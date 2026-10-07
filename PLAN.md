# Connect the two chatbots to the staging frontend

Date: 2026-10-07. Phase: **Implementation**, authorized by the owner's request
to read and implement this plan. This is the focused plan for item 1 in
the owner's current staging delivery list.

## Objective

Make the deployed support chatbot available from the new Health ID frontend,
and connect authenticated patients to the existing patient-record chatbot.
Complete staging configuration, release and verification for each feature,
recording actual results and remaining dependencies separately.

## Baseline established from the repositories

- Frontend: `D-Eminence/Health-id`, checkout `integration/hid-frontend`, branch
  `staging-frontend-20261006`, current source
  `a247ca31711953230dd509eb3f823509dc1b4d59`. The eight staging frontends are
  deployed; this checkout has no chatbot UI or registered chatbot routes.
- Backend: `D-Eminence/hid-system`, checkout `integration/hid-application`,
  accepted source `fe5b30eba5b087f75a8669caaecf76793f44908b`. EHR and support
  services contain the chatbot implementations. Existing gateway routes exist.
- Support/Lex is already deployed and enabled. Prior live FAQ/fallback checks
  passed; repeat a small current readback before this release.
- Patient chat code is deployed in EHR, but `infra/terraform/environments/staging.tfvars`
  currently has `enable_ai = false`. This disables EHR chat and omits the AI
  module's private Bedrock endpoint and inference permissions. A frontend flag
  alone cannot activate patient chat.
- The owner accepted processing across EU countries on 2026-10-05. Reuse that
  decision; verify the configured profile's actual destinations/access at rollout.
- The old `infra/terraform/environments/staging-frontends.json` flags do not
  configure this new repository. Its build currently uses `config/staging.json`
  and the `VITE_HID_` / `NEXT_PUBLIC_HID_` prefixes.
- Existing backend patient chat reads current signed/amended **clinical notes**.
  It does not retrieve archived imported medical records, attachments, lab results
  or prescriptions. No released notes produces an explicit empty-history answer.

These are source and recorded-release findings, not a fresh live infrastructure
audit. Refresh deployed metadata in implementation before changing configuration.

## Scope and decisions

1. Support: an accessible "Support chat" widget on the public website
   (`www.staging.healthidentitydirectory.com`) and patient portal
   (`staging.healthidentitydirectory.com`), including its sign-in/recovery pages.
   Use approved FAQs and `mailto:support@healthidentitydirectory.com`.
2. Patient: an "Ask about your records" page at `/chat`, linked from the
   authenticated patient navigation on the canonical patient portal. Apply the
   existing patient route/session guard; do not expose patient chat in public,
   provider or platform-admin workspaces.
3. Use the shared registered API client, cookie sessions, CSRF and same-origin
   `/api/v1` proxy. No direct browser calls to Lex, Bedrock or internal ECS names.
4. Keep exchanges and support session IDs in component memory. Clear patient
   drafts, replies and in-flight work on logout, account change and route unmount.
   Do not store chat content in browser storage, URLs, logs or release receipts.
5. Render replies as plain text with separate source entries. Do not interpret
   model/provider text as HTML. Do not invent links to unsupported record routes.
6. Add strict public flags `supportChatEnabled`, `patientChatEnabled` and the
   support contact to the new build/configuration path. Defaults are false;
   enable only the intended hosts. Patient requests require backend AI readiness.
7. Reuse existing backend images. New Docker builds are required only if a
   verified backend defect requires a code change. Frontend changes require new
   static archives through the existing GitHub Actions workflow.
8. Production, Pierflow, NIN enrollment, SMS/WhatsApp, application settings and
   database migration are outside this plan. Terraform remains on `dev` and must
   not be pushed. No CDK changes.

## Confirmed API contracts

| Feature | Route and request | Response | Access and limits |
| --- | --- | --- | --- |
| Support | `POST /api/v1/support/chat`, `{ text, sessionId? }` | `{ sessionId, messages: string[] }` | Public; trimmed text 1-500 characters; UUID v4 session; maximum four messages of 1,000 characters each; gateway/service rate limits |
| Patient | `POST /api/v1/ehr/me/chat`, `{ question }` | `{ status: 'ready' \| 'preparing', answer, sources: [{ number, noteId, revisionNo, title, signedAt }] }` | Authenticated patient only; cookie/CSRF; trimmed question 1-500 characters; patient derived by backend, never supplied in request |

Support returns safe JSON error codes for invalid input, rate limit or provider
failure. Patient returns existing Problem Details codes including
`PATIENT_CHAT_DISABLED`, `PATIENT_CHAT_UNAVAILABLE`, `PATIENT_CHAT_RATE_LIMITED`,
`CHAT_RECORD_SCOPE_EXCEEDED` and `CHAT_SOURCES_CHANGED`. Verify the deployed
response envelope through the existing HTTP decoder before finalizing parsers.

