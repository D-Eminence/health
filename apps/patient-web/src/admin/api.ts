import { createApiClient, HidApiError, isHidApiError, NO_RETRY, type DownloadResult, type RequestSpec } from '@hid/http'
import { createRegisteredBrowserClient } from '@hid/api'
import { environment } from './env'
import { backendContract, usesNovuBackend } from '../backendContract'
import { recordServerSessionEnd, recordSessionWindow, reportSessionEnded, serverSessionEnd } from './session-window'
import { announceAdminSessionChange } from './tabs'

export interface AdminActor {
  accountId: string
  subject: string
  displayName: string | null
  email: string | null
  platformRoles: string[]
  platformPermissions: string[]
}
export interface AdminSession { actor: AdminActor }
export interface Page<T> { items: T[]; page: number; pageSize: number; total: number }
/**
 * One page of a cursor-paged list (approvals, demo requests). `nextCursor` is
 * opaque and bound to the list and its filters; null on the last page.
 */
export interface CursorPage<T> { items: T[]; nextCursor: string | null }
export interface Versioned { version: number }
export interface Facility extends Versioned {
  id: string; organizationId: string; organizationName: string; name: string; code: string; status: string
  statusReason: string | null; statusChangedAt: string | null; createdAt: string; membershipCount: number
  /** The phone an emergency-contact alert gives for it, null when not set: Novu's read since hid-system #109 only. */
  alertPhoneE164?: string | null; alertPhoneUpdatedAt?: string | null
}
/** `POST /admin/facilities/:id/alert-phone` (hid-system #109): the phone as stored, and the facility's new version. */
export interface FacilityAlertPhoneSaved extends Versioned { facilityId: string; alertPhoneE164: string | null; replayed: boolean }
/** `POST /admin/emergency-contacts/opt-out` (hid-system #109): how many contacts and patients, never who. */
export interface EmergencyContactOptOut { contacts: number; patients: number; replayed: boolean }
/**
 * A facility's designation for facility-assisted registration (hid-system main
 * f9dbaf0: #85, ADR-063). Version 0, with `designated` false and every other
 * value null, when it has none; that version creates the first one.
 */
export interface AssistedRegistrationDesignation {
  facilityId: string; designated: boolean; status: 'active' | 'suspended' | null; addressLine: string | null
  town: string | null; lga: string | null; state: string | null; hours: string | null; reason: string | null
  version: number; updatedAt: string | null
}
/** `AssistedRegistrationDesignationDto`: the location patients are shown, and the audited reason. */
export interface AssistedRegistrationDesignationInput {
  status: 'active' | 'suspended'; addressLine?: string; town: string; lga: string; state: string; hours?: string; reason: string
}
export interface AssistedRegistrationSaved { facilityId: string; status: 'active' | 'suspended'; version: number; replayed: boolean }
export interface PrincipalMembership { id: string; facilityId: string; facilityName: string; role: string; appRole: string; active: boolean }
export interface Principal extends Versioned {
  id: string; subject: string; email: string | null; displayName: string | null; status: string; createdAt: string
  platformRoles: string[]; activeSessionCount: number; memberships: PrincipalMembership[]
  /**
   * An active authenticator exists. A display hint: the reset command still
   * decides. Absent from an Identity build before hid-system Stage 4A.
   */
  mfaEnrolled?: boolean
}
export interface IdentityReview extends Versioned {
  id: string; facilityId: string; facilityName: string; maskedNin: string; provider: string; status: string
  candidateCount: number; createdAt: string; updatedAt: string
}
export interface AuditEvent {
  sequenceId: string; eventId: string; occurredAt: string; correlationId: string; actorType: string | null
  actorSubject: string | null; facilityId: string | null; action: string; outcome: string; resourceType: string | null
  resourceId: string | null; purposeOfUse: string | null; reason: string | null; sourceSystem: string | null
}
export interface AuditEventPage { items: AuditEvent[]; nextBeforeSequenceId: string | null }
/** Backend filters for the platform audit (exact matches; dates are ISO instants). */
export interface AuditFilters {
  actor?: string; facilityId?: string; action?: string; correlationId?: string
  outcome?: 'success' | 'denied' | 'failure'; from?: string; to?: string
  /** The audited target, for example `facility`; `resourceId` needs it. */
  resourceType?: string; resourceId?: string
}
export interface PlatformControl extends Versioned { controlKey: string; enabled: boolean; reason: string; updatedAt: string }
export interface CommercialProduct extends Versioned { slug: string; name: string; status: 'active' | 'coming_soon' | 'draft' | 'retired' }
export interface CommercialPrice extends Versioned { product_slug: string; context: string; visibility: 'fixed' | 'starting_from' | 'contact_sales' | 'custom_quote' | 'hidden'; amount_minor: number | null; currency: string; billing_period: string | null; unit: string | null; active: boolean }
export interface PricingCatalog { products: CommercialProduct[]; prices: CommercialPrice[] }
export type DemoStatus = 'new' | 'contacted' | 'qualified' | 'closed'
/**
 * A demo request as `GET /admin/demo-requests` returns it (hid-system demo-requests.service.ts
 * DEMO_PROJECTION). The public site's referrals are demo requests with `sourceSection` 'referral':
 * the facility's type, location and contact are in `message`, the referrer's phone in `contactPhone`.
 */
export interface DemoRequest extends Versioned {
  id: string; contactName: string; contactEmail: string; contactPhone: string | null; contactRole: string | null
  organizationName: string | null; organizationType: string | null; productCode: string; message: string | null
  sourcePage: string | null; sourceSection: string | null; ctaLabel: string | null; status: DemoStatus; createdAt: string
}
export type ApplicationStatus = 'pending_verification' | 'ready_for_review' | 'approved' | 'rejected'
export interface OrganizationApplication extends Versioned {
  applicationId: string; productCode: string; organizationName: string | null; organizationType: string | null
  cacHint: string | null; administratorName: string | null; administratorEmail: string; status: ApplicationStatus | string
  verificationResult: string | null; verifiedOrganizationName: string | null; verifiedEntityType: string | null
  verifiedRegistrationDate: string | null; verifiedAddress: string | null; verifiedRegistryStatus: string | null
  profileCompanyName: string | null; profileEntityType: string | null; profileRegistrationDate: string | null
  profileAddress: string | null; profileRegistryStatus: string | null; profileState: string | null
  fieldSources: Record<string, string | null> | null; createdAt: string; verifiedAt: string | null; reviewedAt: string | null
}
/**
 * Which facility sign-ups to list: the ones support has not checked yet (the default), the ones it has reviewed or
 * released, or both.
 */
export type SelfServiceFacilityState = 'unreviewed' | 'reviewed' | 'all'
/**
 * A facility that signed itself up (P4, Novu only): `GET /admin/self-service-facilities`, one row per activated
 * self-service application, at most 200: the unreviewed ones oldest activation first, the others newest first.
 * `version` is the application's, for the review and the release. `organizationName` is the verified legal name,
 * kept after a release renames the organization. The release fields come with P4 round 2 (absent before it).
 */
