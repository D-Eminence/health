UI FEEDBACK AND OVERLAY PATTERNS (toast, drawer, modal, banner, popover and others)

Follow Step 0: first check which of these patterns already exist in the system and reuse them. Where one is missing, create it once as a shared primitive using the existing design tokens, spacing, motion and z-index scale, and use it everywhere. Do not build one-off versions per screen. Tell me which already existed and which you added.

Choose the pattern by the situation, not by habit:

TOAST (transient, non-blocking)
Use for: confirmation that something worked ("Profile updated", "Invitation sent", "Saved on this device"), and for "Undo" opportunities after reversible actions.
Rules:
- Auto-dismiss after a short time, with pause on hover and focus. Stack a maximum of three, and merge repeats instead of piling them up.
- Success and info toasts auto-dismiss. Errors that need action persist until dismissed or resolved.
- Never put patient names, identifiers or clinical details in a toast. Toasts can be seen over a shoulder and may be captured in screen recordings.
- Never use a toast for anything the user must read or decide. Those belong in a banner, dialog or inline message.
- Use role="status" with polite announcements for success and info, and role="alert" for errors. Keyboard-dismissible, with an optional action button.
- Do not fire a toast for every background sync event. Aggregate ("12 changes synced") and only toast on completion or when attention is needed.
- Toasts follow Do not disturb and the sound settings already defined.

DRAWER / SIDE PANEL (keep context, show or edit detail)
Use for: viewing or editing a record without leaving the list (patient quick view, staff member details, facility document preview), the notification centre, filters, the sync and connection details panel, the staff profile editor, and invitation details.
Rules:
- Slides in from the right on desktop, becomes a bottom sheet on mobile.
- Focus moves into the drawer on open, is trapped inside, Escape closes it, and focus returns to the element that opened it.
- Warn before closing with unsaved changes.
- Drawer content can be deep-linked where it makes sense, so the browser Back button closes the drawer rather than leaving the page.
- Do not use a drawer for a multi-step flow. That gets its own page.

MODAL / DIALOG (a decision is required)
Use sparingly, only when the user must decide before continuing: confirming a destructive or irreversible action (deactivate a staff member, delete a document, cancel a subscription), re-entering a password for a sensitive change, and acknowledging terms.
Rules:
- One clear question, a plainly labelled primary action that names the outcome ("Deactivate Dr. Ade", not "OK"), and a cancel option. The destructive action is never the default focus.
- For high-impact actions, require typing a confirmation word.
- Never use a modal for long forms, for marketing, or to report a routine success.
- Trap focus, close on Escape unless the action is dangerous, and set the page behind to inert.
- Never stack modals on modals.

BANNER (persistent state that stays until resolved)
Use for: "Pending verification" with locked clinical modules, "Verification rejected" with the reason and a re-submit action, a trial countdown or renewal notice, "Update available", and a long outage or a sync problem needing attention.
Rules:
- Sits at the top of the relevant area, dismissible only if the condition is not critical.
- Subscription, trial and renewal banners render ONLY for Owner, Admin and Finance roles. Staff never see them, and the data must not be sent to staff clients at all.
- Escalate the visual weight as urgency grows, within the existing tokens.

POPOVER (small contextual detail anchored to a control)
Use for: the connectivity indicator details, the presence and status picker, avatar menu, quick help on a field, and column or filter options.
Rules: keyboard reachable, closes on outside click and Escape, never holds a form that needs saving.

TOOLTIP
Use only for short labels on icon-only buttons and brief clarifications. Never for essential information, and never the only place something is explained. Must also appear on keyboard focus, and be unnecessary on touch.

INLINE MESSAGES
Use for field validation errors, form-level problems, and empty or no-result states. Errors appear next to the field, are linked with aria-describedby, and focus moves to the first error on submit. Do not use toasts for validation.

LOADING AND EMPTY STATES
- Skeletons for content that is loading, spinners only for short blocking actions, progress bars for uploads with a cancel option
- Every list, table, dashboard card and search result gets a designed empty state that explains what to do next
- Never show a blank screen while waiting. In offline mode, show cached content immediately with its "last updated" marker.

OTHER PATTERNS TO ADD WHEN A SCREEN NEEDS THEM
- Confirmation page after onboarding submission (not a toast)
- Stepper with save-and-resume for multi-step flows
- Unsaved-changes guard on every editable form
- Bulk-action bar when multiple rows are selected
- Command palette or global search for fast navigation, if it fits the existing navigation
- Error boundary screens that give the user a safe way back and never expose technical details

CROSS-CUTTING RULES
- Calm, plain-language copy. No technical error text, no blame.
- Neutral wording for staff on restrictions ("Contact your administrator") with no mention of billing.
- Respect reduced-motion preferences: replace slide and fade animations with instant changes.
- One notification should have one home: if something is shown in a banner, do not also toast it.
- Check contrast, focus visibility, and screen reader behaviour for every pattern at WCAG AA.
- Do not place a toast, drawer or modal over the login and password reset screens in a way that hides the form.
- Overlays must never obstruct the connectivity indicator, and the indicator must never trigger a modal.

WHERE TO APPLY THEM IN THE FEATURES ALREADY SPECIFIED
- Onboarding: inline validation per step, stepper with save-and-resume, confirmation page on submit, banner for pending verification, dialog for submitting the agreements
- Profile: toast on save, drawer for editing, dialog for re-entering the password before sensitive changes, badge plus inline note for credential changes pending review
- Password reset: inline messages for errors, a neutral confirmation page, a toast on successful change
- Staff management: drawer for staff details, dialog for deactivation, bulk-action bar for invites
- Subscription: banner and dashboard card for Owner, Admin and Finance only, dialog for cancel or plan change
- Presence and sound: popover for the status picker, a toast only for mentions or assignments, never for others coming online
- Offline: passive indicator with a popover, an aggregate toast on sync completion, a banner only when something needs attention

DELIVERABLES
1. A short list of which overlay and feedback components already exist and which you added
2. A one-page usage guide inside the codebase documenting when to use each pattern (so future screens stay consistent)
3. The shared components, with accessibility behaviour built in
4. The patterns applied to each of the screens above