# Connected EHR acceptance evidence

## Profile and account-security evidence

`tests/profiles.spec.js` checks staff details and picture persistence/removal, hospital identity/logo persistence, unauthorized hospital edits, rejection of non-image uploads, unchanged membership authority, password eye controls across authentication forms, incorrect-current-password errors, credential replacement and session/code invalidation. Password values are asserted absent from persisted state.

Desktop and 390px mobile profile screenshots are saved under `artifacts/staff-profile-desktop.png` and `artifacts/staff-profile-mobile.png`. Reproduce with `node inspect-profile.cjs`.

## Facility registration and subscription evidence

`tests/facility.spec.js` adds three connected tests:

1. Five-step browser registration: first-error focus, Nigerian phone validation, geographic fields, document uploads, saved-draft restoration without passwords, four unticked agreements, submission, email verification and pending-facility routing.
2. Rejection/resubmission, idempotent trial start, 21-day grace, write restrictions after 42 days, preserved record reads, neutral staff UI, direct-route/service denial and simulated renewal.
3. Exact subscription roles, excluded-role response projection, reminder deduplication and separate renewal periods.

The original operational-setup test now supplies a valid registration and simulates facility approval before checking the existing nine setup steps. The facility suite separately verifies the new browser registration.

Reviewed screenshots: artifacts/facility-account-desktop.png, facility-details-desktop.png and facility-details-mobile.png. The 390px mobile viewport has document width 390. Reproduce with `node inspect-facility.cjs`.

Backend privacy, background delivery, trusted server time, regulatory verification and payment processing remain outside the selected simulation. See BACKEND-HANDOVER.md.

The numbered scenarios below correspond to section 33 of `HOSPITAL-EHR-SPEC.md`. Test numbers refer to declaration order in `tests/hospital.spec.js`. These are local frontend tests, not clinical, regulatory or production-security certification.

| Requested scenario | Evidence |
| --- | --- |
| 1. Owner registration, verification, nine steps, launch, refresh | Test 1 drives the browser flow and asserts the newly launched hospital has no patients. |
| 2. Nurse invitation and assigned access | Test 1 accepts the assigned membership and rejects billing creation and its direct URL. |
| 3. MFA, institution, last permitted page | Tests 1 and 7; test 7 signs out/in and restores the selected record URL. |
| 4. Reception registration and check-in | Test 2 creates identity, MRN, walk-in and queue; test 7 books/checks in via the browser and rejects overlap. |
| 5. Nurse triage, doctor consultation and orders | Test 2 asserts shared triage/encounter/order records; test 9 verifies unsigned editing and rejection after signing. |
| 6. Lab collection through published result | Test 2 checks restricted publication and final shared published state. |
| 7. Partial and final dispensing | Test 2 checks 4 + 6 dispensed, stock 100 ? 90, and over-fulfilment rejection. |
| 8. Invoice, partial/final payments, receipts/balances | Test 3 checks duplicate-operation protection, payments, paid state and refund limit; test 8 reconciles totals. |
| 9. Admission, transfer, discharge, turnover | Test 3 verifies bed state changes and saved discharge. |
| 10. External consent approval and revocation | Test 4 asserts returned content before/after each decision. |
| 11. Emergency access and category audit | Test 4 verifies justification-based access and the category-view audit. |
| 12. Session, route, branch and draft restoration | Tests 4 and 7 exercise persistence and browser reload; test 9 checks branch context. |
| 13. Direct URL/action restrictions | Tests 1, 2, 3, 7, 8 and 9 cover route, action, publication, financial export and branch boundaries. |
| 14. Procurement receipt without duplicate stock | Test 3 receives 8 + 12 units, closes the order and rejects further receipt; test 9 checks branch transfer stock. |
| 15. Report reconciliation | Test 8 compares actual invoice/payment/refund totals, date filtering, downloaded filename and export audit. |

## Additional enabled lifecycles

- Test 5: emergency, maternity/newborn, theatre, dental, ICU, nursing observation, telemedicine, referrals, ambulance, blood bank, shifts, credentials and quality incidents.
- Test 6: radiology scheduling/study/report/publication, insurance approval/settlement, password recovery/session invalidation and expired verification.
- Test 9: nursing task completion, local platform facility review and cross-branch inventory.
- Configuration views save facility, departments, branches, services, wards, vehicles, policies, memberships and restrictions. These are configuration records, not independent clinical lifecycles.

## Scope of verification

