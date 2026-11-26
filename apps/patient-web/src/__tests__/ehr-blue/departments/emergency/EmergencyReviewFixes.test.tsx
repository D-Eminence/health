import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type * as BlueRoutes from '../../../../ehr-blue/routes'
import { REAL_FACILITY, SESSION, facility, json, openStaffApp, problem, serve, sessionAt, type Sent } from '../../frame/blueHarness'

/*
 * The emergency department board's review fixes (hid-system#337 / health#330): an arrival answered already_on_board
 * says plainly which of the triage level and complaint entered were not saved (the board keeps the record as it was);
 * focus follows each step; times from an earlier Lagos day carry their date (P2-4); a closed record with no decision is
 * never said to have left; the visit link's refusals are the chart's, not the board's; and a member the board is for is
 * told it is not available yet on a backend before 0169. Every account, facility, patient and reference is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(async () => {
  vi.doMock('../../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../../ehr-blue/frame/pages')
    const home = await import('../../../../ehr-blue/home/pages')
    const { emergencyDepartmentPage } = await import('../../../../ehr-blue/departments/emergency/page')
    return {
      ...actual,
      BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home,
        './departments/pages.ts': { pages: [emergencyDepartmentPage] } }),
    }
  })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const ARRIVE = 'POST /api/v1/ehr/ed-attendances'
const BOARD = 'GET /api/v1/ehr/ed-board'
const SEARCH = 'POST /api/v1/identity/patient-search'
const ATTENDANCE = 'e0000000-0000-4000-8000-0000000000e1'
const PATIENT = 'b0000000-0000-4000-8000-0000000000f1'
const MATCH_REF = `psr_${'B'.repeat(43)}`
const ED = ['ehr.ed.read', 'ehr.encounter.read', 'ehr.encounter.write']
const NURSE = [...ED, 'ehr.ed.arrive', 'ehr.ed.triage', 'ehr.note.write', 'identity.patient.read', 'identity.registration.write']
const DOCTOR = [...NURSE, 'ehr.ed.disposition']
const RECORD = `GET /api/v1/ehr/ed-attendances/${ATTENDANCE}`
const action = (name: string) => `POST /api/v1/ehr/ed-attendances/${ATTENDANCE}/${name}`
const ENCOUNTERS = `POST /api/v1/ehr/patients/${PATIENT}/encounters`
const VISIT = 'c0000000-0000-4000-8000-0000000000c1'
const ME = `member-${REAL_FACILITY}`
const nav = () => screen.getByRole('navigation', { name: 'Main navigation' })
const BOARD_REFUSED = 'Only the front desk, nurses, clinicians and doctors of this facility can use the emergency board.'
const NOT_AVAILABLE = 'The emergency board is not available yet.'

function card(overrides: Record<string, unknown> = {}) {
  return {
    attendanceId: ATTENDANCE, entryId: 'a0000000-0000-4000-8000-0000000000a1', patientId: PATIENT, fullName: 'Tunde Boardone',
    recordKind: 'standard', unknownLabel: null, sex: 'male', dateOfBirth: '1984-03-09', dateOfBirthEstimated: false,
    healthIdLast4: 'BB33', chartBlocked: false, arrivalBasis: 'search', arrivalMode: 'ambulance', arrivedAt: '2026-12-03T08:10:00.000Z',
    minutesInDepartment: 42, column: 'waiting', stage: 'waiting', triageLevel: null, triagedAt: null,
    triagedByMembershipId: null, presentingComplaint: null, complaintHidden: false,
    assignedMembershipId: null, encounterId: null, status: 'open', disposition: null, leftAt: null, rowVersion: 3, ...overrides,
  }
}
const sentTo = (sent: readonly Sent[], route: string) => sent.filter(call => call.route === route)
const recordOf = (attendance = card(), history: unknown[] = []) => () => json({ attendance, history })
const boardOf = (...items: ReturnType<typeof card>[]) => () => json({ items, counts: { waiting: 0, beingSeen: 0, disposition: 0 },
  hasMore: false, limit: 200 })
const event = (kind: string, at: string, extra: Record<string, unknown> = {}) => ({ kind, at, byMembershipId: ME, fromStage: null,
  toStage: null, triageLevel: null, outcome: null, reason: null, complaintChanged: false, ...extra })

const LOOKUP = 'POST /api/v1/identity/patient-lookup'
const lookupAnswer = () => json({ authorization: { decision: 'allow', consentGrantId: 'grant-1', scope: 'read_write' },
  patient: { patientId: PATIENT, hid: 'HID-BBBB33', fullName: 'Tunde Boardone' } })

/** The frame with Patients too, where a chart is opened under the usual access (the visit link needs it open). */
function withPatientsPage() {
  vi.doMock('../../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../../ehr-blue/frame/pages')
    const home = await import('../../../../ehr-blue/home/pages')
    const clinical = await import('../../../../ehr-blue/clinical/pages')
    const { emergencyDepartmentPage } = await import('../../../../ehr-blue/departments/emergency/page')
    return {
      ...actual,
      BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home,
        './clinical/pages.ts': { pages: clinical.pages.filter(page => page.path === 'patients/*') },
        './departments/pages.ts': { pages: [emergencyDepartmentPage] } }),
    }
  })
}

