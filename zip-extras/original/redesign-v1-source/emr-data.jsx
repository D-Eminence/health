// emr-data.jsx — Health ID EMR enterprise fixtures + module information architecture
// Governance reconciliation: the hospital's OWN operational data (registration, triage, encounters,
// beds, billing) is first-party — no consent gate. The Health ID CONSENT DOOR (D1/D2) governs pulling the
// patient's CROSS-INSTITUTION history; break-glass (D3/D4) remains the clinical emergency door.
// ⚠ UNRESOLVED — EMR record shapes scaffolded from the enterprise spec; backend authors contract/emr.types.ts.

const BRANCHES = [
  { id: 'main', name: 'Living Word Hospital — Main', city: 'Enugu' },
  { id: 'gra', name: 'Living Word — GRA Annex', city: 'Enugu' },
  { id: 'nsk', name: 'Living Word — Nsukka', city: 'Nsukka' },
];
const STAFF_USER = { name: 'Dr. Amaka Eze', reg: 'MDCN 62194', role: 'Consultant', roleKey: 'consultant', initials: 'AE' };

// ---- Role catalog for the global role switcher (brief: mandatory, no login). ----
// Each role scopes the sidebar (nav: allowed module ids), the landing module (home),
// and the identity shown in the top bar. Order = switcher order.
// Authoritative source: hid-emr-role-hierarchy guide — 7 tiers, 15 roles.
// `tier`/`tierLabel` group the switcher; `focus` = the role's one-line objective;
// `nav` = allowed module ids (sidebar is filtered to these, in this order);
// isolation rules honored (e.g. Owner has NO clinical/patient access).
const ROLES = [
  // L1 — Platform
  { key: 'platform_admin', label: 'Super Admin', who: 'Tijani O.', initials: 'TO', tier: 'L1', tierLabel: 'Platform', focus: 'Platform oversight', home: 'dashboard',
    nav: ['dashboard', 'setup', 'staff', 'quality', 'reports', 'audit'] },
  // L2 — Hospital Executive
  { key: 'owner', label: 'Hospital Owner', who: 'Mrs. Bisi A.', initials: 'BA', tier: 'L2', tierLabel: 'Executive', focus: 'Business performance', home: 'dashboard',
    nav: ['dashboard', 'billing', 'staff', 'reports', 'setup'] },
  { key: 'medical_director', label: 'Medical Director', who: 'Dr. Femi Okafor', initials: 'FO', tier: 'L2', tierLabel: 'Executive', focus: 'Clinical governance', home: 'dashboard',
    nav: ['dashboard', 'journey', 'patients', 'inpatient', 'quality', 'staff', 'reports', 'audit'] },
  { key: 'administrator', label: 'Hospital Admin', who: 'Grace N.', initials: 'GN', tier: 'L2', tierLabel: 'Executive', focus: 'Operations', home: 'dashboard',
    nav: ['dashboard', 'staff', 'setup', 'shifts', 'patients', 'reports', 'inventory', 'hr'] },
  // L3 — Clinical
  { key: 'consultant', label: 'Consultant', who: 'Dr. Amaka Eze', initials: 'AE', tier: 'L3', tierLabel: 'Clinical', focus: 'Patient care oversight', home: 'dashboard',
    nav: ['dashboard', 'patients', 'consult', 'inpatient', 'lab', 'radiology', 'referrals'] },
  { key: 'doctor', label: 'Doctor', who: 'Dr. I. Nwankwo', initials: 'IN', tier: 'L3', tierLabel: 'Clinical', focus: 'Consultation', home: 'dashboard',
    nav: ['dashboard', 'patients', 'triage', 'consult', 'lab', 'radiology', 'pharmacy', 'referrals'] },
  { key: 'nurse', label: 'Nurse', who: 'Nurse Grace Obi', initials: 'GO', tier: 'L3', tierLabel: 'Clinical', focus: 'Patient monitoring', home: 'dashboard',
    nav: ['dashboard', 'triage', 'patients', 'inpatient', 'maternity'] },
  // L4 — Front Desk
  { key: 'receptionist', label: 'Receptionist', who: 'Joy E.', initials: 'JE', tier: 'L4', tierLabel: 'Front Desk', focus: 'Patient flow', home: 'dashboard',
    nav: ['dashboard', 'patients', 'appointments', 'journey'] },
  { key: 'records', label: 'Records Officer', who: 'Paul A.', initials: 'PA', tier: 'L4', tierLabel: 'Front Desk', focus: 'Medical records', home: 'dashboard',
    nav: ['dashboard', 'patients', 'audit', 'reports'] },
  // L5 — Laboratory
  { key: 'lab_manager', label: 'Lab Manager', who: 'Dr. Uche M.', initials: 'UM', tier: 'L5', tierLabel: 'Laboratory', focus: 'Lab operations', home: 'dashboard',
    nav: ['dashboard', 'lab', 'radiology', 'inventory', 'reports'] },
  { key: 'lab', label: 'Lab Scientist', who: 'Bola Adeyemi', initials: 'BA', tier: 'L5', tierLabel: 'Laboratory', focus: 'Sample testing', home: 'dashboard',
    nav: ['dashboard', 'lab', 'radiology'] },
  // L6 — Pharmacy
  { key: 'pharmacy_manager', label: 'Pharmacy Manager', who: 'Mr. Femi A.', initials: 'FA', tier: 'L6', tierLabel: 'Pharmacy', focus: 'Pharmacy operations', home: 'dashboard',
    nav: ['dashboard', 'pharmacy', 'inventory', 'reports'] },
  { key: 'pharmacist', label: 'Pharmacist', who: 'Tunde Bello', initials: 'TB', tier: 'L6', tierLabel: 'Pharmacy', focus: 'Dispensing', home: 'dashboard',
    nav: ['dashboard', 'pharmacy', 'inventory'] },
  // L7 — Finance
  { key: 'billing', label: 'Billing Officer', who: 'Ada U.', initials: 'AU', tier: 'L7', tierLabel: 'Finance', focus: 'Invoicing & claims', home: 'dashboard',
    nav: ['dashboard', 'billing', 'insurance', 'reports'] },
  { key: 'cashier', label: 'Cashier', who: 'Sam K.', initials: 'SK', tier: 'L7', tierLabel: 'Finance', focus: 'Payment collection', home: 'dashboard',
    nav: ['dashboard', 'billing'] },
];

