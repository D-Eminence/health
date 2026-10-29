# Role and provider matrix - proposal for approval

**Not implemented.** 16 existing roles x 6 provider categories = 96 proposed combinations. The CSV also has 16 explicit unsupported individual-practitioner rows. Read [ROLE-PROVIDER-MATRIX.csv](ROLE-PROVIDER-MATRIX.csv) for every combination, and [machine-readable matrix](artifacts/proposed-role-provider-matrix.json).

The matrix uses existing default role view permissions, not assumed grants. Actual runtime eligibility must also intersect current extra/denied permissions, facility verification, selected branch departments, module capabilities and record scope. A widget requires its own permitted data projection; navigation visibility alone is not a security check. Configured layouts never override these checks. Matrix widget names are eligibility candidates, not a directive to show every widget simultaneously. Select relevant attention items and a small KPI set; omit unavailable/empty metrics.

## Provider mapping and support

| Requested category | Existing stored/setup values | Proposed daily-work restriction |
|---|---|---|
| Hospital | Community Hospital, Specialist Hospital, Multi-Branch Hospital, Teaching Hospital | Department-enabled hospital workflows; never grant clinical access merely because user is Owner. |
| Clinic | Clinic | Outpatient; exclude inpatient/wards/ICU/ward configuration and dispatch by default. |
| Maternity home | Maternity Centre | Maternity/outpatient work; no ward/bed dashboard metrics per brief. |
| Diagnostic lab | Diagnostic Centre | Lab/radiology pipeline; no wards or ambulance. Standalone Lab product not activated. |
| Pharmacy | Registration stores Pharmacy but maps internal type to Clinic | Requires canonical provider classification; dispensing/stock. No wards/ambulance. Standalone Pharmacy product not activated. |
| Specialist centre | Specialist Clinic | Referrals, visits and enabled specialist procedure workflows; no ward metrics by default. |
| Individual practitioner | No provider model or onboarding flow | Unsupported; ordinary Doctor memberships are not an individual-practitioner business account. |

These are proposed defaults, not a claim that provider gating exists today. Current `can` checks role, branch department and verification, but not provider type; the same role generally gets the same menu across provider types when departments match. Registration and setup use different taxonomies. Preserve `registrationProfile.facilityType` when available, normalize legacy types, and never silently interpret a legacy Clinic as Pharmacy. Ambiguous old records require explicit configuration. Clinic/specialist configurations that genuinely need inpatient work require an explicitly supported capability rather than an inferred permission grant.

## Every current role and its default view surface

| Role | Existing module view permissions | Proposed dashboard emphasis |
|---|---|---|
| Platform Super Admin | No clinical catalogue modules; platform/account administration only | Facility verification queue and review decisions |
| Hospital Owner | Billing & Revenue, Insurance & Claims, Inventory & Procurement, Procurement, Ambulance dispatch, Shifts & Roster, HR & Credentials, Quality & Safety, Service catalogue, Ward configuration, Vehicle configuration, Insurance policies | financial-summary, stock-attention, purchase-worklist, credentials-attention, shift-worklist, claims-pipeline |
| Medical Director | Patients, Appointments, Patient Journey, Triage & Vitals, Consultation, Laboratory, Radiology, Pharmacy, Inpatient / Wards, Wards & Beds, Nursing observations & tasks, Emergency, Maternity, Theatre, ICU, Dental, Referral Network, Telemedicine, HR & Credentials, Quality & Safety, External access, Nursing care tasks | incident-attention, clinical-worklist, referral-worklist, appointments-today, results-awaiting-action |
| Hospital Admin | Billing & Revenue, Insurance & Claims, Inventory & Procurement, Procurement, Ambulance dispatch, Shifts & Roster, HR & Credentials, Quality & Safety, Service catalogue, Ward configuration, Vehicle configuration, Insurance policies | financial-summary, stock-attention, purchase-worklist, credentials-attention, shift-worklist, claims-pipeline |
| Consultant | Patients, Appointments, Patient Journey, Triage & Vitals, Consultation, Laboratory, Radiology, Pharmacy, Inpatient / Wards, Wards & Beds, Nursing observations & tasks, Emergency, Maternity, Theatre, ICU, Dental, Referral Network, Telemedicine, Quality & Safety, External access, Nursing care tasks | appointments-today, clinical-worklist, results-awaiting-action, referral-worklist |
| Doctor | Patients, Appointments, Patient Journey, Triage & Vitals, Consultation, Laboratory, Radiology, Pharmacy, Inpatient / Wards, Wards & Beds, Nursing observations & tasks, Emergency, Maternity, Theatre, ICU, Dental, Referral Network, Telemedicine, Quality & Safety, External access, Nursing care tasks | appointments-today, clinical-worklist, results-awaiting-action, referral-worklist |
| Nurse | Patients, Appointments, Patient Journey, Triage & Vitals, Inpatient / Wards, Wards & Beds, Nursing observations & tasks, Maternity, ICU, Nursing care tasks | nursing-tasks-due, observations-due, visits-today, bed-status, maternity-worklist |
| Receptionist | Patients, Appointments, Patient Journey | appointments-today, visits-today, registrations-today |
| Records Officer | Patients | registrations-today |
| Lab Manager | Laboratory, Inventory & Procurement, Procurement, Blood Bank | results-awaiting-action, stock-attention, purchase-worklist, bloodbank-worklist |
| Lab Scientist | Laboratory, Inventory & Procurement, Blood Bank | results-awaiting-action, stock-attention, bloodbank-worklist |
| Pharmacy Manager | Pharmacy, Inventory & Procurement, Procurement | dispensing-queue, stock-attention, purchase-worklist |
| Pharmacist | Pharmacy, Inventory & Procurement | dispensing-queue, stock-attention |
| Billing Officer | Billing & Revenue, Insurance & Claims, Insurance policies | financial-summary, claims-pipeline |
| Cashier | Billing & Revenue, Insurance & Claims | financial-summary, claims-pipeline |
| Radiology Reporter | Radiology | radiology-worklist |

