# Health ID complete frontend gap map

Audit baseline: `Health-id` `8903e68`, `hid-system` `c4b5445` on `hid-local-pre-softbridge-snapshot`, `hid-1.0` `eb6214f`, `Dashboard.zip` supplied on 2026-10-03, and the supplied `HID.html`. Work is on `frontend-integration` in `Health-id`. This is an implementation inventory, not evidence of a staging release. The older open-tab pasted text describes a different backend PR and does not govern this frontend task.

`hid-system` uses an API-only gateway and `/api/v1` routes. Its cookie session, CSRF, facility, and purpose-of-use rules are authoritative. Existing `Health-id` function-name endpoints and bearer-session assumptions describe an older backend and must be replaced. `Dashboard.zip` is a fictional local simulation whose own `FRONTEND-READINESS.md` says it is not ready for a real backend. Its `BACKEND-HANDOVER.md` describes proposed contracts, not implemented hid-system routes. The HTML also holds fixture data and local state only. Both sources provide workflow and UI references, never API authority.

| Feature | Health-id | Dashboard.zip | hid-1.0 | HTML | hid-system backend | Final action |
| ------- | --------- | ------------- | ------- | ---- | ------------------ | ------------ |
| Audience chooser and brand | Complete public `/` | Outside hospital scope | Landing | Login/role concepts | Public content needs no API | KEEP |
| Provider and patient marketing | `/providers`, `/patients` | Outside hospital scope | Landing, hospital entry | Module overview | Public content needs no API | KEEP |
| Product catalogue | `/products` and six detail routes | Outside hospital scope | Commercial products | Service modules | Demo product codes verified | IMPROVE |
| Solutions, about, resources | Pages and responsive shell | Outside hospital scope | Solutions/developers | No equivalent | Public content needs no API | KEEP |
| Main patient signup CTA | Points to missing `/patient` | Outside hospital scope | `/patient` registration | Patient portal mock | Patient enrollment API | WIRE |
| Existing patient CTA | Points to missing `/patient` | Outside hospital scope | `/patient` login | Patient portal mock | `POST /auth/patient/login` | WIRE |
| Provider login CTA | Points to missing `/hospital` | Simulated sign-in | `/hospital/auth` | Fake hospital login | `POST /auth/login`, `GET /auth/session` | WIRE |
| Contact and Book Demo | `mailto:` dialog | Outside hospital scope | Contact/commercial CTAs | No real intake | `POST /commercial/demo-requests`, Turnstile, idempotency | REPLACE MOCK |
| Public pricing | Static amounts in content | Outside hospital scope | Pricing | Static billing examples | `GET /commercial/pricing` | REPLACE MOCK |
| Free periods/offers | Static marketing copy | Outside hospital scope | Offers | No equivalent | No promotion/trial engine | BACKEND GAP |
| Public integrations/API | Product page | Outside hospital scope | Developers | No equivalent | Integration admin, no public onboarding API | IMPROVE |
| Product dashboard previews | Illustrative local state | Outside hospital scope | Product previews | Fixture panels | Operational claims require real API | IMPROVE |
| Patient enrollment NIN | No page | Outside hospital scope | Legacy signup | Fake patient portal | Enrollment start/current API; NIN verifier deployment gated | BUILD |
| Enrollment contact OTP | No page | Outside hospital scope | Patient OTP | Fake login | Enrollment contact/verify API | BUILD |
| Enrollment activation | No page | Outside hospital scope | Patient registration | Fake activation | Enrollment activate; explicit login then needed | BUILD |
| Google patient onboarding | No page | Outside hospital scope | Google identity | No real equivalent | Google nonce/exchange/onboarding/bind | BUILD |
| Patient sign in/session/logout | Placeholder; always anonymous | Outside hospital scope | Patient auth/session | Local-only auth | Cookie login/session/refresh/logout | REPLACE MOCK |
| Password recovery | No page | Outside hospital scope | Reset/OTP | Local-only auth | `POST /auth/otp/{start,verify,complete}` | BUILD |
| Patient dashboard/Health ID/HIDCode | Placeholder discards profile | Outside hospital scope | Portal/profile | Fixture patient card | `GET /identity/me` | REPLACE MOCK |
| Patient bio-data/profile read | No real view | Outside hospital scope | BioData/Profile | Fixture demographics | `GET /identity/me` | BUILD |
| Patient bio-data/profile edit | No view | Outside hospital scope | Editable profile | Local edit | No general self-profile update | BACKEND GAP |
| NIN verification of existing patient | No view | Outside hospital scope | BioData | No real equivalent | `POST /identity/me/verification/nin`, gated provider | WIRE |
| Patient records | No view | Outside hospital scope | Records | Fixture records | `GET /ehr/me/records` | BUILD |
| Patient access history/timeline | No view | Small consent simulation | History/events | Journey panel | `GET /identity/me/access-history` | BUILD |
| Structured medical history editing | No view | Outside hospital scope | Patient History | History fixture | Self-records summary only; no self-history mutation | BACKEND GAP |
| Patient notifications/read | No view | Outside hospital scope | Notifications/watcher | Fixture alerts | `GET /identity/me/notifications`, mark read | BUILD |
| Access history | No view | Outside hospital scope | History | Audit UI mock | `GET /identity/me/access-history` | BUILD |
| Access requests/consent | No view | Small consent simulation | Access controls | Local grant | `GET /identity/me/access-requests`, approve and deny; the patient portal lists and decides them. hid-system `verify-patient-safety-runtime.mjs` passes these routes over HTTP with the runtime role (local only) | BUILT |
| Access PIN set/revoke | No view | Outside hospital scope | PIN input | Local PIN | `POST`/`DELETE /identity/me/access-pin` | BUILD |
| Patient sharing/invites | No view | Outside hospital scope | Share profile | Local share | No patient self-service share-create API | BACKEND GAP |
| Patient revoke active staff grant | No view | Outside hospital scope | Revoke control | Local revoke | `POST /identity/me/consent-grants/:id/revoke` for patient-authorized grants only (Phase 3) | BUILT (Phase 3) |
| Emergency access explanation | No view | Outside hospital scope | Patient emergency info | Break-glass fixture | Access history `breakGlass` label; verified emergency contacts (Phase 3) | BUILT (Phase 3) |
| Account deletion | No view | Outside hospital scope | Account setting | No equivalent | `/identity/me/account-deletion` login deletion lifecycle (Phase 3) | BUILT (Phase 3) |
| Provider sign in and bootstrap | No app | Simulated sign-in, recovery and MFA | Doctor auth/portal | Fake login | Cookie auth/session/refresh/logout | BUILD |
| Organization/facility selection | No app | Simulated institution and branch switch | Facility picker | 9-step setup fixture | Session facilities and `POST /auth/facility` | BUILD |
| Provider onboarding/application | No app | Simulated five-step registration | Hospital signup | Facility setup fixture | Application submit route has a database argument mismatch; completion is narrow | BACKEND GAP |
| Provider dashboard | No app | Simulated role dashboards | Hospital dashboard | Role dashboards with fixtures | Session permissions, domain read APIs | BUILD |
| Provider HID patient lookup | No app | Simulated hospital catalogue | Patient records search | Patient list fixture | `POST /identity/patient-lookup` | BUILD |
| Provider access request/PIN | No app | Simulated hospital catalogue | Access flow | Local consent | Identity consent APIs; the clinician's own list (`GET /identity/access-requests`, with `?status=`), `POST /identity/consent-status` for write gating, grant close; each approval's outcome (`effectiveStatus`, grant expiry) from hid-system 0074 | BUILT (Phase 4: D-Eminence/hid-system#26 and D-Eminence/hid-system#28 with D-Eminence/Health-id#18 and D-Eminence/Health-id#19; no browser or staging run) |
| Provider emergency/break-glass | No app | Simulated hospital catalogue | Emergency | Local expiry, not audited | Audited `POST /identity/break-glass`; dedicated emergency summary route | BUILD |
| Emergency record summary | No app | Simulated hospital catalogue | Emergency | Fixture chart | `GET /ehr/patients/:patientId/emergency-records` returns completed encounters and signed notes under an emergency grant | BUILD |
| Detailed clinical chart during emergency access | No app | Simulated hospital catalogue | Doctor records/history | Fixture chart | Ordinary encounter, vital, note, diagnosis, prescription and lab-request controllers require `direct-care`; an emergency grant uses `emergency` | BACKEND GAP |
| Provider patient records/history | No app | Simulated hospital catalogue | Doctor records/history | Fixture chart | EHR clinical endpoints under direct-care grants; separate limited emergency summary | BUILD |
| Provider notifications | No app | Simulated local alerts | Doctor portal alerts | Fixture alerts | No staff notification inbox API | BACKEND GAP |
| Encounter/consultation | No app | Simulated hospital catalogue | Doctor portal | Consultation chart | EHR encounter CRUD | BUILD |
| Vitals | No app | Simulated hospital catalogue | Limited | Vitals module | EHR vitals/revisions | BUILD |
| Clinical notes | No app | Simulated hospital catalogue | Doctor history | Consultation notes | EHR notes/revisions | BUILD |
| Diagnoses | No app | Simulated hospital catalogue | Doctor records | Diagnosis form | EHR diagnoses | BUILD |
| Prescriptions | No app | Simulated hospital catalogue | Doctor portal | Pharmacy handoff mock | EHR prescriptions + pharmacy work item | BUILD |
| Laboratory requests | No app | Simulated hospital catalogue | Doctor portal | Laboratory queue mock | EHR lab requests + Lab work items | BUILD |
| Documents/upload/download | No app | Simulated hospital catalogue | Records | Attachments mock | EHR document intents/list/download | BUILD |
| Appointments | No app | Simulated hospital catalogue | Hospital UI | Appointment queue fixture | No appointment controller | BACKEND GAP |
| Triage queue | No app | Simulated hospital catalogue | Hospital UI | Triage module fixture | No triage queue API; vitals exist | BACKEND GAP |
| Inpatient/ICU | No app | Simulated hospital catalogue | Limited | Inpatient/ICU fixture | No inpatient controller | BACKEND GAP |
| Maternity | No app | Simulated hospital catalogue | Limited | Maternity fixture | No maternity controller | BACKEND GAP |
| Surgery | No app | Simulated hospital catalogue | Limited | Surgery fixture | No surgery controller | BACKEND GAP |
| Radiology | No app | Simulated hospital catalogue | Limited | Radiology fixture | No radiology controller | BACKEND GAP |
| Provider billing/insurance | No app | Simulated hospital catalogue | Commercial billing | Billing/insurance fixture | Admin billing absent in current backend; no claim/invoice API | BACKEND GAP |
| Inventory | No app | Simulated hospital catalogue | Limited | Stock fixture | No inventory API | BACKEND GAP |
| Facility audit | No app | Simulated hospital catalogue | Admin/provider history | Audit fixture | Identity `/audit/events` is gateway-routed; EHR's controller at the same path is shadowed | BUILD |
| Provider reports and trends | No app | Simulated hospital catalogue | Provider history | Reports fixture | No general provider reporting or trend API | BACKEND GAP |
| Referrals | No app | Simulated hospital catalogue | Limited | Referral fixture | No referral API | BACKEND GAP |
| Staff and role management | No app | Simulated hospital catalogue | Admin users/roles | Staff fixture | Admin principal/platform role APIs; no facility invitation/membership mutation | BACKEND GAP |
| Shifts and HR | No app | Simulated hospital catalogue | Limited | Shifts/HR fixture | No shifts/HR API | BACKEND GAP |
| Quality | No app | Simulated hospital catalogue | Limited | Quality fixture | No quality API | BACKEND GAP |
| Telemedicine | No app | Simulated hospital catalogue | Limited | Telemedicine fixture | No telemedicine API | BACKEND GAP |
| Ambulance | No app | Simulated hospital catalogue | Limited | Ambulance fixture | No ambulance API | BACKEND GAP |
| Blood bank | No app | Simulated hospital catalogue | Limited | Blood bank fixture | No blood-bank API | BACKEND GAP |
| Lab work item/accession | Boundary only | Simulated hospital catalogue | Lab product | Lab fixture | Lab work item/accession API | BUILT (provider portal `/provider/laboratory`; component tests in `apps/patient-web/src/staff/routes/Laboratory.test.tsx`; no browser or staging run) |
| Lab specimen custody | Boundary only | Simulated hospital catalogue | Limited | Lab fixture | Collect/receive/reject APIs | BUILT (provider portal `/provider/laboratory`; component tests; no browser or staging run) |
| Lab execution/result | Boundary only | Simulated hospital catalogue | Limited | Lab fixture | Start/complete/verify/release/history APIs. D-Eminence/hid-system#31 (merged into hid-system `main`, not deployed) makes the specimen execution list authorize the specimen's patient with Identity | BUILT (provider portal `/provider/laboratory`; a failed execution-list read removes the result values of every specimen in that accession: 403 or 404 shows access denied, a 401 shows that the session ended and makes the portal ask the server, which replaces the workspace with the session-ended screen once it confirms the end, and any other failure says access could not be verified; an action, start or history read that fails with 401, 403, 404, 408, a 5xx, no response or an unexpected error re-checks by reloading the list (without `lab.execution.read` the panel hides at once), and a specimen step that fails that way re-reads the accession and every panel's results in place, keeping the step's error; a refusal on its merits and the history 404 for a never-released result change nothing; component and API-client tests; no browser, runtime or staging run) |
| Pharmacy work items | Boundary only | Simulated hospital catalogue | Pharmacy product | Pharmacy fixture | Pharmacy work item API | BUILT (provider portal `/provider/pharmacy`; component tests in `apps/patient-web/src/staff/routes/Pharmacy.test.tsx`; no browser or staging run) |
| Pharmacy dispensing/reversal | Boundary only | Simulated hospital catalogue | Limited | Dispensing fixture | Dispense/reversal API | BUILT (provider portal `/provider/pharmacy`; component tests; no browser or staging run) |
| Migrate access/status | Boundary only | Outside hospital scope | Access gate/dashboard | OCR concept | OCR jobs and status endpoints | BUILD |
| Migrate capture/OCR extraction | Boundary only | Outside hospital scope | Capture/upload | Records scan concept | OCR job creation and extraction | BUILD |
| Migrate bulk import/project matching | Boundary only | Outside hospital scope | Import/matching | Records scan concept | No bulk import or project matching API | BACKEND GAP |
| Migrate validation/QA | Boundary only | Outside hospital scope | Validation/QA | Document review concept | OCR validations and patient confirmation. Before hid-system migration 0075 (D-Eminence/hid-system#30) every confirmation failed under the least-privilege OCR runtime: its outbox insert was refused by row-level security. A second confirmation of the same job version now answers `409 OCR_PATIENT_ALREADY_CONFIRMED`. From hid-system migration 0076 the database also refuses a confirmation or validation whose source document, extraction, or session account or membership it cannot read, and a confirmation that names another member than the signed-in one | BUILD |
| Migrate processing/review | Boundary only | Outside hospital scope | Processing/review | Document review concept | OCR retry, validation and publication. Publication request, success and failure had the same outbox failure until 0075. Validation and publication lists are audited and patient-linked from D-Eminence/hid-system#30 | BUILD |
| Migrate job publication result | Boundary only | Outside hospital scope | Completed/folders | Fixture records | OCR publication lookup by validation | BUILD |
| Migrate global completed records | Boundary only | Outside hospital scope | Completed/folders | Fixture records | No global completed-record index | BACKEND GAP |
| Migrate project/team operations | Boundary only | Outside hospital scope | Projects/team/operations | No equivalent | No project/team lifecycle API | BACKEND GAP |
| Migrate intelligence | Boundary only | Outside hospital scope | Unused workspace component | No equivalent | No intelligence/model analytics API | BACKEND GAP |
| Outreach landing | Product marketing only | Outside hospital scope | Outreach landing | No equivalent | Public content can describe capability | IMPROVE |
| Outreach signup/login/OTP/join | No app | Outside hospital scope | Full legacy flow | No equivalent | No public outreach identity/invite/OTP/join API | BACKEND GAP |
| Outreach campaigns/members | No app | Outside hospital scope | Campaign UI | No equivalent | Staff scoped campaign/member APIs | BUILD |
| Outreach registration cases | No app | Outside hospital scope | Campaign patient flow | No equivalent | Staff scoped registration-case APIs | BUILD |
| Outreach visits/screenings/referrals | No app | Simulated hospital catalogue | Legacy flow | No equivalent | No equivalent endpoint | BACKEND GAP |
| Admin login/session | No app | Simulated platform workspace | `/eminence/login` | Role switch mock | Staff login and admin session with platform permissions | BUILD |
| Admin dashboard/controls | No app | Simulated platform workspace | Overview/controls | Admin dashboard fixture | Admin overview/controls API | BUILD |
| Admin principals/roles | No app | Simulated platform workspace | User/role management | Staff fixture | Admin principals/platform roles APIs | BUILD |
| Admin facility/application review | No app | Simulated platform workspace | Platform controls | Facility setup fixture | Admin facility and application review APIs | BUILD |
| Admin identity review/audit | No app | Simulated platform workspace | Audit | Audit fixture | Admin identity reviews/audit events API | BUILD |
| Admin operations | No app | Simulated platform workspace | Operations | Reports fixture | Admin services/events APIs | BUILD |
| Admin pricing | No app | Simulated platform workspace | Pricing admin | Billing fixture | Admin pricing read/write with versions | BUILD |
| Admin demo requests | No app | Simulated platform workspace | Commercial admin | No equivalent | Admin demo list/status API | BUILD |
| Admin provider integrations | No app | Simulated hospital catalogue | Platform controls | No equivalent | Admin integrations/configuration/test APIs | BUILD |
| Admin OTP provider controls | No app | Simulated hospital catalogue | Platform controls | No equivalent | Integration capability/provider selection APIs | BUILD |
| Admin AI processing | No app | Simulated platform workspace | AI processing | No equivalent | No global AI processing admin API | BACKEND GAP |
| Admin billing/subscriptions | No app | Simulated hospital catalogue | Billing | Billing fixture | No billing/subscription API | BACKEND GAP |
| Shared visual system/responsiveness | Public design and tokens | Responsive shell and state patterns | Portal shells | Dense EMR layouts | Frontend concern | IMPROVE |
| Auth/error/loading states | Partial primitives, no real session | Responsive shell and state patterns | Multiple auth shells | Local feedback | Problem Details, cookie/CSRF contract | REPLACE MOCK |
| PWA/install/voice to text | No operational app | Outside hospital scope | PWA and dictation | No real equivalent | No server dependency; privacy UX required | NOT APPLICABLE |
| Five-step facility registration | No facility form | Simulated account → facility → regulatory identity → setup → agreements | Hospital signup subset | Setup fixture | Application DTO lacks most fields; submit function signature defect | BACKEND GAP |
| Nine-step hospital setup | No workflow | Simulated Facility → Type → Departments → Branches → Staff → Roles → Billing → Review → Launch | Limited onboarding | Nine-step local state | No setup progress or persistence contract | BACKEND GAP |
| Department multi-select | No control | Working labeled checkbox cards in local setup | Limited | Local selection | No department storage or submit endpoint | BACKEND GAP |
| Facility invitation and membership lifecycle | No flow | Simulated invitations and role assignment | Hospital invitation UI | Staff setup fixture | No invitation or membership mutation API | BACKEND GAP |
| Branch selection | No flow | Simulated multi-branch context | Facility picker | Branch setup fixture | Auth selects facility only; no branch contract | BACKEND GAP |
| Provider profile, credential review and presence | No flow | Simulated profile, credential and presence views | Limited profile | Staff fixture | No staff profile/photo, credential review or presence API | BACKEND GAP |
| Offline queue, sync and conflict resolution | No flow | Simulated cache, queue and conflict review | No equivalent | No equivalent | No lease, sync, change-feed or conflict API | BACKEND GAP |
| Facility trial, subscriptions and reminders | No flow | Simulated trial and billing | Legacy pricing UI | Billing fixture | No subscription, trial, payment or reminder contract | BACKEND GAP |
| Nursing tasks, dental and procurement | No flow | Simulated catalogue modules | No equivalent | Fixture modules | No nursing task, dental or procurement API | BACKEND GAP |
| Single authenticated portal | Patient app only; staff/admin drafts are uncommitted separate apps | One simulated hospital shell | One legacy SPA | One local EMR shell | Backend supports role-specific route groups | IMPROVE |

## Backend gaps and integration dependencies

The `BACKEND GAP` rows cannot be presented as operational screens. For each group below, the expected workflow is the corresponding reference row above, frontend completion is **no**, and required backend work is a permissioned API or a fix to the existing route with persistence, validation, audit and tests. The frontend source is listed in the table. In particular:

- **Clinical operations:** appointments, triage queue, inpatient/ICU, maternity, surgery, radiology, claims/billing/insurance, inventory, referrals, shifts/HR, quality, telemedicine, ambulance and blood bank need domain contracts. Vitals, notes, lab requests and prescriptions are supported and should be built.
- **Patient account control:** general profile editing, self-service share/invite, grant revocation and account deletion need patient-scoped APIs. Existing consent approve/deny and PIN APIs do not imply these rights.
- **Commercial:** price catalog exists; promotions/free periods, subscriptions, invoices and payments do not. `null` quote prices must never become fabricated amounts.
- **Outreach:** staff campaign and registration-case APIs exist. Public worker signup, login, OTP, invitations and join flows from `hid-1.0` have no replacement contract.
- **Migrate:** OCR job, extraction, validation and publication APIs exist. Bulk import, project matching, completed-record indexes, legacy project/team operations and the unmounted intelligence workspace have no backend contract.
- **Admin:** dashboard, principal, review, audit, pricing, demo and integrations exist. Global AI processing and billing administration do not.
- **Facility reporting:** The provider portal reads Identity facility audit events. The gateway's `/api/v1/audit/*` route shadows EHR's identically named audit controller, and no general provider reporting or trend API was found. Platform audit uses the separate admin route.
- **Hospital onboarding:** Dashboard's five-step registration and nine-step setup are simulated. The real application DTO only accepts product, organization type, CAC number, administrator name/email and Turnstile; completion adds a few company fields. `organization-applications.service.ts` passes five arguments to `identity.submit_organization_application`, but migration `0046_organization_onboarding.sql` declares six required arguments, so the public submit route is blocked at this snapshot. There is no server draft, department, branch, document, invitation, billing/trial or setup-progress contract. Fix the function call and DTO before this can become a usable onboarding flow.
- **Provider patient registration:** Staff can review a known case UUID and perform backend-governed approval, linking, and enrollment. The backend has no case list/search and case detail omits account enrollment state, so resume after refresh cannot reliably show whether enrollment already happened. Starting new NIN cases is disabled in normal deployments until a verification provider is released.
- **Patient consent:** The patient list/approve/deny routes call `consentContext()` and then `requireRequestContext()`, which requires a facility ID even though patient sessions have none. Correct that backend context path before treating these actions as working.
- **Emergency clinical access:** Identity can issue an audited break-glass grant, and EHR exposes a dedicated emergency record summary of completed encounters and signed notes. The ordinary EHR encounter, vital, note, diagnosis, prescription and lab-request controllers call `clinicalContext()`, which rejects `X-Purpose-Of-Use: emergency`. A detailed chart under an emergency grant therefore needs an explicit backend policy and route contract; the frontend must not silently retry it as `direct-care`.
- **Lab result visibility:** `LabExecutionsService.listForSpecimen()` now resolves the specimen's patient and calls the same Identity `read_records` authorization as the single-execution `get()` before it reads any execution or result revision (D-Eminence/hid-system#31, merged into hid-system `main` as `158f68c`; not deployed). Lab row-level security applies the same consent check, so an absent or revoked grant normally returns `404 LAB_SPECIMEN_NOT_FOUND`. Staging verification is still pending.
- **Staff session end:** hid-system gives an ended, expired or revoked staff session only a generic `401 AUTHENTICATION_REQUIRED` and no reason. Because every refresh rotates the session, the provider portal confirms a 401 with the server before acting. When the server confirms the end, the portal replaces the whole workspace with a fixed session-ended screen and a sign-in link, clears the open patient, cancels the ended session's protected requests in flight and never repeats or applies them in the next session. After sign-in it returns only to an exact workspace path. A 403 refusal of a request never ends the session. Component tests only; no browser, runtime or staging run.
- **Offline and staff profiles:** Dashboard's offline lease, sync, conflict, duplicate review, staff presence, profile photo and credential review endpoints are proposed only. Its local simulation is not an implementation of these capabilities.

Known integration work in `hid-system` is outside this frontend branch: production auth cookies are host-only and Strict, so authenticated browser calls need a same-origin `/api/v1` proxy (the backend repository has a Cloudflare frontend-worker pattern). On a distinct origin, the Identity and Pharmacy CORS gaps (`DELETE`/`PATCH`, Pharmacy `x-csrf-token`) are fixed by hid-system Phase 4 Stage 5 (D-Eminence/hid-system#25). The Identity NIN provider is disabled by default pending its release/security gates. A live staging gateway URL, allowed frontend origins, Google client configuration and Turnstile site key are required for real acceptance; the user confirmed no staging environment exists yet. Patient enrollment activation returns an HID code but no session; the UI must lead the person through sign-in. The gateway routes `/api/v1/audit/*` to Identity, so EHR's identically named audit controller is not reachable through that route.

## Evidence

- `Health-id`: `apps/public-web/app`, `apps/public-web/content/site.ts`, `components/shared/DemoDialog.tsx`, `content/provider.ts`; `apps/patient-web/src/App.tsx`, `session.tsx`, `routes`; `packages/contracts/src/{registry,boundaries}.ts`.
- `Dashboard.zip`: `README.md`, `FRONTEND-READINESS.md`, `HOSPITAL-EHR-SPEC.md`, `FACILITY-ONBOARDING-SPEC.md`, `BACKEND-HANDOVER.md`, `UI-SCREEN-MAP.md`, `src/{app,admin,registration,service,catalog,sync}.tsx`/`.ts` inside the archive. Its 42 local tests do not establish backend integration.
- `hid-1.0`: `src/App.tsx`, `src/features/migrate/ui/MigratePage.tsx`, `src/features/migrate/ui/MigrateAccessGate.tsx`; the full repository is the historical UX reference.
- Uploaded `HID.html`: embedded compiled assets contain fixture EMR state, local login and 30 sidebar modules; no production backend binding is present.
- `hid-system` `c4b5445`: `gateway/nginx.conf.template`, `services/identity-api/src/{auth,identity,consent,admin,commercial,integrations}`, `services/{ehr,lab,pharmacy,ocr,outreach}-api/src`, `docs/HEALTH_ID_{DEMO,PRICING}_CONTRACT.md`.
