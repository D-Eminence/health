# Health ID hospital EHR: screens and flows

Screenshots of every page in the Hospital EHR project from Dashboard.zip. Desktop captures are 1440 px wide and tall pages are kept at full height. All data is fictional.

The three flow maps are in `flow-maps/` (PNG and SVG). Open the published gallery for the same screens with lifecycles and the role table.

| Folder | What it holds |
|---|---|
| `flow-maps/` | How people get in, hospital lifecycle, patient care journey |
| `1-register-and-launch` to `6-subscription` | Step-by-step journeys, numbered in order |
| `workspaces/` | List, create form and detail for each of the 33 workspaces |
| `roles/` | Dashboard for each of the 16 demo roles |
| `admin/` | Hospital admin, platform and error pages |
| `panels/` | Drawers, menus, dialogs and phone or tablet views |


## Register a hospital, get approved, set up and launch

| File | Screen | Route or trigger |
|---|---|---|
| `1-register-and-launch/01-signin.png` | Sign in (entry) | `/signin` |
| `1-register-and-launch/02-register-step1-account.png` | Register: step 1 Your account | `/register` |
| `1-register-and-launch/03-register-step2-facility.png` | Register: step 2 Facility details | `/register` |
| `1-register-and-launch/04-register-step3-verification-docs.png` | Register: step 3 Verification documents | `/register` |
| `1-register-and-launch/05-register-step4-products.png` | Register: step 4 Products & migration | `/register` |
| `1-register-and-launch/06-register-step5-review.png` | Register: step 5 Review & agreements | `/register` |
| `1-register-and-launch/07-register-agreement-dialog.png` | Register: agreements dialog | `/register` |
| `1-register-and-launch/08-registration-submitted.png` | Registration submitted | `/verify?submitted=1` |
| `1-register-and-launch/09-verify-email-code.png` | Verify email code | `/verify?submitted=1` |
| `1-register-and-launch/10-simulation-inbox-code.png` | Simulation controls: inbox shows code | `/simulation` |
| `1-register-and-launch/11-choose-workspace.png` | Choose workspace (institutions) | `/institutions` |
| `1-register-and-launch/12-facility-pending-review.png` | Facility awaiting verification (clinical modules locked) | `/facility` |
| `1-register-and-launch/13-simulation-approved-trial-started.png` | Simulation controls after approval (21-day trial starts) | `/simulation` |
| `1-register-and-launch/14-onboarding-step1-facility.png` | Onboarding: step 1 Facility | `/onboarding` |
| `1-register-and-launch/15-onboarding-step2-type.png` | Onboarding: step 2 Type | `/onboarding` |
| `1-register-and-launch/16-onboarding-step3-departments.png` | Onboarding: step 3 Departments | `/onboarding` |
| `1-register-and-launch/17-onboarding-step4-branches.png` | Onboarding: step 4 Branches | `/onboarding` |
| `1-register-and-launch/18-onboarding-step5-staff.png` | Onboarding: step 5 Staff | `/onboarding` |
| `1-register-and-launch/19-onboarding-step6-roles.png` | Onboarding: step 6 Roles | `/onboarding` |
| `1-register-and-launch/20-onboarding-step7-billing.png` | Onboarding: step 7 Billing | `/onboarding` |
| `1-register-and-launch/21-onboarding-step8-review.png` | Onboarding: step 8 Review | `/onboarding` |
| `1-register-and-launch/22-onboarding-step9-launch.png` | Onboarding: step 9 Launch | `/onboarding` |
| `1-register-and-launch/23-dashboard-new-hospital.png` | Dashboard after launch (empty hospital) | `/dashboard` |


## Sign in with a sign-in code

| File | Screen | Route or trigger |
|---|---|---|
| `2-sign-in/01-signin.png` | Sign in | `/signin` |
| `2-sign-in/02-signin-error.png` | Sign in: wrong password error | `/signin` |
| `2-sign-in/03-verify-mfa.png` | Verify sign-in (MFA code) | `/verify` |
| `2-sign-in/04-simulation-controls-inbox.png` | Simulation controls: inbox + fictional accounts + subscription simulator | `/simulation` |
| `2-sign-in/05-choose-workspace.png` | Choose workspace / branch | `/institutions` |
| `2-sign-in/06-doctor-dashboard.png` | Doctor dashboard after sign-in | `/dashboard` |
| `2-sign-in/07-recover.png` | Recover account access | `/recover` |
| `2-sign-in/08-accept-invitation-form.png` | Accept an invitation (enter link/ID) | `/accept-invitation` |
| `2-sign-in/09-patient-simulation.png` | Patient-side consent simulator | `/patient-simulation` |
| `2-sign-in/10-signed-out-redirect.png` | Protected route while signed out redirects to sign-in | `/signin` |
| `2-sign-in/11-unknown-route-signed-out.png` | Unknown route (signed out) | `/signin` |