export interface SelfServiceFacility extends Versioned {
  applicationId: string; organizationId: string; organizationName: string; facilityId: string; facilityName: string
  facilityLifecycleStatus: string; productCode: string; organizationType: string; cacHint: string
  administratorName: string; administratorEmail: string; administratorAccountId: string | null
  administratorAccountStatus: string | null; activatedAt: string | null; reviewedAt: string | null
  reviewedByAccountId: string | null; reviewNote: string | null
  releasedAt?: string | null; releasedByAccountId?: string | null; releaseReason?: string | null
  /**
   * P4b (absent before it): the administrator's role support's review would give by default (null for 'other'), the
   * roles it may give, and what it gave; how support checked; the licence the administrator entered (full number, for
   * the register check); the facility's staff and invitations; the first 30 days' end; its emergency activations in the
   * last 7 days and invitation emails not delivered in the last day.
   */
  reviewGrantsRole?: string | null; reviewableRoles?: string[]; grantedRole?: string | null; verificationMethod?: string | null
  administratorLicenceBody?: string | null; administratorLicenceNumber?: string | null
  administratorLicenceRecordedAt?: string | null; memberCount?: number | null; pendingInvitationCount?: number | null
  probationEndsAt?: string | null; breakGlassLast7d?: number | null; deliveryFailuresLastDay?: number | null
}
/** How support checked a self-signed-up facility's administrator (P4b SPEC 3.5). */
export type SelfServiceVerificationMethod = 'cac_registered_contact' | 'officer_match' | 'regulator_register' | 'in_person' | 'other'
/** The administrator's own access support gives at review or changes after it: a clinical role, or none (P4b). */
export interface SelfServiceAdministratorAccess {
  grantedRole: 'none' | 'doctor' | 'nurse' | 'lab' | 'pharmacist'
  verificationMethod: SelfServiceVerificationMethod
  /** Required for a clinical role, absent for 'none'. */
  administratorLicence?: { body: string; number: string }
}
/** `POST /admin/self-service-facilities/:applicationId/review`; P4b adds what it granted and the sessions it ended. */
export interface SelfServiceFacilityReviewed extends Versioned { applicationId: string; reviewedAt: string; grantedRole?: string
  sessionsRevoked?: number }
/** `POST …/:applicationId/administrator-role` (P4b). */
export interface SelfServiceAdministratorRoleChanged extends Versioned { applicationId: string; grantedRole: string
  sessionsRevoked: number }
/** `POST …/:applicationId/end-probation` (P4b). */
export interface SelfServiceProbationEnded extends Versioned { applicationId: string; probationEndedAt: string | null }
/** One member or invitation in support's view of a facility's staff (P4b): full licence numbers and who vouched. */
export interface AdminFacilityStaffEntry {
  membershipId?: string; invitationId?: string; reference?: string; accountId: string | null; name: string | null
  email: string | null; roles: string[]; status: string | null; licenceBody: string | null; licenceNumber: string | null
  licenceKey: string | null; sameLicenceElsewhere: number; nameMismatch: boolean; attestedByAccountId: string | null
  attestedByName: string | null; verificationMethod: string | null; attestedAt: string | null; createdAt: string | null
}
/** `GET /admin/facilities/:facilityId/staff` (P4b). */
export interface AdminFacilityStaff {
  facility: { id: string; name: string; selfService: { review: string; organizationType: string | null; productCode: string | null } | null }
  members: AdminFacilityStaffEntry[]
  invitations: AdminFacilityStaffEntry[]
}
/** `GET /admin/staff-invitations?reference=` (P4b): at most 5. */
export interface FoundStaffInvitation {
  invitationId: string; reference: string; facilityId: string; facilityName: string; organizationId: string; status: string
  roleCode: string; createdAt: string | null; expiresAt: string | null
}
/**
 * Orders between facilities (Novu, P4c, SPEC-FINAL §10.4): a facility's summary for support, with no patient and no
 * order content. `listed` says whether it can receive orders from other facilities now, by default (its review
 * method) or as support last set it; the counts per counterpart facility are the last 30 days', by state.
 */
export interface FacilityOrderRouteSummary {
  facilityId: string
  listed: { value: boolean; byDefault: boolean; reason: string | null; setAt: string | null }
  /**
   * Novu since item 4 (hid-system 0089): what the facility is as a destination. `receivingTypes` are the types of its
   * active laboratory or pharmacy products whose application was approved; `review` is its sign-up's review ('pending',
   * 'reviewed' or 'released'), else 'governed' (approved by Health ID support), else 'legacy'. An earlier Identity sends
   * none; read it only through `summaryDestination`.
   */
  destination?: { receivingTypes: string[]; review: DestinationReview }
  receivedAcceptedLifetime: number
  receivedPatientsLifetime: number
  counterparts: Array<{ direction: 'sent' | 'received' | string; facilityId: string; facilityName: string | null
    last30Days: Record<string, number> }>
}
/** A facility's sign-up review as a destination (C20's `destination.review`, item 4). */
export type DestinationReview = 'pending' | 'reviewed' | 'released' | 'governed' | 'legacy'
/** `POST /admin/facilities/:facilityId/order-destination`. */
export interface OrderDestinationSet { facilityId: string; listed: boolean; setAt: string | null }
/** One order between facilities, as support finds it by its reference or the patient's Health ID (C21). */
/**
 * Support's lookup (C21). With the wrong-patient report (item 3, hid-system 0088) Identity also answers
 * `wrongPatientReports: true`: a laboratory or pharmacy can then end an order it accepted for the wrong person, and the
 * Close form asks support to have it ended there first. An earlier Identity sends no such field (D15).
 */
export interface FoundOrderRoutes { items: FoundOrderRoute[]; wrongPatientReports?: boolean }

export interface FoundOrderRoute extends Versioned {
  routeId: string; reference: string; kind: 'lab_request' | 'prescription' | string; effectiveState: string
  orderingFacilityId: string; orderingFacilityName: string; receivingFacilityId: string; receivingFacilityName: string
  createdAt: string | null; acceptedAt: string | null; endedAt: string | null; endedKind: string | null
  /**
   * Novu since item 4 (hid-system 0089): when the receiving facility's access ends (null before it was accepted), and
   * whether support's Close would act at the time of the Find. An earlier Identity sends neither.
   */
  accessEndsAt?: string | null
  closable?: boolean
}
/** `POST /admin/order-routes/:routeId/close`. */
export interface OrderRouteClosed extends Versioned { routeId: string; effectiveState: string }

/** Who did something, as support's list names them: an account and its display or staff name. */
export interface NamedAccount { accountId: string | null; name: string | null }
/**
 * A laboratory's or pharmacy's report that it accepted an order for someone who was not its patient (item 3, C26): no
 * patient and no order content. `note` is the reporter's, for support only (D7), or the fixed text once support removed
 * it at review (`noteRemoved`). `flags` are, in this order, `something_came_back`, `reporter_recorded_work`,
 * `suspected_misuse` and `other_reason_nothing_recorded`; the 30-day counts are the receiving facility's and the
 * accepting member's (D12).
 */
export interface WrongPatientReport extends Versioned {
  reportId: string; routeId: string; reference: string; kind: 'lab_request' | 'prescription' | string
  receivingFacility: { id: string; name: string | null }; orderingFacility: { id: string; name: string | null }
  reportedAt: string; reportedBy: NamedAccount; acceptedBy: NamedAccount; sameMember: boolean
  acceptedWith: 'health_id' | 'date_of_birth_with_reference' | 'date_of_birth' | string; acceptedAt: string | null
  reason: 'wrong_order_chosen' | 'someone_elses_details' | 'suspected_misuse' | 'other' | string
  note: string; noteRemoved: boolean; stateBefore: 'accepted' | 'completed' | string
  resultsVoided: number; resultReportsMarked: number; dispensingReversed: boolean; specimensCollected: number
  recordedBy: NamedAccount[]; reporterRecordedWork: boolean; flags: string[]
  facilityReportsLast30Days: number; memberReportsLast30Days: number
  review: null | { reviewedAt: string; reviewedBy: NamedAccount; actions: string[]; note: string }
}
/** What support records at review (C27): one or more actions, or exactly `no_further_action`. */
export type WrongPatientReviewAction = 'ordering_facility_told' | 'facility_contacted' | 'staff_access_changed'
  | 'facility_suspended' | 'referred_to_dpo' | 'no_further_action'
/** `POST /admin/wrong-patient-reports/:reportId/review`. */
export interface WrongPatientReportReviewed extends Versioned {
  reportId: string; reviewedAt: string; actions: string[]; noteRemoved: boolean
}

