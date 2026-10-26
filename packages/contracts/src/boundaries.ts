/**
 * Application boundaries, expressed as code rather than as a convention.
 *
 * Each frontend is granted the backend route groups its workflows need. Calling
 * outside that grant fails loudly at development time.
 *
 * This is an architecture guard, not a security control. The backend authorises
 * every request regardless of which application sent it; what this prevents is
 * the slow drift where one frontend accumulates unrelated functionality until
 * the boundaries exist only in a diagram.
 */

import { findEndpoint, hasContracts, type HidService } from './registry'

export type HidApp =
  | 'public-web'
  | 'patient-web'
  | 'staff-web'
  | 'ehr-web'
  | 'lab-web'
  | 'pharmacy-web'
  | 'ocr-web'
  | 'outreach-web'
  | 'admin-web'

export interface AppBoundary {
  readonly app: HidApp
  /** One line on what this application is for. Anything outside it belongs elsewhere. */
  readonly purpose: string
  /** Backend services this application may call. */
  readonly services: readonly HidService[]
  /** Whether this application handles patient-identifying or clinical data. */
  readonly handlesPhi: boolean
}

/**
 * Declared with `as const satisfies` so the granted service list of each
 * application survives as a literal type. That is what lets `@hid/api` hand an
 * application only the services it owns, making a boundary violation a
 * compile error rather than something discovered at runtime.
 */
export const APP_BOUNDARIES = {
  'public-web': {
    app: 'public-web',
    purpose: 'Public information and the entry point into patient or provider sign-up.',
    services: ['auth', 'enrollment', 'commercial', 'platform', 'support'],
    handlesPhi: true,
  },
  'patient-web': {
    app: 'patient-web',
    purpose: 'A patient viewing and managing their own health information and consent.',
    services: ['auth', 'enrollment', 'identity', 'ehr', 'access', 'notifications', 'support'],
    handlesPhi: true,
  },
  'staff-web': {
    app: 'staff-web',
    purpose: 'Provider workflows: care, laboratory, pharmacy, OCR and outreach.',
    services: ['auth', 'enrollment', 'identity', 'ehr', 'access', 'files', 'lab', 'pharmacy', 'ocr', 'outreach', 'commercial'],
    handlesPhi: true,
  },
  'ehr-web': {
    app: 'ehr-web',
    purpose: 'Electronic health record authoring and review.',
    services: ['auth', 'identity', 'ehr', 'access', 'files'],
    handlesPhi: true,
  },
  'lab-web': {
    app: 'lab-web',
    purpose: 'Laboratory workflows: orders, specimens, results.',
    services: ['auth', 'identity', 'lab'],
    handlesPhi: true,
  },
  'pharmacy-web': {
    app: 'pharmacy-web',
    purpose: 'Pharmacy workflows: prescriptions, dispensing, stock.',
    services: ['auth', 'identity', 'pharmacy'],
    handlesPhi: true,
  },
  'ocr-web': {
    app: 'ocr-web',
    purpose: 'Document capture, OCR review and migration of existing records.',
    services: ['auth', 'identity', 'ocr'],
    handlesPhi: true,
  },
  'outreach-web': {
    app: 'outreach-web',
    purpose: 'Field registration campaigns run by outreach workers.',
    services: ['auth', 'identity', 'outreach'],
    handlesPhi: true,
  },
  'admin-web': {
    app: 'admin-web',
    purpose: 'Platform administration: users, roles, billing, platform controls.',
    services: ['auth', 'admin', 'platform'],
    handlesPhi: true,
  },
} as const satisfies Record<HidApp, AppBoundary>

/**
 * Shared services contain routes for different actors. These grants narrow a
 * service where the portal surfaces have distinct workflows; an unlisted
 * service follows APP_BOUNDARIES. The backend still decides actual access.
 */
