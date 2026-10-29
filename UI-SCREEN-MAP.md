# Screen and component map - simplification audit

Source-derived map, 2026-10-03. Existing runtime only; proposed navigation changes have not been applied.

## Routes outside the catalogue

| Route / surface | Existing implementation | Audit applicability |
|---|---|---|
| /signin | AuthPage / AuthShell | Compact logo and eye alignment already fixed; demo copy consolidation and consistent terminology remain. |
| /register | Registration, five-step saved form; AuthPage staff account variant when invited | Provider-neutral language; unify identity editing sources without removing stages. |
| /verify | Email verification, MFA, onboarding/recovery confirmation pages | Keep generated-code explanation in demo chip plus essential action feedback; preserve distinct confirmation states. |
| /recover, /reset-password | AuthPage | Keep neutral recovery and inline errors; no new overlay over forms. |
| /accept-invitation, /invitation/:id | Invitation lookup/review/acceptance | One primary invitation outcome; route joins existing staff account/auth flow. |
| /institutions | Institutions | Actual authorized memberships/branches; becomes primary destination of context switch. |
| /dashboard | Dashboard | All roles currently use one generic metrics/module-card template; replace with role/provider widgets. |
| /profile | StaffProfile, standalone when no active membership; Drawer inside workspace | Remove repeated title; personal/security/preferences/presence grouped under one avatar-menu destination. |
| /facility | FacilityProfile + HospitalIdentity + FacilityPresencePolicy | Settings primary home; duplicate identity fields and verification banner state require correction. |
| /subscription | SubscriptionPage + SubscriptionCard | Exact-finance roles; remove self-link and duplicate lifecycle notice; distinguish patient billing. |
| /staff | Staff | Membership access, invitations/bulk actions, credentials and branches; clarify identity/access vs HR/configuration. |
| /setup, /onboarding | Onboarding nine-step operational configuration | Keep aliases and partial progress; Settings links to canonical configuration sources. |
| /reports | Reports | Permissions and dates retained; meaningful report units; no duplicate dashboard statistics. |
| /audit | Audit history within App | Preserve audit detail/provenance despite visual simplification; consistent page header. |
| /platform | Platform | Separate platform reviewer tasks; not an Owner dashboard or clinical access grant. |
| /simulation | Simulation controls/inbox/fictional accounts | Accessible through one configurable demo chip. Production configuration must disable the route, not merely hide the link. |
| /patient-simulation | PatientSimulator | Supporting fictional consent decisions and released records; not a full patient portal. |
| Unknown/denied/expired/not-ready route | App guards / error boundaries | Preserve neutral denial, loading, retry and safe-return states; no new dead navigation destinations. |

## Catalogue surfaces

For each module: `/<id>` list, `/<id>/new` where create permission exists, and `/<id>/:recordId` detail. Quick view and filter drawers are shared. Action forms derive from catalogue transitions and retain their action permission. Some lifecycle work creates related child entities; these must not be mistaken for duplicate modules.