Owner and Admin also receive setup progress and active-staff counts. Subscription presentation remains restricted to Hospital Owner, Hospital Admin and Billing Officer. Cashier retains authorized patient-payment work but never subscription information. The brief's word "Finance" maps to Billing Officer for subscription purposes; do not rename roles or expand that allowlist.

## Role names in the brief that are not account roles

Procurement/Inventory, HR, and Ambulance/Dispatch are work areas, not existing `Role` values. Owner/Admin and some departmental managers have those permissions. Represent these personas through the existing permission model and task widgets, not new invented role strings. A future dedicated role requires a separate permission decision.

## Data limits and approval dependencies

- Owner/Admin bed occupancy, broad clinical workload, and quality aggregates need narrowly scoped aggregate projections; defaults do not grant them raw clinical modules. Do not show a bed widget by reading records they cannot otherwise access.
- Medication administration schedules, drug-interaction checking, messaging, structured immunisation workload, full leave management, invoice due-date aging and reconciliation are not established capabilities. Do not create convincing placeholder metrics; label unavailable work only where actionable or omit it.
- Appointment/visit/order/stock/claim status counts and period comparisons can use existing timestamped fictional records, subject to correct status and date semantics. A prior period with zero activity must show "No comparison yet", not a fabricated percentage.
- Credential expiry fields exist in some credential records; personal credential approval status alone is not an expiry date. Keep these sources distinct.
- Pinned/reordered shortcuts and Owner/Admin role defaults need scoped preferences and a documented mock/remote contract; no such layout preference model exists today.
- Enabled departments are the current module availability mechanism; there is no separate first-class enabled-module/capability registry. Reuse department gates and add explicit provider capability metadata instead of inventing unrelated permissions.

## Widget definitions

| Widget | Existing module dependency | Data contract intent |
|---|---|---|
| financial-summary | billing | Period invoiced/collected/outstanding; existing money records, no invented trends |
| claims-pipeline | insurance | Claims waiting/status; authorized claims only |
| appointments-today | appointments | Today appointments and check-ins |
| visits-today | journey | Current visit stages |
| results-awaiting-action | lab | Lab pipeline; requester/reviewer scope |
| radiology-worklist | radiology | Reports awaiting authorized actions |
| dispensing-queue | pharmacy | Prescriptions awaiting dispensing |
| stock-attention | inventory | Low stock and expiry from available stock fields |
| purchase-worklist | procurement | Open purchasing work |
| nursing-tasks-due | nursing-tasks | Assigned care tasks with recorded due dates |
| observations-due | nursing | Nursing observations; no invented medication-administration schedule |
| clinical-worklist | consult | Unsigned encounters and requested follow-up |
| bed-status | wards | Bed availability; excluded for non-hospital provider profiles |
| incident-attention | quality | Incidents requiring permitted action |
| credentials-attention | hr | Credential records; only dates actually captured |
| shift-worklist | shifts | Existing roster coverage; full leave requests unsupported |
| dispatch-worklist | ambulance | Active dispatch; only Hospital provider profile by default |
| referral-worklist | referrals | Referrals awaiting authorized action |
| registrations-today | patients | Recent registrations; duplicate review widget deferred to review workflow |
| bloodbank-worklist | bloodbank | Blood bank work within permitted hospital department |
| maternity-worklist | maternity | Recorded maternity procedures; no invented immunisation programme |
| procedure-schedule | surgery | Recorded scheduled procedures |
