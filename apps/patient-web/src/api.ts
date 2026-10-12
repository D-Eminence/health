import type { ApiClient } from '@hid/http'
import { inRefreshTurn, refreshInTurn, signOutInTurn } from './sessionRefreshTurn'

/** Contracts read from hid-system c4b5445 Identity and EHR controllers. */
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

export interface EnrollmentProgress {
  stage: 'verify_contact' | 'set_password' | 'active'
  expiresAt?: string
  contactChannel?: 'phone' | 'email'
  maskedContact?: string
  challengeId?: string
  expiresInSeconds?: number
  resendAfterSeconds?: number
  googleOnboardingRequired?: boolean
  googleOnboardingExpiresAt?: string
  hidCode?: string
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
}

export interface PatientNinVerification {
  entityType: 'patient'
  verificationType: 'nin'
  provider: 'qoreid'
  state: 'verified' | 'not_verified' | 'incomplete' | 'provider_error' | 'disabled'
  recordedAt: string
}

export interface PatientRecords {
  encounters: Array<{ id: string; facilityId: string; encounterType: string; status: string; startedAt: string; endedAt: string | null }>
  notes: Array<{ id: string; encounterId: string; facilityId: string; noteType: string; title: string; status: string; revisionNo: number; content: string; signedAt: string | null }>
  vitals: Array<{ id: string; encounterId: string; facilityId: string; recordedAt: string; heightCm: number | null; weightKg: number | null; temperatureC: number | null; pulseBpm: number | null; respiratoryRate: number | null; systolicMmhg: number | null; diastolicMmhg: number | null; oxygenSaturationPercent: number | null; source: string }>
  diagnoses: Array<{ id: string; encounterId: string; facilityId: string; codeSystem: string; code: string; display: string; clinicalStatus: string; verificationStatus: string; onsetAt: string | null; abatementAt: string | null; notes: string | null }>
  prescriptions: Array<{ id: string; encounterId: string; facilityId: string; medicationCodeSystem: string | null; medicationCode: string | null; medicationDisplay: string; doseQuantity: number | null; doseUnit: string | null; routeCode: string | null; frequency: string; instructions: string; startsOn: string | null; endsOn: string | null; status: string }>
  labRequests: Array<{ id: string; encounterId: string; facilityId: string; testCodeSystem: string; testCode: string; testDisplay: string; priority: string; status: string; specimenTypeCode: string | null; clinicalInformation: string | null; externalOrderReference: string | null; createdAt: string }>
  documents: Array<{ id: string; encounterId: string | null; facilityId: string; fileName: string; mediaType: string; sizeBytes: number | null; classification: string; status: string; createdAt: string }>
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

export interface EmergencyContact {
  contactId: string
  name: string
  relationship: EmergencyContactRelationship
  channel: 'email' | 'sms'
  /** Masked by the backend; the full destination is never returned. */
  destinationHint: string
  status: 'unverified' | 'verified'
  verifiedAt: string | null
  notifyOnEmergencyAccess: boolean
  eligibleForEmergencyNotification: boolean
  version: number
  pendingVerification: { expiresAt: string; deliveryOutcome: string } | null
  lastNotification: { status: string; createdAt: string } | null
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

export interface RecoveryChallenge {
  accepted: true
  challengeId: string
  deliveryChannels: ['email', 'sms']
  expiresInSeconds: number
  resendAfterSeconds: number
}

export function createPatientApi(client: ApiClient) {
  const call = <T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown,
    options?: { signal?: AbortSignal; headers?: Readonly<Record<string, string>>; reportUnauthorized?: boolean }) =>
    client.request<T>({ method, path: `/api/v1/${path}`, auth: path.startsWith('auth/') || path.startsWith('identity/patient-enrollments') ? 'optional' : 'required',
      ...(body === undefined ? {} : { body }), ...options })

  // A question about the session, and a refresh, judge their own 401: it may mean
  // only an expired access token, which the refresh restores. The client's
  // onUnauthorized is left to the final 401 of every other request.
  const judged = { reportUnauthorized: false } as const

