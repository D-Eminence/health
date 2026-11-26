import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type * as BlueRoutes from '../../../../ehr-blue/routes'
import {
  DEMO_HOSPITAL, REAL_FACILITY, SESSION, facility, json, openStaffApp, problem, serve, sessionAt, where, type Sent,
} from '../../frame/blueHarness'
import { forgetReferralsServed } from '../../../../ehr-blue/departments/referrals/referralRules'
import { resetSampleStore } from '../../../../ehr-blue/clinical/sample/SampleWorkspace'

/*
 * Referrals between facilities (hid-system REF-1, 0191-0193) inside the blue EHR's real frame, joined as
 * departments/pages.ts joins it: listed under Network & Services for the codes the backend gives, each tab for its own
 * code, reading and answering referrals with the contract's bodies and headers, every date and time in Lagos while the
 * device is set to New York, never a Health ID in an address and never the word "permission" on screen. Switched off
 * (503) or not served (404), a real facility is told referrals are not available yet and a demo facility keeps today's
 * sample. Every account, facility, patient and reference is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeAll(() => { process.env.TZ = 'America/New_York' })
beforeEach(() => {
  resetSampleStore()
  vi.doMock('../../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../../ehr-blue/frame/pages')
    const home = await import('../../../../ehr-blue/home/pages')
    const { referralsPage } = await import('../../../../ehr-blue/departments/referrals/page')
    return {
      ...actual,
      BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home, './departments/pages.ts': { pages: [referralsPage] } }),
    }
  })
})
afterEach(() => { forgetReferralsServed(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const REFERRAL = 'a0000000-0000-4000-8000-00000000a001'
const PATIENT = 'b0000000-0000-4000-8000-00000000b001'
const OTHER = 'f0000000-0000-4000-8000-0000000000c1'
const SENT = 'GET /api/v1/ehr/referrals/sent'
const INCOMING = 'GET /api/v1/ehr/referrals/incoming'
const RECEIVED = 'GET /api/v1/ehr/referrals/received'
const EXPECTED = 'GET /api/v1/ehr/referrals/expected'
const READ = `GET /api/v1/ehr/referrals/${REFERRAL}`
const LETTER = `GET /api/v1/ehr/referrals/${REFERRAL}/letter`
const ACCEPT = `POST /api/v1/ehr/referrals/${REFERRAL}/accept`
const DECLINE = `POST /api/v1/ehr/referrals/${REFERRAL}/decline`
const WITHDRAW = `POST /api/v1/ehr/referrals/${REFERRAL}/withdraw`
const ARRIVE = `POST /api/v1/ehr/referrals/${REFERRAL}/arrive`
const COMPLETE = `POST /api/v1/ehr/referrals/${REFERRAL}/complete`
const SEARCH = 'POST /api/v1/identity/patient-search'
const NAMES = 'GET /api/v1/identity/facility-staff-names'
const DOCTOR = ['ehr.referral.read', 'ehr.referral.send', 'ehr.referral.receive', 'ehr.referral.arrive', 'ehr.encounter.read',
  'ehr.encounter.write', 'identity.patient.read']
const FRONT_DESK = ['ehr.referral.arrive', 'ehr.encounter.read', 'ehr.encounter.write', 'identity.registration.write', 'identity.patient.read']
const MATCH_REF = `psr_${'R'.repeat(43)}`
const nav = () => screen.getByRole('navigation', { name: 'Main navigation' })
const doctorAt = (id = REAL_FACILITY, permissions = DOCTOR, roles = ['doctor']) => facility(id, id === REAL_FACILITY ? 'Fictional General Hospital' : 'Demo Hospital', permissions, roles)

function card(overrides: Record<string, unknown> = {}) {
  return {
    referralId: REFERRAL, reference: '3F2A9C1B', side: 'sent', viewLevel: 'full',
    patient: { patientId: PATIENT, fullName: 'Ngozi Referone', sex: 'female', dateOfBirth: '1979-04-02', dateOfBirthEstimated: false,
      healthIdLast4: 'RF21', sexAtSend: 'female', ageYearsAtSend: 47 },
    destinationKind: 'health_id',
    referringFacility: { facilityId: REAL_FACILITY, name: 'Fictional General Hospital' },
    receivingFacility: { facilityId: OTHER, name: 'Fictional Teaching Hospital' },
    printedFacility: null, encounterId: 'e0000000-0000-4000-8000-00000000e001', departmentCode: 'cardiology', serviceWanted: 'Cardiology clinic',
    urgency: 'routine', reason: 'New heart murmur with breathlessness on exertion',
    referrer: { name: 'Dr Ada Example', licence: { body: 'MDCN', number: 'MDCN/12345' }, membershipId: `member-${REAL_FACILITY}` },
    state: 'sent', effectiveState: 'sent', endedKind: null,
    // 23:10 UTC is 00:10 the next day in Lagos, and 18:10 the same day in New York: Lagos's is shown.
    sentAt: '2026-12-02T23:10:00.000Z', respondBy: '2026-12-09T23:10:00.000Z',
    acceptedAt: null, acceptNote: null, arriveBy: null, arrivedAt: null, visitQueueEntryId: null,
    decline: null, withdrawal: null, outcome: null, completedAt: null, endedAt: null, accessEndsAt: null,
    packageSummary: [{ kind: 'diagnoses', count: 2 }, { kind: 'medicines', count: 1 }], rowVersion: 1, ...overrides,
  }
}
/** As the receiving facility reads a referral waiting for its answer: sex and age only (Q-REF-8 A). */
function preview(overrides: Record<string, unknown> = {}) {
  return card({
    side: 'received', viewLevel: 'preview', encounterId: null, packageSummary: null,
    patient: { patientId: null, fullName: null, sex: null, dateOfBirth: null, dateOfBirthEstimated: null, healthIdLast4: null, sexAtSend: 'female', ageYearsAtSend: 47 },
    referringFacility: { facilityId: OTHER, name: 'Fictional Clinic Ikeja' },
    receivingFacility: { facilityId: REAL_FACILITY, name: 'Fictional General Hospital' },
    referrer: { name: 'Dr Bola Sender', licence: null, membershipId: null }, urgency: 'urgent', ...overrides,
  })
}
const PACKAGE = {
  frozenAt: '2026-12-02T23:10:00.000Z', letterText: 'Dear colleague,\nPlease see this patient.',
  sections: {
    diagnoses: [{ itemId: 'i1', enteredInErrorSinceSent: false, content: { codeSystem: 'ICD-11', code: 'MC81', display: 'Heart murmur', clinicalStatus: 'active',
      verificationStatus: 'provisional', onsetAt: null, recordedAt: '2026-12-01T10:00:00.000Z' } },
    { itemId: 'i2', enteredInErrorSinceSent: true, content: null }],
    vitals: [{ itemId: 'i3', enteredInErrorSinceSent: false, content: { recordedAt: '2026-12-02T22:30:00.000Z', measures: { pulseBpm: 96, systolicMmhg: 150, diastolicMmhg: 95 } } }],
  },
}
const readOf = (referral: unknown, extra: Record<string, unknown> = {}) => () => json({ referral, package: null, packageHidden: null, history: [], ...extra })
const listOf = (...items: unknown[]) => () => json({ items, nextCursor: null })
const notServed = () => problem(503, 'REFERRALS_NOT_AVAILABLE', 'Referrals are not available yet.')