export const APP_ROUTE_GRANTS: Partial<Record<HidApp,
  Partial<Record<HidService, readonly string[]>>>> = {
  'public-web': {
    auth: ['auth.patientLogin', 'auth.staffLogin', 'auth.googleNonce', 'auth.googleOnboarding',
      'auth.googleExchange', 'auth.otpStart', 'auth.otpVerify', 'auth.otpComplete'],
    // The enrollment routes the public site could reach before clinician self
    // sign-up, unchanged (with the patient NIN holder and facility routes main
    // added, hid-system #84 and #85); clinician sign-up is the provider portal's (staff-web).
    enrollment: ['enrollment.availability', 'enrollment.start', 'enrollment.current', 'enrollment.google',
      'enrollment.holder', 'enrollment.holderVerify', 'enrollment.facilityCode', 'enrollment.participatingFacilities',
      'enrollment.contact', 'enrollment.verifyContact', 'enrollment.activate',
      'enrollment.providerStart', 'enrollment.providerVerify', 'enrollment.providerActivate',
      'identity.organizationApply', 'identity.organizationCompletionStart', 'identity.organizationCompletionVerify',
      'identity.organizationCompletionProfile'],
  },
  'patient-web': {
    auth: ['auth.patientLogin', 'auth.googleNonce', 'auth.googleOnboarding', 'auth.googleExchange',
      'auth.googleLink', 'auth.session', 'auth.refresh', 'auth.logout', 'auth.otpStart',
      'auth.otpVerify', 'auth.otpComplete'],
    enrollment: ['enrollment.availability', 'enrollment.start', 'enrollment.current', 'enrollment.google',
      'enrollment.holder', 'enrollment.holderVerify', 'enrollment.facilityCode', 'enrollment.participatingFacilities',
      'enrollment.contact', 'enrollment.verifyContact', 'enrollment.activate'],
    identity: ['identity.me', 'identity.accessHistory', 'identity.accessPin', 'identity.verifyNin',
      'identity.accountDeletion', 'identity.accountDeletionConfirm', 'identity.accountDeletionCancel',
      'identity.emergencyContacts', 'identity.emergencyContact', 'identity.emergencyContactDeactivate',
      'identity.emergencyContactVerification', 'identity.emergencyContactVerificationConfirm',
      // Whether delivery is on, and on which channels (hid-system #109, Novu only; main answers 404).
      'identity.emergencyContactsAvailability',
      // The patient's choice to share imported history with staff (hid-system #94, ADR-067).
      'identity.importedHistorySharing'],
    access: ['access.patientRequests', 'access.approve', 'access.deny', 'access.revokeMyGrant'],
    // Imported history (#94) and patient record chat (#95, ADR-068) are patient-only routes.
    ehr: ['ehr.myRecords', 'ehr.myImportedHistory', 'ehr.patientChatAvailability', 'ehr.patientChat', 'ehr.patientChatHistory',
      // Served by hid-system's staging branches, not main; off unless the build turns the screens on.
      'ehr.myImportedAttachment', 'ehr.patientChatSource',
      // The patient's orders sent to other facilities, and Stop before acceptance (P4c; Novu only, main answers 404).
      'ehr.myOrderRoutes', 'ehr.myOrderRouteWithdraw'],
  },
  'staff-web': {
    // Staff sign-in is two steps since hid-system #71: the password, then an
    // authenticator code, or a first enrolment. Google sign-in is for patients only.
    auth: ['auth.staffLogin', 'auth.staffMfaVerify', 'auth.staffMfaEnrollEmailCode', 'auth.staffMfaEnrollStart',
      'auth.staffMfaEnrollActivate', 'auth.session', 'auth.refresh', 'auth.logout', 'auth.facility',
      'auth.otpStart', 'auth.otpVerify', 'auth.otpComplete'],
    enrollment: ['enrollment.providerStart', 'enrollment.providerVerify', 'enrollment.providerActivate',
      // Whether facility self sign-up is open, and the organization a confirmed sign-up registers (P4; Novu only,
      // main answers 404).
      'enrollment.providerAvailability', 'enrollment.providerProfile',
      // "This isn't my organization" withdraws the sign-up (P4b), and an invitee opens and accepts a staff invitation
      // on the main site (P4b); Novu only, main answers 404.
      'enrollment.providerWithdraw', 'enrollment.staffInvitationOpen', 'enrollment.staffInvitationAccept',
      // Clinician self sign-up and its status page (hid-system ADR-066), public pages outside the workspace.
      'enrollment.clinicianAvailability', 'enrollment.clinicianEmailCode', 'enrollment.clinicianEmailVerify',
      'enrollment.clinicianFacilitySearch', 'enrollment.clinicianSubmit', 'enrollment.clinicianAuthenticatorEmailCode',
      'enrollment.clinicianAuthenticatorStart', 'enrollment.clinicianAuthenticatorActivate',
      'enrollment.clinicianAuthenticatorVerify', 'enrollment.clinicianAuthenticatorChallenge',
      'enrollment.clinicianStatusEmailCode', 'enrollment.clinicianStatusEmailVerify', 'enrollment.clinicianCurrent',
      'enrollment.clinicianWithdraw', 'enrollment.clinicianApply', 'enrollment.clinicianSessionEnd'],
    identity: ['identity.patientLookup', 'identity.authorization', 'identity.consentStatus',
      'identity.facilityAudit',
      'identity.registrationCapabilities', 'identity.resolveNin', 'identity.registrationCase',
      'identity.registrationApprove', 'identity.registrationEnroll', 'identity.registrationLink',
      'identity.organizationVerifyCac',
      // The in-person check of facility-assisted registration (hid-system #85, ADR-063).
      'identity.assistedVerifications',
      // A self-signed-up facility's Staff page, and existing staff joining a facility signed in (P4b; Novu only).
      'identity.facilityStaff', 'identity.facilityAdministratorLicence', 'identity.staffInvitationCreate',
      'identity.staffInvitationResend', 'identity.staffInvitationRevoke', 'identity.facilityStaffEnd',
      'identity.facilityStaffRole', 'identity.staffInvitationSignedInPreview', 'identity.staffInvitationSignedInAccept',
      // The directory of laboratories and pharmacies at other facilities an order can be sent to (P4c; Novu only).
      'identity.orderDestinations'],
    access: ['access.staffRequests', 'access.breakGlass', 'access.verifyPin', 'access.closeOwnGrant'],
    ehr: ['ehr.importedHistory', 'ehr.staffPatientChatAvailability', 'ehr.staffPatientChat', 'ehr.staffPatientChatHistory', 'ehr.staffPatientChatSource',
      'ehr.importedRecords', 'ehr.importedAttachment', 'ehr.emergencyRecords', 'ehr.encounters', 'ehr.encounter', 'ehr.vitals', 'ehr.vital',
      'ehr.vitalCorrections', 'ehr.notes', 'ehr.note', 'ehr.noteRevisions', 'ehr.diagnoses',
      'ehr.diagnosis', 'ehr.prescriptions', 'ehr.prescription', 'ehr.prescriptionPharmacy',
      'ehr.labRequests', 'ehr.labRequest', 'ehr.labRequestLabWorkItem',
      // Sending an order to another facility, its routes and their withdrawal, and the clinician's attestation (P4c; Novu only).
      'ehr.labRequestOrderRoutes', 'ehr.labRequestOrderRouteWithdraw', 'ehr.prescriptionOrderRoutes',
      'ehr.prescriptionOrderRouteWithdraw', 'ehr.orderRouteAttestation',
      // The Overview's orders that the receiver ended as accepted for the wrong person (item 3, D10; proposed, 404 until served).
      'ehr.orderRoutesWrongPatient'],
    // Facility billing (docs/BILLING_SPEC.md; proposed routes) and the price catalogue it shows. Not demo requests.
    commercial: ['commercial.pricing', 'commercial.subscription', 'commercial.subscriptionTrial',
      'commercial.subscriptionCheckout', 'commercial.invoices'],
  },
  'admin-web': {
    // Platform administration uses its own MFA-verified session (Stage 2A);
    // staff sign-in, refresh and sign-out are not platform routes.
    auth: ['auth.adminLogin', 'auth.adminMfaVerify', 'auth.adminMfaEnrollStart', 'auth.adminMfaEnrollActivate',
      'auth.adminRefresh', 'auth.adminLogout', 'auth.otpStart', 'auth.otpVerify', 'auth.otpComplete'],
  },
}