/** `POST /admin/self-service-facilities/:applicationId/release`. */
export interface SelfServiceFacilityReleased extends Versioned { applicationId: string; releasedAt: string }
/**
 * A self-service application not activated yet (P4 round 2, Novu only): `GET /admin/self-service-applications`, at
 * most 200: since hid-system's R16, those holding their CAC number now first, then verified ones, then the newest.
 * It holds its CAC number and product until `lapsesAt`, 24 hours from `submittedAt`; one opened without a hold (its
 * email or network had a sign-up for that CAC number and product closed in the last 7 days, R15) holds nothing, and
 * its `lapsesAt` is `submittedAt`. `holdsCac` says whether it holds them now (R16; absent from an Identity before it).
 * `organizationName` is the verified legal name, null until the CAC is verified.
 */
export interface SelfServiceApplication extends Versioned {
  applicationId: string; productCode: string; organizationType: string; cacHint: string; organizationName: string | null
  administratorName: string; administratorEmail: string; status: 'pending_verification' | 'ready_for_review' | string
  verificationResult: string | null; emailVerified: boolean; submittedAt: string; lapsesAt: string; holdsCac?: boolean
}
/**
 * One read of the open applications: `total` counts every open one that matches, beyond the 200 listed (R16; absent
 * from an Identity before it).
 */
export interface SelfServiceApplicationList { total?: number; items: SelfServiceApplication[] }
/** `POST /admin/self-service-applications/:applicationId/reject`. */
export interface SelfServiceApplicationRejected extends Versioned { applicationId: string; rejectedAt: string }
/** The products a facility can sign itself up for, which a refusal is for. */
export type SelfServiceProduct = 'ehr' | 'migrate' | 'laboratory' | 'pharmacy'
/** `POST /admin/self-service-applications/waive-refusal` (R15): one entry per 7-day refusal lifted. */
export interface SelfServiceRefusalsWaived { waived: Array<Versioned & { applicationId: string; waivedAt: string }> }
export interface IntegrationProvider extends Versioned {
  provider: string; name: string; enabled: boolean; health: string; managementMode: string; availableActions: string[]
  capabilities?: string[]; activeCapabilities?: string[]
  operationGates?: Array<{ operation: string; state: string; detail: string }>
  /** Non-secret settings only; the backend filters the stored configuration. */
  configuration?: Record<string, string>
  /** Credential state only; never a credential value. */
  credential?: { state: string; rotationSupported: boolean }
  lastTestedAt?: string | null; lastSuccessfulTestAt?: string | null; lastFailedTestAt?: string | null
}
export interface IntegrationCapability extends Versioned { capability: string; activeProvider: string | null; fallbackProvider: string | null; eligibleProviders: string[] }
export interface IntegrationCatalog { items: IntegrationProvider[]; capabilities: IntegrationCapability[] }
export interface IntegrationEvent {
  eventId: string; action: string; occurredAt: string; actorAccountId: string | null; correlationId: string
  capability: string | null; reason: string | null; outcome: string
}
/** `GET /admin/overview` (hid-system AdminService.overview). */
export interface PlatformOverview {
  registeredPatients: number; facilities: number; verifiedFacilities: number; suspendedFacilities: number
  activeStaffMemberships: number; pendingIdentityReviews: number
}
export interface DeliveryFailure {
  eventId: string | null; eventType: string | null; producer: string | null; attemptCount: number | null
  errorCode: string | null; errorSummary: string | null; failedAt: string | null
}
export interface ServiceState { service: string; state: string; checkedAt: string; code: string | null }

// Platform security contract: hid-system phase-4-stage-2-backend-security at
// 7cbbf98 (ADR-038), with the Stage 4A contracts (hid-system
// docs/PHASE_4_STAGE_4A_ADMIN_CONTRACTS.md). Field names and values are the backend's.

/** Password accepted: the backend has set an httpOnly MFA challenge cookie. */
export interface PlatformLoginChallenge { status: 'mfa_required' | 'mfa_enrollment_required'; expiresAt: string }
/** An MFA-verified platform session (verify, activate and refresh responses). */
export interface PlatformSessionGrant { actor: AdminActor & { kind?: string; sessionId?: string }; expiresAt: string; idleExpiresAt: string }
/** Returned once, by enrollment start. The secret is never available again. */
export interface MfaEnrollment {
  secret: string; otpauthUri: string; algorithm: 'SHA1'; digits: number; periodSeconds: number; expiresAt: string
}
export interface MfaStatus {
  enrolled: boolean
  factorType: 'totp'
  activatedAt: string | null
  lastUsedAt: string | null
  recoveryCodesRemaining: number
  session: {
    mfaVerifiedAt: string; mfaMethod: 'totp' | 'recovery_code'; stepUpExpiresAt: string | null
    idleExpiresAt: string; absoluteExpiresAt: string
  } | null
}
export interface PlatformSessionInfo {
  sessionId: string; familyId: string; kind: string; authenticationMethod: string; signedInAt: string
  lastRefreshedAt: string; idleExpiresAt: string; absoluteExpiresAt: string; mfaVerifiedAt: string | null
  mfaMethod: string | null; lastStepUpAt: string | null; sourceIp: string | null; current: boolean
}
export interface SessionList { accountId: string; items: PlatformSessionInfo[] }
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired'
export type ApprovalDecision = 'approve' | 'reject' | 'cancel'
export interface ApprovalRequest extends Versioned {
  id: string; action: 'platform_role.grant' | 'mfa.reset'; roleCode: string | null; targetAccountId: string
  targetEmail: string | null; targetDisplayName: string | null; reason: string; status: ApprovalStatus
  requestedBy: string; requestedAt: string; expiresAt: string; decidedBy: string | null; decidedAt: string | null
  decisionReason: string | null; executedAt: string | null
}
export interface ApprovalRequested extends Versioned { requestId: string; status: ApprovalStatus; expiresAt: string; replayed: boolean }
export interface ApprovalDecided extends Versioned {
  requestId: string; status: ApprovalStatus; action: string; targetAccountId: string; executed: boolean; replayed: boolean
}
// Clinician self sign-up review (hid-system ADR-066, branch claude/clinician-self-signup at fa58e2b, not
// merged): ClinicianApplicationAdminService and identity.admin_get_clinician_application (C18). Field names
// and values are the backend's.

export type ClinicianApplicationState = 'awaiting_authenticator' | 'submitted' | 'under_review' | 'approved' | 'rejected'
  | 'withdrawn' | 'expired'
/** `open` lists the three undecided states (not overdue), oldest first; a named state lists newest first. */
export type ClinicianApplicationFilter = 'open' | ClinicianApplicationState
/** The reason shown to the applicant; `identity_not_confirmed` also stops the account applying again. */
export type ClinicianDecisionCode = 'licence_not_verified' | 'licence_not_current' | 'details_mismatch'
  | 'identity_not_confirmed' | 'employment_not_confirmed' | 'facility_not_available' | 'duplicate' | 'existing_account' | 'other'
export interface ClinicianApplicationSummary extends Versioned {
  applicationId: string; state: ClinicianApplicationState | string; submittedAt: string; expiresAt: string
  applicant: { accountId: string; fullName: string; email: string }
  profession: 'doctor' | 'nurse' | string; regulator: { code: string; name: string }
  licenceNumber: string; licenceValidUntil: string
  facility: { id: string; name: string; organizationName: string }
  authenticatorReady: boolean
  step1: { by: { accountId: string; displayName: string | null }; at: string } | null
}
/** Why the caller may not take a step (a display hint: the command checks again). */
export type ClinicianStepRefusal = 'SELF' | 'WORKS_AT_FACILITY' | 'STATE' | 'STEP1_BY_YOU' | 'AUTHENTICATOR_REQUIRED'
  | 'ACCOUNT_INELIGIBLE'
