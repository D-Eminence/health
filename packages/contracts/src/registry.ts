/**
 * Browser routes verified against hid-system c4b5445, and later each where its
 * comment says; the patient enrollment routes against hid-system main f9dbaf0
 * (#82, #84, #85 and #86: ADR-061, ADR-062 and ADR-063). Paths include /api/v1.
 */
export type HidService = 'auth' | 'enrollment' | 'identity' | 'access' | 'ehr' | 'files'
  | 'notifications' | 'lab' | 'pharmacy' | 'ocr' | 'outreach' | 'admin' | 'commercial' | 'platform' | 'support'
export type EndpointMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'
export type EndpointAuth = { readonly kind: 'public' | 'authenticated' }
/**
 * 'surface-verified': hid-system serves the route. 'proposed': built against
 * but not served by hid-system main: facility billing (specified in
 * docs/BILLING_SPEC.md; callers treat a 404 as "not available yet"), support
 * chat, and the staging-branch routes for hospital chat and `/imported-records`,
 * which hid-system's `staging` and `staging-novu-ci-20261005` branches serve (their
 * screens are off unless the build turns them on), hid-system #109's
 * emergency-contact availability read and admin commands, which only
 * `staging-novu-ci-20261005` serves, and facility self sign-up's availability
 * and confirmation reads and support's review, release and open applications,
 * with their search and the waiver of a refusal (P4), and the applicant's
 * withdrawal, the facility's staff and its invitations, and support's
 * administrator access, first-30-days limits and staff reads (P4b), and lab
 * requests and prescriptions sent to a laboratory or pharmacy at another
 * facility, with the patient's list of them and support's tools (P4c), which
 * only `staging-novu-ci-20261005` serves; the wrong-patient report on those
 * orders, support's list and review of the reports and the ordering facility's
 * Overview read (item 3, hid-system 0088), which `staging-novu-ci-20261005`
 * serves since hid-system bd8676e; the late correction of an order that has
 * ended (D17, hid-system 0090: the receiving facility's lookup by reference and
 * its withdrawal), which `staging-novu-ci-20261005` serves since hid-system
 * a3b1822; and "We can't complete this order" (D18, hid-system 0091 on
 * `staging-novu-ci-20261005`: the receiving facility ends an order it accepted
 * and can't complete), which no hid-system release serves yet: callers treat a
 * 404 as "not available yet" and show nothing.
 */
export type ContractStatus = 'surface-verified' | 'proposed'
export interface EndpointDescriptor {
  readonly name: string
  readonly path: string
  readonly service: HidService
  readonly methods: readonly EndpointMethod[]
  readonly auth: EndpointAuth
  /** Per-method backend permissions, all required; absent means session only. */
  readonly permissions?: Partial<Record<EndpointMethod, readonly string[]>>
  /** Query keys required by a method; for example OCR job lookup is scoped to a document. */
  readonly requiredQuery?: Partial<Record<EndpointMethod, readonly string[]>>
  /**
   * Query keys a method refuses, so the value never leaves the browser in an address; for example the order-route
   * lookups refuse a Health ID (hid-system #116), which goes in their searches' POST bodies instead.
   */
  readonly forbiddenQuery?: Partial<Record<EndpointMethod, readonly string[]>>
  /** The shared JSON client cannot consume a download response. */
  readonly responseKind?: 'json' | 'download'
  readonly status: ContractStatus
  readonly note?: string
}

const G = ['GET'] as const, P = ['POST'] as const, GP = ['GET', 'POST'] as const
const GPA = ['GET', 'PATCH'] as const
const r = (name: string, service: HidService, path: string, methods: readonly EndpointMethod[],
  isPublic = false, permissions?: Partial<Record<EndpointMethod, readonly string[]>>,
  note?: string): EndpointDescriptor => ({ name, service, path, methods,
    auth: { kind: isPublic ? 'public' : 'authenticated' },
    ...(permissions ? { permissions } : {}), status: 'surface-verified',
    ...(note ? { note } : {}) })
const proposed = (descriptor: EndpointDescriptor): EndpointDescriptor => ({ ...descriptor, status: 'proposed' })
const one = (method: EndpointMethod, ...permissions: string[]): Partial<Record<EndpointMethod, readonly string[]>> =>
  ({ [method]: permissions })

/**
 * hid-system main 41542fc does not serve these: support chat, hospital ("ask about this patient") chat and
 * `/imported-records` are served by its `staging` and `staging-novu-ci-20261005` branches, which Health-id's
 * staging chain (#61) was built against. Patient record chat, imported history and its sharing choice are
 * served by main (#94, #95) under the contracts in the entries further down.
 */
const NOT_ON_MAIN = 'Served by a hid-system staging branch; not served by hid-system main (41542fc).'
const CHAT_NOTE = `${NOT_ON_MAIN} The screen is off unless the build turns it on.`
const STAFF_CHAT_NOTE = 'Staff sessions holding ehr.record-chat.use, for direct care only (X-Purpose-Of-Use: direct-care, never break-glass). '
  + 'Off by default in hid-system (ADR-069, 0101): 503 RECORD_CHAT_DISABLED until RECORD_CHAT_STAFF_ENABLED and the platform control are on.'
const RECORD_CHAT_NOTE = 'Patient sessions only (403 PATIENT_SESSION_REQUIRED otherwise). Off by default in hid-system '
  + '(ADR-068, 0100): 503 RECORD_CHAT_DISABLED until the flag and the platform control are on.'
/**
 * Emergency contacts: hid-system main's patient-safety controller (services/identity-api/src/patient-safety), which
 * hid-system #109 serves on staging-novu-ci-20261005 under the same paths and answers, with an availability read and
 * two admin commands main does not have.
 */
const EMERGENCY_CONTACTS_NOTE = 'Served by hid-system main and, from hid-system #109, by staging-novu-ci-20261005. There, adding a '
  + 'contact and sending a code need delivery on for the patient (409 EMERGENCY_CONTACT_DELIVERY_UNAVAILABLE otherwise); '
  + 'listing, changing and removing do not.'
const EMERGENCY_CONTACTS_NOVU = 'Served by staging-novu-ci-20261005 from hid-system #109; not served by hid-system main (404).'
/**
 * Facility self sign-up on Novu (P4, owner decision D14): main's provider-enrollment routes, ending with a password
 * that signs the administrator in (main before #71, no authenticator), closed by the platform control
 * provider_self_service_enabled; plus an availability read, a read of what a confirmed sign-up registers, and
 * support's review and release of each new facility and its view of open applications, which main does not have.
 * Checked against the backend's "Website contract v2" (P4 round 2).
 */
const SELF_SIGN_UP_NOVU = 'Served by staging-novu-ci-20261005 from facility self sign-up (P4); not served by hid-system main (404).'
const SELF_SIGN_UP_CLOSED = 'On Novu every route answers 423 PROVIDER_ENROLLMENT_UNAVAILABLE while self sign-up is closed.'
/**
 * Full access after support's review and facility staff invitations (P4b, owner's fourth and fifth decisions): a
 * self-signed-up facility's administrator manages its staff and vouches for their licences; invitees join with an
 * emailed link or code; support reviews the facility, confirming the administrator's own clinical access. Novu only.
 */
const STAFF_P4B_NOVU = 'Served by staging-novu-ci-20261005 from full access after review and staff invitations (P4b); '
  + 'not served by hid-system main (404).'
/** The session field P4b adds to each facility of a staff session (Identity's current-staff-context). */
const SELF_SERVICE_SESSION = 'On Novu since P4b each facility that signed itself up carries selfService { review: '
  + "'pending' | 'reviewed', organizationType }; governed and legacy facilities carry none."
/** The staff routes' shared rules (P4b SPEC 6.3-6.5). */
const STAFF_ROUTE = `${STAFF_P4B_NOVU} Staff session with X-Facility-ID (healthcare-operations) and workforce.manage, `
  + 'CSRF on POST; only at a self-signed-up facility (403 STAFF_MANAGEMENT_NOT_AVAILABLE otherwise).'
const STAFF_INVITATIONS_CLOSED = '423 STAFF_INVITATIONS_UNAVAILABLE while invitations are switched off.'
/**
 * Cross-facility orders (P4c, owner's fifth and sixth decisions): a clinician sends a lab request or prescription to a
 * reviewed laboratory or pharmacy at another facility, attesting that the patient agreed (no in-app approval); the
 * receiver accepts it with the patient's Health ID or date of birth and works it in its own Lab or Pharmacy; results
 * and dispensing come back to the order. The patient sees every order sent and may stop it until acceptance. Novu only.
 */
const ORDER_ROUTES_P4C_NOVU = 'Served by staging-novu-ci-20261005 from cross-facility orders (P4c); not served by '
  + 'hid-system main (404).'
/** The two P4c switches, answered by every order-route route (SPEC-FINAL §11). */
const ORDER_ROUTES_PAUSED = '423 CROSS_FACILITY_ORDERS_UNAVAILABLE while cross_facility_orders_enabled (or, for work on '
  + 'accepted orders, cross_facility_route_access_enabled) is off.'
/**
 * Incoming while route access is off (item 4 integration: the services answer the list's 423 as a problem, so neither
 * field is in it): the work list, which that switch never refuses, still says them.
 */
const RECEIVING_PAUSED = 'While cross_facility_route_access_enabled is off the list\'s 423 is a problem without receives or '
  + 'routesHere; the work list still answers them then.'
/**
 * What item 4 (hid-system 0089, B1 and owner decision D4) adds to the Lab and Pharmacy work lists and Incoming: two facts
 * about the session's own facility, for this service's orders, answered only to a member holding the receive permission.
 */
const RECEIVING_FIELDS = 'Since item 4 (hid-system 0089) also receives (whether this facility receives this service\'s '
  + 'orders from other facilities now: H4, whatever the switches say) and routesHere { waiting, held } (whether orders '
  + 'sent here wait, and whether accepted ones are held here: booleans only, no patient and no count), both only to a '
  + 'member holding the receive permission and omitted when they could not be read; an earlier backend sends neither.'
/** The staff order-route routes' shared rules (SPEC-FINAL §10.1, §10.2). */
const ORDER_ROUTE_STAFF = `${ORDER_ROUTES_P4C_NOVU} Staff session with X-Facility-ID and X-Purpose-Of-Use: direct-care `
  + '(any other purpose 403 PERMISSION_DENIED); CSRF on POST; a stale version 412 VERSION_CONFLICT.'
const ORDER_ROUTE_SEND = 'POST sends the order (a draft is activated) with Idempotency-Key and { expectedRowVersion, '
  + 'receivingFacilityId, patientAgreed: true, attestationTextVersion } (the clinician\'s attestation, the text of '
  + 'ehr.orderRouteAttestation): 201 { route: OrderRouteSummary, order { id, status, rowVersion }, replayed }; 409 '
  + 'ORDER_ROUTE_DESTINATION_INELIGIBLE, _ORDER_NOT_ELIGIBLE, _ORDER_IN_WORK, _ALREADY_SENT, _RESEND_LIMIT, '
  + '_DESTINATION_BUSY, _PATIENT_DENIED, _PATIENT_APP_REQUIRED, _ATTESTATION_OUTDATED, IDEMPOTENCY_KEY_REUSED; 429 '
  + 'ORDER_ROUTE_SEND_LIMIT, _PAIR_LIMIT. GET lists the order\'s routes, newest first: { items: OrderRouteView[] } (the '
  + `summary, attestation, events, and results or dispensings come back). ${ORDER_ROUTES_PAUSED}`
const ORDER_ROUTE_WITHDRAW = 'Withdraws a route still waiting for acceptance, without a consent check. Body { '
  + "expectedVersion, reason: 'sent_in_error' | 'patient_request' | 'other' }; 200 { route }. 404 ORDER_ROUTE_NOT_FOUND, "
  + '409 ORDER_ROUTE_NOT_PENDING.'
/** What P4c adds to the EHR's order lists and reads (SPEC-FINAL §10.1). */
const ORDER_LISTS_P4C = 'On Novu since P4c the page also answers crossFacilityOrders (whether orders between facilities '
  + 'are on), and each item orderRoute: its latest route to another facility (OrderRouteSummary) or null; absent when '
  + 'routes could not be read (emergency access). With the wrong-patient report (item 3, hid-system 0088) the lab-request '
  + 'and prescription pages also answer wrongPatientReports: true (the receiving facility can end an order it accepted '
  + 'for the wrong person; an earlier backend sends no such field). With the late correction (D17, hid-system 0090) they '
  + 'also answer lateCorrection: true, and each orderRoute carries wrongPatient { reportedAt, late } | null and '
  + 'correctableUntil (a time while the receiving facility may still withdraw what it recorded, else null); an earlier '
  + 'backend sends none of these. With "We can\'t complete this order" (D18, hid-system 0091) an orderRoute\'s endedKind '
  + 'may be receiving_unable, with notCompleted { reason, sampleTaken, resultRecorded } | null (sampleTaken: a sample was '
  + 'collected there and not rejected); an earlier backend sends no such field.'
/** The Lab and Pharmacy order-route routes' shared rules (SPEC-FINAL §10.2). */
const RECEIVE_ROUTE = `${ORDER_ROUTE_STAFF} Accept needs Idempotency-Key and { expectedVersion, patientIdentifier { kind: `
  + "'health_id' | 'date_of_birth', value }, reference? } (Pharmacy also reason, 8 to 500; reference, optional, is the "
  + "order's 8-character reference from the patient's app, which names the order with a date of birth): 201 { route, "
  + 'workItemId, patient { fullName, sex, dateOfBirth, healthIdLast4 }, clinicalInformation | instructions, orderer, '
  + 'replayed }; 400 ORDER_ROUTE_INVALID (also a malformed reference); 409 ORDER_ROUTE_PATIENT_MISMATCH (with '
  + 'attemptsLeft: min(5 - wrong tries that named the order, a Health ID or a date of birth with the reference, 20 - all '
  + 'wrong tries); a date of birth alone does not lower the 5), _REFERENCE_MISMATCH (another order\'s reference; nothing '
  + 'counted), _ACCEPT_LOCKED, _ORDER_IN_WORK, _NOT_PENDING, _EXPIRED, _DESTINATION_INELIGIBLE, '
  + '_ORDERING_FACILITY_UNAVAILABLE, _PATIENT_DENIED, _HEALTH_ID_REQUIRED; 429 ORDER_ROUTE_ACCEPT_LIMITED. Decline takes '
  + '{ expectedVersion, reason }. The list takes view (incoming, the default, or recent) only and answers { items, '
  + 'receives?, routesHere?, crossFacilityOrders, crossFacilityWork } (receives and routesHere: see the work lists); '
  + 'since hid-system #116 a healthId query is refused 400 '
  + 'HEALTH_ID_NOT_ACCEPTED_IN_URL before any other check (a Health ID in an address is kept by access logs and browser '
  + "history): one patient's orders are found with the search's POST. Before acceptance no row names the patient. "
  + `${ORDER_ROUTES_PAUSED} ${RECEIVING_PAUSED}`
