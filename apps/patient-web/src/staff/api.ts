import { stagingChatQuestion, parseStagingPatientChat, parseStagingChatHistory, chatQuestion, parsePatientChat,
  parsePatientChatAvailability, parsePatientChatHistory, parsePatientChatCleared } from '@hid/contracts'
import { parseImportedHistory, type ImportedRecordsResponse, type ImportedAttachmentDownload, type ImportedHistoryPage } from '../importedRecords'
import { createApiClient, HidApiError, isHidApiError, NO_RETRY, uploadPresignedObject, type ApiClient, type RequestSpec } from '@hid/http'
import { createRegisteredBrowserClient } from '@hid/api'
import { getEnvironment } from './env'
import {
  assertStaffSessionFacility, endsStaffSession, nextStaffSessionChange, noteStaffSessionRefusal, refusedAsPatient, reportStaffSessionEnded,
  reportStaffSessionRead, staffMfaRequired, staffSessionActor, staffSessionGeneration, staffSessionReadyFor, staffSessionSignal,
  untilStaffSessionReady,
} from './session'
import { inRefreshTurn, refreshInTurn, signOutInTurn } from '../sessionRefreshTurn'
import { heldByOtherPortal } from '../sessionChange'
import { staffLoginAction } from '../productHostname'

export interface Facility {
  id: string
  membershipId: string
  organizationId: string
  name: string
  code?: string
  roles: string[]
  permissions: string[]
  isPrimary: boolean
  /**
   * Novu since P4b, only at a facility that signed itself up: 'pending' until Health ID support has checked it, then
   * 'reviewed', with the facility's type. Governed and legacy facilities, and an Identity before P4b, send none.
   * Copy only: Identity decides every request (see staffAccess.selfServiceReview).
   */
  selfService?: { review: string; organizationType: string }
}

export interface Actor {
  kind?: 'staff' | 'patient'
  id: string
  email?: string
  displayName?: string
  roles: string[]
  permissions: string[]
  facilities: Facility[]
  facility?: Facility
}

/**
 * Where the facility a staff session reports comes from (hid-system ADR-046,
 * migration 0080): 'selected', the facility this sign-in chose with
 * POST /auth/facility; 'default', none chosen, so the server's default (the
 * primary facility, else the first by name); 'reselect', the facility chosen
 * earlier is no longer one of the actor's active facilities, so the default is
 * reported instead. An Identity without that contract sends no field. A value
 * not named here (a later contract) is not taken as a choice made: the portal
 * asks (see facilitySelection.ts).
 */
export type FacilitySelection = 'selected' | 'default' | 'reselect'

export interface StaffSession {
  actor: Actor
  expiresAt?: string
  facilitySelection?: FacilitySelection
}

/**
 * Staff sign-in with an authenticator (hid-system #71, ADR-054, migration 0088).
 * The password step answers with the second step Identity asks for, and only an
 * httpOnly challenge cookie the browser sends to /auth/mfa (5 minutes to verify,
 * 10 to set up an authenticator); the session comes from verify, or from
 * activation after a first enrolment. Nothing of a challenge, code or secret is
 * kept outside the step's own state.
 */
export interface StaffLoginChallenge {
  status: 'mfa_required' | 'mfa_enrollment_required'
  expiresAt: string
}

/**
 * What the password step answered: the second step Identity asks for, or, from
 * an Identity before #71, the session itself. The portal accepts either, so
 * Identity and the portal may be deployed in either order.
 */
export type StaffLoginResult =
  | { kind: 'challenge'; challenge: StaffLoginChallenge }
  | { kind: 'session'; session: StaffSession }

/** Reads the password step's answer. Anything else (a later contract's step, say) opens nothing. */
function loginResult(answer: unknown): StaffLoginResult {
  const read = answer as Partial<StaffLoginChallenge> & Partial<StaffSession> | null
  if ((read?.status === 'mfa_required' || read?.status === 'mfa_enrollment_required') && typeof read.expiresAt === 'string') {
    return { kind: 'challenge', challenge: { status: read.status, expiresAt: read.expiresAt } }
  }
  if (typeof read?.actor?.id === 'string') return { kind: 'session', session: read as StaffSession }
  throw new HidApiError(502, 'The service returned an unreadable response.', { code: 'INVALID_RESPONSE', retryable: false })
}

/** The enrolment code was emailed to the account's address. `expiresAt` is the challenge's, not the code's. */
export interface StaffEnrollmentCodeSent {
  accepted: true
  channel: 'email'
  expiresAt: string
}

/** The new authenticator's secret, which Identity returns this once (enrolment start). */
export interface StaffMfaEnrollment {
  secret: string
  otpauthUri: string
  algorithm: 'SHA1'
  digits: number
  periodSeconds: number
  expiresAt: string
}

/** The session of a first sign-in with the new authenticator, and its recovery codes, shown once. */
export interface StaffMfaActivation extends StaffSession {
  recoveryCodes: string[]
}

export interface RegistrationCapabilities {
  nin: { enabled: boolean; state: string }
  newPatientRegistrationRequiresNin: boolean
}

export interface RegistrationCase {
  caseId: string
  status: 'pending_new_identity_approval' | 'review_required' | 'resolved_existing_identity' |
    'linked_existing' | 'approved_new_identity' | 'rejected' | 'cancelled'
  version: number
  candidateCount: number
  candidates?: Array<{ patientId: string; fullName: string; dateOfBirth: string | null }>
  patient?: { patientId: string; hid: string }
}

export interface RegistrationEnrollment {
  patientId: string
  hid: string
  contactVerificationRequired: boolean
  replayed: boolean
}

export interface ResolveNinInput {
  nin: string
  firstName: string
  lastName: string
  dateOfBirth: string
  gender?: 'female' | 'male' | 'intersex' | 'other' | 'unknown'
}

/**
 * Facility-assisted registration (hid-system main f9dbaf0: #85, migration 0094,
 * ADR-063). At a participating facility a staff member types the desk code the
 * patient's own phone shows, and the names and date of birth as written on one
 * original photo ID, with five attestations. The answer is verified, a result
 * per field, or a refusal: never the NIN, a record value, the contact or a
 * Health ID. Nothing typed is kept outside the screen's own state.
 */
export const ASSISTED_DOCUMENT_TYPES = ['national_id_card', 'international_passport', 'drivers_licence', 'voters_card'] as const
export type AssistedDocumentType = (typeof ASSISTED_DOCUMENT_TYPES)[number]

export interface AssistedVerificationInput {
  /** As the patient's phone shows it; Identity ignores spaces, hyphens and case. */
  deskCode: string
  method: 'government_photo_id_in_person'
  documentType: AssistedDocumentType
  /** As written on the document; the date of birth only when it shows one. */
  document: { firstName: string; lastName: string; dateOfBirth?: string }
  /** Each must be true; Identity refuses the check otherwise. */
  attestations: {
    patientPresent: true
    originalDocumentSeen: true
    photoMatchesPerson: true
    codeShownOnPatientsOwnDevice: true
    patientConsents: true
  }
}

export interface AssistedVerificationResult { outcome: 'verified' }

/** `ListStaffAccessRequestsDto` statuses: the request's own status. */
export const ACCESS_REQUEST_STATUSES = ['pending', 'approved', 'denied', 'revoked', 'expired'] as const
/** Outcome filters an Identity build with hid-system 0074 also accepts. */
export const ACCESS_OUTCOME_FILTERS = ['active', 'closed'] as const
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number] | (typeof ACCESS_OUTCOME_FILTERS)[number]

export interface AccessRequest {
  accessRequestId: string
  patientId: string
  scope: 'read_records' | 'write_records'
  purposeOfUse: string
  reason: string
  status: string
  requestedDurationMinutes: number
  requestedAt: string
  approvedAt?: string | null
  deniedAt?: string | null
  deniedReason?: string | null
  /**
   * The outcome of an approval (hid-system 0074): the grant made from the
   * request, its expiry, and an effective status ('active', 'expired',
   * 'closed' by this clinician or 'revoked'; otherwise the request status).
   * Absent from an Identity build before 0074.
   */
  consentGrantId?: string | null
  grantExpiresAt?: string | null
  effectiveStatus?: string
  authorizationMethod?: 'patient_access_pin' | 'patient_approval' | null
}

export interface GrantResult {
  accessRequestId: string
  consentGrantId: string
  patientId: string
  status: string
  expiresAt: string
}

/** `POST /identity/patient-lookup` patient fields (identity.service.ts). */
export interface PatientSummary {
  patientId: string
  hid: string
  fullName?: string
  firstName?: string
  lastName?: string
  dateOfBirth?: string
  gender?: string
  version?: number
}

/**
 * `POST /identity/patient-lookup` answers only an allowed lookup; a refusal is
 * a 403. `consentGrantId` is the grant that authorized it (patient approval,
 * patient PIN or emergency access), which its clinician may close.
 */
export type PatientLookup =
  | { authorization: { decision: 'deny'; expiresAt?: string }; patient?: never }
  | { authorization: { decision: 'allow'; expiresAt?: string; consentGrantId?: string | null; breakGlass?: boolean; scope?: string }; patient: PatientSummary }

/** `POST /identity/consent-status`: what the current grant permits at this facility. */
export interface ConsentStatus {
  patientId: string
  facilityId: string
  purpose: string
  readAllowed: boolean
  writeAllowed: boolean
  expiresAt?: string
}

export function isAllowedPatientLookup(lookup: PatientLookup): lookup is Extract<PatientLookup, { patient: PatientSummary }> {
  return lookup.authorization.decision === 'allow' && !!lookup.patient
}

export interface Page<T> { items: T[]; nextCursor: string | null }

/**
 * One page of an EHR timeline (TimelineQueryDto): its opaque cursor, or none for
 * the first. `fresh` reads after a change: the HTTP client merges identical GETs
 * in flight, and one started before the change would answer with the old rows.
 */
export interface PageRequest { readonly cursor?: string; readonly fresh?: boolean }

function pageQuery(page: PageRequest) {
  return { query: { limit: 50, ...(page.cursor ? { cursor: page.cursor } : {}) }, ...(page.fresh ? { dedupe: false } : {}) }
}

/** Only fields needed for the provider review are retained from the audit response. */
export interface FacilityAuditEvent {
  sequenceId: string
  occurredAt: string
  correlationId: string
  actorType: string
  action: string
  outcome: 'success' | 'denied' | 'failure'
  resourceType: string | null
}

export interface FacilityAuditPage {
  items: FacilityAuditEvent[]
  nextBeforeSequenceId: string | null
}

export interface Encounter {
  id: string
  patientId: string
  facilityId: string
  encounterType: string
  status: string
  startedAt: string
  chiefComplaint: string | null
  rowVersion: number | string
}

export type RecordKind = 'clinical-notes' | 'vitals' | 'diagnoses' | 'prescriptions' | 'lab-requests'

export interface ClinicalRecord {
  id: string
  patientId: string
  encounterId: string
  createdAt: string
  [key: string]: unknown
}

export type StatusRecordKind = 'clinical-notes' | 'prescriptions' | 'lab-requests'

/**
 * What became of asking Lab to accept an active lab request once EHR saved it
 * (hid-system #56, lab-requests.service.ts LabHandoff; INTERFACE_CONTRACT.md,
 * "Lab requests"). Lab holds one work item per request, at the version it
 * accepted: `already_accepted` means it holds an earlier version, so this
 * version's change is not in Lab; `failed` carries Lab's status and code, and
 * the request can be sent again; `not_sent` means the actor lacks
 * lab.work-item.accept.
 */
export type LabHandoff =
  | { state: 'accepted' }
  | { state: 'already_accepted'; code: string }
  | { state: 'failed'; status: number; code: string }
  | { state: 'not_sent'; code: string }

/**
 * A record as EHR answers its create or status change. Since hid-system #56 a lab
 * request also carries Lab's work item and `labHandoff`, both null unless the
 * request is active; an earlier EHR sends neither.
 */
export type SavedRecord = ClinicalRecord & { labWorkItem?: unknown; labHandoff?: LabHandoff | null }

export type VitalMeasurement = 'systolicMmhg' | 'diastolicMmhg' | 'pulseBpm' | 'temperatureC'
  | 'respiratoryRate' | 'oxygenSaturationPercent' | 'weightKg' | 'heightCm'
export type VitalMeasurements = Partial<Record<VitalMeasurement, number>>

/** An appended correction: its values replace the vital's, which stay as recorded. */
export interface VitalCorrection {
  id: string
  vitalId: string
  correctionNo: number
  replacementValues: VitalMeasurements
  reason: string
  createdAt: string
}

/** EHR UpdateDiagnosisDto: the fields it names, and only those. */
export interface DiagnosisUpdate {
  expectedRowVersion: number
  changeReason: string
  clinicalStatus?: string
  verificationStatus?: string
  notes?: string
}

export interface NoteRevision {
  id: string
  revisionNo: number
  content: string
  changeReason: string
  createdAt: string
}

/** The seven sections of an EHR record summary, in the order EHR names them (INTERFACE_CONTRACT.md, Record summaries). */
export type EmergencySection = 'encounters' | 'notes' | 'vitals' | 'diagnoses' | 'prescriptions' | 'labRequests' | 'documents'

/**
 * GET /ehr/patients/:patientId/emergency-records (hid-system
 * patient-records.service.ts readEmergency): this facility's completed
 * encounters and signed notes, 50 of each; of vitals, diagnoses, prescriptions
 * and lab requests, 100 of each in every status; and 100 documents; but
 * since hid-system #52 only the sections the reader holds the read permission
 * for. `released` names those and `withheld` the others, whose arrays are then
 * empty and mean "not released to this caller", never "no records"; `limits`
 * and `truncated` say, per released section, the most rows it shows and whether
 * more exist. Documents are those whose latest virus scan is clean (status
 * 'available', scanStatus 'clean', mediaType as the scan detected it). Vitals
 * are as first recorded, without corrections, and never shown here. An EHR before
 * #52 sends every section, documents in every status, and one `limit` (100), and
 * none of the four fields. pg sends numeric and bigint columns as strings.
 */
