import { connectionAvailable, trustedNow } from "./connectivity";
import { id } from "./model";
import {
  queueForCurrent,
  readRoot,
  write,
  readRemote,
  writeRemote,
  syncReceipt,
  saveQueue,
  refreshCache,
  markCacheSynced,
  changed,
  deviceState,
  syncing,
  commitReview,
} from "./storage";
const content = (r: any) =>
  JSON.stringify(r ? { data: r.data, status: r.status } : null);
export async function syncNow() {
  if (!connectionAvailable() || deviceState().locked || deviceState().syncing)
    return;
  syncing(true);
  let completed = 0;
  try {
    await navigator.locks.request("health-id-write", async () => {
      const root = await readRoot();
      const session = root.sessions.find(
        (s) => s.id === localStorage.getItem("health-id-session"),
      );
      if (!session || session.expires < trustedNow()) return;
      const account = root.accounts.find((a) => a.id === session.accountId);
      if (!account || account.credentialVersion !== session.version) return;
      const blocked = new Set<string>();
      for (const item of await queueForCurrent()) {
        if (item.state === "synced") continue;
        if (item.state !== "pending") {
          item.changes.forEach((c) => blocked.add(c.after.id));
          continue;
        }
        if (item.nextAttempt > trustedNow()) {
          item.changes.forEach((c) => blocked.add(c.after.id));
          continue;
        }
        if (item.changes.some((c) => blocked.has(c.after.id))) continue;
        const member = root.memberships.find(
          (m) =>
            m.accountId === item.accountId &&
            m.hospitalId === item.hospitalId &&
            m.status === "active",
        );
        if (
          !member ||
          item.authority !==
            JSON.stringify([
              member.role,
              member.branchIds,
              member.extraPermissions,
              member.deniedPermissions,
            ])
        ) {
          item.state = "attention";
          item.reason =
            "Access changed. An administrator must review this pending work.";
          await saveQueue(item);
          continue;
        }
        try {
          let receipt = await syncReceipt(item.id);
          if (!receipt) {
            let conflict = false;
            for (const c of item.changes) {
              const remote = await readRemote(c.after.id);
              delete c.after.conflict;
              if (
                remote &&
                content(remote) !== content(c.before) &&
                content(remote) !== content(c.after)
              ) {
                conflict = true;
                const local = root.records.find((r) => r.id === c.after.id);
                if (local) {
                  local.sync = { state: "conflict", deviceAt: item.deviceAt };
                  local.conflict = {
                    id: item.id,
                    kind: local.kind,
                    local: c.after.data,
                    remote: remote.data,
                    status: "needs-review",
                    reason:
                      "Another device changed this record. Both versions are retained.",
                  };
                }
              }
            }
            if (conflict) {
              item.state = "conflict";
              item.reason = "Conflicting versions retained for review.";
              item.changes.forEach((c) => blocked.add(c.after.id));
              root.audit.push({
                id: id(),
                actorId: item.accountId,
                membershipId: member.id,
                hospitalId: item.hospitalId,
                branchId: item.changes[0].after.branchId,
                action: "sync.conflict.flagged",
                resource: item.id,
                at: new Date(trustedNow()).toISOString(),
                reason: "Conflicting versions retained for clinical review.",
                deviceAt: item.deviceAt,
              });
              await commitReview(root, item, []);
              continue;
            }
            receipt = { id: item.id, at: new Date(trustedNow()).toISOString() };
            for (const c of item.changes) {
              const remote = await readRemote(c.after.id);
              const history = [
                ...(remote?.versions || []),
                ...c.after.versions,
              ];
              c.after.versions = Array.from(
                new Map(history.map((v) => [JSON.stringify(v), v])).values(),
              );
              const local = root.records.find((r) => r.id === c.after.id);
              if (local)
                local.versions = Array.from(
                  new Map(
                    [...c.after.versions, ...local.versions].map((v) => [
                      JSON.stringify(v),
                      v,
                    ]),
                  ).values(),
                );
            }
            await writeRemote(
              item.changes.map((c) => c.after),
              receipt,
            );
          }
          item.state = "synced";
          completed++;
          item.receivedAt = receipt.at;
          item.reason = undefined;
          await saveQueue(item);
          for (const c of item.changes) {
            const r = root.records.find((r) => r.id === c.after.id);
            if (r)
              r.sync = {
                state: "synced",
                deviceAt: item.deviceAt,
                receivedAt: receipt.at,
              };
          }
        } catch (e) {
          item.attempts++;
          item.nextAttempt =
            trustedNow() +
            Math.min(300000, 1000 * 2 ** Math.min(item.attempts, 8));
          item.reason = (e as Error).message;
          await saveQueue(item);
          item.changes.forEach((c) => blocked.add(c.after.id));
        }
      }
      for (const item of await queueForCurrent()) {
        if (item.state === "synced") continue;
        for (const c of item.changes) {
          const record = root.records.find((r) => r.id === c.after.id);
          if (record)
            record.sync = {
              state: record.conflict ? "conflict" : item.state,
              deviceAt: item.deviceAt,
              reason: item.reason,
            };
        }
      }
      await write(root);
      await refreshCache(root);
      await markCacheSynced();
    });
    await changed();
    if (completed)
      window.dispatchEvent(
        new CustomEvent("hid-toast", {
          detail: { code: "synced", count: completed },
        }),
      );
  } finally {
    syncing(false);
  }
}
