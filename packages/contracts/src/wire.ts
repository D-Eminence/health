/** Response and request shapes taken from hid-system c4b5445 controllers/DTOs, and later where a comment says. */

export interface HidFacilityAssignment {
  id: string
  membershipId: string
  organizationId: string
  name: string
  code?: string
  roles: readonly string[]
  permissions: readonly string[]
  isPrimary: boolean
}

export interface HidActor {
  kind?: 'patient' | 'staff'
  patientId?: string
  id: string
  subject: string
  accountId: string
  sessionId?: string
  email?: string
  displayName?: string
  roles: readonly string[]
  permissions: readonly string[]
  platformRoles?: readonly string[]
  platformPermissions?: readonly string[]
  facilityIds: readonly string[]
  facilities: readonly HidFacilityAssignment[]
  facility?: HidFacilityAssignment
  role?: string
  authenticationMethod: 'local' | 'oidc'
}

export interface HidAuthSession {
  actor: HidActor
  expiresAt?: string
}

/**
 * The staff password step's answer since hid-system #71: the second step
 * Identity asks for, with only an httpOnly challenge cookie. An Identity before
 * #71 answers with a session instead.
 */
export interface HidStaffLoginChallenge {
  status: 'mfa_required' | 'mfa_enrollment_required'
  expiresAt: string
}

export interface HidProblemDetails {
  type: string
  title: string
  status: number
  detail: string
  instance: string
  correlationId: string
  code: string
  errors?: readonly { field: string; messages: readonly string[] }[]
}

/**
 * A patient enrollment's progress (hid-system main f9dbaf0). Every start answers
 * `verify_holder` since #84 (ADR-062): the patient proves they hold the NIN, by a
 * code to the phone on the NIN record (`online`) or in person at a participating
 * facility (`facility`, #85, ADR-063). `requiredProfileFields` (ADR-061) comes
 * only after that proof and before activation.
 */
export interface PatientEnrollmentProgress {
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
  requiredProfileFields?: readonly ('dateOfBirth' | 'gender')[]
  /** At `verify_holder`: whether a code can be texted, and the open code's timing. */
  online?: { available: boolean; challengeId?: string; expiresInSeconds?: number; resendAfterSeconds?: number }
  /** At `verify_holder`: whether the facility route is open, and the desk code, to the cookie holder only. */
  facility?: { available: boolean; deskCode?: string; deskCodeExpiresAt?: string }
}

/** `GET .../availability` since #84; an Identity before it sends `{ open }` only. Only `open: true` opens a start. */
export interface PatientEnrollmentAvailability {
  open: boolean
  online?: boolean
  facility?: boolean
}

/** `POST .../holder` (ADR-062): the code texted to the phone on the NIN record. */
export interface PatientEnrollmentHolderCode {
  challengeId: string
  expiresInSeconds: number
  resendAfterSeconds: number
}

/** `GET .../participating-facilities` (ADR-063): by name and place only, and what to bring. */
export interface ParticipatingFacilities {
  facilities: readonly { name: string; addressLine?: string; town: string; lga: string; state: string; hours?: string }[]
  whatToBring: readonly string[]
}

/** What activation may carry for the fields the NIN record lacks (ADR-061). */
export interface PatientEnrollmentProfile {
  dateOfBirth?: string
  gender?: 'female' | 'male' | 'intersex' | 'other' | 'unknown'
}

export interface PatientRecordSummary {
  encounters: readonly {
    id: string; facilityId: string; encounterType: string; status: 'completed'
    startedAt: string; endedAt: string | null
  }[]
  notes: readonly {
    id: string; encounterId: string; facilityId: string; noteType: string
    title: string; status: 'signed' | 'amended'; revisionNo: number
    content: string; signedAt: string | null
  }[]
  limit: 50
}

export interface PublicPrice {
  product_slug: string
  context: string
  visibility: 'fixed' | 'starting_from' | 'contact_sales' | 'custom_quote' | 'hidden'
  amount_minor: number | null
  currency: string
  billing_period: string | null
  unit: string | null
}
export interface PublicPricingResponse { data: readonly PublicPrice[] }

export type DemoProduct = 'ehr' | 'migrate' | 'laboratory' | 'pharmacy' | 'outreach' | 'api' | 'general'
export interface CreateDemoRequest {
  contactName: string
  contactEmail: string
  contactPhone?: string
  contactRole?: string
  organizationName?: string
  organizationType?: 'clinic' | 'hospital' | 'laboratory' | 'pharmacy' | 'other'
  productCode: DemoProduct
  message?: string
  sourcePage?: string
  sourceSection?: string
  ctaLabel?: string
  turnstileAction: 'book-demo'
  turnstileToken: string
}
export interface DemoRequestAccepted { accepted: true; replayed: boolean }

export interface RecoveryOtpStart {
  accepted: true
  challengeId: string
  deliveryChannels: readonly ['email', 'sms']
  expiresInSeconds: number
  resendAfterSeconds: number
}
export interface RecoveryOtpVerified { verified: true; challengeId: string; verificationToken: string }

/** Each facility-guarded call still requires backend RBAC and purpose of use. */
export interface ClinicalRequestHeaders {
  'X-Facility-ID': string
  'X-Purpose-Of-Use': 'direct-care' | 'emergency' | 'healthcare-operations'
}
