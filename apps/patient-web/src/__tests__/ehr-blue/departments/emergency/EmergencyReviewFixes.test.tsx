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
        decidedAt: '2026-12-01T15:00:00.000Z', decidedByMembershipId: ME, admitToDepartmentCode: 'inpatient', admittingMembershipId: ME,
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
    // "you" inside a sentence, without a capital letter.
    expect(within(patient).getByText('Level 2: very urgent, 1 Dec 2026, 14:20 by you')).toBeDefined()
    expect(within(patient).getByText('Admission requested to Inpatient under you, 1 Dec 2026, 16:00')).toBeDefined()
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

/*
 * Round 2 (health#330): each arrival is a request of its own; an unknown patient's Health ID is never lost to a failed
 * arrival, and no record is made for a board that said it is off; a board or record switched off after use is dropped,
 * not kept on screen; focus follows Choose and Choose someone else; and the help says where a board patient's triage is
 * changed.
 */
const UNKNOWN = 'POST /api/v1/identity/unknown-patients'
const unknownMade = (label: string, patientId: string, hid: string) => () => json({ patientId, recordKind: 'unknown', label,
  displayName: `Unknown patient ${label}`, sex: 'unknown', dateOfBirth: null, dateOfBirthEstimated: false, ninStatus: 'not_verified',
  status: 'open', createdAt: '2026-12-03T08:10:00.000Z', openDays: 0, overdue: false, version: 1, hid, replayed: false }, 201)
const unknownCard = (label: string, patientId: string, attendanceId: string) => card({ attendanceId, patientId,
  fullName: `Unknown patient ${label}`, recordKind: 'unknown', unknownLabel: label, arrivalBasis: 'own-facility', arrivalMode: 'brought_by_public' })

/** A read answered 503 ED_BOARD_NOT_AVAILABLE: the client asks twice more (a read's retries), and each answers the same. */
const switchedOff = () => Array.from({ length: 3 }, () => () => problem(503, 'ED_BOARD_NOT_AVAILABLE', 'Service unavailable'))
/** Long enough for a read's two retries after a 503, with their backoff. */
const RETRIED = { timeout: 5000 }

