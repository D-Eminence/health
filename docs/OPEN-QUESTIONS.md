# Open questions and integration blockers

These items are based on the `hid-system` snapshot at `c4b5445` and the
frontend integration in this repository. They separate known backend defects,
deployment dependencies and absent contracts. The historical
[gap map](./HEALTH_ID_COMPLETE_FRONTEND_GAP_MAP.md) contains the reference
screen audit; its baseline status column predates the portal implementation.

## Acceptance environment and deployment

| Item | Current evidence | Needed to close |
| --- | --- | --- |
| Staging acceptance | The user confirmed there is no staging environment yet. Local builds and mocked tests cannot prove end-to-end behavior. | A non-production gateway, service configuration, seeded test principals/facilities and test accounts; run patient, provider, admin, pricing and demo journeys there. |
| Production `/api/v1` routing | Access and refresh cookies are host-only and SameSite Strict. The Next.js and Vite `/api/v1` forwards in this repo are development-only. | Route `/api/v1/*` from each deployed frontend origin to the gateway while preserving cookies, CSRF, Origin and facility/purpose headers. Verify logout, refresh and mutation flows from a browser. |
| Portal hostname and Turnstile | `TurnstileService` currently permits `patient-login`, `staff-login` and `admin-login` together only on `www.healthidentitydirectory.com` or `staging.healthidentitydirectory.com`. The frontend example's portal origin is a local port; visual references mention a separate app hostname. | Choose the one production portal hostname. If it differs from the permitted hosts, change the backend Turnstile allowlist/configuration and verify all three actions on that host. Configure public site links to it. |
| Environment secrets and origins | Public site keys and Google client ID may be exposed to the browser; provider secrets and Turnstile secret must stay server-side. The local gateway must accept both frontend origins. | Supply each environment's public site key, optional Google client ID and backend-only credentials; configure allowed origins and verify production HTTPS. Do not paste credentials into this repository. |

## Backend defects and contract limits at `c4b5445`

| Item | Current evidence | Needed to close |
| --- | --- | --- |
| Patient consent requests | Patient list/approve/deny routes call `consentContext()` and then `requireRequestContext()`, which requires a facility ID that a patient session does not carry. The frontend can send the routes, but this backend path blocks real use. | Give patient consent routes patient-scoped context without a facility requirement; test list, approve and deny with patient cookies and CSRF. |
| Emergency access to the detailed chart | Identity can create an audited break-glass grant with emergency purpose. EHR's ordinary encounter, vital, note, diagnosis, prescription and lab-request controllers call `clinicalContext()`, which accepts only `direct-care`. The distinct `GET /ehr/patients/:patientId/emergency-records` accepts `emergency` but returns only completed encounters and signed notes. | Define which detailed clinical reads, if any, an emergency grant permits; add explicit backend authorization and tests. Keep the frontend on the limited emergency summary until then. |
| Provider organization application | `organization-applications.service.ts` passes five arguments to `identity.submit_organization_application`; migration `0046_organization_onboarding.sql` declares six required arguments. | Reconcile the function call and migration; prove a public application can be submitted and reviewed. |
| Facility selection after reload | `/auth/facility` returns selected context but does not persist a new cookie; the provider portal must ask for a facility again after a reload. Browser storage outside the sanctioned auth hint is blocked by this repo's data policy. | Persist the authorized facility context in the backend session or return it from `/auth/session`, then verify reload and facility switching. |
| Lab draft activation | `LabRequestsService.create()` sends an order to Lab when created with `status: active`, while `LabRequestsService.update()` changes draft to active without calling Lab acceptance. The portal offers active creation, but a saved draft cannot become a Lab work item through the existing PATCH. | Make the draft-to-active transition perform the same governed, idempotent Lab handoff, and test conflict and retry behavior. |
| Direct cross-origin methods/headers | Identity's CORS list permits `GET`, `POST`, `OPTIONS` while PIN revoke uses `DELETE` and organization completion uses `PATCH`. Pharmacy CORS omits `x-csrf-token`. | Fix the backend CORS declarations for supported routes and verify preflight where requests can originate across origins. Same-origin production routing remains required for cookie sessions. |
| Facility audit and provider reporting | The provider portal reads Identity's permissioned facility audit at `/api/v1/audit/events`. The gateway routes `/api/v1/audit/*` to Identity, so EHR's identically named controller is not reachable there. No general provider reports/trends API was found. The platform audit screen uses `/api/v1/admin/audit/events`. | Decide whether EHR audit also needs its own route; add a permissioned provider reporting contract for the reference reports/trends workflow. |
| Platform-only administrator | Admin routes are marked facility optional, but `requireAdminContext()` requires an actor facility, and staff actor construction rejects accounts with no active facility membership. The portal cannot currently support a platform administrator without a facility. | Decide whether platform administrators must always have facility membership; if not, correct actor/context construction and test a platform-only login. |

