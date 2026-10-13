import { parseImportedRecords, type ImportedMedicalRecord, type ImportedAttachmentDownload } from './importedRecords'
import type { ApiClient } from '@hid/http'
import { createEhrService, createSupportService } from '@hid/api'
import { parsePatientChat, type PatientChatReply } from '@hid/contracts'

export interface PatientChatHistory {
  exchanges: Array<{ id: string; question: string; reply: PatientChatReply; createdAt: string }>
  retentionDays: number
  limit: number
}
function parseChatHistory(value: unknown): PatientChatHistory {
  if (typeof value !== 'object' || value === null) throw new Error('Saved chat returned an invalid response.')
  const history = value as Record<string, unknown>
  if (!Array.isArray(history.exchanges) || history.exchanges.length > 10 || history.retentionDays !== 30 || history.limit !== 10) {
    throw new Error('Saved chat returned an invalid response.')
  }
  const ids = new Set<string>()
  const exchanges = history.exchanges.map((item: unknown) => {
    if (typeof item !== 'object' || item === null) throw new Error('Saved chat returned an invalid response.')
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(row.id) || ids.has(row.id)
      || typeof row.question !== 'string' || !row.question.trim() || row.question.length > 500
      || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) throw new Error('Saved chat returned an invalid response.')
    ids.add(row.id)
    return { id: row.id, question: row.question, createdAt: row.createdAt, reply: parsePatientChat(row.reply) }
  })
  return { exchanges, retentionDays: 30, limit: 10 }
}

/** Contracts read from hid-system c4b5445 Identity and EHR controllers. */
export interface PatientSession {
  actor: {
    kind?: 'patient' | 'staff'
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
  importedRecords?: ImportedMedicalRecord[]
  encounters: Array<{ id: string; facilityId: string; encounterType: string; status: string; startedAt: string; endedAt: string | null }>
  notes: Array<{ id: string; encounterId: string; facilityId: string; noteType: string; title: string; status: string; revisionNo: number; content: string; signedAt: string | null }>
  limit: number
}

export interface AccessHistory {
  items: Array<{ consentGrantId: string; scope: string; purpose: string; status: string; startsAt: string; expiresAt: string; reason: string | null; facilityName: string }>
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
    options?: { signal?: AbortSignal; headers?: Readonly<Record<string, string>> }) =>
    client.request<T>({ method, path: `/api/v1/${path}`, auth: path.startsWith('auth/') || path.startsWith('identity/patient-enrollments') ? 'optional' : 'required',
      ...(body === undefined ? {} : { body }), ...options })

  return {
    chat: createEhrService({ app: 'patient-web', client }).chat,
    chatSource: (kind:string,id:string,signal?:AbortSignal) => call<Record<string,unknown>>('GET',
      `ehr/me/chat/sources/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`,undefined,{signal}),
    chatHistory: async (signal?: AbortSignal) => parseChatHistory(await call<unknown>('GET', 'ehr/me/chat/history', undefined, { signal })),
    clearChatHistory: (signal?: AbortSignal) => call<{ cleared: true }>('DELETE', 'ehr/me/chat/history', undefined, { signal }),
    supportChat: createSupportService({ app: 'patient-web', client }).chat,
    session: () => call<PatientSession>('GET', 'auth/session'),
    refresh: () => call<PatientSession>('POST', 'auth/refresh'),
    login: (email: string, password: string, turnstileToken: string) =>
      call<PatientSession>('POST', 'auth/patient/login', { email, password, turnstileAction: 'patient-login', turnstileToken }),
    logout: () => call<void>('POST', 'auth/logout'),
    googleNonce: () => call<{ nonce: string }>('GET', 'auth/google/nonce'),
    googleExchange: (idToken: string, turnstileToken: string, intent: 'sign_in' | 'enroll') =>
      call<PatientSession | { stage: 'GOOGLE_AUTHENTICATED_PENDING_IDENTITY'; expiresAt: string }>(
        'POST', 'auth/oidc/exchange', { idToken, turnstileToken, turnstileAction: 'patient-login', intent }),
    googleOnboarding: () => call<{ stage: 'GOOGLE_AUTHENTICATED_PENDING_IDENTITY'; expiresAt: string }>('GET', 'auth/google/onboarding'),
    googleLink: (idToken: string, principal: string, password: string, turnstileToken: string) =>
      call<{ linked: true }>('POST', 'auth/google/link', { idToken, principal, password, turnstileToken, turnstileAction: 'patient-login' }),
    enrollmentCurrent: () => call<EnrollmentProgress>('GET', 'identity/patient-enrollments/current'),
    enrollmentStart: (nin: string, turnstileToken: string, idempotencyKey: string) =>
      call<EnrollmentProgress>('POST', 'identity/patient-enrollments', { nin, turnstileAction: 'patient-enrollment', turnstileToken },
        { headers: { 'Idempotency-Key': idempotencyKey } }),
    enrollmentBindGoogle: () => call<EnrollmentProgress>('POST', 'identity/patient-enrollments/google'),
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
    records: async (signal?: AbortSignal) => {
      const value = await call<PatientRecords>('GET', 'ehr/me/records', undefined, { signal })
      if (value.importedRecords !== undefined) value.importedRecords = parseImportedRecords(value.importedRecords)
      return value
    },
    importedAttachment: (id: string, signal?: AbortSignal) => call<ImportedAttachmentDownload>('GET',
      `ehr/me/imported-attachments/${encodeURIComponent(id)}/download`, undefined, { signal }),
    accessHistory: (signal?: AbortSignal) => call<AccessHistory>('GET', 'identity/me/access-history', undefined, { signal }),
    accessRequests: (signal?: AbortSignal) => call<AccessRequest[]>('GET', 'identity/me/access-requests', undefined,
      { signal, headers: { 'X-Purpose-Of-Use': 'direct-care' } }),
    approveAccess: (id: string) => call<unknown>('POST', `identity/access-requests/${encodeURIComponent(id)}/approve`, undefined,
      { headers: { 'X-Purpose-Of-Use': 'direct-care' } }),
    denyAccess: (id: string, reason: string) => call<unknown>('POST', `identity/access-requests/${encodeURIComponent(id)}/deny`, { reason },
      { headers: { 'X-Purpose-Of-Use': 'direct-care' } }),
    notifications: (signal?: AbortSignal) => call<PatientNotification[]>('GET', 'identity/me/notifications', undefined, { signal }),
    markNotificationRead: (id: string) => call<{ id: string; readAt: string }>('POST', `identity/me/notifications/${encodeURIComponent(id)}/read`),
    setAccessPin: (pin: string) => call<{ configured: true }>('POST', 'identity/me/access-pin', { pin }),
    revokeAccessPin: () => call<{ revoked: true }>('DELETE', 'identity/me/access-pin'),
  }
}

export type PatientApi = ReturnType<typeof createPatientApi>
