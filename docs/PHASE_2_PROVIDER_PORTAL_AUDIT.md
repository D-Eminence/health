# Phase 2 Provider Portal Frontend Audit

## Scope

The existing staff application is the Provider Portal integration surface. Phase 2 verifies that it consumes authoritative hid-system contracts instead of legacy or Supabase APIs.

## Existing frontend capabilities

| Capability | Status |
| --- | --- |
| Staff/provider sign-in | Existing |
| Session and facility selection | Existing |
| Facility-scoped API headers | Existing |
| Permission-aware navigation/actions | Existing |
| Patient lookup by Health ID | Existing |
| Consent request | Existing |
| Patient PIN access | Existing |
| Break-glass emergency flow | Existing |
| Provider clinical dashboard | Existing |
| Encounters | Existing |
| Clinical notes and revisions | Existing |
| Vitals | Existing |
| Diagnoses | Existing |
| Prescriptions and Pharmacy handoff | Existing |
| Laboratory workflow | Existing |
| Clinical documents | Existing |
| Audit view | Existing |
| Server authorization recheck before sensitive operations | Existing |
| Idempotent clinical mutations | Existing |

## Provider onboarding

The CAC self-service onboarding UI already exists in draft PR #4 on branch `provider-cac-self-enrollment`.

The matching backend implementation exists in hid-system draft PR #10.

These changes are intentionally not duplicated in Phase 2. They need reconciliation with the Phase 1 integration branch before merge.

## Genuine frontend gaps

No new Provider Portal clinical surface is required for the Phase 2 capability list based on the current repository state.

The remaining work is:

1. Reconcile provider onboarding branches with the Phase 1 branch.
2. Run end-to-end contract verification against the authoritative backend.
3. Verify that no provider route falls back to legacy/Supabase APIs.
4. Add targeted regression tests for provider onboarding and facility isolation where coverage is missing.

## Acceptance gates

- Provider can sign in and select a facility.
- Every patient operation carries the active facility context.
- Unauthorized patient lookup does not reveal identity.
- Consent, PIN and emergency access follow the backend decision.
- Provider record reads/writes use hid-system contracts.
- Emergency mode cannot mutate records.
- Laboratory, pharmacy and document actions remain permission scoped.
- Provider audit actions are visible and attributable.
- No production deployment or merge occurs during this phase.

## Ownership

- Frontend: Health ID frontend team
- Backend contract: HID system team
- Security review: HID security/admin owner
- Merge/deploy: repository owner only after review

## Decision

Provider Portal frontend capability is **PREDOMINANTLY EXISTING**. The main missing integration item is onboarding reconciliation, already implemented in a separate draft branch.