// ---- module information architecture (the left sidebar) ----
const NAV = [
  { section: 'Clinical', items: [
    { id: 'dashboard', label: 'Dashboard', icon: 'home' },
    { id: 'patients', label: 'Patients', icon: 'user' },
    { id: 'appointments', label: 'Appointments', icon: 'calendar' },
    { id: 'triage', label: 'Triage & Vitals', icon: 'activity' },
    { id: 'journey', label: 'Patient Journey', icon: 'route' },
    { id: 'consult', label: 'Consultation', icon: 'stethoscope' },
    { id: 'inpatient', label: 'Inpatient / Wards', icon: 'bed' },
    { id: 'emergency', label: 'Emergency', icon: 'alert' },
    { id: 'maternity', label: 'Maternity', icon: 'heart' },
    { id: 'surgery', label: 'Theatre', icon: 'scissors' },
    { id: 'icu', label: 'ICU', icon: 'activity' },
    { id: 'dental', label: 'Dental', icon: 'plus' },
  ] },
  { section: 'Diagnostics', items: [
    { id: 'lab', label: 'Laboratory', icon: 'flask' },
    { id: 'radiology', label: 'Radiology', icon: 'scan' },
    { id: 'pharmacy', label: 'Pharmacy', icon: 'pill' },
  ] },
  { section: 'Operations', items: [
    { id: 'billing', label: 'Billing & Revenue', icon: 'receipt' },
    { id: 'insurance', label: 'Insurance & Claims', icon: 'shield' },
    { id: 'inventory', label: 'Inventory', icon: 'box' },
    { id: 'reports', label: 'Reports', icon: 'chart' },
    { id: 'audit', label: 'Audit & Compliance', icon: 'history' },
  ] },
  { section: 'Network & Services', items: [
    { id: 'ambulance', label: 'Ambulance', icon: 'truck' },
    { id: 'bloodbank', label: 'Blood Bank', icon: 'droplet' },
    { id: 'telemedicine', label: 'Telemedicine', icon: 'video' },
    { id: 'referrals', label: 'Referral Network', icon: 'share' },
  ] },
  { section: 'Administration', items: [
    { id: 'setup', label: 'Hospital Setup', icon: 'building' },
    { id: 'staff', label: 'Staff & Roles', icon: 'users' },
    { id: 'shifts', label: 'Shifts & Roster', icon: 'clock' },
    { id: 'hr', label: 'HR & Credentials', icon: 'badge' },
    { id: 'quality', label: 'Quality & Safety', icon: 'shield-check' },
  ] },
];

// ============================================================================
//  MODULAR HOSPITAL CONFIGURATION — the platform is a configurable OS, not a
//  fixed app. Departments are enabled per facility; nav, roles & workspaces are
//  generated dynamically from the enabled set. (Architecture update.)
// ============================================================================

