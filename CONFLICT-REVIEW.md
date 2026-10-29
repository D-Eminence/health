# Clinical conflict review - local simulation

Open **Connection and sync status > View sync details > Review versions**. Eligible branch reviews include work saved by other staff. The original author does not need to grant another account their password.

The reviewer must have an active clinical role and existing view/edit permissions for every record in the batch, in the current facility and branch. Hospital Owner/Admin access alone does not grant review authority. Unsupported or mixed-authority work stays retained for a suitable workflow; permissions are never expanded automatically.

Compare both complete versions, including status. Choose one for each record, provide a reason, then select **Record review decision**. No choice is preselected. Both originals remain stored. Further amendments use the normal record workflow, rather than a generic merge editor. Changed versions require a reload and another review; reloading or closing protects unsaved choices. Offline choices remain in the open form, but the decision requires a connection and current authority.

A successful decision atomically records the selected projection, original snapshots, version history, reviewer audit and one queue receipt. Later edits are retained. Divergent later edits require their own review; compatible later syncs keep review history. An offline-cache refresh failure is reported separately and can be retried through Sync now. Sign-out, scope changes and revoked clinical access remove open review details.

## Source and verification

- `src/conflicts.ts`: scoped listing, access checks, version tokens and resolution.
- `src/conflict-review.tsx`: shared drawer/form integration.
- `src/storage.ts`: encrypted queue and atomic decision commit.
- `src/sync.ts`: conflict flags/audit and history-preserving later sync.
- `tests/conflicts.spec.js`: role/scope/revocation, cross-staff review, stale versions, multi-record choices, interrupted writes, cache failure, idempotency, successor edits and mobile form behavior. Run `npx playwright test tests/conflicts.spec.js` after building with the preview server running. Tests use isolated fictional browser data.

This phase does not implement duplicate-patient merging, an automatic clinical merge, production server sync or the complete offline failure matrix. Backend endpoint details and remaining phases are in BACKEND-HANDOVER.md and PRD.MD.
