Build the Hospital EHR and hospital operations component of Health ID into a complete, connected frontend application.

Use the attached HID.html and the supplied Hospital EHR specification as source references.

The first implementation focus is the hospital system: account creation, hospital onboarding, staff access, role-based workspaces, patient management, clinical workflows, diagnostics, pharmacy, billing, administration, and hospital operations.

This is strictly a frontend implementation. All accounts, verification, permissions, transactions, notifications, and integrations must run through a persistent local simulation.

Do not build a backend, connect Supabase, create server functions, send real emails, process real payments, or connect external medical services.

Do not add visual design specifications. Follow the existing project’s established components without introducing a new design direction.

The application must work through complete user journeys. A collection of dashboard previews is insufficient.

## 1. Define the implementation scope

Implement the hospital-facing application under the Health ID product.

Use “Health ID — Hospital EHR” as the product context. Preserve HID where it is already used in identifiers or existing module references.

Include:

- Hospital account registration.
- Email verification.
- Staff sign-in.
- Simulated MFA.
- Password recovery.
- Institution and branch selection.
- Hospital onboarding.
- Staff invitations.
- Memberships and permissions.
- Role-specific dashboards.
- Clinical modules.
- Diagnostics.
- Pharmacy.
- Billing and insurance.
- Inventory and procurement.
- Hospital administration.
- Network and support services.
- Consent and emergency access.
- Audit history.
- Persistent sessions and drafts.

Defer these separate products from this first implementation:

- Full consumer patient portal.
- Medical outreach platform.
- HID Migrate.
- Developer API portal.
- Standalone pharmacy and laboratory product onboarding.
- Marketing website.

Include only a minimal patient-side simulation needed to approve or reject hospital access requests and inspect released records. Keep it separate from the hospital workspace.

Do not let these supporting simulations expand into unrelated product development.

## 2. Audit the existing application before implementation

Inspect the bundled source inside HID.html.

Identify:

- Components that can be reused.
- Duplicate authentication implementations.
- Static fixtures.
- Forms that do not save their values.
- Buttons without meaningful outcomes.
- Modules using independent copies of the same records.
- Navigation that exists only in component state.
- Unrestricted role switching.
- Patient selection that automatically creates external record access.
- Setup steps that show information without actually configuring anything.

Replace incomplete behavior while preserving useful existing functionality.

Create one authoritative authentication flow, one shared data model, and one routing system.

Do not maintain old and new workflows in parallel.

## 3. Build a shared frontend domain model

Use React and TypeScript with URL-based routing.

Create shared entities for:

- Account.
- Hospital.
- Branch.
- Department.
- Service.
- Membership.
- Role and permission.
- Staff invitation.
- Staff profile.
- Professional credential.
- Shift and roster assignment.
- Patient identity.
- Hospital patient registration.
- Appointment.
- Visit.
- Queue entry.
- Triage record.
- Encounter.
- Clinical note.
- Prescription and prescription item.
- Laboratory order, sample, and result.
- Radiology order, study, and report.
- Admission.
- Ward and bed.
- Nursing task and observation.
- Procedure.
- Invoice.
- Payment.
- Refund.
- Insurance policy and claim.
- Inventory item, batch, and stock movement.
- Purchase request and purchase order.
- Referral.
- Ambulance and dispatch.
- Blood donation and blood unit.
- Telemedicine session.
- Quality incident.
- Consent request.
- Access grant.
- Notification.
- Audit event.

Give every entity stable identifiers.

Store relationships through IDs rather than duplicating entire records inside unrelated modules.

Separate account identity from hospital membership and patient identity.

Separate the patient’s simulated global Health ID from their hospital-specific medical record number.

Every hospital must have isolated local records. Branch access must be explicit.

## 4. Persistent simulation layer

Create a local mock service layer between components and stored data.

The service layer must handle:

- Reads.
- Validation.
- Mutations.
- Permission checks.
- Status transitions.
- Notifications.
- Audit events.
- Simulated asynchronous operations.
- Controlled failures and retry.

