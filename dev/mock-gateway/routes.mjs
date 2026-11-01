/**
 * The mock gateway's answers, shared by the Node server (server.mjs) and the
 * in-page preview shim (browser-shim.mjs). Sample data only. UI work only.
 */
export const CSRF = 'mock-csrf'
const options = { facility: 'blue', signup: false, enrol: 'open' }
/**
 * `facility`: 'blue' (Demo Hospital, blue EHR) or 'classic'. `signup`: the patient sign-up without a NIN is served.
 * `enrol`: 'open', 'closed' or 'unavailable', for patient and facility sign-up availability.
 */
export function configure(next) { Object.assign(options, next) }

const now = () => new Date()
const iso = (offsetMs = 0) => new Date(now().getTime() + offsetMs).toISOString()
const DAY = 86_400_000
const MIN = 60_000

// ---------------------------------------------------------------- patient --
const patientSession = () => ({
  actor: { kind: 'patient', subject: 'subject-demo', patientId: 'patient-demo', accountId: 'account-demo', authenticationMethod: 'local' },
  expiresAt: iso(30 * DAY),
})

const patient = {
  me: {
    patientId: 'patient-demo', hid: 'HID-ADA2345', firstName: 'Adaeze', lastName: 'Okafor', fullName: 'Adaeze Okafor',
    dateOfBirth: '1991-03-04', gender: 'female', country: 'NG', state: 'Lagos', assuranceState: 'NIN_VERIFIED',
    accessPinConfigured: false, version: 1, ninVerified: true, email: 'adaeze@example.test', emailVerified: true,
    phone: '+2348031234567', phoneVerified: true, hasPhoto: false,
  },
  profileDetails: { hospitalCurrentlyUsing: 'Lagos University Teaching Hospital', hmoName: 'Hygeia HMO', rowVersion: 1 },
  healthProfile: {
    bloodGroup: 'O+', genotype: 'AA', allergies: 'Penicillin, sulfa drugs and peanuts', currentMedications: null, chronicConditions: null,
    medicalNotes: null, rowVersion: 1, updatedAt: '2026-10-20T07:00:00.000Z',
  },
  records: {
    encounters: [
      { id: 'enc-1', facilityId: 'f-1', encounterType: 'outpatient_visit', status: 'completed', startedAt: '2026-10-20T09:00:00Z', endedAt: '2026-10-20T10:00:00Z' },
      { id: 'enc-2', facilityId: 'f-2', encounterType: 'outpatient_visit', status: 'completed', startedAt: '2026-08-02T14:00:00Z', endedAt: '2026-08-02T14:40:00Z' },
    ],
    notes: [{ id: 'note-1', encounterId: 'enc-1', facilityId: 'f-1', noteType: 'consultation', title: 'Malaria review', status: 'signed', revisionNo: 1, content: 'Fever resolving. Continue ACT, review in one week.', signedAt: '2026-10-20T10:05:00Z' }],
    vitals: [{ id: 'v-1', encounterId: 'enc-1', facilityId: 'f-1', recordedAt: '2026-10-20T09:10:00Z', heightCm: 168, weightKg: 64, temperatureC: 37.8, pulseBpm: 88, respiratoryRate: 18, systolicMmhg: 118, diastolicMmhg: 76, oxygenSaturationPercent: 98, source: 'manual' }],
    diagnoses: [{ id: 'd-1', encounterId: 'enc-1', facilityId: 'f-1', codeSystem: 'ICD-10', code: 'B54', display: 'Malaria, unspecified', clinicalStatus: 'active', verificationStatus: 'confirmed', onsetAt: '2026-10-19T00:00:00Z', abatementAt: null, notes: null }],
    prescriptions: [{ id: 'p-1', encounterId: 'enc-1', facilityId: 'f-1', medicationCodeSystem: null, medicationCode: null, medicationDisplay: 'Artemether/Lumefantrine 80/480 mg', doseQuantity: 1, doseUnit: 'tablet', routeCode: 'oral', frequency: 'twice daily', instructions: 'Take with food for 3 days', startsOn: '2026-10-20', endsOn: '2026-10-23', status: 'active' }],
    labRequests: [{ id: 'l-1', encounterId: 'enc-1', facilityId: 'f-1', testCodeSystem: 'LOINC', testCode: '32700-7', testDisplay: 'Malaria smear', priority: 'routine', status: 'completed', specimenTypeCode: 'blood', clinicalInformation: null, externalOrderReference: null, createdAt: '2026-10-20T09:20:00Z' }],
    documents: [{ id: 'doc-1', encounterId: 'enc-1', facilityId: 'f-1', fileName: 'malaria-smear-result.pdf', mediaType: 'application/pdf', sizeBytes: 20480, classification: 'lab_report', status: 'available', createdAt: '2026-10-20T11:00:00Z' }],
    limit: 50,
  },
  accessHistory: () => ({ items: [
    ...shared.map(share => ({ consentGrantId: share.consentGrantId, scope: share.scope, purpose: 'patient-share', status: 'active', startsAt: share.startsAt, expiresAt: share.expiresAt, reason: null, facilityName: share.facilityName, clinicianName: share.clinicianName, patientRevocable: true, shareLevel: share.level, shareDuration: share.duration })),
    { consentGrantId: 'g-1', scope: 'read', purpose: 'direct-care', status: ended.has('g-1') ? 'revoked' : 'active', startsAt: iso(-2 * DAY), expiresAt: iso(28 * DAY), reason: null, facilityName: 'Lagos General Hospital', patientRevocable: true, shareLevel: 'clinical_review', shareDuration: '30d' },
    { consentGrantId: 'g-2', scope: 'read', purpose: 'direct-care', status: 'expired', startsAt: iso(-90 * DAY), expiresAt: iso(-60 * DAY), reason: null, facilityName: 'Reddington Clinic', patientRevocable: false },
  ] }),
  accessRequests: () => [
    { accessRequestId: 'r-1', facilityId: 'f-3', facilityName: 'Ikeja Medical Centre', scope: 'read', reason: 'Follow-up consultation', status: decided.get('r-1') ?? 'pending', requestedDurationMinutes: 60, requestedAt: iso(-30 * MIN), approvedAt: null, deniedAt: null, deniedReason: null },
  ],
  notifications: () => [
    { id: 'n-1', notificationCode: 'ACCESS_REQUEST_RECEIVED', resourceType: 'access-request', resourceId: 'r-1', metadata: {}, readAt: null, createdAt: iso(-30 * MIN) },
    { id: 'n-2', notificationCode: 'RECORDS_OPENED', resourceType: 'record-access', resourceId: null, metadata: { facilityName: 'Lagos General Hospital' }, readAt: null, createdAt: iso(-1 * DAY) },
    { id: 'n-3', notificationCode: 'SECURITY_PASSWORD_CHANGED', resourceType: 'account', resourceId: null, metadata: {}, readAt: iso(-3 * DAY), createdAt: iso(-3 * DAY) },
  ],
  accessLog: () => ({ events: [
    { id: 'e-1', at: iso(-1 * DAY), action: 'viewed', actorKind: 'clinician', actorName: 'Dr Bello', facilityName: 'Lagos General Hospital' },
    { id: 'e-2', at: iso(-2 * DAY), action: 'access_granted', actorKind: 'patient', actorName: 'You', facilityName: 'Lagos General Hospital' },
  ], nextBefore: null }),
}

/*
 * What the patient did in this preview, kept in memory for the page's life (never stored): a decided request, an ended
 * grant, a share. The bodies are not read here, so a share goes to the first sample clinician for 7 days.
 */
const decided = new Map()
const ended = new Set()
const shared = []
const SHARE_PROVIDERS = [
  { membershipId: 'm-1', clinicianName: 'Dr Tunde Bello', role: 'doctor', facilityName: 'Lagos General Hospital', organizationName: 'Lagos State Health Service', newOnHealthId: false },
  { membershipId: 'm-2', clinicianName: 'Dr Amaka Eze', role: 'doctor', facilityName: 'Ikeja Medical Centre', organizationName: '', newOnHealthId: true },
  { membershipId: 'm-3', clinicianName: 'Nurse Bisi Adeyemi', role: 'nurse', facilityName: 'Reddington Clinic', organizationName: '', newOnHealthId: false },
]

function patientRoute(method, path) {
  if (method !== 'GET') {
    if (/^\/identity\/me\/notifications\/[^/]+\/read$/.test(path)) return [200, { id: path.split('/')[4], readAt: iso() }]
    const decision = path.match(/^\/identity\/access-requests\/([^/]+)\/(approve|deny)$/)
    if (decision) { decided.set(decision[1], decision[2] === 'approve' ? 'approved' : 'denied'); return [200, { accessRequestId: decision[1], status: decided.get(decision[1]) }] }
    const revoke = path.match(/^\/identity\/me\/consent-grants\/([^/]+)\/revoke$/)
    if (revoke) { ended.add(revoke[1]); const i = shared.findIndex(x => x.consentGrantId === revoke[1]); if (i >= 0) shared.splice(i, 1); return [200, { consentGrantId: revoke[1], status: 'revoked', replayed: false }] }
    if (path === '/identity/me/share-providers/search') return [200, { items: SHARE_PROVIDERS }]
    if (path === '/identity/me/shares') {
      const p = SHARE_PROVIDERS[0]
      const share = { consentGrantId: `s-${shared.length + 1}`, membershipId: p.membershipId, scope: 'read_records', level: 'view_only', duration: '7d', startsAt: iso(), expiresAt: iso(7 * DAY), clinicianName: p.clinicianName, facilityName: p.facilityName, replacedConsentGrantId: null }
      shared.push(share)
      return [201, share]
    }
    return null
  }
  switch (path) {
    case '/identity/me': return [200, patient.me]
    case '/identity/me/profile-details': return [200, patient.profileDetails]
    case '/ehr/me/health-profile': return [200, patient.healthProfile]
    case '/ehr/me/records': return [200, patient.records]
    case '/identity/me/access-history': return [200, patient.accessHistory()]
    case '/identity/me/access-requests': return [200, patient.accessRequests()]
    case '/identity/me/notifications': return [200, patient.notifications()]
    case '/identity/me/notifications/unread-count': return [200, { unread: 2 }]
    case '/identity/me/access-log': return [200, patient.accessLog()]
    case '/identity/me/share-invitations': return [200, { items: [], limits: { maxOpen: 20, maxNewPerDay: 5, remainingToday: 5 } }]
    case '/identity/me/emergency-contacts/availability': return [200, { delivery: true, channels: ['sms', 'email'] }]
    case '/identity/me/emergency-contacts': return [200, [
      { contactId: 'a0000000-0000-4000-8000-000000000001', name: 'Chidi Okafor', relationship: 'sibling', channel: 'sms', destinationHint: '+234•••••567', status: 'verified', verifiedAt: '2026-10-01T00:00:00Z', notifyOnEmergencyAccess: true, eligibleForEmergencyNotification: true, version: 1, pendingVerification: null, lastNotification: null },
    ]]
    case '/identity/me/account-deletion': return [200, { waitingPeriodSeconds: 1209600, confirmationTtlSeconds: 600, request: null }]
    case '/identity/me/imported-notifications': return [200, []]
    default: return null
  }
}

// --------------------------------------------------------------- provider --
const DEMO_FACILITY_ID = '98d00002-0000-4000-8000-000000000001' // blue EHR demo facility
const CLASSIC_FACILITY_ID = 'f0000000-0000-4000-8000-000000000001'
const STAFF_PERMISSIONS = [
  'identity.patient.read', 'identity.registration.write', 'identity.registration.approve', 'identity.patient.assisted_registration',
  'identity.consent.read', 'identity.consent.write', 'identity.break-glass.write', 'identity.patient-access-pin.verify', 'audit.read',
  'ehr.encounter.read', 'ehr.encounter.write', 'ehr.note.read', 'ehr.note.write', 'ehr.vital.read', 'ehr.vital.write',
  'ehr.diagnosis.read', 'ehr.diagnosis.write', 'ehr.prescription.read', 'ehr.prescription.write', 'ehr.lab-request.read',
  'ehr.lab-request.write', 'ehr.document.read', 'ehr.document.write', 'ehr.imported-history.read',
  'lab.work-item.read', 'lab.work-item.accept', 'lab.accession.create', 'lab.accession.read', 'lab.specimen.collect',
  'lab.specimen.receive', 'lab.specimen.reject', 'lab.execution.read', 'lab.execution.start', 'lab.execution.complete',
  'lab.result.enter', 'lab.result.verify', 'lab.result.release', 'lab.result.correct', 'lab.result.released.read',
  'pharmacy.work-item.read', 'pharmacy.work-item.accept', 'pharmacy.dispensing.create', 'pharmacy.dispensing.read', 'pharmacy.dispensing.reverse',
  'ocr.job.read', 'ocr.job.write', 'ocr.validation.write', 'ocr.patient.confirm', 'ocr.publication.write',
  'outreach.registration.read', 'outreach.registration.write', 'outreach.campaign.read', 'outreach.campaign.write',
  'billing.subscription.read', 'billing.subscription.manage',
  // Point of care (docs/POINT_OF_CARE_SPEC.md; proposed): so Payments, Price list, End of day and Payment setup show.
  'billing.settings.manage', 'billing.catalogue.read', 'billing.catalogue.manage', 'billing.bill.read', 'billing.bill.create',
  'billing.bill.defer', 'billing.payment.record', 'billing.payment.confirm', 'billing.payment.void', 'billing.payment.waive',
  'billing.shift.manage', 'billing.shift.own', 'pharmacy.walk-in.create', 'pharmacy.stock.read', 'pharmacy.stock.manage', 'lab.walk-in.create',
  'lab.result.share',
]
const staffFacility = () => {
  const classic = options.facility === 'classic'
  return {
    id: classic ? CLASSIC_FACILITY_ID : DEMO_FACILITY_ID,
    membershipId: 'member-demo-1', organizationId: 'org-demo',
    name: classic ? 'Ikeja Clinic' : 'Demo Hospital', code: classic ? 'IKJ' : 'DEMO-H',
    roles: ['doctor'], permissions: STAFF_PERMISSIONS, isPrimary: true,
  }
}
const staffSession = () => {
  const facility = staffFacility()
  return {
    actor: { kind: 'staff', id: 'staff-demo-1', email: 'demo.clinician@example.test', displayName: 'Dr Tunde Bello', roles: ['doctor'], permissions: [], facilities: [facility], facility },
    expiresAt: iso(30 * DAY), facilitySelection: 'selected',
  }
}
const DEMO_PATIENT_ID = 'a0000000-0000-4000-8000-000000000001'