/** P4c review: one patient's incoming (or recent) orders, found by the Health ID in the body, never in an address. */
const RECEIVE_SEARCH = `${ORDER_ROUTE_STAFF} Body { view?: 'incoming' | 'recent', healthId } (1 to 64; the Health ID is `
  + 'checked, 400 ORDER_ROUTE_INVALID); the same permission, audit row and answer as the list\'s GET: { items, '
  + `receives?, routesHere?, crossFacilityOrders, crossFacilityWork }. ${ORDER_ROUTES_PAUSED} ${RECEIVING_PAUSED}`
/** What P4c adds to the Lab and Pharmacy work lists and per-item routes. */
const WORK_LISTS_P4C = 'On Novu since P4c items of orders from other facilities carry orderRoute { id, reference, '
  + 'effectiveState, access, orderingFacilityName, ordererName, ordererLicence? } and patient?, and the answer '
  + 'crossFacilityOrders and crossFacilityWork; every per-item route may answer 409 ORDER_ROUTE_CLOSED or 423 '
  + 'CROSS_FACILITY_ORDERS_UNAVAILABLE. With the wrong-patient report (item 3, hid-system 0088) orderRoute also carries '
  + 'version (the route\'s, a number: the report\'s expectedVersion) and endedKind (null while the route is live; '
  + 'wrong_patient, support, order_changed, entered_in_error, receiving_released or ordering_released); an item ended '
  + 'wrong_patient is listed only under the patient\'s own consent (access none, no patient), and every write on it '
  + `answers 409 ORDER_ROUTE_CLOSED. ${RECEIVING_FIELDS} With the late correction (D17, hid-system 0090) the answer also `
  + 'carries lateCorrection: true for a member holding the receive permission (an earlier backend sends no such field), '
  + 'and an item whose route was reported, in its window or after it ended, answers every write 409 ORDER_ROUTE_CLOSED. '
  + 'With "We can\'t complete this order" (D18, hid-system 0091) the answer also carries cannotComplete: true for a member '
  + 'holding the receive permission, and endedKind may be receiving_unable (access read while this facility may still '
  + 'read it, up to 7 days (never past the order\'s 30 days) only when a laboratory had opened an accession; nothing more '
  + 'can be recorded on it: a Lab write '
  + 'answers 409 ORDER_ROUTE_CLOSED under the patient\'s own consent and 404 while only the order lets this facility '
  + 'read it (what it would write is not found for writing, e.g. LAB_EXECUTION_NOT_FOUND, LAB_RESULT_NOT_FOUND), and a '
  + 'dispensing 409 ORDER_ROUTE_CLOSED; the website offers no write there); an earlier backend sends no such field.'
/**
 * The wrong-patient report (item 3, owner decisions D1-D19 of 2026-10-26; hid-system 0088, C25-C28): a laboratory or
 * pharmacy ends an order it accepted for someone who was not the patient, and in the same transaction every result or
 * dispensing it sent back is withdrawn; support reviews each report; the ordering facility's Overview lists such orders
 * for 30 days. Served by staging-novu-ci-20261005 since hid-system bd8676e (item 3's release).
 */
const WRONG_PATIENT_NOVU = 'Served by staging-novu-ci-20261005 since hid-system bd8676e (the wrong-patient report, item 3, '
  + 'hid-system 0088); not served by hid-system main (404).'
/** The Lab and Pharmacy command (C25, SPEC-FINAL §5.1). */
const WRONG_PATIENT_ROUTE = `${WRONG_PATIENT_NOVU} Staff session with X-Facility-ID and X-Purpose-Of-Use: direct-care (any `
  + 'other purpose 403 PERMISSION_DENIED); CSRF; Idempotency-Key required (400 IDEMPOTENCY_KEY_REQUIRED; 16 to 128 '
  + 'characters, a letter or digit first). Body { expectedVersion, reason: wrong_order_chosen | someone_elses_details | '
  + 'suspected_misuse | other, note (8 to 500 after trimming; for Health ID support only) }. Any member holding the '
  + 'receive permission ends an order accepted here (it becomes cancelled), or the access of a completed one, while it may '
  + 'still be worked, and in the same transaction every result version or dispensing it sent back is withdrawn: 200 { '
  + 'route { id, version, effectiveState: cancelled | completed, endedKind: wrong_patient }, resultsVoided, '
  + 'resultReportsMarked, dispensingReversed, replayed } (the same key and report replays). 400 VALIDATION_FAILED (the '
  + 'body: an unknown reason or field, a note outside 8 to 500 as sent), ORDER_ROUTE_INVALID (a note under 8 once trimmed, '
  + 'or the command\'s own check); 403 PERMISSION_DENIED, ORDER_ROUTE_CORRECTION_PERMISSION_REQUIRED (the problem member '
  + 'permission names lab.result.entered-in-error or pharmacy.dispensing.reverse: something must be withdrawn); 404 '
  + 'ORDER_ROUTE_NOT_FOUND; 409 ORDER_ROUTE_NOT_ACCEPTED, '
  + 'ORDER_ROUTE_ALREADY_ENDED (checked before the version), IDEMPOTENCY_KEY_REUSED, ORDER_ROUTE_CHANGED_CONCURRENTLY; 412 '
  + 'VERSION_CONFLICT (something was returned or changed: read the route again); 423 CROSS_FACILITY_ORDERS_UNAVAILABLE '
  + 'while cross_facility_route_access_enabled is off; 503 ORDER_ROUTE_UNAVAILABLE. It can\'t be undone, and the order '
  + 'can\'t be received again: the clinician writes a new one.'
/**
 * "We can't complete this order" (D18, owner decisions D18-1 to D18-15 of 2026-10-27; hid-system 0091 on
 * staging-novu-ci-20261005, C31): a laboratory or pharmacy that accepted an order and can't complete it ends it with one
 * fixed reason of its kind (D18-5; no free text, D18-6), stating that the person it accepted it for was the order's
 * patient. The same codes as the services' DTOs, 0091's command and its endings table (D18-5, SPEC-FINAL §4.3).
 */
export const ORDER_ROUTE_CANNOT_COMPLETE_REASONS = {
  lab_request: ['test_not_offered', 'supplies_unavailable', 'equipment_unavailable', 'sample_unusable', 'sample_not_obtained',
    'cannot_meet_priority', 'patient_declined', 'patient_did_not_return', 'other'],
  prescription: ['out_of_stock', 'medicine_unavailable', 'needs_prescriber_review', 'controlled_requirements',
    'cannot_meet_priority', 'patient_declined', 'patient_did_not_return', 'other'],
} as const
const CANNOT_COMPLETE_NOVU = 'Proposed for staging-novu-ci-20261005 by "We can\'t complete this order" (D18, hid-system 0091 '
  + '(staging-novu-ci-20261005)); not served by hid-system main, nor by staging-novu-ci-20261005 before that release (404).'
/** The Lab and Pharmacy command (C31, SPEC-FINAL §5.1). */
const CANNOT_COMPLETE_ROUTE = `${CANNOT_COMPLETE_NOVU} Staff session with X-Facility-ID and X-Purpose-Of-Use: direct-care `
  + '(any other purpose 403 PERMISSION_DENIED); CSRF; Idempotency-Key required (400 IDEMPOTENCY_KEY_REQUIRED; 16 to 128 '
  + 'characters, a letter or digit first). Body (no other field) { expectedVersion (an integer, at least 1), reason, '
  + 'confirmedPatient: true (the member states that the person it accepted the order for was the order\'s patient), '
  + 'criticalValueTold? (Lab only: true once the ordering facility was phoned about a possibly critical value; Pharmacy '
  + 'refuses the field) }, the reason one of its kind\'s list: Lab reason: '
  + `${ORDER_ROUTE_CANNOT_COMPLETE_REASONS.lab_request.join(' | ')}; Pharmacy reason: `
  + `${ORDER_ROUTE_CANNOT_COMPLETE_REASONS.prescription.join(' | ')}. Any member holding the receive permission ends an `
  + 'order accepted here, inside its 30 days of work, that has not ended and from which nothing has come back (D18-1, '
  + 'D18-10): it becomes cancelled, endedKind receiving_unable, nothing more can be recorded on it, and this facility '
  + 'reads it up to 7 more days (never past its 30 days of work) only when a laboratory had opened an accession, else not '
  + 'at all (D18-2); the patient\'s inbox '
  + 'gets ORDER_ROUTE_NOT_COMPLETED. 200 { route { id, version (a number), effectiveState: cancelled, endedKind: '
  + 'receiving_unable }, reason, readUntil (the route\'s access end: the ending\'s moment when reads ended at once), '
  + 'specimensCollected, resultsRecorded, criticalCandidates, replayed } (the same key and request replays; never the '
  + 'patient). 400 VALIDATION_FAILED (the body: a reason not of this service\'s list, a version not an integer of at least '
  + '1, confirmedPatient not true, an unknown field), ORDER_ROUTE_INVALID (the command\'s own check); 403 '
  + 'PERMISSION_DENIED; 404 ORDER_ROUTE_NOT_FOUND; 409 ORDER_ROUTE_NOT_ACCEPTED, ORDER_ROUTE_ALREADY_ENDED (ended any way, '
  + 'lapsed or reported; checked before the version), ORDER_ROUTE_ALREADY_RETURNED (a result or dispensing went back), '
  + 'ORDER_ROUTE_RESULT_READY (Lab: a checked result waits to be released; checked before the version), '
  + 'ORDER_ROUTE_CRITICAL_VALUE_NOT_TOLD (Lab: a possibly critical value and criticalValueTold not true; checked before the '
  + 'limits, so a member or facility at its limit is still asked), '
  + 'IDEMPOTENCY_KEY_REUSED, ORDER_ROUTE_CHANGED_CONCURRENTLY; 412 VERSION_CONFLICT; 423 '
  + 'CROSS_FACILITY_ORDERS_UNAVAILABLE while cross_facility_route_access_enabled is off; 429 '
  + 'ORDER_ROUTE_CANNOT_COMPLETE_LIMIT (20 per staff member (counted by account, at every facility it belongs to) and 50 per '
  + 'facility in any 24 hours, never lifted, D18-7; the '
  + 'problem member retryAfter is the ISO time from which another is possible); 503 ORDER_ROUTE_UNAVAILABLE. It can\'t be '
  + 'undone, and the order can\'t be sent again: the clinician writes a new one (D18-9).'
/** What the wrong-patient report changes in the EHR's reads of an order's routes (C3, C4). */
const ORDER_ROUTES_WRONG_PATIENT = 'With the wrong-patient report (item 3, hid-system 0088) a route\'s endedKind may be '
  + 'wrong_patient (cancelled, or completed with endedAt), with resendAllowed false, and each result version withdrawn '
  + 'comes back as a report of kind entered_in_error beside its released one. With the late correction (D17, hid-system '
  + '0090) each route also carries wrongPatient { reportedAt, late } | null (the receiving facility\'s report, in its '
  + 'window or after the order had ended, whatever the ending: a late one keeps the earlier ending) and correctableUntil '
  + '(acceptance + 180 days while the receiving facility may still withdraw what it recorded, else null); an earlier '
  + 'backend sends neither. With "We can\'t complete this order" (D18, hid-system 0091) endedKind may be receiving_unable '
  + '(cancelled: the receiving facility accepted it and couldn\'t complete it), and each route also carries notCompleted '
  + '{ reason, sampleTaken, resultRecorded } | null (an object only for a route ended receiving_unable with no '
  + 'wrong-patient report; sampleTaken and resultRecorded null for a prescription); an earlier backend sends no such field.'
/**
 * The late correction (D17, owner decisions D17-1 to D17-13 of 2026-10-26; hid-system 0090, C29 and C30): a laboratory or
 * pharmacy finds an order it accepted by its exact reference, and withdraws what it recorded on it after the order has
 * ended, until 180 days after it accepted it. Served by staging-novu-ci-20261005 since hid-system a3b1822 (D17's release).
 */
const LATE_CORRECTION_NOVU = 'Served by staging-novu-ci-20261005 since hid-system a3b1822 (the late correction, D17, '
  + 'hid-system 0090); not served by hid-system main (404).'
/** The lookup (C30, SPEC-FINAL §5.1). */
const LATE_CORRECTION_LOOKUP = `${LATE_CORRECTION_NOVU} Staff session with X-Facility-ID and X-Purpose-Of-Use: direct-care `
  + '(any other purpose 403 PERMISSION_DENIED); CSRF; audited (lab.order-route.correctable or pharmacy.order-route.correctable, '
  + 'with the route ids, never the patient). A POST so the reference, also an acceptance factor, is in no address. Body { reference } (1 to 16; trimmed '
  + 'and upper-cased, 8 hexadecimal characters). 200 { items [{ id, reference, kind, version, effectiveState, '
  + 'orderingFacilityName, acceptedAt, completedAt, endedAt, endedKind, returned, correction: open | correctable | reported '
  + '| receiver_released | too_late, correctableUntil, wrongPatient { reportedAt, late } | null, details { what, acceptedBy, acceptedWith: '
  + 'health_id | date_of_birth_with_reference | date_of_birth, returned [{ at, withdrawn }] } | null (only while open or '
  + 'correctable) }], lateCorrection: true }: only orders this facility accepted, at most 5, newest acceptance first; no '
  + 'patient, orderer, work item or value. items: [] when none was accepted here: never 404 for that. 400 '
  + 'VALIDATION_FAILED (the body), ORDER_ROUTE_INVALID (not 8 hexadecimal characters); 403 PERMISSION_DENIED; 423 '
  + 'CROSS_FACILITY_ORDERS_UNAVAILABLE while cross_facility_route_access_enabled is off; 503 ORDER_ROUTE_UNAVAILABLE. '
  + 'Lab and Pharmacy never answer ORDER_ROUTE_LOOKUP_INVALID (support\'s Find code).'