## Configuration and contract decisions

| Item | Current evidence | Needed to close |
| --- | --- | --- |
| NIN verification | Identity's NIN provider is disabled by default behind release/security gates; its current `test` mode is allowed only under `NODE_ENV=test`. The patient verification form and provider registration case UI cannot make live verification operational by themselves. | Complete provider setup and release review; test with safe non-production identities before enabling NIN actions. |
| Provider registration case continuity | Identity exposes case lookup by UUID, but no case list/search. The case response does not report whether a pending account was already enrolled; the portal can show the enrollment form again after refresh and the backend then returns a conflict. | Add a permissioned facility-scoped case list or search and an enrollment state in case detail, with audit and pagination. |
| Google, OTP and bot checks | Frontend flows are wired to the backend's OIDC/OTP and Turnstile actions, but no staging provider configuration is available. | Verify configured providers, redirect origins, action names, token validation, rate limits and recovery behavior in staging. |
| OTP recovery audience | `PASSWORD_RESET` challenges are bound to the account matched by email or HID, while `staff-reset` and `admin-reset` describe Turnstile actions rather than a server-enforced account role. The portal asks for work email but the backend does not restrict the reset to staff or platform accounts. | Decide whether recovery needs actor-specific policy; if so, enforce it in the OTP service with tests while preserving generic responses that do not reveal account existence. |
| Provider onboarding depth | The backend has a narrow organization application/completion DTO, not the five-step registration or nine-step facility setup represented in `Dashboard.zip`. It has no server draft, department/branch, invitations, documents or setup-progress contract. | Decide which reference steps are product requirements, then define and implement their persisted backend contracts before exposing them as completed flows. |
| Lab and Pharmacy work queues | Facility-scoped list endpoints return patient IDs and work details with module read permission. Their individual `get` endpoints also call patient authorization; the list endpoints do not. | Confirm the intended policy for queue visibility, then enforce and audit the chosen minimum disclosure in the backend. The portal currently displays only abbreviated patient IDs in queues. |
| Lab execution list and result values | `LabExecutionsService.listForSpecimen()` checks `lab.execution.read` and queries under facility RLS, but does not call the patient authorization service used by `get()`. It aggregates each execution's result revisions, including values that have not been released. Knowledge of a specimen UUID could therefore expose values within the facility to a permitted staff member without the separate patient authorization check. | Apply patient authorization to each returned execution before aggregating result values, or define and enforce an explicit facility-wide result visibility policy. Test revoked/absent grants and unreleased results. |

## Reference workflows without an audited API

The following remain backend contract work before an operational frontend can
claim them:

- **Patient account:** general self-profile editing, patient-created sharing or
  invitations, patient revocation of an active staff grant, account deletion and
  patient-authored structured history.
- **Hospital operations:** appointments, triage queues, inpatient/ICU, maternity,
  surgery, radiology, claims and insurance, inventory, referrals, shifts/HR,
  quality, telemedicine, ambulance, blood bank, dental and procurement.
- **Provider organization:** facility staff invitation/membership mutations,
  branch selection, provider profile/credentials/presence and offline
  lease/sync/conflict handling.
- **Outreach:** public worker signup, OTP, invitation/join, visits and screenings.
  The staff-scoped campaign, member and registration-case routes are separate
  supported contracts and are wired in the provider portal.
- **Migrate:** bulk import, project matching, project/team lifecycle, a global
  completed-record index and intelligence analytics. OCR job, extraction,
  validation, patient confirmation and publication are supported routes.
- **Commercial/admin:** subscription, trial, invoice, payment and global AI
  processing administration. The existing public prices, demo intake and
  platform administration routes do not imply these capabilities.

Before adding any of these screens, agree a permissioned API with persistence,
validation and audit behavior in `hid-system`. Static reference UI and browser
fixtures do not resolve the missing contract.
