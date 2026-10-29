import { allModules } from "./catalog";
import {
  connectionAvailable,
  requireConnection,
  trustedNow,
} from "./connectivity";
import { Database, RecordEntity, id } from "./model";
import { context, can, requirePermission } from "./service";
import {
  PendingChange,
  readRoot,
  readRemote,
  reviewQueue,
  commitReview,
  refreshCache,
  changed,
  deviceState,
} from "./storage";

const reviewers = [
  "Doctor",
  "Consultant",
  "Medical Director",
  "Nurse",
  "Lab Scientist",
  "Lab Manager",
  "Radiology Reporter",
  "Pharmacist",
  "Pharmacy Manager",
];

function moduleFor(record: RecordEntity) {
  const parentModule: Partial<Record<RecordEntity["kind"], string>> = {
    registration: "patients",
    queue: "journey",
    note: "consult",
    prescriptionItem: "pharmacy",
    sample: "lab",
    labResult: "lab",
    study: "radiology",
    radiologyReport: "radiology",
  };
  if (parentModule[record.kind])
    return allModules.find((m) => m.id === parentModule[record.kind]);
  return allModules.find(
    (m) =>
      m.kind === record.kind &&
      (record.kind !== "procedure" || m.id === record.data.module) &&
      (record.kind !== "admission" ||
        (record.data.module === "icu" ? m.id === "icu" : m.id !== "icu")),
  );
}
function authorize(db: Database, item: PendingChange) {
  const ctx = context(db);
  if (
    deviceState().locked ||
    !reviewers.includes(ctx.m.role) ||
    ctx.a.forcePasswordChange ||
    item.hospitalId !== ctx.h.id ||
    !item.changes.length
  )
    throw Error("An authorized clinical reviewer must review this work.");
  for (const change of item.changes) {
    const record = change.after;
    const mod = moduleFor(record);
    if (
      !mod ||
      record.hospitalId !== ctx.h.id ||
      record.branchId !== ctx.s.branchId ||
      !can(db, mod.id) ||
      !can(db, mod.id, "edit")
    )
      throw Error(
        "This review is outside your clinical or branch permissions.",
      );
    requirePermission(db, mod.id, "edit");
  }
  return ctx;
}
function hasEarlierWork(queue: PendingChange[], item: PendingChange) {
  return queue.some(
    (q) =>
      q.id !== item.id &&
      q.sequence < item.sequence &&
      q.state !== "synced" &&
      q.changes.some((c) =>
        item.changes.some((change) => change.after.id === c.after.id),
      ),
  );
}
export async function listConflictReviews() {
  if (deviceState().locked || !connectionAvailable()) return [];
  const db = await readRoot();
  let ctx;
  try {
    ctx = context(db);
  } catch {
    return [];
  }
  const result: { id: string; count: number; deviceAt: string }[] = [];
  const queue = await reviewQueue(ctx.h.id);
  for (const item of queue) {
    if (item.state !== "conflict" || hasEarlierWork(queue, item)) continue;
    try {
      authorize(db, item);
    } catch {
      continue;
    }
    result.push({
      id: item.id,
      count: item.changes.length,
      deviceAt: item.deviceAt,
    });
  }
  return result;
}
async function snapshot(db: Database, item: PendingChange) {
  const ctx = authorize(db, item);
  const records = [];
  for (const change of item.changes) {
    const remote = await readRemote(change.after.id);
    const current = db.records.find((r) => r.id === change.after.id);
    if (
      !current ||
      current.hospitalId !== change.after.hospitalId ||
      current.branchId !== change.after.branchId ||
      (remote &&
        (remote.kind !== change.after.kind ||
          remote.hospitalId !== current.hospitalId ||
          remote.branchId !== current.branchId))
    )
      throw Error(
        "Record scope changed. Ask your administrator to review this work.",
      );
    records.push({ local: change.after, remote, current });
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify({ item, records })),
  );
  const token = Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
  return {
    id: item.id,
    token,
    deviceAt: item.deviceAt,
    records,
    sessionId: ctx.s.id,
    membershipId: ctx.m.id,
    branchId: ctx.s.branchId,
  };
}
export type ConflictReview = Awaited<ReturnType<typeof snapshot>>;

export async function retainsReviewAccess(review: ConflictReview) {
  if (localStorage.getItem("health-id-session") !== review.sessionId)
    return false;
  // Connectivity loss keeps entered review choices; submitting still requires
  // fresh authority. The existing opaque lock screen protects inactive sessions.
  if (!connectionAvailable() || deviceState().locked) return true;
  const db = await readRoot();
  try {
    const ctx = context(db);
    if (ctx.m.id !== review.membershipId || ctx.s.branchId !== review.branchId)
      return false;
    const item = (await reviewQueue(ctx.h.id)).find((i) => i.id === review.id);
    if (!item) return false;
    authorize(db, item);
    return true;
  } catch {
    return false;
  }
}