export interface EmergencyRecords {
  encounters: Array<{
    id: string
    facilityId: string
    encounterType: string
    status: 'completed'
    startedAt: string
    endedAt: string | null
  }>
  notes: Array<{
    id: string
    encounterId: string
    facilityId: string
    noteType: string
    title: string
    status: 'signed' | 'amended'
    revisionNo: number
    content: string
    signedAt: string | null
  }>
  diagnoses: Array<{
    id: string
    encounterId: string
    facilityId: string
    codeSystem: string
    code: string
    display: string
    clinicalStatus: string
    verificationStatus: string
    onsetAt: string | null
    abatementAt: string | null
    notes: string | null
  }>
  prescriptions: Array<{
    id: string
    encounterId: string
    facilityId: string
    medicationCodeSystem: string | null
    medicationCode: string | null
    medicationDisplay: string
    doseQuantity: number | string | null
    doseUnit: string | null
    routeCode: string | null
    frequency: string
    instructions: string
    // pg date columns, sent as the instant of midnight where EHR runs (2026-10-11T23:00:00.000Z an hour east of UTC).
    startsOn: string | null
    endsOn: string | null
    status: string
  }>
  labRequests: Array<{
    id: string
    encounterId: string
    facilityId: string
    testCodeSystem: string
    testCode: string
    testDisplay: string
    priority: string
    status: string
    specimenTypeCode: string | null
    clinicalInformation: string | null
    externalOrderReference: string | null
    createdAt: string
  }>
  documents: Array<{
    id: string
    encounterId: string | null
    facilityId: string
    fileName: string
    mediaType: string
    sizeBytes: number | string | null
    classification: string
    status: string
    scanStatus?: string
    createdAt: string
  }>
  // As first recorded: shown nowhere, so not typed further.
  vitals?: Array<Record<string, unknown>>
  released?: EmergencySection[]
  withheld?: EmergencySection[]
  limits?: Partial<Record<EmergencySection, number>>
  truncated?: Partial<Record<EmergencySection, boolean>>
  /** 50 since hid-system #52, 100 before: not any one section's cap. */
  limit?: number
}

/**
 * A clinical document as EHR's list returns it (document.service.ts list):
 * size_bytes is selected as text.
 */
export interface DocumentRecord {
  id: string
  patientId: string
  encounterId: string
  fileName: string
  mediaType: string
  sizeBytes: number | string
  status: string
  scanStatus: string
  createdAt: string
}

export interface LabWorkItem {
  id: string
  patientId: string
  version: number
  status: string
  testName?: string
  accessionId?: string | null
  accessionNumber?: string | null
  specimenStatuses?: string[]
  acceptedAt?: string
  /** The request's priority, which Lab sends (routine, urgent, asap, stat). */
  priority?: string | null
  /** Novu since P4c, only on work from an order another facility sent here: the order and its route. */
  orderRoute?: WorkItemOrderRoute
  /** Novu since P4c, only on such work while its route allows reading it: who the patient is. */
  patient?: OrderRoutePatient
}

/**
 * A work list's answer. Novu since P4c also says whether orders between facilities are on (`crossFacilityOrders`) and
 * whether work on accepted ones is (`crossFacilityWork`); an earlier backend sends neither.
 */
export interface WorkList<T> extends ReceivingAnswer {
  items: T[]; crossFacilityOrders?: boolean; crossFacilityWork?: boolean
  /**
   * D17 (hid-system 0090): `true`, for a member holding the kind's receive permission, from a backend that lets this
   * facility withdraw what it recorded on an order that has ended ("Correct an order that has ended"). An earlier backend
   * sends no such field.
   */
  lateCorrection?: boolean
  /**
   * D18 (hid-system 0091): `true`, for a member holding the kind's receive permission, from a backend that lets this
   * facility end an order it accepted and can't complete ("We can't complete this order"). An earlier backend sends no
   * such field.
   */
  cannotComplete?: boolean
}

/**
 * Whether orders of this kind are waiting here (`waiting`: sent here and not yet past their respond-by time, as Incoming
 * lists them) and whether this facility holds any it accepted (`held`: accepted, completed or cancelled, with access not
 * yet ended). Booleans only: no patient, no count, no reference.
 */
export interface RoutesHere { waiting: boolean; held: boolean }

/**
 * What the Lab and Pharmacy work lists and Incoming also say about the working facility, for this service's orders from
 * other facilities. Novu since item 4 (hid-system 0089), only to a member holding the kind's receive permission; an
 * earlier backend sends neither, and either is left out when it could not be read.
 */
export interface ReceivingAnswer {
  /**
   * Whether this facility receives this service's orders from other facilities now (H4, whatever the switches say), so
   * new orders can reach it and be accepted here.
   */
  receives?: boolean
  /** Whether orders already sent here wait, and whether accepted ones are held here, listed or not (owner decision D4). */
  routesHere?: RoutesHere
}

export interface LabSpecimen {
  id: string
  accessionId: string
  specimenIdentifier: string
  specimenType: string
  status: string
  version: number
}

export interface LabAccession {
  id: string
  accessionNumber: string
  workItemId: string
  status: string
  specimens: LabSpecimen[]
}

export type LabAbnormalFlag = 'normal' | 'high' | 'low' | 'abnormal' | 'critical_candidate' | 'unknown'

export interface LabResultRevision {
  version: number
  resultType: 'numeric' | 'text'
  numericValue: number | null
  textValue: string | null
  unit: string | null
  referenceRange: string | null
  abnormalFlag: LabAbnormalFlag
  entrySource: 'manual'
  verificationStatus: 'unverified' | 'verified' | 'entered_in_error'
  releaseStatus: 'not_released' | 'verified_not_released' | 'released'
  enteredAt: string
  /** When this revision was released; null until then. Sent since hid-system #51. */
  releasedAt?: string | null
  correctionReason: string | null
}

export interface LabResult {
  id: string
  executionId: string
  status: 'entered_unverified' | 'verified_not_released' | 'released' | 'entered_in_error'
  verificationStatus: LabResultRevision['verificationStatus']
  currentVersion: number
  currentReleasedVersion: number | null
  revisions: LabResultRevision[]
}

/**
 * GET /api/v1/lab/ehr-orders/:sourceEhrOrderId/released-results (hid-system #51,
 * lab-executions.service.ts listReleasedForEhrOrder): the Lab work item accepted
 * from one EHR lab request and the released view of each of its results, in
 * execution start order. A result keeps only its released revisions, under their
 * stored version numbers, so a gap is a revision never released; a result with
 * none is left out, so an order with nothing released has no results.
 */
export interface LabOrderReleasedResults {
  workItemId: string
  sourceEhrOrderId: string
  sourceEhrOrderVersion: number
  patientId: string
  acceptedAt: string
  test: { codeSystem: string; code: string; name: string }
  results: LabResult[]
}

export interface LabExecution {
  id: string
  accessionId: string
  specimenId: string
  requestedTestId: string
  test: { codeSystem: string; code: string; name: string }
  patientId: string
  facilityId: string
  status: 'in_progress' | 'completed'
  method: string | null
  startedAt: string
  completedAt: string | null
  version: number
  result: LabResult | null
}

export type LabResultValue = {
  resultType: 'numeric'
  numericValue: number
  unit?: string
  referenceRange?: string
  abnormalFlag?: LabAbnormalFlag
} | {
  resultType: 'text'
  textValue: string
  unit?: string
  referenceRange?: string
  abnormalFlag?: LabAbnormalFlag
}

/** A Pharmacy work item as hid-system pharmacy.service.ts projectWorkItem() returns it. */
export interface PharmacyWorkItem {
  id: string
  patientId: string
  version: number
  acceptedAt: string
  medication: { display: string }
  doseQuantity?: number | null
  doseUnit?: string | null
  routeCode?: string | null
  frequency?: string
  instructions?: string | null
  dispensing?: { id: string; reversed: boolean } | null
  /** Novu since P4c, only on work from a prescription another facility sent here. */
  orderRoute?: WorkItemOrderRoute
  patient?: OrderRoutePatient
}

/**
 * Cross-facility orders (Novu, P4c, SPEC-FINAL §10): a clinician sends a lab request or prescription to a laboratory or
 * pharmacy at another facility, confirming in an attestation that names it that the patient agreed. The receiver
 * accepts it with the patient's Health ID or date of birth, works it in its own Lab or Pharmacy, and what it releases
 * or dispenses comes back to the order. Field names and values are the services' (P4c services report §8).
 */
export type OrderRouteKind = 'lab_request' | 'prescription'

/**
 * An order's latest route to another facility, on each row of the EHR's order lists. `effectiveState` is one of
 * sent, accepted, completed, declined, withdrawn, expired or cancelled (a later value is shown as it is); `endedKind`
 * says who or what ended it: since the wrong-patient report (hid-system 0088, item 3) also `wrong_patient`, on a
 * cancelled route (it had been accepted) or a completed one with `endedAt` (something had come back, now withdrawn);
 * since D18 (hid-system 0091) also `receiving_unable`, on a cancelled route: the receiving facility accepted it and could
 * not complete it; `version` is the route's, for its withdrawal.
 */
export interface OrderRouteSummary {
  id: string
  reference: string | null
  kind: OrderRouteKind
  version: number
  effectiveState: string
  receivingFacility: { id: string | null; name: string | null; available: boolean | null }
  createdAt: string | null
  respondBy: string | null
  acceptedAt: string | null
  completedAt: string | null
  endedAt: string | null
  endedKind: string | null
  declineReason: string | null
  acceptLocked: boolean
  resendAllowed: boolean
  /**
   * D17 (hid-system 0090; absent from an earlier backend): the receiving facility's report that it accepted the order for
   * someone who was not the patient, in its window (`late: false`) or after the order had ended (`late: true`), whatever
   * the route's ending; null when there is none. Read only when its type is right (wrongPatientReportOf).
   */
  wrongPatient?: OrderRouteReport | null
  /**
   * D17 (absent from an earlier backend): until when the receiving facility may still withdraw what it recorded on the
   * order (180 days after it accepted it, owner decision D17-2), while it may; null once it can't (reported, or past that
   * date). Read only when its type is right (correctableUntil).
   */
  correctableUntil?: string | null
  /**
   * D18 (hid-system 0091; absent from an earlier EHR): why the receiving facility could not complete an order it
   * accepted, and what it had done, for a route ended `receiving_unable` with no wrong-patient report; null for every
   * other route, and once such a report exists. Read only when its type is right (notCompletedOf).
   */
  notCompleted?: OrderRouteNotCompletedFacts | null
}

/**
 * What the receiving facility said when it ended an order it could not complete (D18, C3/C4's `notCompleted`): its
 * reason code (D18-5's lists), whether a sample was taken there and whether a result was recorded there but never
 * released (both null for a prescription). No value, no patient, no free text.
 */
export interface OrderRouteNotCompletedFacts { reason: string; sampleTaken: boolean | null; resultRecorded: boolean | null }

/** A receiving facility's report that it accepted an order for the wrong person (item 3, and D17's late one). */
export interface OrderRouteReport { reportedAt: string; late: boolean }

/** Who confirmed that the patient agreed, when, and the receiving facility the attestation named. */
export interface OrderRouteAttestationRecord {
  textVersion: string | null
  attestedByName: string | null
  attestedAt: string | null
  receivingFacilityName: string | null
}

/** A result the receiving laboratory released, or marked entered in error, copied back to the order. */
export interface OrderRouteResult {
  resultId: string | null
  resultVersion: number | null
  kind: 'released' | 'entered_in_error' | string | null
  test: { codeSystem: string | null; code: string | null; name: string | null }
  resultType: string | null
  numericValue: string | number | null
  textValue: string | null
  unit: string | null
  referenceRange: string | null
  abnormalFlag: string | null
  revisionKind: string | null
  correctionReason: string | null
  occurredAt: string | null
}

/** A dispensing the receiving pharmacy recorded, or reversed, copied back to the prescription. */
export interface OrderRouteDispensing {
  dispensingId: string | null
  kind: 'dispensed' | 'reversed' | string | null
  medication: { codeSystem: string | null; code: string | null; display: string | null }
  quantityDispensed: string | number | null
  quantityUnit: string | null
  occurredAt: string | null
}

/** One route of an order as the ordering facility reads it: the summary, the attestation and what came back. */
export interface OrderRouteView extends OrderRouteSummary {
  attestation: OrderRouteAttestationRecord
  events: Array<{ type: string | null; side: string | null; occurredAt: string | null; reasonCode: string | null; stateAfter: string | null }>
  results?: OrderRouteResult[]
  dispensings?: OrderRouteDispensing[]
}

/** The current attestation text of a kind, with {patient}, {orderingFacility} and {receivingFacility} to fill. */
export interface OrderRouteAttestation { kind: OrderRouteKind; version: string; text: string }

/** A laboratory or pharmacy at another facility that can receive orders now (the directory, at most 10). */
export interface OrderDestination {
  facilityId: string
  facilityName: string
  organizationName: string | null
  /** The organization's CAC registered office (owner decision Q8). */
  registeredAddress: string | null
  /** Signed itself up and is in its first 30 days after Health ID support's review. */
  newOnHealthId: boolean
}

export interface OrderRouteSent {
  route: OrderRouteSummary
  order: { id: string; status: string; rowVersion: number }
  replayed: boolean
}

/** Who the patient is, once this facility has accepted the order and while it may read it. */
export interface OrderRoutePatient { fullName: string; sex: string | null; dateOfBirth: string | null; healthIdLast4: string | null }

/**
 * An order another facility sent here, waiting to be accepted (Incoming): never the patient, the clinical information,
 * the instructions or the licence number. With orders between facilities off, only the reference, kind, ordering
 * facility and dates come.
 */