## Forgot password

| File | Screen | Route or trigger |
|---|---|---|
| `3-forgot-password/01-recover-form.png` | Forgot password: enter email or phone | `/recover` |
| `3-forgot-password/02-recovery-channel-notice.png` | Neutral notice: check recovery channel (no account disclosure) | `/verify?recoveryRequested=1` |
| `3-forgot-password/03-recovery-verify-code.png` | Enter the recovery code | `/verify?recoveryRequested=1` |
| `3-forgot-password/04-reset-password.png` | Set a new password | `/reset-password` |
| `3-forgot-password/05-signin-after-reset.png` | Back at sign in after reset (all sessions revoked) | `/signin` |


## Invite a staff member

| File | Screen | Route or trigger |
|---|---|---|
| `4-staff-invitation/01-invitation-signed-out.png` | Invitation link (signed out): Sign in or Create account | `/invitation/afb444b4-f2a5-49ad-866a-1e195d46601d` |
| `4-staff-invitation/02-staff-account-create.png` | Create your staff account (reached from the invitation link) | `/register?invite=afb444b4-f2a5-49ad-866a-1e195d46601d` |
| `4-staff-invitation/03-verify-code.png` | Verify the staff email code | `/verify` |
| `4-staff-invitation/04-invitation-accept-signed-in.png` | Invitation (signed in): Accept assigned membership | `/invitation/afb444b4-f2a5-49ad-866a-1e195d46601d` |
| `4-staff-invitation/05-choose-workspace-new-membership.png` | Choose workspace: new Nurse membership | `/institutions` |
| `4-staff-invitation/06-forced-password-change.png` | First login: forced password change in My profile | `/profile` |


## Hand-offs between clinical workspaces

| File | Screen | Route or trigger |
|---|---|---|
| `5-clinical-handoffs/01-patient-detail-next-steps.png` | Patient record: Next steps (appointment, walk-in visit, consent) | `/patients/:id` |
| `5-clinical-handoffs/02-new-visit-prefilled.png` | The next step opens a new visit with the patient already filled in | `/journey/new` |
| `5-clinical-handoffs/03-new-patient-validation.png` | Create form: inline validation on an empty save | `/patients/new` |
| `5-clinical-handoffs/04-patient-created.png` | After saving, the new patient record opens | `/patients/:id` |
| `5-clinical-handoffs/05-consult-signed-connected-orders.png` | Signed consultation: connected orders (pharmacy, laboratory, radiology, referral) | `/consult/:id` |
| `5-clinical-handoffs/06-new-lab-order-prefilled.png` | A connected order opens with patient and encounter carried over | `/lab/new` |
| `5-clinical-handoffs/07-consult-draft-sign-available.png` | Unsigned consultation: Sign encounter is available | `/consult/:id` |
| `5-clinical-handoffs/08-sign-confirmation-dialog.png` | Consequential actions ask for a typed confirmation (SIGN) | `/consult/:id` |
| `5-clinical-handoffs/09-visit-continue-care.png` | Patient visit: Continue care (triage, consultation) | `/journey/:id` |
| `5-clinical-handoffs/10-invoice-payment-form.png` | Invoice: Record simulated payment form, as Cashier | `/billing/:id` |
| `5-clinical-handoffs/11-prescription-dispense-form.png` | Prescription: Dispense quantity form, as Pharmacist | `/pharmacy/:id` |


## Subscription: trial, grace, expiry, renewal