Persist structured records and drafts in IndexedDB.

Use localStorage only for small preferences and suitable simulated session metadata.

Include:

- Storage schema version.
- Initial fictional seed data.
- Explicit sample-data loading.
- Reset controls.
- Storage failure handling.
- Protection against repeated submission.
- Consistent timestamps.

A successful operation must update the actual shared record. A success message alone does not count as implementation.

Use fictional information only. Clearly identify the environment as a local demonstration.

## 5. Public entry and account ownership

Provide these hospital entry paths:

1. Register a hospital.
2. Sign in to an existing account.
3. Accept a staff invitation.
4. Recover account access.

Hospital registration is for an authorized owner or administrator establishing the organization.

Public registration must not allow a user to grant themselves Doctor, Medical Director, Pharmacist, or Platform Super Admin permissions.

The hospital creator receives the initial Hospital Owner membership.

They can invite an administrator and other staff through controlled role assignment.

One account can have memberships in multiple hospitals. Each membership has its own role, branches, department, and status.

## 6. Hospital owner registration

Implement:

Register hospital → create account → verify email → start hospital setup → review configuration → launch hospital → owner dashboard.

Account fields:

- Full name.
- Email.
- Phone.
- Password.
- Confirm password.
- Terms acknowledgement.

Validate required fields and duplicate account emails.

Do not store raw passwords in persistent records or expose them in logs. Credential checks remain a frontend simulation.

If an account already exists, offer sign-in and continue hospital registration after authentication.

Prevent repeated submission from creating duplicate accounts or hospitals.

Keep account verification status separate from hospital verification status.

## 7. Email verification simulation

Create a simulated inbox accessible through development controls.

Account verification must include:

- Code generation.
- Code entry.
- Incorrect-code handling.
- Expiry.
- Resend cooldown.
- Invalidation of previous codes after resend.
- Attempt limits.
- Change-email flow.
- Successful verification.

Do not accept any arbitrary code.

Do not claim a real email was sent. Use wording that makes the simulated delivery clear.

Verification must persist. A refreshed browser must not restart the process unnecessarily.

## 8. Sign-in, MFA, and account recovery

Implement the hospital staff sequence:

Credentials → simulated MFA → institution selection when needed → onboarding or authorized workspace.

Validate credentials against local accounts.

For this frontend scope, use simulated email codes as the MFA mechanism. Do not label the flow as a production security implementation.

Handle:

- Incorrect credentials.
- Unverified account.
- Incorrect MFA code.
- Expired MFA code.
- Suspended membership.
- No active membership.
- Multiple memberships.
- Incomplete hospital setup.
- Expired simulated session.

Password recovery must include:

Request reset → simulated recovery code → verify code → enter new password → confirm replacement → return to sign-in.

Changing a password must update local credential verification and invalidate the relevant previous simulated sessions.

Do not send users directly back to login after only entering an email.

## 9. Session restoration and routing

Use real application routes for authentication, onboarding, dashboards, lists, and record detail pages.

Support browser back, forward, direct URLs, and refresh.

After sign-in, resolve:

1. Verification requirements.
2. Pending invitation.
3. Incomplete onboarding.
4. Active hospital memberships.
5. Institution selection if necessary.
6. Branch selection where necessary.
7. Last authorized route.
8. Role dashboard fallback.

Preserve:

- Simulated session.
- Hospital.
- Branch.
- Current route.
- Draft forms.
- Onboarding step.
- Relevant filters.
- Current patient and visit context where valid.

Returning from another app must not redirect the user to the welcome screen.

Hydrate stored state before applying route guards.

If membership or permission changes invalidate the current route, explain the change and redirect to a permitted destination.

Signing out clears active session access while preserving saved hospital records.

## 10. Nine-step hospital onboarding

Preserve the source’s nine-step structure:

1. Facility.
2. Type.
3. Departments.
4. Branches.
5. Staff.
6. Roles.
7. Billing.
8. Review.
9. Launch.