export interface ClinicianStepHint { allowed: boolean; reason: ClinicianStepRefusal | string | null }
export interface ClinicianAttestationChecklist {
  registerChecked: true; licenceCurrentUntilRecorded: true; identityMethod: 'video_call_photo_id' | 'in_person_photo_id'
  identityConfirmed: true; employmentChannel: 'facility_public_phone' | 'in_person_visit'; employmentConfirmed: true
}
export interface ClinicianApplicationDetail extends Omit<ClinicianApplicationSummary, 'facility' | 'step1'> {
  account: { status: string; createdAt: string | null; emailVerifiedAt: string | null; patientAccount: boolean; identityRejection: boolean }
  staff: { id: string; verificationStatus: string; version: number } | null
  authenticator: { enrolled: boolean; factorId: string | null; activatedAt: string | null; enrolledAfterRecovery: boolean }
  otherMemberships: Array<{ facilityName: string; state: string; roles: string[] }>
  facility: {
    id: string; name: string; organizationName: string; lifecycleStatus: string; active: boolean; cacHint: string | null
    orgAdmins: Array<{ displayName: string | null; email: string }>
  }
  attestation: {
    id: string; reviewerAccountId: string; reviewerName: string | null; validUntil: string; evidenceReference: string
    reason: string; recordedAt: string; checklist: Partial<ClinicianAttestationChecklist> | null; factorConfirmedAt: string | null
  } | null
  approval: { by: string; at: string; membershipId: string | null } | null
  decision: { code: ClinicianDecisionCode | string | null; reason: string | null; by: string | null; at: string } | null
  accessState: 'active' | 'lapsed' | 'ended' | 'account_unavailable' | string | null
  rolePermissions: string[]
  flags: {
    sameLicenceKeyOtherAccounts: number; sameLicenceKeyOtherOpenApplications: number; sameLicenceAttestedElsewhere: boolean
    orgAdminNameMatch: boolean; orgAdminEmailDomainMatch: boolean
  }
  callerHints: { attest: ClinicianStepHint; approve: ClinicianStepHint; reject: ClinicianStepHint }
}
/** A3's body. The applicant's code is checked once and never stored; a replay needs no new code. */
export interface ClinicianAttestation {
  validUntil: string; evidenceReference: string; checklist: ClinicianAttestationChecklist; authenticatorCode: string; reason: string
}
export interface ClinicianAttested extends Versioned {
  applicationId: string; state: 'under_review'; attestationId: string; attestedRoles: string[]
  verificationMethod: 'manual_review'; validUntil: string; replayed: boolean
}
export interface ClinicianApproved extends Versioned {
  applicationId: string; state: 'approved'; accountId: string; facilityId: string; membershipId: string; roleCode: string
  attestationId: string; replayed: boolean
}
export interface ClinicianRejected extends Versioned {
  applicationId: string; state: 'rejected'; decisionCode: ClinicianDecisionCode; replayed: boolean
}
type ClinicianApplicationRef = Pick<ClinicianApplicationSummary, 'applicationId' | 'version'>

/** Principal export. Header values are null when the browser may not read them. */
export interface PrincipalExport { blob: Blob; rowCount: number | null; rowLimit: number | null; truncated: boolean | null }

/** The backend's own rejection of a submitted code: never resend that code. */
const keepCodeRejection = (error: HidApiError) => error.code !== 'MFA_INVALID_CODE'

let client: ReturnType<typeof createApiClient> | null = null
function gateway() {
  client ??= createRegisteredBrowserClient(createApiClient({ baseUrl: environment().apiBaseUrl,
    clientId: 'admin-web', sessionMode: 'cookie', csrfCookieName: usesNovuBackend() ? 'hid_access_csrf' : 'hid_access_admin_csrf',
    refreshSession: async () => { await adminApi.refresh() } }), 'admin-web', { backendContract: backendContract() })
  return client
}

/** Platform sign-in steps whose 401 is an answer to the submitted credential. */
const SIGN_IN_PATHS = ['/api/v1/auth/admin/login', '/api/v1/auth/admin/mfa/', '/api/v1/auth/admin/refresh',
  '/api/v1/auth/login', '/api/v1/auth/refresh']

async function request<T>(path: string, options: Partial<RequestSpec> = {}): Promise<T> {
  if (!path.startsWith('/api/v1/admin/') && !path.startsWith('/api/v1/auth/')) {
    throw new Error('The admin application can call only its own backend routes.')
  }
  // Platform administration is platform-scoped: the backend binds no facility
  // to admin routes, so admin requests never carry a provider facility context.
  if (Object.keys(options.headers ?? {}).some(name => name.toLowerCase() === 'x-facility-id')) {
    throw new Error('Platform administration requests do not carry a facility.')
  }
  try {
    return await gateway().request<T>({ method: options.method ?? 'GET', path,
      ...(options.body !== undefined ? { body: options.body } : {}),
      ...(options.query ? { query: options.query } : {}),
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.retry ? { retry: options.retry } : {}),
      ...(options.responseType ? { responseType: options.responseType } : {}),
      ...(options.refreshOnUnauthorized ? { refreshOnUnauthorized: options.refreshOnUnauthorized } : {}),
      auth: options.auth ?? 'required',
    })
  } catch (error) {
    // A protected request still unauthenticated after the client's one refresh,
    // or refused for lacking an MFA-verified platform session, means the server
    // no longer accepts this platform session. The server says whether it
    // expired or was revoked when it can (Stage 4A).
    if (isHidApiError(error) && options.auth !== 'none' && !SIGN_IN_PATHS.some(prefix => path.startsWith(prefix))
      && ((error.status === 401 && SESSION_END_CODES.has(error.code))
        || (error.status === 403 && error.code === 'PLATFORM_SESSION_REQUIRED'))) {
      reportSessionEnded(serverSessionEnd(error.code))
    }
    throw error
  }
}

/** 401 codes meaning the server no longer accepts this platform session. */
const SESSION_END_CODES = new Set(['AUTHENTICATION_REQUIRED', 'PLATFORM_SESSION_EXPIRED', 'PLATFORM_SESSION_REVOKED'])

/**
 * The administrator whose workspace is open, or null while none is (checking,
 * signing in, signed out, ended). Held in memory only. Every admin tab shares the
 * browser's platform cookies, so a refresh can answer for an administrator who
 * signed in from another tab: that has not restored this workspace's session.
 */
let openAccount: string | null = null
/**
 * A workspace ended and no other is being opened yet (no session check or
 * sign-in since). Requests it sent may still be refused with 401 after the
 * browser's cookies came to hold another administrator's session; a refresh
 * then would answer for them and the client would repeat the request, a command
 * included, as them. So none is made until the next workspace is opened.
 */
let workspaceClosed = false

export function adminSessionAccount(): string | null {
  return openAccount
}

/** Binds the workspace to `accountId`; with null, opens the way for one (a session check or a sign-in). */
export function setAdminSessionAccount(accountId: string | null): void {
  openAccount = accountId
  workspaceClosed = false
}

/** The workspace ended: no session is restored for it, or as anyone, until the next one is opened. */
export function closeAdminSession(): void {
  openAccount = null
  workspaceClosed = true
}

/** The client does not repeat a request whose refresh is refused with this 401. */
function sessionNotRestored(): HidApiError {
  return new HidApiError(401, 'Your platform session has ended. Sign in again to continue.',
    { code: 'AUTHENTICATION_REQUIRED', retryable: false })
}

function grant(value: PlatformSessionGrant): PlatformSessionGrant {
  recordSessionWindow({ idleExpiresAt: value.idleExpiresAt })
  return value
}

/**
 * A sign-in step that answered with a session has set the browser's platform
 * cookies, which every admin tab sends from then on, so the other tabs are told
 * at once rather than when this one opens its workspace.
 */