// Facility types offered in the setup wizard.
const FACILITY_TYPES = [
  { id: 'clinic', label: 'Clinic', desc: 'Single general-practice clinic', icon: 'home' },
  { id: 'specialist_clinic', label: 'Specialist Clinic', desc: 'Focused single-specialty practice', icon: 'stethoscope' },
  { id: 'diagnostic', label: 'Diagnostic Centre', desc: 'Lab & imaging, no admissions', icon: 'flask' },
  { id: 'maternity', label: 'Maternity Centre', desc: 'Antenatal, delivery & neonatal', icon: 'heart' },
  { id: 'community', label: 'Community Hospital', desc: 'General hospital, single site', icon: 'building' },
  { id: 'specialist_hospital', label: 'Specialist Hospital', desc: 'Tertiary single-specialty', icon: 'activity' },
  { id: 'multi_branch', label: 'Multi-Branch Hospital', desc: 'Group across several sites', icon: 'store' },
  { id: 'teaching', label: 'Teaching Hospital', desc: 'Full-service + training', icon: 'users' },
];

// Department catalog. `core: true` = always on (the operational spine).
// `modules` = nav ids it unlocks · `roles` = role keys it unlocks.
const DEPARTMENTS = [
  { id: 'opd', label: 'General Outpatient', core: true, modules: ['consult', 'appointments'], roles: ['doctor', 'consultant'] },
  { id: 'emergency', label: 'Emergency', modules: ['emergency'], roles: [] },
  { id: 'inpatient', label: 'Inpatient', modules: ['inpatient'], roles: [] },
  { id: 'laboratory', label: 'Laboratory', modules: ['lab'], roles: ['lab_manager', 'lab'] },
  { id: 'pharmacy', label: 'Pharmacy', modules: ['pharmacy'], roles: ['pharmacy_manager', 'pharmacist'] },
  { id: 'maternity', label: 'Maternity', modules: ['maternity'], roles: [] },
  { id: 'pediatrics', label: 'Pediatrics', modules: [], roles: [] },
  { id: 'radiology', label: 'Radiology', modules: ['radiology'], roles: [] },
  { id: 'dental', label: 'Dental', modules: ['dental'], roles: [] },
  { id: 'physiotherapy', label: 'Physiotherapy', modules: [], roles: [] },
  { id: 'dialysis', label: 'Dialysis', modules: [], roles: [] },
  { id: 'oncology', label: 'Oncology', modules: [], roles: [] },
  { id: 'cardiology', label: 'Cardiology', modules: [], roles: [] },
  { id: 'icu', label: 'ICU', modules: ['icu'], roles: [] },
  { id: 'theatre', label: 'Theatre', modules: ['surgery'], roles: [] },
  { id: 'mental_health', label: 'Mental Health', modules: [], roles: [] },
  { id: 'eye', label: 'Eye Clinic', modules: [], roles: [] },
  { id: 'ent', label: 'ENT', modules: [], roles: [] },
  { id: 'immunization', label: 'Immunization', modules: [], roles: [] },
  { id: 'hiv', label: 'HIV Program', modules: [], roles: [] },
  { id: 'tb', label: 'Tuberculosis Program', modules: [], roles: [] },
];

// modules that are ALWAYS present regardless of departments (operational spine + admin/finance)
const CORE_MODULES = ['dashboard', 'patients', 'appointments', 'triage', 'journey', 'consult',
  'billing', 'insurance', 'inventory', 'reports', 'audit', 'referrals',
  'setup', 'staff', 'shifts', 'hr', 'quality'];
// roles always available (front desk, finance, admin, exec, platform, nursing)
const CORE_ROLES = ['platform_admin', 'owner', 'medical_director', 'administrator', 'nurse',
  'receptionist', 'records', 'billing', 'cashier'];

// Recommended department presets per facility type (what the wizard pre-checks).
const TYPE_PRESETS = {
  clinic: ['opd', 'pharmacy'],
  specialist_clinic: ['opd'],
  diagnostic: ['laboratory', 'radiology'],
  maternity: ['opd', 'maternity', 'laboratory', 'pharmacy', 'inpatient'],
  community: ['opd', 'emergency', 'inpatient', 'laboratory', 'pharmacy', 'maternity', 'pediatrics'],
  specialist_hospital: ['opd', 'emergency', 'inpatient', 'laboratory', 'pharmacy', 'radiology', 'icu', 'theatre'],
  multi_branch: ['opd', 'emergency', 'inpatient', 'laboratory', 'pharmacy', 'maternity', 'pediatrics', 'radiology', 'theatre'],
  teaching: DEPARTMENTS.map((d) => d.id),
};

// The live hospital configuration (what the wizard produces; defaults to a full community hospital
// so the demo shows everything until reconfigured).
const HOSPITAL_CONFIG = {
  name: 'Living Word Hospital',
  type: 'community',
  multiBranch: true,
  departments: ['opd', 'emergency', 'inpatient', 'laboratory', 'pharmacy', 'maternity', 'pediatrics', 'radiology', 'theatre'],
};

