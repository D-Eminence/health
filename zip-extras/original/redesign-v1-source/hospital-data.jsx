// hospital-data.jsx — Hospital clinical workflow fixtures
// Governance: D1/D2 (consent door 1 — request→approve, no cold reveal), D3/D4 (break-glass = door 2,
// clinical-only, four-part contract + audit-what-was-viewed; the ONE place the red emergency frame
// is licensed), D5 (Health ID records, the clinician authorizes), D11 (Staff/Clinical vocabulary),
// feeds Pharmacy (prescription→fulfillment) and Lab (order→queue).
//
// ⚠ UNRESOLVED — needs decision: Consultation / Prescription / LabOrder / BreakGlassGrant shapes are
// scaffolded from PROMPT §4 + DECISIONS §3/§8, NOT a frozen contract. Backend to author
// contract/clinical.types.ts + confirm break-glass/index.ts contract before extending.

const HOSP_NODE = { name: 'Living Word Hospital', type: 'HOSPITAL', dept: 'Antenatal Clinic' };
const CLINICIAN = { name: 'Dr. Amaka Eze', reg: 'MDCN 62194', role: 'Consultant' };

// multi-membership staff: the same clinician works across institutions; they pick the active
// node at sign-in. The chosen node scopes everything (D11 Staff/Clinical vocabulary). [§4.3 auth]
const INSTITUTIONS = [
  { id: 'lwh', name: 'Living Word Hospital', type: 'HOSPITAL', dept: 'Antenatal Clinic', role: 'Consultant', city: 'Enugu' },
  { id: 'fmc', name: 'Federal Medical Centre', type: 'HOSPITAL', dept: 'General Outpatient', role: 'Visiting Consultant', city: 'Enugu' },
  { id: 'stj', name: "St. Jude's Clinic", type: 'CLINIC', dept: 'Family Medicine', role: 'Locum', city: 'Nsukka' },
];

// patient record — only visible UNDER an active grant (consent) or break-glass
const PATIENT = {
  name: 'Ngozi Bello', hid: 'HID-71-2204', age: 31, sex: 'F',
  allergies: [
    { name: 'Penicillin', severity: 'severe', note: 'Anaphylaxis (2021)' },
    { name: 'Sulfa drugs', severity: 'moderate', note: 'Rash' },
  ],
  medications: [
    { name: 'Folic acid 5mg', dose: 'Once daily' },
    { name: 'Ferrous sulfate 200mg', dose: 'Twice daily' },
    { name: 'Methyldopa 250mg', dose: 'Twice daily' },
  ],
  vitals: { bp: '148/94', pulse: '88', temp: '36.8', spo2: '98%' },
  recentResults: [
    { name: 'Haemoglobin', value: '10.2 g/dL', flag: 'low', when: '2 days ago' },
    { name: 'Malaria RDT', value: 'Negative', flag: 'normal', when: '2 days ago' },
    { name: 'Urinalysis', value: 'Protein +', flag: 'high', when: '2 days ago' },
  ],
};

// prescribing catalog (allergy interaction surfaced for the clinician — D5: Health ID records, clinician decides)
const DRUGS = [
  { sku: 'AMX', name: 'Amoxicillin 500mg', klass: 'rx', interacts: 'Penicillin' },
  { sku: 'PCM', name: 'Paracetamol 500mg', klass: 'otc' },
  { sku: 'ACT', name: 'Artemether/Lumefantrine', klass: 'rx' },
  { sku: 'FER', name: 'Ferrous sulfate 200mg', klass: 'otc' },
  { sku: 'MET', name: 'Methyldopa 250mg', klass: 'rx' },
  { sku: 'COD', name: 'Codeine 30mg', klass: 'controlled' },
  { sku: 'NIF', name: 'Nifedipine 20mg', klass: 'rx' },
];

const LAB_TESTS = [
  { id: 'FBC', name: 'Full blood count' },
  { id: 'MAL', name: 'Malaria RDT' },
  { id: 'URI', name: 'Urinalysis' },
  { id: 'GLU', name: 'Blood glucose' },
  { id: 'LFT', name: 'Liver function' },
  { id: 'REN', name: 'Renal panel' },
];

const BG_REASONS = ['Patient unconscious', 'Patient incapacitated', 'Life-threatening emergency'];

// the mandatory four-part break-glass contract (D3) — shown verbatim so it can't be skipped
const BG_CONTRACT = [
  { icon: 'bell',   text: 'The patient is notified immediately.' },
  { icon: 'clock',  text: 'Access expires automatically in 60 minutes.' },
  { icon: 'eye',    text: 'Everything you open is recorded — not just that glass was broken.' },
  { icon: 'shield', text: 'An administrator reviews this access afterwards.' },
];

// ---- dashboard (operation center) fixtures ----
// Today's clinic queue. status: waiting | in_consult | done. Records stay consent-gated —
// the queue shows only what the clinic itself scheduled (name + appt reason), never Health ID records. [D2]
const QUEUE = [
  { id: 'q1', name: 'Ngozi Bello', hid: 'HID-71-2204', time: '09:00', reason: 'Antenatal review', status: 'waiting', grant: false, flag: 'BP 148/94' },
  { id: 'q2', name: 'Samuel Okoro', hid: 'HID-44-8810', time: '09:20', reason: 'Follow-up — malaria', status: 'waiting', grant: false },
  { id: 'q3', name: 'Aisha Mohammed', hid: 'HID-90-1175', time: '09:40', reason: 'New complaint — cough', status: 'waiting', grant: false },
  { id: 'q4', name: 'Chidi Eze', hid: 'HID-22-6300', time: '08:30', reason: 'Antenatal review', status: 'done', grant: false },
];

