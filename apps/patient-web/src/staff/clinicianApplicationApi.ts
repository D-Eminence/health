import { createApiClient } from '@hid/http'
import { createRegisteredBrowserClient } from '@hid/api'
import { getEnvironment } from './env'

/**
 * Clinician self sign-up and its status page (hid-system ADR-066, branch
 * claude/clinician-self-signup; INTERFACE_CONTRACT "Clinician self sign-up").
 * A doctor or nurse proves a work email with a code, applies with a licence
 * and a facility, and sets up an authenticator before two HID administrators
 * review the application. Nothing here issues a session: after the email code
 * the browser holds only the httpOnly capability cookie
 * `hid_clinician_application` (path /api/v1/identity/clinician-applications),
 * which it sends and this module never reads.
 *
 * The pages sit outside the provider workspace, so this client is their own:
 * it restores no staff session on a 401 (there is no refresh here) and reports
 * nothing to the workspace. A 401 means only that the application page or its
 * authenticator step has ended. Commands are never sent again by the client;
 * the page decides, reusing the submission's Idempotency-Key.
 */
const transport = createApiClient({
  baseUrl: getEnvironment().apiBaseUrl,
  clientId: 'staff-web',
  sessionMode: 'cookie',
})
const client = createRegisteredBrowserClient(transport, 'staff-web')

const BASE = '/api/v1/identity/clinician-applications'
const PUBLIC = { auth: 'none' } as const

export type ClinicianProfession = 'doctor' | 'nurse'
export type ClinicianRegulatorCode = 'MDCN' | 'NMCN'
/** The only pairs Identity accepts (a table CHECK, the commands and the DTO). */
export const CLINICIAN_REGULATOR_OF: Readonly<Record<ClinicianProfession, ClinicianRegulatorCode>> =
  Object.freeze({ doctor: 'MDCN', nurse: 'NMCN' })

export type ClinicianApplicationState = 'awaiting_authenticator' | 'submitted' | 'under_review' | 'approved' | 'rejected'
  | 'withdrawn' | 'expired'
export type ClinicianAccessState = 'active' | 'lapsed' | 'ended' | 'account_unavailable'
export type ClinicianDecisionCode = 'licence_not_verified' | 'licence_not_current' | 'details_mismatch' | 'identity_not_confirmed'
  | 'employment_not_confirmed' | 'facility_not_available' | 'duplicate' | 'existing_account' | 'other'

/** The applicant's view of one application (identity.clinician_application_view): never an administrator's notes. */
export interface ClinicianApplicationView {
  applicationId: string
  state: ClinicianApplicationState
  version: number
  facility: { id: string; name: string }
  profession: ClinicianProfession
  regulator: { code: ClinicianRegulatorCode; name: string }
  /** The licence number's last four characters. */
  licenceNumberHint: string
  submittedAt: string
  expiresAt: string
  decidedAt: string | null
  /** Rejected only. */
  decisionCode: ClinicianDecisionCode | null
  /** Approved only. */
  accessState: ClinicianAccessState | null
  canWithdraw: boolean
}

/**
 * The capability's page: `enrolment_required` (no authenticator yet) may read
 * it, withdraw and set one up; `ready` may do everything. `applyRefusal` names
 * why another facility cannot be applied to now.
 */
export interface ClinicianAccountView {
  account: { email: string; fullName: string }
  stage: 'ready' | 'enrolment_required'
  applications: ClinicianApplicationView[]
  canApply: boolean
  applyRefusal?: string | null
}

/** The same answer for every address: whether a code was sent is never said. */
export interface ClinicianCodeSent {
  accepted: true
  challengeId: string
  expiresInSeconds: number
  resendAfterSeconds: number
}

export interface ClinicianFacility { facilityId: string; name: string; organizationName: string }

/** The licence and facility of an application (P14); a sign-up adds the account's fields (P4). */
export interface ClinicianApplicationDetails {
  profession: ClinicianProfession
  regulator: ClinicianRegulatorCode
  licenceNumber: string
  /** YYYY-MM-DD. */
  licenceValidUntil: string
  facilityId: string
  declarations: { accurate: true; verificationConsent: true }
}

export interface ClinicianSignUp extends ClinicianApplicationDetails {
  email: string
  fullName: string
  password: string
}

/** The authenticator step the capability's 0088 challenge opened, or null when the account's budget for them is spent. */
export interface ClinicianAuthenticatorChallenge { purpose: 'enroll' | 'verify'; expiresAt: string }

export interface ClinicianSubmitted {
  applicationId: string
  state: ClinicianApplicationState
  submittedAt: string
  expiresAt: string
  facility: { id: string; name: string }
  profession: ClinicianProfession
  version: number
  replayed: boolean
  next: 'authenticator'
  authenticator: ClinicianAuthenticatorChallenge | null
}

