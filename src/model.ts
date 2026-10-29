export type Value = string | number | boolean | string[];
export type Fields = Record<string, Value>;
export const kinds = [
  "department",
  "service",
  "staffProfile",
  "credential",
  "shift",
  "roster",
  "patient",
  "registration",
  "appointment",
  "visit",
  "queue",
  "triage",
  "encounter",
  "note",
  "prescription",
  "prescriptionItem",
  "labOrder",
  "sample",
  "labResult",
  "radiologyOrder",
  "study",
  "radiologyReport",
  "admission",
  "ward",
  "bed",
  "nursingTask",
  "observation",
  "procedure",
  "invoice",
  "payment",
  "refund",
  "policy",
  "claim",
  "inventory",
  "batch",
  "stockMovement",
  "purchaseRequest",
  "purchaseOrder",
  "referral",
  "ambulance",
  "dispatch",
  "donation",
  "bloodUnit",
  "telemedicine",
  "incident",
  "consent",
  "grant",
  "notification",
] as const;
export type Kind = (typeof kinds)[number];
export interface RecordEntity {
  id: string;
  kind: Kind;
  hospitalId: string;
  branchId: string;
  patientId?: string;
  visitId?: string;
  encounterId?: string;
  parentId?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  authorId: string;
  data: Fields;
  sync?: {
    state: string;
    deviceAt: string;
    receivedAt?: string;
    reason?: string;
  };
  conflict?: {
    id: string;
    kind: string;
    local: Fields;
    remote: Fields;
    status: string;
    reason?: string;
  };
  versions: {
    at: string;
    authorId: string;
    reason: string;
    data: Fields;
    status: string;
  }[];
}
export type Entity<K extends Kind> = RecordEntity & { kind: K };
export type PatientIdentity = Entity<"patient">;
export type HospitalRegistration = Entity<"registration">;
export type Appointment = Entity<"appointment">;
export type Visit = Entity<"visit">;
export type QueueEntry = Entity<"queue">;
export type TriageRecord = Entity<"triage">;
export type Encounter = Entity<"encounter">;
export type ClinicalNote = Entity<"note">;
export type Prescription = Entity<"prescription">;
export type PrescriptionItem = Entity<"prescriptionItem">;
export type LaboratoryOrder = Entity<"labOrder">;
export type Sample = Entity<"sample">;
export type LaboratoryResult = Entity<"labResult">;
export type RadiologyOrder = Entity<"radiologyOrder">;
export type Study = Entity<"study">;
export type RadiologyReport = Entity<"radiologyReport">;
export type Admission = Entity<"admission">;
export type Ward = Entity<"ward">;
export type Bed = Entity<"bed">;
export type Invoice = Entity<"invoice">;
export type Payment = Entity<"payment">;
export type Refund = Entity<"refund">;
export type InsurancePolicy = Entity<"policy">;
export type Claim = Entity<"claim">;
export type InventoryItem = Entity<"inventory">;
export type Batch = Entity<"batch">;
export type StockMovement = Entity<"stockMovement">;
export type PurchaseRequest = Entity<"purchaseRequest">;
export type PurchaseOrder = Entity<"purchaseOrder">;
export type ConsentRequest = Entity<"consent">;
export type AccessGrant = Entity<"grant">;
export const roles = [
  "Platform Super Admin",
  "Hospital Owner",
  "Medical Director",
  "Hospital Admin",
  "Consultant",
  "Doctor",
  "Nurse",
  "Receptionist",
  "Records Officer",
  "Lab Manager",
  "Lab Scientist",
  "Pharmacy Manager",
  "Pharmacist",
  "Billing Officer",
  "Cashier",
  "Radiology Reporter",
] as const;
export type Role = (typeof roles)[number];
export interface Account {
  mfaEnabled?: boolean;
  language?: string;
  displayDepartment?: string;
  pendingEmail?: string;
  forcePasswordChange?: boolean;
  credentials?: {
    number: string;
    details: string;
    status: "pending" | "approved" | "rejected";
    reviewer?: string;
  };
  preferences?: {
    sounds: boolean;
    volume: number;
    message: string;
    mention: string;
    task: string;
    alert: string;
    quietStart: string;
    quietEnd: string;
    muteClinical: boolean;
  };
  securityNotices?: { at: string; text: string; destination: string }[];
  id: string;
  name: string;
  email: string;
  phone: string;
  photo?: string;
  jobTitle?: string;
  bio?: string;
  hash: string;
  salt: string;
  verified: boolean;
  credentialVersion: number;
  lastContext?: { membershipId: string; branchId: string; route: string };
  createdAt: string;
}
export interface Membership {
  shortcuts?: string[];
  id: string;
  accountId: string;
  hospitalId: string;
  role: Role;
  branchIds: string[];
  department: string;
  status: "active" | "suspended" | "ended";
  employment: "employed" | "ended";
  leave: "working" | "on leave";
  extraPermissions: string[];
  deniedPermissions: string[];
}
export interface Branch {
  id: string;
  hospitalId: string;
  name: string;
  address: string;
  contact: string;
  departments: string[];
  hours: string;
}
export interface Hospital {
  dashboardDefaults?: Partial<Record<Role, string[]>>;
  presencePolicy?: {
    enabled: boolean;
    allowOffline: boolean;
    idleMinutes: number;
    criticalSounds: boolean;
  };
  profileHistory?: { at: string; actorId: string; fields: string[] }[];
  id: string;
  ownerId: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  registration: string;
  verification: string;
  type: string;
  departments: string[];
  step: number;
  launched: boolean;
  currency: string;
  invoicePrefix: string;
  paymentMethods: string[];
  paymentTiming: string;
  insurance: boolean;
  logo?: string;
  registrationProfile?: Fields;
  verificationReason?: string;
  verificationHistory?: { status: string; at: string; reason: string }[];
  createdAt: string;
}
export interface Invitation {
  id: string;
  hospitalId: string;
  name: string;
  email: string;
  role: Role;
  department: string;
  branchIds: string[];
  status: "pending" | "accepted" | "revoked";
  expires: number;
  createdAt: string;
}
export interface Code {
  recoveryVerified?: boolean;
  id: string;
  accountId: string;
  purpose: "verify" | "mfa" | "recover";
  code: string;
  expires: number;
  attempts: number;
  sentAt: number;
  used: boolean;
}
export interface Session {
  presence?: {
    status: string;
    text: string;
    expires: number;
    heartbeat: number;
    activeAt: number;
  };
  device?: string;
  lastActive?: string;
  id: string;
  accountId: string;
  version: number;
  expires: number;
  membershipId: string;
  branchId: string;
  lastRoute: string;
}
export interface AuditEvent {
  id: string;
  actorId: string;
  membershipId: string;
  hospitalId: string;
  branchId: string;
  action: string;
  resource: string;
  at: string;
  reason: string;
  deviceAt?: string;
  serverReceivedAt?: string;
  clockSkewMs?: number;
}
export interface Database {
  offlineAuthority?: {
    checkedAt: number;
    validUntil: number;
    clinicalWriteAllowed: boolean;
  };
  schema: 1;
  accounts: Account[];
  hospitals: Hospital[];
  branches: Branch[];
  memberships: Membership[];
  invitations: Invitation[];
  codes: Code[];
  sessions: Session[];
  records: RecordEntity[];
  audit: AuditEvent[];
  drafts: Record<string, Fields>;
  operations: string[];
  sampleLoaded: boolean;
  facilityDrafts?: Record<
    string,
    { status: "draft"; step: number; data: Fields; updatedAt: string }
  >;
  subscriptions?: Record<string, Subscription>;
  subscriptionConfig?: {
    trialDays: number;
    graceDays: number;
    reminderDays: number[];
    renewalDays: number;
    provider: string;
  };
  simulationTime?: number;
  subscriptionReminders?: {
    id: string;
    hospitalId: string;
    end: number;
    days: number;
    createdAt: string;
    readBy: string[];
  }[];
}
export const emptyDB = (): Database => ({
  schema: 1,
  accounts: [],
  hospitals: [],
  branches: [],
  memberships: [],
  invitations: [],
  codes: [],
  sessions: [],
  records: [],
  audit: [],
  drafts: {},
  operations: [],
  sampleLoaded: false,
});
export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const departments = [
  "General Outpatient",
  "Emergency",
  "Inpatient",
  "Laboratory",
  "Pharmacy",
  "Maternity",
  "Pediatrics",
  "Radiology",
  "Dental",
  "Physiotherapy",
  "Dialysis",
  "Oncology",
  "Cardiology",
  "ICU",
  "Theatre",
];
export const facilityTypes = [
  "Clinic",
  "Specialist Clinic",
  "Diagnostic Centre",
  "Maternity Centre",
  "Community Hospital",
  "Specialist Hospital",
  "Multi-Branch Hospital",
  "Teaching Hospital",
];
export const str = (v: Value | undefined) => (v === undefined ? "" : String(v));
export const num = (v: Value | undefined) => Number(v || 0);

export interface Subscription {
  trialStart: number | null;
  trialEnd: number | null;
  periodEnd: number | null;
  plan: string;
  status:
    | "trialing"
    | "active"
    | "expiring_soon"
    | "grace_period"
    | "expired"
    | "cancelled";
  graceDays: number;
  history: { at: number; action: string; actor: string }[];
}