/** Opens the patient's chart on Patients for direct care, then their record on the emergency board, as a nurse does. */
async function openChartThenRecord() {
  await openStaffApp('/provider/patients')
  fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: 'HID-BBBB33' } })
  fireEvent.click(screen.getByRole('button', { name: 'Find' }))
  await waitFor(() => expect(document.body.textContent).toContain('Tunde Boardone'))
  fireEvent.click(within(nav()).getByRole('link', { name: 'Emergency department' }))
  fireEvent.click(within(await screen.findByRole('list', { name: 'Waiting (1)' })).getByRole('link', { name: 'Tunde Boardone' }))
  return screen.findByRole('button', { name: 'Link today’s emergency visit' })
}

async function chooseFromSearch() {
  fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: 'hid-bbbb33' } })
  fireEvent.click(screen.getByRole('button', { name: 'Find patient' }))
  const found = await screen.findByRole('listitem', { name: 'Tunde Boardone' })
  fireEvent.click(within(found).getByRole('button', { name: 'Choose Tunde Boardone' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'How they came' }), { target: { value: 'walk_in' } })
}
const searchAnswer = () => json({ mode: 'standard', outcome: 'found', reach: 'everywhere', message: null, patients: [{
  matchRef: MATCH_REF, matchRefExpiresAt: '2999-01-01T00:00:00.000Z', fullName: 'Tunde Boardone', sex: 'male',
  dateOfBirth: '1984-03-09', healthIdLast4: 'BB33', ninStatus: 'verified' }] })