function signedIn<T extends PlatformSessionGrant>(value: T): T {
  grant(value)
  announceAdminSessionChange()
  return value
}

/** One key per user submission, reused if that submission is retried after step-up. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}

const at = (base: string, ...segments: string[]) => [base, ...segments.map(encodeURIComponent)].join('/')

/** Rows per page for paged admin lists (the backend allows up to 100). */
export const PAGE_SIZE = 25
/** Audit events per request (the backend allows up to 200). */
export const AUDIT_PAGE_SIZE = 50
/** Rows per page for the cursor-paged demo-request list (the backend allows up to 100). */
export const CURSOR_PAGE_SIZE = 50

/**
 * An Identity build before hid-system Stage 4A returns `{ items }` without
 * `nextCursor`: its list is the backend's capped first page, with no further page.
 */
async function cursorPage<T>(page: Promise<CursorPage<T>>): Promise<CursorPage<T>> {
  const value = await page
  return { items: value.items, nextCursor: value.nextCursor ?? null }
}

/**
 * An Identity without hid-system ADR-066 has no queue: its 404 names no
 * clinician code (`NOT_FOUND`, with a detail naming the route). It is said as
 * that, never as a missing application or in the router's words.
 */
async function clinicianQueue<T>(read: Promise<T>): Promise<T> {
  try {
    return await read
  } catch (error) {
    if (isHidApiError(error) && error.status === 404 && error.code === 'NOT_FOUND') {
      throw new HidApiError(404, 'The clinician queue is not available from this Identity.',
        { code: 'CLINICIAN_QUEUE_UNAVAILABLE', requestId: error.requestId, retryable: false })
    }
    throw error
  }
}

/**
 * An Identity without facility self sign-up (hid-system main, or Novu before P4), or without its open applications
 * (Novu before P4 round 2), has no such list: its 404 names no code of its own (`NOT_FOUND`, with a detail naming
 * the route). It is said as that, never in the router's words.
 */
async function selfServiceList<T>(read: Promise<T>, unavailable: { code: string; message: string } = {
  code: 'SELF_SERVICE_REVIEW_UNAVAILABLE', message: 'New facility sign-ups are not available from this Identity.' }): Promise<T> {
  try {
    return await read
  } catch (error) {
    if (isHidApiError(error) && error.status === 404 && error.code === 'NOT_FOUND') {
      throw new HidApiError(404, unavailable.message, { code: unavailable.code, requestId: error.requestId, retryable: false })
    }
    throw error
  }
}

/**
 * An Identity without the wrong-patient report (item 3; hid-system main, or Novu before 0088) has no such route: its 404
 * names no code of its own. It is said as that, never as a missing facility or report, so a page can show nothing.
 */
async function wrongPatientRead<T>(read: Promise<T>, message: string): Promise<T> {
  try {
    return await read
  } catch (error) {
    if (isHidApiError(error) && error.status === 404 && (error.code === 'NOT_FOUND' || error.code === 'API_ROUTE_NOT_FOUND')) {
      throw new HidApiError(404, message, { code: 'WRONG_PATIENT_REPORTS_UNAVAILABLE', requestId: error.requestId, retryable: false })
    }
    throw error
  }
}

/**
 * An Identity without orders between facilities (hid-system main, or Novu before P4c) has no such route: its 404 names
 * no code of its own. It is said as that, never as a missing facility or order.
 */
async function orderRoutesRead<T>(read: Promise<T>, message: string): Promise<T> {
  try {
    return await read
  } catch (error) {
    if (isHidApiError(error) && error.status === 404 && (error.code === 'NOT_FOUND' || error.code === 'API_ROUTE_NOT_FOUND')) {
      throw new HidApiError(404, message, { code: 'ORDER_ROUTES_UNAVAILABLE', requestId: error.requestId, retryable: false })
    }
    throw error
  }
}

