import {
  parseImportedHealthProfile, parseImportedHistory, parseImportedHistorySharing, parseImportedHistorySharingChange, parseImportedRecords,
  type ImportedAttachmentDownload, type ImportedHealthProfile, type ImportedHistoryPage, type ImportedHistorySharing,
  type ImportedHistorySharingChange, type ImportedMedicalRecord,
} from './importedRecords'
import { stagingChatQuestion, parseStagingPatientChat, parseStagingChatHistory } from '@hid/contracts'
import { NO_RETRY, type ApiClient, type DownloadResult, type HidApiError, type RequestSpec, type RetryPolicy } from '@hid/http'
import { createEhrService, createSupportService } from '@hid/api'
import { inRefreshTurn, refreshInTurn, signOutInTurn } from './sessionRefreshTurn'
import { ACCESS_LOG_PAGE_SIZE, parseAccessLog, type AccessLogPage } from './accessLog'
import {
  parseEmailChangeStarted, parseHealthProfile, parsePhoneChanged, parseProfileDetails,
  type EmailChangeStarted, type HealthFields, type HealthProfile, type PhoneChanged, type ProfileDetails,
} from './profileParity'
import { photoBody } from './photoImage'
import {
  parseShareInvitations, parseShareProviders,
  type ShareCreated, type ShareInput, type ShareInvitationConfirmed, type ShareInvitationCreated, type ShareInvitationInput,
  type ShareInvitationList, type ShareProvider, type ShareDuration, type ShareLevel,
} from './shareRecords'
import {
  parseWebPushRemoved, parseWebPushState, parseWebPushSubscribed,
  type WebPushState, type WebPushSubscribed, type WebPushSubscriptionInput,
} from './webPush'

export type { WebPushPushService, WebPushState, WebPushSubscribed, WebPushSubscriptionInput, WebPushSubscriptionItem } from './webPush'

/**
 * Contracts read from hid-system c4b5445 Identity and EHR controllers, and later
 * where a comment says; patient enrollment from hid-system main f9dbaf0.
 */
export interface PatientSession {
  actor: {
    // Patient and platform actors carry a kind; hid-system's staff actor carries none.
    kind?: 'patient' | 'platform'
    subject: string
    patientId?: string
    accountId: string
    authenticationMethod: 'local' | 'oidc'
  }
  expiresAt?: string
}

/**
 * What a NIN record lacks and the patient enters at activation (hid-system
 * ADR-061, on main since #82): named in every progress answer before
 * activation, in this order, `[]` for a complete record.
 */
export const ENROLLMENT_PROFILE_FIELDS = ['dateOfBirth', 'gender'] as const
export type EnrollmentProfileField = typeof ENROLLMENT_PROFILE_FIELDS[number]
/** The genders `POST .../activate` takes (hid-system patient-enrollment.dto.ts). */
export const ENROLLMENT_GENDERS = ['female', 'male', 'intersex', 'other', 'unknown'] as const
export type EnrollmentGender = typeof ENROLLMENT_GENDERS[number]
/** Sent only for the fields the record lacks; `dateOfBirth` as YYYY-MM-DD. */
export interface EnrollmentProfile { dateOfBirth?: string; gender?: EnrollmentGender }

/**
 * The online route at `verify_holder` (hid-system #84, ADR-062): whether a code
 * can be texted to the phone on the NIN record, and the open code's timing.
 */
export interface EnrollmentOnlineRoute {
  available: boolean
  challengeId?: string
  expiresInSeconds?: number
  resendAfterSeconds?: number
}
/**
 * The facility route at `verify_holder` (hid-system #85, ADR-063): whether it is
 * open, and the desk code this device shows at the facility, to its cookie only.
 */
export interface EnrollmentFacilityRoute {
  available: boolean
  deskCode?: string
  deskCodeExpiresAt?: string
}

/**
 * An enrollment's progress (hid-system main f9dbaf0). Since #84 every start
 * answers `verify_holder`, with `online` and `facility`; an Identity before it
 * answers `verify_contact`. `requiredProfileFields` comes only after the holder
 * proof (ADR-061, ADR-062).
 */
export interface EnrollmentProgress {
  stage: 'verify_holder' | 'verify_contact' | 'set_password' | 'active'
  expiresAt?: string
  contactChannel?: 'phone' | 'email'
  maskedContact?: string
  challengeId?: string
  expiresInSeconds?: number
  resendAfterSeconds?: number
  googleOnboardingRequired?: boolean
  googleOnboardingExpiresAt?: string
  hidCode?: string
  /**
   * The full name on the NIN record, before activation, so the person can check
   * that the NIN they typed is theirs (hid-system staging-novu-ci-20261005, an
   * owner decision). Absent from an Identity without it.
   */
  recordName?: string
  requiredProfileFields?: EnrollmentProfileField[]
  online?: EnrollmentOnlineRoute
  facility?: EnrollmentFacilityRoute
}

/**
 * GET .../availability (hid-system#68; since #84 `{ open, online, facility }`).
 * Only `open: true` lets a new enrollment start; `online` and `facility` say how
 * the NIN will be proved. An Identity before #84 sends `{ open }` only.
 */
export interface EnrollmentAvailability {
  open: boolean
  online?: boolean
  facility?: boolean
  /**
   * The sign-up without a NIN (an owner decision, 2026-10-27; hid-1.0's patient
   * sign-up): only `true` says Identity serves POST .../signup. Absent from an
   * Identity before it, which keeps the NIN-first enrollment.
   */
  signup?: boolean
}

/**
 * The genders the sign-up offers, as hid-1.0's did. Identity takes these and more
 * (hid-system patient-enrollment.dto.ts SIGNUP_GENDERS; 0092's sign-up check).
 */
