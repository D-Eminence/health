Redesign the "Register your hospital" screen in Health ID — Hospital EHR into a multi-step facility onboarding flow, and add a subscription layer that starts with a free trial.

STEP 0: MATCH THE EXISTING SYSTEM (do this before writing anything)
Inspect the current codebase and follow what is already there. Do not introduce new libraries, patterns or conventions where an existing one covers the need. Specifically reuse:
- The existing component library, form handling and validation approach, routing, state management, API/data layer and file upload handling
- The existing design tokens, typography, spacing, button and input styles, and the current split layout (form on the left, clinical photo with "More connected care. More time for people." on the right)
- The existing role and permission system. Use the roles, tiers and permission checks already defined in Health ID EHR. Do not invent new roles. Where this brief says "owner", "admin" or "finance", map them to the closest existing roles and tell me which ones you chose.
- The existing naming conventions for files, types, routes, endpoints and database fields
If something I describe conflicts with how the system is already built, follow the system and flag the conflict to me.

Use "Health ID" (never "HID") and "EHR" (never "EMR") in all user-facing text.

PROBLEM
The current screen only creates a user account (name, phone, email, password). It captures nothing about the facility, verifies nothing, and gives the system no idea what kind of provider it is dealing with.

ONBOARDING FLOW (5 steps, progress indicator, Back, and Save & continue later)

Step 1 — Your account
- Full name, phone, email, password, confirm password
- Role at the facility: Owner, Medical Director, Administrator, Other authorised representative

Step 2 — Facility details
- Facility name
- Type: Hospital, Clinic, Maternity home, Diagnostic lab, Pharmacy, Specialist centre
- Ownership: Public, Private, Faith-based, NGO
- Level of care: Primary, Secondary, Tertiary
- Address, State, LGA (dependent on State), optional GPS pin
- Facility phone and email
- Bed count, operating hours, 24-hour emergency (yes/no)
- Departments and services offered

Step 3 — Regulatory identity and verification
- State Ministry of Health licence number, and national facility registry ID if one exists
- CAC registration number
- Medical Director's full name and MDCN number
- NHIA accreditation (optional)
- Uploads: operating licence, CAC certificate, proof of address

Step 4 — Platform setup
- Expected number of staff
- Which Health ID products they want to start with (Identity, EHR, Migrate, Pharmacy, Lab, Medical Outreach, API/Connect)
- Migrating existing records? If yes, from what source
- Need interoperability with external labs, pharmacies or other facilities?

Step 5 — Agreements
- Summary of everything entered, with an edit link per section
- Separate checkboxes, never pre-ticked: Terms of Service, Data Processing Agreement, NDPA data protection and patient consent acknowledgement, and a declaration that the person is authorised to register this facility
- Submit stays disabled until all are ticked
- State clearly that the facility starts on a free trial and that no payment is taken at sign-up

SEPARATE THE PATHS
Registering a new facility and accepting an invitation are different flows. Remove the combined "establish this hospital / accept this invitation" checkbox. "Accept invitation" gets its own short screen. Keep the footer links: Register a hospital, Sign in, Recover access, Accept invitation.

VERIFICATION STATES
Model: draft, submitted, pending_verification, verified, rejected (with reason and a re-submit path), suspended.
While pending_verification, the owner can sign in but clinical modules are locked behind a clear banner. Only facility profile, document re-upload and staff invitations are available.

SUBSCRIPTION AND TRIAL

Trial
- Every newly registered facility starts on a free trial. Make the trial length a configurable value, not hard-coded.
- Store trial start date, trial end date, current plan, and subscription status per facility.
- Subscription states: trialing, active, expiring_soon, grace_period (if I decide to allow one), expired, cancelled. Derive the displayed countdown from the stored end date on the server, not from the client clock.

Who sees it (strict)
- The trial countdown, renewal reminders, billing information and plan details are visible ONLY to the hospital Owner, Admin and Finance department roles.
- Regular staff (doctors, nurses, pharmacists, lab staff, receptionists and every other role) must never see the countdown, the banner, the billing pages, or any hint of subscription status in their UI.
- Enforce this on the server and in the API responses as well, so the data is not sent to staff clients at all. Hiding it in the interface alone is not enough. Use the existing permission system for this, and add a dedicated billing/subscription permission if the system's pattern supports it.

Dashboard for Owner, Admin and Finance
- A trial countdown card on their dashboard showing days remaining, the trial end date, and a clear "Choose a plan" action
- Escalating visual states as the end approaches (for example calm early on, then a more prominent notice in the final days), keeping to the existing design tokens
- A billing section where they can view the plan, see renewal dates, and subscribe or renew

Renewal awareness
- Reminders to Owner, Admin and Finance roles only, at sensible intervals before the trial or subscription ends (for example 14, 7, 3 and 1 days), delivered through the notification channels the system already has (in-app, email, SMS)
- Reminder timing should be configurable
- The same reminder logic applies after the trial, ahead of every paid renewal

When the trial ends
- Define clear behaviour for expiry and flag it to me as a decision, not something to assume silently. A sensible default is read-only access to existing records, with new clinical entries blocked until renewal. Patient safety matters here, so an expired subscription must never block access to records needed for care in an emergency.
- Staff who hit a restriction after expiry should see a neutral message telling them to contact their administrator, with no mention of billing.

Open questions to ask me before building
- Should the trial clock start at registration or when verification is approved?
- Trial length, and whether there is a grace period after expiry
- Plan structure and pricing: per facility, per user, per product module, or tiered by facility type or bed count
- Payment provider to integrate, if one is already in use

BEHAVIOUR AND QUALITY
- Inline validation per step, focus moves to the first error
- Nigerian phone validation (+234 and local formats)
- Draft progress saved server-side so users can resume. Do not store personal data in browser storage.
- Fully keyboard accessible, labelled inputs, visible focus, WCAG AA contrast
- Responsive: the image panel collapses on mobile and the stepper becomes a compact "Step 2 of 5" bar
- Keep the "Local demonstration · fictional records only" notice and the Simulation controls link in the footer

DELIVERABLES
1. A short summary of the existing conventions you found and will follow, and how you mapped owner, admin and finance to the existing roles
2. The onboarding flow, the pending-verification experience, and the invitation screen
3. The subscription data model, trial logic, role-gated dashboard card and billing section, and reminder scheduling
4. A list of backend endpoints or changes needed (create draft, save step, upload document, submit, verification status, subscription status, reminders)
5. A list of anything you assumed or any conflict you found with the existing system