Patient chat has a 35-second backend operation budget and a 45-second gateway
read timeout. Give only this browser request a 40-second timeout; the shared
default is 15 seconds. Support can use a 10-second browser timeout (service
5.5 seconds, gateway 8 seconds). Preserve unrelated timeout settings. No general
automatic retry of chat POSTs; support/session/auth refresh behavior must not
replay an already successful exchange.

## Relevant files and resources

Paths below are relative to the frontend checkout unless prefixed `../../`.

| Area | Files/resources |
| --- | --- |
| Contract registration and types | `packages/contracts/src/registry.ts`, `boundaries.ts`, `domain.ts`, `index.ts`; contract tests |
| Typed clients and request options | `packages/api/src/services.ts`, `service.ts`, `index.ts`; shared HTTP and API tests |
| Feature configuration | `packages/config/src/environment.ts`, config tests; `apps/patient-web/src/env.ts`; `apps/public-web/lib/env.ts`; `config/staging.json`; `.env.example` |
| Patient UI/session | `apps/patient-web/src/App.tsx`, `api.ts`, `session.tsx`, `routes/Portal.tsx`, `index.css`; new chat page/widget tests |
| Shared support UI | New support widget in `packages/ui/src`; `apps/patient-web/src/App.tsx`; `apps/public-web/app/layout.tsx`; public client adapter under `apps/public-web/lib` |
| Build/admission | `scripts/build-staging.py`, `staging_release.py`, `test_staging_release.py`; `.github/workflows/staging-frontends.yml`; Cloudflare Worker tests |
| Publication/deployment | `../../infra/terraform/scripts/staging-new-frontend.py`; existing S3 release bucket and Cloudflare Workers; retained prior version IDs |
| EHR contract | `../hid-application/services/ehr-api/src/ehr/patient-records/patient-chat.dto.ts`, `patient-chat.service.ts`, `patient-records.controller.ts`, `bedrock-ai.service.ts` and tests |
| Support contract | `../hid-application/services/support-api/src/server.mjs` and tests; `../hid-application/gateway/nginx.conf.template` |
| AI configuration | `../../infra/terraform/environments/staging.tfvars`, `main.tf`, `modules/ai/main.tf`, `modules/application/workloads.tf`; EHR task role, VPC endpoint/security groups and ECS definition |
| Previous UI references | `../hid-application/apps/web/src/components/PatientRecordChat.tsx`, `SupportChat.tsx`; adapt behavior to the new repo, do not copy its old client imports |

Before editing public Next.js components, follow `apps/public-web/AGENTS.md`
and read the installed `next/dist/docs/` guides for client components/static
exports. Preserve the current static Cloudflare deployment.

## Implementation order and completion criteria

### 1. Refresh the scoped baseline

- [x] Check frontend branch/working tree and developer updates before editing;
  preserve their changes and identify the exact release base.
- [x] Read current EHR/support image digests, task environments, routing, alarms
  and previous Worker version IDs. Check the two exact API routes using synthetic
  support text and an anonymous patient request (must deny patient access).
- [x] Confirm the applied embedding migration and restricted EHR grants/RLS
  from existing evidence plus a scoped readback; do not repeat the DB migration.

Complete when actual deployment/configuration matches the planned baseline or
the discrepancy is documented with its precise effect on this release.

### 2. Register contracts, transport and feature flags

- [x] Register public support and authenticated EHR chat routes with explicit
  types and runtime response validation. Add the support service factory/export.
- [x] Grant support only to public/patient clients; add EHR chat only to the
  patient route grant. Keep provider/admin grants unchanged.
- [x] Pass per-request timeout/cancellation options through typed service calls;
  preserve cookie/CSRF handling and the recent anonymous-session correction.
- [x] Wire strict flags/contact through shared config, both framework adapters,
  staging config/build, validation and release manifests. Ensure unsupported
  hosts cannot mount patient chat even if they contain the shared portal bundle.

Complete when valid responses work, malformed responses fail safely, unsupported
clients/routes are rejected and flags are demonstrably present in built assets.

### 3. Implement support chat

- [x] Create a shared responsive widget with a labeled launcher, keyboard/focus
  handling, close/reset controls, message list and announced loading/errors.
  Inject the application's typed support-call callback into the shared UI;
  public and patient adapters retain their own registered client/boundary.
- [x] Submit 1-500-character text with an in-memory UUID v4 session; prevent
  concurrent sends. Bound visible transcript history and cancel on unmount.
- [x] Show approved human-support contact when the provider is unavailable;
  handle 429 without automatic resend. Never attach patient identity or records.
- [x] Mount on the public website and patient routes under the support flag.

