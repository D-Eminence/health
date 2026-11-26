import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type * as BlueRoutes from '../../../../ehr-blue/routes'
import type * as PrintPaper from '../../../../print/printPaper'
import { REAL_FACILITY, SESSION, facility, json, openStaffApp, problem, serve, sessionAt, where, type Sent } from '../../frame/blueHarness'

/*
 * The emergency department board (hid-system ED-1, 0168 and 0169) inside the blue EHR's real frame, joined as
 * departments/pages.ts joins it: listed under Care for the roles the backend lets use it, reading and changing the board
 * with the contract's bodies and headers, each write with an Idempotency-Key, and never a Health ID, a matchRef or a
 * patient's name in an address. Every account, facility, patient and reference is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(async () => {
  vi.doMock('../../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../../ehr-blue/frame/pages')
    const home = await import('../../../../ehr-blue/home/pages')
    const { emergencyDepartmentPage } = await import('../../../../ehr-blue/departments/emergency/page')
    const { waitingListPage } = await import('../../../../ehr-blue/departments/waiting/page')
    return {
      ...actual,
      BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home,
        './departments/pages.ts': { pages: [waitingListPage, emergencyDepartmentPage] } }),
    }
  })
})
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.doUnmock('../../../../print/printPaper'); vi.resetModules()
})

const BOARD = 'GET /api/v1/ehr/ed-board'
const ARRIVE = 'POST /api/v1/ehr/ed-attendances'
const SEARCH = 'POST /api/v1/identity/patient-search'
const UNKNOWN = 'POST /api/v1/identity/unknown-patients'
const ATTENDANCE = 'e0000000-0000-4000-8000-0000000000e1'
const RECORD = `GET /api/v1/ehr/ed-attendances/${ATTENDANCE}`
const action = (name: string) => `POST /api/v1/ehr/ed-attendances/${ATTENDANCE}/${name}`
const PATIENT = 'b0000000-0000-4000-8000-0000000000f1'
const MATCH_REF = `psr_${'B'.repeat(43)}`
const ED = ['ehr.ed.read', 'ehr.encounter.read', 'ehr.encounter.write']
const FRONT_DESK = [...ED, 'ehr.ed.arrive', 'identity.registration.write', 'identity.patient.read']
const NURSE = [...ED, 'ehr.ed.arrive', 'ehr.ed.triage', 'ehr.note.write', 'identity.patient.read']
const DOCTOR = [...NURSE, 'ehr.ed.disposition', 'identity.registration.write']
const ME = `member-${REAL_FACILITY}`
const nav = () => screen.getByRole('navigation', { name: 'Main navigation' })

function card(overrides: Record<string, unknown> = {}) {
  return {
    attendanceId: ATTENDANCE, entryId: 'a0000000-0000-4000-8000-0000000000a1', patientId: PATIENT, fullName: 'Tunde Boardone',
    recordKind: 'standard', unknownLabel: null, sex: 'male', dateOfBirth: '1984-03-09', dateOfBirthEstimated: false,
    healthIdLast4: 'BB33', chartBlocked: false, arrivalBasis: 'search', arrivalMode: 'ambulance', arrivedAt: '2026-12-03T08:10:00.000Z',
    minutesInDepartment: 42, column: 'waiting', stage: 'ready', triageLevel: 2, triagedAt: '2026-12-03T08:16:00.000Z',
    triagedByMembershipId: null, presentingComplaint: 'Fall from motorcycle, left leg pain', complaintHidden: false,
    assignedMembershipId: null, encounterId: null, status: 'open', disposition: null, leftAt: null, rowVersion: 3, ...overrides,
  }
}
const boardOf = (...items: ReturnType<typeof card>[]) => () => json({ items,
  counts: { waiting: items.filter(item => item.column === 'waiting').length, beingSeen: items.filter(item => item.column === 'being_seen').length,
    disposition: items.filter(item => item.column === 'disposition').length }, hasMore: false, limit: 200 })
const recordOf = (attendance = card(), history: unknown[] = []) => () => json({ attendance, history })
const written = (attendance = card()) => () => json({ attendance, replayed: false })

function noIdentityInAddresses() {
  for (const [url] of vi.mocked(fetch).mock.calls) expect(String(url)).not.toMatch(/HID-|psr_|Boardone|healthId/i)
}
function sentTo(sent: readonly Sent[], route: string) { return sent.filter(call => call.route === route) }
function checkHeaders(call: Sent, purpose = 'direct-care') {
  expect(call.headers.get('X-Purpose-Of-Use')).toBe(purpose)
  expect(call.headers.get('X-Facility-ID')).toBe(REAL_FACILITY)
}

describe('Emergency department board in the frame', () => {
  it('is listed under Care and shows the three columns, counts, the live triage words and the staff-only warning', async () => {
    // The morning of the cards' day in Lagos: their times are today's, so shown without a date (P2-4).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-03T10:00:00.000Z'))
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    const sent = serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      [BOARD]: [boardOf(
        card(),
        card({ attendanceId: 'e0000000-0000-4000-8000-0000000000e2', fullName: 'Unknown patient U-0007', recordKind: 'unknown',
          unknownLabel: 'U-0007', dateOfBirth: '1991-07-01', dateOfBirthEstimated: true, column: 'being_seen', stage: 'with_clinician',
          triageLevel: 4, assignedMembershipId: ME, presentingComplaint: null, minutesInDepartment: 125 }),
        card({ attendanceId: 'e0000000-0000-4000-8000-0000000000e3', fullName: 'Ada Boardtwo', column: 'disposition', status: 'decided',
          triageLevel: null, disposition: { outcome: 'admit_requested', decidedAt: '2026-12-03T09:00:00.000Z', decidedByMembershipId: ME,
            admitToDepartmentCode: 'inpatient', admittingMembershipId: null, referredToFacilityName: null } }),
      )],
    })
    await openStaffApp('/provider/emergency-department')
    expect(await screen.findByRole('heading', { level: 1, name: 'Emergency department' })).toBeDefined()
    expect(within(nav()).getByRole('link', { name: 'Emergency department' }).getAttribute('href')).toBe('/provider/emergency-department')
    expect(screen.getByText('Do not show this board on a screen patients or visitors can see.')).toBeDefined()

    const waiting = await screen.findByRole('list', { name: 'Waiting (1)' })
    const first = within(waiting).getByRole('listitem', { name: 'Tunde Boardone' })
    expect(within(first).getByText('Level 2: very urgent')).toBeDefined()
    expect(within(first).getByText('Ready to be seen')).toBeDefined()
    // 08:10 UTC is 09:10 in Lagos, whatever the device's zone.
    expect(within(first).getByText('09:10')).toBeDefined()
    expect(within(first).getByText('42 min')).toBeDefined()
    expect(within(first).getByText('Ambulance')).toBeDefined()
    expect(within(first).getByText('Fall from motorcycle, left leg pain')).toBeDefined()
    expect(within(first).getByLabelText('Health ID ending BB33').textContent).toBe('•••• BB33')
    // A level 1 or 2 card is in the critical tone, as on the waiting list; no timer colours.
    expect(first.className).toContain('hid-ehr-dept-emergency-urgent')
    expect(within(first).getByRole('link', { name: 'Tunde Boardone' }).getAttribute('href')).toBe(`/provider/emergency-department/${ATTENDANCE}`)

    const seen = screen.getByRole('list', { name: 'Being seen (1)' })
    const unknown = within(seen).getByRole('listitem', { name: 'Unknown patient U-0007' })
    expect(within(unknown).getByText('Unknown patient')).toBeDefined()
    expect(within(unknown).getByText(/Estimated age/)).toBeDefined()
    expect(within(unknown).getByText('You')).toBeDefined()
    expect(within(unknown).getByText('2 h 5 min')).toBeDefined()
    expect(within(unknown).getByText('None recorded')).toBeDefined()

    const decided = within(screen.getByRole('list', { name: 'Disposition (1)' })).getByRole('listitem', { name: 'Ada Boardtwo' })
    expect(within(decided).getByText('Waiting for admission')).toBeDefined()
    expect(within(decided).getByText('No triage level yet')).toBeDefined()

    expect(screen.getByLabelText('Patients in the department').textContent).toBe('Waiting1Being seen1Disposition1')
    expect(document.body.textContent).not.toMatch(/with_clinician|admit_requested|permission/i)
    checkHeaders(sentTo(sent, BOARD)[0]!)
    noIdentityInAddresses()
  })

  it('hides the complaint from the front desk, and offers New arrival without triage fields', async () => {
    const desk = facility(REAL_FACILITY, 'Fictional Hospital', FRONT_DESK, ['receptionist'])
    serve({
      [SESSION]: [sessionAt(desk, [desk])],
      [BOARD]: [boardOf(card({ presentingComplaint: null, complaintHidden: true }))],
    })
    await openStaffApp('/provider/emergency-department')
    const row = await screen.findByRole('listitem', { name: 'Tunde Boardone' })
    expect(within(row).queryByText('Complaint')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New arrival' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'New arrival' })).toBeDefined()
    expect(where()).toBe('/provider/emergency-department/new')
    expect(screen.queryByRole('combobox', { name: /Triage level/ })).toBeNull()
    expect(screen.queryByRole('textbox', { name: /Presenting complaint/ })).toBeNull()
  })

  it('is not listed for lab staff, and its address says who can use it without reading', async () => {
    const lab = facility(REAL_FACILITY, 'Fictional Hospital', ['ehr.encounter.read', 'lab.work-item.read'], ['lab_scientist'])
    const sent = serve({ [SESSION]: [sessionAt(lab, [lab])] })
    await openStaffApp('/provider/emergency-department')
    expect(await screen.findByText('Only the front desk, nurses, clinicians and doctors of this facility can use the emergency board.')).toBeDefined()
    expect(within(nav()).queryByRole('link', { name: 'Emergency department' })).toBeNull()
    expect(sent.filter(call => call.route.includes('/ed-'))).toEqual([])
  })

  it('says the board is not available yet while it is switched off (503), and stops listing it', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      // The client may ask again after a 503: every answer says the same.
      [BOARD]: Array.from({ length: 5 }, () => () => problem(503, 'ED_BOARD_NOT_AVAILABLE', 'Service unavailable')),
    })
    await openStaffApp('/provider/emergency-department')
    expect(await screen.findByText('The emergency board is not available yet.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'New arrival' })).toBeNull()
    await waitFor(() => expect(within(nav()).queryByRole('link', { name: 'Emergency department' })).toBeNull())
  })

  it('says an ehr-api without the board (404) is not available yet, and a guard’s 403 in plain words', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      [BOARD]: [() => problem(403, 'PERMISSION_DENIED', 'Required permission is missing'),
        () => problem(404, 'NOT_FOUND', 'Cannot GET /api/v1/ehr/ed-board')],
    })
    await openStaffApp('/provider/emergency-department')
    expect(await screen.findByText('Only the front desk, nurses, clinicians and doctors of this facility can use the emergency board.')).toBeDefined()
    expect(document.body.textContent).not.toMatch(/permission/i)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('The emergency board is not available yet.')).toBeDefined()
  })

  it('adds a patient from a search card by its matchRef, with triage, an Idempotency-Key and the Health ID only in the search body', async () => {
    const doctor = facility(REAL_FACILITY, 'Fictional Hospital', DOCTOR, ['doctor'])
    const sent = serve({
      [SESSION]: [sessionAt(doctor, [doctor])],
      [SEARCH]: [() => json({ mode: 'standard', outcome: 'found', reach: 'everywhere', message: null, patients: [{
        matchRef: MATCH_REF, matchRefExpiresAt: '2999-01-01T00:00:00.000Z', fullName: 'Tunde Boardone', sex: 'male',
        dateOfBirth: '1984-03-09', healthIdLast4: 'BB33', ninStatus: 'verified' }] })],
      [ARRIVE]: [() => json({ outcome: 'arrived', attendance: card(), replayed: false }, 201)],
    })
    await openStaffApp('/provider/emergency-department/new')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: 'hid-bbbb33' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find patient' }))
    const found = await screen.findByRole('listitem', { name: 'Tunde Boardone' })
    expect(within(found).getByText('NIN Verified')).toBeDefined()
    expect(sentTo(sent, SEARCH)[0]!.body).toEqual({ healthId: 'HID-BBBB33' })
    expect(document.body.innerHTML).not.toContain(MATCH_REF)
    fireEvent.click(within(found).getByRole('button', { name: 'Choose Tunde Boardone' }))
    expect(screen.getByLabelText('Chosen: Tunde Boardone')).toBeDefined()

    // How they came is required.
    fireEvent.click(screen.getByRole('button', { name: 'Add to the board' }))
    expect(await screen.findByText('Choose how the patient came.')).toBeDefined()
    expect(sentTo(sent, ARRIVE)).toEqual([])

    fireEvent.change(screen.getByRole('combobox', { name: 'How they came' }), { target: { value: 'ambulance' } })
    fireEvent.change(screen.getByRole('combobox', { name: /Triage level/ }), { target: { value: '2' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Presenting complaint/ }), { target: { value: '  Fall from motorcycle, left leg pain ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to the board' }))
    expect(await screen.findByText('Tunde Boardone is on the board.')).toBeDefined()
    const arrival = sentTo(sent, ARRIVE)[0]!
    expect(arrival.body).toEqual({ matchRef: MATCH_REF, arrivalMode: 'ambulance', triageLevel: 2, presentingComplaint: 'Fall from motorcycle, left leg pain' })
    checkHeaders(arrival)
    expect(arrival.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)
    expect(screen.getByRole('link', { name: 'Open their record' }).getAttribute('href')).toBe(`/provider/emergency-department/${ATTENDANCE}`)
    noIdentityInAddresses()
  })

  it('on ED_ARRIVAL_NEEDS_SEARCH says so and goes back to the search', async () => {
    const desk = facility(REAL_FACILITY, 'Fictional Hospital', FRONT_DESK, ['receptionist'])
    serve({
      [SESSION]: [sessionAt(desk, [desk])],
      [SEARCH]: [() => json({ mode: 'standard', outcome: 'found', reach: 'everywhere', message: null, patients: [{
        matchRef: MATCH_REF, matchRefExpiresAt: '2999-01-01T00:00:00.000Z', fullName: 'Tunde Boardone', sex: 'male',
        dateOfBirth: null, healthIdLast4: 'BB33', ninStatus: 'not_verified' }] })],
      [ARRIVE]: [() => problem(403, 'ED_ARRIVAL_NEEDS_SEARCH', 'Search first.')],
    })
    await openStaffApp('/provider/emergency-department/new')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Last name' }), { target: { value: 'Boardone' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'First name' }), { target: { value: 'Tunde' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find patient' }))
    const found = await screen.findByRole('listitem', { name: 'Tunde Boardone' })
    expect(within(found).getByText('NIN Not Verified')).toBeDefined()
    fireEvent.click(within(found).getByRole('button', { name: 'Choose Tunde Boardone' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'How they came' }), { target: { value: 'walk_in' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to the board' }))
    expect(await screen.findByText('Search for the patient first, then add them to the board. A search result can be used for 10 minutes.')).toBeDefined()
    expect(screen.queryByLabelText('Chosen: Tunde Boardone')).toBeNull()
    expect(screen.getByRole('button', { name: 'Find patient' })).toBeDefined()
  })

  it('makes an unknown patient’s record, shows its wristband Health ID at once, and puts it on the board by its patientId', async () => {
    // The wristband prints as a paper (printPaper: a PDF in Safari and on an iPad, with no web address), never the page.
    const printed = vi.fn()
    vi.doMock('../../../../print/printPaper', async importOriginal => ({
      ...await importOriginal<typeof PrintPaper>(), printPaper: printed,
    }))
    const pagePrint = vi.spyOn(window, 'print').mockImplementation(() => {})
    const desk = facility(REAL_FACILITY, 'Fictional Hospital', FRONT_DESK, ['receptionist'])
    const unknownCard = card({ fullName: 'Unknown patient U-0007', recordKind: 'unknown', unknownLabel: 'U-0007', triageLevel: null,
      presentingComplaint: null, complaintHidden: true, arrivalBasis: 'own-facility', arrivalMode: 'brought_by_public' })
    const sent = serve({
      [SESSION]: [sessionAt(desk, [desk])],
      [UNKNOWN]: [() => json({ patientId: PATIENT, recordKind: 'unknown', label: 'U-0007', displayName: 'Unknown patient U-0007',
        sex: 'male', dateOfBirth: '1991-07-01', dateOfBirthEstimated: true, ninStatus: 'not_verified', status: 'open',
        createdAt: '2026-12-03T08:10:00.000Z', openDays: 0, overdue: false, version: 1, hid: 'HID-ZZZZ77', replayed: false }, 201)],
      [ARRIVE]: [() => problem(503, 'ED_BOARD_NOT_AVAILABLE', 'Unavailable'), () => json({ outcome: 'arrived', attendance: unknownCard, replayed: false }, 201)],
    })
    await openStaffApp('/provider/emergency-department/new')
    fireEvent.click(await screen.findByRole('radio', { name: 'Unknown patient' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'How they came' }), { target: { value: 'brought_by_public' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to the board' }))
    expect(await screen.findByText('Choose the sex and why the patient cannot say who they are.')).toBeDefined()
    fireEvent.change(screen.getByRole('combobox', { name: 'Sex' }), { target: { value: 'male' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Estimated age/ }), { target: { value: '35' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Why they cannot say who they are' }), { target: { value: 'unconscious' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to the board' }))
    // The record is made once; the arrival refused (the board is off) is sent again with the same patient and key.
    expect(await screen.findByText('The emergency board is not available yet.')).toBeDefined()
    // The record exists although the arrival failed: its Health ID is on screen now, not only once the arrival is saved
    // (ID-7 answers it once; the unknown-patient list shows its last 4 characters).
    const madeNow = screen.getByRole('region', { name: 'Wristband' })
    expect(within(madeNow).getByText('HID-ZZZZ77', { selector: 'strong' })).toBeDefined()
    expect(within(madeNow).getByRole('button', { name: 'Print wristband' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Add to the board' }))
    expect(await screen.findByText('Unknown patient U-0007 is on the board.')).toBeDefined()
    expect(sentTo(sent, UNKNOWN)).toHaveLength(1)
    const made = sentTo(sent, UNKNOWN)[0]!
    expect(made.body).toEqual({ gender: 'male', unknownReason: 'unconscious', estimatedAgeYears: 35, purpose: 'healthcare-operations' })
    checkHeaders(made, 'healthcare-operations')
    const arrivals = sentTo(sent, ARRIVE)
    expect(arrivals.map(call => call.body)).toEqual([{ patientId: PATIENT, arrivalMode: 'brought_by_public' }, { patientId: PATIENT, arrivalMode: 'brought_by_public' }])
    expect(arrivals[1]!.headers.get('Idempotency-Key')).toBe(arrivals[0]!.headers.get('Idempotency-Key'))
    const wristband = screen.getByRole('region', { name: 'Wristband' })
    expect(within(wristband).getByText('HID-ZZZZ77', { selector: 'strong' })).toBeDefined()
    expect(within(wristband).getByText('It is not shown again once you leave this page.', { exact: false })).toBeDefined()
    fireEvent.click(within(wristband).getByRole('button', { name: 'Print wristband' }))
    expect(pagePrint).not.toHaveBeenCalled()
    expect(printed).toHaveBeenCalledOnce()
    const [paper, kind] = printed.mock.calls[0]! as [HTMLElement, unknown]
    expect(kind).toEqual({ size: 'slip', kind: 'Wristband' })
    // The slip alone: the facility's print header, the label and the Health ID, hidden on screen and from screen readers.
    expect(paper.getAttribute('data-receipt-print')).toBe('health-id')
    expect(paper.getAttribute('aria-hidden')).toBe('true')
    expect(paper.querySelector('[data-print-header]')?.textContent).toContain('Fictional Hospital')
    expect(paper.textContent).toContain('Unknown patient U-0007')
    expect(paper.textContent).toContain('HID-ZZZZ77')
    noIdentityInAddresses()
  })

  it('opens a record with its history, triages, and starts care, each with the row version the card showed', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    const sent = serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      [RECORD]: [
        recordOf(card({ stage: 'waiting', triageLevel: null, presentingComplaint: null }), [
          { kind: 'arrived', at: '2026-12-03T08:10:00.000Z', byMembershipId: ME, fromStage: null, toStage: 'waiting', triageLevel: null,
            outcome: null, reason: null, complaintChanged: false }]),
        recordOf(card({ rowVersion: 4 })),
        recordOf(card({ rowVersion: 5, stage: 'with_clinician', column: 'being_seen', assignedMembershipId: ME })),
      ],
      [action('triage')]: [written(card({ rowVersion: 4 }))],
      [action('move')]: [written(card({ rowVersion: 5, stage: 'with_clinician', column: 'being_seen', assignedMembershipId: ME }))],
    })
    await openStaffApp(`/provider/emergency-department/${ATTENDANCE}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Tunde Boardone' })).toBeDefined()
    const history = screen.getByRole('region', { name: 'History' })
    expect(within(history).getByText('Arrived')).toBeDefined()
    expect(within(history).getByText('You')).toBeDefined()
    // A nurse does not decide where the patient goes, and cannot cancel an arrival with a triage level... (cancel is the
    // front desk's and the triage holder's arrive code: shown, as the nurse also holds ehr.ed.arrive).
    expect(screen.queryByRole('button', { name: 'Record where they go next' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Triage' }))
    const form = screen.getByRole('form', { name: 'Triage' })
    fireEvent.click(within(form).getByRole('button', { name: 'Save triage' }))
    expect(within(form).getByText('Choose a triage level from 1 to 5.')).toBeDefined()
    fireEvent.change(within(form).getByRole('combobox', { name: /Triage level/ }), { target: { value: '2' } })
    fireEvent.change(within(form).getByRole('textbox', { name: /Presenting complaint/ }), { target: { value: 'Fall, left leg pain' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save triage' }))
    expect(await screen.findByText('Tunde Boardone’s triage is saved (Level 2: very urgent).')).toBeDefined()
    expect(sentTo(sent, action('triage'))[0]!.body).toEqual({ expectedRowVersion: 3, triageLevel: 2, presentingComplaint: 'Fall, left leg pain' })
    checkHeaders(sentTo(sent, action('triage'))[0]!)
    expect(sentTo(sent, action('triage'))[0]!.headers.get('Idempotency-Key')).toBeTruthy()

    fireEvent.click(await screen.findByRole('button', { name: 'Start care' }))
    expect(await screen.findByText('Tunde Boardone: you are seeing them now.')).toBeDefined()
    expect(sentTo(sent, action('move'))[0]!.body).toEqual({ expectedRowVersion: 4, stage: 'with_clinician', assignedMembershipId: ME })
    await waitFor(() => expect(sentTo(sent, RECORD)).toHaveLength(3))
    noIdentityInAddresses()
  })

  it('records an admission request, then Handed over to the ward', async () => {
    const doctor = facility(REAL_FACILITY, 'Fictional Hospital', DOCTOR, ['doctor'])
    const decided = card({ status: 'decided', column: 'disposition', rowVersion: 4, disposition: { outcome: 'admit_requested',
      decidedAt: '2026-12-03T09:00:00.000Z', decidedByMembershipId: ME, admitToDepartmentCode: 'inpatient', admittingMembershipId: ME,
      referredToFacilityName: null } })
    const sent = serve({
      [SESSION]: [sessionAt(doctor, [doctor])],
      [RECORD]: [recordOf(), recordOf(decided), recordOf(card({ ...decided, status: 'closed', column: 'closed', rowVersion: 5, leftAt: '2026-12-03T10:00:00.000Z' }))],
      [action('disposition')]: [written(decided)],
      [action('leave')]: [written(card({ ...decided, status: 'closed', column: 'closed', rowVersion: 5, leftAt: '2026-12-03T10:00:00.000Z' }))],
    })
    await openStaffApp(`/provider/emergency-department/${ATTENDANCE}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Record where they go next' }))
    const form = screen.getByRole('form', { name: 'Record where they go next' })
    expect(within(form).getAllByRole('radio')).toHaveLength(7)
    fireEvent.click(within(form).getByRole('radio', { name: /Admission requested/ }))
    fireEvent.click(within(form).getByRole('button', { name: 'Save the decision' }))
    expect(within(form).getByText('Choose a department of this facility to admit the patient to.')).toBeDefined()
    const departments = within(form).getByRole('combobox', { name: /Admit to/ })
    expect(within(departments).queryByRole('option', { name: 'Emergency' })).toBeNull()
    fireEvent.change(departments, { target: { value: 'inpatient' } })
    fireEvent.change(within(form).getByRole('combobox', { name: /Admitting doctor/ }), { target: { value: 'mine' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save the decision' }))
    expect(await screen.findByText('Tunde Boardone: admission requested.')).toBeDefined()
    expect(sentTo(sent, action('disposition'))[0]!.body).toEqual({ expectedRowVersion: 3, outcome: 'admit_requested',
      admitToDepartmentCode: 'inpatient', admittingMembershipId: ME })

    fireEvent.click(await screen.findByRole('button', { name: 'Handed over to the ward' }))
    expect(await screen.findByText('Tunde Boardone has left the department.')).toBeDefined()
    expect(sentTo(sent, action('leave'))[0]!.body).toEqual({ expectedRowVersion: 4 })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Handed over to the ward' })).toBeNull())
  })

  it('records a discharge home, and asks for a reason to change a decision', async () => {
    const doctor = facility(REAL_FACILITY, 'Fictional Hospital', DOCTOR, ['doctor'])
    const discharged = card({ status: 'decided', column: 'disposition', rowVersion: 4, disposition: { outcome: 'discharged',
      decidedAt: '2026-12-03T09:00:00.000Z', decidedByMembershipId: ME, admitToDepartmentCode: null, admittingMembershipId: null,
      referredToFacilityName: null } })
    const sent = serve({
      [SESSION]: [sessionAt(doctor, [doctor])],
      [RECORD]: [recordOf(discharged), recordOf(discharged)],
      [action('disposition')]: [written(discharged)],
    })
    await openStaffApp(`/provider/emergency-department/${ATTENDANCE}`)
    expect(await screen.findByRole('button', { name: 'Left the department' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Change the decision' }))
    const form = screen.getByRole('form', { name: 'Change the decision' })
    fireEvent.click(within(form).getByRole('radio', { name: /Referred to another facility/ }))
    fireEvent.change(within(form).getByRole('textbox', { name: 'Referred to' }), { target: { value: 'Fictional Teaching Hospital' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save the new decision' }))
    expect(within(form).getByText('Say why in at least 8 characters.')).toBeDefined()
    fireEvent.change(within(form).getByRole('textbox', { name: /Why the decision changed/ }), { target: { value: 'Needs a specialist' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save the new decision' }))
    await waitFor(() => expect(sentTo(sent, action('disposition'))).toHaveLength(1))
    expect(sentTo(sent, action('disposition'))[0]!.body).toEqual({ expectedRowVersion: 4, outcome: 'referred_out',
      referredToFacilityName: 'Fictional Teaching Hospital', reason: 'Needs a specialist' })
  })

  it('reloads the record when someone else changed it first (412), and says each refusal in plain words', async () => {
    const doctor = facility(REAL_FACILITY, 'Fictional Hospital', DOCTOR, ['doctor'])
    const sent = serve({
      [SESSION]: [sessionAt(doctor, [doctor])],
      [RECORD]: [recordOf(), recordOf(card({ rowVersion: 7 })), recordOf(card({ rowVersion: 7 }))],
      [action('move')]: [() => problem(412, 'ED_VERSION_CONFLICT', 'Version conflict')],
      [action('disposition')]: [() => problem(403, 'ED_DISPOSITION_NOT_ALLOWED', 'Only clinicians and doctors.')],
    })
    await openStaffApp(`/provider/emergency-department/${ATTENDANCE}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Start care' }))
    expect(await screen.findByText('Someone else changed this patient’s place on the board. Reload it and try again.')).toBeDefined()
    await waitFor(() => expect(sentTo(sent, RECORD)).toHaveLength(2))

    fireEvent.click(screen.getByRole('button', { name: 'Record where they go next' }))
    const form = screen.getByRole('form', { name: 'Record where they go next' })
    fireEvent.click(within(form).getByRole('radio', { name: /Left before being seen/ }))
    expect(within(form).getAllByText('The patient leaves the board and the waiting list now.').length).toBeGreaterThan(0)
    fireEvent.click(within(form).getByRole('button', { name: 'Save the decision' }))
    expect(await screen.findByText('Only clinicians and doctors can record where the patient goes next.')).toBeDefined()
    expect(sentTo(sent, action('disposition'))[0]!.body).toEqual({ expectedRowVersion: 7, outcome: 'left_before_seen' })
    expect(document.body.textContent).not.toMatch(/permission/i)
  })

  it('cancels an arrival made in error with a reason, and answers ED_CANCEL_NOT_ALLOWED in plain words', async () => {
    const desk = facility(REAL_FACILITY, 'Fictional Hospital', FRONT_DESK, ['receptionist'])
    const sent = serve({
      [SESSION]: [sessionAt(desk, [desk])],
      [RECORD]: [recordOf(card({ presentingComplaint: null, complaintHidden: true })), recordOf(card({ complaintHidden: true, presentingComplaint: null }))],
      [action('cancel')]: [() => problem(409, 'ED_CANCEL_NOT_ALLOWED', 'Not allowed')],
    })
    await openStaffApp(`/provider/emergency-department/${ATTENDANCE}`)
    expect(await screen.findByText('Shown to nurses, clinicians and doctors only')).toBeDefined()
    // The front desk does not triage, move or decide.
    expect(screen.queryByRole('button', { name: 'Triage' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start care' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Record where they go next' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel arrival' }))
    const form = screen.getByRole('form', { name: 'Cancel arrival' })
    fireEvent.change(within(form).getByRole('textbox', { name: /Why it is cancelled/ }), { target: { value: 'short' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel arrival' }))
    expect(within(form).getByText('Say why in at least 8 characters.')).toBeDefined()
    fireEvent.change(within(form).getByRole('textbox', { name: /Why it is cancelled/ }), { target: { value: 'Added the wrong patient' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel arrival' }))
    expect(await screen.findByText('This arrival already has a visit or a decision, so it cannot be cancelled. Record where the patient goes next instead.')).toBeDefined()
    expect(sentTo(sent, action('cancel'))[0]!.body).toEqual({ expectedRowVersion: 3, reason: 'Added the wrong patient' })
    await waitFor(() => expect(sentTo(sent, RECORD)).toHaveLength(2))
  })

  it('after Cancel arrival, says the patient is still on the outpatient waiting list and links to it (route 9, hid-system 8c12017b)', async () => {
    const desk = facility(REAL_FACILITY, 'Fictional Hospital', FRONT_DESK, ['receptionist'])
    const hidden = { presentingComplaint: null, complaintHidden: true }
    const cancelled = card({ ...hidden, status: 'closed', column: 'closed', stage: 'waiting', triageLevel: null, leftAt: '2026-12-03T08:20:00.000Z', rowVersion: 4 })
    const sent = serve({
      [SESSION]: [sessionAt(desk, [desk])],
      // The front desk never gets the cancel's reason in the history, even its own (null).
      [RECORD]: [recordOf(card(hidden)), recordOf(cancelled, [
        { kind: 'arrived', at: '2026-12-03T08:10:00.000Z', byMembershipId: ME, fromStage: null, toStage: 'waiting', triageLevel: null,
          outcome: null, reason: null, complaintChanged: false },
        { kind: 'cancelled', at: '2026-12-03T08:20:00.000Z', byMembershipId: ME, fromStage: null, toStage: null, triageLevel: null,
          outcome: null, reason: null, complaintChanged: false }])],
      [action('cancel')]: [written(cancelled)],
    })
    await openStaffApp(`/provider/emergency-department/${ATTENDANCE}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel arrival' }))
    const form = screen.getByRole('form', { name: 'Cancel arrival' })
    // Said before it is done: only the ED record closes, the waiting-list place stays open.
    expect(form.textContent).toContain('The patient stays on the outpatient waiting list: cancel them there too if they are not waiting.')
    fireEvent.change(within(form).getByRole('textbox', { name: /Why it is cancelled/ }), { target: { value: 'Added the wrong patient' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel arrival' }))
    await waitFor(() => expect(document.getElementById('ed-record-notice')).not.toBeNull())
    const notice = document.getElementById('ed-record-notice')!
    expect(notice.textContent).toContain('Tunde Boardone’s arrival is cancelled. '
      + 'The patient is still on the outpatient waiting list. Cancel them there if they are not waiting.')
    expect(within(notice).getByRole('link', { name: 'Open the waiting list' }).getAttribute('href')).toBe('/provider/waiting-list')
    expect(sentTo(sent, action('cancel'))[0]!.body).toEqual({ expectedRowVersion: 3, reason: 'Added the wrong patient' })
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'History' })).getByText('Arrival cancelled')).toBeDefined())
    expect(screen.queryByText(/^Reason:/)).toBeNull()
  })

  it('says a record that is not on this facility’s board in plain words, and links an unknown patient to Patients', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      [RECORD]: [() => problem(404, 'ED_ATTENDANCE_NOT_FOUND', 'Not found')],
      [`GET /api/v1/ehr/ed-attendances/e0000000-0000-4000-8000-0000000000e9`]: [recordOf(card({ attendanceId: 'e0000000-0000-4000-8000-0000000000e9',
        fullName: 'Unknown patient U-0009', recordKind: 'unknown', unknownLabel: 'U-0009', dateOfBirthEstimated: true }))],
    })
    await openStaffApp(`/provider/emergency-department/${ATTENDANCE}`)
    expect(await screen.findByText('This patient is not on this facility’s emergency board.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Back to the board' }))
    expect(where()).toBe('/provider/emergency-department')
  })
})