Each step must collect or configure actual persistent data.

Support save and exit, back navigation, validation, refresh, and resume.

Distinguish required launch configuration from optional configuration that can be completed later.

### Step 1: Facility

Collect:

- Hospital name.
- Main phone.
- Main email.
- Address.
- City.
- State.
- Optional registration details.
- Optional logo.

Provide simulated registration-review states if included:

- Not submitted.
- Submitted.
- Pending review.
- Verified.
- Rejected.

Entering a registration number must not automatically mark the hospital verified.

### Step 2: Type

Support the source’s facility types:

- Clinic.
- Specialist Clinic.
- Diagnostic Centre.
- Maternity Centre.
- Community Hospital.
- Specialist Hospital.
- Multi-Branch Hospital.
- Teaching Hospital.

Treat these as presets, not restrictions on all future configuration.

“Multi-Branch” should also configure branch structure; do not create conflicting facility and branch settings.

Changing the type can suggest department defaults. Ask before replacing departments the user has already customized.

### Step 3: Departments

Support:

- General Outpatient.
- Emergency.
- Inpatient.
- Laboratory.
- Pharmacy.
- Maternity.
- Pediatrics.
- Radiology.
- Dental.
- Physiotherapy.
- Dialysis.
- Oncology.
- Cardiology.
- ICU.
- Theatre.

Explain the functional consequences of enabling each department:

- Modules.
- Role templates.
- Queues.
- Configuration requirements.

Only genuine shared essentials are mandatory.

Do not force admissions on a diagnostic centre or theatre on a clinic.

Distinguish a clinical specialty from a separate operational module. Cardiology, for example, can use shared appointments, triage, and consultation workflows with department-specific context.

### Step 4: Branches

Support single-location and multi-location hospitals.

Create a real main branch.

For each branch collect:

- Name.
- Address.
- Contact.
- Enabled departments.
- Operating hours.

Departments can differ between branches.

### Step 5: Staff

Configure:

- Departments.
- Reporting relationships.
- Shift definitions.
- Initial staff invitations.

Allow inviting staff later.

Invitation fields:

- Name.
- Email.
- Role.
- Department.
- Branch access.

Avoid requiring users to invent a complete reporting hierarchy before launch.

### Step 6: Roles

Show role templates generated from enabled services.

Configure permission scopes and branch access.

Keep administrative authority separate from clinical authority.

The owner does not automatically receive permission to prescribe, sign notes, verify laboratory results, or dispense controlled medication.

### Step 7: Billing

Configure hospital service billing:

- Currency.
- Service catalogue.
- Service prices.
- Invoice numbering.
- Accepted simulated payment methods.
- Payment timing policy.
- Insurance support if enabled.

Do not confuse patient billing with Health ID subscription billing.

Any platform subscription section must use fictional configurable plans and provide demo access without real payment.

### Step 8: Review

Show the complete configuration with edit actions.

Identify:

- Missing required fields.
- Inconsistent branch settings.
- Missing operational dependencies.
- Optional unfinished items.

### Step 9: Launch

Launch once, using an idempotent operation.

Create the hospital configuration, branches, memberships, services, and available navigation.

Provide next actions:

- Register patient.
- Invite staff.
- Book appointment.
- Configure wards.
- Add inventory.
- Complete service pricing.

A newly registered hospital starts empty unless sample data is explicitly loaded.

## 11. Staff invitations and lifecycle

Implement:

Invitation link → invitation details → sign in or create account → verify account if needed → accept membership → role dashboard.

Support:

- Pending.
- Accepted.
- Expired.
- Revoked.

Handle wrong-account acceptance explicitly.

Users cannot change their assigned role through the invitation flow.

Staff management must support:

- Invite.
- Resend.
- Revoke invitation.
- Edit membership.
- Change department.
- Change branch access.
- Suspend.
- Restore.
- End membership.

Keep employment status, leave status, and account access status separate.

A staff member marked “On leave” is not automatically the same as a suspended account.

Permission changes must affect active routes and mutation handlers.