Core onboarding and appointment journeys are exercised through browser controls. Other lifecycle transitions primarily use the same service boundary called by the interface, with assertions on persisted records. Desktop and 390px mobile screenshots are reviewed separately. This does not assert exhaustive browser coverage of every action, screen-reader behavior, PDF renderer or every failure permutation.

## Explicit implementation limits

- One service line per invoice, one medication item per prescription, one stock receipt batch per receipt. Multiple records represent multiple items.
- Specialty documentation uses structured local forms and version history, without specialty-specific clinical algorithms or medical decision support.
- Diagnosis suggestions and medication inventory are fictional. Free-text documentation remains clinician-entered; no treatment is recommended.
- Patient-side consent and recipient/payer/platform decisions are explicitly simulated locally.
- No unavailable real-integration buttons are presented as working. Consumer portal, outreach, HID Migrate, developer portal and standalone lab/pharmacy onboarding remain outside this phase by request.
- Audit and permissions apply at application/service boundaries. All local browser data remains inspectable by its device owner.

See the final verification result in `LOG.MD`; test assertions and this evidence map must be updated together when behavior changes.

## Profile/presence phase coverage

`tests/presence-security.spec.js` adds six scenarios: email re-verification/credential reviewer permissions/device revocation/admin reset; neutral phone recovery and single-use grants/rate limits; presence timeout/facility policy and sound suppression/critical override; accessible crop controls and optional two-step login; regulatory review and profile history; replaced-code reset rejection. Existing invitation tests now exercise required first-login password change. Existing profile tests continue to cover eye controls, profile persistence, hospital edit permissions and password/session invalidation. Offline tests continue to cover durable encrypted queue and cache unlock.

Screenshots: artifacts/staff-profile-desktop.png, staff-profile-tablet.png, staff-profile-mobile.png. These are local fictional-data previews. Audio policy tests verify eligibility logic; they do not certify OS output routing, physical speaker volume or every browser's autoplay implementation. Cross-device realtime, delivered email/SMS, backend key custody and complete offline media/conflict workflows still require integration.

## Overlay and feedback acceptance

`tests/overlays.spec.js` covers seven scenarios: retained dirty profile edits/focus trap/return; typed deactivation and non-stacked dialogs; toast privacy, limits, expiry and persistent errors; passive connection popover and unobstructed mobile sheet/reduced motion; inline field links and DND; authorized workspace search/Back-to-close/no staff subscription payload; notification drawer and contextual record quick view. Existing registration/profile tests now exercise the agreement dialog, confirmation page and success toasts. Full suite passed 32 tests after integration.

Use UI-PATTERNS.md for the runtime inventory and pattern-selection guide. Local attachment progress represents reading/preparing a file, not an implemented backend media transfer. Backend offline-conflict/duplicate/media work remains tracked separately.


## Final overlay verification - 2026-10-03

After the final DND timing fix, toast input sanitization and unsaved-edit guards: TypeScript/build pass and all 32 Playwright tests pass. Shared color samples meet AA thresholds: text 5.00-17.35:1; input boundary 3.52:1. Desktop/mobile screenshots were reviewed; screen-reader behavior is covered through automated roles, accessible names and focus checks, not full assistive-technology certification.


Final phase 2a verification (2026-10-03): TypeScript and build pass. Full Playwright suite: 41/41 passed in 1.2 minutes, including all nine conflict-review scenarios. Desktop/mobile review screenshots inspected; local preview remains http://localhost:4173. No required checks for this phase remain outstanding. The separately documented offline backlog remains open.


## 2026-10-03 - Frontend readiness verification

Executed typecheck/build (pass), full 42-test suite (42/42 pass), 225 workspace/list/create viewport checks spanning 75 cases and all catalogue list routes, 24 auth entry checks and four 320px workspace checks. No page overflow or page errors in those states; no unnamed visible native controls in the workspace sweep. Added verify-frontend.cjs and verify-frontend-limits.cjs, raw JSON artifacts and FRONTEND-VERIFICATION.md. Updated FRONTEND-READINESS.md with actual evidence rather than marking all gates complete.

Verdict: NOT frontend-production-ready. Confirmed that patient search terms persist unencrypted and survive sign-out. Source audit found no repeated-failure attention threshold and raw sync reasons in the UI. Remaining agreed offline client flows, adapter/state-contract verification and full accessibility/browser acceptance remain open. A 2,000-row probe rendered every row and 24,233 DOM nodes, indicating a need for bounded rendering and formal performance budgets. Tests used isolated fictional data. Application fixes are not claimed in this verification turn; prioritized findings FE-01 through FE-06 are in the report. Backend implementation stays outside the delivery target.