export interface IncomingOrderRoute {
  id: string
  reference: string | null
  version: number | null
  effectiveState: string | null
  orderingFacilityName: string | null
  orderer: { name: string | null; licenceBody: string | null; licenceNumber?: string }
  // A lab request.
  test?: { codeSystem: string | null; code: string | null; name: string | null }
  priority?: string | null
  specimenTypeCode?: string | null
  // A prescription.
  medication?: { codeSystem: string | null; code: string | null; display: string | null }
  doseQuantity?: string | number | null
  doseUnit?: string | null
  routeCode?: string | null
  frequency?: string | null
  startsOn?: string | null
  endsOn?: string | null
  prescribedAt?: string | null
  sentAt: string | null
  respondBy: string | null
  acceptLocked: boolean
  /**
   * Wrong tries left before the order locks here: the lower of 5 less the wrong tries that named this order (a Health
   * ID, or a date of birth given with its reference) and 20 less every wrong try. A date of birth alone does not lower
   * the 5 (P4c review).
   */
  attemptsLeft: number | null
}

export interface IncomingOrderRoutes extends ReceivingAnswer {
  items: IncomingOrderRoute[]; crossFacilityOrders: boolean; crossFacilityWork: boolean
}

/** What is shown once an order is accepted: who the patient is, and what the sender wrote. */
export interface OrderRouteAccepted {
  route: { id: string; version: number; effectiveState: string }
  workItemId: string
  patient?: OrderRoutePatient
  clinicalInformation?: string | null
  instructions?: string | null
  orderer: { licenceBody: string | null; licenceNumber: string | null }
  replayed: boolean
}

/** The route of a work item that came from another facility, as the Lab and Pharmacy work lists carry it. */
export interface WorkItemOrderRoute {
  id: string
  reference: string | null
  effectiveState: string
  /** 'work' (may record), 'read' (may only read) or 'none'. */
  access: 'work' | 'read' | 'none' | string
  orderingFacilityName: string | null
  ordererName: string | null
  ordererLicence?: { body: string | null; number: string | null }
  /**
   * The route's version (the wrong-patient report's expectedVersion) and how it ended: null while it is live, else
   * wrong_patient, support, order_changed, entered_in_error, receiving_released or ordering_released, and since D18
   * (hid-system 0091) receiving_unable (this facility could not complete it). Sent only by a backend with the
   * wrong-patient report (hid-system 0088, item 3); without a numeric version a row offers no wrong-patient action.
   */
  version?: number
  endedKind?: string | null
}

export type OrderRouteDeclineReason = 'test_not_offered' | 'medicine_unavailable' | 'cannot_meet_priority' | 'patient_not_seen' | 'other'
export type OrderRouteWithdrawReason = 'sent_in_error' | 'patient_request' | 'other'
/** What happened, as the receiving laboratory or pharmacy reports an order it accepted for the wrong person (item 3, D6). */
export type OrderRouteWrongPatientReason = 'wrong_order_chosen' | 'someone_elses_details' | 'suspected_misuse' | 'other'

/**
 * The answer to a wrong-patient report (item 3, C25): the route as it ended (`cancelled` when it had been accepted,
 * `completed` when something had gone back), and what was withdrawn: Lab's result versions invalidated and those that had
 * come back to the ordering facility, now reported entered in error; whether a dispensing was reversed. A replay (the same
 * key and report) answers the route as it is now and the counts of the first report.
 */
export interface OrderRouteWrongPatientEnded {
  route: { id: string; version: number; effectiveState: string; endedKind: string | null }
  resultsVoided: number
  resultReportsMarked: number
  dispensingReversed: boolean
  replayed: boolean
}

/** Why a receiving laboratory can't complete a lab request it accepted (D18-5, SPEC-FINAL §4.3). */
export type LabCannotCompleteReason = 'test_not_offered' | 'supplies_unavailable' | 'equipment_unavailable' | 'sample_unusable'
  | 'sample_not_obtained' | 'cannot_meet_priority' | 'patient_declined' | 'patient_did_not_return' | 'other'
/** Why a receiving pharmacy can't complete a prescription it accepted (D18-5). Shared codes have their own words by kind. */
export type PharmacyCannotCompleteReason = 'out_of_stock' | 'medicine_unavailable' | 'needs_prescriber_review'
  | 'controlled_requirements' | 'cannot_meet_priority' | 'patient_declined' | 'patient_did_not_return' | 'other'
export type OrderRouteCannotCompleteReason = LabCannotCompleteReason | PharmacyCannotCompleteReason

/**
 * The answer to "We can't complete this order" (D18, C31): the route as the ending left it (`cancelled`,
 * `receiving_unable`; a replay: as it is now), the reason given (a replay: the first ending's), until when this facility
 * may still read it (`readUntil`: the ending's moment when its reads ended at once, else 7 days later) and what it had
 * recorded (Lab; 0 for a prescription). Never the patient or anything clinical.
 */
export interface OrderRouteNotCompleted {
  route: { id: string; version: number; effectiveState: string; endedKind: string | null }
  reason: string
  readUntil: string | null
  specimensCollected: number
  resultsRecorded: number
  criticalCandidates: number
  replayed: boolean
}

/** How the receiving facility found out that it accepted an order for the wrong person (D17, CL11). */
export type OrderRouteDiscoveredBy = 'patient' | 'ordering_facility' | 'own_check' | 'support' | 'other'

/**
 * The receiving facility's own facts about an order it accepted, shown while it may still act on it (D17-8): the test or
 * medicine, who here accepted it and how identity was checked, and what went back to the ordering facility and when (Lab:
 * each result version released; Pharmacy: the dispensing), with whether it has been withdrawn. Never the patient.
 */
export interface CorrectableOrderRouteDetails {
  what: string | null
  acceptedBy: string | null
  acceptedWith: 'health_id' | 'date_of_birth_with_reference' | 'date_of_birth' | string | null
  returned: Array<{ at: string; withdrawn: boolean }>
}

/**
 * An order this facility accepted, found by its exact reference (D17, C30: `POST /{service}/order-routes/correctable`):
 * what may be done about it now (`correction`: `open`, still in item 3's window; `correctable`, ended or lapsed and before
 * `correctableUntil`; `reported`; `too_late`), how it ended, and, while it is open or correctable, `details`. No patient,
 * orderer, work item or value.
 */
export interface CorrectableOrderRoute {
  id: string
  reference: string | null
  kind: OrderRouteKind
  version: number
  effectiveState: string
  orderingFacilityName: string | null
  acceptedAt: string | null
  completedAt: string | null
  endedAt: string | null
  endedKind: string | null
  /** Something went back to the ordering facility (`completedAt` is set), whatever is left of it. */
  returned: boolean
  correction: 'open' | 'correctable' | 'reported' | 'too_late' | string
  correctableUntil: string | null
  wrongPatient: OrderRouteReport | null
  details: CorrectableOrderRouteDetails | null
}

/** The lookup's answer: at most 5 orders, newest acceptance first; `items: []` when none was accepted here. */
export interface CorrectableOrderRoutes { items: CorrectableOrderRoute[]; lateCorrection?: boolean }

/**
 * The answer to a late withdrawal (D17, C29): the route as it is now (`cancelled` or `completed`; an order whose time had
 * only run out now ends `wrong_patient`, one that had ended another way keeps that ending), the ending before
 * (`endedKindBefore`), and what was withdrawn. A replay (the same key and request) answers the first report's counts.
 */
export interface OrderRouteWrongPatientCorrected {
  route: { id: string; version: number; effectiveState: string; endedKind: string | null }
  late: boolean
  endedKindBefore: string | null
  resultsVoided: number
  resultReportsMarked: number
  dispensingReversed: boolean
  correctableUntil: string | null
  replayed: boolean
}

/**
 * One route as the receiving facility reads it (C8, `GET /{service}/order-routes/:routeId`): the Incoming shape, and after
 * acceptance, while the route allows a read, what the sender wrote, the licence number, the patient and the work item.
 */
export interface ReceivedOrderRoute extends IncomingOrderRoute {
  clinicalInformation?: string | null
  instructions?: string | null
  patient?: OrderRoutePatient
  workItemId?: string
}

/**
 * An order sent from the working facility that the receiving laboratory or pharmacy ended as accepted for someone who was
 * not its patient, in the last 30 days (item 3, D10, C28). Only the member who sent it gets it in full, whether or not
 * they may still open the patient's record; `link` is the order's place in the clinical record.
 */
export interface SentWrongPatientOrderRoute {
  routeId: string
  reference: string | null
  kind: OrderRouteKind
  receivingFacility: { id: string | null; name: string | null }
  patient: { name: string | null }
  endedAt: string | null
  /** Result versions that had come back here and are now reported entered in error (0 for a prescription). */
  resultsWithdrawn: number
  dispensingReversed: boolean
  link: { patientId: string; encounterId: string; kind: OrderRouteKind; orderId: string } | null
  /**
   * D17 (hid-system 0090; absent from an earlier backend): when the receiving facility reported it, whether it did so
   * after the order had ended (`late`), and how the order had ended before (`endedKindBefore`, null when it had not).
   * The list then covers reports of the last 30 days whatever the order's ending; a late report on an order that had ended
   * another way keeps that ending in `endedAt`.
   */
  reportedAt?: string
  late?: boolean
  endedKindBefore?: string | null
}

/**
 * The ordering facility's Overview read (C28): every such order the member sent, in full, and every one a colleague sent
 * as a count and its references, never a patient's name (a member's own order is never among them). A member without ehr.order-route.send, or a facility with no
 * such order, gets `{ windowDays: 30, items: [], others: { count: 0, references: [] } }`.
 */
export interface SentWrongPatientOrderRoutes {
  windowDays: number
  items: SentWrongPatientOrderRoute[]
  others: { count: number; references: string[] }
  /** D17: `true` from a backend that serves the late correction (CT3); an earlier one sends no such field. */
  lateCorrection?: boolean
}

export interface OcrJob {
  id: string
  documentId: string
  patientId?: string | null
  status: string
  provider: string
  attemptCount?: number
  maxAttempts?: number
  version: number
  patientConfirmation?: { id: string; patientId: string; version: number; method: string; confirmedAt: string } | null
  lastErrorCode?: string | null
}

export type OcrTargetDomain = 'EHR' | 'LAB' | 'PHARMACY' | 'DOCUMENT_ONLY' | 'UNCLASSIFIED'
export type OcrCandidateType = 'clinical_note' | 'lab_document' | 'historical_medication_evidence' | 'document_only' | 'unclassified'
export interface OcrExtraction {
  id: string
  version: number
  provider: string
  rawText?: string | null
  structuredPayload?: unknown
  confidence?: number | null
}
export interface OcrValidation {
  id: string
  jobId: string
  extractionId: string
  version: number
  disposition: 'validated' | 'rejected'
  targetDomain: OcrTargetDomain
  candidateType: OcrCandidateType
  acceptedFields: Record<string, unknown>
  rejectedFields: Record<string, unknown>[]
  corrections: Record<string, unknown>[]
  reason: string
  reviewedAt: string
}
export interface OcrPublication {
  id: string
  validationId: string
  validationVersion: number
  status: 'pending' | 'processing' | 'published' | 'failed'
  targetDomain: OcrTargetDomain
  targetOperation: string
  targetResourceType?: string | null
  targetResourceId?: string | null
  failureCode?: string | null
  failureSummary?: string | null
  attemptCount?: number
  maxAttempts?: number
}
/** Lab evidence imported from a document (GET /api/v1/lab/imports/:importId), such as an OCR publication made. */
export interface LabImport {
  id: string
  /** accepted, entered_in_error or amended (hid-system lab migration 0017). */
  status: string
  externalLabName?: string | null
  reportedAt?: string | null
  observations: Array<{
    id: string
    ordinal: number
    testCode?: string | null
    testName: string
    value?: string | null
    valueText?: string | null
    unit?: string | null
    referenceRange?: string | null
    abnormalFlag?: string | null
    status?: string
  }>
}
/** Historical medication evidence imported from a document (GET /api/v1/pharmacy/imports/:importId). */
export interface PharmacyImport {
  id: string
  medicationText: string
  strengthText?: string | null
  doseText?: string | null
  frequencyText?: string | null
  historicalContext?: string | null
}
export interface OcrValidationInput {
  extractionId: string
  validatedPayload: Record<string, unknown>
  disposition: 'validated' | 'rejected'
  targetDomain: OcrTargetDomain
  candidateType: OcrCandidateType
  acceptedFields: Record<string, unknown>
  rejectedFields: Record<string, unknown>[]
  corrections: Record<string, unknown>[]
  reason: string
}

export interface OutreachCampaign {
  id: string
  name: string
  status: string
  services: string[]
  startsAt: string
  rowVersion: number
}

export interface OutreachCase {
  id: string
  campaignId?: string
  status: string
  createdAt?: string
  fullName?: string
  temporaryPatientId?: string
  ageYears?: number
  sex?: string
  rowVersion: number
}

export interface OutreachCampaignMember {
  id: string
  campaignId: string
  membershipId: string
  role: 'enumerator' | 'health_worker' | 'admin'
  createdAt: string
}

const transport = createApiClient({
  baseUrl: getEnvironment().apiBaseUrl,
  clientId: 'staff-web',
  sessionMode: 'cookie',
  refreshSession: async () => {
    const sentIn = staffSessionGeneration()
    reportStaffSessionRead(await restoreStaffSession(), sentIn)
  },
})

/** A signal aborted when either one is. */
function eitherAborted(first: AbortSignal | undefined, second: AbortSignal): AbortSignal {
  if (!first) return second
  if (first.aborted || second.aborted) return AbortSignal.abort()
  const both = new AbortController()
  const abort = () => both.abort()
  first.addEventListener('abort', abort, { once: true })
  second.addEventListener('abort', abort, { once: true })
  return both.signal
}

/**
 * Ties each staff request to the session it was sent in. A protected request
 * still refused with 401 after the client's refresh is reported, naming that
 * session; the provider then asks the server whether it really ended. Sign-in
 * and the session, refresh, sign-out and facility calls under /api/v1/auth/ are
 * left to their callers, which know what a 401 there means.
 */