export interface ClinicianStatusVerified { next: 'authenticator_verify' | 'authenticator_setup'; expiresAt: string }

export interface ClinicianEnrollmentCodeSent { accepted: true; channel: 'email'; expiresAt: string }

/** The new authenticator's secret, returned this once. */
export interface ClinicianAuthenticatorSetup {
  secret: string
  otpauthUri: string
  algorithm: string
  digits: number
  periodSeconds: number
  expiresAt: string
}

export type ClinicianActivation = ClinicianAccountView & { recoveryCodes: string[] }

/** One key per submission, kept in the page's memory and reused only for that submission's retry. */
export function newClinicianIdempotencyKey(): string {
  return crypto.randomUUID()
}

export const clinicianApplicationApi = {
  /** P0. Anything but `{ open: true }` is not open. */
  availability: async (): Promise<{ open: boolean }> => {
    const answer = await client.get<{ open?: unknown } | null>(`${BASE}/availability`, PUBLIC)
    return { open: answer?.open === true }
  },

  /** P1. */
  sendCode: (email: string, turnstileToken: string) => client.post<ClinicianCodeSent>(`${BASE}/email-code`,
    { email, turnstileAction: 'clinician-application', turnstileToken }, PUBLIC),

  /** P2. A correct code sets the draft capability cookie (60 minutes). */
  verifyCode: (challengeId: string, email: string, code: string) =>
    client.post<{ verified: true; expiresAt: string }>(`${BASE}/email-code/verify`, { challengeId, email, code }, PUBLIC),

  /** P3. */
  searchFacilities: async (query: string): Promise<ClinicianFacility[]> =>
    (await client.post<{ facilities: ClinicianFacility[] }>(`${BASE}/facility-search`, { query }, PUBLIC)).facilities,

  /** P4. Sets the account capability cookie (30 minutes) in place of the draft. */
  submit: (input: ClinicianSignUp, idempotencyKey: string) =>
    client.post<ClinicianSubmitted>(BASE, input, { ...PUBLIC, headers: { 'Idempotency-Key': idempotencyKey } }),

  /** The authenticator, set up (P5-P7) or verified (P8) with no session; P9 opens its step again. */
  authenticator: {
    sendEmailCode: () => client.post<ClinicianEnrollmentCodeSent>(`${BASE}/authenticator/email-code`, undefined, PUBLIC),
    start: (emailCode: string) => client.post<ClinicianAuthenticatorSetup>(`${BASE}/authenticator/start`, { emailCode }, PUBLIC),
    activate: (code: string) => client.post<ClinicianActivation>(`${BASE}/authenticator/activate`, { code }, PUBLIC),
    verify: (proof: { code: string } | { recoveryCode: string }) =>
      client.post<ClinicianAccountView>(`${BASE}/authenticator/verify`, proof, PUBLIC),
    reopen: () => client.post<ClinicianAuthenticatorChallenge>(`${BASE}/authenticator/challenge`, undefined, PUBLIC),
  },

  /** P10. */
  sendStatusCode: (email: string, turnstileToken: string) => client.post<ClinicianCodeSent>(`${BASE}/status/email-code`,
    { email, turnstileAction: 'clinician-application-status', turnstileToken }, PUBLIC),

  /** P11. Sets the account capability cookie; says which authenticator step comes next. */
  verifyStatusCode: (challengeId: string, email: string, code: string) =>
    client.post<ClinicianStatusVerified>(`${BASE}/status/email-code/verify`, { challengeId, email, code }, PUBLIC),

  /** P12. */
  current: () => client.get<ClinicianAccountView>(`${BASE}/current`, { ...PUBLIC, dedupe: false }),

  /** P13. Sent with the version the page shows; a 409 means it changed. */
  withdraw: (application: Pick<ClinicianApplicationView, 'applicationId' | 'version'>) =>
    client.post<ClinicianApplicationView>(`${BASE}/${encodeURIComponent(application.applicationId)}/withdraw`, undefined,
      { ...PUBLIC, headers: { 'If-Match': `"${application.version}"` } }),

  /** P14. */
  apply: (input: ClinicianApplicationDetails, idempotencyKey: string) =>
    client.post<ClinicianApplicationView & { replayed: boolean }>(`${BASE}/current/applications`, input,
      { ...PUBLIC, headers: { 'Idempotency-Key': idempotencyKey } }),

  /** P15. Always 204; Identity clears the cookie. */
  endSession: () => client.post<void>(`${BASE}/session/end`, undefined, PUBLIC),
}
