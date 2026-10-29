# Health ID feedback and overlay usage

Use the live app primitives in `src/feedback.tsx` and existing forms in `src/ui.tsx`. Source brief: `OVERLAY-SPEC.md`. Keep the supplied Health ID tokens in `public/brand.css`; shared overlay layout, z-index and reduced-motion rules live in `public/feedback.css`.

## Inventory

**Already in the running app:** Button, Card, Heading, Badge, ErrorBox, Form, Operation, PasswordInput; validation links; registration stepper/save-and-resume; subscription card; passive connectivity indicator; error boundaries. Profile save paragraphs, notifications, connection details and switch-workspace dialogs were separate implementations.

**Added or consolidated:** allowlisted toast host, Drawer/mobile sheet, single decision dialog/password prompt, Banner, Popover, Tooltip, Skeleton, EmptyState, shared unsaved-change/navigation guard, attachment preparation progress/cancel, invitation bulk-action bar and permission-filtered workspace search. Archived ZIP examples are reference material, not additional runtime component systems.

## Choose one home

| Pattern | Use it for | Contract |
|---|---|---|
| `toast(code, options)` | A completed save; reversible filter clear with Undo; new assignment/mention; aggregate completed sync | Approved generic copy keys only. Never interpolate names, identifiers, clinical data or server error strings. Maximum 3; repeats merge. Success/info expire after 5 seconds, paused on hover/focus. Actionable errors persist. Polite status or error alert. No toast for validation or a condition already in a banner. |
| `Drawer` | Profile/staff editing, record/document/invitation preview, notifications, filters, sync details | Right panel on desktop, bottom sheet on phone. Focus enters, stays contained and returns to the opener. Background is inert. Escape closes clean panels; dirty panels offer Keep editing/Discard while retaining the mounted form. Nested surfaces suspend the previous drawer. Multi-step flows remain pages. `/profile` supports direct links and Back-to-close. |
| `confirmAction` / `requestPassword` | Deactivation, cancellation, deletion, signing, agreement submission, sensitive email change | A short question and outcome-named action; Cancel receives focus. High-impact actions specify `word`. Password prompts reuse PasswordInput. One visible decision at a time; the drawer is suspended. A cancelled Form handler returns `false` so dirty state survives. |
| `Banner` | Pending/rejected verification, renewal, long outage, sync review, waiting update | Persistent until the condition resolves; critical conditions are not dismissible. Subscription notices/cards require `subscriptionAllowed` and sanitized `workspaceData`; do not pass subscription fields to staff views. Never duplicate with a toast. |
| `Popover` | Passive connection summary or immediate presence selection | Anchored, keyboard reachable, Escape/outside-click close; no form requiring Save. Detailed sync work opens a Drawer. The indicator never opens a decision dialog. |
| `Tooltip` | Supplementary icon label/help | Short, available on hover and focus, linked by aria-describedby. Keep a separate accessible button name; touch users must not depend on it. |
| `Form` / `ErrorBox` | Validation and operation failures | Adjacent errors with aria-describedby; first invalid field receives focus. Keep values after failure. Technical exception details are replaced with calm copy. Set `persistValues` only when onValuesChange actually persists a draft; password values do not count as durable drafts. |
| `Skeleton` / `EmptyState` | Initial loading, no records/results/notifications | Keep cached content visible with its last-updated marker. Explain the next action. Attachment progress describes local file preparation, supports Cancel, and never claims a remote upload. |

## Integration rules

Mount one FeedbackHost outside the inert workspace. Use `go`/`guardedNavigate` for navigation; browser Back and unload also respect dirty forms. Custom editable controls outside forms use `data-editable` and a truthful `data-dirty` state. Clear dirty state only after success. Never erase or remount a dirty form to show a warning.

Reserve the bottom connection-indicator area when opening overlays. Do not cover login/recovery forms with routine feedback: authentication toasts render in normal document flow. Onboarding submission and recovery requests use confirmation pages. Notification sounds remain owned by the existing presence/sound engine; toasts do not add a second sound, and DND suppresses transient toasts.

Ctrl/Cmd+K searches only permitted workspace destinations. Clinical records are not global-search suggestions. Bulk invitation actions retain failures for retry. Keep empty-state copy actionable and neutral for staff restrictions.

Validation: `tests/overlays.spec.js` covers focus/inertness, retained edits, confirmation words, toast privacy/lifetime/limits, DND, mobile/reduced motion, Back, inline error links and role-filtered destinations. Contrast and keyboard checks cover the shared patterns; these are not a full assistive-technology certification. Original modal/toast motion snippets come from the local transitions-dev skill and retain its reduced-motion guards.


Clinical conflict review follows the same Drawer/Form/Banner contracts: Connection details opens the review sheet; the parent drawer is suspended. Complete-version choices and rationale stay inline. A stale review asks for a reload, which guards unsaved choices. The final decision is acknowledged in its review surface, without a duplicate toast.