// Pharmacy's queue, as GET /pharmacy/work-items sends it today: this facility's own work carries no `patient` (only routed
// work does: BACKEND-NEEDS.md), no priority, no image and no quantity. Dispensings made here are kept for the session.
const pharmacyDispensed = new Map([['rx-6', { id: 'disp-6', reversed: false, version: 1 }]])
const pharmacyPaperItems = []
const pharmacyItems = () => [
  { id: 'rx-1', patientId: DEMO_PATIENT_ID, version: 1, acceptedAt: iso(-25 * MIN), medication: { display: 'Amoxicillin 500 mg capsules' }, doseQuantity: 1, doseUnit: 'capsule', routeCode: 'oral', frequency: 'three times daily', instructions: 'For 7 days. Finish the course.' },
  { id: 'rx-2', patientId: 'a0000000-0000-4000-8000-000000000002', version: 1, acceptedAt: iso(-18 * MIN), medication: { display: 'Paracetamol 120 mg/5 ml syrup' }, doseQuantity: 5, doseUnit: 'ml', routeCode: 'oral', frequency: 'every 6 hours when needed', instructions: 'For fever. No more than 4 doses in 24 hours.' },
  { id: 'rx-3', patientId: 'a0000000-0000-4000-8000-000000000003', version: 1, acceptedAt: iso(-12 * MIN), medication: { display: 'Salbutamol 100 mcg inhaler' }, doseQuantity: 2, doseUnit: 'puffs', routeCode: 'inhaled', frequency: 'when needed for wheeze', instructions: null },
  { id: 'rx-4', patientId: DEMO_PATIENT_ID, version: 1, acceptedAt: iso(-9 * MIN), medication: { display: 'Ceftriaxone 1 g injection' }, doseQuantity: 1, doseUnit: 'g', routeCode: 'iv', frequency: 'once daily', instructions: 'For 5 days on the ward.' },
  { id: 'rx-5', patientId: 'a0000000-0000-4000-8000-000000000004', version: 1, acceptedAt: iso(-6 * MIN), medication: { display: 'Metformin 500 mg tablets' }, doseQuantity: null, doseUnit: null, routeCode: 'oral', frequency: '', instructions: null },
  { id: 'rx-6', patientId: 'a0000000-0000-4000-8000-000000000005', version: 2, acceptedAt: iso(-2 * 60 * MIN), medication: { display: 'Hydrocortisone 1% cream' }, doseQuantity: 1, doseUnit: 'thin layer', routeCode: 'topical', frequency: 'twice daily', instructions: 'To the rash only.' },
  { id: 'rx-7', patientId: 'a0000000-0000-4000-8000-000000000006', version: 1, acceptedAt: iso(-3 * MIN), medication: { display: 'Artemether/Lumefantrine 80/480 mg' }, doseQuantity: 1, doseUnit: 'tablet', routeCode: 'oral', frequency: 'twice daily', instructions: 'With food, for 3 days.' },
  // Paper prescriptions entered at the pharmacy (POINT_OF_CARE_SPEC §4, not a counter sale): queued here to pick.
  ...pharmacyPaperItems,
].map(item => {
  const done = pharmacyDispensed.get(item.id)
  return { ...item, version: done ? item.version + 1 : item.version, dispensing: done ? { id: done.id, reversed: done.reversed } : null,
    bill: pharmacyBills[item.id] ?? null, stock: pharmacyStock[item.id] ?? null }
})
// POINT_OF_CARE_SPEC §3 and §5 (proposed, not served yet): each work item's bill summary and the stock on hand, so the
// preview shows Paid, Unpaid, Part paid, Bill follows and Out of stock. Pharmacy/lab work-item fields only.
const pharmacyBills = {
  'rx-1': { billId: 'bill-rx-1', status: 'paid', dueKobo: 0, receiptNumber: 'R-000388' },
  'rx-2': { billId: 'bill-rx-2', status: 'unpaid', dueKobo: 120_000, receiptNumber: null },
  'rx-3': { billId: 'bill-rx-3', status: 'unpaid', dueKobo: 450_000, receiptNumber: null },
  'rx-4': { billId: 'bill-rx-4', status: 'deferred', dueKobo: 850_000, receiptNumber: null },
  'rx-5': { billId: 'bill-rx-5', status: 'unpaid', dueKobo: 150_000, receiptNumber: null },
  'rx-6': { billId: 'bill-rx-6', status: 'paid', dueKobo: 0, receiptNumber: 'R-000371' },
  'rx-7': { billId: 'bill-rx-7', status: 'part_paid', dueKobo: 200_000, receiptNumber: null },
}
const pharmacyStock = {
  'rx-1': { onHand: 240, unit: 'capsules' }, 'rx-2': { onHand: 18, unit: 'bottles' }, 'rx-3': { onHand: 0, unit: 'inhalers' },
  'rx-4': { onHand: 30, unit: 'vials' }, 'rx-5': { onHand: 600, unit: 'tablets' }, 'rx-6': { onHand: 12, unit: 'tubes' },
  'rx-7': { onHand: 4, unit: 'packs' },
}

// Outreach: one active registration campaign this membership belongs to, and the cases registered in the field.
const outreachLinked = new Set(['oc-3'])
const outreachCampaigns = () => [
  { id: 'camp-1', name: 'Ajegunle health week', status: 'active', services: ['registration', 'screening'], startsAt: iso(-3 * DAY), rowVersion: 2 },
  { id: 'camp-2', name: 'Makoko school screening', status: 'draft', services: ['screening'], startsAt: iso(10 * DAY), rowVersion: 1 },
]
const outreachCases = () => [
  { id: 'oc-1', campaignId: 'camp-1', fullName: 'Kemi Balogun', ageYears: 34, sex: 'female', temporaryPatientId: 'tmp_7f3a9c21', createdAt: iso(-40 * MIN), rowVersion: 1 },
  { id: 'oc-2', campaignId: 'camp-1', fullName: 'Ibrahim Musa', ageYears: 61, sex: 'male', temporaryPatientId: 'tmp_2b8e4d10', createdAt: iso(-2 * 60 * MIN), rowVersion: 1 },
  { id: 'oc-3', campaignId: 'camp-1', fullName: 'Chiamaka Obi', ageYears: 8, sex: 'female', temporaryPatientId: 'tmp_9d1c6a55', createdAt: iso(-1 * DAY), rowVersion: 2 },
  { id: 'oc-4', fullName: 'Segun Adewale', ageYears: 45, sex: 'unknown', temporaryPatientId: 'tmp_4e6f0b77', createdAt: iso(-2 * DAY), rowVersion: 1 },
].map(item => ({ ...item, status: outreachLinked.has(item.id) ? 'identity_resolved' : 'identity_resolution_pending', rowVersion: item.rowVersion + (outreachLinked.has(item.id) && item.id !== 'oc-3' ? 1 : 0) }))

function staffRoute(method, path) {
  if (method === 'POST' && path === '/auth/facility') return [200, staffSession()]
  const dispense = method === 'POST' && /^\/pharmacy\/work-items\/([^/]+)\/dispensings$/.exec(path)
  if (dispense) {
    const id = decodeURIComponent(dispense[1])
    if (!pharmacyItems().some(item => item.id === id)) return null
    pharmacyDispensed.set(id, { id: `disp-${id}`, reversed: false, version: 1 })
    return [201, { id: `disp-${id}`, workItemId: id, version: 1 }]
  }
  const reversal = method === 'POST' && /^\/pharmacy\/dispensings\/([^/]+)\/reversals$/.exec(path)
  if (reversal) {
    const entry = [...pharmacyDispensed.values()].find(done => done.id === decodeURIComponent(reversal[1]))
    if (!entry) return null
    entry.reversed = true
    entry.version += 1
    return [201, { id: entry.id, reversed: true, version: entry.version }]
  }
  const link = method === 'POST' && /^\/outreach\/registration-cases\/([^/]+)\/link-existing$/.exec(path)
  if (link) {
    const id = decodeURIComponent(link[1])
    if (!outreachCases().some(item => item.id === id)) return null
    outreachLinked.add(id)
    return [200, outreachCases().find(item => item.id === id)]
  }
  if (method === 'POST' && path === '/identity/patient-lookup') return [200, {
    authorization: { decision: 'allow', consentGrantId: 'grant-1', expiresAt: iso(2 * 60 * MIN), breakGlass: false },
    patient: { patientId: DEMO_PATIENT_ID, hid: 'HID-ZDEMAAA2', fullName: 'Adaeze Okafor', dateOfBirth: '1991-03-04', gender: 'female', version: 1 },
  }]
  if (method !== 'GET') return null
  const dispensing = /^\/pharmacy\/dispensings\/([^/]+)$/.exec(path)
  if (dispensing) {
    const entry = [...pharmacyDispensed.values()].find(done => done.id === decodeURIComponent(dispensing[1]))
    return entry ? [200, { id: entry.id, version: entry.version, reversed: entry.reversed }] : null
  }
  const members = /^\/outreach\/registration-cases\/campaigns\/([^/]+)\/members$/.exec(path)
  if (members) return [200, decodeURIComponent(members[1]) === 'camp-1' ? [
    { id: 'cm-1', campaignId: 'camp-1', membershipId: 'member-demo-1', role: 'health_worker', createdAt: iso(-4 * DAY) },
    { id: 'cm-2', campaignId: 'camp-1', membershipId: 'member-demo-7', role: 'enumerator', createdAt: iso(-4 * DAY) },
  ] : []]
  if (/^\/ehr\/patients\/[^/]+\/encounters(\/[^/]+\/[a-z-]+)?$/.test(path) || path === '/ehr/documents') return [200, { items: [], nextCursor: null }]
  switch (path) {
    case '/identity/access-requests': return [200, [
      { accessRequestId: 'ar-1', patientId: DEMO_PATIENT_ID, scope: 'read_records', purposeOfUse: 'direct-care', reason: 'Follow-up', status: 'pending', requestedDurationMinutes: 60, requestedAt: iso(-20 * MIN), approvedAt: null, deniedAt: null, deniedReason: null, consentGrantId: null, grantExpiresAt: null, effectiveStatus: 'pending', authorizationMethod: null },
    ]]
    case '/identity/shared-with-me': return [200, { items: [] }]
    case '/identity/share-invitations': return [200, { eligible: false, items: [] }]
    case '/identity/registration-capabilities': return [200, { nin: { enabled: true, state: 'available' }, newPatientRegistrationRequiresNin: false }]
    case '/audit/events': return [200, { items: [
      { sequenceId: '12', occurredAt: iso(-2 * 60 * MIN), correlationId: 'corr-12', actorType: 'staff', action: 'ehr.encounter.create', outcome: 'success', resourceType: 'encounter' },
      { sequenceId: '11', occurredAt: iso(-5 * 60 * MIN), correlationId: 'corr-11', actorType: 'staff', action: 'identity.patient.lookup', outcome: 'success', resourceType: 'patient' },
    ], nextBeforeSequenceId: null }]
    case '/lab/work-items': return [200, { items: [
      { id: 'lw-1', patientId: DEMO_PATIENT_ID, version: 1, status: 'accepted', testName: 'Full blood count', acceptedAt: iso(-40 * MIN), priority: 'routine',
        bill: { billId: 'bill-lw-1', status: 'paid', dueKobo: 0, receiptNumber: 'R-000390' } },
      { id: 'lw-2', patientId: DEMO_PATIENT_ID, version: 1, status: 'accepted', testName: 'Malaria parasite test', acceptedAt: iso(-15 * MIN), priority: 'urgent',
        bill: { billId: 'bill-lw-2', status: 'unpaid', dueKobo: 350_000, receiptNumber: null } },
      // A walk-in sent by an outside doctor (POINT_OF_CARE_SPEC §4): `outside` lets "Send to doctor" fill in the email.
      { id: 'lw-3', patientId: 'a0000000-0000-4000-8000-000000000007', version: 1, status: 'accepted', testName: 'Fasting blood sugar', acceptedAt: iso(-8 * MIN), priority: 'routine',
        bill: { billId: 'bill-lw-3', status: 'unpaid', dueKobo: 250_000, receiptNumber: null },
        outside: { prescriberName: 'Dr Funmi Adeyemi', facilityName: 'Grace Family Clinic', writtenOn: iso(-1 * DAY).slice(0, 10), prescriberEmail: 'f.adeyemi@graceclinic.example', prescriberPhone: '+2348021112233', photoFileId: null } },
    ] }]
    case '/pharmacy/work-items': return [200, { items: pharmacyItems() }]
    case '/outreach/registration-cases/campaigns': return [200, outreachCampaigns()]
    case '/outreach/registration-cases': return [200, outreachCases()]
    case '/commercial/subscription': return [200, { organizationId: 'org-demo', productCode: 'provider', status: 'active', trialEndsAt: null, currentPeriodEndsAt: iso(32 * DAY), graceEndsAt: null, price: null, selfServePayment: false }]
    case '/commercial/invoices': return [200, { items: [] }]
    case '/ocr/jobs': return [200, { job: null }]
    default: return null
  }
}