/** The late withdrawal (C29, SPEC-FINAL §5.1). */
const LATE_CORRECTION_ROUTE = `${LATE_CORRECTION_NOVU} Staff session with X-Facility-ID and X-Purpose-Of-Use: direct-care `
  + '(any other purpose 403 PERMISSION_DENIED); CSRF; Idempotency-Key required (400 IDEMPOTENCY_KEY_REQUIRED; 16 to 128 '
  + 'characters, a letter or digit first). Body (all required, no other field) { expectedVersion, reason: '
  + 'wrong_order_chosen | someone_elses_details | suspected_misuse | other, discoveredBy: patient | ordering_facility | '
  + 'own_check | support | other, discoveredOn (YYYY-MM-DD, the Lagos day the facility found out: not in the future, not '
  + 'before the acceptance day), note (8 to 500 after trimming; for Health ID support only) }. Any member holding the '
  + 'receive permission withdraws, after the order has ended or lapsed and until 180 days after acceptance, every result '
  + 'version it recorded (marked entered in error) or the dispensing (reversed), in one transaction; an order whose time '
  + 'had only run out ends wrong_patient, one that had ended another way keeps that ending. 200 { route { id, version, '
  + 'effectiveState, endedKind }, late: true, endedKindBefore, resultsVoided, resultReportsMarked, dispensingReversed, '
  + 'correctableUntil, replayed } (the same key and request replays). 400 VALIDATION_FAILED (the body: a missing or unknown '
  + 'field, an unknown reason or discoveredBy, a date not in that form, a note outside 8 to 500 as sent), ORDER_ROUTE_INVALID '
  + '(a note under 8 once trimmed, discoveredOn not a calendar date, in the future or before the acceptance, or the '
  + 'command\'s own check); 403 '
  + 'PERMISSION_DENIED, ORDER_ROUTE_CORRECTION_PERMISSION_REQUIRED (the problem member permission names '
  + 'lab.result.entered-in-error or pharmacy.dispensing.reverse); 404 ORDER_ROUTE_NOT_FOUND; 409 ORDER_ROUTE_NOT_ACCEPTED, '
  + 'ORDER_ROUTE_STILL_OPEN (use the wrong-patient report), ORDER_ROUTE_ALREADY_REPORTED, ORDER_ROUTE_CORRECTION_TOO_LATE, '
  + 'IDEMPOTENCY_KEY_REUSED, ORDER_ROUTE_CHANGED_CONCURRENTLY; 412 VERSION_CONFLICT; 423 '
  + 'CROSS_FACILITY_ORDERS_UNAVAILABLE; 429 ORDER_ROUTE_CORRECTION_LIMIT (5 per member and 20 per facility in any 24 '
  + 'hours; the problem member retryAfter is the ISO time from which another is possible); 503 ORDER_ROUTE_UNAVAILABLE. '
  + 'It can\'t be undone.'