Complete when public FAQ replies and contact fallback work without sign-in, and
mobile/keyboard operation and unavailable/rate-limited states pass.

### 4. Implement patient chat

- [x] Add guarded `/chat` route and navigation under the patient flag; reuse
  `useSession()` and its API rather than create another authentication path.
- [x] Add question form, busy state, bounded conversation, preparing/empty states,
  safe errors and citation/source display. Explain that replies use released
  clinical notes and do not replace the care team's advice.
- [x] Validate 1-500 characters, prevent concurrent sends, cancel stale work and
  clear content on session/account changes. Keep the no-records response accurate.
- [x] Handle 401/session expiry, 403, 409, 429, disabled AI and model timeout
  without inventing an answer or silently retrying generation.

Complete when the UI follows the confirmed backend response and cannot use a
staff/admin session or send a browser-chosen patient identifier.

### 5. Validate and review the code

- [x] Add focused tests for contracts/grants, flags, timeout/cancellation, CSRF,
  success, malformed response, preparing/empty results, errors and session cleanup.
- [x] Test support plain-text rendering, session reuse, fallback and accessibility;
  test patient citation rendering and denial outside patient routes.
- [x] Run the existing frontend gates: `npm run audit:boundaries`,
  `npm run check`, `npm run test:edge`, `npm run test:release`, and
  `npm audit --audit-level=high`. Preserve existing login/session regressions.
- [x] Review against this plan before publication. Correct findings and rerun
  the affected gates; record exact results rather than assuming earlier counts.

Complete when code review has no unresolved corrections for the feature being
released and the existing CI gates plus new meaningful regressions pass.

### 6. Activate the patient backend in staging

- [ ] Recheck configured `eu.anthropic.claude-sonnet-4-6` and
  `amazon.titan-embed-text-v2:0` access/quotas and destinations in the target
  account; reuse the owner's existing EU-processing approval.
- [x] Prepare a saved Terraform plan for `enable_ai = true` and
  `ai_allow_eu_processing = true`. Expected changes are the AI endpoint,
  security rules, EHR inference policy and EHR configuration/task rollout.
  Explain actual changes and resolve unexpected unrelated changes before apply.
- [x] Apply the scoped accepted plan using existing EHR image digest. Verify
  private network/IAM access, EHR rollout health and restricted embedding access.
- [ ] Evaluate synthetic released notes through the compiled service with its
  actual restricted workload role: empty history, known answer/citations,
  unsupported question, untrusted record instructions, changed/revoked sources
  and cross-patient denial. Check factual grounding, not citation syntax alone.
  Use governed temporary test data and cleanup; never alter customer records.

Complete when actual workload permissions and model responses pass. Existing
account model checks alone do not satisfy this. If the backend needs correction,
record the finding and build/publish only affected services through their current
workflow. A patient dependency must not hold a ready support release.

### 7. Build, publish and deploy the frontend release

- [ ] Enable support on its intended hosts. Enable the patient flag only after
  backend activation and synthetic authorization/grounding checks pass.
- [ ] Commit the reviewed frontend changes on the existing staging integration
  branch; use `staging-frontends.yml` to produce the source-bound eight archives
  and manifest. No new Dockerfile or separate build pipeline is needed.
- [ ] Validate exact source, CI outcome, configuration/lockfile/edge digests and
  archive hashes; publish to the existing encrypted versioned release bucket.
- [ ] Deploy the affected `web` and `public` Workers using a new receipt label;
  retain prior versions and preserve other portal releases. CI can build all
  eight artifacts without requiring all eight deployments.
- [ ] Verify HTTPS, asset hashes, public/deep-link routes, API proxy/security
  headers and unchanged sign-in/session behavior. Roll back affected Workers or
  disable the feature if verification fails.

### 8. Complete browser acceptance and handoff

- [ ] On public and patient sites, send controlled support questions and verify
  FAQ replies, unknown-question contact fallback and mobile/keyboard use.
- [ ] With an authorized controlled patient session, verify chat response,
  sources, empty history, reload/logout and session expiry. No fabricated session
  or password bypass; obtain owner participation if a test session is unavailable.
- [ ] Confirm another patient's records cannot be accessed and patient chat is
  unavailable to signed-out, staff and admin contexts. Check metadata-only logs.
- [ ] Record the release SHA, CI run, image/task references, Worker version IDs,
  synthetic checks and actual browser results; update the root tracker.

Done means each chatbot has its visible UI, working deployed API connection and
recorded acceptance. An API-only check does not close browser acceptance.

## Dependencies, limits and rollback

- **Activation progress:** patient AI infrastructure is enabled. Verify its
  existing Terraform path; no new provider API key is expected for IAM-based
  Bedrock/Lex access. Never request or expose credentials already saved.
- **Acceptance input:** a controlled authorized patient session is needed for
  browser acceptance; a second controlled patient context is needed for isolation
  testing. Existing customer accounts must not be repurposed or relinked.