## 12. Role model and permission boundaries

Preserve these source roles:

- Platform Super Admin.
- Hospital Owner.
- Medical Director.
- Hospital Admin.
- Consultant.
- Doctor.
- Nurse.
- Receptionist.
- Records Officer.
- Lab Manager.
- Lab Scientist.
- Pharmacy Manager.
- Pharmacist.
- Billing Officer.
- Cashier.

Additional roles must be introduced only where an enabled workflow needs them.

The L1–L7 source groupings are organizational categories, not an automatic permission inheritance ladder.

Define permissions separately for:

- View.
- Create.
- Edit.
- Assign.
- Approve.
- Sign.
- Publish.
- Dispense.
- Collect payment.
- Refund.
- Export.
- Manage configuration.
- Manage staff.
- Request external access.
- Use emergency access.

Apply permissions in:

- Navigation.
- Route guards.
- Mock service operations.
- Record actions.
- Exports.

A doctor viewing a lab result is different from a lab scientist authoring it.

A billing officer can prepare invoices and claims; a cashier can collect permitted payments without receiving all financial administration capabilities.

Lab roles do not automatically receive radiology-authoring privileges.

## 13. Role dashboards

Build dashboards from current shared records.

### Platform Super Admin

Facility status, setup progress, account and membership administration, local platform activity, and configuration oversight.

No unrestricted patient clinical access by default.

### Hospital Owner

Revenue, outstanding balances, operational volume, branch summaries, staffing, and configuration tasks.

### Medical Director

Clinical workload, admissions, pending reviews, quality incidents, and authorized clinical governance summaries.

### Hospital Admin

Staffing gaps, invitations, operational queues, configuration tasks, inventory issues, shifts, and credentials.

### Consultant and Doctor

Assigned queue, triage summaries, active encounters, pending results, reviews, prescriptions, and referrals.

### Nurse

Triage queue, vitals, ward observations, nursing tasks, handovers, and relevant maternity activity.

### Receptionist

Appointments, arrivals, registration, check-in, queue placement, and permitted payment tasks.

### Records Officer

Patient identity corrections, duplicate candidates, record completeness, permitted release tasks, and audit activity.

### Laboratory roles

Orders, samples, processing, results awaiting verification, published results, and applicable stock.

### Pharmacy roles

Prescription queue, partial dispensing, stock alerts, batch expiry, and controlled-drug activity.

### Billing Officer and Cashier

Invoices, outstanding balances, payments, claims, refunds requiring approval, and daily collection summaries according to permissions.

Every dashboard action must open the relevant working workflow.

## 14. Hospital module structure

Retain these functional groups.

Clinical:

- Dashboard.
- Patients.
- Appointments.
- Triage & Vitals.
- Patient Journey.
- Consultation.
- Inpatient / Wards.
- Emergency.
- Maternity.
- Theatre.
- ICU.
- Dental.

Diagnostics:

- Laboratory.
- Radiology.
- Pharmacy.

Operations:

- Billing & Revenue.
- Insurance & Claims.
- Inventory & Procurement.
- Reports & Analytics.
- Audit & Compliance.

Network & Services:

- Ambulance.
- Blood Bank.
- Telemedicine.
- Referral Network.

Administration:

- Hospital Setup.
- Staff & Roles.
- Shifts & Roster.
- HR & Credentials.
- Quality & Safety.

Visible modules depend on hospital configuration, branch services, role, and permissions.

Do not show every user every module.

## 15. Patient registration and identity

Support patient search, registration, demographics, identifiers, duplicate review, and hospital enrolment.

Store separately:

- Health ID.
- Hospital medical record number.
- Patient demographics.
- Hospital registration.
- Account ownership.
- External access grants.

Search must support name, Health ID, medical record number, and appropriate contact fields.

Name similarity can suggest a duplicate. It cannot prove that two people are the same.

Use multiple matching fields and explicit review before linking.

Do not automatically merge records.

Support patients without a verified Health ID by creating a provisional local identity.

