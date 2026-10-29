# Frontend verification report

Date: 2026-10-03 (Africa/Lagos). Scope: frontend production readiness only.

**Verdict: NOT READY.** The implemented regression journeys pass, and the rendered route sweep is clean. Confirmed client-side privacy/reliability gaps and unverified acceptance gates prevent readiness sign-off. Backend implementation is not being counted as a frontend blocker.

## Executed checks

| Check | Result |
|---|---|
| TypeScript | Pass: `npm run typecheck` |
| Build | Pass: `npm run build` |
| Full existing Playwright suite | 42/42 passed, 1.6 minutes |
| Workspace route sweep | 75 list/create/workspace cases at 1440, 820 and 390px: 225 checks |
| Catalogue coverage | No catalogue list routes missing; creation routes visited where an actual sampled role has create permission |
| Workspace measurements | Zero page-width overflows, unnamed visible native controls, visible error alerts or uncaught page errors in the visited states |
| Authentication | Six entry screens at 1440, 820, 390 and 320px: 24 checks, no page-width overflow |
| Narrow workspace checks | Dashboard, patients, new patient and profile at 320px: four checks, no page-width overflow |
| Large-list probe | 2,000 fictional patients render 2,000 rows / 24,233 DOM nodes |
| Local measured timing | Latest run: render 1246ms; filter 2070ms, including browser automation waits |
| Bundle | 1,205,135 bytes raw; 215,184 bytes gzip estimate |
| Search privacy reproduction | Search persisted unencrypted and survived sign-out: CONFIRMED |

Timing is a diagnostic sample on local desktop Chrome with a warm app, no CPU/network throttling and no established release budget. It is not a device-independent benchmark. Document-age values in the route sweep are explicitly not load timings because hash navigation retains the document.

## Findings and acceptance work

| ID | Priority / status | Finding and evidence | Required frontend outcome |
|---|---|---|---|
| FE-01 | High, confirmed defect | `src/workflows.tsx:31`, `:162`, `:314` persist search terms in `localStorage` under `filter-<module>`, without user/facility scope. The browser probe confirms they survive sign-out. Queries can contain patient names or identifiers. | Keep sensitive search transient or use the authorized encrypted scope; purge legacy plaintext queries and verify sign-out/account/facility isolation. |
| FE-02 | High, source-confirmed reliability gap | `src/sync.ts:156` keeps retrying with bounded delay but no attempt threshold moving repeated failures into attention. `src/offline.tsx:171` directly renders the saved exception message. | Persistent, plain-language attention state after repeated failure; per-item retry; preserve the item and suppress raw technical error text. |
| FE-03 | High, incomplete agreed client behavior | Sync handles record batches and conflict resolution, but offline duplicate identity review, high-risk inbound refresh, resumable/dependency-aware media and account/profile queue transport remain open. `src/storage.ts:647` queues record changes; `remoteRecords` has no inbound refresh consumer. | Complete those frontend flows against mock contracts, with durable state, cancellation/retry and failure tests. Real server implementation remains outside scope. |
| FE-04 | Medium, measured scalability concern | `src/workflows.tsx:357` maps all filtered rows directly. The 2,000-patient probe produced 24,233 DOM nodes and slow end-to-end filtering. | Bounded rendering/pagination or virtualization; define client performance budgets and verify realistic lists on constrained devices. |
| FE-05 | High, integration acceptance incomplete | Views directly call the local service; endpoint notes exist, but interchangeable remote/mock adapters and their complete error/cancellation/revision contracts are not verified. | A tested client integration boundary using mocks for expected responses, expired sessions, denied access, conflicts, rate limits and transport failures. Do not require a live backend to verify this. |
| FE-06 | Release gate, evidence incomplete | Checks ran on Chromium/Chrome only. Native-control name checks do not establish WCAG compliance. All detail/action permutations, manual screen-reader use, true browser zoom, Safari/Firefox and all physical-device behaviors remain unverified. | Complete the state/action/role matrix and accessibility/browser acceptance with recorded findings. |

## Coverage limits

The 225 route checks inspect currently rendered list/create/workspace states, using one authorized role per route. They do not validate every role/action combination, every record status, every modal/drawer or every field-validation branch. Patient-dependent create forms select an available fictional patient to expose fields. Authentication registration checks cover the entry step; the existing facility test covers the five-step journey. A 320px viewport check is not a substitute for true 400% zoom testing.

Controls were screened using visible native elements, associated labels and ARIA attributes. This is a basic naming check, not an accessibility engine or assistive-technology certification. The sweep is automated geometry/state inspection, not a claim that every screen received human visual review. Existing screenshot reviews and overlay tests remain supplementary evidence.

## Reproduce

With the local server running: `npm run typecheck`, `npm run build`, `npm test`, `node verify-frontend.cjs`, `node verify-frontend-limits.cjs`.

The scripts create isolated fictional browser data. Raw results: [route sweep](artifacts/frontend-verification.json), [authentication, narrow layouts, load and privacy probes](artifacts/frontend-limits.json). The second script reproduces the search-retention issue and signs out afterward. No production user data or external services are used.

Remediation order: FE-01 privacy, FE-02 sync failure handling, FE-03 remaining client workflows, FE-04 bounded rendering, FE-05 integration contracts, then FE-06 final acceptance. This verification turn adds evidence and scripts; it does not claim these findings have been fixed.