export const SIGNUP_GENDERS = ['female', 'male', 'other'] as const
export type SignupGender = typeof SIGNUP_GENDERS[number]
/** The details step of the sign-up: no NIN, which the patient may verify later from their profile. */
export interface EnrollmentSignupDetails {
  firstName: string
  lastName: string
  email: string
  phone: string
  gender: SignupGender
  /** Free text, sent only when given. */
  hospitalCurrentlyUsing?: string
}

/** What the proposed identity/shared-cards/:token answers (BACKEND-NEEDS.md §2). */
export interface SharedCardAnswer {
  card: { fullName: string; hid: string; ninVerified: boolean | null; bloodGroup: string | null; genotype: string | null; allergies: string | null; photoUrl: string | null }
  sharedBy: string
  recipientEmail: string
  level: string
  duration: string
  expiresAt: string
  records: PatientRecords
}

/** What the patient enters for a record they add themselves (proposed: ehr/me/patient-entries). */
export interface OwnRecordInput {
  kind: 'visit' | 'test' | 'medicine' | 'diagnosis' | 'vaccination' | 'other'
  title: string
  facilityName: string | null
  occurredOn: string
  notes: string | null
  attachments: Array<{ fileName: string; mediaType: string; sizeBytes: number; contentBase64: string }>
}

/** A participating facility as the public list shows it (ADR-063): no id. */
export interface ParticipatingFacility {
  name: string
  addressLine?: string
  town: string
  lga: string
  state: string
  hours?: string
}
export interface ParticipatingFacilities {
  facilities: ParticipatingFacility[]
  /** Fixed lines from Identity, shown as sent. */
  whatToBring: string[]
}

export interface PatientProfile {
  patientId: string
  hid: string
  firstName: string
  lastName: string
  fullName: string
  dateOfBirth: string | null
  gender: string | null
  country: string | null
  state: string | null
  assuranceState: string | null
  accessPinConfigured: boolean
  version: number
  /** Whether a NIN is verified on this account; absent from an Identity before the sign-up without a NIN. */
  ninVerified?: boolean
  /**
   * hid-1.0 parity B3 (hid-system 0094; absent from an Identity before it): the account's email, which sign-in and
   * recovery use, and its phone, each null when there is none, whether each was verified (an email changed in the portal
   * is, by its code; one migrated from hid-1.0 may not be, and Health ID sends nothing to it; a phone changed in the
   * portal is not: production sends no SMS), and whether the patient has a photo. Held in memory only, shown masked.
   */
  email?: string | null
  emailVerified?: boolean
  phone?: string | null
  phoneVerified?: boolean
  hasPhoto?: boolean
}

export interface PatientNinVerification {
  entityType: 'patient'
  verificationType: 'nin'
  provider: 'qoreid'
  state: 'verified' | 'not_verified' | 'incomplete' | 'provider_error' | 'disabled'
  recordedAt: string
}

/** The seven sections of a record summary (INTERFACE_CONTRACT.md, Record summaries), in the order EHR names them. */
export type RecordSection = 'encounters' | 'notes' | 'vitals' | 'diagnoses' | 'prescriptions' | 'labRequests' | 'documents'

/**
 * GET /ehr/me/records (hid-system patient-records.service.ts readSelf). Since
 * hid-system #52 only encounters and signed notes are released to the patient:
 * `released` names them, `withheld` names the other five, whose arrays are then
 * always empty and mean "not released to you", never "no records". `limits` and
 * `truncated` say, per released section, the most rows it shows and whether
 * more exist. An EHR before #52 sends none of these four and every section.
 */
export interface PatientRecords {
  /** The staging branches' shape: imported history inside the records answer. hid-system main serves it at importedHistory instead. */
  importedRecords?: ImportedMedicalRecord[]
  /**
   * The staging branches' shape too (Novu, patient-records.service.ts): the health details a migrated patient kept
   * on hid-1.0, null for anyone else. hid-system main sends no such key.
   */
  importedHealthProfile?: ImportedHealthProfile | null
  encounters: Array<{ id: string; facilityId: string; encounterType: string; status: string; startedAt: string; endedAt: string | null }>
  notes: Array<{ id: string; encounterId: string; facilityId: string; noteType: string; title: string; status: string; revisionNo: number; content: string; signedAt: string | null }>
  vitals: Array<{ id: string; encounterId: string; facilityId: string; recordedAt: string; heightCm: number | null; weightKg: number | null; temperatureC: number | null; pulseBpm: number | null; respiratoryRate: number | null; systolicMmhg: number | null; diastolicMmhg: number | null; oxygenSaturationPercent: number | null; source: string }>
  diagnoses: Array<{ id: string; encounterId: string; facilityId: string; codeSystem: string; code: string; display: string; clinicalStatus: string; verificationStatus: string; onsetAt: string | null; abatementAt: string | null; notes: string | null }>
  prescriptions: Array<{ id: string; encounterId: string; facilityId: string; medicationCodeSystem: string | null; medicationCode: string | null; medicationDisplay: string; doseQuantity: number | null; doseUnit: string | null; routeCode: string | null; frequency: string; instructions: string; startsOn: string | null; endsOn: string | null; status: string }>
  labRequests: Array<{ id: string; encounterId: string; facilityId: string; testCodeSystem: string; testCode: string; testDisplay: string; priority: string; status: string; specimenTypeCode: string | null; clinicalInformation: string | null; externalOrderReference: string | null; createdAt: string }>
  documents: Array<{ id: string; encounterId: string | null; facilityId: string; fileName: string; mediaType: string; sizeBytes: number | string | null; classification: string; status: string; createdAt: string }>
  released?: RecordSection[]
  withheld?: RecordSection[]
  limits?: Partial<Record<RecordSection, number>>
  truncated?: Partial<Record<RecordSection, boolean>>
  /** The smallest section limit, 50 since hid-system #52 (100 before); `limits` and `truncated` say more. */
  limit: number
}