/** The services a given application is granted, as a union of literal types. */
export type ServicesOf<A extends HidApp> = (typeof APP_BOUNDARIES)[A]['services'][number]

export class BoundaryViolationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BoundaryViolationError'
  }
}

export function servicesFor(app: HidApp): readonly HidService[] {
  return APP_BOUNDARIES[app].services
}

export function canUseService(app: HidApp, service: HidService): boolean {
  // `services` is a literal tuple per application, so it is widened here to
  // compare against an arbitrary service.
  return servicesFor(app).includes(service)
}

/**
 * Throws unless `app` is allowed to call `endpointName`.
 *
 * Service modules call this once when they are constructed, so a boundary
 * mistake surfaces the first time an application boots rather than the first
 * time a user reaches an unusual screen.
 */
export function assertEndpointAllowed(app: HidApp, endpointName: string): void {
  if (['ehr.staffPatientChatAvailability', 'ehr.staffPatientChat', 'ehr.staffPatientChatHistory', 'ehr.staffPatientChatSource'].includes(endpointName) && !['staff-web', 'ehr-web'].includes(app)) {
    throw new BoundaryViolationError('Staff record chat requires a provider patient context.')
  }
  if ((['ehr.myImportedHistory', 'ehr.myImportedAttachment', 'identity.importedHistorySharing'].includes(endpointName) && app !== 'patient-web')
    || (['ehr.importedHistory', 'ehr.importedRecords', 'ehr.importedAttachment'].includes(endpointName) && !['staff-web', 'ehr-web'].includes(app))) {
    throw new BoundaryViolationError('Imported medical history is available only in its patient or provider context.')
  }
  if (['ehr.patientChatAvailability', 'ehr.patientChat', 'ehr.patientChatHistory', 'ehr.patientChatSource'].includes(endpointName) && app !== 'patient-web') {
    throw new BoundaryViolationError('Patient record chat is available only to the patient application.')
  }
  const descriptor = findEndpoint(endpointName)

  if (!descriptor) {
    throw new BoundaryViolationError(
      `"${endpointName}" is not a known Health ID endpoint. ` +
        'Add it to the contract registry only after the backend contract is confirmed; ' +
        'if it does not exist, record it in docs/OPEN-QUESTIONS.md instead of calling it.',
    )
  }

  if (!hasContracts(descriptor.service)) {
    throw new BoundaryViolationError(
      `The "${descriptor.service}" service has no confirmed backend contracts at the frozen release, ` +
        `so "${endpointName}" cannot be called yet.`,
    )
  }

  if (!canUseService(app, descriptor.service)) {
    throw new BoundaryViolationError(
      `"${app}" may not call the "${descriptor.service}" service (endpoint "${endpointName}"). ` +
        `It is granted: ${servicesFor(app).join(', ')}. ` +
        'Either the workflow belongs in a different application, or the boundary needs to change deliberately.',
    )
  }

  const routeGrant = APP_ROUTE_GRANTS[app]?.[descriptor.service]
  if (routeGrant && !routeGrant.includes(endpointName)) {
    throw new BoundaryViolationError(
      `"${app}" may not call endpoint "${endpointName}" in the shared "${descriptor.service}" service.`,
    )
  }
}