// Derive the set of enabled module ids from a list of enabled department ids.
function enabledModules(deptIds) {
  const set = new Set(CORE_MODULES);
  DEPARTMENTS.forEach((d) => { if (deptIds.includes(d.id)) d.modules.forEach((m) => set.add(m)); });
  return set;
}
// Derive enabled role keys from enabled departments.
function enabledRoleKeys(deptIds) {
  const set = new Set(CORE_ROLES);
  DEPARTMENTS.forEach((d) => { if (deptIds.includes(d.id)) d.roles.forEach((r) => set.add(r)); });
  return set;
}

// ---- enterprise dashboard widgets ----
// FlowBooks-style KPI: big value + inline delta badge + icon chip + contextual footer strip.
const KPIS = [
  { k: 'patients', label: 'Patients today', value: '248', delta: '+12%', tone: 'up', icon: 'user', foot: 'Up from', footValue: '221 yesterday', footTone: 'up' },
  { k: 'revenue', label: 'Revenue recorded', value: '₦4.82M', delta: '+6%', tone: 'up', icon: 'receipt', foot: 'Outstanding', footValue: '₦1.27M', footTone: 'warn' },
  { k: 'beds', label: 'Bed occupancy', value: '82%', delta: '74 / 90', tone: 'flat', icon: 'bed', foot: 'Free now', footValue: '16 beds', footTone: 'plain' },
  { k: 'lab', label: 'Lab turnaround', value: '38 min', delta: '−9%', tone: 'down-good', icon: 'flask', foot: 'Target', footValue: '≤ 45 min', footTone: 'up' },
];
const DASH_QUEUES = [
  { label: 'Waiting for triage', n: 14, icon: 'activity', to: 'triage' },
  { label: 'Ready for doctor', n: 9, icon: 'stethoscope', to: 'consult' },
  { label: 'Lab results to verify', n: 6, icon: 'flask', to: 'lab' },
  { label: 'Prescriptions to dispense', n: 11, icon: 'pill', to: 'pharmacy' },
  { label: 'Invoices unpaid', n: 7, icon: 'receipt', to: 'billing' },
  { label: 'Discharges pending', n: 3, icon: 'bed', to: 'inpatient' },
];
const DEPT_LOAD = [
  { dept: 'General OPD', load: 86 }, { dept: 'Antenatal', load: 64 }, { dept: 'Paediatrics', load: 48 },
  { dept: 'Emergency', load: 72 }, { dept: 'Laboratory', load: 58 },
];
const DASH_NOTICES = [
  { tone: 'danger', icon: 'alert', text: 'ICU bed capacity at 90% — 1 bed free.' },
  { tone: 'warning', icon: 'pill', text: '3 drugs below reorder level in Pharmacy.' },
  { tone: 'info', icon: 'flask', text: '2 urgent lab results awaiting clinician review.' },
];

// ---- patients ----
const PATIENTS = [
  { id: 'p1', hid: 'HID-71-2204', name: 'Ngozi Bello', age: 31, sex: 'F', phone: '0803••• 4471', blood: 'O+', genotype: 'AA', status: 'Outpatient', flag: 'ANC 34w', insurer: 'NHIS' },
  { id: 'p2', hid: 'HID-44-8810', name: 'Samuel Okoro', age: 45, sex: 'M', phone: '0816••• 9920', blood: 'B+', genotype: 'AS', status: 'Outpatient', insurer: 'Self-pay' },
  { id: 'p3', hid: 'HID-90-1175', name: 'Aisha Mohammed', age: 27, sex: 'F', phone: '0701••• 3310', blood: 'A+', genotype: 'AA', status: 'Admitted', flag: 'Ward 3 · Bed 12', insurer: 'Hygeia HMO' },
  { id: 'p4', hid: 'HID-22-6300', name: 'Chidi Eze', age: 52, sex: 'M', phone: '0809••• 1180', blood: 'AB+', genotype: 'AA', status: 'Outpatient', insurer: 'NHIS' },
  { id: 'p5', hid: 'HID-58-7741', name: 'Fatima Yusuf', age: 8, sex: 'F', phone: '0802••• 7755', blood: 'O−', genotype: 'SS', status: 'Admitted', flag: 'Paeds · Bed 4', insurer: 'Self-pay' },
];