export interface AccessHistory {
  items: Array<{
    consentGrantId: string; scope: string; purpose: string; status: string; startsAt: string; expiresAt: string
    reason: string | null; facilityName: string
    /** Emergency (break-glass) access; never revocable by the patient. */
    breakGlass?: boolean
    /** The backend decides whether this patient may revoke the grant. */
    patientRevocable?: boolean
    /**
     * hid-1.0 parity B4 (hid-system 0095; absent from a backend before it): set only for a grant that came from the
     * patient's own share or a confirmed invitation, null otherwise.
     */
    shareLevel?: ShareLevel | null
    shareDuration?: ShareDuration | null
    clinicianName?: string | null
  }>
}

export type AccountDeletionState =
  | 'awaiting_confirmation' | 'pending' | 'blocked' | 'cancelled' | 'completed' | 'expired' | 'superseded'
export type AccountDeletionBlockedReason = 'LEGAL_HOLD' | 'RETENTION_POLICY_UNAVAILABLE' | 'WORKFORCE_ACCOUNT'

export interface AccountDeletionStatus {
  waitingPeriodSeconds: number
  confirmationTtlSeconds: number
  request: {
    requestId: string
    state: AccountDeletionState
    requestedAt: string
    confirmationExpiresAt: string | null
    scheduledFor: string | null
    blockedReasonCode: AccountDeletionBlockedReason | null
    cancelledAt: string | null
    cancellable: boolean
  } | null
}

export interface AccountDeletionRequested {
  requestId: string
  /** Single use and short lived; held in memory only. */
  confirmationToken: string
  confirmationExpiresAt: string
  waitingPeriodSeconds: number
}

export interface AccountDeletionConfirmed {
  requestId: string
  state: 'pending' | 'blocked' | 'completed'
  scheduledFor: string | null
  blockedReasonCode: AccountDeletionBlockedReason | null
}

export const EMERGENCY_CONTACT_RELATIONSHIPS = [
  'spouse', 'partner', 'parent', 'child', 'sibling', 'relative', 'guardian', 'caregiver', 'friend', 'other',
] as const
export type EmergencyContactRelationship = typeof EMERGENCY_CONTACT_RELATIONSHIPS[number]
export type EmergencyContactChannel = 'email' | 'sms'

export interface EmergencyContact {
  contactId: string
  name: string
  relationship: EmergencyContactRelationship
  channel: EmergencyContactChannel
  /** Masked by the backend; the full destination is never returned. */
  destinationHint: string
  status: 'unverified' | 'verified'
  verifiedAt: string | null
  notifyOnEmergencyAccess: boolean
  eligibleForEmergencyNotification: boolean
  version: number
  /** The open code, without its challenge (identity.list_my_emergency_contacts); a failed delivery closes it. */
  pendingVerification: { expiresAt: string; deliveryOutcome: 'pending' | 'accepted' | 'unknown' | string } | null
  /** The last alert; a pending one past its 24-hour window lists as expired. */
  lastNotification: { status: 'pending' | 'delivered' | 'failed' | 'expired' | 'suppressed' | string; createdAt: string } | null
}

/**
 * GET .../emergency-contacts/availability (hid-system #109; main does not serve it, 404): whether this patient can
 * add and verify contacts now, and on which channels. `delivery` is false while delivery is off or the account is
 * outside the pilot.
 */
export interface EmergencyContactsAvailability {
  delivery: boolean
  channels: EmergencyContactChannel[]
}

export interface AccessRequest {
  accessRequestId: string
  facilityId: string
  facilityName: string
  scope: string
  reason: string
  status: string
  requestedDurationMinutes: number
  requestedAt: string
  approvedAt: string | null
  deniedAt: string | null
  deniedReason: string | null
}

export interface PatientNotification {
  id: string
  notificationCode: string
  resourceType: string | null
  resourceId: string | null
  metadata: Record<string, unknown>
  readAt: string | null
  createdAt: string
}

/**
 * A lab request or prescription a clinician sent to a laboratory or pharmacy at another facility (Novu, P4c,
 * SPEC-FINAL §5, §10.1): GET /ehr/me/order-routes, newest first. `content` is every field sent (what the receiving
 * facility received, or will receive once it accepts); `attestationText` is the clinician's confirmation that the
 * patient agreed, as they confirmed it, with {patient}, {orderingFacility} and {receivingFacility} for the page to
 * fill. `actions` holds 'withdraw' (Stop) only while the receiving facility has not accepted it. `endedKind` says who or
 * what ended it; since the wrong-patient report (hid-system 0088, item 3) also `wrong_patient`: the receiving facility
 * reports it accepted the order for someone who was not the patient (cancelled, or completed with `endedAt` once
 * something had come back and was withdrawn); the content stays in full (D13) and `actions` is empty. Since D18
 * (hid-system 0091) also `receiving_unable` on a cancelled route: the receiving facility accepted it and could not
 * complete it (the patient is not told why, D18-4).
 */
export interface PatientOrderRoute {
  id: string
  reference: string | null
  kind: 'lab_request' | 'prescription'
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
  orderingFacilityName: string | null
  receivingFacilityName: string | null
  receivingRegisteredAddress: string | null
  content: Record<string, string | number | null>
  attestationTextVersion: string | null
  attestationText: string | null
  attestedByName: string | null
  actions: Array<'withdraw' | string>
  /**
   * The order was marked entered in error (it may have been written in another patient's chart; P4c review): the
   * route stays listed as the record of what went where, but `content` holds only its reference, the attestation text
   * and attesting clinician are null and `actions` is empty. Absent from a backend before that review.
   */
  enteredInError?: boolean
  /**
   * D17 (hid-system 0090; absent from an earlier backend): the receiving facility's report that it accepted the order for
   * someone who was not the patient, in its window or after the order had ended (`late`), whatever the order's ending;
   * null when there is none. Read only when its type is right.
   */
  wrongPatient?: { reportedAt: string; late: boolean } | null
  /**
   * D17 (absent from an earlier backend): until when the receiving facility may still correct it (withdraw what it
   * recorded on it), while it may; null once it can't.
   */
  correctableUntil?: string | null
}