// pending lab results awaiting the clinician's review (links into the consult). [§4.3]
const PENDING_RESULTS = [
  { id: 'r1', patient: 'Samuel Okoro', test: 'Full blood count', urgency: 'routine', when: '15 min ago', flag: false },
  { id: 'r2', patient: 'Ngozi Bello', test: 'Urinalysis', urgency: 'urgent', when: '40 min ago', flag: true },
];

// operational alerts — never carry approvals/break-glass (those are explicit flows). [§1 no-toast-critical]
const ALERTS = [
  { id: 'a1', icon: 'alert', tone: 'danger', text: 'Ngozi Bello — urinalysis shows protein +, flagged for review.' },
  { id: 'a2', icon: 'bell', tone: 'info', text: '2 patients have been waiting over 20 minutes.' },
];

const DASH_STATS = [
  { k: 'queue', label: 'In queue', value: 3, icon: 'user' },
  { k: 'consult', label: 'Seen today', value: 8, icon: 'stethoscope' },
  { k: 'results', label: 'Results to review', value: 2, icon: 'flask' },
  { k: 'followups', label: 'Follow-ups due', value: 5, icon: 'calendar' },
];

// prescription creator option lists (a real catalog is searched server-side; classification is
// auto-detected from the drug, never chosen by the clinician — D5 recording not authorizing).
const DOSE_FREQ = ['Once daily', 'Twice daily', '3× daily', '4× daily', 'At night', 'As needed'];
const DOSE_DUR = ['3 days', '5 days', '7 days', '14 days', '1 month', 'Ongoing'];
const LAB_URGENCY = [
  { id: 'routine', label: 'Routine', tone: 'gray' },
  { id: 'urgent', label: 'Urgent', tone: 'warning' },
  { id: 'stat', label: 'STAT', tone: 'danger' },
];

// patient history — unified clinical timeline, visible ONLY under an active grant; every open is
// audited (§4.3 patient history). Mixed event types feed from prescriptions/labs/visits/vaccines.
const HISTORY = [
  { id: 'h1', kind: 'visit', icon: 'stethoscope', title: 'Antenatal review', node: 'Living Word Hospital', who: 'Dr. Amaka Eze', when: '2 days ago', detail: 'BP elevated 148/94. Continue methyldopa. Review in 1 week.' },
  { id: 'h2', kind: 'lab', icon: 'flask', title: 'Urinalysis — Protein +', node: 'Living Word Lab', who: 'Lab', when: '2 days ago', detail: 'Trace proteinuria. Flagged for clinician review.', flag: 'high' },
  { id: 'h3', kind: 'lab', icon: 'flask', title: 'Haemoglobin — 10.2 g/dL', node: 'Living Word Lab', who: 'Lab', when: '2 days ago', detail: 'Low. Iron-deficiency anaemia.', flag: 'low' },
  { id: 'h4', kind: 'rx', icon: 'pill', title: 'Prescription — 3 items', node: 'Living Word Hospital', who: 'Dr. Amaka Eze', when: '2 weeks ago', detail: 'Folic acid, ferrous sulfate, methyldopa.' },
  { id: 'h5', kind: 'vaccine', icon: 'syringe', title: 'Tetanus toxoid — Dose 2', node: 'Oje Outreach', who: 'CHW Bola O.', when: '6 weeks ago', detail: 'Next dose due in 4 weeks.' },
  { id: 'h6', kind: 'visit', icon: 'stethoscope', title: 'Booking visit', node: 'Living Word Hospital', who: 'Dr. Amaka Eze', when: '3 months ago', detail: 'First antenatal contact. EDD confirmed by scan.' },
];

// activity / audit log — read-only staff action trail (§4.3 activity log; D4 break-glass is reviewable).
// kind: access | break_glass | rx | lab | note | denied
const AUDIT = [
  { id: 'au1', kind: 'break_glass', icon: 'alert', tone: 'danger', action: 'Broke the glass', target: 'Patient HID-22-9981', reason: 'Patient unconscious', who: 'Dr. Amaka Eze', when: 'Today 08:14', dur: 'Expired after 60 min' },
  { id: 'au2', kind: 'access', icon: 'shield', tone: 'success', action: 'Access granted by patient', target: 'Ngozi Bello · HID-71-2204', reason: 'Antenatal review', who: 'Dr. Amaka Eze', when: 'Today 09:02', dur: '60 min grant' },
  { id: 'au3', kind: 'rx', icon: 'pill', tone: 'info', action: 'Prescription created', target: 'Ngozi Bello', reason: '3 items · routed to pharmacy', who: 'Dr. Amaka Eze', when: 'Today 09:08' },
  { id: 'au4', kind: 'lab', icon: 'flask', tone: 'info', action: 'Lab order placed', target: 'Ngozi Bello', reason: 'Urinalysis · urgent', who: 'Dr. Amaka Eze', when: 'Today 09:09' },
  { id: 'au5', kind: 'denied', icon: 'x', tone: 'gray', action: 'Access denied by patient', target: 'Samuel Okoro · HID-44-8810', reason: 'Patient declined', who: 'Dr. Amaka Eze', when: 'Yesterday 16:40' },
];

Object.assign(window, {
  HOSP_NODE, CLINICIAN, INSTITUTIONS, PATIENT, DRUGS, LAB_TESTS, BG_REASONS, BG_CONTRACT,
  QUEUE, PENDING_RESULTS, ALERTS, DASH_STATS, HISTORY, AUDIT, DOSE_FREQ, DOSE_DUR, LAB_URGENCY,
});