/** An unknown patient's arrival, as a mass-casualty intake enters each one: sex Not known, Unconscious, no age or note. */
async function addUnknownCasualty() {
  fireEvent.click(await screen.findByRole('radio', { name: 'Unknown patient' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Sex' }), { target: { value: 'unknown' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Why they cannot say who they are' }), { target: { value: 'unconscious' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'How they came' }), { target: { value: 'brought_by_public' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add to the board' }))
}

describe('Emergency department board review fixes, round 2', () => {
  it('gives a second unknown patient with the same answers a record and Health ID of their own after Add another arrival', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    const second = 'b0000000-0000-4000-8000-0000000000f2'
    const sent = serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      [UNKNOWN]: [() => problem(500, 'INTERNAL_ERROR', 'Something went wrong'), unknownMade('U-0007', PATIENT, 'HID-ZZZZ77'),
        unknownMade('U-0008', second, 'HID-ZZZZ88')],
      [ARRIVE]: [() => json({ outcome: 'arrived', attendance: unknownCard('U-0007', PATIENT, ATTENDANCE), replayed: false }, 201),
        () => json({ outcome: 'arrived', attendance: unknownCard('U-0008', second, 'e0000000-0000-4000-8000-0000000000e2'), replayed: false }, 201)],
    })
    await openStaffApp('/provider/emergency-department/new')
    await addUnknownCasualty()
    // A retry within one arrival is the same request: the same body with the same key.
    expect(await screen.findByText('The record could not be made. Try again.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Add to the board' }))
    expect(await screen.findByText('Unknown patient U-0007 is on the board.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Add another arrival' }))
    await addUnknownCasualty()
    expect(await screen.findByText('Unknown patient U-0008 is on the board.')).toBeDefined()
    expect(within(screen.getByRole('region', { name: 'Wristband' })).getByText('HID-ZZZZ88', { selector: 'strong' })).toBeDefined()

    const made = sentTo(sent, UNKNOWN)
    expect(made.map(call => call.body)).toEqual(Array(3).fill({ gender: 'unknown', unknownReason: 'unconscious', purpose: 'healthcare-operations' }))
    const keys = made.map(call => call.headers.get('Idempotency-Key'))
    expect(keys[1]).toBe(keys[0])
    // The second casualty's record is a new request: never the first patient's record and Health ID replayed.
    expect(keys[2]).toMatch(/^[0-9a-f-]{36}$/)
    expect(keys[2]).not.toBe(keys[0])
    const arrivals = sentTo(sent, ARRIVE)
    expect(arrivals[1]!.headers.get('Idempotency-Key')).not.toBe(arrivals[0]!.headers.get('Idempotency-Key'))
  })

  it('makes no unknown patient’s record once the board has said it is not available', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    const sent = serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      [SEARCH]: [searchAnswer],
      [ARRIVE]: [() => problem(503, 'ED_BOARD_NOT_AVAILABLE', 'Service unavailable')],
    })
    await openStaffApp('/provider/emergency-department/new')
    await chooseFromSearch()
    fireEvent.click(screen.getByRole('button', { name: 'Add to the board' }))
    expect(await screen.findByText(NOT_AVAILABLE)).toBeDefined()
    await addUnknownCasualty()
    await waitFor(() => expect(document.activeElement?.id).toBe('ed-arrival-error'))
    expect(document.activeElement?.textContent).toBe(NOT_AVAILABLE)
    expect(sentTo(sent, UNKNOWN)).toEqual([])
    expect(sentTo(sent, ARRIVE)).toHaveLength(1)
    expect(screen.queryByRole('region', { name: 'Wristband' })).toBeNull()
  })

  it('drops the board it showed once the board answers that it is switched off, and shows it again once it is back', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      [BOARD]: [boardOf(card({ presentingComplaint: 'Fall from motorcycle, left leg pain' })), ...switchedOff(), boardOf(card())],
    })
    await openStaffApp('/provider/emergency-department')
    expect(await screen.findByRole('listitem', { name: 'Tunde Boardone' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText(NOT_AVAILABLE, {}, RETRIED)).toBeDefined()
    // Its patients are back on the waiting list while it is off: none of the board it showed stays on screen.
    expect(screen.queryByText('Tunde Boardone')).toBeNull()
    expect(screen.queryByText('Fall from motorcycle, left leg pain')).toBeNull()
    expect(screen.queryByLabelText('Patients in the department')).toBeNull()
    expect(screen.queryByRole('list', { name: /^Waiting/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New arrival' })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Show patients who left the board today' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('listitem', { name: 'Tunde Boardone' })).toBeDefined()
    expect(screen.queryByText(NOT_AVAILABLE)).toBeNull()
    expect(screen.getByRole('button', { name: 'New arrival' })).toBeDefined()
  })

  it('drops a record and its actions once the board answers that it is switched off, read or written', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      [RECORD]: [recordOf(card({ triageLevel: 2, presentingComplaint: 'Fall from motorcycle, left leg pain' })), ...switchedOff(), recordOf(card())],
      [action('move')]: [() => problem(503, 'ED_BOARD_NOT_AVAILABLE', 'Service unavailable')],
    })
    await openStaffApp(`/provider/emergency-department/${ATTENDANCE}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Tunde Boardone' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText(NOT_AVAILABLE, {}, RETRIED)).toBeDefined()
    expect(screen.queryByText('Tunde Boardone')).toBeNull()
    expect(screen.queryByText('Fall from motorcycle, left leg pain')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start care' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Triage' })).toBeNull()

    // Back on: read again, then a write answered 503 drops it the same way, with focus on the words left.
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    const start = await screen.findByRole('button', { name: 'Start care' })
    start.focus()
    fireEvent.click(start)
    expect(await screen.findByText(NOT_AVAILABLE)).toBeDefined()
    expect(screen.queryByRole('heading', { level: 1, name: 'Tunde Boardone' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start care' })).toBeNull()
    await waitFor(() => expect(document.activeElement?.id).toBe('ed-record-load-error'))
  })

  it('moves focus to the patient chosen, and back to the search for Choose someone else', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    serve({ [SESSION]: [sessionAt(nurse, [nurse])], [SEARCH]: [searchAnswer] })
    await openStaffApp('/provider/emergency-department/new')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: 'hid-bbbb33' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find patient' }))
    const choose = within(await screen.findByRole('listitem', { name: 'Tunde Boardone' })).getByRole('button', { name: 'Choose Tunde Boardone' })
    choose.focus()
    fireEvent.click(choose)
    // The button pressed is gone with the results: focus is on the patient chosen, not lost to the page.
    await waitFor(() => expect(document.activeElement?.id).toBe('ed-arrival-chosen'))
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Chosen: Tunde Boardone')
    const again = screen.getByRole('button', { name: 'Choose someone else' })
    again.focus()
    fireEvent.click(again)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'First name' })))
  })

  it('says in the guide that a board patient’s triage level is changed on the board only', async () => {
    const { PAGE_GUIDES } = await import('../../../../ehr-blue/frame/pageGuides')
    const tips = PAGE_GUIDES['emergency-department']!.tips!.join(' ')
    expect(tips).not.toContain('a change on one shows on the other')
    expect(tips).toContain('A board patient also shows on the waiting list, but their stage, triage level and who sees them are changed on the board only.')
  })
})