/**
 * POST .../activate's answer, for the sign-up without a NIN and the NIN route alike. `signedIn: true` (hid-system,
 * owner decision 2026-10-28): the answer also set the cookies a patient sign-in sets, and made its session, for the
 * browser that holds the enrollment's cookie, once. Absent from an Identity before it, and false for a replayed
 * activation or when no session could be made: the patient then signs in. It names no actor, so the session is
 * read before it is taken up (session.tsx, takeUpActivatedSession).
 */
export interface EnrollmentActivation {
  stage: 'active'
  hidCode: string
  signedIn?: boolean
}

/**
 * A notification carried over from the patient's hid-1.0 account (hid-system 0062, served on
 * staging-novu-ci-20261005): its own title and message, as hid-1.0 wrote them, shown as plain text only. Each list and
 * each read is audited, so the list is read once per visit and never polled.
 */
export interface ImportedNotification {
  id: string
  title: string
  message: string
  type: string | null
  readAt: string | null
  createdAt: string
}

const text = (value: unknown, limit: number): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, limit) : null

/** The imported list as shown: a row without an id or a time is left out. */
export function parseImportedNotifications(value: unknown): ImportedNotification[] {
  if (!Array.isArray(value)) throw new Error('Your hid-1.0 notifications could not be read.')
  return value.flatMap((entry): ImportedNotification[] => {
    if (typeof entry !== 'object' || entry === null) return []
    const row = entry as Record<string, unknown>
    const id = text(row.id, 100), createdAt = text(row.createdAt, 64)
    if (!id || !createdAt) return []
    return [{ id, createdAt, title: text(row.title, 300) ?? '', message: text(row.message, 4000) ?? '', type: text(row.type, 50),
      readAt: text(row.readAt, 64) }]
  })
}

/** The most imported notifications one read lists (Identity takes 1 to 100). */
export const IMPORTED_NOTIFICATIONS_PAGE = 100

export interface RecoveryChallenge {
  accepted: true
  challengeId: string
  deliveryChannels: ['email', 'sms']
  expiresInSeconds: number
  resendAfterSeconds: number
}

