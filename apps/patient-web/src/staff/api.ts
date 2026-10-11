import { createApiClient, uploadPresignedObject } from '@hid/http'
import { createRegisteredBrowserClient } from '@hid/api'
import { getEnvironment } from './env'

export interface Facility {
  id: string
  membershipId: string
  organizationId: string
  name: string
  code?: string
  roles: string[]
  permissions: string[]
  isPrimary: boolean
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

export interface StaffSession {
  actor: Actor
  expiresAt?: string
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
  limit: number
}

export interface DocumentRecord {
  id: string
  patientId: string
  encounterId: string
  fileName: string
  mediaType: string
  sizeBytes: number
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

export interface PharmacyWorkItem {
  id: string
  patientId: string
  version: number
  acceptedAt: string
  medication: { display: string }
  doseQuantity?: number | null
  doseUnit?: string | null
  frequency?: string
  dispensing?: { id: string; reversed: boolean } | null
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

const client = createRegisteredBrowserClient(createApiClient({
  baseUrl: getEnvironment().apiBaseUrl,
  clientId: 'staff-web',
  sessionMode: 'cookie',
  refreshSession: async () => { await staffApi.refresh() },
}), 'staff-web')

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

export interface ProviderEnrollmentStart {
  accepted: true
  challengeId: string
  expiresInSeconds?: number
  resendAfterSeconds?: number
}

export interface ProviderEnrollmentActivation {
  activated: true
  organizationId: string
  facilityId: string
  accountId: string
  actor: StaffSession['actor']
  expiresAt: string
}

export const providerEnrollmentApi = {
  start: (input: {
    productCode: 'ehr' | 'migrate' | 'laboratory' | 'pharmacy'
    organizationType: 'clinic' | 'hospital' | 'laboratory' | 'pharmacy' | 'other'
    cacRegistrationNumber: string
    administratorName: string
    administratorEmail: string
    turnstileToken: string
  }) => client.post<ProviderEnrollmentStart>('/api/v1/identity/provider-enrollments',
    { ...input, turnstileAction: 'provider-enrollment' }, { auth: 'none' }),

  // The challenge travels only in the body: the gateway API is cross-origin and
  // its CORS policy admits no enrollment-specific request header.
  verify: (challengeId: string, code: string) =>
    client.post<{ verified: true }>('/api/v1/identity/provider-enrollments/verify',
      { challengeId, code }, { auth: 'none' }),

  activate: (password: string) =>
    client.post<ProviderEnrollmentActivation>('/api/v1/identity/provider-enrollments/activate',
      { password }, { auth: 'none' }),
}

export const staffApi = {
  login: (email: string, password: string, turnstileToken?: string) =>
    client.post<StaffSession>('/api/v1/auth/login', {
      email, password, turnstileToken, turnstileAction: 'staff-login',
    }, { auth: 'none' }),
  session: () => client.get<StaffSession>('/api/v1/auth/session', { auth: 'optional' }),
  refresh: () => client.post<StaffSession>('/api/v1/auth/refresh'),
  logout: () => client.post<null>('/api/v1/auth/logout'),
  selectFacility: (facilityId: string) =>
    client.post<StaffSession>('/api/v1/auth/facility', { facilityId }),

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

  encounters: (facilityId: string, patientId: string) =>
    client.get<Page<Encounter>>(patientPath(patientId), { query: { limit: 50 }, headers: facilityHeaders(facilityId) }),
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
  records: (facilityId: string, patientId: string, encounterId: string, kind: RecordKind) =>
    client.get<Page<ClinicalRecord>>(`${encounterPath(patientId, encounterId)}/${kind}`, { query: { limit: 50 }, headers: facilityHeaders(facilityId) }),
  createRecord: (facilityId: string, patientId: string, encounterId: string, kind: RecordKind, input: object, idempotencyKey?: string) =>
    client.post<ClinicalRecord>(`${encounterPath(patientId, encounterId)}/${kind}`, input,
      { headers: { ...facilityHeaders(facilityId), ...keyHeaders(idempotencyKey) } }),
  // A status PATCH: diagnoses have no status field and vitals are corrected, never patched.
  updateRecord: (facilityId: string, patientId: string, encounterId: string, kind: StatusRecordKind,
    recordId: string, input: { expectedRowVersion: number; changeReason: string; status: string }) =>
    client.request<ClinicalRecord>({ method: 'PATCH',
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
  documentDownload: (facilityId: string, documentId: string) =>
    client.get<{ url: string; expiresAt: string | null }>(`/api/v1/ehr/documents/${encodeURIComponent(documentId)}/download`,
      { headers: facilityHeaders(facilityId) }),
  async uploadDocument(facilityId: string, patientId: string, encounterId: string, file: File) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    const sha256Hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    const intent = await client.post<{
      document: { id: string }
      upload: { method: 'PUT'; url: string; requiredHeaders: Record<string, string>; expiresInSeconds: number }
    }>('/api/v1/ehr/documents/upload-intents', {
      patientId, encounterId, fileName: file.name, mediaType: file.type, sizeBytes: file.size,
      sha256Hex, classification: 'phi', retentionClass: 'clinical-10y',
    }, { headers: { ...facilityHeaders(facilityId), ...keyHeaders() } })
    await uploadPresignedObject({ url: intent.upload.url, body: file, requiredHeaders: intent.upload.requiredHeaders })
    await client.post(`/api/v1/ehr/documents/${encodeURIComponent(intent.document.id)}/complete`, undefined,
      { headers: facilityHeaders(facilityId) })
    return intent.document.id
  },

  labWorkItems: (facilityId: string) =>
    client.get<{ items: LabWorkItem[] }>('/api/v1/lab/work-items', { headers: facilityHeaders(facilityId) }),
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
  pharmacyWorkItems: (facilityId: string) =>
    client.get<{ items: PharmacyWorkItem[] }>('/api/v1/pharmacy/work-items', { headers: facilityHeaders(facilityId) }),
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
  confirmOcrPatient: (facilityId: string, job: OcrJob, patientId: string, reason: string) =>
    client.post<{ id: string; jobId: string; patientId: string; version: number }>(`/api/v1/ocr/jobs/${encodeURIComponent(job.id)}/patient-confirmation`,
      { patientId, expectedJobVersion: job.version, method: 'source_document', reason, purpose: 'healthcare-operations' },
      { headers: { ...facilityHeaders(facilityId, 'healthcare-operations'), ...keyHeaders() } }),
  ocrPublications: (facilityId: string, validationId: string) =>
    client.get<{ items: OcrPublication[] }>(`/api/v1/ocr/validations/${encodeURIComponent(validationId)}/publications`,
      { headers: facilityHeaders(facilityId) }),
  publishOcrValidation: (facilityId: string, validation: OcrValidation, patientConfirmationId: string,
    targetOperation: 'create_imported_clinical_note' | 'create_imported_lab_evidence' | 'create_imported_medication_evidence' | 'retain_validated_document') =>
    client.post<OcrPublication>(`/api/v1/ocr/validations/${encodeURIComponent(validation.id)}/publications`,
      { validationVersion: validation.version, patientConfirmationId, targetOperation, purpose: 'direct-care' },
      { headers: { ...facilityHeaders(facilityId), ...keyHeaders() } }),
  retryOcrJob: (facilityId: string, job: OcrJob, reason: string) =>
    client.post<OcrJob>(`/api/v1/ocr/jobs/${encodeURIComponent(job.id)}/retry`,
      { expectedVersion: job.version, reason, purpose: 'healthcare-operations' },
      { headers: facilityHeaders(facilityId, 'healthcare-operations') }),

  outreachCampaigns: (facilityId: string) =>
    client.get<OutreachCampaign[]>('/api/v1/outreach/registration-cases/campaigns', { headers: facilityHeaders(facilityId) }),
  outreachCampaignMembers: (facilityId: string, campaignId: string) =>
    client.get<OutreachCampaignMember[]>(`/api/v1/outreach/registration-cases/campaigns/${encodeURIComponent(campaignId)}/members`,
      { headers: facilityHeaders(facilityId) }),
  updateOutreachCampaignStatus: (facilityId: string, campaign: OutreachCampaign, status: 'active' | 'closed', reason: string) =>
    client.post<OutreachCampaign>(`/api/v1/outreach/registration-cases/campaigns/${encodeURIComponent(campaign.id)}/status`,
      { status, reason }, { headers: { ...facilityHeaders(facilityId), 'If-Match': String(campaign.rowVersion) } }),
  addOutreachCampaignMember: (facilityId: string, campaignId: string, membershipId: string,
    role: OutreachCampaignMember['role']) =>
    client.post<OutreachCampaignMember>(`/api/v1/outreach/registration-cases/campaigns/${encodeURIComponent(campaignId)}/members`,
      { membershipId, role }, { headers: facilityHeaders(facilityId) }),
  outreachCases: (facilityId: string) =>
    client.get<OutreachCase[]>('/api/v1/outreach/registration-cases', { headers: facilityHeaders(facilityId) }),
  linkExistingOutreachCase: (facilityId: string, registrationCase: OutreachCase, canonicalPatientId: string, reason: string) =>
    client.post<OutreachCase>(`/api/v1/outreach/registration-cases/${encodeURIComponent(registrationCase.id)}/link-existing`,
      { canonicalPatientId, expectedVersion: registrationCase.rowVersion, reason },
      { headers: { ...facilityHeaders(facilityId), ...keyHeaders() } }),
  createOutreachCampaign: (facilityId: string, input: { name: string; services: string[]; startsAt: string }) =>
    client.post<OutreachCampaign>('/api/v1/outreach/registration-cases/campaigns', input,
      { headers: facilityHeaders(facilityId) }),
  createOutreachCase: (facilityId: string, input: { campaignId?: string; fullName: string; sex: string; ageYears: number; phone?: string; operationalNotes?: string }) => {
    const localCommandId = crypto.randomUUID()
    return client.post<OutreachCase>('/api/v1/outreach/registration-cases',
      { ...input, localCommandId, temporaryPatientId: `tmp_${crypto.randomUUID()}` },
      { headers: { ...facilityHeaders(facilityId), 'Idempotency-Key': localCommandId } })
  },
}
