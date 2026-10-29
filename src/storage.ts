import { Database, emptyDB, RecordEntity, id } from "./model";
import {
  connectionAvailable,
  requireConnection,
  trustedNow,
  networkSnapshot,
} from "./connectivity";
import { allModules, permissions } from "./catalog";
import { clinicalReadOnly } from "./subscription-model";
export interface Envelope {
  encrypted: true;
  iv: Uint8Array;
  bytes: ArrayBuffer;
}
export interface PendingChange {
  authority?: string;
  id: string;
  accountId: string;
  hospitalId: string;
  deviceAt: string;
  receivedAt?: string;
  sequence: number;
  priority: number;
  attempts: number;
  nextAttempt: number;
  state: "pending" | "attention" | "conflict" | "synced";
  reason?: string;
  changes: { before?: RecordEntity; after: RecordEntity }[];
  audit: Database["audit"];
  resolution?: {
    reviewerId: string;
    at: string;
    reason: string;
    choices: Record<string, "local" | "remote">;
    versions: {
      local: RecordEntity;
      remote?: RecordEntity;
      selected: RecordEntity;
    }[];
  };
}
export interface CacheMeta {
  accountId: string;
  hospitalId: string;
  branchId: string;
  salt: string;
  emailHash: string;
  expires: number;
  confirmedAt: number;
  lastSync: number | null;
  attempts: number;
}
interface Runtime {
  key?: CryptoKey;
  accountId?: string;
  scope?: string;
  locked: boolean;
  reason: string;
  lastActivity: number;
  syncing: boolean;
}
const runtime: Runtime = ((globalThis as any).__healthIdRuntime ||= {
  locked: false,
  reason: "",
  lastActivity: Date.now(),
  syncing: false,
});
let connection: Promise<IDBDatabase> | undefined;
export function open() {
  return (connection ||= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("health-id-hospital", 2);
    req.onupgradeneeded = () => {
      for (const name of ["state", "cache", "outbox", "remote"])
        if (!req.result.objectStoreNames.contains(name))
          req.result.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      connection = undefined;
      reject(
        Error("Local storage could not open. Allow browser storage and retry."),
      );
    };
  }));
}
export async function stored<T>(
  store: string,
  key: IDBValidKey,
): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () =>
      reject(
        Error(
          "Unable to read saved data. Retry without resetting your records.",
        ),
      );
  });
}
async function entries<T>(store: string): Promise<[IDBValidKey, T][]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store),
      s = tx.objectStore(store),
      keys = s.getAllKeys(),
      values = s.getAll();
    tx.oncomplete = () =>
      resolve(keys.result.map((key, i) => [key, values.result[i]]));
    tx.onerror = () => reject(Error("Unable to inspect local storage."));
  });
}
export async function atomic(
  values: {
    store: string;
    key: IDBValidKey;
    value?: unknown;
    remove?: boolean;
  }[],
) {
  if (!values.length) return;
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      [...new Set(values.map((v) => v.store))],
      "readwrite",
    );
    try {
      for (const v of values)
        v.remove
          ? tx.objectStore(v.store).delete(v.key)
          : tx.objectStore(v.store).put(v.value, v.key);
    } catch {
      tx.abort();
      reject(
        Error(
          "Changes were not saved. Free device storage and retry; pending work is retained.",
        ),
      );
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () =>
      reject(
        Error(
          "Changes were not saved. Device storage may be full. Free space and retry; your form is still here.",
        ),
      );
  });
}
let masterPromise: Promise<CryptoKey> | undefined;
async function master() {
  return (masterPromise ||= navigator.locks.request(
    "health-id-encryption-key",
    async () => {
      const existing = await stored<CryptoKey>("state", "device-key");
      if (existing) return existing;
      const key = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
      await atomic([{ store: "state", key: "device-key", value: key }]);
      return key;
    },
  ));
}
export async function seal(data: unknown, key: CryptoKey): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return {
    encrypted: true,
    iv,
    bytes: await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(data)),
    ),
  };
}
export async function unseal<T>(data: Envelope, key: CryptoKey): Promise<T> {
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: data.iv as BufferSource },
        key,
        data.bytes,
      ),
    ),
  );
}
async function accountKey(hash: string) {
  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(hash.match(/.{2}/g)!.map((x) => parseInt(x, 16))),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}
