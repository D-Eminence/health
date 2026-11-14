# HID Phase 0 Frontend Integration Audit

## Scope

This is the Phase 0 baseline for `Health-id` against the authoritative `hid-system` contracts.

Backend reference: `D-Eminence/hid-system` branch `capability-gap-closure-clean`.

## Current frontend structure

Confirmed:
- `apps/public-web`: public site, pricing, demo requests and provider application/completion
- `apps/patient-web`: authenticated patient, provider/staff and platform/admin workspaces
- `packages/api`: registered service bindings
- `packages/auth`: browser/session guards
- `packages/http`: HTTP client and CSRF/session transport
- `packages/contracts`: browser/API route contracts

## Existing integration matrix

| Surface | Existing frontend | Backend contract status | Action |
|---|---|---|---|
| Patient sign-in | Existing | Existing identity/auth | Stabilize and test |
| Patient enrollment by NIN | Existing | Existing governed enrollment | Stabilize and test |
| Contact verification | Existing | Existing | Stabilize and test |
| HIDCode activation | Existing | Existing | Stabilize and test |
| Google sign-in/onboarding | Existing | Existing | Stabilize and test |
| Patient profile | Existing | Existing identity/me | Complete UI data coverage |
| Patient records | Existing | Existing EHR records | Complete timeline/data presentation |
| Access history | Existing | Existing | Complete UI |
| Access requests | Existing | Existing | Complete UI |
| Access PIN | Existing | Existing | Complete UI and tests |
| Notifications | Existing | Existing | Complete UI and delivery-state handling |
| Provider/staff sign-in | Existing | Existing | Stabilize and test |
| Facility selection | Existing | Existing | Stabilize and test |
| Patient lookup | Existing | Existing | Complete authorization states |
| Provider access requests | Existing | Existing | Complete workflow |
| Provider clinical workspace | Existing | Existing EHR contracts | Complete missing record mutations/views |
| Lab | Existing | Existing lab service | Wire complete worklist/result flows |
| Pharmacy | Existing | Existing pharmacy service | Wire complete dispensing flows |
| Clinical documents | Existing | Existing file/document contracts | Complete UI workflow |
| Facility audit | Existing | Existing audit route | Complete filters/pagination |
| Break-glass | Existing foundation | Existing backend authorization | Complete end-to-end UI |
| Admin workspace | Existing | Existing admin foundation | Phase 4 enrichment/lifecycle |
| Public pricing | Existing | Existing pricing catalog | Keep backend authoritative |
| Demo requests | Existing | Existing commercial API | Keep backend authoritative |

## Important architecture finding

`Health-id` already consumes `/api/v1` contracts from the new architecture. Its patient API explicitly targets identity, EHR, access history, access requests, notifications and access PIN. Its staff API explicitly targets facility-scoped identity, patient lookup, encounters, clinical records, laboratory, pharmacy, OCR, outreach and audit.

Therefore Phase 1 and Phase 2 should be integration completion and contract hardening, not a rewrite into legacy APIs.

## Legacy boundary

Do not introduce:
- Supabase client calls
- Supabase database reads/writes
- legacy signed-file APIs
- legacy portal-only authorization
- duplicated clinical state in the frontend

Any unsupported workflow should remain visibly unsupported until the corresponding authoritative backend domain exists.

## Phase 0 deliverable

This audit establishes the working order:
1. Phase 1 patient integration
2. Phase 2 provider integration
3. Phase 3 lifecycle and emergency safety
4. Phase 4 platform administration
5. Phase 5 analytics and AI governance
6. Phase 6 billing
7. Phase 7 core hospital workflows
8. Phase 8 specialized clinical workflows
9. Phase 9 hospital operations
10. Phase 10 hardening

No merge or deployment is implied by this audit.
