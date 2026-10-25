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
 * refusal (P4), and P4b's withdrawal, staff, invitation and support routes, are Novu's too; main answers 404,
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
] as const

describe('routes hid-system main does not serve', () => {
  it.each(NOT_ON_MAIN)('%s is recorded as proposed, with a note saying where it is served', name => {
    const endpoint = HID_ENDPOINTS.find(item => item.name === name)
    expect(endpoint).toBeDefined()
    expect(endpoint?.status).toBe('proposed')
    expect(endpoint?.note).toMatch(/not served by hid-system main/)
  })
})
