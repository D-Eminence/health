import type { PatientNotification } from '../api'

/**
 * What each inbox code means to the patient. Identity writes the first two
 * (hid-system 0037_patient_notification_inbox.sql), and on Novu hid-system #109
 * the third when support removes a contact who asked to stop receiving alerts
 * (its payload holds only the relationship and channel, and is never shown). The
 * account notices (hid-system 0093, patient parity B2) carry no health information
 * and nothing secret. A code added later reads as a general account update until it
 * has its own words, never as the code itself.
 */
const NOTIFICATION_TITLES: Readonly<Record<string, string>> = {
  ACCESS_REQUEST_RECEIVED: 'A hospital or clinic asked to see your health records',
  EMERGENCY_ACCESS_ACTIVATED: 'A health worker opened your records in an emergency',
  EMERGENCY_CONTACT_OPTED_OUT: 'An emergency contact asked to stop getting alerts, so we removed them',
  SECURITY_PASSWORD_RESET_REQUESTED: 'Someone asked to reset your Health ID password',
  SECURITY_PASSWORD_CHANGED: 'Your Health ID password was changed',
  SECURITY_GOOGLE_LINKED: 'A Google account was linked to your Health ID',
  // hid-1.0 parity B4 (hid-system 0095): an invitation the patient sent by email ended unanswered. Its metadata is empty.
  SHARE_INVITATION_EXPIRED: 'Your invitation to share your records has expired',
  // hid-1.0 parity B5 (hid-system 0096): the patient's own account deletion. The scheduled notice's metadata holds the date,
  // the blocked one's a reason code; neither is shown in the title, and the profile's Delete account says the rest.
  ACCOUNT_DELETION_SCHEDULED: 'Your Health ID account is set to be deleted',
  ACCOUNT_DELETION_CANCELLED: 'You cancelled deleting your Health ID account',
  ACCOUNT_DELETION_BLOCKED: 'Your Health ID account couldn’t be deleted. See your profile',
}

/** What each notice is about, shown beside its date. */
export const NOTIFICATION_SUBJECTS: Readonly<Record<string, string>> = {
  'access-request': 'Access request', 'consent-grant': 'Access given', 'emergency-contact': 'Emergency contact',
  // P4c (Novu): an order a clinician sent to a laboratory or pharmacy at another facility.
  'order-route': 'Test or prescription',
  // Patient parity B2 (hid-system 0093): the account's own security notices.
  account: 'Account security',
  // hid-1.0 parity B4 (hid-system 0095): a facility opened the record, and the patient's invitations to share.
  'record-access': 'Record access',
  'share-invitation': 'Invitation to share',
  // hid-1.0 parity B5 (hid-system 0096): the patient's own account deletion.
  'account-deletion': 'Account',
}

/**
 * The inbox codes of orders sent to another facility (Novu, P4c, SPEC-FINAL §5, §13.4). Their metadata holds only
 * the kind and the two facilities' names; the receiving facility is named in the title.
 */
const ORDER_ROUTE_TITLES: Readonly<Record<string, (thing: string, facility: string) => string>> = {
  ORDER_ROUTE_SENT: (thing, facility) => `Your ${thing} was sent to ${facility}. See it in Access & sharing`,
  ORDER_ROUTE_WITHDRAWN: (thing, facility) => `Your ${thing} to ${facility} was withdrawn`,
  ORDER_ROUTE_ACCEPTED: (thing, facility) => `${facility} accepted your ${thing}`,
  ORDER_ROUTE_DECLINED: (thing, facility) => `${facility} couldn’t take your ${thing}`,
  ORDER_ROUTE_ACCEPT_LOCKED: (thing, facility) => `${facility} couldn’t confirm it was you, so it can’t take your ${thing}. Ask your doctor to send it again`,
  ORDER_ROUTE_CANCELLED: (thing, facility) => `Your ${thing} at ${facility} was cancelled`,
  // Item 3 (D8): the receiving facility reports it accepted the order for someone who was not the patient, and ended it.
  ORDER_ROUTE_WRONG_PATIENT: (thing, facility) => `${facility} accepted your ${thing} for someone who was not you, and has ended it`,
  // D17: it reported it after the order had ended another way, which it keeps (SPEC-FINAL §9.3).
  ORDER_ROUTE_WRONG_PATIENT_CORRECTED: (thing, facility) => `${facility} reports that it accepted your ${thing} for someone who was not you`,
  // D18 (D18-3): the receiving facility accepted it and couldn't complete it; the reason is not sent (D18-4).
  ORDER_ROUTE_NOT_COMPLETED: (thing, facility) => `${facility} couldn’t complete your ${thing}. See it in Access & sharing`,
}

/** A name from a notice's metadata, or the words that stand for it: never anything but a short plain string. */
function metadataName(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim() && value.length <= 200 ? value.trim() : null
}

export function notificationTitle(item: PatientNotification): string {
  const orderRoute = ORDER_ROUTE_TITLES[item.notificationCode]
  if (orderRoute) {
    const kind = metadataName(item.metadata, 'kind')
    const thing = kind === 'lab_request' ? 'test request' : kind === 'prescription' ? 'prescription' : 'test request or prescription'
    return orderRoute(thing, metadataName(item.metadata, 'receivingFacilityName') ?? 'another lab or pharmacy')
  }
  // Patient parity B2 (hid-system 0093): a clinician ended their own access before it was due to end
  // (identity.close_own_consent_grant). Its metadata holds the facility's name only, never the clinician's reason.
  if (item.notificationCode === 'CONSENT_GRANT_ENDED_BY_CLINICIAN') {
    return `${metadataName(item.metadata, 'facilityName') ?? 'A hospital'} ended its access to your health records early`
  }
  // hid-1.0 parity B4 (hid-system 0095): a facility's staff opened the record (once per facility a day; the email names no
  // one), and a provider accepted the patient's invitation. Each names the facility only, never the clinician or a record.
  if (item.notificationCode === 'RECORDS_OPENED') {
    return `${metadataName(item.metadata, 'facilityName') ?? 'A hospital'} opened your health records`
  }
  if (item.notificationCode === 'SHARE_INVITATION_ACCEPTED') {
    return `A health worker at ${metadataName(item.metadata, 'facilityName') ?? 'a hospital'} accepted your invitation. Confirm it in Access & sharing`
  }
  return NOTIFICATION_TITLES[item.notificationCode] ?? 'An update about your Health ID account'
}