// ---- triage queue + vitals ranges (abnormality alerts) ----
const TRIAGE_QUEUE = [
  { id: 't1', name: 'Ngozi Bello', hid: 'HID-71-2204', arrived: '08:52', priority: 'urgent', complaint: 'Headache, swelling' },
  { id: 't2', name: 'Samuel Okoro', hid: 'HID-44-8810', arrived: '09:05', priority: 'routine', complaint: 'Fever, body aches' },
  { id: 't3', name: 'Aisha Mohammed', hid: 'HID-90-1175', arrived: '09:11', priority: 'routine', complaint: 'Persistent cough' },
];
// [low, high] normal ranges → out-of-range triggers an alert
const VITAL_FIELDS = [
  { k: 'sbp', label: 'Systolic BP', unit: 'mmHg', lo: 90, hi: 139, ph: '120' },
  { k: 'dbp', label: 'Diastolic BP', unit: 'mmHg', lo: 60, hi: 89, ph: '80' },
  { k: 'pulse', label: 'Pulse', unit: 'bpm', lo: 60, hi: 100, ph: '76' },
  { k: 'temp', label: 'Temp', unit: '°C', lo: 36, hi: 37.5, ph: '36.8' },
  { k: 'resp', label: 'Resp. rate', unit: '/min', lo: 12, hi: 20, ph: '16' },
  { k: 'spo2', label: 'SpO₂', unit: '%', lo: 95, hi: 100, ph: '98' },
  { k: 'weight', label: 'Weight', unit: 'kg', lo: 0, hi: 999, ph: '64' },
  { k: 'height', label: 'Height', unit: 'cm', lo: 0, hi: 999, ph: '165' },
];

// ---- inpatient: wards + beds ----
const WARDS = [
  { id: 'w1', name: 'General Ward', beds: [
    { n: 1, s: 'occupied', who: 'M. Udo' }, { n: 2, s: 'occupied', who: 'P. Obi' }, { n: 3, s: 'free' },
    { n: 4, s: 'occupied', who: 'J. Ade' }, { n: 5, s: 'cleaning' }, { n: 6, s: 'free' },
  ] },
  { id: 'w2', name: 'Maternity', beds: [
    { n: 1, s: 'occupied', who: 'B. Nwosu' }, { n: 2, s: 'occupied', who: 'K. Bello' }, { n: 3, s: 'free' }, { n: 4, s: 'free' },
  ] },
  { id: 'w3', name: 'Paediatrics', beds: [
    { n: 1, s: 'occupied', who: 'F. Yusuf' }, { n: 2, s: 'free' }, { n: 3, s: 'occupied', who: 'T. Eze' }, { n: 4, s: 'occupied', who: 'S. Ali' },
  ] },
  { id: 'icu', name: 'ICU', beds: [
    { n: 1, s: 'occupied', who: 'R. Okeke' }, { n: 2, s: 'occupied', who: 'L. Musa' }, { n: 3, s: 'free' },
  ] },
];

// ---- appointments (day schedule) ----
const APPTS = [
  { id: 'a1', time: '09:00', patient: 'Ngozi Bello', doctor: 'Dr. Eze', type: 'Antenatal', status: 'checked-in' },
  { id: 'a2', time: '09:30', patient: 'Samuel Okoro', doctor: 'Dr. Eze', type: 'Follow-up', status: 'booked' },
  { id: 'a3', time: '10:00', patient: 'Chidi Eze', doctor: 'Dr. Nwankwo', type: 'Consultation', status: 'booked' },
  { id: 'a4', time: '10:30', patient: 'Aisha Mohammed', doctor: 'Dr. Eze', type: 'Review', status: 'booked' },
  { id: 'a5', time: '11:15', patient: 'Fatima Yusuf', doctor: 'Dr. Nwankwo', type: 'Paediatric', status: 'booked' },
];

// ---- billing ----
const INVOICES = [
  { id: 'INV-20481', patient: 'Ngozi Bello', items: 4, amount: 28500, status: 'unpaid', method: '—', when: 'Today' },
  { id: 'INV-20480', patient: 'Samuel Okoro', items: 2, amount: 9000, status: 'paid', method: 'Cash', when: 'Today' },
  { id: 'INV-20479', patient: 'Chidi Eze', items: 6, amount: 54200, status: 'part', method: 'Transfer', when: 'Today' },
  { id: 'INV-20478', patient: 'Aisha Mohammed', items: 3, amount: 16750, status: 'insurance', method: 'Hygeia HMO', when: 'Yesterday' },
];
const REVENUE_SPLIT = [
  { label: 'Consultation', value: 34 }, { label: 'Laboratory', value: 26 }, { label: 'Pharmacy', value: 22 }, { label: 'Procedures', value: 12 }, { label: 'Admission', value: 6 },
];

// ---- lab + pharmacy queues ----
const LAB_QUEUE = [
  { id: 'L-2204', patient: 'Ngozi Bello', test: 'Urinalysis', urgency: 'urgent', stage: 'processing' },
  { id: 'L-2203', patient: 'Samuel Okoro', test: 'Full blood count', urgency: 'routine', stage: 'collected' },
  { id: 'L-2202', patient: 'Chidi Eze', test: 'Liver function', urgency: 'routine', stage: 'verify' },
  { id: 'L-2201', patient: 'A. Mohammed', test: 'Malaria RDT', urgency: 'routine', stage: 'completed' },
];
const PHARM_QUEUE = [
  { id: 'RX-7781', patient: 'Ngozi Bello', items: 3, controlled: false, status: 'new' },
  { id: 'RX-7780', patient: 'Chidi Eze', items: 2, controlled: true, status: 'new' },
  { id: 'RX-7779', patient: 'Samuel Okoro', items: 1, controlled: false, status: 'dispensed' },
];
const INVENTORY_ALERTS = [
  { drug: 'Amoxicillin 500mg', stock: 40, reorder: 100, expiry: '08/2026' },
  { drug: 'Artemether/Lumefantrine', stock: 18, reorder: 60, expiry: '03/2026' },
  { drug: 'Oxytocin inj.', stock: 9, reorder: 30, expiry: '11/2025' },
];

