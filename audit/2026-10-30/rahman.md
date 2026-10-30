Design audit of health main a4f5704 against screens/ (2026-10-30, 21:30 UTC). Owner decisions applied: (1) encounter lifecycle actions move to a "More actions" menu; (2) sample workspaces follow the design role mapping, live pages keep their live permission; (3) fictional history rows on sample pages are wanted, on sample pages only; (4) labels are written properly ("Date of birth", "Health ID", "Blood pressure", "SpO2"), not copied raw. Accepted differences are not listed (sample notice, no sync/offline notes, no export or files, live names and statuses, today's refusal wording).

RAHMAN: frame and ui-kit

Coordinator: design audit of main a4f5704 against design/ehr-target screens/.
Paths starting ehr-blue/ are under apps/patient-web/src/ehr-blue/. "Design" means branch design/ehr-target (src/, public/application.css).

1. [major] The sidebar has entries the design never shows
   Screens: every screen (for example workspaces/patients-1-list.png, admin/staff.png, panels/12-sidebar-collapsed.png, panels/14-mobile-menu-open.png). Live: any /provider page.
   Differs: "Choose workspace" sits under Home when you have more than one facility. "Patient registration" and "In-person check" sit in Clinical. "Facility review" shows in Administration for every role. Together they push Clinical down about 130px, so Home scrolls out of view on long pages.
   Where: ehr-blue/frame/pages.ts:56, :57, :92, :113-114
   Fix:
   - institutions: set `listed: () => false`. The account menu's Switch facility keeps the route.
   - registration and in-person-check: use `{ ...live(...), listed: () => false }`. The routes stay. Ola item 1 adds Patients › Create record as the way in, so land the two changes together.
   - platform: gate it with the sample check from item 2 (`sampleCan(roles, 'platform')`). The design grants it only to Platform Super Admin.

2. [major] Sample workspaces are open to every role
   Screens: admin/denied-route-redirect.png (a Cashier sees only Finance and Insight), roles/*.png sidebars, workspaces/lab-1-list.png, pharmacy-1-list.png, appointments-1-list.png. Live: /provider with roles [cashier], [lab] or [receptionist]. The sidebar still lists Appointments, Inpatient, Maternity, Finance, People and so on.
   Where: ehr-blue/frame/pageAccess.ts:12 (`page.status === 'sample' ||`), frame/pages.ts:32-34 (sample()), clinical/pages.ts:24-42, departments/sample/pages.tsx:29-40
   Fix: add ehr-blue/frame/sampleAccess.ts.
   - Port design src/catalog.ts:1349-1440 `permissions(role)` as designGrants(role).
   - `designRolesOf(session, viewing)`: if a demo role is being viewed (useRoleView().viewing), use that role. Otherwise map the live roles and take the union: org_admin→Hospital Admin, doctor and clinician→Doctor, nurse→Nurse, lab→Lab Scientist, pharmacist→Pharmacist, receptionist→Receptionist, records_officer→Records Officer, billing→Billing Officer.
   - `sampleCan(roles, moduleId, verb = 'view')`. Map frame paths to design module ids: patient-billing→billing, supply→inventory; every other id is the same.
   - In pageAllowed, use `page.status === 'sample' ? sampleCan(designRolesOf(session, viewing), moduleOf(page)) : !page.permission || permissions.includes(page.permission)`.
   - Export a `useSampleCan()` hook. Ola (item 16) and Lekan (item 11) use it to gate actions, Create record, Continue care and history rows.
   - Live pages keep their live permission check.

3. [major] Role dashboard heading
   Screens: roles/*.png (all 16), admin/owner-dashboard.png. Live: /provider › Account menu › View Home as a demo role › any role.
   Differs: live adds the description "The X dashboard, as the design shows it." and a "Back to my dashboard" button. The design has a secondary "Customize shortcuts" button instead.
   Where: ehr-blue/home/RoleDashboard.tsx:44-45
   Fix: use `<EhrPageHeading title={`Welcome, Demo ${role}`} primaryAction={<EhrButton variant="secondary" onClick={() => setCustomizing(true)}>Customize shortcuts</EhrButton>} />` and reuse BlueHome's Customize shortcuts drawer (BlueHome.tsx:202-220). The way back is "My own dashboard" (TopBarParts.tsx:172), which moves with the demo controls in item 8.

4. [major] Role dashboards are missing the design's cards and empty states
   Screens: roles/hospital-owner, hospital-admin, billing-officer, cashier, medical-director, platform-super-admin and records-officer dashboards. Live: View Home as each of those roles.
   Where: ehr-blue/home/RoleDashboard.tsx:13-30 (ROLE_MODULES) and :53-81. Design: src/dashboard.tsx:237-360.
   Fix:
   (a) Hospital Owner, Hospital Admin, Billing Officer and Cashier: replace Activity in period with `<EhrCard title="Patient billing">`. It holds three figures taken from sampleRecords('billing'), then a "View patient billing" link:
       - "Invoiced in period": NGN 30,000, "No comparison yet"
       - "Collected in period": NGN 4,000, "No comparison yet · Before refunds"
       - "Outstanding balance": NGN 26,000, "All open invoices"
   (b) Platform Super Admin, Hospital Owner, Hospital Admin and Medical Director: add `<EhrCard title="People">` with a large 16, "Active staff in this branch" and `<Link to="/provider/staff">Manage staff & access</Link>`.
   (c) Platform Super Admin: the card becomes "Facility review", with "0 facilities awaiting review" and a "Review facilities" link.
   (d) Always render Needs attention and Today, Platform Super Admin included. When empty, use EhrEmptyState:
       - "No open items in your worklist" / "New work requiring review will appear here. Use your work area to review completed records."
       - "No activity recorded today" / "Your permitted appointments and daily work will appear here as records are saved."
   (e) Leave 'patients' out of Needs attention. Records Officer then shows the empty state.
   (f) Activity modules per role:
       - Doctor, Consultant, Medical Director, Nurse: patients, appointments, journey, triage
       - Receptionist: patients, appointments, journey
       - Records Officer: patients
       - Lab Manager: lab, inventory, procurement, bloodbank
       - Lab Scientist: lab, inventory, bloodbank
       - Pharmacy Manager: pharmacy, inventory, procurement
       - Pharmacist: pharmacy, inventory
       - Radiology Reporter: radiology

5. [major] Role dashboard body uses different markup from the design (this merges one major and two minor findings)
   Screens: roles/doctor-dashboard.png and the other roles, panels/13-mobile-dashboard.png. Live: View Home as Doctor.
   Differs:
   - Activity in period is three tinted EhrStatCard tiles; the design has plain figures in two columns.
   - Reporting period is a 240px select with its note underneath and a full-width sample banner above.
   - Needs attention mixes blue 14px links with bold titles.
   Where: ehr-blue/home/RoleDashboard.tsx:58-64, :46-52, :68
   Fix:
   - Activity: use BlueHome's markup (BlueHome.tsx:165-172): `<div className="hid-ehr-blue-activity">{modules.map(m => <div className="hid-ehr-blue-activity-figure"><span>{m.title} created</span><strong>{count}</strong><small>No comparison yet</small></div>)}</div>`.
   - Reporting period: use BlueHome.tsx:153-161 (the "hid-ehr-blue-period" markup, with the note to the right) and move `<EhrSampleBanner />` inside the first card, as BlueHome.tsx:164 does.
   - Needs attention rows: `<Link className="hid-ehr-blue-worklist-link" to=…><strong>{sampleTitle(record)}</strong></Link>` with CSS `.hid-ehr-blue-worklist-link{color:inherit;text-decoration:none} .hid-ehr-blue-worklist-link:hover strong{color:var(--ehr-brand)}`.

6. [major] Pinned shortcuts are wrong
   Screens: roles/*.png, Pinned shortcuts row. Live: View Home as Doctor, Hospital Admin, Platform Super Admin or Billing Officer.
   Differs: live workspaces show as grey plain text, the lists differ from the design, and Platform Super Admin gets an empty section.
   Where: ehr-blue/home/RoleDashboard.tsx:83-90; ehr-blue/frame/frame.css:237-245
   Fix: render every shortcut as `<Link className="hid-ehr-button hid-ehr-button-secondary">`. Resolve live pages with useBluePages() + pageHrefOf(page); useSampleHref() returns null for live pages. Lists:
   - Platform Super Admin: Facility review, Staff & access, Audit & Compliance, Facility settings
   - Owner and Admin: Patient billing, Insurance & Claims, Dispatch, Shifts & Roster
   - Medical Director, Consultant, Doctor and Nurse: Patients, Appointments, Patient visits, Triage & Vitals
   - Receptionist: Patients, Appointments, Patient visits
   - Records Officer: Patients, Reports & Analytics, Audit & Compliance
   - Lab Manager and Lab Scientist: Laboratory, Blood Bank, Supply
   - Pharmacy Manager and Pharmacist: Pharmacy, Supply
   - Billing Officer: Patient billing, Insurance & Claims, Reports & Analytics, Facility subscription
   - Cashier: Patient billing, Insurance & Claims, Reports & Analytics
   - Radiology Reporter: Radiology
   When the list is empty, show "Pin up to six work areas using Customize shortcuts."

7. [major] An administrator's own Home has no People card and shows Activity where the design shows Patient billing
   Screens: admin/owner-dashboard.png, roles/hospital-admin-dashboard.png. Live: /provider as org_admin.
   Where: ehr-blue/home/BlueHome.tsx:162-191
   Fix:
   - With 'workforce.manage', add `<EhrCard title="People">` beside the first card: active-member count, "Active staff in this branch" and `<Link to="/provider/staff">Manage staff & access</Link>`.
   - Read the count live from facilityStaffApi.read(facility.id).members (staff/api.ts:1603) wherever visibleNavigation(facility) lists /provider/staff. Elsewhere, use the sample figure with the sample notice.
   - For org_admin, show the sample Patient billing card (figures as in item 4a) in place of Activity in period.

8. [major] The account menu has grown to about 25 items and scrolls
   Screen: panels/account-menu.png. Live: /provider/patients › Account menu.
   Differs: "Use the classic EHR" and a 16-button "View Home as a demo role" list have been added.
   Where: ehr-blue/frame/TopBarParts.tsx:158-181
   Fix:
   - Menu contents: name; role line `{roles}` only (drop `· ${facility.name}`); My profile; Status: Online; Preferences; Help; Switch facility; Sign out.
   - Remove the signOut icon.
   - Make Status: Online content-width: give it a class with width:auto and align-self:flex-start, overriding frame.css:99.
   - Move "View Home as a demo role", "My own dashboard" and "Use the classic EHR" into the Demo chip popover (DemoChip, TopBarParts.tsx:113-120). Only demo facilities show that chip.

9. [major] "Choose your workspace" opens inside the frame; the design is a standalone page
   Screen: admin/institutions.png. Live: /provider/institutions (Account menu › Switch facility).
   Where: ehr-blue/EhrBlueApp.tsx:24-33; ehr-blue/frame/ChooseWorkspace.tsx:70-95
   Fix:
   - When `useLocation().pathname.replace(/\/+$/, '') === '/provider/institutions'`, render the standalone wrapper `<div className="hid-ehr hid-ehr-blue-standalone"><main …><ChooseWorkspace reason="switch" /></main></div>`, as the no-facility case already does.
   - Intro copy: "Select one of your facility memberships." Drop the extra sentences in WHY.switch.
   - Optional: add a secondary "Register another hospital" link to providerEnrollmentHref(window.location.hostname) (productHostname.ts:131), next to Sign out.

10. [major] An unknown address shows "Page not found"; the design lands on Home
   Screen: admin/unknown-route.png. Live: /provider/not-a-page.
   Where: ehr-blue/frame/BlueFrame.tsx:103
   Fix: replace `: <UnknownPage />` with `: <Navigate replace to="/provider" />`.

11. [major] A page the role may not open shows a refusal page in place; the design redirects to Home with a notice
   Screen: admin/denied-route-redirect.png. Live: /provider/laboratory with roles [cashier].
   Where: ehr-blue/frame/BlueFrame.tsx:101-102; ehr-blue/frame/LivePages.tsx:52-68
   Fix:
   - For reason 'permission', return `<Navigate replace to="/provider" state={{ notice: 'Your current permissions no longer allow that page. Choose an authorized workflow.' }} />`.
   - In BlueHome and RoleDashboard, render useLocation().state?.notice above EhrPageHeading as an info banner: tint background, rounded, 13px text, with a "×" button that runs `navigate('.', { replace: true, state: null })`.

12. [major] Facility subscription shows today's "Plan & billing." page
   Screen: admin/subscription.png. Live: /provider/billing.
   Where: ehr-blue/frame/pages.ts:100 (live('billing', …) → LivePage)
   Fix: add a blue FacilitySubscriptionPage in frame/ and register it at 'billing'.
   - It reads staffApi.subscription and the invoices (staff/api.ts:1698-1705) and keeps today's refusal and state wording.
   - Heading: `EhrPageHeading eyebrow="Separate from patient billing" title="Facility subscription"`, then an intro line.
   - Cards: "Current plan" (plan, status, period end, today's trial and checkout actions), "Renewal reminders", "Subscription history" (invoices).
   - Note: the audit's mock had the wrong subscription shape, so only the structure was compared.

13. [major] The My profile drawer is a stub with three facts
   Screen: admin/profile.png. Live: /provider › Account menu › My profile.
   Where: ehr-blue/frame/TopBarParts.tsx:189-206 (AccountSamplePanel)
   Fix:
   - Drawer title "Edit my profile". Uppercase eyebrow "Personal details and account security", a display-font heading "My profile", then a rule.
   - `<EhrCard title="Profile picture">`: the 96px initials avatar with presence dot, and the line "PNG, JPEG, WebP or GIF · up to 2 MB…". No file input (accepted for samples).
   - `<EhrCard title="Personal details">`: "Sign-in email: <strong>{actor.email}</strong>", then sample EhrFields in two columns: Full name * (prefilled with displayName), Phone *, Job title (display only), About you (textarea), Department (display only), Preferred language.
   - Keep the EhrSampleBanner. Save nothing.

14. [major] The phone menu is a full-height modal with a "Menu" header, × and a dark scrim
   Screen: panels/14-mobile-menu-open.png. Live: /provider at 390x844 › Menu.
   Where: packages/ui/src/ehr/EhrSidebar.tsx:128-160; packages/ui/src/ehr/ehr.css:344-372
   Fix:
   - `.hid-ehr-phone-menu { position: fixed; top: <top-bar height>; height: calc(100% - <top-bar height>); width: 247px }`. The top bar stays visible above it.
   - The scrim is transparent and starts below the bar.
   - Hide the header visually but keep the h2 for aria-labelledby. Escape and the Menu button close it.
   - The list starts with Home.

15. [minor] Titles and the facility name are navy; the design uses grey #484f58 (reported by 3 groups)
   Screens: all (for example workspaces/lab-3-detail2.png, billing-1-list.png, roles/*.png). Live: any page.
   Where: packages/ui/src/ehr/ehr.css:441 (.hid-ehr-page-title), :658 (.hid-ehr-card-title); ehr-blue/frame/frame.css:19-21 (.hid-ehr-blue-facility)
   Fix: set `color: var(--ehr-text)` in all three. Buttons, labels, menus, popovers and drawers stay --ehr-ink. Measured: design rgb(72,79,88), live rgb(11,27,46).

16. [minor] Form controls use 14px/400 text; the design uses 13px/500 (2 groups)
   Screens: every *-2-new.png and the search field on every *-1-list.png. Live: for example /provider/bloodbank/new, /provider/appointments.
   Where: packages/ui/src/ehr/ehr.css:583-595, :597-600
   Fix:
   - After `font: inherit;` (line 594), add `font-size: 13px; font-weight: 500; line-height: 1.5;`.
   - Placeholder: `color: #757575`.
   - Then check that the select is 40px and the date input 45px against bloodbank-2-new. Do not hard-set either height.

17. [minor] Status badges are 22px tall and medium weight; the design's are 27px and regular (2 groups)
   Screens: every list, record and history row. Live: any list.
   Where: packages/ui/src/ehr/ehr.css:775-786
   Fix: `font-weight: 400; line-height: 21px;` and keep `padding: 3px 8px`. This gives 27px, as the design's .badge (application.css:131-139). Connected-history rows then reach the design's 56px pitch.

18. [minor] Drawer header and scrim (2 groups)
   Screens: panels/notifications-drawer.png, workspace-search.png, record-quick-view.png, sync-drawer.png, admin/profile.png.
   Differs: the title is 18px/500, Close has an × icon and is small, and the scrim dims the sidebar and the status bar.
   Where: packages/ui/src/ehr/EhrDrawer.tsx:78-86; packages/ui/src/ehr/ehr.css:834-842, :864-872
   Fix:
   - Remove `icon` and `size="sm"` from Close. The design's Close is a text-only 68x40 secondary button.
   - Add `.hid-ehr .hid-ehr-drawer .hid-ehr-overlay-title { font-size: 20px; font-weight: 700 }`.
   - Above 700px, the end-side drawer scrim gets `left: var(--ehr-sidebar-width)` (the collapsed width when the sidebar is collapsed) and `bottom: 64px`.

19. [minor] The Home and bell glyphs differ (3 groups)
   Screens: every screen (sidebar Home, top-bar Notifications).
   Where: packages/ui/src/ehr/EhrIcon.tsx:58 (Home01Icon), :97 (Notification03Icon)
   Fix: inline the design's paths (src/icons.tsx:132-137, 185-189) on a 24px viewBox, with the same stroke as the other EhrIcons.
   - home: `M3 11 12 3l9 8v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z`
   - bell: `M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9` + `M13.7 21a2 2 0 0 1-3.4 0`

20. [minor] The avatar presence dot is too small (2 groups)
   Screens: every screen (top-right), panels/account-menu.png.
   Where: ehr-blue/frame/frame.css:56-79
   Fix:
   - `.hid-ehr-blue-presence { width: 11px; height: 11px; border: 2px solid #fff; right: 0; bottom: 0 }` (design application.css:712).
   - Initials: `font-weight: 600` (design .profile-avatar.initials).

Left out: 12 minors.
- Home widget titles should be 18px bold (frame.css:566-570).
- Phone stacking of the period note and activity figures (frame.css:537-575).
- Search drawer labels and order (TopBarParts.tsx:45-62).
- Notification rows use small buttons (TopBarParts.tsx:98).
- Demo popover copy and style (TopBarParts.tsx:113-120).
- Connection popover button and position, and sync drawer spacing (ConnectionStatus.tsx:31,45; frame.css:622-634).
- No status bar rule on live pages (BlueFrame.tsx:147).
- Phone top bar wrapping (ehr.css:1149-1157).
- Facility review copy "Save local review" (AdminSamples.tsx:77,88).
- Setup step chips too small (AdminSamples.tsx:373).
- Eyebrow 12px too high (ehr.css:425-431).
- Textarea min-height 96 vs 85 (ehr.css:602-605).

---

