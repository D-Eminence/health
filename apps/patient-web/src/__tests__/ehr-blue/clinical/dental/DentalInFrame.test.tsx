import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import type * as BlueRoutes from '../../../../ehr-blue/routes'
import { DEMO_HOSPITAL, REAL_FACILITY, SESSION, facility, json, openStaffApp, problem, serve, sessionAt, type Sent } from '../../frame/blueHarness'

/*
 * Dental (hid-system DEN-1, 0194-0196) inside the blue EHR's real frame, joined as clinical/pages.ts joins it: listed
 * under "Wards & units" for dentists (ehr.dental.read, Q-DEN-1 A), today's sample for the demo facilities' doctors, and
 * nothing for anyone else. While the dental clinic is switched off (503 DENTAL_NOT_AVAILABLE, or 404 from an ehr-api
 * before it), a dentist is told so and the sidebar stops listing it: never a broken screen. Every account, facility and
 * patient is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
// The blue EHR loads lazily; on a busy machine its first load can take longer than one wait. Loaded once here (then
// forgotten, so each test's own registry below applies), each test's frame opens from the warm transform.
beforeAll(async () => {
  await import('../../../../ehr-blue/EhrBlueApp')
  vi.resetModules()
}, 120_000)
beforeEach(async () => {
  vi.doMock('../../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../../ehr-blue/frame/pages')
    const home = await import('../../../../ehr-blue/home/pages')
    const { dentalPage } = await import('../../../../ehr-blue/clinical/dental/page')
    return { ...actual, BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home, './clinical/pages.ts': { pages: [dentalPage] } }) }
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const VISITS = 'GET /api/v1/ehr/dental-visits'
const QUEUE = 'GET /api/v1/ehr/visit-queue'
const DENTIST = ['ehr.dental.read', 'ehr.dental.write', 'ehr.encounter.read', 'ehr.encounter.write', 'ehr.note.read', 'ehr.note.write',
  'identity.patient.read', 'identity.patient-access-pin.verify', 'ehr.document.read', 'ehr.document.write']
const DOCTOR = ['ehr.encounter.read', 'ehr.encounter.write', 'ehr.note.read', 'ehr.note.write', 'identity.patient.read', 'identity.break-glass.write']
const ME = `member-${REAL_FACILITY}`
const PATIENT = 'a0000000-0000-4000-8000-0000000000d1'
const ENCOUNTER = 'e0000000-0000-4000-8000-0000000000d1'
const nav = () => screen.getByRole('navigation', { name: 'Main navigation' })

function visitsOf(hiddenCount = 0) {
  return () => json({
    items: [{
      patient: { patientId: PATIENT, fullName: 'Ada Toothone', sex: 'female', dateOfBirth: '1990-05-14', healthIdLast4: 'DE77' },
      visit: { visitId: 'f0000000-0000-4000-8000-0000000000d1', patientId: PATIENT, encounterId: ENCOUNTER, encounterStatus: 'in_progress',
        encounterStartedAt: '2026-12-03T08:40:00.000Z', startedAt: '2026-12-03T08:52:00.000Z', startedByMembershipId: ME, stage: 'treated',
        followUpOn: '2027-06-03', followUpNote: null, rowVersion: 2 },
    }],
    hiddenCount, hasMore: false, limit: 200,
  })
}
const queueOf = () => () => json({ items: [{
  entryId: 'b0000000-0000-4000-8000-0000000000d1', patientId: PATIENT, fullName: 'Ada Toothone', sex: 'female', dateOfBirth: '1990-05-14',
  healthIdLast4: 'DE77', stage: 'ready', triageLevel: null, assignedMembershipId: ME, checkInBasis: 'search',
  checkedInAt: '2026-12-03T08:30:00.000Z', checkInDay: '2026-12-03', stageChangedAt: '2026-12-03T08:31:00.000Z', closedAt: null,
  rowVersion: 2, chartBlocked: false,
}, {
  entryId: 'b0000000-0000-4000-8000-0000000000d2', patientId: 'a0000000-0000-4000-8000-0000000000d2', fullName: 'Bola Elsewhere',
  sex: 'male', dateOfBirth: '1980-01-01', healthIdLast4: 'XY12', stage: 'waiting', triageLevel: null, assignedMembershipId: null,
  checkInBasis: 'search', checkedInAt: '2026-12-03T08:35:00.000Z', checkInDay: '2026-12-03', stageChangedAt: '2026-12-03T08:35:00.000Z',
  closedAt: null, rowVersion: 1, chartBlocked: false,
}], hasMore: false, limit: 200 })

function sentTo(sent: readonly Sent[], route: string) { return sent.filter(call => call.route === route) }

describe('Dental in the frame', () => {
  it('is listed for a dentist at a real facility, with today’s visits and the patients set for them to see', async () => {
    const dentist = facility(REAL_FACILITY, 'Fictional Dental Clinic', DENTIST, ['dentist'])
    const sent = serve({ [SESSION]: [sessionAt(dentist, [dentist])], [VISITS]: [visitsOf(2)], [QUEUE]: [queueOf()] })
    await openStaffApp('/provider/dental')
    expect(await screen.findByRole('heading', { level: 1, name: 'Dental' })).toBeDefined()
    expect(within(nav()).getByRole('link', { name: 'Dental' }).getAttribute('href')).toBe('/provider/dental')

    const visits = (await screen.findByRole('heading', { name: 'Dental visits' })).closest('section')!
    await within(visits).findByText('Ada Toothone')
    // 08:52 UTC is 09:52 in Lagos; the follow-up is a Lagos calendar day.
    expect(within(visits).getByText(/Health ID ending DE77 · Female · \d+ years · Started (3 Dec 2026, )?09:52 · Follow-up 3 Jun 2027/)).toBeDefined()
    expect(within(visits).getByText('Treated')).toBeDefined()
    // No patient is open: the row gives no way in.
    expect(within(visits).getByText('Open the patient first')).toBeDefined()
    expect(screen.getByText(/2 more visits are of patients you can’t open now/)).toBeDefined()

    const assigned = screen.getByRole('heading', { name: 'Assigned to me' }).closest('section')!
    await within(assigned).findByText('Ada Toothone')
    expect(within(assigned).queryByText('Bola Elsewhere')).toBeNull()

    const call = sentTo(sent, VISITS)[0]!
    expect(call.headers.get('X-Facility-ID')).toBe(REAL_FACILITY)
    expect(call.headers.get('X-Purpose-Of-Use')).toBe('direct-care')
    for (const [url] of vi.mocked(fetch).mock.calls) expect(String(url)).not.toMatch(/HID-|Toothone|healthId/i)
    expect(document.body.textContent).not.toMatch(/permission|ehr\.dental|DENTAL_/i)
  })

  it('says the dental clinic is not switched on, and leaves the sidebar, while DENTAL_ENABLED is off', async () => {
    const dentist = facility(REAL_FACILITY, 'Fictional Dental Clinic', DENTIST, ['dentist'])
    serve({ [SESSION]: [sessionAt(dentist, [dentist])], [VISITS]: [() => problem(503, 'DENTAL_NOT_AVAILABLE', 'Service unavailable.')], [QUEUE]: [queueOf()] })
    await openStaffApp('/provider/dental')
    expect(await screen.findByText('The dental clinic is not switched on yet.')).toBeDefined()
    expect(screen.getByText(/keep the paper dental chart/)).toBeDefined()
    await waitFor(() => expect(within(nav()).queryByRole('link', { name: 'Dental' })).toBeNull())
    expect(screen.queryByText(/Sample only/)).toBeNull()
  })

  it('is not listed for a doctor at a real facility, and its address says who uses it, reading nothing', async () => {
    const doctor = facility(REAL_FACILITY, 'Fictional Hospital', DOCTOR, ['doctor'])
    const sent = serve({ [SESSION]: [sessionAt(doctor, [doctor])] })
    await openStaffApp('/provider/dental')
    expect(await screen.findByText(/Only dentists of this facility can open or record the dental chart\./)).toBeDefined()
    expect(within(nav()).queryByRole('link', { name: 'Dental' })).toBeNull()
    expect(sent.filter(call => call.route.includes('dental'))).toEqual([])
  })

  it('keeps today’s sample for a doctor at a demo facility, sending nothing', async () => {
    const doctor = facility(DEMO_HOSPITAL, 'Demo Hospital', DOCTOR, ['doctor'])
    const sent = serve({ [SESSION]: [sessionAt(doctor, [doctor])] })
    await openStaffApp('/provider/dental')
    expect(await screen.findByText('Sample only: not connected to Health ID yet. Nothing you do here is saved.')).toBeDefined()
    expect(within(nav()).getByRole('link', { name: 'Dental' })).toBeDefined()
    expect(sent.filter(call => call.route.includes('dental'))).toEqual([])
  })

  it('shows a dentist at a demo facility the sample under the notice while the dental clinic is off', async () => {
    const dentist = facility(DEMO_HOSPITAL, 'Demo Hospital', DENTIST, ['dentist'])
    serve({ [SESSION]: [sessionAt(dentist, [dentist])], [VISITS]: [() => problem(404, 'API_ROUTE_NOT_FOUND', 'Not found.')], [QUEUE]: [queueOf()] })
    await openStaffApp('/provider/dental')
    expect(await screen.findByText('The dental clinic is not switched on yet.')).toBeDefined()
    expect(await screen.findByText('Sample only: not connected to Health ID yet. Nothing you do here is saved.')).toBeDefined()
    expect(within(nav()).getByRole('link', { name: 'Dental' })).toBeDefined()
  })
})