| File | Screen | Route or trigger |
|---|---|---|
| `6-subscription/01-trial-day0.png` | Subscription: free trial running (21 days) | `/subscription` |
| `6-subscription/02-trial-day12.png` | Subscription: day 12 of trial, reminders begin | `/subscription` |
| `6-subscription/03-renewal-reminder-banner.png` | Renewal reminder banner shown on workspace pages (day 20) | `/staff` |
| `6-subscription/04-expiring-soon.png` | Subscription: expiring soon | `/subscription` |
| `6-subscription/05-grace-period.png` | Subscription: 21-day grace period (all work still allowed) | `/subscription` |
| `6-subscription/06-expired-read-only.png` | Subscription: expired - records readable, new writes blocked | `/subscription` |
| `6-subscription/07-expired-create-blocked.png` | Create form while the subscription is expired | `/services/new` |
| `6-subscription/08-renew-confirm.png` | Renewal: confirm demonstration plan (no payment taken) | `/subscription` |
| `6-subscription/09-renewed-active.png` | Subscription: renewed and active | `/subscription` |

## Workspaces

| File | Screen | Route or trigger |
|---|---|---|
| `workspaces/patients-1-list.png` | Patients: List (opened as Receptionist) | `/patients` |
| `workspaces/patients-2-new.png` | Patients: Create form (opened as Receptionist) | `/patients` |
| `workspaces/patients-3-detail.png` | Patients: Record detail (opened as Receptionist) | `/patients` |
| `workspaces/appointments-1-list.png` | Appointments: List (opened as Receptionist) | `/appointments` |
| `workspaces/appointments-2-new.png` | Appointments: Create form (opened as Receptionist) | `/appointments` |
| `workspaces/appointments-3-detail.png` | Appointments: Record detail (opened as Receptionist) | `/appointments` |
| `workspaces/journey-1-list.png` | Patient visits: List (opened as Receptionist) | `/journey` |
| `workspaces/journey-2-new.png` | Patient visits: Create form (opened as Receptionist) | `/journey` |
| `workspaces/journey-3-detail.png` | Patient visits: Record detail (opened as Receptionist) | `/journey` |
| `workspaces/triage-1-list.png` | Triage & Vitals: List (opened as Nurse) | `/triage` |
| `workspaces/triage-2-new.png` | Triage & Vitals: Create form (opened as Nurse) | `/triage` |
| `workspaces/triage-3-detail.png` | Triage & Vitals: Record detail (opened as Nurse) | `/triage` |
| `workspaces/consult-1-list.png` | Consultation: List (opened as Doctor) | `/consult` |
| `workspaces/consult-2-new.png` | Consultation: Create form (opened as Doctor) | `/consult` |
| `workspaces/consult-3-detail1.png` | Consultation: Record detail 1 (opened as Doctor) | `/consult` |
| `workspaces/consult-3-detail2.png` | Consultation: Record detail 2 (opened as Doctor) | `/consult` |
| `workspaces/inpatient-1-list.png` | Inpatient / Wards: List (opened as Doctor) | `/inpatient` |
| `workspaces/inpatient-2-new.png` | Inpatient / Wards: Create form (opened as Doctor) | `/inpatient` |
| `workspaces/inpatient-3-detail1.png` | Inpatient / Wards: Record detail 1 (opened as Doctor) | `/inpatient` |
| `workspaces/inpatient-3-detail2.png` | Inpatient / Wards: Record detail 2 (opened as Doctor) | `/inpatient` |
| `workspaces/wards-1-list.png` | Wards & Beds: List (opened as Nurse) | `/wards` |
| `workspaces/wards-2-new.png` | Wards & Beds: Create form (opened as Nurse) | `/wards` |
| `workspaces/wards-3-detail.png` | Wards & Beds: Record detail (opened as Nurse) | `/wards` |
| `workspaces/nursing-1-list.png` | Nursing observations: List (opened as Nurse) | `/nursing` |
| `workspaces/nursing-2-new.png` | Nursing observations: Create form (opened as Nurse) | `/nursing` |
| `workspaces/nursing-3-detail.png` | Nursing observations: Record detail (opened as Nurse) | `/nursing` |
| `workspaces/nursing-tasks-1-list.png` | Nursing tasks: List (opened as Nurse) | `/nursing-tasks` |
| `workspaces/nursing-tasks-2-new.png` | Nursing tasks: Create form (opened as Nurse) | `/nursing-tasks` |
| `workspaces/nursing-tasks-3-detail.png` | Nursing tasks: Record detail (opened as Nurse) | `/nursing-tasks` |
| `workspaces/emergency-1-list.png` | Emergency: List (opened as Doctor) | `/emergency` |
| `workspaces/emergency-2-new.png` | Emergency: Create form (opened as Doctor) | `/emergency` |
| `workspaces/emergency-3-detail.png` | Emergency: Record detail (opened as Doctor) | `/emergency` |
| `workspaces/maternity-1-list.png` | Maternity: List (opened as Doctor) | `/maternity` |
| `workspaces/maternity-2-new.png` | Maternity: Create form (opened as Doctor) | `/maternity` |
| `workspaces/maternity-3-detail.png` | Maternity: Record detail (opened as Doctor) | `/maternity` |
| `workspaces/surgery-1-list.png` | Theatre & Procedures: List (opened as Doctor) | `/surgery` |
| `workspaces/surgery-2-new.png` | Theatre & Procedures: Create form (opened as Doctor) | `/surgery` |
| `workspaces/surgery-3-detail.png` | Theatre & Procedures: Record detail (opened as Doctor) | `/surgery` |
| `workspaces/icu-1-list.png` | ICU: List (opened as Doctor) | `/icu` |
| `workspaces/icu-2-new.png` | ICU: Create form (opened as Doctor) | `/icu` |
| `workspaces/icu-3-detail.png` | ICU: Record detail (opened as Doctor) | `/icu` |
| `workspaces/dental-1-list.png` | Dental: List (opened as Doctor) | `/dental` |
| `workspaces/dental-2-new.png` | Dental: Create form (opened as Doctor) | `/dental` |
| `workspaces/dental-3-detail.png` | Dental: Record detail (opened as Doctor) | `/dental` |
| `workspaces/consent-1-list.png` | External record access: List (opened as Doctor) | `/consent` |
| `workspaces/consent-2-new.png` | External record access: Create form (opened as Doctor) | `/consent` |
| `workspaces/consent-3-detail.png` | External record access: Record detail (opened as Doctor) | `/consent` |
| `workspaces/lab-1-list.png` | Laboratory: List (opened as Lab Scientist) | `/lab` |
| `workspaces/lab-3-detail1.png` | Laboratory: Record detail 1 (opened as Lab Scientist) | `/lab` |
| `workspaces/lab-3-detail2.png` | Laboratory: Record detail 2 (opened as Lab Scientist) | `/lab` |
| `workspaces/radiology-1-list.png` | Radiology: List (opened as Radiology Reporter) | `/radiology` |
| `workspaces/radiology-3-detail1.png` | Radiology: Record detail 1 (opened as Radiology Reporter) | `/radiology` |
| `workspaces/radiology-3-detail2.png` | Radiology: Record detail 2 (opened as Radiology Reporter) | `/radiology` |
| `workspaces/pharmacy-1-list.png` | Pharmacy: List (opened as Pharmacist) | `/pharmacy` |
| `workspaces/pharmacy-3-detail1.png` | Pharmacy: Record detail 1 (opened as Pharmacist) | `/pharmacy` |
| `workspaces/pharmacy-3-detail2.png` | Pharmacy: Record detail 2 (opened as Pharmacist) | `/pharmacy` |
| `workspaces/billing-1-list.png` | Patient billing: List (opened as Billing Officer) | `/billing` |
| `workspaces/billing-2-new.png` | Patient billing: Create form (opened as Billing Officer) | `/billing` |
| `workspaces/billing-3-detail1.png` | Patient billing: Record detail 1 (opened as Billing Officer) | `/billing` |
| `workspaces/billing-3-detail2.png` | Patient billing: Record detail 2 (opened as Billing Officer) | `/billing` |
| `workspaces/insurance-1-list.png` | Insurance & Claims: List (opened as Billing Officer) | `/insurance` |
| `workspaces/insurance-2-new.png` | Insurance & Claims: Create form (opened as Billing Officer) | `/insurance` |
| `workspaces/insurance-3-detail.png` | Insurance & Claims: Record detail (opened as Billing Officer) | `/insurance` |
| `workspaces/policies-1-list.png` | Policies: List (opened as Billing Officer) | `/policies` |
| `workspaces/policies-2-new.png` | Policies: Create form (opened as Billing Officer) | `/policies` |
| `workspaces/policies-3-detail.png` | Policies: Record detail (opened as Billing Officer) | `/policies` |
| `workspaces/referrals-1-list.png` | Referral Network: List (opened as Doctor) | `/referrals` |
| `workspaces/referrals-2-new.png` | Referral Network: Create form (opened as Doctor) | `/referrals` |
| `workspaces/referrals-3-detail.png` | Referral Network: Record detail (opened as Doctor) | `/referrals` |
| `workspaces/ambulance-1-list.png` | Dispatch: List (opened as Hospital Admin) | `/ambulance` |
| `workspaces/ambulance-2-new.png` | Dispatch: Create form (opened as Hospital Admin) | `/ambulance` |
| `workspaces/ambulance-3-detail.png` | Dispatch: Record detail (opened as Hospital Admin) | `/ambulance` |
| `workspaces/bloodbank-1-list.png` | Blood Bank: List (opened as Lab Manager) | `/bloodbank` |
| `workspaces/bloodbank-2-new.png` | Blood Bank: Create form (opened as Lab Manager) | `/bloodbank` |
| `workspaces/bloodbank-3-detail.png` | Blood Bank: Record detail (opened as Lab Manager) | `/bloodbank` |
| `workspaces/telemedicine-1-list.png` | Telemedicine: List (opened as Doctor) | `/telemedicine` |
| `workspaces/telemedicine-2-new.png` | Telemedicine: Create form (opened as Doctor) | `/telemedicine` |
| `workspaces/telemedicine-3-detail.png` | Telemedicine: Record detail (opened as Doctor) | `/telemedicine` |
| `workspaces/shifts-1-list.png` | Shifts & Roster: List (opened as Hospital Admin) | `/shifts` |
| `workspaces/shifts-2-new.png` | Shifts & Roster: Create form (opened as Hospital Admin) | `/shifts` |
| `workspaces/shifts-3-detail.png` | Shifts & Roster: Record detail (opened as Hospital Admin) | `/shifts` |
| `workspaces/hr-1-list.png` | HR & Credentials: List (opened as Hospital Admin) | `/hr` |
| `workspaces/hr-2-new.png` | HR & Credentials: Create form (opened as Hospital Admin) | `/hr` |
| `workspaces/hr-3-detail.png` | HR & Credentials: Record detail (opened as Hospital Admin) | `/hr` |
| `workspaces/quality-1-list.png` | Quality & Safety: List (opened as Hospital Admin) | `/quality` |
| `workspaces/quality-2-new.png` | Quality & Safety: Create form (opened as Hospital Admin) | `/quality` |
| `workspaces/quality-3-detail.png` | Quality & Safety: Record detail (opened as Hospital Admin) | `/quality` |
| `workspaces/inventory-1-list.png` | Stock: List (opened as Pharmacy Manager) | `/inventory` |
| `workspaces/inventory-2-new.png` | Stock: Create form (opened as Pharmacy Manager) | `/inventory` |
| `workspaces/inventory-3-detail.png` | Stock: Record detail (opened as Pharmacy Manager) | `/inventory` |
| `workspaces/procurement-1-list.png` | Procurement: List (opened as Hospital Owner) | `/procurement` |
| `workspaces/procurement-2-new.png` | Procurement: Create form (opened as Hospital Owner) | `/procurement` |
| `workspaces/procurement-3-detail1.png` | Procurement: Record detail 1 (opened as Hospital Owner) | `/procurement` |
| `workspaces/procurement-3-detail2.png` | Procurement: Record detail 2 (opened as Hospital Owner) | `/procurement` |
| `workspaces/services-1-list.png` | Service catalogue: List (opened as Hospital Admin) | `/services` |
| `workspaces/services-2-new.png` | Service catalogue: Create form (opened as Hospital Admin) | `/services` |
| `workspaces/services-3-detail.png` | Service catalogue: Record detail (opened as Hospital Admin) | `/services` |
| `workspaces/ward-config-1-list.png` | Ward configuration: List (opened as Hospital Admin) | `/ward-config` |
| `workspaces/ward-config-2-new.png` | Ward configuration: Create form (opened as Hospital Admin) | `/ward-config` |
| `workspaces/ward-config-3-detail.png` | Ward configuration: Record detail (opened as Hospital Admin) | `/ward-config` |
| `workspaces/vehicles-1-list.png` | Vehicle configuration: List (opened as Hospital Admin) | `/vehicles` |
| `workspaces/vehicles-2-new.png` | Vehicle configuration: Create form (opened as Hospital Admin) | `/vehicles` |
| `workspaces/vehicles-3-detail.png` | Vehicle configuration: Record detail (opened as Hospital Admin) | `/vehicles` |