export const HID_ENDPOINTS: readonly EndpointDescriptor[] = [
  proposed(r('support.chat','support','/api/v1/support/chat',P,true,undefined,CHAT_NOTE)),
  r('ehr.patientChatAvailability','ehr','/api/v1/ehr/me/chat/availability',G,false,undefined,
    `${RECORD_CHAT_NOTE} 200 { available: false } while off; no model call.`),
  r('ehr.patientChat','ehr','/api/v1/ehr/me/chat',P,false,undefined,
    `${RECORD_CHAT_NOTE} Needs Idempotency-Key (16 to 128 URL-safe characters) and { question (1 to 1000), noticeVersion } `
    + 'taken from availability (428 CHAT_NOTICE_REQUIRED otherwise).'),
  proposed(r('ehr.patientChatSource','ehr','/api/v1/ehr/me/chat/sources/:kind/:sourceId',G,false,undefined,CHAT_NOTE)),
  r('ehr.staffPatientChatAvailability','ehr','/api/v1/ehr/patients/:patientId/chat/availability',G,false,one('GET','ehr.record-chat.use'),
    `${STAFF_CHAT_NOTE} 200 { available: false } while off; otherwise names the categories this member's permissions let chat read (released) and the rest (withheld, Lab always among them). No model call.`),
  r('ehr.staffPatientChat','ehr','/api/v1/ehr/patients/:patientId/chat',P,false,one('POST','ehr.record-chat.use'),
    `${STAFF_CHAT_NOTE} Needs Idempotency-Key (16 to 128 URL-safe characters) and { question (1 to 1000), noticeVersion } taken from availability (428 CHAT_NOTICE_REQUIRED otherwise). 403 CONSENT_REQUIRED without a standard consent, 403 BREAK_GLASS_EXCLUDED under break-glass.`),
  r('ehr.staffPatientChatHistory','ehr','/api/v1/ehr/patients/:patientId/chat/history',['GET','DELETE'],false,
    {GET:['ehr.record-chat.use'],DELETE:['ehr.record-chat.use']},
    `${STAFF_CHAT_NOTE} The asking member's own exchanges only; available while chat is off. DELETE answers 200 { cleared, deletedCount }, or 409 CHAT_HISTORY_ON_HOLD.`),
  proposed(r('ehr.staffPatientChatSource','ehr','/api/v1/ehr/patients/:patientId/chat/sources/:kind/:sourceId',G,false,one('GET','ehr.note.read'),CHAT_NOTE)),
  r('ehr.patientChatHistory','ehr','/api/v1/ehr/me/chat/history',['GET','DELETE'],false,undefined,
    'Patient sessions only; available while chat is off. Newest first, at most 50. DELETE answers 200 { cleared, deletedCount }, '
    + 'or 409 CHAT_HISTORY_ON_HOLD.'),
  r('auth.patientLogin','auth','/api/v1/auth/patient/login',P,true),
  r('auth.staffLogin','auth','/api/v1/auth/login',P,true,undefined,
    'Requires Origin and a workforce Turnstile action. Since hid-system #71 returns an MFA status, not a session.'),
  r('auth.googleNonce','auth','/api/v1/auth/google/nonce',G,true),
  r('auth.googleOnboarding','auth','/api/v1/auth/google/onboarding',G,true),
  r('auth.googleExchange','auth','/api/v1/auth/oidc/exchange',P,true),
  r('auth.googleLink','auth','/api/v1/auth/google/link',P),
  r('auth.session','auth','/api/v1/auth/session',G,false,undefined,SELF_SERVICE_SESSION),
  r('auth.refresh','auth','/api/v1/auth/refresh',P,true,undefined,`Requires refresh cookie and CSRF header. ${SELF_SERVICE_SESSION}`),
  r('auth.logout','auth','/api/v1/auth/logout',P),
  r('auth.facility','auth','/api/v1/auth/facility',P,false,undefined,SELF_SERVICE_SESSION),
  r('auth.otpStart','auth','/api/v1/auth/otp/start',P,true),
  r('auth.otpVerify','auth','/api/v1/auth/otp/verify',P,true),
  r('auth.otpComplete','auth','/api/v1/auth/otp/complete',P,true),
  // Phase 4 Stage 2A platform sign-in (hid-system phase-4-stage-2-backend-security
  // at 7cbbf98, ADR-038). A password yields only an MFA challenge cookie.
  r('auth.adminLogin','auth','/api/v1/auth/admin/login',P,true,undefined,
    'Requires Origin and Turnstile action admin-login. Returns mfa_required or mfa_enrollment_required.'),
  r('auth.adminMfaVerify','auth','/api/v1/auth/admin/mfa/verify',P,true,undefined,
    'Uses the challenge cookie; takes a TOTP code or one recovery code. Returns a platform session.'),
  r('auth.adminMfaEnrollStart','auth','/api/v1/auth/admin/mfa/enroll/start',P,true,undefined,
    'Uses the challenge cookie. The only response that contains the TOTP secret.'),
  r('auth.adminMfaEnrollActivate','auth','/api/v1/auth/admin/mfa/enroll/activate',P,true,undefined,
    'Returns a platform session and the recovery codes, once.'),
  r('auth.adminRefresh','auth','/api/v1/auth/admin/refresh',P,true,undefined,
    'Requires the platform refresh cookie and CSRF header.'),
  r('auth.adminLogout','auth','/api/v1/auth/admin/logout',P),
  // Staff sign-in with an authenticator (hid-system #71 at 8f3eff1, ADR-054,
  // migration 0088). Each step needs Origin and the staff challenge cookie
  // (hid_access_mfa, path /api/v1/auth/mfa), and no Turnstile, CSRF or session.
  r('auth.staffMfaVerify','auth','/api/v1/auth/mfa/verify',P,true,undefined,
    'Takes a TOTP code or one recovery code. Returns a staff session.'),
  r('auth.staffMfaEnrollEmailCode','auth','/api/v1/auth/mfa/enroll/email-code',P,true,undefined,
    'No body. Emails a six-digit enrolment code to the account address; a resend replaces it.'),
  r('auth.staffMfaEnrollStart','auth','/api/v1/auth/mfa/enroll/start',P,true,undefined,
    'Takes the emailed code, or none after provider activation. The only response that contains the TOTP secret.'),
  r('auth.staffMfaEnrollActivate','auth','/api/v1/auth/mfa/enroll/activate',P,true,undefined,
    'Takes the first TOTP code. Returns a staff session and the recovery codes, once.'),

  r('enrollment.start','enrollment','/api/v1/identity/patient-enrollments',P,true),
  r('enrollment.availability','enrollment','/api/v1/identity/patient-enrollments/availability',G,true,undefined,
    'hid-system#68 (FE-4); since #84 (ADR-062) 200 { open, online, facility }, each a boolean. only open: true opens a start; '
    + 'online and facility say which route to prove the NIN holder is on. An Identity before #84 sends { open } only. '
    + 'signup: true says enrollment.signup (the sign-up without a NIN) is served; without it the NIN-first start is used.'),
  proposed(r('enrollment.signup','enrollment','/api/v1/identity/patient-enrollments/signup',P,true,undefined,
    'The sign-up without a NIN (owner decision, 2026-10-27; served once availability says signup: true). Idempotency-Key header; '
    + 'body { firstName, lastName, email, phone, gender: male|female, hospitalCurrentlyUsing?, termsAccepted: true, turnstileToken, '
    + 'turnstileAction: patient-enrollment }. 200 the verify_contact progress, a code sent to the email, and the enrollment cookie; '
    + '409 PATIENT_EMAIL_ALREADY_REGISTERED or PATIENT_PHONE_ALREADY_REGISTERED.')),
  r('enrollment.current','enrollment','/api/v1/identity/patient-enrollments/current',G,true),
  r('enrollment.google','enrollment','/api/v1/identity/patient-enrollments/google',P,true),
  r('enrollment.contact','enrollment','/api/v1/identity/patient-enrollments/contact',P,true),
  r('enrollment.verifyContact','enrollment','/api/v1/identity/patient-enrollments/contact/verify',P,true),
  r('enrollment.activate','enrollment','/api/v1/identity/patient-enrollments/activate',P,true,undefined,
    'Returns HIDCode; does not create a login session. Takes dateOfBirth and gender only for the requiredProfileFields the NIN record lacks (ADR-061).'),
  // The NIN holder step (#84, ADR-062) and the facility route (#85, ADR-063). Each
  // POST needs Origin and the enrollment cookie, and takes no Turnstile token or Idempotency-Key.
  r('enrollment.holder','enrollment','/api/v1/identity/patient-enrollments/holder',P,true,undefined,
    'No body; texts a six-digit code to the phone on the NIN record. 200 { challengeId, expiresInSeconds, resendAfterSeconds }.'),
  r('enrollment.holderVerify','enrollment','/api/v1/identity/patient-enrollments/holder/verify',P,true,undefined,
    'Body { challengeId, code }; 200 { stage: verify_contact, requiredProfileFields }. 409 NIN_ALREADY_REGISTERED only after a correct code.'),
  r('enrollment.facilityCode','enrollment','/api/v1/identity/patient-enrollments/facility-code',P,true,undefined,
    'No body; answers the verify_holder progress with facility.deskCode. A new code replaces the last; five per enrollment.'),
  r('enrollment.participatingFacilities','enrollment','/api/v1/identity/patient-enrollments/participating-facilities',G,true,undefined,
    'No input; 200 { facilities: [{ name, addressLine?, town, lga, state, hours? }], whatToBring }. Empty while the facility route is off.'),

  r('identity.me','identity','/api/v1/identity/me',G),
  r('identity.accessHistory','identity','/api/v1/identity/me/access-history',G),
  r('identity.accessPin','identity','/api/v1/identity/me/access-pin',['POST','DELETE']),
  r('identity.verifyNin','identity','/api/v1/identity/me/verification/nin',P),
  // Phase 3 patient safety (hid-system phase-3-patient-safety, ADR-036).
  r('identity.accountDeletion','identity','/api/v1/identity/me/account-deletion',GP),
  r('identity.accountDeletionConfirm','identity','/api/v1/identity/me/account-deletion/confirm',P),
  r('identity.accountDeletionCancel','identity','/api/v1/identity/me/account-deletion/cancel',P),
  r('identity.emergencyContacts','identity','/api/v1/identity/me/emergency-contacts',GP,false,undefined,EMERGENCY_CONTACTS_NOTE),
  proposed(r('identity.emergencyContactsAvailability','identity','/api/v1/identity/me/emergency-contacts/availability',G,false,undefined,
    `${EMERGENCY_CONTACTS_NOVU} Patient sessions only, no database work: 200 { delivery, channels }; delivery is false while `
    + 'delivery is off or the account is outside the pilot.')),
  r('identity.emergencyContact','identity','/api/v1/identity/me/emergency-contacts/:contactId',P),
  r('identity.emergencyContactDeactivate','identity','/api/v1/identity/me/emergency-contacts/:contactId/deactivate',P),
  r('identity.emergencyContactVerification','identity','/api/v1/identity/me/emergency-contacts/:contactId/verification',P,false,undefined,
    EMERGENCY_CONTACTS_NOTE),
  r('identity.emergencyContactVerificationConfirm','identity','/api/v1/identity/me/emergency-contacts/:contactId/verification/confirm',P),
  r('identity.facilityAudit','identity','/api/v1/audit/events',G,false,one('GET','audit.read'),
    'Gateway routes this path to Identity. Requires healthcare-operations purpose and active facility.'),
  r('identity.patientLookup','identity','/api/v1/identity/patient-lookup',P,false,one('POST','identity.patient.read')),
  r('identity.authorization','identity','/api/v1/identity/authorization/check',P,false,one('POST','identity.authorization.check')),
  r('identity.consentStatus','identity','/api/v1/identity/consent-status',P,false,one('POST','identity.consent.read')),
  r('identity.registrationCapabilities','identity','/api/v1/identity/registration-capabilities',G,false,one('GET','identity.registration.write')),
  r('identity.resolveNin','identity','/api/v1/identity/nin/resolve',P,false,one('POST','identity.registration.write')),
  r('identity.registrationCase','identity','/api/v1/identity/registration-cases/:caseId',G,false,one('GET','identity.registration.write')),
  r('identity.registrationApprove','identity','/api/v1/identity/registration-cases/:caseId/approve-new',P,false,one('POST','identity.registration.approve')),
  r('identity.registrationEnroll','identity','/api/v1/identity/registration-cases/:caseId/enroll',P,false,one('POST','identity.registration.approve')),
  r('identity.registrationLink','identity','/api/v1/identity/registration-cases/:caseId/link-existing',P,false,one('POST','identity.registration.approve')),
  // Facility-assisted registration (hid-system main f9dbaf0: #85, migration 0094, ADR-063). A staff
  // session with MFA, X-Facility-ID, CSRF and an Idempotency-Key; 503 ASSISTED_REGISTRATION_DISABLED while off.
  r('identity.assistedVerifications','identity','/api/v1/identity/assisted-verifications',P,false,
    one('POST','identity.patient.assisted_registration'),
    'Body { deskCode, method, documentType, document, attestations }; 200 { outcome: verified }. The same key replays the stored outcome.'),
  // P4b: a self-signed-up facility's own staff, managed by its administrator (the Staff page).
  proposed(r('identity.facilityStaff','identity','/api/v1/identity/facility-staff',G,false,one('GET','workforce.manage'),
    `${STAFF_ROUTE} Allowed before support's review. 200 { facility { id, name, organizationType, reviewState, `
    + 'firstThirtyDaysEndAt, invitationsOpen, deliveryPaused }, canInvite, limits, inviteOptions { roles [{ code, '
    + 'licenceBody }], attestation { version, text } }, administratorLicence { body, numberHint, recordedAt } | null, '
    + 'administratorLicenceBodies, members [...], invitations [...] }; licence numbers only as their last 4 characters.')),
  proposed(r('identity.facilityAdministratorLicence','identity','/api/v1/identity/facility-staff/administrator-licence',P,false,
    one('POST','workforce.manage'),
    `${STAFF_ROUTE} The administrator's own licence, only before support's review (409 FACILITY_ALREADY_REVIEWED after). `
    + 'Body { licenceBody (MDCN, NMCN, MLSCN or PCN), licenceNumber (3 to 100) }; 200 { licenceBody, numberHint, '
    + 'recordedAt }. 400 ADMINISTRATOR_LICENCE_INVALID, 403 STAFF_MANAGEMENT_NOT_ADMINISTRATOR.')),
  proposed(r('identity.staffInvitationCreate','identity','/api/v1/identity/staff-invitations',P,false,one('POST','workforce.manage'),
    `${STAFF_ROUTE} After support's review (409 FACILITY_REVIEW_PENDING before). Idempotency-Key (16 to 128, starting `
    + 'with a letter or digit) and body { name, email, role, licenceBody?, licenceNumber?, attested: true, '
    + 'currentPassword }: no licence for a receptionist. 201 { invitationId, version, expiresAt, deliveryOutcome, replayed: '
    + 'false }; a replay 200 with replayed: true. 403 STAFF_REAUTHENTICATION_FAILED or STAFF_RECENT_RECOVERY_HOLD; 409 '
    + 'and 429 limits. Never says whether the email has a Health ID account. ' + STAFF_INVITATIONS_CLOSED)),
  proposed(r('identity.staffInvitationResend','identity','/api/v1/identity/staff-invitations/:invitationId/resend',P,false,
    one('POST','workforce.manage'),
    `${STAFF_ROUTE} Body { expectedVersion }; 200 { version, expiresAt, deliveryOutcome }: a new link and code (the old `
    + `ones answer 410 STAFF_INVITATION_SUPERSEDED), 7 more days. 409 STAFF_INVITATION_RESEND_TOO_SOON (a minute), `
    + `_SEND_LIMIT (5 sends). ${STAFF_INVITATIONS_CLOSED}`)),
  proposed(r('identity.staffInvitationRevoke','identity','/api/v1/identity/staff-invitations/:invitationId/revoke',P,false,
    one('POST','workforce.manage'),
    `${STAFF_ROUTE} Body { expectedVersion }; 200 { version, revokedAt }. 409 STAFF_INVITATION_NOT_PENDING. Not closed `
    + 'by the invitations switch.')),
  proposed(r('identity.facilityStaffEnd','identity','/api/v1/identity/facility-staff/:membershipId/end',P,false,
    one('POST','workforce.manage'),
    `${STAFF_ROUTE} Body { expectedVersion, reason (8 to 500), currentPassword }; 200 { version, endedAt, grantsRevoked }: `
    + 'the member\'s facility roles and patients\' consents to them here end. Never the caller\'s own or an administrator\'s '
    + 'membership (409 FACILITY_STAFF_SELF, _ADMINISTRATOR). Not closed by the invitations switch.')),
  proposed(r('identity.facilityStaffRole','identity','/api/v1/identity/facility-staff/:membershipId/role',P,false,
    one('POST','workforce.manage'),
    `${STAFF_ROUTE} Body { expectedVersion, role, licenceBody?, licenceNumber?, attested: true, reason (8 to 500), `
    + 'currentPassword }; 200 { version, roleCode }. 409 FACILITY_STAFF_ROLE_UNCHANGED, _PLATFORM_ACCOUNT. '
    + STAFF_INVITATIONS_CLOSED)),
  // P4b: existing staff accept an invitation signed in on their own host (no X-Facility-ID, no permission, no audit row).
  proposed(r('identity.staffInvitationSignedInPreview','identity','/api/v1/identity/staff-invitations/signed-in/preview',P,false,
    undefined,
    `${STAFF_P4B_NOVU} A staff session, CSRF, and no X-Facility-ID. Body { invitationId, token } (the link) or { code } `
    + '(typed; the email is the session\'s). 200 { invitationId, facilityId, facilityName, roleCode, inviterName, expiresAt }. '
    + '409 STAFF_INVITATION_EMAIL_MISMATCH, _ALREADY_MEMBER, _ACCOUNT_UNAVAILABLE, and open\'s refusals. '
    + STAFF_INVITATIONS_CLOSED)),
  proposed(r('identity.staffInvitationSignedInAccept','identity','/api/v1/identity/staff-invitations/signed-in/accept',P,false,
    undefined,
    `${STAFF_P4B_NOVU} As the preview; 200 { accepted: true, facilityId, membershipId, facilityName, roleCode }. The `
    + `session lists the new facility from its next request. ${STAFF_INVITATIONS_CLOSED}`)),
  // P4c: the directory a clinician picks a laboratory or pharmacy at another facility from.
  { ...proposed(r('identity.orderDestinations','identity','/api/v1/identity/order-destinations',G,false,
    one('GET','ehr.order-route.send'),
    `${ORDER_ROUTES_P4C_NOVU} Staff session with X-Facility-ID (Identity reads it as direct-care). Query kind (laboratory `
    + 'or pharmacy) and query (3 to 80 characters of the facility or organization name). 200 { items [{ facilityId, '
    + 'facilityName, organizationName, registeredAddress (the CAC registered office) | null, newOnHealthId }] }: at most '
    + '10 reviewed or governed facilities listed for orders, never this one. 400 ORDER_DESTINATION_QUERY_INVALID, 429 '
    + `ORDER_DESTINATION_SEARCH_LIMITED (60 searches an hour per member). ${ORDER_ROUTES_PAUSED}`)),
  requiredQuery: { GET: ['kind', 'query'] } },
  proposed(r('enrollment.providerAvailability','enrollment','/api/v1/identity/provider-enrollments/availability',G,true,undefined,
    `${SELF_SIGN_UP_NOVU} Public, no session, never an error: 200 { open: true }, { open: false, reason: 'closed' } (switched `
    + 'off or not configured) or { open: false, reason: \'unavailable\' } (a fault: try again shortly, never shown as closed). '
    + 'Since P4c the open answer is { open: true, crossFacilityOrders } (whether orders between facilities are on).')),
  r('enrollment.providerStart','enrollment','/api/v1/identity/provider-enrollments',P,true,undefined,
    'Accountless; refused when signed in. Requires Origin and Turnstile action provider-enrollment (on Novu, '
    + 'app.* and staging.* only). Answers { accepted, challengeId, expiresInSeconds, resendAfterSeconds }; on Novu also '
    + 'codeSent: false when no code was sent, with challengeId and expiresInSeconds naming the code still in force (absent '
    + `when none can be entered) and resendAfterSeconds the real wait, up to about a day. ${SELF_SIGN_UP_CLOSED}`),
  r('enrollment.providerVerify','enrollment','/api/v1/identity/provider-enrollments/verify',P,true,undefined,
    `Accountless; verifies the emailed code and sets the enrollment cookie. ${SELF_SIGN_UP_CLOSED}`),
  // P4 round 2 (R13): the applicant sees the organization a CAC number names before its account is made.
  proposed(r('enrollment.providerProfile','enrollment','/api/v1/identity/provider-enrollments/profile',G,true,undefined,
    `${SELF_SIGN_UP_NOVU} Accountless and refused when signed in; reads the enrollment cookie that verify sets, with no `
    + 'Origin (a same-origin GET), and changes nothing: 200 { organizationName (the verified legal name), registrationNumber '
    + '(the CAC number as entered), productCode, organizationType, administratorName, administratorEmail }, 401 '
    + `ORGANIZATION_COMPLETION_SESSION_INVALID without a live, ready session. ${SELF_SIGN_UP_CLOSED}`)),
  r('enrollment.providerActivate','enrollment','/api/v1/identity/provider-enrollments/activate',P,true,undefined,
    'Accountless; uses the enrollment cookie. On Novu it signs the administrator in: the session cookies and '
    + `{ activated, organizationId, facilityId, accountId, actor, expiresAt }. ${SELF_SIGN_UP_CLOSED} `
    + 'On hid-system main since #71 it returns an MFA status, not a session. On Novu since P4b the administrator '
    + 'holds org_admin_awaiting_review until support\'s review, and the actor\'s facility carries selfService '
    + "{ review: 'pending', organizationType }."),
  // P4 leftover 1 (P4b): "This isn't my organization" closes the applicant's own open sign-up.
  proposed(r('enrollment.providerWithdraw','enrollment','/api/v1/identity/provider-enrollments/withdraw',P,true,undefined,
    `${SELF_SIGN_UP_NOVU} Accountless and refused when signed in (409 PROVIDER_ENROLLMENT_REQUIRES_SIGN_OUT); Origin `
    + '(403 ORIGIN_DENIED) and the enrollment cookie that verify sets, no body. Closes that sign-up, ends its session '
    + 'and codes and frees its CAC number, with no 7-day refusal: 200 { withdrawn: true }, the cookie cleared; 401 '
    + `ORGANIZATION_COMPLETION_SESSION_INVALID without a live session. ${SELF_SIGN_UP_CLOSED}`)),
  // P4b: an invitee opens their invitation and, for a new or dormant account, sets a password (no session issued).
  proposed(r('enrollment.staffInvitationOpen','enrollment','/api/v1/identity/staff-invitations/open',P,true,undefined,
    `${STAFF_P4B_NOVU} Accountless and refused when signed in (409 STAFF_INVITATION_REQUIRES_SIGN_OUT); Origin and `
    + 'Turnstile action staff-invitation (app.* and staging.* only). Body { invitationId, token } (the link) or { email, '
    + 'code } (typed), with turnstileAction and turnstileToken. 200 { invitationId, facilityName, roleCode, inviterName, '
    + 'inviteeName, email, expiresAt, accountCase, linkRequired }, plus the hid_staff_invitation cookie for a new or '
    + 'dormant account opened by its link. 401 STAFF_INVITATION_CODE_INVALID, 429 STAFF_INVITATION_LOCKED or '
    + 'STAFF_INVITATION_RATE_LIMITED, 410 STAFF_INVITATION_SUPERSEDED, _EXPIRED or _WITHDRAWN, 409 '
    + `STAFF_INVITATION_ALREADY_ACCEPTED. ${STAFF_INVITATIONS_CLOSED}`)),
  proposed(r('enrollment.staffInvitationAccept','enrollment','/api/v1/identity/staff-invitations/accept',P,true,undefined,
    `${STAFF_P4B_NOVU} Accountless; Origin and the hid_staff_invitation cookie that open sets. Body { password } (12 to `
    + '256). 200 { accepted: true, facilityName, roleCode }: the cookie cleared and no session cookie; the person signs '
    + 'in on their role\'s host. 401 STAFF_INVITATION_SESSION_INVALID, 410 _EXPIRED or _WITHDRAWN, 409 _ACCOUNT_EXISTS, '
    + `_ACCOUNT_CHANGED, _PATIENT_ACCOUNT or _ACCOUNT_UNAVAILABLE. ${STAFF_INVITATIONS_CLOSED}`)),
  // Clinician self sign-up and its status page (hid-system ADR-066, branch
  // claude/clinician-self-signup at fa58e2b, re-checked at 9e981e4, and P3's
  // search limit at 1d6ff6f; not merged). Every route needs
  // Origin and no CSRF or session; after the email code the browser holds only
  // the httpOnly capability cookie hid_clinician_application (path
  // /api/v1/identity/clinician-applications). Nothing here issues a session.
  r('enrollment.clinicianAvailability','enrollment','/api/v1/identity/clinician-applications/availability',G,true,undefined,
    'No input; 200 { open: boolean }. Anything but { open: true } means not open.'),
  r('enrollment.clinicianEmailCode','enrollment','/api/v1/identity/clinician-applications/email-code',P,true,undefined,
    'Turnstile action clinician-application (main site only). The same 202 for every address. Refused while signed in.'),
  r('enrollment.clinicianEmailVerify','enrollment','/api/v1/identity/clinician-applications/email-code/verify',P,true,undefined,
    'Sets the draft capability cookie. 409 CLINICIAN_EMAIL_IN_USE only after a correct code.'),
  r('enrollment.clinicianFacilitySearch','enrollment','/api/v1/identity/clinician-applications/facility-search',P,true,undefined,
    'Draft or ready capability; at most 10 verified facilities. 30 searches per capability, then (since 7cd8038) '
    + '429 CLINICIAN_APPLICATION_SEARCH_LIMITED with no Retry-After: only a new capability searches again.'),
  r('enrollment.clinicianSubmit','enrollment','/api/v1/identity/clinician-applications',P,true,undefined,
    'Draft capability and Idempotency-Key. Creates the account and the application; no session, no role. '
    + 'Since 9e981e4 a draft takes at most five hashed submissions (then 401).'),
  r('enrollment.clinicianAuthenticatorEmailCode','enrollment','/api/v1/identity/clinician-applications/authenticator/email-code',P,true,undefined,
    'No body. Emails the enrolment proof code (0088).'),
  r('enrollment.clinicianAuthenticatorStart','enrollment','/api/v1/identity/clinician-applications/authenticator/start',P,true,undefined,
    'Takes the emailed code. The only response that contains the TOTP secret.'),
  r('enrollment.clinicianAuthenticatorActivate','enrollment','/api/v1/identity/clinician-applications/authenticator/activate',P,true,undefined,
    'Takes the first TOTP code. Returns the recovery codes once and the applications; no session.'),
  r('enrollment.clinicianAuthenticatorVerify','enrollment','/api/v1/identity/clinician-applications/authenticator/verify',P,true,undefined,
    'A TOTP code or one recovery code. Returns the applications; no session.'),
  r('enrollment.clinicianAuthenticatorChallenge','enrollment','/api/v1/identity/clinician-applications/authenticator/challenge',P,true,undefined,
    'Opens the authenticator step again after it expired.'),
  r('enrollment.clinicianStatusEmailCode','enrollment','/api/v1/identity/clinician-applications/status/email-code',P,true,undefined,
    'Turnstile action clinician-application-status (main site only). The same 202 for every address.'),
  r('enrollment.clinicianStatusEmailVerify','enrollment','/api/v1/identity/clinician-applications/status/email-code/verify',P,true,undefined,
    'Sets the account capability cookie; answers which authenticator step comes next.'),
  r('enrollment.clinicianCurrent','enrollment','/api/v1/identity/clinician-applications/current',G,true,undefined,
    'The applicant\'s applications, from the capability cookie.'),
  r('enrollment.clinicianWithdraw','enrollment','/api/v1/identity/clinician-applications/:applicationId/withdraw',P,true,undefined,
    'If-Match "<version>".'),
  r('enrollment.clinicianApply','enrollment','/api/v1/identity/clinician-applications/current/applications',P,true,undefined,
    'Ready capability and Idempotency-Key: apply to another facility.'),
  r('enrollment.clinicianSessionEnd','enrollment','/api/v1/identity/clinician-applications/session/end',P,true,undefined,
    'Always 204; ends the capability and clears its cookie.'),
  r('identity.organizationApply','enrollment','/api/v1/identity/organization-applications',P,true),
  r('identity.organizationCompletionStart','enrollment','/api/v1/identity/organization-applications/completion/start',P,true),
  r('identity.organizationCompletionVerify','enrollment','/api/v1/identity/organization-applications/completion/verify',P,true),
  r('identity.organizationCompletionProfile','enrollment','/api/v1/identity/organization-applications/completion/profile',GPA,true),
  r('identity.organizationVerifyCac','identity','/api/v1/identity/organizations/verification/cac/:organizationContext',P,false,one('POST','organization.manage')),

  r('access.patientRequests','access','/api/v1/identity/me/access-requests',G),
  r('access.staffRequests','access','/api/v1/identity/access-requests',GP,false,{GET:['identity.consent.write'],POST:['identity.consent.write']}),
  r('access.approve','access','/api/v1/identity/access-requests/:requestId/approve',P),
  r('access.deny','access','/api/v1/identity/access-requests/:requestId/deny',P),
  r('access.breakGlass','access','/api/v1/identity/break-glass',P,false,one('POST','identity.consent.write','identity.break-glass.write'),
    'On Novu since P4b, a facility that signed itself up may activate emergency access 5 times a day in its first 30 days '
    + 'after support\'s review: 429 EMERGENCY_PROBATION_LIMITED beyond that, until support ends the limits.'),
  r('access.verifyPin','access','/api/v1/identity/standard-access/pin',P,false,one('POST','identity.patient-access-pin.verify')),
  r('access.closeOwnGrant','access','/api/v1/identity/consent-grants/:grantId/close',P,false,one('POST','identity.consent.write')),
  r('access.revokeMyGrant','access','/api/v1/identity/me/consent-grants/:grantId/revoke',P),
  r('notifications.list','notifications','/api/v1/identity/me/notifications',G),
  r('notifications.read','notifications','/api/v1/identity/me/notifications/:notificationId/read',P),

  r('ehr.myRecords','ehr','/api/v1/ehr/me/records',G),
  r('ehr.myImportedHistory','ehr','/api/v1/ehr/me/imported-history',G,false,undefined,
    'Patient sessions only. 503 IMPORTED_HISTORY_DISABLED until hid-system turns the patient read on (ADR-067, 0099). '
    + 'Optional cursor. Not part of ehr.myRecords.'),
  r('ehr.importedHistory','ehr','/api/v1/ehr/patients/:patientId/imported-history',G,false,one('GET','ehr.imported-history.read'),
    'Direct care only (X-Purpose-Of-Use: direct-care, else 400 DIRECT_CARE_PURPOSE_REQUIRED) at the selected facility; '
    + '{ shared: false } with no record until the patient shares. 503 IMPORTED_HISTORY_DISABLED while off. Optional cursor.'),
  r('identity.importedHistorySharing','identity','/api/v1/identity/me/imported-history-sharing',GP,false,undefined,
    'Patient sessions only. GET { shared, updatedAt }; POST { shared } answers { shared, changed, updatedAt }. Turning sharing on '
    + 'needs a recent sign-in (403 PATIENT_RECENT_AUTH_REQUIRED) and no recovery in the last 24 hours (403 PATIENT_RECENT_RECOVERY_HOLD); '
    + '503 IMPORTED_HISTORY_SHARING_DISABLED while the switch is off.'),
  proposed(r('ehr.myImportedAttachment','ehr','/api/v1/ehr/me/imported-attachments/:fileId/download',G,false,undefined,
    `${NOT_ON_MAIN} Offered only when ehr.myRecords carries importedRecords, which main's does not.`)),
  proposed(r('ehr.importedRecords','ehr','/api/v1/ehr/patients/:patientId/imported-records',G,false,one('GET','ehr.note.read'),
    `${NOT_ON_MAIN} The chart asks only when VITE_HID_IMPORTED_RECORDS_ENABLED is true. Main serves imported history at ehr.importedHistory instead.`)),
  proposed(r('ehr.importedAttachment','ehr','/api/v1/ehr/patients/:patientId/imported-attachments/:fileId/download',G,false,one('GET','ehr.note.read','ehr.document.read'),
    `${NOT_ON_MAIN} The chart asks only when VITE_HID_IMPORTED_RECORDS_ENABLED is true.`)),
  r('ehr.emergencyRecords','ehr','/api/v1/ehr/patients/:patientId/emergency-records',G,false,one('GET','ehr.encounter.read','ehr.note.read')),
  r('ehr.encounters','ehr','/api/v1/ehr/patients/:patientId/encounters',GP,false,{GET:['ehr.encounter.read'],POST:['ehr.encounter.write']}),
  r('ehr.encounter','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId',GPA,false,{GET:['ehr.encounter.read'],PATCH:['ehr.encounter.write']}),
  r('ehr.vitals','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/vitals',GP,false,{GET:['ehr.vital.read'],POST:['ehr.vital.write']}),
  r('ehr.vital','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/vitals/:vitalId',G,false,one('GET','ehr.vital.read')),
  r('ehr.vitalCorrections','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/vitals/:vitalId/corrections',GP,false,{GET:['ehr.vital.read'],POST:['ehr.vital.write']}),
  r('ehr.notes','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/clinical-notes',GP,false,{GET:['ehr.note.read'],POST:['ehr.note.write']}),
  r('ehr.note','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/clinical-notes/:noteId',GPA,false,{GET:['ehr.note.read'],PATCH:['ehr.note.write']}),
  r('ehr.noteRevisions','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/clinical-notes/:noteId/revisions',GP,false,{GET:['ehr.note.read'],POST:['ehr.note.write']}),
  r('ehr.diagnoses','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/diagnoses',GP,false,{GET:['ehr.diagnosis.read'],POST:['ehr.diagnosis.write']}),
  r('ehr.diagnosis','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/diagnoses/:diagnosisId',GPA,false,{GET:['ehr.diagnosis.read'],PATCH:['ehr.diagnosis.write']}),
  r('ehr.prescriptions','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/prescriptions',GP,false,{GET:['ehr.prescription.read'],POST:['ehr.prescription.write']},
    ORDER_LISTS_P4C),
  r('ehr.prescription','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/prescriptions/:prescriptionId',GPA,false,{GET:['ehr.prescription.read'],PATCH:['ehr.prescription.write']}),
  r('ehr.prescriptionPharmacy','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/prescriptions/:prescriptionId/pharmacy-work-item',P,false,one('POST','pharmacy.work-item.accept'),
    'On Novu since P4c, 409 PRESCRIPTION_ROUTED while the prescription is sent to (or was accepted by) a pharmacy at another facility.'),
  r('ehr.labRequests','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/lab-requests',GP,false,{GET:['ehr.lab-request.read'],POST:['ehr.lab-request.write']},
    ORDER_LISTS_P4C),
  r('ehr.labRequest','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/lab-requests/:requestId',GPA,false,{GET:['ehr.lab-request.read'],PATCH:['ehr.lab-request.write']},
    'On Novu since P4c a PATCH answers orderRoute (as the change left it), and a request sent to another facility is never '
    + "handed to this facility's Lab: labHandoff { state: 'not_sent', code: 'ORDER_ROUTED' }."),
  // hid-system #56: sends (or sends again) a saved active lab request to Lab.
  r('ehr.labRequestLabWorkItem','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/lab-requests/:requestId/lab-work-item',P,false,one('POST','ehr.lab-request.write','lab.work-item.accept'),
    'On Novu since P4c, 409 LAB_REQUEST_ROUTED while the request is sent to (or was accepted by) a laboratory at another facility.'),
  // P4c: send an order to another facility's laboratory or pharmacy, list its routes, and withdraw one before acceptance.
  proposed(r('ehr.labRequestOrderRoutes','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/lab-requests/:requestId/order-routes',GP,false,
    {GET:['ehr.lab-request.read'],POST:['ehr.lab-request.write','ehr.order-route.send']},
    `${ORDER_ROUTE_STAFF} ${ORDER_ROUTE_SEND} ${ORDER_ROUTES_WRONG_PATIENT}`)),
  proposed(r('ehr.labRequestOrderRouteWithdraw','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/lab-requests/:requestId/order-routes/:routeId/withdraw',P,false,
    one('POST','ehr.order-route.send'), `${ORDER_ROUTE_STAFF} ${ORDER_ROUTE_WITHDRAW}`)),
  proposed(r('ehr.prescriptionOrderRoutes','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/prescriptions/:prescriptionId/order-routes',GP,false,
    {GET:['ehr.prescription.read'],POST:['ehr.prescription.write','ehr.order-route.send']},
    `${ORDER_ROUTE_STAFF} ${ORDER_ROUTE_SEND} ${ORDER_ROUTES_WRONG_PATIENT}`)),
  proposed(r('ehr.prescriptionOrderRouteWithdraw','ehr','/api/v1/ehr/patients/:patientId/encounters/:encounterId/prescriptions/:prescriptionId/order-routes/:routeId/withdraw',P,false,
    one('POST','ehr.order-route.send'), `${ORDER_ROUTE_STAFF} ${ORDER_ROUTE_WITHDRAW}`)),
  { ...proposed(r('ehr.orderRouteAttestation','ehr','/api/v1/ehr/order-route-attestation',G,false,one('GET','ehr.order-route.send'),
    `${ORDER_ROUTE_STAFF} Query kind (lab_request or prescription); also needs the kind's write permission. 200 { kind, `
    + 'version, text }: the newest attestation text, with {patient}, {orderingFacility} and {receivingFacility} for the page '
    + `to fill. 400 ORDER_ROUTE_INVALID. ${ORDER_ROUTES_PAUSED}`)),
  requiredQuery: { GET: ['kind'] } },
  // Item 3 (D10): the ordering facility's Overview card, orders sent from it that the receiver ended as accepted for the wrong person.
  proposed(r('ehr.orderRoutesWrongPatient','ehr','/api/v1/ehr/order-routes/wrong-patient',G,false,one('GET','ehr.order-route.send'),
    `${WRONG_PATIENT_NOVU} Staff session with X-Facility-ID and X-Purpose-Of-Use: direct-care (any other purpose 403 `
    + 'PERMISSION_DENIED), bound to the live membership like the order-route reads, and audited. Orders sent from this '
    + 'facility that ended wrong_patient in the last 30 days: 200 { windowDays: 30, items [{ routeId, reference, kind, '
    + 'receivingFacility { id, name }, patient { name }, endedAt, resultsWithdrawn, dispensingReversed, link { patientId, '
    + 'encounterId, kind, orderId } }] (at most 50, newest first: only the orders this member sent, whether or not they may '
    + 'still open the patient\'s record), others { count, references } (every such order a colleague sent: its reference only, at '
    + 'most 100, never a patient\'s name) }; the empty answer for a facility with none. 403 PERMISSION_DENIED; 503 '
    + 'ORDER_ROUTE_UNAVAILABLE. With the late correction (D17, hid-system 0090) the list covers reports of the last 30 days '
    + 'whatever the order\'s ending, items also carry reportedAt, late and endedKindBefore (a late report on an order that '
    + 'had ended another way keeps that ending in endedAt), and the answer lateCorrection: true; an earlier backend sends '
    + 'none of these.')),
  // P4c: the patient's orders sent to other facilities, and Stop before acceptance (the patient's only action).
  proposed(r('ehr.myOrderRoutes','ehr','/api/v1/ehr/me/order-routes',G,false,undefined,
    `${ORDER_ROUTES_P4C_NOVU} Patient sessions only. 200 { items: PatientOrderRoute[] }, newest first, at most 100: each with `
    + 'orderingFacilityName, receivingFacilityName, receivingRegisteredAddress, content (every field sent), '
    + 'attestationTextVersion, attestationText, attestedByName, actions (withdraw while it waits for acceptance) and '
    + 'enteredInError: when the order was marked entered in error, content holds only its reference, the attestation '
    + 'text and attesting clinician are null and actions is empty. With the wrong-patient report (item 3, hid-system '
    + '0088) endedKind may be wrong_patient: the content stays in full and actions is empty; the patient\'s inbox gets '
    + 'ORDER_ROUTE_WRONG_PATIENT (metadata routeId, kind, orderingFacilityName, receivingFacilityName). With the late '
    + 'correction (D17, hid-system 0090) each item also carries wrongPatient { reportedAt, late } | null and '
    + 'correctableUntil (a time while the receiving facility may still correct it, else null), and a late report on an '
    + 'order that had ended another way sends ORDER_ROUTE_WRONG_PATIENT_CORRECTED (the same metadata); an earlier backend '
    + 'sends neither field. With "We can\'t complete this order" (D18, hid-system 0091) endedKind may be receiving_unable '
    + '(cancelled; the reason is not sent to the patient, D18-4), and the patient\'s inbox gets ORDER_ROUTE_NOT_COMPLETED '
    + '(the same metadata).')),
  proposed(r('ehr.myOrderRouteWithdraw','ehr','/api/v1/ehr/me/order-routes/:routeId/withdraw',P,false,undefined,
    `${ORDER_ROUTES_P4C_NOVU} Patient sessions only; Stop. Body { expectedVersion }; 200 { route: PatientOrderRoute }. 404 `
    + 'ORDER_ROUTE_NOT_FOUND, 409 ORDER_ROUTE_NOT_PENDING (accepted or ended), 412 VERSION_CONFLICT.')),
  r('files.list','files','/api/v1/ehr/documents',G,false,one('GET','ehr.document.read')),
  r('files.uploadIntent','files','/api/v1/ehr/documents/upload-intents',P,false,one('POST','ehr.document.write')),
  r('files.complete','files','/api/v1/ehr/documents/:documentId/complete',P,false,one('POST','ehr.document.write')),
  r('files.download','files','/api/v1/ehr/documents/:documentId/download',G,false,one('GET','ehr.document.read')),

  r('lab.workItems','lab','/api/v1/lab/work-items',G,false,one('GET','lab.work-item.read'),WORK_LISTS_P4C),
  r('lab.workItem','lab','/api/v1/lab/work-items/:workItemId',G,false,one('GET','lab.work-item.read')),
  r('lab.imports','lab','/api/v1/lab/imports',P,false,one('POST','lab.import.write')),
  r('lab.import','lab','/api/v1/lab/imports/:importId',G,false,one('GET','lab.import.read')),
  r('lab.createAccession','lab','/api/v1/lab/work-items/:workItemId/accession',P,false,one('POST','lab.accession.create')),
  r('lab.accession','lab','/api/v1/lab/accessions/:accessionId',G,false,one('GET','lab.accession.read')),
  r('lab.specimens','lab','/api/v1/lab/accessions/:accessionId/specimens',G,false,one('GET','lab.accession.read')),
  r('lab.collect','lab','/api/v1/lab/accessions/:accessionId/specimens/:specimenId/collect',P,false,one('POST','lab.specimen.collect')),
  r('lab.receive','lab','/api/v1/lab/accessions/:accessionId/specimens/:specimenId/receive',P,false,one('POST','lab.specimen.receive')),
  r('lab.reject','lab','/api/v1/lab/accessions/:accessionId/specimens/:specimenId/reject',P,false,one('POST','lab.specimen.reject')),
  r('lab.executions','lab','/api/v1/lab/specimens/:specimenId/executions',GP,false,{GET:['lab.execution.read'],POST:['lab.execution.start']}),
  r('lab.execution','lab','/api/v1/lab/executions/:executionId',G,false,one('GET','lab.execution.read')),
  r('lab.completeExecution','lab','/api/v1/lab/executions/:executionId/complete',P,false,one('POST','lab.execution.complete')),
  r('lab.results','lab','/api/v1/lab/executions/:executionId/results',P,false,one('POST','lab.result.enter')),
  r('lab.correctResult','lab','/api/v1/lab/executions/:executionId/results/:resultId/corrections',P,false,one('POST','lab.result.correct')),
  r('lab.verifyResult','lab','/api/v1/lab/results/:resultId/verify',P,false,one('POST','lab.result.verify')),
  r('lab.releaseResult','lab','/api/v1/lab/results/:resultId/release',P,false,one('POST','lab.result.release')),
  r('lab.resultHistory','lab','/api/v1/lab/results/:resultId/history',G,false,one('GET','lab.result.released.read')),
  // hid-system #51: the released results of the Lab work item accepted from one EHR lab request.
  r('lab.releasedResultsForOrder','lab','/api/v1/lab/ehr-orders/:sourceEhrOrderId/released-results',G,false,one('GET','lab.result.released.read')),
  // P4c: lab requests other facilities send to this laboratory (Incoming and Recent), one of them, accept and decline.
  { ...proposed(r('lab.orderRoutes','lab','/api/v1/lab/order-routes',G,false,one('GET','lab.order-route.receive'),RECEIVE_ROUTE)),
    forbiddenQuery: { GET: ['healthId'] } },
  proposed(r('lab.orderRouteSearch','lab','/api/v1/lab/order-routes/search',P,false,one('POST','lab.order-route.receive'),RECEIVE_SEARCH)),
  proposed(r('lab.orderRoute','lab','/api/v1/lab/order-routes/:routeId',G,false,one('GET','lab.order-route.receive'),
    `${RECEIVE_ROUTE} One route: the Incoming shape, and after acceptance, while it may be read, clinicalInformation, `
    + 'orderer.licenceNumber, patient and workItemId.')),
  proposed(r('lab.orderRouteAccept','lab','/api/v1/lab/order-routes/:routeId/accept',P,false,one('POST','lab.order-route.receive'),RECEIVE_ROUTE)),
  proposed(r('lab.orderRouteDecline','lab','/api/v1/lab/order-routes/:routeId/decline',P,false,one('POST','lab.order-route.receive'),RECEIVE_ROUTE)),
  // Item 3: "This isn't the order's patient", ending an order accepted for the wrong person and withdrawing its results.
  proposed(r('lab.orderRouteWrongPatient','lab','/api/v1/lab/order-routes/:routeId/wrong-patient',P,false,
    one('POST','lab.order-route.receive'),WRONG_PATIENT_ROUTE)),
  // D18: "We can't complete this order", ending an order accepted here that can't be completed, with one fixed reason.
  proposed(r('lab.orderRouteCannotComplete','lab','/api/v1/lab/order-routes/:routeId/cannot-complete',P,false,
    one('POST','lab.order-route.receive'),CANNOT_COMPLETE_ROUTE)),
  // D17: "Correct an order that has ended": find an accepted order by its reference, and withdraw what was recorded on it.
  proposed(r('lab.orderRouteCorrectable','lab','/api/v1/lab/order-routes/correctable',P,false,
    one('POST','lab.order-route.receive'),LATE_CORRECTION_LOOKUP)),
  proposed(r('lab.orderRouteWrongPatientCorrection','lab','/api/v1/lab/order-routes/:routeId/wrong-patient-correction',P,false,
    one('POST','lab.order-route.receive'),LATE_CORRECTION_ROUTE)),
  r('pharmacy.workItems','pharmacy','/api/v1/pharmacy/work-items',G,false,one('GET','pharmacy.work-item.read'),WORK_LISTS_P4C),
  r('pharmacy.workItem','pharmacy','/api/v1/pharmacy/work-items/:workItemId',G,false,one('GET','pharmacy.work-item.read')),
  r('pharmacy.dispense','pharmacy','/api/v1/pharmacy/work-items/:workItemId/dispensings',P,false,one('POST','pharmacy.dispensing.create')),
  r('pharmacy.dispensing','pharmacy','/api/v1/pharmacy/dispensings/:dispensingId',G,false,one('GET','pharmacy.dispensing.read')),
  r('pharmacy.reverse','pharmacy','/api/v1/pharmacy/dispensings/:dispensingId/reversals',P,false,one('POST','pharmacy.dispensing.reverse')),
  r('pharmacy.import','pharmacy','/api/v1/pharmacy/imports/:importId',G,false,one('GET','pharmacy.import.read')),
  // P4c: prescriptions other facilities send to this pharmacy, as Lab's.
  { ...proposed(r('pharmacy.orderRoutes','pharmacy','/api/v1/pharmacy/order-routes',G,false,one('GET','pharmacy.order-route.receive'),
    RECEIVE_ROUTE)), forbiddenQuery: { GET: ['healthId'] } },
  proposed(r('pharmacy.orderRouteSearch','pharmacy','/api/v1/pharmacy/order-routes/search',P,false,one('POST','pharmacy.order-route.receive'),RECEIVE_SEARCH)),
  proposed(r('pharmacy.orderRoute','pharmacy','/api/v1/pharmacy/order-routes/:routeId',G,false,one('GET','pharmacy.order-route.receive'),
    `${RECEIVE_ROUTE} One route: the Incoming shape, and after acceptance, while it may be read, instructions, `
    + 'orderer.licenceNumber, patient and workItemId.')),
  proposed(r('pharmacy.orderRouteAccept','pharmacy','/api/v1/pharmacy/order-routes/:routeId/accept',P,false,one('POST','pharmacy.order-route.receive'),RECEIVE_ROUTE)),
  proposed(r('pharmacy.orderRouteDecline','pharmacy','/api/v1/pharmacy/order-routes/:routeId/decline',P,false,one('POST','pharmacy.order-route.receive'),RECEIVE_ROUTE)),
  // Item 3: the same for a prescription, reversing its dispensing.
  proposed(r('pharmacy.orderRouteWrongPatient','pharmacy','/api/v1/pharmacy/order-routes/:routeId/wrong-patient',P,false,
    one('POST','pharmacy.order-route.receive'),WRONG_PATIENT_ROUTE)),
  // D18: the same for a prescription.
  proposed(r('pharmacy.orderRouteCannotComplete','pharmacy','/api/v1/pharmacy/order-routes/:routeId/cannot-complete',P,false,
    one('POST','pharmacy.order-route.receive'),CANNOT_COMPLETE_ROUTE)),
  // D17: the same for a prescription, reversing its dispensing.
  proposed(r('pharmacy.orderRouteCorrectable','pharmacy','/api/v1/pharmacy/order-routes/correctable',P,false,
    one('POST','pharmacy.order-route.receive'),LATE_CORRECTION_LOOKUP)),
  proposed(r('pharmacy.orderRouteWrongPatientCorrection','pharmacy','/api/v1/pharmacy/order-routes/:routeId/wrong-patient-correction',P,false,
    one('POST','pharmacy.order-route.receive'),LATE_CORRECTION_ROUTE)),

  { ...r('ocr.jobs','ocr','/api/v1/ocr/jobs',GP,false,{GET:['ocr.job.read'],POST:['ocr.job.write']}),
    requiredQuery: { GET: ['documentId'] } },
  r('ocr.job','ocr','/api/v1/ocr/jobs/:jobId',G,false,one('GET','ocr.job.read')),
  r('ocr.retry','ocr','/api/v1/ocr/jobs/:jobId/retry',P,false,one('POST','ocr.job.write')),
  r('ocr.extractions','ocr','/api/v1/ocr/jobs/:jobId/extractions',G,false,one('GET','ocr.job.read')),
  r('ocr.validation','ocr','/api/v1/ocr/jobs/:jobId/validation',P,false,one('POST','ocr.validation.write')),
  r('ocr.validations','ocr','/api/v1/ocr/jobs/:jobId/validations',GP,false,{GET:['ocr.job.read'],POST:['ocr.validation.write']}),
  r('ocr.patientConfirmation','ocr','/api/v1/ocr/jobs/:jobId/patient-confirmation',P,false,one('POST','ocr.patient.confirm')),
  r('ocr.publications','ocr','/api/v1/ocr/validations/:validationId/publications',GP,false,{GET:['ocr.job.read'],POST:['ocr.publication.write']}),

  r('outreach.campaigns','outreach','/api/v1/outreach/registration-cases/campaigns',GP,false,{GET:['outreach.campaign.read'],POST:['outreach.campaign.write']}),
  r('outreach.campaignStatus','outreach','/api/v1/outreach/registration-cases/campaigns/:campaignId/status',P,false,one('POST','outreach.campaign.write')),
  r('outreach.campaignMembers','outreach','/api/v1/outreach/registration-cases/campaigns/:campaignId/members',GP,false,{GET:['outreach.campaign.read'],POST:['outreach.campaign.write']}),
  r('outreach.cases','outreach','/api/v1/outreach/registration-cases',GP,false,{GET:['outreach.registration.read'],POST:['outreach.registration.write']}),
  r('outreach.case','outreach','/api/v1/outreach/registration-cases/:caseId',G,false,one('GET','outreach.registration.read')),
  r('outreach.linkExisting','outreach','/api/v1/outreach/registration-cases/:caseId/link-existing',P,false,one('POST','outreach.registration.write')),

  r('commercial.pricing','commercial','/api/v1/commercial/pricing',G,true),
  r('commercial.demo','commercial','/api/v1/commercial/demo-requests',P,true),
  // Facility billing (docs/BILLING_SPEC.md): proposed, not yet served by hid-system.
  proposed(r('commercial.subscription','commercial','/api/v1/commercial/subscription',G,false,one('GET','billing.subscription.read'))),
  proposed(r('commercial.subscriptionTrial','commercial','/api/v1/commercial/subscription/trial',P,false,one('POST','billing.subscription.manage'))),
  proposed(r('commercial.subscriptionCheckout','commercial','/api/v1/commercial/subscription/checkout',P,false,one('POST','billing.subscription.manage'),
    'Answers a Paystack authorizationUrl; payment is confirmed only by the server (webhook or verify).')),
  proposed(r('commercial.invoices','commercial','/api/v1/commercial/invoices',G,false,one('GET','billing.subscription.read'))),

  r('admin.session','admin','/api/v1/admin/session',G,false,one('GET','platform.admin.access')),
  r('admin.overview','admin','/api/v1/admin/overview',G,false,one('GET','platform.admin.access')),
  r('admin.controls','admin','/api/v1/admin/controls',GP,false,{GET:['platform.control.read'],POST:['platform.control.manage']},
    'On Novu since P4c controlKey also takes cross_facility_orders_enabled and cross_facility_route_access_enabled.'),
  r('admin.facilities','admin','/api/v1/admin/facilities',G,false,one('GET','platform.facility.read')),
  r('admin.facility','admin','/api/v1/admin/facilities/:facilityId',G,false,one('GET','platform.facility.read'),
    'On staging-novu-ci-20261005 since hid-system #109 the read also answers alertPhoneE164 and alertPhoneUpdatedAt.'),
  r('admin.facilityStatus','admin','/api/v1/admin/facilities/:facilityId/status',P,false,one('POST','platform.facility.manage')),
  // hid-system #109: the phone an emergency-contact alert gives for a facility, and support's opt-out of a recipient.
  proposed(r('admin.facilityAlertPhone','admin','/api/v1/admin/facilities/:facilityId/alert-phone',P,false,
    one('POST','platform.facility.manage'),
    `${EMERGENCY_CONTACTS_NOVU} Body { phone (null clears), reason (8 to 500) }, If-Match with the facility version and `
    + 'Idempotency-Key; answers { facilityId, alertPhoneE164, version, replayed }. 400 ADMIN_INVALID_FACILITY_PHONE.')),
  proposed(r('admin.emergencyContactOptOut','admin','/api/v1/admin/emergency-contacts/opt-out',P,false,
    one('POST','platform.emergency-contact.manage'),
    `${EMERGENCY_CONTACTS_NOVU} Body { channel, destination (5 to 254), reason (8 to 500) } and Idempotency-Key; answers `
    + '{ contacts, patients, replayed }, counts only.')),
  // hid-system main f9dbaf0 (#85, ADR-063): a facility's designation for assisted registration.
  r('admin.facilityAssistedRegistration','admin','/api/v1/admin/facilities/:facilityId/assisted-registration',GP,false,
    {GET:['platform.facility.read'],POST:['platform.facility.manage']},
    'GET answers version 0 without a designation. POST needs step-up, a reason, Idempotency-Key and If-Match (0 creates).'),
  // hid-system A24 (ADR-059, #76): the search terms and the export reason go in the JSON body, out of
  // URLs and access logs. The deprecated GET forms (GET /principals and GET /principals/export) are not
  // registered, so the browser cannot put a name, an email address or a reason in a URL.
  r('admin.principalsSearch','admin','/api/v1/admin/principals/search',P,false,one('POST','platform.principal.read'),
    'Body { query, page, pageSize, status? }; answers as GET /principals did. CSRF; no step-up, reason, If-Match or Idempotency-Key.'),
  { ...r('admin.principalsExport','admin','/api/v1/admin/principals/export',P,false,one('POST','platform.principal.export'),
    'Body { reason, query?, status? }. CSV response; use a dedicated download transport. Requires step-up; at most 5,000 rows.'),
    responseKind: 'download' },
  r('admin.principalStatus','admin','/api/v1/admin/principals/:accountId/status',P,false,one('POST','platform.principal.manage')),
  r('admin.principalRoles','admin','/api/v1/admin/principals/:accountId/platform-roles',P,false,one('POST','platform.role.manage')),
  r('admin.principalRevokeSessions','admin','/api/v1/admin/principals/:accountId/sessions/revoke',P,false,one('POST','platform.session.revoke')),
  r('admin.identityReviews','admin','/api/v1/admin/identity/reviews',G,false,one('GET','platform.identity-review.read')),
  r('admin.audit','admin','/api/v1/admin/audit/events',G,false,one('GET','platform.audit.read')),
  r('admin.services','admin','/api/v1/admin/operations/services',G,false,one('GET','platform.operations.read')),
  r('admin.events','admin','/api/v1/admin/operations/events',G,false,one('GET','platform.operations.read')),
  r('admin.pricing','admin','/api/v1/admin/pricing',G,false,one('GET','platform.pricing.read')),
  r('admin.updateProduct','admin','/api/v1/admin/pricing/products/:productSlug',P,false,one('POST','platform.pricing.manage')),
  r('admin.updatePrice','admin','/api/v1/admin/pricing/products/:productSlug/prices/:context',P,false,one('POST','platform.pricing.manage')),
  r('admin.demoRequests','admin','/api/v1/admin/demo-requests',G,false,one('GET','platform.demo.read')),
  r('admin.demoStatus','admin','/api/v1/admin/demo-requests/:requestId/status',P,false,one('POST','platform.demo.manage')),
  r('admin.organizationApplications','admin','/api/v1/admin/organization-applications',G,false,one('GET','platform.identity-review.read')),
  // Support's review of facilities that signed themselves up (P4, owner decision "alert + daily review").
  proposed(r('admin.selfServiceFacilities','admin','/api/v1/admin/self-service-facilities',G,false,
    one('GET','platform.identity-review.read'),
    `${SELF_SIGN_UP_NOVU} Query state: unreviewed (default; oldest activation first), reviewed (reviewed or released) or all `
    + '(newest first). Answers { items }, at most 200, each with its version and releasedAt, releasedByAccountId and '
    + 'releaseReason; since P4b also reviewGrantsRole, reviewableRoles, grantedRole, verificationMethod, '
    + 'administratorLicenceBody, administratorLicenceNumber, administratorLicenceRecordedAt, memberCount, '
    + 'pendingInvitationCount, probationEndsAt, breakGlassLast7d and deliveryFailuresLastDay.')),
  proposed(r('admin.selfServiceFacilityReview','admin','/api/v1/admin/self-service-facilities/:applicationId/review',P,false,
    one('POST','platform.facility.manage','platform.facility.unlock'),
    `${SELF_SIGN_UP_NOVU} Since P4b it gives the facility full access and signs its administrator out once. Body { note `
    + "(8 to 500), grantedRole ('none', doctor, nurse, lab or pharmacist), verificationMethod (cac_registered_contact, "
    + 'officer_match, regulator_register, in_person or other), administratorLicence? { body, number } (required for a '
    + 'clinical role) } and If-Match with the version; no Idempotency-Key or step-up. Answers { applicationId, reviewedAt, '
    + 'version, grantedRole, sessionsRevoked }. 400 SELF_SERVICE_REVIEW_ROLE_INVALID, _LICENCE_REQUIRED, _LICENCE_INVALID; '
    + '404 SELF_SERVICE_FACILITY_NOT_FOUND; 409 VERSION_CONFLICT, SELF_SERVICE_FACILITY_ALREADY_REVIEWED, '
    + 'SELF_SERVICE_FACILITY_REVIEW_REQUIRES_ACTIVE (facility not active, or the administrator\'s account not active).')),
  // P4b: support changes a reviewed administrator's own clinical access, and ends a facility's first 30 days early.
  proposed(r('admin.selfServiceFacilityAdministratorRole','admin',
    '/api/v1/admin/self-service-facilities/:applicationId/administrator-role',P,false,
    one('POST','platform.facility.manage','platform.facility.unlock'),
    `${STAFF_P4B_NOVU} Body { grantedRole, verificationMethod, administratorLicence?, reason (8 to 500) } and If-Match; `
    + 'answers { applicationId, version, grantedRole, sessionsRevoked }. 409 SELF_SERVICE_ADMINISTRATOR_ROLE_UNCHANGED, '
    + 'SELF_SERVICE_FACILITY_REVIEW_REQUIRES_ACTIVE, VERSION_CONFLICT; the review\'s 400s.')),
  proposed(r('admin.selfServiceFacilityEndProbation','admin',
    '/api/v1/admin/self-service-facilities/:applicationId/end-probation',P,false,
    one('POST','platform.facility.manage','platform.facility.unlock'),
    `${STAFF_P4B_NOVU} Body { reason (8 to 500) } and If-Match; answers { applicationId, version, probationEndedAt }. 409 `
    + 'SELF_SERVICE_PROBATION_ALREADY_ENDED, VERSION_CONFLICT.')),
  // P4b: support's reads of a facility's staff and licences, and of an invitation by the reference its email quotes.
  proposed(r('admin.facilityStaff','admin','/api/v1/admin/facilities/:facilityId/staff',G,false,one('GET','platform.principal.read'),
    `${STAFF_P4B_NOVU} Audited, with or without success. 200 { facility { id, name, selfService { review, `
    + 'organizationType, productCode } | null }, members [...], invitations [...] }, each with full licence numbers, '
    + 'licenceKey, sameLicenceElsewhere, nameMismatch, attestedByName and attestedAt. 404 ADMIN_FACILITY_NOT_FOUND.')),
  // P4c: support's tools for orders between facilities: a facility's summary and listing, and finding and closing an order.
  proposed(r('admin.facilityOrderRouteSummary','admin','/api/v1/admin/facilities/:facilityId/order-route-summary',G,false,
    one('GET','platform.facility.read'),
    `${ORDER_ROUTES_P4C_NOVU} Also platform.admin.access; audited. 200 { facilityId, listed { value, byDefault, reason, setAt }, `
    + 'destination? { receivingTypes: (laboratory | pharmacy)[], review: pending | reviewed | released | governed | '
    + 'legacy } (since item 4, hid-system 0089: the types of its active, approved laboratory or pharmacy products, and its '
    + 'sign-up\'s review; the database\'s summary, which Identity passes through as it is, so any Identity sends it once '
    + '0089 is applied and none before), receivedAcceptedLifetime, receivedPatientsLifetime, '
    + 'counterparts [{ direction: sent | received, facilityId, facilityName, last30Days { <state>: count } }] }: no '
    + 'patient, no order content. 404 ADMIN_FACILITY_NOT_FOUND. With "We can\'t complete this order" (D18, hid-system '
    + '0091) the answer also carries notCompleted { last30Days, soonAfterAcceptance, afterSevenDays, '
    + 'laterReportedWrongPatient, byReason { <reason>: count } } (the orders it accepted and ended as not completed in '
    + 'the last 30 days: counts only; soonAfterAcceptance within 60 minutes of accepting with no accession, '
    + 'afterSevenDays 7 days or more after accepting, laterReportedWrongPatient later reported as accepted for the wrong '
    + 'person; byReason only the reasons that occur) and cannotComplete: true, both left out when they could not be read '
    + '(a schema without 0091); an earlier Identity sends neither.')),
  proposed(r('admin.facilityOrderDestination','admin','/api/v1/admin/facilities/:facilityId/order-destination',P,false,
    one('POST','platform.facility.manage','platform.facility.unlock'),
    `${ORDER_ROUTES_P4C_NOVU} Lists the facility for orders from other facilities, or stops listing it; accepted work is `
    + 'unaffected. Body { listed, reason (8 to 500) }; 200 { facilityId, listed, setAt }. 404 ADMIN_FACILITY_NOT_FOUND '
    + '(also a facility without a laboratory or pharmacy product), 409 ORDER_ROUTE_DESTINATION_UNCHANGED.')),
  { ...proposed(r('admin.orderRoutesFind','admin','/api/v1/admin/order-routes',G,false,one('GET','platform.principal.read'),
    `${ORDER_ROUTES_P4C_NOVU} Audited. Finds by reference only: query reference (8 hexadecimal characters). 200 { items [{ `
    + 'routeId, reference, kind, version, effectiveState, orderingFacilityId, orderingFacilityName, receivingFacilityId, '
    + 'receivingFacilityName, createdAt, acceptedAt, endedAt, endedKind, accessEndsAt?, closable? }] } (accessEndsAt and '
    + 'closable since item 4, hid-system 0089: when the receiving facility\'s access ends, null before acceptance, and '
    + 'whether admin.orderRouteClose would act at the time of the Find; an earlier Identity, or a schema before 0089, omits '
    + 'both), at most 5. 400 '
    + 'ORDER_ROUTE_LOOKUP_INVALID '
    + '(also without a reference); 400 HEALTH_ID_NOT_ACCEPTED_IN_URL for a healthId query, since hid-system #116, before '
    + 'the permission check and with no audit row (a Health ID in an address is kept by access logs and browser history): '
    + 'by Health ID, use admin.orderRoutesSearch. With the wrong-patient report (item 3, hid-system 0088) endedKind may '
    + 'be wrong_patient, and the answer also carries wrongPatientReports: true (as does admin.orderRoutesSearch\'s); an '
    + 'earlier Identity sends no such field. With the late correction (D17, hid-system 0090) each row also carries '
    + 'correction (not_accepted | open | correctable | reported | receiver_released | too_late; receiver_released once the '
    + 'receiving facility was released from Health ID, so it can no longer act), correctableUntil (the deadline for open, '
    + 'correctable and too_late, then already past; null for not_accepted, reported and receiver_released) and '
    + 'wrongPatient { reportedAt, '
    + 'late } | null, and the answer lateCorrection: true (as does admin.orderRoutesSearch\'s); an earlier Identity sends '
    + 'none of these. With "We can\'t complete this order" (D18, hid-system 0091) endedKind may be receiving_unable '
    + '(cancelled, closable false, correction correctable), and the answer also carries cannotComplete: true (as does '
    + 'admin.orderRoutesSearch\'s); an earlier Identity sends no such field.')),
  requiredQuery: { GET: ['reference'] }, forbiddenQuery: { GET: ['healthId'] } },
  proposed(r('admin.orderRoutesSearch','admin','/api/v1/admin/order-routes/search',P,false,one('POST','platform.principal.read'),
    `${ORDER_ROUTES_P4C_NOVU} P4c review: finds orders as admin.orderRoutesFind, with the same permissions, audit row `
    + '(admin.order-routes.find) and answer (at most 5 by reference, 20 by Health ID), from the body { reference } or { '
    + 'healthId } (exactly one), so a Health ID is in no address. 400 ORDER_ROUTE_LOOKUP_INVALID; an unknown field 400 '
    + 'VALIDATION_FAILED.')),
  proposed(r('admin.orderRouteClose','admin','/api/v1/admin/order-routes/:routeId/close',P,false,one('POST','platform.facility.manage'),
    `${ORDER_ROUTES_P4C_NOVU} Closes an order between facilities at once: access ends at both, and both and the patient are `
    + 'told. Body { reason (8 to 500) } and If-Match with the version; 200 { routeId, version, effectiveState }. 404 '
    + 'ORDER_ROUTE_NOT_FOUND, 409 VERSION_CONFLICT, ORDER_ROUTE_ALREADY_CLOSED, 428 IF_MATCH_REQUIRED.')),
  // Item 3 (D11): support's list of wrong-patient reports, and its review of one.
  { ...proposed(r('admin.wrongPatientReports','admin','/api/v1/admin/wrong-patient-reports',G,false,one('GET','platform.facility.read'),
    `${WRONG_PATIENT_NOVU} Also platform.admin.access; audited (admin.wrong-patient-reports.list). Query status (unreviewed: `
    + 'every report not reviewed, flagged first, then oldest; recent: the last 90 days, newest first; at most 200) and '
    + 'facilityId? (the receiving facility that reported). 200 { items [{ reportId, version, routeId, reference, kind, '
    + 'receivingFacility { id, name }, orderingFacility { id, name }, reportedAt, reportedBy { accountId, name }, acceptedBy, '
    + 'sameMember, acceptedWith, acceptedAt, reason, note (support only), noteRemoved, stateBefore, resultsVoided, '
    + 'resultReportsMarked, dispensingReversed, specimensCollected, recordedBy [{ accountId, name }], reporterRecordedWork, '
    + 'flags (something_came_back, reporter_recorded_work, suspected_misuse, other_reason_nothing_recorded), '
    + 'facilityReportsLast30Days, memberReportsLast30Days, review: null | { reviewedAt, reviewedBy, actions, note } }] }: no '
    + 'patient and no order content. 400 WRONG_PATIENT_REPORTS_QUERY_INVALID; 404 ADMIN_FACILITY_NOT_FOUND; 503 '
    + 'ORDER_ROUTES_ADMIN_UNAVAILABLE. With the late correction (D17, hid-system 0090) items also carry late, '
    + 'endedKindBefore, discoveredBy, discoveredOn, reporterLateReportsLast30Days, orderingSenderActive and requiredActions '
    + '(referred_to_dpo, ordering_facility_told, or none: what the review requires), stateBefore may be cancelled, flags '
    + 'may also hold late_correction, patient_prompted and patient_reported_before, and the answer carries '
    + 'lateCorrection: true; an earlier Identity sends none of these.')),
  requiredQuery: { GET: ['status'] } },
  proposed(r('admin.wrongPatientReportReview','admin','/api/v1/admin/wrong-patient-reports/:reportId/review',P,false,
    one('POST','platform.facility.manage'),
    `${WRONG_PATIENT_NOVU} Also platform.admin.access. Marks a report reviewed, once: If-Match with its version and body { `
    + 'actions (one or more of ordering_facility_told, facility_contacted, staff_access_changed, facility_suspended, '
    + 'referred_to_dpo, or exactly [no_further_action]), note (8 to 500), removeNote? (the reporter\'s note becomes '
    + '"Removed by Health ID support at review.") }; no Idempotency-Key. 200 { reportId, version, reviewedAt, actions, '
    + 'noteRemoved }. 400 WRONG_PATIENT_REVIEW_INVALID; 404 WRONG_PATIENT_REPORT_NOT_FOUND; 409 VERSION_CONFLICT, '
    + 'WRONG_PATIENT_REPORT_ALREADY_REVIEWED; 428 IF_MATCH_REQUIRED; 503 ORDER_ROUTES_ADMIN_UNAVAILABLE. With the late '
    + 'correction (D17, hid-system 0090, owner decision D17-6): 400 WRONG_PATIENT_REVIEW_REFERRAL_REQUIRED when a late '
    + 'report\'s requiredActions are not all among the actions (a late report where something had come back, or a '
    + '"pretending" one, needs referred_to_dpo; one where something had come back, unless the ordering facility was '
    + 'released, also ordering_facility_told), with the problem member required naming the missing ones, comma-separated, '
    + 'referred_to_dpo first.')),
  { ...proposed(r('admin.staffInvitationFind','admin','/api/v1/admin/staff-invitations',G,false,one('GET','platform.principal.read'),
    `${STAFF_P4B_NOVU} Query reference (8 hexadecimal characters, any case). 200 { items [{ invitationId, reference, `
    + 'facilityId, facilityName, organizationId, status, roleCode, createdAt, expiresAt }] }, at most 5.')),
  requiredQuery: { GET: ['reference'] } },
  // P4 round 2 (R2): support frees a fraudulent or mistaken sign-up's CAC number and legal name for the real company.
  proposed(r('admin.selfServiceFacilityRelease','admin','/api/v1/admin/self-service-facilities/:applicationId/release',P,false,
    one('POST','platform.facility.manage'),
    `${SELF_SIGN_UP_NOVU} Body { reason (8 to 500), allowRetry? (boolean, default false) } and If-Match with the version; `
    + 'no Idempotency-Key or step-up. Only once every facility of the organization is suspended and the administrator\'s '
    + 'account disabled (409 SELF_SERVICE_FACILITY_RELEASE_REQUIRES_SUSPENSION otherwise). Answers { applicationId, '
    + 'releasedAt, version }. 404 SELF_SERVICE_FACILITY_NOT_FOUND, 409 SELF_SERVICE_FACILITY_ALREADY_RELEASED, 409 '
    + 'VERSION_CONFLICT. Unless allowRetry, its email and network can\'t start a sign-up for the CAC number and product for '
    + '7 days. Since P4b it also withdraws the facility\'s pending invitations, ends the memberships of the staff it '
    + 'added, their patients\' consents and their sessions.')),
  // P4 round 2 (R3, ranked and counted by R16): self-service applications not activated yet.
  proposed(r('admin.selfServiceApplications','admin','/api/v1/admin/self-service-applications',G,false,
    one('GET','platform.identity-review.read'),
    `${SELF_SIGN_UP_NOVU} No query. Answers { total, items }: at most 200 items, those holding their CAC number now first, `
    + 'then verified ones, then the newest; total counts every open one. Each: applicationId, version, productCode, '
    + 'organizationType, cacHint, organizationName (null until verified), administratorName, administratorEmail, status, '
    + 'verificationResult, emailVerified, submittedAt, lapsesAt (submittedAt + 24 h, or submittedAt when opened without a '
    + 'hold) and holdsCac.')),
  // R16: the same list for one CAC number, which goes in the body, out of access logs, as principals/search.
  proposed(r('admin.selfServiceApplicationSearch','admin','/api/v1/admin/self-service-applications/search',P,false,
    one('POST','platform.identity-review.read'),
    `${SELF_SIGN_UP_NOVU} Body { cacRegistrationNumber } (spaces removed, upper case, RC, BN or IT and 4 to 20 digits; 400 `
    + 'VALIDATION_FAILED otherwise). Answers { total, items } as the list, for that CAC number only.')),
  // R15: support lifts the 7-day refusals a rejection or release set for a CAC number and product.
  proposed(r('admin.selfServiceApplicationWaiveRefusal','admin','/api/v1/admin/self-service-applications/waive-refusal',P,
    false,one('POST','platform.facility.manage'),
    `${SELF_SIGN_UP_NOVU} Body { cacRegistrationNumber, productCode, reason (8 to 500) }; no If-Match, Idempotency-Key or `
    + 'step-up. Answers { waived: [{ applicationId, waivedAt, version }] }, one per refusal lifted. 404 '
    + 'SELF_SERVICE_REFUSAL_NOT_FOUND when none is in force.')),
  proposed(r('admin.selfServiceApplicationReject','admin','/api/v1/admin/self-service-applications/:applicationId/reject',P,false,
    one('POST','platform.facility.manage'),
    `${SELF_SIGN_UP_NOVU} Body { reason (8 to 500), allowRetry? (boolean, default false) } and If-Match with the version; `
    + 'no Idempotency-Key or step-up. Answers { applicationId, rejectedAt, version }. 404 SELF_SERVICE_APPLICATION_NOT_FOUND, '
    + '409 VERSION_CONFLICT. Unless allowRetry, its email and network then can\'t start a sign-up for the CAC number and '
    + 'product for 7 days.')),
  r('admin.verifyCac','admin','/api/v1/admin/organization-applications/:applicationId/verify-cac',P,false,one('POST','platform.facility.manage')),
  r('admin.approveApplication','admin','/api/v1/admin/organization-applications/:applicationId/approve',P,false,one('POST','platform.facility.manage','platform.principal.manage','platform.role.manage')),
  r('admin.rejectApplication','admin','/api/v1/admin/organization-applications/:applicationId/reject',P,false,one('POST','platform.facility.manage')),
  r('admin.integrations','admin','/api/v1/admin/integrations',G,false,one('GET','platform.integration.read')),
  r('admin.integration','admin','/api/v1/admin/integrations/:provider',G,false,one('GET','platform.integration.read')),
  r('admin.integrationAudit','admin','/api/v1/admin/integrations/:provider/audit',G,false,one('GET','platform.integration.read')),
  r('admin.integrationEnable','admin','/api/v1/admin/integrations/:provider/enable',P,false,one('POST','platform.integration.manage')),
  r('admin.integrationPause','admin','/api/v1/admin/integrations/:provider/pause',P,false,one('POST','platform.integration.manage')),
  r('admin.integrationConfiguration','admin','/api/v1/admin/integrations/:provider/configuration',P,false,one('POST','platform.integration.manage')),
  r('admin.integrationSelection','admin','/api/v1/admin/integrations/capabilities/:capability/selection',P,false,one('POST','platform.integration.manage')),
  r('admin.integrationFallback','admin','/api/v1/admin/integrations/capabilities/:capability/fallback',P,false,one('POST','platform.integration.manage')),
  r('admin.integrationTest','admin','/api/v1/admin/integrations/:provider/test',P,false,one('POST','platform.integration.test')),
  // Phase 4 Stage 2A platform security (hid-system 7cbbf98, ADR-038).
  r('admin.mfaStatus','admin','/api/v1/admin/mfa',G,false,one('GET','platform.admin.access')),
  r('admin.mfaStepUp','admin','/api/v1/admin/mfa/step-up',P,false,one('POST','platform.admin.access'),
    'TOTP only; server-side assurance lasts 5 minutes.'),
  r('admin.mfaRecoveryCodes','admin','/api/v1/admin/mfa/recovery-codes/regenerate',P,false,one('POST','platform.admin.access'),
    'Requires step-up. Returns new recovery codes once.'),
  r('admin.sessions','admin','/api/v1/admin/sessions',G,false,one('GET','platform.admin.access')),
  r('admin.sessionRevoke','admin','/api/v1/admin/sessions/:sessionId/revoke',P,false,one('POST','platform.admin.access')),
  r('admin.principalSessions','admin','/api/v1/admin/principals/:accountId/sessions',G,false,one('GET','platform.session.revoke')),
  r('admin.principalSessionRevoke','admin','/api/v1/admin/principals/:accountId/sessions/:sessionId/revoke',P,false,
    one('POST','platform.session.revoke')),
  r('admin.approvals','admin','/api/v1/admin/approvals',G,false,undefined,
    'Requires one of platform.role.manage, platform.mfa.reset or platform.audit.read.'),
  r('admin.superAdminRequest','admin','/api/v1/admin/principals/:accountId/super-admin-requests',P,false,
    one('POST','platform.role.manage')),
  r('admin.mfaResetRequest','admin','/api/v1/admin/principals/:accountId/mfa-reset-requests',P,false,
    one('POST','platform.mfa.reset')),
  r('admin.approvalDecision','admin','/api/v1/admin/approvals/:requestId/:decision',P,false,one('POST','platform.admin.access'),
    'decision is approve, reject or cancel. The backend decides who may decide.'),
  // Clinician self sign-up review (hid-system ADR-066, branch claude/clinician-self-signup at fa58e2b, not
  // merged): the verification queue. Step 1 and step 2 are made by two different Super Admins, neither of
  // whom works at the facility; each command needs step-up, If-Match, an Idempotency-Key and a reason.
  r('admin.clinicianApplications','admin','/api/v1/admin/clinician-applications',G,false,one('GET','platform.workforce.manage'),
    'Query state (open by default: the three undecided states, oldest first), cursor and limit (1-50, default 20).'),
  r('admin.clinicianApplication','admin','/api/v1/admin/clinician-applications/:applicationId',G,false,
    one('GET','platform.workforce.manage')),
  r('admin.clinicianApplicationAttest','admin','/api/v1/admin/clinician-applications/:applicationId/attest',P,false,
    one('POST','platform.workforce.manage'),
    'Step 1: the checklist, evidence reference, validity, a live code from the applicant\'s authenticator and a reason.'),
  r('admin.clinicianApplicationApprove','admin','/api/v1/admin/clinician-applications/:applicationId/approve',P,false,
    one('POST','platform.workforce.manage'), 'Step 2, by a Super Admin other than step 1\'s: attaches and grants the role.'),
  r('admin.clinicianApplicationReject','admin','/api/v1/admin/clinician-applications/:applicationId/reject',P,false,
    one('POST','platform.workforce.manage'), 'A decision code the applicant sees and a reason they never see.'),

  r('platform.live','platform','/gateway-health/live',G,true),
  r('platform.ready','platform','/gateway-health/ready',G,true),
]

