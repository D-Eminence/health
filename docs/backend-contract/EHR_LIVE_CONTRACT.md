# HID Interface Contract: EHR sections (copy)

> Source: `docs/INTERFACE_CONTRACT.md` in the backend repository D-Eminence/hid-system, branch `staging-novu-ci-20261005`, commit `092cd248566aaedee897910ded783c7826c79b98` (19 Nov 2026).

This is a reviewed copy of the live contract sections the EHR screens use, for frontend developers who cannot open the backend repository. The backend repository is the source of truth; see [README.md](README.md).

- Only the sections below are copied: the ones named in the EHR message, plus section 53, which SX-5 cites, and the live sections that [EHR_PLANNED_CONTRACT.md](EHR_PLANNED_CONTRACT.md) cites for behaviour the EHR, laboratory and pharmacy screens call or show (sections 8, 9, 13, 21-24, 29, 43, 44, 46 and 54). They keep their original headings and their order in the source file.
- Section text is copied exactly. Where the source held backend detail that is not shared outside the backend team, the text reads "[backend detail omitted]".
- Some paragraphs and subsections are omitted whole and read only "[backend detail omitted]", so a "below" or "above" in the kept text can point at an omitted part. Ask the coordinator if you need to know what it says. Section 8 is also copied without the subsections that serve only the patient portal ("Patient enrollment activation signs the patient in", "Patient emails", "Patient sign-up without NIN") or only the Outreach site ("Outreach registration boundary"); those are left out without a marker, and so is one table row in section 54 (the identity provider's own back-channel logout route, which the browser never calls).
- Other sections of the source are not copied here, for example "Current browser and notification boundary" (patient portal and notifications; the planned contract cites its subsection "Patient sessions and self service" only for the line it quotes, "Staff and platform sessions keep 8 hours"), section 19 (the platform administration console), sections 40, 48 and 49 (the Outreach site) and section 52 (the sealed QA tenant). The planned contract also names a section 56 and a section 0136; neither is in the live contract at the source commit. Labels such as ID-2, ID-4, EHR-C7 or 0132 are Release A sections, which reach the live contract once signed. Labels such as EHR-C6, EHR-C8b, SX-6 or SX-7 are in [EHR_PLANNED_CONTRACT.md](EHR_PLANNED_CONTRACT.md). For anything not here, ask the coordinator.
- File paths such as `services/...` or `docs/codes/hid-lab-codes.json` are paths in the backend repository. The HID-LAB code list is copied in this folder as [codes/hid-lab-codes.json](codes/hid-lab-codes.json).

## Where each reference in the EHR message points

| Reference | Heading in this file |
| --- | --- |
| [FR-1, Q105] | [FR-1. No typed reason for a first signature or a first activation (wave 1, no migration)](#fr-1-no-typed-reason-for-a-first-signature-or-a-first-activation-wave-1-no-migration)<br>[Q105. No typed reason for a lab request's first activation, starting and finishing a visit, and draft edits (no migration)](#q105-no-typed-reason-for-a-lab-requests-first-activation-starting-and-finishing-a-visit-and-draft-edits-no-migration) |
| [ID-0] | [ID-0. NIN status on staff answers, and the NIN service breaker (Akos wave 1, no migration)](#id-0-nin-status-on-staff-answers-and-the-nin-service-breaker-akos-wave-1-no-migration) |
| [Q100 B] | [Q100 B. "No such patient" on the staff Health ID lookup (no migration)](#q100-b-no-such-patient-on-the-staff-health-id-lookup-no-migration) |
| [EHR-C1] | [EHR-C1. The open visit today, and starting a visit without a duplicate (wave 1, no migration)](#ehr-c1-the-open-visit-today-and-starting-a-visit-without-a-duplicate-wave-1-no-migration) |
| [EHR-C3] | [EHR-C3. Latest vitals for a patient (wave 1, no migration)](#ehr-c3-latest-vitals-for-a-patient-wave-1-no-migration) |
| [EHR-C8a] | [EHR-C8a. A completed visit entered in error (wave 1, no migration)](#ehr-c8a-a-completed-visit-entered-in-error-wave-1-no-migration) |
| [SX-10, SX-5, SX-9] | [SX-10. Registration-case list for the desk and approvers (Akos wave 1, no migration)](#sx-10-registration-case-list-for-the-desk-and-approvers-akos-wave-1-no-migration)<br>[SX-5. My staff profile, read only (no migration)](#sx-5-my-staff-profile-read-only-no-migration)<br>[SX-9. Saved lists: this facility's OCR jobs and staff names (no migration)](#sx-9-saved-lists-this-facilitys-ocr-jobs-and-staff-names-no-migration) |
| [ORD-3] | [ORD-3. Own pharmacy and laboratory progress on prescriptions and lab requests (wave 1, no migration)](#ord-3-own-pharmacy-and-laboratory-progress-on-prescriptions-and-lab-requests-wave-1-no-migration) |
| [ORD-10 phase 1] | [ORD-10 phase 1. Same-medicine warning when prescribing (wave 1, no migration)](#ord-10-phase-1-same-medicine-warning-when-prescribing-wave-1-no-migration) |
| [EHR-C4] | [EHR-C4: chart summary](#ehr-c4-chart-summary) |
| [EHR-C5] | [EHR-C5: one-call consultation](#ehr-c5-one-call-consultation) |
| [SX-1] | [SX-1: modules map per facility](#sx-1-modules-map-per-facility) |
| [Wave 0] | [Wave 0: answers for the EHR screens (R-1 to R-4, P2-5, P2-6)](#wave-0-answers-for-the-ehr-screens-r-1-to-r-4-p2-5-p2-6) |
| (cited by SX-5) section 53 | [53. Each staff product is its own site; the staff reset email (owner decision of 17 November 2026, Q88, Q89 and Q97)](#53-each-staff-product-is-its-own-site-the-staff-reset-email-owner-decision-of-17-november-2026-q88-q89-and-q97) |
| (cited by the planned contract) section 8 | [8. Identity Resolution](#8-identity-resolution) |
| (cited by the planned contract) section 9 | [9. Patient Identifier Contract](#9-patient-identifier-contract) |
| (cited by the planned contract as "section 9 near line 879") the `BN`/`IT` CAC prefixes | [QoreID self and organization verification](#qoreid-self-and-organization-verification), in section 8 (the planned contract's "section 9" here means this paragraph of section 8) |
| (cited by the planned contract) section 13 | [13. Pharmacy](#13-pharmacy) |
| (cited by the planned contract) sections 21-24 | [21. Orders between facilities: an order accepted for the wrong person](#21-orders-between-facilities-an-order-accepted-for-the-wrong-person)<br>[22. Orders between facilities: whether a facility receives, when support's Close acts, and what a facility is as a destination](#22-orders-between-facilities-whether-a-facility-receives-when-supports-close-acts-and-what-a-facility-is-as-a-destination)<br>[23. Orders between facilities: correcting an order accepted for the wrong person after it ended](#23-orders-between-facilities-correcting-an-order-accepted-for-the-wrong-person-after-it-ended)<br>[24. Orders between facilities: an order the laboratory or pharmacy accepted but can't complete](#24-orders-between-facilities-an-order-the-laboratory-or-pharmacy-accepted-but-cant-complete) |
| (cited by the planned contract) 0101 / section 29 | [29. Pharmacy dispensing checks its EHR prescription (0101)](#29-pharmacy-dispensing-checks-its-ehr-prescription-0101) |
| (cited by the planned contract) section 43 (43.1 to 43.5) | [43. Sign-up, setup wizard and registration desk fields (0114)](#43-sign-up-setup-wizard-and-registration-desk-fields-0114) |
| (cited by the planned contract) section 44 | [44. Allergies and the allergy check at prescribing (0117)](#44-allergies-and-the-allergy-check-at-prescribing-0117) |
| (cited by the planned contract) section 46 | [46. Prescription strength, form, duration, quantity and priority for the pharmacy (0125)](#46-prescription-strength-form-duration-quantity-and-priority-for-the-pharmacy-0125) |
| (cited by the planned contract) section 54 | [54. Single sign-on on the product sites, staff with a password only (0127, owner decision Q92 B)](#54-single-sign-on-on-the-product-sites-staff-with-a-password-only-0127-owner-decision-q92-b) |

## 8. Identity Resolution

HID lookup uses the existing versioned Identity resolution interface. Sensitive
NIN resolution uses the active body-based contract:

```text
POST /api/v1/identity/nin/resolve
```

Supported resolution inputs:

* HID
* NIN

For sensitive NIN lookup, prefer a body-based protected request when query-string exposure would create logging or browser-history risk.

### QoreID self and organization verification

This is distinct from governed NIN resolution above. The browser sends the
11-digit NIN (and, only for a profile without a date of birth, `dateOfBirth`);
the server adds required first/last name and DOB claims from the
authenticated patient's canonical profile to QoreID's request. HID never
returns the NIN or provider demographics. Extra browser body fields are rejected.

```text
POST /api/v1/identity/me/verification/nin
POST /api/v1/identity/organizations/verification/cac/hospital
POST /api/v1/identity/organizations/verification/cac/laboratory
POST /api/v1/identity/organizations/verification/cac/pharmacy
```

The first route requires an active patient session. The CAC routes require the
active facility plus `organization.manage` and accept exactly `{ "regNumber":
"RC1234" }` (or `BN`/`IT`). The server derives the existing organization from
the membership rather than accepting an organization ID. All routes return a
safe HID result state (`verified`, `not_verified`, `incomplete`) or static
Problem Details; raw QoreID payloads, NIN/CAC inputs, OAuth tokens, and
diagnostic text are excluded. [backend detail omitted]

### HID Resolution

Input:

* HID

Return only authorized patient identity information required by the caller.

### Registration Capabilities

`GET /api/v1/identity/registration-capabilities` requires authenticated workforce
access, `X-Facility-Id`, and `identity.registration.write`. Staging returns:

```json
{"nin":{"enabled":false,"state":"deferred"},"newPatientRegistrationRequiresNin":true}
```

With `NIN_PROVIDER_MODE=deferred`, NIN resolve returns HTTP 503 with code
`NIN_PROVIDER_DEFERRED` before identifier lookup or a provider call. [backend detail omitted] Existing case review and enrollment
retain their identity-evidence, authorization and audit requirements. [backend detail omitted]

### NIN Resolution

Flow:

1. validate format
2. verify through NIN provider abstraction when required
3. [backend detail omitted]
4. search deterministic demographic candidates when no binding exists
5. create or replay an idempotent registration case
6. [backend detail omitted]
7. return only the case state and an authorized canonical patient reference when already resolved

Do not unnecessarily return raw NIN.
[backend detail omitted]

### Registration Cases

```text
GET  /api/v1/identity/registration-cases/:caseId
POST /api/v1/identity/registration-cases/:caseId/approve-new
POST /api/v1/identity/registration-cases/:caseId/link-existing
POST /api/v1/identity/registration-cases/:caseId/enroll
```

`resolve`, `approve-new`, and `link-existing` require `Idempotency-Key`.
Review commands require `expectedVersion` and fail with a version conflict when
the case changed. Replaying the same key and canonical request returns the
existing terminal result; reusing a key with a different request returns a
conflict.

Case states currently include:

```text
pending_new_identity_approval
review_required
resolved_existing_identity
linked_existing
approved_new_identity
rejected
cancelled
```

`resolved_existing_identity` means the verified NIN was already bound and no
identity mutation occurred. `linked_existing` requires explicit review of a
stored candidate. `approved_new_identity` is the only transition that may issue
a new canonical UUID and HID.

Enrollment requires `identity.registration.approve`, the current facility,
`Idempotency-Key`, `expectedVersion`, reason, `healthcare-operations` purpose and
a normalized email address. Only a resolved, currently verified canonical NIN
binding can enroll an unmapped patient. The command creates a separate
`pending_reset` auth account and immutable enrollment evidence; it does not link
an existing account merely because an email matches. Governed NIN assurance is
preserved when the existing OTP flow verifies contact ownership and sets the
password. The case response supplies only bounded authorized review candidates.
Real NIN verification still requires a configured provider; deterministic mode
is test-only, is rejected in staging, and unavailable/deferred modes cannot issue
verified evidence.

## 9. Patient Identifier Contract

Conceptual identifier:

```text
id
patient_id
type
protected value
verified
registration_case_id for NIN
created_at
```

Rules:

* HID remains canonical application identifier.
* NIN is secondary.
* verified NIN is unique.
* NIN is never patient primary key.

## 13. Pharmacy

EHR communicates with Pharmacy through Pharmacy APIs.

Implemented operations:

```text
[backend detail omitted]
GET  /api/v1/pharmacy/work-items
GET  /api/v1/pharmacy/work-items/:workItemId
POST /api/v1/pharmacy/work-items/:workItemId/dispensings
GET  /api/v1/pharmacy/dispensings/:dispensingId
POST /api/v1/pharmacy/dispensings/:dispensingId/reversals
[backend detail omitted]
GET  /api/v1/pharmacy/imports?patientId=<uuid>[&limit=1-100][&cursor=<id>]
GET  /api/v1/pharmacy/imports/:importId
```

EHR's public handoff command requires the prescription ID, current expected row
version, reason, and `Idempotency-Key`. [backend detail omitted] Pharmacy reauthorizes the actor and
patient, enforces same-facility processing, and returns an `accepted` work item.
That result never means `dispensed`.

Dispensing is a separate Pharmacy command requiring an accepted work item,
expected work-item version, positive quantity/unit, reason, pharmacist
permission, non-break-glass write authorization, and idempotency. This slice
allows one full dispensing per work item; partial fills and refills are not
modeled. Reversal requires the exact dispensing version and appends a preserved
relationship rather than updating or deleting the original event.

[backend detail omitted]

`GET /api/v1/pharmacy/imports?patientId=` answers one patient's imported
medication records at the request's facility (single and batch alike), newest
first (`created_at`, then `id`), as `{ items, nextCursor }`: each item is the
same projection as `GET imports/:importId`, OCR provenance ids included
(`sourceDocumentId`, `ocrJobId`, `extractionId`, `validationId`,
`validationVersion`, `publicationId`). `limit` is 1-100 (default 50);
`nextCursor` is the last record's id when more may follow, else `null`, and is
passed back as `cursor` (a cursor that is not one of this patient's records
here answers an empty page). It has the guards of `GET imports/:importId`:
browser route, `pharmacy.import.read`, Identity `read_records` for that patient
at that facility under `X-Purpose-Of-Use` (break-glass may read), checked
before any read, so a refusal reads and audits nothing; [backend detail omitted]
Any other query parameter, `healthId` among them, is refused 400.

## 21. Orders between facilities: an order accepted for the wrong person

A laboratory or pharmacy that accepted an order from another facility can
report that the person it accepted it for was not the order's patient
(migration 0088; owner decisions of 2026-10-26, recorded in
`MAIN_TO_NOVU_PORT.md`). In one transaction its access ends, every result it
released on the order is marked entered in error, a dispensing it recorded is
reversed, support gets a report, and the patient gets an inbox notice
(`ORDER_ROUTE_WRONG_PATIENT`, metadata `{routeId, kind, orderingFacilityName,
receivingFacilityName}`; no email). The order cannot be received again: the
clinician writes a new one.

```text
POST /api/v1/lab/order-routes/:routeId/wrong-patient        # lab.order-route.receive
POST /api/v1/pharmacy/order-routes/:routeId/wrong-patient   # pharmacy.order-route.receive
```

Facility context, `X-Purpose-Of-Use: direct-care` and `Idempotency-Key` are
required. The body is `{ expectedVersion, reason, note }`: `reason` is one of
`wrong_order_chosen`, `someone_elses_details`, `suspected_misuse`, `other`;
`note` is 8-500 characters once trimmed and reaches Health ID support only
(never an audit row, a log line, the ordering facility or the patient). Any
member who may receive that kind of order may report; when something must be
withdrawn the member also needs `lab.result.entered-in-error` or
`pharmacy.dispensing.reverse`. It is allowed while the receiver may still work
on the order (30 days after acceptance, or 14 days after the first return, 45
at most) and not once anyone else ended it. `200` answers
`{ route: { id, version, effectiveState, endedKind: 'wrong_patient' },
resultsVoided, resultReportsMarked, dispensingReversed, replayed }`; the same
member, key and request answer the stored report with `replayed: true`.

| Status | Code | When |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | the body (an unknown reason, a note outside 8-500, an unknown field) |
| 400 | `ORDER_ROUTE_INVALID` | a note shorter than 8 once trimmed, or the command's own input check |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | no or malformed key |
| 403 | `PERMISSION_DENIED` | not a receiving member under direct care |
| 403 | `ORDER_ROUTE_CORRECTION_PERMISSION_REQUIRED` | something must be withdrawn; problem member `permission` names the missing one |
| 404 | `ORDER_ROUTE_NOT_FOUND` | not addressed to this facility, or another kind |
| 409 | `ORDER_ROUTE_NOT_ACCEPTED` | not accepted (decline it instead) |
| 409 | `ORDER_ROUTE_ALREADY_ENDED` | ended by anyone, or past the window; checked before the version |
| 409 | `IDEMPOTENCY_KEY_REUSED` | the key with another request, also when that request is on another route at the same moment |
| 409 | `ORDER_ROUTE_CHANGED_CONCURRENTLY` | a concurrent route write or a deadlock (this command only) |
| 412 | `VERSION_CONFLICT` | something was returned or changed since the version was read |
| 423 | `CROSS_FACILITY_ORDERS_UNAVAILABLE` | `cross_facility_route_access_enabled` off |
| 503 | `ORDER_ROUTE_UNAVAILABLE` | anything else |

The Lab and Pharmacy work lists' `orderRoute` card gains `version` (a number)
and `endedKind` (null while the route is live). After a report the work item
leaves the list for members without the patient's consent; any write on it
answers 409 `ORDER_ROUTE_CLOSED`, and a Lab release under consent is refused.

Support (Identity, [backend detail omitted]):

```text
GET  /api/v1/admin/wrong-patient-reports?status=unreviewed|recent&facilityId=   # platform.facility.read
POST /api/v1/admin/wrong-patient-reports/:reportId/review                       # platform.facility.manage, If-Match
```

The list answers `{ items }` (at most 200): `unreviewed` flagged first, then
oldest first; `recent` the last 90 days, newest first; `facilityId` the
reporting (receiving) facility, 404 `ADMIN_FACILITY_NOT_FOUND` when unknown.
Each item carries the report, both facilities, who reported and who accepted
(names, `sameMember`, `acceptedWith`), the reason and note, what was
withdrawn, who recorded the work, [backend detail omitted], and `review`. It
carries no patient and no order content. The admin Overview tile counts the
`unreviewed` list. The review takes `{ actions, note, removeNote? }`: one or
more of `ordering_facility_told`, `facility_contacted`,
`staff_access_changed`, `facility_suspended`, `referred_to_dpo`, or exactly
`["no_further_action"]`, and a note of 8-500; `removeNote` replaces the
reporter's note with "Removed by Health ID support at review." It answers
`{ reportId, version, reviewedAt, actions, noteRemoved }`; refusals are 400
`WRONG_PATIENT_REVIEW_INVALID`, 404 `WRONG_PATIENT_REPORT_NOT_FOUND`, 409
`WRONG_PATIENT_REPORT_ALREADY_REVIEWED` (once only, checked before the
version), 409 `VERSION_CONFLICT`, 428 `IF_MATCH_REQUIRED`. [backend detail omitted]

The ordering facility (EHR):

```text
GET /api/v1/ehr/order-routes/wrong-patient   # ehr.order-route.send, facility, direct-care only
```

The Overview card lists the orders sent from the session's facility that
ended this way in the last 30 days: `{ windowDays: 30, items, others: { count,
references } }`. A member sees an order in full (`routeId`, `reference`,
`kind`, `receivingFacility { id, name }`, `patient { name }`, `endedAt`,
`resultsWithdrawn`, `dispensingReversed`, `link { patientId, encounterId,
kind, orderId }`) only if they sent it, whether or not they may still open
the patient's record (at most 50, newest first); every colleague's such order
of the facility counts in `others` with its reference only (at most 100
references; the count is complete). A member's own order is never in
`others`. [backend detail omitted] The order's route views (`GET
…/order-routes`), the order lists' `orderRoute`, the patient's
`GET /api/v1/ehr/me/order-routes` and support's lookup answer `endedKind:
'wrong_patient'` unchanged in shape; the views list each withdrawn result as
an `entered_in_error` report, without a value, beside its `released` row.

This backend also says that it serves the report, so the website's guidance
can wait for it (D15: the website ships first and stays dormant). The EHR's
lab-request and prescription lists (`GET …/encounters/:encounterId/lab-requests`
and `…/prescriptions`) and support's lookup (`GET /api/v1/admin/order-routes`
and `POST /api/v1/admin/order-routes/search`) answer `wrongPatientReports:
true` beside their items; an earlier backend sends no such field. Only then
does the website ask the ordering clinician, in its change warning, and
support, in its Close form, to have the laboratory or pharmacy end an order it
accepted for the wrong person first. The Lab and Pharmacy work lists say the
same through `orderRoute.version`, which only this backend sends.

## 22. Orders between facilities: whether a facility receives, when support's Close acts, and what a facility is as a destination

Migration 0089 (item 4; owner decisions of 2026-10-26, recorded in
`MAIN_TO_NOVU_PORT.md`) adds three read-only facts to answers that already
exist. No route, status code or audit row is added. An earlier backend sends
none of the new fields, so a client reads each only when it is present and of
the right type.

The Lab and Pharmacy work lists and Incoming:

```text
GET  /api/v1/lab/work-items                GET  /api/v1/pharmacy/work-items
GET  /api/v1/lab/order-routes              GET  /api/v1/pharmacy/order-routes
POST /api/v1/lab/order-routes/search       POST /api/v1/pharmacy/order-routes/search
```

answer two more fields beside `items`, `crossFacilityOrders` and
`crossFacilityWork`:

- `receives` (boolean): whether clinicians at other facilities can send this
  facility lab requests (prescriptions) now. That is: an active, verified
  facility whose sign-up support reviewed or approved, with an active
  laboratory (pharmacy) product, listed for orders, with a member who may
  receive them. It reads no switch, so it stays true while orders between
  facilities are off.
- `routesHere` (`{ waiting: boolean, held: boolean }`): `waiting` says an
  order of that kind was sent to this facility and is not yet past its
  respond-by (what Incoming lists). It can be accepted only while `receives`
  is true and orders between facilities are on; it can be declined until its
  respond-by either way. `held` says one it accepted (accepted, completed, or
  cancelled with its reads kept) may still be read here. Both stay true at a
  facility that support unlisted, or whose product is suspended, so it still
  sees and can decline what was sent and is told when its accepted work is
  paused.

Both are about the session's own facility (the request names none), carry no
patient, count or reference, and are answered only to a member holding
`lab.order-route.receive` (`pharmacy.order-route.receive`). A member without
it, and an earlier backend, get neither field; a failure to read them leaves
them out and the list still answers. While
`cross_facility_route_access_enabled` is off, Incoming answers 423 as before,
without them; the work list still carries them.

```json
{ "items": [], "receives": true, "routesHere": { "waiting": true, "held": false },
  "crossFacilityOrders": true, "crossFacilityWork": true }
```

Support's lookup (`GET /api/v1/admin/order-routes?reference=` and
`POST /api/v1/admin/order-routes/search`, `platform.principal.read`): each
item gains `accessEndsAt` (ISO-8601, when the receiving facility's read
access ends; `null` before acceptance) and `closable` (whether
`POST /api/v1/admin/order-routes/:routeId/close` would act now, by the
database's clock). A live order that is not closable is a completed one
whose access has ended, or that someone ended. Clients trust `closable` as
answered and use no clock of their own. Close may still answer 409
`ORDER_ROUTE_ALREADY_CLOSED` when access ends between the lookup and the
close. An earlier backend, or a schema without 0089, sends neither field.

```json
{ "items": [{ "routeId": "…", "reference": "3F2A9C1B", "kind": "lab_request", "version": 4,
  "effectiveState": "completed", "…": "…", "acceptedAt": "2026-10-01T09:00:00.000Z", "endedAt": null,
  "endedKind": null, "accessEndsAt": "2026-10-19T11:12:00.000Z", "closable": false }],
  "wrongPatientReports": true }
```

Support's facility summary
(`GET /api/v1/admin/facilities/:facilityId/order-route-summary`,
`platform.facility.read`) gains `destination` after `listed`, which keeps its
four keys:

- `receivingTypes`: the sorted subset of `laboratory` and `pharmacy` of the
  facility's active products whose source application is approved. It is
  `[]` for a hospital, clinic or other facility, a suspended product and a
  released sign-up.
- `review`: `pending`, `reviewed` or `released` (the self sign-up's review),
  `governed` (approved by support without a self sign-up) or `legacy`.

No verification method is answered. Listing can change whether clinicians
find the facility only when `receivingTypes` is not empty and `review` is
`pending`, `reviewed` or `governed`; the console offers the listing form only
then. The summary is the database's own, which Identity passes through as it
is, so `destination` is answered as soon as 0089 is applied, by an earlier
Identity image too; a schema before 0089 answers without it.

```json
{ "facilityId": "…", "listed": { "value": true, "byDefault": true, "reason": null, "setAt": null },
  "destination": { "receivingTypes": ["laboratory"], "review": "governed" },
  "receivedAcceptedLifetime": 0, "receivedPatientsLifetime": 0, "counterparts": [] }
```

## 23. Orders between facilities: correcting an order accepted for the wrong person after it ended

A laboratory or pharmacy that finds out, after an order ended or its window
lapsed, that it accepted the order for someone who was not its patient can
still withdraw what it recorded on it, until 180 days after it accepted the
order (migration 0090, D17; owner decisions of 2026-10-26, recorded in
`MAIN_TO_NOVU_PORT.md`). In one transaction every result it recorded on the
order is marked entered in error (or its dispensing reversed) exactly as §21
does; an order whose time had only run out ends `wrong_patient` now, and an
order that had ended another way keeps that ending; support gets a report
flagged `late_correction`; the patient gets an inbox notice
(`ORDER_ROUTE_WRONG_PATIENT` when the order ended now,
`ORDER_ROUTE_WRONG_PATIENT_CORRECTED` when it had ended before; metadata
`{routeId, kind, orderingFacilityName, receivingFacilityName}`; no email).
The receiver's access to the patient's records is never reopened. What the
ordering facility recorded from the value (a note, a diagnosis, a
prescription) stays until it amends it.

```text
POST /api/v1/lab/order-routes/correctable                               # lab.order-route.receive
POST /api/v1/pharmacy/order-routes/correctable                          # pharmacy.order-route.receive
POST /api/v1/lab/order-routes/:routeId/wrong-patient-correction        # lab.order-route.receive
POST /api/v1/pharmacy/order-routes/:routeId/wrong-patient-correction   # pharmacy.order-route.receive
```

Facility context and `X-Purpose-Of-Use: direct-care` are required on all four.

**Find an order by its reference.** The body is `{ reference }` (a string of
1-16 characters; a POST, so the reference, which with a date of birth names an
order at acceptance, is in no request line). The service trims and
upper-cases it; it must then be 8 hex characters (400 `ORDER_ROUTE_INVALID`).
`200` answers at most 5 orders this facility accepted with that reference,
newest acceptance first, and `lateCorrection: true`:

```json
{ "items": [ { "id": "…", "reference": "3F2A9C1B", "kind": "lab_request", "version": 9,
    "effectiveState": "completed", "orderingFacilityName": "…", "acceptedAt": "…", "completedAt": "… | null",
    "endedAt": "… | null", "endedKind": "support | … | null", "returned": true,
    "correction": "open | correctable | reported | receiver_released | too_late", "correctableUntil": "…",
    "wrongPatient": { "reportedAt": "…", "late": true } | null,
    "details": { "what": "Full blood count", "acceptedBy": "…",
                 "acceptedWith": "health_id | date_of_birth_with_reference | date_of_birth",
                 "returned": [ { "at": "…", "withdrawn": false } ] } | null } ],
  "lateCorrection": true }
```

`correction` is `open` while item 3's report (§21) still applies (the
website then offers that form with this `id` and `version`), `correctable`
when only this correction applies, `reported` once the order has a report (in
or after its window), `receiver_released` once the receiving facility's
organization was released from Health ID (the order ended
`receiving_released`, or ended another way before the release; no member can
act on it any more, so in practice only support's lookup below ever shows it),
`too_late` from `correctableUntil` (180 days after acceptance; for `too_late`
already past). `details`, the facility's own facts
about the order (the test or medicine, who here accepted it and how identity
was checked, what went back and when, at most 20), is present only while the
order is `open` or `correctable`. No patient, orderer, work item or value is
ever answered. A reference no order accepted here carries answers `200
{ "items": [], "lateCorrection": true }`, never 404. [backend detail omitted]

| Status | Code | When |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | the body (no reference, not a string, longer than 16, an unknown field) |
| 400 | `ORDER_ROUTE_INVALID` | not 8 hex characters once trimmed and upper-cased |
| 403 | `PERMISSION_DENIED` | not a receiving member under direct care |
| 423 | `CROSS_FACILITY_ORDERS_UNAVAILABLE` | `cross_facility_route_access_enabled` off |
| 503 | `ORDER_ROUTE_UNAVAILABLE` | anything else |

Lab and Pharmacy never answer `ORDER_ROUTE_LOOKUP_INVALID` (the code of support's lookup).

**Correct it.** `Idempotency-Key` is required. The body, every field
required, unknown fields refused:

```json
{ "expectedVersion": 9,
  "reason": "wrong_order_chosen | someone_elses_details | suspected_misuse | other",
  "discoveredBy": "patient | ordering_facility | own_check | support | other",
  "discoveredOn": "2026-10-20",
  "note": "8 to 500 characters once trimmed, for Health ID support" }
```

`discoveredOn` is the day the facility found out: a calendar date, not after
today and not before the day it accepted the order (Africa/Lagos). The note
reaches support's list only (never an audit row, a log line, the ordering
facility or the patient). [backend detail omitted] Any member who may receive that kind of order
may correct; when something must be withdrawn the member also needs
`lab.result.entered-in-error` or `pharmacy.dispensing.reverse`. At most 5
late corrections per member and 20 per facility in any 24 hours, exact;
support cannot lift the limit. `200` answers:

```json
{ "route": { "id": "…", "version": 11, "effectiveState": "completed | cancelled", "endedKind": "wrong_patient | support | …" },
  "late": true, "endedKindBefore": "support | null", "resultsVoided": 1, "resultReportsMarked": 1,
  "dispensingReversed": false, "correctableUntil": "…", "replayed": false }
```

`endedKindBefore` is how the order had ended before the correction (null when
its time had only run out; it then ends `wrong_patient` now). The same member,
key and request answer the stored report with `replayed: true`. [backend detail omitted]

| Status | Code | When |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | the body: an unknown reason or `discoveredBy`, a date not in the form `YYYY-MM-DD`, a note outside 8-500 as sent, a missing or unknown field |
| 400 | `ORDER_ROUTE_INVALID` | a note under 8 once trimmed; `discoveredOn` not a calendar date, in the future, or before the order was accepted; the command's own input check |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | no or malformed key |
| 403 | `PERMISSION_DENIED` | not a receiving member under direct care; also an order whose receiving organization was released (the command's `ORDER_ROUTE_RECEIVER_RELEASED`, which such a member never reaches) |
| 403 | `ORDER_ROUTE_CORRECTION_PERMISSION_REQUIRED` | something must be withdrawn; problem member `permission` names the missing one |
| 404 | `ORDER_ROUTE_NOT_FOUND` | not addressed to this facility, or another kind |
| 409 | `ORDER_ROUTE_NOT_ACCEPTED` | never accepted here |
| 409 | `ORDER_ROUTE_STILL_OPEN` | still open: use §21's report |
| 409 | `ORDER_ROUTE_ALREADY_REPORTED` | reported already, in or after the window (also when a concurrent report won) |
| 409 | `ORDER_ROUTE_CORRECTION_TOO_LATE` | past `correctableUntil` |
| 409 | `IDEMPOTENCY_KEY_REUSED` | the key with another request, or a key first used for §21's report |
| 409 | `ORDER_ROUTE_CHANGED_CONCURRENTLY` | a concurrent release, reversal or order change, or a deadlock (this command only) |
| 412 | `VERSION_CONFLICT` | correctable, but the order's version moved since it was read; checked after the state |
| 423 | `CROSS_FACILITY_ORDERS_UNAVAILABLE` | `cross_facility_route_access_enabled` off |
| 429 | `ORDER_ROUTE_CORRECTION_LIMIT` | 5 by this member or 20 at this facility in the last 24 hours; problem member `retryAfter` (ISO-8601 UTC, milliseconds) is the earliest time another is possible |
| 503 | `ORDER_ROUTE_UNAVAILABLE` | anything else, [backend detail omitted] |

After a correction (in or after the window), nothing more can be written or
released on the order's work item, even under the patient's consent (409
`ORDER_ROUTE_CLOSED`; a Lab release is refused).

**What the other services answer (fields only; no new route).** Each new
field is sent only by a backend with 0090; a client reads it only when it is
present and of the right type.

- EHR: the order's route views (`GET …/order-routes`), the lab-request and
  prescription lists' and reads' `orderRoute`, and the patient's
  `GET /api/v1/ehr/me/order-routes` items gain `wrongPatient: { reportedAt,
  late } | null` (the receiver's report, in or after the window) and
  `correctableUntil: string | null` (set while the order is `open` or
  `correctable`; never once the receiving organization was released). The lab-request and prescription lists add
  `lateCorrection: true` beside `wrongPatientReports: true`. The Overview card
  (`GET /api/v1/ehr/order-routes/wrong-patient`) lists the reports of the last
  30 days whatever the order's ending; its items gain `reportedAt`, `late` and
  `endedKindBefore` (a late report on an order that had ended another way
  keeps that ending in `endedAt`), and the answer adds `lateCorrection: true`.
- Lab and Pharmacy: the work lists add `lateCorrection: true` for a member
  holding the kind's receive permission (nothing to anyone else).
- Identity, support's lookup (`GET /api/v1/admin/order-routes`, `POST
  /api/v1/admin/order-routes/search`): each item gains `correction`
  (`not_accepted | open | correctable | reported | receiver_released |
  too_late`), `correctableUntil` (null for `not_accepted`, `reported` and
  `receiver_released`; already past for `too_late`) and `wrongPatient: { reportedAt, late } | null`; the answer adds
  `lateCorrection: true`.
- Identity, support's reports list (`GET /api/v1/admin/wrong-patient-reports`):
  each item gains `late`, `endedKindBefore`, `discoveredBy`, `discoveredOn`
  (`YYYY-MM-DD`), [backend detail omitted]; the answer adds
  `lateCorrection: true`.
- Identity, the review (`POST /api/v1/admin/wrong-patient-reports/:reportId/review`):
  [backend detail omitted] Every other
  refusal is unchanged.

[backend detail omitted]

`lateCorrection: true` on any of these answers, a `correctableUntil` key on
any route, or any answer from the lookup tells the website that this backend
serves the correction (D17-11: the website ships first and stays dormant). An
earlier backend sends none of them, and its Lab and Pharmacy answer the two
new routes 404.

## 24. Orders between facilities: an order the laboratory or pharmacy accepted but can't complete

A laboratory or pharmacy that accepted an order from another facility and then
cannot do it (the test is not offered after all, something has run out or is
out of service, the sample can't be used, the patient chose not to go ahead or
left) ends it itself with one fixed reason (migration 0091, hid-system 0091 on
`staging-novu-ci-20261005`, D18; owner decisions of 2026-10-27, recorded in
`MAIN_TO_NOVU_PORT.md`). In one transaction the order ends (`cancelled`, ended
kind `receiving_unable`); the facility can record nothing more on it; it keeps
reading it for up to 7 days (never past the order's 30-day work window) only
if it had opened an accession on a lab request,
otherwise not at all from that moment (no one, support included, can shorten
the 7 days); the reason and what it had recorded are kept for the ordering
facility and support; [backend detail omitted] and the patient gets an inbox notice
`ORDER_ROUTE_NOT_COMPLETED` (metadata `{routeId, kind, orderingFacilityName,
receivingFacilityName}`; no reason; no email; nothing for a patient without an
active account). Nothing is withdrawn: on an accepted order nothing has gone
back to the ordering facility or the patient.

```text
POST /api/v1/lab/order-routes/:routeId/cannot-complete        # lab.order-route.receive
POST /api/v1/pharmacy/order-routes/:routeId/cannot-complete   # pharmacy.order-route.receive
```

Facility context, `X-Purpose-Of-Use: direct-care` and `Idempotency-Key` are
required. Any member who may receive that kind of order may use it (D18-10).
It applies only to an order this facility accepted, inside its 30-day work
window, not ended, not reported as accepted for the wrong person, with nothing
returned yet (D18-1); a lab request with a checked (verified, not invalidated)
result waiting to be released is refused until that result is released, or
corrected if it is wrong (a correction makes a new, unverified version; no Lab
route marks a single result entered in error) (D18-15). The body, unknown fields
refused, no free text (D18-6):

```json
{ "expectedVersion": 2, "reason": "supplies_unavailable", "confirmedPatient": true, "criticalValueTold": true }
```

- `reason`, by kind (D18-5; [backend detail omitted]):
  - Lab: `test_not_offered`, `supplies_unavailable`, `equipment_unavailable`,
    `sample_unusable`, `sample_not_obtained`, `cannot_meet_priority`,
    `patient_declined`, `patient_did_not_return`, `other`;
  - Pharmacy: `out_of_stock`, `medicine_unavailable`, `needs_prescriber_review`,
    `controlled_requirements`, `cannot_meet_priority`, `patient_declined`,
    `patient_did_not_return`, `other`.
- `confirmedPatient` must be `true`: the member states that the person it
  accepted the order for was the order's patient (for a prescription, or was
  collecting it for them). Someone who was not uses §21's report or §23's
  correction instead.
- `criticalValueTold` (Lab only; the Pharmacy refuses it as an unknown field):
  `true` states that the ordering facility was phoned about a possibly
  critical value recorded on the order (a current, not invalidated result
  version the laboratory flagged `critical_candidate`); required only when
  there is one; absent, `false` or `null` reads as not told.
- [backend detail omitted] The same member, facility, key and request
  answer `replayed: true` with the order as it is now and the first ending's
  reason and counts; a resubmission with `criticalValueTold: true` after
  `ORDER_ROUTE_CRITICAL_VALUE_NOT_TOLD` is a new request with a new key.

`200` answers:

```json
{ "route": { "id": "…", "version": 3, "effectiveState": "cancelled", "endedKind": "receiving_unable" },
  "reason": "supplies_unavailable", "readUntil": "2026-11-03T10:15:00.000Z",
  "specimensCollected": 1, "resultsRecorded": 1, "criticalCandidates": 1, "replayed": false }
```

`version` is a number. `readUntil` is when the facility's reading ends: 7 days
after the ending, or the end of the order's 30-day window if that comes first,
when it had opened an accession; else the ending's moment (always for a
prescription). The counts are what the laboratory had recorded
(specimens collected and still held, that is collected or received, never a
rejected one; results in any state; possibly critical current values; 0 for a
pharmacy). Never the patient, the ending's id or anything clinical.
[backend detail omitted]

| Status | Code | When |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | the body: a reason not of this service's list (the other kind's included), a version not an integer of at least 1, `confirmedPatient` not `true`, `criticalValueTold` not a boolean (Lab) or present at all (Pharmacy), an unknown field |
| 400 | `ORDER_ROUTE_INVALID` | the command's own input check (a key or digest that reached it malformed) |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | no or malformed key |
| 403 | `PERMISSION_DENIED` | not a receiving member under direct care; a released receiving organization |
| 404 | `ORDER_ROUTE_NOT_FOUND` | not addressed to this facility, or another kind |
| 409 | `ORDER_ROUTE_NOT_ACCEPTED` | never accepted (sent, declined, withdrawn, expired): decline it instead |
| 409 | `ORDER_ROUTE_ALREADY_ENDED` | ended any way (also a concurrent ending that won, or another key on an order this command ended), reported as accepted for the wrong person, or its work window lapsed |
| 409 | `ORDER_ROUTE_ALREADY_RETURNED` | completed: a result or the dispensing went back |
| 409 | `ORDER_ROUTE_RESULT_READY` | Lab: a checked result waits to be released (answered before a stale version, whatever `criticalValueTold` says) |
| 409 | `ORDER_ROUTE_CRITICAL_VALUE_NOT_TOLD` | Lab: a possibly critical value is recorded and `criticalValueTold` is not `true` (checked before the limits, so a member or facility at its limit is still asked about it) |
| 409 | `IDEMPOTENCY_KEY_REUSED` | the key with another request, another order or the other kind |
| 409 | `ORDER_ROUTE_CHANGED_CONCURRENTLY` | a serialization failure or deadlock (this command only) |
| 412 | `VERSION_CONFLICT` | still open, but the order's version moved since it was read; checked after the state |
| 423 | `CROSS_FACILITY_ORDERS_UNAVAILABLE` | `cross_facility_route_access_enabled` off |
| 429 | `ORDER_ROUTE_CANNOT_COMPLETE_LIMIT` | 20 endings by this staff member's account (at every facility it belongs to, not only this one) or 50 at this facility in the last 24 hours (D18-7, exact, never lifted); problem member `retryAfter` (ISO-8601 UTC, milliseconds, the later of the two when both are reached) is the earliest time another is possible. Past the limit the facility asks the ordering facility to cancel the order or Health ID support to close it, after phoning the ordering facility about any result recorded on it: either ending ends the facility's reading at once and shows the ordering facility no word of a result |
| 503 | `ORDER_ROUTE_UNAVAILABLE` | anything else, [backend detail omitted] |

After the ending nothing more can be written, verified, released or
dispensed on the order's work item, even under the patient's consent: a
dispensing answers 409 `ORDER_ROUTE_CLOSED`; a Lab write answers 409
`ORDER_ROUTE_CLOSED` under the patient's consent and 404 (the execution or
result is not found for writing) while only the order lets the laboratory read
it, as after §21's report. Results the laboratory recorded and never released
stay in its own records only. §21's report then answers
`ORDER_ROUTE_ALREADY_ENDED`; §23's lookup lists the order `correctable` and
§23's correction corrects it (also after the facility's reading ended), so an
ending of this kind never closes the way to a wrong-patient report. Support's
Close answers `ORDER_ROUTE_ALREADY_CLOSED`. The same order can never be sent
again (`ORDER_ROUTE_ORDER_IN_WORK`, D18-9); the clinician writes a new order.

**What the other services answer (fields only; no new route).** Each is sent
only by a backend with 0091; a client reads it only when it is present and of
the right type.

- Lab and Pharmacy: the work lists (`GET /api/v1/{lab,pharmacy}/work-items`)
  add `cannotComplete: true` (after `lateCorrection`) for a member holding the
  kind's receive permission, nothing to anyone else. A row ended this way
  shows `endedKind: 'receiving_unable'` with `access: 'read'` while the
  facility's reading lasts; after it only the patient's consent shows it.
- EHR: the order summary (`orderRoute` on the lab-request and prescription
  lists and reads, the order's route views) gains `notCompleted: { reason,
  sampleTaken, resultRecorded } | null`: an object only for an order ended
  `receiving_unable` that has no wrong-patient report (once one exists the
  earlier reason is not about the patient, and `wrongPatient` and
  `correctableUntil` follow §23); `sampleTaken` (a specimen was collected and not rejected) and
  `resultRecorded` (a result was recorded there and not released) are
  booleans for a lab request and `null` for a prescription. The patient's
  `GET /api/v1/ehr/me/order-routes` is unchanged (the order reads `cancelled`,
  `receiving_unable`, with §23's `correctableUntil`); the Overview is unchanged
  (D18-8: no card).
- Identity, support's facility summary
  (`GET /api/v1/admin/facilities/:facilityId/order-route-summary`): the answer
  adds, after its earlier keys, `notCompleted` and `cannotComplete: true`,
  [backend detail omitted] and both left out on
  any failure (D18-11; [backend detail omitted]). Counts only. There is
  no list across facilities.
- Identity, support's lookup (`GET /api/v1/admin/order-routes`,
  `POST /api/v1/admin/order-routes/search`): the answer adds
  `cannotComplete: true`; an order ended this way is found as any other
  (`cancelled`, `receiving_unable`, `closable: false`, §23's `correction`).
- Identity, support's reports list (`GET /api/v1/admin/wrong-patient-reports`):
  unchanged. A report made after such an ending is a late report (D18-12):
  `late: true`, `endedKindBefore: 'receiving_unable'`, [backend detail omitted]

`cannotComplete: true` on any of these answers tells the website that this
backend serves the ending (D18-13: the website ships first and stays
dormant). An earlier backend sends none of these fields, and its Lab and
Pharmacy answer the new route 404.

## 29. Pharmacy dispensing checks its EHR prescription (0101)

Migration 0101 ([backend detail omitted], the review of
0100 under the same owner decision of 2026-11-01, "Fix it now"; main 0080's
dispensing half; unsigned until the owner signs the declaration) makes the
database refuse to dispense a same-facility Pharmacy work item once its EHR
prescription is no longer what Pharmacy accepted. [backend detail omitted]

`POST .../pharmacy/work-items/:id/dispensings` answers that message 409
`PHARMACY_PRESCRIPTION_NOT_DISPENSABLE` ("This prescription can no longer be
dispensed here"), the code it already answers for a route-backed work item
whose prescription changed; the website already handles it (it marks the work
"Not dispensable"). [backend detail omitted]

Owner decision this carries (as on `main`): once its prescription has changed
or stopped, a same-facility work item can be neither dispensed nor accepted
again (one work item per prescription; a second acceptance is answered 409),
so the prescriber writes a new prescription. A prescription put on hold and
resumed is a new version, and its work item stays undispensable too. A
dispensing recorded while the prescription was active can still be reversed
after it is cancelled: [backend detail omitted]

[backend detail omitted]

## 43. Sign-up, setup wizard and registration desk fields (0114)

Migration 0114 ([backend detail omitted]), unsigned.

Owner decisions: "don't remove them instead we need to collect those information" and
"allow trading name, all fields required". Every field below is required **on the website**,
which must always send it. For the release step (43.0) the API accepts a sign-up or desk request
that carries **none** of the new fields, and refuses one that carries only **some** of them
(400 `VALIDATION_FAILED`, with `errors[].field`). A follow-up release makes them required in the
API too. These stay
**not collected** until the document bucket and its virus scanner exist: operating licence,
CAC certificate, proof of address, and the facility logo. Hide them; do not grey them out (D5).
Sending any of them (for example `logo`) is refused as an unknown field.

All existing request validation stays the same: `whitelist` and `forbidNonWhitelisted`, so an
unknown field gets 400 `VALIDATION_FAILED`.

### 43.0. Release order (important)

Today's backend refuses unknown fields (`forbidNonWhitelisted`), so the website cannot send
the new fields before this backend is live. This backend therefore accepts both bodies: the old
one (none of the new fields) and the new one (all of them). A partial set is refused. Release in
three steps:

1. This backend (0114 and Identity). The live website keeps working unchanged.
2. The website that always sends every new field (sign-up, setup wizard, every desk screen).
3. A small follow-up backend release that makes the fields required in the API.

Every screen that posts to `POST /api/v1/identity/nin/resolve` must send the desk fields in
section 43.3 before step 3, including the pharmacy `newHealthId.tsx`, the classic Registration
screen and hid-system `apps/web/src/lib/patientRegistrationApi.ts`.

### 43.1. Shared shape: `FacilityProfile`

This object is used by facility sign-up (`facilityProfile`) and by the setup wizard's save.

| Field | Type | Rule |
|---|---|---|
| `tradingName` | string | Trimmed, 2-200 characters. The name people use. The CAC legal name is kept as QoreID reads it (D1). |
| `ownership` | string | One of `public`, `private`, `faith_based`, `ngo` |
| `careLevel` | string | One of `primary`, `secondary`, `tertiary` |
| `addressLine` | string | Trimmed, 5-300 characters. The site address. It is not shown in the public directory, which keeps the CAC address (D2). |
| `city` | string | Trimmed, 2-100 characters |
| `stateCode` | string | One of the 37 codes in section 43.5 |
| `lga` | string | Trimmed, 2-100 characters. Free text until the official list is loaded (D6). |
| `gpsLatitude` | number | 4 to 14, at most 6 decimal places |
| `gpsLongitude` | number | 2.5 to 15, at most 6 decimal places |
| `phone` | string | E.164 (`+` and 8-15 digits). Spaces, dots, dashes and brackets are ignored. A Nigerian local number (`0` and 10 digits) is read as `+234…`. |
| `email` | string | A valid email, at most 254 characters. It is lower-cased and trimmed. |
| `bedCount` | integer | 0 to 100000 |
| `operatingHours` | string | Trimmed, 2-200 characters, for example `Mon-Sun 24 hours` |
| `emergency24h` | boolean | |
| `departments` | string[] | 1-15 codes, no repeats, from section 43.6. Informational only: it creates no departments (D7). |
| `servicesOffered` | string | Trimmed, 2-2000 characters |
| `smohLicenceNumber` | string | Trimmed, 2-100 characters. The State Ministry of Health licence number. |
| `hasRegistryId` | boolean | |
| `registryId` | string or null | 2-100 characters **exactly when** `hasRegistryId` is true. Must be `null` or left out when it is false. |
| `hasNhiaAccreditation` | boolean | |
| `nhiaAccreditationNumber` | string or null | 2-100 characters **exactly when** `hasNhiaAccreditation` is true. Must be `null` or left out when it is false. |
| `medicalDirectorName` | string | Trimmed, 2-200 characters |
| `medicalDirectorMdcn` | string | It is upper-cased with spaces collapsed, then must match `^[A-Z0-9][A-Z0-9/. -]{1,98}[A-Z0-9]$` (the staff-licence format). Example: `MDCN/12345`. |
| `expectedStaff` | integer | 1 to 100000 |
| `migratingRecords` | boolean | "Will you bring records from an older system?" |
| `needsInteroperability` | boolean | "Do you need to exchange records with other systems?" |

### 43.2. Facility sign-up: `POST /api/v1/identity/provider-enrollments` (start)

The existing body gains three fields, sent together (all or none, see 43.0):

```json
{
  "productCode": "ehr", "organizationType": "hospital", "cacRegistrationNumber": "RC1234567",
  "administratorName": "…", "administratorEmail": "…",
  "turnstileAction": "provider-enrollment", "turnstileToken": "…",

  "administratorRole": "owner",
  "administratorPhone": "+2348098765432",
  "facilityProfile": { …FacilityProfile… }
}
```

| Field | Rule |
|---|---|
| `administratorRole` | One of `owner`, `medical_director`, `administrator`, `other_authorised_representative` |
| `administratorPhone` | Same phone rule as `FacilityProfile.phone`. It is stored encrypted (personal data, D4) and is never returned. |
| `facilityProfile` | The object in section 43.1 |

The response is unchanged. The profile is stored with the emailed code that this request sends.
When the application is activated (self-service activation, or a platform administrator's
approval), the profile sent with the confirmed code is copied to the facility.

New refusal: **400 `FACILITY_PROFILE_INVALID`** ("Check the facility details and try again").
The database refused the profile; this should not happen when the DTO rules above are followed.
**503 `COLLECTED_FIELDS_UNAVAILABLE`** [backend detail omitted]. Nothing is
written or charged.

Suggested website mapping: "Role at facility" is `administratorRole` and "Your phone" is
`administratorPhone`. If the role is Medical Director, the website may prefill
`medicalDirectorName`.

### 43.3. Staff patient registration: `POST /api/v1/identity/nin/resolve`

The existing body (`nin`, `firstName`, `lastName`, `dateOfBirth`, `gender?`, `purpose`) gains
these fields, sent together (all or none, see 43.0; `existingHealthId` follows its own rule):

| Field | Type | Rule |
|---|---|---|
| `phone` | string | Same phone rule as in section 43.1 |
| `addressLine` | string | Trimmed, 5-300 characters |
| `city` | string | Trimmed, 2-100 characters |
| `stateCode` | string | One of the 37 codes in section 43.5 |
| `lga` | string | Trimmed, 2-100 characters |
| `hasExistingHealthId` | boolean | "Does the patient already have a Health ID?" (D13) |
| `existingHealthId` | string or null | **Exactly when** `hasExistingHealthId` is true: `HID-` and 6-32 of `A-H J-N P-Z 2-9`. Trimmed and upper-cased before the check, so `hid-abc234` is accepted. Must be `null` or left out when false. |

Not collected: allergies (D11, left to clinical records) and "provisional local identity" (D12, off).
Sending `allergies` is refused as an unknown field.

The phone and address are stored encrypted with the registration case. When the case resolves to
a patient (an existing NIN match, an approved new patient, or a linked existing patient), they
are copied as a **facility-held, unverified** contact at the same moment. They are never used
for sign-in or recovery and are never returned in plain text.

Deletion rule (NDPA): this data is never changed and never deleted, except by **erasure**: the
encrypted phone and address, their key version and the stated Health ID are set to null and the
erasure time and reason are recorded. Erasure happens for every facility's copy when the
patient's account deletion completes (0096), and on an NDPA erasure request, which Health ID
support has run [backend detail omitted]. The
same erasure removes the patient's Health ID from any other person's case that stated it (for
example by a typo); that person's own phone and address stay. A case that never became a
patient (rejected, cancelled or never reviewed) is erased by case on an NDPA erasure request
[backend detail omitted]

The Idempotency-Key is bound to all of these fields. A retry with a different phone, address or
stated Health ID under the same key is refused (409 `IDEMPOTENCY_KEY_REUSED`).

Stated Health ID (D13). It is a hint only. It never adds a review candidate, never shows
staff a patient they could not otherwise see, and never bypasses the name and date-of-birth
matching (a patient-lookup by Health ID needs the patient's consent; this route does not).
- If the patient it names is already a review candidate (by name and date of birth against the
  verified NIN details), that candidate gains the reason `stated_hid`. Nothing else changes.
- If the NIN matches a patient, the NIN match wins.
- Otherwise it is noted internally as `no_match`. Staff are never told whether the Health ID
  exists.
- link-existing refuses (409 `PATIENT_NOT_A_REVIEW_CANDIDATE`) a candidate whose only reason is
  `stated_hid`.

Response (`RegistrationCaseResult`) gains one field:

```json
{ "caseId": "…", "status": "…", "version": 1, "candidateCount": 1,
  "contactRecorded": true, "patient": { "patientId": "…", "hid": "HID-…" } }
```

`contactRecorded` is false when the request carried no desk fields (43.0) or the contact has
been erased.

The same `contactRecorded` field appears on `GET /api/v1/identity/registration-cases/:id`,
approve-new and link-existing. No phone or address is ever returned.

### 43.4. Setup wizard and facility profile (after activation)

Both routes need a staff session at the `X-Facility-ID` facility with `workforce.manage` (the
facility administrator), plus the usual CSRF header and `X-Purpose-Of-Use: healthcare-operations`.
Only **self-service** facilities can use them. Governed, legacy and sealed demo facilities are
refused.

### `GET /api/v1/identity/facility-profile`

200, with header `ETag: "<version>"`:

```json
{
  "facility": { "id": "uuid", "name": "Name as Health ID has it (CAC)", "reviewState": "pending|reviewed|…" },
  "version": 0,
  "profile": null
}
```

When the facility has a profile, `version` is at least 1 and `profile` is:

```json
{ …every FacilityProfile field…,
  "source": "self_service_signup" | "facility_administrator",
  "submitterRole": "owner" | "medical_director" | "administrator" | "other_authorised_representative" | null,
  "submitterPhoneOnRecord": true,
  "updatedAt": "2026-11-11T10:00:00.000Z",
  "version": 3 }
```

`registryId` and `nhiaAccreditationNumber` are `null` when the matching yes/no is false.
The applicant's phone is never returned; only `submitterPhoneOnRecord` says it was given.

### `POST /api/v1/identity/facility-profile` (save; POST because the API's CORS allows GET and POST only)

Headers:
- `If-Match: "<version>"`: the `version` from the GET. Use `"0"` for a facility with no profile
  yet. `W/"3"`, `"3"` and `3` are all accepted.
- `Idempotency-Key`: 16-128 URL-safe characters (`[A-Za-z0-9][A-Za-z0-9._:-]{15,127}`). Use a
  new key for each save the user makes.

Body: a `FacilityProfile` (section 43.1), with every field required.

200, with header `ETag: "<new version>"`:

```json
{ "facilityId": "uuid", "version": 4, "changedFields": ["phone", "tradingName"], "replayed": false }
```

`changedFields` lists API field names (sorted by their database column names), never values.
A save with no changes answers the same version and `changedFields: []`. Replaying the same key
with the same body answers the first answer with `replayed: true`.

Refusals:

| Status | code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | A field is missing or invalid (DTO) |
| 400 | `FACILITY_PROFILE_INVALID` | The database refused the profile |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | The Idempotency-Key header is missing or malformed |
| 428 | `IF_MATCH_REQUIRED` | If-Match is missing or not a whole number of 0 or more |
| 412 | `VERSION_CONFLICT` | Someone saved first. Reload, then save again. |
| 409 | `IDEMPOTENCY_KEY_REUSED` | The same key was used with a different body |
| 409 | `FACILITY_PROFILE_SEALED` | A sealed demo facility (D9) |
| 403 | `STAFF_MANAGEMENT_NOT_AVAILABLE` | Not a self-service facility. Health ID support keeps its details. |
| 403 | `PERMISSION_DENIED` | Not the facility administrator |
| 503 | `FACILITY_PROFILE_UNAVAILABLE` | Anything else |

The GET uses the same 403 and 503 codes.

The setup wizard and the review step should load from GET, show the real values, and save with
POST. `FacilityProfile.tsx` can show the GET answer.

### 43.5. State codes (ISO 3166-2:NG), as [backend detail omitted] holds them

AB Abia, AD Adamawa, AK Akwa Ibom, AN Anambra, BA Bauchi, BY Bayelsa, BE Benue, BO Borno,
CR Cross River, DE Delta, EB Ebonyi, ED Edo, EK Ekiti, EN Enugu, FC Federal Capital Territory,
GO Gombe, IM Imo, JI Jigawa, KD Kaduna, KN Kano, KT Katsina, KE Kebbi, KO Kogi, KW Kwara,
LA Lagos, NA Nasarawa, NI Niger, OG Ogun, ON Ondo, OS Osun, OY Oyo, PL Plateau, RI Rivers,
SO Sokoto, TA Taraba, YO Yobe, ZA Zamfara.

The website's facility list says "FCT". Show "Federal Capital Territory (FCT)" and send `FC`.

### 43.6. Department codes

`general_outpatient`, `emergency`, `inpatient`, `laboratory`, `pharmacy`, `maternity`,
`pediatrics`, `radiology`, `dental`, `physiotherapy`, `dialysis`, `oncology`, `cardiology`,
`icu`, `theatre`.

### 43.7. Not in this backend change

- The admin console's application list does not show the new fields yet. The admin dashboard
  belongs to other agents; ask the coordinator.
- The current-staff-context `facility` object does not include the profile. Use
  `GET /identity/facility-profile`.
- The QoreID state, LGA, city and company email are not captured for pre-fill yet (plan A.5).

## 44. Allergies and the allergy check at prescribing (0117)

Two sources, always kept apart and labelled on screens:

- **Recorded** ([backend detail omitted], 0117): what a clinician recorded at a facility.
- **Reported by the patient** ([backend detail omitted], 0094): free text the patient typed.

All routes are direct care only (`X-Purpose-Of-Use: direct-care`), [backend detail omitted]

| Route | Permission | Answer |
| --- | --- | --- |
| `GET ehr/patients/:patientId/allergies[?includeEnteredInError=true]` | `ehr.note.read` | `{ recorded: RecordedAllergy[], patientReported: { allergies: string \| null, updatedAt } }` |
| `POST ehr/patients/:patientId/allergies` (`Idempotency-Key`) | `ehr.note.write` | 201 `RecordedAllergy` |
| `POST ehr/patients/:patientId/allergies/:allergyId/entered-in-error` | `ehr.note.write` | 200 `RecordedAllergy` |
| `POST ehr/patients/:patientId/allergy-check` | `ehr.prescription.write` | `{ matches: AllergyMatch[], acknowledgementRequired, warningToken }` |

`RecordedAllergy`: `id, patientId, facilityId, createdBy, createdByMembershipId, substance, reaction, severity
(mild | moderate | severe | unknown), status (active | entered_in_error), enteredInErrorBy, enteredInErrorAt,
enteredInErrorReason, rowVersion, createdAt, updatedAt, recordedHere`. Recorded allergies follow the patient: a
clinician with read access at any facility sees those recorded at every facility; only the recording facility
(`recordedHere: true`) may mark one entered in error (else 409 `ALLERGY_RECORDED_ELSEWHERE`, [backend detail omitted]).

Create body: `{ substance (1-200, one line), reaction? (1-500, one line), severity }`. "NKDA", "No known allergies",
"none" and the like are refused with 400 `ALLERGY_NOT_A_SUBSTANCE` (they are not an allergy). The list answers active
allergies first, the most serious first (severe, not known, moderate, mild), then newest first.
Entered in error body: `{ expectedRowVersion, reason (3-500) }`; 412 `VERSION_CONFLICT`, 409
`ALLERGY_ALREADY_ENTERED_IN_ERROR`. Nothing is ever deleted.

**The check.** `AllergyMatch`: `source (recorded | patient_reported), allergyId? (recorded only; the first when
grouped), allergyIds? (recorded only: every recorded allergy the line stands for), substance, reaction, severity,
matchKind (same_medicine | same_class | cross_reactivity), className?, recordedHere? and recordedOn? (recorded only:
whether it was recorded at the current facility, and when), message`. The message is plain English: the allergy with
its severity and reaction ("Penicillin allergy: SEVERE (Anaphylaxis)." or "Patient-reported allergy: “…”."), why
it matched, then where it came from ("Recorded by a clinician at this facility on 3 Mar 2026.", "… at another
facility …", or "Entered by the patient in their Health ID portal, not checked by a clinician."). The same substance,
severity and reaction recorded more than once is one line with every id in `allergyIds` ("recorded at 2
facilities"). The medicine's display text and code are compared with each allergy (the patient's text is split into
terms on commas, semicolons, slashes, new lines and "and"; "none", "nil", "NKDA" and the like are ignored; a hyphen
separates words, so "Amoxicillin-clavulanate" names amoxicillin; "sulph" is read as "sulf"; brand and other names are
read as their generics, both ways, e.g. Flagyl as metronidazole, Augmentin as amoxicillin with clavulanic acid, Keflex
as cefalexin, Tramal as tramadol, Ciprotab as ciprofloxacin, Panadol as paracetamol and co-codamol as codeine with
paracetamol, and acetaminophen and paracetamol (or cefalexin and cephalexin) as one medicine; one-letter
misspellings and plurals of names of 8 letters or more match; salts, forms and strengths such as "sodium",
"sulfate", "capsules" or "500mg" do not name a medicine on their own): the same medicine; the same class
(`className`: "penicillins", "cephalosporins", "carbapenems", "sulfonamides (“sulfa” medicines)", "NSAIDs, the
anti-inflammatory painkillers", "fluoroquinolones" (also named "quinolones"; any "-floxacin") or "macrolides" (any
"-thromycin"); by class words, members, prefixes and name patterns; quinine, chloroquine and the other quinolines are
not quinolones); and cross-reactivity between penicillins, cephalosporins and carbapenems, both ways, and between
ceftazidime and aztreonam (`className` is then the medicine's name). No match never means "safe".

`warningToken` names exactly the warning shown: the sha256 (hex) of the medicine (its normalized display text and
code) and every matched allergy with how it matched. The prescriber's acknowledgement must carry it.

**At prescribing, at the send and at the hand-off.** The check runs, [backend detail omitted] whenever a prescription is written as or becomes active, and again before it goes to a pharmacy, because an
allergy may have been recorded since it became active:

- `POST ehr/patients/:patientId/encounters/:encounterId/prescriptions` (create);
- `PATCH …/prescriptions/:id` with `status: active` from draft (Activate) or on hold (Resume);
- `POST …/prescriptions/:id/order-routes` (send to another facility) of a draft, which the send makes active, or of
  an active prescription: [backend detail omitted] (0098: draft and active). A prescription in any
  other status is not checked, so the send's own 409 `ORDER_ROUTE_ORDER_NOT_ELIGIBLE` (or its 404) answers;
- `POST …/prescriptions/:id/pharmacy-work-item` (the hand-off to this facility's pharmacy, permission
  `pharmacy.work-item.accept`), after its own checks, which answer first: 412 `PRESCRIPTION_VERSION_CONFLICT`, 409
  `PRESCRIPTION_NOT_ELIGIBLE` (not active) and 409 `PRESCRIPTION_ROUTED`. Its 409 answers before pharmacy-api is
  called, so nothing is written in the EHR or in Pharmacy.

[backend detail omitted] when the facility may write but not
read the patient's records (a deny directive of the patient's naming only `read_records`) it refuses with 403
`CONSENT_REQUIRED`, as a missing consent is refused everywhere else, before it reads or writes anything (the send asks
before it reads the prescription), so a prescription is never written, activated, resumed, sent or handed on unchecked.

On Activate, Resume, send and hand-off, a match already covered by an acknowledgement stored for the prescription (at
any stage: its recorded allergy ids, and each of the patient's own terms) needs no new one. Otherwise, with a match and
no accepted `allergyAcknowledgement`, nothing is written and the answer is 409 `ALLERGY_ACKNOWLEDGEMENT_REQUIRED` with,
in `errors[]`:

- one entry per match: `{ field: "allergyAcknowledgement", messages: [the match's message] }`;
- one entry `{ field: "allergyAcknowledgement.warningToken", messages: [the current warning's token] }`;
- one entry per part of the acknowledgement that failed: `{ field: "allergyAcknowledgement.rejected", code,
  messages: [a plain-English sentence] }`. A reason and a token can both fail (two entries).

| `code` | When | What the client does |
| --- | --- | --- |
| `ALLERGY_ACKNOWLEDGEMENT_MISSING` | no `allergyAcknowledgement` was sent (the first warning) | show the warning, ask for a reason |
| `ALLERGY_ACKNOWLEDGEMENT_REASON_MISSING` | `reason` absent, or only spaces | ask for a reason; the token was fine unless a token entry is also present |
| `ALLERGY_ACKNOWLEDGEMENT_REASON_INVALID` | `reason` under 10 or over 500 characters after trimming, no word of three letters, or a control character other than a new line | keep the warning, ask to fix the reason |
| `ALLERGY_WARNING_TOKEN_INVALID` | `warningToken` absent or not 64 lower-case hex | run the check again (or use the token in this 409) |
| `ALLERGY_WARNING_TOKEN_STALE` | a well-formed token of another warning (an allergy recorded meanwhile, another medicine, or the patient's text changed) | show the new warning, clear the tick, send the token from this 409 |

The `detail` is "The allergy warning changed since it was shown. Check the allergies again and give a reason to go
ahead." when the token is stale; "The reason to go ahead after the allergy warning was not accepted. …" for a reason
or token problem otherwise; and "This medicine may match an allergy on the patient's record. …" when none was sent. A
client reads `errors[].code` on the `allergyAcknowledgement.rejected` entries, not the detail. The create, PATCH,
send and hand-off bodies take `allergyAcknowledgement: { reason, warningToken }`, an object; the request validation
only refuses (400) a non-object, a non-string or null `reason` or `warningToken`, a `reason` over 2000 or a
`warningToken` over 200 characters, or another property. The reason's rules (10-500 after trimming, at least one word
of three letters, no control character but new lines) and the token are checked by the allergy check, so their
refusals are the 409 above with the current warning, never a 400. A valid acknowledgement writes the prescription (or
the change, or the route, or lets the hand-off go on) and one [backend detail omitted] row with
its stage (`create | activate | resume | send | handoff`), the reason, the matched recorded allergy ids and the
patient's own terms that matched. [backend detail omitted] The hand-off stores its row in the
EHR transaction that ends before pharmacy-api is called, as it does its audit row, so a refusal by Pharmacy after
that keeps the row, and a retry finds the match covered. A send's replay (the same key and body) is checked like the
first send: it answers the stored route unless an allergy recorded since matches and no stored reason covers it, and
then the 409; a reason given on a replay is not stored, since the route was already sent. An acknowledgement sent
when nothing needs one is ignored, whatever it holds. A client must only send `allergyAcknowledgement` after a
warning: an ehr-api without 0117 refuses the unknown property (on the hand-off body, so does an ehr-api from before
the hand-off check).

**The stored acknowledgements on the prescription reads.** `GET …/encounters/:encounterId/prescriptions/:id` and each
item of `GET …/encounters/:encounterId/prescriptions` carry `allergyAcknowledgements:
PrescriptionAllergyAcknowledgement[]` (oldest first; `[]` when none), so a second clinician activating, resuming,
sending or handing it off sees the earlier reason. `PrescriptionAllergyAcknowledgement`: `id, stage (create |
activate | resume | send | handoff), reason, createdBy (account id), createdByMembershipId, createdAt,
matchedRecordedAllergyIds (uuid[]: the recorded allergies it covered; `GET …/allergies?includeEnteredInError=true`
names them), patientReportedMatched, patientReportedTerms (string[]: the patient's own terms it covered,
normalized)`. Same permission (`ehr.prescription.read`), authorization and RLS as before (acknowledgements are read
at their own facility with read access); [backend detail omitted]

**Severity in the messages.** `severe` reads "SEVERE", `moderate` "moderate", `mild` "mild" and `unknown` "severity
not known" (the clinician's choice "Not known" in the form): "Latex allergy: severity not known."

**In the emergency read (0117).** `GET /api/v1/ehr/patients/:patientId/emergency-records` (purpose `emergency`, a
current break-glass grant, as before) also answers `allergies`, read-only and labelled by source:

```text
allergies: {
  recorded: [{ source: "recorded", id, substance, reaction | null, severity (mild | moderate | severe | unknown),
               recordedHere, recordedOn }],          // active only, every facility, most serious first, at most 200
  patientReported: { source: "patient_reported", allergies: string | null, updatedAt | null }
}
```

`recordedHere` is whether it was recorded at the current facility; `recordedOn` when. No route changes an allergy
under the emergency purpose. [backend detail omitted]

[backend detail omitted]

## 53. Each staff product is its own site; the staff reset email (owner decision of 17 November 2026, Q88, Q89 and Q97)

identity-api (with one new notification-api route) and, for the
administrator rule decided by the owner as Q90 and Q91, migration 0126
[backend detail omitted]. The gate reads the permissions
the seeds already grant and, for an administrator, the recorded kinds of its
organisation and the products it holds; the session carries its product in the signed access token.

### The product of a request

The product is the request's `Origin` host, matched exactly (https, no port,
no path) against the hosts `turnstile.service.ts` names:

| Product | Production host | Staging host |
| --- | --- | --- |
| `ehr` | `ehr.healthidentitydirectory.com` | `ehr.staging.healthidentitydirectory.com` |
| `lab` | `lab.healthidentitydirectory.com` | `lab.staging.healthidentitydirectory.com` |
| `pharmacy` | `pharmacy.healthidentitydirectory.com` | `pharmacy.staging.healthidentitydirectory.com` |
| `migrate` | `migrate.healthidentitydirectory.com` | `migrate.staging.healthidentitydirectory.com` |
| `outreach` | `outreach.healthidentitydirectory.com` | `outreach.staging.healthidentitydirectory.com` |

Every other host (`app.`, `www.`, the apex, `admin.`, and every local or
development host) has no product and keeps the behaviour before Q88: all the
account's memberships, and platform administrators sign in as before.

### Which memberships a product site keeps (Q88-1)

`POST /api/v1/auth/login` (and a staff Google sign-in), `POST
/api/v1/auth/refresh` and `POST /api/v1/auth/facility` keep only the facility
memberships whose permissions fit the product of the site:

| Site | A membership fits when it holds any of |
| --- | --- |
| `ehr.` | `ehr.encounter.write`, `organization.manage` (hospital roles) |
| `lab.` | `lab.work-item.read`, `lab.work-item.accept` (lab roles), or `organization.manage` (an administrator) |
| `pharmacy.` | `pharmacy.work-item.read`, `pharmacy.dispensing.read` (pharmacy roles), or `organization.manage` |
| `migrate.` | `ehr.encounter.write`, `organization.manage` only (lab staff are not admitted, although they hold `ocr.job.*`) |
| `outreach.` | `outreach.registration.read`, `outreach.campaign.read` (outreach roles), or `organization.manage` |

Each staff site is for its own job (owner decision Q97, "Q97 A", 17 November
2026): a membership that holds `ehr.encounter.write` without
`organization.manage` (doctor, clinician, nurse and receptionist) fits `ehr.`
and `migrate.` only, although the seeds also grant those roles the lab,
pharmacy and outreach reading codes for their own hospital work (0018, 0023,
0024, 0038). A hospital administrator (`admin`, `org_admin`, which hold
`organization.manage`, and the review-pending administrator below) keeps every
site of its own organisation. Lab staff, pharmacists, outreach organisers and
volunteers, and the account-only outreach session are unchanged. A doctor who
also helps an outreach group signs in on `outreach.` with the group only. A
membership that also holds a site's own job keeps that site: one that holds
`lab.result.enter`, `lab.specimen.receive` or `lab.order-route.receive` (the
lab role's codes, never seeded to the hospital clinical roles) is admitted on
`lab.`, and one that holds `pharmacy.dispensing.create`,
`pharmacy.work-item.accept` or `pharmacy.order-route.receive` (the
pharmacist's) on `pharmacy.`; for example a nurse also given the lab role at a
small clinic.

Owner decision 5 (11 November 2026, the same login can also run its own
outreach group) still holds for these roles. "Start an outreach group"
(`GET .../outreach-organisers/for-my-account/availability` and `POST
/api/v1/identity/outreach-organisers/for-my-account`) checks no product: any
staff session on any site may use it, so the website runs the form on `ehr.`
for a login whose `actor.products` does not list `outreach`, instead of
linking to `outreach.`, which would refuse it. The new group's organiser
membership fits `outreach.`; the login then signs in there with the group
only, and `actor.products` lists `outreach` from the next session read.

In identity-api the Q97 rule is `facilityAdmittedOnProduct` (product-gate.ts):
the permission rule `facilityFitsProduct`, then the hospital clinical rule.
Every caller (sign-in, refresh, each request, `POST /auth/facility` and
`actor.products`) uses `facilityAdmittedOnProduct`, never
`facilityFitsProduct` alone; `product-gate-own-job.spec.ts` pins this.

An administrator's membership (`organization.manage`, or the administrator
awaiting review below) is the one exception: it counts as a hospital role only
at a hospital organisation, and otherwise fits only the sites of its
organisation's recorded kinds (owner decisions Q90 and Q91, below).

From the seeds: `ehr.encounter.write` is held by doctor, clinician, nurse and
receptionist (0006); `organization.manage` by admin and org_admin (0006);
`lab.work-item.read` by lab, doctor, clinician, nurse and admin (0018);
`pharmacy.work-item.read` and `pharmacy.dispensing.read` by pharmacist, doctor,
clinician, nurse and admin (0023); the outreach reads by outreach_organiser and
outreach_volunteer (0115) and the hospital roles (0024, 0038). So an outreach
organiser or volunteer is admitted only on `outreach.`; lab staff (and a lab
second checker) only on `lab.`; a pharmacist only on `pharmacy.`; a doctor,
clinician, nurse or receptionist only on `ehr.` and `migrate.` (Q97). One
addition: the administrator of a facility that signed
itself up and awaits support's review (membership `org_admin`, permissions
`org_admin_awaiting_review`'s, which hold `workforce.manage` but not
`organization.manage`, 0086) is admitted wherever org_admin is, so it can sign
in again on the site it signed up on.

Administrators follow their organisation's kind (owner decisions of 17
November 2026, verbatim: Q90 "Q90 A since its the best option that gives each
product seperate environment"; Q91 "Q91 A"). A membership is an
administrator's when it holds `organization.manage` (admin and org_admin,
0006) or is the administrator awaiting review above, and does not hold
`ehr.encounter.write`. Its sites depend only on the recorded kinds of its
organisation and the products it holds, not on its other codes (org_admin
also reads outreach registrations, admin also reads lab and pharmacy work):

| The organisation's recorded kinds | The administrator is admitted on |
| --- | --- |
| none recorded (Q91 A), or any `hospital` or `clinic` | every product site, as a hospital role |
| `laboratory` only | `lab.`, and the site of each product it holds |
| `pharmacy` only | `pharmacy.`, and the site of each product it holds |
| `laboratory` and `pharmacy` (no hospital or clinic) | `lab.` and `pharmacy.`, and the site of each product it holds |

A held product's site is `ehr.` for `ehr`, `migrate.` for `migrate`, `lab.`
for `laboratory` and `pharmacy.` for `pharmacy`; `outreach.` is never one. So
a laboratory or a pharmacy that bought `ehr` or `migrate` (both sign-up forms
accept any organisation type with any product) keeps that product's site for
its administrator, and the administrator awaiting review of a pharmacy that
signed itself up on `migrate.` can sign in there again.

[backend detail omitted] The answer
holds only `clinic`, `hospital`, `laboratory` and `pharmacy`, and is empty
when nothing is recorded: [backend detail omitted] `organization_products` is the distinct product codes, sorted, of
the organisation's active [backend detail omitted] (a suspended
product is not held, but its application's kind stays recorded, so
suspending a laboratory's only product narrows its administrator to `lab.`
instead of widening it to every site). The staff context reads it [backend detail omitted]
and adds `organizationKinds` (sorted, once each)
to that facility only when it is not empty, and `organizationProducts`
(sorted, once each) only beside `organizationKinds` and when it is not empty,
so a membership with no recorded kind answers exactly as before.

[backend detail omitted] The org_admin of a laboratory-only
organisation is refused (`403 PRODUCT_NOT_AUTHORISED`) on every site but
`lab.` (and the site of any other product it holds). The administrator
awaiting review of a self-signed-up laboratory is admitted on `lab.` (and on
the site of the product it signed up for), of a hospital or clinic on every
site. Clinical
hospital roles (`ehr.encounter.write`: doctor, clinician, nurse, receptionist)
and the lab, pharmacy and outreach roles are unchanged, at any organisation:
a hospital receptionist, for example, is still admitted on `migrate.`.
`product-gate.spec.ts` pins these answers; the database suite
`organization-staff-kinds.integration.sql` pins the function's.

The session's `actor.facilities`, `actor.facilityIds` and the selected
`actor.facility` hold only fitting memberships. The access token carries the
product (`product` claim); every request, including the delegated
`/auth/service-session` other services call, keeps only the fitting
memberships, and `X-Facility-ID` naming any other facility is `403
FACILITY_ACCESS_DENIED`. A session that no longer fits its site (its last
fitting membership ended) ends with `401`, as an ended membership always has.
This holds on `POST /auth/refresh` too: a refresh that no longer fits its site
(or, off the product sites, an account whose last membership ended) is `401`
with the cookies cleared, never one of the 403 sign-in refusals below, so every
website signs out cleanly.
`POST /auth/facility` also keeps only the facilities that fit the product of
its own `Origin` (`403 FACILITY_ACCESS_DENIED` otherwise). An access token
issued before this release carries no product and keeps today's behaviour
until its refresh, which applies the gate. After Q97, a doctor's, clinician's,
nurse's or receptionist's session issued on `lab.`, `pharmacy.` or `outreach.`
no longer fits its site: its next request or refresh answers `401` and the
website signs out, the mechanism above, unchanged.

### The sites a login can open: `actor.products` (Q97)

Every staff session answer carries the staff product sites this login can
open, so the website shows only those:

```ts
actor.products: ('ehr' | 'lab' | 'pharmacy' | 'migrate' | 'outreach')[]
```

- Always present on a staff actor; never on a patient actor.
- Order is fixed: `ehr`, `lab`, `pharmacy`, `migrate`, `outreach`; no
  duplicates.
- Computed with the gate's own rule over **all** the account's active
  memberships, before the current site's filter, so it is the same whatever
  site (or no-product host such as `admin.`) the session was issued on. A site
  is listed when at least one membership fits it.
- `["outreach"]` for the account-only outreach session (Q88-2).
- `[]` for a platform administrator with no membership (it opens `admin.`,
  which is not a staff product site).
- Carried in the answers of `POST /api/v1/auth/login`, a staff Google sign-in,
  `POST /api/v1/auth/refresh`, `GET /api/v1/auth/session` and `POST
  /api/v1/auth/facility` (each `{ actor, ... }`). It is not an access-token
  claim; it is read from the database on every request with the rest of the
  actor.

Examples (fictional): a doctor `["ehr", "migrate"]`; a doctor who also helps
an outreach group `["ehr", "migrate", "outreach"]`; lab staff `["lab"]`; a
hospital `org_admin` `["ehr", "lab", "pharmacy", "migrate", "outreach"]`.

The product is bound to the session, not to the `Origin` of each refresh (the
`Origin` is the client's to set). A staff session issued on a product site
carries its product in the server-made refresh token
[backend detail omitted]. `POST /auth/refresh`
re-applies that product, and answers `401` with the cookies cleared when the
request's `Origin` names any other product or none (for example a session
issued on `lab.` refreshed with `Origin: https://app.healthidentitydirectory.com`).
A refresh token with no product (issued before this release, or on a host with
no product) takes the product of the site it is refreshed on, and keeps it from
then on.

When the password is right but no membership fits:

```json
{ "status": 403, "code": "PRODUCT_NOT_AUTHORISED",
  "detail": "This account isn't set up for this Health ID product.", "product": "lab" }
```

A platform administrator with no fitting membership gets the same answer on a
product site; on `admin.` (no product) nothing changes.

### A verified staff login with no membership (Q88-2)

An active account with an active, verified staff record, no platform role
assignment and not one of the sealed demo accounts (0098), that has no
active membership:

- on `outreach.`, signs in with an account-only session: `actor.accountOnly:
  true`, no facility, no roles, no permissions. It reaches only `GET
  /api/v1/auth/session`, `POST /api/v1/auth/logout`, `POST
  /api/v1/auth/refresh` (public) and "Start an outreach group" (`GET
  /api/v1/identity/outreach-organisers/for-my-account/availability`, `POST
  /api/v1/identity/outreach-organisers/for-my-account`); every other route,
  the delegated service session included, answers `403
  NO_ACTIVE_FACILITY_MEMBERSHIP` before its handler. The start still needs
  `outreach_organiser_signup_enabled` on (`423
  OUTREACH_ORGANISER_SIGNUP_UNAVAILABLE` while it is off). Once the group is
  started, a refresh gives the normal outreach session at the new group.
- on every other site (and hosts with no product):

```json
{ "status": 403, "code": "NO_ACTIVE_FACILITY_MEMBERSHIP",
  "detail": "You aren't part of a facility or outreach group yet." }
```

Neither 403 is a failed sign-in: they are answered only after the password
was checked, [backend detail omitted] A
wrong password, an unknown email, a locked-out principal, and a right password
for any other account with no membership (a patient login, a sealed demo
account, an account with a platform role) still answer the one `401` "Invalid
credentials" [backend detail omitted]

[backend detail omitted]

### The staff password reset code email (Q89)

`POST /api/v1/auth/otp/start` with `PASSWORD_RESET` and the Turnstile action
`staff-reset` (the five product sites) or `admin-reset` (`admin.`), for an
account with an email that is not a patient the patient email could name,
[backend detail omitted] The email is the patient reset code's layout: subject "Your
Health ID password reset code", header "Health ID Security", "Hello <first
name>," (or "Hello there,"), "A password reset was requested for your Health
ID staff account. Use the code below to continue.", the boxed "Verification
Code", and "This code expires in <N> minutes. If you did not request this
reset, ignore this message and consider changing your password after you sign
in.", with N from `OTP_EXPIRY_SECONDS`. The first name is the first word of
[backend detail omitted] after any leading titles (Dr, Dr., Prof,
Professor, Mr, Mrs, Ms, Miss, Nurse), cut to notification-api's person-name
pattern. [backend detail omitted] A patient account keeps the
patient email whatever site asked; the patient portal's reset of a staff-only
account, legacy recovery and SMS keep the generic code message. The start
still answers every identifier alike.

## 46. Prescription strength, form, duration, quantity and priority for the pharmacy (0125)

Owner decision 25 of 2026-11-01 ([backend detail omitted], "all recommended except D5", on
the Akos handover backend plan, items 3b and 4; D6: no drug picture until the
price list; D9: the quantity to dispense is the prescriber's suggestion, the
pharmacist still confirms it and nothing compares the two). The prescriber
records how urgent a prescription is, the strength and form meant, how long
it is for and how much to hand over, and this facility's pharmacy sees them
on its own work. 0125 is unsigned until the owner signs its declaration.
[backend detail omitted]

Routes (paths and permissions unchanged): `POST
/api/v1/ehr/patients/:patientId/encounters/:encounterId/prescriptions`
(`ehr.prescription.write`), the prescription reads and update, and
`GET /api/v1/pharmacy/work-items` and `GET
/api/v1/pharmacy/work-items/:workItemId` (`pharmacy.work-item.read`).

While `PRESCRIPTION_DISPENSING_DETAILS_ENABLED` is `true` in ehr-api, the
create body takes these optional fields, at creation only (the update body is
unchanged and never changes them):

| Field | Value |
| --- | --- |
| `priority` | `routine`, `urgent`, `asap` or `stat` |
| `strength` | as written, 1-80 characters after trimming ("500 mg") |
| `doseForm` | `tablet`, `capsule`, `liquid`, `injection`, `cream`, `inhaler`, `drops` or `other` |
| `durationValue`, `durationUnit` | a whole number 1-3650 and `day`, `week` or `month`, both or neither |
| `quantityToDispense`, `quantityUnit` | a number above 0 with at most 4 decimals (at most 99,999,999.9999) and 1-80 characters, both or neither |

`null` for any of them is refused, as for every optional field. A pair sent
half answers 400 `DURATION_INCOMPLETE` ("Duration value and unit must be
supplied together") or `QUANTITY_INCOMPLETE` ("Quantity to dispense and its
unit must be supplied together"); a bad value answers 400
`VALIDATION_FAILED` naming the field. Every prescription answer (list, read,
create, update and an idempotent replay) adds each of the seven that is set,
under the same name (`quantityToDispense` as a number), and the list answer
adds `dispensingDetails: true`, which tells the website it may send them. A
create body without them keeps its Idempotency-Key digest, so a retry across
the deploy replays.

While the setting is off (the default), the routes answer exactly as
before: the create body is validated against today's fields with the
validation the app installs globally, so each new field answers 400
`VALIDATION_FAILED`, `"property priority should not exist"`, word for word;
no statement names the new columns, and no answer or list carries a new key.

[backend detail omitted]

While `PRESCRIPTION_DISPENSING_DETAILS_ENABLED` is `true` in pharmacy-api, a
work item that is this facility's own work (it has
`sourceEhrPrescriptionId`, and no `orderRoute`) carries, each only when there
is a value:

| Field | Value |
| --- | --- |
| `medication.strength`, `medication.doseForm` | as the prescriber gave them |
| `priority` | as the prescriber gave it |
| `duration` | `{ "value": n, "unit": "day" \| "week" \| "month" }` as the prescriber gave it; else, when the work item has both a start and an end date, the whole days from one to the other, both included, as `day` |
| `quantityToDispense`, `quantityUnit` | as the prescriber gave them; the dispensing form starts with them and the pharmacist confirms the quantity |

The values are those of the prescription version Pharmacy accepted, so they
do not change when the prescription later changes (the work item is then not
dispensable, as before). A prescription written before 0125, or without
them, gives none (only the duration from the dates). The prescriber's values
are left out when the member may not read the work now and when the database
read fails ([backend detail omitted]); the duration
from the work item's own dates is still given then. Nothing is added while
the setting is off.
Route-backed work items and the acceptance answer are unchanged (the same
details on work from another facility need the route to carry them, item 4b,
later). An emergency session with an active break-glass grant gets them,
because its work rows are shown too. [backend detail omitted] `PharmacyWorkItem` in `@hid/api-client` gains the optional fields.

[backend detail omitted]

## 54. Single sign-on on the product sites, staff with a password only (0127, owner decision Q92 B)

[backend detail omitted] Owner decision Q92 B: single sign-on goes to production with
staff signing in by password only, as they sign in today. [backend detail omitted] The provider on `auth.` (its sign-in page,
its session, authorize, token, discovery, key set, end-session and sending
back-channel logout) is not in this change. Each product site is an OpenID
Connect relying party of it, [backend detail omitted];
Identity issues each product its own host-only session, as a password
sign-in there does today. No cookie has a `Domain` (ADR-033), and the session
cookies of section 53 and before are unchanged. The website switch
(`VITE_HID_SSO`) is a separate release.

### Off until configured

With `AUTH_SSO_ISSUER` unset (production today), every route below answers
exactly as a route that does not exist (`404 NOT_FOUND`, no cookie, no audit
row); sign-in, the session check and sign-out are unchanged. [backend detail omitted] `POST /auth/sso/logout` answers `404` with or without a
session. The same holds on a host that is not a configured client (`admin.`,
`auth.` itself, [backend detail omitted]). [backend detail omitted] Every answer below carries
`Cache-Control: no-store` and `Referrer-Policy: no-referrer`; redirects are
`303` to configured addresses or the checked return path, never to an
address read from the request.

| Route (under `/api/v1`) | Answer |
| --- | --- |
| `GET /auth/sso/start?return_to=<path>[&prompt=none\|login]` | With a live session of this product (the session's kind is the client's and, for staff, it was issued for this site's product), unless `prompt=login`: `303` to `return_to`. Otherwise `303` to the provider's authorization endpoint [backend detail omitted]. `return_to` must be a page path on this host (no other host, scheme, `//`, `\`, dot segment, encoded `/`, `\` or control character, encoded unreserved character, fragment, `/api/` route or Health ID); anything else becomes `/`. Over a live session, `prompt=login` makes the callback accept only that session's account and end the earlier sign-in. Provider unreachable: `303` to the client's `sign_in_path` |
| `GET /auth/sso/callback` | Signed in: the three session cookies a sign-in sets, `303` to the transaction's return page. A quiet attempt answered `login_required` (or `interaction_required`, `consent_required`, `account_selection_required`): `303` to the provider again, without `prompt`, with a new transaction. Anything else, the product gate's refusals included: no session, `303` to `sign_in_path`, nothing in the address |
| `POST /auth/sso/logout` | Product sign-out. With a live session it is admitted exactly as `POST /auth/logout` (a session, by bearer or by cookie with its Origin and CSRF checks; any session kind, an account-only outreach session included), and today's sign-out runs first (the session ends, the cookies are cleared, [backend detail omitted]). With no live access token (none, or one that no longer verifies) it still answers, as hid-system#142 did and the patient website relies on: the request must come from an allowed Origin (`403 ORIGIN_DENIED` otherwise, unless it names a bearer token); a refresh cookie must come with its CSRF token (`403 CSRF_VALIDATION_FAILED` otherwise; nothing ends, nothing is cleared); a sign-in of the client's kind that the refresh cookie could still renew is ended as today's sign-out ends one ([backend detail omitted]), and with none nothing ends; the cookies are cleared. When a sign-in was ended, every other unrevoked sign-in of that account and kind ends too (reason `sso_logout`). Then `200 { "endSessionUrl": "<end_session_endpoint>?client_id=…&post_logout_redirect_uri=https%3A%2F%2F<host>%2F" }` for the frontend to open. It never carries `id_token_hint`. Provider unreachable: `503 SSO_PROVIDER_UNAVAILABLE` (this product is signed out all the same). `POST /auth/logout` itself is unchanged (`204`) |

[backend detail omitted]
(2 minutes after start or callback sent the browser to `sign_in_path`; while it
is present start never hands off quietly, and while the provider stays
unreachable it sends the browser to `/`, so no page loops).

### The session: a password sign-in on that site (Q88, Q92 B)

The callback issues the session [backend detail omitted], for staff and patients alike:

- **Staff.** The ID token must say the person signed in with a password
  (`amr` contains `pwd`; a second factor the provider also lists is
  accepted, never required); otherwise it is refused (`staff_password`). The
  session's product is the client's site's product (section 53), taken from
  the configured client and never from the request (a navigation from `auth.`
  carries no product `Origin`). So the same product gate applies: only the
  memberships admitted on the site (section 53's [backend detail omitted]:
  the Q88/Q90 permission and kind rule, then Q97's own-job rule, so a
  hospital clinical membership opens only `ehr.` and `migrate.` through
  single sign-on too), and the session's `actor.products` lists every site
  the login can open, as for a password sign-in; `403 PRODUCT_NOT_AUTHORISED` or `403
  NO_ACTIVE_FACILITY_MEMBERSHIP` refuse it, [backend detail omitted],
  and the browser is sent to the site's own sign-in page with no session; a
  verified staff login with no membership gets its account-only session on
  `outreach.` only, with `outreach.`'s short idle lock; and the refresh token
  is bound to the product ([backend detail omitted]), so refresh
  and every request keep the gate exactly as for a password sign-in.
- **Patients** on the patients' site (`web`), as a patient password sign-in.

The account must be active and not disabled. [backend detail omitted] The sign-in's absolute end, and a patient's
recent-sign-in check (`PATIENT_RECENT_AUTH_REQUIRED`), count from that
`auth_time`; idle and absolute lifetimes are otherwise those of a password
sign-in of that kind and site. A provider sign-in older than the account's
`password_changed_at` ([backend detail omitted]) is refused
(`stale_provider_sign_in`), so a provider session from before a password
recovery opens nothing. [backend detail omitted]

[backend detail omitted]

### Sign-out everywhere

Back-channel logout ends every unrevoked staff or patient sign-in that the
provider session `sid` opened, whichever product ([backend detail omitted]), or, when the token names only `sub`, every staff and patient
sign-in of that account. Product sign-out also ends every other sign-in of
the account of the same kind, including one made on a product's own sign-in
page and the account's sign-ins on other devices. The other sites keep their
cookies until a request reaches Identity: then a refused `POST /auth/refresh`
clears them, as today, and so does a refused `GET /auth/session` on a single
sign-on site when nothing of the sign-in can still renew. That refused refresh
of a sign-in ended with reason `sso_logout` is an ended sign-in, not a stolen
refresh token: `401`, [backend detail omitted] A refresh of a session ended for any other reason is answered
as production answers it today.

### What the provider must do (to confirm before switching on)

[backend detail omitted]

### Database (0127)

[backend detail omitted]

## FR-1. No typed reason for a first signature or a first activation (wave 1, no migration)

Owner decision of 18 November 2026: signing a note or activating a
prescription for the first time needs no typed reason. A reason is still
needed to change anything already signed or active. ehr-api only; no
migration, no new setting. `schema.integration.sql` is unchanged.

### Request bodies

`changeReason` becomes optional in three bodies: `PATCH
/ehr/patients/:patientId/encounters/:encounterId/clinical-notes/:noteId`
(UpdateClinicalNote), `PATCH .../prescriptions/:prescriptionId`
(UpdatePrescription) and `PATCH .../lab-requests/:requestId`
(UpdateLabRequest). Q105 adds two more: `PATCH
/ehr/patients/:patientId/encounters/:encounterId` (UpdateEncounter) and
`POST .../clinical-notes/:noteId/revisions` (new note text). When it is
sent, the rules are unchanged: a string, trimmed, 3 to 500 characters,
never `null` (`400` from validation otherwise). Diagnosis updates and
vitals corrections still require it in the body.

### When the server records a fixed reason

| Change | Typed reason | What is recorded in [backend detail omitted] |
| --- | --- | --- |
| A draft note signed (`status: "signed"`) with no other field (no `title`), and the note's version history shows it was never signed or amended | Not needed | `First signature (no reason needed)` |
| A draft prescription activated (`status: "active"`) with no other field (no `frequency`, `instructions` or `endsOn`; `allergyAcknowledgement` may be sent), and its version history shows it was never active, on hold or completed | Not needed | `First activation (no reason needed)` |
| Either of the above with a typed reason | Optional | The typed reason |
| Q105 adds: a lab request's first activation, starting and finishing a visit, and edits to a draft note, prescription or lab request that was never signed or active (see the Q105 section for the conditions and the recorded reasons) | Not needed | The Q105 fixed reason |
| Anything else: amend, hold, resume after a hold, stop or cancel (drafts included), entered in error (drafts and visits included), completing an order, any change to something already signed or active, a visit's chief complaint | **Required** | The typed reason |

"First" is checked against the record's version history, not only its
current status, and fails closed: if the record's create version cannot be
read, a reason is required. [backend detail omitted]

A missing reason where one is required answers:

```
400 { "code": "CHANGE_REASON_REQUIRED", "detail": "Please say why you are changing this.", ... }
```

before anything is written. For prescriptions the reason rule is decided
before the allergy check; the allergy check itself is unchanged, so an
allergy match on a first activation still answers `409
ALLERGY_ACKNOWLEDGEMENT_REQUIRED` until the acknowledgement is sent. For lab
requests and visits, a change that can never go without a typed reason
answers the `400` before the request reaches the database; one that might
(a lab request's first activation or draft edit, a visit's start or finish)
is decided under the row lock (Q105).

### Audit

[backend detail omitted]

### Extended by Q105

Owner question 6 was answered yes on 18 November 2026: the first activation
of a lab request, starting and finishing a visit, and edits to drafts no
longer need a typed reason. The request bodies, the table, the `400` and
the audit above include it; the Q105 section has the conditions and the
recorded reasons. For notes and prescriptions, a draft edit (and an edit
sent with the first signature or first activation) now records a fixed
reason too.

### Screen change needed (Akos frontend branch)

The note "Sign" and prescription "Activate" actions may send no
`changeReason`. Since Q105, starting or finishing a visit, a lab request's
first send and draft edits may send none too (see Q105's Website section).
Every other change keeps asking for a reason and shows the server's plain
message on `CHANGE_REASON_REQUIRED`.

## EHR-C1. The open visit today, and starting a visit without a duplicate (wave 1, no migration)

Akos P0-2 and N-3. ehr-api only; no migration, no new setting. "Today" is
the calendar day in Lagos (`Africa/Lagos`, UTC+1) until international
settings (P2-4). Both routes still need the patient's consent (normal
`read_records` or `write_records` grant) until the waiting list (EHR-C7)
lands; a refusal is `403 CONSENT_REQUIRED` and is audited as today.

### `GET /ehr/patients/:patientId/encounters/open-today`

Permission `ehr.encounter.read`. `patientId` is the UUID (never a Health
ID). Answers `200`:

```json
{ "day": "2026-11-18", "timeZone": "Africa/Lagos", "encounter": { ...visit... } }
```

`encounter` is the newest visit of this patient at this facility that is
open (`planned`, `in_progress` or `on_hold`) and was started on today's Lagos
day (from 00:00 to before 24:00 Lagos time), or `null` when there is none.
The imported paper records visit is never returned. The visit has the same
fields as `GET .../encounters/:encounterId`. [backend detail omitted]

### `POST /ehr/patients/:patientId/encounters` with `reuseOpenVisit`

The create body gains `reuseOpenVisit` (optional boolean, never `null`).

- Absent or `false`: exactly as before (the Idempotency-Key digest of a body
  without it is unchanged, and the answer has no new field).
- `true`: only with `status` `planned` or `in_progress` (otherwise `400
  REUSE_OPEN_VISIT_NEEDS_OPEN_STATUS`, "To use the open visit today, start
  the visit as planned or in progress."), and only with a `startedAt` on
  today's Lagos day by the server's clock (otherwise `400
  REUSE_OPEN_VISIT_STARTED_AT_NOT_TODAY`, "To use the open visit today, the
  visit must start today (Lagos time). Check the date and time on this
  device."). So a device whose clock is behind cannot create a visit dated
  yesterday that no later lookup finds, and a planned visit for another day
  is booked without `reuseOpenVisit`. Both checks run before the database
  is touched. The server takes a transaction
  lock for this patient at this facility
  [backend detail omitted]
  **before** it looks for today's open visit, and holds it until the
  transaction ends. If an open visit today exists, it is answered and
  nothing is created; otherwise the visit is created. Two requests at the
  same moment therefore give one visit.

The answer is `201` with the visit plus `reusedOpenVisit: true` (an
existing visit) or `false` (a new one). When `reusedOpenVisit` is `true`,
the answer is the existing visit as it is: its `encounterType`, `status`,
`startedAt` and `chiefComplaint` are the existing visit's, not the request's
(an `emergency` request can get back an `ambulatory` visit that is
`on_hold`); the screen shows the visit it got back. An idempotent replay of
the same request answers the same visit, with `reusedOpenVisit: false` only
when that request created it: [backend detail omitted] A client must not send the same
`X-Correlation-Id` on two different requests. [backend detail omitted]

### Screen change needed (Akos frontend branch)

Before "Start visit", read `open-today` and offer to continue the open
visit; when starting, send `reuseOpenVisit: true` so a double tap or two
staff at once do not make two visits.

## EHR-C3. Latest vitals for a patient (wave 1, no migration)

Akos P1-14. ehr-api only; no migration, no new setting.

### `GET /ehr/patients/:patientId/vitals/latest`

Permission `ehr.vital.read`. `patientId` is the UUID (never a Health ID).
Read under the patient's consent (`read_records`), like every vitals read.
A refusal answers `403 CONSENT_REQUIRED` [backend detail omitted] Answers `200`:

```json
{
  "facilityId": "<uuid>",
  "measures": {
    "bloodPressure": { "value": { "systolicMmhg": 128, "diastolicMmhg": 84 }, "recordedAt": "...", "vitalId": "<uuid>", "encounterId": "<uuid>", "corrected": false },
    "pulseBpm": { "value": 76, "recordedAt": "...", "vitalId": "<uuid>", "encounterId": "<uuid>", "corrected": true },
    "temperatureC": { "value": 37.2, "...": "..." }
  }
}
```

Rules:

- Only this facility's vitals for this patient.
- For each measure (`heightCm`, `weightKg`, `temperatureC`, `pulseBpm`,
  `respiratoryRate`, `bloodPressure`, `oxygenSaturationPercent`) the newest
  reading (by `recordedAt`, then entry time) that has that measure. A measure
  with no reading is left out of `measures`.
- The vital's current correction is applied first (the correction's values
  over the original ones, as the patient record already applies them);
  `corrected` says whether the reading's current correction set this measure
  (per measure, not per reading: a correction that changes only the pulse
  leaves the weight of the same reading `corrected: false`; for
  `bloodPressure`, true when the correction set either half of the pair).
- Blood pressure is one measure and is always the systolic and diastolic
  pair from the same reading; it is never mixed across readings.
- Vitals of a visit entered in error are left out. (A single vital entered
  in error waits for EHR-C8b, migration 0142.)
- Values are JSON numbers (the per-visit vitals list still returns numeric
  columns as strings, unchanged).

### Screen change needed (Akos frontend branch)

The patient header or chart may show "Latest vitals" from this route, one
call per patient, and label each value with its date.

## EHR-C8a. A completed visit entered in error (wave 1, no migration)

QA open question. ehr-api only; no migration, no new setting.

### `PATCH /ehr/patients/:patientId/encounters/:encounterId`

A `completed` visit may now move to `entered_in_error` (before, a completed
visit could not change status). The body is the usual UpdateEncounter body,
and **a typed `changeReason` is required** (3 to 500 characters; [backend detail omitted]). Since Q105 the body
may leave `changeReason` out, but only to start or finish a visit; entering
a visit in error still needs a typed one:

```json
{ "expectedRowVersion": 3, "status": "entered_in_error", "changeReason": "Wrong patient chosen" }
```

Refusals. The two `400`s come first, before the visit is read; the `409`s
are checked under the visit's row lock, before anything is written:

| Answer | When |
| --- | --- |
| `400` (validation) | A `changeReason` shorter than 3 characters after trimming (a blank one included), longer than 500, or `null` |
| `400 CHANGE_REASON_REQUIRED` "Please say why you are changing this." | No `changeReason` (Q105 lets the body leave it out, but only for a start or finish) |
| `409 IMPORTED_VISIT_NOT_ENTERED_IN_ERROR` "The imported paper records visit cannot be marked as entered in error." | The visit is the patient's imported paper records visit (0113) |
| `409 VISIT_HAS_OPEN_ORDERS` "Cancel or stop this visit's prescriptions and lab requests, drafts included, before marking it as entered in error." | The visit still has a `draft`, `active` or `on_hold` prescription or lab request (so no pharmacy or lab keeps acting on a visit that should not exist; a draft counts because it could otherwise be activated later) |
| `409 VISIT_HAS_SIGNED_NOTES` "Mark this visit's signed notes as entered in error before marking the visit as entered in error." | The visit still has a `signed` or `amended` note (so the patient's own record never lists a note of the visit; see below) |
| `409 INVALID_ENCOUNTER_TRANSITION` | A completed visit to any status other than `entered_in_error` (unchanged) |

[backend detail omitted] Entering a planned, in-progress or
on-hold visit in error is unchanged.

### Nothing new on a visit entered in error (any visit, not only a completed one)

Every path that adds to a visit or starts something on it now reads the
visit first, [backend detail omitted], and refuses a visit entered in
error with
`409 VISIT_ENTERED_IN_ERROR` "This visit was marked as entered in error. Nothing new can be added to it or started on it."

| Route | Refused on a visit entered in error | Still allowed |
| --- | --- | --- |
| `POST .../encounters/:encounterId/prescriptions` | always | |
| `PATCH .../prescriptions/:id` | activate, resume, complete, any edit | `on_hold`, `cancelled`, `entered_in_error` |
| `POST .../prescriptions/:id/pharmacy-work-item` | always (before the pharmacy is called) | |
| `POST .../encounters/:encounterId/lab-requests` | always (before the laboratory is called) | |
| `PATCH .../lab-requests/:id` | activate, resume, complete, any edit | `on_hold`, `cancelled`, `entered_in_error` |
| `POST .../lab-requests/:id/lab-work-item` | always (a read, no lock: this route writes nothing in the EHR) | |
| `POST .../encounters/:encounterId/clinical-notes` | always | |
| `PATCH .../clinical-notes/:id` | sign, title change | `entered_in_error` |

[backend detail omitted] A replay of an Idempotency-Key that was already
completed is answered as before.

### What the patient sees afterwards

- The patient's own record (`GET` patient self records) lists only completed
  visits, so the visit disappears from it.
- The notes in that read are unchanged for the patient: a signed note of a
  visit that is not completed yet is still listed, as before. The read leaves
  out a note only when its visit can be seen and is entered in error
  [backend detail omitted] a completed visit entered in error has no signed note
  left (`VISIT_HAS_SIGNED_NOTES`), so its notes never reach the patient.
- The emergency read (staff, who can see every visit at the facility) now
  leaves out notes of a visit entered in error.
- Known gap, unchanged from before: a planned, in-progress or on-hold visit
  can still be entered in error with signed notes in it (that path has no new
  check), and the patient's record still lists those notes. Closing it needs
  a database helper the patient's read can call (a migration), or the same
  `VISIT_HAS_SIGNED_NOTES` rule on that path: an owner decision.
- The patient chat reads visits, notes, prescriptions, tests, diagnoses and
  vitals only from completed visits (unchanged; [backend detail omitted]).

### Screen change needed (Akos frontend branch)

Offer "Entered in error" on a completed visit, ask for the reason, and show
the plain message of each `409` (for open orders, link to the visit's
prescriptions and lab requests).

## ID-0. NIN status on staff answers, and the NIN service breaker (Akos wave 1, no migration)

Owner decision of 18 November 2026: screens say "NIN Verified" or "NIN Not
Verified". The service answers one field with two values and the screen
shows the words.

### `ninStatus`

`ninStatus` is `"verified"` or `"not_verified"`. No other value is ever
returned, and no stored verification value is passed through as it is.

- `"verified"`: the patient holds a NIN that was checked and has not been
  revoked [backend detail omitted].
- `"not_verified"`: everything else, including a NIN that was revoked.

Added to:

- `POST /api/v1/identity/patient-lookup`: `patient.ninStatus`, beside
  `patient.version`. [backend detail omitted]
- Every registration-case answer (`POST identity/nin/resolve`,
  `GET identity/registration-cases/:caseId`, `approve-new`,
  `link-existing`, and their replays): top-level `ninStatus`. A case is
  `"verified"` when its NIN was checked and, once the case points at a
  patient, that patient still holds a checked NIN that is not revoked. Every
  case today has a checked NIN; `"not_verified"` cases arrive with ID-2.
- Desk search cards (ID-3a, lane B) use the same rule:
  `services/identity-api/src/identity/nin-status.ts` exports
  `patientHasVerifiedNinSql()` and `ninStatusOf()`.

### `GET /api/v1/identity/registration-capabilities`

Same permission and headers as before (`identity.registration.write`,
`X-Facility-Id`). The answer gains `nin.available` and `withoutNin`:

```json
{
  "nin": { "enabled": true, "state": "test-only", "available": true },
  "withoutNin": { "enabled": false },
  "newPatientRegistrationRequiresNin": true
}
```

Staging (deferred) answers
`{"nin":{"enabled":false,"state":"deferred","available":false},"withoutNin":{"enabled":false},"newPatientRegistrationRequiresNin":true}`.

- `nin.available` is `false` when NIN checks are off (`enabled: false`) or the
  breaker below is tripped; otherwise `true`.
- `withoutNin.enabled` is `false` until ID-2 (0130) ships desk registration
  without a NIN. `newPatientRegistrationRequiresNin` stays `true` until then.

### The breaker

Kept in memory in each Identity process (no table, no secret, no setting).

- [backend detail omitted]
- A NIN that does not match (`422 NIN_VERIFICATION_FAILED`) is an answer, not
  a failure, and does not count. Nor does a `4xx`.
- While tripped, `POST identity/nin/resolve` answers `503` with code
  `NIN_PROVIDER_UNAVAILABLE` and detail "The NIN service is not answering
  right now. Please try again in a minute." without calling the service.
  [backend detail omitted] A replay of
  an earlier request is still answered.
- [backend detail omitted]
- NIN checks switched off (`NIN_PROVIDER_MODE=unavailable`) are a setting,
  not an outage: the breaker is not touched and no warning is logged. The
  desk gets `503` `NIN_PROVIDER_UNAVAILABLE`, "NIN verification is not
  configured", every time (not "try again in a minute"), audited as below.
  Deferred staging is unchanged (`NIN_PROVIDER_DEFERRED`).

[backend detail omitted]

### Screen change (Akos's frontend branch)

Show `ninStatus` as "NIN Verified" or "NIN Not Verified" on the patient
lookup and registration-case screens. When `nin.available` is `false`, tell
the desk the NIN service is not answering and to try again in a minute. Do
not offer registration without a NIN until `withoutNin.enabled` is `true`.

### Tests

`services/identity-api/src/identity/nin-status.spec.ts` (verified,
not_verified and revoked on the lookup and the case answer; breaker trip,
window, retry, recovery, log event; one check at a time while retrying, with
two desks at once; checks switched off do not trip it; the audit row says
whether the NIN was sent; capabilities; no answer contains the word the
owner ruled out). `nin-deferred-staging.spec.ts` exact bodies updated.

## SX-10. Registration-case list for the desk and approvers (Akos wave 1, no migration)

Default agreed in the 18 November plan: the desk sees its own cases, approvers
see every case at the facility.

```text
GET /api/v1/identity/registration-cases?view=mine|facility[&status=...][&limit=...][&cursor=...]
```

- Permission `identity.registration.write`, `X-Facility-Id`, and
  `X-Purpose-Of-Use` (`direct-care`, `emergency` or `healthcare-operations`,
  as on `GET registration-cases/:caseId`). `Cache-Control: no-store`.
- `view=mine` (the default): the cases this member's account started at this
  facility.
- `view=facility`: every case at this facility. It also needs
  `identity.registration.approve`; without it the answer is `403`
  `REGISTRATION_CASE_LIST_DENIED`, "Only staff who approve registrations can
  see every case at this facility." (audited, outcome `denied`).
- `status` (optional): one of `pending_new_identity_approval`,
  `review_required`, `resolved_existing_identity`, `linked_existing`,
  `approved_new_identity`, `rejected`, `cancelled`.
- `limit`: 1 to 100, default 50. `cursor`: the `nextCursor` of the previous
  page, as given. A cursor that is not one we gave answers `400`
  `REGISTRATION_CASE_CURSOR_INVALID`, "This page link is not valid. Start
  again from the first page."
- Any other query parameter (for example a Health ID) answers `400`. Health
  IDs are never taken in the URL.
- Only cases of the facility in `X-Facility-Id` are read, whatever else the
  member may read; another facility sees nothing.

Answer, newest first:

```json
{
  "view": "mine",
  "cases": [
    {
      "caseId": "uuid",
      "status": "approved_new_identity",
      "version": 2,
      "candidateCount": 0,
      "contactRecorded": true,
      "ninStatus": "verified",
      "patient": { "patientId": "uuid", "hid": "HID-QX7K2M" },
      "fullName": "Ada Fictional",
      "dateOfBirth": "1991-04-05",
      "createdAt": "2026-11-18T10:00:58.000Z",
      "updatedAt": "2026-11-18T10:05:58.000Z",
      "createdByMe": true
    }
  ],
  "nextCursor": null
}
```

The item has the same fields as `GET registration-cases/:caseId` (with
`ninStatus` from ID-0; `patient` only once the case points at a patient), plus
`fullName`, `dateOfBirth`, `createdAt`, `updatedAt` and `createdByMe`. No NIN
digits are read or returned (not even the last four), and candidates are not
listed; open one case for them.

[backend detail omitted]

### Screen change (Akos's frontend branch)

A "My registrations" list for the desk (`view=mine`) and an "All
registrations" list for approvers (`view=facility`), with "NIN Verified" /
"NIN Not Verified" from `ninStatus`, and "Load more" while `nextCursor` is
not null. Opening a row calls `GET registration-cases/:caseId`.

### Tests

`services/identity-api/src/identity/registration-case-list.spec.ts`: mine and
facility views, another facility sees nothing, the refusal and its audit row,
the success audit row, no NIN digits in the answer or the query, paging and
bad cursors, and query parameters (a Health ID is refused). Those run on a
fake database; one test checks that the Postgres suite below runs the read
the service sends, word for word.

[backend detail omitted]

`services/identity-api/src/identity/registration-case-list.http.spec.ts`
(supertest, the real security guard, audit interceptor and the global
validation pipe as `main.ts` sets it): `200` with `Cache-Control: no-store`
and the audit row; `403 PERMISSION_DENIED` without
`identity.registration.write`; `400 VALIDATION_FAILED` for
`?hid=HID-QX7K2M`, with nothing read and the Health ID written nowhere;
`400 PURPOSE_OF_USE_REQUIRED` without `X-Purpose-Of-Use`.

## SX-5. My staff profile, read only (no migration)

Akos P1-8, read part. The account menu's "My profile" for staff. Changing a
password while signed in (SX-6), preferences and home shortcuts (SX-7) come
later; until then `canChange` answers `false` for each, and the screen shows
no edit control.

| Route (under `/api/v1`) | Who | Answer |
| --- | --- | --- |
| `GET /identity/me/staff-profile` | Any staff session, by bearer or cookie, including a platform administrator with no facility membership. `X-Facility-ID` is optional; when sent it must be one of the caller's own facilities and only marks that facility as current. No permission is needed: it reads the caller's own account. | `200` below. A patient session: `403 PATIENT_SCOPE_DENIED`. An outreach account-only session (no facility membership): `403 NO_ACTIVE_FACILITY_MEMBERSHIP`. An `X-Facility-ID` that is not one of the caller's own facilities: `403 FACILITY_ACCESS_DENIED`. An account that is no longer active: `401 AUTHENTICATION_REQUIRED`. |

```json
{
  "accountId": "uuid",
  "name": "Ada Fictional",
  "email": "ada@example.test",
  "signIn": { "method": "password", "hasPassword": true, "passwordChangedAt": "2026-10-01T09:00:00.000Z" },
  "licence": { "numberHint": "4567" },
  "memberSince": "2026-01-05T08:00:00.000Z",
  "currentFacilityId": "uuid or null",
  "facilities": [
    { "id": "uuid", "membershipId": "uuid", "name": "Fictional Clinic", "roles": ["doctor"], "isPrimary": true, "isCurrent": true }
  ],
  "products": ["ehr", "migrate"],
  "canChange": { "name": false, "password": false, "preferences": false }
}
```

- `name` is the account's display name, else the staff record's full name.
- `signIn.method` is `password` or `single_sign_on` (how this session was
  signed in). `hasPassword` is `false` for a login that has never set one
  (Google only); `passwordChangedAt` is then `null`.
- `licence` is `null` when no licence number is recorded, or when the
  recorded one has no letter or digit (for example `--`), so `numberHint` is
  never `null`. Only the last four letters or digits are answered (the same
  rule as [backend detail omitted]), never the full number.
- `facilities` and `products` are the session's own (every active
  membership this site admits, section 53), so the profile never shows a
  facility the session itself cannot use.
- The read is by the session's account id and subject together, active
  accounts only. The password hash is never selected.
- `currentFacilityId` is `null`, and every `isCurrent` is `false`, when no
  `X-Facility-ID` is sent.
- [backend detail omitted] No patient is read.

Screen change (Akos frontend branch): the account menu gains "My profile",
which shows these fields; the licence is shown as "Licence number ending
4567".

## SX-9. Saved lists: this facility's OCR jobs and staff names (no migration)

Akos P1-10. OCR jobs no longer disappear when the page is left: the Migrate
desk reads this facility's jobs, newest first, a page at a time, and shows
who started each one by name. (The registration-case list is SX-10, lane A;
it uses the same names route.)

| Route (under `/api/v1`) | Who | Answer |
| --- | --- | --- |
| `GET /ocr/job-list[?status=<status>][&mine=true][&limit=<1-50>][&cursor=<nextCursor>]` | Staff with `ocr.job.read` at the `X-Facility-ID` facility (doctor, clinician, nurse, lab, admin). Purpose is always `healthcare-operations`, whatever `X-Purpose-Of-Use` says. | `200 { items, nextCursor }` below. No `X-Facility-ID`: `400 FACILITY_REQUIRED`. A facility the caller is not active at: `403 FACILITY_ACCESS_DENIED`. No `ocr.job.read`: `403 PERMISSION_DENIED`. Any other query key, a status that does not exist, `mine` other than `true`, a limit outside 1-50: `400 VALIDATION_FAILED`. A cursor this route did not make: `400 OCR_JOB_LIST_CURSOR_INVALID`, "This page of the list can no longer be opened. Start the list again." |
| `GET /identity/facility-staff-names[?membershipIds=<id>,<id>,…]` | Any staff member active at the `X-Facility-ID` facility. No permission beyond membership. | `200 { facilityId, staff, complete }` below. No `X-Facility-ID`: `400 FACILITY_REQUIRED`. A facility the caller is not active at: `403 FACILITY_ACCESS_DENIED`. A patient session: `403 PATIENT_SCOPE_DENIED`. More than 100 ids, or anything but comma-separated UUIDs: `400 VALIDATION_FAILED`. |

`status` is one of `queued`, `processing`, `extracted`,
`awaiting_validation`, `validated`, `rejected`, `failed`, `cancelled` ([backend detail omitted]); an item's `status` is always one of
these. `mine=true` lists
only the jobs the caller started at this facility. `limit` defaults to 25.

```json
{
  "items": [
    {
      "id": "uuid",
      "documentId": "uuid",
      "status": "awaiting_validation",
      "createdAt": "2026-11-18T10:00:00.123Z",
      "createdByMembershipId": "uuid",
      "createdByMe": false,
      "attemptCount": 1,
      "maxAttempts": 3,
      "completedAt": null,
      "failedAt": null,
      "failureCode": null
    }
  ],
  "nextCursor": "opaque string, or null on the last page"
}
```

- Only this facility's jobs are read: the query filters on the request's
  facility, [backend detail omitted]. Another facility's jobs are never listed.
- No patient field is answered and no patient or document table is read.
  A job's patient is shown only when the job is opened with
  `GET /ocr/jobs/:jobId`, which checks access to that patient as today.
  No Health ID is ever accepted in this URL.
- `failureCode` is the stored code only (for example `PROVIDER_TIMEOUT`); the
  stored free-text summary is not answered.
- Paging is by `(createdAt, id)`, newest first, kept to the microsecond, so a
  page never repeats or skips a job. Pass `nextCursor` back as `cursor` with
  the same filters.
- [backend detail omitted]

```json
{
  "facilityId": "uuid",
  "staff": [
    { "membershipId": "uuid", "name": "Bola Fictional", "current": true },
    { "membershipId": "uuid", "name": null, "current": false }
  ],
  "complete": true
}
```

- The facility is the request's own, never one the caller names.
- `staff` holds the facility's members past and present, current members
  first, then by name. `current` is `false` once the membership, the staff
  record or the login has ended. `name` is `null` for a login that was
  deleted; the screen shows "Former staff member".
- Only names are answered: no email, role, licence or account id.
- Without `membershipIds`, at most 500 names; `complete` is `false` when
  there are more, and the screen then asks for the ids on its page with
  `membershipIds`.
- [backend detail omitted]

Screen change (Akos frontend branch): the Migrate desk gains a "Documents
read here" list (status filter, "Only mine", "Load more"), showing "Started
by <name>" from the names route; a row opens the job as today.

## ORD-3. Own pharmacy and laboratory progress on prescriptions and lab requests (wave 1, no migration)

Akos items N-1b and N-8 (build plan of 18 November 2026, lane D). A
clinician sees, on each prescription and lab request, where it is in this
facility's own pharmacy or laboratory, for example "Dispensed 11:05". No
migration, no new setting and no new secret: [backend detail omitted]

### Internal routes (ehr-api only)

[backend detail omitted]

Answer: `{ "items": [...] }`, one item per id asked, in the order asked.

Pharmacy item: `sourceEhrPrescriptionId`, `status`, `receivedAt`,
`dispensedAt`, `reversedAt` (ISO times or `null`).

| `status` | Meaning |
| --- | --- |
| `not_received` | no work item here that the clinician may read |
| `received` | the pharmacy has it and has not dispensed it |
| `dispensed` | dispensed at `dispensedAt` |
| `dispensing_reversed` | dispensed, then the dispensing was reversed at `reversedAt` |

Lab item: `sourceEhrOrderId`, `status`, `receivedAt`, `collectedAt`
(the first sample taken), `lastResultAt` (the latest released result).

| `status` | Meaning |
| --- | --- |
| `not_received` | no work item here that the clinician may read |
| `received` | the laboratory has it; no sample taken yet |
| `sample_collected` | a sample was taken (collected or received; not rejected, cancelled or entered in error) |
| `some_results_ready` | some of its tests have a released result |
| `results_ready` | every test it asks for has a released result |

A result counts only while its current version is released and not marked
entered in error (the laboratory work list's rule). Only this facility's
own work is read: work on an order route to another facility is left out
(its progress is on the EHR item's `orderRoute`).

[backend detail omitted]

Runtime proof: `services/ehr-api/scripts/verify-order-routes-runtime.mjs`
step 10b signs a doctor in with the cookie, reads through ehr-api a
prescription dispensed by the hospital's own pharmacist (`dispensed`, with
the dispensing's time) and a lab request with results released by its own
laboratory (`results_ready`), each under the doctor's own grant only; a
routed prescription and lab request stay `not_received`; a doctor without a
grant gets `403` from ehr-api, pharmacy-api and lab-api, and the denials are
audited with the patient.

[backend detail omitted]

### ehr-api answers

`GET .../encounters/:encounterId/prescriptions` and
`GET .../prescriptions/:prescriptionId`: each prescription gains
`ownProgress` with the pharmacy fields above (`status`, `receivedAt`,
`dispensedAt`, `reversedAt`).

`GET .../encounters/:encounterId/lab-requests` and
`GET .../lab-requests/:requestId`: each lab request gains `ownProgress` with
the lab fields above (`status`, `receivedAt`, `collectedAt`, `lastResultAt`).

`ownProgress.status` is also:
- `not_received` for a draft (never sent, so not asked about);
- `unknown` (all times `null`) when the pharmacy or laboratory could not be
  asked or answered something unexpected: down, slower than 3 seconds,
  refused, or a malformed answer. The EHR answer itself never fails because
  of it.

ehr-api asks once per page (at most 100 ids per call), after its own read
and audit, with the clinician's own credentials. Nothing else in these
answers changes.

Screen change (Akos frontend branch): show `ownProgress` on each order row,
for example "Received 10:40", "Dispensed 11:05", "Sample taken 09:30",
"Results ready 11:05"; show "Progress not available right now" for
`unknown`, and nothing for `not_received` on a draft.

## ORD-10 phase 1. Same-medicine warning when prescribing (wave 1, no migration)

Akos items N-9c and P0-5 (build plan of 18 November 2026, lane D). A
warning, never a block. Phase 2 (with Release B) adds medicines of the same
class (ATC).

### The check before saving

`POST /api/v1/ehr/patients/:patientId/duplicate-medicine-check`, direct care
only, permission `ehr.prescription.write` (as the allergy check). Read-only;
answer `200`, `Cache-Control: no-store`.

Request: `medicationDisplay` (1-500 characters), optional
`medicationCodeSystem` (up to 255), `medicationCode` (up to 100) and
`excludePrescriptionId` (a UUID: the prescription being changed or
activated, left out). Any other field is refused.

Answer:

| Field | Value |
| --- | --- |
| `checked` | `true` when the check ran |
| `matches` | the current prescriptions of the same medicine, newest first |
| `message` | plain words for the form, or `null` when there are no matches |

Each match: `prescriptionId`, `encounterId`, `medicationDisplay`, `status`
(`draft`, `active` or `on_hold`), `startsOn`, `endsOn` (`YYYY-MM-DD` or
`null`), `createdAt`, `matchedBy` (`code` or `name`).

Messages: "This patient already has a current prescription for this
medicine. Check it before you continue." or "This patient already has N
current prescriptions for this medicine. Check them before you continue."

What is compared: only this patient's prescriptions at this facility that
the clinician may read under consent, and only current ones (draft, active
or on hold, not ended before today in Lagos), at most 500, newest first.
They match when the codes are the same (and the code systems are the same,
or one is missing), or when the two name a medicine in common once
numbers, units, dose form and anything in brackets are set aside
(`matchedBy: name`). A strength ends the name of its medicine and a
separator (`/`, `+`, `&`, `,`, "and", "with", "plus") starts the next, so a
combination product names each of its medicines. A number is set aside on
its own: the word after it is kept, and a name such as B12 or D3 keeps its
digits. Examples: "Amoxicillin 500 mg capsules" and "amoxicillin 250mg"
match; "Codeine 30 paracetamol 500" and "Paracetamol 1 g" match (both hold
paracetamol); "Amoxicillin" and "Ampicillin" do not; "Vitamin B12 1000 mcg"
and "Vitamin B6 50mg" do not; "Insulin 70/30 mixtard" and "Insulin" do not
(words after the last strength with no separator before them belong to the
medicine before it).

Refusals: `403 CONSENT_REQUIRED` when Identity refuses the read, or when the
database does not allow this patient's records to be read here (so "no
match" never stands for "could not read"); `400` for a bad body or purpose.

[backend detail omitted]

### On a new prescription

`POST .../encounters/:encounterId/prescriptions` (unchanged request and
status) gains `duplicateMedicines` with the same shape, compared with the
patient's other current prescriptions (the new one left out). It never
fails the create: when the check cannot run, `duplicateMedicines` is
`{ "checked": false, "matches": [], "message": null }`. A prescription
created already cancelled, completed or entered in error gets
`{ "checked": true, "matches": [], "message": null }` without a check.

Screen change (Akos frontend branch): run the check when a medicine is
chosen and show `message` with the matches (medicine, status, dates) above
Save; Save stays enabled. After Save, show `duplicateMedicines.message` if
present.

## Q105. No typed reason for a lab request's first activation, starting and finishing a visit, and draft edits (no migration)

Owner decision of 18 November 2026 (owner question 6, answered yes; Akos
N-12: reasons only for things already signed or active). It extends FR-1 in
ehr-api only: no migration, no new setting, `schema.integration.sql`
unchanged. The rule and the fail-closed "first" check are FR-1's: "never
signed or active" is read from the record's version history
[backend detail omitted], and if its create version cannot be read, a typed
reason is required.

### Request bodies

`changeReason` may now also be left out of `PATCH
/ehr/patients/:patientId/encounters/:encounterId` (UpdateEncounter) and `POST
.../clinical-notes/:noteId/revisions` (new note text). When sent, the rules
are unchanged (trimmed, 3 to 500 characters, never `null`). Diagnosis
updates and vital corrections still require it in the body.

### When the server records a fixed reason

| Change (no typed reason sent) | Condition | Recorded reason (`change_reason`) | [backend detail omitted] |
| --- | --- | --- | --- |
| Lab request `status: "active"` from `draft` (may also change `priority` or `clinicalInformation`); it is then sent to Lab as before | never active, on hold or completed | `First activation (no reason needed)` | [backend detail omitted] |
| Lab request `priority` or `clinicalInformation` while it stays `draft` | never active, on hold or completed | `Draft edit (no reason needed)` | [backend detail omitted] |
| Prescription `frequency`, `instructions` or `endsOn` while it stays `draft` | never active, on hold or completed | `Draft edit (no reason needed)` | [backend detail omitted] |
| Prescription `status: "active"` from `draft` together with those edits | as FR-1 | `First activation (no reason needed)` | [backend detail omitted] |
| Note `title` while it stays `draft` | never signed or amended | `Draft edit (no reason needed)` | [backend detail omitted] |
| Note signed together with a `title` change | never signed or amended | `First signature (no reason needed)` | [backend detail omitted] |
| New note text (`revisions`) on a `draft` note; the revision row's `change_reason` holds the same text | never signed or amended | `Draft edit (no reason needed)` | [backend detail omitted] |
| Visit `status: "in_progress"` from `planned`, no other field | never in progress, on hold or completed | `Visit started (no reason needed)` | [backend detail omitted] |
| Visit `status: "completed"` from `in_progress`, with or without `endedAt`, no `chiefComplaint` | never completed | `Visit finished (no reason needed)` | [backend detail omitted] |

A typed reason, when sent, is always recorded instead, [backend detail omitted]

### Still needs a typed reason

`400 CHANGE_REASON_REQUIRED`, "Please say why you are changing this.",
before anything is written, for: putting on hold, resuming after a hold,
cancelling (drafts included), entering in error (drafts and visits
included), completing a lab request or prescription, amending a signed note,
any change to an active, held or ended order, a visit's chief complaint, and
any of the changes in the table when the history shows the record was
signed or active before or cannot be read. For lab requests, a change to
`on_hold`, `completed`, `cancelled` or `entered_in_error` without a reason
answers the `400` before the request reaches the database; a draft's
activation or edit is decided under the request's row lock. For visits, a
change without a reason that can be neither a start (`in_progress`, no other
field) nor a finish (`completed`, with at most `endedAt`) answers the `400`
before the visit is read, so before EHR-C8a's `409`s (`VISIT_HAS_OPEN_ORDERS`
and the others); a move to `in_progress` or `completed` is decided under the
visit's row lock (a resume after a hold, or a start or finish the history
shows happened before, then answers the `400`). The allergy check on a prescription's activation is unchanged (409
`ALLERGY_ACKNOWLEDGEMENT_REQUIRED` until acknowledged). For notes and
prescriptions, EHR-C8a's 409 `VISIT_ENTERED_IN_ERROR` is unchanged and comes
first; for lab requests and visits, the early `400` above comes before it.

### Website

Akos's frontend may leave the reason box out for these changes. Every
other change keeps it.

## Q100 B. "No such patient" on the staff Health ID lookup (no migration)

Owner decision of 18 November 2026 (Q100, option B): a Health ID that no
patient has answers "No such patient" distinctly. identity-api only: no
migration and no new setting.

### `POST /api/v1/identity/patient-lookup`

Body unchanged (`hid` in the body, never in a URL; `purpose`). Answers:

| Case | Status | Body |
| --- | --- | --- |
| The patient opens (unchanged) | `200` | as before |
| No patient record of any status has this Health ID, and the Health ID is on the member's facility's side of the seals (below) | `404` | `{ "code": "PATIENT_NOT_FOUND", "detail": "No patient has this Health ID." }` |
| The patient exists but is not available here (another facility's patient without consent, not active, sealed tenant) | `404` | today's answer, unchanged (`code` `NOT_FOUND`, "Patient was not found or is not available") |
| [backend detail omitted] | `404` | today's answer, whether or not any record has the Health ID, never `PATIENT_NOT_FOUND` |
| The patient can be seen here but this lookup is not authorized | `403` | today's answer, unchanged; never counted toward the limit below |
| [backend detail omitted] | `404` | today's answer (`404` `NOT_FOUND`) [backend detail omitted], never `PATIENT_NOT_FOUND` and never a `429`; a `403` stays today's `403` |

[backend detail omitted] A limited account keeps getting today's `404`,
never a new status: the website ends access and closes an open record on any
`403` or `404` from this lookup (its check before every save), so a `429`
there would leave a record open after access has ended. [backend detail omitted]

### The seals (demo 0098, QA 0123)

Nothing in a sealed tenant ever finds a real patient, and nothing real finds
a sealed one (0098 D2, 0123). [backend detail omitted] So a demo or QA member learns nothing about
real Health IDs, a real member nothing about demo or QA ones, and the demo
and QA tenants nothing about each other; each learns only whether a Health
ID of its own side is issued. [backend detail omitted]

### Audit

[backend detail omitted]

### Not changed

Access requests, the Access PIN and emergency access by Health ID keep
their answers (`404 CONSENT_RESOURCE_NOT_FOUND` and so on). They are lane A's
(`src/consent/*`) and are being changed by hid-system#264 (0128).

### Website

Find a patient shows the owner's words, "No patient has this Health ID."
(the answer's `detail`), with Register for roles that register (health repo,
`PatientsWorkspace.tsx`), only on `PATIENT_NOT_FOUND`. Every other `404` and
every `403` stays a refused lookup, as today. A limited account gets today's
`404`, never a `429`.

## Wave 0: answers for the EHR screens (R-1 to R-4, P2-5, P2-6)

**These are answers, not new behaviour.** Nothing in any service, migration,
grant or setting changes. They answer the questions in Akos's note "Health ID
EHR QA (Doctor role): backend needs" (17 Nov 2026), items R-1, R-2, R-3, R-4,
P2-5 and P2-6. The only new files are the HID-LAB code list
(`docs/codes/hid-lab-codes.json`) and its check
(`scripts/tests/hid-lab-codes.test.mjs`).

Every statement was checked against `staging-novu-ci-20261005` at `964fabdf`
(19 Nov 2026). File references are to that branch, and a migration number
such as `0004:181` means `services/ehr-api/database/migrations/0004_*.sql`,
line 181. [backend detail omitted] Anything marked **Planned** is in the
18 Nov build plan and is not built.

Rules shared by the three order bodies below: every text field is trimmed of
outer spaces before it is checked (`clinical.dto.ts:23`), lengths count
characters after trimming, an optional field may be left out but `null` is
refused, and a field the body does not declare is refused with `400
VALIDATION_FAILED` (`services/ehr-api/src/common/validation.ts:3-9`,
`common/validation-pipe.ts:11-28`). `clinical.dto.ts` is
`services/ehr-api/src/ehr/shared/clinical.dto.ts`.

### R-1. Diagnoses: "ICD-10" and dotted codes

`POST /api/v1/ehr/patients/:patientId/encounters/:encounterId/diagnoses`
(`diagnoses.controller.ts:8,27`).

| Field | Required today | What is accepted | Source |
| --- | --- | --- | --- |
| `codeSystem` | Yes | Any text, 1 to 255 characters. There is no list and nothing checks it. `ICD-10` is stored exactly as sent. | `clinical.dto.ts:299-302`, `0004:180` |
| `code` | Yes | Any text, 1 to 100 characters. There is no pattern, so dotted codes such as `B50.9`, `O14.9` and plain ones such as `B54` are accepted. | `clinical.dto.ts:304-307`, `0004:181` |
| `display` | Yes | Any text, 1 to 500 characters. | `clinical.dto.ts:309-312`, `0004:182` |

- **Yes:** code system `ICD-10` exactly as written, and WHO codes with a dot,
  are accepted.
- **A diagnosis must have a code today.** A body without `code` gets `400
  VALIDATION_FAILED`, and the column is `NOT NULL` (`0004:181`). Free text is
  allowed for the name only. Until this changes, the screen should ask for a
  code, or say the diagnosis cannot be saved without one.
- Send the code system as `ICD-10`. The patient's own record chat leaves out
  sensitive diagnoses by their ICD-10 code only when the code system contains
  "ICD" (`services/ehr-api/src/ehr/patient-records/patient-evidence.policy.ts:135,156`);
  it also checks the name.
- The code and code system cannot be changed after saving
  (`UpdateDiagnosisDto`, `clinical.dto.ts:335-353`, has no code fields). A
  wrong code is corrected by marking the diagnosis entered in error and
  saving a new one.
- **Planned (0145, Release B):** ICD terminology search, and a diagnosis
  saved with a name and no code. It waits for owner question 8 (ICD-10
  licence or ICD-11). The route Akos suggested,
  `GET /api/v1/ehr/terminology/icd10`, does not exist today.

### R-2. Lab tests: "LOINC", and local codes for tests without one

`POST /api/v1/ehr/patients/:patientId/encounters/:encounterId/lab-requests`
(`lab-requests.controller.ts:14,41`).

| Field | Required today | What is accepted | Source |
| --- | --- | --- | --- |
| `testCodeSystem` | Yes | Any text, 1 to 255 characters. No list; nothing checks it. | `clinical.dto.ts:562-565`, `0004:242` |
| `testCode` | Yes | Any text, 1 to 100 characters. No pattern. | `clinical.dto.ts:567-570`, `0004:243` |
| `testDisplay` | Yes | Any text, 1 to 500 characters. | `clinical.dto.ts:572-575`, `0004:244` |
| `specimenTypeCode` | No | Any text up to 100 characters. | `clinical.dto.ts:584-588`, `0004:247` |

When the request is sent to the facility's own lab, Lab takes the same
lengths (`services/lab-api/src/lab/dto/accept-ehr-order.dto.ts:15-17`,
`0018:27-29`), so every request EHR saves can be sent.

- **Yes:** `LOINC` is accepted as the test code system (as text, like any
  other).
- **A test must have a code today.** A request with a name and no code gets
  `400 VALIDATION_FAILED`, and the column is `NOT NULL` (`0004:243`). So the
  13 tests the screen fills by name only are refused unless the clinician
  types a code.
- **Answer for tests with no LOINC code: use the local code system
  `HID-LAB`.** Send `testCodeSystem: "HID-LAB"`, the code from the table as
  `testCode`, and the name from the table as `testDisplay`. The codes are
  fixed: a code is never changed and never re-used for another test. They
  use only capital letters A to Z, digits and single hyphens. The same list is
  in `docs/codes/hid-lab-codes.json`, and `scripts/tests/hid-lab-codes.test.mjs`
  checks that its codes are unique and well formed and that this table matches
  it. The specimen is a plain-words suggestion; the screen may send it as
  `specimenTypeCode` (optional).

The list is every test in the screen's built-in list that has no LOINC code
(health repo, `main` at `14779584`,
`apps/patient-web/src/ehr-blue/clinical/parts/vocabulary.ts:77-104`). Akos's
note names three of them (malaria smear, Widal, genotype).

| HID-LAB code | Test name (`testDisplay`) | Specimen |
| --- | --- | --- |
| `MP-SMEAR` | Malaria parasite (blood film) | Blood (EDTA) |
| `MP-RDT` | Malaria rapid diagnostic test | Blood |
| `WIDAL` | Widal test | Serum |
| `URINALYSIS` | Urinalysis | Urine |
| `HB-GENOTYPE` | Haemoglobin genotype | Blood (EDTA) |
| `HIV-SCREEN` | HIV screening | Blood |
| `HBSAG` | Hepatitis B surface antigen | Serum |
| `HCV-AB` | Hepatitis C antibody | Serum |
| `EUCR` | Electrolytes, urea and creatinine | Serum |
| `LFT` | Liver function test | Serum |
| `LIPID-PROFILE` | Lipid profile | Serum |
| `STOOL-MICRO` | Stool microscopy | Stool |
| `SPUTUM-AFB` | Sputum for AFB | Sputum |

- Keep these names as they are. The patient's own record chat leaves out
  sensitive tests. For a code that is not LOINC it checks both the name and
  the code text against its word list (`patient-evidence.policy.ts:62-75,146-148`),
  and the database filter checks the name only
  (`patient-evidence.query.ts:120-121`). "HIV screening",
  "Hepatitis B surface antigen", "Hepatitis C antibody" and "Haemoglobin
  genotype" all match that list.
- **Planned (0144, Release B):** a lab test catalogue with LOINC codes, into
  which the HID-LAB codes move, and a lab request saved with a name and no
  code.

### R-3. Prescriptions: route words, frequency, medicine code

`POST /api/v1/ehr/patients/:patientId/encounters/:encounterId/prescriptions`
(`prescriptions.controller.ts:15,49`).

| Field | Required today | What is accepted | Source |
| --- | --- | --- | --- |
| `medicationDisplay` | Yes | Any text, 1 to 500 characters. | `clinical.dto.ts:368-371`, `0004:211` |
| `medicationCodeSystem` | No | Any text up to 255 characters. | `clinical.dto.ts:356-360`, `0004:209` |
| `medicationCode` | No | Any text up to 100 characters. | `clinical.dto.ts:362-366`, `0004:210` |
| `routeCode` | No | Any text up to 100 characters. There is no code list. | `clinical.dto.ts:384-388`, `0004:214` |
| `frequency` | Yes | Free text, 1 to 240 characters. | `clinical.dto.ts:390-393`, `0004:215` |
| `doseUnit` | No | Any text, 1 to 80 characters. | `clinical.dto.ts:378-382` |
| `instructions` | Yes | Free text, 1 to 4000 characters. | `clinical.dto.ts:395-398` |

- **`routeCode` takes plain words** such as "oral", "intravenous" or
  "intramuscular", up to 100 characters. No HL7 or SNOMED CT route list is
  checked, so the screen does not need to switch.
- **`frequency` is free text**, 1 to 240 characters: "Twice daily" and
  "Every 8 hours" are accepted as written.
- **The medicine code and its code system are optional.** A prescription can
  be saved with the generic name only.
- Leave an optional field out rather than sending an empty string. EHR
  accepts `""` for `routeCode`, `medicationCode` and `medicationCodeSystem`
  (only a maximum is checked), but EHR passes the value on unchanged when the
  prescription is sent to the facility's pharmacy
  (`prescriptions.service.ts:347-352`), and Pharmacy needs at least one
  character in each (`services/pharmacy-api/src/pharmacy/dto/accept-ehr-prescription.dto.ts:13-14,18`,
  `0023:63-64,68`). Such a prescription could not be sent.
- The medicine and route cannot be changed after saving. An update changes
  only status, frequency (1 to 240), instructions and end date
  (`UpdatePrescriptionDto`, `clinical.dto.ts:499-530`).
- **Planned (0144, Release B):** formulary search from the catalogue.

### R-4. Rate limits on the pages the drawers re-read

**Answer: yes, one extra read when a drawer closes stays inside every limit.**
No per-route limit applies to the reads a page makes (visits, vitals,
diagnoses, notes, lab requests, prescriptions, allergies, access requests,
registration cases, pharmacy work items). [backend detail omitted]

Every limit on the path from the website to the services:

| Where | What is limited | Limit | Counts a drawer re-read? | Source |
| --- | --- | --- | --- | --- |
| [backend detail omitted] | | | | |
| Gateway | Patient record chat `POST /api/v1/ehr/me/chat` and support chat `POST /api/v1/support/chat` | [backend detail omitted], then `429` | No | [backend detail omitted] |
| Gateway | Staff record chat `POST /api/v1/ehr/patients/:patientId/chat` | [backend detail omitted], then `429` | No | [backend detail omitted] |
| Identity | Health ID lookups answered `404` (no such patient, or a patient this facility may not see) | [backend detail omitted] (never `429`). | No | [backend detail omitted] |
| Identity | Order destination search `GET /api/v1/identity/order-destinations` | [backend detail omitted], then `429` | No: it is a typed search, not re-read when a drawer closes | [backend detail omitted] |
| Identity | Emergency access activation | [backend detail omitted], then `429 EMERGENCY_RATE_LIMITED` | No | [backend detail omitted] |
| EHR | Sending orders to another facility | [backend detail omitted], then `429` | No | [backend detail omitted] |
| Services | Other actions: sign-in and sign-up codes, enrolment, invitations, outreach sign-up and Health IDs, contact changes, share searches, shares and share invitations, web push, offline key escrow, the patient record chat, and accepting, correcting or ending orders at Lab and Pharmacy | Each its own limit, then `429` (or `404` as above) | No: none of these is a page read | [backend detail omitted] |
| Gateway and services | The page reads listed above | None | — | [backend detail omitted] |

[backend detail omitted] Re-reading only after a drawer saved something keeps the load lower
still.

### P2-5. Coding systems and FHIR today

- **No code checking.** Diagnoses, lab tests and medicines accept any code
  system and any code as text, within the lengths in R-1 to R-3. ICD-10,
  ICD-11, SNOMED CT, LOINC and HID-LAB are all accepted the same way; none is
  looked up or checked against a code list.
- Code systems are read in one place only: the patient's own record chat
  recognises LOINC (`patient-evidence.policy.ts:78-98`) and ICD
  (`patient-evidence.policy.ts:134-135,156`) to leave out sensitive tests and
  diagnoses.
- **No FHIR API.** No service on this branch has a FHIR route or returns
  FHIR resources.
- **Planned:** the lab test catalogue with LOINC and HID-LAB codes (0144) and
  ICD terminology search (0145, after owner question 8: ICD-10 licence or
  ICD-11). The 18 Nov build plan has no FHIR item.

### P2-6. Where data is kept, and compliance

Facts, as configured:

| Topic | Fact | Source |
| --- | --- | --- |
| Region | Production runs in AWS `eu-west-1` (Ireland), in two zones, `eu-west-1a` and `eu-west-1b`. Releases deploy there. | `infra/terraform/environments/production.tfvars:19,50` (dev); `scripts/production_deployment_core.py:21` |
| Database | PostgreSQL 16 on RDS, not reachable from the internet, storage encrypted with its own KMS key (key rotation on), a standby copy in a second zone, automated backups kept 30 days. | `infra/terraform/modules/data/main.tf:2-6,368-394` (dev); `infra/terraform/variables.tf:125-128` (dev); `production.tfvars:301` (dev) |
| Documents | S3, encrypted with a KMS key, versioned, all public access blocked. | `modules/data/main.tf:75-108` (dev) |
| In transit | The public and internal load balancers listen only on HTTPS, with the TLS 1.2 and 1.3 policy. [backend detail omitted] The database refuses connections without TLS (`rds.force_ssl`), and services connect with the RDS certificate. | [backend detail omitted] |
| [backend detail omitted] | | |
| Logs | Application logs are kept 90 days, Identity and security logs 365 days. | [backend detail omitted] |

Data that leaves `eu-west-1`, as configured:

| What | Where it goes | Source |
| --- | --- | --- |
| Record chat (the patient's "ask about my records" and staff "Ask about this patient"): text from the record | The Claude API, processed in the United States | `production.tfvars:257-261` (dev); `services/ehr-api/src/ehr/patient-records/claude-ai.service.ts:197-202` |
| Paper records read for Migrate: text read from the page | The Claude API, processed in the United States | `production.tfvars:262-265` (dev); `services/ocr-worker/src/reading/claude.client.ts:12-13`, `services/ocr-worker/src/config.ts:73` |
| Error reports | Sentry, EU (Germany) host; scrubbed errors only | `production.tfvars:303-307` (dev) |
| NIN checks | QoreID | `production.tfvars:46` (dev) |
| Notifications | Novu (`api.novu.co`), with email through Brevo | `production.tfvars:26-27` (dev) |
| Google sign-in | Google | `production.tfvars:44` (dev) |
| Every website and API request | Cloudflare, in front of AWS | this contract, "Current browser and notification boundary" |

This repository does not record where QoreID, Novu, Brevo, Google or
Cloudflare keep data.

Not done, said plainly:

- **No in-country hosting.** All Health ID data is kept in one AWS region,
  `eu-west-1` (Ireland), not in Nigeria. There is no option today to keep a
  country's data in that country, and the 18 Nov build plan has no item for
  it (it lists P2-6 among the gaps no design covers yet).
- **Certification is held outside this repository.** Health ID told us on
  19 Nov 2026 that it holds NDPA (formerly NDPR) certification, and that the
  service is aligned with GDPR and HIPAA. The certificate and any assessment
  papers are kept by Health ID, not here; ask Health ID for them. When you
  describe this to buyers, use exactly those words: "NDPA certified" and
  "GDPR- and HIPAA-aligned". Do not say "GDPR certified" or "HIPAA certified".
- [backend detail omitted]

## EHR-C4: chart summary

Akos P1-1 and N-11 (wave 1, lane C). ehr-api only; no migration, no new
permission, no new grant, no new setting. One call returns the sections a
doctor's chart opens with. Each section follows the rules of the route that
already reads it; nothing here lets anyone read more than those routes allow.

### `GET /ehr/patients/:patientId/chart-summary`

`patientId` is the patient's UUID (never a Health ID). `Cache-Control:
no-store`. The caller needs at least one of `ehr.encounter.read`,
`ehr.diagnosis.read`, `ehr.prescription.read`, `ehr.lab-request.read`,
`ehr.vital.read` or `ehr.note.read`, or the answer is `403
PERMISSION_DENIED`. `X-Purpose-Of-Use` is `direct-care` or `emergency`; any
other value is `400 PURPOSE_OF_USE_REQUIRED`.

Each section is included only when the caller holds the permission of the
route that reads it today:

| Section | Permission | What it holds | At most |
| --- | --- | --- | --- |
| `demographics` | `identity.patient.read` | `patientId`, `fullName`, `firstName`, `lastName`, `dateOfBirth`, `gender` (the patient card Identity already gives the EHR; no Health ID, no NIN) | 1 |
| `problems` | `ehr.diagnosis.read` | diagnoses that are `active`, `recurrence` or `relapse`, not `refuted` or `entered_in_error`, newest first | 50 |
| `medications` | `ehr.prescription.read` | prescriptions `active` or `on_hold`, not ended before today (Lagos), newest first, each with `ownProgress` (ORD-3) | 50 |
| `allergies` | `ehr.note.read` | active recorded allergies (any facility, most serious first, `recordedHere`) and the patient's own allergy text, as the emergency read answers them | 200 |
| `latestVitals` | `ehr.vital.read` | exactly the EHR-C3 answer (`facilityId`, `measures`) | 7 measures |
| `recentVisits` | `ehr.encounter.read` | this facility's visits, newest first | 10 |
| `openLabRequests` | `ehr.lab-request.read` | lab requests `active` or `on_hold`, newest first, each with `ownProgress` (ORD-3) | 50 |
| `recentResults` | `lab.result.released.read` | the newest, by release time, of the released results the summary reads from Lab (see `complete` below) | 10 |

Lists answer `{ "items": [...], "more": true | false }`; `more` says there
were more than the limit. `recentResults` also has `complete` (false when Lab
had more pages than the summary reads: at most 5 pages of 200). Lab gives its
pages in record order, not by time. So when `complete` is false (more than
1,000 released results), the items are the newest of the 1,000 read, and may
not be the patient's newest results. The pages are read one after another,
each with the Lab client's own 10-second limit, and the summary sets no
overall limit on them: a slow Lab can make the whole answer slow, though a
Lab that fails or times out only leaves `recentResults` out as
`unavailable`.

Each section reads the same records as its own route: this facility's
visits, diagnoses, prescriptions, lab requests and vitals; the patient's
allergies from any facility, as the allergy list does; and the results Lab
gives the EHR, as the staff record does. Anything entered in error is left
out: a visit entered in error, and every diagnosis,
prescription, lab request and vital recorded in it; a diagnosis or allergy
entered in error; a prescription or lab request entered in error, cancelled
or completed.

Answer `200`:

```json
{
  "patientId": "<uuid>",
  "facilityId": "<uuid>",
  "purposeOfUse": "direct-care",
  "limits": { "recentVisits": 10, "problems": 50, "medications": 50, "openLabRequests": 50, "allergies": 200, "recentResults": 10 },
  "sections": {
    "demographics": { "patientId": "<uuid>", "fullName": "...", "firstName": "...", "lastName": "...", "dateOfBirth": "1990-01-01", "gender": "female" },
    "problems": { "items": [{ "id": "<uuid>", "encounterId": "<uuid>", "codeSystem": "ICD-10", "code": "B50.9", "display": "...", "clinicalStatus": "active", "verificationStatus": "confirmed", "onsetAt": null, "notes": null, "createdAt": "..." }], "more": false },
    "medications": { "items": [{ "id": "<uuid>", "encounterId": "<uuid>", "medicationDisplay": "...", "medicationCodeSystem": null, "medicationCode": null, "doseQuantity": "1", "doseUnit": "tablet", "routeCode": "oral", "frequency": "...", "instructions": "...", "startsOn": "2026-11-18", "endsOn": null, "status": "active", "createdAt": "...", "ownProgress": { "status": "dispensed", "receivedAt": "...", "dispensedAt": "...", "reversedAt": null } }], "more": false },
    "allergies": { "recorded": [{ "source": "recorded", "id": "<uuid>", "substance": "...", "reaction": "...", "severity": "severe", "recordedHere": true, "recordedOn": "..." }], "patientReported": { "source": "patient_reported", "allergies": null, "updatedAt": null } },
    "latestVitals": { "facilityId": "<uuid>", "measures": { "pulseBpm": { "value": 76, "recordedAt": "...", "vitalId": "<uuid>", "encounterId": "<uuid>", "corrected": false } } },
    "recentVisits": { "items": [{ "id": "<uuid>", "encounterNumber": "...", "encounterType": "ambulatory", "status": "in_progress", "startedAt": "...", "endedAt": null, "chiefComplaint": "...", "importedPaperRecords": false }], "more": false },
    "openLabRequests": { "items": [{ "id": "<uuid>", "encounterId": "<uuid>", "testCodeSystem": "HID-LAB", "testCode": "MP-SMEAR", "testDisplay": "...", "priority": "routine", "status": "active", "specimenTypeCode": null, "clinicalInformation": null, "createdAt": "...", "ownProgress": { "status": "received", "receivedAt": "...", "collectedAt": null, "lastResultAt": null } }], "more": false },
    "recentResults": { "items": [{ "id": "<uuid>", "version": "...", "title": "...", "recordedAt": "...", "effectiveAt": "...", "fields": {} }], "more": false, "complete": true }
  },
  "leftOut": [
    { "section": "recentResults", "reason": "unavailable", "message": "This part of the chart could not be loaded just now. Try again in a moment." }
  ]
}
```

### Sections left out

A section that is not in `sections` is listed in `leftOut` with a reason and
a plain sentence to show:

| `reason` | When | `message` |
| --- | --- | --- |
| `permission` | the caller does not hold the section's permission, or the other service (Identity or Lab) refused (`403`) | "You do not have permission to see this part of the chart." |
| `permission` | an emergency read (below), for every section it does not show | "Emergency access shows allergies and past visits only. This part of the chart is not shown." |
| `unavailable` | Identity or Lab could not be reached, timed out or answered something unexpected | "This part of the chart could not be loaded just now. Try again in a moment." |

When the pharmacy or the laboratory cannot tell the progress of an item, the
section is still answered, each such item carries `ownProgress: { "status":
"unknown" }` (as on the per-visit lists), and `leftOut` lists
`medications.ownProgress` ("Pharmacy progress could not be loaded just now.
The medicines are shown without it.") or `openLabRequests.ownProgress`
("Laboratory progress could not be loaded just now. The lab requests are
shown without it."), reason `unavailable`. A laboratory that is down never
fails the answer.

### Consent and audit

One consent check for the whole call, the same as every EHR read: Identity
decides `read_records` for this patient, member, facility and purpose, and
the database applies its own row checks as well. Without consent the answer
is `403 CONSENT_REQUIRED`, [backend detail omitted], and nothing is read. [backend detail omitted]

The patient card and the results are read after that, from Identity and Lab,
through the reads the staff record chat already uses. Identity and Lab check
access themselves, [backend detail omitted] The
pharmacy and laboratory progress is read the same way the per-visit lists
read it.

### Emergency (break-glass)

With `X-Purpose-Of-Use: emergency`, the summary shows exactly what the
emergency read (`GET /ehr/patients/:patientId/emergency-records`) shows
today, under the same rules: the caller needs both `ehr.encounter.read` and
`ehr.note.read` (else `403 PERMISSION_DENIED`), and an active break-glass
grant (else `403 CONSENT_REQUIRED`, [backend detail omitted]). It answers
`allergies` and `recentVisits` (completed visits at this facility, with the
emergency read's columns: no chief complaint); every other section is in
`leftOut` with reason `permission`. [backend detail omitted]

### Screen change needed (Akos frontend branch)

"Open chart" calls this route once per patient and shows each section in
`sections`. For each entry in `leftOut`, show its `message` where that
section would be. Re-read after a drawer closes, as the per-section lists
are.

## EHR-C5: one-call consultation

Akos N-5 ("Start consultation" saves only the complaint; "Save the rest" is
needed for the diagnosis and the notes). ehr-api only; no migration, no new
grant, no new setting. [backend detail omitted]
Prescriptions and lab requests are not part of this call; they keep their own
routes. Draft auto-save (EHR-C6, 0141) is separate.

### `POST /ehr/patients/:patientId/consultations`

`patientId` is the UUID (never a Health ID or NIN). Headers as for every
clinical write: `X-Facility-ID`, `X-Purpose-Of-Use: direct-care` and an
`Idempotency-Key` (16 to 128 URL-safe characters, otherwise `400
IDEMPOTENCY_KEY_REQUIRED`).

Body (each part is exactly the body of its own route, with the same
validation; an unknown field is `400 VALIDATION_FAILED`):

```json
{
  "visit": { "encounterType": "ambulatory", "status": "in_progress", "startedAt": "2026-11-18T09:30:00.000Z",
             "chiefComplaint": "Fever for two days" },
  "note": { "noteType": "consultation", "title": "Consultation", "status": "signed", "content": "..." },
  "vitals": { "recordedAt": "2026-11-18T09:35:00.000Z", "temperatureC": 38.4, "systolicMmhg": 120, "diastolicMmhg": 80 },
  "diagnoses": [ { "codeSystem": "ICD-10", "code": "B50.9", "display": "Malaria", "clinicalStatus": "active",
                   "verificationStatus": "provisional" } ]
}
```

- `visit` (required): the body of `POST .../encounters`. A consultation is
  always saved on the open visit today (EHR-C1): `reuseOpenVisit` may be
  left out or be `true`; `false` is `400 CONSULTATION_USES_OPEN_VISIT` ("A
  consultation is saved on the open visit today. Leave out reuseOpenVisit or
  set it to true."). The EHR-C1 rules apply unchanged: `status` `planned` or
  `in_progress` (`400 REUSE_OPEN_VISIT_NEEDS_OPEN_STATUS`), `startedAt` on
  today's Lagos day (`400 REUSE_OPEN_VISIT_STARTED_AT_NOT_TODAY`), and the
  same transaction lock for this patient at this facility, taken before the
  lookup. If the patient has an open visit today it is used and nothing new
  is created; otherwise the visit is created.
- When the open visit today is used (`encounter.reusedOpenVisit: true`), the
  `visit` fields sent (`chiefComplaint`, `encounterType`, `startedAt` and the
  rest) are not saved: the open visit keeps the values it already has, and
  the answer shows those. The complaint the doctor typed is then not on the
  visit. Put it in the note, or save it as a visit edit (`PATCH
  .../encounters/:encounterId`, which needs a typed reason for a complaint
  change) after this call. This is the EHR-C1 rule;
  the call does not refuse or warn about it.
- `note` (optional): the body of `POST .../clinical-notes`, `draft` or
  `signed`. A note signed here needs no reason (FR-1: a first signature never
  does).
- `vitals` (optional): the body of `POST .../vitals`, with the same checks
  (`400 VITAL_MEASUREMENT_REQUIRED`, `400 BLOOD_PRESSURE_INCOMPLETE`).
- `diagnoses` (optional): up to 20 bodies of `POST .../diagnoses`. A code is
  still required (Wave 0 R-1).

### All or nothing

Every part is saved in ONE database transaction. If any part is refused (a
diagnosis the database refuses, the visit entered in error, and so on), no
part is saved: no visit, note, vitals, diagnosis, Idempotency-Key row or
part's audit row. [backend detail omitted] The answer is the refused part's
own error (for example `400 INVALID_CLINICAL_DATA`, `409
VISIT_ENTERED_IN_ERROR`). It does not always say which part was refused: a
database refusal such as `400 INVALID_CLINICAL_DATA` names no part, and a
validation error inside a part names only that part's top-level field
(`visit`, `note`, `vitals` or `diagnoses`), not the field within it. The
same Idempotency-Key can then be sent again with the corrected body.

### Permissions and consent

Permission `ehr.encounter.write` always, plus the write permission of each
part sent: `ehr.note.write` for `note`, `ehr.vital.write` for `vitals`,
`ehr.diagnosis.write` for a non-empty `diagnoses`. If one is missing, the
whole call is `403 PERMISSION_DENIED` ("Required permission is missing")
before the body is validated and before anything is read or saved. [backend detail omitted] Consent is checked once, as for each
part's own route (`write_records` for this patient; `403 CONSENT_REQUIRED`
otherwise). The checks each part's own route makes before the database
(above) also run before the consent check, except the `startedAt` day
check, which runs after it (Idempotency-Key, below).

### Answer

`201`:

```json
{
  "encounter": { "...visit...": "...", "reusedOpenVisit": true },
  "note": { "...note, as POST .../clinical-notes answers...": "..." },
  "vitals": { "...vitals, as POST .../vitals answers...": "..." },
  "diagnoses": [ { "...diagnosis, as POST .../diagnoses answers...": "..." } ]
}
```

`note` and `vitals` are `null` and `diagnoses` is `[]` when not sent.
`encounter.reusedOpenVisit` is `true` when the open visit today was used and
`false` when this call created the visit (EHR-C1).

### Idempotency-Key

Required. The same key with the same body answers the saved consultation
again (`201`, the same visit, note, vitals and diagnoses, as they are now;
`reusedOpenVisit` as first answered) and saves nothing new. A body that
differs only by `reuseOpenVisit: true` is the same body. The same key with
another body is `409 IDEMPOTENCY_KEY_REUSED`; while the first request with
the key is still running, the second waits for it, as on every clinical
create. A retry after Lagos midnight, when `startedAt` is no longer today,
is answered the same way from its key; only a consultation not yet saved
under its key gets `400 REUSE_OPEN_VISIT_STARTED_AT_NOT_TODAY`. That check
now runs after the consent check, so without consent such a request is
`403 CONSENT_REQUIRED`. A key, once used, keeps answering this consultation
(or `409` for another body) for as long as its row exists: the rows are
never deleted and the check does not look at their expiry time. Use a fresh
key for each new consultation. The key is stored once for the
whole call (operation `consultation.create`) and once per part
(`consultation.encounter`, `consultation.clinical-note`,
`consultation.vital`, `consultation.diagnosis.1` to `.20`), so a key used on
a single route never clashes with a consultation.

### Audit

[backend detail omitted]

### Screen change needed (Akos frontend branch)

"Start consultation" sends the visit, note, vitals and diagnoses in this one
call with a fresh Idempotency-Key per consultation (kept for a retry of the
same save), instead of creating the visit first and asking for "Save the
rest". On an error, nothing was saved. Show the error's message; when it
names a part (`visit`, `note`, `vitals` or `diagnoses`), show it with that
section. After a `201` with `encounter.reusedOpenVisit: true`, the complaint
typed in "Start consultation" is not on the visit (above): save it as a
visit edit, or put it in the note before sending.

## SX-1: modules map per facility

Akos N-2b, N-2e and P1-5 (wave 1, no migration, no new setting). The session
answer already lists each facility's `roles` (every active role of the
membership) and `permissions`. Each facility now also carries `modules`: the
product areas the screens should show at that facility, so the website can
hide what a role cannot use. The server still checks every route on its own;
`modules` changes no permission and refuses nothing.

### Where it appears

`actor.facilities[*].modules` and, when a facility is selected,
`actor.facility.modules`, in these `{ actor, ... }` session answers of
identity-api: `POST /api/v1/auth/login`, `POST /api/v1/auth/oidc/exchange`
(Google sign-in), `POST /api/v1/auth/refresh`, `GET /api/v1/auth/session`,
`POST /api/v1/auth/facility` and the workload
read of the same answer (`GET` and `POST /api/v1/auth/service-session`).

- `modules` is added after every existing field of the facility. Every
  other field is unchanged, `roles[0]` (and so `actor.role`) included, and
  so is the order of the actor's fields.
- A patient session and an account-only outreach session have no facility,
  so their answers are unchanged, byte for byte.
- It is not an access-token claim and is not stored: it is worked out from
  the facility's `permissions` each time the answer is built.
- `POST /api/v1/auth/google/link` answers `{ linked: true }` to a patient
  session, with no actor, so it has no `modules`.
- Three routes that sign staff in answer an `actor` without `modules`,
  unchanged: `POST /api/v1/identity/provider-enrollments/activate` (a new
  administrator), `POST /api/v1/identity/outreach-organisers/activate` and
  `POST /api/v1/identity/outreach-invitations/accept` (outreach
  memberships). After them the website reads `GET /api/v1/auth/session`,
  which carries `modules`.

### The map

Every key is always present, `true` (show the area) or `false` (hide it), in
this order. Each area is shown when the facility's `permissions` hold every
code in the "Shown when the facility holds" column. These are the codes the
area's routes already require.

```json
{
  "patients": true, "registration": false, "accessRequests": true, "emergencyAccess": true,
  "triage": true, "consultation": true, "orders": true, "lab": false, "labResults": true,
  "pharmacy": false, "prescriptions": true, "migrate": true, "outreach": true,
  "admin": false, "audit": false
}
```

| Key | Akos's row | Shown when the facility holds |
| --- | --- | --- |
| `patients` | Find patient | `identity.patient.read` |
| `registration` | Register and check in | `identity.registration.write` |
| `accessRequests` | Access requests and PIN | `identity.consent.write` |
| `emergencyAccess` | Emergency access | `identity.consent.write` and `identity.break-glass.write` |
| `triage` | Triage and vitals (and Nursing observations) | `ehr.vital.read` |
| `consultation` | Consultation and diagnosis | `ehr.diagnosis.read` |
| `orders` | Order labs and prescribe | `ehr.lab-request.write` and `ehr.prescription.write` |
| `lab` | Lab queue and results entry | `lab.result.enter` |
| `labResults` | Lab results | `lab.result.released.read` |
| `pharmacy` | Dispense medicines | `pharmacy.dispensing.create` |
| `prescriptions` | Prescriptions | `ehr.prescription.read` |
| `migrate` | Scan paper records | `ocr.job.read` and `ocr.publication.write` |
| `outreach` | Outreach | `outreach.campaign.read` |
| `admin` | Facility profile and staff | `workforce.manage` |
| `audit` | The "View (audit)" cells | `audit.read` |

- The map is a pure function of the facility's own `permissions`
  (`services/identity-api/src/auth/facility-modules.ts`): the same codes
  always give the same map, whatever their order. A membership with two
  roles shows what either role shows.
- Akos's row "Nursing observations" has no key: no permission tells it apart
  from "Triage and vitals" today, so the screens use `triage` for both.
- P1-5: doctor, clinician, nurse, receptionist, lab and pharmacist never hold
  `workforce.manage` or `audit.read`, so `admin` and `audit` are `false` for
  them. A facility administrator (admin, org_admin, and the administrator
  awaiting review) sees both.
- The map shows what today's role rows allow, not Akos's proposed table. For
  example a doctor's `registration` is `true`, because the doctor role holds
  `identity.registration.write` today. The role rows change only in a later
  migration that the owner picks from the matrix below (0136).

Example answers for today's seeded roles (fictional facility):

| Role | Areas shown (`true`) |
| --- | --- |
| receptionist | patients, registration, accessRequests, outreach |
| nurse | patients, registration, accessRequests, emergencyAccess, triage, consultation, labResults, prescriptions, migrate, outreach |
| doctor, clinician | the nurse's areas and orders |
| lab | patients, accessRequests, lab, labResults |
| pharmacist | patients, accessRequests, pharmacy, prescriptions |
| admin | registration, labResults, outreach, admin, audit |
| org_admin | registration, outreach, admin, audit |
| outreach organiser or volunteer | outreach |

### The role matrix (Akos's table against today's role rows)

`services/identity-api/test/role-matrix.json` is Akos's proposed table,
checked in. The jest test `src/auth/role-matrix.spec.ts` compares each role's
seeded permissions [backend detail omitted] with the table, one row at a time through the areas above, and names
each difference: **wider** (today gives more than the table) or **narrower**
(today gives less). Today's middle level is written "shown, without" the
area's missing codes, not "view only": an area is shown when its show codes
are held, and some of those are writes (`identity.consent.write` for access
requests). Today there are 20, recorded in the fixture's `todayDifferences`,
for example:

- `receptionist (Front desk), Access requests and PIN: narrower. Today shown, without identity.patient-access-pin.verify; Akos's table full.`
  (the front desk can already make access requests, a write, but cannot check a patient's PIN)
- `doctor (Doctor), Register and check in: wider. Today full; Akos's table hidden.`
- `lab (Lab), Find patient: wider. Today full; Akos's table with lab orders only.`

The test passes today. It fails when a migration adds or removes a
[backend detail omitted] for a role of the table (`todayRolePermissions` pins
every seeded code of receptionist, nurse, doctor, clinician, lab, pharmacist,
admin and org_admin) or when the differences change, until the same pull
request updates the fixture. Packages that add role rows (0131, 0133, 0134,
0136) update it.

Clinician is compared with Akos's Doctor column (it holds the same codes
today); admin and org_admin with the Facility admin column.

### Audit

[backend detail omitted]

### Website (Akos frontend branch, not changed here)

Read `actor.facility.modules` (or the chosen facility's entry in
`actor.facilities`) and hide each menu item and home tile whose key is
`false`; P1-5 hides Facility settings when `admin` is `false`. Treat a
missing `modules` (an older backend) as today: show what is shown now.