## Role dashboards

| File | Screen | Route or trigger |
|---|---|---|
| `roles/hospital-owner-dashboard.png` | Hospital Owner dashboard | `/dashboard` |
| `roles/medical-director-dashboard.png` | Medical Director dashboard | `/dashboard` |
| `roles/hospital-admin-dashboard.png` | Hospital Admin dashboard | `/dashboard` |
| `roles/consultant-dashboard.png` | Consultant dashboard | `/dashboard` |
| `roles/doctor-dashboard.png` | Doctor dashboard | `/dashboard` |
| `roles/nurse-dashboard.png` | Nurse dashboard | `/dashboard` |
| `roles/receptionist-dashboard.png` | Receptionist dashboard | `/dashboard` |
| `roles/records-officer-dashboard.png` | Records Officer dashboard | `/dashboard` |
| `roles/lab-manager-dashboard.png` | Lab Manager dashboard | `/dashboard` |
| `roles/lab-scientist-dashboard.png` | Lab Scientist dashboard | `/dashboard` |
| `roles/pharmacy-manager-dashboard.png` | Pharmacy Manager dashboard | `/dashboard` |
| `roles/pharmacist-dashboard.png` | Pharmacist dashboard | `/dashboard` |
| `roles/billing-officer-dashboard.png` | Billing Officer dashboard | `/dashboard` |
| `roles/cashier-dashboard.png` | Cashier dashboard | `/dashboard` |
| `roles/radiology-reporter-dashboard.png` | Radiology Reporter dashboard | `/dashboard` |
| `roles/platform-super-admin-dashboard.png` | Platform Super Admin dashboard | `/dashboard` |

