# Per-module audit inventory

Audit only, 2026-10-03. Every catalogue module uses `Workflow` list/create/detail templates. For each module below, shared findings M01-M06 apply wherever that surface renders: duplicate inline/Drawer text search; module-group eyebrow with repeated navigation context; generic Create record/ Saved record labels; mechanical pluralisation; multiple status/time fragments; and dashboard module-card duplication. These are source/template findings, not a claim of manually viewing every role x provider x state permutation.

| Route | Current label / record kind | Default roles with view access | Current navigation icon | Specific overlap / proposed disposition |
|---|---|---|---|---|
| `/patients` | Patients / `patient` | Medical Director, Consultant, Doctor, Nurse, Receptionist, Records Officer | user | Registration duplicate warning exists; offline duplicate-review inbox remains unfinished. |
| `/appointments` | Appointments / `appointment` | Medical Director, Consultant, Doctor, Nurse, Receptionist | calendar | Date/appointment work, distinct from visit journey. |
| `/journey` | Patient Journey / `visit` | Medical Director, Consultant, Doctor, Nurse, Receptionist | route | Visit stages, not a second appointments list; choose one term consistently. |
| `/triage` | Triage & Vitals / `triage` | Medical Director, Consultant, Doctor, Nurse | activity | Fix literal question-mark separators in cached triage summary. |
| `/consult` | Consultation / `encounter` | Medical Director, Consultant, Doctor | stethoscope | Unsigned-draft editing and signing are distinct actions; do not flatten them into generic Save. |
| `/lab` | Laboratory / `labOrder` | Medical Director, Consultant, Doctor, Lab Manager, Lab Scientist | flask | Order/sample/results pipeline, not a standalone Lab product. |
| `/radiology` | Radiology / `radiologyOrder` | Medical Director, Consultant, Doctor, Radiology Reporter | scan | Order/report pipeline; specialized reporter permissions remain. |
| `/pharmacy` | Pharmacy / `prescription` | Medical Director, Consultant, Doctor, Pharmacy Manager, Pharmacist | pill | Prescription dispensing plus stock links; no invented interaction alerts. |
| `/inpatient` | Inpatient / Wards / `admission` | Medical Director, Consultant, Doctor, Nurse | bed | Admission lifecycle; overlaps in language with wards/ICU but must not collapse clinical lifecycles silently. |
| `/wards` | Wards & Beds / `bed` | Medical Director, Consultant, Doctor, Nurse | list (generic fallback) | Daily bed state; distinct from ward configuration. Assess relation with Admissions before any further merge. |
| `/nursing` | Nursing observations & tasks / `observation` | Medical Director, Consultant, Doctor, Nurse | list (generic fallback) | Rename to Nursing observations to distinguish from nursing care tasks; no merge yet. |
| `/emergency` | Emergency / `procedure` | Medical Director, Consultant, Doctor | list (generic fallback) | Shares procedure entity with other specialties; retain explicit module discrimination. |
| `/maternity` | Maternity / `procedure` | Medical Director, Consultant, Doctor, Nurse | list (generic fallback) | Shares procedure entity; avoid claiming structured antenatal/immunisation dashboard without data. |
| `/surgery` | Theatre / `procedure` | Medical Director, Consultant, Doctor | list (generic fallback) | Choose Theatre & Procedures consistently; shares procedure entity. |
| `/icu` | ICU / `admission` | Medical Director, Consultant, Doctor, Nurse | list (generic fallback) | Same admission kind, selected by module; remains dedicated capability pending any merger decision. |
| `/dental` | Dental / `procedure` | Medical Director, Consultant, Doctor | list (generic fallback) | Shares procedure entity; keep its department permission gate. |
| `/billing` | Billing & Revenue / `invoice` | Hospital Owner, Hospital Admin, Billing Officer, Cashier | receipt | Differentiate patient billing from Facility subscription. No subscription payload for Cashier. |
| `/insurance` | Insurance & Claims / `claim` | Hospital Owner, Hospital Admin, Billing Officer, Cashier | list (generic fallback) | Requested parent for Claims and Policies tabs. |
| `/inventory` | Inventory & Procurement / `inventory` | Hospital Owner, Hospital Admin, Lab Manager, Lab Scientist, Pharmacy Manager, Pharmacist | box | Requested merge: Supply parent, Stock tab; retain inventory permissions. |
| `/procurement` | Procurement / `purchaseRequest` | Hospital Owner, Hospital Admin, Lab Manager, Pharmacy Manager | list (generic fallback) | Requested merge: Supply parent, Procurement tab; retain purchasing transitions. |
| `/referrals` | Referral Network / `referral` | Medical Director, Consultant, Doctor | list (generic fallback) | Referral workflow; no general cross-provider messaging product. |
| `/ambulance` | Ambulance dispatch / `dispatch` | Hospital Owner, Hospital Admin | list (generic fallback) | Rename Dispatch consistently with ambulance lifecycle; exclude Lab/Pharmacy profiles. |
| `/bloodbank` | Blood Bank / `donation` | Lab Manager, Lab Scientist | list (generic fallback) | Requires Laboratory department; should not automatically appear in every standalone diagnostic lab. |
| `/telemedicine` | Telemedicine / `telemedicine` | Medical Director, Consultant, Doctor | list (generic fallback) | Structured record, not a connected video or messaging service. |
| `/shifts` | Shifts & Roster / `roster` | Hospital Owner, Hospital Admin | list (generic fallback) | Roster planning remains People; not a complete leave-management system. |
| `/hr` | HR & Credentials / `credential` | Hospital Owner, Medical Director, Hospital Admin | list (generic fallback) | Staff credential records overlap with profile credential review; one primary reviewer inbox needs agreed ownership. |
| `/quality` | Quality & Safety / `incident` | Hospital Owner, Medical Director, Hospital Admin, Consultant, Doctor | list (generic fallback) | Generic incident workflow; no fabricated quality score. |
| `/consent` | External access / `consent` | Medical Director, Consultant, Doctor | list (generic fallback) | Label External record access, separate explicit grants from patient registration. |
| `/services` | Service catalogue / `service` | Hospital Owner, Hospital Admin | list (generic fallback) | Move one-time Service catalogue into Settings. |
| `/ward-config` | Ward configuration / `ward` | Hospital Owner, Hospital Admin | list (generic fallback) | Move to Settings; retain ward entity and daily Wards & Beds separately. |
| `/vehicles` | Vehicle configuration / `ambulance` | Hospital Owner, Hospital Admin | list (generic fallback) | Move vehicle configuration into Settings; keep daily Dispatch separate. |
| `/policies` | Insurance policies / `policy` | Hospital Owner, Hospital Admin, Billing Officer | list (generic fallback) | Requested move under Insurance & Claims; preserve policies permission independently. |
| `/nursing-tasks` | Nursing care tasks / `nursingTask` | Medical Director, Consultant, Doctor, Nurse | list (generic fallback) | Separate assigned nursingTask entity; possible future Nursing tabs, approval required. |