Registering a patient must not create an external-history access grant.

## 16. Appointments, visits, and queues

Support:

- Book appointment.
- Reschedule.
- Cancel.
- Mark no-show.
- Check in.
- Register walk-in.
- Assign clinician.
- Assign department.
- Transfer queue.
- Complete or cancel visit.

Prevent conflicting bookings according to configured clinician availability.

Keep appointment status separate from visit status.

Check-in creates or links a visit and queue entry.

The Patient Journey module must derive its stages from underlying events rather than keeping an independent status.

A visit can have parallel pending laboratory, pharmacy, and billing activities.

Never use a generic “Advance” action to bypass required data or role-specific approvals.

## 17. Triage and nursing

Support:

- Triage queue.
- Vital entry.
- Units.
- Timestamp.
- Recording nurse.
- Priority.
- Presenting complaint.
- Relevant observations.
- Save draft.
- Complete triage.
- Correct a previous observation through recorded amendment.

Completed triage becomes available in the clinician’s queue.

If demonstration abnormality flags are included, use explicit fictional configurable rules. Identify them as demonstration rules rather than validated clinical decision support.

Do not diagnose patients automatically.

Nursing observations and medication administration records must remain distinct from pharmacy dispensing records.

## 18. Consultation workflow

Support:

- Patient and visit context.
- Local hospital record history.
- Triage.
- Presenting complaint.
- History.
- Examination.
- Diagnosis entry.
- Clinical notes.
- Prescriptions.
- Laboratory orders.
- Radiology orders.
- Referrals.
- Follow-up.
- Encounter summary.

Lifecycle:

Draft → saved draft → signed → amended where necessary.

Preserve signed versions. Amendments require author, time, and reason.

Create prescriptions and orders as shared entities linked to the patient, visit, encounter, and author.

Use a fictional medication and diagnosis catalogue.

Medication classification and allergy warnings can use transparent fixture rules. Do not claim a complete interaction engine or automatically recommend treatment.

Require clinician confirmation.

Signing an encounter must not automatically complete unrelated pending investigations.

## 19. Laboratory

Implement:

Order → sample collection → processing → draft result → verification → publication.

Store sample identity, collector, collection time, processing details, result values, units, comments, reviewer, and publication time.

Support cancellation, rejected samples, recollection, and corrected reports.

Verification permissions must be explicit.

Publishing updates the clinician’s pending-results workflow.

Keep draft, verified, and published states distinct.

Correcting a published result preserves the earlier report.

## 20. Radiology

Implement:

Order → scheduling → examination → local study attachment → draft report → review → publication.

Support ordering clinician, modality, indication, urgency, report author, and reviewer.

File preview must work for supported local files.

Do not imply a live PACS or DICOM service.

Radiology reporting requires its own permission scope.

## 21. Pharmacy

Implement:

Prescription → review → stock selection → partial or full dispensing → fulfilment history.

Each item tracks:

- Prescribed quantity.
- Dispensed quantity.
- Remaining quantity.
- Batch.
- Dispensing pharmacist.
- Timestamp.

Prevent duplicate fulfilment and negative stock.

Prevent routine dispensing from expired batches.

Controlled-drug simulation must require the appropriate permission and capture a dedicated audit record.

Do not infer real professional authorization from a role label or fictional licence.

## 22. Inpatient, wards, and beds

Implement:

Admission request → admission → bed assignment → observations and tasks → transfers → discharge preparation → discharge summary → bed turnover.

Separate:

- Admission status.
- Bed occupancy.
- Cleaning status.
- Maintenance status.

Prevent simultaneous active allocation of the same bed.

Support ward transfer and nursing handover.

Discharge closes the admission while preserving unresolved financial balances and follow-up tasks.

Do not delete the patient’s clinical history when closing an admission.

## 23. Emergency and external access

Emergency department activity and external break-glass access are different functions.

Emergency care must support rapid local registration, triage, clinical assignment, and disposition.

First-party hospital records are available according to normal role permissions.