// ------------------------------------------------------------------ admin --
const ADMIN_ACTOR = {
  accountId: 'admin-1', subject: 'staff:admin-1', displayName: 'Akorede Admin', email: 'admin@example.test',
  platformRoles: ['platform_super_admin'],
  platformPermissions: [
    'platform.admin.access', 'platform.audit.read', 'platform.control.manage', 'platform.control.read',
    'platform.demo.manage', 'platform.demo.read', 'platform.facility.manage', 'platform.facility.read', 'platform.facility.unlock',
    'platform.identity-review.read', 'platform.integration.manage', 'platform.integration.read', 'platform.integration.test',
    'platform.mfa.reset', 'platform.operations.read', 'platform.pricing.manage', 'platform.pricing.read', 'platform.principal.export',
    'platform.principal.manage', 'platform.principal.read', 'platform.role.manage', 'platform.session.revoke', 'platform.workforce.manage',
  ],
}
const adminGrant = () => ({ actor: { ...ADMIN_ACTOR, kind: 'platform', sessionId: 's1' }, expiresAt: iso(8 * 60 * MIN), idleExpiresAt: iso(15 * MIN) })
const FACILITY_UUID = '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f'
const adminFacilities = [
  { id: FACILITY_UUID, organizationId: 'org-1', organizationName: 'Lagos Health', name: 'Ikeja Clinic', code: 'IKJ', status: 'verified', statusReason: null, statusChangedAt: null, createdAt: '2026-09-01T09:00:00.000Z', membershipCount: 4, version: 3 },
  { id: '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d', organizationId: 'org-2', organizationName: 'Reddington Group', name: 'Reddington Lekki', code: 'RDL', status: 'pending', statusReason: null, statusChangedAt: null, createdAt: '2026-10-12T09:00:00.000Z', membershipCount: 1, version: 1 },
]

function adminRoute(method, path) {
  if (method === 'POST' && path === '/auth/admin/refresh') return [200, adminGrant()]
  if (method === 'POST' && path === '/auth/admin/logout') return [204, null]
  if (method === 'POST' && path === '/admin/principals/search') return [200, { items: [], page: 1, pageSize: 25, total: 0 }]
  if (method !== 'GET') return null
  if (/^\/admin\/facilities\/[^/]+\/assisted-registration$/.test(path)) {
    return [200, { facilityId: path.split('/')[3], designated: false, status: null, addressLine: null, town: null, lga: null, state: null, hours: null, reason: null, version: 0, updatedAt: null }]
  }
  if (/^\/admin\/facilities\/[^/]+$/.test(path)) {
    const found = adminFacilities.find(f => f.id === path.split('/')[3])
    return found ? [200, found] : null
  }
  if (/^\/admin\/integrations\/[^/]+\/audit$/.test(path)) return [200, { items: [] }]
  switch (path) {
    case '/admin/session': return [200, { actor: ADMIN_ACTOR }]
    case '/admin/mfa': return [200, {
      enrolled: true, factorType: 'totp', activatedAt: '2026-10-01T09:00:00.000Z', lastUsedAt: iso(-60 * MIN), recoveryCodesRemaining: 8,
      session: { mfaVerifiedAt: iso(-60 * MIN), mfaMethod: 'totp', stepUpExpiresAt: null, idleExpiresAt: iso(15 * MIN), absoluteExpiresAt: iso(8 * 60 * MIN) },
    }]
    case '/admin/overview': return [200, { registeredPatients: 12480, facilities: 29, verifiedFacilities: 12, suspendedFacilities: 1, activeStaffMemberships: 214, pendingIdentityReviews: 3 }]
    case '/admin/approvals': return [200, { items: [
      { id: 'request-1', action: 'platform_role.grant', roleCode: 'platform_super_admin', targetAccountId: 'account-c', targetEmail: 'c@example.test', targetDisplayName: 'Chidi Operator', reason: 'Second on-call Super Admin', status: 'pending', requestedBy: 'admin-a', requestedAt: iso(-3 * 60 * MIN), expiresAt: iso(21 * 60 * MIN), decidedBy: null, decidedAt: null, decisionReason: null, executedAt: null, version: 1 },
    ], nextCursor: null }]
    case '/admin/organization-applications': return [200, { items: [
      { applicationId: 'app-1', productCode: 'ehr', organizationName: 'Ikeja Care Ltd', organizationType: 'clinic', cacHint: 'RC••••56', administratorName: 'Bola Admin', administratorEmail: 'bola@example.test', status: 'ready_for_review', verificationResult: 'verified', verifiedOrganizationName: 'IKEJA CARE LIMITED', verifiedEntityType: 'Limited company', verifiedRegistrationDate: '2015-04-01', verifiedAddress: '1 Allen Avenue, Ikeja', verifiedRegistryStatus: 'active', profileCompanyName: 'Ikeja Care Ltd', profileEntityType: null, profileRegistrationDate: null, profileAddress: null, profileRegistryStatus: null, profileState: 'complete', fieldSources: { companyName: 'qoreid' }, createdAt: '2026-10-01T09:00:00.000Z', verifiedAt: '2026-10-02T09:00:00.000Z', reviewedAt: null, version: 5 },
    ] }]
    case '/admin/demo-requests': return [200, { items: [
      { id: 'd1', contactName: 'Tolu Adeyemi', contactEmail: 'tolu@example.test', contactPhone: null, contactRole: 'Medical Director', organizationName: 'Surulere Family Clinic', organizationType: 'clinic', productCode: 'ehr', message: null, sourcePage: '/', sourceSection: null, ctaLabel: null, status: 'new', createdAt: iso(-1 * DAY), version: 1 },
    ], nextCursor: null }]
    case '/admin/integrations': return [200, {
      items: [{ provider: 'ses', name: 'AWS SES', enabled: true, health: 'healthy', managementMode: 'dashboard', availableActions: ['pause', 'configure'], capabilities: ['email'], activeCapabilities: ['email'], operationGates: [{ operation: 'send', state: 'available', detail: 'Ready to send' }], configuration: { fromAddress: 'no-reply@example.test' }, credential: { state: 'configured', rotationSupported: false }, lastTestedAt: null, lastSuccessfulTestAt: null, lastFailedTestAt: null, version: 7 }],
      capabilities: [{ capability: 'email', activeProvider: 'ses', fallbackProvider: null, eligibleProviders: ['ses'], version: 1 }],
    }]
    case '/admin/facilities': return [200, { items: adminFacilities, page: 1, pageSize: 25, total: adminFacilities.length }]
    case '/admin/identity/reviews': return [200, { items: [], page: 1, pageSize: 25, total: 0 }]
    case '/admin/clinician-applications': return [200, { items: [], nextCursor: null }]
    case '/admin/audit/events': return [200, { items: [
      { sequenceId: '7', eventId: 'event-7', occurredAt: iso(-4 * 60 * MIN), correlationId: 'corr-7', actorType: 'staff', actorSubject: 'staff:admin-1', facilityId: FACILITY_UUID, action: 'admin.facility.status.request', outcome: 'success', resourceType: 'facility', resourceId: FACILITY_UUID, purposeOfUse: 'operations', reason: 'Licence verified', sourceSystem: 'hid' },
    ], nextBeforeSequenceId: null }]
    case '/admin/sessions': return [200, { accountId: 'admin-1', items: [
      { sessionId: 's1', familyId: 'family-s1', kind: 'platform', authenticationMethod: 'password', signedInAt: iso(-60 * MIN), lastRefreshedAt: iso(-5 * MIN), idleExpiresAt: iso(15 * MIN), absoluteExpiresAt: iso(8 * 60 * MIN), mfaVerifiedAt: iso(-60 * MIN), mfaMethod: 'totp', lastStepUpAt: null, sourceIp: '203.0.113.7', current: true },
    ] }]
    case '/admin/operations/services': return [200, { checkedAt: iso(), services: ['gateway', 'identity', 'ehr', 'lab', 'pharmacy'].map(service => ({ service, state: 'healthy', checkedAt: iso(), code: null })) }]
    case '/admin/operations/events': return [200, { state: 'healthy', code: null, metrics: null, failures: [] }]
    case '/admin/controls': return [200, [{ controlKey: 'maintenance_mode', enabled: false, reason: 'Normal operation', updatedAt: '2026-10-01T09:00:00.000Z', version: 3 }]]
    case '/admin/pricing': return [200, {
      products: [{ slug: 'ehr', name: 'EHR', status: 'active', version: 1 }],
      prices: [{ product_slug: 'ehr', context: 'per_facility', visibility: 'fixed', amount_minor: 5000000, currency: 'NGN', billing_period: 'monthly', unit: null, active: true, version: 1 }],
    }]
    default: return null
  }
}


// Optional features that are off in the default build: the UI hides them on a 404, so they are not backend needs.
export const EXPECTED_404 = new Set(['GET /ehr/me/imported-history', 'GET /identity/me/web-push', 'GET /identity/me/photo'])

/** The workspace a request belongs to, from its path and the path of the page asking. */
export function workspaceFor(path, pagePath, forced) {
  if (path.startsWith('/admin/') || path.startsWith('/auth/admin/')) return 'admin'
  if (forced === 'patient' || forced === 'provider') return forced
  return pagePath.startsWith('/provider') ? 'provider' : 'patient'
}

/**
 * Answers one gateway request. `path` is the part after /api/v1, without query. `request` may carry the parsed JSON
 * `body` and the `query` (URLSearchParams); the point-of-care writes need the body.
 * Returns { status, body, headers } or null when the mock has no answer.
 */