function reportingSessionEnd(inner: ApiClient): ApiClient {
  const outer: ApiClient = {
    baseUrl: inner.baseUrl,
    async request<T>(spec: RequestSpec): Promise<T> {
      const sentIn = staffSessionGeneration()
      const protectedCall = spec.auth !== 'none' && !spec.path.startsWith('/api/v1/auth/')
      // A protected request goes out only while its session is ready: one made while
      // the session is being checked, could not be confirmed, or the page is away
      // waits, and is never sent if that session ends. Readiness is read again, as
      // it leaves, after every wait. Calls under /api/v1/auth/ are what settles it.
      if (protectedCall) while (!staffSessionReadyFor(sentIn)) await nextStaffSessionChange()
      const own: RequestSpec = {
        ...spec,
        // A request whose session has since ended, or sent while none is in use (the
        // session-ended screen), is never restored and repeated: by the time its 401
        // arrives the browser may hold the next person's session.
        refreshOnUnauthorized: error => staffSessionGeneration() === sentIn && staffSessionActor() !== null
          && (spec.refreshOnUnauthorized?.(error) ?? true),
        // It is also cancelled when its session ends, so the next session's identical
        // read never joins it. Calls under /api/v1/auth/ run to completion: an
        // abandoned refresh could leave the browser holding a used refresh token.
        ...(protectedCall ? {
          signal: eitherAborted(spec.signal, staffSessionSignal()),
          // The HTTP client sends some requests again on its own: a read after a
          // backoff, and any request after a refresh. Each attempt waits for its
          // session again as it leaves, so none goes out while the session is
          // being checked, could not be confirmed, or the page is away; nor for a
          // facility found gone meanwhile (see setStaffSessionFacilities).
          beforeAttempt: async () => {
            await spec.beforeAttempt?.(); await untilStaffSessionReady(sentIn)
            assertStaffSessionFacility(spec.headers)
          },
        } : {}),
      }
      try { return await inner.request<T>(own) }
      catch (error) {
        // Heard on any call, a refresh or session read included: the provider says why once it finds the session ended.
        noteStaffSessionRefusal(error, sentIn)
        // A 403 is reported only when it says the session is a patient's, or one without an
        // authenticator (endsStaffSession); the server is then asked.
        if (protectedCall && (endsStaffSession(error) || refusedAsPatient(error))) reportStaffSessionEnded(sentIn)
        throw error
      }
    },
    get: (path, spec) => outer.request({ ...spec, method: 'GET', path }),
    post: (path, body, spec) => outer.request({ ...spec, method: 'POST', path, body }),
  }
  return outer
}

const client = createRegisteredBrowserClient(reportingSessionEnd(transport), 'staff-web')

let refreshing: Promise<StaffSession> | null = null

/**
 * Restores the session once for every caller waiting on it: two refreshes sent
 * together with the same cookie would make the server end the whole session.
 * The portal's other windows take turns with this one (refreshInTurn); one that
 * waited for another first reads the session, which that window has usually
 * restored already. Without the refresh cookie (dropped by the browser at the
 * idle or absolute limit, or cleared by a sign-out elsewhere) the server answers
 * 403 CSRF_VALIDATION_FAILED; with a patient's sign-in in the cookies, which
 * this portal never rotates, 403 SESSION_CLIENT_MISMATCH; for a sign-in made
 * without an authenticator, 403 STAFF_MFA_REQUIRED, having ended it and cleared
 * the cookies (hid-system #71). Nothing can restore the session then, so it is
 * reported as the ended session it is.
 */
function refreshStaffSession(): Promise<StaffSession> {
  refreshing ??= refreshInTurn(
    () => client.get<StaffSession>('/api/v1/auth/session', { auth: 'optional', dedupe: false })
      .then(session => typeof session?.actor?.id === 'string' ? session : null, () => null),
    () => client.post<StaffSession>('/api/v1/auth/refresh'))
    .catch((error: unknown) => {
      if (isHidApiError(error) && error.status === 403 && error.code === 'CSRF_VALIDATION_FAILED') throw sessionEnded(error)
      if (heldByOtherPortal(error) || staffMfaRequired(error)) throw sessionEnded(error)
      throw error
    })
    .finally(() => { refreshing = null })
  return refreshing
}

function sessionEnded(cause?: HidApiError): HidApiError {
  return new HidApiError(401, 'Your session has ended. Sign in again to continue.',
    { code: 'AUTHENTICATION_REQUIRED', requestId: cause?.requestId, retryable: false, cause })
}

/** Whether `session` is a staff session of `actorId`. An answer without an actor is no one's. */
function isSessionOf(session: StaffSession | null | undefined, actorId: string): boolean {
  const actor = session?.actor
  return typeof actor?.id === 'string' && actor.kind !== 'patient' && actor.id === actorId
}

/**
 * Restores this tab's session after a 401. A refresh that answers for another
 * account (signed in from another tab, staff or patient) has not restored it: it
 * counts as the 401 of an ended session, so nothing is repeated as that account.
 * A sign-out names the account it started for, which outlives the workspace.
 */
async function restoreStaffSession(actorId = staffSessionActor()): Promise<StaffSession> {
  const restored = await refreshStaffSession()
  if (actorId !== null && !isSessionOf(restored, actorId)) throw sessionEnded()
  return restored
}

/**
 * Runs a call under /api/v1/auth/ that the client does not refresh for. A 401
 * there may only mean the 15-minute access token expired, so the session is
 * restored once and the call repeated. A call from a session that has since
 * ended is never repeated: the cookies the browser holds now belong to the next one.
 */
async function withRestoredSession<T>(call: () => Promise<T>): Promise<T> {
  const sentIn = staffSessionGeneration()
  try { return await call() }
  catch (error) {
    if (!endsStaffSession(error) || staffSessionGeneration() !== sentIn) throw error
    await restoreStaffSession()
    if (staffSessionGeneration() !== sentIn) throw error
    return call()
  }
}

/** How many times sign-out restores the session before it reports that it could not finish. */
const SIGN_OUT_ATTEMPTS = 3

/**
 * The sign-out in progress, if any. Signing in waits for it, and for a refresh
 * still in flight: either answer can clear the browser's session cookies, which
 * by then could be the new session's.
 */
let leaving: Promise<unknown> = Promise.resolve()

/**
 * Sends a sign-in step whose answer sets the session cookies (the password step
 * of an Identity before hid-system #71, verify and enrolment activation) once a
 * sign-out in progress and a refresh in flight have answered, and in the
 * session turn, so no other window's refresh answers after it: each of those
 * answers can clear or replace the new session's cookies.
 */
async function settingSession<T>(step: () => Promise<T>): Promise<T> {
  await Promise.all([leaving, refreshing?.catch(() => undefined)])
  return inRefreshTurn(step)
}

function signOut(confirmFirst = false): Promise<void> {
  const signingOut = signOutStaffSession(confirmFirst)
  leaving = signingOut.catch(() => undefined)
  return signingOut
}

/**
 * Ends the session on the server. It resolves only once no session remains:
 * the server confirmed the sign-out, or refused to restore the session at all.
 * A 401 after a refresh the server accepted proves nothing (another refresh in
 * this tab may have rotated the session meanwhile), so the session is restored
 * and the sign-out sent again. A sign-out from a session that has since ended
 * does nothing, so it can never end the next one, and neither does one whose
 * restore finds another account's session in the browser, or one Identity
 * refuses because the browser holds a patient's sign-in: this session is
 * already gone from it.
 */
async function signOutStaffSession(confirmFirst: boolean): Promise<void> {
  const sentIn = staffSessionGeneration()
  // The account this sign-out is for, named now: leaving the workspace clears it.
  const actorId = staffSessionActor()
  // From a workspace locked while its session is checked, the browser may already
  // hold another account's session (signed in from another tab): logout ends
  // whichever session the cookies carry. The server is asked first. A browser
  // that no longer holds this session has nothing of it to end; one the server
  // cannot answer for is not signed out blindly.
  if (confirmFirst) {
    if (actorId === null) return
    const found = await checkStaffSession(actorId, sentIn)
    if (staffSessionGeneration() !== sentIn || found === 'ended') return
    if (found === 'unknown') throw new Error('Sign-out could not be completed. Try again.')
  }
  for (let attempt = 1; ; attempt += 1) {
    try { await signOutInTurn(() => stillThisAccount(actorId), () => client.post<null>('/api/v1/auth/logout')); return }
    catch (error) {
      // The browser holds a patient's sign-in now, which Identity neither ended nor
      // changed: this session has already left it.
      if (heldByOtherPortal(error)) return
      if (!endsStaffSession(error)) throw error
    }
    if (staffSessionGeneration() !== sentIn) return
    if (attempt === SIGN_OUT_ATTEMPTS) throw new Error('Sign-out could not be completed. Try again.')
    try { await restoreStaffSession(actorId) }
    catch (refused) { if (endsStaffSession(refused)) return; throw refused }
    if (staffSessionGeneration() !== sentIn) return
  }
}

/**
 * Whether the browser still holds this account's session. A refused question
 * (a 401 also comes from a server that could not check) is thrown, and handled
 * as a refused sign-out: the session is restored, and its account confirmed,
 * before the sign-out is sent again.
 */
async function stillThisAccount(actorId: string | null): Promise<boolean> {
  const session = await client.get<StaffSession | null>('/api/v1/auth/session', { auth: 'optional', dedupe: false })
  return actorId !== null && isSessionOf(session, actorId)
}

/**
 * What the server says about a session after one of its requests was refused:
 * it has ended, it is still accepted, or the server could not say.
 */
export type StaffSessionCheck = 'ended' | 'alive' | 'unknown'

/**
 * Whether the session `actorId` held in generation `sentIn` has really ended,
 * after a request found it refused. The server is asked directly, restoring the
 * session once if only the access token expired. Cookies that now belong to
 * another account (signed in from another tab, staff or patient) end this one.
 * A question the server could not answer, or an answer without an account,
 * confirms nothing. Once the generation has changed the answer no longer
 * matters, and the session is never restored with cookies that may belong to
 * the next one.
 */
async function checkStaffSession(actorId: string, sentIn: number): Promise<StaffSessionCheck> {
  let session: StaffSession
  // A read of its own: one already in flight may have reached the server before the refusal.
  try { session = await client.get<StaffSession>('/api/v1/auth/session', { auth: 'optional', dedupe: false }) }
  catch (error) {
    if (!endsStaffSession(error) || staffSessionGeneration() !== sentIn) return 'unknown'
    try { session = await refreshStaffSession() }
    catch (refused) { return endsStaffSession(refused) ? 'ended' : 'unknown' }
  }
  if (typeof session?.actor?.id !== 'string') return 'unknown'
  if (!isSessionOf(session, actorId)) return 'ended'
  reportStaffSessionRead(session, sentIn)
  return 'alive'
}

function facilityHeaders(facilityId: string, purpose: 'direct-care' | 'emergency' | 'healthcare-operations' = 'direct-care') {
  return { 'X-Facility-ID': facilityId, 'X-Purpose-Of-Use': purpose }
}

function keyHeaders(key?: string) { return { 'Idempotency-Key': key ?? crypto.randomUUID() } }

function patientPath(patientId: string) {
  return `/api/v1/ehr/patients/${encodeURIComponent(patientId)}/encounters`
}

function encounterPath(patientId: string, encounterId: string) {
  return `${patientPath(patientId)}/${encodeURIComponent(encounterId)}`
}

/**
 * The start's answer. hid-system main always sends a code and answers `{ accepted, challengeId, expiresInSeconds,
 * resendAfterSeconds }`. Novu (P4 round 2, R14) also says whether this start sent a new code: with `codeSent` false
 * no email went out (a code was sent less than a minute ago, or the sign-up or its email has had as many codes as
 * Identity sends for now); `challengeId` and `expiresInSeconds` then name the code still in force, and are absent
 * when no code can still be entered; `resendAfterSeconds` is the real wait before a new code, up to about a day.
 */
export interface ProviderEnrollmentStart {
  accepted: true
  codeSent?: boolean
  challengeId?: string
  expiresInSeconds?: number
  resendAfterSeconds?: number
}

/**
 * Whether facility self sign-up is open (Novu, P4). `reason` says why not: 'closed' (switched off or not
 * configured) or 'unavailable' (Identity could not tell, because of a fault: try again shortly). Identity before
 * round 2 answered `{ open: false }` alone, which meant closed.
 */
export interface ProviderEnrollmentAvailability {
  open: boolean
  reason?: string
  /** Novu since P4c, on the open answer: whether orders between facilities are on. */
  crossFacilityOrders?: boolean
}

/**
 * Activation sets the administrator's password. On Novu (novu-v1, the
 * production backend; facility self sign-up, P4) it then signs the
 * administrator in, as a staff sign-in does: the session cookies, and the
 * session's `actor` in the answer (owner decision: a password, no
 * authenticator). On hid-system main since #71 it opens a staff MFA enrolment
 * instead, whose proof is the activation itself (`status`
 * 'mfa_enrollment_required', or 'mfa_required' for an account that already
 * has an authenticator), with the challenge cookie and no session.
 */
export interface ProviderEnrollmentActivation {
  activated: true
  organizationId: string
  facilityId: string
  accountId: string
  status?: StaffLoginChallenge['status']
  actor?: StaffSession['actor']
  expiresAt: string
}

/** Verify's answer; it also sets the enrollment cookie that …/profile and activation read. */
export interface ProviderEnrollmentVerified {
  verified: true
}

/**
 * GET …/provider-enrollments/profile (Novu, P4 round 2, R13): what a confirmed sign-up will register, read before
 * the account exists. `organizationName` is the verified legal name on the CAC record, which the organization and
 * the facility take; `registrationNumber` is the CAC number as the applicant entered it (spaces removed, capitals);
 * the administrator's name and email and the organization type are the ones the account will keep (those sent
 * with the code that was confirmed). Read with the enrollment cookie; it changes nothing.
 */
export interface ProviderEnrollmentProfile {
  organizationName: string
  registrationNumber: string
  productCode: string
  organizationType: string
  administratorName: string
  administratorEmail: string
}

