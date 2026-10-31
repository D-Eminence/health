/**
 * The mock gateway's answers, shared by the Node server (server.mjs) and the
 * in-page preview shim (browser-shim.mjs). Sample data only. UI work only.
 */
export const CSRF = 'mock-csrf'
const options = { facility: 'blue' }
/** `facility`: 'blue' (Demo Hospital, blue EHR) or 'classic'. */
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
  'billing.shift.manage', 'pharmacy.walk-in.create', 'pharmacy.stock.read', 'pharmacy.stock.manage', 'lab.walk-in.create',
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
const pharmacyItems = () => [
  { id: 'rx-1', patientId: DEMO_PATIENT_ID, version: 1, acceptedAt: iso(-25 * MIN), medication: { display: 'Amoxicillin 500 mg capsules' }, doseQuantity: 1, doseUnit: 'capsule', routeCode: 'oral', frequency: 'three times daily', instructions: 'For 7 days. Finish the course.' },
  { id: 'rx-2', patientId: 'a0000000-0000-4000-8000-000000000002', version: 1, acceptedAt: iso(-18 * MIN), medication: { display: 'Paracetamol 120 mg/5 ml syrup' }, doseQuantity: 5, doseUnit: 'ml', routeCode: 'oral', frequency: 'every 6 hours when needed', instructions: 'For fever. No more than 4 doses in 24 hours.' },
  { id: 'rx-3', patientId: 'a0000000-0000-4000-8000-000000000003', version: 1, acceptedAt: iso(-12 * MIN), medication: { display: 'Salbutamol 100 mcg inhaler' }, doseQuantity: 2, doseUnit: 'puffs', routeCode: 'inhaled', frequency: 'when needed for wheeze', instructions: null },
  { id: 'rx-4', patientId: DEMO_PATIENT_ID, version: 1, acceptedAt: iso(-9 * MIN), medication: { display: 'Ceftriaxone 1 g injection' }, doseQuantity: 1, doseUnit: 'g', routeCode: 'iv', frequency: 'once daily', instructions: 'For 5 days on the ward.' },
  { id: 'rx-5', patientId: 'a0000000-0000-4000-8000-000000000004', version: 1, acceptedAt: iso(-6 * MIN), medication: { display: 'Metformin 500 mg tablets' }, doseQuantity: null, doseUnit: null, routeCode: 'oral', frequency: '', instructions: null },
  { id: 'rx-6', patientId: 'a0000000-0000-4000-8000-000000000005', version: 2, acceptedAt: iso(-2 * 60 * MIN), medication: { display: 'Hydrocortisone 1% cream' }, doseQuantity: 1, doseUnit: 'thin layer', routeCode: 'topical', frequency: 'twice daily', instructions: 'To the rash only.' },
  { id: 'rx-7', patientId: 'a0000000-0000-4000-8000-000000000006', version: 1, acceptedAt: iso(-3 * MIN), medication: { display: 'Artemether/Lumefantrine 80/480 mg' }, doseQuantity: 1, doseUnit: 'tablet', routeCode: 'oral', frequency: 'twice daily', instructions: 'With food, for 3 days.' },
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
  receiptFooter: 'Thank you. Keep this receipt: the pharmacy or lab will ask for it.', version: 3,
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
let pocShift = { id: 'shift-1', openedBy: STAFF_NAME, openedAt: new Date(new Date().setHours(8, 0, 0, 0)).toISOString(), closedAt: null, openingCashKobo: pocKobo(20000) }
const pocClosedShifts = []

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
  const workItemId = bill.lines.find(line => line.workItemId)?.workItemId
  if (workItemId && typeof pharmacyBills !== 'undefined' && pharmacyBills[workItemId]) {
    pharmacyBills[workItemId] = { billId: bill.id, status: bill.status, dueKobo: bill.dueKobo, receiptNumber: bill.receiptNumber }
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
  if (path === '/pharmacy/walk-in-orders' || path === '/lab/walk-in-requests') {
    if (!body) return NO_BODY()
    const lab = path.startsWith('/lab')
    const lines = (lab ? body.tests : body.items) ?? []
    const who = body.patient ?? { kind: 'anonymous' }
    const id = `bill-walkin-${pocWalkInSeq++}`
    const workItemIds = lines.map((_, index) => `${lab ? 'lw' : 'rx'}-walkin-${pocWalkInSeq}-${index + 1}`)
    const bill = pocBill(id, lab ? 'lab' : 'pharmacy', null, lines.map((line, index) => [line.catalogueItemId, lab ? 1 : Number(line.quantity) || 1, workItemIds.at(index)]), { ago: 0 })
    bill.patient = who.kind === 'anonymous' ? null : { patientId: null, displayName: who.kind === 'quick' ? who.name : who.healthId, healthId: who.kind === 'health_id' ? who.healthId : null }
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
    if (rest === '/defer') {
      if (!['emergency', 'inpatient'].includes(body.reason)) return pocProblem(400, 'VALIDATION_FAILED', 'Reason: emergency or inpatient.')
      settleBill(pocBump(bill), 'deferred')
      syncWorkItemBill(bill)
      return [200, bill]
    }
    return null
  }
  if (path === '/commercial/shifts/current' && method === 'GET') return [200, pocShift ? shiftView(pocShift) : null]
  if (path === '/commercial/shifts') {
    if (method === 'GET') return [200, { items: [...pocClosedShifts, ...(pocShift ? [shiftView(pocShift)] : [])], nextPage: null }]
    if (!body) return NO_BODY()
    if (pocShift) return pocProblem(409, 'SHIFT_ALREADY_OPEN', 'The day is already open.')
    pocShift = { id: `shift-${pocClosedShifts.length + 2}`, openedBy: STAFF_NAME, openedAt: iso(), closedAt: null, openingCashKobo: Number(body.openingCashKobo) || 0 }
    return [201, shiftView(pocShift)]
  }
  const close = method === 'POST' && /^\/commercial\/shifts\/([^/]+)\/close$/.exec(path)
  if (close) {
    if (!pocShift || pocShift.id !== decodeURIComponent(close[1])) return pocProblem(404, 'COMMERCIAL_SHIFT_NOT_FOUND', 'That day is not open.')
    if (!body) return NO_BODY()
    const counted = Number(body.countedCashKobo)
    const view = shiftView(pocShift)
    const done = { ...view, closedAt: iso(), countedCashKobo: counted, differenceKobo: counted - view.expectedCashKobo, note: body.note ?? null }
    pocClosedShifts.push(done)
    pocShift = null
    return [200, done]
  }
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
  const handler = workspace === 'admin' ? adminRoute : workspace === 'provider' ? staffRoute : patientRoute
  // Point of care (proposed routes) for the provider workspace, with the request's body and query when the caller has them.
  const hit = (workspace === 'provider' ? pointOfCareRoute(method, path, request) : null) ?? handler(method, path)
  return hit ? { status: hit[0], body: hit[1], headers: {} } : null
}

export function notServed(method, path) {
  return { type: 'about:blank', title: 'NOT_FOUND', status: 404, code: 'NOT_FOUND', detail: `Mock gateway does not serve ${method} ${path}` }
}
