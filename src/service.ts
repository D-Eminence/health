import { DEMO_MODE } from "./config";
import {
  connectionAvailable,
  requireConnection,
  trustedNow,
} from "./connectivity";
import { facilityErrors, safeProfile } from "./facility-fields";
import {
  defaultSubscriptionConfig,
  DAY,
  simulationNow,
  subscriptionAllowed,
  pendingFacility,
  subscriptionState,
  clinicalReadOnly,
} from "./subscription-model";
import {
  Account,
  AuditEvent,
  Branch,
  Database,
  Fields,
  Hospital,
  Invitation,
  Kind,
  Membership,
  RecordEntity,
  Role,
  Session,
  departments,
  emptyDB,
  id,
  now,
  num,
  roles,
  str,
} from "./model";
import { allModules, Field, Module, permissions } from "./catalog";
import { providerAllows } from "./provider";
import {
  read,
  transaction,
  changed,
  refreshCache,
  clearUserCache,
  unlockDevice,
  readRoot,
} from "./storage";
export const SESSION_KEY = "health-id-session";
export function token() {
  return localStorage.getItem(SESSION_KEY) || "";
}
export function sessionIn(db: Database): Session | undefined {
  const s = db.sessions.find((x) => x.id === token());
  const a = db.accounts.find((x) => x.id === s?.accountId);
  return s &&
    a?.verified &&
    s.expires > trustedNow() &&
    s.version === a.credentialVersion
    ? s
    : undefined;
}
export function context(db: Database) {
  const s = sessionIn(db);
  if (!s) throw Error("Your simulated session expired. Sign in again.");
  const a = db.accounts.find((x) => x.id === s.accountId)!;
  const m = db.memberships.find(
    (x) => x.id === s.membershipId && x.accountId === a.id,
  );
  if (!m || m.status !== "active")
    throw Error(
      "This membership is unavailable. Select an active institution.",
    );
  if (!m.branchIds.includes(s.branchId))
    throw Error("Branch access changed. Select an authorized branch.");
  const h = db.hospitals.find((x) => x.id === m.hospitalId)!;
  return { s, a, m, h };
}
export function can(db: Database, module: string, action = "view") {
  try {
    const { m, h, s } = context(db);
    const key = module + "." + action;
    if (
      pendingFacility(h) &&
      ![
        "profile",
        "facility",
        "staff",
        "dashboard",
        "notifications",
        "subscription",
        "platform",
      ].includes(module)
    )
      return false;
    if (module === "subscription" && !subscriptionAllowed(m)) return false;
    if (
      module === "facility" &&
      !["Hospital Owner", "Hospital Admin"].includes(m.role)
    )
      return false;
    const mod = allModules.find((x) => x.id === module);
    if (mod && !providerAllows(h, module)) return false;
    const b = db.branches.find((x) => x.id === s.branchId);
    if (mod?.department && !b?.departments.includes(mod.department))
      return false;
    return (
      !m.deniedPermissions.includes(key) &&
      (permissions(m.role).includes(key) || m.extraPermissions.includes(key))
    );
  } catch {
    return false;
  }
}
export function requirePermission(db: Database, module: string, action = "view") {
  if (!can(db, module, action))
    throw Error(
      "Permission denied. Your active membership does not allow this action.",
    );
  const ctx = context(db);
  if (ctx.a.forcePasswordChange)
    throw Error("Change your password in My profile before making changes.");
  if (
    !connectionAvailable() &&
    [
      "billing",
      "insurance",
      "subscription",
      "staff",
      "setup",
      "platform",
      "hr",
    ].includes(module) &&
    action !== "view" &&
    action !== "export"
  )
    throw Error(
      "This action needs a connection. Your local clinical work remains available.",
    );
  if (
    !connectionAvailable() &&
    db.offlineAuthority &&
    !db.offlineAuthority.clinicalWriteAllowed &&
    action !== "view" &&
    action !== "export" &&
    allModules.some(
      (m) => m.id === module && ["Clinical", "Diagnostics"].includes(m.group),
    )
  )
    throw Error(
      "New entries are unavailable. Contact your administrator. Existing records remain available.",
    );
  if (
    action !== "view" &&
    action !== "export" &&
    clinicalReadOnly(db, ctx.h) &&
    allModules.some(
      (m) =>
        m.id === module &&
        ["Clinical", "Diagnostics", "Network & Services"].includes(m.group),
    ) &&
    !(module === "consent" && action === "emergency")
  )
    throw Error(
      "New entries are unavailable. Contact your administrator. Existing records remain available.",
    );
  return ctx;
}
function audit(
  db: Database,
  action: string,
  resource: string,
  reason = "",
  ctx?: { accountId: string; hospitalId?: string },
) {
  let actorId = ctx?.accountId || "",
    membershipId = "",
    hospitalId = ctx?.hospitalId || "",
    branchId = "";
  try {
    const c = context(db);
    actorId = c.a.id;
    membershipId = c.m.id;
    hospitalId = c.h.id;
    branchId = c.s.branchId;
  } catch {
    /* Authentication and simulation events have no membership yet. */
  }
  const e: AuditEvent = {
    id: id(),
    actorId,
    membershipId,
    hospitalId,
    branchId,
    action,
    resource,
    at: now(),
    reason,
  };
  db.audit.push(e);
}
export function records(db: Database, module: string) {
  if (!can(db, module)) return [];
  const mod = allModules.find((x) => x.id === module);
  if (!mod) return [];
  const { h, s } = context(db);
  return db.records.filter(
    (r) =>
      r.hospitalId === h.id &&
      r.branchId === s.branchId &&
      r.kind === mod.kind &&
      (r.kind !== "procedure" || r.data.module === module) &&
      (module !== "icu" || r.data.module === "icu"),
  );
}
export async function saveShortcuts(ids: string[], role?: Role) {
  await transaction(db => {
    const {m,h} = context(db);
    const selected = [...new Set(ids)].slice(0,6);
    if (role) {
      requirePermission(db,"setup","edit");
      if (!["Hospital Owner","Hospital Admin"].includes(m.role) || !roles.includes(role)) throw Error("Layout access denied.");
      (h.dashboardDefaults ||= {})[role] = selected;
    } else m.shortcuts = selected;
    audit(db,"dashboard.shortcuts-updated",role || m.id);
  });
}
export function scoped(db: Database, kind?: Kind) {
  const { h, s } = context(db);
  return db.records.filter(
    (r) =>
      r.hospitalId === h.id &&
      r.branchId === s.branchId &&
      (!kind || r.kind === kind),
  );
}
function get(db: Database, recordId: string) {
  const c = context(db);
  const r = db.records.find(
    (x) =>
      x.id === recordId &&
      x.hospitalId === c.h.id &&
      x.branchId === c.s.branchId,
  );
  if (!r) throw Error("Record not found in this hospital and branch.");
  return r;
}
function add(
  db: Database,
  kind: Kind,
  data: Fields,
  status = "active",
  refs: Partial<RecordEntity> = {},
): RecordEntity {
  const { h, s, a } = context(db);
  const r: RecordEntity = {
    id: id(),
    kind,
    hospitalId: h.id,
    branchId: s.branchId,
    status,
    createdAt: now(),
    updatedAt: now(),
    authorId: a.id,
    data,
    versions: [],
    ...refs,
  };
  db.records.push(r);
  return r;
}
function notify(
  db: Database,
  text: string,
  route: string,
  metadata: Fields = {},
) {
  add(
    db,
    "notification",
    { text, route, event: "alert", ...metadata },
    "unread",
  );
}
function validate(fields: Field[], data: Fields) {
  for (const f of fields) {
    const value = data[f.key];
    if (
      f.required &&
      (value === undefined || value === "" || (f.type === "checkbox" && !value))
    )
      throw Error(f.label + " is required.");
    if (
      f.type === "number" &&
      value !== "" &&
      value !== undefined &&
      !Number.isFinite(Number(value))
    )
      throw Error(f.label + " must be a number.");
    if (f.options && value && !f.options.includes(String(value)))
      throw Error("Invalid " + f.label);
  }
}
function positive(value: unknown, label = "Quantity") {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0)
    throw Error(label + " must be greater than zero.");
  return n;
}
function reference(db: Database, value: unknown, kind: Kind) {
  const r = get(db, String(value));
  if (r.kind !== kind) throw Error("Incorrect record type for " + kind);
  return r;
}
function ownPatient(db: Database, value: string) {
  return reference(db, value, "patient");
}
function money(value: unknown) {
  return Math.round(positive(value, "Amount") * 100);
}
export function balance(db: Database, invoice: RecordEntity) {
  const paid = db.records
    .filter((r) => r.kind === "payment" && r.parentId === invoice.id)
    .reduce((s, r) => s + num(r.data.cents), 0);
  const refunds = db.records
    .filter((r) => r.kind === "refund" && r.parentId === invoice.id)
    .reduce((s, r) => s + num(r.data.cents), 0);
  return {
    total: num(invoice.data.totalCents),
    paid: paid - refunds,
    due: num(invoice.data.totalCents) - paid + refunds,
  };
}
function recalc(db: Database, invoice: RecordEntity) {
  const b = balance(db, invoice);
  invoice.status = b.due === 0 ? "paid" : b.paid > 0 ? "partial" : "issued";
}
function history(db: Database, r: RecordEntity, reason: string) {
  r.versions.push({
    at: now(),
    authorId: context(db).a.id,
    reason,
    data: structuredClone(r.data),
    status: r.status,
  });
}
async function credential(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const hash = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return [...new Uint8Array(hash)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
function passwordCheck(pw: string) {
  if (pw.length < 8)
    throw Error("Use at least eight characters for this local-only password.");
}
function issue(
  db: Database,
  accountId: string,
  purpose: "verify" | "mfa" | "recover",
  cooldown = true,
) {
  const previous = db.codes
    .filter((c) => c.accountId === accountId && c.purpose === purpose)
    .at(-1);
  if (
    cooldown &&
    previous &&
    !previous.used &&
    Date.now() - previous.sentAt < 30000
  )
    throw Error("Wait 30 seconds before requesting another code.");
  db.codes
    .filter((c) => c.accountId === accountId && c.purpose === purpose)
    .forEach((c) => {
      c.used = true;
      c.recoveryVerified = false;
    });
  const value =
    (crypto.getRandomValues(new Uint32Array(1))[0] % 900000) + 100000;
  const code = {
    id: id(),
    accountId,
    purpose,
    code: String(value),
    expires: Date.now() + 5 * 60000,
    attempts: 0,
    sentAt: Date.now(),
    used: false,
  };
  db.codes.push(code);
  return code.id;
}
function newSession(db: Database, account: Account) {
  const s: Session = {
    id: id(),
    accountId: account.id,
    version: account.credentialVersion,
    expires: trustedNow() + 8 * 3600000,
    device: /Mobile|Android|iPhone/.test(navigator.userAgent)
      ? "Phone / tablet"
      : "Desktop browser",
    lastActive: new Date().toISOString(),
    membershipId: account.lastContext?.membershipId || "",
    branchId: account.lastContext?.branchId || "",
    lastRoute: account.lastContext?.route || "/dashboard",
  };
  db.sessions.push(s);
  return s.id;
}
function createHospital(db: Database, a: Account) {
  const h: Hospital = {
    id: id(),
    ownerId: a.id,
    name: "New hospital",
    phone: "",
    email: a.email,
    address: "",
    city: "",
    state: "",
    registration: "",
    verification: "Not submitted",
    type: "Clinic",
    departments: ["General Outpatient"],
    step: 0,
    launched: false,
    currency: "NGN",
    invoicePrefix: "INV",
    paymentMethods: ["Cash"],
    paymentTiming: "After service",
    insurance: false,
    createdAt: now(),
  };
  db.hospitals.push(h);
  const b: Branch = {
    id: id(),
    hospitalId: h.id,
    name: "Main",
    address: "",
    contact: "",
    departments: h.departments.slice(),
    hours: "09:00-17:00",
  };
  db.branches.push(b);
  db.memberships.push({
    id: id(),
    accountId: a.id,
    hospitalId: h.id,
    role: "Hospital Owner",
    branchIds: [b.id],
    department: "Administration",
    status: "active",
    employment: "employed",
    leave: "working",
    extraPermissions: [],
    deniedPermissions: [],
  });
  return h;
}
export async function register(data: Fields, invitationId?: string) {
  await requireConnection();
  if (!invitationId) {
    for (let step = 0; step < 5; step++) {
      const errors = facilityErrors(step, data);
      if (Object.keys(errors).length) throw Error(Object.values(errors)[0]);
    }
  }
  const email = str(data.email).trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw Error("Enter a valid email.");
  if (!data.name || !data.phone || !data.terms)
    throw Error("Complete your name, phone and terms acknowledgement.");
  const pw = str(data.password);
  passwordCheck(pw);
  if (pw !== data.confirm) throw Error("Passwords do not match.");
  const salt = id(),
    hash = await credential(pw, salt);
  return transaction(async (db) => {
    const existing = db.accounts.find((a) => a.email === email);
    if (
      existing &&
      (invitationId ||
        sessionIn(db)?.accountId !== existing.id ||
        (await credential(pw, existing.salt)) !== existing.hash)
    )
      throw Error(
        "This account already exists. Sign in to continue or recover access.",
      );
    if (invitationId) {
      const inv = db.invitations.find((i) => i.id === invitationId);
      if (
        !inv ||
        inv.email !== email ||
        inv.status !== "pending" ||
        inv.expires < Date.now()
      )
        throw Error("Invitation is not valid for this email.");
    }
    const a: Account = existing || {
      id: id(),
      name: str(data.name),
      email,
      phone: str(data.phone),
      hash,
      salt,
      verified: false,
      credentialVersion: 1,
      createdAt: now(),
    };
    if (!existing) db.accounts.push(a);
    if (!invitationId) {
      const h = createHospital(db, a);
      if (data.facilityName) {
        for (let step = 0; step < 5; step++) {
          const errors = facilityErrors(step, data);
          if (Object.keys(errors).length) throw Error(Object.values(errors)[0]);
        }
        h.registrationProfile = safeProfile(data);
        h.name = str(data.facilityName);
        h.phone = str(data.facilityPhone);
        h.email = str(data.facilityEmail);
        h.address = str(data.address);
        h.state = str(data.state);
        h.city = str(data.lga);
        h.type =
          (
            {
              Hospital: "Community Hospital",
              "Maternity home": "Maternity Centre",
              "Diagnostic lab": "Diagnostic Centre",
              "Specialist centre": "Specialist Clinic",
              Pharmacy: "Clinic",
            } as Record<string, string>
          )[str(data.facilityType)] || str(data.facilityType);
        h.departments = data.departments as string[];
        h.registration = str(data.licence);
        h.verification = "pending_verification";
        h.verificationHistory = [
          {
            status: "submitted",
            at: now(),
            reason: "Agreements accepted in local simulation",
          },
          {
            status: "pending_verification",
            at: now(),
            reason: "Awaiting simulated platform review",
          },
        ];
        const branch = db.branches.find((b) => b.hospitalId === h.id)!;
        Object.assign(branch, {
          address: h.address,
          contact: h.phone,
          departments: h.departments,
          hours: str(data.hours),
        });
        db.subscriptions ||= {};
        db.subscriptions[h.id] = {
          trialStart: null,
          trialEnd: null,
          periodEnd: null,
          plan: "Free trial",
          status: "trialing",
          graceDays: (db.subscriptionConfig || defaultSubscriptionConfig)
            .graceDays,
          history: [],
        };
        if (data.draftId && db.facilityDrafts)
          delete db.facilityDrafts[str(data.draftId)];
      }
    }
    const purpose = existing ? "mfa" : "verify";
    const codeId = issue(db, a.id, purpose);
    audit(db, "account.register", a.id, "Local account simulation", {
      accountId: a.id,
    });
    return { accountId: a.id, codeId, purpose };
  });
}
export async function signIn(email: string, password: string) {
  if (!connectionAvailable()) {
    try {
      await requireConnection();
    } catch {
      await unlockDevice(email, password);
      return { offline: true };
    }
  }

  return transaction(async (db) => {
    const a = db.accounts.find((x) => x.email === email.trim().toLowerCase());
    if (!a || (await credential(password, a.salt)) !== a.hash)
      throw Error("Incorrect email or password.");
    if (a.verified && a.mfaEnabled === false) {
      const session = newSession(db, a);
      localStorage.setItem(SESSION_KEY, session);
      return { session };
    }
    const purpose = a.verified ? "mfa" : "verify";
    const codeId = issue(db, a.id, purpose);
    return { accountId: a.id, codeId, purpose };
  });
}
export async function resend(
  accountId: string,
  purpose: "verify" | "mfa" | "recover",
) {
  await requireConnection();
  return transaction((db) => issue(db, accountId, purpose));
}
export async function recover(identifier: string) {
  await requireConnection();
  return transaction((db) => {
    const input = identifier.trim().toLowerCase();
    const key = "health-id-recovery-attempts";
    const attempts: number[] = JSON.parse(
      localStorage.getItem(key) || "[]",
    ).filter((t: number) => Date.now() - t < 15 * 60000);
    attempts.push(Date.now());
    localStorage.setItem(key, JSON.stringify(attempts));
    const a = db.accounts.find(
      (x) =>
        x.email === input ||
        (x.phone.replace(/[^0-9]/g, "").replace(/^234/, "0") ===
          input.replace(/[^0-9]/g, "").replace(/^234/, "0") &&
          /[0-9]/.test(input)),
    );
    const recent =
      a &&
      db.codes.some(
        (c) =>
          c.accountId === a.id &&
          c.purpose === "recover" &&
          Date.now() - c.sentAt < 30000,
      );
    return {
      accountId: a?.id || id(),
      codeId:
        a && attempts.length <= 5 && !recent
          ? issue(db, a.id, "recover")
          : id(),
      purpose: "recover" as const,
    };
  });
}
export async function verify(codeId: string, value: string) {
  await requireConnection();
  const result = await transaction((db) => {
    const c = db.codes.find((x) => x.id === codeId);
    if (!c || c.used) return { error: "This code has been replaced or used." };
    if (c.expires < Date.now())
      return { error: "Code expired. Request another code." };
    if (c.attempts >= 5)
      return { error: "Attempt limit reached. Request another code." };
    c.attempts++;
    if (c.code !== value) return { error: "Incorrect code." };
    c.used = true;
    const a = db.accounts.find((x) => x.id === c.accountId)!;
    if (c.purpose === "recover") {
      c.recoveryVerified = true;
      return { recovery: c.id };
    }
    a.verified = true;
    audit(db, "account." + c.purpose, a.id, "Verified simulated code", {
      accountId: a.id,
    });
    return { session: newSession(db, a) };
  });
  if (result.error) throw Error(result.error);
  if (result.session) localStorage.setItem(SESSION_KEY, result.session);
  await changed();
  return result;
}
export async function resetPassword(
  recoveryId: string,
  password: string,
  confirm: string,
) {
  await requireConnection();
  passwordCheck(password);
  if (password !== confirm) throw Error("Passwords do not match.");
  const salt = id(),
    hash = await credential(password, salt);
  let changedAccount = "";
  await transaction((db) => {
    const code = db.codes.find(
      (c) =>
        c.id === recoveryId &&
        c.purpose === "recover" &&
        c.recoveryVerified === true &&
        c.used &&
        c.expires > Date.now(),
    );
    if (!code) throw Error("Recovery verification expired. Start again.");
    const a = db.accounts.find((a) => a.id === code.accountId)!;
    changedAccount = a.id;
    a.hash = hash;
    a.salt = salt;
    a.forcePasswordChange = false;
    securityNotice(
      a,
      "Your password was reset. All previous sessions were signed out.",
    );
    a.credentialVersion++;
    db.sessions = db.sessions.filter((s) => s.accountId !== a.id);
    db.codes = db.codes.filter((c) => c.accountId !== a.id);
    audit(db, "account.password-replaced", a.id, "Prior sessions invalidated", {
      accountId: a.id,
    });
  });
  localStorage.removeItem(SESSION_KEY);
  for (const key of Object.keys(localStorage)) if (key.startsWith("filter-")) localStorage.removeItem(key);
  if (changedAccount) await clearUserCache(changedAccount);
}
export async function changeEmail(
  accountId: string,
  email: string,
  password: string,
) {
  await requireConnection();
  return transaction(async (db) => {
    const a = db.accounts.find((x) => x.id === accountId);
    if (!a || a.verified || (await credential(password, a.salt)) !== a.hash)
      throw Error(
        "Verify account credentials before changing this unverified email.",
      );
    email = email.trim().toLowerCase();
    if (
      !/^\S+@\S+\.\S+$/.test(email) ||
      db.accounts.some((x) => x.id !== a.id && x.email === email)
    )
      throw Error("Email is invalid or already registered.");
    a.email = email;
    return issue(db, a.id, "verify", false);
  });
}
export async function signOut() {
  const db = await read();
  const session = sessionIn(db);
  await transaction((db) => {
    db.sessions = db.sessions.filter((s) => s.id !== token());
  });
  localStorage.removeItem(SESSION_KEY);
  for (const key of Object.keys(localStorage)) if (key.startsWith("filter-")) localStorage.removeItem(key);
  if (session) await clearUserCache(session.accountId);
  await changed();
}
export async function chooseMembership(membershipId: string, branchId: string) {
  await transaction((db) => {
    const s = sessionIn(db);
    if (!s) throw Error("Sign in first.");
    const m = db.memberships.find(
      (m) =>
        m.id === membershipId &&
        m.accountId === s.accountId &&
        m.status === "active",
    );
    if (!m || !m.branchIds.includes(branchId))
      throw Error("This membership or branch is unavailable.");
    const account = db.accounts.find((a) => a.id === s.accountId)!;
    const prior = account.lastContext;
    s.membershipId = m.id;
    s.branchId = branchId;
    s.lastRoute =
      prior?.membershipId === m.id && prior.branchId === branchId
        ? prior.route
        : "/dashboard";
    account.lastContext = { membershipId: m.id, branchId, route: s.lastRoute };
    audit(db, "session.select-institution", m.hospitalId);
  });
  await refreshCache();
}
export async function rememberRoute(route: string) {
  await transaction((db) => {
    const s = sessionIn(db);
    if (s) {
      s.lastRoute = route;
      const a = db.accounts.find((a) => a.id === s.accountId)!;
      a.lastContext = {
        membershipId: s.membershipId,
        branchId: s.branchId,
        route,
      };
    }
  });
}
export async function saveDraft(key: string, value: Fields | null) {
  await transaction((db) => {
    const { a, h, s } = context(db);
    const full = [a.id, h.id, s.branchId, key].join(":");
    if (value) db.drafts[full] = value;
    else delete db.drafts[full];
  });
}
export function draft(db: Database, key: string) {
  try {
    const { a, h, s } = context(db);
    return db.drafts[[a.id, h.id, s.branchId, key].join(":")];
  } catch {
    return undefined;
  }
}
export async function newHospital() {
  throw Error("Use Register a hospital to complete facility verification.");
}
export async function configure(data: Partial<Hospital>, step: number) {
  await transaction((db) => {
    const { h, a } = requirePermission(db, "setup", "edit");
    if (
      data.registration !== undefined &&
      data.registration !== h.registration &&
      ["verified", "approved"].includes(h.verification)
    ) {
      h.verification = "pending_verification";
      (h.verificationHistory ||= []).push({
        status: "pending_verification",
        at: now(),
        reason: "Registration changed in hospital setup",
      });
      (h.profileHistory ||= []).push({
        at: now(),
        actorId: a.id,
        fields: ["registration"],
      });
    }
    const allowed = [
      "name",
      "phone",
      "email",
      "address",
      "city",
      "state",
      "registration",
      "type",
      "departments",
      "currency",
      "invoicePrefix",
      "paymentMethods",
      "paymentTiming",
      "insurance",
      "logo",
    ] as const;
    for (const key of allowed)
      if (data[key] !== undefined) Object.assign(h, { [key]: data[key] });
    h.step = step;
    audit(db, "hospital.configure", h.id, "Onboarding step " + (step + 1));
  });
}
export async function saveBranch(data: Partial<Branch>) {
  await transaction((db) => {
    const { h, m } = requirePermission(db, "setup", "edit");
    if (
      !data.name ||
      !data.address ||
      !data.contact ||
      !data.hours ||
      !data.departments?.length
    )
      throw Error(
        "Branch name, address, contact, hours and departments are required.",
      );
    if (data.departments.some((d) => !h.departments.includes(d)))
      throw Error("Branch departments must be enabled in the hospital.");
    if (data.id) {
      const b = db.branches.find(
        (b) => b.id === data.id && b.hospitalId === h.id,
      );
      if (!b) throw Error("Branch not found.");
      Object.assign(b, data, { hospitalId: h.id });
    } else {
      const b: Branch = {
        id: id(),
        hospitalId: h.id,
        name: data.name,
        address: data.address,
        contact: data.contact,
        departments: data.departments,
        hours: data.hours,
      };
      db.branches.push(b);
      m.branchIds.push(b.id);
    }
    audit(db, "branch.configure", data.id || h.id);
  });
}
export function launchErrors(db: Database, h: Hospital) {
  const errors: string[] = [];
  for (const key of [
    "name",
    "phone",
    "email",
    "address",
    "city",
    "state",
  ] as const)
    if (!h[key] || h[key] === "New hospital")
      errors.push("Facility " + key + " is required.");
  if (!h.departments.length) errors.push("Enable at least one department.");
  const branches = db.branches.filter((b) => b.hospitalId === h.id);
  if (!branches.length) errors.push("Configure a main branch.");
  if (h.type === "Multi-Branch Hospital" && branches.length < 2)
    errors.push("Multi-Branch Hospital requires two branches.");
  for (const b of branches)
    if (
      !b.name ||
      !b.address ||
      !b.contact ||
      !b.hours ||
      !b.departments.length ||
      b.departments.some((d) => !h.departments.includes(d))
    )
      errors.push("Complete and reconcile branch " + b.name);
  if (!h.currency || !h.invoicePrefix || !h.paymentMethods.length)
    errors.push("Complete billing policy.");
  return errors;
}
export async function launch() {
  await transaction((db) => {
    const { h } = requirePermission(db, "setup", "edit");
    if (h.launched) return;
    const errors = launchErrors(db, h);
    if (errors.length) throw Error(errors.join(" "));
    h.launched = true;
    h.step = 8;
    for (const d of h.departments) add(db, "department", { name: d });
    audit(db, "hospital.launch", h.id);
    notify(
      db,
      "Hospital launched. Invite staff and configure services.",
      "/staff",
    );
  });
}
function assignable(role: Role, target: Role) {
  if (target === "Platform Super Admin") return false;
  if (role === "Hospital Owner") return target !== "Hospital Owner";
  return (
    role === "Hospital Admin" &&
    !["Hospital Owner", "Medical Director", "Hospital Admin"].includes(target)
  );
}
export async function invite(data: Fields) {
  await requireConnection();
  await transaction((db) => {
    const { h, m } = requirePermission(db, "staff", "create");
    const role = str(data.role) as Role;
    if (!assignable(m.role, role) || !roles.includes(role))
      throw Error("You cannot assign this role.");
    const email = str(data.email).trim().toLowerCase();
    if (!data.name || !/^\S+@\S+\.\S+$/.test(email))
      throw Error("Name and valid email are required.");
    const branchIds = (data.branches as string[]) || [];
    if (!branchIds.length || branchIds.some((b) => !m.branchIds.includes(b)))
      throw Error("Choose authorized branches.");
    if (
      db.invitations.some(
        (i) =>
          i.hospitalId === h.id &&
          i.email === email &&
          i.status === "pending" &&
          i.expires > Date.now(),
      )
    )
      throw Error("A pending invitation already exists.");
    db.invitations.push({
      id: id(),
      hospitalId: h.id,
      name: str(data.name),
      email,
      role,
      department: str(data.department),
      branchIds,
      status: "pending",
      expires: Date.now() + 7 * 86400000,
      createdAt: now(),
    });
    audit(db, "staff.invite", email);
  });
}
export async function invitationAction(
  invitationId: string,
  action: "resend" | "revoke",
) {
  await transaction((db) => {
    const { h } = requirePermission(db, "staff", "edit");
    const i = db.invitations.find(
      (i) => i.id === invitationId && i.hospitalId === h.id,
    );
    if (!i || i.status === "accepted")
      throw Error("Invitation cannot be changed.");
    i.status = action === "revoke" ? "revoked" : "pending";
    if (action === "resend") i.expires = Date.now() + 7 * 86400000;
    audit(db, "invitation." + action, i.id);
  });
}
export async function acceptInvitation(invitationId: string) {
  await requireConnection();
  await transaction((db) => {
    const s = sessionIn(db);
    if (!s) throw Error("Sign in and verify first.");
    const a = db.accounts.find((a) => a.id === s.accountId)!;
    const inv = db.invitations.find((i) => i.id === invitationId);
    if (!inv || inv.status !== "pending" || inv.expires < Date.now())
      throw Error("Invitation expired, revoked or already accepted.");
    if (a.email !== inv.email)
      throw Error("Wrong account. Sign in with " + inv.email);
    if (
      db.memberships.some(
        (m) =>
          m.hospitalId === inv.hospitalId &&
          m.accountId === a.id &&
          m.role === inv.role,
      )
    )
      throw Error("Membership already exists.");
    db.memberships.push({
      id: id(),
      accountId: a.id,
      hospitalId: inv.hospitalId,
      role: inv.role,
      branchIds: inv.branchIds.slice(),
      department: inv.department,
      status: "active",
      employment: "employed",
      leave: "working",
      extraPermissions: [],
      deniedPermissions: [],
    });
    db.records.push({
      id: id(),
      kind: "staffProfile",
      hospitalId: inv.hospitalId,
      branchId: inv.branchIds[0],
      authorId: a.id,
      status: "active",
      createdAt: now(),
      updatedAt: now(),
      data: { account: a.id, department: inv.department, reportingTo: "" },
      versions: [],
    });
    inv.status = "accepted";
    a.forcePasswordChange = true;
    audit(db, "invitation.accept", inv.id, "Assigned role retained", {
      accountId: a.id,
      hospitalId: inv.hospitalId,
    });
  });
}
export async function editMembership(memberId: string, data: Fields) {
  await requireConnection();
  await transaction((db) => {
    const { h, m } = requirePermission(db, "staff", "edit");
    const target = db.memberships.find(
      (x) => x.id === memberId && x.hospitalId === h.id,
    );
    if (!target || target.role === "Hospital Owner" || target.id === m.id)
      throw Error("Cannot change the owner or your own authority.");
    if (data.role && data.role !== target.role) {
      if (!assignable(m.role, str(data.role) as Role))
        throw Error("Role assignment denied.");
      target.role = str(data.role) as Role;
    }
    if (data.branches) {
      const branches = data.branches as string[];
      if (!branches.length || branches.some((b) => !m.branchIds.includes(b)))
        throw Error("Invalid branch access.");
      target.branchIds = branches;
    }
    if (data.status) target.status = str(data.status) as Membership["status"];
    if (data.department) target.department = str(data.department);
    if (data.leave) target.leave = str(data.leave) as Membership["leave"];
    if (data.employment)
      target.employment = str(data.employment) as Membership["employment"];
    if (data.denied) {
      const denied = data.denied as string[];
      if (
        !Array.isArray(denied) ||
        denied.some((p) => !permissions(target.role).includes(p))
      )
        throw Error("Restrictions must belong to the selected role template.");
      target.deniedPermissions = denied;
    }
    if (data.reportingTo !== undefined) {
      const manager = str(data.reportingTo);
      if (
        manager &&
        (manager === target.id ||
          !db.memberships.some(
            (x) => x.id === manager && x.hospitalId === h.id,
          ))
      )
        throw Error("Choose another staff member in this hospital.");
      let profile = db.records.find(
        (r) =>
          r.kind === "staffProfile" &&
          r.hospitalId === h.id &&
          r.data.account === target.accountId,
      );
      if (!profile)
        profile = add(db, "staffProfile", { account: target.accountId });
      profile.data.reportingTo = manager;
    }
    audit(db, "membership.edit", target.id);
  });
}
function checkBooking(db: Database, data: Fields, exclude = "") {
  const start = Date.parse(str(data.starts));
  if (!Number.isFinite(start)) throw Error("Choose a valid appointment time.");
  const clinician = db.memberships.find(
    (m) =>
      m.id === data.clinician &&
      m.hospitalId === context(db).h.id &&
      m.status === "active" &&
      m.branchIds.includes(context(db).s.branchId),
  );
  if (
    !clinician ||
    !["Doctor", "Consultant", "Medical Director"].includes(clinician.role)
  )
    throw Error("Choose an active clinician membership ID from Staff.");
  if (
    scoped(db, "appointment").some(
      (r) =>
        r.id !== exclude &&
        r.status === "booked" &&
        r.data.clinician === data.clinician &&
        Math.abs(Date.parse(str(r.data.starts)) - start) < 30 * 60000,
    )
  )
    throw Error("Clinician already has an overlapping 30-minute appointment.");
  const rosters = scoped(db, "roster").filter(
    (r) => r.data.staff === data.clinician,
  );
  if (
    rosters.length &&
    !rosters.some(
      (r) =>
        Date.parse(str(r.data.starts)) <= start &&
        Date.parse(str(r.data.ends)) >= start + 30 * 60000,
    )
  )
    throw Error("Appointment is outside the configured clinician roster.");
}
function createVisit(
  db: Database,
  patientId: string,
  data: Fields,
  parentId?: string,
) {
  const visit = add(db, "visit", data, "waiting", { patientId, parentId });
  add(
    db,
    "queue",
    { department: data.department || "", clinician: data.clinician || "" },
    "triage",
    { patientId, visitId: visit.id },
  );
  return visit;
}
export async function createRecord(
  moduleId: string,
  data: Fields,
  patientId: string,
  operationId: string,
) {
  return transaction((db) => {
    const { h } = requirePermission(db, moduleId, "create");
    if (
      !h.launched &&
      !["services", "ward-config", "vehicles", "shifts", "hr"].includes(
        moduleId,
      )
    )
      throw Error("Launch the hospital before recording operational activity.");
    if (db.operations.includes(operationId)) return;
    const mod = allModules.find((m) => m.id === moduleId)!;
    validate(mod.fields, data);
    if (mod.patient) ownPatient(db, patientId);
    for (const f of mod.fields)
      if (f.ref) {
        const parent = reference(db, data[f.key], f.ref);
        if (parent.patientId && patientId && parent.patientId !== patientId)
          throw Error("Linked record belongs to another patient.");
      }
    let r: RecordEntity;
    const refs: Partial<RecordEntity> = { patientId: patientId || undefined };
    if (data.visit) refs.visitId = str(data.visit);
    if (data.encounter) {
      const e = reference(db, data.encounter, "encounter");
      refs.encounterId = e.id;
      refs.visitId = e.visitId;
    }
    if (moduleId === "patients") {
      const possible = scoped(db, "patient").filter(
        (p) =>
          str(p.data.name).toLowerCase() === str(data.name).toLowerCase() &&
          (p.data.dob === data.dob || p.data.phone === data.phone),
      );
      if (possible.length && !data.duplicateReviewed)
        throw Error(
          "Possible duplicate: matching name and contact or birth date. Review existing records and confirm that this is a distinct person.",
        );
      if (
        data.healthId &&
        scoped(db, "patient").some((p) => p.data.healthId === data.healthId)
      )
        throw Error(
          "This Health ID is already enrolled. Open the existing record.",
        );
      r = add(db, "patient", {
        ...data,
        healthId: data.healthId || "LOCAL-" + id().slice(0, 8),
        provisional: !data.healthId || Boolean(data.provisional),
      });
      add(
        db,
        "registration",
        {
          mrn:
            "MRN-" +
            (scoped(db, "registration").length + 1).toString().padStart(6, "0"),
        },
        "active",
        { patientId: r.id },
      );
    } else if (moduleId === "appointments") {
      checkBooking(db, data);
      r = add(db, mod.kind, data, mod.initial, refs);
    } else if (moduleId === "journey") r = createVisit(db, patientId, data);
    else if (moduleId === "billing") {
      const service = reference(db, data.service, "service");
      const quantity = positive(data.quantity);
      if (
        scoped(db, "invoice").some(
          (i) => i.data.source === data.source && i.status !== "void",
        )
      )
        throw Error("This service event has already been charged.");
      r = add(
        db,
        "invoice",
        {
          ...data,
          number: h.invoicePrefix + "-" + (scoped(db, "invoice").length + 1),
          unitCents: Math.round(num(service.data.price) * 100),
          totalCents: Math.round(num(service.data.price) * 100) * quantity,
        },
        "draft",
        refs,
      );
    } else if (moduleId === "shifts") {
      const starts = Date.parse(str(data.starts)),
        ends = Date.parse(str(data.ends));
      if (!(ends > starts)) throw Error("Shift end must follow its start.");
      if (
        scoped(db, "roster").some(
          (r) =>
            r.data.staff === data.staff &&
            Date.parse(str(r.data.starts)) < ends &&
            Date.parse(str(r.data.ends)) > starts,
        )
      )
        throw Error("Staff roster conflict.");
      r = add(db, "roster", data, "assigned");
      add(
        db,
        "shift",
        { starts: data.starts, ends: data.ends, department: data.department },
        "defined",
        { parentId: r.id },
      );
    } else {
      if (["pharmacy", "procurement"].includes(moduleId))
        positive(data.quantity);
      if (moduleId === "services" && num(data.price) < 0)
        throw Error("Service price cannot be negative.");
      if (
        moduleId === "inventory" &&
        (num(data.packSize) < 1 || num(data.threshold) < 0)
      )
        throw Error(
          "Pack size must be positive and reorder threshold cannot be negative.",
        );
      if (
        moduleId === "consent" &&
        (num(data.duration) < 1 || num(data.duration) > 60)
      )
        throw Error("Access duration must be 1–60 minutes.");
      if (moduleId === "insurance") {
        const policy = reference(db, data.policy, "policy");
        if (Date.parse(str(policy.data.expiry)) < Date.now())
          throw Error("This local coverage fixture is expired.");
      }
      r = add(
        db,
        mod.kind,
        { ...data, module: moduleId },
        mod.initial || "active",
        refs,
      );
    }
    if (
      ["lab", "radiology", "pharmacy"].includes(moduleId) &&
      refs.encounterId
    ) {
      const encounter = get(db, refs.encounterId);
      if (encounter.status !== "signed")
        throw Error("Sign the encounter before issuing clinical orders.");
    }
    if (moduleId === "pharmacy") {
      add(
        db,
        "prescriptionItem",
        {
          item: data.item,
          quantity: data.quantity,
          dispensed: 0,
          instructions: data.instructions,
        },
        "pending",
        { ...refs, parentId: r.id },
      );
      r.data.dispensed = 0;
    }
    if (moduleId === "bloodbank")
      add(
        db,
        "bloodUnit",
        { group: data.group, expiry: data.expiry },
        "quarantine",
        { parentId: r.id },
      );
    if (moduleId === "triage") r.visitId = str(data.visit);
    if (moduleId === "consult") {
      r.visitId = str(data.visit);
      add(db, "note", { note: data.note }, "draft", {
        ...refs,
        parentId: r.id,
        encounterId: r.id,
      });
    }
    db.operations.push(operationId);
    audit(db, moduleId + ".create", r.id);
    notify(db, mod.title + " record created", "/" + moduleId + "/" + r.id, {
      event: data.assignedTo ? "task" : "alert",
      recipient:
        db.memberships.find((m) => m.id === data.assignedTo)?.accountId || "",
    });
    return r.id;
  });
}
function stock(
  db: Database,
  itemId: string,
  lot: string,
  quantity: number,
  expiry: string,
  referenceId: string,
) {
  if (!Number.isInteger(quantity) || quantity <= 0)
    throw Error("Use a positive whole number of base units.");
  if (!expiry || Date.parse(expiry) < Date.now())
    throw Error("Stock receipt requires a future expiry date.");
  if (scoped(db, "stockMovement").some((m) => m.data.reference === referenceId))
    throw Error("This receipt was already recorded.");
  let batch = scoped(db, "batch").find(
    (b) => b.parentId === itemId && b.data.lot === lot,
  );
  if (batch && batch.data.expiry !== expiry)
    throw Error("Batch expiry does not match the existing lot.");
  if (batch) batch.data.quantity = num(batch.data.quantity) + quantity;
  else
    batch = add(db, "batch", { lot, quantity, expiry }, "available", {
      parentId: itemId,
    });
  add(
    db,
    "stockMovement",
    { quantity, reference: referenceId, reason: "receipt", batch: batch.id },
    "posted",
    { parentId: itemId },
  );
  return batch;
}
export async function act(
  moduleId: string,
  recordId: string,
  actionId: string,
  data: Fields,
  operationId: string,
) {
  return transaction((db) => {
    const mod = allModules.find((m) => m.id === moduleId)!;
    const action = mod.actions.find((a) => a.id === actionId);
    if (!action) throw Error("Unavailable action.");
    const { h, a, s } = requirePermission(
      db,
      moduleId,
      action.permission || "edit",
    );
    if (db.operations.includes(operationId)) return;
    const r = get(db, recordId);
    if (
      r.kind !== mod.kind ||
      (r.kind === "procedure" && r.data.module !== moduleId) ||
      (moduleId === "icu" && r.data.module !== "icu") ||
      !action.from.includes(r.status)
    )
      throw Error(
        "This action is no longer available for the current record state.",
      );
    validate(action.fields || [], data);
    for (const field of action.fields || [])
      if (field.ref) {
        const linked = reference(db, data[field.key], field.ref);
        if (linked.patientId && r.patientId && linked.patientId !== r.patientId)
          throw Error("Linked action record belongs to another patient.");
      }
    history(db, r, str(data.reason) || action.label);
    const originalData = { ...r.data };
    if (moduleId === "appointments" && actionId === "reschedule")
      checkBooking(db, { ...r.data, ...data }, r.id);
    if (moduleId === "appointments" && actionId === "checkin") {
      if (db.records.some((v) => v.kind === "visit" && v.parentId === r.id))
        throw Error("Already checked in.");
      createVisit(
        db,
        r.patientId!,
        { ...r.data, complaint: r.data.reason },
        r.id,
      );
    }
    if (moduleId === "journey" && ["complete", "cancel"].includes(actionId))
      db.records
        .filter((q) => q.kind === "queue" && q.visitId === r.id)
        .forEach((q) => {
          q.status = "completed";
          q.updatedAt = now();
        });
    if (moduleId === "journey" && actionId === "assign")
      db.records
        .filter((q) => q.visitId === r.id && q.kind === "queue")
        .forEach((q) => {
          q.data.department = data.department;
          q.data.clinician = data.clinician;
        });
    if (moduleId === "triage" && actionId === "complete") {
      const visit = get(db, r.visitId!);
      visit.status = "triaged";
      db.records
        .filter((q) => q.kind === "queue" && q.visitId === visit.id)
        .forEach((q) => (q.status = "clinician"));
      notify(
        db,
        "Triage completed for " + str(ownPatient(db, r.patientId!).data.name),
        "/consult",
      );
    }
    if (moduleId === "consult") {
      const note = db.records.find(
        (n) => n.kind === "note" && n.parentId === r.id,
      );
      if (note) {
        history(db, note, str(data.reason) || "Signed");
        note.status = "signed";
        note.data.note = data.note || r.data.note;
      }
      if (actionId === "sign") {
        const visit = get(db, r.visitId!);
        visit.status = "consulting";
        db.records
          .filter((q) => q.kind === "queue" && q.visitId === visit.id)
          .forEach((q) => (q.status = "completed"));
      }
    }
    if (moduleId === "lab") {
      if (actionId === "process")
        db.records
          .filter((x) => x.kind === "sample" && x.parentId === r.id)
          .forEach((x) => {
            x.status = "processing";
            x.data.processing = data.processing;
            x.data.processedAt = now();
          });
      if (actionId === "collect")
        add(
          db,
          "sample",
          { sampleCode: data.sampleCode, collector: a.id, collectedAt: now() },
          "collected",
          { parentId: r.id, patientId: r.patientId },
        );
      if (actionId === "result" || actionId === "correct")
        add(db, "labResult", { ...data, author: a.id }, "draft", {
          parentId: r.id,
          patientId: r.patientId,
          encounterId: r.encounterId,
        });
      if (actionId === "verify" || actionId === "publish") {
        const result = db.records
          .filter((x) => x.kind === "labResult" && x.parentId === r.id)
          .at(-1);
        if (!result) throw Error("Draft result required.");
        result.status = action.to;
        result.data[actionId === "verify" ? "reviewer" : "publishedAt"] =
          actionId === "verify" ? a.id : now();
      }
      if (actionId === "reject")
        db.records
          .filter((x) => x.kind === "sample" && x.parentId === r.id)
          .forEach((x) => (x.status = "rejected"));
    }
    if (moduleId === "radiology") {
      if (actionId === "attach") {
        if (
          !str(data.attachment).startsWith("data:image/") &&
          !str(data.attachment).startsWith("data:application/pdf")
        )
          throw Error("Only local image or PDF studies are supported.");
        add(db, "study", { attachment: data.attachment }, "attached", {
          parentId: r.id,
          patientId: r.patientId,
        });
      }
      if (actionId === "report" || actionId === "correct")
        add(db, "radiologyReport", { ...data, author: a.id }, "draft", {
          parentId: r.id,
          patientId: r.patientId,
          encounterId: r.encounterId,
        });
      if (actionId === "review" || actionId === "publish") {
        const report = db.records
          .filter((x) => x.kind === "radiologyReport" && x.parentId === r.id)
          .at(-1);
        if (!report) throw Error("Draft report required.");
        report.status = action.to;
        report.data.reviewer = a.id;
      }
    }
    if (moduleId === "pharmacy" && actionId === "dispense") {
      if (r.data.controlled && !can(db, "pharmacy", "controlled"))
        throw Error("Controlled-drug dispensing permission required.");
      const batch = reference(db, data.batch, "batch");
      if (batch.parentId !== r.data.item)
        throw Error("Selected batch is for another medication.");
      if (Date.parse(str(batch.data.expiry)) < Date.now())
        throw Error("Expired stock cannot be dispensed.");
      const quantity = positive(data.quantity);
      if (
        !Number.isInteger(quantity) ||
        quantity > num(batch.data.quantity) ||
        quantity > num(r.data.quantity) - num(r.data.dispensed)
      )
        throw Error(
          "Quantity exceeds remaining prescription or available stock.",
        );
      batch.data.quantity = num(batch.data.quantity) - quantity;
      r.data.dispensed = num(r.data.dispensed) + quantity;
      add(
        db,
        "stockMovement",
        {
          quantity: -quantity,
          batch: batch.id,
          reason: "dispense",
          pharmacist: a.id,
          reference: operationId,
        },
        "posted",
        {
          parentId: str(r.data.item),
          patientId: r.patientId,
          encounterId: r.encounterId,
        },
      );
      const pi = db.records.find(
        (x) => x.kind === "prescriptionItem" && x.parentId === r.id,
      )!;
      pi.data.dispensed = r.data.dispensed;
      pi.status =
        num(r.data.dispensed) === num(r.data.quantity)
          ? "fulfilled"
          : "partial";
      if (r.data.controlled)
        audit(
          db,
          "controlled-drug.dispense",
          r.id,
          "Dedicated controlled-drug simulation record",
        );
    }
    if (["inpatient", "icu"].includes(moduleId)) {
      if (actionId === "admit" || actionId === "transfer") {
        const bed = reference(db, data.bed, "bed");
        if (bed.status !== "available")
          throw Error("Bed is occupied, awaiting cleaning or in maintenance.");
        if (actionId === "transfer") {
          const old = reference(db, r.data.bed, "bed");
          old.status = "cleaning";
        }
        bed.status = "occupied";
        bed.data.admission = r.id;
      }
      if (actionId === "discharge") {
        const bed = reference(db, r.data.bed, "bed");
        bed.status = "cleaning";
        delete bed.data.admission;
      }
    }
    if (moduleId === "billing") {
      if (actionId === "pay") {
        const cents = money(data.amount);
        if (cents > balance(db, r).due)
          throw Error("Payment exceeds outstanding balance.");
        if (!h.paymentMethods.includes(str(data.method)))
          throw Error(
            "Payment method is not enabled by hospital billing policy.",
          );
        if (
          scoped(db, "payment").some((p) => p.data.reference === data.reference)
        )
          throw Error("Transaction reference already recorded.");
        add(
          db,
          "payment",
          {
            cents,
            reference: data.reference,
            method: data.method,
            receipt: "RCT-" + id().slice(0, 8),
          },
          "received",
          { parentId: r.id, patientId: r.patientId },
        );
      }
      if (actionId === "refund") {
        const cents = money(data.amount);
        if (cents > balance(db, r).paid)
          throw Error("Refund exceeds refundable balance.");
        add(db, "refund", { cents, reason: data.reason }, "refunded", {
          parentId: r.id,
          patientId: r.patientId,
        });
      }
      if (actionId === "void" && balance(db, r).paid > 0)
        throw Error("Refund collected payments before voiding.");
    }
    if (moduleId === "insurance") {
      const inv = reference(db, r.data.invoice, "invoice");
      if (
        actionId === "approve" &&
        money(data.approvedAmount) > num(inv.data.totalCents)
      )
        throw Error("Approval exceeds invoice total.");
      if (actionId === "settle") {
        const cents = money(data.amount);
        if (
          cents > money(r.data.approvedAmount) ||
          cents > balance(db, inv).due
        )
          throw Error(
            "Settlement exceeds approval or outstanding invoice balance.",
          );
        if (
          scoped(db, "payment").some((p) => p.data.reference === data.reference)
        )
          throw Error("Settlement reference already recorded.");
        add(
          db,
          "payment",
          {
            cents,
            method: "Insurance",
            reference: data.reference,
            receipt: "RCT-" + id().slice(0, 8),
          },
          "received",
          { parentId: inv.id, patientId: inv.patientId },
        );
        recalc(db, inv);
      }
    }
    if (moduleId === "inventory") {
      if (actionId === "receive")
        stock(
          db,
          r.id,
          str(data.lot),
          positive(data.quantity),
          str(data.expiry),
          str(data.reference),
        );
      if (actionId === "adjust") {
        const b = reference(db, data.batch, "batch");
        if (b.parentId !== r.id) throw Error("Wrong item batch.");
        const delta = num(data.delta);
        if (!Number.isInteger(delta) || num(b.data.quantity) + delta < 0)
          throw Error(
            "Adjustment must use whole units and cannot create negative stock.",
          );
        b.data.quantity = num(b.data.quantity) + delta;
        add(
          db,
          "stockMovement",
          { quantity: delta, batch: b.id, reason: data.reason },
          "posted",
          { parentId: r.id },
        );
      }
      if (actionId === "transfer") {
        const b = reference(db, data.batch, "batch");
        if (b.parentId !== r.id) throw Error("Wrong item batch.");
        const quantity = positive(data.quantity);
        const destination = db.branches.find(
          (b) => b.id === data.destination && b.hospitalId === h.id,
        );
        if (!destination || destination.id === s.branchId)
          throw Error("Choose a different branch in this hospital.");
        if (
          !context(db).m.branchIds.includes(destination.id) ||
          quantity > num(b.data.quantity)
        )
          throw Error("Insufficient stock or no access to destination.");
        b.data.quantity = num(b.data.quantity) - quantity;
        let destinationItem = db.records.find(
          (x) =>
            x.kind === "inventory" &&
            x.hospitalId === h.id &&
            x.branchId === destination.id &&
            x.data.catalogueId === (r.data.catalogueId || r.id),
        );
        if (!destinationItem)
          destinationItem = add(
            db,
            "inventory",
            { ...r.data, catalogueId: r.data.catalogueId || r.id },
            "active",
            { branchId: destination.id },
          );
        const received = add(
          db,
          "batch",
          { lot: b.data.lot, expiry: b.data.expiry, quantity },
          "available",
          { parentId: destinationItem.id, branchId: destination.id },
        );
        add(
          db,
          "stockMovement",
          {
            quantity: -quantity,
            batch: b.id,
            destination: destination.id,
            reason: data.reason,
          },
          "posted",
          { parentId: r.id },
        );
        add(
          db,
          "stockMovement",
          {
            quantity,
            batch: received.id,
            origin: s.branchId,
            reason: data.reason,
          },
          "posted",
          { parentId: destinationItem.id, branchId: destination.id },
        );
      }
    }
    if (moduleId === "procurement") {
      if (actionId === "order")
        add(
          db,
          "purchaseOrder",
          { ...r.data, reference: data.reference, received: 0 },
          "ordered",
          { parentId: r.id },
        );
      if (actionId === "receive") {
        const quantity = positive(data.quantity);
        const received = num(r.data.received);
        if (quantity > num(r.data.quantity) - received)
          throw Error("Receipt exceeds the remaining purchase quantity.");
        stock(
          db,
          str(r.data.item),
          str(data.lot),
          quantity,
          str(data.expiry),
          str(data.reference),
        );
        r.data.received = received + quantity;
        const po = db.records.find(
          (x) => x.kind === "purchaseOrder" && x.parentId === r.id,
        )!;
        po.data.received = r.data.received;
        po.status =
          num(r.data.received) === num(r.data.quantity) ? "closed" : "partial";
      }
    }
    if (moduleId === "ambulance") {
      const vehicle = reference(db, r.data.vehicle, "ambulance");
      if (actionId === "dispatch") {
        if (
          vehicle.status !== "available" ||
          scoped(db, "dispatch").some(
            (d) =>
              d.id !== r.id &&
              d.data.vehicle === vehicle.id &&
              d.status === "dispatched",
          )
        )
          throw Error("Vehicle is unavailable.");
        vehicle.status = "dispatched";
      } else vehicle.status = "available";
    }
    if (moduleId === "bloodbank") {
      if (
        ["reserve", "issue"].includes(actionId) &&
        Date.parse(str(r.data.expiry)) < Date.now()
      )
        throw Error("Blood unit expired. Dispose it.");
      const unit = db.records.find(
        (x) => x.kind === "bloodUnit" && x.parentId === r.id,
      )!;
      unit.status = action.to;
      unit.data = { ...unit.data, ...data };
      if (actionId === "reserve") ownPatient(db, str(data.patient));
    }
    if (moduleId === "maternity" && actionId === "delivery") {
      const baby = add(db, "patient", {
        name: data.newborn,
        dob: now().slice(0, 10),
        healthId: "LOCAL-" + id().slice(0, 8),
        provisional: true,
        motherId: r.patientId!,
      });
      add(db, "registration", { mrn: "MRN-" + id().slice(0, 6) }, "active", {
        patientId: baby.id,
      });
      data.newbornId = baby.id;
    }
    if (["clockin", "clockout"].includes(actionId))
      data[actionId + "At"] = now();
    const mutable = { ...data };
    if (["pharmacy", "procurement"].includes(moduleId)) delete mutable.quantity;
    r.data = { ...r.data, ...mutable };
    if (moduleId === "pharmacy" && actionId === "dispense")
      r.data.quantity = originalData.quantity;
    r.status = action.to;
    r.updatedAt = now();
    if (moduleId === "pharmacy" && actionId === "dispense")
      r.status =
        num(r.data.dispensed) === num(originalData.quantity)
          ? "fulfilled"
          : "partial";
    if (moduleId === "procurement" && actionId === "receive")
      r.status =
        num(r.data.received) === num(originalData.quantity)
          ? "closed"
          : "partial";
    if (moduleId === "billing" && ["pay", "refund"].includes(actionId))
      recalc(db, r);
    if (actionId === "publish") {
      r.data.publishedAt = now();
      notify(
        db,
        "Published result is ready for the ordering clinician",
        "/" + moduleId + "/" + r.id,
      );
    }
    db.operations.push(operationId);
    audit(
      db,
      moduleId + "." + actionId,
      r.id,
      str(data.reason) || action.label,
    );
    return r.id;
  });
}
export async function emergencyGrant(patientId: string, data: Fields) {
  await transaction((db) => {
    requirePermission(db, "consent", "emergency");
    ownPatient(db, patientId);
    if (!data.reason || !data.justification || !data.ack)
      throw Error("Reason, justification and acknowledgement are required.");
    const r = add(
      db,
      "grant",
      {
        categories: str(data.categories) || "Published results",
        expires: Date.now() + 15 * 60000,
        reason: data.reason,
        justification: data.justification,
        emergency: true,
        clinician: context(db).a.id,
      },
      "active",
      { patientId },
    );
    audit(db, "emergency-access.granted", r.id, str(data.reason));
    notify(db, "Emergency access recorded for patient review", "/consent", {
      event: "alert",
      critical: true,
    });
  });
}
export async function patientDecision(
  requestId: string,
  decision: "approve" | "decline" | "revoke",
) {
  if (!DEMO_MODE) throw Error("Simulation is disabled.");
  await transaction((db) => {
    const r = db.records.find(
      (x) => x.id === requestId && (x.kind === "consent" || x.kind === "grant"),
    );
    if (!r) throw Error("Request not found.");
    if (decision === "revoke") {
      r.status = "revoked";
      db.records
        .filter((g) => g.kind === "grant" && g.parentId === r.id)
        .forEach((g) => (g.status = "revoked"));
    } else {
      if (r.kind !== "consent" || r.status !== "pending")
        throw Error("Request already resolved.");
      r.status = decision === "approve" ? "approved" : "declined";
      if (decision === "approve")
        db.records.push({
          ...r,
          id: id(),
          kind: "grant",
          parentId: r.id,
          status: "active",
          data: {
            ...r.data,
            clinician: r.authorId,
            expires: Date.now() + Math.min(60, num(r.data.duration)) * 60000,
          },
          createdAt: now(),
          versions: [],
        });
    }
    db.audit.push({
      id: id(),
      actorId: "patient-simulator",
      membershipId: "",
      hospitalId: r.hospitalId,
      branchId: r.branchId,
      action: "patient." + decision,
      resource: r.id,
      reason: "Explicit local patient-side simulation",
      at: now(),
    });
  });
}
export function externalRecords(
  db: Database,
  patientId: string,
  category: string,
) {
  const { a, h } = requirePermission(db, "consent");
  const patient = ownPatient(db, patientId);
  const grant = db.records.find(
    (g) =>
      g.kind === "grant" &&
      g.patientId === patientId &&
      g.hospitalId === h.id &&
      g.data.clinician === a.id &&
      g.status === "active" &&
      num(g.data.expires) > Date.now() &&
      g.data.categories === category,
  );
  if (!grant) return [];
  const identities = db.records
    .filter(
      (p) =>
        p.kind === "patient" &&
        p.data.healthId === patient.data.healthId &&
        p.hospitalId !== h.id,
    )
    .map((p) => p.id);
  return db.records.filter(
    (r) =>
      identities.includes(r.patientId || "") &&
      (category === "Published results"
        ? ["labResult", "radiologyReport"].includes(r.kind) &&
          r.status === "published"
        : r.kind === "note" && r.status === "signed"),
  );
}
export async function viewExternal(patientId: string, category: string) {
  return transaction((db) => {
    const result = externalRecords(db, patientId, category);
    audit(db, "external.category-view", patientId, category);
    return result;
  });
}
export async function markRead(recordId: string) {
  await transaction((db) => {
    const r = get(db, recordId);
    if (r.kind !== "notification") throw Error("Notification not found.");
    r.status = "read";
  });
}
export async function restrictMembership(memberId: string, denied: string[]) {
  await transaction((db) => {
    const { h, m } = requirePermission(db, "staff", "edit");
    const target = db.memberships.find(
      (x) => x.id === memberId && x.hospitalId === h.id,
    );
    if (!target || target.role === "Hospital Owner" || target.id === m.id)
      throw Error("Cannot restrict this membership.");
    if (denied.some((p) => !permissions(target.role).includes(p)))
      throw Error("Restrict only permissions contained in this role template.");
    target.deniedPermissions = denied;
    audit(db, "membership.restrict", target.id, denied.join(", "));
  });
}
export async function submitHospitalReview() {
  await transaction((db) => {
    const { h } = requirePermission(db, "setup", "edit");
    if (!h.registration)
      throw Error("Record registration details before submitting for review.");
    h.verification = h.registrationProfile
      ? "pending_verification"
      : "Pending review";
    audit(
      db,
      "hospital.review-submitted",
      h.id,
      "Local simulation, not verified",
    );
  });
}
export async function platformAction(
  hospitalId: string,
  action: string,
  reason: string,
) {
  await requireConnection();
  await transaction((db) => {
    requirePermission(db, "platform", "edit");
    if (!reason.trim()) throw Error("A review reason is required.");
    const hospital = db.hospitals.find((h) => h.id === hospitalId);
    if (!hospital) throw Error("Hospital not found.");
    if (
      ![
        "Verified",
        "Rejected",
        "Pending review",
        "verified",
        "rejected",
        "pending_verification",
        "suspended",
      ].includes(action)
    )
      throw Error("Invalid review state.");
    const normalized =
      (
        {
          Verified: "verified",
          Rejected: "rejected",
          "Pending review": "pending_verification",
        } as Record<string, string>
      )[action] || action;
    hospital.verification = hospital.registrationProfile ? normalized : action;
    hospital.verificationReason = reason;
    (hospital.verificationHistory ||= []).push({
      status: normalized,
      at: now(),
      reason,
    });
    if (normalized === "verified" && hospital.registrationProfile) {
      db.subscriptions ||= {};
      const config = db.subscriptionConfig || defaultSubscriptionConfig;
      const sub = db.subscriptions[hospital.id] || {
        trialStart: null,
        trialEnd: null,
        periodEnd: null,
        plan: "Free trial",
        status: "trialing" as const,
        graceDays: config.graceDays,
        history: [],
      };
      if (sub.trialStart === null) {
        sub.trialStart = simulationNow(db);
        sub.trialEnd = sub.trialStart + config.trialDays * DAY;
        sub.history.push({
          at: sub.trialStart,
          action: "Trial started after verification",
          actor: context(db).a.id,
        });
      }
      db.subscriptions[hospital.id] = sub;
    }
    audit(
      db,
      "platform.facility-review",
      hospital.id,
      reason + " (fictional local review)",
    );
  });
}
export async function simulateFacilityReview(
  hospitalId: string,
  action: string,
  reason: string,
) {
  if (!DEMO_MODE) throw Error("Simulation is disabled.");
  await requireConnection();
  await transaction((db) => {
    if (!reason.trim()) throw Error("A review reason is required.");
    const hospital = db.hospitals.find((h) => h.id === hospitalId);
    if (!hospital) throw Error("Hospital not found.");
    if (
      ![
        "Verified",
        "Rejected",
        "Pending review",
        "verified",
        "rejected",
        "pending_verification",
        "suspended",
      ].includes(action)
    )
      throw Error("Invalid review state.");
    const normalized =
      (
        {
          Verified: "verified",
          Rejected: "rejected",
          "Pending review": "pending_verification",
        } as Record<string, string>
      )[action] || action;
    hospital.verification = hospital.registrationProfile ? normalized : action;
    hospital.verificationReason = reason;
    (hospital.verificationHistory ||= []).push({
      status: normalized,
      at: now(),
      reason,
    });
    if (normalized === "verified" && hospital.registrationProfile) {
      db.subscriptions ||= {};
      const config = db.subscriptionConfig || defaultSubscriptionConfig;
      const sub = db.subscriptions[hospital.id] || {
        trialStart: null,
        trialEnd: null,
        periodEnd: null,
        plan: "Free trial",
        status: "trialing" as const,
        graceDays: config.graceDays,
        history: [],
      };
      if (sub.trialStart === null) {
        sub.trialStart = simulationNow(db);
        sub.trialEnd = sub.trialStart + config.trialDays * DAY;
        sub.history.push({
          at: sub.trialStart,
          action: "Trial started after verification",
          actor: "simulation-controls",
        });
      }
      db.subscriptions[hospital.id] = sub;
    }
    audit(
      db,
      "simulation.facility-review",
      hospital.id,
      reason + " (fictional local review)",
    );
  });
}
export async function updateDraftRecord(
  moduleId: string,
  recordId: string,
  data: Fields,
) {
  await transaction((db) => {
    requirePermission(db, moduleId, "edit");
    const mod = allModules.find((m) => m.id === moduleId)!;
    const r = get(db, recordId);
    if (
      !["consult", "triage"].includes(moduleId) ||
      r.kind !== mod.kind ||
      r.status !== "draft"
    )
      throw Error("Only an unsigned draft may be edited.");
    validate(mod.fields, data);
    for (const field of mod.fields)
      if (field.ref) {
        const linked = reference(db, data[field.key], field.ref);
        if (linked.patientId && linked.patientId !== r.patientId)
          throw Error("Linked record belongs to a different patient.");
      }
    history(db, r, "Draft edited");
    r.data = { ...r.data, ...data };
    r.updatedAt = now();
    if (moduleId === "consult") {
      r.visitId = str(data.visit);
      const note = db.records.find(
        (n) => n.kind === "note" && n.parentId === r.id,
      );
      if (note) note.data.note = data.note;
    }
    audit(db, moduleId + ".draft-edit", r.id);
  });
}
export async function devAction(action: string, target = "") {
  if (!DEMO_MODE) throw Error("Simulation is disabled.");
  await transaction((db) => {
    if (action === "reset") {
      Object.assign(db, emptyDB());
      return;
    }
    if (action === "expire-code") {
      const c = db.codes.find((c) => c.id === target);
      if (c) c.expires = 0;
    }
    if (action === "expire-invitation") {
      const i = db.invitations.find((i) => i.id === target);
      if (i) i.expires = 0;
    }
    if (action === "suspend") {
      const m = db.memberships.find((m) => m.id === target);
      if (m) m.status = m.status === "active" ? "suspended" : "active";
    }
    if (action === "expire-grant") {
      const g = db.records.find((g) => g.id === target && g.kind === "grant");
      if (g) g.data.expires = 0;
    }
    if (action === "expire-session") {
      const s = db.sessions.find((s) => s.id === token());
      if (s) s.expires = 0;
    }
    audit(db, "simulation." + action, target, "Development controls");
  });
  if (action === "reset") localStorage.removeItem(SESSION_KEY);
}
export async function sampleData() {
  if (!DEMO_MODE) throw Error("Simulation is disabled.");
  const salt = id(),
    hash = await credential("DemoPass123!", salt);
  await transaction((db) => {
    if (db.sampleLoaded) throw Error("Sample data is already loaded.");
    const hospitalId = id(),
      branchId = id();
    const h: Hospital = {
      id: hospitalId,
      ownerId: "",
      name: "Fictional Cedar Hospital",
      phone: "08000000000",
      email: "hospital@example.test",
      address: "1 Example Road",
      city: "Demo City",
      state: "Demo State",
      registration: "",
      verification: "Not submitted",
      type: "Teaching Hospital",
      departments: departments.slice(),
      step: 8,
      launched: true,
      currency: "NGN",
      invoicePrefix: "DEMO",
      paymentMethods: ["Cash", "Transfer", "Card", "Insurance"],
      paymentTiming: "After service",
      insurance: true,
      createdAt: now(),
    };
    db.hospitals.push(h);
    db.branches.push({
      id: branchId,
      hospitalId,
      name: "Main",
      address: h.address,
      contact: h.phone,
      departments: departments.slice(),
      hours: "00:00-23:59",
    });
    for (const role of roles) {
      const accountId = id();
      const email = role.toLowerCase().replaceAll(" ", "-") + "@example.test";
      db.accounts.push({
        id: accountId,
        name: "Demo " + role,
        email,
        phone: "08000000000",
        salt,
        hash,
        verified: true,
        credentialVersion: 1,
        createdAt: now(),
      });
      const membership: Membership = {
        id: id(),
        accountId,
        hospitalId,
        branchIds: [branchId],
        department: "Demo department",
        role,
        status: "active",
        employment: "employed",
        leave: "working",
        extraPermissions: [],
        deniedPermissions: [],
      };
      db.memberships.push(membership);
      if (role === "Hospital Owner") h.ownerId = accountId;
    }
    const seed = (
      kind: Kind,
      data: Fields,
      status = "active",
      refs: Partial<RecordEntity> = {},
    ) => {
      const r: RecordEntity = {
        id: id(),
        kind,
        hospitalId,
        branchId,
        status,
        createdAt: now(),
        updatedAt: now(),
        authorId: h.ownerId,
        data,
        versions: [],
        ...refs,
      };
      db.records.push(r);
      return r;
    };
    const p = seed("patient", {
      name: "Alex Example",
      dob: "1990-01-01",
      sex: "Female",
      phone: "08000000001",
      healthId: "HID-DEMO-001",
      provisional: false,
      allergies: "Fictional Med A",
    });
    seed("registration", { mrn: "MRN-000001" }, "active", { patientId: p.id });
    seed("service", { name: "Fictional consultation", price: 5000 });
    const item = seed("inventory", {
      name: "Fictional Med A",
      unit: "tablet",
      packSize: 10,
      threshold: 20,
      category: "Medication",
    });
    seed(
      "batch",
      { lot: "DEMO-LOT", quantity: 100, expiry: "2030-01-01" },
      "available",
      { parentId: item.id },
    );
    const ward = seed("ward", { name: "Example ward" });
    for (const name of ["Bed 1", "Bed 2"])
      seed("bed", { name, ward: ward.id }, "available");
    seed(
      "ambulance",
      { name: "DEMO-VEHICLE", crew: "Fictional crew" },
      "available",
    );
    const otherHospital = id(),
      otherBranch = id(),
      otherPatient = id();
    db.hospitals.push({
      ...h,
      id: otherHospital,
      name: "Fictional Partner Clinic",
      ownerId: h.ownerId,
    });
    db.branches.push({
      id: otherBranch,
      hospitalId: otherHospital,
      name: "Main",
      address: "2 Example Road",
      contact: h.phone,
      departments: ["General Outpatient"],
      hours: "09:00-17:00",
    });
    seed(
      "patient",
      { name: "Alex Example", healthId: "HID-DEMO-001" },
      "active",
      { id: otherPatient, hospitalId: otherHospital, branchId: otherBranch },
    );
    seed(
      "note",
      { note: "Fictional released historical note. No clinical guidance." },
      "signed",
      {
        patientId: otherPatient,
        hospitalId: otherHospital,
        branchId: otherBranch,
      },
    );
    seed(
      "labResult",
      { value: "Demonstration only", unit: "demo" },
      "published",
      {
        patientId: otherPatient,
        hospitalId: otherHospital,
        branchId: otherBranch,
      },
    );
    db.sampleLoaded = true;
    audit(
      db,
      "simulation.load-samples",
      hospitalId,
      "Explicit fictional sample loading",
    );
  });
}
export async function exportModule(moduleId: string) {
  const db = await read();
  requirePermission(db, moduleId, "export");
  const data = records(db, moduleId);
  await transaction((db) => audit(db, moduleId + ".export", moduleId));
  return data;
}

export function reportMetrics(db: Database, from = "", to = ""): Fields {
  requirePermission(db, "reports");
  if (from && to && from > to) throw Error("Start date must precede end date.");
  const r = scoped(db).filter(
    (x) =>
      (!from || x.createdAt.slice(0, 10) >= from) &&
      (!to || x.createdAt.slice(0, 10) <= to),
  );
  const invoices = r.filter((x) => x.kind === "invoice" && x.status !== "void");
  const beds = r.filter((x) => x.kind === "bed");
  const queues = r.filter(
    (x) => x.kind === "queue" && x.status !== "completed",
  );
  return {
    visits: r.filter((x) => x.kind === "visit").length,
    signedEncounters: r.filter(
      (x) => x.kind === "encounter" && x.status === "signed",
    ).length,
    admissions: r.filter((x) => x.kind === "admission").length,
    occupiedBeds: beds.filter((x) => x.status === "occupied").length,
    totalBeds: beds.length,
    publishedResults: r.filter(
      (x) =>
        ["labResult", "radiologyReport"].includes(x.kind) &&
        x.status === "published",
    ).length,
    fulfilledPrescriptions: r.filter(
      (x) => x.kind === "prescription" && x.status === "fulfilled",
    ).length,
    invoiced: invoices.reduce((n, x) => n + num(x.data.totalCents), 0) / 100,
    collected: invoices.reduce((n, x) => n + balance(db, x).paid, 0) / 100,
    outstanding: invoices.reduce((n, x) => n + balance(db, x).due, 0) / 100,
    stockMovements: r.filter((x) => x.kind === "stockMovement").length,
    qualityRates: "No data ? no validated denominator",
    meanOpenQueueMinutes: queues.length
      ? Math.round(
          queues.reduce(
            (n, x) => n + (Date.now() - Date.parse(x.createdAt)) / 60000,
            0,
          ) / queues.length,
        )
      : "No data",
  };
}
export async function exportReport(from = "", to = "") {
  return transaction((db) => {
    requirePermission(db, "reports", "export");
    const { h, s } = context(db);
    const result = {
      from,
      to,
      hospital: h.name,
      branch: s.branchId,
      metrics: reportMetrics(db, from, to),
    };
    audit(db, "reports.export", s.branchId, from + " through " + to);
    return result;
  });
}

export async function saveFacilityDraft(
  draftId: string,
  step: number,
  data: Fields,
) {
  if (!draftId) throw Error("Draft reference required.");
  await transaction((db) => {
    db.facilityDrafts ||= {};
    db.facilityDrafts[draftId] = {
      status: "draft",
      step,
      data: safeProfile(data),
      updatedAt: now(),
    };
  });
}
export async function saveFacilityProfile(data: Fields, submit = false) {
  await requireConnection();
  await transaction((db) => {
    const { h } = requirePermission(db, "facility", "edit");
    for (let step = 1; step < 4; step++) {
      const errors = facilityErrors(step, data, true);
      if (Object.keys(errors).length) throw Error(Object.values(errors)[0]);
    }
    const profileChanges = Object.keys(safeProfile(data)).filter(
      (key) =>
        JSON.stringify(h.registrationProfile?.[key]) !==
        JSON.stringify(data[key]),
    );
    const regulatory = profileChanges.some((key) =>
      [
        "licence",
        "cac",
        "registryId",
        "directorName",
        "mdcn",
        "operatingLicence",
        "cacCertificate",
      ].includes(key),
    );
    (h.profileHistory ||= []).push({
      at: now(),
      actorId: context(db).a.id,
      fields: profileChanges,
    });
    h.registrationProfile = { ...h.registrationProfile, ...safeProfile(data) };
    if (regulatory && h.verification !== "suspended") {
      h.verification = "pending_verification";
      (h.verificationHistory ||= []).push({
        status: "pending_verification",
        at: now(),
        reason: "Regulatory fields changed: " + profileChanges.join(", "),
      });
    }
    if (Array.isArray(data.departments)) h.departments = data.departments;

    Object.assign(h, {
      name: str(data.facilityName),
      phone: str(data.facilityPhone),
      email: str(data.facilityEmail),
      address: str(data.address),
      state: str(data.state),
      city: str(data.lga),
      registration: str(data.licence),
    });
    if (submit) {
      if (h.verification === "suspended")
        throw Error("Contact the platform reviewer to resolve suspension.");
      h.verification = "pending_verification";
      (h.verificationHistory ||= []).push(
        {
          status: "submitted",
          at: now(),
          reason: "Facility profile resubmitted",
        },
        {
          status: "pending_verification",
          at: now(),
          reason: "Awaiting review",
        },
      );
    }
    audit(
      db,
      "facility.profile-save",
      h.id,
      submit ? "Resubmitted" : "Profile edited",
    );
  });
}
export async function subscriptionDetails() {
  const db = await read();
  const { h } = requirePermission(db, "subscription");
  const sub = db.subscriptions?.[h.id];
  return sub
    ? {
        ...sub,
        status: subscriptionState(db, sub),
        now: simulationNow(db),
        daysRemaining: Math.max(
          0,
          Math.ceil(
            ((sub.periodEnd ?? sub.trialEnd ?? simulationNow(db)) -
              simulationNow(db)) /
              DAY,
          ),
        ),
      }
    : null;
}
export async function renewSubscription(plan: string) {
  await requireConnection();
  await transaction((db) => {
    const { h, a } = requirePermission(db, "subscription", "edit");
    if (pendingFacility(h))
      throw Error("Facility verification is required first.");
    if (!["Demo facility plan"].includes(plan))
      throw Error("Select the configured demonstration plan.");
    const config = db.subscriptionConfig || defaultSubscriptionConfig;
    db.subscriptions ||= {};
    const sub = db.subscriptions[h.id] || {
      trialStart: null,
      trialEnd: null,
      periodEnd: null,
      plan,
      status: "active" as const,
      graceDays: config.graceDays,
      history: [],
    };
    sub.periodEnd =
      Math.max(
        simulationNow(db),
        sub.status === "cancelled" ? 0 : (sub.periodEnd ?? sub.trialEnd ?? 0),
      ) +
      config.renewalDays * DAY;
    sub.plan = plan;
    sub.graceDays = config.graceDays;
    sub.status = "active";
    sub.history.push({
      at: simulationNow(db),
      action: "Simulated renewal; no payment collected",
      actor: a.id,
    });
    db.subscriptions[h.id] = sub;
    audit(db, "subscription.demo-renew", h.id, "No payment integration");
  });
}
export async function cancelSubscription() {
  await requireConnection();
  await transaction((db) => {
    const { h, a } = requirePermission(db, "subscription", "edit");
    const sub = db.subscriptions?.[h.id];
    if (!sub) throw Error("No subscription exists.");
    sub.status = "cancelled";
    sub.history.push({
      at: simulationNow(db),
      action: "Cancelled in simulation",
      actor: a.id,
    });
    audit(db, "subscription.cancel", h.id);
  });
}
export async function configureSubscriptionSimulation(data: Fields) {
  if (!DEMO_MODE) throw Error("Simulation is disabled.");
  await transaction((db) => {
    const trialDays = Number(data.trialDays),
      graceDays = Number(data.graceDays),
      renewalDays = Number(data.renewalDays),
      reminderDays = str(data.reminderDays).split(",").map(Number);
    if (
      !Number.isInteger(trialDays) ||
      trialDays < 1 ||
      !Number.isInteger(graceDays) ||
      graceDays < 0 ||
      !Number.isInteger(renewalDays) ||
      renewalDays < 1 ||
      reminderDays.some((x) => !Number.isInteger(x) || x < 1)
    )
      throw Error("Enter valid whole days.");
    db.subscriptionConfig = {
      trialDays,
      graceDays,
      renewalDays,
      reminderDays,
      provider: str(data.provider),
    };
    audit(
      db,
      "simulation.subscription-config",
      "configuration",
      "Applies to new periods",
    );
  });
}
export async function advanceSimulationDays(days: number) {
  if (!DEMO_MODE) throw Error("Simulation is disabled.");
  if (!Number.isInteger(days) || days < 0)
    throw Error("Use non-negative whole days.");
  await transaction((db) => {
    db.simulationTime = simulationNow(db) + days * DAY;
    audit(db, "simulation.advance-time", "clock", String(days) + " days");
  });
  await syncSubscriptionReminders();
}
export async function syncSubscriptionReminders() {
  const snapshot = await read();
  const due = (db: Database) =>
    Object.entries(db.subscriptions || {}).flatMap(([hospitalId, sub]) => {
      const end = sub.periodEnd ?? sub.trialEnd;
      if (!end || sub.status === "cancelled") return [];
      const days = Math.ceil((end - simulationNow(db)) / DAY);
      const threshold = (
        db.subscriptionConfig || defaultSubscriptionConfig
      ).reminderDays
        .filter((d) => days <= d && days > 0)
        .sort((a, b) => a - b)[0];
      if (
        threshold === undefined ||
        db.subscriptionReminders?.some(
          (r) =>
            r.hospitalId === hospitalId &&
            r.end === end &&
            r.days === threshold,
        )
      )
        return [];
      return [
        {
          id: id(),
          hospitalId,
          end,
          days: threshold,
          createdAt: now(),
          readBy: [],
        },
      ];
    });
  const statusChanged = (db: Database) =>
    Object.values(db.subscriptions || {}).some(
      (sub) => sub.status !== subscriptionState(db, sub),
    );
  if (!due(snapshot).length && !statusChanged(snapshot)) return;
  await transaction((db) => {
    db.subscriptionReminders ||= [];
    db.subscriptionReminders.push(...due(db));
    for (const sub of Object.values(db.subscriptions || {}))
      sub.status = subscriptionState(db, sub);
  });
}
export async function workspaceData() {
  const db = await read();
  if (connectionAvailable()) await refreshCache(db);
  let membership: Membership | undefined;
  try {
    membership = context(db).m;
  } catch {}
  const allowed = membership && subscriptionAllowed(membership);
  if (!allowed) {
    delete db.subscriptions;
    delete db.subscriptionConfig;
    delete db.subscriptionReminders;
    db.audit = db.audit.filter(
      (e) =>
        !e.action.includes("subscription") && !e.action.includes("demo-renew"),
    );
  } else {
    db.subscriptions = Object.fromEntries(
      Object.entries(db.subscriptions || {}).filter(
        ([id]) => id === membership!.hospitalId,
      ),
    );
    db.subscriptionReminders = db.subscriptionReminders?.filter(
      (r) => r.hospitalId === membership!.hospitalId,
    );
  }
  return db;
}

export async function registrationPolicy() {
  const db = await read();
  const config = db.subscriptionConfig || defaultSubscriptionConfig;
  return { trialDays: config.trialDays, graceDays: config.graceDays };
}

function validateProfilePhoto(value: string) {
  if (value === "") return;
  if (
    value.length > 2800000 ||
    !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)
  )
    throw Error("Choose a PNG, JPEG, WebP or GIF image no larger than 2 MB.");
}
export async function updateOwnProfile(data: Fields) {
  await transaction((db) => {
    const session = sessionIn(db);
    if (!session) throw Error("Sign in to update your profile.");
    const account = db.accounts.find((a) => a.id === session.accountId)!;
    if (data.name !== undefined) {
      if (!str(data.name).trim()) throw Error("Full name is required.");
      account.name = str(data.name).trim();
    }
    if (data.phone !== undefined) {
      if (
        !/^(?:\+234|234|0)[789]\d{9}$/.test(
          str(data.phone).replace(/[\s()-]/g, ""),
        )
      )
        throw Error("Enter a valid Nigerian phone number.");
      account.phone = str(data.phone).trim();
    }
    if (data.photo !== undefined) {
      validateProfilePhoto(str(data.photo));
      account.photo = str(data.photo);
    }
    for (const key of [
      "jobTitle",
      "bio",
      "language",
      "displayDepartment",
    ] as const)
      if (data[key] !== undefined) account[key] = str(data[key]);
    audit(db, "account.profile-updated", account.id, "Own profile update", {
      accountId: account.id,
    });
  });
}
export async function updateHospitalIdentity(data: Fields) {
  await requireConnection();
  await transaction((db) => {
    const { h, a } = requirePermission(db, "facility", "edit");
    const fields = Object.keys(data).filter(
      (k) =>
        ["name", "phone", "email", "address", "logo"].includes(k) &&
        JSON.stringify((h as any)[k]) !== JSON.stringify(data[k]),
    );
    if (fields.length)
      (h.profileHistory ||= []).push({ at: now(), actorId: a.id, fields });
    if (data.logo !== undefined) {
      validateProfilePhoto(str(data.logo));
      h.logo = str(data.logo);
    }
    if (data.name !== undefined) {
      if (!str(data.name).trim()) throw Error("Hospital name is required.");
      h.name = str(data.name).trim();
    }
    if (data.phone !== undefined) {
      if (
        !/^(?:\+234|234|0)[789]\d{9}$/.test(
          str(data.phone).replace(/[\s()-]/g, ""),
        )
      )
        throw Error("Enter a valid Nigerian phone number.");
      h.phone = str(data.phone).trim();
    }
    if (data.email !== undefined) {
      if (!/^\S+@\S+\.\S+$/.test(str(data.email)))
        throw Error("Enter a valid hospital email.");
      h.email = str(data.email).trim();
    }
    if (data.address !== undefined) {
      if (!str(data.address).trim())
        throw Error("Hospital address is required.");
      h.address = str(data.address).trim();
    }
    if (h.registrationProfile)
      Object.assign(h.registrationProfile, {
        facilityName: h.name,
        facilityPhone: h.phone,
        facilityEmail: h.email,
        address: h.address,
      });
    audit(db, "hospital.profile-updated", h.id);
  });
}
export async function changeOwnPassword(
  currentPassword: string,
  password: string,
  confirm: string,
) {
  await requireConnection();
  passwordCheck(password);
  if (password !== confirm) throw Error("Passwords do not match.");
  if (password === currentPassword) throw Error("Choose a different password.");
  const salt = id();
  const hash = await credential(password, salt);
  let changedAccount = "";
  await transaction(async (db) => {
    const session = sessionIn(db);
    if (!session) throw Error("Sign in to change your password.");
    const account = db.accounts.find((a) => a.id === session.accountId)!;
    if ((await credential(currentPassword, account.salt)) !== account.hash)
      throw Error("Current password is incorrect.");
    audit(
      db,
      "account.password-changed",
      account.id,
      "All sessions and recovery codes invalidated",
      { accountId: account.id },
    );
    changedAccount = account.id;
    account.forcePasswordChange = false;
    securityNotice(
      account,
      "Your password changed. All previous sessions were signed out.",
    );
    account.salt = salt;
    account.hash = hash;
    account.credentialVersion++;
    db.sessions = db.sessions.filter((s) => s.accountId !== account.id);
    db.codes = db.codes.filter((c) => c.accountId !== account.id);
  });
  localStorage.removeItem(SESSION_KEY);
  for (const key of Object.keys(localStorage)) if (key.startsWith("filter-")) localStorage.removeItem(key);
  if (changedAccount) await clearUserCache(changedAccount);
  await changed();
}

function securityNotice(account: Account, text: string) {
  (account.securityNotices ||= []).push({
    at: now(),
    text,
    destination: account.email,
  });
}
export async function requestProfileEmail(email: string, password: string) {
  await requireConnection();
  return transaction(async (db) => {
    const { a } = context(db);
    if ((await credential(password, a.salt)) !== a.hash)
      throw Error("Current password is incorrect.");
    email = email.trim().toLowerCase();
    if (
      !/^\S+@\S+\.\S+$/.test(email) ||
      db.accounts.some((x) => x.email === email)
    )
      throw Error("Choose a valid, unused email.");
    a.pendingEmail = email;
    return issue(db, a.id, "verify");
  });
}
export async function confirmProfileEmail(codeId: string, value: string) {
  await requireConnection();
  const result = await transaction((db) => {
    const { a } = context(db);
    const code = db.codes.find(
      (c) => c.id === codeId && c.accountId === a.id && c.purpose === "verify",
    );
    if (!code || code.used || code.expires < Date.now() || code.attempts >= 5)
      return "Code unavailable. Request another code.";
    code.attempts++;
    if (code.code !== value) return "Incorrect code.";
    if (
      !a.pendingEmail ||
      db.accounts.some((x) => x.id !== a.id && x.email === a.pendingEmail)
    )
      return "This email is unavailable.";
    code.used = true;
    securityNotice(a, "Your sign-in email changed to " + a.pendingEmail);
    a.email = a.pendingEmail;
    delete a.pendingEmail;
    securityNotice(a, "Your new sign-in email is verified.");
    audit(db, "account.email-changed", a.id);
    return "";
  });
  if (result) throw Error(result);
}
export async function signOutOtherDevices() {
  await requireConnection();
  await transaction((db) => {
    const s = sessionIn(db);
    if (!s) throw Error("Sign in first.");
    db.sessions = db.sessions.filter(
      (x) => x.accountId !== s.accountId || x.id === s.id,
    );
    audit(db, "account.other-sessions-revoked", s.accountId);
  });
}
export async function adminReset(memberId: string) {
  await requireConnection();
  await transaction((db) => {
    const { m, h } = context(db);
    if (!["Hospital Owner", "Hospital Admin"].includes(m.role))
      throw Error("Only Owner or Admin may initiate recovery.");
    const target = db.memberships.find(
      (x) => x.id === memberId && x.hospitalId === h.id,
    );
    if (!target) throw Error("Staff member is unavailable.");
    issue(db, target.accountId, "recover");
    audit(
      db,
      "account.admin-reset-requested",
      target.accountId,
      "Reset code delivered to simulated inbox; password is never shown.",
    );
  });
}
export async function submitCredentials(number: string, details: string) {
  await requireConnection();
  await transaction((db) => {
    const { a } = context(db);
    if (!number.trim()) throw Error("Credential number is required.");
    a.credentials = {
      number: number.trim(),
      details: details.trim(),
      status: "pending",
    };
    audit(db, "account.credentials-submitted", a.id);
  });
}
export async function reviewCredentials(memberId: string, approve: boolean) {
  await requireConnection();
  await transaction((db) => {
    const { m, h } = context(db);
    if (!["Hospital Owner", "Hospital Admin"].includes(m.role))
      throw Error("Only Owner or Admin may review credentials.");
    const target = db.memberships.find(
      (x) =>
        x.id === memberId &&
        x.hospitalId === h.id &&
        x.accountId !== m.accountId,
    );
    const a = db.accounts.find((x) => x.id === target?.accountId);
    if (!a?.credentials)
      throw Error("No pending credentials for this staff member.");
    a.credentials.status = approve ? "approved" : "rejected";
    a.credentials.reviewer = m.accountId;
    audit(db, "account.credentials-reviewed", a.id, a.credentials.status);
  });
}
export const defaultPreferences = {
  sounds: true,
  volume: 35,
  message: "off",
  mention: "off",
  task: "chime",
  alert: "off",
  quietStart: "22:00",
  quietEnd: "07:00",
  muteClinical: true,
};
export async function savePreferences(data: Fields) {
  await transaction((db) => {
    const { a } = context(db);
    const volume = Number(data.volume);
    if (!Number.isFinite(volume) || volume < 0 || volume > 100)
      throw Error("Volume must be between 0 and 100.");
    for (const key of ["message", "mention", "task", "alert"])
      if (!["off", "chime", "drop", "pulse"].includes(str(data[key])))
        throw Error("Choose an available sound.");
    for (const key of ["quietStart", "quietEnd"])
      if (data[key] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(str(data[key])))
        throw Error("Use HH:MM for quiet hours.");
    a.preferences = {
      sounds: !!data.sounds,
      volume,
      message: str(data.message),
      mention: str(data.mention),
      task: str(data.task),
      alert: str(data.alert),
      quietStart: str(data.quietStart),
      quietEnd: str(data.quietEnd),
      muteClinical: !!data.muteClinical,
    };
  });
}
export async function setPresence(
  status: string,
  text: string,
  minutes: number,
) {
  await requireConnection();
  await transaction((db) => {
    const { s, h } = context(db);
    if (!["Online", "Away", "Do not disturb", "Offline"].includes(status))
      throw Error("Invalid status.");
    if (status === "Offline" && h.presencePolicy?.allowOffline === false)
      throw Error("This facility disables appearing offline.");
    if (text.length > 80) throw Error("Keep your status under 80 characters.");
    s.presence = {
      status,
      text,
      expires: minutes
        ? Date.now() + Math.min(1440, Math.max(1, minutes)) * 60000
        : 0,
      heartbeat: Date.now(),
      activeAt: Date.now(),
    };
    for (const other of db.sessions.filter(
      (x) =>
        x.accountId === s.accountId &&
        x.id !== s.id &&
        db.memberships.some(
          (m) => m.id === x.membershipId && m.hospitalId === h.id,
        ),
    ))
      other.presence = {
        ...s.presence,
        heartbeat: other.presence?.heartbeat || 0,
      };
  });
  // Apply the committed preference before callers can emit feedback. React's
  // presence effect also refreshes it for expiry and session changes.
  (globalThis as any).__hidDnd = status === "Do not disturb";
}
export async function presenceHeartbeat(activeAt: number) {
  if (!connectionAvailable()) return;
  await transaction((db) => {
    let ctx;
    try {
      ctx = context(db);
    } catch {
      return;
    }
    const { s } = ctx;
    s.lastActive = now();
    s.presence ||= {
      status: "Online",
      text: "",
      expires: 0,
      heartbeat: 0,
      activeAt: 0,
    };
    s.presence.heartbeat = Date.now();
    s.presence.activeAt = activeAt;
  });
}
export async function savePresencePolicy(data: Fields) {
  await requireConnection();
  await transaction((db) => {
    const { m, h } = context(db);
    if (!["Hospital Owner", "Hospital Admin"].includes(m.role))
      throw Error("Only Owner or Admin may change presence policy.");
    const idle = Number(data.idleMinutes);
    if (!Number.isFinite(idle) || idle < 1 || idle > 60)
      throw Error("Idle period must be 1�60 minutes.");
    h.presencePolicy = {
      enabled: !!data.enabled,
      allowOffline: !!data.allowOffline,
      idleMinutes: idle,
      criticalSounds: !!data.criticalSounds,
    };
    audit(db, "hospital.presence-policy", h.id);
  });
}

export async function setTwoFactor(enabled: boolean, password: string) {
  await requireConnection();
  await transaction(async (db) => {
    const { a } = context(db);
    if ((await credential(password, a.salt)) !== a.hash)
      throw Error("Current password is incorrect.");
    a.mfaEnabled = enabled;
    securityNotice(
      a,
      "Two-step sign-in " + (enabled ? "enabled" : "disabled") + ".",
    );
    audit(db, "account.two-factor-changed", a.id);
  });
}
export function visibleNotifications(db: Database) {
  const { a } = context(db);
  return scoped(db, "notification").filter(
    (n) =>
      (!n.data.recipient || n.data.recipient === a.id) &&
      can(db, str(n.data.route).split("/")[1] || "notifications"),
  );
}

export async function updateHospitalOperations(data: Fields) {
  await requireConnection();
  await transaction((db) => {
    const { h, a } = requirePermission(db, "facility", "edit");
    const previous = h.registrationProfile || {};
    const fields = [
      "hours",
      "beds",
      "departments",
      "services",
      "licence",
      "cac",
      "registryId",
      "directorName",
    ];
    const changedFields = fields.filter(
      (k) =>
        JSON.stringify(
          previous[k] ?? (k === "licence" ? h.registration : ""),
        ) !== JSON.stringify(data[k]),
    );
    if (!Number.isInteger(Number(data.beds)) || Number(data.beds) < 0)
      throw Error("Bed count must be a non-negative whole number.");
    if (!Array.isArray(data.departments)) throw Error("Choose departments.");
    const regulatory = changedFields.some((k) =>
      ["licence", "cac", "registryId", "directorName"].includes(k),
    );
    h.registrationProfile = {
      ...previous,
      ...Object.fromEntries(fields.map((k) => [k, data[k]])),
    };
    h.departments = data.departments;
    h.registration = str(data.licence);
    if (regulatory && h.verification !== "suspended") {
      h.verification = "pending_verification";
      (h.verificationHistory ||= []).push({
        status: "pending_verification",
        at: now(),
        reason: "Regulatory profile changed: " + changedFields.join(", "),
      });
    }
    if (changedFields.length)
      (h.profileHistory ||= []).push({
        at: now(),
        actorId: a.id,
        fields: changedFields,
      });
    audit(db, "hospital.operations-updated", h.id, changedFields.join(", "));
  });
}