// ---- reports + radiology + surgery + maternity + emergency ----
const REPORTS = [
  { id: 'r1', name: 'Daily patients seen', icon: 'user', desc: 'Attendance by department & hour' },
  { id: 'r2', name: 'Revenue report', icon: 'receipt', desc: 'Recorded payments by service & method' },
  { id: 'r3', name: 'Drug consumption', icon: 'pill', desc: 'Dispensing volume & stock movement' },
  { id: 'r4', name: 'Top diagnoses', icon: 'activity', desc: 'ICD-coded diagnosis frequency' },
  { id: 'r5', name: 'Lab performance', icon: 'flask', desc: 'Turnaround time & volume' },
  { id: 'r6', name: 'Staff performance', icon: 'users', desc: 'Encounters & workload per staff' },
];
const RAD_REQUESTS = [
  { id: 'IMG-441', patient: 'Chidi Eze', study: 'Chest X-ray', urgency: 'routine', status: 'requested' },
  { id: 'IMG-440', patient: 'Aisha Mohammed', study: 'Abdominal USS', urgency: 'urgent', status: 'acquired' },
  { id: 'IMG-439', patient: 'R. Okeke', study: 'CT Head', urgency: 'stat', status: 'reporting' },
];
const SURGERIES = [
  { id: 's1', time: '08:00', theatre: 'Theatre 1', proc: 'Caesarean section', surgeon: 'Dr. Okafor', status: 'in-theatre' },
  { id: 's2', time: '11:00', theatre: 'Theatre 2', proc: 'Appendectomy', surgeon: 'Dr. Bello', status: 'scheduled' },
  { id: 's3', time: '14:00', theatre: 'Theatre 1', proc: 'Hernia repair', surgeon: 'Dr. Okafor', status: 'scheduled' },
];
const ANC = [
  { id: 'm1', name: 'Ngozi Bello', ga: '34 weeks', edd: '12 Jul', visit: 'Visit 6', risk: 'high', next: 'Today' },
  { id: 'm2', name: 'Blessing Nwosu', ga: '28 weeks', edd: '20 Aug', visit: 'Visit 4', risk: 'normal', next: '2 weeks' },
  { id: 'm3', name: 'Kemi Bello', ga: '38 weeks', edd: '04 Jun', visit: 'Visit 8', risk: 'normal', next: '1 week' },
];
const EMERGENCY_CASES = [
  { id: 'e1', name: 'Unknown male', triage: 'P1 — Resus', complaint: 'RTA, head injury', arrived: '2 min ago', glass: true },
  { id: 'e2', name: 'R. Okeke', triage: 'P1 — Resus', complaint: 'Chest pain, ↓BP', arrived: '14 min ago', glass: false },
  { id: 'e3', name: 'L. Musa', triage: 'P2 — Urgent', complaint: 'Severe asthma', arrived: '22 min ago', glass: false },
];

// ---- global notifications + tasks ----
const NOTIFS = [
  { icon: 'flask', text: 'Urgent: Ngozi Bello urinalysis ready', when: '3 min', tone: 'danger' },
  { icon: 'bed', text: 'Bed 5 (General) ready after cleaning', when: '20 min', tone: 'info' },
  { icon: 'receipt', text: 'INV-20479 part-paid by transfer', when: '32 min', tone: 'info' },
  { icon: 'pill', text: 'Oxytocin stock below reorder level', when: '1 hr', tone: 'warning' },
];

