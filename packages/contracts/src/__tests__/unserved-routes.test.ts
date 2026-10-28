import { describe, expect, it } from 'vitest'
import { HID_ENDPOINTS } from '../index'

/**
 * Routes the frontend is built against that hid-system main (41542fc) does not
 * serve: support chat, the hospital chat's source read, the patient chat source read and
 * `/imported-records` are served by hid-system's staging branches, which
 * Health-id #61 was built against. On main each is answered 404 (by ehr-api, or
 * by the gateway for support chat), so the registry must not record them as
 * served. Patient record chat and imported history are served by main (#94,
 * #95), under the entries `ehr.patientChat*`, `ehr.myImportedHistory`, and since ADR-069 (0101) staff record chat
 * under `ehr.staffPatientChat`, `ehr.staffPatientChatAvailability` and `ehr.staffPatientChatHistory`,
 * `ehr.importedHistory` and `identity.importedHistorySharing`. hid-system #109 serves the emergency-contact
 * availability read and the two emergency-contact admin commands on staging-novu-ci-20261005 only; main answers 404,
 * and the patient card and the admin console treat that as not offered. Facility self sign-up's availability and
 * confirmation reads and support's review, release and open applications, with their search and the waiver of a
 * refusal (P4), P4b's withdrawal, staff, invitation and support routes, and P4c's orders between facilities, are Novu's
 * too; main answers 404,
 * which the sign-up page takes as "show the form" (availability) or "show the CAC number alone" (the confirmation),
 * and the admin console serves the review page only on a Novu build.
 */
const NOT_ON_MAIN = [
  'support.chat',
  'ehr.patientChatSource',
  'ehr.staffPatientChatSource',
  'ehr.myImportedAttachment', 'ehr.importedRecords', 'ehr.importedAttachment',
  'identity.emergencyContactsAvailability', 'admin.facilityAlertPhone', 'admin.emergencyContactOptOut',
  'enrollment.providerAvailability', 'enrollment.providerProfile', 'admin.selfServiceFacilities',
  'admin.selfServiceFacilityReview', 'admin.selfServiceFacilityRelease', 'admin.selfServiceApplications',
  'admin.selfServiceApplicationReject', 'admin.selfServiceApplicationSearch', 'admin.selfServiceApplicationWaiveRefusal',
  // P4b: the withdrawal, the Staff page, joining by invitation, and support's administrator access, limits and staff reads.
  'enrollment.providerWithdraw', 'enrollment.staffInvitationOpen', 'enrollment.staffInvitationAccept',
  'identity.facilityStaff', 'identity.facilityAdministratorLicence', 'identity.staffInvitationCreate',
  'identity.staffInvitationResend', 'identity.staffInvitationRevoke', 'identity.facilityStaffEnd', 'identity.facilityStaffRole',
  'identity.staffInvitationSignedInPreview', 'identity.staffInvitationSignedInAccept', 'admin.facilityStaff',
  'admin.staffInvitationFind', 'admin.selfServiceFacilityAdministratorRole', 'admin.selfServiceFacilityEndProbation',
  // P4c: orders between facilities: the directory, sending and withdrawing, the attestation, the patient's list and Stop,
  // Lab's and Pharmacy's incoming orders, and support's summary, listing, lookup and close.
  'identity.orderDestinations', 'ehr.labRequestOrderRoutes', 'ehr.labRequestOrderRouteWithdraw', 'ehr.prescriptionOrderRoutes',
  'ehr.prescriptionOrderRouteWithdraw', 'ehr.orderRouteAttestation', 'ehr.myOrderRoutes', 'ehr.myOrderRouteWithdraw',
  'lab.orderRoutes', 'lab.orderRoute', 'lab.orderRouteAccept', 'lab.orderRouteDecline', 'pharmacy.orderRoutes',
  'pharmacy.orderRoute', 'pharmacy.orderRouteAccept', 'pharmacy.orderRouteDecline', 'admin.facilityOrderRouteSummary',
  'admin.facilityOrderDestination', 'admin.orderRoutesFind', 'admin.orderRouteClose',
  // P4c review: one patient's incoming orders and support's lookup, found by a Health ID in the body.
  'lab.orderRouteSearch', 'pharmacy.orderRouteSearch', 'admin.orderRoutesSearch',
  // Item 3 (hid-system 0088): the wrong-patient report, the ordering facility's Overview read, and support's list and review.
  'lab.orderRouteWrongPatient', 'pharmacy.orderRouteWrongPatient', 'ehr.orderRoutesWrongPatient', 'admin.wrongPatientReports',
  'admin.wrongPatientReportReview',
  // D17 (hid-system 0090): "Correct an order that has ended", Lab's and Pharmacy's lookup by reference and withdrawal.
  'lab.orderRouteCorrectable', 'lab.orderRouteWrongPatientCorrection', 'pharmacy.orderRouteCorrectable',
  'pharmacy.orderRouteWrongPatientCorrection',
  // D18 (hid-system 0091 on staging-novu-ci-20261005): "We can't complete this order", Lab's and Pharmacy's command.
  'lab.orderRouteCannotComplete', 'pharmacy.orderRouteCannotComplete',
  // hid-1.0 patient parity B2 (hid-system 0093 on staging-novu-ci-20261005): the bell's count and the access log, and the
  // hid-1.0 notifications carried over (0062), which the count includes.
  'notifications.unreadCount', 'identity.accessLog', 'notifications.imported', 'notifications.importedRead',
  // hid-1.0 patient parity B3 (hid-system 0094 on staging-novu-ci-20261005): the profile's coverage, photo and contact
  // details, the health information the patient enters, and the chart's read of it.
  'identity.profileDetails', 'identity.myPhoto', 'identity.myPhotoChange', 'identity.contactChanges', 'identity.contactChangeVerify',
  'ehr.myHealthProfile', 'ehr.patientReportedHealthProfile',
] as const

describe('routes hid-system main does not serve', () => {
  it.each(NOT_ON_MAIN)('%s is recorded as proposed, with a note saying where it is served', name => {
    const endpoint = HID_ENDPOINTS.find(item => item.name === name)
    expect(endpoint).toBeDefined()
    expect(endpoint?.status).toBe('proposed')
    expect(endpoint?.note).toMatch(/not served by hid-system main/)
  })
})