/**
 * How long the browser waits for a start. The start checks the security token
 * with Cloudflare (up to two tries), then looks the CAC up with QoreID (a token
 * and a lookup, each up to 5 s), then sends the email code: more than the
 * client's usual 15 s at worst. The production gateway gives up at 30 s and
 * answers 503 UPSTREAM_UNAVAILABLE, so this only bounds a hung connection.
 */
export const PROVIDER_ENROLLMENT_START_TIMEOUT_MS = 35_000

export const providerEnrollmentApi = {
  /**
   * Whether facility self sign-up is open (Novu, P4): `{ open }`, with a `reason` when it is not, never an error
   * from Identity. hid-system main has no such route (404). Asked with no retries: the page shows the form unless
   * the answer is a clear no.
   */
  availability: (signal?: AbortSignal) => client.get<ProviderEnrollmentAvailability>(
    '/api/v1/identity/provider-enrollments/availability',
    { auth: 'none', retry: NO_RETRY, timeoutMs: 10_000, ...(signal ? { signal } : {}) }),

  start: (input: {
    productCode: 'ehr' | 'migrate' | 'laboratory' | 'pharmacy'
    organizationType: 'clinic' | 'hospital' | 'laboratory' | 'pharmacy' | 'other'
    cacRegistrationNumber: string
    administratorName: string
    administratorEmail: string
    turnstileToken: string
  }) => client.post<ProviderEnrollmentStart>('/api/v1/identity/provider-enrollments',
    { ...input, turnstileAction: 'provider-enrollment' }, { auth: 'none', timeoutMs: PROVIDER_ENROLLMENT_START_TIMEOUT_MS }),

  // The challenge travels only in the body. The portal reaches the API on its
  // own host (the Worker proxies /api/v1/*), and no enrollment-specific header
  // is needed: verify sets the enrollment cookie, which activation reads.
  verify: (challengeId: string, code: string) =>
    client.post<ProviderEnrollmentVerified>('/api/v1/identity/provider-enrollments/verify',
      { challengeId, code }, { auth: 'none' }),

  /**
   * What the sign-up registers (Novu, P4 round 2), read with the enrollment
   * cookie once the email is confirmed, so the administrator sees whose CAC
   * number it is before any account is made. A same-origin GET: the browser
   * sends the cookie and no Origin, which Identity does not ask for here.
   * hid-system main, and an Identity without the route, answer 404: the page
   * then shows the CAC number alone. Asked with no retries.
   */
  profile: () => client.get<ProviderEnrollmentProfile>('/api/v1/identity/provider-enrollments/profile',
    { auth: 'none', retry: NO_RETRY, timeoutMs: 10_000 }),

  // Activation can sign the new administrator in (Novu), so it takes the session turn as sign-ins do.
  activate: (password: string) => inRefreshTurn(() =>
    client.post<ProviderEnrollmentActivation>('/api/v1/identity/provider-enrollments/activate',
      { password }, { auth: 'none' })),

  /**
   * "This isn't my organization" (Novu, P4b): closes the applicant's own confirmed sign-up, read from the enrollment
   * cookie, ends its codes and frees its CAC number, with no 7-day refusal. No body. 200 { withdrawn: true }, or 401
   * ORGANIZATION_COMPLETION_SESSION_INVALID once the session has gone; hid-system main and an Identity before P4b answer
   * 404. Sent once: a lost answer is not repeated.
   */
  withdraw: () => client.post<{ withdrawn: true }>('/api/v1/identity/provider-enrollments/withdraw', undefined,
    { auth: 'none', retry: NO_RETRY }),
}

/** What an invitation email's delivery came to: sent, refused by the address, or not confirmed (P4b). */
export type StaffDeliveryOutcome = 'accepted' | 'definitive_failure' | 'unknown' | 'pending'

/** A member of a self-signed-up facility (GET …/facility-staff, P4b): licence numbers come as their last 4 characters. */
export interface FacilityStaffMember {
  membershipId: string
  version: number
  accountId: string
  name: string
  email: string
  roles: string[]
  isAdministrator: boolean
  isSelf: boolean
  joinedAt: string | null
  licence: { body: string; numberHint: string | null; vouchedBy: string | null; vouchedAt: string | null; method: string | null } | null
}

/** An invitation of a self-signed-up facility: the waiting ones, and the last 30 days' others (P4b). */
export interface FacilityStaffInvitation {
  invitationId: string
  version: number
  reference: string
  name: string
  email: string
  roleCode: string
  licence: { body: string; numberHint: string | null } | null
  status: 'pending' | 'accepted' | 'revoked' | 'expired' | string
  invitedBy: string | null
  createdAt: string | null
  lastSentAt: string | null
  expiresAt: string | null
  sendCount: number
  deliveryOutcome: StaffDeliveryOutcome | string
  resendAvailableAt: string | null
}

/** The Staff page's one read (P4b SPEC 6.3). */
export interface FacilityStaff {
  facility: {
    id: string
    name: string
    organizationType: string
    reviewState: 'pending' | 'reviewed' | string
    firstThirtyDaysEndAt: string | null
    invitationsOpen: boolean
    deliveryPaused: boolean
  }
  canInvite: boolean
  limits: { pendingInvitations: number; pendingLimit: number; invitationsToday: number; invitationsPerDay: number
    emailsToday: number; emailsPerDay: number }
  inviteOptions: { roles: Array<{ code: string; licenceBody: string | null }>; attestation: { version: string; text: string | null } | null }
  administratorLicence: { body: string; numberHint: string | null; recordedAt: string | null } | null
  administratorLicenceBodies: string[]
  members: FacilityStaffMember[]
  invitations: FacilityStaffInvitation[]
}

/** A role, with its licence (none for a receptionist), as an invitation or a role change sends it. */
export interface StaffRoleChoice {
  role: string
  licenceBody?: string
  licenceNumber?: string
}

export interface StaffInvitationCreated { invitationId: string; version: number; expiresAt: string | null
  deliveryOutcome: StaffDeliveryOutcome | string; replayed: boolean }

/**
 * A self-signed-up facility's own staff (P4b, Novu only): the administrator's Staff page. Every call names the working
 * facility (X-Facility-ID, healthcare operations) and needs workforce.manage there. Invite, remove and change role
 * carry the administrator's password, which Identity checks as a sign-in does; it is never kept here.
 */
export const facilityStaffApi = {
  read: (facilityId: string) => client.get<FacilityStaff>('/api/v1/identity/facility-staff',
    { headers: facilityHeaders(facilityId, 'healthcare-operations'), dedupe: false }),
  /** The pending administrator's own licence, which support checks at review. */
  recordAdministratorLicence: (facilityId: string, licenceBody: string, licenceNumber: string) =>
    client.post<{ licenceBody: string; numberHint: string | null; recordedAt: string | null }>(
      '/api/v1/identity/facility-staff/administrator-licence', { licenceBody, licenceNumber },
      { headers: facilityHeaders(facilityId, 'healthcare-operations') }),
  /** One Idempotency-Key per invitation form, kept for its retries: the same key and request replay, sending nothing. */
  invite: (facilityId: string, input: StaffRoleChoice & { name: string; email: string; currentPassword: string },
    idempotencyKey: string) => client.post<StaffInvitationCreated>('/api/v1/identity/staff-invitations',
    { name: input.name, email: input.email, role: input.role, ...licenceFields(input), attested: true,
      currentPassword: input.currentPassword },
    { headers: { ...facilityHeaders(facilityId, 'healthcare-operations'), ...keyHeaders(idempotencyKey) } }),
  resend: (facilityId: string, invitation: Pick<FacilityStaffInvitation, 'invitationId' | 'version'>) =>
    client.post<{ version: number; expiresAt: string | null; deliveryOutcome: StaffDeliveryOutcome | string }>(
      `/api/v1/identity/staff-invitations/${encodeURIComponent(invitation.invitationId)}/resend`,
      { expectedVersion: invitation.version }, { headers: facilityHeaders(facilityId, 'healthcare-operations') }),
  revoke: (facilityId: string, invitation: Pick<FacilityStaffInvitation, 'invitationId' | 'version'>) =>
    client.post<{ version: number; revokedAt: string | null }>(
      `/api/v1/identity/staff-invitations/${encodeURIComponent(invitation.invitationId)}/revoke`,
      { expectedVersion: invitation.version }, { headers: facilityHeaders(facilityId, 'healthcare-operations') }),
  end: (facilityId: string, member: Pick<FacilityStaffMember, 'membershipId' | 'version'>, reason: string, currentPassword: string) =>
    client.post<{ version: number; endedAt: string | null; grantsRevoked: number }>(
      `/api/v1/identity/facility-staff/${encodeURIComponent(member.membershipId)}/end`,
      { expectedVersion: member.version, reason, currentPassword },
      { headers: facilityHeaders(facilityId, 'healthcare-operations') }),
  changeRole: (facilityId: string, member: Pick<FacilityStaffMember, 'membershipId' | 'version'>,
    input: StaffRoleChoice & { reason: string; currentPassword: string }) =>
    client.post<{ version: number; roleCode: string }>(
      `/api/v1/identity/facility-staff/${encodeURIComponent(member.membershipId)}/role`,
      { expectedVersion: member.version, role: input.role, ...licenceFields(input), attested: true, reason: input.reason,
        currentPassword: input.currentPassword },
      { headers: facilityHeaders(facilityId, 'healthcare-operations') }),
}

/** The licence fields of a role: both, or none for a receptionist (Identity refuses a licence there). */
function licenceFields(choice: StaffRoleChoice): { licenceBody?: string; licenceNumber?: string } {
  return choice.licenceBody && choice.licenceNumber ? { licenceBody: choice.licenceBody, licenceNumber: choice.licenceNumber } : {}
}

/** How an invitation is proved: the email link's id and token, or the email address and the 6-digit code it gave. */
export type StaffInvitationProof = { invitationId: string; token: string } | { email: string; code: string }

/**
 * Who the invited email belongs to, as Identity found it once the invitation was proved (P4b SPEC 4.7): 'new' and
 * 'dormant_staff' set a password here; 'existing_staff' accepts signed in on their own site; the others cannot accept.
 */
export type StaffInvitationAccountCase = 'new' | 'dormant_staff' | 'existing_staff' | 'already_member' | 'patient_account'
  | 'unavailable'

export interface StaffInvitationOpened {
  invitationId: string
  facilityName: string
  roleCode: string
  inviterName: string | null
  inviteeName: string
  email: string
  expiresAt: string | null
  accountCase: StaffInvitationAccountCase | string
  linkRequired: boolean
}

export interface StaffInvitationPreview {
  invitationId: string
  facilityId: string
  facilityName: string
  roleCode: string
  inviterName: string | null
  expiresAt: string | null
}

/**
 * Joining a facility by invitation (P4b, Novu only). Open and accept are public, on the main site, with no session:
 * open proves the invitation (Turnstile action staff-invitation) and, for a new or dormant account, sets the
 * invitation cookie that accept reads; accept sets the password and issues no session. Existing staff preview and
 * accept signed in on their own site, with no facility named.
 */
export const staffInvitationApi = {
  open: (proof: StaffInvitationProof, turnstileToken: string) =>
    client.post<StaffInvitationOpened>('/api/v1/identity/staff-invitations/open',
      { ...proof, turnstileToken, turnstileAction: 'staff-invitation' }, { auth: 'none', retry: NO_RETRY }),
  accept: (password: string) => client.post<{ accepted: true; facilityName: string; roleCode: string }>(
    '/api/v1/identity/staff-invitations/accept', { password }, { auth: 'none', retry: NO_RETRY }),
  /** The email is the session's own, so a typed proof is the code alone. */
  previewSignedIn: (proof: { invitationId: string; token: string } | { code: string }) =>
    client.post<StaffInvitationPreview>('/api/v1/identity/staff-invitations/signed-in/preview', proof),
  acceptSignedIn: (proof: { invitationId: string; token: string } | { code: string }) =>
    client.post<{ accepted: true; facilityId: string; membershipId: string; facilityName: string; roleCode: string }>(
      '/api/v1/identity/staff-invitations/signed-in/accept', proof),
}

/**
 * Facility billing (docs/BILLING_SPEC.md), scoped to the active facility's organization.
 * Proposed routes: a 404 or 501 means billing is not available yet (see billing.ts).
 */
export const billingApi = {
  subscription: (facilityId: string) => client.get<unknown>('/api/v1/commercial/subscription',
    { headers: { 'X-Facility-ID': facilityId } }),
  startTrial: (facilityId: string, idempotencyKey?: string) => client.post<unknown>('/api/v1/commercial/subscription/trial', {},
    { headers: { 'X-Facility-ID': facilityId, ...keyHeaders(idempotencyKey) } }),
  checkout: (facilityId: string, idempotencyKey?: string) => client.post<unknown>('/api/v1/commercial/subscription/checkout', {},
    { headers: { 'X-Facility-ID': facilityId, ...keyHeaders(idempotencyKey) } }),
  invoices: (facilityId: string) => client.get<unknown>('/api/v1/commercial/invoices',
    { headers: { 'X-Facility-ID': facilityId } }),
  /** The public price catalogue, which hid-system already serves. */
  pricing: () => client.get<unknown>('/api/v1/commercial/pricing', { auth: 'none' }),
}

