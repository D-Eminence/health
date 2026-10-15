/** Response and request shapes taken from hid-system c4b5445 controllers/DTOs. */

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

export interface PatientEnrollmentProgress {
  stage: 'verify_contact' | 'set_password' | 'active'
  expiresAt?: string
  contactChannel?: 'phone' | 'email'
  maskedContact?: string
  challengeId?: string
  googleOnboardingRequired?: boolean
  googleOnboardingExpiresAt?: string
  hidCode?: string
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