## Admin and platform pages

| File | Screen | Route or trigger |
|---|---|---|
| `admin/owner-dashboard.png` | Home dashboard (Owner) (Hospital Owner) | `/dashboard` |
| `admin/staff.png` | Staff & access (Hospital Owner) | `/staff` |
| `admin/facility.png` | Facility profile (Hospital Owner) | `/facility` |
| `admin/setup.png` | Facility settings (setup stepper after launch) (Hospital Owner) | `/setup` |
| `admin/subscription.png` | Facility subscription (Hospital Owner) | `/subscription` |
| `admin/reports.png` | Reports & Analytics (Hospital Owner) | `/reports` |
| `admin/audit.png` | Audit & Compliance (Hospital Owner) | `/audit` |
| `admin/institutions.png` | Choose workspace (Owner) (Hospital Owner) | `/institutions` |
| `admin/platform.png` | Facility review (platform reviewer) (Platform Super Admin) | `/platform` |
| `admin/profile.png` | My profile (drawer) (Hospital Owner) | `/profile` |
| `admin/unknown-route.png` | Unknown route inside workspace (Hospital Owner) | `/not-a-page` |
| `admin/denied-route-redirect.png` | Direct URL to unauthorised page: redirected to Home with notice (Cashier) | `/lab` |

## Panels, dialogs and phone views