function directCare(sent: readonly Sent[], route: string) {
  const call = sent.find(item => item.route === route)!
  expect(call.headers.get('X-Purpose-Of-Use')).toBe('direct-care')
  expect(call.headers.get('X-Facility-ID')).toBe(REAL_FACILITY)
}
/** No request carried a Health ID, a matchRef or a patient's name in its address. */
function noIdentityInAddresses() {
  for (const [url] of vi.mocked(fetch).mock.calls) expect(String(url)).not.toMatch(/HID-|psr_|Referone|healthId/i)
}
const bodyOf = (sent: readonly Sent[], route: string, index = 0) => sent.filter(item => item.route === route)[index]!.body as Record<string, unknown>
const keyOf = (sent: readonly Sent[], route: string, index = 0) => sent.filter(item => item.route === route)[index]!.headers.get('Idempotency-Key')
const noPermissionWord = () => expect(document.body.textContent).not.toMatch(/permission/i)

describe('Referrals in the frame', () => {
  it('is listed under Network & Services and opens on Sent, in Lagos time, with direct care headers', async () => {
    const doctor = doctorAt()
    const sent = serve({ [SESSION]: [sessionAt(doctor, [doctor])], [SENT]: [listOf(card({ reason: null }))] })
    await openStaffApp('/provider/referrals')
    expect(await screen.findByRole('heading', { level: 1, name: 'Referrals' })).toBeDefined()
    await waitFor(() => expect(where()).toBe('/provider/referrals/sent'))
    expect(within(nav()).getByRole('link', { name: 'Referrals' }).getAttribute('href')).toBe('/provider/referrals')
    const tabs = screen.getByRole('navigation', { name: 'Referrals' })
    expect(within(tabs).getAllByRole('link').map(link => link.textContent)).toEqual(['Sent', 'Incoming', 'Received', 'Expected arrivals'])
    const row = await screen.findByRole('listitem', { name: 'Ngozi Referone' })
    expect(within(row).getByText('To Fictional Teaching Hospital')).toBeDefined()
    expect(within(row).getByText('Cardiology · Cardiology clinic')).toBeDefined()
    expect(within(row).getByText('Sent 3 Dec 2026, 00:10')).toBeDefined()
    expect(within(row).getByText('Waiting for an answer')).toBeDefined()
    expect(within(row).getByRole('link', { name: 'Ngozi Referone' }).getAttribute('href')).toBe(`/provider/referrals/${REFERRAL}`)
    directCare(sent, SENT)
    noPermissionWord()
    noIdentityInAddresses()
  })

  it('gives the front desk Expected arrivals only, and a lab scientist nothing, without reading', async () => {
    const desk = facility(REAL_FACILITY, 'Fictional General Hospital', FRONT_DESK, ['receptionist'])
    serve({ [SESSION]: [sessionAt(desk, [desk])], [EXPECTED]: [() => json({ items: [], hasMore: false, limit: 200 })] })
    await openStaffApp('/provider/referrals')
    await waitFor(() => expect(where()).toBe('/provider/referrals/expected'))
    expect(await screen.findByText('No referred patients expected')).toBeDefined()
    expect(within(screen.getByRole('navigation', { name: 'Referrals' })).getAllByRole('link').map(link => link.textContent)).toEqual(['Expected arrivals'])
  })

  it('tells a member with no referral code who can use referrals, and lists nothing', async () => {
    const lab = facility(REAL_FACILITY, 'Fictional General Hospital', ['lab.work-item.read', 'identity.patient.read'], ['lab'])
    const sent = serve({ [SESSION]: [sessionAt(lab, [lab])] })
    await openStaffApp('/provider/referrals')
    expect(await screen.findByText('Only the front desk, clinicians and doctors of this facility can use referrals.')).toBeDefined()
    expect(within(nav()).queryByRole('link', { name: 'Referrals' })).toBeNull()
    expect(sent.filter(call => call.route.includes('referral'))).toEqual([])
    noPermissionWord()
  })

  it('says referrals are not available yet when they are switched off, and stops listing them', async () => {
    const doctor = doctorAt()
    serve({ [SESSION]: [sessionAt(doctor, [doctor])], [SENT]: [notServed, notServed, notServed] })
    await openStaffApp('/provider/referrals/sent')
    expect(await screen.findByText('Referrals are not available yet.')).toBeDefined()
    expect(screen.getByText(/keep using your paper referral letters/)).toBeDefined()
    await waitFor(() => expect(within(nav()).queryByRole('link', { name: 'Referrals' })).toBeNull())
    expect(screen.queryAllByText(/Sample only/)).toEqual([])
  })

  it('says the same on an ehr-api without the routes (404)', async () => {
    const doctor = doctorAt()
    const missing = () => problem(404, 'NOT_FOUND', 'Cannot GET /api/v1/ehr/referrals/sent')
    serve({ [SESSION]: [sessionAt(doctor, [doctor])], [SENT]: [missing, missing, missing] })
    await openStaffApp('/provider/referrals/sent')
    expect(await screen.findByText('Referrals are not available yet.')).toBeDefined()
  })

  it('keeps today’s sample at a demo facility while referrals are switched off', async () => {
    const doctor = doctorAt(DEMO_HOSPITAL)
    serve({ [SESSION]: [sessionAt(doctor, [doctor])], [SENT]: [notServed, notServed, notServed] })
    await openStaffApp('/provider/referrals')
    expect((await screen.findAllByText(/Sample only/)).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Referral Network' })).toBeDefined()
    // The live tab's address is not a sample record: the sample's list opens.
    await waitFor(() => expect(where()).toBe('/provider/referrals'))
  })

  it('keeps today’s sample at a demo facility for a doctor without the referral codes, and reads nothing', async () => {
    const doctor = doctorAt(DEMO_HOSPITAL, ['ehr.encounter.read', 'ehr.encounter.write', 'identity.patient.read'])
    const sent = serve({ [SESSION]: [sessionAt(doctor, [doctor])] })
    await openStaffApp('/provider/referrals')
    expect((await screen.findAllByText(/Sample only/)).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Referral Network' })).toBeDefined()
    expect(sent.filter(call => call.route.includes('referral'))).toEqual([])
  })

  it('shows Incoming with the waiting count and only sex and age, then accepts with one key and reads the referral again', async () => {
    const doctor = doctorAt()
    const accepted = preview({ viewLevel: 'full', state: 'accepted', effectiveState: 'accepted', acceptedAt: '2026-12-03T08:00:00.000Z',
      arriveBy: '2027-03-03T08:00:00.000Z', accessEndsAt: '2027-04-02T08:00:00.000Z', acceptNote: 'Come on Tuesday.',
      patient: card().patient, packageSummary: [{ kind: 'diagnoses', count: 2 }], rowVersion: 2 })
    const sent = serve({
      [SESSION]: [sessionAt(doctor, [doctor])],
      [INCOMING]: [() => json({ items: [preview()], counts: { waiting: 1, urgent: 1 }, hasMore: false, limit: 200 })],
      [READ]: [readOf(preview(), { packageHidden: 'not_accepted', history: [{ kind: 'sent', at: '2026-12-02T23:10:00.000Z', side: 'referring', byMembershipId: null, reasonCode: null }] }),
        readOf(accepted, { package: PACKAGE, history: [
          { kind: 'sent', at: '2026-12-02T23:10:00.000Z', side: 'referring', byMembershipId: null, reasonCode: null },
          { kind: 'accepted', at: '2026-12-03T08:00:00.000Z', side: 'receiving', byMembershipId: `member-${REAL_FACILITY}`, reasonCode: null }] })],
      [ACCEPT]: [() => problem(503, 'SERVICE_UNAVAILABLE', 'Try again.'), () => json({ referral: accepted, package: PACKAGE, replayed: true })],
    })
    await openStaffApp('/provider/referrals/incoming')
    const row = await screen.findByRole('listitem', { name: 'Patient: Female, 47 years' })
    expect(within(row).getByText('From Fictional Clinic Ikeja')).toBeDefined()
    expect(within(row).getByText('Answer by 10 Dec 2026, 00:10')).toBeDefined()
    expect(within(row).getByText('Reason: New heart murmur with breathlessness on exertion')).toBeDefined()
    expect(within(row).getByText('Urgent').getAttribute('data-tone')).toBe('critical')
    expect(screen.getByText('1 waiting, 1 urgent')).toBeDefined()
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Referrals' })).getByRole('link', { name: 'Incoming (1)' })).toBeDefined())
    expect(document.body.textContent).not.toContain('Ngozi')

    fireEvent.click(within(row).getByRole('link', { name: 'Patient: Female, 47 years' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Referral 3F2A9C1B' })).toBeDefined()
    expect(screen.getByText('What was sent shows once you accept the referral.')).toBeDefined()
    expect(screen.getByText('Dr Bola Sender (Licence not on record)')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    fireEvent.change(screen.getByLabelText('Note to the referring facility (optional)'), { target: { value: 'Come on Tuesday.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Accept referral' }))
    expect(await screen.findByText('The referral could not be accepted. Try again.')).toBeDefined()
    // The same body again after no answer: the same Idempotency-Key, so the server answers its first answer.
    fireEvent.click(screen.getByRole('button', { name: 'Accept referral' }))
    expect(await screen.findByText(/^Accepted\. The referring facility and the patient are told/)).toBeDefined()
    expect(bodyOf(sent, ACCEPT)).toEqual({ expectedRowVersion: 1, note: 'Come on Tuesday.' })
    expect(keyOf(sent, ACCEPT, 0)).toBeTruthy()
    expect(keyOf(sent, ACCEPT, 1)).toBe(keyOf(sent, ACCEPT, 0))
    directCare(sent, ACCEPT)
    // Read again: the package and the patient now show, and the history names "You".
    expect(await screen.findByText('Heart murmur · ICD-11 MC81 · Provisional')).toBeDefined()
    expect(screen.getByText('Marked entered in error since it was sent: not shown.')).toBeDefined()
    expect(screen.getByText('2 Dec 2026, 23:30: Blood pressure 150/95 mmHg · Pulse 96 bpm')).toBeDefined()
    expect(screen.getByText(/^Ngozi Referone · Female · Born 2 Apr 1979 · Health ID ending •••• RF21$/)).toBeDefined()
    expect(screen.getByText('You')).toBeDefined()
    noPermissionWord()
    noIdentityInAddresses()
  })

  it('declines with a reason and a note, and reads a referral someone else changed again', async () => {
    const doctor = doctorAt()
    const declined = preview({ viewLevel: 'metadata', patient: null, reason: null, state: 'declined', effectiveState: 'declined',
      decline: { reasonCode: 'no_capacity', note: null, declinedAt: '2026-12-03T09:00:00.000Z' }, rowVersion: 3 })
    const sent = serve({
      [SESSION]: [sessionAt(doctor, [doctor])],
      [READ]: [readOf(preview()), readOf(preview({ rowVersion: 2 })), readOf(declined)],
      [DECLINE]: [() => problem(412, 'REFERRAL_VERSION_CONFLICT', 'Changed.'), () => json({ referral: declined, replayed: false })],
    })
    await openStaffApp(`/provider/referrals/${REFERRAL}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }))
    fireEvent.click(screen.getByRole('button', { name: 'Decline referral' }))
    expect(screen.getByText('Choose why you are declining.')).toBeDefined()
    expect(screen.getByText('The note needs at least 8 characters.')).toBeDefined()
    expect(sent.filter(call => call.route === DECLINE)).toEqual([])
    fireEvent.change(screen.getByLabelText('Why are you declining?'), { target: { value: 'no_capacity' } })
    fireEvent.change(screen.getByLabelText('Note to the referring facility'), { target: { value: 'Our clinic is full this month.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Decline referral' }))
    expect(await screen.findByText('Someone else changed this referral. Reload it and try again.')).toBeDefined()
    // Read again at version 2, the form kept as typed; declining again sends the new version under a new key.
    await waitFor(() => expect(sent.filter(call => call.route === READ)).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: 'Decline referral' }))
    expect(await screen.findByText('Declined. The referring facility and the patient are told.')).toBeDefined()
    expect(bodyOf(sent, DECLINE, 0)).toEqual({ expectedRowVersion: 1, reasonCode: 'no_capacity', note: 'Our clinic is full this month.' })
    expect(bodyOf(sent, DECLINE, 1)).toEqual({ expectedRowVersion: 2, reasonCode: 'no_capacity', note: 'Our clinic is full this month.' })
    expect(keyOf(sent, DECLINE, 1)).not.toBe(keyOf(sent, DECLINE, 0))
    await waitFor(() => expect(sent.filter(call => call.route === READ)).toHaveLength(3))
    expect((await screen.findAllByText('Declined')).length).toBeGreaterThan(0)
  })

  it('offers decline but not accept while the control is off', async () => {
    const doctor = doctorAt()
    const metadata = preview({ viewLevel: 'metadata', patient: null, reason: null })
    serve({
      [SESSION]: [sessionAt(doctor, [doctor])],
      [INCOMING]: [() => json({ items: [metadata], counts: { waiting: 1, urgent: 1 }, hasMore: false, limit: 200 })],
      [READ]: [readOf(metadata, { packageHidden: 'not_accepted' })],
    })
    await openStaffApp('/provider/referrals/incoming')
    expect(await screen.findByText('Accepting is switched off')).toBeDefined()
    fireEvent.click(await screen.findByRole('link', { name: 'Patient details not shown' }))
    expect(await screen.findByRole('button', { name: 'Decline' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(screen.getByText(/switched off for now\. You can still decline it\./)).toBeDefined()
  })

  it('marks an expected patient arrived from a fresh search, the matchRef in the body only', async () => {
    const desk = facility(REAL_FACILITY, 'Fictional General Hospital', FRONT_DESK, ['receptionist'])
    const item = { referralId: REFERRAL, reference: '3F2A9C1B', patient: { patientId: PATIENT, fullName: 'Ngozi Referone', sex: 'female',
      dateOfBirth: '1979-04-02', dateOfBirthEstimated: false, healthIdLast4: 'RF21' }, referringFacilityName: 'Fictional Clinic Ikeja',
      departmentCode: 'cardiology', serviceWanted: null, urgency: 'routine', acceptedAt: '2026-12-03T08:00:00.000Z', arriveBy: '2027-03-03T08:00:00.000Z', rowVersion: 2 }
    const sent = serve({
      [SESSION]: [sessionAt(desk, [desk])],
      [EXPECTED]: [() => json({ items: [item], hasMore: false, limit: 200 }), () => json({ items: [], hasMore: false, limit: 200 })],
      [SEARCH]: [() => json({ mode: 'standard', outcome: 'found', reach: 'everywhere', message: null, patients: [{ matchRef: MATCH_REF,
        matchRefExpiresAt: '2999-01-01T00:00:00.000Z', fullName: 'Ngozi Referone', sex: 'female', dateOfBirth: '1979-04-02', healthIdLast4: 'RF21', ninStatus: 'verified' }] })],
      [ARRIVE]: [
        () => problem(403, 'REFERRAL_ARRIVAL_NEEDS_SEARCH', 'Search first.'),
        () => json({ outcome: 'checked_in', referral: card({ side: 'received', state: 'arrived', effectiveState: 'arrived' }), entry: {}, replayed: false }),
      ],
    })
    await openStaffApp('/provider/referrals/expected')
    const row = await screen.findByRole('listitem', { name: 'Ngozi Referone' })
    expect(within(row).getByText('Born 2 Apr 1979')).toBeDefined()
    expect(within(row).getByLabelText('Health ID ending RF21').textContent).toBe('•••• RF21')
    expect(within(row).getByText('Arrive by 3 Mar 2027, 09:00')).toBeDefined()
    expect(row.textContent).not.toContain('heart murmur')
    fireEvent.click(within(row).getByRole('button', { name: 'Patient arrived: Ngozi Referone' }))
    // Not yet this facility's own: the server asks for a search.
    fireEvent.click(screen.getByRole('button', { name: 'Already a patient here: mark arrived' }))
    expect(await screen.findByText('Search for the patient named on the referral, then mark them arrived. A search result can be used for 10 minutes.')).toBeDefined()
    expect(bodyOf(sent, ARRIVE, 0)).toEqual({ expectedRowVersion: 2, patientId: PATIENT })
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Referone' } })
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1979-04-02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find patient' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Mark Ngozi Referone arrived' }))
    expect(await screen.findByText('Ngozi Referone is marked arrived and checked in to the waiting list.')).toBeDefined()
    expect(bodyOf(sent, ARRIVE, 1)).toEqual({ expectedRowVersion: 2, matchRef: MATCH_REF })
    expect(keyOf(sent, ARRIVE, 1)).not.toBe(keyOf(sent, ARRIVE, 0))
    noIdentityInAddresses()
    noPermissionWord()
  })

  it('records the outcome of an arrived referral, with "Did not attend" not offered after arrival', async () => {
    const doctor = doctorAt()
    const arrived = preview({ viewLevel: 'full', patient: card().patient, state: 'arrived', effectiveState: 'arrived', acceptedAt: '2026-12-03T08:00:00.000Z',
      arrivedAt: '2026-12-10T09:00:00.000Z', accessEndsAt: '2027-04-02T08:00:00.000Z', rowVersion: 3 })
    const completed = { ...arrived, state: 'completed', effectiveState: 'completed', rowVersion: 4,
      outcome: { code: 'seen_care_returned', feedbackNote: 'Echo normal. Back to you.', completedAt: '2026-12-10T10:00:00.000Z' } }
    const sent = serve({
      [SESSION]: [sessionAt(doctor, [doctor])],
      [READ]: [readOf(arrived, { package: PACKAGE }), readOf(completed, { package: PACKAGE })],
      [COMPLETE]: [() => json({ referral: completed, replayed: false })],
    })
    await openStaffApp(`/provider/referrals/${REFERRAL}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Complete referral' }))
    const choices = within(screen.getByLabelText('Outcome')).getAllByRole('option').map(option => option.textContent)
    expect(choices).not.toContain('Did not attend')
    expect(choices).toContain('Seen; care goes back to the referring clinician')
    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'seen_care_returned' } })
    fireEvent.change(screen.getByLabelText('Feedback to the referring facility'), { target: { value: 'Echo normal. Back to you.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save outcome' }))
    expect(await screen.findByText('Completed. The referring facility can read the outcome and your feedback.')).toBeDefined()
    expect(bodyOf(sent, COMPLETE)).toEqual({ expectedRowVersion: 3, outcome: 'seen_care_returned', feedbackNote: 'Echo normal. Back to you.' })
    expect(await screen.findByText('Seen; care goes back to the referring clinician (10 Dec 2026, 11:00)')).toBeDefined()
  })

  it('withdraws a sent referral with the note its reason needs, and prints the patient copy with no Health ID', async () => {
    const doctor = doctorAt()
    const withdrawn = card({ state: 'withdrawn', effectiveState: 'withdrawn', rowVersion: 2,
      withdrawal: { by: 'referring_facility', reasonCode: 'sent_in_error', note: 'Wrong department chosen.', withdrawnAt: '2026-12-03T10:00:00.000Z' } })
    const sent = serve({
      [SESSION]: [sessionAt(doctor, [doctor])],
      [READ]: [readOf(card(), { package: PACKAGE }), readOf(card(), { package: PACKAGE }), readOf(withdrawn, { package: PACKAGE })],
      [LETTER]: [() => json({ referral: card(), package: PACKAGE, letter: { referringFacilityAddress: '12 Fiction Road, Ikeja', printedAt: '2026-12-03T23:30:00.000Z' } })],
      [WITHDRAW]: [() => json({ referral: withdrawn, replayed: false })],
      [NAMES]: [() => json({ facilityId: REAL_FACILITY, staff: [], complete: true })],
    })
    await openStaffApp(`/provider/referrals/${REFERRAL}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Print patient copy' }))
    await waitFor(() => expect(where()).toBe(`/provider/referrals/${REFERRAL}/letter`))
    const letter = await screen.findByRole('article', { name: 'Referral letter' })
    expect(within(letter).getByText('Referral letter: patient copy')).toBeDefined()
    expect(within(letter).getByText('12 Fiction Road, Ikeja')).toBeDefined()
    expect(within(letter).getByText('4 Dec 2026, 00:30')).toBeDefined()
    expect(within(letter).getByText('Ngozi Referone, Female, Born 2 Apr 1979')).toBeDefined()
    expect(letter.textContent).not.toMatch(/RF21|Health ID ending|HID-/)
    expect(within(letter).getByText('Referred by Dr Ada Example (MDCN MDCN/12345)')).toBeDefined()
    directCare(sent, LETTER)

    fireEvent.click(screen.getByRole('button', { name: 'Back to the referral' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw referral' }))
    fireEvent.change(screen.getByLabelText('Why are you withdrawing it?'), { target: { value: 'sent_in_error' } })
    fireEvent.click(within(screen.getByRole('form', { name: 'Withdraw the referral' })).getByRole('button', { name: 'Withdraw referral' }))
    expect(screen.getByText('The note needs at least 8 characters.')).toBeDefined()
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Wrong department chosen.' } })
    fireEvent.click(within(screen.getByRole('form', { name: 'Withdraw the referral' })).getByRole('button', { name: 'Withdraw referral' }))
    expect(await screen.findByText('Withdrawn. The receiving facility can no longer accept it, and the patient is told.')).toBeDefined()
    expect(bodyOf(sent, WITHDRAW)).toEqual({ expectedRowVersion: 1, reasonCode: 'sent_in_error', note: 'Wrong department chosen.' })
    expect(keyOf(sent, WITHDRAW)).toBeTruthy()
    noIdentityInAddresses()
    noPermissionWord()
  })

  it('reads Received with its own code, and a mistyped address goes back to the list', async () => {
    const doctor = doctorAt()
    serve({
      [SESSION]: [sessionAt(doctor, [doctor])],
      [RECEIVED]: [listOf(preview({ viewLevel: 'metadata', patient: null, reason: null, state: 'declined', effectiveState: 'declined',
        decline: { reasonCode: 'service_not_offered', note: null, declinedAt: '2026-12-03T09:00:00.000Z' } }))],
      [SENT]: [listOf()],
    })
    await openStaffApp('/provider/referrals/received')
    const row = await screen.findByRole('listitem', { name: 'Patient details not shown' })
    expect(within(row).getByText('Declined')).toBeDefined()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Referrals' })).getByRole('link', { name: 'Sent' }))
    expect(await screen.findByText('No referrals sent in the last 90 days')).toBeDefined()
  })
})