// ---------------------------------------------------------- point of care --
// docs/POINT_OF_CARE_SPEC.md (proposed, not served by hid-system yet): payment setup, the price list, bills and their
// payments, receipts and end of day, for the provider workspace. Payments, items and the day are kept in this process's
// memory for the session (a reload of the preview starts again). Health ID records payments; it never moves money.
// A write needs its JSON body: the in-page preview passes it; the Node server reads none, so there a write is refused
// 400 MOCK_BODY_NOT_RECEIVED rather than saving something that was not sent.
const pocKobo = naira => Math.round(naira * 100)
const pocSettings = {
  wherePaid: 'both', methods: ['cash', 'pos', 'transfer', 'hmo', 'waiver'],
  payBefore: { pharmacy: true, lab: true }, allowDeferredFor: ['emergency', 'inpatient'],
  transferAccount: { bankName: 'Zenith Bank', accountName: 'Demo Hospital Ltd', accountNumber: '1012345678' },
  hmos: [{ id: 'hmo-nhia', name: 'NHIA' }, { id: 'hmo-hygeia', name: 'Hygeia HMO' }, { id: 'hmo-axa', name: 'AXA Mansard Health' }, { id: 'hmo-leadway', name: 'Leadway Health' }],
  receiptFooter: 'Thank you. Keep this receipt: the pharmacy or lab will ask for it.',
  // End of day (§7): each till has its own day here; 'facility' and 'cashier' can be tried from Payment setup.
  dayCloseBy: 'till', tills: [{ id: 'till-pharmacy', name: 'Pharmacy till' }, { id: 'till-lab', name: 'Lab till' }],
  version: 3,
}
const pocItem = (id, kind, name, extra, cash, hmo = {}) => ({
  id, kind, name, strength: null, form: null, packSize: null, imageUrl: null, prescriptionOnly: kind === 'drug', active: true, version: 1, ...extra,
  prices: { cashKobo: pocKobo(cash), hmo: Object.entries(hmo).map(([hmoId, amount]) => ({ hmoId, amountKobo: pocKobo(amount) })) },
})
const pocCatalogue = [
  pocItem('cat-amox', 'drug', 'Amoxicillin', { strength: '500 mg', form: 'capsule', packSize: 'Strip of 10' }, 1200, { 'hmo-nhia': 900, 'hmo-hygeia': 1100 }),
  pocItem('cat-pcm-syr', 'drug', 'Paracetamol syrup', { strength: '120 mg/5 ml', form: 'liquid', packSize: '60 ml bottle', prescriptionOnly: false }, 1200, { 'hmo-nhia': 800 }),
  pocItem('cat-salb', 'drug', 'Salbutamol inhaler', { strength: '100 mcg', form: 'inhaler', packSize: '200 doses' }, 4500, { 'hmo-hygeia': 4000, 'hmo-axa': 4200 }),
  pocItem('cat-ceft', 'drug', 'Ceftriaxone', { strength: '1 g', form: 'injection', packSize: 'Vial' }, 8500, { 'hmo-nhia': 6500, 'hmo-leadway': 8000 }),
  pocItem('cat-metf', 'drug', 'Metformin', { strength: '500 mg', form: 'tablet', packSize: 'Strip of 30' }, 1500, { 'hmo-nhia': 1000 }),
  pocItem('cat-hc', 'drug', 'Hydrocortisone cream', { strength: '1%', form: 'cream', packSize: '15 g tube' }, 2000),
  pocItem('cat-al', 'drug', 'Artemether/Lumefantrine', { strength: '80/480 mg', form: 'tablet', packSize: 'Pack of 6' }, 3500, { 'hmo-nhia': 2500, 'hmo-hygeia': 3200 }),
  pocItem('cat-vitc', 'drug', 'Vitamin C', { strength: '100 mg', form: 'tablet', packSize: 'Strip of 10', prescriptionOnly: false }, 500),
  pocItem('cat-fbc', 'lab_test', 'Full blood count', { packSize: 'Blood, EDTA tube' }, 4000, { 'hmo-nhia': 3000, 'hmo-hygeia': 3800 }),
  pocItem('cat-mp', 'lab_test', 'Malaria parasite test', { packSize: 'Blood film' }, 3500, { 'hmo-nhia': 2500 }),
  pocItem('cat-fbs', 'lab_test', 'Fasting blood sugar', { packSize: 'Blood, fluoride tube' }, 2500, { 'hmo-axa': 2300 }),
  pocItem('cat-ua', 'lab_test', 'Urinalysis', { packSize: 'Urine, clean catch' }, 2000),
  pocItem('cat-dress', 'other', 'Wound dressing', { packSize: 'Per dressing' }, 3000, { 'hmo-leadway': 2700 }),
]
const POC_PATIENTS = {
  [DEMO_PATIENT_ID]: ['Adaeze Okafor', 'HID-ZDEMAAA2'],
  'a0000000-0000-4000-8000-000000000002': ['Musa Ibrahim', 'HID-MUSA4821'],
  'a0000000-0000-4000-8000-000000000003': ['Ngozi Eze', 'HID-NGOZ7710'],
  'a0000000-0000-4000-8000-000000000004': ['Abubakar Bello', 'HID-ABUB3392'],
  'a0000000-0000-4000-8000-000000000005': ['Funke Adebayo', 'HID-FUNK2054'],
  'a0000000-0000-4000-8000-000000000006': ['Emeka Nwosu', 'HID-EMEK6618'],
  'a0000000-0000-4000-8000-000000000007': ['Halima Yusuf', 'HID-HALI9043'],
}
/** Names by Health ID: the demo patients and anyone given a Health ID at a walk-in, so a bill shows their name. */
const POC_HID_NAMES = Object.fromEntries(Object.values(POC_PATIENTS).map(([name, hid]) => [hid, name]))

// Facility registration (served by hid-system: NIN check → case → approve new or link existing → enroll), as the
// Registration page and a walk-in's "New Health ID" use it. Cases live in memory. A last name the demo patients share
// (Okafor, Ibrahim, Eze…) answers a possible match, so "This is them" / "Someone new" can be tried; anyone else, none.
const registrationCases = new Map()
let registrationSeq = 1
const newHid = () => `HID-${Array.from({ length: 8 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')}`
function registrationRoute(method, path, { body } = {}) {
  if (method === 'POST' && path === '/identity/nin/resolve') {
    if (!body) return NO_BODY()
    if (!body.firstName || !body.lastName || !body.dateOfBirth) return pocProblem(400, 'VALIDATION_FAILED', 'Enter the name and date of birth.')
    if (body.nin !== undefined && !/^\d{11}$/.test(body.nin)) return pocProblem(400, 'VALIDATION_FAILED', 'Enter the 11 digit NIN.')
    const last = String(body.lastName).trim().toLowerCase()
    const candidates = Object.entries(POC_PATIENTS).filter(([, [name]]) => name.toLowerCase().split(' ').at(-1) === last)
      .map(([patientId, [fullName]]) => ({ patientId, fullName, dateOfBirth: patientId === DEMO_PATIENT_ID ? '1991-03-04' : null }))
    const caseId = `00000000-0000-4000-8000-${String(registrationSeq++).padStart(12, '0')}`
    const found = { caseId, status: candidates.length ? 'review_required' : 'pending_new_identity_approval', version: 1,
      candidateCount: candidates.length, candidates, fullName: `${String(body.firstName).trim()} ${String(body.lastName).trim()}` }
    registrationCases.set(caseId, found)
    const { fullName: _name, ...view } = found
    return [201, view]
  }
  const casePath = /^\/identity\/registration-cases\/([^/]+)(\/(approve-new|link-existing|enroll))?$/.exec(path)
  if (!casePath) return null
  const found = registrationCases.get(decodeURIComponent(casePath[1]))
  if (!found) return pocProblem(404, 'IDENTITY_REGISTRATION_CASE_NOT_FOUND', 'No such registration.')
  const view = () => { const { fullName: _name, ...rest } = found; return rest }
  const action = casePath[3]
  if (!action) return method === 'GET' ? [200, view()] : null
  if (method !== 'POST') return null
  if (!body) return NO_BODY()
  if (body.expectedVersion !== undefined && body.expectedVersion !== found.version) return pocProblem(409, 'VERSION_CONFLICT', 'The registration changed.')
  if (action === 'approve-new') {
    if (!['pending_new_identity_approval', 'review_required'].includes(found.status)) return pocProblem(409, 'IDENTITY_REGISTRATION_INVALID_STATE', 'This registration is already decided.')
    const hid = newHid()
    Object.assign(found, { status: 'approved_new_identity', version: found.version + 1, patient: { patientId: crypto.randomUUID(), hid } })
    POC_HID_NAMES[hid] = found.fullName
    return [200, view()]
  }
  if (action === 'link-existing') {
    const candidate = found.candidates.find(entry => entry.patientId === body.patientId)
    if (found.status !== 'review_required' || !candidate) return pocProblem(409, 'IDENTITY_REGISTRATION_INVALID_STATE', 'Pick one of the matches.')
    Object.assign(found, { status: 'linked_existing', version: found.version + 1, patient: { patientId: candidate.patientId, hid: POC_PATIENTS[candidate.patientId][1] } })
    return [200, view()]
  }
  if (!found.patient) return pocProblem(409, 'IDENTITY_REGISTRATION_INVALID_STATE', 'Give them a Health ID first.')
  if (!/^\S+@\S+\.\S+$/.test(body.email ?? '')) return pocProblem(400, 'VALIDATION_FAILED', 'Enter a valid email.')
  return [201, { patientId: found.patient.patientId, hid: found.patient.hid, contactVerificationRequired: true, replayed: false }]
}
const STAFF_NAME = 'Dr Tunde Bello'
let pocBillSeq = 400
let pocReceiptSeq = 391
let pocPaymentSeq = 1
const pocPayment = (method, amount, extra = {}) => ({
  id: `pay-${pocPaymentSeq++}`, method, amountKobo: pocKobo(amount), reference: null, hmoId: null, waivedBy: null, reason: null,
  receivedBy: STAFF_NAME, receivedAt: iso(-90 * MIN), voided: false, status: method === 'transfer' ? 'pending_check' : 'recorded', ...extra,
})
function pocBill(id, source, patientId, lines, { status = 'unpaid', payments = [], receiptNumber = null, ago = 30 } = {}) {
  const billLines = lines.map(([catId, quantity, workItemId = null], index) => {
    const found = pocCatalogue.find(entry => entry.id === catId)
    return { id: `${id}-l${index + 1}`, catalogueItemId: catId, name: [found.name, found.strength].filter(Boolean).join(' '), quantity,
      unitKobo: found.prices.cashKobo, totalKobo: found.prices.cashKobo * quantity, workItemId }
  })
  const patient = patientId ? { patientId, displayName: POC_PATIENTS[patientId][0], healthId: POC_PATIENTS[patientId][1] } : null
  const bill = { id, number: `B-000${pocBillSeq++}`, source, status, patient, lines: billLines, totalKobo: 0, paidKobo: 0, dueKobo: 0,
    payments, receiptNumber, createdAt: iso(-ago * MIN), version: 1 }
  return settleBill(bill, status)
}
/** Totals from the lines and the payments that stand; the status follows unless the bill is deferred or void. */
function settleBill(bill, keep) {
  bill.totalKobo = bill.lines.reduce((sum, line) => sum + line.totalKobo, 0)
  bill.paidKobo = bill.payments.filter(payment => !payment.voided).reduce((sum, payment) => sum + payment.amountKobo, 0)
  bill.dueKobo = Math.max(0, bill.totalKobo - bill.paidKobo)
  bill.status = keep === 'deferred' || keep === 'void' ? keep : bill.dueKobo === 0 ? 'paid' : bill.paidKobo > 0 ? 'part_paid' : 'unpaid'
  return bill
}
const POC_PID = 'a0000000-0000-4000-8000-00000000000'
const pocBills = [
  pocBill('bill-rx-1', 'pharmacy', DEMO_PATIENT_ID, [['cat-amox', 2, 'rx-1']], { payments: [pocPayment('pos', 2400, { reference: '402911736055' })], receiptNumber: 'R-000388', ago: 30 }),
  pocBill('bill-rx-2', 'pharmacy', `${POC_PID}2`, [['cat-pcm-syr', 1, 'rx-2']], { ago: 20 }),
  pocBill('bill-rx-3', 'pharmacy', `${POC_PID}3`, [['cat-salb', 1, 'rx-3']], { ago: 14 }),
  pocBill('bill-rx-4', 'pharmacy', DEMO_PATIENT_ID, [['cat-ceft', 1, 'rx-4']], { status: 'deferred', ago: 10 }),
  pocBill('bill-rx-5', 'pharmacy', `${POC_PID}4`, [['cat-metf', 1, 'rx-5']], { ago: 7 }),
  pocBill('bill-rx-6', 'pharmacy', `${POC_PID}5`, [['cat-hc', 1, 'rx-6']], { payments: [pocPayment('cash', 2000)], receiptNumber: 'R-000371', ago: 130 }),
  pocBill('bill-rx-7', 'pharmacy', `${POC_PID}6`, [['cat-al', 1, 'rx-7']], { payments: [pocPayment('cash', 1500, { receivedAt: iso(-3 * MIN) })], ago: 4 }),
  pocBill('bill-lw-1', 'lab', DEMO_PATIENT_ID, [['cat-fbc', 1, 'lw-1']], { payments: [pocPayment('hmo', 3000, { hmoId: 'hmo-nhia', reference: 'NHIA-77120' }), pocPayment('cash', 1000)], receiptNumber: 'R-000390', ago: 42 }),
  pocBill('bill-lw-2', 'lab', DEMO_PATIENT_ID, [['cat-mp', 1, 'lw-2']], { ago: 16 }),
  pocBill('bill-lw-3', 'lab', `${POC_PID}7`, [['cat-fbs', 1, 'lw-3']], { ago: 9 }),
  pocBill('bill-otc-1', 'pharmacy', null, [['cat-vitc', 2], ['cat-pcm-syr', 1]], { ago: 2 }),
  pocBill('bill-lab-ua', 'lab', `${POC_PID}2`, [['cat-ua', 1], ['cat-fbc', 1]], { payments: [pocPayment('transfer', 6000, { reference: 'FBN/0091/7723', receivedAt: iso(-25 * MIN) })], receiptNumber: 'R-000389', ago: 28 }),
]
// The days open now, whoever's they are (the facility's, a cashier's or a till's), and those closed, newest last.
const pocTodayAt = (hours, minutes = 0) => new Date(new Date().setHours(hours, minutes, 0, 0)).toISOString()
const pocOpenShifts = [
  { id: 'shift-1', scope: 'till', tillId: 'till-pharmacy', tillName: 'Pharmacy till', cashierName: STAFF_NAME, openedBy: STAFF_NAME,
    openedAt: pocTodayAt(8), closedAt: null, openingCashKobo: pocKobo(20000) },
]
const pocClosedShifts = [
  { id: 'shift-0', scope: 'cashier', tillId: null, tillName: null, cashierName: 'Amaka Obi', openedBy: 'Amaka Obi', openedAt: pocTodayAt(7),
    closedAt: pocTodayAt(7, 50), openingCashKobo: pocKobo(5000), totals: ['cash', 'pos', 'transfer', 'hmo', 'waiver'].map(method => ({ method, count: method === 'cash' ? 2 : 0, amountKobo: method === 'cash' ? pocKobo(7500) : 0 })),
    expectedCashKobo: pocKobo(12500), countedCashKobo: pocKobo(12300), differenceKobo: pocKobo(-200), unpaidBills: { count: 0, amountKobo: 0 }, deferredBills: { count: 0, amountKobo: 0 }, note: 'Gave change twice.' },
]
let pocShiftSeq = 2
/** Whose day a request means, by the facility's setup: the facility's, this cashier's, or the till asked for. */
function pocShiftMatch(tillId) {
  const by = pocSettings.dayCloseBy ?? 'facility'
  if (by === 'till') return shift => shift.scope === 'till' && shift.tillId === tillId
  if (by === 'cashier') return shift => shift.scope === 'cashier' && shift.cashierName === STAFF_NAME
  return shift => shift.scope === 'facility'
}