| File | Screen | Route or trigger |
|---|---|---|
| `panels/notifications-drawer.png` | Notifications drawer | Bell in the top bar |
| `panels/account-menu.png` | Account menu | Avatar: profile, status, preferences, help, sign out |
| `panels/workspace-search.png` | Workspace search | Ctrl or Cmd+K, shown with the query 'lab' |
| `panels/demo-chip-popover.png` | About this demo | The Demo chip in the top bar |
| `panels/connection-popover.png` | Connection and sync status | Bottom-right status chip |
| `panels/sync-drawer.png` | Sync details | View sync details from the status popover |
| `panels/record-quick-view.png` | Record quick view | Quick view button on any list row |
| `panels/action-form-collect-sample.png` | Action form on a record | Collect sample, opened inline on a laboratory order |
| `panels/12-sidebar-collapsed.png` | Sidebar collapsed to an icon rail | /dashboard |
| `panels/13-mobile-dashboard.png` | Phone (390 px): dashboard | /dashboard |
| `panels/14-mobile-menu-open.png` | Phone: navigation menu open | /dashboard |
| `panels/15-mobile-patients-list.png` | Phone: patients list | /patients |
| `panels/16-mobile-signin.png` | Phone: sign in | /signin |
| `panels/17-tablet-signin.png` | Tablet (820 px): sign in | /signin |
