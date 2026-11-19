# HID Interface Contract: EHR sections (copy)

> Source: `docs/INTERFACE_CONTRACT.md` in the backend repository D-Eminence/hid-system, branch `staging-novu-ci-20261005`, commit `092cd248566aaedee897910ded783c7826c79b98` (19 Nov 2026).

This is a reviewed copy of the live contract sections the EHR screens use, for frontend developers who cannot open the backend repository. The backend repository is the source of truth; see [README.md](README.md).

- Only the sections below are copied: the ones named in the EHR message, plus section 53, which SX-5 cites. They keep their original headings and their order in the source file.
- Section text is copied exactly. Where the source held backend detail that is not shared outside the backend team, the text reads "[backend detail omitted]".
- Some paragraphs and subsections are omitted whole and read only "[backend detail omitted]", so a "below" or "above" in the kept text can point at an omitted part. Ask the coordinator if you need to know what it says.
- Other sections of the source (for example sections 21-24, 44 or 46, or "Current browser and notification boundary") are not copied here. Labels such as ID-2, ID-4, EHR-C7 or 0132 are Release A sections, which reach the live contract once signed. Labels such as EHR-C6, EHR-C8b, SX-6 or SX-7 are in [EHR_PLANNED_CONTRACT.md](EHR_PLANNED_CONTRACT.md). For anything not here, ask the coordinator.
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