export async function getConflictReview(
  batchId: string,
): Promise<ConflictReview> {
  await requireConnection();
  return navigator.locks.request("health-id-write", async () => {
    const db = await readRoot();
    const queue = await reviewQueue(context(db).h.id);
    const item = queue.find((i) => i.id === batchId);
    if (!item || item.state !== "conflict")
      throw Error("This review is no longer available. Refresh the list.");
    if (hasEarlierWork(queue, item))
      throw Error("Earlier saved work must be synced or reviewed first.");
    return snapshot(db, item);
  });
}
export async function resolveConflict(
  batchId: string,
  token: string,
  choices: Record<string, "local" | "remote">,
  reason: string,
) {
  await requireConnection();
  if (!reason.trim() || reason.trim().length < 10 || reason.length > 1000)
    throw Error("Explain the review decision in 10 to 1,000 characters.");
  const cacheRefreshed = await navigator.locks.request(
    "health-id-write",
    async () => {
      const db = await readRoot();
      const queue = await reviewQueue(context(db).h.id);
      const item = queue.find((i) => i.id === batchId);
      if (!item) throw Error("This review is no longer available.");
      const ctx = authorize(db, item);
      // A retried accepted request must not append another version or audit event.
      if (item.state === "synced" && item.resolution)
        return refreshCache(db).then(
          () => true,
          () => false,
        );
      if (item.state !== "conflict")
        throw Error("This item is not awaiting conflict review.");
      if (hasEarlierWork(queue, item))
        throw Error("Earlier saved work must be synced or reviewed first.");
      const review = await snapshot(db, item);
      if (review.token !== token)
        throw Error(
          "A version changed while you were reviewing. Reload the versions and review again.",
        );
      const at = new Date(trustedNow()).toISOString();
      const selected: RecordEntity[] = [];
      const versions: NonNullable<PendingChange["resolution"]>["versions"] = [];
      for (const pair of review.records) {
        const choice = choices[pair.local.id];
        if (choice !== "local" && choice !== "remote")
          throw Error("Choose a version for every record.");
        const source = choice === "local" ? pair.local : pair.remote;
        if (!source)
          throw Error(
            "The connected version is unavailable. Reload the review.",
          );
        const result = structuredClone(source);
        const history = [
          ...pair.local.versions,
          ...(pair.remote?.versions || []),
        ];
        for (const [label, record] of [
          ["Device version", pair.local],
          ["Connected version", pair.remote],
        ] as const) {
          if (record)
            history.push({
              at: record.updatedAt,
              authorId: record.authorId,
              reason: `${label} retained during conflict review`,
              data: record.data,
              status: record.status,
            });
        }
        result.versions = Array.from(
          new Map(history.map((v) => [JSON.stringify(v), v])).values(),
        );
        result.versions.push({
          at,
          authorId: ctx.a.id,
          reason: reason.trim(),
          data: result.data,
          status: result.status,
        });
        result.updatedAt = at;
        delete result.conflict;
        result.sync = {
          state: "synced",
          deviceAt: item.deviceAt,
          receivedAt: at,
        };
        selected.push(result);
        versions.push({
          local: pair.local,
          remote: pair.remote,
          selected: result,
        });
        // Later edits stay intact. Their original base is retained so a divergent
        // later batch needs another explicit review rather than silently winning.
        const later = queue.some(
          (q) =>
            q.id !== item.id &&
            q.sequence > item.sequence &&
            q.state !== "synced" &&
            q.changes.some((c) => c.after.id === result.id),
        );
        if (!later)
          db.records[db.records.findIndex((r) => r.id === result.id)] = result;
        else {
          const current = db.records.find((r) => r.id === result.id)!;
          if (current.conflict?.id === item.id) delete current.conflict;
          current.versions = [...result.versions, ...current.versions];
          current.sync = { state: "pending", deviceAt: current.updatedAt };
        }
      }
      item.state = "synced";
      item.receivedAt = at;
      delete item.reason;
      item.resolution = {
        reviewerId: ctx.a.id,
        at,
        reason: reason.trim(),
        choices,
        versions,
      };
      db.audit.push({
        id: id(),
        actorId: ctx.a.id,
        membershipId: ctx.m.id,
        hospitalId: ctx.h.id,
        branchId: ctx.s.branchId,
        action: "sync.conflict.resolved",
        resource: item.id,
        at,
        reason: reason.trim(),
        deviceAt: item.deviceAt,
        serverReceivedAt: at,
      });
      await commitReview(db, item, selected);
      // Cache refresh may be retried independently after a committed decision.
      return refreshCache(db).then(
        () => true,
        () => false,
      );
    },
  );
  await changed();
  return { cacheRefreshed };
}