export const adminApi = {
  async novuLogin(email: string, password: string, token: string): Promise<void> {
    if (!usesNovuBackend()) throw new Error('Novu authentication requires the configured novu-v1 backend.')
    await request('/api/v1/auth/login', { method: 'POST', auth: 'none',
      body: { email, password, turnstileAction: 'admin-login', ...(token ? { turnstileToken: token } : {}) } })
    announceAdminSessionChange()
  },
  login(email: string, password: string, token: string) {
    return request<PlatformLoginChallenge>('/api/v1/auth/admin/login', { method: 'POST', auth: 'none',
      body: { email, password, turnstileAction: 'admin-login', ...(token ? { turnstileToken: token } : {}) } })
  },
  async verifyMfa(input: { code: string } | { recoveryCode: string }) {
    return signedIn(await request<PlatformSessionGrant>('/api/v1/auth/admin/mfa/verify', { method: 'POST', auth: 'none', body: input }))
  },
  startEnrollment() {
    return request<MfaEnrollment>('/api/v1/auth/admin/mfa/enroll/start', { method: 'POST', auth: 'none' })
  },
  async activateEnrollment(code: string) {
    return signedIn(await request<PlatformSessionGrant & { recoveryCodes: string[] }>(
      '/api/v1/auth/admin/mfa/enroll/activate', { method: 'POST', auth: 'none', body: { code } }))
  },
  session() { return request<AdminSession>('/api/v1/admin/session') },
  async refresh() {
    if (workspaceClosed) throw sessionNotRestored()
    if (usesNovuBackend()) {
      // With no readable CSRF cookie there is no safely refreshable Novu session.
      // Treat a first visit as signed out, not as a failed admin/MFA endpoint.
      if (!document.cookie.split(';').some(cookie => cookie.trim().startsWith('hid_access_csrf='))) throw sessionNotRestored()
      const value = await request<{ actor: { accountId: string }; expiresAt?: string }>(
        '/api/v1/auth/refresh', { method: 'POST', auth: 'optional' })
      if (openAccount !== null && value.actor.accountId !== openAccount) {
        reportSessionEnded('switched')
        throw sessionNotRestored()
      }
      return value
    }
    let refreshed: PlatformSessionGrant
    try {
      refreshed = await request<PlatformSessionGrant>('/api/v1/auth/admin/refresh', { method: 'POST', auth: 'optional' })
    } catch (error) {
      // The shared client reports the original request's 401 after a failed
      // refresh, so keep the refresh's own reason for the session-end notice.
      if (isHidApiError(error) && error.status === 401) recordServerSessionEnd(serverSessionEnd(error.code))
      throw error
    }
    // A session for another administrator ends this workspace. The refusal is a
    // 401, so the client does not repeat the original request as them.
    if (openAccount !== null && refreshed.actor?.accountId !== openAccount) {
      reportSessionEnded('switched')
      throw sessionNotRestored()
    }
    return grant(refreshed)
  },
  logout() { return request<void>(usesNovuBackend() ? '/api/v1/auth/logout' : '/api/v1/auth/admin/logout', { method: 'POST' }) },
  async mfaStatus(signal?: AbortSignal) {
    const status = await request<MfaStatus>('/api/v1/admin/mfa', { signal })
    if (status.session) {
      recordSessionWindow({ idleExpiresAt: status.session.idleExpiresAt, absoluteExpiresAt: status.session.absoluteExpiresAt })
    }
    return status
  },
  stepUp(code: string) {
    return request<{ stepUpExpiresAt: string }>('/api/v1/admin/mfa/step-up', { method: 'POST', body: { code },
      refreshOnUnauthorized: keepCodeRejection })
  },
  regenerateRecoveryCodes() {
    return request<{ recoveryCodes: string[] }>('/api/v1/admin/mfa/recovery-codes/regenerate', { method: 'POST' })
  },
  sessions(signal?: AbortSignal) { return request<SessionList>('/api/v1/admin/sessions', { signal }) },
  revokeOwnSession(sessionId: string) {
    return request<{ sessionId: string; revokedCount: number }>(at('/api/v1/admin/sessions', sessionId, 'revoke'), { method: 'POST' })
  },
  principalSessions(accountId: string, signal?: AbortSignal) {
    return request<SessionList>(at('/api/v1/admin/principals', accountId, 'sessions'), { signal })
  },
  revokePrincipalSession(accountId: string, sessionId: string, input: { reason: string; compromised: boolean }, idempotencyKey: string) {
    return request<{ accountId: string; revokedCount: number; replayed: boolean }>(
      at('/api/v1/admin/principals', accountId, 'sessions', sessionId, 'revoke'),
      { method: 'POST', body: input, headers: { 'Idempotency-Key': idempotencyKey } })
  },
  /**
   * Newest first, one page per call (the backend's default of 50 rows unless
   * `limit` is given); pass the previous page's `nextCursor` with the same
   * status. `limit` and `cursor` are sent only when given, because an Identity
   * build before Stage 4A refuses any parameter but `status`.
   */
  approvals(status: ApprovalStatus | null, page: { cursor?: string; limit?: number } = {}, signal?: AbortSignal) {
    return cursorPage(request<CursorPage<ApprovalRequest>>('/api/v1/admin/approvals', { signal, query: {
      ...(status ? { status } : {}), ...(page.limit ? { limit: page.limit } : {}),
      ...(page.cursor ? { cursor: page.cursor } : {}) } }))
  },
  requestSuperAdmin(accountId: string, reason: string, idempotencyKey: string) {
    return request<ApprovalRequested>(at('/api/v1/admin/principals', accountId, 'super-admin-requests'),
      { method: 'POST', body: { reason }, headers: { 'Idempotency-Key': idempotencyKey } })
  },
  requestMfaReset(accountId: string, reason: string, idempotencyKey: string) {
    return request<ApprovalRequested>(at('/api/v1/admin/principals', accountId, 'mfa-reset-requests'),
      { method: 'POST', body: { reason }, headers: { 'Idempotency-Key': idempotencyKey } })
  },
  decideApproval(approval: Pick<ApprovalRequest, 'id' | 'version'>, decision: ApprovalDecision, reason: string, idempotencyKey: string) {
    return adminApi.command<ApprovalDecided>(at('/api/v1/admin/approvals', approval.id, decision), { reason },
      { version: approval.version, idempotencyKey })
  },
  async exportPrincipals(input: { reason: string; query?: string; status?: string }, signal?: AbortSignal): Promise<PrincipalExport> {
    // Every export is audited, so a failed export is never repeated automatically. Its terms and the
    // audited reason go in the body, out of URLs and access logs (hid-system A24).
    const result = await request<DownloadResult>('/api/v1/admin/principals/export', { method: 'POST', responseType: 'download',
      retry: NO_RETRY, signal, body: { reason: input.reason,
        ...(input.query !== undefined ? { query: input.query } : {}), ...(input.status !== undefined ? { status: input.status } : {}) } })
    const header = (name: string) => result.headers.get(name)
    const count = header('X-HID-Export-Row-Count')
    const limit = header('X-HID-Export-Row-Limit')
    const truncated = header('X-HID-Export-Truncated')
    return { blob: result.blob, rowCount: count === null ? null : Number(count), rowLimit: limit === null ? null : Number(limit),
      truncated: truncated === null ? null : truncated === 'true' }
  },
  overview(signal?: AbortSignal) { return request<PlatformOverview>('/api/v1/admin/overview', { signal }) },
  controls(signal?: AbortSignal) { return request<PlatformControl[]>('/api/v1/admin/controls', { signal }) },
  facilities(filters: { page?: number; pageSize?: number; status?: string; query?: string } = {}, signal?: AbortSignal) {
    return request<Page<Facility>>('/api/v1/admin/facilities', { signal, query: { page: filters.page ?? 1,
      pageSize: filters.pageSize ?? PAGE_SIZE, status: filters.status, query: filters.query } })
  },
  facility(facilityId: string, signal?: AbortSignal) {
    return request<Facility>(at('/api/v1/admin/facilities', facilityId), { signal })
  },
  assistedRegistration(facilityId: string, signal?: AbortSignal) {
    return request<AssistedRegistrationDesignation>(at('/api/v1/admin/facilities', facilityId, 'assisted-registration'), { signal })
  },
  /**
   * Designates or suspends a facility (hid-system #85, ADR-063): a high-risk command needing step-up, a
   * reason, the submission's key and If-Match with the version read, 0 for the first designation.
   */
  setAssistedRegistration(facilityId: string, input: AssistedRegistrationDesignationInput, version: number, idempotencyKey: string) {
    return adminApi.command<AssistedRegistrationSaved>(at('/api/v1/admin/facilities', facilityId, 'assisted-registration'), input,
      { version, idempotencyKey, creates: true })
  },
  /**
   * The phone an emergency-contact alert gives for a facility (hid-system #109, Novu only), or null to clear it so
   * alerts give Health ID support's. As the status command: If-Match with the facility version, which it bumps,
   * the submission's key and a reason.
   */
  setFacilityAlertPhone(facility: Pick<Facility, 'id' | 'version'>, phone: string | null, reason: string, idempotencyKey: string) {
    return adminApi.command<FacilityAlertPhoneSaved>(at('/api/v1/admin/facilities', facility.id, 'alert-phone'), { phone, reason },
      { version: facility.version, idempotencyKey })
  },
  /**
   * Support stops emergency-access alerts to someone who asked (hid-system #109, Novu only): every patient's
   * contact at that destination is removed. The destination goes in the POST body, never in a URL.
   */
  optOutEmergencyContact(input: { channel: 'email' | 'sms'; destination: string; reason: string }, idempotencyKey: string) {
    return adminApi.command<EmergencyContactOptOut>('/api/v1/admin/emergency-contacts/opt-out', input, { idempotencyKey })
  },
  /**
   * A search term is a name or an email address, so it goes in a POST body, never in a URL that browser
   * history or an access log keeps (hid-system A24). Being a POST, a failed search is not repeated.
   */
  principals(query: string, filters: { page?: number; status?: string } = {}, signal?: AbortSignal) {
    return request<Page<Principal>>('/api/v1/admin/principals/search', { method: 'POST', signal,
      body: { query, page: filters.page ?? 1, pageSize: PAGE_SIZE, ...(filters.status ? { status: filters.status } : {}) } })
  },
  reviews(filters: { page?: number; status?: string } = {}, signal?: AbortSignal) {
    return request<Page<IdentityReview>>('/api/v1/admin/identity/reviews', { signal,
      query: { page: filters.page ?? 1, pageSize: PAGE_SIZE, status: filters.status } })
  },
  audit(filters: AuditFilters = {}, beforeSequenceId?: string, signal?: AbortSignal) {
    return request<AuditEventPage>('/api/v1/admin/audit/events', { signal,
      query: { limit: AUDIT_PAGE_SIZE, ...filters, ...(beforeSequenceId ? { beforeSequenceId } : {}) } })
  },
  services(signal?: AbortSignal) { return request<{ checkedAt: string; services: ServiceState[] }>('/api/v1/admin/operations/services', { signal }) },
  events(signal?: AbortSignal) { return request<{ state: string; code: string | null; metrics: Record<string, number | boolean> | null; failures: DeliveryFailure[] }>('/api/v1/admin/operations/events', { signal }) },
  pricing(signal?: AbortSignal) { return request<PricingCatalog>('/api/v1/admin/pricing', { signal }) },
  /** Newest first, one page per call; pass the previous page's `nextCursor` with the same filters. */
  demos(filters: { status?: DemoStatus; productCode?: string } = {}, page: { cursor?: string; limit?: number } = {},
    signal?: AbortSignal) {
    return cursorPage(request<CursorPage<DemoRequest>>('/api/v1/admin/demo-requests', { signal,
      query: { limit: page.limit ?? CURSOR_PAGE_SIZE, status: filters.status, productCode: filters.productCode,
        ...(page.cursor ? { cursor: page.cursor } : {}) } }))
  },
  applications(status?: ApplicationStatus, signal?: AbortSignal) {
    return request<{ items: OrganizationApplication[] }>('/api/v1/admin/organization-applications', { signal,
      ...(status ? { query: { status } } : {}) })
  },
  verifyApplicationCac(application: Pick<OrganizationApplication, 'applicationId' | 'version'>) {
    return adminApi.command<{ status: string; version: number; state: string; profileState?: string }>(
      at('/api/v1/admin/organization-applications', application.applicationId, 'verify-cac'), {}, { version: application.version })
  },
  approveApplication(application: Pick<OrganizationApplication, 'applicationId' | 'version'>, reason: string,
    existing?: { organizationId: string; facilityId: string }) {
    return adminApi.command<{ organizationId: string; facilityId: string; firstAdminAccountId: string; version: number; organizationReused: boolean }>(
      at('/api/v1/admin/organization-applications', application.applicationId, 'approve'),
      { reason, ...(existing ? { existingOrganizationId: existing.organizationId, existingFacilityId: existing.facilityId } : {}) },
      { version: application.version })
  },
  rejectApplication(application: Pick<OrganizationApplication, 'applicationId' | 'version'>, reason: string) {
    return adminApi.command<{ status: string; version: number }>(
      at('/api/v1/admin/organization-applications', application.applicationId, 'reject'), { reason }, { version: application.version })
  },
  /** Facilities that signed themselves up (P4, Novu only), for support's review within a working day. */
  selfServiceFacilities(state: SelfServiceFacilityState, signal?: AbortSignal) {
    return selfServiceList(request<{ items: SelfServiceFacility[] }>('/api/v1/admin/self-service-facilities',
      { signal, query: { state } }))
  },
  /**
   * Records that support checked a self-signed-up facility, which since P4b gives it full access and signs its
   * administrator out once: a note of 8 to 500 characters, the administrator's own access (a clinical role with the
   * licence support checked, or none) and how support checked, with If-Match with the version listed. Needs
   * platform.facility.manage and platform.facility.unlock. Novu has no step-up or Idempotency-Key here.
   */
  reviewSelfServiceFacility(facility: Pick<SelfServiceFacility, 'applicationId' | 'version'>, note: string,
    access: SelfServiceAdministratorAccess) {
    return adminApi.command<SelfServiceFacilityReviewed>(
      at('/api/v1/admin/self-service-facilities', facility.applicationId, 'review'), { note, ...access },
      { version: facility.version })
  },
  /** Changes a reviewed administrator's own access (P4b): as the review's, with a reason; a new role signs them out. */
  setSelfServiceAdministratorRole(facility: Pick<SelfServiceFacility, 'applicationId' | 'version'>, reason: string,
    access: SelfServiceAdministratorAccess) {
    return adminApi.command<SelfServiceAdministratorRoleChanged>(
      at('/api/v1/admin/self-service-facilities', facility.applicationId, 'administrator-role'), { ...access, reason },
      { version: facility.version })
  },
  /** Ends a reviewed facility's first-30-days limits early (P4b): a reason of 8 to 500 characters. */
  endSelfServiceProbation(facility: Pick<SelfServiceFacility, 'applicationId' | 'version'>, reason: string) {
    return adminApi.command<SelfServiceProbationEnded>(
      at('/api/v1/admin/self-service-facilities', facility.applicationId, 'end-probation'), { reason },
      { version: facility.version })
  },
  /**
   * A facility's staff and invitations with their full licence numbers, who vouched and when (P4b, Novu only).
   * Identity audits every read. An Identity without the route answers 404, said as not available.
   */
  facilityStaff(facilityId: string, signal?: AbortSignal) {
    return selfServiceList(request<AdminFacilityStaff>(at('/api/v1/admin/facilities', facilityId, 'staff'), { signal }),
      { code: 'FACILITY_STAFF_UNAVAILABLE', message: 'Facility staff and licences are not available from this Identity.' })
  },
  /** A facility's orders with other facilities (P4c, Novu only): listing and counts, no patient or order content. */
  facilityOrderRouteSummary(facilityId: string, signal?: AbortSignal) {
    return orderRoutesRead(request<FacilityOrderRouteSummary>(at('/api/v1/admin/facilities', facilityId, 'order-route-summary'), { signal }),
      'Orders between facilities are not available from this Identity.')
  },
  /** Lists a laboratory or pharmacy for orders from other facilities, or stops listing it (P4c): a reason of 8 to 500. */
  setOrderDestination(facilityId: string, listed: boolean, reason: string) {
    return orderRoutesRead(adminApi.command<OrderDestinationSet>(at('/api/v1/admin/facilities', facilityId, 'order-destination'),
      { listed, reason }), 'Orders between facilities are not available from this Identity.')
  },
  /**
   * Finds orders between facilities by their 8-character reference (at most 5) or the patient's Health ID (at most
   * 20), exactly one of them (P4c). Identity audits the lookup. A Health ID goes in the body of `POST
   * …/order-routes/search` (P4c review), never in a URL that an access log keeps; a reference is read with the GET.
   * Being a POST, a failed search by Health ID is not repeated.
   */
  findOrderRoutes(lookup: { reference: string } | { healthId: string }, signal?: AbortSignal) {
    const read = 'healthId' in lookup
      ? request<FoundOrderRoutes>('/api/v1/admin/order-routes/search', { method: 'POST', signal,
        body: { healthId: lookup.healthId } })
      : request<FoundOrderRoutes>('/api/v1/admin/order-routes', { signal, query: { reference: lookup.reference } })
    return orderRoutesRead(read, 'Orders between facilities can’t be found from this Identity.')
  },
  /** Closes an order between facilities at once (P4c): If-Match with its version and a reason of 8 to 500. */
  closeOrderRoute(route: Pick<FoundOrderRoute, 'routeId' | 'version'>, reason: string) {
    return orderRoutesRead(adminApi.command<OrderRouteClosed>(at('/api/v1/admin/order-routes', route.routeId, 'close'), { reason },
      { version: route.version }), 'Orders between facilities can’t be closed from this Identity.')
  },
  /**
   * Reports that a laboratory or pharmacy accepted an order for the wrong person (item 3, C26): `unreviewed` (every one
   * not reviewed, flagged first, then oldest) or `recent` (the last 90 days, newest first), at most 200, optionally
   * only those a facility made. Identity audits each read. An Identity without the route answers 404, said as
   * WRONG_PATIENT_REPORTS_UNAVAILABLE.
   */
  wrongPatientReports(status: 'unreviewed' | 'recent', facilityId?: string, signal?: AbortSignal) {
    return wrongPatientRead(request<{ items: WrongPatientReport[] }>('/api/v1/admin/wrong-patient-reports',
      { signal, query: { status, ...(facilityId ? { facilityId } : {}) } }),
    'Wrong-patient reports are not available from this Identity yet.')
  },
  /**
   * Marks a wrong-patient report reviewed, once (item 3, C27): If-Match with its version, one or more actions (or
   * exactly no_further_action), a note of 8 to 500, and whether to remove the reporter's note. No Idempotency-Key.
   */
  reviewWrongPatientReport(report: Pick<WrongPatientReport, 'reportId' | 'version'>,
    body: { actions: WrongPatientReviewAction[]; note: string; removeNote?: boolean }) {
    return wrongPatientRead(adminApi.command<WrongPatientReportReviewed>(at('/api/v1/admin/wrong-patient-reports', report.reportId, 'review'),
      { actions: body.actions, note: body.note, ...(body.removeNote ? { removeNote: true } : {}) }, { version: report.version }),
    'Wrong-patient reports can’t be reviewed from this Identity yet.')
  },
  /** Finds an invitation by the 8-character reference its email quotes (P4b): the reference only, never an email. */
  findStaffInvitations(reference: string, signal?: AbortSignal) {
    return selfServiceList(request<{ items: FoundStaffInvitation[] }>('/api/v1/admin/staff-invitations',
      { signal, query: { reference } }),
    { code: 'STAFF_INVITATION_LOOKUP_UNAVAILABLE', message: 'Invitations can’t be found by reference from this Identity.' })
  },
  /**
   * Releases a fraudulent or mistaken self sign-up (P4 round 2), once its facility is suspended and its
   * administrator disabled: Identity closes the application, unlinks the CAC number, suspends the product and
   * deactivates and renames the organization, so the real company can sign up. A reason of 8 to 500 characters and
   * If-Match with the version listed, as the review; no step-up or Idempotency-Key. Its email and network then can't
   * start a sign-up for the CAC number and product for 7 days, unless `allowRetry` (R15), which is sent only when
   * true, so the body stays `{ reason }` for an Identity before R15.
   */
  releaseSelfServiceFacility(facility: Pick<SelfServiceFacility, 'applicationId' | 'version'>, reason: string,
    allowRetry = false) {
    return adminApi.command<SelfServiceFacilityReleased>(
      at('/api/v1/admin/self-service-facilities', facility.applicationId, 'release'),
      { reason, ...(allowRetry ? { allowRetry: true } : {}) }, { version: facility.version })
  },
  /** Self-service applications not activated yet (P4 round 2, Novu only), those holding their CAC number now first. */
  selfServiceApplications(signal?: AbortSignal) {
    return selfServiceList(request<SelfServiceApplicationList>('/api/v1/admin/self-service-applications', { signal }),
      { code: 'SELF_SERVICE_APPLICATIONS_UNAVAILABLE', message: 'Open sign-up applications are not available from this Identity.' })
  },
  /**
   * The open applications for one CAC number (R16). The number goes in a POST body, out of URLs and access logs, as
   * the principal search does; Identity removes spaces and upper-cases it, and refuses one that is not RC, BN or IT
   * and 4 to 20 digits (400 VALIDATION_FAILED). Being a POST, a failed search is not repeated.
   */
  searchSelfServiceApplications(cacRegistrationNumber: string, signal?: AbortSignal) {
    return selfServiceList(request<SelfServiceApplicationList>('/api/v1/admin/self-service-applications/search',
      { method: 'POST', signal, body: { cacRegistrationNumber } }),
    { code: 'SELF_SERVICE_APPLICATION_SEARCH_UNAVAILABLE', message: 'Open sign-ups can’t be found by CAC number from this Identity.' })
  },
  /**
   * Closes an open self-service application (P4 round 2): a reason of 8 to 500 characters and If-Match with the
   * version listed; no step-up or Idempotency-Key. Its email and network then can't start a sign-up for the CAC number
   * and product for 7 days, unless `allowRetry` (R15: the applicant's own mistake), sent only when true.
   */
  rejectSelfServiceApplication(application: Pick<SelfServiceApplication, 'applicationId' | 'version'>, reason: string,
    allowRetry = false) {
    return adminApi.command<SelfServiceApplicationRejected>(
      at('/api/v1/admin/self-service-applications', application.applicationId, 'reject'),
      { reason, ...(allowRetry ? { allowRetry: true } : {}) }, { version: application.version })
  },
  /**
   * Lifts every 7-day refusal a rejection or release set for a CAC number and product (R15), for a company whose own
   * email or network it refused: the CAC number (spaces removed, upper case), the product and a reason of 8 to 500
   * characters. No version, step-up or Idempotency-Key; 404 SELF_SERVICE_REFUSAL_NOT_FOUND when none is in force.
   */
  waiveSelfServiceRefusals(input: { cacRegistrationNumber: string; productCode: SelfServiceProduct; reason: string }) {
    return adminApi.command<SelfServiceRefusalsWaived>('/api/v1/admin/self-service-applications/waive-refusal', input)
  },
  integrations(signal?: AbortSignal) { return request<IntegrationCatalog>('/api/v1/admin/integrations', { signal }) },
  integrationHistory(provider: string, signal?: AbortSignal) {
    return request<{ items: IntegrationEvent[] }>(at('/api/v1/admin/integrations', provider, 'audit'), { signal })
  },
  configureIntegration(provider: Pick<IntegrationProvider, 'provider' | 'version'>, configuration: Record<string, string>,
    reason: string, idempotencyKey: string) {
    return adminApi.command<{ provider: string; enabled: boolean; configuration: Record<string, string>; version: number; replayed: boolean }>(
      at('/api/v1/admin/integrations', provider.provider, 'configuration'), { configuration, reason },
      { version: provider.version, idempotencyKey })
  },
  /**
   * The clinician verification queue (A1), one page per call: `limit` and
   * `cursor` are sent only when given (the backend's page is 20, at most 50).
   * The query carries no personal data.
   */
  clinicianApplications(state: ClinicianApplicationFilter, page: { cursor?: string; limit?: number } = {}, signal?: AbortSignal) {
    return clinicianQueue(cursorPage(request<CursorPage<ClinicianApplicationSummary>>('/api/v1/admin/clinician-applications', {
      signal, query: { state, ...(page.limit ? { limit: page.limit } : {}), ...(page.cursor ? { cursor: page.cursor } : {}) } })))
  },
  /** A2: one application with what both steps need, its warnings and the caller's hints. */
  clinicianApplication(applicationId: string, signal?: AbortSignal) {
    return clinicianQueue(request<ClinicianApplicationDetail>(at('/api/v1/admin/clinician-applications', applicationId), { signal }))
  },
  /** A3, step 1: the checklist, the evidence reference, the validity and a live code the applicant reads out. */
  attestClinicianApplication(application: ClinicianApplicationRef, input: ClinicianAttestation, idempotencyKey: string) {
    return adminApi.command<ClinicianAttested>(at('/api/v1/admin/clinician-applications', application.applicationId, 'attest'),
      input, { version: application.version, idempotencyKey })
  },
  /** A4, step 2: only a Super Admin other than step 1's; attaches the account and grants the role step 1 attested. */
  approveClinicianApplication(application: ClinicianApplicationRef, reason: string, idempotencyKey: string) {
    return adminApi.command<ClinicianApproved>(at('/api/v1/admin/clinician-applications', application.applicationId, 'approve'),
      { reason }, { version: application.version, idempotencyKey })
  },
  /** A5: a decision code the applicant sees and a reason they never see. */
  rejectClinicianApplication(application: ClinicianApplicationRef, decisionCode: ClinicianDecisionCode, reason: string,
    idempotencyKey: string) {
    return adminApi.command<ClinicianRejected>(at('/api/v1/admin/clinician-applications', application.applicationId, 'reject'),
      { decisionCode, reason }, { version: application.version, idempotencyKey })
  },
  /**
   * A governed admin command. Pass the submission's idempotency key so a retry
   * after step-up is the same command, never a second one. `version` goes as
   * If-Match; it is at least 1, or 0 for a command that `creates` its resource
   * (the facility designation, hid-system #85), whose If-Match: 0 is sent too.
   */
  command<T>(path: string, body: unknown, options: { version?: number; idempotencyKey?: string; creates?: boolean } = {}) {
    if (!path.startsWith('/api/v1/admin/')) throw new Error('Admin command route required.')
    if (options.version !== undefined
      && (!Number.isSafeInteger(options.version) || options.version < (options.creates ? 0 : 1))) {
      throw new Error('Reload this item before changing it.')
    }
    return request<T>(path, { method: 'POST', body, headers: {
      ...(options.version !== undefined ? { 'If-Match': `"${options.version}"` } : {}),
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
    } })
  },
}
