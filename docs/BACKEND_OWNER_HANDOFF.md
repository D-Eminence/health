> - **What this is:** the verified backend hand-off for the hid-system owner. Health-id does not change hid-system (it is read-only from this repository), so every item below is for hid-system's maintainers. In the body a bare `#N` is a hid-system PR (written hid-system#N in the rest of these docs), and Health-id's own PRs are written "Health-id #N". Health-id cites the items its screens depend on by id in [open questions](./OPEN-QUESTIONS.md), the [gap map](./HEALTH_ID_COMPLETE_FRONTEND_GAP_MAP.md) and the [Stage 2B report](./PHASE_4_STAGE_2B_FRONTEND_SECURITY.md).
> - **Basis:** hid-system `main` at `bbc6e89` (this refresh of the `6b49a06` hand-off re-maps every hid-system citation to it), and Health-id `main` after the six readiness PRs (Health-id #42, #44 to #48; `0eda90f`) and the hid-system alignment PR, Health-id #49 (merged as `cf32087`, final head `e42a0a2`). The body keeps its Health-id citations at the audit basis `c880421`, and its context bullet "Health-id since the audit basis" and section 9 describe `0eda90f`, before the alignment PR: their statement that Health-id handles none of the contract changes #48 to #61 introduce is no longer so (next bullet).
> - **Since `bbc6e89` (read-only watch at `b69a6ab`, merge of #65).** `main` merged four more PRs on 2026-10-13, none released. This note updates the body where those PRs made it untrue; the other status lines are still as at `bbc6e89`.
>   - **#63** (`aa3ebc4`): role bootstrap as a non-superuser RDS administrator; migration `0083_ocr_claim_in_body_variable_conflict`. **#64** (`215524d`): EHR clinical safety, migration `0084`. The ledger now ends at 0084, so #47 must take **0085** (rule 5, C1); its trial merge onto `b69a6ab` (`git merge-tree`, which writes nothing) conflicts in eight files (C1).
>   - **#64**: changing an encounter's status now closes its records in the same transaction. Cancelling cancels its draft, active and on-hold prescriptions and lab requests. Entered in error marks those orders, its notes and its diagnoses entered in error, and is now allowed from `completed`. Creates and order activations on a closed encounter answer `409 ENCOUNTER_NOT_OPEN`. Migration 0084 deletes five Lab and Pharmacy write permissions (`services/ehr-api/src/ehr/encounters/encounters.service.ts:38-81, 207-234`; `docs/INTERFACE_CONTRACT.md:855-892`). Lab and Pharmacy are still not told (`:882-883`), so A1 and A3 stay open. Health-id: the encounter status form says what the change does, and the records list shown is read again after Cancel or Mark entered in error (Health-id #51). That wording holds only against an EHR with #64, so Health-id deploys with or after it (C2).
>   - **#54** (`fa811b7`): ADR-047 is accepted (2026-10-13; `docs/DECISIONS.md:2462-2475`): one environment-bound workload issuer for staging and production. Nothing is deployed: staging needs I5 and production needs I6 (D9).
>   - **#65** (`b69a6ab`): the edge carries the client address in `X-Real-IP` and Identity keys its start limits per client network. This is hid-system's IP-1, the defect A7 describes (`docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:242`). A7 has not been re-verified item by item. In staging and production the gateway requires that header and refuses a request without it with `403 CLIENT_ADDRESS_REQUIRED` (`gateway/proxy-headers.conf:13-16`), so any Worker serving a Health-id build must set it the way hid-system's Workers do (D1). The gateway also proxies only Identity and EHR at launch, and a production synth refuses any other module (`infra/aws/src/config.ts:38, 195`). Every Lab, Pharmacy, OCR and Outreach route answers `404 API_ROUTE_NOT_FOUND` with no detail (`gateway/nginx.conf.template:51-66, 190-245`; `docs/INTERFACE_CONTRACT.md:21-26`).
>   - **New ask (MOD-1, beside D1 and C2).** While those four modules are off, migrations still seed their read permissions, to doctor, clinician, nurse and admin among others (`0018`, `0023`, `0013`, `0024`; 0084 deletes only five write permissions; hid-system decision D17 sets the launch modules). Health-id shows workspaces by permission, so those roles still see Laboratory, Pharmacy, Migrate/OCR and Outreach, and every load answers 404. Health-id now says the module is not in service on this deployment. To hide the workspaces, either withdraw those read permissions while a module is off, or expose the enabled module set to the browser. Note also that `docs/INTERFACE_CONTRACT.md:843-844` ("remain readable") and `docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:213` ("Reads stay") contradict the route closure.
> - **Addressed on Health-id's side.** These are frontend parts only: none closes a backend item, and each also handles the answer of a hid-system build without the change.
>   - Readiness PRs: the A1 and A3 warnings at the status forms, the A2 cap notice, the A11 and B1 emergency summary (sections only for a role with each read permission, no vitals), the B5 publication key in page memory, and the facility chooser working without `facilitySelection` (C1).
>   - hid-system alignment PR, for the contracts of #48 and #50 to #61:
>     - A3 (#56): a role holding `lab.work-item.accept` can activate a draft or resume a held request, each sent to Lab, create an active request, and send a saved active request again (Send to Lab, `POST …/lab-work-item`). Every `labHandoff` state is said. Hold, cancel, completion and entered in error stay unoffered for a request Lab may hold (A3 remaining, E18).
>     - A25 (#56): `409 LAB_HANDOFF_REFUSED` and `502 LAB_HANDOFF_UNCONFIRMED` on create are read as a saved active request: the list is read again, the form and its key clear, and the work continues at Send to Lab. Behind today's gateway the 502 arrives as `503 UPSTREAM_UNAVAILABLE` (A8), which the portal cannot tell from an outage.
>     - A1 (#48): a dispensing refused with `409 PHARMACY_PRESCRIPTION_NOT_DISPENSABLE` marks the work "Not dispensable"; Send to Pharmacy explains `409 PHARMACY_PRESCRIPTION_NOT_ELIGIBLE`, EHR's 412 and `409 PRESCRIPTION_NOT_ELIGIBLE`, and `409 IDEMPOTENCY_CONFLICT`; the prescription warning is worded to hold with or without 0080. A1(a), the state before an attempt, still needs the backend.
>     - A11 and E15 (#52): the patient records page says a withheld section is not yet shared and follows `truncated` and `limits`; the emergency summary says a withheld section is not included, follows `truncated`, and says its documents passed the scan.
>     - B6 (#51): "View released results" under each lab request that may have reached Lab, in the clinical record and, under the emergency purpose, in the emergency summary; `releasedAt` in the Lab result history.
>     - B14 (#58): a break-glass refused with `400 INVALID_CONSENT_COMMAND` says emergency access may not be enabled for the deployment.
>     - A15 (#59): a document left `initiated` says the upload was not completed and that only the person who started it can finish it.
>     - A5 and B5 (#60): OCR's `503 EHR_SERVICE_AUTH_UNAVAILABLE`, `LAB_SERVICE_AUTH_UNAVAILABLE` and `PHARMACY_SERVICE_AUTH_UNAVAILABLE` read as a failed connection between services (behind the gateway these also arrive as `503 UPSTREAM_UNAVAILABLE`, A8); `OCR_PUBLICATION_IN_PROGRESS` also names "no attempts remain"; the publication key is held per signed-in account.
>     - E19 (#55, #61) and #50: after a refused code, recovery and enrollment say what a spent code budget does; recovery offers "Start again for a new code" once `resendAfterSeconds` has passed; an enrollment that a sign-in or sign-out on the device ended continues from the NIN step with the same start key; and `429 ENROLLMENT_RATE_LIMITED` at activation is explained.
>   - hid-system#68 (merged after this hand-off's basis; read at `main` `8f3eff1`), for E20(a): the enrollment page reads `GET /identity/patient-enrollments/availability` (FE-4) and offers a start only on `200 { open: true }`; otherwise it says registration is not open yet, with sign-in and recovery links, or that the check failed. An enrollment in progress continues. For E20(b) and (c): `409 ENROLLMENT_CONTACT_REVERIFY_REQUIRED` at activation returns to the contact step, and the completion screen asks the patient to save the HID, which may not be shown again. Unlike the items above, an Identity without #68 answers the read with 404 and the page offers no start, so Health-id deploys with or after #68.
>   - Launch alignment (Health-id branch `claude/launch-alignment-fixes`, against hid-system `main` `8f3eff1`, which production is to run):
>     - A24 (#76): the console searches users with `POST /admin/principals/search` and exports with `POST /admin/principals/export`, the terms and the reason in the JSON body with the platform CSRF token. The registry holds no `GET` form, so hid-system can remove the deprecated `GET /admin/principals` and `GET /admin/principals/export` once no earlier console is deployed.
>     - ENC-RETRACT-1 and -2 (#74, migration 0090): the encounter status form says what a retraction now also marks entered in error (final vitals, completed orders, initiated or uploaded documents) and that cancelling changes nothing but open orders; `403 ENCOUNTER_RETRACTION_NOT_PERMITTED` says the role may not make that change, that nothing changed and to ask a colleague, naming no kind of record. The portal still offers Cancel and Mark entered in error to every role holding `ehr.encounter.write` (the EHR decides), and no retraction of a completed encounter.
>     - ENC-RETRACT-2 (#74): a vital with `status: entered_in_error` is marked so in the Vitals tab, keeps its values and offers no correction; a correction answered `412 VERSION_CONFLICT` or `409 VITAL_NOT_AMENDABLE` reads the vitals again and says whether the vital was marked entered in error. The single-vital retraction route (`POST …/vitals/:vitalId/entered-in-error`) is not offered. `INTERFACE_CONTRACT.md` says a correction of a vital entered in error answers the 409, but `vitals.service.ts` `correct` checks `expectedRowVersion` first and a retraction raises it, so a client that loaded the vital before the retraction gets the 412; the contract could say so.
>     - A9 (#74 and #76, ADR-059): a patient request answered `403 PATIENT_SESSION_REQUIRED` makes the patient portal ask `GET /auth/session` whose session the browser holds before the refusal reaches the page; a provider's or administrator's session found there signs the tab out and sign-in says the sign-in changed elsewhere. The 403 alone ends nothing.
>     - MOD-1 (#75, migration 0091): with no role holding any `ocr.*` permission, the dashboard's Health ID Migrate card and `/provider/migrate`, the last OCR entry points shown to every role, are shown only with `ocr.job.read`.
>   - Patient sign-up against hid-system `main` `f9dbaf0` (Health-id branch `claude/patient-signup-online`; #82, #84, #85 and #86, ADR-061 to ADR-063), for E20(a) and (d) and the patient rows of hid-system's "Health-id alignment" list (`PHASE_4_STAGE_5_RELEASE_READINESS.md` section 3, rows 1 to 3, 6, 8 to 10, 13 to 15 and 17; P31 and P33):
>     - The registry and the patient-web grant name `POST .../holder`, `/holder/verify`, `/facility-code` and `GET .../participating-facilities`; availability is read as `{ open, online, facility }` with `open` the only gate, and the NIN step says how the NIN will be proved. `@hid/contracts` and `@hid/api` follow.
>     - `verify_holder`: the choice of the code texted to the phone on the NIN record or the facility, the code with every answer of the contract table (the resend wait from `Retry-After` or `online.resendAfterSeconds`), the facility stage with the desk code shown again after a reload and replaced only when asked, "I have been checked" reading `GET .../current`, and its `404` answered with the staff member's direction (P31) and the start key kept for the same NIN. `409 NIN_HOLDER_PROOF_CONFLICT` is read as 0094 answers it: another registration of the NIN was already checked in person and is finished on the phone used at the facility.
>     - The password step asks for the date of birth or gender a record lacks (ADR-061). `409 NIN_ALREADY_REGISTERED` after a correct code or at activation leads to account recovery, sign-in and support with the `correlationId`; `409 ENROLLMENT_HOLDER_PROOF_REQUIRED` starts again with a new key; `404 ENROLLMENT_NOT_FOUND` names its other causes; the start's `409 IDEMPOTENCY_KEY_REUSED` (the key's registration is active) says the registration was completed and offers sign-in and account recovery. The signed-in Verify NIN card is hidden until P27.
>     - The staff check, the admin designation and the problem `fields` member (rows 4, 5 and 7) are D-Eminence/Health-id#56, merged; the provider rows (11, 12 and 16) are not done.
>   - Facility-assisted registration, staff and console (Health-id branch `claude/assisted-staff-screens`, against hid-system `main` `f9dbaf0`: #85, migration 0094, ADR-063; this answers E20(d) on Health-id's side, since #85 builds the route behind `ASSISTED_REGISTRATION_ENABLED`, off):
>     - The provider portal's in-person check sends `POST /identity/assisted-verifications` with `X-Facility-ID`, CSRF, purpose `healthcare-operations` and one `Idempotency-Key` per submission, kept while the answer is unknown so a `503 ASSISTED_VERIFICATION_UNAVAILABLE`, `ENROLLMENT_RECONCILIATION_REQUIRED` or `ENROLLMENT_UNAVAILABLE` is checked again as the same check. It handles every answer in the contract table and shows the `422` per-field result from `fields`, which `@hid/http` now keeps (Health-id dropped it before).
>     - The console's facility page reads and changes the designation (`GET`/`POST /admin/facilities/:facilityId/assisted-registration`), the first with `If-Match: 0`, which the console's command helper used to refuse. It reads it on every facility page, flag or not; an Identity without #85 answers the unknown route `404 NOT_FOUND`, which the panel shows as a quiet "not available on this Identity service yet" note. Deploy order: the console with or after an Identity carrying #85 (open questions, "Deploy order for the designation read").
>     - An active designation counts only for a verified, active facility of an active organization (0094's `facility_assisted_registration_participating`), and nothing suspends it when the facility's status changes. The designation read carries neither the facility's nor the organization's state, so the panel can say "Not in effect" only from the facility's own status (not verified); an inactive organization or `facility.active` false is not visible to it. Observation, no new item.
>     - Observations, no new item: `403 ASSISTED_REGISTRATION_NOT_AUTHORIZED` gives staff one answer for four causes, so the screen names them all (the facility taking part, an active account, a sign-in confirmed with an authenticator, an attested clinical grant and an active membership); the designation read answers a missing facility `404 ADMIN_FACILITY_NOT_FOUND` and the command `404 ADMIN_RESOURCE_NOT_FOUND`, both handled; `429 ASSISTED_VERIFICATION_LIMITED` carries no `Retry-After` (A21), so staff are told only to try later.
>     - The patient screens of the route (the facility list, the desk code and the continuation after the check) are on Health-id's patient sign-up branch; until both are deployed the flag must stay off (hid-system P31, P33).
>   - Not done from section 9's frontend list: Sign out on "No facility assignment" (A10); Reject is still offered on a `required` specimen (A12); prescription Cancel and Hold after a handoff are still offered, with the warning (A1); no Pharmacy join for dispensing status (B6); no break-glass grant recovery by replay (B11). Patient recovery offers "Use a different email or Health ID" at once, so a restart with the same account's other identifier within `resendAfterSeconds` gets an id with no code (section 11, A13 residuals).
>   - Deploy order: the alignment PR's Lab actions need an EHR with #56, deployed after the Lab with #56 (C2); see open questions.

# hid-system backend work required by the Health-id portal

Basis: hid-system `main` at `bbc6e89` (merge of #62). The previous basis was `6b49a06` (merge of #46); since then `main` merged #48 to #53 and #55 to #62 (2026-10-12, 14:39Z to 19:09Z), none of them released. Every hid-system citation below is `path:line` at `bbc6e89` unless it says `#47@1c18e91` (open PR #47, unchanged since the previous basis) or `@6b49a06`. Health-id citations are prefixed `Health-id:` and refer to Health-id `main` at `c880421`, the audit basis; Health-id `main` is now `0eda90f` and those lines were not re-cited. All claims were traced statically from code and re-checked at `bbc6e89`; #47 was re-checked by a read-only three-way trial merge onto `bbc6e89` (`git merge-tree 6b49a06 bbc6e89 1c18e91`, which writes nothing). Nothing was run against a database or a deployed stack unless stated.

**Status lines.** Every item carries a **Status at `bbc6e89`** line: **fixed** (the item is moved to section 11 with the fixing PR), **partly fixed** (the item stays, rewritten to what remains, and the fixed parts are also listed in section 11), **still open**, or **changed** (still open, but the code, contract or context moved; the change is stated). **New** marks an item found in the 14 merged PRs.

---

## 0. Context

- **Health-id** (`D-Eminence/Health-id`) is the frontend: the public site, the patient portal, the provider portal (EHR, Laboratory, Pharmacy, Migrate/OCR, Outreach, Registration, Access) and the platform admin console. It is a separate repository. Do not change it from this work.
- Health-id calls **only** the `/api/v1` routes listed in its registry (`Health-id: packages/contracts/src/registry.ts`). A new route, a changed method, a changed request or response field, or a new status/code is a contract change the frontend must be told about (see section 10).
- Health-id uses cookie sessions on the portal origin (`credentials: 'include'`, CSRF header from the cookie, `X-HID-Client` on refresh and logout, `X-Facility-ID` and `X-Purpose-Of-Use` on every facility-scoped call).
- Health-id **never treats a 503 as a session mismatch or sign-out**. A 503 is shown as "temporarily unavailable, try again" and the session is kept. A 401 is treated as "the session may have ended": the staff portal locks the workspace and asks `GET /auth/session`; the patient portal shows sign-in; the admin console reports the session ended for `AUTHENTICATION_REQUIRED`. Therefore the backend must answer **401 only when the presented credential is definitively invalid or ended**, and answer faults with 5xx.
- Health-id **stores no clinical data in the browser** (no localStorage, sessionStorage, IndexedDB, Cache API or service worker; enforced by lint). It cannot work around a missing backend contract by caching state client-side. Anything that must survive a reload has to come from the backend. (This is why hid-system's proposed default D16, "persist the publication key per validation" in the browser, cannot be Health-id's answer to B5.)
- The patient portal and the provider portal are served from **one origin** and share the session cookies Identity sets (`services/identity-api/src/auth/auth.controller.ts:500-515`; since #50 every cookie set or clear also expires the public enrollment cookie `hid_enrollment`).
- **Health-id since the audit basis.** Health-id `main` is now `0eda90f` (Health-id #42, #44 to #48 merged). It has addressed the frontend-impact items it could: the emergency summary shows diagnoses, prescriptions, lab requests and documents (listed, never opened) only to a role holding each read permission, and shows no vitals (A11, B1); the clinical record warns that prescription and encounter status changes do not reach Pharmacy or the Laboratory, warns that a draft lab request is never sent, and offers no change to a lab request the Laboratory may be working on (A1, A3); the Lab and Pharmacy lists say when they reach the 200-item cap (A2); OCR publication retry reuses one Idempotency-Key held in page memory (B5); the facility chooser (Health-id #42) is merged and works without `facilitySelection` (C1). Health-id `0eda90f` handles none of the contract changes that #48 to #61 introduce (no code reads `labHandoff`, `LAB_HANDOFF_*`, `withheld`, `PHARMACY_PRESCRIPTION_NOT_*` or the released-results route); each item lists them under its frontend impact.
- **hid-system's own decision record.** #57 and #62 added `docs/PHASE_3_LAUNCH_DECISIONS.md` (open decisions N1 to N5 and D1 to D16, with proposed defaults, and operator plans I1 to I8; nothing in it is decided or executed). Section 7 maps each E item to it.

## 1. Working rules

1. Read `CODEX.md`, `docs/README.md`, `docs/DECISIONS.md`, `docs/INTERFACE_CONTRACT.md`, `docs/SECURITY.md`, `docs/CODING_STANDARDS.md` and `docs/PHASE_3_LAUNCH_DECISIONS.md` before you start. Accepted ADRs are constraints.
2. **One issue, or one small group named in this document, per PR.** Branch from current `main`. Keep each PR reviewable.
3. **Failing-first tests.** For every defect, first add the test that fails on `main` and show it failing (paste the failing output in the PR), then fix. Use the repo's existing styles:
   - jest specs next to the code (`*.spec.ts`, e.g. `services/identity-api/src/audit/auth-refusal-audit.spec.ts` registers the real `AuditInterceptor`);
   - rollback-only SQL suites in `services/ehr-api/database/tests/*.integration.sql` (the rehearsal picks up every additional suite automatically: `scripts/tuf-staging-migration-rehearsal.mjs:329-334`; the container acceptance lists them explicitly: `scripts/run-container-database-acceptance.sh`);
   - exact-role HTTP verifiers `services/*/scripts/verify-*-runtime.mjs`, each wired into `scripts/tuf-staging-migration-rehearsal.mjs:342-382` (add a new verifier there and in `docs/TUF-STAGING-MIGRATION.md`; #56's `verify-ehr-lab-handoff-runtime.mjs` is the latest example);
   - gateway and worker checks in `scripts/verify-container-platform.mjs` and `infra/cloudflare/test/frontend-worker.test.mjs`.
4. **Never relax an audit rule, a CHECK constraint, an RLS policy or an authorization check to make a test pass.** Where this document asks for a policy change (for example after a product decision in section 7), make it deliberately in a new migration and an ADR, with tests that pin the new rule.
5. **Forward-only migrations.** Never edit an applied migration: `0001`-`0084` are in the immutable ledger (#48 took 0080, #55 0081, #58 0082, #63 0083, #64 0084; at `b69a6ab`). Open PR #47 still carries `0080_session_facility_selection.sql` and must be renumbered to `0085` (C1). Number new migrations from `0086` (or the next free number once #47 merges) and renumber on rebase if needed. For each migration update `release/config/components.json` (`last`, `count`, file `sha256`), the accepted map in `scripts/verify-migration-ledger.mjs`, `services/ehr-api/database/runtime-grants.sql` for any new object, the migration range string and suite list in `scripts/run-container-database-acceptance.sh`, the `docs/MIGRATION_RUNBOOK.md` table (lock impact, order relative to the role bootstrap and to the service deploy) and `docs/PHASE_4_STAGE_5_RELEASE_READINESS.md` §1 and §5. #55's diff (0081) is a complete example.
6. **Run the gates** before asking for review: each touched service's `npm --prefix services/<svc> run typecheck`, `lint` and `test`; root `npm test` and `npm run verify`; and the migration rehearsal (`scripts/tuf-staging-migration-rehearsal.mjs`) whenever a migration, grant, SQL function or runtime verifier changes.
7. **Update the affected docs in the same PR:** `docs/INTERFACE_CONTRACT.md` (routes, fields, status codes, error codes), `docs/DATABASE.md` (new objects), `docs/DECISIONS.md` (an ADR for every policy change), `docs/MIGRATION_RUNBOOK.md`, and `docs/PHASE_4_STAGE_5_RELEASE_READINESS.md` (release order, staging checks S4*, known limits). Where a fix settles a question in `docs/PHASE_3_LAUNCH_DECISIONS.md`, update its row. Other docs are named per issue.
8. **No deployment, DNS, Cloudflare, AWS, secret, environment-variable or production-data change** without separate, explicit authorization. Code and config changes to `infra/`, `gateway/` and `release/` are in scope as PRs; applying them is not (the operator plans I1 to I8 stay unexecuted until authorized).
9. Keep PHI out of logs, audit `details`, URLs and error `detail` strings. 5xx Problem Details keep their generic `detail` (the ProblemDetailsFilter already does this; see A25 for what that costs a 5xx that must name a saved row).
10. If a fix needs a product decision (section 7) that has not been made, do not guess: implement only the parts that do not depend on it, and report the open decision.

## 2. Summary

Counts (open or partly fixed): A defects 24 (P0 6, P1 8, P2 10; A13 fixed, A25 new); B contracts 14 (P0 3, P1 4, P2 7; B14 new); C release work 2; D infrastructure 9 (D8, D9 new); E decisions 20 (E17 to E20 new); F roadmap 7 groups. Fully fixed since `6b49a06`: A13. Partly fixed: A1, A3, A5, A11, A14, A15, B6, D4.

| ID | Cls | Pri | Issue | Status at `bbc6e89` | Blocked on |
|---|---|---|---|---|---|
| A1 | A | P1 (was P0) | Pharmacy work whose EHR prescription changed: dispensing now refused, but the state is invisible and resumed or edited prescriptions are stranded | partly fixed (#48, 0080) | E18 (lifecycle part) |
| A2 | A | P0 | Lab and Pharmacy queues return the 200 oldest work items; new orders disappear | still open (worse: #48 strands items in the window) | - |
| A3 | A | P0 | EHR lab-request cancel/hold/entered-in-error/priority changes after Lab accepts never reach Lab | partly fixed (#56: draft to active, resend route, 409 instead of 500) | E18 (withdrawal policy) |
| A4 | A | P0 | Identity guard answers 401 to database faults; every service relays it | still open | - |
| A5 | A | P0 | Service-to-service (workload) auth failures reach the browser as 401 | partly fixed (#60 OCR mapping, #56 EHR-to-Lab handoff, #53 JWKS reuse) | - |
| A6 | A | P0 | `POST /auth/refresh` clears cookies on 5xx and after a committed rotation | still open | - |
| A7 | A | P0 | Per-IP rate limits and lockouts key on the load balancer address | still open (new budgets in #55, #61 avoid IP keys) | - |
| A8 | A | P1 | Gateway replaces every upstream 502/503/504 body and headers | still open (now also masks A25's 502) | - |
| A9 | A | P1 | Patient-only routes answer 503 (and audit nothing) to a staff sign-in | still open | - |
| A10 | A | P1 | Staff with no active membership: correct password answers 401 | still open (changed by #50) | - |
| A11 | A | P1 | Emergency summary returns vitals as first recorded (corrections ignored) | partly fixed (#52: limits, truncation, documents, permissions, audit) | E17 |
| A12 | A | P1 | Lab answers 500 to refused specimen and verification transitions | still open (narrow mappings added by #48, #56) | - |
| A14 | A | P1 | Lab/Pharmacy/OCR answer a patient session and a missing facility with the wrong codes | partly fixed (#60: purpose header 400) | - |
| A15 | A | P2 | Document routes answer generic codes and return numbers as strings; completion binding has no database backstop | partly fixed (#59: uploader-only completion) | - |
| A16 | A | P2 | Platform-admin grant bypasses maintenance mode for staff sessions | still open | - |
| A17 | A | P2 | Audit fidelity: refusal codes missing; Pharmacy/Outreach/Lab-guard refusals unaudited | still open | - |
| A18 | A | P2 | Delegated authorization check grants write scope on a reported read | still open | - |
| A19 | A | P2 | Disallowed CORS origin answers 500 in all six services | still open | - |
| A20 | A | P2 | Authenticated platform step-up answers 401 for a wrong code | still open | - |
| A21 | A | P2 | No `Retry-After` on 429/503; not exposed by CORS | still open | - |
| A22 | A | P2 | Demo-request replay with a different body is accepted | still open | - |
| A23 | A | P2 | Validation errors drop nested field paths (EHR, Lab) | still open | - |
| A24 | A | P2 | Admin principal search/export put PII and reasons in GET query strings | still open | - |
| A25 | A | P1 | **New (#56).** EHR lab-request create answers 409/502 after the request is saved; the 502 loses its detail and becomes 503 at the gateway | new | - |
| B1 | B | P0 | Break-glass cannot open the chart; emergency reads are facility-local | still open (changed: #52 permission filter; `emergency` code unseeded, B14) | E1 |
| B2 | B | P0 | Lab/Pharmacy staff need their own patient grant per patient: empty queues | still open | E2 |
| B3 | B | P0 | Onboarded organizations get only org_admin; no workforce or member API | still open | E4 |
| B4 | B | P1 | OCR needs two grant purposes the portal cannot obtain together | still open (changed: `healthcare-operations` unseeded, B14) | E3 |
| B5 | B | P1 | Failed OCR publication cannot be retried by id; exhausted retries never end | still open (changed: #60 makes workload refusals retryable) | - |
| B6 | B | P1 | No dispensing state from the order; nothing for the patient | partly fixed (#51: clinician released results by EHR order) | E15 (patient part) |
| B7 | B | P2 | Session contract: actor kind, expiries, end reasons, targeted logout | still open | E6 (reasons, expiries) |
| B8 | B | P2 | Registration case list/search and enrollment state | still open | - |
| B9 | B | P2 | No production NIN provider for provider-initiated registration | still open | - |
| B10 | B | P2 | Outreach case list capped at 100 without cursor; campaign writes refused | still open | E5 (writes) |
| B11 | B | P2 | Clinician cannot list their own active grants (break-glass included) | still open | - |
| B12 | B | P2 | No facility OCR job list | still open | - |
| B13 | B | P2 | Documents without an encounter cannot be listed | still open | - |
| B14 | B | P1 | **New (found and partly fixed by #58).** Purpose codes `emergency` and `healthcare-operations` are not seeded: break-glass and OCR job commands are refused on a migrations-built database | new | E1, E3 |
| C1 | C | - | PR #47 (facility selection per sign-in, ADR-046): renumber 0080 to 0085, resolve eight conflicts (at `b69a6ab`), re-verify; pre-merge fixes and deploy order | changed | A6, A8, E7 |
| C2 | C | - | Merged but unreleased: #39, #41, #42, #46 (and #31, #33-#38, #40, #43-#45), now also #48-#53 and #55-#62 (migrations 0080-0082) | changed | D3 |
| D1-D9 | D | - | Hosting, Turnstile hosts, staging, secrets/origins, NIN credentials, CSP, access logs, malware scanner, production workload issuer | D4 partly fixed (#49); D8, D9 new (D9: ADR-047 accepted by #54, not deployed); rest still open | E8, E9 |
| E1-E20 | E | - | Product decisions | all open; E14 corrected; E17-E20 new | - |
| F | F | - | Feature API roadmap (reference workflows with no backend) | still open | E16 |

Suggested order (patient safety first, then sessions): A3 (cancel and priority propagation) with A25, then A1's remaining visibility and lifecycle (after E18), then A2; then A4, A6, A5, A7, A8 (one PR each; A8 also unmasks A25's 502 and C1's refresh 503); then C1 (renumber to 0085, rebase, re-run gates); then B14 together with E1 and E3 (break-glass and OCR are unusable on a migrations-built database until it lands); then A9, A10, A11(a) after E17, A12, A14; B1-B4 as soon as E1-E4 are decided; the rest in any order.

---

## 3. Class A: defects in existing behaviour

### A1 (P1, was P0). Pharmacy work whose EHR prescription changed: dispensing is refused since #48, but the state is invisible and a resumed or edited prescription is stranded

**Status at `bbc6e89`: partly fixed by #48 (migration 0080).** Fixed: the database refuses an acceptance that is not the exact active prescription version and a dispensing whose prescription is no longer `active` at the version Pharmacy accepted; both guards read `ehr.prescriptions` `FOR SHARE` inside Pharmacy's SERIALIZABLE transaction, so this holds for any API client, and Pharmacy answers `409 PHARMACY_PRESCRIPTION_NOT_ELIGIBLE` and `409 PHARMACY_PRESCRIPTION_NOT_DISPENSABLE` (`services/ehr-api/database/migrations/0080_pharmacy_source_prescription_guards.sql:52-114, 116-163`; `services/pharmacy-api/src/pharmacy/pharmacy.service.ts:74-93, 122-137, 199-210`; `docs/INTERFACE_CONTRACT.md:998-1036`). This is a guard on the source row, not the withdrawal command this item proposed at `6b49a06`. What remains is below.

**Problem (remaining).**
- (a) **No visible state.** A work item whose prescription was cancelled, held, completed, marked entered in error or edited stays `status: 'accepted'` with `dispensing: null` in `GET /pharmacy/work-items` and `GET /pharmacy/work-items/:id` (`pharmacy.service.ts:344-355`); the screen keeps offering Dispense until the 409. Inside A2's oldest-200 window these items never leave the list.
- (b) **Stranded prescriptions.** The guards require the accepted version, so any EHR edit (frequency, instructions, `endsOn`) or a hold then resume makes the work item permanently undispensable, and the new version cannot be handed off: the re-acceptance finds the existing work item by `source_ehr_prescription_id` and answers `409 IDEMPOTENCY_CONFLICT` (`pharmacy.service.ts:113-121`). The contract's remedy is a new prescription (`docs/INTERFACE_CONTRACT.md:1033-1036`), but the EHR still offers resume and edit on a handed-off prescription without saying so (`services/ehr-api/src/ehr/prescriptions/prescriptions.service.ts:59-66, 140-177`). This is decision E18 (hid-system D10).
- (c) **No Pharmacy state in EHR.** The prescription projection carries none (`prescriptions.service.ts:35-41`), and a cancel committed after a dispensing "is reported to neither side" (`docs/INTERFACE_CONTRACT.md:1031-1032`).
- (d) **Three snapshot fields not compared yet.** The acceptance guard skips `prescribed_at`, `starts_on` and `ends_on` until the EHR rollback floor sends their exact texts (0080 header `:21-28`; `prescriptions.service.ts:43-57`; `docs/INTERFACE_CONTRACT.md:1443-1455`).
- (e) **A stalled Pharmacy transaction blocks EHR writes.** A Pharmacy transaction that stalls after the guard keeps the share lock; a prescriber's cancel or hold then waits for EHR's 15 s `statement_timeout` and fails with `500`. No `idle_in_transaction_session_timeout` is set (`docs/DECISIONS.md:1948`, "ADR-042 addendum", third bullet).

**Frontend impact.** Health-id warns that status changes do not reach Pharmacy. Once #48 is deployed, Dispense on a withdrawn item answers `409 PHARMACY_PRESCRIPTION_NOT_DISPENSABLE`, Send to Pharmacy on a changed prescription `409 PHARMACY_PRESCRIPTION_NOT_ELIGIBLE` (EHR passes it through), and Send to Pharmacy after a hold-and-resume `409 IDEMPOTENCY_CONFLICT`; Health-id can explain these only after the attempt. Once (a) to (c) ship: the Pharmacy screen shows the item as not dispensable and the clinical record shows the Pharmacy state per prescription.

**Required fix (remaining).**
1. Expose the source state on the work item, in the list and the read: for example `source: { status, version, current }` or `dispensable: boolean`, computed by the guard's rule (prescription `active` at the accepted version), read without a lock. A2's open state must treat a non-dispensable, undispensed item as not open (or offer `state=withdrawn`).
2. After E18: either allow a new work item for the new prescription version (an ADR on one work item per prescription) or refuse the EHR resume or edit of a handed-off prescription with a named `409` (for example `PRESCRIPTION_IN_PHARMACY`). In both cases the re-handoff of a changed version must answer a code that names the case, not `IDEMPOTENCY_CONFLICT`.
3. Expose Pharmacy state on the EHR prescription projection (`pharmacy: { workItemId, dispensable, dispensed, reversed } | null`), or document that clients join `GET /pharmacy/work-items` on `sourceEhrPrescriptionId` (B6).
4. The follow-up migration that compares `prescribed_at`, `starts_on` and `ends_on`, once no deployable EHR build sends `Date` values.
5. Set `idle_in_transaction_session_timeout` for the Pharmacy runtime role (or document why not), and answer an EHR prescription update that times out on the lock (`57014`) with `503`, not `500`.

**Acceptance tests (failing first).** `verify-pharmacy-runtime.mjs`: after an EHR cancel, `GET /pharmacy/work-items/:id` reports the item not dispensable (nothing says so today); hold then resume, then the EHR `.../pharmacy-work-item` handoff answers the documented code (`409 IDEMPOTENCY_CONFLICT` today). `prescriptions.service.spec.ts`: the projection carries the Pharmacy state. SQL suite for the time and date comparison when it lands.

**Constraints.** The 0080 guards, their constraint names and their 409s stay; work items, events, dispensings and reversals stay insert-only; one dispensing per work item; reversal unchanged.

**Docs.** `INTERFACE_CONTRACT.md` §13, `DATABASE.md` ("Pharmacy source prescription guards (0080)"), `PHARMACY_EXTRACTION_INVENTORY.md`, `PHASE_3_LAUNCH_DECISIONS.md` D10, an ADR for E18.

Source findings: BE-PHARMACY-CANCEL-NOT-PROPAGATED; hid-system CLIN-2 and CLIN-2-TIME (fixed by #48), CLIN-2-POLICY (D10, open).

### A2 (P0). Lab and Pharmacy work queues return the 200 oldest work items; newer orders disappear

**Status at `bbc6e89`: still open; worse since #48.** Neither list changed. Work items whose prescription changed after acceptance now stay `accepted` and undispensable for good (A1(a)), so they hold their place in the oldest-200 window permanently.

**Problem.** Both list routes return the oldest 200 rows, finished or not, with no cursor and no truncation signal. Work items are insert-only and their `status` is always `accepted`, so finished work never leaves the list. Once a reader can see 200 items (the cap applies after RLS, see B2), every newer order is invisible.

**Evidence.**
- `services/lab-api/src/lab/lab-work-items.service.ts:128-143`, the query at `:139` (`order by w.accepted_at asc,w.id asc limit 200`), response `{ items }` only.
- `services/pharmacy-api/src/pharmacy/pharmacy.service.ts:158-167`, `:161` (same order and cap).
- `services/ehr-api/database/migrations/0018_lab_work_items.sql:25` and `0023_pharmacy_domain_foundation.sql:62` (`status` CHECK allows only `accepted`, so a plain status filter cannot work).
- Lab `get()` (`lab-work-items.service.ts:117-126`) omits `testName`, `accessionId`, `accessionNumber` and `specimenStatuses`, which `list()` returns (`:140-141`).

**Frontend impact.** The Laboratory and Pharmacy pages render the list (`Health-id: apps/patient-web/src/staff/routes/Operations.tsx:452-470`, `:505-516`); Health-id now says when a list reaches the cap, but cannot show what lies beyond it. Once fixed: the default list shows open work, the portal pages with `nextCursor`, and offers "Show completed".

**Required fix.**
- Add a derived open state and filter on it. Lab: open while there is no accession, or any specimen or result of the work item is not finished (no released current result for each execution). Pharmacy: open while there is no dispensing **and the source prescription is still dispensable** (A1(a)).
- `GET /api/v1/lab/work-items` and `GET /api/v1/pharmacy/work-items` accept `state=open|all` (default **`open`**), `limit` (1-200, default 200) and an opaque keyset `cursor`; return `{ items, nextCursor }`. Lab: order by an explicit priority rank (`stat`, `asap`, `urgent`, `routine`), then `accepted_at, id` ascending. `priority` is text with those four values (`0018_lab_work_items.sql:26`), so ordering by the column itself gives the alphabetical `asap, routine, stat, urgent`; the cursor must carry the rank. Pharmacy: `accepted_at, id` ascending. Reuse EHR's cursor rules (`services/ehr-api/src/ehr/shared/clinical-context.ts:15-30, 143`): a foreign or malformed cursor answers `400 INVALID_CURSOR`.
- Each item carries its derived `open` flag. Lab `get()` returns the same projection as `list()`.
- Add an index in a new migration only if `EXPLAIN` on 10k synthetic rows shows a sequential sort.

**Acceptance tests (failing first).** In `verify-lab-runtime.mjs` and `verify-pharmacy-runtime.mjs`: seed 201 accepted work items visible to the reader, finish the oldest one; the newest open item is on page 1 (absent today); `state=all` walks all 201 through `nextCursor` with no duplicate; a tampered cursor answers 400 `INVALID_CURSOR`; Lab `GET /lab/work-items/:id` returns `testName` and `specimenStatuses`; a Pharmacy item whose prescription was cancelled after acceptance is not in the default list. Unit specs for cursor encoding.

**Constraints.** Response stays a superset (`items` unchanged in shape); RLS and permission checks unchanged; list audit rows unchanged (`pharmacy.work-item.list` keeps `returnedCount`).

**Docs.** `INTERFACE_CONTRACT.md` (Lab and Pharmacy queues), `LAB_EXTRACTION_INVENTORY.md`, `PHARMACY_EXTRACTION_INVENTORY.md`.

Source findings: LABPHARM-01; "Lab and Pharmacy work queues - 200 oldest cap" (verifier correction applied: no status filter is possible); BE-LAB-PHARM-QUEUE-SHAPE.

### A3 (P0). EHR lab-request changes after Lab accepts never reach Lab

**Status at `bbc6e89`: partly fixed by #56.** Fixed: (a) activating a draft, or resuming a held request that Lab never accepted, now sends it to Lab after the update commits (`services/ehr-api/src/ehr/lab-requests/lab-requests.service.ts:271-315`); (c) a create whose handoff fails no longer leaves the request unrecoverable: `POST .../lab-requests/:requestId/lab-work-item` sends or resends an active request at its current version (`lab-requests.controller.ts:54-67`; `lab-requests.service.ts:180-212`), and a create replay with the same `Idempotency-Key` resends it; (d, in part) Lab answers a later version of an order it already holds with `409 LAB_ORDER_ALREADY_ACCEPTED` instead of `500`, and an earlier one with `409 LAB_ORDER_NOT_CURRENT` (`services/lab-api/src/lab/lab-work-items.service.ts:54-79, 183-218`); the EHR reports it as `labHandoff: { state: 'already_accepted' }`. The create's new failure answers are a new defect (A25). What remains is below.

**Problem (remaining).** (b) Cancelling, holding, completing or marking entered in error a request that Lab already accepted changes EHR only; Lab keeps working it and can release a result for a withdrawn order. The update commits and answers `labHandoff: null` for any non-active status (`lab-requests.service.ts:308`); there is still no Lab withdrawal route (`services/lab-api/src/lab/lab-work-items.controller.ts:13-26`). The contract now says so explicitly (`docs/INTERFACE_CONTRACT.md:845-847`). (d) A `priority` (for example routine to stat) or `clinical_information` change after acceptance commits in EHR and is reported as `already_accepted`, so the change is never in Lab (`lab-requests.service.ts:54-66, 226-228`; `lab-work-items.service.ts:71-76`): Lab keeps working the routine version of a stat order.

**Evidence.** `services/ehr-api/src/ehr/lab-requests/lab-requests.service.ts:83-90` (TRANSITIONS), `:129-167` (create: Lab called only for an active request, after commit), `:247-262` (key `ehr-order:<id>:<version>`), `:271-315` (update); `services/lab-api/src/lab/lab-work-items.service.ts:47-79` (one work item per order, ever; a later version is refused, not applied); `docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:985` (orders created while Lab acceptance failed: since #56 each can be resent); hid-system D10 and D15 (`docs/PHASE_3_LAUNCH_DECISIONS.md`, §2).

**Frontend impact.** Health-id offers no change on a request the Laboratory may be working on and warns that a draft is never sent (`Health-id: apps/patient-web/src/staff/routes/Clinical.tsx:69-73` at `c880421`, warnings since). Once #56 is deployed it can offer Activate (the PATCH returns `labHandoff`) and must render the `labHandoff` states `accepted`, `already_accepted` ("this change is not in the Laboratory"), `failed` (with Lab's `status` and `code`, and a Resend action through `.../lab-work-item`) and `not_sent` (`LAB_PERMISSION_ABSENT`). Cancel after acceptance still cannot be offered safely.

**Required fix (remaining).**
- Lab: append-only source-withdrawal record and internal `POST /api/v1/lab/work-items/withdraw-ehr-order` (`@InternalCaller('ehr-api')`, idempotent per order id and version). Accession, specimen, execution, result entry, verification and release refuse with **`409 LAB_SOURCE_WITHDRAWN`** once withdrawn (hid-system D10 proposes the narrower "refuse new accession and execution for cancelled or entered-in-error orders; released results stay"; decide in E18). EHR calls it before committing cancel, entered-in-error or on-hold of an accepted request; Lab unreachable gives **`503 LAB_SERVICE_UNAVAILABLE`** with the EHR row unchanged. Alternative if you choose not to propagate: refuse those transitions with **`409 LAB_REQUEST_IN_LAB`** once Lab has accepted (clinicians then cannot cancel; record the choice in an ADR).
- Priority and clinical-information changes after acceptance: refuse them with **`409 LAB_REQUEST_IN_LAB`** once Lab has accepted, or propagate them to Lab (append-only, as for withdrawal). Today they commit and report `already_accepted`, which leaves the EHR and Lab disagreeing about a stat order.

**Acceptance tests (failing first).** `lab-requests.service.spec.ts` with a Lab fake: cancel after acceptance calls the withdrawal and a Lab 503 leaves EHR unchanged (no call today); a priority change after acceptance answers 409 `LAB_REQUEST_IN_LAB` or reaches Lab, per the choice (commits and reports `already_accepted` today). `verify-lab-runtime.mjs`: after a withdrawal, accessioning answers 409 `LAB_SOURCE_WITHDRAWN`. SQL suite: withdrawal rows are insert-only and RLS-scoped. Extend `verify-ehr-lab-handoff-runtime.mjs` with the cancel case.

**Constraints.** Lab key format `ehr-order:<id>:<version>`, the exact `requestedAt` (#44) and #56's acceptance answers unchanged; Lab records stay append-only.

**Docs.** `INTERFACE_CONTRACT.md` §11 ("EHR lab requests sent to Lab") and §12, `LAB_EXTRACTION_INVENTORY.md`, `PHASE_3_LAUNCH_DECISIONS.md` D10, an ADR for E18.

Source findings: "Lab draft activation" (fixed by #56); "Lab request changes after Lab accepts" (open); BE-LAB-ORDER-HANDOFF; LAB-EHR-01; hid-system CLIN-3b.

### A4 (P0). Identity's guard answers 401 `AUTHENTICATION_REQUIRED` to database and dependency faults; every service relays it

**Status at `bbc6e89`: still open.** `security.guard.ts` and the callers below are unchanged since `6b49a06`.

**Problem.** `SecurityGuard.canActivate` maps every error that is not a `DomainProblem` to 401. Raw database errors reach it from the runtime-control check (any SQLSTATE other than 55000, a statement timeout, a pool connect timeout with no code, grant or function drift 42501/42883), from session verification (`assertSessionActive`), from actor resolution and from the platform assurance read. When the denial audit insert in the catch still succeeds (a partial fault), the user gets 401. EHR, Lab, Pharmacy and OCR authenticate every request through Identity's `/auth/service-session` (and authorize patients through `/identity/service/authorization/check`); Outreach authenticates through `/identity/outreach/authorize` (`services/identity-api/src/identity/identity.controller.ts:65-85`). All of these pass through the same guard, so the 401 reaches every portal page. Outreach's own control check rethrows raw errors (500). EHR fixed its control check in #46 but its guard catch still maps other errors to 401.

**Evidence.**
- `services/identity-api/src/auth/security.guard.ts:51-200` (try covers verify, runtime controls, platform assurance), `:139-197` (denial audit), `:198-199` (non-DomainProblem to 401), `:263-277` (`controlEnabled` maps only 55000; `:275` rethrows), `:234` (`readPlatformAssurance`).
- `services/identity-api/src/auth/token.service.ts:414-430` (`verify`), `:658-695` (`assertSessionActive`, plain query), `:862-875` (`resolveActor`), `services/identity-api/src/auth/current-staff-context.service.ts:61-80`.
- `services/identity-api/src/audit/audit.service.ts:57-71` (audit insert failure gives 503, so only partial faults give 401).
- `services/ehr-api/src/integrations/identity-api.service.ts:69-81`, `services/lab-api/src/auth/lab-remote-security.guard.ts:29`, `services/pharmacy-api/src/auth/pharmacy-security.guard.ts:48-50`, `services/outreach-api/src/auth/outreach-security.guard.ts:61-63` (status and code relayed); `services/outreach-api/src/auth/outreach-security.guard.ts:97-103` (raw rethrow, 500).
- `services/ehr-api/src/auth/remote-security.guard.ts:76-90` (fixed control check), `:50-53` (catch still maps to 401).

**Frontend impact.** On a partial database fault every user looks signed out: the patient portal shows sign-in (`Health-id: apps/patient-web/src/session.tsx:85-87`), the staff portal locks and ends the workspace when `/auth/session` also answers 401, the admin console reports the session ended (`Health-id: apps/patient-web/src/admin/api.ts:176-189`). Once fixed: users see "temporarily unavailable" and keep their session.

**Required fix.**
- `controlEnabled`: every error other than 55000 `PLATFORM_CONTROL_DISABLED:` becomes `DomainProblem(503, 'PLATFORM_CONTROL_UNAVAILABLE')`, exactly as `remote-security.guard.ts:84-89`. Same change in `outreach-security.guard.ts:97-103`.
- `canActivate` catch, in this order, still recording the denial audit first:
  1. any `DomainProblem`, whatever its status: rethrow unchanged. `DomainProblem` extends `HttpException` (`services/identity-api/src/common/problem.ts:23`), so a rule keyed on "HttpException below 500" would rewrite the guard's own 503 `PLATFORM_MAINTENANCE` (`security.guard.ts:252`) and 503 `PLATFORM_CONTROL_UNAVAILABLE` (`:273`) into `AUTHENTICATION_UNAVAILABLE`, contradicting test (a) below;
  2. `UnauthorizedException`: `DomainProblem(401, 'AUTHENTICATION_REQUIRED')` with the generic detail "Valid authentication is required" (as today, `:199`). Do not pass it through as an `HttpException`: its message is internal (for example "Staff account or facility membership is inactive", `current-staff-context.service.ts:166`) and would become the 401's `detail`;
  3. any other `HttpException`: rethrow unchanged;
  4. any non-HTTP error (pg errors, pool timeouts, unknown errors, including from `readPlatformAssurance`): **`DomainProblem(503, 'AUTHENTICATION_UNAVAILABLE')`**.
  Every deliberate refusal on this path is already an `UnauthorizedException` or a `DomainProblem` (`token.service.ts:417-427, 627-639, 692`; `current-staff-context.service.ts:76, 100, 103, 166, 215`), so no real refusal is reclassified.
- Apply the same rule to the EHR and OCR guards (`services/ehr-api/src/auth/remote-security.guard.ts:50-53`, `services/ocr-api/src/auth/remote-security.guard.ts:44-48`).
- `verify()`/`verifyOidc()` wrap every `jwtVerify` failure, JWKS fetch failures included, into `UnauthorizedException` (`token.service.ts:422`, `:585`). In OIDC mode, distinguish JWKS availability errors (jose `ERR_JWKS_TIMEOUT`, fetch failures) and answer 503 `AUTHENTICATION_UNAVAILABLE`.

**Acceptance tests (failing first).** Guard spec next to `security.guard.ts`: (a) `select platform.control_enabled` rejects with `{code:'57014'}`, then with a codeless `Error('timeout exceeded when trying to connect')`: 503 `PLATFORM_CONTROL_UNAVAILABLE` and one denied audit row (401 today); (b) `assertSessionActive` query rejects with `{code:'08006'}`: 503 (401 today); (c) `verify` rejects with `UnauthorizedException`: still 401 `AUTHENTICATION_REQUIRED` with the generic detail; (d) platform route where `readPlatformAssurance` rejects: 503; (e) audit insert also fails: 503 (unchanged); (f) maintenance on: 503 `PLATFORM_MAINTENANCE` passes through unchanged. Outreach guard spec: control fault gives 503 (500 today). EHR and OCR guard specs: a raw (non-HTTP) error from `authenticateRequest` gives 503 (401 today). The EHR Identity integration already wraps non-HTTP errors as 503 `IDENTITY_SERVICE_UNAVAILABLE` (`services/ehr-api/src/integrations/identity-api.service.ts:68-81`), so this test fails first only when the mock rejects `authenticateRequest` itself with a raw error; say so in the spec.

**Constraints.** Real authentication failures stay 401 with the same code; audit-before-answer behaviour unchanged; platform admin exemption handled in A16.

**Docs.** `INTERFACE_CONTRACT.md` (error codes), `SECURITY.md`.

Source findings: ID-GUARD-FAULT-401, ID-GUARD-401-ON-FAULT, BE-IDENTITY-CONTROL-FAULT-401, "Refused staff cookie sign-out answers 503 - guard DB fault" (verifier corrections applied: jose errors are already wrapped; the rule is "DomainProblem unchanged, Unauthorized to a generic 401, other HttpException unchanged, non-HTTP errors to 503").

### A5 (P0). Service-to-service authentication failures reach the browser as 401

**Status at `bbc6e89`: partly fixed.** Fixed by #60: OCR answers an EHR, Lab or Pharmacy refusal of its own workload identity (`401`/`403` with `INTERNAL_SERVICE_AUTH_REQUIRED`, `INVALID_WORKLOAD_IDENTITY`, `WORKLOAD_CALLER_DENIED` or `WORKLOAD_IDENTITY_UNAVAILABLE`) as `503 EHR_SERVICE_AUTH_UNAVAILABLE`, `LAB_SERVICE_AUTH_UNAVAILABLE` or `PHARMACY_SERVICE_AUTH_UNAVAILABLE`, and a publication stores it as retryable (`services/ocr-api/src/integrations/owning-service-auth.ts:15-31`; `ehr-api.service.ts:52`, `lab-api.service.ts:21`, `pharmacy-api.service.ts:54` in the same folder). Fixed by #56 for one path: the EHR lab-request handoff never passes Lab's `401` on (`services/ehr-api/src/ehr/lab-requests/lab-requests.service.ts:72-81, 204-211`; it answers `502`, see A25). Mitigated by #53: Lab, Pharmacy and EHR's OCR caller guard keep one remote JWKS set per process instead of fetching it on every request (`services/lab-api/src/auth/lab-workload-identity.service.ts:12-13, 21`, `services/pharmacy-api/src/auth/pharmacy-workload-identity.service.ts:12-15, 31`, `services/ehr-api/src/auth/ocr-internal-caller.guard.ts:11-13, 48`), which makes a JWKS fetch failure rarer but does not change its answer. What remains is below; `docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:201` records the Identity part as a follow-up.

**Problem (remaining).** When a service's own workload credential is rejected or Identity cannot fetch the workload JWKS, Identity answers 401 (or 403 `ORIGIN_DENIED` when the delegated-read fallback runs), after the user's own token was already accepted. Identity renders these as `401 AUTHENTICATION_REQUIRED` and `403 ACCESS_DENIED`, the codes of a user refusal, so no caller (OCR included) can tell them apart, and EHR, Lab, Pharmacy and Outreach relay them to the browser. EHR relays Pharmacy's workload refusals on the prescription handoff unchanged. Lab, Pharmacy and EHR's OCR caller guard still answer a JWKS fetch failure as 401 `INVALID_WORKLOAD_IDENTITY` at the source.

**Evidence.** `services/identity-api/src/auth/workload-auth.service.ts:65-94` (`authenticateService`; `:89` wraps every `jwtVerify` failure, remote JWKS included, into `UnauthorizedException`; `:92` answers a subject mismatch with a plain `ForbiddenException`, which reaches callers as the generic 403 `ACCESS_DENIED`); `services/identity-api/src/auth/security.guard.ts:304-316` (delegated read swallows any workload error and falls back to the Origin/CSRF check, giving 403 `ORIGIN_DENIED`); callers relay unchanged: `services/lab-api/src/auth/lab-remote-security.guard.ts:22,29`, `services/pharmacy-api/src/auth/pharmacy-security.guard.ts:48-50`, `services/outreach-api/src/auth/outreach-security.guard.ts:58-63`, `services/ehr-api/src/integrations/identity-api.service.ts:68-81`, `services/ehr-api/src/integrations/pharmacy-api.service.ts:50-59` (Pharmacy's status and code passed through); JWKS fetch failure is 401 `INVALID_WORKLOAD_IDENTITY` at the source: `services/lab-api/src/auth/lab-workload-identity.service.ts:24`, `services/pharmacy-api/src/auth/pharmacy-workload-identity.service.ts:38`, `services/ehr-api/src/auth/ocr-internal-caller.guard.ts:51`. `docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:982` and `:1027` record that an Identity JWKS outage still ends an OCR publication as terminal and reaches the browser as a 401.

**Frontend impact.** A workload misconfiguration or an Identity JWKS outage makes the staff portal refresh, lock and re-check the session on every request instead of showing an outage. OCR pages are covered once #60 is deployed for EHR, Lab and Pharmacy refusals (they get `503 <SERVICE>_SERVICE_AUTH_UNAVAILABLE`), not for Identity's. Once fixed: a 503 "temporarily unavailable" everywhere.

**Required fix (remaining).**
- Identity: give workload failures distinct codes: `401 WORKLOAD_AUTHENTICATION_FAILED` for a bad token, `503 WORKLOAD_IDENTITY_UNAVAILABLE` for JWKS fetch/timeout, and `403 WORKLOAD_CALLER_DENIED` (the code Lab, Pharmacy and EHR already use) for the subject mismatch at `workload-auth.service.ts:92`.
- In `delegatedSafeBrowserRequest`, rethrow **only** the availability error (`503 WORKLOAD_IDENTITY_UNAVAILABLE`) instead of falling back. Every other workload failure keeps today's fail-closed fallback to the Origin/CSRF check (`security.guard.ts:313-315`).
- Lab, Pharmacy and EHR's OCR caller guard: answer a JWKS fetch/timeout failure with `503 WORKLOAD_IDENTITY_UNAVAILABLE` at the source (keep 401 `INVALID_WORKLOAD_IDENTITY` for a bad token).
- Callers (`packages/api-client/src/identity.ts` request handling and each service's translate/guard: EHR's Identity and Pharmacy clients, Lab, Pharmacy, Outreach, and OCR's Identity client): map a peer 401/403 carrying a workload code (`INTERNAL_SERVICE_AUTH_REQUIRED`, `INVALID_WORKLOAD_IDENTITY`, `WORKLOAD_*`) to **`503 <PEER>_SERVICE_AUTH_UNAVAILABLE`**, reusing #60's `owning-service-auth.ts` rule; relay 401 only when Identity rejected the user's own credential. Then OCR's Identity client can map `503 IDENTITY_SERVICE_AUTH_UNAVAILABLE` and close the `:1027` limit.

**Acceptance tests (failing first).** Per service unit spec: peer answers 401 `{code:'INVALID_WORKLOAD_IDENTITY'}`, browser receives 503 (EHR's Pharmacy handoff passes 401 today); an expired user token still yields 401. Identity spec: JWKS fetch rejects, a delegated GET answers 503, not 403 `ORIGIN_DENIED`; a bad workload token on a delegated GET still falls back to the Origin/CSRF check (403 `ORIGIN_DENIED` without Origin, unchanged); a subject mismatch answers 403 `WORKLOAD_CALLER_DENIED` (403 `ACCESS_DENIED` today). Lab, Pharmacy and EHR OCR-caller specs: a JWKS fetch rejection answers 503 `WORKLOAD_IDENTITY_UNAVAILABLE` (401 today).

**Constraints.** Workload authentication strictness unchanged; local-secret mode stays refused in production (`services/identity-api/src/config/environment.ts:228`); #53's per-process JWKS set and #60's OCR mapping unchanged.

Source findings: BE-WORKLOAD-401-PASSTHROUGH, ID-WORKLOAD-OUTAGE-STATUS (the "local mode in production" part is unreachable and dropped); hid-system DEP-4 throttle exposure (#53).

### A6 (P0). `POST /auth/refresh` clears the session cookies on any failure, including 5xx and after a committed rotation

**Status at `bbc6e89`: still open.** #50 only made `setCookies`/`clearCookies` also expire `hid_enrollment`; the try/catch is unchanged.

**Problem.** One `try` covers the rotation (which commits inside `TokenService.refresh`) and a separate success-audit insert; the `catch` clears cookies for every error. A transient fault before rotation (e.g. in actor resolution) signs the user out with a 500. An audit failure after the commit answers 503 without the rotated cookies. Without the gateway, that 503 carries the cookie-clearing `Set-Cookie` headers and the user is signed out. Behind the gateway, A8 drops those headers, so the browser keeps the spent refresh token, and the next refresh finds a rotated token and revokes the whole session family as reuse.

**Evidence.** `services/identity-api/src/auth/auth.controller.ts:215-245` (one try at `:235-244`, `clearCookies` in the catch at `:242`); `services/identity-api/src/auth/token.service.ts:353-382` (rotation commit), `:300-307` (reuse revocation of the family); `services/identity-api/src/audit/audit.service.ts:57-71` (audit failure is 503). Platform refresh shares the "clear on any error" half: `services/identity-api/src/auth/platform-auth.controller.ts:101-106`. Still present on #47@1c18e91 and in the trial merge of #47 onto `bbc6e89`: the first try (`#47@1c18e91 auth.controller.ts:242-247`, around the rotation) and the third try (`:262-270`, around the success audit) clear cookies on any error, 5xx included.

**Frontend impact.** A short database fault signs users out of every tab; a later refresh can revoke the sign-in family. Once fixed: a failed refresh leaves the user signed in and the client retries.

**Required fix.** Clear cookies only on a definitive refusal (`UnauthorizedException`, or a `DomainProblem` below 500). `SESSION_CLIENT_MISMATCH` is excluded: it is thrown before the `try` (`auth.controller.ts:233`) and must keep the other app's cookies, as it does today. On 5xx leave cookies alone. Record the `auth.refresh` success audit **inside the rotation transaction** (pass the client into `TokenService.refresh` and use `recordWithClient`), so a rotation either commits with its audit and returns its new cookies, or rolls back. Platform refresh: do not clear cookies on 5xx.

**Acceptance tests (failing first).** Controller spec: (a) `auth.refresh` rejects with a pg error: 5xx and no clearing `Set-Cookie`; (b) the audit insert fails: the rotation rolls back (the old refresh token still refreshes once) and no cookie is cleared; (c) `UnauthorizedException` still clears. Extend `verify-session-sign-out-runtime.mjs` (or a new refresh verifier) with an audit-failure injection: a second refresh after the failure succeeds and no family is revoked.

**Constraints.** Reuse detection and family revocation unchanged; `X-HID-Client` kind check and #50's renewability rule unchanged.

Source findings: ID-REFRESH-COOKIES.

### A7 (P0). Per-IP rate limits and lockouts key on the load balancer address, not the client

**Status at `bbc6e89`: still open.** The worker, gateway, WAF rule and every limit below are unchanged. #55 (recovery code budget per account) and #61 (enrollment contact-code budget per recipient) deliberately key their new budgets on the account or recipient, "never per client IP", because of this defect (`docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:185`; `docs/INTERFACE_CONTRACT.md:18-30`); the IP-keyed start limits remain.

**Problem.** The Cloudflare worker deletes `cf-connecting-ip`, `x-forwarded-for` and `x-real-ip` and sets no client-IP header; nginx overwrites `X-Forwarded-For` with its peer (an ALB node); Identity trusts the whole VPC CIDR. `request.ip` is therefore an ALB node address for every user, and every per-IP limit becomes platform-wide: OTP start, patient enrollment start and contact, organization application and completion quotas, provider CAC quota, and platform MFA failures (19 per 15 minutes locks out every administrator). The WAF rate rule aggregates by source IP, which is a Cloudflare egress address. Audit `source_ip` records the ALB.

**Evidence.** `infra/cloudflare/src/frontend-worker.mjs:128-160` (deletes at `:132-135`); `gateway/proxy-headers.conf:7`; no `real_ip` configuration in `gateway/nginx.conf.template`; `services/identity-api/src/main.ts:19-20` and `infra/aws/src/hid-regional-stack.ts:763` (TRUST_PROXY_CIDRS = VPC); `infra/aws/src/hid-regional-stack.ts:1241-1245` (WAF `aggregateKeyType: 'IP'`). IP-keyed limits (all under `services/identity-api/src/`): `auth/otp.service.ts:91,132`; `identity/patient-enrollment.service.ts:72-76,187-188`; `identity/organization-applications.service.ts:62-65`; `identity/organization-profile-completion.service.ts:65-67`; `identity/provider-enrollment.service.ts:68`; `auth/mfa/mfa.service.ts:55,507-517`. `scripts/verify-container-platform.mjs:209` asserts the current overwrite.

**Frontend impact.** One person (or attacker) exhausting a limit blocks everyone: patients see "too many requests" on OTP and enrollment, administrators are locked out of MFA. No frontend fix is possible.

**Required fix.** (1) Worker: read `cf-connecting-ip` before deleting it and always set its own `x-hid-client-ip`, overwriting any client-supplied value. (2) Gateway: `proxy_set_header X-Forwarded-For $http_x_hid_client_ip;` (or `real_ip_header X-HID-Client-IP` with `set_real_ip_from` limited to the ALB/VPC range), and never pass an inbound `x-hid-client-ip` that did not come through the ALB (ALB ingress is already restricted to the worker by the WAF origin-secret rule, `hid-regional-stack.ts:1226-1236`). (3) WAF: custom-key or forwarded-IP aggregation on `x-hid-client-ip`. (4) Keep `TRUST_PROXY_CIDRS` = VPC. Replace, do not delete, the `verify-container-platform.mjs:209` assertion: assert the chain is overwritten from the trusted header.

**Acceptance tests (failing first).** `infra/cloudflare/test/frontend-worker.test.mjs`: inbound `cf-connecting-ip: 203.0.113.9` and client-sent `x-hid-client-ip: 1.1.1.1` are forwarded with `x-hid-client-ip: 203.0.113.9`. Gateway container check: two different `x-hid-client-ip` values reach a stub upstream as two different `X-Forwarded-For`. Infra test for the WAF rule key. Staging (D3): two clients each start 5 OTPs and neither is limited by the other.

**Constraints.** No caller-controlled IP may ever be trusted; the origin-secret rule stays; #55's and #61's account and recipient budgets stay. Applying the worker, gateway image and WAF change is a deployment (needs separate authorization).

**Docs.** `PLATFORM_CONTAINER_ACCEPTANCE.md`, `AWS_DEPLOYMENT_ARCHITECTURE.md`, `SECURITY.md`.

Source findings: GW-CLIENT-IP.

### A8 (P1). The gateway replaces every upstream 502/503/504 with `UPSTREAM_UNAVAILABLE`, dropping code, detail and headers

**Status at `bbc6e89`: still open; more impact.** `gateway/` is unchanged. Since #56 the EHR answers `502 LAB_HANDOFF_UNCONFIRMED` for a lab request it has already saved (A25), which the gateway turns into `503 UPSTREAM_UNAVAILABLE`; since #47 (open) refresh can answer a deliberate 503 with rotated cookies (C1). Both depend on this fix.

**Problem.** `proxy_intercept_errors on` makes nginx apply `error_page 502 503 504` to upstream responses too, so every application 503/502 becomes a fixed 503 `UPSTREAM_UNAVAILABLE` (a 502 also becomes 503), losing the domain code, `Set-Cookie`, `Retry-After` and the correlation header. About 50 distinct 5xx codes are affected, e.g. `PLATFORM_MAINTENANCE`, `PLATFORM_CONTROL_UNAVAILABLE`, `MFA_UNAVAILABLE`, `TURNSTILE_UNAVAILABLE`, `EMERGENCY_CONTACT_DELIVERY_UNAVAILABLE`, `EMERGENCY_CONTACT_VERIFICATION_UNDELIVERABLE` (502), `QOREID_DISABLED`, `NIN_PROVIDER_DEFERRED`, `INTEGRATION_PAUSED`, `VERIFICATION_EVIDENCE_UNAVAILABLE`, and now `LAB_HANDOFF_UNCONFIRMED` (502), `EHR_SERVICE_AUTH_UNAVAILABLE`, `LAB_SERVICE_AUTH_UNAVAILABLE`, `PHARMACY_SERVICE_AUTH_UNAVAILABLE`. It contradicts `docs/INTERFACE_CONTRACT.md:291`. It also defeats PR #47's refresh design (C1).

**Evidence.** `gateway/proxy-headers.conf:14`; `gateway/nginx.conf.template:23-28` and `:30-50`; `docs/PLATFORM_CONTAINER_ACCEPTANCE.md:117` (records it as intended); `scripts/verify-container-platform.mjs:205-206` (asserts only the `error_page` line). Example emitters: `services/identity-api/src/patient-safety/emergency-contact.service.ts:141,171`, `auth/mfa/mfa-secret-protector.ts:82`, `auth/security.guard.ts:252`, `identity/organization-applications.service.ts:148,221`, `integrations/integration-runtime.service.ts:65`; `services/ehr-api/src/ehr/lab-requests/lab-requests.service.ts:242-244`.

**Frontend impact.** These branches never fire in a gateway deployment: `Health-id: apps/patient-web/src/routes/AccountSafety.tsx:89`, `admin/problems.ts:31,57,71`, `admin/Organizations.tsx:22,24,26`. While emergency-contact delivery is disabled a patient is told the platform is down; while `MFA_SECRET_KEY_B64` is missing from the secret (D4) admin sign-in looks like an outage; a saved lab request looks unsaved (A25). Once fixed: the specific messages appear; no frontend change needed.

**Required fix.** Remove `proxy_intercept_errors on;` (or set `off`). nginx still applies `error_page` to errors it generates itself (upstream refused, reset, timed out), so an unreachable service still answers `UPSTREAM_UNAVAILABLE`. Add an assertion in `scripts/verify-container-platform.mjs` that interception is off; update `PLATFORM_CONTAINER_ACCEPTANCE.md:117`.

**Acceptance tests (failing first).** Gateway container test with a stub upstream: (a) stub answers 503 `application/problem+json` `{code:'EMERGENCY_CONTACT_DELIVERY_UNAVAILABLE'}` with `Set-Cookie`, `Retry-After` and `X-Correlation-ID`; the client receives the same status, body and headers (fails today); (b) stub answers 502 `{code:'LAB_HANDOFF_UNCONFIRMED'}`, client gets 502 and that code; (c) upstream port closed, client gets 503 `UPSTREAM_UNAVAILABLE` (passes today and after).

**Constraints.** Gateway-generated failures stay bounded Problem Details; upstream 5xx `detail` stays generic.

Source findings: GW-503-INTERCEPT, GW-503-MASK.

### A9 (P1). Patient-only routes answer 503 (and record nothing) to a staff sign-in, in Identity and in EHR

**Status at `bbc6e89`: still open.** The Identity controllers, both interceptors and both audit services are unchanged; #52 rewrote `PatientRecordsService` but `self()` still refuses a non-patient in the handler (`patient-records.service.ts:55-59`). **Since `8f3eff1`:** #74 (EHR) and #76 (Identity, ADR-059) refuse a non-patient session on every patient-only route in the guards with `403 PATIENT_SESSION_REQUIRED` and audits it; the Health-id patient portal then re-reads `/auth/session` (launch alignment, `claude/launch-alignment-fixes`), so the frontend part is done.

**Problem.** Patient-only routes are `@PatientAllowed() @FacilityOptional()` and refuse a non-patient in the handler with 403 `PATIENT_SESSION_REQUIRED`. The `AuditInterceptor` then records the failure as `api.*` / `http-request` with a staff subject and no facility; `assertActorFacility` rejects a staff row without a facility unless it is an `auth.*` event and throws `ServiceUnavailableException`, so the client gets 503 `DEPENDENCY_UNAVAILABLE` and no audit row is written. #42 fixed only `@AuditSessionEvent` routes. EHR's `GET /ehr/me/records` has the same defect in EHR's own interceptor (EHR refuses staff before calling Identity).

**Evidence.**
- Identity: `services/identity-api/src/auth/patient-self.service.ts:8-13`; `auth/patient-self.controller.ts:9-12` (class decorators), routes `:16-51` and `:53-61`; `consent/consent.controller.ts:18-26, 49, 61, 74`; `patient-safety/emergency-contact.controller.ts:14-17`; `patient-safety/patient-account-deletion.controller.ts:11-14`; `identity/qoreid-verification.controller.ts:16-24`; `audit/audit.interceptor.ts:44-46, 63-75, 105-112`; `audit/audit.service.ts:166-182`; the guard's own refusal audit (`auth/security.guard.ts:172-184`) is accepted by `assertActorFacility`.
- EHR: `services/ehr-api/src/ehr/patient-records/patient-records.controller.ts:12-15`; `patient-records.service.ts:55-59`; `services/ehr-api/src/audit/audit.interceptor.ts:60-77`; `services/ehr-api/src/audit/audit.service.ts:158-169`.

**Frontend impact.** On the shared origin, after a provider signs in in another tab, the patient tab's next `GET /identity/me`, `/identity/me/access-requests`, `/ehr/me/records`, etc. gets a retried 503 "service unavailable" instead of a session refusal. Once fixed, Health-id will treat 403 `PATIENT_SESSION_REQUIRED` as "the session changed" and re-read `/auth/session`.

**Required fix.** Add `PatientOnly()` metadata (`common/decorators.ts` in Identity and EHR). In Identity `SecurityGuard` (after the `PATIENT_ALLOWED` check, `security.guard.ts:59-61`) and EHR `RemoteSecurityGuard` (`remote-security.guard.ts:26-28`), throw `DomainProblem(403, 'PATIENT_SESSION_REQUIRED')` for any non-patient actor on a `PatientOnly` route; the guards' existing refusal audit writes a facility-less `auth.authorization.denied` row. Apply it to `PatientSelfController` (including `service/patient-self-authorization`), the four patient `ConsentController` routes, `EmergencyContactController`, `PatientAccountDeletionController`, `QoreIdVerificationController.verifyMyNin` and EHR `self()`. Defence in depth: in both interceptors' failure branch, record a non-patient actor with no bound facility as `auth.authorization.denied` / `authentication` with no membership or organization, so no handler refusal can turn into 503 again.

**Acceptance tests (failing first).** Extend `services/identity-api/src/audit/auth-refusal-audit.spec.ts` (real interceptor and AuditService over a fake DB): a staff access cookie without `X-Facility-ID` on each listed route answers 403 `PATIENT_SESSION_REQUIRED` and writes one denied row (503 and no row today); a patient cookie still gets 200. EHR spec with `AuditInterceptor` registered as in `app.module.ts`: staff cookie on `GET /api/v1/ehr/me/records` answers 403 plus one audit row (503 today); patient gets 200. Add a staff-cookie case to `verify-patient-runtime.mjs`.

**Constraints.** The `assertActorFacility` rule (staff rows need a facility unless `auth.*`) and the 0067 CHECKs stay as they are.

Source findings: ID-PATIENT-ONLY-503, ID-STAFF-ON-PATIENT-503, BE-EHR-ME-RECORDS-503, BE-ACCESS-PATIENT-ROUTES-503, "Refused staff cookie sign-out answers 503 - patient-only routes" (verifier correction applied: EHR's 503 originates in EHR).

### A10 (P1). A staff account with no active facility membership is answered 401 (at sign-in and on every request)

**Status at `bbc6e89`: still open; changed by #50.** #50 moved the membership joins into `eligibleStaffMembershipJoins` (`services/identity-api/src/auth/current-staff-context.service.ts:38-55`, used at `:141`) and made the refresh kind lookup and sign-out treat a staff sign-in whose actor no longer resolves as not renewable (`token.service.ts:101-124`), so a named-client refresh no longer answers `403 SESSION_CLIENT_MISMATCH` for it. Refresh itself still answers 401 for it and, through A6's catch, clears the cookies; sign-in is unchanged.

**Problem.** `CurrentStaffContextService.resolvePostgres` inner-joins the account's active, unheld memberships with an active, verified staff record and an active organization and facility. When that returns no rows it throws `UnauthorizedException('Staff account or facility membership is inactive')`. (`toActor`'s own `UnauthorizedException('No active facility membership')` is unreachable through `resolve()`, because `resolvePostgres` never returns an empty facility list.) At sign-in this happens after the password was verified, so a correct password is answered 401 like a wrong one and recorded as a failed login attempt. On a live session (membership ended) every request is 401, which reads as signed out.

**Evidence.** `services/identity-api/src/auth/current-staff-context.service.ts:127-166` (the joins at `:141`, defined at `:38-55`; the refusal at `:165-166`), `:215` (unreachable); `services/identity-api/src/auth/token.service.ts:142` (`issue()` resolves the actor), `:874` (`resolveActor` calls `currentStaff.resolve`); `services/identity-api/src/auth/local-auth.provider.ts:31-76` (the password is verified first, and only for an active, not disabled account); `services/identity-api/src/auth/auth.controller.ts:185-213` (an `UnauthorizedException` is recorded with `recordLoginFailure`, `auth/auth-session-audit.service.ts:59-75`).

**Frontend impact.** The provider portal's "No facility assignment" screen is unreachable; the sign-in form shows its invalid-credentials message, or a live workspace reads as signed out. Once fixed: the portal shows the no-assignment screen (Health-id `0eda90f` offers no Sign out there yet; a frontend row).

**Required fix.** When the query at `:127-164` returns no rows, check whether the account itself is active and not disabled (`status = 'active'` and `disabled_until` passed, as `:156-157` and `:69-73` do). If it is, throw `DomainProblem(403, 'NO_ACTIVE_FACILITY_MEMBERSHIP')`; otherwise keep the 401. Do not change the `:166` message wholesale: it also covers inactive and disabled accounts, which must stay 401. Decide (and document) whether sign-in then issues a session that authorizes nothing (portal shows the screen) or refuses sign-in with that 403 and no session; in either case do not record a password failure. Every facility-scoped route continues to refuse. Keep #50's renewability rule consistent with the choice (a session that authorizes nothing must not become "renewable" for the other app).

**Acceptance tests (failing first).** Spec: correct password, no active membership: 403 `NO_ACTIVE_FACILITY_MEMBERSHIP`, no `auth.login_attempts` failure row (401 and a failure row today); live session whose membership is ended: `GET /auth/session` answers the chosen documented response, never 401. Wrong password still 401; a disabled or inactive account with a live token still 401.

**Constraints.** Must not reveal anything to someone who has not proven the password.

Source: auditor note (pr42-review), verified at `6b49a06` and re-checked at `bbc6e89`.

### A11 (P1). The emergency summary returns vitals as first recorded; corrections are ignored

**Status at `bbc6e89`: partly fixed by #52.** Fixed: (b) documents are read from `ehr.documents_effective` with `status = 'available'` only (latest scan of the exact object clean) (`services/ehr-api/src/ehr/patient-records/patient-records.service.ts:169-176`); (c) each section reads one row more than its limit and the response carries `limits`, `truncated`, `released`, `withheld` and the legacy `limit: 50` (`:20-26, 178-203`); (d) the emergency summary reads a further category only when the reader holds its read permission, and names the others as withheld (`:28-46, 81-104`); (e) the emergency audit records each category's count and the withheld categories (`:91-101`). The patient summary now returns only encounters and notes and names the other five categories as withheld (`:10-18, 107-125`); for a patient session those five were already always empty under row-level security (correction below). Remaining: (a).

**Problem (remaining).** (a) The emergency summary's vitals are returned as originally recorded; corrections (`current_correction_no`, `ehr.vital_corrections`) are ignored, so a corrected wrong value is shown to an emergency clinician as current. #52 held this back deliberately pending the correction-semantics decision (E17, hid-system D8); its implementation is preserved in hid-system commit `7401193`.

**Evidence.** `patient-records.service.ts:139-146` ("Vitals as first recorded; corrections are not applied, pending the decision"); `services/ehr-api/src/ehr/vitals/vitals.service.ts:177-197` (corrections); `docs/INTERFACE_CONTRACT.md:934-940`. Also unchanged: diagnoses, prescriptions and lab requests in `entered_in_error` are returned with their status (the frontend can filter those).

**Frontend impact.** Health-id shows no vitals in the emergency summary until (a) ships (section 9). Health-id must render the patient summary's `withheld` categories as "not released to you", not "none" (the patient page says "No vitals are available." today), and may read `limits`/`truncated` once #52 is deployed.

**Required fix (remaining, after E17).** Return the current corrected values plus `currentCorrectionNo` and `correctedAt`, under the semantics E17 chooses (proposed default: the current correction is the whole current set, as Health-id's clinician chart applies it); define them in `INTERFACE_CONTRACT.md`. Whether the emergency summary keeps all seven sections at all is E1(c); if E1 narrows it, give `emergency()` its own projection.

**Acceptance tests (failing first).** Extend `patient-records.service.spec.ts`: a corrected vital in the emergency summary returns the replacement values and `currentCorrectionNo` (the original values today).

**Constraints.** Self read stays patient-session bound; #52's permission filter, limits and audit stay; facility filter on the emergency path unchanged here (B1 changes it after E1).

**Docs.** `INTERFACE_CONTRACT.md` §11 "Record summaries" (`:892-944`), `PHASE_3_LAUNCH_DECISIONS.md` D8.

Source findings: "Corrected vitals elsewhere - backend", BE-PATIENT-VITAL-CORRECTIONS (open); "Emergency access to the detailed chart - section limits", BE-EHR-EMERGENCY-LIMIT-DRIFT, EHR-EMERG-01 and the permission and audit points of "Detailed clinical chart during emergency access" (fixed by #52); hid-system CLIN-1, VIT-1 (held, D8).

### A12 (P1). Lab answers 500 to refused specimen and verification transitions; Lab, Pharmacy and OCR translate no general database errors

**Status at `bbc6e89`: still open; changed slightly.** Two narrow, per-command mappings now exist: Lab's EHR-order acceptance maps its own `23514`, `42501` and `lab.work_items` `23505` (#56; `services/lab-api/src/lab/lab-work-items.service.ts:167-222`), and Pharmacy maps the two 0080 guard constraints (#48; `services/pharmacy-api/src/pharmacy/pharmacy.service.ts:74-93`). Lab's ProblemDetailsFilter now logs the SQLSTATE of a mapped cause (`services/lab-api/src/common/problem.ts:23-38, 67-79`) but still maps nothing itself. Every case below is unchanged. #51 added `releasedAt` to each revision; `enteredByCurrentActor` and `verifiedAt` are still absent.

**Problem.** (a) Rejecting a specimen that was never collected violates the transition trigger (23514) and answers 500; required to rejected is not intended (`0019:10` describes reject as for a collected specimen). (b) The person who entered a result gets 500 on Verify (trigger 23514 "verifier must be independent"), and revisions do not say who entered them, so the UI cannot hide Verify. (c) Two members verifying or releasing the same version: the second gets 500 after one retry (unique violation). Apart from the two mappings above, Lab, Pharmacy and OCR have no database-error translation, so any trigger or constraint refusal is a 500.

**Evidence.** `services/ehr-api/database/migrations/0019_lab_accessions_specimens.sql:178-189`; `services/lab-api/src/lab/lab-accessions.service.ts:107-131`; `0021_lab_result_verification_release.sql:36, 49, 76-77`; `services/lab-api/src/lab/lab-executions.service.ts:119-132` (govern, no pre-check), `:174` (`resultAggregate` maps no `entered_by`/`verified_by`); `services/lab-api/src/database/database.service.ts:31-34, 84-88`; documented known limits `docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:979` (unique conflicts, case (c)) and `:983` (the verifier-independence 23514 answers 500, case (b); "Since #56 Lab's EHR-order acceptance alone maps its own").

**Frontend impact.** The Laboratory page offers Reject on a `required` specimen (`Health-id: apps/patient-web/src/staff/routes/Operations.tsx:82-83`; Health-id will stop offering it) and Verify to the enterer; both end in a generic server error. Once fixed: specific 409 messages, and Verify hidden for the enterer.

**Required fix.** Pre-check in `transition()`: **`409 LAB_SPECIMEN_TRANSITION_NOT_ALLOWED`**. Pre-check in `govern()`: **`409 LAB_RESULT_VERIFIER_NOT_INDEPENDENT`**. Expose `enteredByCurrentActor` (boolean) and `verifiedAt` per revision. Map the `result_verifications`/`result_releases` unique violation after the retry to **`409 LAB_RESULT_ALREADY_VERIFIED`** / **`409 LAB_RESULT_ALREADY_RELEASED`**. Add a database-error translator to Lab, Pharmacy and OCR modelled on `services/ehr-api/src/ehr/shared/clinical.repository.ts:220-238` (which maps 23514 to 400 and 23505 to 409), keeping #56's and #48's command-specific mappings first:
- the two known trigger messages to their 409 codes: "Illegal or stale specimen lifecycle transition" (`0019:186`) to `LAB_SPECIMEN_TRANSITION_NOT_ALLOWED`; "Result verifier must be independent and result must be eligible" (`0021:77`) to a 409 that covers both conditions (for example `LAB_RESULT_NOT_VERIFIABLE`), leaving `LAB_RESULT_VERIFIER_NOT_INDEPENDENT` to the `govern()` pre-check;
- any other 23514 to 400; 23505 to 409 (case (c)); 23503 to 409; 42501 to 403; 22P02 to 400; unknown stays 500.
Mind OCR's retry rule: OCR stores a Lab `5xx` from `POST /lab/imports/from-ocr` as retryable and a `4xx` as terminal (`docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:266`); decide for the import path whether a mapped database refusal should become terminal, and document it.

**Acceptance tests (failing first).** `lab-accessions.service.spec.ts`: reject a `required` specimen answers 409 (500 today); collect a received specimen answers 409. `lab-executions.service.spec.ts`: enter then verify as the same account answers 409; two accounts verify the same version, the second gets 409. `verify-lab-runtime.mjs`: the same three over HTTP as the Lab runtime role.

**Constraints.** Do not relax `lab.validate_specimen_transition` or the independence trigger.

Source findings: BE-LAB-SPECIMEN-REJECT-500 (verifier correction applied: no product decision needed), BE-LAB-VERIFY-SELF-500.

### A14 (P1). Lab, Pharmacy and OCR answer a patient session and a missing facility with the wrong codes

**Status at `bbc6e89`: partly fixed by #60.** Fixed: (c) a missing or unknown `X-Purpose-Of-Use` now answers `400 PURPOSE_OF_USE_REQUIRED` in all five `requireRequestContext` (`services/identity-api/src/common/request-context.ts:94`, `services/ehr-api/src/common/request-context.ts:69`, `services/lab-api/src/common/request-context.ts:69`, `services/pharmacy-api/src/common/request-context.ts:69`, `services/ocr-api/src/common/request-context.ts:70`; `docs/INTERFACE_CONTRACT.md:749-761`). The guards are unchanged, so (a) and (b) remain.

**Problem (remaining).** (a) A patient cookie reaches Lab, Pharmacy and OCR (Identity's `/auth/service-session` is `@PatientAllowed`) and is refused as `403 FACILITY_ACCESS_DENIED`; EHR answers `403 PATIENT_SCOPE_DENIED`. (b) Lab and Pharmacy answer a missing or malformed `X-Facility-ID` with 403 `FACILITY_ACCESS_DENIED`; EHR, Identity, OCR and Outreach answer 400 `FACILITY_REQUIRED`.

**Evidence.** `services/lab-api/src/auth/lab-remote-security.guard.ts:32`; `services/pharmacy-api/src/auth/pharmacy-security.guard.ts:55`; `services/ocr-api/src/auth/remote-security.guard.ts:26-31`; EHR reference `services/ehr-api/src/auth/remote-security.guard.ts:26-28`.

**Frontend impact.** The staff portal locks the workspace only on `PATIENT_SCOPE_DENIED` (`Health-id: apps/patient-web/src/staff/session.ts:160`); on Lab, Pharmacy and OCR a patient cookie shows "no access at this facility" instead.

**Required fix (remaining).** Lab, Pharmacy, OCR guards: `403 PATIENT_SCOPE_DENIED` when `actor.kind === 'patient'` on a route that is not `PatientAllowed`; Lab and Pharmacy: `400 FACILITY_REQUIRED` for a missing or malformed header.

**Acceptance tests (failing first).** Guard specs per service for each case.

**Constraints.** Authentication order unchanged (authenticate, patient scope, facility, permission); EHR and Identity codes unchanged; #60's purpose rule unchanged.

Source findings: "Staff session end - patient session on Lab/Pharmacy/OCR", BE-HEADER-VALIDATION-STATUS (open); ID-PURPOSE-HEADER-500 (fixed by #60).

### A15 (P2). Document routes answer generic codes and return numbers as strings; upload completion binding has no database backstop

**Status at `bbc6e89`: partly fixed by #59.** Fixed: `POST /ehr/documents/:id/complete` is bound to the account that created the intent: any other caller that passes the route checks gets `404 NOT_FOUND` before the patient authorization and the storage read, the completing `UPDATE` requires `created_by = $6`, and the replay branch checks the creator too (`services/ehr-api/src/documents/document.service.ts:182-223, 326-333`; `docs/INTERFACE_CONTRACT.md:1209-1243`). The answer is 404, not the `403 DOCUMENT_UPLOAD_NOT_OWNED` proposed; the membership is not compared; uploader-only is the current default pending hid-system D13 (proposed default: as implemented). What remains is below.

**Problem (remaining).** No row-level security backs the binding (the `documents_update` policy checks the write grant only, `services/ehr-api/database/migrations/0005_database_authorization.sql:391-393`). An invalid Idempotency-Key answers 409 `CONFLICT` (rest of EHR: 400 `IDEMPOTENCY_KEY_REQUIRED`); uploads disabled answers 409 `CONFLICT`; other database errors 500; consent refusals 403 `ACCESS_DENIED`. `list()` returns `sizeBytes` and `version` as strings while `view()` returns numbers; the emergency summary's documents return `sizeBytes` as a string (the patient summary no longer returns documents).

**Evidence.** `document.service.ts:134-148` (`::text` casts at `:138`, `:141`), `:268-278` (uploads disabled), `:372-376` (key), `:189-190` (consent refusal as `ForbiddenException`); `services/ehr-api/src/ehr/patient-records/patient-records.service.ts:171-176` (`size_bytes` bigint); `services/ehr-api/src/common/idempotency.ts:6-14`.

**Frontend impact.** The portal types these fields as numbers (`Health-id: apps/patient-web/src/staff/api.ts:248-258`). Once #59 is deployed, a colleague's completion answers `404` (Health-id completes only from the uploading session, so this should not occur).

**Required fix (remaining).** A restrictive RLS policy (or trigger) on the initiated-to-uploaded transition requiring `created_by = platform.current_account_id()` (new migration). Use `DomainProblem` codes: `400 IDEMPOTENCY_KEY_REQUIRED`, `423 UPLOADS_DISABLED`, `403 CONSENT_REQUIRED`, `409 DOCUMENT_NOT_COMPLETABLE`, `409 DOCUMENT_INTEGRITY_MISMATCH`. Return integers in `list()` and in the record summaries.

**Acceptance tests (failing first).** SQL suite: as the EHR runtime with another member's session, the initiated-to-uploaded `UPDATE` of a colleague's document is refused by the database (allowed today when the service check is bypassed). Bad key: 400 (409 today). `list()` returns `sizeBytes` as a number.

**Constraints.** #59's 404 and its order, object integrity checks (size, sha256, media type) and `reject_document_object_rebinding` unchanged; a replayed completion by the creator still returns the uploaded document.

Source findings: PROSE-L138a and "Staff session end - upload completion ownership" (fixed by #59); BE-EHR-DOCUMENTS-CONTRACT (open).

### A16 (P2). A platform-admin grant bypasses maintenance mode and the provider-portal switch for that person's staff sessions

**Status at `bbc6e89`: still open.**

**Problem.** `enforceRuntimeControls` returns early for any actor whose platform permissions include `platform.admin.access`. Staff actors carry the account's platform grants, so a password-only staff or clinical session of a platform administrator keeps working through maintenance and a disabled provider portal.

**Evidence.** `services/identity-api/src/auth/security.guard.ts:247-248`; `services/identity-api/src/auth/current-staff-context.service.ts:79, 227`; `services/ehr-api/src/auth/remote-security.guard.ts:60-61`; `services/outreach-api/src/auth/outreach-security.guard.ts:79-80` (same bypass in Outreach's own control check). Lab, Pharmacy and OCR have no control check of their own; they authenticate through Identity's guard, so the Identity change covers them.

**Frontend impact.** None for ordinary users. During maintenance, Health-id's maintenance message does not appear for these administrators' staff and clinical sessions.

**Required fix.** Identity: replace the check with `if (actor.kind === 'platform') return;` (platform sessions must keep reaching the console during maintenance, including `POST /admin/controls`; removing the early return entirely would lock the console out). EHR and Outreach: drop the bypass (platform sessions never authenticate there). If operators need clinical access during maintenance, add an explicit audited control.

**Acceptance tests (failing first).** Guard spec: staff actor with `platformPermissions ['platform.admin.access']` and maintenance on: 503 `PLATFORM_MAINTENANCE`; provider portal off: 423 `PLATFORM_PORTAL_DISABLED`; a platform session on `POST /admin/controls` during maintenance still succeeds. EHR and Outreach guard specs: the same staff actor during maintenance gets 503 `PLATFORM_MAINTENANCE`; Outreach with `outreach_portal_enabled` off gets 423.

**Constraints.** Platform sessions keep console access during maintenance; no other control behaviour changes.

Source findings: ID-CONTROL-BYPASS (verifier correction applied).

### A17 (P2). Audit fidelity gaps

**Status at `bbc6e89`: still open.** (#51 added released-result read audits in Lab and #56 a handoff eligibility audit in EHR; neither touches the gaps below.)

**Problem.** (a) Identity guard records `details.code` only for platform routes; facility, `auth.authorization.denied` and system branches record method and route only. (b) Identity and EHR interceptors record every handler error as outcome `failure` with no status or code, including 4xx refusals (since #59 that includes a refused upload completion, recorded only as `api.ehr.document.upload-complete.request` `failure` without the document id, `docs/INTERFACE_CONTRACT.md:1241-1243`). (c) Pharmacy and Outreach register no `AuditInterceptor`; the Lab, Pharmacy and Outreach guards record no refusal; `PharmacyService.authorize` throws without recording. (d) Identity's interceptor records the browser-supplied `X-Purpose-Of-Use` as the purpose on patient routes (`audit.interceptor.ts:120-123`), so a patient approve/deny sent with `direct-care` is audited as direct care.

**Evidence.** `services/identity-api/src/auth/security.guard.ts:140-196` (code only at `:153`); `services/identity-api/src/audit/audit.interceptor.ts:63-75, 120-123`; `services/pharmacy-api/src/app.module.ts:14`; `services/outreach-api/src/app.module.ts:14`; `services/lab-api/src/auth/lab-remote-security.guard.ts:18-37`; `services/pharmacy-api/src/pharmacy/pharmacy.service.ts:325-334`; EHR's pattern `services/ehr-api/src/auth/remote-security.guard.ts:92-132`.

**Frontend impact.** The facility Audit page (`Health-id: apps/patient-web/src/staff/api.ts:758-775`) shows "failure" for refusals with no reason, and denied Pharmacy and Outreach attempts are missing.

**Required fix.** Add `status` and `code` to every guard branch and interceptor failure row; outcome `denied` for status below 500, `failure` otherwise. Port EHR's `recordDenied` and `AuditInterceptor` to Pharmacy and Outreach, and `recordDenied` to the Lab guard; record service-level consent refusals as `denied`. Record purpose `patient-self` on patient-only routes regardless of the header. No PHI in details.

**Acceptance tests (failing first).** Identity spec: facility-bound staff missing a permission writes `security.authorization` with `details.code 'PERMISSION_DENIED'`; a handler 403 writes `denied` with status and code; a 500 writes `failure`; a patient approve sent with `X-Purpose-Of-Use: direct-care` records `patient-self`. Pharmacy spec: a refused dispense (including `PHARMACY_PRESCRIPTION_NOT_DISPENSABLE`) writes one denied row. Lab guard spec: `PERMISSION_DENIED` writes one row.

**Constraints.** No PHI in `details`; success rows unchanged; the `assertActorFacility` rule unchanged.

**Docs.** `SECURITY.md` (audit coverage).

Source findings: ID-AUDIT-REFUSAL-CODE, BE-AUDIT-GAPS; auditor note (gapmap-1) for (d).

### A18 (P2). `/identity/service/authorization/check` grants `write_records` on a request the guard admitted as a reported read

**Status at `bbc6e89`: still open.**

**Problem.** The guard skips the cookie CSRF check on a delegation route when an authenticated workload reports a safe browser method, and records that so the route can refuse a write. The service authorization route never checks it, so a caller bug would silently drop CSRF protection for writes.

**Evidence.** `services/identity-api/src/auth/security.guard.ts:304-316` (sets `request.delegatedBrowserMethod` "so the route can refuse to authorize a write"); `services/identity-api/src/identity/identity.controller.ts:35-47` never reads it; Outreach does (`:74-79`).

**Frontend impact.** None (defence in depth).

**Required fix.** In `authorizeService`, when `request.delegatedBrowserMethod` is set and `input.scope !== 'read_records'`, throw `403 CSRF_VALIDATION_FAILED`. Defence in depth; no current GET asks for write.

**Acceptance tests (failing first).** `delegated-browser-request.spec.ts`: workload reports GET with a cookie and no CSRF and asks for `write_records`: 403; `read_records`: 200.

**Constraints.** Outreach's existing check unchanged; delegated reads still authorized.

Source findings: ID-DELEGATED-WRITE-SCOPE, BE-DELEGATED-WRITE-DEFENSE.

### A19 (P2). A request from an Origin not in `CORS_ORIGINS` answers 500 in all six services

**Status at `bbc6e89`: still open.**

**Problem.** The CORS origin callback raises a plain `Error` for a disallowed origin; the global filter maps it to 500 `INTERNAL_ERROR`.

**Evidence.** `services/identity-api/src/config/cors.ts:21-24` (`callback(new Error(...))`, mapped to 500 by the filter); same pattern in `services/ehr-api/src/main.ts:49`, `services/lab-api/src/main.ts:49`, `services/ocr-api/src/main.ts:33`, `services/outreach-api/src/main.ts:33`, `services/pharmacy-api/src/config/cors.ts:14`; `services/identity-api/src/config/cors.spec.ts:85-89` checks only the missing ACAO header.

**Frontend impact.** A portal origin missing from `CORS_ORIGINS` presents as a server fault on every same-origin POST, hiding a configuration error.

**Required fix.** Pass or throw `DomainProblem(403, 'ORIGIN_DENIED')` (prefer this). It keeps an explicit, diagnosable refusal on every route, including GETs and the services that rely on CORS alone. With `callback(null, false)` a disallowed origin proceeds to the handler and only the browser's read block remains. (Identity's browser-facing `@Public` POSTs check Origin themselves either way: `auth/otp.controller.ts:23, 52-56`, `identity/patient-enrollment.controller.ts:31, 105-108`, `auth/auth.controller.ts:593-598`, `identity/provider-enrollment.controller.ts:113-116`, `identity/organization-applications.controller.ts:38-40, 97-100`, `commercial/demo-requests.controller.ts:25-28`, `auth/platform-auth.controller.ts:179-182`.)

**Acceptance tests (failing first).** Extend `services/identity-api/src/config/cors.spec.ts` and `services/pharmacy-api/src/config/cors.spec.ts` with the ProblemDetailsFilter registered: POST with `Origin: https://attacker.example.test` answers 403 `ORIGIN_DENIED`, not 500. EHR, Lab, OCR and Outreach configure CORS inline in `main.ts`: extract it to a `config/cors.ts` and add the same spec.

**Constraints.** Allowed origins and every server-side Origin refusal unchanged.

Source findings: ID-CORS-500 (verifier correction applied).

### A20 (P2). Authenticated platform step-up answers 401 for a wrong code and a changed factor

**Status at `bbc6e89`: still open.**

**Problem.** On an authenticated platform route, a wrong TOTP code and a changed factor are answered 401, the status clients use for an ended session.

**Evidence.** `services/identity-api/src/auth/mfa/mfa.service.ts:290` (`stepUp`), `:553-559` (`failed` and `invalid` both 401) on authenticated routes in `admin/platform-security.controller.ts`.

**Frontend impact.** The console avoids a refresh only for `MFA_INVALID_CODE` (`Health-id: apps/patient-web/src/admin/api.ts:141, 249-251`); `MFA_CHALLENGE_INVALID` still triggers refresh and retry.

**Required fix.** On authenticated routes (step-up, recovery-code regeneration) answer a wrong code with `403 MFA_INVALID_CODE` and a factor/assurance mismatch with `403 PLATFORM_SESSION_REQUIRED`; keep 401 on the unauthenticated `/auth/admin/mfa/*` challenge routes.

**Acceptance tests (failing first).** Spec: step-up with a wrong code answers 403 `MFA_INVALID_CODE` and still records the factor failure. Extend `verify-platform-security-runtime.mjs`.

**Constraints.** Factor failure counting, lockout and the unauthenticated challenge routes unchanged.

Source findings: ID-STEPUP-401.

### A21 (P2). No `Retry-After` on Identity 429 and 503 answers; not exposed through CORS

**Status at `bbc6e89`: still open.** #50 (activation budget) and #61 (spent contact-code budget) added new `429 ENROLLMENT_RATE_LIMITED` answers that also carry no hint; #55 answers a spent recovery budget like an unknown identifier, not with a 429.

**Problem.** Rate-limit and maintenance answers carry no hint of when to retry, and the header would not be readable through CORS.

**Evidence.** No `Retry-After` anywhere under `services/identity-api/src`; 429s at `services/identity-api/src/auth/otp.service.ts:419`, `auth/mfa/mfa.service.ts:555`, `identity/patient-enrollment.service.ts:581-582`, `consent/consent.service.ts:287`; `config/cors.ts:15-16` (exposed headers).

**Frontend impact.** The client already honours `Retry-After` (`Health-id: packages/http/src/client.ts:398`) but never receives it, so it uses fixed backoff.

**Required fix.** Set `Retry-After` (seconds) on rate-limit 429s from the bucket's window or `blocked_until`, and on 503 `PLATFORM_MAINTENANCE` when an end time is known; add `retry-after` to `CORS_EXPOSED_HEADERS`. (503 headers reach the browser only after A8.) Do not add it where it would disclose something #55 and #61 deliberately hide (a spent code budget is answered exactly like a wrong code).

**Acceptance tests (failing first).** Spec: a blocked OTP start returns 429 with `Retry-After` between 1 and the window length; CORS spec exposes it.

**Constraints.** Limits and windows unchanged.

Source findings: ID-RETRY-AFTER.

### A22 (P2). A demo-request replay with a different body is silently accepted

**Status at `bbc6e89`: still open.**

**Problem.** Replaying an idempotency key with a different body returns `accepted: true, replayed: true` and stores nothing new; the only abuse control is Turnstile (no per-network quota).

**Evidence.** `services/identity-api/src/commercial/demo-requests.service.ts:44-77` (`on conflict (idempotency_key_sha256) do nothing`, `replayed: true` with no body comparison); `common/idempotency.ts:17` (`requestDigest`).

**Frontend impact.** None; the public demo form uses a fresh key per submission.

**Required fix.** Store a request digest beside the key (new migration) and answer `409 IDEMPOTENCY_KEY_REUSED` when it differs. Add a per-network quota after A7.

**Acceptance tests (failing first).** Spec and `demo-requests.integration.sql`: same key, different `contactEmail`: 409; same key and body: `replayed: true`.

**Constraints.** Each submission still needs a fresh single-use Turnstile token.

Source findings: COM-DEMO-IDEMPOTENCY.

### A23 (P2). Validation errors drop nested field paths

**Status at `bbc6e89`: still open.** (#56's new `SendLabRequestToLabDto` and Lab's `AcceptEhrOrderDto` changes add no nested DTO.)

**Problem.** For nested DTOs class-validator puts the failures in `children`; the response says `{ field: 'replacementValues', messages: [] }`.

**Evidence.** `services/ehr-api/src/main.ts:73-81` (maps only top-level `property` and `constraints`); nested DTOs exist only in EHR (`ehr/shared/clinical.dto.ts:255-260`) and Lab (`lab/dto/accession.dto.ts:13`, `create-lab-import.dto.ts:26`, `ocr-lab-import.dto.ts:11`); the other services share the factory but have no nested DTO.

**Frontend impact.** None today (no screen reads `details`; native min/max run first). Needed for field-level errors on nested forms such as vital corrections.

**Required fix.** A shared helper that flattens `children` into dotted fields (`replacementValues.systolicMmhg`) with their messages; top-level entries unchanged. Apply to all six services.

**Acceptance tests (failing first).** EHR: vital correction with `replacementValues.systolicMmhg = 999` answers 400 with `{ field: 'replacementValues.systolicMmhg', messages: [<max message>] }` (`messages: []` today). Lab: one nested accession case.

**Constraints.** Top-level entries and the `VALIDATION_FAILED` code unchanged.

Source findings: BE-NESTED-VALIDATION-ERRORS (scope narrowed by the verifier).

### A24 (P2). Admin principal search and export put names, emails and audit reasons in GET query strings

**Status at `bbc6e89`: still open.** **Since `8f3eff1`:** #76 added both `POST` routes and keeps the `GET` forms for one release; the Health-id console uses only the `POST` forms since the launch alignment (`claude/launch-alignment-fixes`), so the frontend part is done and the `GET` forms can go once no earlier console is deployed.

**Problem.** Search terms (names, emails), status and the export's audit reason travel in the URL, which gateway and edge access logs record in full.

**Evidence.** `services/identity-api/src/admin/admin.controller.ts:76-81` (`GET principals` with `@Query`), `:83-87` (`GET principals/export`, reason in the query); `gateway/nginx.conf.template:12,18` (access logs disabled only for health); `infra/cloudflare/src/frontend-worker.mjs:130` (forwards pathname plus search).

**Frontend impact.** The console deliberately keeps the term out of the address bar (`Health-id: apps/patient-web/src/admin/Principals.tsx:19-22`), but the API request line carries it into access logs.

**Required fix.** Add `POST /api/v1/admin/principals/search` and `POST /api/v1/admin/principals/export`, with the query and reason in the JSON body; keep the GET forms for one deprecation release. Each POST needs a `@HighRiskAction` with a registered policy: the guard refuses a non-safe platform method without one with 403 `HIGH_RISK_POLICY_MISSING` (`security.guard.ts:208-215`).
- Search: register a new policy in `services/identity-api/src/admin/high-risk-policy.ts` with `platform.principal.read`, no step-up (as the GET today), and no reason, If-Match or Idempotency-Key.
- Export: reuse `platform.principals.export` (`high-risk-policy.ts:76`). On a POST the guard reads the policy's reason from the body (`security.guard.ts:226`).
Interim mitigation is D7.

**Acceptance tests (failing first).** `verify-platform-admin-runtime.mjs`: POST search and export return the same rows and export headers as GET; the export audit row carries the reason from the body.

**Constraints.** Permissions, step-up, high-risk policy and export headers unchanged (the GET search has no high-risk action today, `admin.controller.ts:76-81`; the POST form only adds the registration the guard needs).

Source findings: SEC-ADMIN-SEARCH-IN-URL.

### A25 (P1, new in #56). Creating an active lab request answers an error after the request is saved; the 502 loses its detail and, behind the gateway, becomes `503 UPSTREAM_UNAVAILABLE`

**Status at `bbc6e89`: new.** Introduced by #56's create contract (`docs/INTERFACE_CONTRACT.md:799-810`).

**Problem.** `POST .../lab-requests` commits the request, then asks Lab to accept it. When Lab refuses (`400`, `403`, `409`) the create answers `409 LAB_HANDOFF_REFUSED`; when Lab answers anything else (its `401`, another `4xx`, a `5xx`) or cannot be reached, `502 LAB_HANDOFF_UNCONFIRMED`; the request stays saved and active in both cases (`services/ehr-api/src/ehr/lab-requests/lab-requests.service.ts:159-167, 237-245`). `POST .../:requestId/lab-work-item` answers the same `502` (`:204-211`). Three things go wrong for a browser client:
1. The `502`'s detail, which is the only place that names the saved request, is replaced by the generic 5xx detail ("The service could not complete the request.", `services/ehr-api/src/common/problem.ts:47-49`), and the Problem carries no structured request id.
2. Behind the gateway the `502` becomes `503 UPSTREAM_UNAVAILABLE` with nothing of the EHR's answer left (A8; `gateway/proxy-headers.conf:14`, `gateway/nginx.conf.template:23-28`). A client then sees an outage on a request that was created.
3. A client that treats a non-2xx create as "not created" lets the clinician submit again; a resubmission with a new `Idempotency-Key` creates a second active request, and an abandoned one leaves an active order in the EHR that the clinician believes was never placed. Only a replay with the same key and body recovers it.
`PATCH` answers the same Lab outcomes as `200` with `labHandoff: { state: 'failed', status, code }` (`:307-315`), so the two write paths disagree. Also, `update()` reports `not_sent` (`LAB_PERMISSION_ABSENT`) without calling Lab when the actor lacks `lab.work-item.accept` (`:309-312`), while `create()` calls Lab and answers `409 LAB_HANDOFF_REFUSED` (every seeded role holding `ehr.lab-request.write` also holds `lab.work-item.accept`, `0018_lab_work_items.sql:10-13`, so this affects custom roles only).

**Evidence.** As cited; `services/ehr-api/src/ehr/lab-requests/lab-requests.controller.ts:32-39, 54-67`; `docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:554` (deploy step 9: before the Lab with #56, the new EHR reports some answers as `502` or `409 LAB_HANDOFF_REFUSED`). Health-id offers active creation (`Health-id: apps/patient-web/src/staff/routes/Clinical.tsx:289`, the "Request handling" select, at `0eda90f`).

**Frontend impact.** Once #56 is deployed, an active lab request created while Lab refuses or is unreachable is reported to the clinician as a failure (409) or as a platform outage (503 through the gateway). Health-id can work around the 409 by reloading the list, but cannot tell a 503 for a saved request from a real outage.

**Required fix.** Make create answer like update: `201` with the saved request, `labWorkItem: null` and `labHandoff: { state: 'failed', status, code }` (or `not_sent`), so the status says what happened to the EHR row and the body says what happened in Lab. If an error status is kept for create, put the saved request's id and `rowVersion` in structured Problem fields (not only `detail`) and use a status that the gateway does not intercept even before A8 (a `4xx`, for example `409 LAB_HANDOFF_UNCONFIRMED`). Apply the same choice to `.../lab-work-item`. Give create the same `lab.work-item.accept` pre-check as update.

**Acceptance tests (failing first).** `lab-requests.service.spec.ts` with a Lab fake answering 503: an active create answers `201` with `labHandoff.state 'failed'` and the saved request (`502` today); a Lab fake answering 403: `201` with `failed` and Lab's code (`409` today); an actor without `lab.work-item.accept`: `201` with `not_sent` and no Lab call. Extend `verify-ehr-lab-handoff-runtime.mjs` with Lab stopped.

**Constraints.** The save still commits before Lab is called (Lab's guard reads the committed request); Lab's `401` never reaches the browser; the resend route and replay semantics unchanged.

**Docs.** `INTERFACE_CONTRACT.md` §11 "EHR lab requests sent to Lab".

Source: this re-verification (new in #56).

---

## 4. Class B: missing or broken contracts behind screens Health-id already has

### B1 (P0, needs E1). Break-glass cannot open the chart; every emergency read is limited to the current facility

**Status at `bbc6e89`: still open; changed.** #52 made the emergency summary read a further category only when the reader holds its read permission, with per-category counts in the audit (A11). #58 showed that `emergency` is not a seeded purpose code, so on a database built from migrations break-glass activation itself is refused (B14). The chart routes, `clinicalContext()`, the facility filter and the RLS policies below are unchanged.

**Problem.** (a) All ordinary chart GETs (encounters, vitals, notes, diagnoses, prescriptions, lab requests) use `clinicalContext()`, which accepts only `direct-care`; a break-glass grant has purpose `emergency` and the normal grant branch excludes break-glass, so a break-glass holder gets 403 with direct-care and 400 with emergency. Only the summary works. Non-completed encounters, unsigned notes, note revisions and vital corrections are unreachable under break-glass. (b) Every clinical read, including the emergency summary, returns only rows created at the caller's current facility (`ehr.context_allows` requires `row_facility_id = current_facility_id`, and the emergency read adds `facility_id = $2` to every section). At an emergency department that has never treated the patient, the summary is empty. (c) Document list/download accept any validated purpose, so they likely work under break-glass, but this has not been run (hid-system N3 records the same open question for EHR documents and OCR reads).

**Evidence.** `services/ehr-api/src/ehr/shared/clinical-context.ts:7-13`; GET handlers in `ehr/encounters/encounters.controller.ts:12,22`, `vitals/vitals.controller.ts`, `clinical-notes/clinical-notes.controller.ts`, `diagnoses/diagnoses.controller.ts`, `prescriptions/prescriptions.controller.ts:17,24`, `lab-requests/lab-requests.controller.ts:17,24`; `services/ehr-api/database/migrations/0012_narrow_break_glass_authorization.sql:37-49` (normal branch excludes break-glass; exact purpose), `:80-101` (emergency branch: read only, same facility); `0005_database_authorization.sql:24-45`; `services/ehr-api/src/ehr/patient-records/patient-records.service.ts:81-104, 131-176` (every section `facility_id=$2`); `services/ehr-api/src/ehr/shared/clinical.repository.ts:56-61`; `services/ehr-api/src/documents/document.controller.ts:29-54` with `common/request-context.ts:60-71`; `docs/SECURITY.md:61` (cross-facility only through an explicit workflow; none exists). Lab and Pharmacy policies are facility-bound the same way (`0017:104-110`, `0023:227-242`).

**Frontend impact.** Under break-glass the provider portal shows only the summary and never retries as direct-care (correct). Clinicians at an ER that did not treat the patient see nothing. Once the contract exists, the portal will page the chart under `X-Purpose-Of-Use: emergency` and show the facility of each row.

**Required fix (after E1, and B14 for the `emergency` code).**
- Add `clinicalReadContext(request)` accepting `direct-care` or `emergency`; switch only the GET handlers of the six clinical controllers to it; writes keep `clinicalContext`. In `ClinicalRepository.run`, when the purpose is `emergency`, require `authorization.breakGlass === true` and refuse `write_records` with **`403 EMERGENCY_READ_ONLY`**; audit each emergency read as a break-glass read.
- If E1(b) allows cross-facility emergency reads: a new migration with a security-definer read function or a dedicated SELECT policy that admits rows from any facility only when `current_purpose_of_use = 'emergency'` and the caller holds an active break-glass grant at their current facility; drop the facility filter on the emergency path only; return `facilityId` and facility name on every row; audit per-facility counts. Do not change `context_allows` for any other purpose.
- State explicitly in the contract whether document list/download are allowed under emergency, and add a test either way.

**Acceptance tests (failing first).** `ehr-api` controller+service spec with the real guard and an Identity fake returning `allowed + breakGlass` for `emergency`: each clinical GET with `X-Purpose-Of-Use: emergency` answers 200 (400 today); POST/PATCH with emergency answer 400/403; a direct-care-only grant with the emergency header answers 403. If cross-facility: `emergency.integration.sql` gains "encounter and signed note at facility A, break-glass at facility B, summary contains A's rows" (empty today) and "direct-care grant at B still sees only B".

**Constraints.** Break-glass stays read-only unless E1(d) decides otherwise; reason, expiry, rate limit, notification and `break_glass_enabled` control unchanged; #52's per-category permission filter stays; `SECURITY.md:61` updated with the explicit workflow.

**Docs.** ADR; `SECURITY.md`; `INTERFACE_CONTRACT.md:230-241` and §11 "Record summaries".

Source findings: BE-EHR-EMERGENCY-CHART (verifier corrections applied: the summary is not "reduced"; document list/download plausibly work), "Detailed clinical chart during emergency access", PROSE-L136, BE-EHR-FACILITY-LOCAL-RECORDS, "Emergency access to the detailed chart - policy" (evidence corrected: break-glass is read-only by `0012:79-101`); hid-system PREC-4 scope (D9), OCR-READ-PURPOSE (N3).

### B2 (P0, needs E2). Lab and Pharmacy staff need their own patient grant for each patient: queues look empty and no step can be taken

**Status at `bbc6e89`: still open.** No policy changed. #51's released-results route and #56's acceptance mapping run under the same row-level security (an order whose work item RLS hides answers `404 LAB_WORK_ITEM_NOT_FOUND`, or `409 LAB_ORDER_ALREADY_ACCEPTED` on acceptance).

**Problem.** Lab and Pharmacy RLS applies `has_active_consent_grant` with the **reader's own** account, membership and exact purpose to every row. A lab technician or pharmacist without a personal grant sees an empty queue and cannot accession, run, verify, release or dispense. Their roles hold `identity.consent.write` but not `identity.patient-access-pin.verify`, so their only route is a patient-approved request, and the queue does not show which patient to ask. Accepting a prescription into Pharmacy requires `pharmacy.work-item.accept` (pharmacist only) and a direct-care **write** grant on the EHR route. `list()` itself runs no per-patient authorize, but RLS filters per row, while `get()` authorizes explicitly.

**Evidence.** `services/ehr-api/database/migrations/0012_narrow_break_glass_authorization.sql:37-49`; `0017_lab_imported_evidence.sql:104-110`; `0018_lab_work_items.sql:147-148`; `0023_pharmacy_domain_foundation.sql:24, 227-242, 379-380`; `0010_consent_commands_and_audit_reads.sql:13-21`; `0033_supabase_cutover_identity_controls.sql:16-18`; `services/lab-api/src/lab/lab-work-items.service.ts:117-143`; `services/pharmacy-api/src/pharmacy/pharmacy.service.ts:158-180, 325-334`; `services/ehr-api/src/ehr/prescriptions/prescriptions.controller.ts:51-66`; per-request session settings `services/lab-api/src/database/database.service.ts:112-116`, `services/pharmacy-api/src/database/database.service.ts:102-105`.

**Frontend impact.** The Laboratory and Pharmacy pages say "No accepted lab work" and "No accepted prescriptions" (`Health-id: apps/patient-web/src/staff/routes/Operations.tsx:462, 513`, rendered by the empty state at `:53`) when work exists. Once fixed: queues show the facility's work per the chosen disclosure rule.

**Required fix (after E2).** Implement the chosen fulfilment authorization in a new migration (`identity.has_active_consent_grant` and/or `lab.context_allows`, `pharmacy.context_allows`, and Identity `authorize()`), e.g. an order-scoped, time-limited fulfilment grant created atomically when Lab/Pharmacy accepts the order, valid for the receiving facility and that work item only; or role-scoped queue visibility with minimum disclosure plus per-patient grants for detail and writes; or grant `identity.patient-access-pin.verify` to `lab` and `pharmacist`. The PIN option makes the queue visible only: a PIN grant is `read_records` under `direct-care` (`0079_patient_access_pin_actor_window.sql:312, 322`), while accessioning, results and dispensing need `write_records` (`services/lab-api/src/lab/lab-accessions.service.ts:114`; `lab-executions.service.ts:123, 188`; `services/pharmacy-api/src/pharmacy/pharmacy.service.ts:188, 325-332`), so those steps would still need a write grant. Cover Pharmacy acceptance in the same decision. Audit every fulfilment-grant use.

**Acceptance tests (failing first).** Runtime verifiers: a doctor creates an active lab order and a prescription; a lab technician and a pharmacist at the receiving facility with no personal grant list the work item and can perform the next step (empty list or 403 today); a member of another facility still sees nothing; after the grant's end, access stops. SQL suite pinning the new policy.

**Constraints.** No facility-wide bypass of patient deny directives (`0012:55-78`) unless the ADR says so; no relaxation for other services.

Source findings: BE-LAB-PHARM-PER-MEMBER-CONSENT, LABPHARM-02, "Lab and Pharmacy work queues - disclosure policy".

### B3 (P0, needs E4). Onboarded organizations get only `org_admin`; Identity has no workforce or member API

**Status at `bbc6e89`: still open.** No workforce route exists. hid-system now records the decision as D14 (`docs/PHASE_3_LAUNCH_DECISIONS.md`, §2: which roles hold `workforce.manage`, how existing staff are attached, whether pending access requests close when a membership ends, whether staff MFA is a launch gate, "by ADR before WF-1").

**Problem.** Self-service activation and admin approval create one `org_admin` membership. `org_admin` holds `organization.manage`, `workforce.manage`, `audit.read`, `identity.registration.*` and `outreach.*`, and no `ehr.*`, `lab.*`, `pharmacy.*` or `ocr.*`. No route invites staff, lists facility members, assigns or revokes facility roles, or ends a membership; `workforce.manage` authorizes nothing. A newly onboarded hospital cannot do any clinical work and cannot add anyone. Outreach's add-member route needs a raw membership UUID because no route lists members.

**Evidence.** `services/ehr-api/database/migrations/0061_provider_cac_self_service_onboarding.sql:334-349`; `0048_cac_legal_entity_binding.sql:315-327`; `0006_phase1_authorization_vocabulary.sql:80`; `0011_governed_nin_registration.sql:18-20`; `0024_outreach_registration_foundation.sql:23-24`; `0038_outreach_campaign_workspaces.sql:17`; `services/identity-api/src/admin/admin.controller.ts:111` (only platform-role route); no `workforce.manage` in any service source; `services/outreach-api/src/outreach/dto/add-campaign-member.dto.ts`.

**Frontend impact.** The portal has no staff management screen to offer and asks Outreach admins to paste a "Membership UUID" (`Health-id: apps/patient-web/src/staff/routes/Operations.tsx:890-901`). Once the contract exists, Health-id builds staff invitation and role screens and a member picker.

**Required fix (after E4).** New `services/identity-api/src/identity/workforce.controller.ts` and service, SQL commands and runtime grants in a new migration, all gated on `workforce.manage` with a bound facility, audited, If-Match and a reason on mutations:
- `GET /api/v1/identity/facilities/current/members?status=&cursor=` (membershipId, display name, roles, status; also usable with `outreach.campaign.write` for the Outreach picker);
- `POST /api/v1/identity/facilities/current/staff-invitations` (email invitation leading to OTP activation into a membership);
- `POST /api/v1/identity/facilities/current/memberships/:membershipId/roles` and `.../end`, restricted to an allowlist of facility roles; ending a membership revokes its sessions.
- Never allow assigning platform roles through these routes; apply step-up or two-person approval to admin roles if E4 says so.
- Alternatively or additionally (E4): amend activation/approval in a new migration to grant product-appropriate clinical roles.

**Acceptance tests (failing first).** SQL suite and HTTP verifier: a freshly activated org_admin invites a clinician, assigns `clinician`, and the clinician's `/auth/session` lists `ehr.encounter.read` at the facility; a non-org_admin gets 403 `PERMISSION_DENIED`; assigning a platform role is refused; ending the membership ends the clinician's sessions; the member list shows only the bound facility's members.

**Constraints.** No platform role through workforce routes; activation and approval stay atomic and audited; `org_admin` keeps its current permissions.

Source findings: ID-NO-WORKFORCE, "Onboarded organizations have no clinical access", GAP-L114, "Staff and role management", "Reference workflows - Provider organization", BE-OUTREACH-MEMBER-DIRECTORY; hid-system WF-1, WF-2 (D14).

### B4 (P1, needs E3). OCR needs two grant purposes that the portal cannot obtain together

**Status at `bbc6e89`: still open; changed.** The OCR DTOs are unchanged. #58 showed that `healthcare-operations` is not a seeded purpose code, so on a database built from migrations every `healthcare-operations` access request and every OCR job command (create, validate, confirm, retry) is refused whatever grants the clinician holds (B14). hid-system's proposed default for E3 (N3) is that OCR commands accept `direct-care` as well, with `write_records` to create a job. Since #60 an OCR read without a valid purpose header answers `400 PURPOSE_OF_USE_REQUIRED` instead of `500`.

**Problem.** Job create, validate, confirm and retry accept only `healthcare-operations`; publication accepts only `direct-care`; reads take the header purpose; Identity matches purpose exactly. Identity accepts `healthcare-operations` access requests, but the patient's inbox does not return the purpose, so a patient cannot tell an import request from a care request. Read refusals are masked as 404 `OCR_JOB_NOT_FOUND` while creation answers 403.

**Evidence.** `services/ocr-api/src/ocr/dto/create-ocr-job.dto.ts:26`, `validate-ocr-job.dto.ts:37`, `confirm-ocr-patient.dto.ts:13`, `retry-ocr-job.dto.ts:13`, `create-ocr-publication.dto.ts:11`; `services/ocr-api/src/ocr/ocr.service.ts:142, 709-727`; `services/identity-api/src/identity/postgres-identity.provider.ts:73`; `services/identity-api/src/consent/consent.controller.ts:38-46, 95-101`; `services/identity-api/src/consent/consent.service.ts:106-118`; `services/ehr-api/database/migrations/0066_patient_access_safety.sql:274-290` (`list_my_patient_access_requests` returns no purpose); `services/ehr-api/database/migrations/0082_purpose_of_use_vocabulary.sql:13-19`.

**Frontend impact.** Migrate cannot authorize any OCR job today; the portal requests access only as direct-care. Once decided, the portal either uses one purpose throughout or adds a "records import" access request and shows the purpose to patients.

**Required fix (after E3).** One purpose: accept `direct-care` in the four DTOs and authorize the whole lifecycle under it (ADR). Two purposes: seed `healthcare-operations` (B14) and return `purposeOfUse` and the requester's display name from `identity.list_my_patient_access_requests` (new migration: drop and recreate the function with the column, runtime grant) and `ConsentService.listMyAccessRequests`. Either way decide 404 vs 403 for a job that exists at the facility without a grant.

**Acceptance tests (failing first).** Runtime verifier (`verify-ocr-runtime.mjs`, on a database that inserts no purpose code itself): one clinician holding the chosen grant(s) creates, validates, confirms and publishes a job end to end. `patient-access-safety.integration.sql`: the patient's list returns the purpose.

**Constraints.** Exact-purpose matching in Identity stays; any purpose widening only by ADR after E3.

Source findings: OCR-01, BE-OCR-PURPOSE-SPLIT, "OCR purpose of use"; hid-system OCR-1 (N3), PURPOSE-SEED (#58).

### B5 (P1). A failed OCR publication cannot be retried by id, and exhausted retries answer "in progress" forever

**Status at `bbc6e89`: still open; changed.** `ocr.service.ts` and `ocr.controller.ts` are unchanged. #60 stores an EHR, Lab or Pharmacy refusal of OCR's workload identity as the retryable `OWNING_SERVICE_UNAVAILABLE` instead of a terminal failure (A5), so fewer publications end terminal, and the contract now states the rule this item contests: "Only the original requester, keeping the original key, can retry, so a client keeps the key per validation and per requester and offers a retry only to that requester" (`docs/INTERFACE_CONTRACT.md:1172-1193`). hid-system proposes D16 ("persist the publication key per validation" in the client), which Health-id cannot do (section 0), and D12 (a lapsed authorization stays terminal).

**Problem.** A retryable publication failure resumes only by replaying the original requester's `Idempotency-Key` (lookup by facility, requester and key); any new key answers 409 `OCR_ALREADY_PUBLISHED`. No worker retries publications. The projection has no `nextAttemptAt` or `retryable`. A failure stored as `OWNING_SERVICE_UNAVAILABLE` after the last permitted attempt is not "terminal", but the claim requires `attempt_count < max_attempts`, so even the original requester gets 409 `OCR_PUBLICATION_IN_PROGRESS` forever.

**Evidence.** `services/ocr-api/src/ocr/ocr.service.ts:82-89` (retryable codes, `isTerminalFailure`), `:415-430`, `:466-487` (claim at `:474`, 409 at `:487`), `:659-667` (projection); `services/ocr-api/src/ocr/ocr.controller.ts:87-107`; no publication code in `services/ocr-worker/src`; `docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:982` ("After the last one a publication answers `409 OCR_PUBLICATION_IN_PROGRESS`, not `409 OCR_PUBLICATION_TERMINAL`, and no operator path retries it").

**Frontend impact.** After a reload, on another device, or for another reviewer, a transiently failed import is stranded. Health-id reuses one key per validation within a page visit (page memory only). Once fixed, the portal shows "retry available at <time>" and a Retry button.

**Required fix.** `POST /api/v1/ocr/publications/:publicationId/retry` (`ocr.publication.write`, purpose `direct-care`, `write_records` via `authorizeJob`, `If-Match` on the publication version, audited): runs `executePublication` for a retryable failure whatever the original key or requester; **`409 OCR_PUBLICATION_RETRY_NOT_DUE`** with `nextAttemptAt` when not yet due; **`409 OCR_PUBLICATION_TERMINAL`** for a terminal failure or exhausted attempts (treat `attempt_count >= max_attempts` as terminal in `isTerminalFailure` and the projection). Add `retryable` and `nextAttemptAt` to `projectPublication`. Optionally let `ocr-worker` claim due retryable publications.

**Acceptance tests (failing first).** `verify-ocr-runtime.mjs`: owner fake answers 503, publication is failed and retryable; a different staff member calls retry after `nextAttemptAt` and it publishes; before then 409 `OCR_PUBLICATION_RETRY_NOT_DUE`; after `maxAttempts` 409 `OCR_PUBLICATION_TERMINAL` (409 `IN_PROGRESS` today). `ocr-job-source-and-publication.integration.sql` if SQL changes.

**Constraints.** Original-key replay, retryable failure codes (including #60's workload mapping) and `max_attempts` unchanged; the claim stays conditional so a retry never publishes twice.

Source findings: BE-OCR-PUBLICATION-RETRY, OCR-03, PROSE-L130, "OCR review fields and failed publications - backend residual".

### B6 (P1). No route shows a dispensing from the EHR order, and nothing reaches the patient (clinician Lab results fixed)

**Status at `bbc6e89`: partly fixed by #51.** Fixed: the ordering clinician can read released Lab results by the EHR order, `GET /api/v1/lab/ehr-orders/:sourceEhrOrderId/released-results` (`lab.result.released.read`, an Identity `read_records` decision, released revisions only, audited as `lab.result.released.read`), and `GET /lab/results/:resultId/history` returns the released view to any reader without `lab.execution.read` (`services/lab-api/src/lab/lab-executions.controller.ts:32-35`; `services/lab-api/src/lab/lab-executions.service.ts:133-160, 181-187`; `docs/INTERFACE_CONTRACT.md:1332-1388`). What remains is below.

**Problem (remaining).** (a) Dispensing: no route returns the Pharmacy work item or dispensing for an EHR prescription; `GET /pharmacy/work-items` takes no filter and is the facility's oldest 200 (A2; `services/pharmacy-api/src/pharmacy/pharmacy.service.ts:158-167`), and EHR's prescription projection carries no Pharmacy state (A1(c)). (b) The EHR lab-request projection still carries no Lab state (`services/ehr-api/src/ehr/lab-requests/lab-requests.service.ts:36-42`), so a client asks Lab per order. (c) Patient: `/ehr/me/records` now returns only encounters and notes and names prescriptions, lab requests and documents as withheld (#52; `services/ehr-api/src/ehr/patient-records/patient-records.service.ts:10-18, 107-125`); no released results, no dispensing state, and no patient document download (document routes are staff-only, `services/ehr-api/src/documents/document.controller.ts:29-54`). (d) A released result whose correction is pending shows no flag (hid-system D11 keeps it so).

**Evidence.** As cited; `services/event-dispatcher/src/event-contracts.ts:4-19` (`LabResultReleased` and `MedicationDispensed` reach only the notification worker).

**Frontend impact.** Once #51 is deployed, Health-id can show released results under each lab request in the clinical record (it does not call the route at `0eda90f`). Dispensing status stays an interim join on the Pharmacy list, with a notice when the list is at its cap. The patient sees no results, dispensing or documents.

**Required fix (remaining).** Dispensing: add `?sourceEhrPrescriptionId=` to `GET /pharmacy/work-items` (same permission, RLS and audit), or the EHR prescription projection of A1. Patient (after E15): released results and dispensing status in `/ehr/me/records` (or patient routes) under the release categories E15 chooses, and `GET /api/v1/ehr/me/documents/:id/download` (`PatientOnly`, patient-self authorization through Identity, clean-scan documents only, audited with purpose `patient-self`).

**Acceptance tests (failing first).** Pharmacy runtime verifier: `?sourceEhrPrescriptionId=` returns that prescription's work item and dispensing (the filter is ignored today). EHR spec: the patient sees released values and can download a clean document; a staff session gets 403 `PATIENT_SESSION_REQUIRED`.

**Constraints.** Unreleased results are never returned (#51's released view stays); patient routes stay patient-session bound; downloads only after a clean scan.

Source findings: BE-RESULTS-DISPENSING-NO-RETURN (verifier correction applied for clinician dispensing, qualified by the 200-oldest cap of A2); auditor note (gapmap-1) for patient documents and results; hid-system LAB5-A, LAB5-RELEASED-LEAK (fixed by #51), PREC-1 Phase B (D7).

### B7 (P2, reasons and expiries need E6). Staff and patient session contract

**Status at `bbc6e89`: still open.** (#50 changed what "renewable" means for the kind lookup; none of the points below.)

**Problem.** (a) Staff actors carry no `kind`; `GET /auth/session` returns no idle or absolute expiry (refresh returns only the access `expiresAt`). (b) Ended staff and patient sessions get a generic 401 `AUTHENTICATION_REQUIRED`; only platform sessions have `PLATFORM_SESSION_EXPIRED`/`REVOKED`. (c) Cookie `POST /auth/logout` ends whichever sign-in the cookies hold; a sign-in made in another window between the portal's account check and the logout is ended. A frontend workaround is impossible (a remembered CSRF token mismatches and the `finally` clears the new session's cookies).

**Evidence.** `services/identity-api/src/auth/current-staff-context.service.ts:216-232`; `auth/auth.controller.ts:247-274, 328-395, 438-443`; `auth/token.service.ts:685-694`; `auth/platform-session-end.ts:21-40`.

**Frontend impact.** The portal infers staff from a missing `kind` (`Health-id: apps/patient-web/src/api.ts:7-8`), cannot name why a session ended or warn before expiry, and checks `/auth/session` before signing out (a race remains). Once fixed: named end reasons, expiry warnings and a race-free sign-out.

**Required fix.** Add `kind: 'staff'` to staff actors (additive). Return `idleExpiresAt` and `absoluteExpiresAt` from `/auth/session` and refresh. When the presented token is provably the session's own (valid signature), answer `401 SESSION_EXPIRED` or `401 SESSION_REVOKED`, reusing `classifyPlatformSessionEnd`; never leak account existence. `POST /auth/logout` accepts an optional expected session id (body field or `X-HID-Expected-Session`); on mismatch answer **`409 SESSION_CHANGED`**, end nothing and keep cookies.

**Acceptance tests (failing first).** Spec: staff `/auth/session` includes `kind` and both expiries; an expired staff session answers 401 `SESSION_EXPIRED`; logout with cookies for session B and expected A answers 409 and B stays active; a match ends A. Extend `verify-session-sign-out-runtime.mjs`.

**Constraints.** No account enumeration; `X-HID-Client` kind checks, #50's renewability rule and platform end reasons unchanged.

Source findings: ID-STAFF-SESSION-CONTRACT, ID-LOGOUT-TARGET, PROSE-L138b, "Staff session end - reason and expiry", "Staff session end - logout cannot name its session".

### B8 (P2). Registration case list/search and enrollment state

**Status at `bbc6e89`: still open.** (#60: the case read without a valid purpose header now answers `400 PURPOSE_OF_USE_REQUIRED`.)

**Problem.** Staff can open a registration case only by id; after a refresh they cannot find pending cases or tell whether enrollment already happened.

**Evidence.** `services/identity-api/src/identity/nin-registration.controller.ts:16-75` (capabilities, resolve, get, approve-new, enroll, link-existing only); `services/identity-api/src/identity/nin-registration.service.ts:613-623` (projection has no enrollment state). Impact is limited while no production NIN provider exists (B9).

**Frontend impact.** The Registration screen cannot list or resume cases. Health-id hides case creation while NIN is unavailable (B9).

**Required fix.** `GET /api/v1/identity/registration-cases?status=&cursor=` (facility-scoped, permissioned, masked NIN, audited); `accountEnrollment: { state: 'none' | 'invited' | 'active', enrolledAt }` on the case projection.

**Acceptance tests.** Spec and `verify-registration-review-runtime.mjs`: another facility's cases are invisible; the projection reports enrollment after `POST enroll`.

**Constraints.** Masked NIN only; facility RLS; every list audited.

Source findings: PROSE-L134, "Provider registration case continuity".

### B9 (P2). No production NIN provider for provider-initiated registration

**Status at `bbc6e89`: still open.** hid-system N2(d) proposes keeping facility-assisted registration out of launch scope.

**Problem.** Registration-case NIN resolution is enabled only in `test` mode; staging `deferred` answers 503; production has no provider.

**Evidence.** `services/identity-api/src/identity/nin-registration.controller.ts:16-24` (enabled only in `test` mode); `services/identity-api/src/config/environment.ts:97, 169-174`; `services/identity-api/src/identity/nin-verification.provider.ts:45-79` (Unavailable, Deferred, DeterministicTest only); deferred answers 503 `NIN_PROVIDER_DEFERRED` (masked by A8).

**Frontend impact.** Health-id hides provider-initiated case creation.

**Required fix.** A production adapter for the registration-case resolver (e.g. QoreID, as patient self-verification uses), behind the existing release gates; credentials are D5.

**Acceptance tests.** Runtime verifier with a production-shaped provider stub: `nin/resolve` creates a case and `registration-capabilities` reports enabled.

**Constraints.** Release gates and NIN keys unchanged; `test` mode stays refused outside `NODE_ENV=test`.

Source findings: "Provider-initiated patient registration", ID-NIN-REGISTRATION; hid-system FAC-2, REG-1 (N2).

### B10 (P2; campaign writes need E5). Outreach registration-case list capped at 100 with no cursor; campaign writes refused

**Status at `bbc6e89`: still open.** hid-system records E5 as N4 with a proposed default (ADR-045 option B).

**Problem.** The case list returns the newest 100 with no cursor, so older pending cases cannot be resolved from the UI. Campaign create, status and member writes answer 400 `VALIDATION_FAILED` by design until governance is decided.

**Evidence.** `services/outreach-api/src/outreach/outreach.service.ts:70-77` (`order by created_at desc,id desc limit 100`, plain array); `services/identity-api/src/identity/dto/authorize-outreach.dto.ts:3-12` (`outreach.campaign.write` not authorized, so create/status/member writes answer 400); `services/outreach-api/README.md:12-15`; ADR-045 `docs/DECISIONS.md:2176-2179` (status line still "Not merged or deployed"; #43 is merged); `docs/HEALTH_ID_OUTREACH_CAMPAIGN_CONTRACT.md:5` (still describes creation as working).

**Frontend impact.** The Outreach page shows at most 100 cases with no notice and offers link-existing only from list cards; Health-id hides campaign write actions until E5.

**Required fix.** Keyset paging and a `status` filter (`identity_resolution_pending`) on the case list, returning `{ items, nextCursor }`. After E5: enforce campaign governance in `OutreachService` and the RLS of `0038`/`0045` (new migration), then add `outreach.campaign.write` to `OUTREACH_PERMISSIONS`. Until then consider removing `outreach.campaign.write` from role grants (`0038:12-17`) so clients do not see an unusable permission. Fix the ADR-045 status line and the campaign contract doc now.

**Acceptance tests.** `verify-outreach-runtime.mjs`: with 101 cases the oldest pending one is reachable by cursor or filter; after E5, a nurse with `outreach.campaign.write` cannot add themselves as campaign admin and an org_admin can create a campaign and add an enumerator.

**Constraints.** Campaign writes stay refused until E5's governance is enforced; cookie reads (#43) unchanged.

Source findings: OUTREACH-03, PROSE-L129.

### B11 (P2). A clinician cannot list their own active grants (break-glass included)

**Status at `bbc6e89`: still open.** The replay workaround below also needs an `emergency` code to exist (B14).

**Problem.** The staff access-request list excludes break-glass grants and caps at 100 rows with no cursor, so after a reload a clinician cannot see their own active emergency grant (closing it needs its id).

**Evidence.** `services/ehr-api/database/migrations/0074_staff_access_request_outcome.sql:139` (`break_glass = false`), `:146` (`limit 100`, no cursor); `services/identity-api/src/consent/consent.service.ts:85-104`; close needs the grant id (`consent.controller.ts:103-117`). A re-POST of `/identity/break-glass` replays the active grant's id without extending it (`0031_emergency_notification_and_rate_limit.sql:119-154`), which Health-id will use as a workaround.

**Frontend impact.** Health-id will recover the grant id through the break-glass replay; a listing removes the workaround.

**Required fix.** `GET /api/v1/identity/consent-grants/mine?status=active&cursor=` (grantId, patientId, hid, purpose, scope, expiresAt, breakGlass, authorizationMethod), new SQL function plus runtime grant; or include break-glass rows (`breakGlass: true`) and a cursor in the existing list.

**Acceptance tests.** Activate break-glass; in a new request list and close it (200); the grant no longer authorizes the emergency summary.

**Constraints.** Replay semantics (no extension, no new notification) unchanged; close still needs a reason and the `break_glass_enabled` control.

Source findings: BE-BREAKGLASS-GRANT-UNLISTABLE (severity lowered by the verifier).

### B12 (P2). No facility OCR job list

**Status at `bbc6e89`: still open.**

**Problem.** `GET /ocr/jobs` requires a `documentId` and returns one job; there is no facility list of jobs awaiting validation or failed.

**Evidence.** `services/ocr-api/src/ocr/dto/find-ocr-job.dto.ts:3-5` (`documentId` required); `services/ocr-api/src/ocr/ocr.controller.ts:30-35`.

**Frontend impact.** Migrate reaches a job only through a document inside an encounter, and the portal says so.

**Required fix.** `GET /api/v1/ocr/jobs?status=&cursor=` facility-scoped: job metadata only, or per-row patient authorization; audited listing.

**Acceptance tests.** Two jobs awaiting validation at the facility are listed; another facility's job is not.

**Constraints.** Facility-scoped; metadata only or per-row patient authorization.

Source findings: BE-OCR-JOB-QUEUE, GAP-L88.

### B13 (P2). Documents without an encounter cannot be listed

**Status at `bbc6e89`: still open.**

**Problem.** Upload makes `encounterId` optional, but the list requires it, so documents uploaded without an encounter cannot be listed.

**Evidence.** `services/ehr-api/src/documents/dto/list-documents.dto.ts:3-6` (`encounterId` required) while `create-document-upload.dto.ts:20` makes it optional; the list query filters `document.encounter_id=$2` (`services/ehr-api/src/documents/document.service.ts:147`).

**Frontend impact.** Such documents never appear in the clinical record's document list.

**Required fix.** Make `encounterId` optional on `GET /ehr/documents` (patient-wide list, paged with a cursor), with the same authorization.

**Acceptance tests.** An upload without an encounter is listed for the patient; an encounter filter still works.

**Constraints.** Authorization unchanged.

Source: auditor note (gapmap-2).

### B14 (P1, new; needs E1 and E3). The purpose codes `emergency` and `healthcare-operations` are not seeded: break-glass and OCR job commands are refused on a database built from migrations

**Status at `bbc6e89`: new; partly fixed by #58.** #58 found that `identity.purpose_of_use_codes` (0003) was never seeded by any migration, the role bootstrap or the legacy importer, so every staff consent check failed closed on a migrations-built database; the suites and verifiers had hidden it by inserting the codes themselves. Migration 0082 seeds `direct-care` only (`ON CONFLICT (code) DO NOTHING`) and deliberately holds the other two codes the services name until their product decisions.

**Problem.** Without an active `emergency` code, break-glass activation answers `400 INVALID_CONSENT_COMMAND` while `break_glass_enabled` is on (its 0039 default) and `423 BREAK_GLASS_DISABLED` while it is off; so the emergency summary (B1), the break-glass grant replay (B11) and the emergency purpose in general are unusable. Without `healthcare-operations`, every `healthcare-operations` access request and read is refused, and with it OCR job create, validate, confirm and retry (B4). Whether staging or production hold hand-inserted rows cannot be told from the repository (release checklist P10).

**Evidence.** `services/ehr-api/database/migrations/0082_purpose_of_use_vocabulary.sql:1-26` (header `:13-19` names the two held codes and why); `docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:190-191` (consequences, "Not seeded, pending product decisions"), `:359` (P10: record the codes before and after 0082 and the `break_glass_enabled` state); `docs/PHASE_3_LAUNCH_DECISIONS.md` N3 and operator plan I2; `services/ocr-api/src/ocr/dto/create-ocr-job.dto.ts:26` (`@IsIn(['healthcare-operations'])`).

**Frontend impact.** On such a database Health-id's break-glass flow fails with `400 INVALID_CONSENT_COMMAND` (Health-id shows a generic refusal; it should say emergency access is not available) and Migrate cannot start any OCR job. Health-id cannot work around either.

**Required fix (after E1 and E3).** Seed `emergency` by a reviewed migration only after `break_glass_enabled` is set to its intended launch state (hid-system's proposal), and `healthcare-operations` with the E3 decision (or retire it from the OCR DTOs if E3 chooses `direct-care` only). Until then, answer break-glass activation with a named code when the purpose code is missing or inactive (for example `423 EMERGENCY_PURPOSE_UNAVAILABLE`) instead of the generic `400 INVALID_CONSENT_COMMAND`. Run P10 on every environment and record the result in the release.

**Acceptance tests (failing first).** `purpose-of-use-vocabulary.integration.sql` (it inserts no code): after the new migration, as `hid_identity_runtime`, a break-glass activation with the control on succeeds (refused with 22023 today); an OCR job create under the E3 purpose is authorized. Identity spec: activation with the code missing answers the named code.

**Constraints.** `ON CONFLICT (code) DO NOTHING` semantics stay (an operator's inactive row is kept); exact-purpose matching stays.

**Docs.** `DATABASE.md` "Purpose-of-use vocabulary (0082)", `INTERFACE_CONTRACT.md` (break-glass refusals), `PHASE_3_LAUNCH_DECISIONS.md` N3.

Source: hid-system PURPOSE-SEED (#58), re-verified here.

---

## 5. Class C: unmerged and unreleased work

### C1. PR #47: facility selection kept per sign-in (ADR-046); must be renumbered from 0080 to 0085

**Status at `bbc6e89`: changed; still open.** Branch `claude/facility-selection-persistence`, head `1c18e91`, **not merged** (`1c18e91` is not an ancestor of `bbc6e89`; its merge base is `6b49a06`). Health-id #42 (the client) has merged and works without `facilitySelection`. On `main`, `POST /auth/facility` still stores nothing; refresh always resolves the primary facility, and so does `GET /auth/session` unless the request carries a valid `X-Facility-ID` for one of the actor's facilities, which the guard binds (`services/identity-api/src/auth/security.guard.ts:114-126`). Evidence: `services/identity-api/src/auth/auth.controller.ts:398-436`; `current-staff-context.service.ts:202-214`; `token.service.ts:587, 874` never pass `preferredFacilityId`.

**Re-verification against `bbc6e89`** (read-only trial merge, `git merge-tree 6b49a06 bbc6e89 1c18e91`):
- **Migration number.** #47 adds `0080_session_facility_selection.sql`; `main` has 0080 (#48), 0081 (#55), 0082 (#58) and, since `bbc6e89`, 0083 (#63) and 0084 (#64). Renumber to **`0085`** (next free at `b69a6ab`) and recompute its `sha256`. 36 added lines in 18 files of #47 name `0080` (docs, `release/config/components.json`, `scripts/verify-migration-ledger.mjs`, `scripts/run-container-database-acceptance.sh`, `scripts/tuf-staging-migration-rehearsal.mjs`, `runtime-grants.sql`, the SQL suite, `verify-facility-selection-runtime.mjs`, `auth-policy.ts`, `auth.controller.ts`, `auth.types.ts`, `token.service.ts` and the two specs); rename each.
- **Textual conflicts (five files):** `docs/DATABASE.md`, `docs/MIGRATION_RUNBOOK.md` (the migration table row and the two "ledger reaches" lines, now `0082`), `release/config/components.json` (`last`/`count` now `0082`/`82`, and the file list), `scripts/run-container-database-acceptance.sh` (the suite after `purpose-of-use-vocabulary.integration.sql`, and the `0001-0082` range string), `scripts/verify-migration-ledger.mjs` (the accepted map). Resolve each by appending #47's entry after 0082 as 0083. **At `b69a6ab`** (`git merge-tree` of `1c18e91` onto `b69a6ab`, which writes nothing) eight files conflict: those five, plus `docs/DECISIONS.md` (ADR-047, now accepted, sits where #47 adds ADR-046), `docs/TUF-STAGING-MIGRATION.md` and `services/ehr-api/database/runtime-grants.sql`. Append #47's entry after 0084 as 0085.
- **Auto-merged, re-review semantically (at `bbc6e89`; at `b69a6ab` `docs/DECISIONS.md`, `docs/TUF-STAGING-MIGRATION.md` and `runtime-grants.sql` conflict instead, above):** `services/identity-api/src/auth/auth.controller.ts` and `token.service.ts` (#50 changed both: `setCookies`/`clearCookies` now also expire `hid_enrollment`, and the renewability lookup `RENEWABLE` now requires `ACTOR_RESOLVES`, `token.service.ts:101-124`); `runtime-grants.sql` (#55 added the `auth.otp_start_cooldowns` grants); `docs/DECISIONS.md` (ADR-046 is still free on `main`; ADR-047 was proposed by draft #54, and #54 merged it as accepted at `fa811b7`); `docs/INTERFACE_CONTRACT.md`; `docs/TUF-STAGING-MIGRATION.md`; `scripts/tuf-staging-migration-rehearsal.mjs`. #47 does not touch `docs/PHASE_4_STAGE_5_RELEASE_READINESS.md`, which now lists 0080 to 0082 in §1 and §5; add #47's migration there (rule 7), as 0085 at `b69a6ab`.
- **Re-run every gate** after the rebase, including the rehearsal and the container acceptance (rule 6), and paste the results; CI green at `1c18e91` was against `6b49a06`.
- **Two memberships at one facility (hid-system N5, new question).** `resolvePostgres` groups by membership, so an account with two active memberships at one facility yields two `facilities` entries with the same `id`, ordered by `is_primary desc, facility.name, membership.facility_id` with no membership tie-break (`current-staff-context.service.ts:158-162, 172`); `toActor` then binds whichever comes first (`:212-214`). #47 stores a `membershipId` with the selection; decide which membership a stored facility selection binds (hid-system proposes the oldest active membership) and run the read-only data check I4 first (`docs/PHASE_3_LAUNCH_DECISIONS.md`, N5 and I4). #59 states the same gap for upload completion ("an account with two memberships at one facility may be bound to either").

You decide release placement. Before merging:
1. **Refresh failure path.** On the branch, when the selection read fails after rotation, refresh sets the rotated cookies and answers 503 (`#47@1c18e91 services/identity-api/src/auth/auth.controller.ts:255-261`; the read fails as 503 `DEPENDENCY_UNAVAILABLE` at `:516-523`). Through the gateway that 503 loses its `Set-Cookie` (A8), the browser keeps the spent refresh token, and the next refresh revokes the family. Either land A8 first, or answer **200** with the rotated cookies and a selection state that says the choice could not be read (a new value such as `'unavailable'`, which is a contract change Health-id must handle; the branch's type allows only `'selected' | 'default' | 'reselect'`, `#47@1c18e91 services/identity-api/src/auth/auth.types.ts:54`). Do not report `'default'` in that case: ADR-046 rightly refuses to report a facility the user did not choose. Also apply A6 on the branch: its first try block (`:242-247`, around the rotation) still clears cookies on any error, 5xx included, and its last try block (`:262-270`) still clears them when the success audit fails after the committed rotation; both survive the trial merge unchanged.
2. **Product decision E7** (ask at every multi-facility sign-in, or only on `reselect`, plus N5) must be made before #47 is **deployed**; not before it merges.

Deploy order (from the branch's `docs/MIGRATION_RUNBOOK.md` row, renumbered): **apply #47's migration (0085 at `b69a6ab`) after 0080 to 0084, then run the role bootstrap (`db:bootstrap`, `db:verify-roles`), before the Identity build that reads the table serves traffic.** Without the table every staff `GET /auth/session` and refresh answers 503 and no staff page loads. The previous Identity ignores the table. The migration takes `SHARE ROW EXCLUSIVE` on four tables briefly; it fails cleanly after the 5 s lock timeout and can be re-run.

Contract changes to announce:
- `facilitySelection: 'default' | 'selected' | 'reselect'` on sign-in, `/auth/session`, refresh and `POST /auth/facility` responses;
- `POST /auth/facility` can answer 401 if the sign-in ended;
- `GET /auth/session` can answer `503 DEPENDENCY_UNAVAILABLE`, with cookies untouched, when the stored choice cannot be read;
- refresh can answer `503 DEPENDENCY_UNAVAILABLE` with the rotated cookies and `X-CSRF-Token` set and no actor in the body (`#47@1c18e91 docs/INTERFACE_CONTRACT.md:192-198`; `services/identity-api/src/auth/auth.controller.ts:255-261, 516-523`), unless item 1 changes it to a 200.

Source findings: HID-47-UNMERGED, ID-FACILITY-NOT-PERSISTED, "Facility selection after reload - backend", "Organization/facility selection", PR42-PRODUCT-ASK-EVERY-SIGNIN; hid-system WF-3, FAC-4 (N5).

### C2. Merged on `main`, not known to be released

**Status at `bbc6e89`: changed (the set grew).** `main` still has no release tag. The release-readiness doc still says nothing it covers (now the database through 0082) has been deployed and no staging or production database has been migrated (`docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:32-33, 40`), and that none of the §7 staging checks (S1-S6, including S4a-S4i) has been run because no staging environment exists (`:572-594`, statement at `:574-576`). Health-id treats all of these as unreleased:
- **#39** sign-out by refresh cookie and `X-HID-Client` kind checks (S4e);
- **#41** www `/provider/recover` (`apps/web/src/App.tsx:221`);
- **#42** Identity session-route refusals audited instead of 503;
- **#46** EHR and OCR guard refusals before a facility is bound, audited instead of 503;
- also #31 (Lab: patient authorization before listing a specimen's executions), #33 (Stage 8 fail-closed session guards and OCR worker leases, migration 0077; merge `54f79d2`), #34 (Stage 9: runtime-role row locks, migration 0078, SERIALIZABLE retry; S4g, S4h), #35 and #36 (OCR publication retry), #37 (patient signup-to-sign-in runtime verifier only; no product code), #38 (delegated cookie reads, S4d), #40 (timeline cursor precision, S4f), #43 (Outreach cookie reads), #44 (exact `requestedAt`), #45 (PIN actor window, 0079);
- **new since `6b49a06`:** #48 (Pharmacy source prescription guards, **0080**; on apply, already accepted work items whose prescription changed become undispensable at once, `:242`), #49 (Identity MFA key in CDK; operator plan I1, D4), #50 (enrollment activation budget, enrollment cookie expired at sign-in/refresh/sign-out, renewability requires a resolvable actor; S4i), #51 (released Lab results by EHR order, B6), #52 (record summaries, A11), #53 (per-process workload JWKS), #55 (uniform recovery start and recovery code budget, **0081**, A13), #56 (EHR to Lab handoff, A3, A25), #57 and #62 (docs, including `PHASE_3_LAUNCH_DECISIONS.md`), #58 (direct-care purpose code, **0082**, B14), #59 (uploader-only completion, A15), #60 (purpose 400 and OCR workload refusals, A14, A5), #61 (enrollment contact-code budget per recipient);
- with migrations 0077-0082 and their bootstrap order (§2, §5, §6, §9 of the release-readiness doc): 0080 needs no bootstrap but the Pharmacy API with the `409` mapping should go before or with it; 0081 needs the bootstrap before the Identity build with #55 (otherwise every recovery start fails); 0082 needs P10 before and after; the EHR with #56 deploys after the Lab with #56 (`:529-531, 541-554`); the `mfaSecretKeyB64` field must exist in each environment's Identity secret before the #49 task definition is deployed, or no Identity task starts (`:352`, `:551`).

Ask: state which commit is deployed in each environment; plan the release that carries these (respecting the documented migration-then-bootstrap-then-deploy order and operator plans I1 and I2); run the §7 staging acceptance (S1-S6, including S4a-S4i) on staging (D3); tell Health-id when each lands so it can drop its interim handling and handle the new contracts (section 9).

Source findings: PROSE-L137, "Staff sign-in, recovery and enrollment on product hosts - release and hosting" (release half).

---

## 6. Class D: infrastructure and deployment (code PRs allowed; applying them needs separate authorization)

**D1. Hosting and same-origin `/api/v1` for the Health-id portals.** **Status at `bbc6e89`: still open.** Cookies are host-only and `SameSite=Strict` with the refresh cookie on `/api/v1/auth` (`services/identity-api/src/auth/auth.controller.ts:500-515`), and the CSRF cookie must be readable on the portal origin, so the portal must call `/api/v1` on its own origin. Every worker serves a hid-system app (`infra/cloudflare/workers/*/wrangler.json`; `infra/cloudflare/src/frontend-worker.mjs:10-35, 128-187`); Health-id has no deployment definition. Decide which application serves www and each product host (with E8); add worker definitions that serve Health-id builds with the same `/api/v1` proxy (preserving Origin, cookies, `X-CSRF-Token`, `X-HID-Client`, `Idempotency-Key`, `If-Match`); retire or redirect the legacy `apps/admin` on `admin.healthidentitydirectory.com` (`infra/cloudflare/workers/hid-admin/wrangler.json`; it signs in with staff `POST /auth/login`, `apps/admin/src/App.tsx:63`, which platform routes refuse); either proxy `/gateway-health/*` or have Health-id drop those registry entries, and make `/gateway-health/ready` check upstreams (`gateway/nginx.conf.template:17-21`). Verify in a real browser that Google Identity Services sign-in works under the worker's `Cross-Origin-Opener-Policy: same-origin` (`frontend-worker.mjs:38`); GSI popup mode documents `same-origin-allow-popups`. Test: on each host, browser sign-in, refresh, logout and one CSRF mutation per service succeed; platform MFA sign-in on admin. Sources: PROSE-L141, "Production /api/v1 routing", "Legacy admin app and hostname", INFRA-HOSTING-AND-LEGACY-ADMIN, "Staff sign-in ... release and hosting" (hosting half); security auditor note (COOP).

**D2. Turnstile actions per host.** **Status at `bbc6e89`: still open.** Only www and staging accept `patient-login`, `staff-login` and `admin-login` together, plus `staff-reset`, `provider-enrollment` and `patient-enrollment`; admin accepts only `admin-login` and `admin-reset`; the lab, pharmacy, migrate and outreach hosts accept only their own `*-login`, and the ehr host accepts `ehr-login` and `staff-login` (`services/identity-api/src/auth/turnstile.service.ts:24-53`, ehr at `:32` and `:46`). Health-id plans the admin console on the admin host and the unified portal on a host still to be chosen. After E8/E9, change `ACTIONS_BY_DEPLOYMENT` (with spec) and configure the Turnstile widget hostnames. Sources: "Portal hostname and Turnstile", "Staff sign-in ... decisions".

**D3. Staging environment and acceptance.** **Status at `bbc6e89`: still open; the checklist grew** (S4i for #50; S4g extended for 0080; P10 for 0082). Stand up the staging gateway and services, seed principals and facilities, and run the §7 staging acceptance (S1-S6, including S4a-S4i and the S4b OCR pipeline; `docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:572-594`) and confirm P8 (schema owner, `:357`; operator plan I3) and P10 (purpose codes, `:359`), then the Health-id patient, provider, admin, pricing and demo journeys through the same-origin proxy. Include: staff idle expiry, absolute expiry and revocation with real browsers (hidden, switched and bfcache-restored tabs never show a patient); Google OIDC, OTP delivery and Turnstile per host; a public organization application submitted and reviewed; Lab result visibility with absent, revoked and active grants (#31) and the released-results route (#51); A7 (two clients' OTP limits independent); break-glass activation once `emergency` is seeded (B14). Sources: "Staging acceptance", "Staff session end - browser and staging verification", "Google, OTP and bot checks", "Reference workflows - Migrate", PROSE-L137, "Provider organization application" (not a defect; only this proof remains).

**D4. Secrets and allowed origins per environment.** **Status at `bbc6e89`: partly fixed by #49.** Fixed in code: the regional stack now injects `MFA_SECRET_KEY_B64` from the `mfaSecretKeyB64` field of the Identity sensitive secret and sets `MFA_KEY_VERSION=aws-v1`, and the preflight checks the field's format (`infra/aws/src/hid-regional-stack.ts:451-460, 780-782, 861-885, 895-898`; `scripts/staging-external-preflight.py`). Not done (operator plan I1, not run): the field must be added to each environment's secret **before** that task definition is deployed, or ECS starts no Identity task and every sign-in stops (`docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:352`, `:551`). Still open: every deployed portal origin in `CORS_ORIGINS` of Identity, EHR, Lab, Pharmacy, OCR and Outreach (built from fixed subdomains today, `infra/aws/src/hid-regional-stack.ts:761-762`; Identity checks Origin even on same-origin refresh, logout and OTP: `services/identity-api/src/auth/auth.controller.ts:27, 593-598`, `auth/otp.controller.ts:14-16, 52-56`, `auth/security.guard.ts:318-323`); `TURNSTILE_SECRET_KEY` (`turnstile.service.ts:74-76`); Google client IDs; Health-id public site keys per environment. Never reuse a key across environments; do not rotate the NIN or OTP HMAC keys before a keyring ships (I8). Source: "Environment secrets and origins"; hid-system MFA-INFRA-P3 (#49).

**D5. NIN/QoreID credentials.** **Status at `bbc6e89`: still open.** Patient self-verification (QoreID) needs only credentials and configuration; provider registration cases first need B9. Test with safe identities on staging. Public NIN-only enrollment also waits on hid-system N1 (E20). Source: "NIN verification".

**D6. Content-Security-Policy.** **Status at `bbc6e89`: still open.** No CSP anywhere (`infra/cloudflare/src/frontend-worker.mjs:37-42`). Add a header CSP with `frame-ancestors 'none'` for portal hosts in the worker (script/frame origins: `https://challenges.cloudflare.com`, `https://accounts.google.com/gsi/`; `connect-src 'self'` plus the presigned document-storage origin). Health-id adds its own meta/Next CSP. Test: extend `infra/cloudflare/test/frontend-worker.test.mjs`. Source: SEC-NO-CSP (shared with frontend).

**D7. Access-log query strings.** **Status at `bbc6e89`: still open.** Interim mitigation for A24: drop `$args` from gateway and edge access-log formats for `/api/v1/admin/`. Source: SEC-ADMIN-SEARCH-IN-URL.

**D8 (new). Malware scanner engine and credential.** **Status at `bbc6e89`: new (recorded by #57).** No document becomes downloadable, and no OCR job can start, until a scanner posts `clean` for the exact object version; the engine, its workload identity (`hid:<env>:document-scanner`) and the `document_scanner` account are undecided and unprovisioned (`docs/PHASE_3_LAUNCH_DECISIONS.md` D5 and operator plan I7). Health-id's document download and Migrate depend on it. Decide (hid-system D5), then deploy per I7 with a staging check (a PDF becomes downloadable and can start OCR; an EICAR file is refused).

**D9 (new). Production workload issuer.** **Status at `bbc6e89`: new (recorded by #57; draft #54, ADR-047 proposed). At `b69a6ab`: decided; #54 merged and ADR-047 accepted (2026-10-13), not deployed.** Every service-to-service call in production depends on the workload token issuer, its key custody, its outage behaviour and its edge protection (hid-system D1 to D3, plans I5 and I6). The JWKS endpoint shares the issuer's stage throttle; #53 reduced the per-request JWKS fetches that would have hit it. A5's `503 WORKLOAD_IDENTITY_UNAVAILABLE` is the browser-facing answer for an issuer outage. D1 to D3 are decided by ADR-047; run I5 on staging before I6.

---

## 7. Class E: product decisions to obtain (with options)

Every E item is still open at `bbc6e89`; none was decided by the merged PRs. Where hid-system's `docs/PHASE_3_LAUNCH_DECISIONS.md` (#57, #62) records the same question with a proposed default, the hid-system id is given; a proposed default is not a decision.

- **E1. Emergency (break-glass) access** (blocks B1, B14; informs A11). **Status: still open; changed** (hid-system D9 and N3; #52 implemented D9's proposed default for the summary; `emergency` is unseeded, B14). (a) Detailed chart: summary only (today) / all ordinary chart GETs read-only / a named subset. (b) Facility scope: current facility only (today; empty at an ER that never treated the patient) / break-glass reads all facilities read-only / also let patient-approved direct-care grants span facilities. (c) Summary content: keep the seven sections (today; since #52 each further section only for a reader holding its read permission, and the seeded doctor, clinician and nurse roles hold all seven) / narrow back to completed encounters and signed notes / add allergies (no allergy model exists) and verified emergency contacts (today only notified). (d) Emergency documentation: none (today; an ER cannot record care for an unconscious patient: break-glass is read-only, `0012:80-101`; PIN grants are read-only direct-care, `0079:306-325`) / break-glass write limited to encounters, vitals and notes with mandatory retrospective review / a facility-attested emergency treatment grant. (e) Document list and download, and OCR reads, under `emergency`: allowed (today, untested) or refused (hid-system N3 asks the same). (f) New: when to seed the `emergency` purpose code, and the launch state of `break_glass_enabled` (on by default, 0039). Source findings: BE-EMERGENCY-NO-WRITE, EHR-EMERG-02, "Emergency access to the detailed chart - policy", BE-EHR-FACILITY-LOCAL-RECORDS; hid-system D9, N3.
- **E2. Lab/Pharmacy fulfilment authorization and queue disclosure** (blocks B2). **Status: still open.** Per-member patient grants (today) / order-scoped fulfilment grant created on acceptance for the receiving facility / role-scoped queue with minimum disclosure (which fields) and per-patient grants for detail and writes / PIN verification for `lab` and `pharmacist` (this makes the queue visible only: a PIN grant is `read_records`, so accessioning, results and dispensing would still need a write grant; see B2). Must also cover Pharmacy acceptance (today a pharmacist needs a patient-approved EHR write grant). hid-system's decision record has no entry for it. Source findings: BE-LAB-PHARM-PER-MEMBER-CONSENT, LABPHARM-02, "Lab and Pharmacy work queues - disclosure policy".
- **E3. OCR purpose of use** (blocks B4, B14). **Status: still open; changed** (hid-system N3 proposes: OCR commands accept `direct-care` as well as `healthcare-operations`; creating a job needs `write_records`, so a read-only PIN cannot start paid extraction; `healthcare-operations` is unseeded until this is decided). One purpose (`direct-care`) for the whole job lifecycle / two purposes (`healthcare-operations` for job steps, `direct-care` for publication) with the purpose and requester shown to the patient. Also: refusals as 404 (hide existence) or 403. Source findings: OCR-01, BE-OCR-PURPOSE-SPLIT, "OCR purpose of use"; hid-system N3.
- **E4. Workforce for onboarded organizations** (blocks B3). **Status: still open** (hid-system D14: which roles hold `workforce.manage`, how existing staff are attached, whether pending access requests close when a membership ends, whether staff MFA is a launch gate; by ADR). Which facility roles each organization type gets at activation/approval / org_admin-managed invitations and role assignment; which roles org_admin may assign; step-up or two-person approval for admin roles; invitation channel (email OTP). Source findings: ID-NO-WORKFORCE, "Onboarded organizations have no clinical access", "Staff and role management", GAP-L114; hid-system D14.
- **E5. Outreach campaign governance (ADR-045)** (blocks B10 writes, F outreach). **Status: still open** (hid-system N4 proposes ADR-045 option B: per-campaign governance first, only a campaign's own `admin` members may change it, in `OutreachService` and RLS, then authorize the permission). Who may create and close campaigns (org_admin/admin only?), who may add members (campaign admins only?), members cannot raise their own role; whether field workers outside facility staff exist. Health-id's public outreach copy depends on it. Source findings: PROSE-L129 (campaign writes); GAP-L91 is the frontend copy that depends on it (section 9); hid-system N4.
- **E6. Session policy** (B7). **Status: still open.** (a) Idle lifetime: `AUTH_REFRESH_TTL_SECONDS` defaults to 8 h (`services/identity-api/src/config/environment.ts:43-45`) while the patient portal shows sign-in after the 15-minute access token lapses; set a shared-device timeout. (b) Expose end reasons and expiries to staff/patient clients. (c) Separate cookie names for patient sessions on the shared origin (as platform sessions have) vs keep the `X-HID-Client` mitigation; separate names need a coordinated frontend change. Source findings: ID-SHARED-SESSION-COOKIE, "Patient and staff idle lifetime", ID-STAFF-SESSION-CONTRACT, "Staff session end - reason and expiry".
- **E7. Facility chooser after #47 deploys** (C1). **Status: still open; changed** (Health-id #42 is merged and asks at every multi-facility sign-in; hid-system N5 adds a question). Ask at every sign-in when the person has more than one facility (Health-id today) / ask only on `reselect` (ADR-046's own client guidance, `#47@1c18e91 docs/INTERFACE_CONTRACT.md:245-247`). New (N5): when an account has two active memberships at the same facility, which one a session binds (hid-system proposes the stored selection, else the oldest active membership); run the read-only check I4 first. Decide before deploying #47. Source findings: PR42-PRODUCT-ASK-EVERY-SIGNIN; hid-system N5.
- **E8. Portal hostname** (D1, D2). **Status: still open.** Unified portal on www (the only production host accepting patient, staff and admin login) / another host (Turnstile change). Admin console on the admin host (retire legacy `apps/admin`). Source findings: "Portal hostname and Turnstile - hostname decision".
- **E9. Provider enrollment host and recovery return link** (D2). **Status: still open.** Keep `provider-enrollment` and `staff-reset` on www only; whether a fixed, validated return from `www/provider/recover` to the product host is wanted. Source findings: "Staff sign-in, recovery and enrollment on product hosts - decisions".
- **E10. Patient lookup existence** (`services/identity-api/src/identity/identity.service.ts:33-48`: 404 unknown HID vs 403 known without consent, generic codes). **Status: still open.** Hide existence (one answer for both) / keep the distinction; in both cases use domain codes `PATIENT_NOT_FOUND`, `PATIENT_ACCESS_NOT_AUTHORIZED`. (#55 removed the same kind of oracle from recovery start, CODEX.md §27.) Source findings: ID-LOOKUP-ENUM.
- **E11. OTP recovery audience** (`services/identity-api/src/auth/otp.controller.ts:20-36`, `otp.service.ts:77-223`). **Status: still open** (#55 changed the start's answers and added one code budget per account across purposes, not the audience). Any account kind for any recovery action (today) / bind `staff-reset`, `admin-reset` and `patient-reset-start` to their account kinds, keeping identical public responses. Source findings: "OTP recovery audience".
- **E12. Patient access history** (`0066_patient_access_safety.sql:393-412`: latest 50 grants, no paging). **Status: still open.** Grants only / actual record-access events (facility, time, purpose) with paging. Source findings: ID-ACCESS-HISTORY-CONTRACT.
- **E13. Admin exact totals.** **Status: still open.** Cursor paging only (today) / exact waiting counts on `GET /admin/overview`. Source findings: "Admin list caps".
- **E14. EHR audit route.** **Status: still open; corrected.** EHR's `GET /audit/events` (`services/ehr-api/src/audit/audit.controller.ts:8-14`) is not served: its controller is registered in no module (`services/ehr-api/src/audit/audit.module.ts:4-6` provides only `AuditService`; `services/ehr-api/src/app.module.ts:14-28` registers only `HealthController`), and the gateway would route `/api/v1/audit` to Identity anyway (`gateway/nginx.conf.template:34-35`). The previous text gave only the gateway reason. Retire it / expose it as `/api/v1/ehr/audit/events` (register the controller and route it). Source findings: "Facility audit and provider reporting" (audit half; the reporting half is in F); DOC-FRONTEND-CLAIMS (correction).
- **E15. Patient result and record release** (B6). **Status: still open; changed** (#52 now withholds vitals, diagnoses, prescriptions, lab requests and documents from the patient summary by default and names them in `withheld`; hid-system D7 proposes: completed-encounter items only, never draft or entered in error, confirmed diagnoses only, documents only once a patient download route exists). Show released Lab results to patients immediately / after a delay or clinician sign-off; which other categories are released and on which conditions. Source findings: auditor note (gapmap-1) for patient results (B6); hid-system PREC-1 Phase B (D7).
- **E16. Patient self-service and commercial scope** (F). **Status: still open.** Which profile fields patients may edit (contact details with re-verification; NIN-verified name and date of birth through review only); patient-reported history; patient-created share grants beyond the Access PIN; offers, free periods and trials. Source findings: "Free periods/offers", "Patient bio-data/profile edit", "Structured medical history editing", "Patient sharing/invites", "Reference workflows - Patient account".
- **E17 (new). Vital correction semantics** (blocks A11(a)). **Status: open** (hid-system D8; #52 held the implementation back, preserved in hid-system commit `7401193`). The current correction replaces the whole current set (proposed default; how Health-id's clinician chart renders it) / it replaces only the named values. Risk of the default: an API client that sends a partial correction loses the omitted values.
- **E18 (new). Accepted Pharmacy and Lab work after an EHR change** (blocks A1(b), A3 remaining). **Status: open** (hid-system D10 and D15). Today: a dispensing needs the exact accepted prescription version (#48), so any edit or a hold and resume strands the work item, and re-handoff answers `409 IDEMPOTENCY_CONFLICT`; Lab keeps working the version it accepted whatever the EHR does (#56). Options: re-handoff of the new version (needs an ADR on one work item per prescription/order) / refuse EHR edits, holds and cancels after handoff (`409 ..._IN_PHARMACY`/`_IN_LAB`) / propagate withdrawal and changes (A3's withdrawal route). hid-system's proposed Lab default: refuse new accession and execution for cancelled or entered-in-error orders; released results stay. Also confirm EHR-to-Lab ordering and in-system result return are in launch scope (D15 proposes yes).
- **E19 (new). Recovery and enrollment code-guess budgets.** **Status: open** (hid-system D6; implemented as the default by #55 and #61). Five wrong codes in 15 minutes per account (recovery) or per recipient (enrollment contact) block every code, a correct one too, for 15 minutes; never keyed by IP; no daily cap. Risks for Health-id's users: anyone who knows an email address or HID can suspend that account's recovery, and anyone who knows a phone number or email can suspend its enrollment verification, for 15 minutes at a time; the legitimate user then sees only "invalid code" (`403 OTP_INVALID_OR_EXPIRED`, `422 OTP_INVALID`) and Health-id cannot tell them to wait. Decide the thresholds per environment, and whether a blocked state may be shown to someone who has proven the code (A21 must not add a disclosure the budget hides).
- **E20 (new). Enrollment assurance and HID recovery** (hid-system N1, N2; recorded by #57, not re-verified in code here beyond #50's cookie change). (a) Whether a person must prove they hold a NIN before enrolling as its holder (proposed: keep public NIN-only enrollment disabled until bound to the registry phone or an assisted check; D5). (b) How a phone-only patient recovers a lost HID (proposed: send the HID to the verified contact at activation and offer lookup by verified contact plus OTP). (c) How long the enrollment cookie may re-display the HID after activation (#50 now expires it at any sign-in, refresh or sign-out on the device; the window itself is unchanged). (d) Whether facility-assisted registration is in launch scope (B9; proposed: no). Health-id's enrollment and recovery screens depend on (a) to (c). **Since `bbc6e89`:** (a) is answered by #84 (ADR-062, a code to the phone on the NIN record) and (d) by #85 (ADR-063, an in-person check at a participating facility, in scope by the owner's decision of 2026-10-14), both merged at `main` `f9dbaf0` and not deployed; Health-id's patient screens for them are on branch `claude/patient-signup-online` (see the note at the top). (b) and (c) are unchanged.

---

## 8. Class F: feature APIs the reference workflows need (roadmap only)

**Status at `bbc6e89`: still open; unchanged.** Each needs a product decision (E16 or scoping) and then a contract (ADR, migration, RLS, audit) before any Health-id screen. None exists at `bbc6e89` (the merged PRs added no feature API; #51's released-results route closes part of B6, not F).

1. **Clinical operations:** appointments and scheduling; triage queue (vitals exist); inpatient/ICU (admissions, beds, transfers; only an `inpatient` encounter type exists); maternity; surgery; radiology/imaging orders and results; cross-facility referrals; telemedicine (only a `virtual` encounter type); ambulance dispatch; blood bank; nursing tasks; dental; procurement; quality and incidents; pharmacy inventory/stock ledger tied to dispensing.
2. **Provider organization:** five-step facility registration (regulatory identity, facility details, agreements, server-side draft with If-Match, document upload intents; today `services/identity-api/src/identity/dto/organization-application.dto.ts:7-31`); nine-step setup progress aggregate; departments; branches (or branches as facilities); staff profile, photo, credential review and presence; shifts/HR; staff notification inbox (only the patient inbox exists); facility reports and trends (de-identified aggregates); provider billing, invoices, insurance claims. (Workforce itself is B3.)
3. **Commercial and platform administration:** subscriptions, trials, payments, reminders, invoices; offers/promotions (price rows have no offer fields, `0043`); admin view of OCR/AI processing (0075 metrics exist); organization directory; support cases; security metrics; legal holds administration (`legal_holds` exists in `0064` with no route); session-event review.
4. **Patient account:** `PATCH /identity/me` with If-Match on `version` and recent authentication; patient-reported history as separate provenance-tagged records; patient share grants.
5. **Migrate:** governed migration projects (batch ingest, patient matching, reconciliation queue, status); project/team lifecycle; global completed-record index (beyond B12); analytics only if wanted.
6. **Outreach:** public worker identity, invitation, OTP and join bound to a facility membership (overlaps B3, E5); visit, screening and referral records with consent and audit.
7. **Offline:** lease, sync, change feed and conflict resolution, only with an offline ADR (PHI at rest on devices, lease expiry, conflict policy).

Sources: all gap-map `BACKEND GAP` rows ("Free periods/offers"; patient profile, history, sharing; provider notifications; appointments through blood bank; Migrate bulk import, global records, projects, intelligence; outreach signup and visits; admin AI processing and billing; GAP-L111 to L119), "Provider onboarding depth", "Facility audit and provider reporting" (reporting half), and the "Reference workflows" findings.

---

## 9. Not included, and corrections applied

- **Frontend-owned decisions, not backend work:** indefinite workspace lock policy; authenticator QR encoder (decided and done: the provider portal draws the staff setup QR code in the page from Identity's `otpauthUri` with `qrcode-generator` 2.0.4, never a remote service; the platform console still shows the setup key and link only); retry and messaging when Lab result access cannot be verified (its staging check is in D3); public outreach marketing copy (its dependency is E5).
- **Corrections from the verification pass, already reflected above:** EHR's `/ehr/me/records` 503 originates in EHR's own interceptor, not Identity (A9); jose errors are already wrapped as `UnauthorizedException` (A4); the queue "status filter" cannot work because `status` is always `accepted` (A2); required-to-rejected specimens are not intended, so no decision is needed (A12); entered-in-error rows already carry their status (A11); the emergency summary returns seven sections, not two, and document list/download plausibly work under break-glass (B1); break-glass is read-only by `0012`, so the document policy question covers reads only (E1); a break-glass grant id can be recovered by replay, so B11 is P2; the platform-admin bypass must become a `kind === 'platform'` check, not be removed (A16); prefer an explicit 403 `ORIGIN_DENIED` over `callback(null, false)`, which would let a disallowed origin through to the handler with only the browser's read block (A19); "local workload mode in production" is unreachable (A5); clinicians can derive dispensing state from the Pharmacy list, but only reliably once A2 ships (B6); the gateway assertion at `verify-container-platform.mjs:206` stays valid (A8).
- **Corrections made at `bbc6e89`:** E14's cause is an unregistered controller, not only the gateway route. A11's patient half was never a live defect: for a patient session, row-level security returns only completed encounters and signed or amended notes, so vitals, diagnoses, prescriptions, lab requests and documents were always empty (`services/ehr-api/database/migrations/0030_patient_self_service.sql:91-102`; `0005_database_authorization.sql:24-44, 350-389`; `services/ehr-api/src/database/database.service.ts:117-122`; `services/ehr-api/database/runtime-grants.sql:20`; hid-system calls it PREC-1), and #52 now names them as withheld. A1 was fixed by a database guard on the source prescription (#48), not by the withdrawal command proposed at `6b49a06`; A1 is rewritten to what that leaves open. Working rule 5 and C1: `main` used 0080 (#48), 0081 (#55) and 0082 (#58), so #47 must take 0083.
- **Frontend work Health-id will do itself (do not do it here):** render the emergency summary's added sections only if E1(c) keeps them, and render vitals only after A11(a) ships (the summary returns uncorrected vitals today, `patient-records.service.ts:139-146`); stop offering Reject on `required` specimens; restrict prescription Cancel/Hold after handoff until A1's remaining parts ship; reuse one OCR publication key per validation; join the Pharmacy list for dispensing status as an interim only (unreliable until A2 or B6's `?sourceEhrPrescriptionId=` ships); offer a `healthcare-operations` access request on Migrate if E3 keeps two purposes; recover a break-glass grant id by replay; show a queue-cap notice until A2 ships; treat 403 `PATIENT_SESSION_REQUIRED` as a changed session after A9 (done since the launch alignment, against `8f3eff1`). **New contract handling once #48 to #61 are deployed:** render the patient summary's `withheld` categories as "not released", not "none", and read `limits`/`truncated` (#52); show released results under each lab request from `GET /lab/ehr-orders/:id/released-results` (#51); render `labHandoff` (`accepted`, `already_accepted`, `failed` with Resend through `.../lab-work-item`, `not_sent`) and treat `409 LAB_HANDOFF_REFUSED` on create as "saved, not in the Laboratory" (#56; A25 for the 502); explain `409 PHARMACY_PRESCRIPTION_NOT_DISPENSABLE`, `409 PHARMACY_PRESCRIPTION_NOT_ELIGIBLE` and the `409 IDEMPOTENCY_CONFLICT` of a resumed prescription (#48); in recovery, keep the latest `challengeId`, do not restart with the account's other identifier within `resendAfterSeconds` (that start gets an id with no code), and word "invalid code" so that a spent budget is covered (#55, E19); the same for enrollment `422 OTP_INVALID` and `429 ENROLLMENT_RATE_LIMITED` (#50, #61); a non-uploader's completion now answers `404` (#59); break-glass may answer `400 INVALID_CONSENT_COMMAND` until `emergency` is seeded (B14); offer Sign out on "No facility assignment" (A10).

## 10. How to report back

For each issue ID, reply with:
1. **PR link**, branch, and the issue IDs it closes (or the parts it closes).
2. **Tests:** the failing-first test names and the failing output on `main`; the passing run; gates run (service typecheck, lint, test; root `npm test`, `npm run verify`; migration rehearsal when applicable) and their results.
3. **Contract changes the frontend must know about:** each route (method, path), request fields and headers, response fields, status codes and error codes added or changed, default behaviour changes (for example A2's `state=open` default), and anything removed or deprecated (with the deprecation release).
4. **Migrations and deploy order:** migration number, lock impact, whether the role bootstrap is needed, and the required order relative to which service deploy.
5. **Docs updated** (file and section), including the `PHASE_3_LAUNCH_DECISIONS.md` row a fix settles.
6. **Open items:** decisions still needed (by E-number and hid-system id), parts not done, risks, and anything in this document you found to be wrong at the time you worked on it (with evidence).
7. For C1 and C2: the release that carries each PR, and the commit deployed per environment once known.

## 11. Resolved since `6b49a06`

Fixed in full (moved out of section 3):

| ID | Fixing PR | What changed at `bbc6e89` | Residuals (not reopened) |
|---|---|---|---|
| A13 (P1). `POST /auth/otp/start` revealed whether an account exists | #55 (migration 0081) | Every start answers the same `202` body before any code is delivered; the cooldown is kept per purpose and keyed identifier in `auth.otp_start_cooldowns`, known or not, so a repeat within `resendAfterSeconds` gets the same `challengeId` either way; delivery runs after the response (`services/identity-api/src/auth/otp.service.ts:45-223`; `services/ehr-api/database/migrations/0081_uniform_recovery_start_cooldown.sql`; `services/identity-api/src/common/after-response-tasks.ts`; `docs/INTERFACE_CONTRACT.md:298-311`). Wrong codes now count against one budget per account across challenges and purposes (`otp.service.ts:259` onward). The same timing fix applies to organization profile completion. | Recorded by #55 (`docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:183-189`): someone who knows both an email and an HID can still learn whether they are one account through the start limits' account bucket (`429`); a known account's start and a wrong code for a live challenge run more statements than an unknown identifier's (a timing difference); delivery is an in-process after-response task, not a durable outbox (lost if the process stops within the 6 s shutdown grace); a restart with the account's other identifier within the cooldown gets an id with no code; anyone can suspend an account's recovery for 15 minutes with five wrong codes (E19). |

Fixed in part (the item stays in section 3, rewritten to what remains):

| ID | Part fixed | Fixing PR | Where |
|---|---|---|---|
| A1 | Pharmacy refuses acceptance of a non-current prescription version and dispensing of a prescription no longer active at the accepted version (`409 PHARMACY_PRESCRIPTION_NOT_ELIGIBLE`, `409 PHARMACY_PRESCRIPTION_NOT_DISPENSABLE`), in the database | #48 (0080) | `0080_pharmacy_source_prescription_guards.sql:52-163`; `pharmacy.service.ts:74-93, 122-137, 199-210` |
| A3 | (a) draft to active (and resume of a never-accepted request) is sent to Lab; (c) a failed handoff can be resent (`POST .../lab-work-item`, or a create replay); (d) a later version of an accepted order answers `409 LAB_ORDER_ALREADY_ACCEPTED`, not `500` | #56 | `lab-requests.service.ts:129-315`; `lab-requests.controller.ts:54-67`; `lab-work-items.service.ts:47-79, 167-222` |
| A5 | OCR maps EHR, Lab and Pharmacy workload refusals to `503 <SERVICE>_SERVICE_AUTH_UNAVAILABLE` and stores them as retryable; the EHR lab handoff never passes Lab's `401` on; per-process JWKS sets | #60, #56, #53 | `ocr-api/src/integrations/owning-service-auth.ts`; `lab-requests.service.ts:72-81`; the three workload verifiers |
| A11 | (b) available documents only; (c) per-section limits, `truncated`, `limits`; (d) per-category read permissions in the emergency summary; (e) per-category audit counts | #52 | `patient-records.service.ts:10-203` |
| A14 | (c) missing or unknown `X-Purpose-Of-Use` answers `400 PURPOSE_OF_USE_REQUIRED` in Identity, EHR, Lab, Pharmacy and OCR | #60 | the five `common/request-context.ts` |
| A15 | Upload completion bound to the intent's creator (other callers `404`) | #59 | `document.service.ts:182-223, 326-333` |
| B6 | Ordering clinician reads released Lab results by EHR order; the history read returns the released view to non-Lab readers | #51 | `lab-executions.controller.ts:32-35`; `lab-executions.service.ts:133-160, 181-187` |
| D4 | Identity task reads `MFA_SECRET_KEY_B64` from the sensitive secret and runs with `MFA_KEY_VERSION=aws-v1` (the secret field itself is operator plan I1, not run) | #49 | `infra/aws/src/hid-regional-stack.ts:451-460, 780-782, 861-898` |

Merged hardening with no item of its own in this hand-off: #50 (enrollment activation budget per enrollment; `hid_enrollment` expired at every staff or patient sign-in, refresh and sign-out; a sign-in is renewable only if refresh could resolve its actor; staging check S4i) and #61 (enrollment contact-code failure budget per recipient). Both are in C2 and E19, and #50 bears on A10.

## Reviewer notes rejected

Each review correction was re-checked against hid-system `6b49a06` (and #47 at `1c18e91`) before it was applied, and the citations below re-checked at `bbc6e89`. All of them were applied except the following, which were rejected or adjusted:

- **C2, "S4a-S4h are all unrun is inferred" (rejected).** The release-readiness doc says it directly: "None of them has been run, because no staging environment exists yet" (`docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:574-576`, covering S1-S6 and now S4a-S4i), and "Nothing here has been deployed" (`:32-33`). C2 keeps the statement, now cited to `:572-594`.
- **A4, example of a leaked 401 detail (adjusted).** "Refresh token reuse detected" (`token.service.ts:307`) is thrown only on `POST /auth/refresh`, which is `@Public` and never reaches the guard. A4 uses a guard-path message instead (`current-staff-context.service.ts:166`). The rule itself was applied as given.
- **A19, "every other Identity `@Public` POST checks Origin" (adjusted).** Every browser-facing one does. The workload-only `POST /identity/service/workloads/document-scanner/authorize` (`identity.controller.ts:49-63`) is `@Public` and checks no Origin; it requires workload authentication instead. A19 lists only the browser-facing routes.
- **C1, contract citation (adjusted).** The 503 behaviour of `GET /auth/session` and refresh is at `#47@1c18e91 docs/INTERFACE_CONTRACT.md:192-198`, not `:189-195` (`:185-190` is the table). The handler lines are `auth.controller.ts:255-261` (refresh) and `:516-523` (`withFacilitySelection`).
- **A11/section 9, P0 or conditional (choice).** The review offered either raising A11(a)/(b) to P0 or making the Health-id rendering conditional. The conditional option was taken, so the counts were unchanged (A11 stayed P1; at `bbc6e89` only (a) remains).

## 12. Clinician self sign-up (ADR-064): Health-id's applicant pages wait on an unmerged backend

**Status (2026-10-15).** Owner decision 2 of 2026-10-14. hid-system's backend is on branch `claude/clinician-self-signup` (head `fa58e2b`, from `claude/signup-base` `274e0bd`; `fc29731` after its review fixes, which Health-id was re-checked against): **not pushed, merged or deployed**. Its migration is `0094_clinician_self_signup.sql` and must be renumbered (`0096` was planned) when it merges; ADR-064 is "Proposed; needs owner approval". Health-id branch `claude/clinician-signup-pages` (not merged) builds the applicant's pages against that branch's code and its contract (P0-P15, the common rules and the rate limits): `/provider/join` and `/provider/join/status`, outside the provider workspace, plus the way in from provider sign-in and provider enrollment, and the platform console's verification queue (A1-A5) at `/admin/clinicians`.

**What Health-id depends on (please keep, or tell Health-id when it changes):**

- The sixteen public routes under `/api/v1/identity/clinician-applications` with the request and answer shapes of the branch's DTOs and the application view `{applicationId, state, version, facility, profession, regulator, licenceNumberHint, submittedAt, expiresAt, decidedAt, decisionCode, accessState, canWithdraw}`; P0 answering `200 {open}` (Health-id offers sign-up only on `{ open: true }`, and reads a 404 as not open).
- The error codes by name: `CLINICIAN_SIGNUP_CLOSED`, `CLINICIAN_APPLICATION_RATE_LIMITED` (Health-id shows no countdown), `CLINICIAN_EMAIL_IN_USE` (only after a correct code), `CLINICIAN_APPLICATION_{SESSION_INVALID, CODE_INVALID, REQUIRES_SIGN_OUT, FACILITY_BUSY, FACILITY_UNAVAILABLE, AUTHENTICATOR_REQUIRED, AUTHENTICATOR_READY, ACCOUNT_INELIGIBLE, ALREADY_OPEN, MEMBERSHIP_EXISTS, ROLE_CONFLICT, LIMIT_REACHED, STATE_INVALID, NOT_FOUND, INVALID, UNAVAILABLE}`, `STAFF_MFA_FACTOR_UNPROVEN`, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `PLATFORM_MAINTENANCE`, the `TURNSTILE_*` codes and the 0088 codes on P5-P9. A 401 on these routes must keep meaning only "this application page or step ended": Health-id never refreshes or signs anyone out on it.
- The Turnstile actions `clinician-application` and `clinician-application-status` accepted on www and staging (D2): on a staff product host or the admin site Health-id links to the main site's page instead of showing a form.
- `403 NO_ACTIVE_FACILITY_MEMBERSHIP` at staff sign-in for an applicant not yet approved (the branch's staff-session re-check): the provider sign-in page keeps Identity's detail and points to the status page.
- The queue (A1-A5, RESULT §4.3): `GET /admin/clinician-applications?state=&cursor=&limit=` answering `{items, nextCursor}` with the summary fields the service maps; `GET /admin/clinician-applications/:applicationId` answering C18's JSON, including `callerHints.{attest,approve,reject}.{allowed,reason}` with the reasons `SELF`, `WORKS_AT_FACILITY`, `STATE`, `STEP1_BY_YOU`, `AUTHENTICATOR_REQUIRED` and `ACCOUNT_INELIGIBLE` (the console chooses its panels by them), `flags`, `rolePermissions` and `attestation.reviewerAccountId` (step 2 is never offered to that administrator); the three commands' bodies and answers with `replayed`, and their codes by name (`CLINICIAN_APPLICATION_{NOT_FOUND, STATE_INVALID, COMMAND_INVALID, SECOND_ADMIN_REQUIRED, AUTHENTICATOR_CODE_INVALID, AUTHENTICATOR_RATE_LIMITED, AUTHENTICATOR_REQUIRED, AUTHENTICATOR_CHANGED, ACCOUNT_INELIGIBLE}`, the 0087 `WORKFORCE_*` codes, `VERSION_CONFLICT`, `STEP_UP_REQUIRED`/`STEP_UP_EXPIRED`). Step 1's `validUntil` is sent as the end of the chosen day in Lagos (`YYYY-MM-DDT23:59:59+01:00`), which the backend's cap (the end of the licence's expiry date in Lagos, and three years) accepts on the licence's own date. An Identity without the queue answers a bare `404 NOT_FOUND`, which the console says as "not deployed".
- Since the branch's review fixes (re-checked at `fc29731`): `403 CLINICIAN_APPLICATION_STAFF_SIGN_IN_REQUIRED` at P7, P9 and P11 (Health-id shows the contract's fixed words, "Your authenticator was reset. Sign in to the provider portal to set it up again, or contact HID support.", and offers no retry); `403 CLINICIAN_APPLICATION_ACCOUNT_INELIGIBLE` on P12 and P13 for a disabled or inactive account (Health-id leaves for the email form, with no Retry) while P14's keeps meaning "this account cannot apply"; `409 CLINICIAN_APPLICATION_AUTHENTICATOR_READY` at P7 read as "an earlier activation went through", so Health-id warns that the recovery codes it may never have shown can't be shown again.
- P7 is the only answer carrying the ten recovery codes; a lost P7 answer loses them (the account works, but has no codes the person saw). A way for an applicant, or an administrator, to issue new recovery codes would close this (0088's `regenerateRecoveryCodes` serves platform sessions only); until then the page tells the person to keep the authenticator app safe and contact HID support.
- P6 requires a six-digit `emailCode` even after the challenge's email proof was used (0088 then answers P5 with `409 MFA_ENROLLMENT_PROOF_COMPLETE`). Health-id recovers through P9 (a new challenge and a new emailed code), which spends one of the 5 challenges per 15 minutes. Accepting P6 without a code once the proof is complete, as staff sign-in's `/auth/mfa/enroll/start` does, would let the page continue directly.

**Deploy order.** Merge the branch; migrations through the previous head, then the renumbered 0094 as the bootstrap's administrator, the role bootstrap, the checks of the branch's release notes, then Identity; then Health-id. Against an Identity without it, Health-id's sign-up page and provider pages say sign-up isn't open yet (P0 is a 404), and the status page says it couldn't load the applications. Keep `clinician_signup_enabled` off until the release checklist's P25 conditions hold; Health-id's administrators' queue, one of them, is built on the same branch and ships with the applicant pages.

**Ask.** Tell Health-id when the branch merges (with the migration's final number and any contract change), when Identity with it is deployed per environment, and when the control is opened.