Cross-institution history requires a separate grant.

Normal external-access flow:

Identify patient → request defined scope → patient simulation approves or declines → active grant → permitted history.

Record:

- Requesting clinician.
- Hospital.
- Patient.
- Reason.
- Categories.
- Duration.
- Approval.
- Expiry.
- Revocation.

Patient selection must never automatically grant access.

Emergency break-glass requires an authorized clinical role, patient identity, reason, justification, acknowledgement, short-lived grant, and audit events.

Recheck grants when records are displayed and when access changes.

On expiry or revocation, remove protected external content while preserving the clinician’s own unsaved local note.

Record which external categories were viewed.

## 24. Maternity, theatre, ICU, and dental

Implement meaningful workflows rather than generic department placeholders.

Maternity:

- Antenatal enrolment.
- Scheduled visits.
- Observations.
- Delivery episode.
- Postnatal follow-up.
- Linked newborn identity where applicable.

Theatre:

- Procedure request.
- Scheduling.
- Team assignment.
- Checklist completion.
- Procedure documentation.
- Recovery.
- Cancellation.

ICU:

- Admission or transfer.
- Bed allocation.
- Observation records.
- Assigned care team.
- Tasks.
- Transfer or discharge.

Dental:

- Appointment.
- Assessment.
- Findings.
- Treatment plan.
- Procedure.
- Follow-up.

Use shared patient, visit, admission, order, and billing infrastructure.

Do not imply that clinical checklists are authoritative medical guidance.

## 25. Billing and revenue

Support:

- Service charges.
- Invoice drafts.
- Invoice issue.
- Partial payment.
- Full payment.
- Outstanding balance.
- Void.
- Refund.
- Receipt.
- Print or download.

Calculate totals from actual line items and payment records.

Prevent duplicate payments and refunds beyond the available refundable balance.

Use simulated payment methods and clearly identify all transactions as fictional.

Clinical ordering, service completion, charging, and payment are distinct events. Use configured charging rules to prevent duplicate charges.

Hospital subscription billing must remain separate.

## 26. Insurance and claims

Support:

- Insurer.
- Patient coverage.
- Policy details.
- Coverage checks using local fixtures.
- Authorization reference.
- Claim creation.
- Supporting service records.
- Submission simulation.
- Approval.
- Partial approval.
- Rejection.
- Resubmission.
- Settlement simulation.

Keep claim approval separate from payment receipt.

Link claims to actual invoices and services.

Do not claim live HMO integration or real eligibility verification.

## 27. Inventory and procurement

Support:

- Items.
- Categories.
- Units and pack conversions.
- Batches.
- Expiry.
- Location.
- Reorder threshold.
- Stock receipt.
- Consumption.
- Transfer.
- Adjustment with reason.
- Movement history.

Procurement:

Request → approval → purchase order → partial or full receipt → closure.

Prevent stock from increasing merely because a purchase order was approved. Increase it only when goods are received.

Stock transfers must debit and credit the correct locations.

Keep equipment assets separate from consumables where their lifecycle differs.

## 28. Network and support services

Ambulance:

Maintain vehicles, availability, maintenance, dispatch requests, crew assignment, dispatch, completion, and cancellation.

Prevent conflicting active dispatches.

Blood Bank:

Track donations, screening and quarantine states, units, expiry, reservation, issue, disposal, and movement history.

Do not automatically declare compatibility or suitability from blood group alone.

Telemedicine:

Track booking, waiting, session start, session end, documentation, and follow-up.

Use an explicit local session simulation. Do not imply real video connectivity.

Referrals:

Create destination, reason, urgency, selected clinical summary, consent scope, sending state, acceptance, and completion.

Sending a referral does not grant unrestricted external-history access to the receiving hospital.

## 29. Shifts, HR, and quality

Shifts & Roster:

Define shifts, assign staff, detect conflicts, record simulated clock-in and clock-out, and preserve handover notes.

HR & Credentials:

Store fictional professional credentials, expiry, review status, leave requests, and employment details.

