ADDITIONAL REQUIREMENTS (follow the same Step 0 rule: reuse the existing components, permission system, notification channels, and conventions. Do not introduce new patterns where the system already has one.)

PASSWORD FIELDS (applies everywhere in the product)
- Every password input gets a show/hide eye icon toggle: registration, confirm password, sign in, change password, reset password, accept invitation.
- Build it as a real button inside the field with aria-label ("Show password" / "Hide password") and aria-pressed, keyboard focusable, and visible focus state.
- It must not break browser password managers or autofill.
- Reuse one shared PasswordField component so the behaviour is identical on every screen.
- Add a strength indicator on create/change flows.

PROFILE MANAGEMENT

Staff profile (each user edits their own)
- Profile picture: upload, crop, replace, remove. Limit file type and size, strip image metadata, show initials as the fallback.
- Editable: display name, phone, email (changing email requires re-verification), job title, department, short bio, language, notification preferences
- Credential fields (for example MDCN number, licence details) are editable but changes go into a pending-review state and show a "verification pending" badge until approved
- Security section: change password (current password required), sign out of other devices, active sessions list with device and last-active time
- Staff cannot edit hospital-level details

Hospital profile (Owner and Admin only)
- Facility logo, name, address, contact details, departments, services, operating hours, bed count
- Changes to regulatory fields (licence number, CAC, registry ID, Medical Director) trigger re-verification and show the facility's verification status. Non-regulatory edits save immediately.
- Keep a change history showing who edited what and when
- Subscription and billing details stay visible only to Owner, Admin and Finance, as specified earlier. Nothing about them appears on any staff profile or staff-facing screen.

Password reset and account recovery
- Forgot password flow: request by email or phone, time-limited single-use token, a neutral response that doesn't reveal whether an account exists, rate limiting, and invalidation of all active sessions after a reset
- Admin-initiated reset: Owner/Admin can send a reset link to a staff member. Admins must never see or set a staff member's password.
- Forced password change on first login for invited staff
- Notify the user by email or SMS whenever their password or email changes
- Optional two-factor authentication, using whichever channels the system already supports

PRESENCE: ONLINE / OFFLINE (Slack-style)

Status model
- Online (active), Away (idle after a configurable period), Do not disturb, Offline
- Shown as a small coloured dot on the avatar everywhere a staff member appears: staff directory, chat or messaging, assignment lists, mentions
- Optional short custom status (for example "In theatre", "On ward round") with an optional expiry
- Users can set Away or Do not disturb manually. Do not disturb silences sounds and visual pop-ups, but never silences critical clinical alerts.

Rules
- Presence is scoped to the user's own facility only. No cross-facility visibility.
- Presence must carry no patient or clinical information.
- Admin setting: facility can enable or disable presence, and choose whether staff can appear offline
- Handle dropped connections gracefully: a heartbeat with a timeout, so a closed tab or lost network becomes Offline after a short delay, with no stuck "online" ghosts
- Presence must not be used as a hidden staff-monitoring or timekeeping tool, and last-seen data must not be exposed beyond what the facility enables

Connection indicator (separate from presence)
- A small unobtrusive indicator for the user's own connection state (connected, reconnecting, offline). When offline, show clearly what still works and what is queued to sync, using the system's existing offline behaviour if there is one.

Sounds
- Original notification sounds for: new message, mention, assignment or task, and alert. Do not copy or imitate Slack's actual audio. Create or source original, licensed sounds.
- Settings per user: sounds on/off, volume, choice of sound per event type, and quiet hours
- Respect Do not disturb and quiet hours
- Respect browser autoplay rules by unlocking audio after the first user interaction, and play nothing when the tab is muted
- Critical clinical alerts use a distinct, more urgent sound and bypass Do not disturb, with an admin-controlled policy
- Do not play sounds while a user is in a context where noise is inappropriate if the system has a way of knowing (for example an active patient-facing view), or at least make that a per-user toggle
- Keep sounds short and make visual notifications work fully without sound

OPEN QUESTIONS TO ASK ME
- Does Health ID already have internal messaging or notifications that sounds and presence attach to, or should this introduce them?
- Should presence be on for every role by default, or only for certain departments?
- Which events should trigger sounds in the first version?

DELIVERABLES (add to the earlier list)
- Profile screens for staff and hospital, including the profile picture flow
- Password reset, admin-initiated reset, and the shared eye-icon PasswordField
- Presence service, avatar status dot, status picker, connection indicator, and sound settings
- Any new endpoints, real-time channels, and data fields required, listed separately