async function digest(text: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return [
    ...new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          salt: new TextEncoder().encode(salt),
          iterations: 100000,
          hash: "SHA-256",
        },
        key,
        256,
      ),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function readRoot(): Promise<Database> {
  const saved = await stored<Envelope | Database>("state", "data");
  if (!saved) return emptyDB();
  if ("encrypted" in saved) return unseal<Database>(saved, await master());
  if (saved.schema !== 1) throw Error("Unsupported local data version.");
  await write(saved);
  return saved;
}
export async function write(data: Database) {
  await atomic([
    { store: "state", key: "data", value: await seal(data, await master()) },
  ]);
}
const channel = new BroadcastChannel("health-id-changes");
export const listeners = new Set<() => void | Promise<void>>();
channel.onmessage = () => {
  listeners.forEach((f) => {
    void Promise.resolve(f()).catch(() => {});
  });
};
export async function changed() {
  channel.postMessage("changed");
  await Promise.all(
    [...listeners].map(async (f) => {
      try {
        await f();
      } catch {}
    }),
  );
}
export const lockListeners = new Set<() => void>();
export const deviceState = () => ({ ...runtime });
export function lockDevice(
  reason = "Your workspace is locked after inactivity. Saved work is safe.",
) {
  runtime.locked = true;
  runtime.key = undefined;
  runtime.reason = reason;
  lockListeners.forEach((f) => f());
}
export function noteActivity() {
  runtime.lastActivity = Date.now();
}
export function startAutoLock() {
  const key = "__healthIdLockStarted";
  if ((globalThis as any)[key]) return;
  (globalThis as any)[key] = true;
  for (const event of ["pointerdown", "keydown", "touchstart"])
    window.addEventListener(
      event,
      () => {
        if (!runtime.locked) noteActivity();
      },
      { passive: true },
    );
  setInterval(() => {
    if (
      localStorage.getItem("health-id-session") &&
      !runtime.locked &&
      Date.now() - runtime.lastActivity > 5 * 60000
    )
      lockDevice();
  }, 10000);
}
function current(db: Database) {
  const s = db.sessions.find(
    (s) => s.id === localStorage.getItem("health-id-session"),
  );
  const a = db.accounts.find((a) => a.id === s?.accountId);
  const m = db.memberships.find(
    (m) => m.id === s?.membershipId && m.accountId === a?.id,
  );
  return { s, a, m };
}
export function cacheProjection(db: Database): Database {
  const { s, a, m } = current(db);
  if (!s || !a || !m) return db;
  const p = new Set(
    [...permissions(m.role), ...m.extraPermissions].filter(
      (x) => !m.deniedPermissions.includes(x),
    ),
  );
  const kinds = new Set(
    allModules.filter((mod) => p.has(mod.id + ".view")).map((mod) => mod.kind),
  );
  if (kinds.has("labOrder"))
    ["sample", "labResult"].forEach((k) => kinds.add(k as any));
  if (kinds.has("radiologyOrder"))
    ["study", "radiologyReport"].forEach((k) => kinds.add(k as any));
  if (kinds.has("encounter")) kinds.add("note");
  if (kinds.has("prescription"))
    ["prescriptionItem", "inventory", "batch"].forEach((k) =>
      kinds.add(k as any),
    );
  if (kinds.has("invoice"))
    ["payment", "refund", "service"].forEach((k) => kinds.add(k as any));
  if (kinds.has("inventory"))
    ["batch", "stockMovement"].forEach((k) => kinds.add(k as any));
  if (kinds.has("admission"))
    ["ward", "bed"].forEach((k) => kinds.add(k as any));
  if (p.has("consent.view")) kinds.add("grant");
  kinds.add("notification");
  kinds.add("registration");
  const scoped = db.records.filter(
    (r) => r.hospitalId === m.hospitalId && r.branchId === s.branchId,
  );
  const relevant = scoped.filter(
    (r) =>
      r.authorId === a.id ||
      r.data.clinician === m.id ||
      Date.parse(r.updatedAt) > trustedNow() - 7 * 86400000,
  );
  const wanted = new Set(
    relevant.map((r) => r.patientId || (r.kind === "patient" ? r.id : "")),
  );
  const patients = scoped
    .filter((r) => r.kind === "patient" && wanted.has(r.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 100);
  const ids = new Set(patients.map((p) => p.id));
  let records = scoped.filter(
    (r) => kinds.has(r.kind) && (!r.patientId || ids.has(r.patientId)),
  );
  if (
    [...kinds].some((k) =>
      [
        "patient",
        "visit",
        "triage",
        "encounter",
        "labOrder",
        "radiologyOrder",
        "prescription",
        "invoice",
        "admission",
        "procedure",
      ].includes(k),
    )
  )
    records = [...records.filter((r) => r.kind !== "patient"), ...patients];
  records = records.map((r) => {
    const copy = structuredClone(r);
    for (const [key, value] of Object.entries(copy.data))
      if (typeof value === "string" && value.startsWith("data:"))
        delete copy.data[key];
    return copy;
  });
  const out = structuredClone(db);
  out.offlineAuthority = {
    checkedAt: trustedNow(),
    validUntil: s.expires,
    clinicalWriteAllowed: !clinicalReadOnly(
      db,
      db.hospitals.find((h) => h.id === m.hospitalId)!,
    ),
  };
  out.records = records;
  out.hospitals = db.hospitals.filter((h) => h.id === m.hospitalId);
  out.branches = db.branches.filter(
    (b) => b.hospitalId === m.hospitalId && m.branchIds.includes(b.id),
  );
  out.memberships = db.memberships.filter((x) => x.hospitalId === m.hospitalId);
  out.accounts = db.accounts
    .filter((x) => out.memberships.some((m) => m.accountId === x.id))
    .map((x) =>
      x.id === a.id
        ? x
        : {
            ...x,
            hash: "",
            salt: "",
            photo: undefined,
            securityNotices: undefined,
            pendingEmail: undefined,
            preferences: undefined,
            credentials: undefined,
          },
    );
  out.sessions = [s];
  out.codes = [];
  out.invitations = p.has("staff.view")
    ? db.invitations.filter((i) => i.hospitalId === m.hospitalId)
    : [];
  out.audit = p.has("audit.view")
    ? db.audit.filter(
        (e) => e.hospitalId === m.hospitalId && e.branchId === s.branchId,
      )
    : [];
  out.drafts = Object.fromEntries(
    Object.entries(db.drafts).filter(([k]) =>
      k.startsWith(a.id + ":" + m.hospitalId + ":" + s.branchId + ":"),
    ),
  );
  delete out.facilityDrafts;
  out.subscriptions = undefined;
  out.subscriptionConfig = undefined;
  out.subscriptionReminders = undefined;
  return out;
}
export async function refreshCache(db?: Database) {
  if (!connectionAvailable() || runtime.locked) return;
  db ||= await readRoot();
  const { s, a, m } = current(db);
  if (!s || !a || !m) return;
  if (m.status !== "active" || s.version !== a.credentialVersion) {
    await clearUserCache(a.id);
    lockDevice(
      "Your access changed. Contact your administrator or sign in again.",
    );
    return;
  }
  runtime.key = await accountKey(a.hash);
  runtime.accountId = a.id;
  runtime.scope = a.id + ":" + m.hospitalId + ":" + s.branchId;
  const existing = await stored<CacheMeta>("cache", runtime.scope + ":meta");
  const meta: CacheMeta = {
    accountId: a.id,
    hospitalId: m.hospitalId,
    branchId: s.branchId,
    salt: a.salt,
    emailHash: await digest(a.email),
    expires: Math.min(s.expires, trustedNow() + 8 * 3600000),
    confirmedAt: trustedNow(),
    lastSync: existing?.lastSync || null,
    attempts: 0,
  };
  const projection = cacheProjection(db);
  await atomic([
    {
      store: "cache",
      key: runtime.scope,
      value: await seal(projection, runtime.key),
    },
    { store: "cache", key: runtime.scope + ":meta", value: meta },
  ]);
  sessionStorage.setItem("health-id-cache-scope", runtime.scope);
}
export async function cachedData(): Promise<Database> {
  const scope =
    runtime.scope || sessionStorage.getItem("health-id-cache-scope");
  if (runtime.locked || !runtime.key || !scope) {
    lockDevice("Unlock your cached workspace to continue.");
    throw Error("Workspace locked.");
  }
  const meta = await stored<CacheMeta>("cache", scope + ":meta");
  if (
    !meta ||
    trustedNow() > meta.expires ||
    trustedNow() < meta.confirmedAt - 300000
  ) {
    lockDevice(
      "Reconnect to renew your eight-hour offline access window. Pending work is retained.",
    );
    throw Error("Reconnect to renew offline access.");
  }
  const encrypted = await stored<Envelope>("cache", scope);
  if (!encrypted)
    throw Error("This workspace is not cached yet. Connect and open it first.");
  return unseal<Database>(encrypted, runtime.key);
}
export async function read(): Promise<Database> {
  if (
    localStorage.getItem("health-id-session") &&
    networkSnapshot().checkedAt === null
  ) {
    await requireConnection().catch(() => {});
  }
  if (
    !connectionAvailable() &&
    networkSnapshot().checkedAt !== null &&
    localStorage.getItem("health-id-session")
  )
    return cachedData();
  return readRoot();
}
export async function unlockDevice(email: string, password: string) {
  const metas = (await entries<CacheMeta>("cache")).filter(([key]) =>
    String(key).endsWith(":meta"),
  );
  const hash = await digest(email.trim().toLowerCase());
  const selected = metas.find(([, meta]) => meta.emailHash === hash);
  if (!selected) {
    await requireConnection();
    const root = await readRoot();
    const a = root.accounts.find((a) => a.email === email.trim().toLowerCase());
    if (!a || (await passwordHash(password, a.salt)) !== a.hash)
      throw Error("Unable to unlock. Check your credentials.");
    runtime.locked = false;
    await refreshCache(root);
    lockListeners.forEach((f) => f());
    return;
  }
  const [key, meta] = selected;
  const scope = String(key).replace(/:meta$/, "");
  try {
    const encryptionKey = await accountKey(
      await passwordHash(password, meta.salt),
    );
    const enc = await stored<Envelope>("cache", scope);
    if (!enc) throw Error("missing");
    const db = await unseal<Database>(enc, encryptionKey);
    if (trustedNow() > meta.expires || trustedNow() < meta.confirmedAt - 300000)
      throw Error("window");
    if (connectionAvailable()) {
      const root = await readRoot();
      const a = root.accounts.find((a) => a.id === meta.accountId);
      const m = root.memberships.find(
        (m) => m.id === db.sessions[0]?.membershipId,
      );
      if (
        !a ||
        a.credentialVersion !==
          db.accounts.find((a) => a.id === meta.accountId)?.credentialVersion ||
        m?.status !== "active"
      ) {
        await clearUserCache(meta.accountId);
        throw Error("revoked");
      }
    }
    runtime.key = encryptionKey;
    runtime.accountId = meta.accountId;
    runtime.scope = scope;
    runtime.locked = false;
    runtime.reason = "";
    noteActivity();
    localStorage.setItem("health-id-session", db.sessions[0].id);
    sessionStorage.setItem("health-id-cache-scope", scope);
    meta.attempts = 0;
    await atomic([{ store: "cache", key, value: meta }]);
    lockListeners.forEach((f) => f());
    await changed();
    return;
  } catch (error) {
    meta.attempts++;
    if (meta.attempts >= 5) {
      await clearUserCache(meta.accountId);
      lockDevice("Cached records cleared. Reconnect and sign in again.");
    } else await atomic([{ store: "cache", key, value: meta }]);
    throw Error(
      (error as Error).message === "window"
        ? "Reconnect to renew offline access. Saved pending changes are retained."
        : meta.attempts >= 5
          ? "Cached records cleared after five failed attempts. Connect and sign in again; encrypted pending changes are retained."
          : "Unable to unlock. Check your credentials or reconnect.",
    );
  }
}
export async function clearUserCache(accountId: string) {
  const keys = (await entries<unknown>("cache")).filter(([key]) =>
    String(key).startsWith(accountId + ":"),
  );
  await atomic(keys.map(([key]) => ({ store: "cache", key, remove: true })));
  runtime.key = undefined;
  runtime.accountId = undefined;
  runtime.scope = undefined;
  runtime.locked = false;
  sessionStorage.removeItem("health-id-cache-scope");
  lockListeners.forEach((f) => f());
}
let failNext = false;
export function simulateFailure() {
  failNext = true;
}
function applyChanges(root: Database, before: Database, after: Database) {
  for (const key of [
    "records",
    "audit",
    "sessions",
    "accounts",
    "memberships",
  ] as const) {
    const old = new Map((before[key] as any[]).map((r) => [r.id, r]));
    const next = after[key] as any[];
    const target = root[key] as any[];
    for (const r of next)
      if (JSON.stringify(old.get(r.id)) !== JSON.stringify(r)) {
        const index = target.findIndex((x) => x.id === r.id);
        if (index < 0) target.push(r);
        else target[index] = r;
      }
    for (const r of before[key] as any[])
      if (!next.some((x) => x.id === r.id)) {
        const index = target.findIndex((x) => x.id === r.id);
        if (index >= 0) target.splice(index, 1);
      }
  }
  for (const [key, value] of Object.entries(after.drafts))
    root.drafts[key] = value;
  for (const key of Object.keys(before.drafts))
    if (!(key in after.drafts)) delete root.drafts[key];
  root.operations = [...new Set([...root.operations, ...after.operations])];
  return root;
}
export async function transaction<T>(
  fn: (db: Database) => T | Promise<T>,
): Promise<T> {
  return navigator.locks.request("health-id-write", async () => {
    if (failNext) {
      failNext = false;
      throw Error(
        "Simulated operation failure. No changes saved. Retry this operation.",
      );
    }
    const offline =
      !connectionAvailable() &&
      networkSnapshot().checkedAt !== null &&
      !!localStorage.getItem("health-id-session");
    const db = offline ? await cachedData() : await readRoot();
    const before = structuredClone(db);
    const result = await fn(db);
    const root = offline ? applyChanges(await readRoot(), before, db) : db;
    const { s, a, m } = current(before);
    const changes = db.records
      .filter(
        (r) =>
          JSON.stringify(before.records.find((b) => b.id === r.id)) !==
            JSON.stringify(r) && r.kind !== "notification",
      )
      .map((after) => ({
        before: before.records.find((r) => r.id === after.id),
        after,
      }));
    if (a && s && m)
      for (const change of changes)
        change.after.sync = {
          state: "pending",
          deviceAt: new Date().toISOString(),
        };
    const mutations: { store: string; key: IDBValidKey; value: unknown }[] = [
      { store: "state", key: "data", value: await seal(root, await master()) },
    ];
    if (a && s && m && changes.length) {
      const key =
        runtime.key && runtime.accountId === a.id
          ? runtime.key
          : await accountKey(a.hash);
      const change: PendingChange = {
        authority: JSON.stringify([
          m.role,
          m.branchIds,
          m.extraPermissions,
          m.deniedPermissions,
        ]),
        id: id(),
        accountId: a.id,
        hospitalId: m.hospitalId,
        deviceAt: new Date().toISOString(),
        sequence: ((globalThis as any).__healthIdSequence = Math.max(
          Date.now() * 1000,
          ((globalThis as any).__healthIdSequence || 0) + 1,
        )),
        priority: changes.some((c) =>
          JSON.stringify(c.after.data).includes("data:"),
        )
          ? 2
          : 0,
        attempts: 0,
        nextAttempt: 0,
        state: "pending",
        changes,
        audit: db.audit.filter((e) => !before.audit.some((b) => b.id === e.id)),
      };
      mutations.push({
        store: "outbox",
        key: change.id,
        value: {
          accountId: a.id,
          hospitalId: m.hospitalId,
          payload: await seal(change, await master()),
        },
      });
      for (const c of changes) {
        if (!(await stored("remote", c.after.id)) && c.before)
          mutations.push({
            store: "remote",
            key: c.after.id,
            value: await seal(c.before, await master()),
          });
      }
    }
    if (offline && runtime.scope && runtime.key)
      mutations.push({
        store: "cache",
        key: runtime.scope,
        value: await seal(db, runtime.key),
      });
    await atomic(mutations);
    await changed();
    return result;
  });
}
export async function queueForCurrent(): Promise<PendingChange[]> {
  if (!runtime.key || !runtime.accountId || runtime.locked) return [];
  const list = await entries<{ accountId: string; payload: Envelope }>(
    "outbox",
  );
  const result: PendingChange[] = [];
  for (const [, v] of list)
    if (v.accountId === runtime.accountId) {
      try {
        result.push(await unseal<PendingChange>(v.payload, await master()));
      } catch {}
    }
  return result.sort(
    (a, b) => a.priority - b.priority || a.sequence - b.sequence,
  );
}
export async function hasPendingDeviceChanges() {
  for (const [, value] of await entries<{payload: Envelope}>("outbox")) {
    try {
      if ((await unseal<PendingChange>(value.payload, await master())).state !== "synced") return true;
    } catch { return true; }
  }
  return false;
}
export async function saveQueue(item: PendingChange) {
  if (!runtime.key) throw Error("Unlock your workspace to sync.");
  await atomic([
    {
      store: "outbox",
      key: item.id,
      value: {
        accountId: item.accountId,
        hospitalId: item.hospitalId,
        payload: await seal(item, await master()),
      },
    },
  ]);
}
export async function readRemote(recordId: string) {
  const enc = await stored<Envelope>("remote", recordId);
  return enc ? unseal<RecordEntity>(enc, await master()) : undefined;
}
// Raw encrypted storage access; callers must check current clinical authority.
export async function reviewQueue(
  hospitalId: string,
): Promise<PendingChange[]> {
  if (!runtime.key || runtime.locked) return [];
  const rows = await entries<{ hospitalId: string; payload: Envelope }>(
    "outbox",
  );
  const result: PendingChange[] = [];
  for (const [, row] of rows)
    if (row.hospitalId === hospitalId)
      result.push(await unseal<PendingChange>(row.payload, await master()));
  return result.sort((a, b) => a.sequence - b.sequence);
}
// Called under health-id-write: keep the decision, audit, outbox and simulated
// authority in one transaction so a crash cannot acknowledge a partial review.
export async function commitReview(
  root: Database,
  item: PendingChange,
  records: RecordEntity[],
) {
  if (!runtime.key || runtime.locked)
    throw Error("Unlock your workspace to continue.");
  const key = await master();
  await atomic([
    { store: "state", key: "data", value: await seal(root, key) },
    {
      store: "outbox",
      key: item.id,
      value: {
        accountId: item.accountId,
        hospitalId: item.hospitalId,
        payload: await seal(item, key),
      },
    },
    ...(await Promise.all(
      records.map(async (r) => ({
        store: "remote",
        key: r.id,
        value: await seal(r, key),
      })),
    )),
    ...(item.state === "synced"
      ? [
          {
            store: "remote",
            key: "receipt:" + item.id,
            value: { id: item.id, at: item.receivedAt },
          },
        ]
      : []),
  ]);
}
export async function writeRemote(
  records: RecordEntity[],
  receipt?: { id: string; at: string },
) {
  await atomic([
    ...(await Promise.all(
      records.map(async (r) => ({
        store: "remote",
        key: r.id,
        value: await seal(r, await master()),
      })),
    )),
    ...(receipt
      ? [{ store: "remote", key: "receipt:" + receipt.id, value: receipt }]
      : []),
  ]);
}
export async function syncReceipt(changeId: string) {
  return stored<{ id: string; at: string }>("remote", "receipt:" + changeId);
}
export async function cacheMeta() {
  return runtime.scope
    ? stored<CacheMeta>("cache", runtime.scope + ":meta")
    : undefined;
}
export async function markCacheSynced() {
  const meta = await cacheMeta();
  if (meta && runtime.scope) {
    meta.lastSync = trustedNow();
    await atomic([
      { store: "cache", key: runtime.scope + ":meta", value: meta },
    ]);
  }
}
export function syncing(value: boolean) {
  runtime.syncing = value;
}

export async function remoteRecords() {
  const all = await entries<Envelope>("remote");
  const result: RecordEntity[] = [];
  for (const [key, value] of all)
    if (!String(key).startsWith("receipt:"))
      result.push(await unseal<RecordEntity>(value, await master()));
  return result;
}