describe('Emergency department board review fixes', () => {
  it('says plainly that a triage level and complaint entered for a patient already on the board were not saved', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    const sent = serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      [SEARCH]: [searchAnswer],
      [ARRIVE]: [() => json({ outcome: 'already_on_board', attendance: card(), replayed: false })],
    })
    await openStaffApp('/provider/emergency-department/new')
    await chooseFromSearch()
    fireEvent.change(screen.getByRole('combobox', { name: /Triage level/ }), { target: { value: '1' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Presenting complaint/ }), { target: { value: 'Chest pain' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to the board' }))
    expect(await screen.findByText('Tunde Boardone is already on the board.')).toBeDefined()
    expect(sentTo(sent, ARRIVE)[0]!.body).toEqual({ matchRef: MATCH_REF, arrivalMode: 'walk_in', triageLevel: 1, presentingComplaint: 'Chest pain' })
    const notSaved = screen.getByRole('alert')
    expect(within(notSaved).getByText('The triage level and complaint you entered were not saved')).toBeDefined()
    // Focus is on the result, which is read out from there (not lost to the page when the form goes).
    await waitFor(() => expect(document.activeElement?.id).toBe('ed-arrived-title'))
    expect(notSaved.textContent).toContain('The board still shows Tunde Boardone as: No triage level yet. To change it, open their record and select Triage.')
    expect(screen.getByRole('link', { name: 'Open their record' }).getAttribute('href')).toBe(`/provider/emergency-department/${ATTENDANCE}`)
    // The arrival notice is not a success tone when nothing new was saved.
    expect(screen.getByText('Tunde Boardone is already on the board.').closest('.hid-ehr-dept-notice')!.className).not.toContain('positive')
  })

  it('says nothing about triage when none was entered for a patient already on the board', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      [SEARCH]: [searchAnswer],
      [ARRIVE]: [() => json({ outcome: 'already_on_board', attendance: card({ triageLevel: 2 }), replayed: false })],
    })
    await openStaffApp('/provider/emergency-department/new')
    await chooseFromSearch()
    fireEvent.click(screen.getByRole('button', { name: 'Add to the board' }))
    expect(await screen.findByText('Tunde Boardone is already on the board.')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/were not saved/)).toBeNull()
  })

  for (const [entered, title] of [['level', 'The triage level you entered was not saved'], ['complaint', 'The complaint you entered was not saved']] as const) {
    it(`names only the ${entered} entered when a patient already on the board keeps their record as it was`, async () => {
      const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
      serve({
        [SESSION]: [sessionAt(nurse, [nurse])],
        [SEARCH]: [searchAnswer],
        [ARRIVE]: [() => json({ outcome: 'already_on_board', attendance: card({ triageLevel: 3 }), replayed: false })],
      })
      await openStaffApp('/provider/emergency-department/new')
      await chooseFromSearch()
      if (entered === 'level') fireEvent.change(screen.getByRole('combobox', { name: /Triage level/ }), { target: { value: '2' } })
      else fireEvent.change(screen.getByRole('textbox', { name: /Presenting complaint/ }), { target: { value: 'Chest pain' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add to the board' }))
      const notSaved = await screen.findByRole('alert')
      expect(within(notSaved).getByText(title)).toBeDefined()
      expect(notSaved.textContent).not.toMatch(entered === 'level' ? /complaint you entered/ : /triage level you entered/)
    })
  }

  it('moves focus to the result after an arrival, to the first question for another, and to a refusal returned early', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      [SEARCH]: [searchAnswer],
      [ARRIVE]: [() => json({ outcome: 'arrived', attendance: card(), replayed: false }, 201)],
    })
    await openStaffApp('/provider/emergency-department/new')
    // The arrival time's hint says what an empty field means.
    expect(await screen.findByText('Lagos time, up to 6 hours ago. Leave it empty if they arrived just now.')).toBeDefined()
    // How they came, but no patient chosen yet: the refusal is focused, as every other refusal is.
    fireEvent.change(screen.getByRole('combobox', { name: 'How they came' }), { target: { value: 'ambulance' } })
    const add = screen.getByRole('button', { name: 'Add to the board' })
    add.focus()
    fireEvent.click(add)
    expect(await screen.findByText('Search for the patient, then choose them.')).toBeDefined()
    await waitFor(() => expect(document.activeElement?.id).toBe('ed-arrival-error'))

    await chooseFromSearch()
    screen.getByRole('button', { name: 'Add to the board' }).focus()
    fireEvent.click(screen.getByRole('button', { name: 'Add to the board' }))
    expect(await screen.findByText('Tunde Boardone is on the board.')).toBeDefined()
    await waitFor(() => expect(document.activeElement?.id).toBe('ed-arrived-title'))
    expect(document.activeElement).not.toBe(document.body)

    const another = screen.getByRole('button', { name: 'Add another arrival' })
    another.focus()
    fireEvent.click(another)
    expect(await screen.findByRole('heading', { level: 2, name: 'Who arrived' })).toBeDefined()
    await waitFor(() => expect(document.activeElement?.id).toBe('ed-arrival-who'))
  })

  it('dates an arrival, triage and decision from an earlier Lagos day, on the board and the record (P2-4)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-03T10:00:00.000Z')) // 11:00 in Lagos, on 3 Dec
    const doctor = facility(REAL_FACILITY, 'Fictional Hospital', DOCTOR, ['doctor'])
    // Admission requested on Monday, still waiting for a ward on Wednesday (Q-ED-6 A).
    const waiting = card({ arrivedAt: '2026-12-01T13:05:00.000Z', triageLevel: 2, triagedAt: '2026-12-01T13:20:00.000Z', triagedByMembershipId: ME,
      column: 'disposition', status: 'decided', minutesInDepartment: 2875, disposition: { outcome: 'admit_requested',
        decidedAt: '2026-12-01T15:00:00.000Z', decidedByMembershipId: ME, admitToDepartmentCode: 'inpatient', admittingMembershipId: null,
        referredToFacilityName: null } })
    const today = card({ attendanceId: 'e0000000-0000-4000-8000-0000000000e2', fullName: 'Ada Boardtwo', arrivedAt: '2026-12-03T08:10:00.000Z' })
    serve({
      [SESSION]: [sessionAt(doctor, [doctor])],
      [BOARD]: [boardOf(waiting, today)],
      [RECORD]: [recordOf(waiting)],
    })
    await openStaffApp('/provider/emergency-department')
    const earlier = await screen.findByRole('listitem', { name: 'Tunde Boardone' })
    expect(within(earlier).getByText('1 Dec 2026, 14:05')).toBeDefined()
    expect(within(screen.getByRole('listitem', { name: 'Ada Boardtwo' })).getByText('09:10')).toBeDefined()

    fireEvent.click(within(earlier).getByRole('link', { name: 'Tunde Boardone' }))
    const patient = await screen.findByRole('region', { name: 'Patient' })
    expect(within(patient).getByText('Level 2: very urgent, 1 Dec 2026, 14:20 by You')).toBeDefined()
    expect(within(patient).getByText('Admission requested to Inpatient, 1 Dec 2026, 16:00')).toBeDefined()
  })

  it('never says a cancelled arrival left the department, on the board or on its record', async () => {
    const doctor = facility(REAL_FACILITY, 'Fictional Hospital', DOCTOR, ['doctor'])
    const cancelled = card({ status: 'closed', column: 'closed', leftAt: '2026-12-03T08:20:00.000Z', rowVersion: 4 })
    serve({
      [SESSION]: [sessionAt(doctor, [doctor])],
      [BOARD]: [boardOf(), boardOf(cancelled)],
      [RECORD]: [recordOf(cancelled, [event('arrived', '2026-12-03T08:10:00.000Z', { toStage: 'waiting' }),
        event('cancelled', '2026-12-03T08:20:00.000Z', { reason: 'Added the wrong patient' })])],
    })
    await openStaffApp('/provider/emergency-department')
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Show patients who left the board today' }))
    const closed = await screen.findByRole('list', { name: 'Off the board today (1)' })
    const row = within(closed).getByRole('listitem', { name: 'Tunde Boardone' })
    expect(within(row).getByText('Closed')).toBeDefined()
    expect(row.textContent).not.toMatch(/left the department/i)

    fireEvent.click(within(row).getByRole('link', { name: 'Tunde Boardone' }))
    const patient = await screen.findByRole('region', { name: 'Patient' })
    // The badge and the stage say how it closed; the time it closed is not called "Left".
    expect(within(patient).getAllByText('Arrival cancelled')).toHaveLength(2)
    expect(within(patient).getByText('Closed', { selector: 'dt' })).toBeDefined()
    expect(within(patient).queryByText('Left', { selector: 'dt' })).toBeNull()
    expect(patient.textContent).not.toMatch(/left the department/i)
  })

  it('links today’s emergency visit once the chart is open: EHR-C1’s visit, then route 6 with its id', async () => {
    withPatientsPage()
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    const sent = serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      // A Health ID typed in whole may be looked up as it arrives as well as by Find: either answers the same.
      [LOOKUP]: [lookupAnswer, lookupAnswer],
      [BOARD]: [boardOf(card())],
      [RECORD]: [recordOf(), recordOf(card({ encounterId: VISIT, rowVersion: 4 }))],
      [ENCOUNTERS]: [() => json({ id: VISIT, patientId: PATIENT, facilityId: REAL_FACILITY, encounterType: 'emergency', status: 'in_progress',
        startedAt: '2026-12-03T08:20:00.000Z', chiefComplaint: 'Emergency department attendance', rowVersion: 1 }, 201)],
      [action('visit')]: [() => json({ attendance: card({ encounterId: VISIT, rowVersion: 4 }), replayed: false })],
    })
    fireEvent.click(await openChartThenRecord())
    expect(await screen.findByText('Today’s emergency visit is linked.')).toBeDefined()
    const visit = sentTo(sent, ENCOUNTERS)[0]!
    expect(visit.body).toEqual({ encounterType: 'emergency', status: 'in_progress', startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/),
      chiefComplaint: 'Emergency department attendance', reuseOpenVisit: true })
    expect(visit.headers.get('X-Purpose-Of-Use')).toBe('direct-care')
    expect(visit.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)
    const link = sentTo(sent, action('visit'))[0]!
    expect(link.body).toEqual({ expectedRowVersion: 3, encounterId: VISIT })
    expect(link.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('says a visit refused for the chart’s access (403 CONSENT_REQUIRED) or a 404 as the chart’s, never as the board’s', async () => {
    withPatientsPage()
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    const sent = serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      // A Health ID typed in whole may be looked up as it arrives as well as by Find: either answers the same.
      [LOOKUP]: [lookupAnswer, lookupAnswer],
      [BOARD]: [boardOf(card())],
      [RECORD]: [recordOf()],
      [ENCOUNTERS]: [() => problem(403, 'CONSENT_REQUIRED', 'Active consent and facility membership are required'),
        () => problem(404, 'CLINICAL_RESOURCE_NOT_FOUND', 'Clinical resource was not found')],
    })
    fireEvent.click(await openChartThenRecord())
    expect(await screen.findByText('The emergency visit was not started. Your access to this patient’s record has ended or does not allow changes. '
      + 'Open their chart again on Patients, then come back here.')).toBeDefined()
    expect(screen.queryByText(BOARD_REFUSED)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Link today’s emergency visit' }))
    expect(await screen.findByText(/The patient was not found at this facility\./)).toBeDefined()
    expect(screen.queryByText(NOT_AVAILABLE)).toBeNull()
    // Nothing was linked, and the board is still listed: the visit's refusal says nothing about the board.
    expect(sentTo(sent, action('visit'))).toEqual([])
    expect(within(nav()).getByRole('link', { name: 'Emergency department' })).toBeDefined()
    expect(document.body.textContent).not.toMatch(/permission/i)
  })

  it('tells a nurse the board is not available yet on a backend before 0169 (no ED code yet), reading nothing', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', ['ehr.encounter.read', 'ehr.encounter.write', 'ehr.note.write'], ['nurse'])
    const sent = serve({ [SESSION]: [sessionAt(nurse, [nurse])] })
    await openStaffApp('/provider/emergency-department')
    expect(await screen.findByText(NOT_AVAILABLE)).toBeDefined()
    expect(screen.queryByText(BOARD_REFUSED)).toBeNull()
    expect(within(nav()).queryByRole('link', { name: 'Emergency department' })).toBeNull()
    expect(sent.filter(call => call.route.includes('/ed-'))).toEqual([])
  })
})