  return {
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
    // question is handled as a refused sign-out.
    logout: (subject: string | undefined) => signOutInTurn(() => call<PatientSession>('GET', 'auth/session').then(
      session => session.actor?.kind === 'patient' && subject !== undefined && session.actor.subject === subject),
    () => call<void>('POST', 'auth/logout'), { alwaysAsk: true }),
    googleNonce: () => call<{ nonce: string }>('GET', 'auth/google/nonce'),
    googleExchange: (idToken: string, turnstileToken: string, intent: 'sign_in' | 'enroll') =>
      inRefreshTurn(() => call<PatientSession | { stage: 'GOOGLE_AUTHENTICATED_PENDING_IDENTITY'; expiresAt: string }>(
        'POST', 'auth/oidc/exchange', { idToken, turnstileToken, turnstileAction: 'patient-login', intent })),
    googleOnboarding: () => call<{ stage: 'GOOGLE_AUTHENTICATED_PENDING_IDENTITY'; expiresAt: string }>('GET', 'auth/google/onboarding'),
    googleLink: (idToken: string, principal: string, password: string, turnstileToken: string) =>
      call<{ linked: true }>('POST', 'auth/google/link', { idToken, principal, password, turnstileToken, turnstileAction: 'patient-login' }),
    enrollmentCurrent: () => call<EnrollmentProgress>('GET', 'identity/patient-enrollments/current'),
    enrollmentStart: (nin: string, turnstileToken: string, idempotencyKey: string) =>
      call<EnrollmentProgress>('POST', 'identity/patient-enrollments', { nin, turnstileAction: 'patient-enrollment', turnstileToken },
        { headers: { 'Idempotency-Key': idempotencyKey } }),
    enrollmentBindGoogle: () => call<{ bound: true }>('POST', 'identity/patient-enrollments/google'),
    enrollmentContact: (channel: 'email' | 'phone', contact: string) =>
      call<{ challengeId: string; expiresInSeconds: number; resendAfterSeconds: number }>('POST', 'identity/patient-enrollments/contact', { channel, contact }),
    enrollmentVerify: (challengeId: string, code: string) =>
      call<{ stage: 'set_password' }>('POST', 'identity/patient-enrollments/contact/verify', { challengeId, code }),
    enrollmentActivate: (password: string) =>
      call<{ stage: 'active'; hidCode: string }>('POST', 'identity/patient-enrollments/activate', { password }),
    recoveryStart: (identifier: string, turnstileToken: string) =>
      call<RecoveryChallenge>('POST', 'auth/otp/start', { identifier, purpose: 'PASSWORD_RESET', turnstileAction: 'patient-reset-start', turnstileToken }),
    recoveryVerify: (challengeId: string, code: string) =>
      call<{ verified: true; challengeId: string; verificationToken: string }>('POST', 'auth/otp/verify', { challengeId, code, purpose: 'PASSWORD_RESET' }),
    recoveryComplete: (challengeId: string, verificationToken: string, newPassword: string) =>
      call<{ completed: true }>('POST', 'auth/otp/complete', { challengeId, verificationToken, newPassword, purpose: 'PASSWORD_RESET' }),
    profile: (signal?: AbortSignal) => call<PatientProfile>('GET', 'identity/me', undefined, { signal }),
    verifyNin: (nin: string) => call<PatientNinVerification>('POST', 'identity/me/verification/nin', { nin }),
    records: (signal?: AbortSignal) => call<PatientRecords>('GET', 'ehr/me/records', undefined, { signal }),
    accessHistory: (signal?: AbortSignal) => call<AccessHistory>('GET', 'identity/me/access-history', undefined, { signal }),
    // Patient-owned revocation; the staff `consent-grants/:id/close` route is not a patient route.
    revokeAccess: (grantId: string, reason: string) => call<{ consentGrantId: string; status: 'revoked'; replayed: boolean }>(
      'POST', `identity/me/consent-grants/${encodeURIComponent(grantId)}/revoke`, { reason }),
    // The patient's own decisions carry no purpose of use: Identity binds them to the
    // patient session, and would audit a purpose header as the purpose of the decision.
    accessRequests: (signal?: AbortSignal) => call<AccessRequest[]>('GET', 'identity/me/access-requests', undefined, { signal }),
    approveAccess: (id: string) => call<unknown>('POST', `identity/access-requests/${encodeURIComponent(id)}/approve`),
    denyAccess: (id: string, reason: string) => call<unknown>('POST', `identity/access-requests/${encodeURIComponent(id)}/deny`, { reason }),
    notifications: (signal?: AbortSignal) => call<PatientNotification[]>('GET', 'identity/me/notifications', undefined, { signal }),
    markNotificationRead: (id: string) => call<{ id: string; readAt: string }>('POST', `identity/me/notifications/${encodeURIComponent(id)}/read`),
    setAccessPin: (pin: string) => call<{ configured: true }>('POST', 'identity/me/access-pin', { pin }),
    revokeAccessPin: () => call<{ revoked: true }>('DELETE', 'identity/me/access-pin'),
    accountDeletionStatus: (signal?: AbortSignal) =>
      call<AccountDeletionStatus>('GET', 'identity/me/account-deletion', undefined, { signal }),
    requestAccountDeletion: () => call<AccountDeletionRequested>('POST', 'identity/me/account-deletion'),
    confirmAccountDeletion: (requestId: string, confirmationToken: string, confirmation: string) =>
      call<AccountDeletionConfirmed>('POST', 'identity/me/account-deletion/confirm', { requestId, confirmationToken, confirmation }),
    cancelAccountDeletion: (requestId: string) =>
      call<{ requestId: string; state: 'cancelled'; replayed: boolean }>('POST', 'identity/me/account-deletion/cancel', { requestId }),
    emergencyContacts: (signal?: AbortSignal) =>
      call<EmergencyContact[]>('GET', 'identity/me/emergency-contacts', undefined, { signal }),
    addEmergencyContact: (input: { name: string; relationship: EmergencyContactRelationship; channel: 'email' | 'sms';
      destination: string; notifyOnEmergencyAccess: boolean }) =>
      call<EmergencyContact>('POST', 'identity/me/emergency-contacts', input),
    updateEmergencyContact: (contactId: string, input: { expectedVersion: number; name?: string;
      relationship?: EmergencyContactRelationship; notifyOnEmergencyAccess?: boolean }) =>
      call<EmergencyContact>('POST', `identity/me/emergency-contacts/${encodeURIComponent(contactId)}`, input),
    deactivateEmergencyContact: (contactId: string) =>
      call<{ contactId: string; status: 'deactivated'; replayed: boolean }>(
        'POST', `identity/me/emergency-contacts/${encodeURIComponent(contactId)}/deactivate`),
    sendEmergencyContactVerification: (contactId: string) =>
      call<{ challengeId: string; expiresAt: string; deliveryOutcome: string }>(
        'POST', `identity/me/emergency-contacts/${encodeURIComponent(contactId)}/verification`),
    confirmEmergencyContactVerification: (contactId: string, challengeId: string, code: string) =>
      call<{ contactId: string; status: 'verified' }>(
        'POST', `identity/me/emergency-contacts/${encodeURIComponent(contactId)}/verification/confirm`, { challengeId, code }),
  }
}

export type PatientApi = ReturnType<typeof createPatientApi>
