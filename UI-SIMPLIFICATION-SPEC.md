Audit and fix repetition, clutter and inconsistency across the whole Health ID — Hospital EHR interface, for every user role and every provider type. The Hospital Owner dashboard is the example that exposed the problems, but the fixes must apply system-wide.

STEP 0: MATCH THE EXISTING SYSTEM
Before changing anything, inspect the codebase and map: all screens, the navigation configuration, every role and permission, every facility/provider type, and the shared components. Reuse the existing component library, design tokens, routing, permission system and conventions. Do not introduce new libraries or patterns where one exists. Produce the audit first (see Deliverables) and wait for my approval before large restructuring. If anything here conflicts with how the system is built, follow the system and flag the conflict.

Use "Health ID" (never "HID") and "EHR" (never "EMR") in all user-facing text.

SCOPE
Roles: Hospital Owner, Admin, Finance, Medical Director, doctors, nurses, pharmacists, lab staff, receptionists, records officers, procurement, HR, ambulance/dispatch, and every other role found in the codebase.
Provider types: hospital, clinic, maternity home, diagnostic lab, pharmacy, specialist centre, plus individual practitioners where the system supports them.
Surfaces: dashboards, navigation, top bar, profile, notifications, settings, onboarding, and every module screen.

PRINCIPLE
Every piece of information and every action has exactly one primary home. If something is reachable from several places, one is the main route and the others are shortcuts that clearly lead to the same destination. Nothing is shown twice on the same screen.

1. NAVIGATION: ONE SOURCE OF TRUTH
- Define navigation once in a single configuration driven by role, facility type, enabled modules and permissions. Sidebar, mobile menu, search and shortcuts all read from it. No hand-built menus per screen.
- Group the sidebar into collapsible sections, for example: Home, Clinical, Pharmacy and Lab, Finance, Supply, People, Insight, Network and Services, Settings. Adjust to the real modules found.
- Merge overlapping modules: Inventory and Procurement should be one module, and Insurance policies should be a tab under Insurance and Claims. Report any other overlaps you find before merging.
- Move one-time setup (ward configuration, service catalogue, vehicle configuration, departments, templates) into a Settings or Configuration group, separate from daily work.
- Remember which groups a user collapsed. Highlight the current page and keep it visible without the user having to scroll.
- Each item gets its own distinct, meaningful icon. No two items share the same generic icon.
- Users see only what their role and facility type allow. A pharmacy never sees ward configuration. A lab never sees ambulance dispatch.

2. DASHBOARDS: CONTENT, NOT A SECOND MENU
Remove the grid of module cards that duplicates the sidebar. Each role gets a dashboard built from useful content, using a shared set of dashboard components:

Common building blocks:
- Greeting using the person's name (never their role title as a name)
- Setup checklist for new facilities, shown first until complete, then collapsed and eventually hidden
- KPIs with a period selector (today / week / month) and trend against the previous period
- "Needs attention" list: items waiting on this user, ordered by urgency
- "Today" summary relevant to the role
- A maximum of 4 to 6 shortcuts, or Recent and Pinned items
- Designed empty states that explain the next step, never rows of zeros

By role (adapt to the real roles and modules):
- Owner/Admin: revenue and collections, outstanding balances, active staff, bed occupancy, pending approvals, low or expiring stock, expiring staff credentials, claims awaiting submission, uncovered shifts
- Finance: invoiced, collected, outstanding, claims status, aged receivables, reconciliation items
- Medical Director: clinical quality and safety items, incident reports, credential and licence expiries, department workload
- Doctors: today's patients, pending results, orders awaiting action, messages
- Nurses: assigned patients, due medications and vitals, handover notes, bed status
- Pharmacists: prescriptions to dispense, low stock, expiring stock, interaction alerts
- Lab staff: samples awaiting, results pending verification, turnaround times
- Reception and records: appointments, check-ins, registrations, duplicate-patient review
- Procurement/Inventory: reorder alerts, open purchase orders, deliveries expected
- HR: credential expiries, leave requests, shifts to cover
- Dispatch: active calls and available vehicles

By provider type:
- Hospital: full set above
- Clinic and maternity home: outpatient, antenatal and immunisation workload instead of ward and bed metrics
- Diagnostic lab: sample and result pipeline, no ward or bed content
- Pharmacy: dispensing, stock, expiry, controlled-drug logs
- Specialist centre: referrals in, appointments, procedure schedule
Dashboard widgets are selected from the facility type, the enabled modules and the user's permissions. Show nothing that does not apply.

