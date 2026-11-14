/**
 * The mock gateway's answers, shared by the Node server (server.mjs) and the
 * in-page preview shim (browser-shim.mjs). Sample data only. UI work only.
 */
export const CSRF = 'mock-csrf'
const options = { facility: 'blue' }
/**
 * `facility`: 'blue' (Demo Hospital, blue EHR), 'classic', or 'outreach' (a fictional outreach group, open sign-up on outreach.).
 * `outreachRoles`: the demo login's roles in the Outreach screening campaign (default coordinator and clinician), to see
 * what a registrar, tester or data checker sees (sensitive results hidden, no outcome).
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
  'outreach.screening.write', 'outreach.sensitive.read',
  'billing.subscription.read', 'billing.subscription.manage',
  // Point of care (docs/POINT_OF_CARE_SPEC.md; proposed): so Payments, Price list, End of day and Payment setup show.
  'billing.settings.manage', 'billing.catalogue.read', 'billing.catalogue.manage', 'billing.bill.read', 'billing.bill.create',
  'billing.bill.defer', 'billing.payment.record', 'billing.payment.confirm', 'billing.payment.void', 'billing.payment.waive',
  'billing.shift.manage', 'billing.shift.own', 'pharmacy.walk-in.create', 'pharmacy.stock.read', 'pharmacy.stock.manage', 'lab.walk-in.create',
  'lab.result.share',
]
const OUTREACH_GROUP_ID = '0e7c0000-0000-4000-8000-000000000001'
const staffFacility = () => {
  const classic = options.facility === 'classic'
  // Open sign-up on outreach.: the demo login is the organiser of a fictional outreach group, outreach permissions only.
  if (options.facility === 'outreach') {
    return {
      id: OUTREACH_GROUP_ID, membershipId: 'member-demo-1', organizationId: 'org-outreach-demo', name: 'Ajegunle Health Volunteers',
      code: 'OUT-DEMO', roles: ['outreach_organiser'], isPrimary: true,
      permissions: ['outreach.registration.read', 'outreach.registration.write', 'outreach.campaign.read', 'outreach.campaign.write',
        // Outreach campaigns (owner decisions 13 Nov 2026; proposed): the stations' writes, and sensitive results.
        'outreach.screening.write', 'outreach.sensitive.read'],
    }
  }
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
    actor: { kind: 'staff', id: 'staff-demo-1', email: 'demo.clinician@example.test', displayName: 'Dr Tunde Bello', roles: facility.roles, permissions: [], facilities: [facility], facility },
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

// Outreach: one active registration campaign this membership belongs to, and the cases registered in the field. Each
// case carries `phone` and `operationalNotes` (null when none was given), as production's Outreach sends them.
const outreachLinked = new Set(['oc-3'])
// Campaign management (hid-system#222, 0111): the demo membership is camp-1's admin. What is created, opened, closed or
// added lasts until the mock restarts.
const outreachCampaignStore = [
  { id: 'camp-1', name: 'Ajegunle health week', status: 'active', services: ['registration', 'vitals'], startsAt: iso(-3 * DAY), endsAt: iso(4 * DAY), rowVersion: 2 },
  { id: 'camp-2', name: 'Makoko school screening', status: 'planned', services: ['vitals', 'referral'], startsAt: iso(10 * DAY), endsAt: null, rowVersion: 1 },
]
const outreachCampaigns = () => outreachCampaignStore.map(campaign => ({ ...campaign }))
const outreachMemberStore = new Map([
  ['camp-1', [
    { id: 'cm-1', campaignId: 'camp-1', membershipId: 'member-demo-1', role: 'admin', createdAt: iso(-4 * DAY) },
    { id: 'cm-2', campaignId: 'camp-1', membershipId: 'member-demo-7', role: 'enumerator', createdAt: iso(-4 * DAY) },
  ]],
  ['camp-2', [{ id: 'cm-3', campaignId: 'camp-2', membershipId: 'member-demo-7', role: 'admin', createdAt: iso(-1 * DAY) }]],
])
// The facility's active staff, by name, as 0111's outreach.campaign_staff names them.
const outreachFacilityStaff = [
  { membershipId: 'member-demo-1', name: 'Dr Tunde Bello' },
  { membershipId: 'member-demo-7', name: 'Nurse Bisi Adeyemi' },
  { membershipId: 'member-demo-8', name: 'Musa Ibrahim' },
  { membershipId: 'member-demo-9', name: 'Funmi Adeyemi' },
]
const outreachProblem = (status, code, detail) => [status, { type: 'about:blank', title: code, status, code, detail }]
/** Outreach campaign management as hid-system#222 serves it, for the demo membership. */
function outreachCampaignRoute(method, path, { body, headers } = {}) {
  const base = '/outreach/registration-cases/campaigns'
  if (method === 'GET' && path === `${base}/governance`) {
    // Health ID never verifies an outreach group (owner decision Q38): any group not paused is 'unverified'.
    return [200, { rule: 'campaign_admins', organiserStatus: options.facility !== 'outreach' ? 'not_outreach_group'
      : outreachGroupState.status === 'suspended' ? 'suspended' : 'unverified' }]
  }
  const match = new RegExp(`^${base}/([^/]+)/(staff|status|members)$`).exec(path)
  const campaign = match ? outreachCampaignStore.find(entry => entry.id === decodeURIComponent(match[1])) : undefined
  if (match && !campaign) return outreachProblem(404, 'OUTREACH_CAMPAIGN_NOT_FOUND', 'The Outreach campaign was not found')
  const members = campaign ? outreachMemberStore.get(campaign.id) ?? [] : []
  const role = members.find(member => member.membershipId === 'member-demo-1')?.role ?? null
  if (method === 'GET' && match?.[2] === 'staff') {
    const people = !role ? [] : outreachFacilityStaff
      .map(person => ({ ...person, campaignRole: members.find(member => member.membershipId === person.membershipId)?.role ?? null }))
      .filter(person => role === 'admin' || person.campaignRole)
    return [200, { yourRole: role, people }]
  }
  if (method === 'GET' && match?.[2] === 'members') return [200, members]
  if (method !== 'POST') return null
  if (path === base) {
    if (!body) return NO_BODY()
    if (body.endsAt && Date.parse(body.endsAt) <= Date.parse(body.startsAt)) return outreachProblem(400, 'OUTREACH_CAMPAIGN_DATES_INVALID', 'An Outreach campaign must end after it starts')
    const created = { id: `camp-${outreachCampaignStore.length + 1}-${Date.now().toString(36)}`, name: String(body.name).trim(), status: 'planned',
      services: [...new Set(body.services ?? [])], startsAt: body.startsAt, endsAt: body.endsAt ?? null, rowVersion: 1 }
    outreachCampaignStore.unshift(created)
    outreachMemberStore.set(created.id, [{ id: `cm-${created.id}`, campaignId: created.id, membershipId: 'member-demo-1', role: 'admin', createdAt: iso() }])
    return [201, { ...created }]
  }
  if (!match) return null
  if (role !== 'admin') return outreachProblem(403, 'OUTREACH_CAMPAIGN_ADMIN_REQUIRED', 'Only this Outreach campaign\'s admins can change it')
  if (!body) return NO_BODY()
  if (match[2] === 'status') {
    const expected = Number(String(headers?.get?.('if-match') ?? '').replace(/^W\//, '').replace(/"/g, ''))
    if (expected !== campaign.rowVersion) return outreachProblem(412, 'VERSION_CONFLICT', 'The Outreach campaign changed; reload before retrying')
    if (campaign.status === 'closed') return outreachProblem(409, 'OUTREACH_CAMPAIGN_CLOSED', 'A closed Outreach campaign cannot be reopened')
    if (body.status === 'active' && Date.parse(campaign.startsAt) > Date.now()) return outreachProblem(409, 'OUTREACH_CAMPAIGN_NOT_STARTED', 'The Outreach campaign cannot become active before its start time')
    campaign.status = body.status
    campaign.rowVersion += 1
    return [200, { ...campaign }]
  }
  if (match[2] === 'members') {
    const person = outreachFacilityStaff.find(entry => entry.membershipId === body.membershipId)
    if (!person) return outreachProblem(422, 'OUTREACH_STAFF_NOT_AVAILABLE', 'That person is not an active staff member at this facility')
    if (members.some(member => member.membershipId === person.membershipId)) return outreachProblem(409, 'OUTREACH_CAMPAIGN_MEMBER_EXISTS', 'The staff member is already in this Outreach campaign')
    const added = { id: `cm-${campaign.id}-${members.length + 1}`, campaignId: campaign.id, membershipId: person.membershipId, role: body.role, createdAt: iso() }
    outreachMemberStore.set(campaign.id, [...members, added])
    return [201, added]
  }
  return null
}
// --------------------------------------------- open sign-up on outreach. --
// Owner decisions of 11 November 2026: the organiser sign-up (details, email code, terms, password), "Start an outreach
// group" for a signed-in login, the team's invitations, accepting one, and support's list. No Health ID check before a
// group's campaigns go live (decision Q38). Fictional data only; what is made lasts until the mock restarts. The demo
// code is 123456.
const OUTREACH_TERMS = '2026-11-01'
const outreachGroupState = { status: 'active' }
const outreachSignups = new Map()
const outreachInvitationStore = [
  { invitationId: 'b1000000-0000-4000-8000-000000000002', name: 'Chinedu Eze', email: 'chinedu@example.test', status: 'pending', expiresAt: iso(6 * DAY), createdAt: iso(-3 * 60 * MIN), acceptedAt: null },
]
// Who has joined (identity.list_outreach_team's members); invitations are listed while pending only.
const outreachTeamMembers = [
  { membershipId: 'member-demo-1', name: 'Funke Ade', email: 'funke@example.test', roleCode: 'outreach_organiser', status: 'active', joinedAt: iso(-5 * 60 * MIN) },
  { membershipId: 'b2000000-0000-4000-8000-000000000001', name: 'Bisi Adeyemi', email: 'bisi@example.test', roleCode: 'outreach_volunteer', status: 'active', joinedAt: iso(-1 * DAY) },
]
/** Registrations whose person's details support deleted at their request. */
const outreachRedacted = new Set()
const outreachOrganiserStore = [
  { organizationId: 'org-outreach-demo', facilityId: OUTREACH_GROUP_ID, version: 1, displayName: null, groupName: 'Ajegunle Health Volunteers', kind: 'group',
    registrationNumber: 'IT123456', organiserName: 'Funke Ade', organiserEmail: 'funke@example.test', phone: '+2348012345678', termsVersion: OUTREACH_TERMS,
    createdAt: iso(-5 * 60 * MIN), suspendedAt: null, suspensionReason: null, campaigns: 1, activeCampaigns: 0, members: 2, pendingInvitations: 1 },
  { organizationId: 'org-outreach-demo-2', facilityId: '0e7c0000-0000-4000-8000-000000000002', version: 2, displayName: 'Makoko Youth Health Club', groupName: 'Makoko Youth Health Club', kind: 'group',
    registrationNumber: null, organiserName: 'Tobi Bello', organiserEmail: 'tobi@example.test', phone: '+2348098765432', termsVersion: OUTREACH_TERMS,
    createdAt: iso(-9 * DAY), suspendedAt: null, suspensionReason: null, campaigns: 3, activeCampaigns: 1, members: 6, pendingInvitations: 0 },
]
/** identity-api's list: `status` active, suspended or all (the default), each row with its status and label. */
const outreachOrganiserRows = (status) => outreachOrganiserStore.map(row => {
  const rowStatus = row.suspendedAt ? 'suspended' : 'active'
  return { ...row, status: rowStatus, label: rowStatus === 'suspended' ? 'Paused' : 'Unverified organiser' }
}).filter(row => status !== 'active' && status !== 'suspended' ? true : row.status === status)

function outreachSignupRoute(method, path, { body } = {}) {
  const signup = '/identity/outreach-organisers'
  if (method === 'GET' && (path === `${signup}/availability` || path === `${signup}/for-my-account/availability`)) {
    return [200, { open: true, termsVersion: OUTREACH_TERMS }]
  }
  if (method === 'POST' && path === signup) {
    if (!body?.email || !body?.groupName) return outreachProblem(400, 'VALIDATION_FAILED', 'Complete every field.')
    if (/hospital|ministry/i.test(body.groupName)) return outreachProblem(422, 'OUTREACH_ORGANISER_NAME_NOT_ALLOWED', 'Choose another group name.')
    const challengeId = 'c0de0000-0000-4000-8000-000000000001'
    // As Identity: the same answer whatever the email's account, so it says nothing about who has a login. An email with
    // a login (here @demo-hospital.example, staff, or @patient.example, a patient) gets an email saying what to do and
    // no code, so no sign-up starts.
    if (!/@(demo-hospital|patient)\.example$/i.test(body.email)) outreachSignups.set(challengeId, { ...body, verified: false })
    return [200, { accepted: true, challengeId, expiresInSeconds: 600, resendAfterSeconds: 60 }]
  }
  if (method === 'POST' && path === `${signup}/verify-email`) {
    const found = outreachSignups.get(body?.challengeId)
    if (!found) return outreachProblem(401, 'OUTREACH_ORGANISER_SIGNUP_SESSION_INVALID', 'Start again.')
    if (body.code !== '123456') return outreachProblem(400, 'OTP_INVALID', 'That code is not right.')
    found.verified = true
    return [200, { verified: true }]
  }
  if (method === 'POST' && path === `${signup}/activate`) {
    if (body?.termsVersion !== OUTREACH_TERMS || body?.acceptTerms !== true) return outreachProblem(409, 'OUTREACH_ORGANISER_TERMS_REQUIRED', 'The organiser terms have changed. Reload.')
    return [200, { activated: true, organizationId: 'org-outreach-demo', facilityId: OUTREACH_GROUP_ID, accountId: 'staff-demo-1', organiserStatus: 'active', label: 'Unverified organiser',
      actor: staffSession().actor, expiresAt: iso(15 * MIN) }]
  }
  if (method === 'POST' && path === `${signup}/for-my-account`) {
    if (body?.termsVersion !== OUTREACH_TERMS || body?.acceptTerms !== true) return outreachProblem(409, 'OUTREACH_ORGANISER_TERMS_REQUIRED', 'The organiser terms have changed. Reload.')
    return [201, { started: true, organizationId: 'org-outreach-demo', facilityId: OUTREACH_GROUP_ID, membershipId: 'member-outreach-1', organiserStatus: 'active',
      label: 'Unverified organiser' }]
  }
  const invitations = '/identity/outreach-invitations'
  if (method === 'GET' && path === invitations) {
    return [200, { members: outreachTeamMembers, invitations: outreachInvitationStore.filter(entry => entry.status === 'pending') }]
  }
  if (method === 'POST' && path === invitations) {
    if (!body?.email || !body?.name) return outreachProblem(400, 'VALIDATION_FAILED', 'Enter their name and email.')
    const email = String(body.email).toLowerCase()
    if (outreachTeamMembers.some(entry => entry.email === email)) return outreachProblem(409, 'OUTREACH_INVITEE_ALREADY_MEMBER', 'This person is already in your team.')
    // Identity does not replay an invitation: the same person again while one waits is refused, and no second email goes.
    if (outreachInvitationStore.some(entry => entry.email === email && entry.status === 'pending')) {
      return outreachProblem(409, 'OUTREACH_INVITATION_ALREADY_SENT', 'This person already has an invitation waiting.')
    }
    const created = { invitationId: `b1000000-0000-4000-8000-${String(outreachInvitationStore.length + 1).padStart(12, '0')}`, name: body.name,
      email: String(body.email).toLowerCase(), status: 'pending', expiresAt: iso(7 * DAY), createdAt: iso(), acceptedAt: null }
    outreachInvitationStore.unshift(created)
    return [201, { invitationId: created.invitationId, expiresAt: created.expiresAt, deliveryOutcome: 'accepted', replayed: false }]
  }
  if (method === 'POST' && (path === `${invitations}/accept` || path === `${invitations}/signed-in/accept`)) {
    // By link only: the email carries no code.
    if (!body?.invitationId || !body?.token || 'code' in body || 'email' in body) return outreachProblem(400, 'VALIDATION_FAILED', 'Open the link from the email again.')
    // An invitation sent to a patient's Health ID login (here, an invitation id ending ...0009): it can't help a group.
    if (String(body.invitationId).endsWith('000000000009')) return outreachProblem(409, 'OUTREACH_INVITATION_PATIENT_LOGIN', 'This email is a patient’s Health ID login.')
    // As Identity: the answer does not name the group.
    return [200, { accepted: true, facilityId: OUTREACH_GROUP_ID, membershipId: 'b2000000-0000-4000-8000-000000000002', roleCode: 'outreach_volunteer' }]
  }
  return null
}

/** The version a support command names, from If-Match (W/"3", "3" or 3) or body.version, as identity-api reads it. */
function adminOutreachVersion(headers, body) {
  const header = String(headers?.get?.('if-match') ?? '').trim().replace(/^W\//, '').replace(/^"|"$/g, '')
  const version = header ? Number(header) : body?.version ?? Number.NaN
  return Number.isSafeInteger(version) && version >= 1 ? version : null
}

function adminOutreachRoute(method, path, { body, headers, query } = {}) {
  if (method === 'GET' && path === '/admin/outreach-organisers') return [200, { organisers: outreachOrganiserRows(query?.get?.('status') ?? 'all') }]
  // Pausing a group; there is no review route (decision Q38).
  const organiser = method === 'POST' && /^\/admin\/outreach-organisers\/([^/]+)\/suspend$/.exec(path)
  if (organiser) {
    const row = outreachOrganiserStore.find(entry => entry.organizationId === decodeURIComponent(organiser[1]))
    if (!row) return outreachProblem(404, 'OUTREACH_ORGANISER_NOT_FOUND', 'That outreach group was not found.')
    const version = adminOutreachVersion(headers, body)
    if (version === null) return outreachProblem(428, 'OUTREACH_ADMIN_VERSION_REQUIRED', 'Reload the list, then try again.')
    if (version !== row.version) return outreachProblem(409, 'OUTREACH_ORGANISER_VERSION_CONFLICT', 'Someone else changed this outreach group just now. Reload the list and try again.')
    if (row.suspendedAt) return outreachProblem(409, 'OUTREACH_ORGANISER_ALREADY_SUSPENDED', 'This outreach group is already paused.')
    row.version += 1
    row.suspendedAt = iso()
    row.suspensionReason = body?.reason ?? null
    if (row.organizationId === 'org-outreach-demo') outreachGroupState.status = 'suspended'
    return [200, { organizationId: row.organizationId, version: row.version, status: 'suspended', label: 'Paused', revokedRoles: row.members }]
  }
  // Finding a registration when someone asks for their details to be deleted: where and when only.
  if (method === 'POST' && path === '/admin/outreach-registrations/search') {
    if (!body?.organizationId || (!body.temporaryPatientId && !body.phone)) {
      return outreachProblem(400, 'OUTREACH_REGISTRATION_LOOKUP_INVALID', 'Choose the group, then give a temporary ID or a phone number.')
    }
    const group = outreachOrganiserStore.find(entry => entry.organizationId === body.organizationId)
    const matches = group ? outreachCases().filter(item => item.campaignId && (body.temporaryPatientId
      ? item.temporaryPatientId === body.temporaryPatientId : String(item.phone ?? '').replace(/\D/g, '').endsWith(String(body.phone).replace(/\D/g, '').slice(-10)))) : []
    return [200, { registrations: matches.map(item => ({ caseId: item.id, groupName: group.groupName, campaignName: 'Ajegunle market health day',
      temporaryPatientId: item.temporaryPatientId, createdAt: item.createdAt, redacted: outreachRedacted.has(item.id) })) }]
  }
  const redact = method === 'POST' && /^\/admin\/outreach-registrations\/([^/]+)\/redact$/.exec(path)
  if (redact) {
    const caseId = decodeURIComponent(redact[1])
    const reason = String(body?.reason ?? '').trim()
    if (reason.length < 8 || reason.length > 500) return outreachProblem(422, 'OUTREACH_REDACTION_INVALID', 'Give a reason of 8 to 500 characters.')
    if (outreachRedacted.has(caseId) || !outreachCases().some(item => item.id === caseId)) {
      return outreachProblem(409, 'OUTREACH_REGISTRATION_NOT_REDACTABLE', 'Already deleted, or not found.')
    }
    outreachRedacted.add(caseId)
    return [200, { caseId, outcome: 'redacted' }]
  }
  const campaign = method === 'POST' && /^\/admin\/outreach-campaigns\/([^/]+)\/(close|admins)$/.exec(path)
  if (campaign) {
    if (campaign[2] === 'admins') return [200, { campaignId: campaign[1], membershipId: body?.membershipId ?? 'member-demo-1', role: 'admin', alreadyAdmin: false }]
    if (adminOutreachVersion(headers, body) === null) return outreachProblem(428, 'OUTREACH_ADMIN_VERSION_REQUIRED', 'Reload the list, then try again.')
    return [200, { campaignId: campaign[1], status: 'closed', alreadyClosed: false }]
  }
  return null
}

const outreachCases = () => [
  { id: 'oc-1', campaignId: 'camp-1', fullName: 'Kemi Balogun', ageYears: 34, sex: 'female', temporaryPatientId: 'tmp_7f3a9c21', phone: '+2348031234567', operationalNotes: 'Met at the market. Wants a blood pressure check next week.', createdAt: iso(-40 * MIN), rowVersion: 1 },
  { id: 'oc-2', campaignId: 'camp-1', fullName: 'Ibrahim Musa', ageYears: 61, sex: 'male', temporaryPatientId: 'tmp_2b8e4d10', phone: '08029876543', operationalNotes: null, createdAt: iso(-2 * 60 * MIN), rowVersion: 1 },
  { id: 'oc-3', campaignId: 'camp-1', fullName: 'Chiamaka Obi', ageYears: 8, sex: 'female', temporaryPatientId: 'tmp_9d1c6a55', phone: null, operationalNotes: 'Came with her mother.', createdAt: iso(-1 * DAY), rowVersion: 2 },
  { id: 'oc-4', fullName: 'Segun Adewale', ageYears: 45, sex: 'unknown', temporaryPatientId: 'tmp_4e6f0b77', phone: null, operationalNotes: null, createdAt: iso(-2 * DAY), rowVersion: 1 },
].map(item => ({ ...item, status: outreachLinked.has(item.id) ? 'identity_resolved' : 'identity_resolution_pending', rowVersion: item.rowVersion + (outreachLinked.has(item.id) && item.id !== 'oc-3' ? 1 : 0) }))
  // Outreach campaigns: the screening campaign's visits and this session's registrations, as the caller may see them.
  .concat(allVisits().map(visitFor))

// --------------------------------------- Outreach campaigns (owner decisions 13 Nov 2026) --
// Proposed routes (BACKEND-NEEDS.md "Outreach campaigns (owner decisions 13 Nov 2026)"): a live campaign, "Ajegunle
// Hepatitis B & Hypertension Screening", at two sites with a team of six (and one invitation waiting), ~40 visits across
// the stations, 5 positive hepatitis B tests, 4 referrals and 6 follow-ups. The dashboard, follow-up list and report are
// worked out from the visits, so they always agree. Writes are kept in memory (and replayed by Idempotency-Key); they
// need their JSON body, which the in-page preview passes and the Node server does not (400 MOCK_BODY_NOT_RECEIVED).
// Registration (POST /outreach/registration-cases) makes a Health ID record at once (HID-…, identity not yet checked)
// and a visit code like K7-4F2, for any campaign. The demo login is the team's coordinator and clinician; set
// ?outreachRoles=registrar,vitals in the preview (MOCK_OUTREACH_ROLES in the server) to see what other roles see.
const HBV_CAMPAIGN_ID = 'camp-hbv'
outreachCampaignStore.unshift({ id: HBV_CAMPAIGN_ID, name: 'Ajegunle Hepatitis B & Hypertension Screening', status: 'active',
  services: ['registration', 'vitals', 'lab_sample', 'referral'], startsAt: iso(-1 * DAY), endsAt: iso(1 * DAY), rowVersion: 3 })
outreachMemberStore.set(HBV_CAMPAIGN_ID, [{ id: 'cm-hbv-1', campaignId: HBV_CAMPAIGN_ID, membershipId: 'member-demo-1', role: 'admin', createdAt: iso(-6 * DAY) }])

const CODE_ALPHABET = '234679ACDEFGHJKMNPQRTWXY'
let seed = 20261113
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const pick = list => list[Math.floor(rand() * list.length)]
const between = (low, high) => low + Math.floor(rand() * (high - low + 1))
const usedCodes = new Set()
function newVisitCode() {
  for (;;) {
    const chars = Array.from({ length: 5 }, () => pick(CODE_ALPHABET))
    const code = `${chars.slice(0, 2).join('')}-${chars.slice(2).join('')}`
    if (!usedCodes.has(code)) { usedCodes.add(code); return code }
  }
}
const HID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
let hidCount = 0
const newHealthId = () => `HID-${Array.from({ length: 8 }, () => pick(HID_ALPHABET)).join('')}`
const newPatientId = () => `a1000000-0000-4000-8000-${String(++hidCount).padStart(12, '0')}`
const day = days => iso(days * DAY).slice(0, 10)
const maskPhone = phone => phone ? `•••• ••• ${String(phone).replace(/\D/g, '').slice(-4)}` : null
const digits = phone => String(phone ?? '').replace(/\D/g, '').slice(-10)

const HBV_SITES = [
  { id: 'site-1', name: 'Ajegunle Town Hall', community: 'Ajegunle', lga: 'Ajeromi-Ifelodun', address: '12 Tolu Road, Ajegunle', target: 250 },
  { id: 'site-2', name: 'St Mary’s Church Hall', community: 'Olodi-Apapa', lga: 'Ajeromi-Ifelodun', address: '4 Boundary Road, Olodi-Apapa', target: 150 },
]
const HBV_PACKAGE = {
  vitals: [
    { id: 'bp_systolic', name: 'Blood pressure, top number (systolic)', unit: 'mmHg', min: 60, max: 260, decimals: 0, normalText: 'Under 140' },
    { id: 'bp_diastolic', name: 'Blood pressure, bottom number (diastolic)', unit: 'mmHg', min: 30, max: 160, decimals: 0, normalText: 'Under 90' },
    { id: 'pulse', name: 'Pulse', unit: 'bpm', min: 25, max: 220, decimals: 0, normalText: '60 to 100' },
  ],
  tests: [{ id: 'hbsag', name: 'Hepatitis B rapid test (HBsAg)', focus: 'hepatitis_b', kind: 'choice', sensitive: true, usesKit: true,
    results: [{ value: 'positive', label: 'Positive', flag: 'abnormal' }, { value: 'negative', label: 'Negative', flag: 'normal' }, { value: 'invalid', label: 'Invalid (test again)', flag: 'invalid' }],
    note: 'Read at the time on the kit. No control line means invalid: test again with a new kit.' }],
  questions: [
    { id: 'htn_known', text: 'Has a health worker ever told you that you have high blood pressure?', kind: 'yesno', focus: 'hypertension' },
    { id: 'htn_medicine', text: 'Do you take medicine for blood pressure?', kind: 'yesno', focus: 'hypertension' },
    { id: 'htn_warning', text: 'Do you have a bad headache, chest pain or trouble seeing right now?', kind: 'yesno', focus: 'hypertension', flagWhen: 'yes', flagLevel: 'refer_urgent', flagReason: 'Has a bad headache, chest pain or trouble seeing now.' },
    { id: 'hbv_tested', text: 'Have you been tested for hepatitis B before?', kind: 'yesno', focus: 'hepatitis_b' },
    { id: 'hbv_vaccine', text: 'Have you had the hepatitis B vaccine?', kind: 'yesno', focus: 'hepatitis_b' },
    { id: 'hbv_jaundice', text: 'Are your eyes or skin yellow now?', kind: 'yesno', focus: 'hepatitis_b', flagWhen: 'yes', flagLevel: 'refer_routine', flagReason: 'Has yellow eyes or skin.' },
  ],
}
const HBV_PARTNERS = [
  { id: 'partner-1', name: 'General Hospital Ajeromi', phone: '+2348023456789', address: '1 Tolu Road, Ajegunle', treats: ['hepatitis_b', 'hypertension'], notes: 'Medical outpatients, Monday to Friday, 8am.' },
  { id: 'partner-2', name: 'LUTH Liver Clinic', phone: '+2348034567890', address: 'Ishaga Road, Idi-Araba', treats: ['hepatitis_b'], notes: 'Bring the referral slip. Tuesdays and Thursdays.' },
  { id: 'partner-3', name: 'Ajegunle Primary Health Centre', phone: '+2348045678901', address: '22 Mosafejo Street, Ajegunle', treats: ['hypertension'], notes: null },
]
const HBV_KITS = [
  { id: 'kit-1', siteId: 'site-1', testId: 'hbsag', lot: 'HB-2291', expiresOn: day(180), count: 200 },
  { id: 'kit-2', siteId: 'site-1', testId: 'hbsag', lot: 'HB-2307', expiresOn: day(20), count: 100 },
  { id: 'kit-3', siteId: 'site-2', testId: 'hbsag', lot: 'HB-2291', expiresOn: day(180), count: 14 },
]
const campaignPlans = new Map([[HBV_CAMPAIGN_ID, {
  campaignId: HBV_CAMPAIGN_ID, organisationName: 'Ajegunle Health Volunteers', target: 400, focuses: ['hepatitis_b', 'hypertension'],
  sites: HBV_SITES, package: HBV_PACKAGE, stationMode: 'split', stations: ['register', 'vitals', 'tests', 'counselling', 'results'],
  partners: HBV_PARTNERS,
  consent: { text: 'We will record your name, age, sex, phone and community, check your blood pressure and test for hepatitis B. '
    + 'Your results go into your own Health ID record. Only the screening team sees them; hepatitis B results only the counsellor and clinician. '
    + 'You can say no to any test.', version: '2026-11-13', hivText: null, hivVersion: null, languages: ['en', 'yo', 'pcm'] },
  kits: HBV_KITS, rowVersion: 4, updatedAt: iso(-2 * DAY),
}]])

// A campaign the organisation ran last month (closed): malaria, blood pressure and one type of its own, sickle cell, which
// is not on the list (owner, 13 Nov 2026: "Other" → a type of the organisation's own). Its visits are not kept here: its
// dashboard is its counts as they were when it closed, and the organisation's summary adds them in.
const PAST_CAMPAIGN_ID = 'camp-olodi'
outreachCampaignStore.push({ id: PAST_CAMPAIGN_ID, name: 'Olodi malaria and sickle cell drive', status: 'closed',
  services: ['registration', 'vitals', 'lab_sample', 'referral'], startsAt: iso(-40 * DAY), endsAt: iso(-38 * DAY), rowVersion: 5 })
outreachMemberStore.set(PAST_CAMPAIGN_ID, [{ id: 'cm-olodi-1', campaignId: PAST_CAMPAIGN_ID, membershipId: 'member-demo-1', role: 'admin', createdAt: iso(-45 * DAY) }])
const SICKLE_CELL = { id: 'custom:sickle-cell', label: 'Sickle cell' }
campaignPlans.set(PAST_CAMPAIGN_ID, {
  campaignId: PAST_CAMPAIGN_ID, organisationName: 'Ajegunle Health Volunteers', target: 300, focuses: ['hypertension', 'malaria', SICKLE_CELL],
  sites: [{ id: 'site-o1', name: 'Olodi Community Centre', community: 'Olodi-Apapa', lga: 'Ajeromi-Ifelodun', address: '9 Olodi Road', target: 300 }],
  package: { vitals: HBV_PACKAGE.vitals.concat([{ id: 'temperature', name: 'Temperature', unit: '°C', min: 32, max: 43, decimals: 1, normalText: 'Under 37.5' }]),
    tests: [{ id: 'malaria_rdt', name: 'Malaria rapid test (mRDT)', focus: 'malaria', kind: 'choice', sensitive: false, usesKit: true,
      results: [{ value: 'positive', label: 'Positive', flag: 'abnormal' }, { value: 'negative', label: 'Negative', flag: 'normal' }, { value: 'invalid', label: 'Invalid (test again)', flag: 'invalid' }] },
    { id: 'own-sickle01', name: 'Sickle cell test', focus: SICKLE_CELL.id, kind: 'choice', sensitive: false, usesKit: false,
      results: [{ value: 'positive', label: 'Positive', flag: 'abnormal' }, { value: 'negative', label: 'Negative', flag: 'normal' }, { value: 'invalid', label: 'Invalid', flag: 'invalid' }] }],
    questions: HBV_PACKAGE.questions.filter(question => question.focus === 'hypertension') },
  stationMode: 'split', stations: ['register', 'vitals', 'tests', 'results'], partners: HBV_PARTNERS.filter(partner => partner.treats.includes('hypertension')),
  consent: { text: 'We will record your name, age, sex, phone and community, check your blood pressure and temperature, and test for malaria and sickle cell.',
    version: '2026-10-01', hivText: null, hivVersion: null, languages: ['en', 'yo', 'pcm'] },
  kits: [], rowVersion: 6, updatedAt: iso(-38 * DAY),
})
const pastDashboards = new Map([[PAST_CAMPAIGN_ID, {
  asOf: iso(-38 * DAY), target: 300, registered: 212, screened: 198, waiting: {},
  outcomes: { normal: 150, followUp: 22, referUrgent: 3, referRoutine: 37, pending: 0 },
  byFocus: [{ focus: 'hypertension', screened: 190, positive: 37, referred: 12 }, { focus: 'malaria', screened: 198, positive: 41, referred: 23 },
    { focus: SICKLE_CELL.id, label: SICKLE_CELL.label, screened: 64, positive: 5, referred: 5 }],
  byMember: [], bySite: [{ siteId: 'site-o1', name: 'Olodi Community Centre', registered: 212, screened: 198 }], byHour: [], kits: [], alerts: [],
}]])

const demoRoles = () => options.outreachRoles ?? ['coordinator', 'clinician']
const teamStore = new Map([[HBV_CAMPAIGN_ID, [
  { memberId: 'tm-1', membershipId: 'member-demo-1', name: 'Funke Ade', phone: '+2348012345678', email: 'funke@example.test', roles: ['coordinator', 'clinician'], siteId: 'site-1', station: 'results', status: 'accepted', invitedAt: iso(-6 * DAY), joinedAt: iso(-6 * DAY), rowVersion: 1 },
  { memberId: 'tm-2', name: 'Bisi Adeyemi', phone: '+2348021111111', email: 'bisi@example.test', roles: ['registrar'], siteId: 'site-1', station: 'register', status: 'accepted', invitedAt: iso(-5 * DAY), joinedAt: iso(-5 * DAY), rowVersion: 1 },
  { memberId: 'tm-3', name: 'Musa Ibrahim', phone: '+2348032222222', email: null, roles: ['vitals'], siteId: 'site-1', station: 'vitals', status: 'accepted', invitedAt: iso(-5 * DAY), joinedAt: iso(-4 * DAY), rowVersion: 1 },
  { memberId: 'tm-4', name: 'Grace Okon', phone: '+2348043333333', email: 'grace@example.test', roles: ['tester', 'counsellor'], siteId: 'site-1', station: 'tests', status: 'accepted', invitedAt: iso(-5 * DAY), joinedAt: iso(-4 * DAY), rowVersion: 2 },
  { memberId: 'tm-5', name: 'Tobi Bello', phone: '+2348054444444', email: null, roles: ['registrar', 'vitals'], siteId: 'site-2', station: 'register', status: 'accepted', invitedAt: iso(-4 * DAY), joinedAt: iso(-3 * DAY), rowVersion: 1 },
  { memberId: 'tm-6', name: 'Dr Chidi Nwosu', phone: '+2348065555555', email: 'chidi@example.test', roles: ['clinician', 'counsellor', 'tester'], siteId: 'site-2', station: 'results', status: 'accepted', invitedAt: iso(-4 * DAY), joinedAt: iso(-3 * DAY), rowVersion: 1 },
  { memberId: 'tm-7', name: 'Amaka Eze', phone: '+2348076666666', email: null, roles: ['data_checker'], siteId: null, station: null, status: 'invited', invitedAt: iso(-1 * DAY), joinedAt: null, rowVersion: 1 },
]]])
teamStore.set(PAST_CAMPAIGN_ID, [{ memberId: 'tm-o1', membershipId: 'member-demo-1', name: 'Funke Ade', phone: '+2348012345678', email: 'funke@example.test',
  roles: ['coordinator', 'clinician'], siteId: 'site-o1', station: 'results', status: 'accepted', invitedAt: iso(-45 * DAY), joinedAt: iso(-45 * DAY), rowVersion: 1 }])
const teamOf = campaignId => teamStore.get(campaignId) ?? []
const memberName = memberId => teamOf(HBV_CAMPAIGN_ID).find(member => member.memberId === memberId)?.name ?? null
const you = campaignId => teamOf(campaignId).find(member => member.membershipId === 'member-demo-1') ?? null
const yourRoles = campaignId => (you(campaignId) ? demoRoles() : [])
const seesSensitive = campaignId => yourRoles(campaignId).some(role => role === 'counsellor' || role === 'clinician')

// The visits. Index i: site-1 for the first 26, site-2 for the rest; newer visits are further back in the stations.
const FIRST = { female: ['Kemi', 'Adaeze', 'Funmilayo', 'Ngozi', 'Aisha', 'Blessing', 'Chioma', 'Halima', 'Yetunde', 'Esther', 'Ronke', 'Zainab'],
  male: ['Ibrahim', 'Segun', 'Emeka', 'Tunde', 'Musa', 'Chinedu', 'Yusuf', 'Babatunde', 'Obinna', 'Sola', 'Kunle', 'Uche'] }
const LAST = ['Balogun', 'Okafor', 'Adeyemi', 'Musa', 'Eze', 'Ogunleye', 'Bello', 'Nwankwo', 'Abubakar', 'Okon', 'Adewale', 'Obi', 'Lawal', 'Danjuma']
const HBV_POSITIVE_REFERRED = { 2: 'arrived', 9: 'not_arrived', 28: 'made' }
const HBV_POSITIVE_WAITING = new Set([18, 37])
const BP_URGENT = 12
const BP_FOLLOW_UP = { 15: [148, 94], 31: [152, 92] }
const RETESTED = 5
const FOLLOW_UP_STATUS = { 2: 'reached', 9: 'not_reached', 28: 'due', 12: 'reached', 15: 'due', 31: 'due' }
function stageOf(index) {
  // How far along: 0 registered, 1 vitals done, 2 tests done (waiting for counselling), 3 complete.
  const newest = index < 26 ? 25 - index : 39 - index
  const [registered, vitals, tests] = index < 26 ? [4, 3, 3] : [2, 2, 2]
  if (newest < registered) return 0
  if (newest < registered + vitals) return 1
  if (newest < registered + vitals + tests) return 2
  return 3
}
const campaignVisits = []
for (let index = 0; index < 40; index += 1) {
  const sex = rand() < 0.55 ? 'female' : 'male'
  const fullName = `${pick(FIRST[sex])} ${pick(LAST)}`
  const siteId = index < 26 ? 'site-1' : 'site-2'
  const registrar = siteId === 'site-2' ? 'tm-5' : index % 7 === 0 ? 'tm-1' : 'tm-2'
  const createdAt = iso(-(20 + (39 - index) * 8) * MIN)
  const at = minutes => new Date(Date.parse(createdAt) + minutes * MIN).toISOString()
  const stage = HBV_POSITIVE_WAITING.has(index) ? 2 : stageOf(index)
  const phone = rand() < 0.85 ? `+234${pick(['803', '806', '813', '816', '703', '706', '810', '902'])}${String(between(1000000, 9999999))}` : null
  const visit = {
    id: `ov-${String(index + 1).padStart(2, '0')}`, campaignId: HBV_CAMPAIGN_ID, status: 'identity_resolution_pending', createdAt,
    fullName, ageYears: between(19, 72), sex, temporaryPatientId: `tmp_${Math.floor(rand() * 0xffffffff).toString(16).padStart(8, '0')}`,
    phone, operationalNotes: null, rowVersion: 1 + stage,
    healthId: newHealthId(), patientId: newPatientId(), visitCode: newVisitCode(), identityChecked: false, siteId,
    stationsDone: ['register'], registeredBy: { memberId: registrar, name: memberName(registrar) },
    vitals: [], tests: [], answers: [], outcome: null, referral: null, followUp: null,
  }
  const vitalsBy = siteId === 'site-1' ? 'tm-3' : 'tm-5'
  const testsBy = siteId === 'site-1' ? 'tm-4' : 'tm-6'
  const clinician = siteId === 'site-1' ? 'tm-1' : 'tm-6'
  if (stage >= 1) {
    const [systolic, diastolic] = index === BP_URGENT ? [186, 118] : BP_FOLLOW_UP[index] ?? [between(105, 135), between(65, 85)]
    visit.vitals.push({ entryId: `${visit.id}-v1`, readings: { bp_systolic: systolic, bp_diastolic: diastolic, pulse: between(62, 96) }, takenAt: at(6), recordedBy: vitalsBy, siteId })
    visit.answers = [{ questionId: 'htn_known', value: index === BP_URGENT || BP_FOLLOW_UP[index] ? 'yes' : 'no' }, { questionId: 'htn_medicine', value: 'no' },
      { questionId: 'htn_warning', value: 'no' }, { questionId: 'hbv_tested', value: rand() < 0.2 ? 'yes' : 'no' }, { questionId: 'hbv_vaccine', value: rand() < 0.15 ? 'yes' : 'no' },
      { questionId: 'hbv_jaundice', value: 'no' }]
    visit.stationsDone.push('vitals')
  }
  if (stage >= 2) {
    const positive = index in HBV_POSITIVE_REFERRED || HBV_POSITIVE_WAITING.has(index)
    const lot = 'HB-2291'
    const kitId = siteId === 'site-1' ? 'kit-1' : 'kit-3'
    if (index === RETESTED) visit.tests.push({ entryId: `${visit.id}-t1`, testId: 'hbsag', result: 'invalid', kitId, kitLot: lot, attempt: 1, takenAt: at(14), flag: 'invalid', recordedBy: testsBy })
    visit.tests.push({ entryId: `${visit.id}-t${index === RETESTED ? 2 : 1}`, testId: 'hbsag', result: positive ? 'positive' : 'negative', kitId, kitLot: lot,
      attempt: index === RETESTED ? 2 : 1, takenAt: at(index === RETESTED ? 24 : 14), flag: positive ? 'abnormal' : 'normal', recordedBy: testsBy })
    visit.stationsDone.push('tests')
  }
  if (stage >= 3) {
    const referredHbv = index in HBV_POSITIVE_REFERRED
    const confirmedBy = { memberId: clinician, name: memberName(clinician), roles: teamOf(HBV_CAMPAIGN_ID).find(member => member.memberId === clinician).roles }
    if (referredHbv || index === BP_URGENT) {
      const urgent = index === BP_URGENT
      const reason = urgent ? 'Blood pressure is very high (186/118 mmHg). Needs to be seen today.' : 'Hepatitis B test is positive. Needs care at a clinic that treats hepatitis B.'
      visit.outcome = { kind: 'refer', urgency: urgent ? 'urgent' : 'routine', reason, suggestedKind: 'refer', suggestedUrgency: urgent ? 'urgent' : 'routine', confirmedBy, confirmedAt: at(30) }
      const status = urgent ? 'arrived' : HBV_POSITIVE_REFERRED[index]
      visit.referral = { referralId: `ref-${visit.id}`, partnerId: urgent ? 'partner-1' : index === 9 ? 'partner-1' : 'partner-2', urgency: urgent ? 'urgent' : 'routine', reason,
        status, notes: status === 'arrived' ? 'Seen at the clinic.' : status === 'not_arrived' ? 'Did not go yet: no money for transport.' : null, madeAt: at(31), updatedAt: at(status === 'made' ? 31 : 200), rowVersion: status === 'made' ? 1 : 2 }
      visit.followUp = { followUpId: `fu-${visit.id}`, dueOn: urgent ? day(1) : day(7), reason: urgent ? 'Check they were seen at the hospital.' : 'Check they reached the liver clinic.',
        status: FOLLOW_UP_STATUS[index], notes: FOLLOW_UP_STATUS[index] === 'reached' ? 'Spoke on the phone.' : FOLLOW_UP_STATUS[index] === 'not_reached' ? 'No answer twice.' : null,
        attempts: FOLLOW_UP_STATUS[index] === 'due' ? 0 : FOLLOW_UP_STATUS[index] === 'not_reached' ? 2 : 1, updatedAt: at(32), rowVersion: FOLLOW_UP_STATUS[index] === 'due' ? 1 : 2 }
    } else if (BP_FOLLOW_UP[index]) {
      const [systolic, diastolic] = BP_FOLLOW_UP[index]
      visit.outcome = { kind: 'follow_up', reason: `Blood pressure is high (${systolic}/${diastolic} mmHg). Recheck in two weeks before referring.`, suggestedKind: 'refer', suggestedUrgency: 'routine', confirmedBy, confirmedAt: at(28) }
      visit.followUp = { followUpId: `fu-${visit.id}`, dueOn: day(index === 15 ? -1 : 14), reason: 'Recheck blood pressure.', status: FOLLOW_UP_STATUS[index], notes: null, attempts: 0, updatedAt: at(28), rowVersion: 1 }
    } else {
      visit.outcome = { kind: 'normal', reason: 'Everything checked today is in the usual range.', suggestedKind: 'normal', confirmedBy, confirmedAt: at(26) }
    }
    visit.stationsDone.push('counselling', 'results')
  }
  campaignVisits.push(visit)
}
/** Registrations made in this session (any campaign), newest first. */
const outreachRegistered = []
const replays = new Map()
const allVisits = () => [...outreachRegistered, ...campaignVisits]
const SENSITIVE_TESTS = new Set(['hbsag', 'hiv_rapid'])

/** A visit as the caller may see it: sensitive results and reasons only to counsellors and clinicians. */
function visitFor(visit) {
  const campaignId = visit.campaignId ?? HBV_CAMPAIGN_ID
  if (seesSensitive(campaignId)) return { ...visit, sensitiveHidden: false }
  const hidden = visit.tests.some(test => SENSITIVE_TESTS.has(test.testId))
  const sensitiveOutcome = visit.outcome && /hepatitis b|hiv/i.test(visit.outcome.reason)
  return { ...visit, tests: visit.tests.filter(test => !SENSITIVE_TESTS.has(test.testId)),
    outcome: visit.outcome && sensitiveOutcome ? { ...visit.outcome, reason: 'Shared by a counsellor or clinician.' } : visit.outcome,
    referral: visit.referral && sensitiveOutcome ? { ...visit.referral, reason: 'Shared by a counsellor or clinician.' } : visit.referral,
    sensitiveHidden: hidden }
}
const caseVisit = id => allVisits().find(visit => visit.id === id)
const versionOf = headers => {
  const value = headers?.get?.('if-match')
  return value == null ? null : Number(String(value).replace(/^W\//, '').replace(/"/g, ''))
}
const idemKey = (headers, body) => headers?.get?.('idempotency-key') ?? body?.localCommandId ?? null

/** The visit as registration answers it: a Health ID record made at once, identity not yet checked, and its visit code. */
function registerVisit(body) {
  const samePhone = body.phone ? allVisits().find(visit => visit.campaignId === body.campaignId && digits(visit.phone) === digits(body.phone)) : undefined
  const visit = {
    id: `ov-new-${outreachRegistered.length + 1}`, campaignId: body.campaignId ?? null, status: 'identity_resolution_pending', createdAt: iso(),
    fullName: String(body.fullName ?? '').trim(), ageYears: body.ageYears, sex: body.sex, temporaryPatientId: body.temporaryPatientId ?? `tmp_${Date.now().toString(16)}`,
    phone: body.phone ?? null, operationalNotes: body.operationalNotes ?? null, rowVersion: 1, possibleDuplicate: Boolean(samePhone),
    // Dedupe by phone: the same person registered elsewhere keeps their one Health ID record.
    healthId: samePhone?.healthId ?? newHealthId(), patientId: samePhone?.patientId ?? newPatientId(), visitCode: newVisitCode(), identityChecked: false,
    siteId: you(body.campaignId)?.siteId ?? null, stationsDone: ['register'], registeredBy: you(body.campaignId) ? { memberId: you(body.campaignId).memberId, name: you(body.campaignId).name } : null,
    vitals: [], tests: [], answers: [], outcome: null, referral: null, followUp: null,
  }
  outreachRegistered.unshift(visit)
  return visit
}

function campaignDashboard(campaignId) {
  if (pastDashboards.has(campaignId)) return pastDashboards.get(campaignId)
  const visits = allVisits().filter(visit => visit.campaignId === campaignId)
  const plan = campaignPlans.get(campaignId)
  const done = (visit, station) => visit.stationsDone.includes(station)
  const finalTest = visit => [...visit.tests].sort((a, b) => b.attempt - a.attempt).find(test => test.testId === 'hbsag')
  const high = visit => visit.vitals.some(entry => entry.readings.bp_systolic >= 140 || entry.readings.bp_diastolic >= 90)
  const order = plan?.stations ?? ['register', 'vitals', 'tests', 'counselling', 'results']
  const waiting = Object.fromEntries(order.slice(1).map((station, index) => [station,
    visits.filter(visit => done(visit, order[index]) && !done(visit, station)).length]))
  const kits = (plan?.kits ?? []).map(kit => {
    const used = visits.reduce((sum, visit) => sum + visit.tests.filter(test => test.kitId === kit.id).length, 0)
    return { kitId: kit.id, siteId: kit.siteId, testId: kit.testId, lot: kit.lot, expiresOn: kit.expiresOn, count: kit.count, used, left: kit.count - used }
  })
  const hours = new Map()
  for (const visit of visits) {
    const hour = `${visit.createdAt.slice(0, 13)}:00:00.000Z`
    const key = `${visit.siteId}|${hour}`
    hours.set(key, (hours.get(key) ?? 0) + 1)
  }
  const siteName = siteId => plan?.sites.find(site => site.id === siteId)?.name ?? 'No site'
  const alerts = []
  for (const kit of kits) {
    if (kit.left < kit.count * 0.25) alerts.push({ kind: 'kit_low', message: `${kit.left} hepatitis B kits left in lot ${kit.lot} at ${siteName(kit.siteId)}.`, siteId: kit.siteId, count: kit.left })
    if (Date.parse(kit.expiresOn) - Date.now() < 30 * DAY) alerts.push({ kind: 'kit_expiring', message: `Kit lot ${kit.lot} at ${siteName(kit.siteId)} expires on ${kit.expiresOn}.`, siteId: kit.siteId })
  }
  for (const [station, count] of Object.entries(waiting)) {
    if (count >= 5) alerts.push({ kind: 'queue_long', message: `${count} people are waiting for ${station === 'vitals' ? 'vital signs' : station}.`, count })
  }
  const invalid = visits.reduce((sum, visit) => sum + visit.tests.filter(test => test.result === 'invalid').length, 0)
  if (invalid) alerts.push({ kind: 'invalid_tests', message: `${invalid} invalid test result${invalid === 1 ? '' : 's'} today.`, count: invalid })
  const urgentWaiting = visits.filter(visit => visit.referral?.urgency === 'urgent' && visit.referral.status === 'made').length
  if (urgentWaiting) alerts.push({ kind: 'urgent_referral', message: `${urgentWaiting} urgent referral${urgentWaiting === 1 ? '' : 's'} not yet seen.`, count: urgentWaiting })
  const overdue = visits.filter(visit => visit.followUp?.status === 'due' && visit.followUp.dueOn < day(0)).length
  if (overdue) alerts.push({ kind: 'follow_up_overdue', message: `${overdue} follow-up${overdue === 1 ? ' is' : 's are'} overdue.`, count: overdue })
  const team = teamOf(campaignId)
  return {
    asOf: iso(), target: plan?.target ?? 0,
    registered: visits.length, screened: visits.filter(visit => done(visit, 'vitals') || done(visit, 'tests')).length,
    waiting,
    outcomes: {
      normal: visits.filter(visit => visit.outcome?.kind === 'normal').length,
      followUp: visits.filter(visit => visit.outcome?.kind === 'follow_up').length,
      referUrgent: visits.filter(visit => visit.outcome?.kind === 'refer' && visit.outcome.urgency === 'urgent').length,
      referRoutine: visits.filter(visit => visit.outcome?.kind === 'refer' && visit.outcome.urgency !== 'urgent').length,
      pending: visits.filter(visit => !visit.outcome).length,
    },
    byFocus: (plan?.focuses ?? []).map(focus => focus === 'hepatitis_b'
      ? { focus, screened: visits.filter(visit => finalTest(visit) && finalTest(visit).result !== 'invalid').length,
        positive: visits.filter(visit => finalTest(visit)?.result === 'positive').length,
        referred: visits.filter(visit => visit.referral && finalTest(visit)?.result === 'positive').length }
      : { focus, screened: visits.filter(visit => visit.vitals.length).length, positive: visits.filter(high).length,
        referred: visits.filter(visit => visit.referral && high(visit)).length }),
    byMember: team.filter(member => member.status !== 'invited').map(member => ({ memberId: member.memberId, name: member.name, roles: member.roles,
      registered: visits.filter(visit => visit.registeredBy?.memberId === member.memberId).length,
      screened: visits.filter(visit => visit.vitals.some(entry => entry.recordedBy === member.memberId) || visit.tests.some(entry => entry.recordedBy === member.memberId)
        || visit.outcome?.confirmedBy.memberId === member.memberId).length })),
    bySite: (plan?.sites ?? []).map(site => ({ siteId: site.id, name: site.name, registered: visits.filter(visit => visit.siteId === site.id).length,
      screened: visits.filter(visit => visit.siteId === site.id && done(visit, 'vitals')).length })),
    byHour: [...hours.entries()].map(([key, registered]) => ({ siteId: key.split('|')[0], hour: key.split('|')[1], registered })).sort((a, b) => a.hour.localeCompare(b.hour)),
    kits, alerts,
  }
}

/**
 * GET …/organisation/summary (proposed): the organisation's numbers across its campaigns, from the same counts as each
 * campaign's dashboard, so the two always agree. Counts only.
 */
function organisationSummary() {
  const month = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }).slice(0, 7)
  const monthOf = time => new Date(time).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }).slice(0, 7)
  const now = Date.now()
  const planned = [...campaignPlans.keys()].filter(id => outreachCampaignStore.some(campaign => campaign.id === id))
  const dashboards = planned.map(id => ({ plan: campaignPlans.get(id), dashboard: campaignDashboard(id) }))
  const visits = allVisits().filter(visit => visit.campaignId)
  const people = new Set(visits.map(visit => visit.patientId ?? visit.id))
  const past = [...pastDashboards.values()].reduce((sum, dash) => sum + dash.registered, 0)
  const byFocus = new Map()
  for (const { plan, dashboard } of dashboards) {
    const labelOf = focus => (plan.focuses.find(item => (typeof item === 'string' ? item : item.id) === focus)?.label) ?? null
    for (const item of plan.focuses) {
      const focus = typeof item === 'string' ? item : item.id
      const row = byFocus.get(focus) ?? { focus, label: typeof item === 'string' ? FOCUS_WORDS[focus] ?? focus : item.label, campaigns: 0, screened: 0, positive: 0, referred: 0 }
      row.campaigns += 1
      byFocus.set(focus, row)
    }
    for (const entry of dashboard.byFocus) {
      const row = byFocus.get(entry.focus) ?? { focus: entry.focus, label: entry.label ?? labelOf(entry.focus) ?? FOCUS_WORDS[entry.focus] ?? entry.focus, campaigns: 1, screened: 0, positive: 0, referred: 0 }
      row.screened += entry.screened; row.positive += entry.positive; row.referred += entry.referred
      byFocus.set(entry.focus, row)
    }
  }
  const rows = [...byFocus.values()]
  const sum = pick => dashboards.reduce((total, { dashboard }) => total + pick(dashboard), 0)
  return {
    campaigns: {
      total: outreachCampaignStore.length,
      running: outreachCampaignStore.filter(campaign => campaign.status === 'active' && Date.parse(campaign.startsAt) <= now && (!campaign.endsAt || Date.parse(campaign.endsAt) > now)).length,
      planned: outreachCampaignStore.filter(campaign => campaign.status === 'planned').length,
      closed: outreachCampaignStore.filter(campaign => campaign.status === 'closed').length,
    },
    people: { reached: people.size + past, thisMonth: visits.filter(visit => monthOf(visit.createdAt) === month).length },
    screened: sum(dash => dash.screened),
    positive: sum(dash => dash.byFocus.reduce((total, row) => total + row.positive, 0)),
    referred: sum(dash => dash.outcomes.referUrgent + dash.outcomes.referRoutine),
    byFocus: rows,
    conditions: rows.filter(row => row.focus !== 'general_check' && row.screened > 0)
      .map(row => ({ condition: row.focus, label: row.label, screened: row.screened, positive: row.positive })),
  }
}
const FOCUS_WORDS = { hepatitis_b: 'Hepatitis B', hiv: 'HIV', diabetes: 'Diabetes', hypertension: 'High blood pressure', breast_cancer: 'Breast cancer',
  cervical_cancer: 'Cervical cancer', prostate_cancer: 'Prostate cancer', malaria: 'Malaria', eye_health: 'Eye health', general_check: 'General health check' }

function teamMemberCounts(campaignId, member) {
  const visits = allVisits().filter(visit => visit.campaignId === campaignId)
  return { ...member, membershipId: undefined,
    registered: visits.filter(visit => visit.registeredBy?.memberId === member.memberId).length,
    screened: visits.filter(visit => visit.vitals.some(entry => entry.recordedBy === member.memberId) || visit.tests.some(entry => entry.recordedBy === member.memberId)
      || visit.outcome?.confirmedBy.memberId === member.memberId).length }
}

/** Outreach campaigns' proposed routes (see the top of this section). */
function outreachScreeningRoute(method, path, { body, headers } = {}) {
  const base = '/outreach/registration-cases'
  if (method === 'POST' && path === base) {
    if (!body) return NO_BODY()
    const key = idemKey(headers, body)
    if (key && replays.has(key)) return replays.get(key)
    if (body.campaignId && !outreachCampaignStore.some(campaign => campaign.id === body.campaignId)) return outreachProblem(404, 'OUTREACH_CAMPAIGN_NOT_FOUND', 'The Outreach campaign was not found')
    const answer = [201, visitFor(registerVisit(body))]
    if (key) replays.set(key, answer)
    return answer
  }
  if (method === 'GET' && path === `${base}/organisation/summary`) return [200, organisationSummary()]
  const one = method === 'GET' && new RegExp(`^${base}/(ov-[^/]+)$`).exec(path)
  if (one) { const visit = caseVisit(decodeURIComponent(one[1])); return visit ? [200, visitFor(visit)] : null }

  const campaignMatch = new RegExp(`^${base}/campaigns/([^/]+)/(plan|team|team/[^/]+|participants/search|visits/by-code/[^/]+|dashboard|follow-ups|report)$`).exec(path)
  if (campaignMatch) {
    const campaignId = decodeURIComponent(campaignMatch[1])
    const campaign = outreachCampaignStore.find(entry => entry.id === campaignId)
    if (!campaign) return outreachProblem(404, 'OUTREACH_CAMPAIGN_NOT_FOUND', 'The Outreach campaign was not found')
    const rest = campaignMatch[2]
    const coordinator = yourRoles(campaignId).includes('coordinator') || (!teamStore.has(campaignId) && (outreachMemberStore.get(campaignId) ?? []).some(member => member.membershipId === 'member-demo-1' && member.role === 'admin'))
    if (rest === 'plan') {
      const plan = campaignPlans.get(campaignId)
      if (method === 'GET') return plan ? [200, plan] : outreachProblem(404, 'OUTREACH_PLAN_NOT_FOUND', 'This campaign has no plan yet')
      if (method !== 'PUT') return null
      if (!coordinator) return outreachProblem(403, 'OUTREACH_COORDINATOR_REQUIRED', 'Only coordinators can change the plan')
      if (!body) return NO_BODY()
      if (versionOf(headers) !== (plan?.rowVersion ?? 0)) return outreachProblem(412, 'VERSION_CONFLICT', 'The plan changed; reload before saving')
      if (!Array.isArray(body.focuses) || body.focuses.length === 0 || !Array.isArray(body.sites) || body.sites.length === 0) {
        return outreachProblem(422, 'OUTREACH_PLAN_INVALID', 'A plan needs at least one focus and one site')
      }
      const saved = { ...body, campaignId, rowVersion: (plan?.rowVersion ?? 0) + 1, updatedAt: iso() }
      campaignPlans.set(campaignId, saved)
      if (!teamStore.has(campaignId)) teamStore.set(campaignId, [{ memberId: `tm-${campaignId}-1`, membershipId: 'member-demo-1', name: STAFF_NAME, phone: null,
        email: 'demo.clinician@example.test', roles: ['coordinator', 'clinician'], siteId: null, station: null, status: 'accepted', invitedAt: iso(), joinedAt: iso(), rowVersion: 1 }])
      return [200, saved]
    }
    if (rest === 'team') {
      if (method === 'GET') {
        const own = you(campaignId)
        return [200, { members: teamOf(campaignId).filter(member => member.status !== 'removed').map(member => teamMemberCounts(campaignId, member)),
          you: own ? { memberId: own.memberId, roles: demoRoles(), siteId: own.siteId, station: own.station } : null }]
      }
      if (method !== 'POST') return null
      if (!coordinator) return outreachProblem(403, 'OUTREACH_COORDINATOR_REQUIRED', 'Only coordinators can invite')
      if (!body) return NO_BODY()
      const phone = body.phone ? String(body.phone).trim() : null
      const email = body.email ? String(body.email).trim().toLowerCase() : null
      if ((!phone && !email) || (phone && !/^\+?\d{10,14}$/.test(phone.replace(/\s/g, ''))) || (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
        return outreachProblem(400, 'OUTREACH_TEAM_CONTACT_INVALID', 'Give a phone number or an email address')
      }
      if (!Array.isArray(body.roles) || body.roles.length === 0) return outreachProblem(400, 'VALIDATION_FAILED', 'Choose at least one role')
      const team = teamOf(campaignId)
      const existing = team.find(member => member.status !== 'removed' && ((phone && digits(member.phone) === digits(phone)) || (email && member.email === email)))
      if (existing) return [200, teamMemberCounts(campaignId, existing)]
      const created = { memberId: `tm-${campaignId}-${team.length + 1}`, name: body.name ?? null, phone, email, roles: body.roles, siteId: body.siteId ?? null,
        station: body.station ?? null, status: 'invited', invitedAt: iso(), joinedAt: null, rowVersion: 1 }
      teamStore.set(campaignId, [...team, created])
      return [201, teamMemberCounts(campaignId, created)]
    }
    if (rest.startsWith('team/')) {
      const member = teamOf(campaignId).find(entry => entry.memberId === decodeURIComponent(rest.slice(5)))
      if (!member || member.status === 'removed') return outreachProblem(404, 'OUTREACH_TEAM_MEMBER_NOT_FOUND', 'That team member was not found')
      if (method !== 'PATCH' && method !== 'DELETE') return null
      if (!coordinator) return outreachProblem(403, 'OUTREACH_COORDINATOR_REQUIRED', 'Only coordinators can change the team')
      if (versionOf(headers) !== member.rowVersion) return outreachProblem(412, 'VERSION_CONFLICT', 'The team member changed; reload before retrying')
      const coordinators = teamOf(campaignId).filter(entry => entry.status !== 'removed' && entry.roles.includes('coordinator'))
      const losesCoordinator = member.roles.includes('coordinator') && coordinators.length === 1
        && (method === 'DELETE' || (Array.isArray(body?.roles) && !body.roles.includes('coordinator')))
      if (losesCoordinator) return outreachProblem(409, 'OUTREACH_TEAM_LAST_COORDINATOR', 'A campaign needs a coordinator')
      if (method === 'DELETE') { member.status = 'removed'; member.rowVersion += 1; return [204, null] }
      if (!body) return NO_BODY()
      if (body.roles !== undefined) member.roles = body.roles
      if (body.siteId !== undefined) member.siteId = body.siteId
      if (body.station !== undefined) member.station = body.station
      member.rowVersion += 1
      return [200, teamMemberCounts(campaignId, member)]
    }
    if (rest === 'participants/search') {
      // A POST with the phone or Health ID in the body: personal data never goes in the address or the logs.
      if (method !== 'POST') return null
      const phone = body?.phone ? String(body.phone) : null
      const healthId = body?.healthId ? String(body.healthId) : null
      if (!phone === !healthId) return outreachProblem(400, 'OUTREACH_SEARCH_INVALID', 'Search by a phone number or a Health ID')
      const found = allVisits().filter(visit => phone ? digits(visit.phone) === digits(phone) && digits(phone).length === 10 : visit.healthId === String(healthId).trim().toUpperCase())
      const matches = found.map(visit => ({ matchId: `match-${visit.patientId}`, initials: visit.fullName.split(/\s+/).map(part => part[0]).join('').toUpperCase(),
        ageYears: visit.ageYears, sex: visit.sex, maskedPhone: maskPhone(visit.phone), hasHealthId: true, inThisCampaign: visit.campaignId === campaignId,
        caseId: visit.campaignId === campaignId ? visit.id : null, visitCode: visit.campaignId === campaignId ? visit.visitCode : null }))
      // Someone with a Health ID who has never been to this campaign: 0803 000 0001 or HID-KNOWN001.
      if (!matches.length && (digits(phone) === '8030000001' || healthId === 'HID-KNOWN001')) {
        matches.push({ matchId: 'match-known-1', initials: 'AO', ageYears: 35, sex: 'female', maskedPhone: '•••• ••• 0001', hasHealthId: true, inThisCampaign: false, caseId: null, visitCode: null })
      }
      return [200, { matches }]
    }
    if (method !== 'GET') return null
    if (rest.startsWith('visits/by-code/')) {
      const code = decodeURIComponent(rest.slice('visits/by-code/'.length)).toUpperCase()
      const visit = allVisits().find(entry => entry.campaignId === campaignId && entry.visitCode === code)
      return visit ? [200, visitFor(visit)] : outreachProblem(404, 'OUTREACH_VISIT_NOT_FOUND', 'No visit has this code in this campaign')
    }
    if (rest === 'dashboard') return [200, campaignDashboard(campaignId)]
    if (rest === 'follow-ups') {
      const sensitive = seesSensitive(campaignId)
      const items = allVisits().filter(visit => visit.campaignId === campaignId && visit.followUp).map(visit => {
        const private_ = /hepatitis b|hiv|liver/i.test(`${visit.followUp.reason} ${visit.referral?.reason ?? ''}`)
        const hide = private_ && !sensitive
        return { caseId: visit.id, visitCode: visit.visitCode, fullName: visit.fullName, phone: visit.phone, siteId: visit.siteId,
          followUp: hide ? { ...visit.followUp, reason: 'Follow-up' } : visit.followUp,
          referral: visit.referral ? { ...visit.referral, reason: hide ? 'Shared by a counsellor or clinician.' : visit.referral.reason,
            partnerName: campaignPlans.get(campaignId)?.partners.find(partner => partner.id === visit.referral.partnerId)?.name ?? null } : null,
          sensitive: private_ }
      }).sort((a, b) => a.followUp.dueOn.localeCompare(b.followUp.dueOn))
      return [200, { items }]
    }
    if (rest === 'report') {
      const visits = allVisits().filter(visit => visit.campaignId === campaignId)
      const dash = campaignDashboard(campaignId)
      const plan = campaignPlans.get(campaignId)
      const band = age => age < 18 ? 'Under 18' : age < 30 ? '18 to 29' : age < 45 ? '30 to 44' : age < 60 ? '45 to 59' : '60 and over'
      return [200, {
        campaignName: campaign.name, organisationName: plan?.organisationName ?? '', startsOn: campaign.startsAt.slice(0, 10), endsOn: campaign.endsAt ? campaign.endsAt.slice(0, 10) : null,
        sites: (plan?.sites ?? []).map(site => ({ siteId: site.id, name: site.name, lga: site.lga, ...dash.bySite.find(entry => entry.siteId === site.id) })).map(({ siteId, name, lga, registered, screened }) => ({ siteId, name, lga, registered, screened })),
        target: dash.target, registered: dash.registered, screened: dash.screened,
        bySex: { female: visits.filter(visit => visit.sex === 'female').length, male: visits.filter(visit => visit.sex === 'male').length,
          other: visits.filter(visit => visit.sex !== 'female' && visit.sex !== 'male').length },
        byAgeBand: ['Under 18', '18 to 29', '30 to 44', '45 to 59', '60 and over'].map(name => ({ band: name, count: visits.filter(visit => band(visit.ageYears) === name).length })),
        byFocus: dash.byFocus, outcomes: dash.outcomes,
        referrals: { made: visits.filter(visit => visit.referral).length, arrived: visits.filter(visit => visit.referral?.status === 'arrived').length,
          notArrived: visits.filter(visit => visit.referral?.status === 'not_arrived').length, waiting: visits.filter(visit => visit.referral?.status === 'made').length },
        followUps: { due: visits.filter(visit => visit.followUp?.status === 'due').length, reached: visits.filter(visit => visit.followUp?.status === 'reached').length,
          notReached: visits.filter(visit => visit.followUp?.status === 'not_reached').length, closed: visits.filter(visit => visit.followUp?.status === 'closed').length },
        kitsUsed: dash.kits.reduce((sum, kit) => sum + kit.used, 0),
        invalidTests: visits.reduce((sum, visit) => sum + visit.tests.filter(test => test.result === 'invalid').length, 0),
        smallCountThreshold: 5,
      }]
    }
    return null
  }

  const caseMatch = new RegExp(`^${base}/([^/]+)/(vitals|tests|answers|outcome|referral|follow-up|consent-code|consent-code/verify|slip-sms)$`).exec(path)
  if (!caseMatch || caseMatch[1] === 'campaigns') return null
  if (method !== 'POST' && method !== 'PATCH') return null
  const visit = caseVisit(decodeURIComponent(caseMatch[1]))
  if (!visit) return outreachProblem(404, 'OUTREACH_VISIT_NOT_FOUND', 'The visit was not found')
  if (!body) return NO_BODY()
  const kind = caseMatch[2]
  const key = idemKey(headers, body)
  const replayKey = key ? `${visit.id}|${kind}|${key}` : null
  if (replayKey && replays.has(replayKey)) return replays.get(replayKey)
  const remember = answer => { if (replayKey) replays.set(replayKey, answer); return answer }
  const campaignId = visit.campaignId ?? HBV_CAMPAIGN_ID
  const by = you(campaignId)?.memberId ?? null
  const plan = campaignPlans.get(campaignId)
  const addStation = (...stations) => { for (const station of stations) if (!visit.stationsDone.includes(station)) visit.stationsDone.push(station) }
  const bump = () => { visit.rowVersion += 1 }
  if (method === 'POST' && kind === 'vitals') {
    visit.vitals.push({ entryId: `${visit.id}-v${visit.vitals.length + 1}`, ...body, recordedBy: by })
    addStation('vitals'); bump()
    return remember([201, visitFor(visit)])
  }
  if (method === 'POST' && kind === 'tests') {
    const results = Array.isArray(body.results) ? body.results : []
    if (results.some(result => SENSITIVE_TESTS.has(result.testId)) && !seesSensitive(campaignId) && !yourRoles(campaignId).includes('tester')) {
      return outreachProblem(403, 'OUTREACH_SENSITIVE_ROLE_REQUIRED', 'Only counsellors, clinicians and testers record this test')
    }
    if (results.some(result => result.testId === 'hiv_rapid') && !body.consent) return outreachProblem(422, 'OUTREACH_HIV_CONSENT_REQUIRED', 'HIV testing needs its own consent')
    for (const result of results) {
      const kit = result.kitLot ? plan?.kits.find(entry => entry.lot === result.kitLot && entry.testId === result.testId && (!visit.siteId || entry.siteId === visit.siteId)) : null
      if (result.kitLot && !kit) return outreachProblem(422, 'OUTREACH_KIT_UNKNOWN', 'That kit lot is not in the plan')
      if (kit && kit.expiresOn < day(0)) return outreachProblem(422, 'OUTREACH_KIT_EXPIRED', 'That kit lot has expired')
      const option = plan?.package.tests.find(test => test.id === result.testId)?.results.find(entry => entry.value === result.result)
      visit.tests.push({ entryId: `${visit.id}-t${visit.tests.length + 1}`, ...result, kitId: kit?.id ?? result.kitId ?? null, flag: option?.flag ?? 'normal', recordedBy: by })
    }
    addStation('tests'); bump()
    return remember([201, visitFor(visit)])
  }
  if (method === 'POST' && kind === 'answers') {
    const answers = new Map(visit.answers.map(answer => [answer.questionId, answer]))
    for (const answer of body.answers ?? []) answers.set(answer.questionId, answer)
    visit.answers = [...answers.values()]; bump()
    return remember([201, visitFor(visit)])
  }
  if (method === 'POST' && kind === 'outcome') {
    if (!yourRoles(campaignId).some(role => role === 'counsellor' || role === 'clinician')) return outreachProblem(403, 'OUTREACH_OUTCOME_ROLE_REQUIRED', 'Only a counsellor or clinician confirms the outcome')
    if (body.kind === 'refer' && !body.urgency) return outreachProblem(400, 'VALIDATION_FAILED', 'A referral needs its urgency')
    visit.outcome = { ...body, confirmedBy: { memberId: by, name: you(campaignId)?.name ?? null, roles: yourRoles(campaignId) }, confirmedAt: iso() }
    addStation('counselling', 'results'); bump()
    return remember([201, visit.outcome])
  }
  if (kind === 'referral') {
    if (method === 'POST') {
      if (!plan?.partners.some(partner => partner.id === body.partnerId)) return outreachProblem(422, 'OUTREACH_PARTNER_UNKNOWN', 'Choose a partner from the plan')
      visit.referral = { referralId: `ref-${visit.id}`, ...body, status: 'made', notes: null, madeAt: iso(), updatedAt: iso(), rowVersion: 1 }
      bump()
      return remember([201, visit.referral])
    }
    if (!visit.referral) return outreachProblem(404, 'OUTREACH_REFERRAL_NOT_FOUND', 'This visit has no referral')
    if (versionOf(headers) !== visit.referral.rowVersion) return outreachProblem(412, 'VERSION_CONFLICT', 'The referral changed; reload before retrying')
    visit.referral = { ...visit.referral, status: body.status ?? visit.referral.status, notes: body.notes ?? visit.referral.notes, updatedAt: iso(), rowVersion: visit.referral.rowVersion + 1 }
    return remember([200, visit.referral])
  }
  if (kind === 'follow-up') {
    if (method === 'POST') {
      visit.followUp = { followUpId: `fu-${visit.id}`, ...body, status: 'due', notes: null, attempts: 0, updatedAt: iso(), rowVersion: 1 }
      bump()
      return remember([201, visit.followUp])
    }
    if (!visit.followUp) return outreachProblem(404, 'OUTREACH_FOLLOW_UP_NOT_FOUND', 'This visit has no follow-up')
    if (versionOf(headers) !== visit.followUp.rowVersion) return outreachProblem(412, 'VERSION_CONFLICT', 'The follow-up changed; reload before retrying')
    const tried = body.status === 'reached' || body.status === 'not_reached'
    visit.followUp = { ...visit.followUp, status: body.status ?? visit.followUp.status, notes: body.notes ?? visit.followUp.notes, dueOn: body.dueOn ?? visit.followUp.dueOn,
      attempts: visit.followUp.attempts + (tried ? 1 : 0), updatedAt: iso(), rowVersion: visit.followUp.rowVersion + 1 }
    return remember([200, visit.followUp])
  }
  if (method !== 'POST') return null
  if (kind === 'consent-code') {
    if (!visit.phone) return outreachProblem(422, 'OUTREACH_PHONE_REQUIRED', 'This registration has no phone number')
    return remember([201, { challengeId: `consent-${visit.id}-${body.purpose ?? 'registration'}`, sentTo: maskPhone(visit.phone), expiresAt: iso(10 * MIN), resendAfterSeconds: 60 }])
  }
  if (kind === 'consent-code/verify') {
    if (body.code !== '123456') return outreachProblem(400, 'OTP_INVALID', 'That code is not right')
    const purpose = String(body.challengeId ?? '').endsWith('-hiv') ? 'hiv' : 'registration'
    return remember([201, { consentId: `consent-record-${visit.id}-${purpose}`, purpose, method: 'code', language: 'en', version: plan?.consent.version ?? '2026-11-13',
      recordedBy: by, witnessName: null, guardianName: null, recordedAt: iso() }])
  }
  if (kind === 'slip-sms') {
    if (!visit.phone) return outreachProblem(422, 'OUTREACH_PHONE_REQUIRED', 'This registration has no phone number')
    return remember([201, { sentTo: maskPhone(visit.phone), deliveryOutcome: 'accepted' }])
  }
  return null
}


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
    'platform.admin.access', 'platform.audit.read', 'platform.control.manage', 'platform.control.read', 'platform.dashboard.read',
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

/** `GET /admin/overview/activity?days=` sample: names, emails and Health IDs already shortened, and uploads named by kind only, as the backend sends them. */
function adminActivity(days) {
  const scale = days / 30
  const n = value => Math.round(value * scale)
  const daily = Array.from({ length: days }, (_, index) => {
    const date = new Date(now().getTime() - (days - 1 - index) * DAY).toISOString().slice(0, 10)
    return { date, signups: 1 + ((index * 7) % 5) + Math.floor(index / Math.max(1, days / 4)), activeAccounts: 70 + ((index * 13) % 40) + index }
  })
  return {
    days, generatedAt: iso(),
    people: { accounts: 341, verifiedPct: 96, profilesCompletePct: 78, activeInPeriod: Math.min(341, n(188)), sharedWithFacility: 214, accessPins: 146, newInPeriod: n(64), prevNewInPeriod: n(53) },
    care: { healthRecords: n(1184), visits: n(486), labRequests: n(212), prescriptions: n(174), emergencyAccess: n(31), outreachSignups: n(58) },
    migrateAsk: { pagesRead: n(1140), recordsMoved: n(642), questionsAnswered: null, answersWithSourcesPct: 97 },
    daily,
    recentSignups: [
      { name: 'Amina Y.', email: 'am***@gmail.com', healthId: 'HID-7K…M9', profilePct: 100, status: 'verified', createdAt: iso(-12 * MIN) },
      { name: 'Chukwudi E.', email: 'ch***@yahoo.com', healthId: 'HID-Q4…X2', profilePct: 86, status: 'verified', createdAt: iso(-48 * MIN) },
      { name: 'Folake B.', email: 'fo***@gmail.com', healthId: 'HID-M9…A4', profilePct: 100, status: 'verified', createdAt: iso(-2 * 60 * MIN) },
      { name: 'Ibrahim A.', email: 'ib***@outlook.com', healthId: 'HID-3T…K7', profilePct: 72, status: 'pending', createdAt: iso(-3 * 60 * MIN) },
      { name: 'Ngozi O.', email: 'ng***@gmail.com', healthId: 'HID-W8…P1', profilePct: 58, status: 'pending', createdAt: iso(-5 * 60 * MIN) },
    ],
    recentUploads: [
      { document: 'PDF', patient: 'Amina Y.', facility: 'Pilot hospital', sizeBytes: 1258291, scan: 'clean', createdAt: iso(-20 * MIN) },
      { document: 'Word', patient: 'Chukwudi E.', facility: 'Pilot hospital', sizeBytes: 655360, scan: 'clean', createdAt: iso(-60 * MIN) },
      { document: 'Image', patient: 'Folake B.', facility: 'Pilot clinic', sizeBytes: 3565158, scan: 'pending', createdAt: iso(-2 * 60 * MIN) },
      { document: 'Image', patient: 'Ibrahim A.', facility: 'Pilot clinic', sizeBytes: 839680, scan: 'clean', createdAt: iso(-4 * 60 * MIN) },
    ],
  }
}

function adminRoute(method, path, request = {}) {
  if (method === 'GET' && path === '/admin/overview/activity') {
    const days = Number(request.query?.get?.('days') ?? 30)
    return [7, 30, 90].includes(days) ? [200, adminActivity(days)] : [400, { code: 'VALIDATION_FAILED', status: 400, detail: 'days must be 7, 30 or 90' }]
  }
  if (method === 'GET' && path === '/admin/operations/health') return [200, { services: [
    { name: 'identity-api', availabilityPct: 99.98, p50Ms: 182, p95Ms: 412 }, { name: 'ehr-api', availabilityPct: 99.97, p50Ms: 164, p95Ms: 390 },
  ], messagesDelivered: 99.9, documentsScanned: 1140, source: 'cloudwatch' }]
  // Error reporting is not connected in the sample, as on a fresh install: the overview shows "Not set up yet".
  if (method === 'GET' && path === '/admin/operations/errors') return [503, { code: 'not_configured', status: 503, detail: 'Error reporting is not set up' }]
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
    case '/admin/controls': return [200, [{ controlKey: 'maintenance_mode', enabled: false, reason: 'Normal operation', updatedAt: '2026-10-01T09:00:00.000Z', version: 3 },
      // Open sign-up on outreach.: seeded off.
      { controlKey: 'outreach_organiser_signup_enabled', enabled: false, reason: 'Seeded off', updatedAt: '2026-11-11T09:00:00.000Z', version: 1 }]]
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
  const hit = (workspace === 'admin' ? adminOutreachRoute(method, path, request) : null)
    ?? (workspace === 'provider' ? registrationRoute(method, path, request) ?? labRoute(method, path, request)
    ?? outreachScreeningRoute(method, path, request) ?? outreachCampaignRoute(method, path, request) ?? outreachSignupRoute(method, path, request) ?? pointOfCareRoute(method, path, request) : null)
    ?? handler(method, path, request)
  return hit ? { status: hit[0], body: hit[1], headers: {} } : null
}

export function notServed(method, path) {
  return { type: 'about:blank', title: 'NOT_FOUND', status: 404, code: 'NOT_FOUND', detail: `Mock gateway does not serve ${method} ${path}` }
}
