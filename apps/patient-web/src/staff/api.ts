import { createApiClient, HidApiError, isHidApiError, uploadPresignedObject, type ApiClient, type RequestSpec } from '@hid/http'
import { createRegisteredBrowserClient } from '@hid/api'
import { getEnvironment } from './env'
import {
  assertStaffSessionFacility, endsStaffSession, nextStaffSessionChange, refusedAsPatient, reportStaffSessionEnded, reportStaffSessionRead,
  staffSessionActor, staffSessionGeneration, staffSessionReadyFor, staffSessionSignal, untilStaffSessionReady,
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
        // A 403 is reported only when it says the session is a patient's; the server is then asked.
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
 * this portal never rotates, 403 SESSION_CLIENT_MISMATCH. Nothing can restore
 * the session then, so it is reported as the ended session it is.
 */
function refreshStaffSession(): Promise<StaffSession> {
  refreshing ??= refreshInTurn(
    () => client.get<StaffSession>('/api/v1/auth/session', { auth: 'optional', dedupe: false })
      .then(session => typeof session?.actor?.id === 'string' ? session : null, () => null),
    () => client.post<StaffSession>('/api/v1/auth/refresh'))
    .catch((error: unknown) => {
      if (isHidApiError(error) && error.status === 403 && error.code === 'CSRF_VALIDATION_FAILED') throw sessionEnded(error)
      if (heldByOtherPortal(error)) throw sessionEnded(error)
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

  // Activation signs the new administrator in, so it takes the session turn as sign-ins do.
  activate: (password: string) => inRefreshTurn(() =>
    client.post<ProviderEnrollmentActivation>('/api/v1/identity/provider-enrollments/activate',
      { password }, { auth: 'none' })),
}

export const staffApi = {
  login: async (email: string, password: string, turnstileToken?: string) => {
    await Promise.all([leaving, refreshing?.catch(() => undefined)])
    // Nor may another window's refresh answer after it: its cookies would replace this sign-in's.
    return inRefreshTurn(() => client.post<StaffSession>('/api/v1/auth/login', {
      email, password, turnstileToken, turnstileAction: staffLoginAction(window.location.hostname),
    }, { auth: 'none' }))
  },
  session: () => client.get<StaffSession>('/api/v1/auth/session', { auth: 'optional' }),
  refresh: () => refreshStaffSession(),
  logout: signOut,
  checkSession: checkStaffSession,
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
  records: (facilityId: string, patientId: string, encounterId: string, kind: RecordKind, page: PageRequest = {}) =>
    client.get<Page<ClinicalRecord>>(`${encounterPath(patientId, encounterId)}/${kind}`, { ...pageQuery(page), headers: facilityHeaders(facilityId) }),
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
    await uploadPresignedObject({ url: intent.upload.url, body: file, requiredHeaders: intent.upload.requiredHeaders, signal })
    await untilStaffSessionReady(sentIn)
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
  confirmOcrPatient: (facilityId: string, job: OcrJob, patientId: string, reason: string, idempotencyKey?: string) =>
    client.post<{ id: string; jobId: string; patientId: string; version: number }>(`/api/v1/ocr/jobs/${encodeURIComponent(job.id)}/patient-confirmation`,
      { patientId, expectedJobVersion: job.version, method: 'source_document', reason, purpose: 'healthcare-operations' },
      { headers: { ...facilityHeaders(facilityId, 'healthcare-operations'), ...keyHeaders(idempotencyKey) } }),
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