// ---- Patient Journey Engine (Level 6) — live workflow state per patient ----
const JOURNEY_STAGES = [
  { id: 'registration', label: 'Registration', icon: 'user-plus' },
  { id: 'triage', label: 'Triage', icon: 'activity' },
  { id: 'waiting', label: 'Waiting', icon: 'clock' },
  { id: 'consult', label: 'Consultation', icon: 'stethoscope' },
  { id: 'lab', label: 'Lab', icon: 'flask' },
  { id: 'pharmacy', label: 'Pharmacy', icon: 'pill' },
  { id: 'billing', label: 'Billing', icon: 'receipt' },
  { id: 'discharge', label: 'Discharge', icon: 'check' },
];
// stageIndex = where the patient currently is; waitMins = time in current stage
const JOURNEY_PATIENTS = [
  { id: 'j1', name: 'Ngozi Bello', hid: 'HID-71-2204', stage: 4, waitMins: 12, dept: 'Antenatal', flag: 'urgent' },
  { id: 'j2', name: 'Samuel Okoro', hid: 'HID-44-8810', stage: 3, waitMins: 6, dept: 'General OPD' },
  { id: 'j3', name: 'Aisha Mohammed', hid: 'HID-90-1175', stage: 2, waitMins: 24, dept: 'General OPD', flag: 'long-wait' },
  { id: 'j4', name: 'Chidi Eze', hid: 'HID-22-6300', stage: 6, waitMins: 4, dept: 'General OPD' },
  { id: 'j5', name: 'Fatima Yusuf', hid: 'HID-58-7741', stage: 5, waitMins: 9, dept: 'Paediatrics' },
  { id: 'j6', name: 'Blessing Nwosu', hid: 'HID-33-5521', stage: 1, waitMins: 3, dept: 'Antenatal' },
];

// ---- Shift Management (Level 5) ----
const SHIFTS = [
  { id: 'morning', label: 'Morning', time: '07:00–14:00', onDuty: 42, required: 45, tone: 'warning' },
  { id: 'afternoon', label: 'Afternoon', time: '14:00–21:00', onDuty: 38, required: 38, tone: 'success' },
  { id: 'night', label: 'Night', time: '21:00–07:00', onDuty: 19, required: 24, tone: 'danger' },
  { id: 'oncall', label: 'On-call', time: '24h', onDuty: 8, required: 8, tone: 'success' },
];
const ROSTER = [
  { name: 'Dr. Amaka Eze', role: 'Consultant', shift: 'Morning', dept: 'Antenatal', status: 'clocked-in', at: '06:52' },
  { name: 'Dr. Ibrahim Nwankwo', role: 'Medical Officer', shift: 'Morning', dept: 'General OPD', status: 'clocked-in', at: '07:01' },
  { name: 'Nurse Grace Obi', role: 'Nurse', shift: 'Morning', dept: 'General Ward', status: 'clocked-in', at: '06:45' },
  { name: 'Dr. Femi Okafor', role: 'Surgeon', shift: 'On-call', dept: 'Theatre', status: 'on-call', at: '—' },
  { name: 'Nurse Sani Bello', role: 'Nurse', shift: 'Night', dept: 'ICU', status: 'overtime', at: '21:00' },
];

// ---- HR & Credentials (Level 21) — license expiry tracking ----
const HR_STAFF = [
  { name: 'Dr. Amaka Eze', role: 'Consultant', license: 'MDCN 62194', expires: '2027-03', status: 'valid', leave: '12 days' },
  { name: 'Dr. Ibrahim Nwankwo', role: 'Medical Officer', license: 'MDCN 71820', expires: '2026-07', status: 'valid', leave: '8 days' },
  { name: 'Bola Adeyemi', role: 'Lab Scientist', license: 'MLSCN 4471', expires: '2026-06', status: 'expiring', leave: '15 days' },
  { name: 'Tunde Bello', role: 'Pharmacist', license: 'PCN 9920', expires: '2025-12', status: 'expired', leave: '3 days' },
  { name: 'Nurse Grace Obi', role: 'Nurse', license: 'NMCN 33210', expires: '2027-01', status: 'valid', leave: '20 days' },
];

// ---- Quality & Safety (Level 23) ----
const QUALITY_KPIS = [
  { label: 'Patient satisfaction', value: '4.4 / 5', tone: 'up', delta: '+0.2' },
  { label: 'Readmission rate', value: '4.8%', tone: 'down-good', delta: '−0.6%' },
  { label: 'Infection rate', value: '1.2%', tone: 'flat', delta: '0%' },
  { label: 'Mortality rate', value: '0.9%', tone: 'down-good', delta: '−0.1%' },
];
const INCIDENTS = [
  { id: 'IR-204', type: 'Medication near-miss', dept: 'Pharmacy', severity: 'moderate', status: 'investigating', when: 'Today' },
  { id: 'IR-203', type: 'Patient fall', dept: 'General Ward', severity: 'low', status: 'closed', when: 'Yesterday' },
  { id: 'IR-202', type: 'Equipment failure', dept: 'ICU', severity: 'high', status: 'open', when: '2 days ago' },
];

