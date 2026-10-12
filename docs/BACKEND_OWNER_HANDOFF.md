> - **What this is:** the verified backend hand-off for the hid-system owner. Health-id does not change hid-system (it is read-only from this repository), so every item below is for hid-system's maintainers; Health-id tracks each one by its id in [open questions](./OPEN-QUESTIONS.md).
> - **Basis:** hid-system `main` at `6b49a06` and Health-id `main` at `c880421`, as audited on 2026-10-12. Line citations refer to those commits; Health-id code has moved since.
> - **Since then:** Health-id has addressed the "Frontend impact" items the frontend could: the emergency summary shows its diagnoses, prescriptions, lab requests and documents (listed, never opened) only to a role holding each read permission, and shows no vitals (A11, B1); the clinical record warns that encounter and prescription status changes do not reach Pharmacy or the Laboratory, warns that a draft lab request is never sent to the Laboratory, and offers no change to a lab request the Laboratory may be working on (A1, A3); the Lab and Pharmacy lists say when they reach the 200-item cap (A2); and OCR publication retry reuses one Idempotency-Key held in page memory (B5). Everything after this note is the hand-off as written.

# hid-system backend work required by the Health-id portal

Basis: hid-system `main` at `6b49a06` (merge of #46). Every hid-system citation below is `path:line` at `6b49a06` unless it says `#47@1c18e91`. Health-id citations are prefixed `Health-id:` and refer to Health-id `main` at `c880421`. All claims were traced statically from code and re-checked at `6b49a06`; nothing was run against a database or a deployed stack unless stated.

---

## 0. Context

- **Health-id** (`D-Eminence/Health-id`) is the frontend: the public site, the patient portal, the provider portal (EHR, Laboratory, Pharmacy, Migrate/OCR, Outreach, Registration, Access) and the platform admin console. It is a separate repository. Do not change it from this work.
- Health-id calls **only** the `/api/v1` routes listed in its registry (`Health-id: packages/contracts/src/registry.ts`). A new route, a changed method, a changed request or response field, or a new status/code is a contract change the frontend must be told about (see section 10).
- Health-id uses cookie sessions on the portal origin (`credentials: 'include'`, CSRF header from the cookie, `X-HID-Client` on refresh and logout, `X-Facility-ID` and `X-Purpose-Of-Use` on every facility-scoped call).
- Health-id **never treats a 503 as a session mismatch or sign-out**. A 503 is shown as "temporarily unavailable, try again" and the session is kept. A 401 is treated as "the session may have ended": the staff portal locks the workspace and asks `GET /auth/session`; the patient portal shows sign-in; the admin console reports the session ended for `AUTHENTICATION_REQUIRED`. Therefore the backend must answer **401 only when the presented credential is definitively invalid or ended**, and answer faults with 5xx.
- Health-id **stores no clinical data in the browser** (no localStorage, sessionStorage, IndexedDB, Cache API or service worker; enforced by lint). It cannot work around a missing backend contract by caching state client-side. Anything that must survive a reload has to come from the backend.
- The patient portal and the provider portal are served from **one origin** and share the session cookies Identity sets (`services/identity-api/src/auth/auth.controller.ts:492-506`).

## 1. Working rules

1. Read `CODEX.md`, `docs/README.md`, `docs/DECISIONS.md`, `docs/INTERFACE_CONTRACT.md`, `docs/SECURITY.md` and `docs/CODING_STANDARDS.md` before you start. Accepted ADRs are constraints.
2. **One issue, or one small group named in this document, per PR.** Branch from current `main`. Keep each PR reviewable.
3. **Failing-first tests.** For every defect, first add the test that fails on `main` and show it failing (paste the failing output in the PR), then fix. Use the repo's existing styles:
   - jest specs next to the code (`*.spec.ts`, e.g. `services/identity-api/src/audit/auth-refusal-audit.spec.ts` registers the real `AuditInterceptor`);
   - rollback-only SQL suites in `services/ehr-api/database/tests/*.integration.sql` (the rehearsal picks up every additional suite automatically: `scripts/tuf-staging-migration-rehearsal.mjs:321-325`; the container acceptance lists them explicitly: `scripts/run-container-database-acceptance.sh`);
   - exact-role HTTP verifiers `services/*/scripts/verify-*-runtime.mjs`, each wired into `scripts/tuf-staging-migration-rehearsal.mjs:335-370` (add a new verifier there and in `docs/TUF-STAGING-MIGRATION.md`);
   - gateway and worker checks in `scripts/verify-container-platform.mjs` and `infra/cloudflare/test/frontend-worker.test.mjs`.
4. **Never relax an audit rule, a CHECK constraint, an RLS policy or an authorization check to make a test pass.** Where this document asks for a policy change (for example after a product decision in section 7), make it deliberately in a new migration and an ADR, with tests that pin the new rule.
5. **Forward-only migrations.** Never edit an applied migration (`0001`-`0079` are in the immutable ledger). `0080` is reserved by open PR #47 (section 5); number new migrations from `0081` and renumber on rebase if needed. For each migration update `release/config/components.json` (`last`, `count`, file `sha256`), the accepted map in `scripts/verify-migration-ledger.mjs`, `services/ehr-api/database/runtime-grants.sql` for any new object, the migration range string and suite list in `scripts/run-container-database-acceptance.sh`, and the `docs/MIGRATION_RUNBOOK.md` table (lock impact, order relative to the role bootstrap and to the service deploy). PR #47's diff is a complete example.
6. **Run the gates** before asking for review: each touched service's `npm --prefix services/<svc> run typecheck`, `lint` and `test`; root `npm test` and `npm run verify`; and the migration rehearsal (`scripts/tuf-staging-migration-rehearsal.mjs`) whenever a migration, grant, SQL function or runtime verifier changes.
7. **Update the affected docs in the same PR:** `docs/INTERFACE_CONTRACT.md` (routes, fields, status codes, error codes), `docs/DATABASE.md` (new objects), `docs/DECISIONS.md` (an ADR for every policy change), `docs/MIGRATION_RUNBOOK.md`, and `docs/PHASE_4_STAGE_5_RELEASE_READINESS.md` (release order, staging checks S4*, known limits). Other docs are named per issue.
8. **No deployment, DNS, Cloudflare, AWS, secret, environment-variable or production-data change** without separate, explicit authorization. Code and config changes to `infra/`, `gateway/` and `release/` are in scope as PRs; applying them is not.
9. Keep PHI out of logs, audit `details`, URLs and error `detail` strings. 5xx Problem Details keep their generic `detail` (the ProblemDetailsFilter already does this).
10. If a fix needs a product decision (section 7) that has not been made, do not guess: implement only the parts that do not depend on it, and report the open decision.

## 2. Summary

Counts: A defects 24 (P0 7, P1 7, P2 10); B contracts 13 (P0 3, P1 3, P2 7); C release work 2; D infrastructure 7; E decisions 16; F roadmap 7 groups.

| ID | Cls | Pri | Issue | Blocked on |
|---|---|---|---|---|
| A1 | A | P0 | Pharmacy can dispense a prescription cancelled, held or entered in error in EHR | - |
| A2 | A | P0 | Lab and Pharmacy queues return the 200 oldest work items; new orders disappear | - |
| A3 | A | P0 | EHR lab-request changes never reach Lab (cancel/EiE/hold/priority after acceptance; draft to active) | - |
| A4 | A | P0 | Identity guard answers 401 to database faults; every service relays it | - |
| A5 | A | P0 | Service-to-service (workload) auth failures reach the browser as 401 | - |
| A6 | A | P0 | `POST /auth/refresh` clears cookies on 5xx and after a committed rotation | - |
| A7 | A | P0 | Per-IP rate limits and lockouts key on the load balancer address | - |
| A8 | A | P1 | Gateway replaces every upstream 502/503/504 body and headers | - |
| A9 | A | P1 | Patient-only routes answer 503 (and audit nothing) to a staff sign-in | - |
| A10 | A | P1 | Staff with no active membership: correct password answers 401 | - |
| A11 | A | P1 | Records aggregate: superseded vitals, rejected documents, wrong limit, thin permission and audit | E1 (scope only) |
| A12 | A | P1 | Lab answers 500 to refused specimen and verification transitions | - |
| A13 | A | P1 | `POST /auth/otp/start` reveals whether an account exists | - |
| A14 | A | P1 | Lab/Pharmacy/OCR refusal codes wrong; missing purpose header answers 500 | - |
| A15 | A | P2 | Document upload completion not bound to its creator; generic codes; numbers as strings | - |
| A16 | A | P2 | Platform-admin grant bypasses maintenance mode for staff sessions | - |
| A17 | A | P2 | Audit fidelity: refusal codes missing; Pharmacy/Outreach/Lab-guard refusals unaudited | - |
| A18 | A | P2 | Delegated authorization check grants write scope on a reported read | - |
| A19 | A | P2 | Disallowed CORS origin answers 500 in all six services | - |
| A20 | A | P2 | Authenticated platform step-up answers 401 for a wrong code | - |
| A21 | A | P2 | No `Retry-After` on 429/503; not exposed by CORS | - |
| A22 | A | P2 | Demo-request replay with a different body is accepted | - |
| A23 | A | P2 | Validation errors drop nested field paths (EHR, Lab) | - |
| A24 | A | P2 | Admin principal search/export put PII and reasons in GET query strings | - |
| B1 | B | P0 | Break-glass cannot open the chart; emergency reads are facility-local | E1 |
| B2 | B | P0 | Lab/Pharmacy staff need their own patient grant per patient: empty queues | E2 |
| B3 | B | P0 | Onboarded organizations get only org_admin; no workforce or member API | E4 |
| B4 | B | P1 | OCR needs two grant purposes the portal cannot obtain together | E3 |
| B5 | B | P1 | Failed OCR publication cannot be retried by id; exhausted retries never end | - |
| B6 | B | P1 | No way to see a released Lab result or dispensing from the order or as the patient | E15 (patient part) |
| B7 | B | P2 | Session contract: actor kind, expiries, end reasons, targeted logout | E6 (reasons, expiries) |
| B8 | B | P2 | Registration case list/search and enrollment state | - |
| B9 | B | P2 | No production NIN provider for provider-initiated registration | - |
| B10 | B | P2 | Outreach case list capped at 100 without cursor; campaign writes refused | E5 (writes) |
| B11 | B | P2 | Clinician cannot list their own active grants (break-glass included) | - |
| B12 | B | P2 | No facility OCR job list | - |
| B13 | B | P2 | Documents without an encounter cannot be listed | - |
| C1 | C | - | PR #47 (facility selection per sign-in, ADR-046, 0080): pre-merge fixes and deploy order | A6, A8, E7 |
| C2 | C | - | Merged but unreleased: #39, #41, #42, #46 (and #31, #33-#38, #40, #43-#45) | D3 |
| D1-D7 | D | - | Hosting, Turnstile hosts, staging, secrets/origins, NIN credentials, CSP, access logs | E8, E9 |
| E1-E16 | E | - | Product decisions | - |
| F | F | - | Feature API roadmap (reference workflows with no backend) | E16 |

Suggested order (patient safety first, then sessions): A1, A3, A2; then A4, A6, A5, A7, A8 (one PR each); then C1; then A9, A10, A11, A12, A13, A14; B1-B4 as soon as E1-E4 are decided; the rest in any order.

---

## 3. Class A: defects in existing behaviour

### A1 (P0). Pharmacy can dispense a prescription that EHR has cancelled, put on hold or marked entered in error

**Problem.** Once a prescription has been sent to Pharmacy, a later EHR status change (active to `on_hold`, `cancelled`, `entered_in_error`, `completed`) or a change to `frequency`, `instructions` or `endsOn` is stored in EHR only. Pharmacy keeps its frozen copy and will dispense it. Re-sending the changed prescription is refused (`409 IDEMPOTENCY_CONFLICT`). There is no asynchronous path either: the event dispatcher has no EHR producer.

**Evidence.**
- `services/ehr-api/src/ehr/prescriptions/prescriptions.service.ts:42-49` (TRANSITIONS allow active to on_hold, completed, cancelled, entered_in_error); `:123-160` (`update()` writes EHR only, no `pharmacyApi` call); `:162-215` (`acceptForPharmacy` is the only Pharmacy call).
- `services/pharmacy-api/src/pharmacy/pharmacy.service.ts:84-91` (re-accept matched by `source_ehr_prescription_id`, changed digest gives 409); `:93-106` (insert with `source_status 'active'`); `:151-189` (`dispense()` checks the grant and work-item version only, never the EHR status).
- `services/ehr-api/database/migrations/0023_pharmacy_domain_foundation.sql:61-62` (`source_status`/`status` CHECKs fixed), `:105` (`work_item_events.event_type` CHECK allows only `prescription_accepted`), `:355-363` (work items, events, dispensings are append-only).
- `services/ehr-api/src/ehr/prescriptions/prescriptions.service.ts:34-40` (the projection's `COLUMNS`) carries no Pharmacy state.

**Frontend impact.** Today the provider portal offers Cancel, Hold and Mark entered in error on active prescriptions (`Health-id: apps/patient-web/src/staff/routes/Clinical.tsx:56-62`) with no warning after "Send to Pharmacy", and the Pharmacy screen keeps offering Dispense. Health-id may add an interim restriction, but any API client can still create the divergence. Once fixed: the Pharmacy screen shows the work item as withdrawn and Dispense is refused with a specific code; the clinical record can show the Pharmacy state of a prescription.

**Required fix.**
1. Pharmacy: add an append-only record of source withdrawal/change, preferably a new table (for example `pharmacy.work_item_source_changes`: work item, prescription id and version, change kind `withdrawn|changed`, actor, membership, reason, idempotency key, correlation id) with RLS through `pharmacy.context_allows`, an insert-only trigger and runtime grants. Do not widen the `0023:105` CHECK unless you decide to in an ADR.
2. Pharmacy: internal command `POST /api/v1/pharmacy/work-items/withdraw-ehr-prescription` (`@InternalCaller('ehr-api')`, the user's request delegated as for `accept-ehr-prescription`, idempotent per prescription id and version). Gate it with `@RequirePermissions('ehr.prescription.write')`, which the clinician making the EHR change already holds (the EHR update route requires it, `prescriptions.controller.ts:44`; the Pharmacy guard checks required permissions against the Identity actor's facility permissions, `pharmacy-security.guard.ts:61-65`), not with a pharmacist permission. Authorize the patient on the EHR caller identity and the **requesting clinician's** direct-care `write_records` grant for the patient (the person cancelling may not be the prescriber). A prescription with no work item answers `200 { workItem: null }` (nothing to withdraw); EHR does not record handoffs, so it calls this on every qualifying change.
3. Pharmacy: `dispense()` refuses with **`409 PHARMACY_SOURCE_WITHDRAWN`** when a source change exists for the work item, checked inside the same SERIALIZABLE transaction. Add the same check to the database-side dispensing validation (`pharmacy.validate_dispensing`, last redefined at `0077_fail_closed_session_guards_and_ocr_worker_leases.sql:729`) in a new migration, as defence in depth.
4. EHR: in `PrescriptionsService.update()`, when the status leaves `active` or a dispensing field changes, call the Pharmacy command after `lock()` and the transition check (`prescriptions.service.ts:138-141`) and before the `UPDATE` (`:143`), so it runs **before** the EHR change commits (fail-safe order: a withdrawal without the EHR change still prevents dispensing; retries converge through the idempotency key). If Pharmacy cannot be reached, refuse the EHR change with **`503 PHARMACY_SERVICE_UNAVAILABLE`** and leave the row unchanged. Never let EHR and Pharmacy diverge silently.
5. Decide and document what happens after a withdrawal when the prescription becomes dispensable again (`on_hold` to `active`, or a changed frequency/instructions/end date): a new handoff of the new version (the one-work-item-per-prescription rule then needs an ADR), or refuse with `409 PRESCRIPTION_WITHDRAWN_FROM_PHARMACY` and require a new prescription.
6. Expose Pharmacy state on the EHR prescription projection, e.g. `pharmacy: { workItemId, dispensed, reversed, withdrawn } | null`, or document that clients join `GET /pharmacy/work-items` on `sourceEhrPrescriptionId`.

**Acceptance tests (failing first).**
- Pharmacy runtime verifier (`services/pharmacy-api/scripts/verify-pharmacy-runtime.mjs`): accept a prescription, record a withdrawal through the internal route, `POST /pharmacy/work-items/:id/dispensings` answers 409 `PHARMACY_SOURCE_WITHDRAWN` (201 today); replaying the withdrawal is idempotent.
- New SQL suite (`pharmacy-source-withdrawal.integration.sql`): a dispensing insert after a source change is refused by the database; the source-change table refuses UPDATE and DELETE; RLS hides another facility's rows.
- `ehr-api` spec (`prescriptions.service.spec.ts`): `update()` from `active` to `cancelled` calls the Pharmacy withdrawal with key `ehr-prescription:<id>:<version>`; Pharmacy 503 leaves the EHR row unchanged and answers 503; a draft prescription never calls Pharmacy.

**Constraints.** Work items, events, dispensings and reversals stay insert-only; one dispensing per work item; reversal unchanged; existing idempotency keys unchanged; EHR status transitions unchanged except where an ADR says otherwise.

**Docs.** `INTERFACE_CONTRACT.md` (prescription lifecycle, new code), `PRODUCT.md:161`, `DATABASE.md`, `PHARMACY_EXTRACTION_INVENTORY.md`, an ADR.

Source findings: BE-PHARMACY-CANCEL-NOT-PROPAGATED; "Lab request changes after Lab accepts - prescription analog".

### A2 (P0). Lab and Pharmacy work queues return the 200 oldest work items; newer orders disappear

**Problem.** Both list routes return the oldest 200 rows, finished or not, with no cursor and no truncation signal. Work items are insert-only and their `status` is always `accepted`, so finished work never leaves the list. Once a reader can see 200 items (the cap applies after RLS, see B2), every newer order is invisible.

**Evidence.**
- `services/lab-api/src/lab/lab-work-items.service.ts:102-117`, the query at `:113` (`order by w.accepted_at asc,w.id asc limit 200`), response `{ items }` only.
- `services/pharmacy-api/src/pharmacy/pharmacy.service.ts:127-136`, `:130` (same order and cap).
- `services/ehr-api/database/migrations/0018_lab_work_items.sql:25` and `0023_pharmacy_domain_foundation.sql:62` (`status` CHECK allows only `accepted`, so a plain status filter cannot work).
- Lab `get()` (`lab-work-items.service.ts:91-100`) omits `testName`, `accessionId`, `accessionNumber` and `specimenStatuses`, which `list()` returns (`:114-115`).

**Frontend impact.** The Laboratory and Pharmacy pages render the list with no notice (`Health-id: apps/patient-web/src/staff/routes/Operations.tsx:452-470`, `:505-516`). New orders silently never appear. Once fixed: the default list shows open work, the portal pages with `nextCursor`, and offers "Show completed".

**Required fix.**
- Add a derived open state and filter on it. Lab: open while there is no accession, or any specimen or result of the work item is not finished (no released current result for each execution). Pharmacy: open while there is no dispensing (and, after A1, no source withdrawal).
- `GET /api/v1/lab/work-items` and `GET /api/v1/pharmacy/work-items` accept `state=open|all` (default **`open`**), `limit` (1-200, default 200) and an opaque keyset `cursor`; return `{ items, nextCursor }`. Lab: order by an explicit priority rank (`stat`, `asap`, `urgent`, `routine`), then `accepted_at, id` ascending. `priority` is text with those four values (`0018_lab_work_items.sql:26`), so ordering by the column itself gives the alphabetical `asap, routine, stat, urgent`; the cursor must carry the rank. Pharmacy: `accepted_at, id` ascending. Reuse EHR's cursor rules (`services/ehr-api/src/ehr/shared/clinical-context.ts:15-30, 143`): a foreign or malformed cursor answers `400 INVALID_CURSOR`.
- Each item carries its derived `open` flag. Lab `get()` returns the same projection as `list()`.
- Add an index in a new migration only if `EXPLAIN` on 10k synthetic rows shows a sequential sort.

**Acceptance tests (failing first).** In `verify-lab-runtime.mjs` and `verify-pharmacy-runtime.mjs`: seed 201 accepted work items visible to the reader, finish the oldest one; the newest open item is on page 1 (absent today); `state=all` walks all 201 through `nextCursor` with no duplicate; a tampered cursor answers 400 `INVALID_CURSOR`; Lab `GET /lab/work-items/:id` returns `testName` and `specimenStatuses`. Unit specs for cursor encoding.

**Constraints.** Response stays a superset (`items` unchanged in shape); RLS and permission checks unchanged; list audit rows unchanged (`pharmacy.work-item.list` keeps `returnedCount`).

**Docs.** `INTERFACE_CONTRACT.md` (Lab and Pharmacy queues), `LAB_EXTRACTION_INVENTORY.md`, `PHARMACY_EXTRACTION_INVENTORY.md`.

Source findings: LABPHARM-01; "Lab and Pharmacy work queues - 200 oldest cap" (verifier correction applied: no status filter is possible); BE-LAB-PHARM-QUEUE-SHAPE.

### A3 (P0). EHR lab-request changes never reach Lab

**Problem.** (a) A lab request created as `draft` and later PATCHed to `active` never creates a Lab work item. (b) Cancelling, holding or marking entered in error a request that Lab already accepted changes EHR only; Lab keeps working it and can release a result for a withdrawn order. (c) `create()` commits the EHR row and only then calls Lab: a Lab refusal (for example 403 `PERMISSION_DENIED` when the clinician lacks `lab.work-item.accept`) reaches the browser as an error although the order exists, and there is no route to retry the handoff for another user or after the 24 h idempotency window. (d) `update()` also changes `priority` and `clinical_information` after Lab has accepted (for example routine to stat); Lab never learns. A re-handoff of that newer version cannot succeed either: Lab's replay lookup matches the order id **and** version, while the table allows one work item per order, so the insert hits the unique key (23505) and answers 500 after the retry.

**Evidence.**
- `services/ehr-api/src/ehr/lab-requests/lab-requests.service.ts:48-55` (TRANSITIONS), `:94-129` (`create()`, Lab called only when active, `:124-126`, after commit), `:131-146` (`accept()`, key `ehr-order:<id>:<version>`), `:148-184` (`update()`, no Lab call; it accepts `priority` and `clinicalInformation`, `:155`, and writes them, `:167-170`).
- `services/ehr-api/src/integrations/lab-api.service.ts:20` (Lab status and code relayed).
- `services/lab-api/src/lab/lab-work-items.controller.ts:13-26` (accept, list, get only; no withdraw); `services/lab-api/src/lab/lab-work-items.service.ts:42-48` (replay lookup by key, or by order id and version at `:46-47`); `services/ehr-api/database/migrations/0018_lab_work_items.sql:50` (`unique(source_ehr_order_id)`), `:136` (immutable work items); `docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:748` (unique conflicts answer 500 after one retry).

**Frontend impact.** The portal withholds "Activate" on drafts and offers no change on active requests (`Health-id: apps/patient-web/src/staff/routes/Clinical.tsx:69-73`), so clinicians cannot activate a draft or cancel an active lab order at all. Once fixed, the portal can offer Activate and Cancel and show the Lab handoff outcome.

**Required fix.**
- Add `POST /api/v1/ehr/patients/:patientId/encounters/:encounterId/lab-requests/:requestId/lab-work-item` mirroring the prescriptions route (`prescriptions.controller.ts:51-66`): idempotent handoff of an active request at its current version.
- On draft to active in `update()`, perform the same idempotent handoff. Both `create()` and `update()` return `labWorkItem` plus `labHandoff: { status: 'accepted' | 'failed', code? }` instead of throwing after the commit (or move the handoff to a transactional outbox with retry; document which).
- Lab: append-only source-withdrawal record and internal `POST /api/v1/lab/work-items/withdraw-ehr-order` (`@InternalCaller('ehr-api')`, idempotent per order id and version). Accession, specimen, execution, result entry, verification and release refuse with **`409 LAB_SOURCE_WITHDRAWN`** once withdrawn. EHR calls it before committing cancel, entered-in-error or on-hold of an accepted request; Lab unreachable gives **`503 LAB_SERVICE_UNAVAILABLE`** with the EHR row unchanged. Alternative if you choose not to propagate: refuse those transitions with **`409 LAB_REQUEST_IN_LAB`** once Lab has accepted (clinicians then cannot cancel; record the choice in an ADR).
- Priority and clinical-information changes after acceptance: refuse them with **`409 LAB_REQUEST_IN_LAB`** once Lab has accepted, or propagate them to Lab (append-only, as for withdrawal). Either way, Lab's accept route answers **409** (for example `LAB_ORDER_ALREADY_ACCEPTED`), not 500, when a work item already exists for an earlier version of the same order.

**Acceptance tests (failing first).** `ehr-api` specs with a Lab fake: draft to active creates exactly one work item and a replay creates none; Lab 403 on create answers 201 with `labHandoff.status 'failed'`, then the handoff route succeeds; cancel after acceptance calls the withdrawal and a Lab 503 leaves EHR unchanged; a priority change after acceptance answers 409 `LAB_REQUEST_IN_LAB` (or reaches Lab, per your choice). `verify-lab-runtime.mjs`: after a withdrawal, accessioning answers 409 `LAB_SOURCE_WITHDRAWN`; accepting version 2 of an order already accepted at version 1 answers 409 (500 today). SQL suite: withdrawal rows are insert-only and RLS-scoped.

**Constraints.** Lab key format `ehr-order:<id>:<version>` and the exact `requestedAt` (#44) unchanged; Lab records stay append-only.

**Docs.** `INTERFACE_CONTRACT.md`, `LAB_EXTRACTION_INVENTORY.md`, `PHASE_4_STAGE_5_RELEASE_READINESS.md` (Stage 9 known limit "Lab orders created on the EHR while Lab acceptance failed have no work item" at `:754` closed).

Source findings: "Lab draft activation"; "Lab request changes after Lab accepts"; BE-LAB-ORDER-HANDOFF; LAB-EHR-01.

### A4 (P0). Identity's guard answers 401 `AUTHENTICATION_REQUIRED` to database and dependency faults; every service relays it

**Problem.** `SecurityGuard.canActivate` maps every error that is not a `DomainProblem` to 401. Raw database errors reach it from the runtime-control check (any SQLSTATE other than 55000, a statement timeout, a pool connect timeout with no code, grant or function drift 42501/42883), from session verification (`assertSessionActive`), from actor resolution and from the platform assurance read. When the denial audit insert in the catch still succeeds (a partial fault), the user gets 401. EHR, Lab, Pharmacy and OCR authenticate every request through Identity's `/auth/service-session` (and authorize patients through `/identity/service/authorization/check`); Outreach authenticates through `/identity/outreach/authorize` (`services/identity-api/src/identity/identity.controller.ts:65-85`). All of these pass through the same guard, so the 401 reaches every portal page. Outreach's own control check rethrows raw errors (500). EHR fixed its control check in #46 but its guard catch still maps other errors to 401.

**Evidence.**
- `services/identity-api/src/auth/security.guard.ts:51-200` (try covers verify, runtime controls, platform assurance), `:139-197` (denial audit), `:198-199` (non-DomainProblem to 401), `:263-277` (`controlEnabled` maps only 55000; `:275` rethrows), `:234` (`readPlatformAssurance`).
- `services/identity-api/src/auth/token.service.ts:394-410` (`verify`), `:635-672` (`assertSessionActive`, plain query), `:839-852` (`resolveActor`), `services/identity-api/src/auth/current-staff-context.service.ts:32-51`.
- `services/identity-api/src/audit/audit.service.ts:57-71` (audit insert failure gives 503, so only partial faults give 401).
- `services/ehr-api/src/integrations/identity-api.service.ts:69-81`, `services/lab-api/src/auth/lab-remote-security.guard.ts:29`, `services/pharmacy-api/src/auth/pharmacy-security.guard.ts:48-50`, `services/outreach-api/src/auth/outreach-security.guard.ts:61-63` (status and code relayed); `services/outreach-api/src/auth/outreach-security.guard.ts:97-103` (raw rethrow, 500).
- `services/ehr-api/src/auth/remote-security.guard.ts:76-90` (fixed control check), `:50-53` (catch still maps to 401).

**Frontend impact.** On a partial database fault every user looks signed out: the patient portal shows sign-in (`Health-id: apps/patient-web/src/session.tsx:85-87`), the staff portal locks and ends the workspace when `/auth/session` also answers 401, the admin console reports the session ended (`Health-id: apps/patient-web/src/admin/api.ts:176-189`). Once fixed: users see "temporarily unavailable" and keep their session.

**Required fix.**
- `controlEnabled`: every error other than 55000 `PLATFORM_CONTROL_DISABLED:` becomes `DomainProblem(503, 'PLATFORM_CONTROL_UNAVAILABLE')`, exactly as `remote-security.guard.ts:84-89`. Same change in `outreach-security.guard.ts:97-103`.
- `canActivate` catch, in this order, still recording the denial audit first:
  1. any `DomainProblem`, whatever its status: rethrow unchanged. `DomainProblem` extends `HttpException` (`services/identity-api/src/common/problem.ts:23`), so a rule keyed on "HttpException below 500" would rewrite the guard's own 503 `PLATFORM_MAINTENANCE` (`security.guard.ts:252`) and 503 `PLATFORM_CONTROL_UNAVAILABLE` (`:273`) into `AUTHENTICATION_UNAVAILABLE`, contradicting test (a) below;
  2. `UnauthorizedException`: `DomainProblem(401, 'AUTHENTICATION_REQUIRED')` with the generic detail "Valid authentication is required" (as today, `:199`). Do not pass it through as an `HttpException`: its message is internal (for example "Staff account or facility membership is inactive", `current-staff-context.service.ts:152`) and would become the 401's `detail`;
  3. any other `HttpException`: rethrow unchanged;
  4. any non-HTTP error (pg errors, pool timeouts, unknown errors, including from `readPlatformAssurance`): **`DomainProblem(503, 'AUTHENTICATION_UNAVAILABLE')`**.
  Every deliberate refusal on this path is already an `UnauthorizedException` or a `DomainProblem` (`token.service.ts:397-407, 604-616, 669`; `current-staff-context.service.ts:47, 71, 74, 152, 201`), so no real refusal is reclassified.
- Apply the same rule to the EHR and OCR guards (`services/ehr-api/src/auth/remote-security.guard.ts:50-53`, `services/ocr-api/src/auth/remote-security.guard.ts:44-48`).
- `verify()`/`verifyOidc()` wrap every `jwtVerify` failure, JWKS fetch failures included, into `UnauthorizedException` (`token.service.ts:402`, `:562`). In OIDC mode, distinguish JWKS availability errors (jose `ERR_JWKS_TIMEOUT`, fetch failures) and answer 503 `AUTHENTICATION_UNAVAILABLE`.

**Acceptance tests (failing first).** Guard spec next to `security.guard.ts`: (a) `select platform.control_enabled` rejects with `{code:'57014'}`, then with a codeless `Error('timeout exceeded when trying to connect')`: 503 `PLATFORM_CONTROL_UNAVAILABLE` and one denied audit row (401 today); (b) `assertSessionActive` query rejects with `{code:'08006'}`: 503 (401 today); (c) `verify` rejects with `UnauthorizedException`: still 401 `AUTHENTICATION_REQUIRED` with the generic detail; (d) platform route where `readPlatformAssurance` rejects: 503; (e) audit insert also fails: 503 (unchanged); (f) maintenance on: 503 `PLATFORM_MAINTENANCE` passes through unchanged. Outreach guard spec: control fault gives 503 (500 today). EHR and OCR guard specs: a raw (non-HTTP) error from `authenticateRequest` gives 503 (401 today). The EHR Identity integration already wraps non-HTTP errors as 503 `IDENTITY_SERVICE_UNAVAILABLE` (`services/ehr-api/src/integrations/identity-api.service.ts:68-81`), so this test fails first only when the mock rejects `authenticateRequest` itself with a raw error; say so in the spec.

**Constraints.** Real authentication failures stay 401 with the same code; audit-before-answer behaviour unchanged; platform admin exemption handled in A16.

**Docs.** `INTERFACE_CONTRACT.md` (error codes), `SECURITY.md`.

Source findings: ID-GUARD-FAULT-401, ID-GUARD-401-ON-FAULT, BE-IDENTITY-CONTROL-FAULT-401, "Refused staff cookie sign-out answers 503 - guard DB fault" (verifier corrections applied: jose errors are already wrapped; the rule is "DomainProblem unchanged, Unauthorized to a generic 401, other HttpException unchanged, non-HTTP errors to 503").

### A5 (P0). Service-to-service authentication failures reach the browser as 401

**Problem.** When a service's own workload credential is rejected or Identity cannot fetch the workload JWKS, Identity answers 401 (or 403 `ORIGIN_DENIED` when the delegated-read fallback runs), after the user's own token was already accepted. Callers relay that 401 to the browser, which reads it as a possibly ended user session.

**Evidence.** `services/identity-api/src/auth/workload-auth.service.ts:65-94` (`authenticateService`; `:89` wraps every `jwtVerify` failure, remote JWKS included, into `UnauthorizedException`; `:92` answers a subject mismatch with a plain `ForbiddenException`, which reaches callers as the generic 403 `ACCESS_DENIED`); `services/identity-api/src/auth/security.guard.ts:304-316` (delegated read swallows any workload error and falls back to the Origin/CSRF check, giving 403 `ORIGIN_DENIED`); callers relay unchanged: `services/lab-api/src/auth/lab-remote-security.guard.ts:22,29`, `services/pharmacy-api/src/auth/pharmacy-security.guard.ts:48-50`, `services/outreach-api/src/auth/outreach-security.guard.ts:58-63`, `services/ehr-api/src/integrations/identity-api.service.ts:68-81`; EHR's OCR caller guard answers 401 `INVALID_WORKLOAD_IDENTITY` (`services/ehr-api/src/auth/ocr-internal-caller.guard.ts:14-47`), which OCR relays. Lab and Pharmacy verify their own internal callers the same way: a JWKS fetch failure is 401 `INVALID_WORKLOAD_IDENTITY` at the source (`services/lab-api/src/auth/lab-workload-identity.service.ts:21`, `services/pharmacy-api/src/auth/pharmacy-workload-identity.service.ts:33`, `services/ehr-api/src/auth/ocr-internal-caller.guard.ts:47`). `docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:751` records that such a 401 ends an OCR publication as terminal.

**Frontend impact.** A workload misconfiguration or JWKS outage makes the staff portal refresh, lock and re-check the session on every request instead of showing an outage. Once fixed: a 503 "temporarily unavailable".

**Required fix.**
- Identity: give workload failures distinct codes: `401 WORKLOAD_AUTHENTICATION_FAILED` for a bad token, `503 WORKLOAD_IDENTITY_UNAVAILABLE` for JWKS fetch/timeout, and `403 WORKLOAD_CALLER_DENIED` (the code Lab, Pharmacy and EHR already use) for the subject mismatch at `workload-auth.service.ts:92`.
- In `delegatedSafeBrowserRequest`, rethrow **only** the availability error (`503 WORKLOAD_IDENTITY_UNAVAILABLE`) instead of falling back. Every other workload failure keeps today's fail-closed fallback to the Origin/CSRF check (`security.guard.ts:313-315`).
- Lab, Pharmacy and EHR's OCR caller guard: answer a JWKS fetch/timeout failure with `503 WORKLOAD_IDENTITY_UNAVAILABLE` at the source (keep 401 `INVALID_WORKLOAD_IDENTITY` for a bad token). This closes the `:751` known limit (a JWKS outage no longer makes an OCR publication terminal); update that line.
- Callers (`packages/api-client/src/identity.ts` request handling and each service's translate/guard): map a peer 401/403 carrying a workload code (`INTERNAL_SERVICE_AUTH_REQUIRED`, `INVALID_WORKLOAD_IDENTITY`, `WORKLOAD_*`) to **`503 <PEER>_SERVICE_AUTH_UNAVAILABLE`**; relay 401 only when Identity rejected the user's own credential.

**Acceptance tests (failing first).** Per service unit spec: peer answers 401 `{code:'INVALID_WORKLOAD_IDENTITY'}`, browser receives 503; an expired user token still yields 401. Identity spec: JWKS fetch rejects, a delegated GET answers 503, not 403 `ORIGIN_DENIED`; a bad workload token on a delegated GET still falls back to the Origin/CSRF check (403 `ORIGIN_DENIED` without Origin, unchanged); a subject mismatch answers 403 `WORKLOAD_CALLER_DENIED` (403 `ACCESS_DENIED` today). Lab, Pharmacy and EHR OCR-caller specs: a JWKS fetch rejection answers 503 `WORKLOAD_IDENTITY_UNAVAILABLE` (401 today).

**Constraints.** Workload authentication strictness unchanged; local-secret mode stays refused in production (`config/environment.ts:212`).

Source findings: BE-WORKLOAD-401-PASSTHROUGH, ID-WORKLOAD-OUTAGE-STATUS (the "local mode in production" part is unreachable and dropped).

### A6 (P0). `POST /auth/refresh` clears the session cookies on any failure, including 5xx and after a committed rotation

**Problem.** One `try` covers the rotation (which commits inside `TokenService.refresh`) and a separate success-audit insert; the `catch` clears cookies for every error. A transient fault before rotation (e.g. in actor resolution) signs the user out with a 500. An audit failure after the commit answers 503 without the rotated cookies. Without the gateway, that 503 carries the cookie-clearing `Set-Cookie` headers and the user is signed out. Behind the gateway, A8 drops those headers, so the browser keeps the spent refresh token, and the next refresh finds a rotated token and revokes the whole session family as reuse.

**Evidence.** `services/identity-api/src/auth/auth.controller.ts:214-244` (one try at `:234-243`, `clearCookies` in the catch); `services/identity-api/src/auth/token.service.ts:333-362` (rotation commit), `:280-287` (reuse revocation of the family); `services/identity-api/src/audit/audit.service.ts:57-71` (audit failure is 503). Platform refresh shares the "clear on any error" half: `services/identity-api/src/auth/platform-auth.controller.ts:101-106`. Still present on #47@1c18e91: both the first try (`auth.controller.ts:242-247`, around the rotation) and the third try (`:262-270`, around the success audit) clear cookies on any error, 5xx included.

**Frontend impact.** A short database fault signs users out of every tab; a later refresh can revoke the sign-in family. Once fixed: a failed refresh leaves the user signed in and the client retries.

**Required fix.** Clear cookies only on a definitive refusal (`UnauthorizedException`, or a `DomainProblem` below 500). `SESSION_CLIENT_MISMATCH` is excluded: it is thrown before the `try` (`auth.controller.ts:232`) and must keep the other app's cookies, as it does today. On 5xx leave cookies alone. Record the `auth.refresh` success audit **inside the rotation transaction** (pass the client into `TokenService.refresh` and use `recordWithClient`), so a rotation either commits with its audit and returns its new cookies, or rolls back. Platform refresh: do not clear cookies on 5xx.

**Acceptance tests (failing first).** Controller spec: (a) `auth.refresh` rejects with a pg error: 5xx and no clearing `Set-Cookie`; (b) the audit insert fails: the rotation rolls back (the old refresh token still refreshes once) and no cookie is cleared; (c) `UnauthorizedException` still clears. Extend `verify-session-sign-out-runtime.mjs` (or a new refresh verifier) with an audit-failure injection: a second refresh after the failure succeeds and no family is revoked.

**Constraints.** Reuse detection and family revocation unchanged; `X-HID-Client` kind check unchanged.

Source findings: ID-REFRESH-COOKIES.

### A7 (P0). Per-IP rate limits and lockouts key on the load balancer address, not the client

**Problem.** The Cloudflare worker deletes `cf-connecting-ip`, `x-forwarded-for` and `x-real-ip` and sets no client-IP header; nginx overwrites `X-Forwarded-For` with its peer (an ALB node); Identity trusts the whole VPC CIDR. `request.ip` is therefore an ALB node address for every user, and every per-IP limit becomes platform-wide: OTP start, patient enrollment start and contact, organization application and completion quotas, provider CAC quota, and platform MFA failures (19 per 15 minutes locks out every administrator). The WAF rate rule aggregates by source IP, which is a Cloudflare egress address. Audit `source_ip` records the ALB.

**Evidence.** `infra/cloudflare/src/frontend-worker.mjs:128-160` (deletes at `:132-135`); `gateway/proxy-headers.conf:7`; no `real_ip` configuration in `gateway/nginx.conf.template`; `services/identity-api/src/main.ts:19-20` and `infra/aws/src/hid-regional-stack.ts:750` (TRUST_PROXY_CIDRS = VPC); `infra/aws/src/hid-regional-stack.ts:1209-1213` (WAF `aggregateKeyType: 'IP'`). IP-keyed limits (all under `services/identity-api/src/`): `auth/otp.service.ts:68,106`; `identity/patient-enrollment.service.ts:59-63,175-176`; `identity/organization-applications.service.ts:62-65`; `identity/organization-profile-completion.service.ts:52-54`; `identity/provider-enrollment.service.ts:68`; `auth/mfa/mfa.service.ts:55,507-517`. `scripts/verify-container-platform.mjs:209` asserts the current overwrite.

**Frontend impact.** One person (or attacker) exhausting a limit blocks everyone: patients see "too many requests" on OTP and enrollment, administrators are locked out of MFA. No frontend fix is possible.

**Required fix.** (1) Worker: read `cf-connecting-ip` before deleting it and always set its own `x-hid-client-ip`, overwriting any client-supplied value. (2) Gateway: `proxy_set_header X-Forwarded-For $http_x_hid_client_ip;` (or `real_ip_header X-HID-Client-IP` with `set_real_ip_from` limited to the ALB/VPC range), and never pass an inbound `x-hid-client-ip` that did not come through the ALB (ALB ingress is already restricted to the worker by the WAF origin-secret rule, `hid-regional-stack.ts` around `:1195-1203`). (3) WAF: custom-key or forwarded-IP aggregation on `x-hid-client-ip`. (4) Keep `TRUST_PROXY_CIDRS` = VPC. Replace, do not delete, the `verify-container-platform.mjs:209` assertion: assert the chain is overwritten from the trusted header.

**Acceptance tests (failing first).** `infra/cloudflare/test/frontend-worker.test.mjs`: inbound `cf-connecting-ip: 203.0.113.9` and client-sent `x-hid-client-ip: 1.1.1.1` are forwarded with `x-hid-client-ip: 203.0.113.9`. Gateway container check: two different `x-hid-client-ip` values reach a stub upstream as two different `X-Forwarded-For`. Infra test for the WAF rule key. Staging (D3): two clients each start 5 OTPs and neither is limited by the other.

**Constraints.** No caller-controlled IP may ever be trusted; the origin-secret rule stays. Applying the worker, gateway image and WAF change is a deployment (needs separate authorization).

**Docs.** `PLATFORM_CONTAINER_ACCEPTANCE.md`, `AWS_DEPLOYMENT_ARCHITECTURE.md`, `SECURITY.md`.

Source findings: GW-CLIENT-IP.

### A8 (P1). The gateway replaces every upstream 502/503/504 with `UPSTREAM_UNAVAILABLE`, dropping code, detail and headers

**Problem.** `proxy_intercept_errors on` makes nginx apply `error_page 502 503 504` to upstream responses too, so every application 503/502 becomes a fixed 503 `UPSTREAM_UNAVAILABLE` (a 502 also becomes 503), losing the domain code, `Set-Cookie`, `Retry-After` and the correlation header. About 50 distinct 5xx codes are affected, e.g. `PLATFORM_MAINTENANCE`, `PLATFORM_CONTROL_UNAVAILABLE`, `MFA_UNAVAILABLE`, `TURNSTILE_UNAVAILABLE`, `EMERGENCY_CONTACT_DELIVERY_UNAVAILABLE`, `EMERGENCY_CONTACT_VERIFICATION_UNDELIVERABLE` (502), `QOREID_DISABLED`, `NIN_PROVIDER_DEFERRED`, `INTEGRATION_PAUSED`, `VERIFICATION_EVIDENCE_UNAVAILABLE`. It contradicts `docs/INTERFACE_CONTRACT.md:249`. It also defeats PR #47's refresh design (C1).

**Evidence.** `gateway/proxy-headers.conf:14`; `gateway/nginx.conf.template:23-28` and `:30-50`; `docs/PLATFORM_CONTAINER_ACCEPTANCE.md:117` (records it as intended); `scripts/verify-container-platform.mjs:205-206` (asserts only the `error_page` line). Example emitters: `services/identity-api/src/patient-safety/emergency-contact.service.ts:141,171`, `auth/mfa/mfa-secret-protector.ts:82`, `auth/security.guard.ts:252`, `identity/organization-applications.service.ts:148,221`, `integrations/integration-runtime.service.ts:65`.

**Frontend impact.** These branches never fire in a gateway deployment: `Health-id: apps/patient-web/src/routes/AccountSafety.tsx:89`, `admin/problems.ts:31,57,71`, `admin/Organizations.tsx:22,24,26`. While emergency-contact delivery is disabled a patient is told the platform is down; while `MFA_SECRET_KEY_B64` is unmapped (P3) admin sign-in looks like an outage. Once fixed: the specific messages appear; no frontend change needed.

**Required fix.** Remove `proxy_intercept_errors on;` (or set `off`). nginx still applies `error_page` to errors it generates itself (upstream refused, reset, timed out), so an unreachable service still answers `UPSTREAM_UNAVAILABLE`. Add an assertion in `scripts/verify-container-platform.mjs` that interception is off; update `PLATFORM_CONTAINER_ACCEPTANCE.md:117`.

**Acceptance tests (failing first).** Gateway container test with a stub upstream: (a) stub answers 503 `application/problem+json` `{code:'EMERGENCY_CONTACT_DELIVERY_UNAVAILABLE'}` with `Set-Cookie`, `Retry-After` and `X-Correlation-ID`; the client receives the same status, body and headers (fails today); (b) stub answers 502, client gets 502; (c) upstream port closed, client gets 503 `UPSTREAM_UNAVAILABLE` (passes today and after).

**Constraints.** Gateway-generated failures stay bounded Problem Details; upstream 5xx `detail` stays generic.

Source findings: GW-503-INTERCEPT, GW-503-MASK.

### A9 (P1). Patient-only routes answer 503 (and record nothing) to a staff sign-in, in Identity and in EHR

**Problem.** Patient-only routes are `@PatientAllowed() @FacilityOptional()` and refuse a non-patient in the handler with 403 `PATIENT_SESSION_REQUIRED`. The `AuditInterceptor` then records the failure as `api.*` / `http-request` with a staff subject and no facility; `assertActorFacility` rejects a staff row without a facility unless it is an `auth.*` event and throws `ServiceUnavailableException`, so the client gets 503 `DEPENDENCY_UNAVAILABLE` and no audit row is written. #42 fixed only `@AuditSessionEvent` routes. EHR's `GET /ehr/me/records` has the same defect in EHR's own interceptor (EHR refuses staff before calling Identity).

**Evidence.**
- Identity: `services/identity-api/src/auth/patient-self.service.ts:8-13`; `auth/patient-self.controller.ts:9-12` (class decorators), routes `:16-51` and `:53-61`; `consent/consent.controller.ts:18-26, 49, 61, 74`; `patient-safety/emergency-contact.controller.ts:14-17`; `patient-safety/patient-account-deletion.controller.ts:11-14`; `identity/qoreid-verification.controller.ts:16-24`; `audit/audit.interceptor.ts:44-46, 63-75, 105-112`; `audit/audit.service.ts:166-182`; the guard's own refusal audit (`auth/security.guard.ts:172-184`) is accepted by `assertActorFacility`.
- EHR: `services/ehr-api/src/ehr/patient-records/patient-records.controller.ts:12-15`; `patient-records.service.ts:15-19`; `services/ehr-api/src/audit/audit.interceptor.ts:60-77`; `services/ehr-api/src/audit/audit.service.ts:158-169`.

**Frontend impact.** On the shared origin, after a provider signs in in another tab, the patient tab's next `GET /identity/me`, `/identity/me/access-requests`, `/ehr/me/records`, etc. gets a retried 503 "service unavailable" instead of a session refusal. Once fixed, Health-id will treat 403 `PATIENT_SESSION_REQUIRED` as "the session changed" and re-read `/auth/session`.

**Required fix.** Add `PatientOnly()` metadata (`common/decorators.ts` in Identity and EHR). In Identity `SecurityGuard` (after the `PATIENT_ALLOWED` check, `security.guard.ts:59-61`) and EHR `RemoteSecurityGuard` (`remote-security.guard.ts:26-28`), throw `DomainProblem(403, 'PATIENT_SESSION_REQUIRED')` for any non-patient actor on a `PatientOnly` route; the guards' existing refusal audit writes a facility-less `auth.authorization.denied` row. Apply it to `PatientSelfController` (including `service/patient-self-authorization`), the four patient `ConsentController` routes, `EmergencyContactController`, `PatientAccountDeletionController`, `QoreIdVerificationController.verifyMyNin` and EHR `self()`. Defence in depth: in both interceptors' failure branch, record a non-patient actor with no bound facility as `auth.authorization.denied` / `authentication` with no membership or organization, so no handler refusal can turn into 503 again.

**Acceptance tests (failing first).** Extend `services/identity-api/src/audit/auth-refusal-audit.spec.ts` (real interceptor and AuditService over a fake DB): a staff access cookie without `X-Facility-ID` on each listed route answers 403 `PATIENT_SESSION_REQUIRED` and writes one denied row (503 and no row today); a patient cookie still gets 200. EHR spec with `AuditInterceptor` registered as in `app.module.ts`: staff cookie on `GET /api/v1/ehr/me/records` answers 403 plus one audit row (503 today); patient gets 200. Add a staff-cookie case to `verify-patient-runtime.mjs`.

**Constraints.** The `assertActorFacility` rule (staff rows need a facility unless `auth.*`) and the 0067 CHECKs stay as they are.

Source findings: ID-PATIENT-ONLY-503, ID-STAFF-ON-PATIENT-503, BE-EHR-ME-RECORDS-503, BE-ACCESS-PATIENT-ROUTES-503, "Refused staff cookie sign-out answers 503 - patient-only routes" (verifier correction applied: EHR's 503 originates in EHR).

### A10 (P1). A staff account with no active facility membership is answered 401 (at sign-in and on every request)

**Problem.** `CurrentStaffContextService.resolvePostgres` inner-joins the account's active, unheld memberships with an active, verified staff record and an active organization and facility. When that returns no rows it throws `UnauthorizedException('Staff account or facility membership is inactive')`. (`toActor`'s own `UnauthorizedException('No active facility membership')` is unreachable through `resolve()`, because `resolvePostgres` never returns an empty facility list.) At sign-in this happens after the password was verified, so a correct password is answered 401 like a wrong one and recorded as a failed login attempt. On a live session (membership ended) every request is 401, which reads as signed out.

**Evidence.** `services/identity-api/src/auth/current-staff-context.service.ts:98-152` (the joins at `:111-127`, the refusal at `:151-152`), `:201` (unreachable); `services/identity-api/src/auth/token.service.ts:122` (`issue()` resolves the actor), `:851` (`resolveActor` calls `currentStaff.resolve`); `services/identity-api/src/auth/local-auth.provider.ts:31-76` (the password is verified first, and only for an active, not disabled account); `services/identity-api/src/auth/auth.controller.ts:184-212` (an `UnauthorizedException` is recorded with `recordLoginFailure`, `auth/auth-session-audit.service.ts:59-75`).

**Frontend impact.** The provider portal's "No facility assignment" screen is unreachable; the sign-in form shows its invalid-credentials message, or a live workspace reads as signed out. Once fixed: the portal shows the no-assignment screen with Sign out.

**Required fix.** When the query at `:98-150` returns no rows, check whether the account itself is active and not disabled (`status = 'active'` and `disabled_until` passed, as `:142-143` and `:40-44` do). If it is, throw `DomainProblem(403, 'NO_ACTIVE_FACILITY_MEMBERSHIP')`; otherwise keep the 401. Do not change the `:152` message wholesale: it also covers inactive and disabled accounts, which must stay 401. Decide (and document) whether sign-in then issues a session that authorizes nothing (portal shows the screen) or refuses sign-in with that 403 and no session; in either case do not record a password failure. Every facility-scoped route continues to refuse.

**Acceptance tests (failing first).** Spec: correct password, no active membership: 403 `NO_ACTIVE_FACILITY_MEMBERSHIP`, no `auth.login_attempts` failure row (401 and a failure row today); live session whose membership is ended: `GET /auth/session` answers the chosen documented response, never 401. Wrong password still 401; a disabled or inactive account with a live token still 401.

**Constraints.** Must not reveal anything to someone who has not proven the password.

Source: auditor note (pr42-review), verified at `6b49a06`.

### A11 (P1). Patient and emergency records aggregate: superseded vitals, rejected documents, wrong limit, thin permission check, no emergency audit counts

**Problem.** `PatientRecordsService.read()` serves both `GET /ehr/me/records` and the break-glass `GET /ehr/patients/:id/emergency-records`. Since `a486a23` it returns seven sections. (a) Vitals are returned as originally recorded; corrections (`current_correction_no`, `ehr.vital_corrections`) are ignored, so a corrected wrong value is shown as current. (b) Documents are filtered only by `status='uploaded'`; scanner-rejected documents are included and indistinguishable. (c) Encounters and notes are capped at 50, other sections at 100, but the response reports a single `limit: 100`, so truncation can never be detected. (d) The emergency route requires only `ehr.encounter.read` and `ehr.note.read` but returns vitals, diagnoses, prescriptions, lab requests and documents. (e) The emergency audit event records no section counts (the self read does). Diagnoses, prescriptions and lab requests in `entered_in_error` are returned with their status (the frontend can filter those).

**Evidence.** `services/ehr-api/src/ehr/patient-records/patient-records.service.ts:15-43` (self, counts at `:31-39`), `:45-49` (emergency, no details), `:51-111` (read), `:57`, `:65` (limit 50), `:73, :79, :86, :93, :99` (limit 100), `:109` (`limit: 100`), `:67-73` (vitals without corrections), `:95-99` (documents); `patient-records.controller.ts:17-24` (permissions at `:18`); `services/ehr-api/src/ehr/vitals/vitals.service.ts:177-197` (corrections). `docs/INTERFACE_CONTRACT.md:174-177` still says 50 encounters and 50 notes only.

**Frontend impact.** The patient records page shows superseded vital values (`Health-id: apps/patient-web/src/routes/Portal.tsx:120-145`) and lists rejected documents; the staff emergency summary's truncation notice can never fire (`Health-id: apps/patient-web/src/staff/routes/Clinical.tsx:614-615`). Because (a) would show superseded vitals to emergency clinicians, Health-id will render the emergency summary's vitals only after (a) ships and its documents only after (b) ships (section 9). Once fixed: corrected values with a "corrected" marker and per-section truncation notices.

**Required fix.**
- Vitals: return the current corrected values plus `currentCorrectionNo` and `correctedAt`; define in `INTERFACE_CONTRACT.md` whether a correction replaces the whole set or named values (`vitals.service.ts:177-197`).
- Documents: join the latest scan event; exclude rejected documents (or return `scanStatus` and document it).
- Fetch `limit + 1` per section; return `limits: { encounters: 50, notes: 50, vitals: 100, diagnoses: 100, prescriptions: 100, labRequests: 100, documents: 100 }` and `truncated: { <section>: boolean }`. Keep the legacy `limit` until Health-id moves to `limits`, set to 50 (true again for the two sections the current portal reads).
- Emergency route: return a section only if the actor holds its read permission (`ehr.vital.read`, `ehr.diagnosis.read`, `ehr.prescription.read`, `ehr.lab-request.read`, `ehr.document.read`), or require them all; and add per-section counts to the `ehr.emergency.records.read` audit details.
- Whether the emergency summary should keep the seven sections at all is decision E1(c); if E1 narrows it, give `emergency()` its own projection.

**Acceptance tests (failing first).** Extend `services/ehr-api/src/ehr/patient-records/patient-records.service.spec.ts`: a corrected vital returns replacement values and `currentCorrectionNo`; a rejected document is excluded; 51 completed encounters give `truncated.encounters === true`; the emergency audit row carries counts; an actor without `ehr.prescription.read` gets no prescriptions section. No SQL change is expected; if one is made, add a SQL suite for it.

**Constraints.** Self read stays patient-session bound; facility filter on the emergency path unchanged here (B1 changes it after E1).

**Docs.** `INTERFACE_CONTRACT.md:174-177` and `:190-197`.

Source findings: "Corrected vitals elsewhere - backend", BE-PATIENT-VITAL-CORRECTIONS (verifier correction: entered-in-error rows carry their status), "Emergency access to the detailed chart - section limits", BE-EHR-EMERGENCY-LIMIT-DRIFT, EHR-EMERG-01, plus the permission and audit points of "Detailed clinical chart during emergency access".

### A12 (P1). Lab answers 500 to refused specimen and verification transitions; Lab, Pharmacy and OCR translate no database errors

**Problem.** (a) Rejecting a specimen that was never collected violates the transition trigger (23514) and answers 500; required to rejected is not intended (`0019:10` describes reject as for a collected specimen). (b) The person who entered a result gets 500 on Verify (trigger 23514 "verifier must be independent"), and revisions do not say who entered them, so the UI cannot hide Verify. (c) Two members verifying or releasing the same version: the second gets 500 after one retry (unique violation). Lab, Pharmacy and OCR have no database-error translation, so any trigger or constraint refusal is a 500.

**Evidence.** `services/ehr-api/database/migrations/0019_lab_accessions_specimens.sql:178-189`; `services/lab-api/src/lab/lab-accessions.service.ts:107-131`; `0021_lab_result_verification_release.sql:36, 49, 76-77`; `services/lab-api/src/lab/lab-executions.service.ts:117-130` (govern, no pre-check), `:145` (`resultAggregate` maps no `entered_by`/`verified_by`); `services/lab-api/src/database/database.service.ts:31-34, 84-88`; documented known limits `docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:748` (unique conflicts, case (c)) and `:752` (the verifier-independence 23514 answers 500, case (b)).

**Frontend impact.** The Laboratory page offers Reject on a `required` specimen (`Health-id: apps/patient-web/src/staff/routes/Operations.tsx:82-83`; Health-id will stop offering it) and Verify to the enterer; both end in a generic server error. Once fixed: specific 409 messages, and Verify hidden for the enterer.

**Required fix.** Pre-check in `transition()`: **`409 LAB_SPECIMEN_TRANSITION_NOT_ALLOWED`**. Pre-check in `govern()`: **`409 LAB_RESULT_VERIFIER_NOT_INDEPENDENT`**. Expose `enteredByCurrentActor` (boolean) and `verifiedAt` per revision. Map the `result_verifications`/`result_releases` unique violation after the retry to **`409 LAB_RESULT_ALREADY_VERIFIED`** / **`409 LAB_RESULT_ALREADY_RELEASED`**. Add a database-error translator to Lab, Pharmacy and OCR modelled on `services/ehr-api/src/ehr/shared/clinical.repository.ts:220-238` (which maps 23514 to 400 and 23505 to 409):
- the two known trigger messages to their 409 codes: "Illegal or stale specimen lifecycle transition" (`0019:186`) to `LAB_SPECIMEN_TRANSITION_NOT_ALLOWED`; "Result verifier must be independent and result must be eligible" (`0021:77`) to a 409 that covers both conditions (for example `LAB_RESULT_NOT_VERIFIABLE`), leaving `LAB_RESULT_VERIFIER_NOT_INDEPENDENT` to the `govern()` pre-check;
- any other 23514 to 400; 23505 to 409 (case (c)); 23503 to 409; 42501 to 403; 22P02 to 400; unknown stays 500.

**Acceptance tests (failing first).** `lab-accessions.service.spec.ts`: reject a `required` specimen answers 409 (500 today); collect a received specimen answers 409. `lab-executions.service.spec.ts`: enter then verify as the same account answers 409; two accounts verify the same version, the second gets 409. `verify-lab-runtime.mjs`: the same three over HTTP as the Lab runtime role.

**Constraints.** Do not relax `lab.validate_specimen_transition` or the independence trigger.

Source findings: BE-LAB-SPECIMEN-REJECT-500 (verifier correction applied: no product decision needed), BE-LAB-VERIFY-SELF-500.

### A13 (P1). `POST /auth/otp/start` reveals whether an account exists

**Problem.** Within the resend cooldown a known identifier gets the same `challengeId` again, while an unknown identifier gets a fresh random id every time; delivery is awaited only for known accounts (timing difference). Two calls within 60 s answer "exists / does not exist" for any email or HID.

**Evidence.** `services/identity-api/src/auth/otp.service.ts:111-120` (cooldown keyed on `account_id`, null for unknown), `:121` (unknown returns `none`), `:144-152` (delivery only for a real challenge), `:154-156` (fresh `candidateChallengeId`); `config/environment.ts:72`.

**Frontend impact.** None visible; the patient and staff recovery screens use this route.

**Required fix.** Make the response independent of existence by anchoring the decoy at the first request, exactly as a real challenge is anchored. The real cooldown runs from the challenge's `created_at` (`otp.service.ts:111-119`), so a deterministic id derived from fixed time windows (for example an HMAC of identifier, purpose and window start) still leaks: two starts 5 s apart that straddle a window boundary give two ids for an unknown identifier and one for a known one. Instead persist a decoy keyed by `recipient_hmac` and purpose with its own `created_at`, either in a new table or in `auth.otp_challenges` with a nullable `account_id` (a schema change in either case), and answer the cooldown from it as for a real challenge. Move delivery off the request path (outbox) so timing does not depend on existence.

**Acceptance tests (failing first).** Spec: two starts for an unknown identifier within the cooldown return the same `challengeId`, as for a known one, and the bodies are otherwise deep-equal; the same holds for two starts a few seconds apart at any wall-clock time (no window boundary effect); `verify-otp-recovery-runtime.mjs` adds the same pair over HTTP. `otp-recovery.integration.sql` for the schema change (a decoy row can never be verified or consumed).

**Constraints.** Rate limits unchanged; a decoy must never be verifiable.

Source findings: ID-OTP-ENUM.

### A14 (P1). Lab, Pharmacy and OCR answer a patient session and a missing facility with the wrong codes; a missing purpose header answers 500

**Problem.** (a) A patient cookie reaches Lab, Pharmacy and OCR (Identity's `/auth/service-session` is `@PatientAllowed`) and is refused as `403 FACILITY_ACCESS_DENIED`; EHR answers `403 PATIENT_SCOPE_DENIED`. (b) Lab and Pharmacy answer a missing or malformed `X-Facility-ID` with 403 `FACILITY_ACCESS_DENIED`; EHR, Identity, OCR and Outreach answer 400 `FACILITY_REQUIRED`. (c) A missing or invalid `X-Purpose-Of-Use` throws a plain `Error` (500) in `requireRequestContext` in Identity (e.g. `GET /identity/registration-cases/:caseId`), EHR documents, Lab, Pharmacy and OCR reads.

**Evidence.** `services/lab-api/src/auth/lab-remote-security.guard.ts:32`; `services/pharmacy-api/src/auth/pharmacy-security.guard.ts:55`; `services/ocr-api/src/auth/remote-security.guard.ts:26-31`; EHR reference `services/ehr-api/src/auth/remote-security.guard.ts:26-28`; `services/identity-api/src/common/request-context.ts:85-89`; `services/ehr-api/src/common/request-context.ts:61-65`; `services/lab-api/src/common/request-context.ts:57-62`; `services/pharmacy-api/src/common/request-context.ts:56-62`; `services/ocr-api/src/common/request-context.ts:63-67`; `services/identity-api/src/identity/nin-registration.controller.ts:40-46`.

**Frontend impact.** The staff portal locks the workspace only on `PATIENT_SCOPE_DENIED` (`Health-id: apps/patient-web/src/staff/session.ts:160`); on Lab, Pharmacy and OCR a patient cookie shows "no access at this facility" instead. Health-id always sends the purpose header, so (c) is latent.

**Required fix.** Lab, Pharmacy, OCR guards: `403 PATIENT_SCOPE_DENIED` when `actor.kind === 'patient'` on a route that is not `PatientAllowed`; Lab and Pharmacy: `400 FACILITY_REQUIRED` for a missing or malformed header. All five `requireRequestContext`: `DomainProblem(400, 'PURPOSE_OF_USE_REQUIRED')` for a missing or invalid purpose; keep "context was not established" as 500.

**Acceptance tests (failing first).** Guard specs per service for each case; controller spec `GET /identity/registration-cases/:id` without the header answers 400.

**Constraints.** Authentication order unchanged (authenticate, patient scope, facility, permission); EHR and Identity codes unchanged.

Source findings: "Staff session end - patient session on Lab/Pharmacy/OCR", BE-HEADER-VALIDATION-STATUS, ID-PURPOSE-HEADER-500.

### A15 (P2). Document upload completion is not bound to its creator; document routes answer generic codes and return numbers as strings

**Problem.** Any member with a write grant for the patient at the facility can complete another member's upload intent (object hash, size and type must still match, so the impact is attribution). An invalid Idempotency-Key answers 409 `CONFLICT` (rest of EHR: 400 `IDEMPOTENCY_KEY_REQUIRED`); uploads disabled answers 409 `CONFLICT`; other database errors 500; consent refusals 403 `ACCESS_DENIED`. `list()` returns `sizeBytes` and `version` as strings while `view()` returns numbers; `/ehr/me/records` also returns `sizeBytes` as a string.

**Evidence.** `services/ehr-api/src/documents/document.service.ts:181-219` (update predicate `id`, `facility_id`, `status` only), `:130-142` (`::text` casts), `:262-274`, `:359-363`; `services/ehr-api/database/migrations/0005_database_authorization.sql:391-393` (RLS checks write grant only); `services/ehr-api/src/common/idempotency.ts:6-14`.

**Frontend impact.** The portal types these fields as numbers (`Health-id: apps/patient-web/src/staff/api.ts:248-258`); the patient page prints sizes without separators.

**Required fix.** Add `and created_by = $n and created_by_membership_id = $m` to the completion update, or answer **`403 DOCUMENT_UPLOAD_NOT_OWNED`**; mirror it in a restrictive RLS policy on the initiated-to-uploaded transition (new migration). Use `DomainProblem` codes: `400 IDEMPOTENCY_KEY_REQUIRED`, `423 UPLOADS_DISABLED`, `403 CONSENT_REQUIRED`, `409 DOCUMENT_NOT_COMPLETABLE`, `409 DOCUMENT_INTEGRITY_MISMATCH`. Return integers in `list()` and in the records aggregate.

**Acceptance tests (failing first).** Integration: account A creates an intent and uploads; account B at the same facility with a write grant calls `POST /ehr/documents/:id/complete`: 403 and status stays `initiated` (succeeds today). Bad key: 400. SQL suite for the new policy.

**Constraints.** Object integrity checks (size, sha256, media type) and `reject_document_object_rebinding` unchanged; a replayed completion by the creator still returns the uploaded document.

Source findings: PROSE-L138a, "Staff session end - upload completion ownership", BE-EHR-DOCUMENTS-CONTRACT.

### A16 (P2). A platform-admin grant bypasses maintenance mode and the provider-portal switch for that person's staff sessions

**Problem.** `enforceRuntimeControls` returns early for any actor whose platform permissions include `platform.admin.access`. Staff actors carry the account's platform grants, so a password-only staff or clinical session of a platform administrator keeps working through maintenance and a disabled provider portal.

**Evidence.** `services/identity-api/src/auth/security.guard.ts:247-248`; `services/identity-api/src/auth/current-staff-context.service.ts:50, 213`; `services/ehr-api/src/auth/remote-security.guard.ts:60-61`; `services/outreach-api/src/auth/outreach-security.guard.ts:79-80` (same bypass in Outreach's own control check). Lab, Pharmacy and OCR have no control check of their own; they authenticate through Identity's guard, so the Identity change covers them.

**Frontend impact.** None for ordinary users. During maintenance, Health-id's maintenance message does not appear for these administrators' staff and clinical sessions.

**Required fix.** Identity: replace the check with `if (actor.kind === 'platform') return;` (platform sessions must keep reaching the console during maintenance, including `POST /admin/controls`; removing the early return entirely would lock the console out). EHR and Outreach: drop the bypass (platform sessions never authenticate there). If operators need clinical access during maintenance, add an explicit audited control.

**Acceptance tests (failing first).** Guard spec: staff actor with `platformPermissions ['platform.admin.access']` and maintenance on: 503 `PLATFORM_MAINTENANCE`; provider portal off: 423 `PLATFORM_PORTAL_DISABLED`; a platform session on `POST /admin/controls` during maintenance still succeeds. EHR and Outreach guard specs: the same staff actor during maintenance gets 503 `PLATFORM_MAINTENANCE`; Outreach with `outreach_portal_enabled` off gets 423.

**Constraints.** Platform sessions keep console access during maintenance; no other control behaviour changes.

Source findings: ID-CONTROL-BYPASS (verifier correction applied).

### A17 (P2). Audit fidelity gaps

**Problem.** (a) Identity guard records `details.code` only for platform routes; facility, `auth.authorization.denied` and system branches record method and route only. (b) Identity and EHR interceptors record every handler error as outcome `failure` with no status or code, including 4xx refusals. (c) Pharmacy and Outreach register no `AuditInterceptor`; the Lab, Pharmacy and Outreach guards record no refusal; `PharmacyService.authorize` throws without recording. (d) Identity's interceptor records the browser-supplied `X-Purpose-Of-Use` as the purpose on patient routes (`audit.interceptor.ts:120-123`), so a patient approve/deny sent with `direct-care` is audited as direct care.

**Evidence.** `services/identity-api/src/auth/security.guard.ts:140-196` (code only at `:153`); `services/identity-api/src/audit/audit.interceptor.ts:63-75, 120-123`; `services/pharmacy-api/src/app.module.ts:14`; `services/outreach-api/src/app.module.ts:14`; `services/lab-api/src/auth/lab-remote-security.guard.ts:18-37`; `services/pharmacy-api/src/pharmacy/pharmacy.service.ts:292-301`; EHR's pattern `services/ehr-api/src/auth/remote-security.guard.ts:92-132`.

**Frontend impact.** The facility Audit page (`Health-id: apps/patient-web/src/staff/api.ts:758-775`) shows "failure" for refusals with no reason, and denied Pharmacy and Outreach attempts are missing.

**Required fix.** Add `status` and `code` to every guard branch and interceptor failure row; outcome `denied` for status below 500, `failure` otherwise. Port EHR's `recordDenied` and `AuditInterceptor` to Pharmacy and Outreach, and `recordDenied` to the Lab guard; record service-level consent refusals as `denied`. Record purpose `patient-self` on patient-only routes regardless of the header. No PHI in details.

**Acceptance tests (failing first).** Identity spec: facility-bound staff missing a permission writes `security.authorization` with `details.code 'PERMISSION_DENIED'`; a handler 403 writes `denied` with status and code; a 500 writes `failure`; a patient approve sent with `X-Purpose-Of-Use: direct-care` records `patient-self`. Pharmacy spec: a refused dispense writes one denied row. Lab guard spec: `PERMISSION_DENIED` writes one row.

**Constraints.** No PHI in `details`; success rows unchanged; the `assertActorFacility` rule unchanged.

**Docs.** `SECURITY.md` (audit coverage).

Source findings: ID-AUDIT-REFUSAL-CODE, BE-AUDIT-GAPS; auditor note (gapmap-1) for (d).

### A18 (P2). `/identity/service/authorization/check` grants `write_records` on a request the guard admitted as a reported read

**Problem.** The guard skips the cookie CSRF check on a delegation route when an authenticated workload reports a safe browser method, and records that so the route can refuse a write. The service authorization route never checks it, so a caller bug would silently drop CSRF protection for writes.

**Evidence.** `services/identity-api/src/auth/security.guard.ts:304-316` (sets `request.delegatedBrowserMethod` "so the route can refuse to authorize a write"); `services/identity-api/src/identity/identity.controller.ts:35-47` never reads it; Outreach does (`:74-79`).

**Frontend impact.** None (defence in depth).

**Required fix.** In `authorizeService`, when `request.delegatedBrowserMethod` is set and `input.scope !== 'read_records'`, throw `403 CSRF_VALIDATION_FAILED`. Defence in depth; no current GET asks for write.

**Acceptance tests (failing first).** `delegated-browser-request.spec.ts`: workload reports GET with a cookie and no CSRF and asks for `write_records`: 403; `read_records`: 200.

**Constraints.** Outreach's existing check unchanged; delegated reads still authorized.

Source findings: ID-DELEGATED-WRITE-SCOPE, BE-DELEGATED-WRITE-DEFENSE.

### A19 (P2). A request from an Origin not in `CORS_ORIGINS` answers 500 in all six services

**Problem.** The CORS origin callback raises a plain `Error` for a disallowed origin; the global filter maps it to 500 `INTERNAL_ERROR`.

**Evidence.** `services/identity-api/src/config/cors.ts:21-24` (`callback(new Error(...))`, mapped to 500 by the filter); same pattern in `services/ehr-api/src/main.ts:49`, `services/lab-api/src/main.ts:49`, `services/ocr-api/src/main.ts:33`, `services/outreach-api/src/main.ts:33`, `services/pharmacy-api/src/config/cors.ts:14`; `services/identity-api/src/config/cors.spec.ts:85-89` checks only the missing ACAO header.

**Frontend impact.** A portal origin missing from `CORS_ORIGINS` presents as a server fault on every same-origin POST, hiding a configuration error.

**Required fix.** Pass or throw `DomainProblem(403, 'ORIGIN_DENIED')` (prefer this). It keeps an explicit, diagnosable refusal on every route, including GETs and the services that rely on CORS alone. With `callback(null, false)` a disallowed origin proceeds to the handler and only the browser's read block remains. (Identity's browser-facing `@Public` POSTs check Origin themselves either way: `auth/otp.controller.ts:23, 52-56`, `identity/patient-enrollment.controller.ts:32, 103-106`, `auth/auth.controller.ts:582-587`, `identity/provider-enrollment.controller.ts:112-115`, `identity/organization-applications.controller.ts:38-40, 97-100`, `commercial/demo-requests.controller.ts:25-28`, `auth/platform-auth.controller.ts:179-182`.)

**Acceptance tests (failing first).** Extend `services/identity-api/src/config/cors.spec.ts` and `services/pharmacy-api/src/config/cors.spec.ts` with the ProblemDetailsFilter registered: POST with `Origin: https://attacker.example.test` answers 403 `ORIGIN_DENIED`, not 500. EHR, Lab, OCR and Outreach configure CORS inline in `main.ts`: extract it to a `config/cors.ts` and add the same spec.

**Constraints.** Allowed origins and every server-side Origin refusal unchanged.

Source findings: ID-CORS-500 (verifier correction applied).

### A20 (P2). Authenticated platform step-up answers 401 for a wrong code and a changed factor

**Problem.** On an authenticated platform route, a wrong TOTP code and a changed factor are answered 401, the status clients use for an ended session.

**Evidence.** `services/identity-api/src/auth/mfa/mfa.service.ts:290` (`stepUp`), `:553-559` (`failed` and `invalid` both 401) on authenticated routes in `admin/platform-security.controller.ts`.

**Frontend impact.** The console avoids a refresh only for `MFA_INVALID_CODE` (`Health-id: apps/patient-web/src/admin/api.ts:141, 249-251`); `MFA_CHALLENGE_INVALID` still triggers refresh and retry.

**Required fix.** On authenticated routes (step-up, recovery-code regeneration) answer a wrong code with `403 MFA_INVALID_CODE` and a factor/assurance mismatch with `403 PLATFORM_SESSION_REQUIRED`; keep 401 on the unauthenticated `/auth/admin/mfa/*` challenge routes.

**Acceptance tests (failing first).** Spec: step-up with a wrong code answers 403 `MFA_INVALID_CODE` and still records the factor failure. Extend `verify-platform-security-runtime.mjs`.

**Constraints.** Factor failure counting, lockout and the unauthenticated challenge routes unchanged.

Source findings: ID-STEPUP-401.

### A21 (P2). No `Retry-After` on Identity 429 and 503 answers; not exposed through CORS

**Problem.** Rate-limit and maintenance answers carry no hint of when to retry, and the header would not be readable through CORS.

**Evidence.** No `Retry-After` anywhere under `services/identity-api/src`; 429s at `services/identity-api/src/auth/otp.service.ts:337`, `auth/mfa/mfa.service.ts:555`, `identity/patient-enrollment.service.ts:516`, `consent/consent.service.ts:287`; `config/cors.ts:15-16` (exposed headers).

**Frontend impact.** The client already honours `Retry-After` (`Health-id: packages/http/src/client.ts:398`) but never receives it, so it uses fixed backoff.

**Required fix.** Set `Retry-After` (seconds) on rate-limit 429s from the bucket's window or `blocked_until`, and on 503 `PLATFORM_MAINTENANCE` when an end time is known; add `retry-after` to `CORS_EXPOSED_HEADERS`. (503 headers reach the browser only after A8.)

**Acceptance tests (failing first).** Spec: a blocked OTP start returns 429 with `Retry-After` between 1 and the window length; CORS spec exposes it.

**Constraints.** Limits and windows unchanged.

Source findings: ID-RETRY-AFTER.

### A22 (P2). A demo-request replay with a different body is silently accepted

**Problem.** Replaying an idempotency key with a different body returns `accepted: true, replayed: true` and stores nothing new; the only abuse control is Turnstile (no per-network quota).

**Evidence.** `services/identity-api/src/commercial/demo-requests.service.ts:44-77` (`on conflict (idempotency_key_sha256) do nothing`, `replayed: true` with no body comparison); `common/idempotency.ts:17` (`requestDigest`).

**Frontend impact.** None; the public demo form uses a fresh key per submission.

**Required fix.** Store a request digest beside the key (new migration) and answer `409 IDEMPOTENCY_KEY_REUSED` when it differs. Add a per-network quota after A7.

**Acceptance tests (failing first).** Spec and `demo-requests.integration.sql`: same key, different `contactEmail`: 409; same key and body: `replayed: true`.

**Constraints.** Each submission still needs a fresh single-use Turnstile token.

Source findings: COM-DEMO-IDEMPOTENCY.

### A23 (P2). Validation errors drop nested field paths

**Problem.** For nested DTOs class-validator puts the failures in `children`; the response says `{ field: 'replacementValues', messages: [] }`.

**Evidence.** `services/ehr-api/src/main.ts:73-81` (maps only top-level `property` and `constraints`); nested DTOs exist only in EHR (`ehr/shared/clinical.dto.ts:255-260`) and Lab (`lab/dto/accession.dto.ts:13`, `create-lab-import.dto.ts:26`, `ocr-lab-import.dto.ts:11`); the other services share the factory but have no nested DTO.

**Frontend impact.** None today (no screen reads `details`; native min/max run first). Needed for field-level errors on nested forms such as vital corrections.

**Required fix.** A shared helper that flattens `children` into dotted fields (`replacementValues.systolicMmhg`) with their messages; top-level entries unchanged. Apply to all six services.

**Acceptance tests (failing first).** EHR: vital correction with `replacementValues.systolicMmhg = 999` answers 400 with `{ field: 'replacementValues.systolicMmhg', messages: [<max message>] }` (`messages: []` today). Lab: one nested accession case.

**Constraints.** Top-level entries and the `VALIDATION_FAILED` code unchanged.

Source findings: BE-NESTED-VALIDATION-ERRORS (scope narrowed by the verifier).

### A24 (P2). Admin principal search and export put names, emails and audit reasons in GET query strings

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

---

## 4. Class B: missing or broken contracts behind screens Health-id already has

### B1 (P0, needs E1). Break-glass cannot open the chart; every emergency read is limited to the current facility

**Problem.** (a) All ordinary chart GETs (encounters, vitals, notes, diagnoses, prescriptions, lab requests) use `clinicalContext()`, which accepts only `direct-care`; a break-glass grant has purpose `emergency` and the normal grant branch excludes break-glass, so a break-glass holder gets 403 with direct-care and 400 with emergency. Only the summary works. Non-completed encounters, unsigned notes, note revisions and vital corrections are unreachable under break-glass. (b) Every clinical read, including the emergency summary, returns only rows created at the caller's current facility (`ehr.context_allows` requires `row_facility_id = current_facility_id`, and the emergency read adds `facility_id = $2` to every section). At an emergency department that has never treated the patient, the summary is empty. (c) Document list/download accept any validated purpose, so they likely work under break-glass, but this has not been run.

**Evidence.** `services/ehr-api/src/ehr/shared/clinical-context.ts:7-13`; GET handlers in `ehr/encounters/encounters.controller.ts:12,22`, `vitals/vitals.controller.ts`, `clinical-notes/clinical-notes.controller.ts`, `diagnoses/diagnoses.controller.ts`, `prescriptions/prescriptions.controller.ts:17,24`, `lab-requests/lab-requests.controller.ts:12,19`; `services/ehr-api/database/migrations/0012_narrow_break_glass_authorization.sql:37-49` (normal branch excludes break-glass; exact purpose), `:80-101` (emergency branch: read only, same facility); `0005_database_authorization.sql:24-45`; `services/ehr-api/src/ehr/patient-records/patient-records.service.ts:45-53`; `services/ehr-api/src/ehr/shared/clinical.repository.ts:56-61`; `services/ehr-api/src/documents/document.controller.ts:29-54` with `common/request-context.ts:59-66`; `docs/SECURITY.md:61` (cross-facility only through an explicit workflow; none exists). Lab and Pharmacy policies are facility-bound the same way (`0017:104-110`, `0023:227-242`).

**Frontend impact.** Under break-glass the provider portal shows only the summary and never retries as direct-care (correct). Clinicians at an ER that did not treat the patient see nothing. Once the contract exists, the portal will page the chart under `X-Purpose-Of-Use: emergency` and show the facility of each row.

**Required fix (after E1).**
- Add `clinicalReadContext(request)` accepting `direct-care` or `emergency`; switch only the GET handlers of the six clinical controllers to it; writes keep `clinicalContext`. In `ClinicalRepository.run`, when the purpose is `emergency`, require `authorization.breakGlass === true` and refuse `write_records` with **`403 EMERGENCY_READ_ONLY`**; audit each emergency read as a break-glass read.
- If E1(b) allows cross-facility emergency reads: a new migration with a security-definer read function or a dedicated SELECT policy that admits rows from any facility only when `current_purpose_of_use = 'emergency'` and the caller holds an active break-glass grant at their current facility; drop the facility filter on the emergency path only; return `facilityId` and facility name on every row; audit per-facility counts. Do not change `context_allows` for any other purpose.
- State explicitly in the contract whether document list/download are allowed under emergency, and add a test either way.

**Acceptance tests (failing first).** `ehr-api` controller+service spec with the real guard and an Identity fake returning `allowed + breakGlass` for `emergency`: each clinical GET with `X-Purpose-Of-Use: emergency` answers 200 (400 today); POST/PATCH with emergency answer 400/403; a direct-care-only grant with the emergency header answers 403. If cross-facility: `emergency.integration.sql` gains "encounter and signed note at facility A, break-glass at facility B, summary contains A's rows" (empty today) and "direct-care grant at B still sees only B".

**Constraints.** Break-glass stays read-only unless E1(d) decides otherwise; reason, expiry, rate limit, notification and `break_glass_enabled` control unchanged; `SECURITY.md:61` updated with the explicit workflow.

**Docs.** ADR; `SECURITY.md`; `INTERFACE_CONTRACT.md:190-197`.

Source findings: BE-EHR-EMERGENCY-CHART (verifier corrections applied: the summary is not "reduced"; document list/download plausibly work), "Detailed clinical chart during emergency access", PROSE-L136, BE-EHR-FACILITY-LOCAL-RECORDS, "Emergency access to the detailed chart - policy" (evidence corrected: break-glass is read-only by `0012:79-101`).

### B2 (P0, needs E2). Lab and Pharmacy staff need their own patient grant for each patient: queues look empty and no step can be taken

**Problem.** Lab and Pharmacy RLS applies `has_active_consent_grant` with the **reader's own** account, membership and exact purpose to every row. A lab technician or pharmacist without a personal grant sees an empty queue and cannot accession, run, verify, release or dispense. Their roles hold `identity.consent.write` but not `identity.patient-access-pin.verify`, so their only route is a patient-approved request, and the queue does not show which patient to ask. Accepting a prescription into Pharmacy requires `pharmacy.work-item.accept` (pharmacist only) and a direct-care **write** grant on the EHR route. `list()` itself runs no per-patient authorize, but RLS filters per row, while `get()` authorizes explicitly.

**Evidence.** `services/ehr-api/database/migrations/0012_narrow_break_glass_authorization.sql:37-49`; `0017_lab_imported_evidence.sql:104-110`; `0018_lab_work_items.sql:147-148`; `0023_pharmacy_domain_foundation.sql:24, 227-242, 379-380`; `0010_consent_commands_and_audit_reads.sql:13-21`; `0033_supabase_cutover_identity_controls.sql:16-18`; `services/lab-api/src/lab/lab-work-items.service.ts:91-117`; `services/pharmacy-api/src/pharmacy/pharmacy.service.ts:127-149, 292-301`; `services/ehr-api/src/ehr/prescriptions/prescriptions.controller.ts:51-66`; per-request session settings `services/lab-api/src/database/database.service.ts:112-116`, `services/pharmacy-api/src/database/database.service.ts:102-105`.

**Frontend impact.** The Laboratory and Pharmacy pages say "No accepted lab work" and "No accepted prescriptions" (`Health-id: apps/patient-web/src/staff/routes/Operations.tsx:462, 513`, rendered by the empty state at `:53`) when work exists. Once fixed: queues show the facility's work per the chosen disclosure rule.

**Required fix (after E2).** Implement the chosen fulfilment authorization in a new migration (`identity.has_active_consent_grant` and/or `lab.context_allows`, `pharmacy.context_allows`, and Identity `authorize()`), e.g. an order-scoped, time-limited fulfilment grant created atomically when Lab/Pharmacy accepts the order, valid for the receiving facility and that work item only; or role-scoped queue visibility with minimum disclosure plus per-patient grants for detail and writes; or grant `identity.patient-access-pin.verify` to `lab` and `pharmacist`. The PIN option makes the queue visible only: a PIN grant is `read_records` under `direct-care` (`0079_patient_access_pin_actor_window.sql:312, 322`), while accessioning, results and dispensing need `write_records` (`services/lab-api/src/lab/lab-accessions.service.ts:114`; `lab-executions.service.ts:121, 148`; `services/pharmacy-api/src/pharmacy/pharmacy.service.ts:157, 292-299`), so those steps would still need a write grant. Cover Pharmacy acceptance in the same decision. Audit every fulfilment-grant use.

**Acceptance tests (failing first).** Runtime verifiers: a doctor creates an active lab order and a prescription; a lab technician and a pharmacist at the receiving facility with no personal grant list the work item and can perform the next step (empty list or 403 today); a member of another facility still sees nothing; after the grant's end, access stops. SQL suite pinning the new policy.

**Constraints.** No facility-wide bypass of patient deny directives (`0012:55-78`) unless the ADR says so; no relaxation for other services.

Source findings: BE-LAB-PHARM-PER-MEMBER-CONSENT, LABPHARM-02, "Lab and Pharmacy work queues - disclosure policy".

### B3 (P0, needs E4). Onboarded organizations get only `org_admin`; Identity has no workforce or member API

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

Source findings: ID-NO-WORKFORCE, "Onboarded organizations have no clinical access", GAP-L114, "Staff and role management", "Reference workflows - Provider organization", BE-OUTREACH-MEMBER-DIRECTORY.

### B4 (P1, needs E3). OCR needs two grant purposes that the portal cannot obtain together

**Problem.** Job create, validate, confirm and retry accept only `healthcare-operations`; publication accepts only `direct-care`; reads take the header purpose; Identity matches purpose exactly. Identity accepts `healthcare-operations` access requests, but the patient's inbox does not return the purpose, so a patient cannot tell an import request from a care request. Read refusals are masked as 404 `OCR_JOB_NOT_FOUND` while creation answers 403.

**Evidence.** `services/ocr-api/src/ocr/dto/create-ocr-job.dto.ts:26`, `validate-ocr-job.dto.ts:37`, `confirm-ocr-patient.dto.ts:13`, `retry-ocr-job.dto.ts:13`, `create-ocr-publication.dto.ts:11`; `services/ocr-api/src/ocr/ocr.service.ts:142, 709-727`; `services/identity-api/src/identity/postgres-identity.provider.ts:73`; `services/identity-api/src/consent/consent.controller.ts:38-46, 95-101`; `services/identity-api/src/consent/consent.service.ts:106-118`; `services/ehr-api/database/migrations/0066_patient_access_safety.sql:274-290` (`list_my_patient_access_requests` returns no purpose).

**Frontend impact.** Migrate cannot authorize any OCR job today; the portal requests access only as direct-care. Once decided, the portal either uses one purpose throughout or adds a "records import" access request and shows the purpose to patients.

**Required fix (after E3).** One purpose: accept `direct-care` in the four DTOs and authorize the whole lifecycle under it (ADR). Two purposes: return `purposeOfUse` and the requester's display name from `identity.list_my_patient_access_requests` (new migration: drop and recreate the function with the column, runtime grant) and `ConsentService.listMyAccessRequests`. Either way decide 404 vs 403 for a job that exists at the facility without a grant.

**Acceptance tests (failing first).** Runtime verifier (`verify-ocr-runtime.mjs`): one clinician holding the chosen grant(s) creates, validates, confirms and publishes a job end to end. `patient-access-safety.integration.sql`: the patient's list returns the purpose.

**Constraints.** Exact-purpose matching in Identity stays; any purpose widening only by ADR after E3.

Source findings: OCR-01, BE-OCR-PURPOSE-SPLIT, "OCR purpose of use".

### B5 (P1). A failed OCR publication cannot be retried by id, and exhausted retries answer "in progress" forever

**Problem.** A retryable publication failure resumes only by replaying the original requester's `Idempotency-Key` (lookup by facility, requester and key); any new key answers 409 `OCR_ALREADY_PUBLISHED`. No worker retries publications. The projection has no `nextAttemptAt` or `retryable`. A failure stored as `OWNING_SERVICE_UNAVAILABLE` after the last permitted attempt is not "terminal", but the claim requires `attempt_count < max_attempts`, so even the original requester gets 409 `OCR_PUBLICATION_IN_PROGRESS` forever.

**Evidence.** `services/ocr-api/src/ocr/ocr.service.ts:82-89` (retryable codes, `isTerminalFailure`), `:415-430`, `:466-487` (claim at `:474`, 409 at `:487`), `:659-667` (projection); `services/ocr-api/src/ocr/ocr.controller.ts:87-107`; no publication code in `services/ocr-worker/src`; `docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:751`.

**Frontend impact.** After a reload, on another device, or for another reviewer, a transiently failed import is stranded. (Health-id will also reuse one key per validation within a page visit.) Once fixed, the portal shows "retry available at <time>" and a Retry button.

**Required fix.** `POST /api/v1/ocr/publications/:publicationId/retry` (`ocr.publication.write`, purpose `direct-care`, `write_records` via `authorizeJob`, `If-Match` on the publication version, audited): runs `executePublication` for a retryable failure whatever the original key or requester; **`409 OCR_PUBLICATION_RETRY_NOT_DUE`** with `nextAttemptAt` when not yet due; **`409 OCR_PUBLICATION_TERMINAL`** for a terminal failure or exhausted attempts (treat `attempt_count >= max_attempts` as terminal in `isTerminalFailure` and the projection). Add `retryable` and `nextAttemptAt` to `projectPublication`. Optionally let `ocr-worker` claim due retryable publications.

**Acceptance tests (failing first).** `verify-ocr-runtime.mjs`: owner fake answers 503, publication is failed and retryable; a different staff member calls retry after `nextAttemptAt` and it publishes; before then 409 `OCR_PUBLICATION_RETRY_NOT_DUE`; after `maxAttempts` 409 `OCR_PUBLICATION_TERMINAL` (409 `IN_PROGRESS` today). `ocr-job-source-and-publication.integration.sql` if SQL changes.

**Constraints.** Original-key replay, retryable failure codes and `max_attempts` unchanged; the claim stays conditional so a retry never publishes twice.

Source findings: BE-OCR-PUBLICATION-RETRY, OCR-03, PROSE-L130, "OCR review fields and failed publications - backend residual".

### B6 (P1). No route shows a released Lab result or a dispensing from the EHR order, or to the patient

**Problem.** EHR lab-request projections carry no Lab state; `GET /lab/results/:id/history` needs a result id that doctors cannot reach (they hold `lab.result.released.read` but not `lab.accession.read`/`lab.execution.read`; the Lab list returns no result id). `LabResultReleased` and `MedicationDispensed` are consumed only by the notification worker. The patient record (`/ehr/me/records`) contains orders but no released results and no dispensing state, and patients cannot download the documents it lists (document routes are staff-only).

**Evidence.** `services/ehr-api/src/ehr/lab-requests/lab-requests.service.ts:30-36`; `services/lab-api/src/lab/lab-executions.controller.ts:14, 16, 32`; `services/lab-api/src/lab/lab-work-items.service.ts:102-117`; `services/ehr-api/database/migrations/0019_lab_accessions_specimens.sql:13-15`, `0020_lab_test_execution_results.sql:13-14`, `0021_lab_result_verification_release.sql:15`; `services/event-dispatcher/src/event-contracts.ts:4-19`; `services/ehr-api/src/ehr/patient-records/patient-records.service.ts:81-99`; `services/ehr-api/src/documents/document.controller.ts:29-54` (no `PatientAllowed`). Clinicians can in principle see dispensing state by joining `GET /pharmacy/work-items` on `sourceEhrPrescriptionId` (`pharmacy.service.ts:50-53`), but that is unreliable until A2 ships: the list is the facility's oldest 200 work items with no patient or prescription filter (`pharmacy.service.ts:129-130`), so a newer prescription is simply absent. Health-id will use the join only as an interim, with a notice when the list is at its cap.

**Frontend impact.** Results appear only on the Laboratory page; the ordering clinician and the patient cannot see them. Once fixed, the clinical record shows results under each order and the patient record shows released results and documents.

**Required fix.** Clinician: `GET /api/v1/lab/work-items/:workItemId/results` (or `?sourceEhrOrderId=`) returning released versions only, gated by `lab.result.released.read` and a `read_records` grant; or an EHR projection consuming `LabResultReleased`. Dispensing: add `?sourceEhrPrescriptionId=` to `GET /pharmacy/work-items` (same permission, RLS and audit), or the EHR prescription projection of A1 step 6. Patient (after E15): released results and dispensing status in `/ehr/me/records` (or patient routes), and `GET /api/v1/ehr/me/documents/:id/download` (`PatientOnly`, patient-self authorization through Identity, clean-scan documents only, audited with purpose `patient-self`).

**Acceptance tests (failing first).** Lab runtime verifier: release a result, a doctor with a read grant fetches it from the work item (no route today); an unreleased result is never returned. EHR spec: the patient sees released values and can download a clean document; a staff session gets 403 `PATIENT_SESSION_REQUIRED`.

**Constraints.** Unreleased results are never returned; patient routes stay patient-session bound; downloads only after a clean scan.

Source findings: BE-RESULTS-DISPENSING-NO-RETURN (verifier correction applied for clinician dispensing, qualified by the 200-oldest cap of A2); auditor note (gapmap-1) for patient documents and results.

### B7 (P2, reasons and expiries need E6). Staff and patient session contract

**Problem.** (a) Staff actors carry no `kind`; `GET /auth/session` returns no idle or absolute expiry (refresh returns only the access `expiresAt`). (b) Ended staff and patient sessions get a generic 401 `AUTHENTICATION_REQUIRED`; only platform sessions have `PLATFORM_SESSION_EXPIRED`/`REVOKED`. (c) Cookie `POST /auth/logout` ends whichever sign-in the cookies hold; a sign-in made in another window between the portal's account check and the logout is ended. A frontend workaround is impossible (a remembered CSRF token mismatches and the `finally` clears the new session's cookies).

**Evidence.** `services/identity-api/src/auth/current-staff-context.service.ts:202-218`; `auth/auth.controller.ts:246-273, 325-392, 435-440`; `auth/token.service.ts:662-671`; `auth/platform-session-end.ts:21-40`.

**Frontend impact.** The portal infers staff from a missing `kind` (`Health-id: apps/patient-web/src/api.ts:7-8`), cannot name why a session ended or warn before expiry, and checks `/auth/session` before signing out (a race remains). Once fixed: named end reasons, expiry warnings and a race-free sign-out.

**Required fix.** Add `kind: 'staff'` to staff actors (additive). Return `idleExpiresAt` and `absoluteExpiresAt` from `/auth/session` and refresh. When the presented token is provably the session's own (valid signature), answer `401 SESSION_EXPIRED` or `401 SESSION_REVOKED`, reusing `classifyPlatformSessionEnd`; never leak account existence. `POST /auth/logout` accepts an optional expected session id (body field or `X-HID-Expected-Session`); on mismatch answer **`409 SESSION_CHANGED`**, end nothing and keep cookies.

**Acceptance tests (failing first).** Spec: staff `/auth/session` includes `kind` and both expiries; an expired staff session answers 401 `SESSION_EXPIRED`; logout with cookies for session B and expected A answers 409 and B stays active; a match ends A. Extend `verify-session-sign-out-runtime.mjs`.

**Constraints.** No account enumeration; `X-HID-Client` kind checks and platform end reasons unchanged.

Source findings: ID-STAFF-SESSION-CONTRACT, ID-LOGOUT-TARGET, PROSE-L138b, "Staff session end - reason and expiry", "Staff session end - logout cannot name its session".

### B8 (P2). Registration case list/search and enrollment state

**Problem.** Staff can open a registration case only by id; after a refresh they cannot find pending cases or tell whether enrollment already happened.

**Evidence.** `services/identity-api/src/identity/nin-registration.controller.ts:16-75` (capabilities, resolve, get, approve-new, enroll, link-existing only); `services/identity-api/src/identity/nin-registration.service.ts:613-623` (projection has no enrollment state). Impact is limited while no production NIN provider exists (B9).

**Frontend impact.** The Registration screen cannot list or resume cases. Health-id hides case creation while NIN is unavailable (B9).

**Required fix.** `GET /api/v1/identity/registration-cases?status=&cursor=` (facility-scoped, permissioned, masked NIN, audited); `accountEnrollment: { state: 'none' | 'invited' | 'active', enrolledAt }` on the case projection.

**Acceptance tests.** Spec and `verify-registration-review-runtime.mjs`: another facility's cases are invisible; the projection reports enrollment after `POST enroll`.

**Constraints.** Masked NIN only; facility RLS; every list audited.

Source findings: PROSE-L134, "Provider registration case continuity".

### B9 (P2). No production NIN provider for provider-initiated registration

**Problem.** Registration-case NIN resolution is enabled only in `test` mode; staging `deferred` answers 503; production has no provider.

**Evidence.** `services/identity-api/src/identity/nin-registration.controller.ts:16-24` (enabled only in `test` mode); `services/identity-api/src/config/environment.ts:90, 153-158`; `services/identity-api/src/identity/nin-verification.provider.ts:45-79` (Unavailable, Deferred, DeterministicTest only); deferred answers 503 `NIN_PROVIDER_DEFERRED` (masked by A8).

**Frontend impact.** Health-id hides provider-initiated case creation.

**Required fix.** A production adapter for the registration-case resolver (e.g. QoreID, as patient self-verification uses), behind the existing release gates; credentials are D5.

**Acceptance tests.** Runtime verifier with a production-shaped provider stub: `nin/resolve` creates a case and `registration-capabilities` reports enabled.

**Constraints.** Release gates and NIN keys unchanged; `test` mode stays refused outside `NODE_ENV=test`.

Source findings: "Provider-initiated patient registration", ID-NIN-REGISTRATION.

### B10 (P2; campaign writes need E5). Outreach registration-case list capped at 100 with no cursor; campaign writes refused

**Problem.** The case list returns the newest 100 with no cursor, so older pending cases cannot be resolved from the UI. Campaign create, status and member writes answer 400 `VALIDATION_FAILED` by design until governance is decided.

**Evidence.** `services/outreach-api/src/outreach/outreach.service.ts:70-77` (`order by created_at desc,id desc limit 100`, plain array); `services/identity-api/src/identity/dto/authorize-outreach.dto.ts:3-12` (`outreach.campaign.write` not authorized, so create/status/member writes answer 400); `services/outreach-api/README.md:12-15`; ADR-045 `docs/DECISIONS.md:2090-2093` (status line still "Not merged or deployed"; #43 is merged); `docs/HEALTH_ID_OUTREACH_CAMPAIGN_CONTRACT.md:5` (still describes creation as working).

**Frontend impact.** The Outreach page shows at most 100 cases with no notice and offers link-existing only from list cards; Health-id hides campaign write actions until E5.

**Required fix.** Keyset paging and a `status` filter (`identity_resolution_pending`) on the case list, returning `{ items, nextCursor }`. After E5: enforce campaign governance in `OutreachService` and the RLS of `0038`/`0045` (new migration), then add `outreach.campaign.write` to `OUTREACH_PERMISSIONS`. Until then consider removing `outreach.campaign.write` from role grants (`0038:12-17`) so clients do not see an unusable permission. Fix the ADR-045 status line and the campaign contract doc now.

**Acceptance tests.** `verify-outreach-runtime.mjs`: with 101 cases the oldest pending one is reachable by cursor or filter; after E5, a nurse with `outreach.campaign.write` cannot add themselves as campaign admin and an org_admin can create a campaign and add an enumerator.

**Constraints.** Campaign writes stay refused until E5's governance is enforced; cookie reads (#43) unchanged.

Source findings: OUTREACH-03, PROSE-L129.

### B11 (P2). A clinician cannot list their own active grants (break-glass included)

**Problem.** The staff access-request list excludes break-glass grants and caps at 100 rows with no cursor, so after a reload a clinician cannot see their own active emergency grant (closing it needs its id).

**Evidence.** `services/ehr-api/database/migrations/0074_staff_access_request_outcome.sql:139` (`break_glass = false`), `:146` (`limit 100`, no cursor); `services/identity-api/src/consent/consent.service.ts:85-104`; close needs the grant id (`consent.controller.ts:103-117`). A re-POST of `/identity/break-glass` replays the active grant's id without extending it (`0031_emergency_notification_and_rate_limit.sql:119-154`), which Health-id will use as a workaround.

**Frontend impact.** Health-id will recover the grant id through the break-glass replay; a listing removes the workaround.

**Required fix.** `GET /api/v1/identity/consent-grants/mine?status=active&cursor=` (grantId, patientId, hid, purpose, scope, expiresAt, breakGlass, authorizationMethod), new SQL function plus runtime grant; or include break-glass rows (`breakGlass: true`) and a cursor in the existing list.

**Acceptance tests.** Activate break-glass; in a new request list and close it (200); the grant no longer authorizes the emergency summary.

**Constraints.** Replay semantics (no extension, no new notification) unchanged; close still needs a reason and the `break_glass_enabled` control.

Source findings: BE-BREAKGLASS-GRANT-UNLISTABLE (severity lowered by the verifier).

### B12 (P2). No facility OCR job list

**Problem.** `GET /ocr/jobs` requires a `documentId` and returns one job; there is no facility list of jobs awaiting validation or failed.

**Evidence.** `services/ocr-api/src/ocr/dto/find-ocr-job.dto.ts:3-5` (`documentId` required); `services/ocr-api/src/ocr/ocr.controller.ts:30-35`.

**Frontend impact.** Migrate reaches a job only through a document inside an encounter, and the portal says so.

**Required fix.** `GET /api/v1/ocr/jobs?status=&cursor=` facility-scoped: job metadata only, or per-row patient authorization; audited listing.

**Acceptance tests.** Two jobs awaiting validation at the facility are listed; another facility's job is not.

**Constraints.** Facility-scoped; metadata only or per-row patient authorization.

Source findings: BE-OCR-JOB-QUEUE, GAP-L88.

### B13 (P2). Documents without an encounter cannot be listed

**Problem.** Upload makes `encounterId` optional, but the list requires it, so documents uploaded without an encounter cannot be listed.

**Evidence.** `services/ehr-api/src/documents/dto/list-documents.dto.ts:3-6` (`encounterId` required) while `create-document-upload.dto.ts:20` makes it optional.

**Frontend impact.** Such documents never appear in the clinical record's document list.

**Required fix.** Make `encounterId` optional on `GET /ehr/documents` (patient-wide list, paged with a cursor), with the same authorization.

**Acceptance tests.** An upload without an encounter is listed for the patient; an encounter filter still works.

**Constraints.** Authorization unchanged.

Source: auditor note (gapmap-2).

---

## 5. Class C: unmerged and unreleased work

### C1. PR #47: facility selection kept per sign-in (ADR-046, migration 0080)

Branch `claude/facility-selection-persistence`, head `1c18e91`, CI green, **not merged** (`1c18e91` is not an ancestor of `6b49a06`). On `main`, `POST /auth/facility` stores nothing; refresh always resolves the primary facility, and so does `GET /auth/session` unless the request carries a valid `X-Facility-ID` for one of the actor's facilities, which the guard binds (`services/identity-api/src/auth/security.guard.ts:114-126`). Evidence: `services/identity-api/src/auth/auth.controller.ts:395-433`; `current-staff-context.service.ts:188-200`; `token.service.ts:564, 851` never pass `preferredFacilityId`. Health-id PR #42 implements the client and can merge before #47 (it is dormant until Identity sends `facilitySelection`).

You decide release placement. Before merging:
1. **Refresh failure path.** On the branch, when the selection read fails after rotation, refresh sets the rotated cookies and answers 503 (`#47@1c18e91 services/identity-api/src/auth/auth.controller.ts:255-261`; the read fails as 503 `DEPENDENCY_UNAVAILABLE` at `:516-523`). Through the gateway that 503 loses its `Set-Cookie` (A8), the browser keeps the spent refresh token, and the next refresh revokes the family. Either land A8 first, or answer **200** with the rotated cookies and a selection state that says the choice could not be read (a new value such as `'unavailable'`, which is a contract change Health-id #42 must handle; the branch's type allows only `'selected' | 'default' | 'reselect'`, `#47@1c18e91 services/identity-api/src/auth/auth.types.ts:54`). Do not report `'default'` in that case: ADR-046 rightly refuses to report a facility the user did not choose. Also apply A6 on the branch: its first try block (`:242-247`, around the rotation) still clears cookies on any error, 5xx included, and its last try block (`:262-270`) still clears them when the success audit fails after the committed rotation.
2. **Product decision E7** (ask at every multi-facility sign-in, or only on `reselect`) must be made before #47 is **deployed**; not before it merges.

Deploy order (from the branch's `docs/MIGRATION_RUNBOOK.md` row): **apply 0080 and run the role bootstrap (`db:bootstrap`, `db:verify-roles`) before the Identity build that reads the table serves traffic.** Without the table every staff `GET /auth/session` and refresh answers 503 and no staff page loads. The previous Identity ignores the table. 0080 takes `SHARE ROW EXCLUSIVE` on four tables briefly; it fails cleanly after the 5 s lock timeout and can be re-run.

Contract changes to announce:
- `facilitySelection: 'default' | 'selected' | 'reselect'` on sign-in, `/auth/session`, refresh and `POST /auth/facility` responses;
- `POST /auth/facility` can answer 401 if the sign-in ended;
- `GET /auth/session` can answer `503 DEPENDENCY_UNAVAILABLE`, with cookies untouched, when the stored choice cannot be read;
- refresh can answer `503 DEPENDENCY_UNAVAILABLE` with the rotated cookies and `X-CSRF-Token` set and no actor in the body (`#47@1c18e91 docs/INTERFACE_CONTRACT.md:192-198`; `services/identity-api/src/auth/auth.controller.ts:255-261, 516-523`), unless item 1 changes it to a 200.

Source findings: HID-47-UNMERGED, ID-FACILITY-NOT-PERSISTED, "Facility selection after reload - backend", "Organization/facility selection", PR42-PRODUCT-ASK-EVERY-SIGNIN.

### C2. Merged on `main`, not known to be released

`main` has no release tag. The release-readiness doc says nothing it covers (the database through 0079) has been deployed and no staging or production database has been migrated (`docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:20-21, 28`), and that none of the §7 staging checks (S1-S6, including S4a-S4h) has been run because no staging environment exists (`:403-424`, statement at `:405-407`). Health-id treats these as unreleased:
- **#39** sign-out by refresh cookie and `X-HID-Client` kind checks (S4e);
- **#41** www `/provider/recover` (`apps/web/src/App.tsx:221`);
- **#42** Identity session-route refusals audited instead of 503;
- **#46** EHR and OCR guard refusals before a facility is bound, audited instead of 503;
- also #31 (Lab: patient authorization before listing a specimen's executions), #33 (Stage 8 fail-closed session guards and OCR worker leases, migration 0077; merge `54f79d2`), #34 (Stage 9: runtime-role row locks, migration 0078, SERIALIZABLE retry; S4g, S4h), #35 and #36 (OCR publication retry), #37 (patient signup-to-sign-in runtime verifier only; no product code), #38 (delegated cookie reads, S4d), #40 (timeline cursor precision, S4f), #43 (Outreach cookie reads), #44 (exact `requestedAt`), #45 (PIN actor window, 0079), with migrations 0077-0079 and their bootstrap order (§2, §5, §9 of the release-readiness doc).

Ask: state which commit is deployed in each environment; plan the release that carries these (respecting the documented migration-then-bootstrap-then-deploy order); run the §7 staging acceptance (S1-S6, including S4a-S4h) on staging (D3); tell Health-id when each lands so it can drop its interim handling.

Source findings: PROSE-L137, "Staff sign-in, recovery and enrollment on product hosts - release and hosting" (release half).

---

## 6. Class D: infrastructure and deployment (code PRs allowed; applying them needs separate authorization)

**D1. Hosting and same-origin `/api/v1` for the Health-id portals.** Cookies are host-only and `SameSite=Strict` with the refresh cookie on `/api/v1/auth` (`services/identity-api/src/auth/auth.controller.ts:492-506`), and the CSRF cookie must be readable on the portal origin, so the portal must call `/api/v1` on its own origin. Every worker serves a hid-system app (`infra/cloudflare/workers/*/wrangler.json`; `infra/cloudflare/src/frontend-worker.mjs:10-35, 128-187`); Health-id has no deployment definition. Decide which application serves www and each product host (with E8); add worker definitions that serve Health-id builds with the same `/api/v1` proxy (preserving Origin, cookies, `X-CSRF-Token`, `X-HID-Client`, `Idempotency-Key`, `If-Match`); retire or redirect the legacy `apps/admin` on `admin.healthidentitydirectory.com` (`infra/cloudflare/workers/hid-admin/wrangler.json`; it signs in with staff `POST /auth/login`, `apps/admin/src/App.tsx:63`, which platform routes refuse); either proxy `/gateway-health/*` or have Health-id drop those registry entries, and make `/gateway-health/ready` check upstreams (`gateway/nginx.conf.template:17-21`). Verify in a real browser that Google Identity Services sign-in works under the worker's `Cross-Origin-Opener-Policy: same-origin` (`frontend-worker.mjs:38`); GSI popup mode documents `same-origin-allow-popups`. Test: on each host, browser sign-in, refresh, logout and one CSRF mutation per service succeed; platform MFA sign-in on admin. Sources: PROSE-L141, "Production /api/v1 routing", "Legacy admin app and hostname", INFRA-HOSTING-AND-LEGACY-ADMIN, "Staff sign-in ... release and hosting" (hosting half); security auditor note (COOP).

**D2. Turnstile actions per host.** Only www and staging accept `patient-login`, `staff-login` and `admin-login` together, plus `staff-reset`, `provider-enrollment` and `patient-enrollment`; admin accepts only `admin-login` and `admin-reset`; the lab, pharmacy, migrate and outreach hosts accept only their own `*-login`, and the ehr host accepts `ehr-login` and `staff-login` (`services/identity-api/src/auth/turnstile.service.ts:24-53`, ehr at `:32` and `:46`). Health-id plans the admin console on the admin host and the unified portal on a host still to be chosen. After E8/E9, change `ACTIONS_BY_DEPLOYMENT` (with spec) and configure the Turnstile widget hostnames. Sources: "Portal hostname and Turnstile", "Staff sign-in ... decisions".

**D3. Staging environment and acceptance.** Stand up the staging gateway and services, seed principals and facilities, and run the §7 staging acceptance (S1-S6, including S4a-S4h and the S4b OCR pipeline; `docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:403-424`) and confirm P8 (schema owner, `:210`), then the Health-id patient, provider, admin, pricing and demo journeys through the same-origin proxy. Include: staff idle expiry, absolute expiry and revocation with real browsers (hidden, switched and bfcache-restored tabs never show a patient); Google OIDC, OTP delivery and Turnstile per host; a public organization application submitted and reviewed; Lab result visibility with absent, revoked and active grants (#31); A7 (two clients' OTP limits independent). Sources: "Staging acceptance", "Staff session end - browser and staging verification", "Google, OTP and bot checks", "Reference workflows - Migrate", PROSE-L137, "Provider organization application" (not a defect; only this proof remains).

**D4. Secrets and allowed origins per environment.** Every deployed portal origin in `CORS_ORIGINS` of Identity, EHR, Lab, Pharmacy, OCR and Outreach (built from fixed subdomains today, `infra/aws/src/hid-regional-stack.ts:748-749`; Identity checks Origin even on same-origin refresh, logout and OTP: `services/identity-api/src/auth/auth.controller.ts:26, 582-587`, `auth/otp.controller.ts:14-16, 52-56`, `auth/security.guard.ts:318-323`); `MFA_SECRET_KEY_B64` and `MFA_KEY_VERSION` mapped by infra (P3, `PHASE_4_STAGE_5_RELEASE_READINESS.md:205`; without it admin sign-in fails 503 `MFA_UNAVAILABLE`); `TURNSTILE_SECRET_KEY` (`turnstile.service.ts:74-76`); Google client IDs; Health-id public site keys per environment. Source: "Environment secrets and origins".

**D5. NIN/QoreID credentials.** Patient self-verification (QoreID) needs only credentials and configuration; provider registration cases first need B9. Test with safe identities on staging. Source: "NIN verification".

**D6. Content-Security-Policy.** No CSP anywhere (`infra/cloudflare/src/frontend-worker.mjs:37-42`). Add a header CSP with `frame-ancestors 'none'` for portal hosts in the worker (script/frame origins: `https://challenges.cloudflare.com`, `https://accounts.google.com/gsi/`; `connect-src 'self'` plus the presigned document-storage origin). Health-id adds its own meta/Next CSP. Test: extend `infra/cloudflare/test/frontend-worker.test.mjs`. Source: SEC-NO-CSP (shared with frontend).

**D7. Access-log query strings.** Interim mitigation for A24: drop `$args` from gateway and edge access-log formats for `/api/v1/admin/`. Source: SEC-ADMIN-SEARCH-IN-URL.

---

## 7. Class E: product decisions to obtain (with options)

- **E1. Emergency (break-glass) access** (blocks B1; informs A11). (a) Detailed chart: summary only (today) / all ordinary chart GETs read-only / a named subset. (b) Facility scope: current facility only (today; empty at an ER that never treated the patient) / break-glass reads all facilities read-only / also let patient-approved direct-care grants span facilities. (c) Summary content: keep the seven sections added unreviewed by `a486a23` / narrow back to completed encounters and signed notes / add allergies (no allergy model exists) and verified emergency contacts (today only notified). (d) Emergency documentation: none (today; an ER cannot record care for an unconscious patient: break-glass is read-only, `0012:80-101`; PIN grants are read-only direct-care, `0079:306-325`) / break-glass write limited to encounters, vitals and notes with mandatory retrospective review / a facility-attested emergency treatment grant. (e) Document list and download under `emergency`: allowed or refused. Source findings: BE-EMERGENCY-NO-WRITE, EHR-EMERG-02, "Emergency access to the detailed chart - policy", BE-EHR-FACILITY-LOCAL-RECORDS.
- **E2. Lab/Pharmacy fulfilment authorization and queue disclosure** (blocks B2). Per-member patient grants (today) / order-scoped fulfilment grant created on acceptance for the receiving facility / role-scoped queue with minimum disclosure (which fields) and per-patient grants for detail and writes / PIN verification for `lab` and `pharmacist` (this makes the queue visible only: a PIN grant is `read_records`, so accessioning, results and dispensing would still need a write grant; see B2). Must also cover Pharmacy acceptance (today a pharmacist needs a patient-approved EHR write grant). Source findings: BE-LAB-PHARM-PER-MEMBER-CONSENT, LABPHARM-02, "Lab and Pharmacy work queues - disclosure policy".
- **E3. OCR purpose of use** (blocks B4). One purpose (`direct-care`) for the whole job lifecycle / two purposes (`healthcare-operations` for job steps, `direct-care` for publication) with the purpose and requester shown to the patient. Also: refusals as 404 (hide existence) or 403. Source findings: OCR-01, BE-OCR-PURPOSE-SPLIT, "OCR purpose of use".
- **E4. Workforce for onboarded organizations** (blocks B3). Which facility roles each organization type gets at activation/approval / org_admin-managed invitations and role assignment; which roles org_admin may assign; step-up or two-person approval for admin roles; invitation channel (email OTP). Source findings: ID-NO-WORKFORCE, "Onboarded organizations have no clinical access", "Staff and role management", GAP-L114.
- **E5. Outreach campaign governance (ADR-045)** (blocks B10 writes, F outreach). Who may create and close campaigns (org_admin/admin only?), who may add members (campaign admins only?), members cannot raise their own role; whether field workers outside facility staff exist. Health-id's public outreach copy depends on it. Source findings: PROSE-L129 (campaign writes); GAP-L91 is the frontend copy that depends on it (section 9).
- **E6. Session policy** (B7). (a) Idle lifetime: `AUTH_REFRESH_TTL_SECONDS` defaults to 8 h (`config/environment.ts:43-45`) while the patient portal shows sign-in after the 15-minute access token lapses; set a shared-device timeout. (b) Expose end reasons and expiries to staff/patient clients. (c) Separate cookie names for patient sessions on the shared origin (as platform sessions have) vs keep the `X-HID-Client` mitigation; separate names need a coordinated frontend change. Source findings: ID-SHARED-SESSION-COOKIE, "Patient and staff idle lifetime", ID-STAFF-SESSION-CONTRACT, "Staff session end - reason and expiry".
- **E7. Facility chooser after #47 deploys** (C1). Ask at every sign-in when the person has more than one facility (Health-id #42 today) / ask only on `reselect` (ADR-046's own client guidance, `#47@1c18e91 docs/INTERFACE_CONTRACT.md:245-247`). Decide before deploying #47. Source findings: PR42-PRODUCT-ASK-EVERY-SIGNIN.
- **E8. Portal hostname** (D1, D2). Unified portal on www (the only production host accepting patient, staff and admin login) / another host (Turnstile change). Admin console on the admin host (retire legacy `apps/admin`). Source findings: "Portal hostname and Turnstile - hostname decision".
- **E9. Provider enrollment host and recovery return link** (D2). Keep `provider-enrollment` and `staff-reset` on www only; whether a fixed, validated return from `www/provider/recover` to the product host is wanted. Source findings: "Staff sign-in, recovery and enrollment on product hosts - decisions".
- **E10. Patient lookup existence** (`services/identity-api/src/identity/identity.service.ts:33-48`: 404 unknown HID vs 403 known without consent, generic codes). Hide existence (one answer for both) / keep the distinction; in both cases use domain codes `PATIENT_NOT_FOUND`, `PATIENT_ACCESS_NOT_AUTHORIZED`. Source findings: ID-LOOKUP-ENUM.
- **E11. OTP recovery audience** (`services/identity-api/src/auth/otp.controller.ts:20-36`, `otp.service.ts:80-146`). Any account kind for any recovery action (today) / bind `staff-reset`, `admin-reset` and `patient-reset-start` to their account kinds, keeping identical public responses. Source findings: "OTP recovery audience".
- **E12. Patient access history** (`0066_patient_access_safety.sql:393-412`: latest 50 grants, no paging). Grants only / actual record-access events (facility, time, purpose) with paging. Source findings: ID-ACCESS-HISTORY-CONTRACT.
- **E13. Admin exact totals.** Cursor paging only (today) / exact waiting counts on `GET /admin/overview`. Source findings: "Admin list caps".
- **E14. EHR audit route.** EHR's `GET /audit/events` (`services/ehr-api/src/audit/audit.controller.ts:8-12`) is unreachable because the gateway routes `/api/v1/audit` to Identity (`gateway/nginx.conf.template:34-35`). Retire it / expose it as `/api/v1/ehr/audit/events`. Source findings: "Facility audit and provider reporting" (audit half; the reporting half is in F).
- **E15. Patient result release** (B6). Show released Lab results to patients immediately / after a delay or clinician sign-off. Source findings: auditor note (gapmap-1) for patient results (B6).
- **E16. Patient self-service and commercial scope** (F). Which profile fields patients may edit (contact details with re-verification; NIN-verified name and date of birth through review only); patient-reported history; patient-created share grants beyond the Access PIN; offers, free periods and trials. Source findings: "Free periods/offers", "Patient bio-data/profile edit", "Structured medical history editing", "Patient sharing/invites", "Reference workflows - Patient account".

---

## 8. Class F: feature APIs the reference workflows need (roadmap only)

Each needs a product decision (E16 or scoping) and then a contract (ADR, migration, RLS, audit) before any Health-id screen. None exists at `6b49a06`.

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

- **Frontend-owned decisions, not backend work:** indefinite workspace lock policy; authenticator QR encoder; retry and messaging when Lab result access cannot be verified (its staging check is in D3); public outreach marketing copy (its dependency is E5).
- **Corrections from the verification pass, already reflected above:** EHR's `/ehr/me/records` 503 originates in EHR's own interceptor, not Identity (A9); jose errors are already wrapped as `UnauthorizedException` (A4); the queue "status filter" cannot work because `status` is always `accepted` (A2); required-to-rejected specimens are not intended, so no decision is needed (A12); entered-in-error rows already carry their status (A11); the emergency summary returns seven sections, not two, and document list/download plausibly work under break-glass (B1); break-glass is read-only by `0012`, so the document policy question covers reads only (E1); a break-glass grant id can be recovered by replay, so B11 is P2; the platform-admin bypass must become a `kind === 'platform'` check, not be removed (A16); prefer an explicit 403 `ORIGIN_DENIED` over `callback(null, false)`, which would let a disallowed origin through to the handler with only the browser's read block (A19); "local workload mode in production" is unreachable (A5); clinicians can derive dispensing state from the Pharmacy list, but only reliably once A2 ships (B6); the gateway assertion at `verify-container-platform.mjs:206` stays valid (A8).
- **Frontend work Health-id will do itself (do not do it here):** render the emergency summary's added sections only if E1(c) keeps them, and then render vitals only after A11(a) ships (the summary returns uncorrected vitals today, `patient-records.service.ts:67-73`) and documents only after A11(b) ships (scanner-rejected documents are included today, `:95-99`); stop offering Reject on `required` specimens; restrict prescription Cancel/Hold after handoff until A1 ships; reuse one OCR publication key per validation; join the Pharmacy list for dispensing status as an interim only (unreliable until A2 or B6's `?sourceEhrPrescriptionId=` ships); offer a `healthcare-operations` access request on Migrate if E3 keeps two purposes; recover a break-glass grant id by replay; show a queue-cap notice until A2 ships; treat 403 `PATIENT_SESSION_REQUIRED` as a changed session after A9.

## 10. How to report back

For each issue ID, reply with:
1. **PR link**, branch, and the issue IDs it closes (or the parts it closes).
2. **Tests:** the failing-first test names and the failing output on `main`; the passing run; gates run (service typecheck, lint, test; root `npm test`, `npm run verify`; migration rehearsal when applicable) and their results.
3. **Contract changes the frontend must know about:** each route (method, path), request fields and headers, response fields, status codes and error codes added or changed, default behaviour changes (for example A2's `state=open` default), and anything removed or deprecated (with the deprecation release).
4. **Migrations and deploy order:** migration number, lock impact, whether the role bootstrap is needed, and the required order relative to which service deploy.
5. **Docs updated** (file and section).
6. **Open items:** decisions still needed (by E-number), parts not done, risks, and anything in this document you found to be wrong at the time you worked on it (with evidence).
7. For C1 and C2: the release that carries each PR, and the commit deployed per environment once known.

## Reviewer notes rejected

Each review correction was re-checked against hid-system `6b49a06` (and #47 at `1c18e91`) before it was applied. All of them were applied except the following, which were rejected or adjusted:

- **C2, "S4a-S4h are all unrun is inferred" (rejected).** The release-readiness doc says it directly: "None of them has been run, because no staging environment exists yet" (`docs/PHASE_4_STAGE_5_RELEASE_READINESS.md:405-407`, covering S1-S6 and S4a-S4h), and "Nothing here has been deployed" (`:20-21`). C2 keeps the statement, now cited to `:403-424`.
- **A4, example of a leaked 401 detail (adjusted).** "Refresh token reuse detected" (`token.service.ts:287`) is thrown only on `POST /auth/refresh`, which is `@Public` and never reaches the guard. A4 uses a guard-path message instead (`current-staff-context.service.ts:152`). The rule itself was applied as given.
- **A19, "every other Identity `@Public` POST checks Origin" (adjusted).** Every browser-facing one does. The workload-only `POST /identity/service/workloads/document-scanner/authorize` (`identity.controller.ts:49-63`) is `@Public` and checks no Origin; it requires workload authentication instead. A19 lists only the browser-facing routes.
- **C1, contract citation (adjusted).** The 503 behaviour of `GET /auth/session` and refresh is at `#47@1c18e91 docs/INTERFACE_CONTRACT.md:192-198`, not `:189-195` (`:185-190` is the table). The handler lines are `auth.controller.ts:255-261` (refresh) and `:516-523` (`withFacilitySelection`).
- **A11/section 9, P0 or conditional (choice).** The review offered either raising A11(a)/(b) to P0 or making the Health-id rendering conditional. The conditional option was taken, so the counts are unchanged (A11 stays P1).