export function createPatientApi(sender: ApiClient) {
  // Told each time a request that needs the session is answered: the browser's sign-in is live, perhaps just renewed
  // by that request's refresh. The bell (notificationBadge.tsx) reads again then, after readings it held back on a 401.
  const accepted = new Set<() => void>()
  const client: ApiClient = {
    ...sender,
    async request<T>(spec: RequestSpec): Promise<T> {
      const answer = await sender.request<T>(spec)
      if ((spec.auth ?? 'required') === 'required') {
        for (const listener of [...accepted]) {
          try { listener() } catch { /* a listener's own fault never fails the request */ }
        }
      }
      return answer
    },
    get: (path, spec) => client.request({ ...spec, method: 'GET', path }),
    post: (path, body, spec) => client.request({ ...spec, method: 'POST', path, body }),
  }
  const call = <T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown,
    options?: { signal?: AbortSignal; headers?: Readonly<Record<string, string>>; query?: Readonly<Record<string, string>>; reportUnauthorized?: boolean; timeoutMs?: number
      refreshOnUnauthorized?: (error: HidApiError) => boolean; retry?: RetryPolicy; responseType?: 'json' | 'download' }) =>
    client.request<T>({ method, path: `/api/v1/${path}`, auth: path.startsWith('auth/') || path.startsWith('identity/patient-enrollments') ? 'optional' : 'required',
      ...(body === undefined ? {} : { body }), ...options })

  // A question about the session, and a refresh, judge their own 401: it may mean
  // only an expired access token, which the refresh restores. The client's
  // onUnauthorized is left to the final 401 of every other request.
  const judged = { reportUnauthorized: false } as const

  const chatService = createEhrService({ app: 'patient-web', client })

  return {
    /** Calls `listener` each time a request that needs the session is answered; returns the way to stop. */
    onSessionAccepted: (listener: () => void): (() => void) => {
      accepted.add(listener)
      return () => { accepted.delete(listener) }
    },
    // Retained Novu backend: real ready/preparing replies, 10 exchanges/30 days,
    // source reads and a 500-character question. No main-only notice endpoint.
    novuChat: async (question: string, signal?: AbortSignal) =>
      parseStagingPatientChat(await call<unknown>('POST', 'ehr/me/chat',
        { question: stagingChatQuestion(question) }, { signal, timeoutMs: 65_000 })),
    novuChatHistory: async (signal?: AbortSignal) =>
      parseStagingChatHistory(await call<unknown>('GET', 'ehr/me/chat/history', undefined, { signal })),
    clearNovuChatHistory: async (signal?: AbortSignal): Promise<{ cleared: true }> => {
      const answer = await call<{ cleared?: unknown }>('DELETE', 'ehr/me/chat/history', undefined, { signal })
      if (answer?.cleared !== true) throw new Error('The conversation could not be cleared.')
      return { cleared: true }
    },
    // Patient record chat (hid-system #95, ADR-068): the service's own methods, parsed against its contract.
    chatAvailability: chatService.chatAvailability,
    chat: chatService.chat,
    chatHistory: (signal?: AbortSignal) => chatService.chatHistory({ signal }),
    clearChatHistory: (signal?: AbortSignal) => chatService.clearChatHistory({ signal }),
    // The staging branches' source-record read; hid-system main does not serve it. Kept for ChatSource.tsx.
    chatSource: (kind: string, id: string, signal?: AbortSignal) => call<Record<string, unknown>>('GET',
      `ehr/me/chat/sources/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, undefined, { signal }),
    // Imported legacy medical history (#94, ADR-067): its own route, a page at a time, and the patient's sharing choice.
    importedHistory: async (cursor?: string | null, signal?: AbortSignal): Promise<ImportedHistoryPage> =>
      parseImportedHistory(await call<unknown>('GET', 'ehr/me/imported-history', undefined, { signal, ...(cursor ? { query: { cursor } } : {}) }), false),
    importedHistorySharing: async (signal?: AbortSignal): Promise<ImportedHistorySharing> =>
      parseImportedHistorySharing(await call<unknown>('GET', 'identity/me/imported-history-sharing', undefined, { signal })),
    setImportedHistorySharing: async (shared: boolean, signal?: AbortSignal): Promise<ImportedHistorySharingChange> =>
      parseImportedHistorySharingChange(await call<unknown>('POST', 'identity/me/imported-history-sharing', { shared }, { signal })),
    supportChat: createSupportService({ app: 'patient-web', client }).chat,
    session: () => call<PatientSession>('GET', 'auth/session', undefined, judged),
    // Windows of the portal take turns to refresh; one that waited reads the session
    // first, and takes only a patient's as restored: a provider's is refreshed, and refused.
    refresh: () => refreshInTurn(
      () => call<PatientSession>('GET', 'auth/session', undefined, judged).then(session => session?.actor?.kind === 'patient' ? session : null, () => null),
      () => call<PatientSession>('POST', 'auth/refresh', undefined, judged)),
    // A sign-in waits for another window's refresh, whose answer would otherwise replace its cookies.
    login: (email: string, password: string, turnstileToken: string) =>
      inRefreshTurn(() => call<PatientSession>('POST', 'auth/patient/login', { email, password, turnstileAction: 'patient-login', turnstileToken })),
    // Signing out takes the same turn, and ends the session only while the browser
    // still holds this patient's. The portal hears other windows sign in on the
    // session-change channel, but a browser without the channel, or an
    // announcement still on its way, says nothing, so it always asks. A refused
    // question is handled as a refused sign-out. The sign-out judges the 401 of
    // either call (session.tsx restores the session and signs out again), so the
    // tab is not signed out here while the server session may still be live.
    logout: (subject: string | undefined) => signOutInTurn(() => call<PatientSession>('GET', 'auth/session', undefined, judged).then(
      session => session.actor?.kind === 'patient' && subject !== undefined && session.actor.subject === subject),
    () => call<void>('POST', 'auth/logout', undefined, judged), { alwaysAsk: true }),
    googleNonce: () => call<{ nonce: string }>('GET', 'auth/google/nonce'),
    googleExchange: (idToken: string, turnstileToken: string, intent: 'sign_in' | 'enroll') =>
      inRefreshTurn(() => call<PatientSession | { stage: 'GOOGLE_AUTHENTICATED_PENDING_IDENTITY'; expiresAt: string }>(
        'POST', 'auth/oidc/exchange', { idToken, turnstileToken, turnstileAction: 'patient-login', intent })),
    googleOnboarding: () => call<{ stage: 'GOOGLE_AUTHENTICATED_PENDING_IDENTITY'; expiresAt: string }>('GET', 'auth/google/onboarding'),
    enrollmentCurrent: () => call<EnrollmentProgress>('GET', 'identity/patient-enrollments/current'),
    // hid-system#68 (FE-4): whether a start would pass its checks made before a NIN is read.
    // Only `{ open: true }` means open (INTERFACE_CONTRACT.md, public patient enrollment).
    enrollmentAvailability: () => call<EnrollmentAvailability>('GET', 'identity/patient-enrollments/availability'),
    /**
     * A record the patient adds themselves (a visit, a result, a medicine), with where it happened and photos or files of
     * the paper. PROPOSED: no backend serves it yet (logged in dev/mock-gateway/backend-needs and BACKEND-NEEDS.md); until
     * one does it answers 404, and the page says nothing was saved. Kept as "added by you", never as a clinician's.
     */
    addOwnRecord: (entry: OwnRecordInput, signal?: AbortSignal) => call<{ id: string }>('POST', 'ehr/me/patient-entries', entry, { signal }),
    /**
     * The card a provider opens from the email a patient's share sends (PROPOSED, BACKEND-NEEDS.md §2): the patient's card
     * and the records the share allows, for as long as the share lasts. No session: the link's token is the access.
     */
    sharedCard: (token: string, signal?: AbortSignal) => call<SharedCardAnswer>('GET', `identity/shared-cards/${encodeURIComponent(token)}`, undefined, { signal }),
    // ADR-063: public, by name and place only. Empty while the facility route is off.
    participatingFacilities: () => call<ParticipatingFacilities>('GET', 'identity/patient-enrollments/participating-facilities'),
    enrollmentStart: (nin: string, turnstileToken: string, idempotencyKey: string) =>
      call<EnrollmentProgress>('POST', 'identity/patient-enrollments', { nin, turnstileAction: 'patient-enrollment', turnstileToken },
        { headers: { 'Idempotency-Key': idempotencyKey } }),
    // The sign-up without a NIN: the details and the security check; the answer is verify_contact, with a code
    // sent to the email. A fresh Idempotency-Key per attempt. Its code is sent again with enrollmentContact.
    enrollmentSignup: (details: EnrollmentSignupDetails, turnstileToken: string, idempotencyKey: string) =>
      call<EnrollmentProgress>('POST', 'identity/patient-enrollments/signup', {
        firstName: details.firstName, lastName: details.lastName, email: details.email, phone: details.phone, gender: details.gender,
        ...(details.hospitalCurrentlyUsing ? { hospitalCurrentlyUsing: details.hospitalCurrentlyUsing } : {}),
        termsAccepted: true, turnstileToken, turnstileAction: 'patient-enrollment',
      }, { headers: { 'Idempotency-Key': idempotencyKey } }),
    enrollmentBindGoogle: () => call<{ bound: true }>('POST', 'identity/patient-enrollments/google'),
    // The NIN holder step (ADR-062): no body; the code goes to the phone on the NIN record, never one typed here.
    enrollmentHolderCode: () =>
      call<{ challengeId: string; expiresInSeconds: number; resendAfterSeconds: number }>('POST', 'identity/patient-enrollments/holder'),
    enrollmentHolderVerify: (challengeId: string, code: string) =>
      call<{ stage: 'verify_contact'; requiredProfileFields?: EnrollmentProfileField[] }>('POST', 'identity/patient-enrollments/holder/verify', { challengeId, code }),
    // The facility route (ADR-063): no body; the answer is the verify_holder progress with the desk code.
    enrollmentFacilityCode: () => call<EnrollmentProgress>('POST', 'identity/patient-enrollments/facility-code'),
    enrollmentContact: (channel: 'email' | 'phone', contact: string) =>
      call<{ challengeId: string; expiresInSeconds: number; resendAfterSeconds: number }>('POST', 'identity/patient-enrollments/contact', { channel, contact }),
    enrollmentVerify: (challengeId: string, code: string) =>
      call<{ stage: 'set_password'; requiredProfileFields?: EnrollmentProfileField[] }>('POST', 'identity/patient-enrollments/contact/verify', { challengeId, code }),
    // A field is sent only when given (ADR-061: one the NIN record provides is refused). Activation may sign the
    // patient in (`signedIn`), so it waits for another window's refresh, as a sign-in does: that refresh's answer
    // would otherwise replace or clear the new session's cookies.
    enrollmentActivate: (password: string, profile: EnrollmentProfile = {}) =>
      inRefreshTurn(() => call<EnrollmentActivation>('POST', 'identity/patient-enrollments/activate', {
        password,
        ...(profile.dateOfBirth === undefined ? {} : { dateOfBirth: profile.dateOfBirth }),
        ...(profile.gender === undefined ? {} : { gender: profile.gender }),
      })),
    recoveryStart: (identifier: string, turnstileToken: string) =>
      call<RecoveryChallenge>('POST', 'auth/otp/start', { identifier, purpose: 'PASSWORD_RESET', turnstileAction: 'patient-reset-start', turnstileToken }),
    recoveryVerify: (challengeId: string, code: string) =>
      call<{ verified: true; challengeId: string; verificationToken: string }>('POST', 'auth/otp/verify', { challengeId, code, purpose: 'PASSWORD_RESET' }),
    recoveryComplete: (challengeId: string, verificationToken: string, newPassword: string) =>
      call<{ completed: true }>('POST', 'auth/otp/complete', { challengeId, verificationToken, newPassword, purpose: 'PASSWORD_RESET' }),
    profile: (signal?: AbortSignal) => call<PatientProfile>('GET', 'identity/me', undefined, { signal }),
    // The date of birth is checked against the NIN record; an account made without a NIN has none on its profile.
    verifyNin: (nin: string, dateOfBirth: string) =>
      call<PatientNinVerification>('POST', 'identity/me/verification/nin', { nin, dateOfBirth }),
    records: async (signal?: AbortSignal) => {
      const value = await call<PatientRecords>('GET', 'ehr/me/records', undefined, { signal })
      // Only the staging branches' answer carries importedRecords; main's does not (it keeps exactly its keys).
      if (value.importedRecords !== undefined) value.importedRecords = parseImportedRecords(value.importedRecords)
      if (value.importedHealthProfile !== undefined) value.importedHealthProfile = parseImportedHealthProfile(value.importedHealthProfile)
      return value
    },
    importedAttachment: (id: string, signal?: AbortSignal) => call<ImportedAttachmentDownload>('GET',
      `ehr/me/imported-attachments/${encodeURIComponent(id)}/download`, undefined, { signal }),
    accessHistory: (signal?: AbortSignal) => call<AccessHistory>('GET', 'identity/me/access-history', undefined, { signal }),
    // hid-1.0 parity B4 (hid-system 0095 on Novu; a backend before it, or with sharing off, answers 404). The search
    // text goes in a POST body, never an address. Sharing gives access, so it takes an Idempotency-Key made once per
    // confirm and reused when that confirm is sent again; so does an invitation.
    searchShareProviders: async (query: string, signal?: AbortSignal): Promise<ShareProvider[]> =>
      parseShareProviders(await call<unknown>('POST', 'identity/me/share-providers/search', { query }, { signal })),
    createShare: (body: ShareInput, idempotencyKey: string) => call<ShareCreated>('POST', 'identity/me/shares',
      { membershipId: body.membershipId, level: body.level, duration: body.duration }, { headers: { 'Idempotency-Key': idempotencyKey } }),
    // The probe for sharing: 200 means served, 404 not.
    shareInvitations: async (signal?: AbortSignal): Promise<ShareInvitationList> =>
      parseShareInvitations(await call<unknown>('GET', 'identity/me/share-invitations', undefined, { signal })),
    createShareInvitation: (body: ShareInvitationInput, idempotencyKey: string) => call<ShareInvitationCreated>('POST',
      'identity/me/share-invitations', { email: body.email, ...(body.name ? { name: body.name } : {}), level: body.level, duration: body.duration },
      { headers: { 'Idempotency-Key': idempotencyKey } }),
    cancelShareInvitation: (invitationId: string) => call<{ invitationId: string; status: 'cancelled'; replayed: boolean }>('POST',
      `identity/me/share-invitations/${encodeURIComponent(invitationId)}/cancel`),
    confirmShareInvitation: (invitationId: string) => call<ShareInvitationConfirmed>('POST',
      `identity/me/share-invitations/${encodeURIComponent(invitationId)}/confirm`),
    // Patient-owned revocation; the staff `consent-grants/:id/close` route is not a patient route.
    revokeAccess: (grantId: string, reason: string) => call<{ consentGrantId: string; status: 'revoked'; replayed: boolean }>(
      'POST', `identity/me/consent-grants/${encodeURIComponent(grantId)}/revoke`, { reason }),
    // The patient's own decisions carry no purpose of use: Identity binds them to the
    // patient session, and would audit a purpose header as the purpose of the decision.
    accessRequests: (signal?: AbortSignal) => call<AccessRequest[]>('GET', 'identity/me/access-requests', undefined, { signal }),
    approveAccess: (id: string) => call<unknown>('POST', `identity/access-requests/${encodeURIComponent(id)}/approve`),
    denyAccess: (id: string, reason: string) => call<unknown>('POST', `identity/access-requests/${encodeURIComponent(id)}/deny`, { reason }),
    notifications: (signal?: AbortSignal) => call<PatientNotification[]>('GET', 'identity/me/notifications', undefined, { signal }),
    // Orders a clinician sent to another facility (Novu, P4c): hid-system main, and a Novu before it, answer 404.
    orderRoutes: (signal?: AbortSignal) => call<{ items: PatientOrderRoute[] }>('GET', 'ehr/me/order-routes', undefined, { signal }),
    // Stop, before the receiving facility accepts it: the patient's only action on an order sent elsewhere.
    stopOrderRoute: (route: Pick<PatientOrderRoute, 'id' | 'version'>) => call<{ route: PatientOrderRoute }>('POST',
      `ehr/me/order-routes/${encodeURIComponent(route.id)}/withdraw`, { expectedVersion: route.version }),
    markNotificationRead: (id: string) => call<{ id: string; readAt: string }>('POST', `identity/me/notifications/${encodeURIComponent(id)}/read`),
    /**
     * The bell's count (hid-system 0093; an Identity before it answers 404): unread inbox items and unread imported
     * hid-1.0 notifications. Never retried, and its 401 never signs the patient out: the next reading comes soon.
     * Without `refresh` (a reading on the minute) an expired access token is not refreshed either, so a page left
     * open does not keep the sign-in alive.
     */
    unreadNotificationCount: async ({ refresh, signal }: { refresh: boolean; signal?: AbortSignal }): Promise<number> => {
      const answer = await call<{ unread?: unknown }>('GET', 'identity/me/notifications/unread-count', undefined, {
        signal, reportUnauthorized: false, retry: NO_RETRY, ...(refresh ? {} : { refreshOnUnauthorized: () => false }) })
      const unread = answer?.unread
      if (typeof unread !== 'number' || !Number.isFinite(unread) || unread < 0) throw new Error('The unread count could not be read.')
      return Math.floor(unread)
    },
    // The patient's hid-1.0 notifications (hid-system 0062): a page from `offset`, newest first; each read is audited.
    importedNotifications: async (offset = 0, signal?: AbortSignal): Promise<ImportedNotification[]> =>
      parseImportedNotifications(await call<unknown>('GET', 'identity/me/imported-notifications', undefined,
        { signal, query: { limit: String(IMPORTED_NOTIFICATIONS_PAGE), offset: String(offset) } })),
    markImportedNotificationRead: (id: string) => call<{ id: string; readAt: string | null }>('POST',
      `identity/me/imported-notifications/${encodeURIComponent(id)}/read`),
    // Who viewed or changed the patient's record (hid-system 0093; an Identity before it answers 404), newest first.
    accessLog: async (before: string | null, signal?: AbortSignal): Promise<AccessLogPage> =>
      parseAccessLog(await call<unknown>('GET', 'identity/me/access-log', undefined,
        { signal, query: { limit: String(ACCESS_LOG_PAGE_SIZE), ...(before ? { before } : {}) } })),
    // hid-1.0 parity B3 (hid-system 0094 on staging-novu-ci-20261005; a backend before it answers 404). The hospital the
    // patient uses now and their HMO, saved against the version read; a stale one is refused with 409 VERSION_CONFLICT.
    profileDetails: async (signal?: AbortSignal): Promise<ProfileDetails> =>
      parseProfileDetails(await call<unknown>('GET', 'identity/me/profile-details', undefined, { signal })),
    saveProfileDetails: async (input: { hospitalCurrentlyUsing: string | null; hmoName: string | null; expectedVersion: number }): Promise<ProfileDetails> =>
      parseProfileDetails(await call<unknown>('PUT', 'identity/me/profile-details', input)),
    /**
     * The patient's photo as bytes, to be shown through a blob: URL held in memory only (Identity answers it with
     * Cache-Control: private, no-store). Only a JPEG or PNG is taken; anything else is refused as no photo.
     */
    photo: async (signal?: AbortSignal): Promise<Blob> => {
      const answer = await call<DownloadResult>('GET', 'identity/me/photo', undefined, { signal, responseType: 'download' })
      const type = (answer.headers.get('content-type') ?? answer.blob.type).split(';')[0]?.trim().toLowerCase()
      if (type !== 'image/jpeg' && type !== 'image/png') throw new Error('Your photo could not be shown.')
      return answer.blob.type === type ? answer.blob : new Blob([answer.blob], { type })
    },
    // Always the JPEG the page drew from the chosen picture, base64, with no metadata, in a body made to pass
    // production's 8 KB edge limit (photoImage.ts).
    savePhoto: (data: string) => call<{ hasPhoto: true }>('PUT', 'identity/me/photo', photoBody(data)),
    removePhoto: () => call<{ hasPhoto: false }>('DELETE', 'identity/me/photo'),
    // A new email needs the current password and a 6-digit code sent to it; the old address is told.
    startEmailChange: async (email: string, currentPassword: string): Promise<EmailChangeStarted> =>
      parseEmailChangeStarted(await call<unknown>('POST', 'identity/me/contact-changes', { channel: 'email', email, currentPassword })),
    verifyEmailChange: (changeId: string, code: string) =>
      call<{ email: string }>('POST', `identity/me/contact-changes/${encodeURIComponent(changeId)}/verify`, { code }),
    // A new phone needs the current password only, and is then shown as not verified: production sends no SMS.
    changePhone: async (phone: string, currentPassword: string): Promise<PhoneChanged> =>
      parsePhoneChanged(await call<unknown>('POST', 'identity/me/contact-changes', { channel: 'phone', phone, currentPassword }), phone),
    // What the patient says about their health, apart from clinicians' records; saved against the version read.
    healthProfile: async (signal?: AbortSignal): Promise<HealthProfile> =>
      parseHealthProfile(await call<unknown>('GET', 'ehr/me/health-profile', undefined, { signal })),
    saveHealthProfile: async (input: HealthFields & { expectedVersion: number }): Promise<HealthProfile> =>
      parseHealthProfile(await call<unknown>('PUT', 'ehr/me/health-profile', input)),
    setAccessPin: (pin: string) => call<{ configured: true }>('POST', 'identity/me/access-pin', { pin }),
    revokeAccessPin: () => call<{ revoked: true }>('DELETE', 'identity/me/access-pin'),
    // "Notifications on this device" (hid-system 0097, B6; contract b6-contract.md §3). All three answer 404 on a backend
    // before 0097 and while push is not configured: the Notifications page then shows nothing. The endpoint goes in a body, never an
    // address; the subscribe body stays far under production's 8 KB edge limit (an endpoint is at most 2048 characters).
    webPush: async (signal?: AbortSignal): Promise<WebPushState> =>
      parseWebPushState(await call<unknown>('GET', 'identity/me/web-push', undefined, { signal })),
    saveWebPushSubscription: async (input: WebPushSubscriptionInput): Promise<WebPushSubscribed> =>
      parseWebPushSubscribed(await call<unknown>('PUT', 'identity/me/web-push/subscription', {
        endpoint: input.endpoint, expirationTime: input.expirationTime, keys: { p256dh: input.keys.p256dh, auth: input.keys.auth }, keyId: input.keyId,
      })),
    // Never rate limited: turning off must always work. Sign-out sends it with its own options (session.tsx).
    removeWebPushSubscription: async (endpoint: string, options: { signal?: AbortSignal; reportUnauthorized?: boolean; retry?: RetryPolicy
      refreshOnUnauthorized?: (error: HidApiError) => boolean; timeoutMs?: number } = {}): Promise<{ removed: boolean }> =>
      parseWebPushRemoved(await call<unknown>('POST', 'identity/me/web-push/subscription/remove', { endpoint }, options)),
    accountDeletionStatus: (signal?: AbortSignal) =>
      call<AccountDeletionStatus>('GET', 'identity/me/account-deletion', undefined, { signal }),
    requestAccountDeletion: () => call<AccountDeletionRequested>('POST', 'identity/me/account-deletion'),
    confirmAccountDeletion: (requestId: string, confirmationToken: string, confirmation: string) =>
      call<AccountDeletionConfirmed>('POST', 'identity/me/account-deletion/confirm', { requestId, confirmationToken, confirmation }),
    cancelAccountDeletion: (requestId: string) =>
      call<{ requestId: string; state: 'cancelled'; replayed: boolean }>('POST', 'identity/me/account-deletion/cancel', { requestId }),
    // Emergency contacts: hid-system main's patient-safety controller (services/identity-api/src/patient-safety,
    // emergency-contact.controller.ts and .service.ts), served on Novu (staging-novu-ci-20261005) by hid-system #109
    // under the same paths and answers. #109 adds the availability read, and refuses adding a contact and sending a
    // code with 409 EMERGENCY_CONTACT_DELIVERY_UNAVAILABLE while delivery is off for the patient.
    emergencyContactsAvailability: (signal?: AbortSignal) =>
      call<EmergencyContactsAvailability>('GET', 'identity/me/emergency-contacts/availability', undefined, { signal }),
    emergencyContacts: (signal?: AbortSignal) =>
      call<EmergencyContact[]>('GET', 'identity/me/emergency-contacts', undefined, { signal }),
    addEmergencyContact: (input: { name: string; relationship: EmergencyContactRelationship; channel: EmergencyContactChannel;
      destination: string; notifyOnEmergencyAccess: boolean }) =>
      call<EmergencyContact>('POST', 'identity/me/emergency-contacts', input),
    updateEmergencyContact: (contactId: string, input: { expectedVersion: number; name?: string;
      relationship?: EmergencyContactRelationship; notifyOnEmergencyAccess?: boolean }) =>
      call<EmergencyContact>('POST', `identity/me/emergency-contacts/${encodeURIComponent(contactId)}`, input),
    deactivateEmergencyContact: (contactId: string) =>
      call<{ contactId: string; status: 'deactivated'; replayed: boolean }>(
        'POST', `identity/me/emergency-contacts/${encodeURIComponent(contactId)}/deactivate`),
    sendEmergencyContactVerification: (contactId: string) =>
      call<{ challengeId: string; expiresAt: string; deliveryOutcome: 'accepted' | 'unknown' | string }>(
        'POST', `identity/me/emergency-contacts/${encodeURIComponent(contactId)}/verification`),
    confirmEmergencyContactVerification: (contactId: string, challengeId: string, code: string) =>
      call<{ contactId: string; status: 'verified' }>(
        'POST', `identity/me/emergency-contacts/${encodeURIComponent(contactId)}/verification/confirm`, { challengeId, code }),
  }
}

export type PatientApi = ReturnType<typeof createPatientApi>