// ---- Insurance & Claims (Level 15) ----
const INSURANCE_KPIS = [['Claims this month', '142'], ['Pending pre-auth', '18'], ['Approved value', '₦8.4M'], ['Rejected', '6']];
const CLAIMS = [
  { id: 'CLM-5521', patient: 'Aisha Mohammed', insurer: 'Hygeia HMO', amount: 16750, status: 'submitted', service: 'Admission' },
  { id: 'CLM-5520', patient: 'Ngozi Bello', insurer: 'NHIS', amount: 8500, status: 'pre-auth', service: 'Antenatal' },
  { id: 'CLM-5519', patient: 'Chidi Eze', insurer: 'NHIS', amount: 54200, status: 'approved', service: 'Procedure' },
  { id: 'CLM-5518', patient: 'M. Udo', insurer: 'AIICO', amount: 12000, status: 'rejected', service: 'Laboratory' },
];

// ---- Inventory & Procurement (Level 20) ----
const STOCK_ITEMS = [
  { item: 'Surgical gloves (box)', cat: 'Consumable', stock: 120, reorder: 200, tone: 'warning' },
  { item: 'IV cannula 18G', cat: 'Consumable', stock: 540, reorder: 300, tone: 'success' },
  { item: 'CBC reagent kit', cat: 'Reagent', stock: 14, reorder: 40, tone: 'danger' },
  { item: 'Oxygen cylinder', cat: 'Equipment', stock: 22, reorder: 15, tone: 'success' },
  { item: 'Sutures 3-0', cat: 'Consumable', stock: 85, reorder: 100, tone: 'warning' },
];
const PROCUREMENT = [
  { id: 'PO-881', vendor: 'MedSupply Ltd', items: 6, value: 420000, status: 'pending' },
  { id: 'PO-880', vendor: 'PharmaPlus', items: 3, value: 185000, status: 'approved' },
  { id: 'PO-879', vendor: 'LabReagents Co', items: 4, value: 96000, status: 'delivered' },
];

// ---- Blind-spot modules ----
const AMBULANCES = [
  { id: 'AMB-1', plate: 'ENU-441-AA', crew: 'Paramedic team A', status: 'on-call', eta: '—' },
  { id: 'AMB-2', plate: 'ENU-442-AB', crew: 'Paramedic team B', status: 'dispatched', eta: '8 min · RTA, Ogui Rd' },
  { id: 'AMB-3', plate: 'ENU-443-AC', crew: 'Transfer crew', status: 'maintenance', eta: '—' },
];
const BLOOD_STOCK = [
  { group: 'O+', units: 24, tone: 'success' }, { group: 'O−', units: 4, tone: 'danger' },
  { group: 'A+', units: 16, tone: 'success' }, { group: 'A−', units: 6, tone: 'warning' },
  { group: 'B+', units: 11, tone: 'success' }, { group: 'B−', units: 3, tone: 'danger' },
  { group: 'AB+', units: 8, tone: 'success' }, { group: 'AB−', units: 5, tone: 'warning' },
];
const TELE_SESSIONS = [
  { id: 'TM-12', patient: 'Ada Eze (remote)', doctor: 'Dr. Eze', time: '10:30', status: 'waiting' },
  { id: 'TM-11', patient: 'John Bull (remote)', doctor: 'Dr. Nwankwo', time: '11:00', status: 'scheduled' },
  { id: 'TM-10', patient: 'Mary Okon (remote)', doctor: 'Dr. Eze', time: '09:30', status: 'completed' },
];
const REFERRALS_OUT = [
  { id: 'RF-330', patient: 'Chidi Eze', to: 'UNTH Cardiology', reason: 'Specialist cardiology review', urgency: 'urgent', status: 'sent' },
  { id: 'RF-329', patient: 'Fatima Yusuf', to: 'National Eye Centre', reason: 'Paediatric ophthalmology', urgency: 'routine', status: 'accepted' },
  { id: 'RF-328', patient: 'M. Udo', to: 'Health ID Lab Network', reason: 'Histopathology', urgency: 'routine', status: 'completed' },
];

Object.assign(window, {
  BRANCHES, STAFF_USER, ROLES, NAV, KPIS, DASH_QUEUES, DEPT_LOAD, DASH_NOTICES,
  PATIENTS, TRIAGE_QUEUE, VITAL_FIELDS, WARDS, APPTS, INVOICES, REVENUE_SPLIT,
  LAB_QUEUE, PHARM_QUEUE, INVENTORY_ALERTS, REPORTS, RAD_REQUESTS, SURGERIES, ANC, EMERGENCY_CASES, NOTIFS,
  JOURNEY_STAGES, JOURNEY_PATIENTS, SHIFTS, ROSTER, HR_STAFF, QUALITY_KPIS, INCIDENTS,
  CLAIMS, INSURANCE_KPIS, PROCUREMENT, STOCK_ITEMS, AMBULANCES, BLOOD_STOCK, TELE_SESSIONS, REFERRALS_OUT,
  FACILITY_TYPES, DEPARTMENTS, CORE_MODULES, CORE_ROLES, TYPE_PRESETS, HOSPITAL_CONFIG, enabledModules, enabledRoleKeys,
});