/** The day as the screen reads it: totals of the payments that stand since it opened. */
function shiftView(shift) {
  const since = Date.parse(shift.openedAt)
  const until = shift.closedAt ? Date.parse(shift.closedAt) : Infinity
  const payments = pocBills.flatMap(bill => bill.payments).filter(payment => !payment.voided && Date.parse(payment.receivedAt) >= since && Date.parse(payment.receivedAt) <= until)
  const totals = ['cash', 'pos', 'transfer', 'hmo', 'waiver'].map(method => {
    const these = payments.filter(payment => payment.method === method)
    return { method, count: these.length, amountKobo: these.reduce((sum, payment) => sum + payment.amountKobo, 0) }
  })
  const expectedCashKobo = shift.openingCashKobo + totals.find(total => total.method === 'cash').amountKobo
  const of = status => pocBills.filter(bill => status.includes(bill.status))
  const sum = bills => ({ count: bills.length, amountKobo: bills.reduce((total, bill) => total + bill.dueKobo, 0) })
  return { ...shift, totals, expectedCashKobo, countedCashKobo: shift.countedCashKobo ?? null, differenceKobo: shift.differenceKobo ?? null,
    unpaidBills: sum(of(['unpaid', 'part_paid'])), deferredBills: sum(of(['deferred'])) }
}
/** Keeps the pharmacy queue's bill summary (its work items' `bill`) in step with a bill paid here. */
function syncWorkItemBill(bill) {
  // Every line's work item: a paper prescription with several drugs has one bill for all of them.
  for (const workItemId of bill.lines.map(line => line.workItemId).filter(Boolean)) {
    if (typeof pharmacyBills !== 'undefined' && pharmacyBills[workItemId]) {
      pharmacyBills[workItemId] = { billId: bill.id, status: bill.status, dueKobo: bill.dueKobo, receiptNumber: bill.receiptNumber }
    }
  }
}
const pocProblem = (status, code, detail) => [status, { type: 'about:blank', title: code, status, code, detail }]
const NO_BODY = () => pocProblem(400, 'MOCK_BODY_NOT_RECEIVED', 'The mock gateway did not receive what was sent, so nothing was saved. Use the in-page preview to try saving.')
const pocBump = record => { record.version += 1; return record }

