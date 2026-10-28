# Frontend architecture

This document describes the code in this repository and the `hid-system`
gateway/API, first audited at commit `c4b5445` and most recently checked
against `main` at `6b49a06` on 2026-10-12 (with open D-Eminence/hid-system#47
at `1c18e91`). hid-system `main` has since moved to `bbc6e89` (hid-system#48 to
#53 and #55 to #62, merged on 2026-10-12, none released); where those change a
statement below, it says so. Those statements, and what the hid-system
alignment PR (Health-id #49, merged as `cf32087` after Health-id #48) does with these
changes, were checked against `bbc6e89` on 2026-10-13. It supersedes the
earlier plan based on the historical `hid-unified` Supabase functions.
`hid-1.0`, `Dashboard.zip` and `HID.html` informed visual and workflow coverage; their local fixtures do not
define API behavior. The [gap map](./HEALTH_ID_COMPLETE_FRONTEND_GAP_MAP.md)
records that baseline audit and should not be read as today's completion list.
The hid-system work this frontend depends on is in the
[backend hand-off](./BACKEND_OWNER_HANDOFF.md), cited by item id (A1, B1, C1,
D1, E1, F1 and so on) here and in [open questions](./OPEN-QUESTIONS.md).

## Deployment shape

```text
Public browser  → public-web origin → /api/v1 → hid-system gateway → services
Portal browser  → one portal origin → /api/v1 → hid-system gateway → services
```

`apps/public-web` is the Next.js public website. It owns the audience pages,
product descriptions, pricing and demo request flow. `apps/patient-web` is the
Vite authenticated portal. All signed-in workspaces share **one portal origin**:

| URL prefix | Workspace | Main implemented areas |
| --- | --- | --- |
| `/`, `/sign-in`, `/enroll`, `/recover` | Patient | Enrollment, session/recovery, profile and NIN re-verification, records, access, notifications, settings |
| `/provider/*`, `/provider/recover` | Provider | Session/facility selection, patient lookup and access, registration-case review, clinical work, laboratory, pharmacy, OCR, outreach, facility audit and recovery |
| `/admin/*`, `/admin/recover` | Platform | MFA sign-in and enrolment; overview (backend totals and waiting work); organization applications (verify, approve, reject); facilities (filters, paging and a linkable detail page); users and roles (with export, session review and two-person requests); approvals; identity reviews; audit (backend filters); my security (MFA, recovery codes, sessions); service health; integrations (settings, history, routes); platform controls; pricing; demo requests; and recovery |

Each area restores the shared backend cookie session and applies its own
permission checks. The backend remains the
authority for access control. Unsupported modules from the reference material
are not represented by local fixture data or simulated mutations. The public site's
`/provider/apply` page sends providers to the portal's `/provider/enroll`,
which uses the self-service provider-enrollment routes, and `/provider/complete`
uses the completion routes. The public site has no organization application
form: the unused `ProviderApplicationForm` was removed, so no screen calls
`POST /api/v1/identity/organization-applications`, though the route stays
registered.

The public site can link to a separately hosted portal through
`NEXT_PUBLIC_HID_PORTAL_ORIGIN`. That variable names the one portal origin for
patients, providers and admins; it does not imply separate provider or admin
deployments. Production routing and hostnames still need to be configured and
verified. Local development uses ports 3100 and 3200 for the two apps, with
`/api/v1/*` forwarded to the local gateway on port 3000. Both apps use their own
origin as the browser API base URL. The Vite/Next development proxies do not
configure a production proxy.

## Request and contract path

```text
screen → area API module → registered browser client → @hid/http → /api/v1
```

`packages/contracts/src/registry.ts` records audited gateway routes and
methods. The browser client in `packages/api` rejects unknown routes and
backend-internal endpoints; app-scoped route checks apply the declared service
grants. `packages/api` also contains typed service modules for shared use.
`packages/http` owns URL construction, request timeout/cancellation, limited
read retries, no-store requests, CSRF/cookie handling, correlation IDs and
Problem Details error parsing. Neither route registration nor a frontend guard
grants permission: the backend checks the current principal, facility and
permission on every protected request.

The public pricing page reads `GET /api/v1/commercial/pricing`, and the demo form
submits to `POST /api/v1/commercial/demo-requests` with Turnstile and an
idempotency key. A `null` price is a quote, not an amount that the frontend can
invent; a catalogue row for a product the site does not present is left out,
and a malformed row refuses the whole catalogue. The demo form holds the
contact role to the 2 to 120 characters `CreateDemoRequestDto` accepts and
reuses one `Idempotency-Key` when a submission is retried. Patient, provider
and admin requests use the actual Identity, EHR, Access, Lab, Pharmacy, OCR,
Outreach and Admin endpoints registered for their routes. The laboratory
workspace covers work items, accession, specimen custody, analytical
execution, result revisions (with each revision's release time, sent since
hid-system#51), verification, release and history. The clinical workspace
creates EHR lab requests and hands active prescriptions to Pharmacy. In every
released hid-system build EHR sends a lab request to Lab only when it is
created active, and passes neither a later prescription or lab-request change
nor an encounter's status to Pharmacy or Lab (hand-off A1, A3). hid-system
`main` (`bbc6e89`, not released) changes part of this:

- Pharmacy accepts only the exact active prescription version EHR checked
  (`409 PHARMACY_PRESCRIPTION_NOT_ELIGIBLE`) and dispenses only while the
  prescription is still active at the version it accepted
  (`409 PHARMACY_PRESCRIPTION_NOT_DISPENSABLE`), by a database guard
  (hid-system#48, migration 0080). Pharmacy has always kept one work item per
  prescription, so a prescription changed after its handoff, a resumed hold
  included, cannot be sent again (`409 IDEMPOTENCY_CONFLICT`); with the guard
  its work can no longer be dispensed either, and stays listed as accepted
  (hand-off A1, E18).
- EHR sends a lab request to Lab after any change that leaves it active
  (activating a draft, resuming a held request), but only for an actor holding
  `lab.work-item.accept` (otherwise `labHandoff` is `not_sent`), and reports
  the outcome as `labHandoff`. `POST …/lab-requests/:requestId/lab-work-item`
  sends a saved active request again; it needs `ehr.lab-request.write` and
  `lab.work-item.accept` (hid-system#56). Lab keeps one work item per request,
  at the version it accepted: a later change comes back as `already_accepted`
  and is not in Lab, and holding, cancelling, completing or marking entered in
  error a request Lab accepted is not sent at all (hand-off A3). A create that
  Lab refused or did not confirm answers `409 LAB_HANDOFF_REFUSED` or
  `502 LAB_HANDOFF_UNCONFIRMED` after the request is saved and active
  (hand-off A25).
- Lab serves the released results of the work item accepted from an EHR lab
  request (`GET /lab/ehr-orders/:sourceEhrOrderId/released-results`, with
  `lab.result.released.read`) and audits each read (hid-system#51).

Since the hid-system alignment PR (Health-id #49) the portal uses these, and handles the
answers of a build without them. A role holding `lab.work-item.accept` may
create an active request, activate a draft ("Activate and send to Lab"),
resume a held request ("Resume and send to Lab") and send a saved active
request again (Send to Lab, one `Idempotency-Key` per attempt). Any other role
may create only drafts, and a note under each request says who can do more.
Each `labHandoff` state is said. A create answered with `LAB_HANDOFF_REFUSED`
or `LAB_HANDOFF_UNCONFIRMED` is treated as the saved request it is: the list is
read again, the form and its key clear, and focus moves to that request's Send
to Lab. An active or held request is offered no other change, and its note
says those changes do not reach Lab. Each request that may have reached Lab
(any but a draft) offers "View released results" to a reader with
`lab.result.released.read`, read only when opened. The status form of an
active or held prescription says that Pharmacy is not told, that the pharmacy
must be contacted if the prescription was sent, and that Pharmacy may refuse
to dispense it after the change, even once resumed: true with or without
migration 0080, which no response reveals. Pharmacy marks work "Not
dispensable" once a dispensing is refused with
`PHARMACY_PRESCRIPTION_NOT_DISPENSABLE`, until the page is reloaded. Since
hid-system#64 (migration 0084) a change of encounter status also closes the
encounter's records. Cancelling cancels its draft, active and on-hold
prescriptions and lab requests and changes nothing else. Since hid-system#74
(migration 0090) entered in error marks its notes, diagnoses and final vitals,
its draft, active, on-hold and completed prescriptions and lab requests, and
its initiated or uploaded documents entered in error. The encounter status form
says so, and says that Pharmacy and the Laboratory are not told. EHR answers
with the encounter and only the ids it closed, so after either change the
records list shown is read again. A close that would change a kind of record
the actor may not write is refused with `403 ENCOUNTER_RETRACTION_NOT_PERMITTED`
and nothing written (hid-system ENC-RETRACT-1); the form then says the role may
not make that change, that nothing changed and to ask a colleague whose role
may change all of the encounter's records, naming no kind of record, as EHR
does not. Since 0091 no role holds `ehr.lab-request.write` or
`ehr.document.write`, so an encounter that still holds a lab request, or (to be
marked entered in error) an initiated or uploaded document, cannot be closed by
anyone. Since hid-system#74 a vital carries `status`; one entered in error
(on its own or with its encounter) keeps its values, is marked "Entered in
error" in the Vitals tab and offers no correction, which EHR would refuse with
`409 VITAL_NOT_AMENDABLE`. A retraction, like a correction, raises the vital's
row version, which EHR checks first, so a correction sent at the version
loaded before either is refused with `412 VERSION_CONFLICT` (the 409 answers
only the version of a vital already entered in error). Either refusal reads the
vitals again, says whether they were marked entered in error or changed
otherwise, and moves focus to the vital. That wording is untrue against an
EHR without hid-system#74, so the portal is to be deployed with or after it.
The Lab and Pharmacy lists say when
they reach the backend's cap of the 200 oldest work items (A2), and Pharmacy
adds that work it can no longer dispense stays listed and counts toward the
200.

Against an EHR without hid-system#56, activating a draft leaves it active
without Lab receiving it (the page says Lab was not asked) and Send to Lab
answers 404, so the portal with these actions is to be deployed with or after
that EHR. Through hid-system's gateway as it stands, a service's 502, 503 or
504 reaches the browser as `503 UPSTREAM_UNAVAILABLE` without the service's
code (hand-off A8). A create answered `502 LAB_HANDOFF_UNCONFIRMED` then reads
as an outage: the form keeps its values and key, so pressing again unchanged
replays the same create and sends it to Lab again, while a changed form
creates a second active request (hand-off A25). See
[open questions](./OPEN-QUESTIONS.md) for these and the other contract limits
and backend defects.

Retry keys for OCR publications (one `Idempotency-Key` per publication request
and signed-in account, since OCR finds a publication by facility, requesting
account and key) and Outreach registration cases (the case's `localCommandId`
with its temporary patient ID) live in component memory only, never in browser
storage. A retry after a lost answer replays the same command; a reload loses
the key, and OCR offers no other way to resume (hand-off B5). Since the
hid-system alignment PR, OCR's `503 EHR_SERVICE_AUTH_UNAVAILABLE`,
`LAB_SERVICE_AUTH_UNAVAILABLE` or `PHARMACY_SERVICE_AUTH_UNAVAILABLE`
(hid-system#60: an owning service refused OCR's own workload identity, which a
publication stores as the retryable `OWNING_SERVICE_UNAVAILABLE`) reads as a
failed connection between Health ID services, to retry in about 15 seconds;
behind the gateway it also arrives as `503 UPSTREAM_UNAVAILABLE` (hand-off A8).
Outreach campaign management is
not offered: Identity refuses `outreach.campaign.write` until campaign
governance is decided (ADR-045; hand-off B10, E5), so the portal lists
campaigns and members read-only and says so. Since hid-system#65 the gateway
proxies only Identity and EHR at launch. Every Lab, Pharmacy, OCR and Outreach
route answers `404 API_ROUTE_NOT_FOUND` with no detail, while those modules'
read permissions stay seeded, so their workspaces still open. Each says that
the module is not in service on this deployment and that refreshing will not
help, instead of the client's generic "not found" (hand-off MOD-1). Since
hid-system#75 (migration 0091) no role holds any of those modules'
permissions, so the workspaces are hidden by permission; the dashboard's
Health ID Migrate card and `/provider/migrate`, which lead only to Document
OCR, are shown only with `ocr.job.read`, as the OCR workspace is.

Break-glass access is audited by Identity, and the portal offers it only to a
role holding every permission the grant and the summary need. EHR's dedicated
emergency summary route returns this facility's completed encounters and
signed notes (50 each) and its vitals, diagnoses, prescriptions, lab requests
and uploaded documents (100 each). The route requires only `ehr.encounter.read`
and `ehr.note.read`, so the portal shows each further section only to a role
holding its read permission, lists documents without opening them, and leaves
out vitals, which EHR sends without corrections. That hiding is display, not
access control: in every released hid-system build every section reaches the
browser (hand-off A11). hid-system#52 (`7856366`; merged into `main`, not
released) has EHR withhold each category the reader may not read and name it
in `withheld`, report per-section `limits` and `truncated`, list only
documents whose latest scan is clean, and audit the counts; vitals are still
sent as first recorded (A11(a)). Since the hid-system alignment PR the portal
reads these fields where EHR sends them: a section EHR withheld says it is not
included rather than that the facility has none, the "most recent only" notice
follows `truncated`, and the documents note says the listed documents passed
the virus scan. Each lab request in the summary that may have reached Lab
offers its released results, read with the emergency purpose, to a role with
`lab.result.released.read`. The ordinary
encounter and related clinical routes require `direct-care`, so an emergency
grant does not open the detailed chart; that policy gap is tracked in
[open questions](./OPEN-QUESTIONS.md) (hand-off B1, E1). On a database built
from hid-system's migrations no `emergency` purpose of use exists
(hid-system#58's migration 0082 seeds only `direct-care`), so Identity refuses
break-glass with `400 INVALID_CONSENT_COMMAND` while the `break_glass_enabled`
control is on, its default (hand-off B14); the portal then says emergency
access may not be enabled for the deployment.

The frontend does not call a database directly. `scripts/check-boundaries.mjs`
checks repository imports and forbidden dependencies, and ESLint restricts
direct network calls outside the transport layer. The public browser still
loads the approved Turnstile and optional Google identity scripts for those
flows; they are not gateway business APIs. A signed object-storage link from
EHR is used only after `assertSignedStorageUrl` (`@hid/http`) accepts it:
`https` with no user name or password, or `http` to this machine in the local
environment. The document upload's storage PUT and `window.open` for a download
both check it first.

### Facility-assisted registration (hid-system#85)

hid-system `main` `f9dbaf0` (D-Eminence/hid-system#85, migration 0094,
ADR-063; merged, not deployed, every flag off) lets a patient without a usable
registry phone prove at a participating facility that they hold their NIN. The
patient's own device shows a desk code; the staff and console screens are:

- **The staff in-person check** (`/provider/in-person-check`,
  `staff/routes/InPersonCheck.tsx`), offered to a facility role holding
  `identity.patient.assisted_registration` (doctor, clinician, nurse). It sends
  `POST /identity/assisted-verifications` through the staff client, so
  `X-Facility-ID`, the CSRF token and the session rules apply as for every
  staff command, with purpose `healthcare-operations` and an
  `Idempotency-Key`. The key is held in the page's memory for one submission
  and reused only while that submission's answer is unknown (a `5xx` or a lost
  connection) and its details are unchanged: Identity then replays the stored
  check without counting it again. What staff type is never stored, put in the
  address or logged, and the screen shows no NIN, record value, contact or
  Health ID: a mismatch is shown per field as `match`, `no_match` or
  `not_in_record`, from the problem's `fields` member, which `@hid/http` keeps
  as `HidApiError.fields` (field names to `match`, `no_match` or
  `not_in_record` only: any other value, even one shaped like a code such as
  a surname, is dropped; never in log summaries). A field without one of
  those three words is shown as "no result given". No answer of this route restores, ends or signs out the
  session. A date of birth the date control cannot report (partly typed, or
  impossible such as 31 February: its value is then empty and only
  `validity.badInput` says so) is refused at the field, so a check is never
  sent and counted without the date typed. `503 ASSISTED_REGISTRATION_DISABLED`
  is a final answer, not an unknown one: the key is dropped and nothing offers
  to check again.
- **The designation** ("Registration in person" on
  `/admin/facilities/:facilityId`, `admin/AssistedRegistration.tsx`). It reads
  `GET /admin/facilities/:facilityId/assisted-registration` and, with
  `platform.facility.manage`, sends the `POST` under step-up with a reason, an
  `Idempotency-Key` and `If-Match` with the version read. The first
  designation is version `0`, so `adminApi.command` accepts `0` for a command
  that `creates` its resource and sends it as `If-Match: "0"`; every other
  command still refuses a version below 1 before sending. A save or a
  `VERSION_CONFLICT` reads the designation again, and the new version replaces
  the form, so focus moves to the panel's heading. The panel clears its last
  answer on each press of Save, even one refused before sending, and shows
  each answer as a new element (a notice inside a status region that is always
  present), so the same words answering twice are announced twice. The page's
  Refresh, and a change of the facility's status, read the designation again.
  The panel gets the facility's status: Identity counts a designation only for
  a verified, active facility of an active organization, so an active one on a
  facility that is not verified says "Not in effect". An Identity without
  hid-system#85 answers the read with its default `404 NOT_FOUND`; any `404`
  but `ADMIN_FACILITY_NOT_FOUND` is shown as a quiet note that this Identity
  does not offer it yet, not as a failed read.

The patient's facility list, desk code and continuation after the check are
the patient sign-up screens (alignment list rows 2, 3, 6, 8 and 9).

Each protected submission sends a single-use token from a widget carrying the
action hid-system pins for its endpoint (sign-in's password and Google
submissions share its one `patient-login` check, using each token once), and a
page shows one check at a time. The enrollment NIN step offers the NIN start (`patient-enrollment`) and
Google sign-up (`patient-login`) as two paths: "Continue with Google" replaces
the NIN form and its check with Google's, so the two are never on screen
together. Cloudflare's script loads once for the whole portal through
`loadTurnstileScript` (`src/Turnstile.tsx`), shared by the patient, provider and
administration pages; a failed load is removed so the next page tries again. The
public site's demo dialog renders its check only while it is open. Every
password field (nine, on eight screens) is a `@hid/ui` `PasswordInput`: a Show
toggle beside the field with `aria-pressed`, named "Show password" (where a
form has two, each toggle is named for its own field: "Show new password",
"Show confirmed password"). It changes only how the password is displayed, and
masks it again when its form is sent, the page is left, or the person switches
to another tab or app; the Google-link password, sent by Google's button rather
than a form, is masked again after each attempt. Edge's own reveal button is
hidden. PIN and NIN fields have no toggle (PINs and registration's NIN are
masked; the patient NIN fields are plain text).

## Authentication and patient data

`hid-system` issues HttpOnly, host-only, SameSite Strict access and refresh
cookies. The browser client sends `credentials: 'include'`, reads the separate
CSRF cookie and sends `X-CSRF-Token` on mutations. It does not put access tokens
in the browser's local storage or attach a bearer header for cookie sessions.
The client can call the refresh endpoint before treating a protected 401 as a
signed-out session. Session state is restored from the backend; the browser
cannot inspect the HttpOnly cookie to decide who is signed in.

The patient and provider portals share these cookies on one origin. On
`POST /auth/refresh` and `POST /auth/logout`, and on no other call, the cookie
client names its application in `X-HID-Client` (`patient-web` or `staff-web`,
the client's own `clientId`; a caller cannot change it). hid-system #39 then
refuses the other portal's sign-in with `403 SESSION_CLIENT_MISMATCH`, rotating
and ending nothing, and each portal ends only its own session.

Staff sign-in is two steps since hid-system#71 (ADR-054, migration 0088; on
hid-system `main` at `8f3eff1`, not deployed). `POST /auth/login` answers
`{ status: 'mfa_required' | 'mfa_enrollment_required', expiresAt }` and sets
only an httpOnly challenge cookie (`hid_access_mfa`, path `/api/v1/auth/mfa`).
The session comes from `POST /auth/mfa/verify` (an authenticator code or one
recovery code), or, on a first sign-in, from `/auth/mfa/enroll/activate` after
the emailed code (`/enroll/email-code`) and `/enroll/start`, with ten recovery
codes shown once. The registry grants those four routes to `staff-web` only.
`staffApi.login` reads the password step's answer as that second step or, from
an Identity before #71, as the session, so the portal and Identity can be
deployed in either order; any other answer opens nothing. The provider's
`login` changes no state; `completeSignIn` opens the workspace. The steps that
set the session cookies (an older Identity's password step, verify,
activation) wait for a sign-out or refresh in flight and take the Web Locks
turn, and activation tells the other tabs at once, since the browser holds the
session while its recovery codes are shown. The MFA steps carry no Turnstile
token and a 401 there is never refreshed; the staff API keeps no code, setup
secret or recovery code, and returns each only to the step that asked.
The second step's screens (`staff/routes/StaffMfaSteps.tsx`) follow Identity's
answer: the authenticator code or one recovery code; or, on a first sign-in,
an explanation and a code emailed to the account's address only when asked
(sends and setup starts count against 5 per 15 minutes), the setup (a QR code
drawn in the page from the `otpauth://` URI by `src/mfa/OtpauthQr.tsx`, inline
SVG with presentation attributes only, never a remote service; the grouped
setup key; an open-in-app link; the deadline), its first code, and the ten
recovery codes, shown once. The session opens only once the person says the
codes are stored, and the workspace keeps the session without them. Each
refusal is said: a wrong code at its field; 429, `503 MFA_UNAVAILABLE` and
`MFA_ENROLLMENT_CODE_UNDELIVERABLE` keep the step; `MFA_CHALLENGE_INVALID` and
`STAFF_MFA_FACTOR_UNPROVEN` (a two-person reset) go back to the password;
`MFA_ENROLLMENT_PROOF_REQUIRED` back to the email step,
`MFA_ENROLLMENT_PROOF_COMPLETE` on to setup with no code, and
`MFA_ENROLLMENT_PROOF_UNAVAILABLE` stops. Each step's heading takes focus. The
codes, the secret and the recovery codes live only in the steps' state.
Provider enrollment activation (`/provider/enroll`) continues into the same
steps on its own page: the activation is the enrolment's proof, so setup
starts with no emailed code; an account that already has an authenticator is
asked for its code; the page reloads into the workspace only after the
recovery codes, and a challenge that lapses sends the administrator to
`/provider/sign-in`. The page does not listen for the other tabs, so verify
and activation announce the new session on a channel opened for the message.
On a Novu build (novu-v1, facility self sign-up, P4) there is no authenticator
step: activation sets the password and signs the administrator in, and the page
says where staff sign in next time before opening the workspace. It asks
`GET /identity/provider-enrollments/availability` first and shows a closed
notice while sign-up is off, or a "temporarily unavailable" notice when
Identity answers that it could not tell (`reason: 'unavailable'`). Once the
email is confirmed it reads what the sign-up registers
(`GET /identity/provider-enrollments/profile`: the legal name, the CAC number,
the facility type and the administrator) and shows it, or the CAC number alone,
before the account is made. A start that answers `codeSent: false` is never
shown as a sent code: the page uses the code in force, or waits as Identity
says. When that start changed the facility type or administrator name, which
only a sent code carries, the page stays at the details: the changes wait for
the next code, or the code in force is entered with the details it carries.
When the administrator email already has an account, Identity closes the
sign-up (hid-system R15), and the page offers a new one with another email at
once. The console's "Open applications" view lists the sign-ups holding a CAC
number first, with the total, finds one CAC number's
(`POST /admin/self-service-applications/search`), lets support spare an
applicant the 7-day refusal when rejecting or releasing (`allowRetry`), and
lifts such a refusal (`POST /admin/self-service-applications/waive-refusal`).
On Novu since P4b, a self-signed-up facility's session carries
`facility.selfService` (`review`, `organizationType`). Until support's review
the administrator holds `org_admin_awaiting_review`; a banner says what stays
locked for the facility's type and that the review signs everyone out once.
The Staff page (`/provider/staff`, `workforce.manage`, listed only at such a
facility) records the administrator's own licence, invites staff (a role,
the regulator's licence for a clinical role, an attestation and the
administrator's password, with an `Idempotency-Key`), and resends, revokes,
removes and changes roles with the version read. An invitation opens on the
main site at `/provider/invitation` (Turnstile `staff-invitation`, the link's
`#<id>.<token>` taken out of the address at once), or, for existing staff,
signed in at `/provider/staff/join` on their own staff site: the workspace
takes the link out of the address before its sign-in gate, holds it in
memory for 30 minutes (the portal keeps nothing in browser storage), and a
sign-in returns to the join page. The console's review form chooses the
administrator's role and how support checked them, and its facility pages
show staff and licences on demand and find an invitation by its reference.
Laboratory and pharmacy pages of a stand-alone facility say where its work
comes from today, in one message per case (`staff/betweenFacilities.ts`),
which since P4c also says whether other facilities can send it orders.
On Novu since P4c, a clinician can send a lab request or prescription to a
laboratory or pharmacy at another facility (`staff/routes/OrderRoutes.tsx`):
a directory picker (`GET /identity/order-destinations`, 3 to 80 characters,
on demand) shows each facility's CAC registered office, the clinician ticks
the attestation Identity's EHR serves (`GET /ehr/order-route-attestation`,
filled with the names, its version sent back), and the send carries an
`Idempotency-Key`. The order's row then shows the route's state from the
order list's `orderRoute`, loads its details and what came back only when
asked, offers Withdraw while it waits, and hides this facility's own Lab and
Pharmacy hand-offs. Returned results are grouped by result: the value to
use first, each version a correction replaced marked as replaced, and a
version marked entered in error naming the value it voids. The Lab and
Pharmacy pages list incoming orders
(`GET /{lab|pharmacy}/order-routes?view=incoming`, refreshed every two
minutes and on focus), accept one only after the patient's Health ID or date
of birth is confirmed (a mismatch says the tries left from the problem's
`attemptsLeft`; with a date of birth, the order's reference read from the
patient's app, never filled from the card, names the order, and without it a
mismatch asks for the reference instead of counting down), decline with a
reason, and name the patient only on work
from another facility. Only a laboratory receives lab requests and only a
pharmacy prescriptions, though the receive permission comes with the role at
every facility: the pages go by the work list's `receives` when sent (item 4,
hid-system 0089, only to a member holding the receive permission), else the
session's facility type (`receivingHere` in `staff/orderRoutes.ts`), and by
the work list's `routesHere { waiting, held }` for orders already sent here
or held here, listed or not. Each answer that says so is remembered in memory
for 10 minutes per membership, facility and service, which spares the
Overview an audited Incoming read at a facility that does not receive. A
facility that receives reads Incoming at once and every two minutes; one that
can't now shows only orders still waiting, with Decline but no Accept, keeps
the paused notice for work it holds, and a stand-alone one is told, without a
reason, that clinicians at other facilities can't send it orders at the
moment. A checked stand-alone laboratory or pharmacy, or one the page saw
receive, still reads Incoming every two minutes while it can't (showing
nothing unless an order waits), and the page goes by the newer of the work
list's and Incoming's answers, so a facility support lists again is noticed
without a refresh; a governed hospital never reads it. A hospital or clinic that signed itself up reads and says nothing
about other facilities; without `receives`, a governed facility, whose type
the session does not carry, reads Incoming once its work list has answered and
says nothing until an order or routed work shows up. A Health ID typed to find a patient's orders goes in the body of
`POST /{lab|pharmacy}/order-routes/search`, never in an address, and is sent
only when asked, never by the timer. The patient portal lists the patient's sent orders on
Access and consent with the clinician's attestation as confirmed, and offers
Stop while one waits; an order marked entered in error stays listed by
reference, state and facilities only (`enteredInError`). The console finds an
order by its reference or Health ID (a Health ID in the body of
`POST /admin/order-routes/search`, once per Find; a row is found again by its
reference),
closes it (`If-Match`) while Health ID says Close would still act (the row's
`closable`, item 4; from an earlier Identity, while its access may still be
open), naming the day access ended (`accessEndsAt`), and shows and
changes a facility's listing on demand, in words that depend on what the
console knows of the facility's type and review (the summary's `destination`
when sent), offering the listing form only where listing can change whether
it is found. A 404 from any of these routes means the backend does not serve
them yet: the page shows nothing new, and a main-v1 build never asks.
Item 3 (hid-system 0088, built website first and dormant until that release)
lets a laboratory or pharmacy end an order it accepted for someone who was not
the patient: "This isn't the order's patient" on the Accepted panel, which now
leads with a check that the person at the counter is the patient named, and on
a routed work row while its route allows work and the work list's card carries
the route's `version` (`staff/routes/WrongPatient.tsx`). The form takes one of
four reasons, a note for Health ID support only and a confirmation, keeps one
`Idempotency-Key` per identical report, and reads the route again on 412
(`GET /{lab|pharmacy}/order-routes/:routeId`); the message that follows stays
until closed and says to phone the ordering facility, which Health ID does not
alert. A row whose card says how it ended (`endedKind`) says who ended it, and
hides only the writes the services would refuse as closed, never Open
accession. The ordering clinician reads what the receiver reports, a red
notice that the order can't be sent again, and each withdrawn result as
"another person's result", its value hidden until asked for; the change
screen asks for the receiver to end it first while it may still be worked.
The Overview of a member holding `ehr.order-route.send` lists such orders of
the last 30 days (`GET /ehr/order-routes/wrong-patient`): in full only those
the member sent, the rest as a count and references, never a patient's name.
The patient reads the new ending and its own inbox title; support's console
lists the reports (`GET /admin/wrong-patient-reports`, flagged first), marks
one reviewed (`If-Match`, one or more actions, optionally removing the
reporter's note), and counts them on the Overview and a facility's page. Each
new read answers 404 on today's backend and then shows nothing; the console's
page says it is not available yet. The website stays dormant until the
backend says it serves the report (`wrongPatientServed.ts`): a work list's card
carrying the route's numeric `version`, `wrongPatientReports: true` on the
EHR's lab-request and prescription pages and on support's order lookup, or an
answer from one of the new reads. Until then the Accepted panel asks only for
the check, with no button and no "end this order now"; the change warning and
support's Close form keep their earlier words, so nobody is sent to a
laboratory or pharmacy that cannot end the order, nor away from the
clinician's change or support's Close; and the console stops listing the
reports page once a read answers 404.
D17, the late correction (hid-system 0090, owner decisions D17-1 to D17-13,
built website first and dormant until that release), lets the laboratory or
pharmacy withdraw what it recorded on an order it accepted for the wrong
person after the order has ended, until the date each answer carries
(`correctableUntil`, 180 days after acceptance; no other screen writes the
number, only support's rule of thumb). "Correct an order that has ended" sits,
collapsed, right after the Laboratory and Pharmacy work lists' toolbar, for a
member holding the receive permission (`staff/routes/LateWrongPatient.tsx`):
it finds an order by its exact reference only when Find is pressed
(`POST /{lab|pharmacy}/order-routes/correctable`, the reference in the body;
`items: []` when none was accepted here), shows that facility's own facts
about it and never the patient, opens item 3's own form for an order still
open after reading it (`GET …/order-routes/:routeId`, which names the
patient), and withdraws an ended one with a form of its own
(`POST …/:routeId/wrong-patient-correction`: how and when the facility found
out, item 3's reasons, a note for support and an attestation that it checked
its own records; one `Idempotency-Key` per identical request; on 412 it finds
the order again and keeps the form open; with no answer it keeps the form and
its key, so the same request answers `replayed` if it went through; a refusal
whose new lookup closes the form is said again in the order's row, with focus
there). The limit refusal says from when
more are possible, from the problem's `retryAfter` member (`HidApiError.retryAt`).
The ordering clinician reads item 3's red warning, the values hidden, for a
report made after the order had ended another way (`wrongPatient.late`),
with how long after it came back and that what they recorded from it still
shows until they amend it; an order something came back on says whom to
phone with the reference and until when (the day and time), or, past that
time or once the laboratory or pharmacy was released from Health ID
(`receivingDeadlineOf`), to record it in the notes without the value; the
change warning names the date instead of
asking for the order to be ended first; the Overview card says when each late
report came. The patient reads the late report after the ending's words, the
sentences that name no content on an order also marked entered in error, the
"haven't been" line with the reference and the date, and the new inbox title.
Support's list flags late reports, says how the order had ended and how and
when the facility found out, and requires what Identity says a late report
requires (`requiredActions`; `400 WRONG_PATIENT_REVIEW_REFERRAL_REQUIRED`
names what is missing in the problem's `required` member); Find says until
when the facility can still withdraw it, or, past that date or once it was
released (`correction: receiver_released`), the stop-gap if someone reports
the wrong person, only where something came back, and Close no longer says
closing stops it. Every new field is optional and read
only when its type is right. The website learns that D17 is served from the
backend's answers (`lateCorrectionServed.ts`): `lateCorrection: true` on the
work lists, the EHR's order lists, the Overview read, support's Find or its
reports list, a `correctableUntil` key on any route, or any answer from the
new lookup; until then every screen keeps its earlier words. It is switched
off only by rolling the four services back together.
D18, "We can't complete this order" (hid-system 0091 (staging-novu-ci-20261005),
owner decisions D18-1 to D18-15, built website first and dormant until that
release), lets a laboratory or pharmacy end an order it accepted and can't
finish (`staff/routes/CannotComplete.tsx`): on a routed work row whose route is
accepted, below "This isn't the order's patient", and in "Correct an order
that has ended" for an order found still open and accepted (after its own read
of the order, `GET …/order-routes/:routeId`, for the patient and the request's
priority), `POST /{lab|pharmacy}/order-routes/:routeId/cannot-complete` with
`Idempotency-Key` and `{ expectedVersion, reason, confirmedPatient: true,
criticalValueTold? }`. One form is open per row; once D18 is served both
buttons name the order they act on. The form takes one of the kind's fixed
reasons (nine for a laboratory, eight for a pharmacy, the registry's
`ORDER_ROUTE_CANNOT_COMPLETE_REASONS`; no free text), the statement that the
person was the order's patient, "We will phone {ordering} about this now" for
an urgent, asap or stat lab request and the must-phone reasons, and, after the
Lab's `ORDER_ROUTE_CRITICAL_VALUE_NOT_TOLD`, that it has phoned about the
possibly critical value (sent as `criticalValueTold: true`, Lab only). One key
per identical request; no answer keeps the form and the key; 412 reads the
list again and keeps the form. A refusal whose new list no longer offers the
form keeps its words in the row, with focus there, or above the list when the
row is gone; item 3's row form keeps its words the same way. Each ending is
said in its own neutral entry above the work list until closed; the row then
says this facility couldn't complete it, and leaves the list when its reads
end (at once unless a laboratory had opened an accession; then 7 days later,
or when the order's 30 days end if that is sooner, which the form says); the
Accepted panel
of an order ended from its row closes. The accession of routed work whose
order no longer lets the laboratory record (`routeClosedForWork`, also an
order cancelled after it changed) is shown to be read: no specimen step,
execution or result write is offered, as the services refuse them, and a
write refused 404 for writing on routed work (`LAB_*_NOT_FOUND`) is said as
the order having closed. The ordering clinician reads a short
badge with both days and a neutral paragraph with the reason, the next step
and whether a sample was taken or a result recorded there (the summary's
`notCompleted`, dropped once a wrong-patient report exists); the change
warning says a change changes nothing there. The patient reads that the
facility couldn't complete it (never why), to contact the clinic, and the new
inbox title (`ORDER_ROUTE_NOT_COMPLETED`). Support's Find names the ending, a
facility's panel shows its endings of the last 30 days as counts
(`notCompleted` in the facility summary), a later wrong-patient report names
the earlier ending, and Close says the facility can end an accepted order
itself and, for a laboratory's order, to ask it about results first (closing
ends its reading at once and tells the clinic nothing of a result; the Lab's
limit refusal says the same, and a possibly critical value is asked about
before the limit). Every new field is optional and read only when its type is right. The
website learns that D18 is served only from `cannotComplete: true` on the work
lists, support's Find or the facility summary (`cannotCompleteServed.ts`);
until then no screen offers or mentions it, and every page reads as before.
The words keyed on `receiving_unable`, `notCompleted`, the counts and the
inbox title need no gate: only a backend that serves D18 sends them.
A staff sign-in on a product host lands on the Overview, not the host's own
page, when the working facility cannot use that page (`staff/navigation.ts`).
The platform console refuses the platform enrolment of an
account with a staff membership as Identity does
(`409 MFA_ENROLLMENT_STAFF_SIGN_IN_REQUIRED`) and says to set the
authenticator up at staff sign-in first. Identity refuses a staff sign-in made without an authenticator (every
one before #71, or one whose authenticator was reset) with
`403 STAFF_MFA_REQUIRED` on every guarded route, and its refresh ends that
sign-in. The provider portal takes it as the end of the session
(`endsStaffSession`): it asks the server as for a 401, and the session-ended
screen and the sign-in page say Health ID now asks for an authenticator code.
The staff client notes the session that heard the refusal, because the refresh
that answers it clears the cookies and later answers no longer say why. A 503
is never taken for that end. The portal offers no staff Google sign-in, which
Identity refuses (`403 GOOGLE_STAFF_SIGN_IN_DISABLED`). The platform console's
setup-key grouping, six-digit code rules and recovery-code step are shared
from `src/mfa/`, and file saving from `src/download.ts`.

Clinician self sign-up (hid-system ADR-066, built against the unmerged backend
branch `claude/clinician-self-signup` at `fa58e2b`, re-checked at `9e981e4`,
and at `1d6ff6f` for the facility search's limit) has two public pages, `/provider/join` and `/provider/join/status`, routed
before `/provider/*` and
outside the provider workspace, as `/provider/enroll` is. They never ask
`GET /auth/session`, hold no staff session and open none. Identity keeps the
applicant's state in an httpOnly capability cookie (`hid_clinician_application`,
path `/api/v1/identity/clinician-applications`), which the page sends and never
reads. `staff/clinicianApplicationApi.ts` uses a client of its own, registered
as `staff-web`, that restores nothing on a 401 and reports nothing to the
workspace: a 401 means only that the application page or its authenticator
step ended. The applicant's authenticator steps
(`staff/clinician/ClinicianAuthenticator.tsx`) run Identity's 0088 challenge
with no session and reuse `src/mfa/` (QR code, setup key, six-digit codes,
recovery codes); staff sign-in's `StaffMfaSteps` is unchanged. Form values,
security-check tokens, the password, the setup key, recovery codes and the
applications live only in component state; the Idempotency-Key of a submission
is kept in memory and reused only for that submission. The pages' security
checks (`clinician-application`, `clinician-application-status`) are accepted
only on the main site, so on a staff product host or the admin site each page,
and every link to it, goes to the main site's address
(`clinicianPageHref` in `productHostname.ts`). Provider sign-in and provider
enrollment offer the way in only while `GET .../availability` answers
`{ open: true }`.

Each patient tab is bound to the patient it shows. Both portals announce sign-in
and sign-out on one `BroadcastChannel`, `hid-session-change`
(`src/sessionChange.ts`), and both listen on it. A patient tab asks
`GET /auth/session` at once on an announcement, on a return to view after 60
seconds or more hidden or after an announcement heard while away, and once on a
back/forward-cache restore; a 401 there is restored once through refresh, in
its Web Locks turn, before the answer is judged. The tab stays signed in only
for a patient session with its own subject: another account's session signs it
out, an outage changes nothing, and a provider's session found in the shared
cookies means signed out, not an error. Since hid-system#74 (EHR) and #76
(Identity) every patient-only route refuses any other session with
`403 PATIENT_SESSION_REQUIRED`; a patient request refused so asks the same
question, as an announcement would, and returns its refusal only once it is
answered, so a page whose patient has left the browser goes to sign-in instead
of showing an error. The 403 alone signs nothing out, and a question the
server cannot answer changes nothing. `refreshSession` restores only the
patient shown. Session questions judge their own 401
(`RequestSpec.reportUnauthorized: false` in `@hid/http`) instead of passing it
to the client's global sign-out.

The patient records page names only the sections EHR released: hid-system#52
releases completed encounters and signed notes to a patient session and names
the other five sections in `withheld`. Since the hid-system alignment PR a
withheld section says it is not yet shared with patients in Health ID, rather
than that there are none, and a section EHR reports as `truncated` says only
the most recent are shown; an EHR before hid-system#52 is shown as before.
Enrollment and password recovery follow hid-system `main`'s limits. Since hid-system#50 every
sign-in, refresh and sign-out in the browser expires the enrollment cookie
(`hid_enrollment`), after which each enrollment step answers
`404 ENROLLMENT_NOT_FOUND`: the page returns to the NIN step, and the same NIN,
sent again with the start key the page kept, restores the enrollment. Since
hid-system#84 (`main` `f9dbaf0`) a `404` also follows a later proof of the same
NIN elsewhere, a deletion after `409 NIN_ALREADY_REGISTERED` and the 24-hour
expiry, and the page says so. A start with a new key, after a reload for
example, is a new registration and a new paid NIN lookup; it is never refused
as `409 NIN_ALREADY_REGISTERED`, which Identity now says only after the NIN
holder is proved. hid-system#55 and hid-system#61 give recovery codes one
failure budget per account and enrollment codes one per contact: by default the
fifth wrong code within 15 minutes makes every code refused, a correct one too,
for 15 minutes, with the same answer as a wrong code, so after a refused code
the pages say what a spent budget does (hand-off E19). A recovery start for the
same identifier within `resendAfterSeconds` answers the same challenge and
sends no code, so "Start again for a new code" appears only once that wait has
passed; "Use a different email or Health ID" (provider and platform: "work
email") is offered at once. A start with the same account's other identifier
within that wait gets a challenge for which no code is sent (hand-off section
11, A13 residuals).

Whether a new enrollment may start comes from hid-system#68's
`GET /identity/patient-enrollments/availability` (FE-4, read at hid-system
`main` `8f3eff1`), read with the enrollment check. The NIN step and Google
sign-up are offered only on `200 { open: true }`, and only then does a NIN step
ask to reconnect the Google account an ended enrollment required. Any other
body is not open: the page says, in Identity's own words for the start's 503,
that new Health ID registration is not open yet, links to sign-in and password
recovery, and loads no security check. Since hid-system#84 the answer is
`{ open, online, facility }`: `open` stays the only gate, and the NIN step says
how the NIN will be proved, by a code texted to the phone on the NIN record or
at a participating facility, or that either is not available; an Identity
before #84 sends `{ open }` only and neither route is described. A failed read,
a 503 included, says the check failed and offers Try again; it is never taken
for a sign-out. Only a
start is refused while registration is closed, a resume with the same key
included, so an enrollment in progress continues, an activated one still shows
its HID within its 15 minutes, and one that a sign-in or sign-out ended here is
told to enter its NIN again only once a read finds registration open. While the
read has failed, Try again stands in for the NIN step and takes focus when a
step ends that way. The read predicts only the checks a start makes before it
reads a NIN, so the start's own refusals (rate limits, the lookup quota,
`503 ENROLLMENT_RECONCILIATION_REQUIRED`) are shown as before; a start answered
`503 PATIENT_REGISTRATION_NOT_OPEN` (no holder route on) shows the closed notice,
and a NIN lookup that could not be completed, or any other outage, says
Identity's "We could not check your NIN now. Try again later." with the step
kept. With every flag at its default, staging and production answer every start
that way until an operator opens a holder route. The sign-in page's "Get your
Health ID" link and the public site's sign-up entry do not read availability;
they lead to this notice.

The NIN holder step (hid-system#84, ADR-062; #85, ADR-063; read at `main`
`f9dbaf0`). Every start answers `verify_holder`, with `online` and `facility`,
and the page asks the patient to prove the NIN is theirs before a contact or a
password; nothing is said to be verified until Identity says so. Online:
`POST .../holder` texts a code to the phone on the NIN record (no body), and
`POST .../holder/verify` checks it; a correct code continues at the contact step
with `requiredProfileFields`, which the password step asks for (ADR-061). The
resend wait comes from `Retry-After` when a gateway sends one, otherwise from
`GET .../current`'s `online.resendAfterSeconds`. Where the online route cannot
help (`NIN_HOLDER_ROUTE_UNAVAILABLE`, `NIN_HOLDER_ROUTE_LIMITED`) the choice says
why and offers the facility. Facility: the stage says an in-person check of one
original photo ID must come first, lists what to bring and the participating
facilities (`GET .../participating-facilities`, also the public page
`/enroll/facilities`), and shows the desk code (`POST .../facility-code`) only
when asked; `GET .../current` shows the same code after a reload, and a new one
is asked for only if staff ask. "I have been checked" reads `GET .../current`:
`verify_contact` continues, with a confirmation in the page's status region
that also describes the contact field focus moves to, and `verify_holder` says
the check is not recorded yet. A `404` at the facility stage follows the staff
member's direction (account recovery, sign-in or start again; P31) and also
names a sign-in or sign-out in this browser. It keeps the start key, as every
other stage does: such a sign-in or sign-out expires only the cookie, so the
NIN entered before a reload resumes the registration with its check and no new
lookup, and one that is gone starts afresh with either key. A `404` found by
Check again just after the sign-out note goes to the NIN step, as the note says.
`409 NIN_HOLDER_PROOF_CONFLICT` after a correct code means another registration
of the NIN was already checked in person (0094); the page stays at the choice,
says to finish that registration on the phone used at the facility, and keeps
the facility as the fallback, with no desk code for this one. `409
NIN_ALREADY_REGISTERED`, after a correct code or at activation, leads to
account recovery, sign-in and Health ID support with the problem's
`correlationId`; `409 ENROLLMENT_HOLDER_PROOF_REQUIRED` at activation starts
again at the NIN step with a new key. The start's `409 IDEMPOTENCY_KEY_REUSED`
can only mean that the registration this page's key started was activated
(`resume` answers it for another NIN or an active row, and the key is bound to
the NIN), so the page says the registration was completed and offers sign-in
and account recovery, not a new start. The desk code, the
challenge and the route state are page state only. The signed-in "Verify NIN"
card is hidden until the owner decides P27: hid-system answers it
`503 QOREID_PATIENT_NIN_BINDING_DISABLED` by default and production refuses the
flag.

hid-system#68 also bounds activation in time (N2(b), N2(c)). An activation
whose contact was proved more than 30 minutes earlier answers
`409 ENROLLMENT_CONTACT_REVERIFY_REQUIRED`, and Identity has already sent the
enrollment back to the contact step, so the page goes there too: the contact
typed on the page is kept, the code and password are cleared, and an alert says
why. When that 409 never reached the page (it was lost, or answered another
tab's activation), the next try is refused as not at the password step
(`409 ENROLLMENT_STAGE_INVALID`): the page then reads `GET .../current` and
goes to the step Identity has, the code step when another tab already sent a
new code, with the same alert. If Identity still has the password step, or the
read fails, the refusal or the failure is shown there and the next try reads
again. Any other activation refusal stays at the password step. The activation
response expires the enrollment cookie, and `GET .../current` shows the HID
only if that response was lost and only for 15 minutes after activation, so
the completion screen asks the patient to save the HID. Until hid-system sends
it to the verified contact (N2(a)), a patient with only a verified phone signs
in and resets the password with it.

The platform console's workspace is bound to the administrator who opened it,
held in memory only. A refresh or session read that answers for another
administrator ends the workspace with a notice and is refused as a 401, so no
request is repeated as them. Admin tabs announce on their own channel,
`hid-admin-session-change`, because platform cookies are separate, and re-check
`GET /admin/session` on an announcement, a return after 60 seconds or more, or a
back/forward-cache restore; sign-out first asks whose session the cookies carry
(see [Phase 4 Stage 2B](./PHASE_4_STAGE_2B_FRONTEND_SECURITY.md)).

Staff requests include `X-Facility-ID` and `X-Purpose-Of-Use` with the selected
facility context; patient self-service requests carry neither. The selected
facility must belong to the authenticated session; the backend checks the
header on each request. Admin routes use their
own platform permissions and are platform-scoped: the admin client never sends
`X-Facility-ID`, and the backend binds no facility to them even if one is sent.
`apps/patient-web/src/admin` is the authoritative Platform Admin UI. Since
Stage 3, one navigation map (`navigation.ts`) drives the sidebar, the overview
and the route guard, so an area and its sub-pages render, and request data,
only for the permissions that list it. The `apps/admin` app in hid-system is
legacy: it uses staff sign-in, which the Stage 2A admin endpoints no longer
accept, yet hid-system still builds it and routes `admin.healthidentitydirectory.com`
to it in Cloudflare (see
[Phase 4 Stage 3](./PHASE_4_STAGE_3_ADMIN_CONSOLIDATION.md)). UI permission gates
hide unavailable actions and render access errors, but do not replace server
authorization. Since Stage 2B the admin UI signs in to the separate MFA-verified
platform session (`/auth/admin/*`, `hid_access_admin*` cookies) and answers the
backend's `STEP_UP_REQUIRED` with an authenticator confirmation before repeating
the same command once; see
[Phase 4 Stage 2B](./PHASE_4_STAGE_2B_FRONTEND_SECURITY.md). Since the launch
alignment with hid-system `main` `8f3eff1` the user search and the principal
export send their terms, and the export its audited reason, in a JSON body
(`POST /admin/principals/search` and `POST /admin/principals/export`,
hid-system#76, A24), with the platform CSRF token like every platform cookie
`POST`. The registry holds no `GET` form of either, so no name, email address
or reason goes into a URL that browser history or an access log keeps. Being
`POST`s, neither is repeated automatically; the export keeps its download
transport and row headers. An Identity without hid-system#76 answers both
`404`, so the console is deployed with or after it.

The console's clinician verification queue (`/admin/clinicians`,
`admin/ClinicianApplications.tsx`; hid-system ADR-066, built against the
unmerged branch `claude/clinician-self-signup` at `fa58e2b`, re-checked at
`9e981e4`) is shown for
`platform.workforce.manage` and links an application by its ID only. It uses
the console's own pieces: the state filter in the address, the backend's
cursor per state, `useGovernedSubmit` (one Idempotency-Key per submission,
repeated only by the step-up), `If-Match` with the version shown, and a
reason on every command. The server's caller hints choose which panel shows
(step 1, step 2, reject); the commands decide. Step 2 is never offered to the
administrator who recorded step 1, whatever a hint says. Step 1 sends a live
code the applicant reads from their own authenticator, from a field with
`autocomplete="off"`, so the browser never offers the reviewer's one-time
code there. Every outcome reloads the application; a changed application
(`VERSION_CONFLICT`, or a step no longer open) is reloaded and said to have
changed, and a lost answer is reloaded and said to be unconfirmed; a step-1
refusal Identity makes before it checks the applicant's code keeps the form and
says the code was not checked. The words a
rejection shows the applicant come from the status page's own copy
(`decisionCopy` in `staff/clinician/copy.ts`), so the console and the
applicant read the same sentence.

The clinician pages make every change to the application details to the
current value (a state updater), so an answer that arrives late, such as a
facility search, never puts back what was changed while it ran. The status
page says an application page "closed" only once it has held a capability
(an email code was checked or the applications were read); a 401 before that
just shows the email form. A closed intake is answered before the capability
(hid-system `9e981e4`), so it does not show that the page is still open: the
status page reads the applications again after one. A capability's 30
facility searches never come back (`429 CLINICIAN_APPLICATION_SEARCH_LIMITED`,
no `Retry-After`; hid-system `7cd8038`), so once they are spent the search is
turned off and the page says how to get new ones: sign-up offers "Confirm
email again" (the details stay), and the status page says to close the page
and enter the email for a new code. A refusal that keeps a
form moves focus to the control that can deal with it, since the one pressed
was disabled while the request ran.

Clinical responses use `cache: 'no-store'`; screens show loading, empty and
error states for backend reads. `@hid/observability` handles redaction for
diagnostics. Public variables are checked for secret-like names and values at
build time: the portal's `vite.config.ts` runs `assertPublicEnvironment` over
the resolved `VITE_HID_` variables and refuses to build or serve, and the public
site checks when `RootLayout` calls `getEnvironment()` during `next build`. The
portal reads each public variable by name, never the env object whole, so only
the variables it names reach the bundle: most through
`apps/patient-web/src/publicEnvironment.ts`, and `VITE_HID_GOOGLE_CLIENT_ID`
directly in the Google controls. Clinical request/response bodies are not
intended for logs, public URLs or browser persistence. Provider facility
selection is held in portal memory and sent as `X-Facility-ID` on scoped calls.
Choosing a facility in the list only proposes it; Switch facility confirms it.
The portal keeps nothing about the facility in browser storage. With
hid-system's per-sign-in facility contract (D-Eminence/hid-system#47: ADR-046;
open, not merged or deployed; hand-off C1; its migration 0080 must be
renumbered to 0085, since hid-system `main` gave 0080 to hid-system#48, 0081 to
hid-system#55, 0082 to hid-system#58, 0083 to hid-system#63 and 0084 to
hid-system#64), Identity keeps the facility a
sign-in chose and reports `facilitySelection` on staff sign-in, session reads and refresh, so a reload
shows the facility chosen. While it is unresolved (`reselect`: the chosen
facility is no longer available; `default` for someone with more than one
facility; or a value the portal does not know) the portal opens no page, shows
no sidebar, and asks where the person is working, with nothing preselected. An
Identity without that contract reports no field (`null` counts the same): the
portal then uses the facility `/auth/session` resolves (the primary one, else
the first by name) at load and sign-in, as before. So the chooser, merged into
`main`, works with hid-system `main` today and needs nothing from hid-system#47
to run. Either way, a tab keeps its in-memory facility across a refresh or
session check only while it is still among `actor.facilities`. When it is gone,
the tab closes the open page and patient and asks again; it never adopts the
facility the answer reports. The staff transport cancels any protected request
whose `X-Facility-ID` is no longer one of the session's facilities
(`setStaffSessionFacilities` and `assertStaffSessionFacility` in
`staff/session.ts`).

The browser keeps nothing about a person beyond the portal hint (`@hid/auth`):
no localStorage, sessionStorage, IndexedDB or Cache API, and no service worker
or push subscription except the one a patient turns on for phone and computer
notifications (B6, below). ESLint enforces each where it is used plainly,
through a property or by destructuring (`eslint.config.js`:
`NO_BROWSER_STORAGE`, `NO_INDEXED_DB`, `NO_SERVICE_WORKER`, `NO_CACHE_STORAGE`);
computed or aliased access is left to review. `NO_SERVICE_WORKER` is lifted for
exactly two files, `apps/patient-web/src/pushDevice.ts` and
`apps/patient-web/public/sw.js`; every other rule stays on in both. The portal's pages keep each read's last answer
in memory for the patient signed in (`apps/patient-web/src/resourceCache.ts`),
so a page opened again shows it at once while it reads again; it goes as that
patient signs out or another account signs in, and is never written to browser
storage. The portal can be
added to a home screen: a web app manifest
(`apps/patient-web/public/health-id.webmanifest`, named Health ID, standalone,
theme colour the tokens' brand, `start_url` `/` so that each product and admin
host opens its own workspace) and the public site's icons
(`apps/public-web/app/icon.png` and `apple-icon.png`, copied to
`apps/patient-web/public/icons/`), linked from the shell for the tab and the
home screen, and 192, 512 and maskable 512 icons for installing it as an app
(B6; made once from the 180 px mark). Its `id` is `/`, which deliberately
continues the identity of an earlier HID app installed on the same host.
The Notifications page offers "Install the Health ID app" where the browser has offered
installing (`beforeinstallprompt`, held in memory), and the Home Screen steps on
iPhone and iPad. Nothing is available offline: an installed app that cannot
reach the network shows the browser's own offline page. Each app also serves
`/service-worker.js`, which no
Health ID page registers: when the browser checks a worker that hid-system's
earlier apps registered on a host (scope `/`, caches named `hid-…`) for an
update, this script replaces it, deletes those caches and unregisters itself.
It serves and stores nothing and reloads no page itself, but it takes over at
once, so an open page of hid-system's EHR, which reloads when its worker
changes, reloads once, as on any EHR release.

Phone and computer notifications (B6; hid-system 0097, contract
b6-contract.md) are payload-free Web Push. A patient turns on "Notifications on
this device" on the Notifications page; only that click asks for notification permission (a
permission another app left on the host is not consent). `pushDevice.ts`, a
chunk of its own loaded only then and at sign-out, registers `/sw.js` at scope
`/` and subscribes with Identity's VAPID public key; the subscription goes to
Identity (`PUT /identity/me/web-push/subscription`), which stores the endpoint
encrypted and binds it to that sign-in. A push carries nothing: `/sw.js`
listens for `push` and `notificationclick` only, shows the fixed "Health ID /
You have a new notification." (no item text, unlike hid-1.0) and opens
`/notifications`. It has no fetch handler and uses no Cache API, storage,
IndexedDB or network, so nothing about a patient is kept on the device; the
launch build check (`scripts/check-launch-build.mjs`, `inspectServiceWorker`)
refuses a build whose worker does more, or any other worker. Signing out turns
notifications off on that device (Identity is told, at most 2 seconds, and the
browser unsubscribes), and the server pushes only to a live sign-in. While
Identity's push is not configured, or on a backend before 0097, its routes
answer 404 and the Notifications page shows no device section. The browser vendors' push services learn
only that an empty message was sent to a browser, and when.

## Production requirements

Because the session cookies are host-only and SameSite Strict, the portal's
production origin must forward its own `/api/v1/*` requests to the gateway.
That forwarding must preserve cookies, CSRF and request headers. A direct
cross-origin call to the gateway is not an equivalent session deployment. The
public site also needs a production `/api/v1/*` route for pricing and demo
requests; its Next.js rewrite is development-only (hand-off D1). Since
hid-system#65 the gateway in staging and production also refuses, with
`403 CLIENT_ADDRESS_REQUIRED`, any request whose edge did not set `X-Real-IP`
to the client's address, so that forwarding must set it as hid-system's
Workers do.

Installing the portal and retiring an earlier worker need each host to serve
the built files as files, never the single-page fallback:
`/health-id.webmanifest` as `application/manifest+json`, `/icons/*.png`, and
`/service-worker.js` as JavaScript with `Cache-Control: no-cache`.
hid-system's frontend worker sets no-cache for a path ending
`/service-worker.js` from the asset response's URL, a branch its tests do not
reach. The script must answer `200` at the URL the earlier worker was
registered with, query included, with no redirect: a redirect or `index.html`
makes the earlier worker's update fail, so it keeps the host. Retiring needs no
CSP allowance (no Health ID page registers a worker); a CSP must allow
`manifest-src 'self'` (hand-off D1, D6). A HID worker on the apex,
`healthidentitydirectory.com`, outside Health ID's hosts, was observed on 2026-10-13 by Health-id's PWA audit with a read-only request to `https://healthidentitydirectory.com/service-worker.js`: 200 JavaScript, cache `hid-static-v2026-04-29-1`, served by Vercel, with `www` redirecting there; its scope was not seen.
hid-system's apex redirect would answer that path with a 308, so the apex must
instead answer `/service-worker.js` itself with this script, for months after
the switch (hand-off D1).

The portal build publishes no source maps (`build.sourcemap: false`, guarded by
`apps/patient-web/src/__tests__/buildConfig.test.ts`): hid-system's frontend
worker serves every asset unfiltered, so a map would be public.

This portal is not deployed. hid-system's Cloudflare configuration
(`infra/cloudflare/workers/*/wrangler.json` at `522fb2e`) serves `www` and
`staging` with hid-system's own `apps/web`, and each product host with its own
hid-system app. The provider recovery links on product hosts point to
`/provider/recover` on www. hid-system's own `apps/web` has the same fixed route
since D-Eminence/hid-system#41 (merged into hid-system `main` at `63201b1`, not
yet released), so the links work with today's hosting once a release carries
it, or once this portal serves www. On the `ehr`, `lab`, `pharmacy`,
`migrate`, `outreach` and `admin` hosts, in production and under `.staging.`,
exactly as hid-system's `infra/cloudflare/src/frontend-worker.mjs` names them,
`/` opens that product's workspace (`STAFF_PRODUCT_HOSTNAMES`,
`isPlatformAdminHostname` in `productHostname.ts`); only listed hosts match, and
the `ocr` hosts, hid-system's legacy redirects to `migrate`, are not mapped. The
Vite dev and preview servers answer the same hosts.

The backend's current Turnstile service permits all three general login
actions (`patient-login`, `staff-login`, `admin-login`) together, and
enrollment and patient and staff recovery, only on
`www.healthidentitydirectory.com` or `staging.healthidentitydirectory.com`.
Each staff product host accepts only its own login action (`lab-login`,
`pharmacy-login`, `ocr-login` on `migrate`, `outreach-login`); `ehr` accepts
`ehr-login` and `staff-login`. Staff sign-in sends the current host's action,
and `staff-login` on `ehr` and elsewhere (`staffLoginAction` in
`apps/patient-web/src/productHostname.ts`). The `admin` host accepts
`admin-login` and `admin-reset`. The admin approval message sends a new
administrator to `/provider/recover` on `www` (or `staging`) to set a password,
and the provider sign-in page on a staff product host (`ehr`, `lab`,
`pharmacy`, `migrate`, `outreach`) or the admin site links "Forgot your
password?" to the same page and says resets are done on the main site
(`staffRecoveryHref` in `productHostname.ts`). Opened directly on one of those
hosts, `/provider/recover` shows that notice and link instead of a reset form.
The address is one of three fixed values and carries no return address; after
a reset, the recovery page's sign-in link stays on the main site.
Hosting patient sign-in, enrollment or patient and staff recovery on another
hostname requires a backend Turnstile allowlist/configuration change. No staging environment exists yet, and no live
end-to-end acceptance has been run. Backend defects and deployment decisions
are listed in [open questions](./OPEN-QUESTIONS.md).

## Shared interface contract

`packages/ui` holds the design tokens (`tokens.css`) and the shared
components. A `Field` gives its error, otherwise its hint, to the one `Input`,
`Select` or `Textarea` inside it as `aria-describedby`, joined with the
caller's own ids, and an error sets `aria-invalid` and the critical border.
That context is why these controls live in the `'use client'` module
`Field.tsx`: the public site's server components cannot use a React context,
and any `@hid/ui` module using a client-only React API must say `'use client'`
(`FieldDescription.test.tsx`). Form-control boundaries use
`--color-line-control` (3:1 on every light surface), status text the
`--color-positive-ink` and `--color-caution-ink` tokens (4.5:1 alone, or on
their own tint over white, `surface-sunk`, `surface-tint` or `brand-tint`), and
small text `--color-faint`; cards and dividers keep
`--color-line-strong`, and icons and fills the bright status colours. Shared
controls show focus with an outline, brand or critical. The ratios are computed
from the token values (`ColourContrast.test.tsx` in both apps). Focus after
actions and page changes is shared by both portals (`src/pageFocus.ts`), and
provider forms tie each refused value to its field
(`staff/useFieldProblems.tsx`).

## Repository and verification

| Path | Role |
| --- | --- |
| `apps/public-web` | Public website and commercial API flow |
| `apps/patient-web` | Unified authenticated portal with patient, provider and admin route groups |
| `packages/config` | Public environment parsing and validation |
| `packages/contracts` | Audited route registry, permissions and app boundaries |
| `packages/http` | Gateway transport and uploads |
| `packages/api` | Service clients and browser route guards |
| `packages/auth` | Principal and access models |
| `packages/observability` | Redacted diagnostics |
| `packages/ui` | Shared tokens and components; `Field`, `Input`, `Select` and `Textarea` in the `'use client'` module `Field.tsx` |

The root scripts provide `typecheck`, `lint`, `test`, `audit:boundaries`,
`build:public-web`, `build:patient-web` and `audit:launch-build`, which runs
hid-system's staging refusals for the portal build
(`infra/cloudflare/scripts/health-id-artifact.mjs`) over
`apps/patient-web/dist`. These are local code checks. A
successful build or mocked test does not establish that the backend routes,
cookies, Turnstile actions or real credentials work in a deployed environment.