export const staffApi = {
  login: (email: string, password: string, turnstileToken?: string) =>
    settingSession(() => client.post<unknown>('/api/v1/auth/login', {
      email, password, turnstileToken, turnstileAction: staffLoginAction(window.location.hostname),
    }, { auth: 'none' })).then(loginResult),
  session: () => client.get<StaffSession>('/api/v1/auth/session', { auth: 'optional' }),
  refresh: () => refreshStaffSession(),
  logout: signOut,
  checkSession: checkStaffSession,
  // The second steps of staff sign-in need no Turnstile token, CSRF token or session: the challenge
  // cookie is their credential. Under /api/v1/auth/ with auth 'none', a 401 there (a wrong code, a
  // spent challenge) is never refreshed and never taken for the end of a session.
  verifyMfa: (proof: { code: string } | { recoveryCode: string }) =>
    settingSession(() => client.post<StaffSession>('/api/v1/auth/mfa/verify', proof, { auth: 'none' })),
  sendEnrollmentCode: () =>
    client.post<StaffEnrollmentCodeSent>('/api/v1/auth/mfa/enroll/email-code', undefined, { auth: 'none' }),
  /** With the emailed code; with none only after provider activation, which is its own proof. */
  startEnrollment: (emailCode?: string) =>
    client.post<StaffMfaEnrollment>('/api/v1/auth/mfa/enroll/start', emailCode === undefined ? {} : { emailCode }, { auth: 'none' }),
  activateEnrollment: (code: string) =>
    settingSession(() => client.post<StaffMfaActivation>('/api/v1/auth/mfa/enroll/activate', { code }, { auth: 'none' })),
  selectFacility: async (facilityId: string) => {
    const sentIn = staffSessionGeneration()
    const actorId = staffSessionActor()
    try {
      const session = await withRestoredSession(() => client.post<StaffSession>('/api/v1/auth/facility', { facilityId }))
      // A switch answered for another account (signed in from another tab) is not this session's to adopt.
      if (actorId !== null && !isSessionOf(session, actorId)) throw sessionEnded()
      return session
    } catch (error) { if (endsStaffSession(error)) reportStaffSessionEnded(sentIn); throw error }
  },

  facilityAudit: async (facilityId: string, beforeSequenceId?: string): Promise<FacilityAuditPage> => {
    const page = await client.get<FacilityAuditPage>('/api/v1/audit/events', {
      query: { limit: 50, ...(beforeSequenceId ? { beforeSequenceId } : {}) },
      headers: facilityHeaders(facilityId, 'healthcare-operations'),
    })
    return {
      nextBeforeSequenceId: page.nextBeforeSequenceId,
      items: page.items.map(event => ({
        sequenceId: event.sequenceId,
        occurredAt: event.occurredAt,
        correlationId: event.correlationId,
        actorType: event.actorType,
        action: event.action,
        outcome: event.outcome,
        resourceType: event.resourceType,
      })),
    }
  },

  registrationCapabilities: (facilityId: string) =>
    client.get<RegistrationCapabilities>('/api/v1/identity/registration-capabilities',
      { headers: facilityHeaders(facilityId, 'healthcare-operations') }),
  resolveNin: (facilityId: string, input: ResolveNinInput, idempotencyKey: string) =>
    client.post<RegistrationCase>('/api/v1/identity/nin/resolve',
      { ...input, purpose: 'healthcare-operations' },
      { headers: { ...facilityHeaders(facilityId, 'healthcare-operations'), ...keyHeaders(idempotencyKey) } }),
  registrationCase: (facilityId: string, caseId: string) =>
    client.get<RegistrationCase>(`/api/v1/identity/registration-cases/${encodeURIComponent(caseId)}`,
      { headers: facilityHeaders(facilityId, 'healthcare-operations') }),
  approveNewRegistration: (facilityId: string, registrationCase: RegistrationCase, reason: string, idempotencyKey: string) =>
    client.post<RegistrationCase>(`/api/v1/identity/registration-cases/${encodeURIComponent(registrationCase.caseId)}/approve-new`,
      { expectedVersion: registrationCase.version, reason, purpose: 'healthcare-operations' },
      { headers: { ...facilityHeaders(facilityId, 'healthcare-operations'), ...keyHeaders(idempotencyKey) } }),
  linkExistingRegistration: (facilityId: string, registrationCase: RegistrationCase, patientId: string, reason: string, idempotencyKey: string) =>
    client.post<RegistrationCase>(`/api/v1/identity/registration-cases/${encodeURIComponent(registrationCase.caseId)}/link-existing`,
      { patientId, expectedVersion: registrationCase.version, reason, purpose: 'healthcare-operations' },
      { headers: { ...facilityHeaders(facilityId, 'healthcare-operations'), ...keyHeaders(idempotencyKey) } }),
  enrollRegistration: (facilityId: string, registrationCase: RegistrationCase, email: string, reason: string, idempotencyKey: string) =>
    client.post<RegistrationEnrollment>(`/api/v1/identity/registration-cases/${encodeURIComponent(registrationCase.caseId)}/enroll`,
      { expectedVersion: registrationCase.version, email, reason, purpose: 'healthcare-operations' },
      { headers: { ...facilityHeaders(facilityId, 'healthcare-operations'), ...keyHeaders(idempotencyKey) } }),

  // The in-person check of facility-assisted registration (hid-system #85, ADR-063). Identity records it
  // as healthcare operations. One key per submission: the same key replays the stored outcome, so a
  // retry after a 503 or a lost answer is not charged again.
  assistedVerification: (facilityId: string, input: AssistedVerificationInput, idempotencyKey: string) =>
    client.post<AssistedVerificationResult>('/api/v1/identity/assisted-verifications', input,
      { headers: { ...facilityHeaders(facilityId, 'healthcare-operations'), ...keyHeaders(idempotencyKey) } }),

  lookupPatient: (facilityId: string, hid: string, purpose: 'direct-care' | 'emergency' = 'direct-care') =>
    client.post<PatientLookup>('/api/v1/identity/patient-lookup', { hid: hid.trim().toUpperCase(), purpose },
      { headers: facilityHeaders(facilityId, purpose) }),
  listAccessRequests: (facilityId: string, status?: AccessRequestStatus) =>
    client.get<AccessRequest[]>('/api/v1/identity/access-requests',
      { ...(status ? { query: { status } } : {}), headers: facilityHeaders(facilityId) }),
  consentStatus: (facilityId: string, patientId: string) =>
    client.post<ConsentStatus>('/api/v1/identity/consent-status', { patientId, purpose: 'direct-care' },
      { headers: facilityHeaders(facilityId) }),
  requestAccess: (facilityId: string, hid: string, scope: 'read_records' | 'write_records', reason: string, durationMinutes: number) =>
    client.post<AccessRequest>('/api/v1/identity/access-requests', { hid: hid.trim().toUpperCase(), scope, reason, durationMinutes },
      { headers: facilityHeaders(facilityId) }),
  verifyPin: (facilityId: string, hid: string, pin: string) =>
    client.post<GrantResult>('/api/v1/identity/standard-access/pin', { hid: hid.trim().toUpperCase(), pin, durationMinutes: 60 },
      { headers: facilityHeaders(facilityId) }),
  breakGlass: (facilityId: string, hid: string, reason: string) =>
    client.post<GrantResult>('/api/v1/identity/break-glass', { hid: hid.trim().toUpperCase(), reason, durationMinutes: 30 },
      { headers: facilityHeaders(facilityId, 'emergency') }),
  closeGrant: (facilityId: string, grantId: string, reason: string) =>
    client.post<GrantResult>(`/api/v1/identity/consent-grants/${encodeURIComponent(grantId)}/close`, { reason },
      { headers: facilityHeaders(facilityId) }),

  encounters: (facilityId: string, patientId: string, page: PageRequest = {}) =>
    client.get<Page<Encounter>>(patientPath(patientId), { ...pageQuery(page), headers: facilityHeaders(facilityId) }),
  // One encounter, read afresh: the documented one may be on a page not shown.
  encounter: (facilityId: string, patientId: string, encounterId: string) =>
    client.get<Encounter>(encounterPath(patientId, encounterId), { headers: facilityHeaders(facilityId), dedupe: false }),
  patientChat: async (facilityId:string,patientId:string,question:string,signal?:AbortSignal) =>
    parseStagingPatientChat(await client.post<unknown>(`/api/v1/ehr/patients/${encodeURIComponent(patientId)}/chat`,
      {question:stagingChatQuestion(question)},{headers:facilityHeaders(facilityId),signal,timeoutMs:65_000})),
  patientChatHistory: async (facilityId:string,patientId:string,signal?:AbortSignal) =>
    parseStagingChatHistory(await client.get<unknown>(`/api/v1/ehr/patients/${encodeURIComponent(patientId)}/chat/history`,
      {headers:facilityHeaders(facilityId),signal,dedupe:false})),
  clearPatientChatHistory: (facilityId:string,patientId:string,signal?:AbortSignal) =>
    client.request<{cleared:true}>({method:'DELETE',path:`/api/v1/ehr/patients/${encodeURIComponent(patientId)}/chat/history`,
      headers:facilityHeaders(facilityId),signal}),
  // Staff record chat as hid-system main serves it (ADR-069, 0101): direct care only, one patient at the selected
  // facility, the asking member's own history. `/chat/sources/...` is not served, so a source is not opened.
  recordChatAvailability: async (facilityId: string, patientId: string, signal?: AbortSignal) =>
    parsePatientChatAvailability(await client.get<unknown>(`/api/v1/ehr/patients/${encodeURIComponent(patientId)}/chat/availability`,
      { headers: facilityHeaders(facilityId, 'direct-care'), signal, dedupe: false })),
  // One question. The key makes a retry of the same question answer the stored reply; the service's own deadline
  // is 25 seconds, so the client waits a little longer than that.
  recordChat: async (facilityId: string, patientId: string, question: string,
    ask: { noticeVersion: string; idempotencyKey: string; maxQuestionLength?: number }, signal?: AbortSignal) =>
    parsePatientChat(await client.post<unknown>(`/api/v1/ehr/patients/${encodeURIComponent(patientId)}/chat`,
      { question: chatQuestion(question, ask.maxQuestionLength ?? 1000), noticeVersion: ask.noticeVersion },
      { headers: { ...facilityHeaders(facilityId, 'direct-care'), 'Idempotency-Key': ask.idempotencyKey }, signal, timeoutMs: 35_000 })),
  recordChatHistory: async (facilityId: string, patientId: string, signal?: AbortSignal) =>
    parsePatientChatHistory(await client.get<unknown>(`/api/v1/ehr/patients/${encodeURIComponent(patientId)}/chat/history`,
      { headers: facilityHeaders(facilityId, 'direct-care'), signal, dedupe: false })),
  clearRecordChatHistory: async (facilityId: string, patientId: string, signal?: AbortSignal) =>
    parsePatientChatCleared(await client.request<unknown>({ method: 'DELETE',
      path: `/api/v1/ehr/patients/${encodeURIComponent(patientId)}/chat/history`,
      headers: facilityHeaders(facilityId, 'direct-care'), signal })),
  patientChatSource: (facilityId:string,patientId:string,kind:string,id:string,signal?:AbortSignal) =>
    client.get<Record<string,unknown>>(`/api/v1/ehr/patients/${encodeURIComponent(patientId)}/chat/sources/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
      {headers:facilityHeaders(facilityId),signal,dedupe:false}),
  // Imported legacy medical history as hid-system main serves it (#94, ADR-067): direct care only, at the selected
  // facility, a page at a time; `shared: false` with no record until the patient shares.
  importedHistory: async (facilityId: string, patientId: string, cursor: string | null, signal?: AbortSignal): Promise<ImportedHistoryPage> =>
    parseImportedHistory(await client.get<unknown>(`/api/v1/ehr/patients/${encodeURIComponent(patientId)}/imported-history`,
      { headers: facilityHeaders(facilityId, 'direct-care'), signal, dedupe: false, ...(cursor ? { query: { cursor } } : {}) }), true),
  importedRecords: (facilityId: string, patientId: string, purpose: 'direct-care' | 'emergency', signal?: AbortSignal) =>
    client.get<ImportedRecordsResponse>(`/api/v1/ehr/patients/${encodeURIComponent(patientId)}/imported-records`,
      { headers: facilityHeaders(facilityId, purpose), signal, dedupe: false }),
  importedAttachment: (facilityId: string, patientId: string, fileId: string, purpose: 'direct-care' | 'emergency', signal?: AbortSignal) =>
    client.get<ImportedAttachmentDownload>(`/api/v1/ehr/patients/${encodeURIComponent(patientId)}/imported-attachments/${encodeURIComponent(fileId)}/download`,
      { headers: facilityHeaders(facilityId, purpose), signal, dedupe: false }),
  emergencyRecords: (facilityId: string, patientId: string) =>
    client.get<EmergencyRecords>(`/api/v1/ehr/patients/${encodeURIComponent(patientId)}/emergency-records`,
      { headers: facilityHeaders(facilityId, 'emergency') }),
  createEncounter: (facilityId: string, patientId: string, input: { encounterType: string; status: string; startedAt: string; chiefComplaint: string }, idempotencyKey?: string) =>
    client.post<Encounter>(patientPath(patientId), input,
      { headers: { ...facilityHeaders(facilityId), ...keyHeaders(idempotencyKey) } }),
  updateEncounter: (facilityId: string, patientId: string, encounterId: string,
    input: { expectedRowVersion: number; changeReason: string; status: string; endedAt?: string }) =>
    client.request<Encounter>({ method: 'PATCH', path: encounterPath(patientId, encounterId), body: input,
      headers: facilityHeaders(facilityId) }),
  // Novu since P4c a lab request or prescription page also says whether orders between facilities are on; with the
  // wrong-patient report (item 3, hid-system 0088) it also answers wrongPatientReports: true, and with the late correction
  // (D17, hid-system 0090) lateCorrection: true (an earlier backend, nothing).
  records: (facilityId: string, patientId: string, encounterId: string, kind: RecordKind, page: PageRequest = {}) =>
    client.get<Page<ClinicalRecord> & { crossFacilityOrders?: boolean; wrongPatientReports?: boolean; lateCorrection?: boolean }>(`${encounterPath(patientId, encounterId)}/${kind}`, { ...pageQuery(page), headers: facilityHeaders(facilityId) }),
  createRecord: (facilityId: string, patientId: string, encounterId: string, kind: RecordKind, input: object, idempotencyKey?: string) =>
    client.post<SavedRecord>(`${encounterPath(patientId, encounterId)}/${kind}`, input,
      { headers: { ...facilityHeaders(facilityId), ...keyHeaders(idempotencyKey) } }),
  // A status PATCH: diagnoses have no status field and vitals are corrected, never patched.
  updateRecord: (facilityId: string, patientId: string, encounterId: string, kind: StatusRecordKind,
    recordId: string, input: { expectedRowVersion: number; changeReason: string; status: string }) =>
    client.request<SavedRecord>({ method: 'PATCH',
      path: `${encounterPath(patientId, encounterId)}/${kind}/${encodeURIComponent(recordId)}`,
      body: input, headers: facilityHeaders(facilityId) }),
  updateDiagnosis: (facilityId: string, patientId: string, encounterId: string, diagnosisId: string,
    input: DiagnosisUpdate) =>
    client.request<ClinicalRecord>({ method: 'PATCH',
      path: `${encounterPath(patientId, encounterId)}/diagnoses/${encodeURIComponent(diagnosisId)}`,
      body: input, headers: facilityHeaders(facilityId) }),
  vitalCorrections: (facilityId: string, patientId: string, encounterId: string, vitalId: string) =>
    client.get<VitalCorrection[]>(`${encounterPath(patientId, encounterId)}/vitals/${encodeURIComponent(vitalId)}/corrections`,
      { headers: facilityHeaders(facilityId) }),
  correctVital: (facilityId: string, patientId: string, encounterId: string, vitalId: string,
    input: { expectedRowVersion: number; changeReason: string; replacementValues: VitalMeasurements }, idempotencyKey?: string) =>
    client.post<VitalCorrection>(`${encounterPath(patientId, encounterId)}/vitals/${encodeURIComponent(vitalId)}/corrections`, input,
      { headers: { ...facilityHeaders(facilityId), ...keyHeaders(idempotencyKey) } }),
  acceptPrescription: (facilityId: string, patientId: string, encounterId: string,
    prescriptionId: string, expectedRowVersion: number, reason: string, idempotencyKey?: string) =>
    client.post<unknown>(`${encounterPath(patientId, encounterId)}/prescriptions/${encodeURIComponent(prescriptionId)}/pharmacy-work-item`,
      { expectedRowVersion, reason }, { headers: { ...facilityHeaders(facilityId), ...keyHeaders(idempotencyKey) } }),
  // Sends (or sends again) a saved active lab request to Lab at the version read
  // (hid-system #56). The body is exactly SendLabRequestToLabDto; the caller keeps
  // one key per attempt, so pressing again after no answer is the same send.
  sendLabRequestToLab: (facilityId: string, patientId: string, encounterId: string, requestId: string,
    expectedRowVersion: number, idempotencyKey?: string) =>
    client.post<unknown>(`${encounterPath(patientId, encounterId)}/lab-requests/${encodeURIComponent(requestId)}/lab-work-item`,
      { expectedRowVersion }, { headers: { ...facilityHeaders(facilityId), ...keyHeaders(idempotencyKey) } }),
  noteRevisions: (facilityId: string, patientId: string, encounterId: string, noteId: string) =>
    client.get<NoteRevision[]>(`${encounterPath(patientId, encounterId)}/clinical-notes/${encodeURIComponent(noteId)}/revisions`,
      { headers: facilityHeaders(facilityId) }),
  addNoteRevision: (facilityId: string, patientId: string, encounterId: string, noteId: string,
    input: { expectedRowVersion: number; changeReason: string; content: string }, idempotencyKey?: string) =>
    client.post<NoteRevision>(`${encounterPath(patientId, encounterId)}/clinical-notes/${encodeURIComponent(noteId)}/revisions`, input,
      { headers: { ...facilityHeaders(facilityId), ...keyHeaders(idempotencyKey) } }),
  documents: (facilityId: string, patientId: string, encounterId: string) =>
    client.get<Page<DocumentRecord>>('/api/v1/ehr/documents', {
      query: { patientId, encounterId }, headers: facilityHeaders(facilityId),
    }),
  // A signed storage link valid for expiresInSeconds (s3-storage.provider.ts createDownload).
  documentDownload: (facilityId: string, documentId: string) =>
    client.get<{ url: string; expiresInSeconds: number }>(`/api/v1/ehr/documents/${encodeURIComponent(documentId)}/download`,
      { headers: facilityHeaders(facilityId) }),
  async uploadDocument(facilityId: string, patientId: string, encounterId: string, file: File) {
    // Every step runs only while the session the upload started in is ready: each
    // waits while that session is checked, unconfirmed or away, and the upload is
    // abandoned once it has ended (another account signed in, or signed out), so
    // a document is never completed as the next account. The storage PUT is
    // cancelled with the session. The server's own ownership check is separate.
    const sentIn = staffSessionGeneration()
    const signal = staffSessionSignal()
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    const sha256Hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    await untilStaffSessionReady(sentIn)
    const intent = await client.post<{
      document: { id: string }
      upload: { method: 'PUT'; url: string; requiredHeaders: Record<string, string>; expiresInSeconds: number }
    }>('/api/v1/ehr/documents/upload-intents', {
      patientId, encounterId, fileName: file.name, mediaType: file.type, sizeBytes: file.size,
      sha256Hex, classification: 'phi', retentionClass: 'clinical-10y',
    }, { headers: { ...facilityHeaders(facilityId), ...keyHeaders() } })
    await untilStaffSessionReady(sentIn)
    await uploadPresignedObject({ url: intent.upload.url, body: file, requiredHeaders: intent.upload.requiredHeaders, signal,
      allowLocalHttp: getEnvironment().name === 'local' })
    await untilStaffSessionReady(sentIn)
    await client.post(`/api/v1/ehr/documents/${encodeURIComponent(intent.document.id)}/complete`, undefined,
      { headers: facilityHeaders(facilityId) })
    return intent.document.id
  },

  labWorkItems: (facilityId: string) =>
    client.get<WorkList<LabWorkItem>>('/api/v1/lab/work-items', { headers: facilityHeaders(facilityId) }),
  createLabAccession: (facilityId: string, workItemId: string, specimenType: string, reason: string) =>
    client.post<LabAccession>(`/api/v1/lab/work-items/${encodeURIComponent(workItemId)}/accession`,
      { requirements: [{ specimenType }], reason },
      { headers: { ...facilityHeaders(facilityId), ...keyHeaders() } }),
  // Read afresh like the Lab result reads below: a failed specimen step re-reads it to confirm access.
  labAccession: (facilityId: string, accessionId: string) =>
    client.get<LabAccession>(`/api/v1/lab/accessions/${encodeURIComponent(accessionId)}`,
      { headers: facilityHeaders(facilityId), dedupe: false }),
  transitionSpecimen: (facilityId: string, accessionId: string, specimen: LabSpecimen, action: 'collect' | 'receive' | 'reject', detail: string) =>
    client.post<LabSpecimen>(`/api/v1/lab/accessions/${encodeURIComponent(accessionId)}/specimens/${encodeURIComponent(specimen.id)}/${action}`,
      action === 'collect' ? { expectedVersion: specimen.version, collectedAt: new Date().toISOString(), notes: detail } :
        action === 'receive' ? { expectedVersion: specimen.version, receivedAt: new Date().toISOString(), condition: detail } :
          { expectedVersion: specimen.version, reason: detail },
      { headers: { ...facilityHeaders(facilityId), ...keyHeaders() } }),
  // Lab result reads are never merged with an identical read already in flight: the
  // Laboratory page re-reads them to confirm access, and that needs a request of its own.
  labExecutions: (facilityId: string, specimenId: string) =>
    client.get<{ items: LabExecution[] }>(`/api/v1/lab/specimens/${encodeURIComponent(specimenId)}/executions`,
      { headers: facilityHeaders(facilityId), dedupe: false }),
  startLabExecution: (facilityId: string, specimen: LabSpecimen, reason: string, method?: string) =>
    client.post<LabExecution>(`/api/v1/lab/specimens/${encodeURIComponent(specimen.id)}/executions`,
      { expectedSpecimenVersion: specimen.version, startedAt: new Date().toISOString(), reason,
        ...(method?.trim() ? { method: method.trim() } : {}) },
      { headers: { ...facilityHeaders(facilityId), ...keyHeaders() } }),
  completeLabExecution: (facilityId: string, execution: LabExecution, notes?: string) =>
    client.post<LabExecution>(`/api/v1/lab/executions/${encodeURIComponent(execution.id)}/complete`,
      { expectedVersion: execution.version, completedAt: new Date().toISOString(),
        ...(notes?.trim() ? { notes: notes.trim() } : {}) },
      { headers: { ...facilityHeaders(facilityId), ...keyHeaders() } }),
  enterLabResult: (facilityId: string, execution: LabExecution, value: LabResultValue) =>
    client.post<LabResult>(`/api/v1/lab/executions/${encodeURIComponent(execution.id)}/results`,
      { expectedExecutionVersion: execution.version, ...value },
      { headers: { ...facilityHeaders(facilityId), ...keyHeaders() } }),
  correctLabResult: (facilityId: string, execution: LabExecution, result: LabResult, value: LabResultValue,
    reason: string, revisionKind: 'correction' | 'amendment') =>
    client.post<LabResult>(`/api/v1/lab/executions/${encodeURIComponent(execution.id)}/results/${encodeURIComponent(result.id)}/corrections`,
      { expectedExecutionVersion: execution.version, expectedResultVersion: result.currentVersion,
        ...value, reason, revisionKind },
      { headers: { ...facilityHeaders(facilityId), ...keyHeaders() } }),
  verifyLabResult: (facilityId: string, result: LabResult, reason: string) =>
    client.post<LabResult>(`/api/v1/lab/results/${encodeURIComponent(result.id)}/verify`,
      { expectedResultVersion: result.currentVersion, occurredAt: new Date().toISOString(), reason },
      { headers: { ...facilityHeaders(facilityId), ...keyHeaders() } }),
  releaseLabResult: (facilityId: string, result: LabResult, reason: string) =>
    client.post<LabResult>(`/api/v1/lab/results/${encodeURIComponent(result.id)}/release`,
      { expectedResultVersion: result.currentVersion, occurredAt: new Date().toISOString(), reason },
      { headers: { ...facilityHeaders(facilityId), ...keyHeaders() } }),
  labResultHistory: (facilityId: string, resultId: string) =>
    client.get<LabResult>(`/api/v1/lab/results/${encodeURIComponent(resultId)}/history`,
      { headers: facilityHeaders(facilityId), dedupe: false }),
  // The released results of the Lab work item accepted from one EHR lab request
  // (hid-system #51). Each read is audited, so it is made only when asked for, and
  // never merged with one in flight. Lab allows it under an active emergency grant.
  labReleasedResultsForOrder: (facilityId: string, labRequestId: string, purpose: 'direct-care' | 'emergency' = 'direct-care') =>
    client.get<LabOrderReleasedResults>(`/api/v1/lab/ehr-orders/${encodeURIComponent(labRequestId)}/released-results`,
      { headers: facilityHeaders(facilityId, purpose), dedupe: false }),
  pharmacyWorkItems: (facilityId: string) =>
    client.get<WorkList<PharmacyWorkItem>>('/api/v1/pharmacy/work-items', { headers: facilityHeaders(facilityId) }),
  dispense: (facilityId: string, item: PharmacyWorkItem, quantityDispensed: number, quantityUnit: string, reason: string) =>
    client.post<unknown>(`/api/v1/pharmacy/work-items/${encodeURIComponent(item.id)}/dispensings`,
      { expectedWorkItemVersion: item.version, quantityDispensed, quantityUnit, reason },
      { headers: { ...facilityHeaders(facilityId), ...keyHeaders() } }),
  reverseDispensing: (facilityId: string, dispensingId: string, expectedDispensingVersion: number, reason: string) =>
    client.post<unknown>(`/api/v1/pharmacy/dispensings/${encodeURIComponent(dispensingId)}/reversals`,
      { expectedDispensingVersion, reason },
      { headers: { ...facilityHeaders(facilityId), ...keyHeaders() } }),
  dispensing: (facilityId: string, dispensingId: string) =>
    client.get<{ id: string; version: number }>(`/api/v1/pharmacy/dispensings/${encodeURIComponent(dispensingId)}`,
      { headers: facilityHeaders(facilityId) }),

  findOcrJob: (facilityId: string, documentId: string) =>
    client.get<{ job: OcrJob | null }>('/api/v1/ocr/jobs', { query: { documentId }, headers: facilityHeaders(facilityId, 'healthcare-operations') }),
  ocrJob: (facilityId: string, jobId: string) =>
    client.get<OcrJob>(`/api/v1/ocr/jobs/${encodeURIComponent(jobId)}`,
      { headers: facilityHeaders(facilityId, 'healthcare-operations') }),
  createOcrJob: (facilityId: string, documentId: string, patientId: string) =>
    client.post<OcrJob>('/api/v1/ocr/jobs', { documentId, patientId, provider: 'textract', purpose: 'healthcare-operations' },
      { headers: { ...facilityHeaders(facilityId, 'healthcare-operations'), ...keyHeaders() } }),
  ocrExtractions: (facilityId: string, jobId: string) =>
    client.get<{ items: OcrExtraction[] }>(`/api/v1/ocr/jobs/${encodeURIComponent(jobId)}/extractions`,
      { headers: facilityHeaders(facilityId, 'healthcare-operations') }),
  ocrValidations: (facilityId: string, jobId: string) =>
    client.get<{ items: OcrValidation[] }>(`/api/v1/ocr/jobs/${encodeURIComponent(jobId)}/validations`,
      { headers: facilityHeaders(facilityId, 'healthcare-operations') }),
  validateOcrJob: (facilityId: string, job: OcrJob, input: OcrValidationInput) =>
    client.post<OcrJob & { validationId: string; validationVersion: number }>(`/api/v1/ocr/jobs/${encodeURIComponent(job.id)}/validation`,
      { ...input, expectedVersion: job.version, purpose: 'healthcare-operations' },
      { headers: { ...facilityHeaders(facilityId, 'healthcare-operations'), ...keyHeaders() } }),
  confirmOcrPatient: (facilityId: string, job: OcrJob, patientId: string, reason: string, idempotencyKey?: string) =>
    client.post<{ id: string; jobId: string; patientId: string; version: number }>(`/api/v1/ocr/jobs/${encodeURIComponent(job.id)}/patient-confirmation`,
      { patientId, expectedJobVersion: job.version, method: 'source_document', reason, purpose: 'healthcare-operations' },
      { headers: { ...facilityHeaders(facilityId, 'healthcare-operations'), ...keyHeaders(idempotencyKey) } }),
  ocrPublications: (facilityId: string, validationId: string) =>
    client.get<{ items: OcrPublication[] }>(`/api/v1/ocr/validations/${encodeURIComponent(validationId)}/publications`,
      { headers: facilityHeaders(facilityId) }),
  // OCR resumes a publication its owning service could not take only when the request
  // that started it is sent again with the same key, so the caller holds the key.
  publishOcrValidation: (facilityId: string, validation: OcrValidation, patientConfirmationId: string,
    targetOperation: 'create_imported_clinical_note' | 'create_imported_lab_evidence' | 'create_imported_medication_evidence' | 'retain_validated_document',
    idempotencyKey: string) =>
    client.post<OcrPublication>(`/api/v1/ocr/validations/${encodeURIComponent(validation.id)}/publications`,
      { validationVersion: validation.version, patientConfirmationId, targetOperation, purpose: 'direct-care' },
      { headers: { ...facilityHeaders(facilityId), ...keyHeaders(idempotencyKey) } }),
  retryOcrJob: (facilityId: string, job: OcrJob, reason: string) =>
    client.post<OcrJob>(`/api/v1/ocr/jobs/${encodeURIComponent(job.id)}/retry`,
      { expectedVersion: job.version, reason, purpose: 'healthcare-operations' },
      { headers: facilityHeaders(facilityId, 'healthcare-operations') }),
  // What a Lab or Pharmacy publication made, read from the domain that owns it.
  labImport: (facilityId: string, importId: string) =>
    client.get<LabImport>(`/api/v1/lab/imports/${encodeURIComponent(importId)}`, { headers: facilityHeaders(facilityId) }),
  pharmacyImport: (facilityId: string, importId: string) =>
    client.get<PharmacyImport>(`/api/v1/pharmacy/imports/${encodeURIComponent(importId)}`, { headers: facilityHeaders(facilityId) }),

  outreachCampaigns: (facilityId: string) =>
    client.get<OutreachCampaign[]>('/api/v1/outreach/registration-cases/campaigns', { headers: facilityHeaders(facilityId) }),
  outreachCampaignMembers: (facilityId: string, campaignId: string) =>
    client.get<OutreachCampaignMember[]>(`/api/v1/outreach/registration-cases/campaigns/${encodeURIComponent(campaignId)}/members`,
      { headers: facilityHeaders(facilityId) }),
  outreachCases: (facilityId: string) =>
    client.get<OutreachCase[]>('/api/v1/outreach/registration-cases', { headers: facilityHeaders(facilityId) }),
  linkExistingOutreachCase: (facilityId: string, registrationCase: OutreachCase, canonicalPatientId: string, reason: string) =>
    client.post<OutreachCase>(`/api/v1/outreach/registration-cases/${encodeURIComponent(registrationCase.id)}/link-existing`,
      { canonicalPatientId, expectedVersion: registrationCase.rowVersion, reason },
      { headers: { ...facilityHeaders(facilityId), ...keyHeaders() } }),
  // Outreach answers a command sent again (its localCommandId is also its Idempotency-Key)
  // with the case it made, so the caller names the command and resends it for the same case.
  createOutreachCase: (facilityId: string, input: { campaignId?: string; fullName: string; sex: string; ageYears: number; phone?: string; operationalNotes?: string },
    command: { localCommandId: string; temporaryPatientId: string }) =>
    client.post<OutreachCase>('/api/v1/outreach/registration-cases', { ...input, ...command },
      { headers: { ...facilityHeaders(facilityId), 'Idempotency-Key': command.localCommandId } }),
}

/** The EHR path of an order's routes. */
function orderRoutesPath(patientId: string, encounterId: string, kind: OrderRouteKind, orderId: string) {
  return `${encounterPath(patientId, encounterId)}/${kind === 'lab_request' ? 'lab-requests' : 'prescriptions'}/${encodeURIComponent(orderId)}/order-routes`
}

/** The service that receives a kind of order: Lab for lab requests, Pharmacy for prescriptions. */
export type ReceivingService = 'lab' | 'pharmacy'

/**
 * Orders between facilities (Novu, P4c). Every call is direct care at the working facility (X-Purpose-Of-Use:
 * direct-care); EHR refuses any other purpose. hid-system main, and a Novu before P4c, answer each route 404, which
 * the pages read as "not available yet". Writes are sent once; each caller keeps its own Idempotency-Key for a retry.
 */
export const orderRoutesApi = {
  /** The directory (60 searches an hour per member): never retried, so a failure costs one search at most. */
  destinations: (facilityId: string, kind: 'laboratory' | 'pharmacy', query: string, signal?: AbortSignal) =>
    client.get<{ items: OrderDestination[] }>('/api/v1/identity/order-destinations', {
      query: { kind, query }, headers: facilityHeaders(facilityId, 'direct-care'), retry: NO_RETRY, dedupe: false,
      ...(signal ? { signal } : {}) }),
  /** The current attestation text of a kind, read afresh each time the send form opens (each read is audited). */
  attestation: (facilityId: string, kind: OrderRouteKind) =>
    client.get<OrderRouteAttestation>('/api/v1/ehr/order-route-attestation',
      { query: { kind }, headers: facilityHeaders(facilityId, 'direct-care'), dedupe: false }),
  send: (facilityId: string, patientId: string, encounterId: string, kind: OrderRouteKind, orderId: string,
    input: { expectedRowVersion: number; receivingFacilityId: string; attestationTextVersion: string }, idempotencyKey: string) =>
    client.post<OrderRouteSent>(orderRoutesPath(patientId, encounterId, kind, orderId),
      { expectedRowVersion: input.expectedRowVersion, receivingFacilityId: input.receivingFacilityId, patientAgreed: true,
        attestationTextVersion: input.attestationTextVersion },
      { headers: { ...facilityHeaders(facilityId, 'direct-care'), ...keyHeaders(idempotencyKey) } }),
  /** An order's routes, newest first, with the attestation and what came back. Audited: read only when asked. */
  routes: (facilityId: string, patientId: string, encounterId: string, kind: OrderRouteKind, orderId: string) =>
    client.get<{ items: OrderRouteView[] }>(orderRoutesPath(patientId, encounterId, kind, orderId),
      { headers: facilityHeaders(facilityId, 'direct-care'), dedupe: false }),
  withdraw: (facilityId: string, patientId: string, encounterId: string, kind: OrderRouteKind, orderId: string,
    route: Pick<OrderRouteSummary, 'id' | 'version'>, reason: OrderRouteWithdrawReason) =>
    client.post<{ route: OrderRouteSummary }>(
      `${orderRoutesPath(patientId, encounterId, kind, orderId)}/${encodeURIComponent(route.id)}/withdraw`,
      { expectedVersion: route.version, reason }, { headers: facilityHeaders(facilityId, 'direct-care') }),
  /**
   * Orders other facilities sent here, waiting to be accepted; a Health ID finds one patient's. The Health ID goes in
   * the body of `POST …/order-routes/search` (P4c review), never in an address, which gateway access logs keep with the
   * request line; the list's GET is read without it. Every read is audited, so callers still send a Health ID only when
   * the person asks (IncomingOrders: Find or Refresh, never the timer or focus).
   */
  incoming: (facilityId: string, service: ReceivingService, healthId?: string) => healthId
    ? client.post<IncomingOrderRoutes>(`/api/v1/${service}/order-routes/search`, { view: 'incoming', healthId },
      { headers: facilityHeaders(facilityId, 'direct-care') })
    : client.get<IncomingOrderRoutes>(`/api/v1/${service}/order-routes`, {
      query: { view: 'incoming' }, headers: facilityHeaders(facilityId, 'direct-care'), dedupe: false }),
  /**
   * Accepts an order with the patient's identifier. `reference`, sent only when given, is the order's 8-character
   * reference the patient reads in their app: with a date of birth it names the order, so a wrong date counts towards
   * this order's five tries; another order's reference is refused (409 ORDER_ROUTE_REFERENCE_MISMATCH) and counts nothing.
   */
  accept: (facilityId: string, service: ReceivingService, route: { id: string; version: number },
    patientIdentifier: { kind: 'health_id' | 'date_of_birth'; value: string }, reason: string | undefined, idempotencyKey: string,
    reference?: string) =>
    client.post<OrderRouteAccepted>(`/api/v1/${service}/order-routes/${encodeURIComponent(route.id)}/accept`,
      { expectedVersion: route.version, patientIdentifier, ...(service === 'pharmacy' ? { reason } : {}),
        ...(reference ? { reference } : {}) },
      { headers: { ...facilityHeaders(facilityId, 'direct-care'), ...keyHeaders(idempotencyKey) } }),
  decline: (facilityId: string, service: ReceivingService, route: { id: string; version: number }, reason: OrderRouteDeclineReason) =>
    client.post<{ route: { id: string; version: number; effectiveState: string } }>(
      `/api/v1/${service}/order-routes/${encodeURIComponent(route.id)}/decline`,
      { expectedVersion: route.version, reason }, { headers: facilityHeaders(facilityId, 'direct-care') }),
  /**
   * One route as this facility reads it (C8), read again when the wrong-patient report answered 412 (something was
   * returned or changed since its version was read). Audited, so read only then.
   */
  get: (facilityId: string, service: ReceivingService, routeId: string) =>
    client.get<ReceivedOrderRoute>(`/api/v1/${service}/order-routes/${encodeURIComponent(routeId)}`,
      { headers: facilityHeaders(facilityId, 'direct-care'), dedupe: false }),
  /**
   * The receiving laboratory or pharmacy reports that it accepted the order for someone who was not its patient (item 3,
   * C25): the order ends at once, and every result or dispensing it sent back is withdrawn, in one step. The caller keeps
   * one Idempotency-Key per report (the same report sent again after no answer is a replay); the note, trimmed, is for
   * Health ID support only. A backend without the route answers 404 (the caller says it is not available yet).
   */
  reportWrongPatient: (facilityId: string, service: ReceivingService, route: { id: string; version: number },
    input: { reason: OrderRouteWrongPatientReason; note: string }, idempotencyKey: string) =>
    client.post<OrderRouteWrongPatientEnded>(`/api/v1/${service}/order-routes/${encodeURIComponent(route.id)}/wrong-patient`,
      { expectedVersion: route.version, reason: input.reason, note: input.note },
      { headers: { ...facilityHeaders(facilityId, 'direct-care'), ...keyHeaders(idempotencyKey) } }),
  /**
   * The receiving laboratory or pharmacy ends an order it accepted and can't complete (D18, C31), with one reason of its
   * kind's list and the statement that the person it accepted the order for was the order's patient
   * (`confirmedPatient: true`); a laboratory also says, when it has, that it phoned the ordering facility about a
   * possibly critical value (`criticalValueTold: true`, sent only then; a pharmacy never sends it, its service refuses
   * it). The caller keeps one Idempotency-Key per identical request (the same request sent again after no answer is a
   * replay). A backend without the route answers 404 (the caller says it is not available yet).
   */
  cannotComplete: (facilityId: string, service: ReceivingService, route: { id: string; version: number },
    input: { reason: OrderRouteCannotCompleteReason; confirmedPatient: true; criticalValueTold?: boolean }, idempotencyKey: string) =>
    client.post<OrderRouteNotCompleted>(`/api/v1/${service}/order-routes/${encodeURIComponent(route.id)}/cannot-complete`,
      { expectedVersion: route.version, reason: input.reason, confirmedPatient: true,
        ...(service === 'lab' && input.criticalValueTold === true ? { criticalValueTold: true } : {}) },
      { headers: { ...facilityHeaders(facilityId, 'direct-care'), ...keyHeaders(idempotencyKey) } }),
  /**
   * Finds an order this facility accepted by its exact 8-character reference (D17, C30), to withdraw what it recorded on
   * it after it has ended. A POST, so the reference (also an acceptance factor) stays out of request lines that gateways
   * log. Audited: read only when asked. `{ items: [] }` when none was accepted here; a backend without the route answers
   * 404 (the caller says it is not available yet).
   */
  findCorrectable: (facilityId: string, service: ReceivingService, reference: string) =>
    client.post<CorrectableOrderRoutes>(`/api/v1/${service}/order-routes/correctable`, { reference },
      { headers: facilityHeaders(facilityId, 'direct-care') }),
  /**
   * The receiving laboratory or pharmacy withdraws what it recorded on an order it accepted for someone who was not its
   * patient, after the order has ended (D17, C29): every result it recorded is marked entered in error, or the dispensing
   * reversed, in one step. The caller keeps one Idempotency-Key per request (the same request sent again after no answer
   * is a replay); the note, trimmed, is for Health ID support only.
   */
  correctWrongPatient: (facilityId: string, service: ReceivingService, route: { id: string; version: number },
    input: { reason: OrderRouteWrongPatientReason; discoveredBy: OrderRouteDiscoveredBy; discoveredOn: string; note: string },
    idempotencyKey: string) =>
    client.post<OrderRouteWrongPatientCorrected>(
      `/api/v1/${service}/order-routes/${encodeURIComponent(route.id)}/wrong-patient-correction`,
      { expectedVersion: route.version, reason: input.reason, discoveredBy: input.discoveredBy, discoveredOn: input.discoveredOn,
        note: input.note },
      { headers: { ...facilityHeaders(facilityId, 'direct-care'), ...keyHeaders(idempotencyKey) } }),
  /**
   * Orders sent from this facility that the receiver ended as accepted for the wrong person in the last 30 days (item 3,
   * D10, C28), for the Overview: read once when it opens, by a member holding ehr.order-route.send. Audited. A backend
   * without the route answers 404, and the Overview then shows nothing.
   */
  sentWrongPatient: (facilityId: string) =>
    client.get<SentWrongPatientOrderRoutes>('/api/v1/ehr/order-routes/wrong-patient',
      { headers: facilityHeaders(facilityId, 'direct-care'), dedupe: false }),
}