Distinguish recorded credential information from independently verified credentials.

Quality & Safety:

Create incidents, assign reviewers, record investigation, corrective actions, resolution, and history.

Calculate metrics only where their underlying events and denominator are defined.

Show “No data” instead of invented satisfaction, infection, or readmission percentages.

## 30. Reports, notifications, and audit

Reports must use shared records and respect hospital, branch, date, and permission filters.

Define metrics precisely, including:

- Visits.
- Completed encounters.
- Queue waiting time.
- Admissions.
- Bed occupancy.
- Published results.
- Prescription fulfilment.
- Invoiced amount.
- Collected amount.
- Outstanding balance.
- Stock movements.

Create notifications from meaningful events and link them to the associated records.

Audit events must include actor, membership context, hospital, branch where relevant, action, resource, timestamp, and reason where required.

The local audit log is a simulation, not tamper-proof storage.

Exports must contain the actual filtered records and respect permissions.

## 31. Required state handling

Every implemented workflow needs:

- Empty state.
- Loading state.
- Validation state.
- Pending submission.
- Success outcome.
- Failure.
- Retry.
- Permission denial.
- Missing record.
- Unsaved changes.
- Persistence and restoration.

Handle storage failure without pretending the operation succeeded.

When switching hospital or branch during a draft, offer save, discard, or cancel.

Do not carry a patient context from one hospital into another.

Do not expose bundler errors or technical initialization messages as ordinary product content.

## 32. Development controls

Provide a separate simulation control area for:

- Fictional account selection.
- Simulated inbox.
- Sample data.
- Expired verification codes.
- Failed operations.
- Suspended memberships.
- Expired invitations.
- Expired and revoked access grants.
- Resetting local data.

Role switching in ordinary navigation is allowed only among the signed-in account’s actual memberships or assigned roles.

Do not expose unrestricted role impersonation as a product feature.

## 33. Acceptance scenarios

Verify these journeys:

1. New owner registers, verifies account, completes all nine setup steps, launches, and returns after refresh.
2. Owner invites a nurse; the nurse accepts and receives only the assigned access.
3. Staff signs in, completes MFA, selects the correct institution, and resumes the last permitted page.
4. Receptionist registers a patient, books or checks in a visit, and sends them to triage.
5. Nurse records triage; doctor sees it, signs a consultation, and creates orders.
6. Laboratory collects, processes, verifies, and publishes a result visible to the ordering clinician.
7. Pharmacist partially dispenses, later completes fulfilment, and stock remains correct.
8. Billing officer issues an invoice; cashier records a partial payment and final payment; receipts and balances agree.
9. A patient is admitted, transferred, discharged, and the bed moves through turnover correctly.
10. Doctor requests external history; patient simulation approves and later revokes; access responds immediately.
11. Authorized clinician uses emergency access with justification; viewed categories are audited.
12. Refresh and returning from another app preserve session, route, branch, and drafts.
13. Restricted users cannot bypass permissions by entering a direct URL or triggering an action.
14. Procurement receipt updates inventory correctly without duplicating stock.
15. Reports reconcile with the underlying records.

Also verify at least one complete lifecycle for every additional enabled module.

## 34. Implementation order

Build in this sequence:

1. Shared model, storage, mock services, and routes.
2. Registration, verification, sign-in, MFA, and recovery.
3. Nine-step hospital onboarding.
4. Invitations, memberships, institution selection, and permissions.
5. Patient registration, appointments, visits, and queues.
6. Triage and consultation.
7. Laboratory, radiology, pharmacy, and billing.
8. Inpatient and specialty workflows.
9. Insurance, procurement, administration, and support services.
10. Consent, audit, reporting, recovery states, and full acceptance verification.

Do not finish after implementing dashboards.

The deliverable must be a connected Hospital EHR frontend with maintainable source, persistent fictional records, working user journeys, and an accurate completion report.

Clearly identify any unfinished module and disable its unavailable actions. Never present a placeholder as completed functionality.