// Stock, walk-ins and result shares (same spec, §4–§6), kept in memory like the rest.
const pocDay = days => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10)
const pocStock = [
  ['cat-amox', 'capsules', 180, 100, [['AMX-2291', 210, 120], ['AMX-2307', 400, 60]]],
  ['cat-pcm-syr', 'bottles', 6, 10, [['PCS-118', 45, 6]]],
  ['cat-salb', 'inhalers', 14, 5, [['SAL-77', 300, 14]]],
  ['cat-ceft', 'vials', 0, 10, []],
  ['cat-metf', 'tablets', 420, 120, [['MTF-903', 25, 120], ['MTF-951', 500, 300]]],
  ['cat-hc', 'tubes', 9, 5, [['HC-12', 180, 9]]],
  ['cat-al', 'packs', 22, 10, [['AL-4410', 90, 22]]],
  ['cat-vitc', 'tablets', 600, 100, [['VC-31', 365, 600]]],
].map(([catId, unit, onHand, reorderLevel, batches]) => {
  const item = pocCatalogue.find(entry => entry.id === catId)
  return { catalogueItemId: catId, name: item.name, strength: item.strength, form: item.form, imageUrl: null, onHand, unit, reorderLevel,
    batches: batches.map(([batchNumber, days, quantity]) => ({ batchId: `${catId}-${batchNumber}`, batchNumber, expiresOn: pocDay(days), quantity })) }
})
const pocMovements = {}
const pocMove = (catId, change, kind, note = null) => { (pocMovements[catId] ??= []).unshift({ id: `mv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, change, kind, note, by: STAFF_NAME, at: iso() }) }
pocMove('cat-amox', 400, 'received', 'Invoice EMZ-5521'); pocMove('cat-amox', -21, 'dispensed'); pocMove('cat-ceft', -10, 'dispensed'); pocMove('cat-pcm-syr', -2, 'adjusted', 'Damaged')
let pocWalkInSeq = 1

/**
 * The pharmacy's own writes (POINT_OF_CARE_SPEC §4, the owner's order of 2026-10-31: work first, identity optional):
 * - POST /pharmacy/walk-in-orders: a counter sale (`counter: true`: no queue, handed over at the counter) or a paper
 *   prescription (queued under Prescriptions to pick). No customer, a name and phone, or a Health ID; a prescription-only
 *   item needs a Health ID or the doctor's prescription (`outside`).
 * - POST /pharmacy/sales/:billId/hand-over: the sale's items leave the shelf (first to expire first).
 * - POST /files/order-photos: a photo of the paper (multipart: the preview receives no body, and keeps no picture).
 */
function pharmacySaleRoute(path, body) {
  if (path === '/files/order-photos') return [201, { fileId: `file-${Date.now().toString(36)}` }]
  if (path === '/pharmacy/walk-in-orders') {
    if (!body) return NO_BODY()
    const lines = body.items ?? []
    const who = body.patient ?? { kind: 'anonymous' }
    if (lines.length === 0) return pocProblem(400, 'VALIDATION_FAILED', 'Add at least one item.')
    const items = lines.map(line => pocCatalogue.find(entry => entry.id === line.catalogueItemId))
    if (items.some(item => !item)) return pocProblem(404, 'COMMERCIAL_CATALOGUE_ITEM_NOT_FOUND', 'An item is no longer on the price list.')
    const needsRx = items.find(item => item.prescriptionOnly)
    if (needsRx && who.kind !== 'health_id' && !body.outside?.prescriberName) return pocProblem(422, 'PRESCRIPTION_REQUIRED', `${needsRx.name} needs the doctor’s prescription.`)
    const short = lines.find(line => { const stock = pocStock.find(entry => entry.catalogueItemId === line.catalogueItemId); return stock && stock.onHand < (Number(line.quantity) || 1) })
    if (short) return pocProblem(409, 'OUT_OF_STOCK', 'There isn’t enough in stock.')
    const seq = pocWalkInSeq++
    const counter = body.counter === true
    const workItemIds = counter ? [] : lines.map((_, index) => `rx-paper-${seq}-${index + 1}`)
    const bill = pocBill(`bill-walkin-${seq}`, 'pharmacy', null, lines.map((line, index) => [line.catalogueItemId, Number(line.quantity) || 1, workItemIds[index] ?? null]), { ago: 0 })
    const name = who.kind === 'health_id' ? POC_HID_NAMES[who.healthId] ?? who.healthId : typeof who.name === 'string' && who.name.trim() ? who.name.trim() : null
    bill.patient = name ? { patientId: null, displayName: name, healthId: who.kind === 'health_id' ? who.healthId : null } : null
    if (counter) bill.handedOverAt = null
    lines.forEach((line, index) => {
      const workItemId = workItemIds[index]
      if (!workItemId) return
      const item = items[index]
      const dose = /^\s*(\d+(?:\.\d+)?)\s*(.*)$/.exec(line.dose ?? '')
      const stock = pocStock.find(entry => entry.catalogueItemId === item.id)
      pharmacyPaperItems.unshift({ id: workItemId, patientId: null, version: 1, acceptedAt: iso(), medication: { display: [item.name, item.strength].filter(Boolean).join(' ') },
        doseQuantity: dose ? Number(dose[1]) : null, doseUnit: dose ? dose[2] || null : null, routeCode: 'oral', frequency: line.frequency ?? '', instructions: null,
        patient: { fullName: name ?? 'Walk-in customer', sex: null, dateOfBirth: null, healthIdLast4: who.kind === 'health_id' ? who.healthId.slice(-4) : null },
        outside: body.outside ?? null })
      pharmacyBills[workItemId] = { billId: bill.id, status: bill.status, dueKobo: bill.dueKobo, receiptNumber: null }
      if (stock) pharmacyStock[workItemId] = { onHand: stock.onHand, unit: stock.unit }
    })
    pocBills.unshift(bill)
    return [201, { workItemIds, bill }]
  }
  const handOver = /^\/pharmacy\/sales\/([^/]+)\/hand-over$/.exec(path)
  if (handOver) {
    const bill = pocBills.find(entry => entry.id === decodeURIComponent(handOver[1]))
    if (!bill || bill.source !== 'pharmacy') return pocProblem(404, 'COMMERCIAL_BILL_NOT_FOUND', 'No such sale.')
    if (bill.handedOverAt) return [200, { handedOverAt: bill.handedOverAt, bill }]
    if (pocSettings.payBefore.pharmacy && ['unpaid', 'part_paid'].includes(bill.status)) return pocProblem(409, 'PAYMENT_REQUIRED', 'This needs to be paid first.')
    for (const line of bill.lines) {
      const stock = pocStock.find(entry => entry.catalogueItemId === line.catalogueItemId)
      if (stock && stock.onHand < line.quantity) return pocProblem(409, 'OUT_OF_STOCK', 'There isn’t enough in stock.')
    }
    for (const line of bill.lines) {
      const stock = pocStock.find(entry => entry.catalogueItemId === line.catalogueItemId)
      if (!stock) continue
      let left = line.quantity
      for (const batch of [...stock.batches].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))) {
        const take = Math.min(batch.quantity, left)
        batch.quantity -= take
        left -= take
      }
      stock.onHand -= line.quantity
      pocMove(stock.catalogueItemId, -line.quantity, 'dispensed', `Sale ${bill.number}`)
    }
    bill.handedOverAt = iso()
    pocBump(bill)
    return [200, { handedOverAt: bill.handedOverAt, bill }]
  }
  return null
}
/** A time as the facility's day (the preview's local day), as `GET bills?date=` compares it. */
const pocLocalDay = value => { const day = new Date(value); return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}` }

function pointOfCareExtraRoute(method, path, { body, query } = {}) {
  const q = (query?.get?.('q') ?? '').trim().toLowerCase()
  if (path === '/pharmacy/stock' && method === 'GET') {
    const filter = query?.get?.('filter')
    const soon = pocDay(90)
    const items = pocStock.filter(line => (!q || line.name.toLowerCase().includes(q))
      && (filter !== 'low' || line.onHand <= line.reorderLevel) && (filter !== 'expiring' || line.batches.some(batch => batch.expiresOn <= soon)))
    return [200, { items, nextPage: null, total: items.length }]
  }
  const movements = method === 'GET' && /^\/pharmacy\/stock\/([^/]+)\/movements$/.exec(path)
  if (movements) return [200, { items: pocMovements[decodeURIComponent(movements[1])] ?? [], nextPage: null }]
  if (method !== 'POST') return null
  if (path === '/pharmacy/stock/receipts') {
    if (!body) return NO_BODY()
    for (const line of body.lines ?? []) {
      const found = pocStock.find(entry => entry.catalogueItemId === line.catalogueItemId)
      if (!found) continue
      found.onHand += Number(line.quantity) || 0
      found.batches.push({ batchId: `${found.catalogueItemId}-${line.batchNumber}`, batchNumber: line.batchNumber, expiresOn: line.expiresOn, quantity: Number(line.quantity) || 0 })
      pocMove(found.catalogueItemId, Number(line.quantity) || 0, 'received', body.invoiceNumber ? `Invoice ${body.invoiceNumber}` : null)
    }
    return [201, { id: `rcv-${Date.now().toString(36)}`, receivedAt: iso() }]
  }
  if (path === '/pharmacy/stock/adjustments') {
    if (!body) return NO_BODY()
    const found = pocStock.find(entry => entry.catalogueItemId === body.catalogueItemId)
    if (!found) return pocProblem(404, 'PHARMACY_STOCK_ITEM_NOT_FOUND', 'No such item.')
    const batch = found.batches.find(entry => entry.batchId === body.batchId)
    const change = Number(body.change) || 0
    if (batch) batch.quantity = Math.max(0, batch.quantity + change)
    found.onHand = Math.max(0, found.onHand + change)
    pocMove(found.catalogueItemId, change, 'adjusted', body.note ?? body.reason ?? null)
    return [201, found]
  }
  const pharmacyAnswer = pharmacySaleRoute(path, body)
  if (pharmacyAnswer) return pharmacyAnswer
  if (path === '/pharmacy/walk-in-orders' || path === '/lab/walk-in-requests') {
    if (!body) return NO_BODY()
    const lab = path.startsWith('/lab')
    const lines = (lab ? body.tests : body.items) ?? []
    const who = body.patient ?? { kind: 'anonymous' }
    const id = `bill-walkin-${pocWalkInSeq++}`
    const workItemIds = lines.map((_, index) => `${lab ? 'lw' : 'rx'}-walkin-${pocWalkInSeq}-${index + 1}`)
    const bill = pocBill(id, lab ? 'lab' : 'pharmacy', null, lines.map((line, index) => [line.catalogueItemId, lab ? 1 : Number(line.quantity) || 1, workItemIds.at(index)]), { ago: 0 })
    bill.patient = who.kind === 'anonymous' ? null : { patientId: null, displayName: POC_HID_NAMES[who.healthId] ?? who.healthId, healthId: who.kind === 'health_id' ? who.healthId : null }
    pocBills.unshift(bill)
    return [201, { workItemIds, bill }]
  }
  if (/^\/lab\/accessions\/[^/]+\/result-shares$/.test(path)) {
    if (!body) return NO_BODY()
    if (!/^\S+@\S+\.\S+$/.test(body.email ?? '')) return pocProblem(400, 'VALIDATION_FAILED', 'Enter an email address.')
    return [201, { shareId: `share-${Date.now().toString(36)}`, sentTo: body.email, expiresAt: new Date(Date.now() + 14 * 864e5).toISOString() }]
  }
  return null
}

function pointOfCareRoute(method, path, { body, query } = {}) {
  const extra = pointOfCareExtraRoute(method, path, { body, query })
  if (extra) return extra
  if (!path.startsWith('/commercial/') || ['/commercial/subscription', '/commercial/invoices', '/commercial/pricing'].includes(path)) return null
  const q = (query?.get?.('q') ?? '').trim().toLowerCase()
  if (path === '/commercial/payment-settings') {
    if (method === 'GET') return [200, pocSettings]
    if (method !== 'PUT') return null
    if (!body) return NO_BODY()
    Object.assign(pocSettings, body, { version: pocSettings.version + 1 })
    return [200, pocSettings]
  }
  if (path === '/commercial/catalogue-items') {
    if (method === 'GET') {
      const kind = query?.get?.('kind')
      const items = pocCatalogue.filter(entry => (!kind || entry.kind === kind) && (!q || entry.name.toLowerCase().includes(q)))
      return [200, { items, nextPage: null, total: items.length }]
    }
    if (method !== 'POST') return null
    if (!body) return NO_BODY()
    const created = { ...body, id: `cat-${pocCatalogue.length + 1}-${Date.now().toString(36)}`, imageUrl: null, version: 1 }
    pocCatalogue.push(created)
    return [201, created]
  }
  const catalogueItem = /^\/commercial\/catalogue-items\/([^/]+)$/.exec(path)
  if (catalogueItem && method === 'PATCH') {
    const found = pocCatalogue.find(entry => entry.id === decodeURIComponent(catalogueItem[1]))
    if (!found) return pocProblem(404, 'COMMERCIAL_CATALOGUE_ITEM_NOT_FOUND', 'No such item.')
    if (!body) return NO_BODY()
    if (body.expectedVersion !== undefined && body.expectedVersion !== found.version) return pocProblem(409, 'VERSION_CONFLICT', 'The item changed.')
    const { expectedVersion: _version, imageFileId: _image, ...changes } = body
    return [200, pocBump(Object.assign(found, changes))]
  }
  if (path === '/commercial/bills') {
    if (method !== 'GET') return body ? pocProblem(422, 'MOCK_NOT_MODELLED', 'The preview does not make bills; the pharmacy and lab do.') : NO_BODY()
    const status = query?.get?.('status')
    const source = query?.get?.('source')
    const items = pocBills.filter(bill => (!status || bill.status === status || (status === 'open' && ['unpaid', 'part_paid'].includes(bill.status)))
      && (!source || bill.source === source)
      && (!query?.get?.('date') || pocLocalDay(bill.createdAt) === query.get('date'))
      && (!q || [bill.number, bill.receiptNumber ?? '', bill.patient?.displayName ?? '', bill.patient?.healthId ?? ''].some(text => text.toLowerCase().includes(q))))
    return [200, { items, nextPage: null, total: items.length }]
  }
  const billPath = /^\/commercial\/bills\/([^/]+)(\/.*)?$/.exec(path)
  if (billPath) {
    const bill = pocBills.find(entry => entry.id === decodeURIComponent(billPath[1]))
    if (!bill) return pocProblem(404, 'COMMERCIAL_BILL_NOT_FOUND', 'No such bill.')
    const rest = billPath[2] ?? ''
    if (method === 'GET' && rest === '') return [200, bill]
    if (method === 'GET' && rest === '/receipt') {
      if (!bill.receiptNumber) return pocProblem(404, 'COMMERCIAL_RECEIPT_NOT_FOUND', 'Nothing has been paid on this bill yet.')
      return [200, { receiptNumber: bill.receiptNumber, facility: { name: staffFacility().name, address: '12 Broad Street, Lagos Island, Lagos', phone: '+234 803 000 0000' },
        bill, issuedAt: bill.payments.filter(payment => !payment.voided).at(-1)?.receivedAt ?? bill.createdAt, issuedBy: STAFF_NAME, footer: pocSettings.receiptFooter }]
    }
    if (method !== 'POST') return null
    if (!body) return NO_BODY()
    if (rest === '/payments') {
      const amountKobo = Number(body.amountKobo)
      if (!pocSettings.methods.includes(body.method)) return pocProblem(422, 'PAYMENT_METHOD_NOT_ACCEPTED', 'This facility does not take that way of paying.')
      if (!Number.isInteger(amountKobo) || amountKobo <= 0) return pocProblem(400, 'VALIDATION_FAILED', 'The amount must be more than ₦0.00.')
      if (amountKobo > bill.dueKobo) return pocProblem(409, 'OVERPAYMENT', 'That is more than the amount due.')
      bill.payments.push(pocPayment(body.method, amountKobo / 100, { reference: body.reference ?? null, hmoId: body.hmoId ?? null, reason: body.reason ?? null,
        waivedBy: body.method === 'waiver' ? STAFF_NAME : null, receivedAt: iso() }))
      bill.receiptNumber = `R-000${pocReceiptSeq++}`
      settleBill(pocBump(bill), bill.status)
      syncWorkItemBill(bill)
      return [201, bill]
    }
    const paymentPath = /^\/payments\/([^/]+)\/(void|confirm)$/.exec(rest)
    if (paymentPath) {
      const payment = bill.payments.find(entry => entry.id === decodeURIComponent(paymentPath[1]))
      if (!payment) return pocProblem(404, 'COMMERCIAL_PAYMENT_NOT_FOUND', 'No such payment.')
      if (paymentPath[2] === 'confirm') payment.status = 'confirmed'
      else { if (!body.reason) return pocProblem(400, 'VALIDATION_FAILED', 'Say why the payment is cancelled.'); payment.voided = true; payment.reason = body.reason }
      settleBill(pocBump(bill), bill.status === 'paid' || bill.status === 'part_paid' ? undefined : bill.status)
      syncWorkItemBill(bill)
      return [200, bill]
    }
    // A sale made without a Health ID, put on the one given afterwards (pharmacy, after the sale).
    if (rest === '/patient') {
      const healthId = String(body.healthId ?? '').trim().toUpperCase()
      if (!/^HID-[A-Z0-9]{4,}$/.test(healthId)) return pocProblem(400, 'VALIDATION_FAILED', 'Type a Health ID like HID-ADA2345.')
      if (bill.patient?.healthId && bill.patient.healthId !== healthId) return pocProblem(409, 'COMMERCIAL_BILL_HAS_PATIENT', 'This sale is already on another Health ID.')
      bill.patient = { patientId: null, displayName: POC_HID_NAMES[healthId] ?? bill.patient?.displayName ?? healthId, healthId }
      return [200, pocBump(bill)]
    }
    if (rest === '/defer') {
      if (!['emergency', 'inpatient'].includes(body.reason)) return pocProblem(400, 'VALIDATION_FAILED', 'Reason: emergency or inpatient.')
      settleBill(pocBump(bill), 'deferred')
      syncWorkItemBill(bill)
      return [200, bill]
    }
    return null
  }
  if (path === '/commercial/shifts/current' && method === 'GET') {
    const tillId = query?.get?.('tillId') || null
    if ((pocSettings.dayCloseBy ?? 'facility') === 'till' && !tillId) return pocProblem(400, 'VALIDATION_FAILED', 'Say which till.')
    const open = pocOpenShifts.find(pocShiftMatch(tillId))
    return [200, open ? shiftView(open) : null]
  }
  if (path === '/commercial/shifts') {
    if (method === 'GET') {
      const status = query?.get?.('status')
      const date = query?.get?.('date')
      const open = pocOpenShifts.map(shiftView)
      const items = status === 'open' ? open
        : [...pocClosedShifts, ...open].filter(shift => !date || shift.openedAt.slice(0, 10) === date || (shift.closedAt ?? '').slice(0, 10) === date)
      return [200, { items, nextPage: null }]
    }
    if (!body) return NO_BODY()
    const by = pocSettings.dayCloseBy ?? 'facility'
    const till = by === 'till' ? (pocSettings.tills ?? []).find(entry => entry.id === body.tillId) : null
    if (by === 'till' && !till) return pocProblem(400, 'VALIDATION_FAILED', 'Pick one of this facility’s tills.')
    if (pocOpenShifts.some(pocShiftMatch(till?.id ?? null))) return pocProblem(409, 'SHIFT_ALREADY_OPEN', 'This day is already open.')
    const opened = { id: `shift-${pocShiftSeq++}`, scope: by, tillId: till?.id ?? null, tillName: till?.name ?? null,
      cashierName: by === 'cashier' || by === 'till' ? STAFF_NAME : null, openedBy: STAFF_NAME, openedAt: iso(), closedAt: null,
      openingCashKobo: Number(body.openingCashKobo) || 0 }
    pocOpenShifts.push(opened)
    return [201, shiftView(opened)]
  }
  const close = method === 'POST' && /^\/commercial\/shifts\/([^/]+)\/close$/.exec(path)
  if (close) {
    const index = pocOpenShifts.findIndex(shift => shift.id === decodeURIComponent(close[1]))
    if (index < 0) return pocProblem(404, 'COMMERCIAL_SHIFT_NOT_FOUND', 'That day is not open.')
    if (!body) return NO_BODY()
    const counted = Number(body.countedCashKobo)
    const view = shiftView(pocOpenShifts[index])
    const done = { ...view, closedAt: iso(), countedCashKobo: counted, differenceKobo: counted - view.expectedCashKobo, note: body.note ?? null }
    pocClosedShifts.push(done)
    pocOpenShifts.splice(index, 1)
    return [200, done]
  }
  return null
}

// ------------------------------------------------------------------- lab --
// The lab's work (today's Lab routes, plus docs/POINT_OF_CARE_SPEC.md §4 and §6, proposed): requests at every stage, so
// the work list, a request's steps (collect, receive, test, result, check and release) and Results can be tried end to
// end. Walk-ins carry only the basics (name, age, sex, phone) and a Health ID when they have one. Kept in this process's
// memory for the session; a write needs its JSON body (the in-page preview passes it).
let labSeq = 130
const labWork = []
const labAccessions = new Map()
const labExecutionsById = new Map()
const labTestCode = name => ({ codeSystem: 'LOCAL', code: name.replace(/[^A-Za-z]/g, '').slice(0, 6).toUpperCase(), name })
function labAccession(workItemId, specimenType, status) {
  const id = `acc-${labSeq}`
  const accession = { id, accessionNumber: `ACC-2026-000${labSeq}`, workItemId, status: 'open',
    specimens: [{ id: `spc-${labSeq}`, accessionId: id, specimenIdentifier: `SPC-000${labSeq}`, specimenType, status, version: 1 }] }
  labSeq += 1
  labAccessions.set(id, accession)
  labWork.find(work => work.id === workItemId).accessionId = id
  return accession
}
function labExecution(specimen, status, result = null) {
  const work = labWork.find(entry => entry.accessionId === specimen.accessionId)
  const id = `exe-${labSeq++}`
  const execution = { id, accessionId: specimen.accessionId, specimenId: specimen.id, requestedTestId: `rt-${work.id}`, test: labTestCode(work.testName),
    patientId: work.patientId, facilityId: DEMO_FACILITY_ID, status, method: 'Analyser', startedAt: iso(-30 * MIN), completedAt: status === 'completed' ? iso(-10 * MIN) : null,
    version: status === 'completed' ? 2 : 1, result: null }
  if (result) execution.result = labResult(execution, result)
  labExecutionsById.set(id, execution)
  return execution
}
function labRevision(version, value) {
  return { version, resultType: value.resultType, numericValue: value.resultType === 'numeric' ? Number(value.numericValue) : null,
    textValue: value.resultType === 'text' ? value.textValue : null, unit: value.unit ?? null, referenceRange: value.referenceRange ?? null,
    abnormalFlag: value.abnormalFlag ?? 'unknown', entrySource: 'manual', verificationStatus: 'unverified', releaseStatus: 'not_released',
    enteredAt: iso(), releasedAt: null, correctionReason: value.reason ?? null }
}
function labResult(execution, value) {
  return { id: `res-${labSeq++}`, executionId: execution.id, status: 'entered_unverified', verificationStatus: 'unverified', currentVersion: 1,
    currentReleasedVersion: null, revisions: [labRevision(1, value)] }
}
const labRelease = result => {
  const revision = result.revisions.find(entry => entry.version === result.currentVersion)
  Object.assign(revision, { verificationStatus: 'verified', releaseStatus: 'released', releasedAt: iso(-5 * MIN) })
  Object.assign(result, { status: 'released', verificationStatus: 'verified', currentReleasedVersion: result.currentVersion })
}
const labPaid = n => ({ billId: `bill-lab-paid-${n}`, status: 'paid', dueKobo: 0, receiptNumber: `R-000${370 + n}` })
const labBasics = (name, ageYears, sex, phone, healthId = null) => ({ name, ageYears, sex, phone, healthId, clinicalNote: null })
// This facility's own EHR orders (lw-1, lw-2) and walk-ins at every stage.
labWork.push(
  { id: 'lw-1', patientId: DEMO_PATIENT_ID, testName: 'Full blood count', acceptedAt: iso(-40 * MIN), priority: 'routine',
    patient: { fullName: 'Adaeze Okafor', sex: 'female', dateOfBirth: '1991-03-04', healthIdLast4: 'AAA2' } },
  { id: 'lw-2', patientId: DEMO_PATIENT_ID, testName: 'Malaria parasite test', acceptedAt: iso(-15 * MIN), priority: 'urgent',
    patient: { fullName: 'Adaeze Okafor', sex: 'female', dateOfBirth: '1991-03-04', healthIdLast4: 'AAA2' } },
  { id: 'lw-3', patientId: null, testName: 'Fasting blood sugar', acceptedAt: iso(-8 * MIN), priority: 'routine', request: { id: 'lr-3', number: 'LR-000121' },
    walkIn: { ...labBasics('Halima Yusuf', 52, 'female', '+2348035550101', 'HID-HALI9043'), clinicalNote: 'Thirst and tiredness. Rule out diabetes.' },
    outside: { prescriberName: 'Dr Funmi Adeyemi', facilityName: 'Grace Family Clinic', writtenOn: iso(-1 * DAY).slice(0, 10), prescriberEmail: 'f.adeyemi@graceclinic.example', prescriberPhone: '+2348021112233', photoFileId: null } },
  { id: 'lw-4', patientId: null, testName: 'Urinalysis', acceptedAt: iso(-55 * MIN), priority: 'routine', request: { id: 'lr-4', number: 'LR-000117' },
    walkIn: labBasics('Chinedu Eze', 28, 'male', '+2348091234500'), bill: labPaid(1) },
  { id: 'lw-5', patientId: null, testName: 'Malaria parasite test', acceptedAt: iso(-70 * MIN), priority: 'urgent', request: { id: 'lr-5', number: 'LR-000115' },
    walkIn: labBasics('Musa Ibrahim', 9, 'male', '+2348067778899'), bill: labPaid(2) },
  { id: 'lw-6', patientId: null, testName: 'Full blood count', acceptedAt: iso(-95 * MIN), priority: 'routine', request: { id: 'lr-6', number: 'LR-000112' },
    walkIn: labBasics('Ngozi Eze', 41, 'female', '+2348023456789', 'HID-NGOZ7710'), bill: labPaid(3) },
  { id: 'lw-7', patientId: null, testName: 'Fasting blood sugar', acceptedAt: iso(-2 * 60 * MIN), priority: 'routine', request: { id: 'lr-7', number: 'LR-000109' },
    walkIn: labBasics('Funke Adebayo', 33, 'female', '+2348031112222'), bill: labPaid(4) },
  { id: 'lw-8', patientId: null, testName: 'Malaria parasite test', acceptedAt: iso(-3 * 60 * MIN), priority: 'routine', request: { id: 'lr-8', number: 'LR-000104' },
    walkIn: labBasics('Emeka Nwosu', 60, 'male', '+2348057654321', 'HID-EMEK6618'), bill: labPaid(5),
    outside: { prescriberName: 'Dr Bello Sani', facilityName: 'Unity Clinic, Yaba', writtenOn: null, prescriberEmail: 'b.sani@unityclinic.example', prescriberPhone: null, photoFileId: null } },
)
labAccession('lw-4', 'Urine, clean catch', 'collected')
labExecution(labAccession('lw-5', 'Blood film', 'received').specimens[0], 'in_progress')
labExecution(labAccession('lw-6', 'Blood, EDTA tube', 'received').specimens[0], 'completed')
labExecution(labAccession('lw-7', 'Blood, fluoride tube', 'received').specimens[0], 'completed',
  { resultType: 'numeric', numericValue: 6.8, unit: 'mmol/L', referenceRange: '3.9-5.5', abnormalFlag: 'high' })
labRelease(labExecution(labAccession('lw-8', 'Blood film', 'received').specimens[0], 'completed',
  { resultType: 'text', textValue: 'No malaria parasites seen', referenceRange: 'Not seen', abnormalFlag: 'normal' }).result)

/** A work item as GET /lab/work-items sends it, with the proposed fields: its bill, stage facts and the walk-in's basics. */
function labWorkView(work) {
  const accession = work.accessionId ? labAccessions.get(work.accessionId) : null
  const executions = [...labExecutionsById.values()].filter(execution => execution.accessionId === work.accessionId)
  const bill = pocBills.find(entry => entry.lines.some(line => line.workItemId === work.id))
  const released = executions.flatMap(execution => execution.result?.revisions.filter(revision => revision.releasedAt).map(revision => revision.releasedAt) ?? []).sort().at(-1) ?? null
  const { bill: fixedBill, ...rest } = work
  return { ...rest, version: 1, status: 'accepted', accessionNumber: accession?.accessionNumber ?? null,
    specimenStatuses: accession?.specimens.map(specimen => specimen.status) ?? [], executionStatuses: executions.map(execution => execution.status),
    resultStatuses: executions.flatMap(execution => execution.result ? [execution.result.status] : []), releasedAt: released,
    walkIn: work.walkIn ? { ...work.walkIn, healthId: work.walkIn.healthId ?? bill?.patient?.healthId ?? null } : undefined,
    bill: bill ? { billId: bill.id, status: bill.status, dueKobo: bill.dueKobo, receiptNumber: bill.receiptNumber } : fixedBill ?? null }
}
const labVersionConflict = () => pocProblem(409, 'LAB_VERSION_CONFLICT', 'This changed since it was read. Refresh and try again.')

function labRoute(method, path, { body } = {}) {
  if (!path.startsWith('/lab/')) return null
  if (method === 'GET' && path === '/lab/work-items') return [200, { items: labWork.map(labWorkView) }]
  const workItem = /^\/lab\/work-items\/([^/]+)(\/accession)?$/.exec(path)
  if (workItem) {
    const work = labWork.find(entry => entry.id === decodeURIComponent(workItem[1]))
    if (!work) return pocProblem(404, 'LAB_WORK_ITEM_NOT_FOUND', 'No such lab work.')
    if (method === 'GET' && !workItem[2]) return [200, labWorkView(work)]
    if (method !== 'POST' || !workItem[2]) return null
    if (!body) return NO_BODY()
    if (work.accessionId) return pocProblem(409, 'LAB_ACCESSION_EXISTS', 'This work already has an accession.')
    const type = String(body.requirements?.[0]?.specimenType ?? '').trim()
    if (!type || !String(body.reason ?? '').trim()) return pocProblem(400, 'VALIDATION_FAILED', 'Enter the sample type and the reason.')
    return [201, labAccession(work.id, type, 'required')]
  }
  const accessionPath = /^\/lab\/accessions\/([^/]+)(\/.*)?$/.exec(path)
  if (accessionPath) {
    const accession = labAccessions.get(decodeURIComponent(accessionPath[1]))
    if (!accession) return pocProblem(404, 'LAB_ACCESSION_NOT_FOUND', 'No such accession.')
    const rest = accessionPath[2] ?? ''
    if (method === 'GET' && rest === '') return [200, accession]
    if (method === 'GET' && rest === '/specimens') return [200, { items: accession.specimens }]
    if (method !== 'POST') return null
    if (!body) return NO_BODY()
    if (rest === '/result-shares') {
      const channel = body.channel ?? (body.email ? 'email' : null)
      const to = String(body.to ?? body.email ?? '').trim()
      if (channel === 'email' && !/^\S+@\S+\.\S+$/.test(to)) return pocProblem(400, 'VALIDATION_FAILED', 'Enter an email address.')
      if (channel === 'sms' && !/^\+\d{10,15}$/.test(to)) return pocProblem(400, 'VALIDATION_FAILED', 'Enter a phone number.')
      if (channel !== 'email' && channel !== 'sms') return pocProblem(400, 'VALIDATION_FAILED', 'Send by email or SMS.')
      return [201, { shareId: `share-${Date.now().toString(36)}`, sentTo: to, expiresAt: new Date(Date.now() + 14 * DAY).toISOString() }]
    }
    const step = /^\/specimens\/([^/]+)\/(collect|receive|reject)$/.exec(rest)
    if (!step) return null
    const specimen = accession.specimens.find(entry => entry.id === decodeURIComponent(step[1]))
    if (!specimen) return pocProblem(404, 'LAB_SPECIMEN_NOT_FOUND', 'No such sample.')
    if (body.expectedVersion !== undefined && body.expectedVersion !== specimen.version) return labVersionConflict()
    const action = step[2]
    const from = { collect: ['required'], receive: ['collected'], reject: ['required', 'collected'] }[action]
    if (!from.includes(specimen.status)) return pocProblem(409, 'LAB_SPECIMEN_STATE_CONFLICT', 'The sample is not at that step.')
    if (action === 'collect') {
      const view = labWorkView(labWork.find(work => work.id === accession.workItemId))
      if (pocSettings.payBefore.lab && ['unpaid', 'part_paid'].includes(view.bill?.status)) return pocProblem(409, 'PAYMENT_REQUIRED', 'This needs to be paid first.')
    }
    if (action === 'reject' && !String(body.reason ?? '').trim()) return pocProblem(400, 'VALIDATION_FAILED', 'Say why the sample is rejected.')
    Object.assign(specimen, { status: { collect: 'collected', receive: 'received', reject: 'rejected' }[action], version: specimen.version + 1 })
    return [200, specimen]
  }
  const specimenRuns = /^\/lab\/specimens\/([^/]+)\/executions$/.exec(path)
  if (specimenRuns) {
    const id = decodeURIComponent(specimenRuns[1])
    const specimen = [...labAccessions.values()].flatMap(accession => accession.specimens).find(entry => entry.id === id)
    if (!specimen) return pocProblem(404, 'LAB_SPECIMEN_NOT_FOUND', 'No such sample.')
    if (method === 'GET') return [200, { items: [...labExecutionsById.values()].filter(execution => execution.specimenId === id) }]
    if (method !== 'POST') return null
    if (!body) return NO_BODY()
    if (specimen.status !== 'received') return pocProblem(409, 'LAB_SPECIMEN_STATE_CONFLICT', 'Receive the sample first.')
    if (body.expectedSpecimenVersion !== undefined && body.expectedSpecimenVersion !== specimen.version) return labVersionConflict()
    const execution = labExecution(specimen, 'in_progress')
    Object.assign(execution, { startedAt: iso(), method: body.method ?? null })
    return [201, execution]
  }
  const run = /^\/lab\/executions\/([^/]+)(\/complete|\/results|\/results\/([^/]+)\/corrections)?$/.exec(path)
  if (run) {
    const execution = labExecutionsById.get(decodeURIComponent(run[1]))
    if (!execution) return pocProblem(404, 'LAB_EXECUTION_NOT_FOUND', 'No such test.')
    if (method === 'GET' && !run[2]) return [200, execution]
    if (method !== 'POST' || !run[2]) return null
    if (!body) return NO_BODY()
    if (run[2] === '/complete') {
      if (execution.status !== 'in_progress') return pocProblem(409, 'LAB_EXECUTION_STATE_CONFLICT', 'The test is not running.')
      if (body.expectedVersion !== undefined && body.expectedVersion !== execution.version) return labVersionConflict()
      Object.assign(execution, { status: 'completed', completedAt: iso(), version: execution.version + 1 })
      return [200, execution]
    }
    if (body.resultType === 'numeric' && !body.unit) return pocProblem(400, 'VALIDATION_FAILED', 'A number needs its unit.')
    if (run[2] === '/results') {
      if (execution.status !== 'completed' || execution.result) return pocProblem(409, 'LAB_RESULT_STATE_CONFLICT', 'This test already has a result.')
      execution.result = labResult(execution, body)
      return [201, execution.result]
    }
    const result = execution.result
    if (!result || result.id !== decodeURIComponent(run[3])) return pocProblem(404, 'LAB_RESULT_NOT_FOUND', 'No such result.')
    if (body.expectedResultVersion !== undefined && body.expectedResultVersion !== result.currentVersion) return labVersionConflict()
    const version = result.currentVersion + 1
    result.revisions.push(labRevision(version, body))
    Object.assign(result, { currentVersion: version, status: 'entered_unverified', verificationStatus: 'unverified' })
    return [201, result]
  }
  const decision = /^\/lab\/results\/([^/]+)\/(verify|release|history)$/.exec(path)
  if (decision) {
    const result = [...labExecutionsById.values()].map(execution => execution.result).find(entry => entry?.id === decodeURIComponent(decision[1]))
    if (!result) return pocProblem(404, 'LAB_RESULT_NOT_FOUND', 'No such result.')
    if (decision[2] === 'history') return method === 'GET' ? [200, result] : null
    if (method !== 'POST') return null
    if (!body) return NO_BODY()
    if (body.expectedResultVersion !== undefined && body.expectedResultVersion !== result.currentVersion) return labVersionConflict()
    const revision = result.revisions.find(entry => entry.version === result.currentVersion)
    if (decision[2] === 'verify') {
      if (result.status !== 'entered_unverified') return pocProblem(409, 'LAB_RESULT_STATE_CONFLICT', 'This result is not waiting to be checked.')
      Object.assign(revision, { verificationStatus: 'verified', releaseStatus: 'verified_not_released' })
      Object.assign(result, { status: 'verified_not_released', verificationStatus: 'verified' })
      return [200, result]
    }
    if (result.status !== 'verified_not_released') return pocProblem(409, 'LAB_RESULT_STATE_CONFLICT', 'Check the result before it is released.')
    Object.assign(revision, { releaseStatus: 'released', releasedAt: iso() })
    Object.assign(result, { status: 'released', currentReleasedVersion: result.currentVersion })
    return [200, result]
  }
  if (method === 'POST' && path === '/lab/walk-in-requests') {
    if (!body) return NO_BODY()
    const who = body.patient ?? {}
    const tests = body.tests ?? []
    if (!String(who.name ?? '').trim() || !Number.isInteger(who.ageYears) || !['female', 'male'].includes(who.sex) || !/^\+\d{10,15}$/.test(who.phone ?? '')) {
      return pocProblem(400, 'VALIDATION_FAILED', 'Enter their name, age, sex and phone.')
    }
    if (tests.length === 0) return pocProblem(400, 'VALIDATION_FAILED', 'Add at least one test.')
    const items = tests.map(test => pocCatalogue.find(entry => entry.id === test.catalogueItemId && entry.kind === 'lab_test'))
    if (items.some(item => !item)) return pocProblem(404, 'COMMERCIAL_CATALOGUE_ITEM_NOT_FOUND', 'A test is no longer on the price list.')
    const seq = labSeq++
    const request = { id: `lr-${seq}`, number: `LR-000${seq}` }
    const workItemIds = items.map((_, index) => `lw-walkin-${seq}-${index + 1}`)
    items.forEach((item, index) => labWork.unshift({ id: workItemIds[index], patientId: null, testName: item.name, acceptedAt: iso(), priority: body.priority === 'urgent' ? 'urgent' : 'routine',
      request, walkIn: { name: who.name.trim(), ageYears: who.ageYears, sex: who.sex, phone: who.phone, healthId: who.healthId ?? null, clinicalNote: body.clinicalNote ?? null },
      outside: body.outside ?? null }))
    const bill = pocBill(`bill-${request.id}`, 'lab', null, items.map((item, index) => [item.id, 1, workItemIds[index]]), { ago: 0 })
    bill.patient = { patientId: null, displayName: who.name.trim(), healthId: who.healthId ?? null }
    pocBills.unshift(bill)
    return [201, { workItemIds, bill, request }]
  }
  return null
}


// ------------------------------------------------- signed-out flows (dev) --
// Sign-up, recovery, sign-in second steps and invitations, so every step of the signed-out screens can be walked in
// the preview. Any code is accepted; a code of 000000 is refused. Sample answers only.
const flow = { patient: null, provider: null, invitation: null }
const challenge = (id) => ({ challengeId: id, expiresInSeconds: 600, resendAfterSeconds: 30 })
const badCode = body => body?.code === '000000'
const otpProblem = () => pocProblem(400, 'OTP_INVALID_OR_EXPIRED', 'That code is wrong or has expired. Check it and try again.')
const patientProgress = () => ({ ...flow.patient, expiresAt: iso(24 * 60 * MIN) })
const MFA = { secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/Health%20ID:demo?secret=JBSWY3DPEHPK3PXP&issuer=Health%20ID', algorithm: 'SHA1', digits: 6, periodSeconds: 30 }
const RECOVERY_CODES = ['A1B2-C3D4', 'E5F6-G7H8', 'J9K1-L2M3', 'N4P5-Q6R7', 'S8T9-U1V2', 'W3X4-Y5Z6', 'B7C8-D9E1', 'F2G3-H4J5']

function signedOutRoute(method, path, workspace, { body } = {}) {
  const enrolment = options.enrol === 'open' ? { open: true } : options.enrol === 'closed' ? { open: false, reason: 'closed' } : null
  // Patient sign-up and recovery.
  if (path === '/identity/patient-enrollments/availability') return enrolment ? [200, { ...enrolment, online: true, facility: true, signup: options.signup }]
    : pocProblem(503, 'UPSTREAM_UNAVAILABLE', 'Unavailable.')
  if (path === '/identity/patient-enrollments/current' && method === 'GET') return flow.patient ? [200, patientProgress()]
    : pocProblem(404, 'ENROLLMENT_NOT_FOUND', 'No registration in progress.')
  if (path === '/auth/google/onboarding') return pocProblem(404, 'GOOGLE_ONBOARDING_NOT_FOUND', 'None.')
  if (method === 'POST' && path === '/auth/patient/login') return [200, patientSession()]
  if (path === '/identity/patient-enrollments/participating-facilities') return [200, { facilities: [
    { name: 'Lagos General Hospital', addressLine: '1 Hospital Road', town: 'Ikeja', lga: 'Ikeja', state: 'Lagos', hours: 'Mon–Fri, 8am–4pm' },
    { name: 'Reddington Clinic', addressLine: '12 Idowu Martins St', town: 'Victoria Island', lga: 'Eti-Osa', state: 'Lagos' },
  ], whatToBring: ['Your phone, with the registration open', 'One original photo ID: NIN slip, passport, driver’s licence or voter’s card'] }]
  if (method === 'POST' && path === '/identity/patient-enrollments') {
    flow.patient = { stage: 'verify_holder', recordName: 'ADAEZE OKAFOR', online: { available: true }, facility: { available: true, deskCode: null } }
    return [201, patientProgress()]
  }
  if (method === 'POST' && path === '/identity/patient-enrollments/signup') {
    flow.patient = { stage: 'verify_contact', contactChannel: 'email', maskedContact: `${String(body?.email ?? 'you@example.com').replace(/^(.).*@/, '$1•••@')}`, ...challenge('signup-1') }
    return [201, patientProgress()]
  }
  if (method === 'POST' && path === '/identity/patient-enrollments/holder') return [200, challenge('holder-1')]
  if (method === 'POST' && path === '/identity/patient-enrollments/facility-code') {
    flow.patient = { ...flow.patient, facility: { available: true, deskCode: '482 913', deskCodeExpiresAt: iso(30 * MIN) } }
    return [200, patientProgress()]
  }
  if (method === 'POST' && path === '/identity/patient-enrollments/holder/verify') {
    if (badCode(body)) return otpProblem()
    flow.patient = { stage: 'verify_contact' }
    return [200, { stage: 'verify_contact' }]
  }
  if (method === 'POST' && path === '/identity/patient-enrollments/contact') {
    flow.patient = { stage: 'verify_contact', contactChannel: body?.channel ?? 'phone', maskedContact: body?.channel === 'email' ? 'a•••@example.com' : '+234•••••567', ...challenge('contact-1') }
    return [200, challenge('contact-1')]
  }
  if (method === 'POST' && path === '/identity/patient-enrollments/contact/verify') {
    if (badCode(body)) return otpProblem()
    flow.patient = { stage: 'set_password' }
    return [200, { stage: 'set_password' }]
  }
  if (method === 'POST' && path === '/identity/patient-enrollments/activate') {
    flow.patient = null
    return [200, { stage: 'active', hidCode: 'HID-KEM4821', signedIn: false }]
  }
  if (method === 'POST' && path === '/auth/otp/start') return [200, { accepted: true, ...challenge('reset-1') }]
  if (method === 'POST' && path === '/auth/otp/verify') return badCode(body) ? otpProblem() : [200, { verified: true, challengeId: 'reset-1', verificationToken: 'reset-token' }]
  if (method === 'POST' && path === '/auth/otp/complete') return [200, { completed: true }]
  // Provider sign-in: a password answers the authenticator step (an email with "new" sets one up first).
  if (method === 'POST' && path === '/auth/login' && workspace === 'provider') {
    return [200, { status: /new/i.test(String(body?.email ?? '')) ? 'mfa_enrollment_required' : 'mfa_required', expiresAt: iso(10 * MIN) }]
  }
  if (method === 'POST' && path === '/auth/mfa/verify') return badCode(body) ? pocProblem(401, 'MFA_CODE_INVALID', 'That code didn’t work. Try again.') : [200, staffSession()]
  if (method === 'POST' && path === '/auth/mfa/enroll/email-code') return [200, { accepted: true, channel: 'email', expiresAt: iso(10 * MIN) }]
  if (method === 'POST' && path === '/auth/mfa/enroll/start') return [200, { ...MFA, expiresAt: iso(10 * MIN) }]
  if (method === 'POST' && path === '/auth/mfa/enroll/activate') return [200, { ...staffSession(), recoveryCodes: RECOVERY_CODES }]
  // Platform sign-in: the same two steps.
  if (method === 'POST' && path === '/auth/admin/login') {
    return [200, { status: /new/i.test(String(body?.email ?? '')) ? 'mfa_enrollment_required' : 'mfa_required', expiresAt: iso(10 * MIN) }]
  }
  if (method === 'POST' && path === '/auth/admin/mfa/verify') return [200, adminGrant()]
  if (method === 'POST' && path === '/auth/admin/mfa/enroll/start') return [200, { ...MFA, expiresAt: iso(10 * MIN) }]
  if (method === 'POST' && path === '/auth/admin/mfa/enroll/activate') return [200, { ...adminGrant(), recoveryCodes: RECOVERY_CODES }]
  // Facility sign-up.
  if (path === '/identity/provider-enrollments/availability') return enrolment ? [200, { ...enrolment, crossFacilityOrders: true }]
    : [200, { open: false, reason: 'unavailable' }]
  if (method === 'POST' && path === '/identity/provider-enrollments') {
    flow.provider = { cac: body?.registrationNumber ?? 'RC123456', name: body?.administratorName ?? 'Ada Bello', email: body?.administratorEmail ?? 'ada@example.test', type: body?.organizationType ?? 'hospital', product: body?.productCode ?? 'ehr' }
    return [201, { accepted: true, codeSent: true, ...challenge('provider-1') }]
  }
  if (method === 'POST' && path === '/identity/provider-enrollments/verify') return badCode(body) ? otpProblem() : [200, { verified: true }]
  if (path === '/identity/provider-enrollments/profile') return [200, { organizationName: 'KEMSHEN HEALTHCARE LIMITED', registrationNumber: flow.provider?.cac ?? 'RC123456',
    productCode: flow.provider?.product ?? 'ehr', organizationType: flow.provider?.type ?? 'hospital', administratorName: flow.provider?.name ?? 'Ada Bello', administratorEmail: flow.provider?.email ?? 'ada@example.test' }]
  if (method === 'POST' && path === '/identity/provider-enrollments/activate') {
    return [200, { activated: true, organizationId: 'org-new', facilityId: DEMO_FACILITY_ID, accountId: 'acct-new', status: 'mfa_enrollment_required', expiresAt: iso(10 * MIN) }]
  }
  if (path === '/identity/clinician-applications/availability') return [200, { open: true }]
  // Staff invitations (Novu).
  if (method === 'POST' && path === '/identity/staff-invitations/open') {
    flow.invitation = { invitationId: 'inv-1', facilityName: 'Demo Hospital', roleCode: 'nurse', inviterName: 'Dr Tunde Bello', inviteeName: 'Ngozi Eze',
      email: body?.email ?? 'ngozi@demohospital.example', expiresAt: iso(6 * DAY), accountCase: 'new', linkRequired: false }
    return [200, flow.invitation]
  }
  if (method === 'POST' && path === '/identity/staff-invitations/accept') return [200, { facilityName: 'Demo Hospital', roleCode: flow.invitation?.roleCode ?? 'nurse' }]
  return null
}

export function respond(method, path, workspace, request = {}) {
  const csrfCookie = { 'Set-Cookie': `hid_access_csrf=${CSRF}; Path=/; SameSite=Lax` }
  if (path === '/auth/session' && method === 'GET') return { status: 200, body: workspace === 'provider' ? staffSession() : patientSession(), headers: csrfCookie }
  if (path === '/auth/refresh' && method === 'POST') return { status: 200, body: workspace === 'provider' ? staffSession() : patientSession(), headers: csrfCookie }
  if (path === '/auth/logout' && method === 'POST') return { status: 204, body: null, headers: {} }
  if (path === '/admin/session' && method === 'GET') {
    return { status: 200, body: { actor: ADMIN_ACTOR }, headers: { 'Set-Cookie': `hid_access_admin_csrf=${CSRF}; Path=/; SameSite=Lax` } }
  }
  const signedOut = signedOutRoute(method, path, workspace, request)
  if (signedOut) return { status: signedOut[0], body: signedOut[1], headers: {} }
  const handler = workspace === 'admin' ? adminRoute : workspace === 'provider' ? staffRoute : patientRoute
  // Point of care (proposed routes) for the provider workspace, with the request's body and query when the caller has them.
  const hit = (workspace === 'provider' ? registrationRoute(method, path, request) ?? labRoute(method, path, request) ?? pointOfCareRoute(method, path, request) : null) ?? handler(method, path)
  return hit ? { status: hit[0], body: hit[1], headers: {} } : null
}

export function notServed(method, path) {
  return { type: 'about:blank', title: 'NOT_FOUND', status: 404, code: 'NOT_FOUND', detail: `Mock gateway does not serve ${method} ${path}` }
}