Trial and billing:
- The subscription trial countdown card, renewal notices and billing information appear on the dashboards of Owner, Admin and Finance only. No other role ever sees any hint of subscription state, and the data is not sent to their clients. Server-enforced, as specified earlier.

3. TOP BAR: SIMPLIFY
Replace the row of same-weight buttons with:
- Branch/workspace switcher (only if the user has more than one; otherwise show the facility name once)
- Global search (rename "Find workspace" to something clear, and let it search patients where permitted, modules, staff and settings)
- Notification bell with an unread count (no "(0)" text)
- One avatar menu containing: my profile, presence status (Online / Away / Do not disturb), preferences, help, and sign out
- Sign out lives only in the avatar menu
The user's role is shown once, inside the avatar menu and profile, not in the top bar, sidebar, page label and heading all at once.

4. STATUS, SYNC AND PRESENCE: SEPARATE AND QUIET
- Presence (the user's own Online / Away / Do not disturb) lives in the avatar menu with a dot on the avatar. Remove the separate "Status: Online" button.
- The connectivity indicator is a separate, passive element. By default it is quiet ("All changes saved" with a check, or nothing at all). It becomes visible only when there is something to say: Syncing, Slow connection, Offline, or Needs attention.
- Never show "Online" and "Syncing" as competing labels. Presence and connection are different concepts and look different.
- Place it where it never covers page content or actions. Make sure it does not overlap cards or bottom-right controls.
- As specified earlier, it never blocks the user and never triggers a modal.

5. SYSTEM MESSAGES AND BANNERS
- Replace the vague amber "Workspace status" block. Update notices become a small, calm item: "A new version is ready" with a "Refresh" action. Refresh must first check for unsynced changes and never force a reload while work is in progress. No technical instructions such as "close all preview tabs".
- Use banners only for persistent states that need action: pending verification, locked modules, sync problem, and (for Owner, Admin, Finance only) trial or renewal notices.
- Follow the toast / drawer / modal / banner rules defined previously. One event, one home.

6. DEMO AND SIMULATION NOTICES
- Consolidate "LOCAL SIMULATION", "Fictional local demonstration", "fictional records" and "Simulation controls" into one small demo chip in a fixed place, with a popover holding the explanation and the simulation controls link.
- Remove the repeated "Current saved records" caption under metrics.
- Make this chip trivially removable for production builds via configuration.

7. BREADCRUMBS, TITLES AND LABELS
- No breadcrumb on home pages. Breadcrumbs only where there is real depth.
- The facility name appears once (sidebar header or top-bar switcher, not both plus breadcrumb).
- Make entire cards clickable. Remove the repeated "Open workflow →" text on every card.
- Do not display "0 records · 0 open / active" on every card. Hide empty modules from the dashboard or show a useful empty state.
- Fix pluralisation everywhere (1 record, 2 records). Use a shared helper.
- Metric labels must mean what they say. "Staff" in a row of financial figures becomes "Active staff" and moves out of that row.
- Consistent terminology across the product: one name per concept, and update all labels, titles, buttons and messages to match.

8. CONSISTENCY ACROSS EVERY SCREEN
Run the same audit on every module screen, not just dashboards:
- Detect and remove repeated headings, repeated role or facility labels, duplicate actions, and two controls that do the same thing
- Page header pattern: title, short description if needed, and one primary action. Same layout everywhere.
- Same spacing, table, filter, form and empty-state patterns on every screen
- One place for settings, one place for profile, one place for notifications
- Reduce visual noise: fewer borders and badges, clear hierarchy, one primary action per view
- Accessibility pass: contrast, focus order, labels, landmarks, and keyboard navigation for the new navigation and avatar menu

9. PERFORMANCE AND PERSONALISATION
- Dashboard widgets load independently with skeletons, and cached data shows instantly with its last-updated time when offline
- Let users pin and reorder their own shortcuts. Let Owner and Admin set default layouts per role.

DELIVERABLES
1. An audit report first: every duplicated element, overlapping module, inconsistent label and shared-icon problem found across the product, grouped by screen and role. Wait for approval.
2. The role-by-facility-type matrix showing which navigation items and dashboard widgets each combination gets
3. The single navigation configuration and the updated sidebar and mobile menu
4. The simplified top bar with avatar menu, notification bell and search
5. The redesigned dashboards for every role and provider type
6. The merged modules and the Settings group
7. The consolidated demo chip, quiet connectivity indicator, and update notice
8. A short "UI rules" document in the codebase listing the one-home principle, page header pattern, terminology list and component usage, so future screens stay consistent
9. A list of anything you changed that affects permissions, and anything you could not do because of how the system is built