- **Data coverage:** imported-history retrieval is a separate backend feature.
  This plan does not expand it or falsely mark it supported. Absence of released
  notes is a supported empty state, not a migration failure.
- **Actual model issues:** entitlement, quota, destination or grounding failures
  found during execution must include evidence and the required correction;
  do not label unperformed checks as confirmed blockers.
- **Rollback:** capture exact prior `web`/`public` Worker versions and EHR task
  definition/configuration. Disable patient/support UI independently and restore
  affected versions if necessary. Preserve embeddings/customer data; do not run a
  recursive Terraform destroy or repeat imports to undo a chatbot rollout.
- **Unchanged boundary:** no production rollout, Terraform push, CDK work or
  NIN enrollment activation. Implementation will update the checkboxes and
  explain any supported deviation before changing the architecture.

## Progress

### Implementation readback - 2026-10-07

- Frontend integration branch is still based on `a247ca3`; remote `main` has
  no newer changes (three integration commits ahead of main). Developer work
  was preserved. New chat code follows the existing registered client.
- Implemented public/patient support widget, guarded patient `/chat`, bounded
  memory-only transcripts, cancellation/account cleanup, plain-text sources,
  strict configuration and per-host release-manifest flags. Patient generation
  has a 40-second timeout; support has 10 seconds. POST retry behavior is unchanged.
- Review caught and corrected the EHR provider-client grant for the newly
  introduced chat route; only the patient application may call it.
- Validation: 273 tests in 34 files passed (`--maxWorkers=2`, avoiding an
  observed local cold lazy-import timeout), 30 edge tests passed, four release
  tests passed, boundary audit passed and npm audit found zero vulnerabilities.
  Type checking includes separate patient/public app checks, because the root
  package build does not include those application projects.
- Archived prior generated build assets under the root `tmp` folder before
  lint/release admission. They are release evidence, not source files. Normal
  Vitest/esbuild required execution with filesystem access to ancestor folders.
- Live support FAQ/fallback checks passed on both intended hosts; anonymous
  patient chat returned 401. Receipt: `../../tmp/staging-chat-routes.latest.json`.
- Activated the existing EU Bedrock infrastructure with a verified saved plan:
  five new AI resources, EHR task replacement and EHR service update only.
  Included the existing alert-email variable input and privately retrieved origin
  secret. EHR is healthy on task definition `hid-staging-ehr-api:4`, using the
  unchanged image `sha256:c64b3f409ef835b55b359660b748bcf8502c7d0e901ba0415f529fdb416a4b9c`.
  Processing profile destinations match the previously approved six EU regions.
- Synthetic evaluation confirms the actual EHR role is neither superuser nor
  RLS-bypassing, embedding SELECT/INSERT is allowed, UPDATE/DELETE is denied,
  forced RLS isolates patients, and the compiled authorization checks reject staff
  and mismatched patient contexts. Corrected temporary fixture HID, facility and
  account/subject bindings; every attempt rolled back without customer changes.
- A real generation attempt reached Bedrock but returned
  `ResourceNotFoundException` (HTTP 404). Fresh AWS model availability readback:
  authorization, entitlement and region AVAILABLE; agreement NOT_AVAILABLE.
  The EU inference profile is ACTIVE. Requested owner authorization for the
  one-time model agreement before accepting license terms/usage charges.
  Generation/grounding, changed-source and revocation acceptance remain open.
  Receipt: `../../tmp/staging-chat-ai-20261007/ChatSynthetic.latest.json`
  (task runner retains per-task receipts). No substitute model was selected.
- Added explicit regression coverage for shared-bundle provider/admin hostname
  denial and authenticated staff-session denial; 14 focused UI/host tests passed.
- Browser inventory reports no available browsers in this tool session. Browser
  acceptance is not claimed; owner participation remains the precise handoff.
- Patient frontend flag stays off until synthetic model/RLS checks pass.
  Support publication and affected Worker deployments follow now; patient activation
  waits for model access and generation checks. Browser acceptance remains open.

Acceptance distinction: the synthetic runtime evaluator calls published classes
with controlled authorization adapters and the actual restricted database role;
it creates no persistent session/token. This complements real RLS/model testing
but does not claim browser login or HTTP identity authorization is verified.
Authorized patient browser acceptance remains a separate final check.

- [x] Inspect repositories, existing contracts, feature configuration and release conventions.
- [x] Create this focused implementation plan and link it from the root plan.
- [ ] Implement, validate, review/correct, deploy and accept support chat.
- [ ] Implement, activate AI, validate, review/correct, deploy and accept patient chat.

The original planning phase changed documents only. The implementation phase
now includes frontend code, checks and the scoped Bedrock/EHR rollout above.