export const NON_FRONTEND_ENDPOINTS: readonly string[] = [
  '/api/v1/auth/service-session', '/api/v1/identity/service/*',
  '/api/v1/ehr/internal/ocr/*', '/api/v1/lab/work-items/accept-ehr-order',
  '/api/v1/lab/imports/from-ocr', '/api/v1/pharmacy/work-items/accept-ehr-prescription',
  '/api/v1/pharmacy/imports/from-ocr', '/api/v1/notifications/otp',
  '/api/v1/notifications/emergency-contact-alert', '/api/v1/notifications/staff-invitation',
  // This admin route exists but always returns INTEGRATION_CREDENTIAL_ROTATION_EXTERNAL.
  '/api/v1/admin/integrations/:provider/credential-reference',
]
const byName = new Map(HID_ENDPOINTS.map(descriptor => [descriptor.name, descriptor]))
export function findEndpoint(name: string): EndpointDescriptor | undefined { return byName.get(name) }
export function endpointsForService(service: HidService): EndpointDescriptor[] {
  return HID_ENDPOINTS.filter(descriptor => descriptor.service === service)
}
export const SERVICES_WITHOUT_CONTRACTS: readonly HidService[] = []
export function hasContracts(service: HidService): boolean {
  return HID_ENDPOINTS.some(descriptor => descriptor.service === service)
}