| Module route | Field count | Configured actions |
|---|---|---|
| /patients | 8 | Correct demographics (`edit`) |
| /appointments | 4 | Reschedule (`reschedule`); Check in (`checkin`); Cancel appointment (`cancel`); Mark no-show (`noShow`) |
| /journey | 3 | Assign / transfer queue (`assign`); Complete visit (`complete`); Cancel visit (`cancel`) |
| /triage | 8 | Complete triage (`complete`); Amend observation (`amend`) |
| /consult | 8 | Sign encounter (`sign`); Amend signed note (`amend`) |
| /lab | 4 | Collect sample (`collect`); Start processing (`process`); Save draft result (`result`); Verify result (`verify`); Publish result (`publish`); Reject sample (`reject`); Correct published result (`correct`); Cancel order (`cancel`) |
| /radiology | 4 | Schedule examination (`schedule`); Record examination (`examine`); Attach local study (`attach`); Draft report (`report`); Review report (`review`); Publish report (`publish`); Correct report (`correct`) |
| /pharmacy | 6 | Review prescription (`review`); Dispense quantity (`dispense`) |
| /inpatient | 2 | Admit and allocate bed (`admit`); Transfer bed (`transfer`); Prepare discharge (`prepare`); Discharge patient (`discharge`) |
| /wards | 2 | Complete bed turnover (`clean`); Place in maintenance (`maintenance`); Release from maintenance (`release`) |
| /nursing | 4 | Amend observation (`amend`) |
| /emergency | 3 | Record assessment (`assess`); Record disposition (`disposition`) |
| /maternity | 2 | Antenatal observation (`observe`); Record delivery (`delivery`); Postnatal follow-up (`followup`) |
| /surgery | 2 | Schedule procedure (`schedule`); Complete demo checklist (`checklist`); Document procedure (`perform`); Complete recovery (`recover`); Cancel procedure (`cancel`) |
| /icu | 2 | Admit and allocate bed (`admit`); Transfer bed (`transfer`); Prepare discharge (`prepare`); Discharge patient (`discharge`) |
| /dental | 2 | Record assessment (`assess`); Record treatment (`perform`); Arrange follow-up (`followup`) |
| /billing | 3 | Issue invoice (`issue`); Record simulated payment (`pay`); Refund payment (`refund`); Void invoice (`void`) |
| /insurance | 4 | Submit simulated claim (`submit`); Record payer decision (`approve`); Record rejection (`reject`); Record simulated settlement (`settle`) |
| /inventory | 5 | Receive stock (`receive`); Consume / adjust stock (`adjust`); Transfer stock (`transfer`) |
| /procurement | 4 | Approve request (`approve`); Create purchase order (`order`); Receive goods (`receive`) |
| /referrals | 5 | Send simulated referral (`send`); Simulate recipient acceptance (`accept`); Complete referral (`complete`) |
| /ambulance | 4 | Dispatch vehicle (`dispatch`); Complete dispatch (`complete`); Cancel dispatch (`cancel`) |
| /bloodbank | 3 | Record screening review (`screen`); Reserve unit (`reserve`); Issue unit (`issue`); Dispose unit (`dispose`) |
| /telemedicine | 3 | Enter local waiting room (`wait`); Start local session simulation (`start`); End and document session (`end`) |
| /shifts | 4 | Simulated clock-in (`clockin`); Simulated clock-out (`clockout`) |
| /hr | 5 | Record credential review (`review`) |
| /quality | 2 | Assign reviewer (`assign`); Record investigation (`investigate`); Resolve incident (`resolve`) |
| /consent | 3 | No catalogue transition actions |
| /services | 2 | No catalogue transition actions |
| /ward-config | 1 | No catalogue transition actions |
| /vehicles | 2 | Maintenance (`maintenance`); Release vehicle (`release`) |
| /policies | 4 | No catalogue transition actions |
| /nursing-tasks | 4 | Start task (`start`); Complete task (`complete`); Cancel task (`cancel`) |

## Overlay and state surfaces

| Surface | Existing shared implementation | Primary-home decision |
|---|---|---|
| Notifications | App Drawer + visibleNotifications | Bell only; no second inbox. |
| Profile | StaffProfile inside Drawer | Avatar menu primary; deep link retained. |
| Staff access/invitation detail | Staff shared Drawer | Staff workspace; credential-inbox overlap needs explicit ownership. |
| Record quick view | Workflow Drawer | Secondary list action; full detail is canonical route. |
| Text filters | Workflow Drawer and inline search | Duplicate query; consolidate. |
| File preview | DataView Drawer | Contextual attachment preview, not duplicate storage. |
| Connection summary/sync queue | OfflineTools Popover/Drawer | Reserved passive shell status; same sync drawer. |
| Conflict review | ConflictReviewDrawer | From sync review; preserve explicit clinician decision and history. |
| Presence | PresencePicker Popover / PresenceSettings | Immediate choice in avatar menu; expanded preferences in profile. |
| Sensitive confirmation/password | FeedbackHost singleton decision | Reuse outcome-labelled dialog and eye input. |
| Workspace search | WorkspaceSearch Drawer | Expand existing search with separately authorized entity sources. |
| Context switch | App Drawer | Only if multiple contexts; protect drafts. |
| Offline lock | OfflineTools lock dialog | Separate privacy boundary, not connectivity notification. |
| Toasts, banners, validation, skeleton/empty | feedback.tsx / ui.tsx | One condition, one message home; no fake loading or metrics. |
| Errors/restore/unavailable screens | App/ConnectionBoundary | Preserve saved data and meaningful retry. |

## State coverage constraint

The source inventory preserves exact fields/actions and role permissions for implementation review. The previous 42 tests and responsive sweep are a baseline, not evidence that every listed action state has been visually reviewed. After approved restructuring, verify all configured action forms, permission-denied paths, empty/loading/error states and touched overlays against the new common patterns.
