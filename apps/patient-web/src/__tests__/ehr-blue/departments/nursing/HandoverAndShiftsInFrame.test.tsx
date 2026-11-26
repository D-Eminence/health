import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { REAL_FACILITY, SESSION, facility, json, openStaffApp, problem, serve, sessionAt } from '../../frame/blueHarness'
import {
  ADMIN, ADMISSION, ADMISSION_HIDDEN, ADMISSION_READ, ADMISSIONS, ASSIGNMENTS, CHART, COLLEAGUE, HANDOVER, HANDOVERS, ME, NEW_SHIFT, NURSE,
  SET_ASSIGNMENTS, SHIFT, SHIFTS, SHIFT_NEXT, WARD, WARDS, card, hiddenCard, many, noIdentityInAddresses, sentTo, shift, wardsOf, withNursingPages,
} from './nursingFixtures'

/*
 * Shift handover and clinical shifts (hid-system NUR-1 routes 14-18; Q193 A) inside the blue EHR's real frame: the
 * ward's sheet with counts for all and notes only where the chart can be read, a note on a sheet not made yet, give and
 * accept; the facility's shifts set up by an admin under healthcare operations, and who is on each ward's shift. Every
 * account, facility, patient and reference is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => withNursingPages())
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const nurse = () => facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
/** A press from the keyboard: focus on the control, then its click. */
const press = (control: HTMLElement) => { control.focus(); fireEvent.click(control) }
const shiftsOf = (...items: ReturnType<typeof shift>[]) => () => json({ items: items.length ? items : [shift()], fluidDayStartsAtHour: 7 })

function sheet(overrides: Record<string, unknown> = {}) {
  return {
    handoverId: HANDOVER, status: 'draft', wardId: WARD, wardType: 'general', date: '2026-12-03', shiftId: SHIFT,
    from: '2026-12-03T06:30:00.000Z', to: '2026-12-03T13:30:00.000Z',
    nextShift: { shiftId: SHIFT_NEXT, date: '2026-12-03', from: '2026-12-03T13:00:00.000Z', to: '2026-12-03T20:00:00.000Z' },
    fromMembershipIds: [ME], toMembershipIds: [COLLEAGUE], givenByMembershipId: null, givenAt: null, acceptedByMembershipId: null,
    acceptedAt: null, rowVersion: 2,
    patients: [
      { admissionId: ADMISSION, patient: card(), bedName: 'Bed 4', chartShown: true, lastObservationAt: '2026-12-03T11:00:00.000Z',
        flagsSinceLastShift: 2, dosesMissedThisShift: 1, dosesDueNextShift: 3, openTasks: 2, overdueTasks: 1, fluidBalanceMl: -250,
        watch: true, handoverNoteId: 'n1', handoverNote: 'Breathing better on 2 L. Recheck glucose at 16:00.', noteHidden: false, itemRowVersion: 4 },
      { admissionId: ADMISSION_HIDDEN, patient: hiddenCard(), bedName: 'Bed 7', chartShown: false, lastObservationAt: null,
        flagsSinceLastShift: null, dosesMissedThisShift: 0, dosesDueNextShift: 1, openTasks: 0, overdueTasks: 0, fluidBalanceMl: null,
        watch: false, handoverNoteId: 'n2', handoverNote: null, noteHidden: true, itemRowVersion: 1 },
    ],
    ...overrides,
  }
}

describe('Shift handover in the frame', () => {
  it('shows the sheet: counts for every patient, notes and chart figures only where the chart can be read', async () => {
    const member = nurse()
    const sent = serve({
      [SESSION]: [sessionAt(member, [member])],
      [WARDS]: [wardsOf()],
      [SHIFTS]: [shiftsOf()],
      [HANDOVERS]: many(() => json(sheet())),
    })
    await openStaffApp('/provider/handover')
    expect(await screen.findByRole('heading', { level: 1, name: 'Shift handover' })).toBeDefined()
    expect(screen.getByText('Do not show this list on a screen patients or visitors can see.')).toBeDefined()
    const patients = await screen.findByRole('list', { name: 'Patients' })
    const ada = within(patients).getByRole('listitem', { name: 'Ada Wardone' })
    expect(within(ada).getByText('Watch closely')).toBeDefined()
    expect(within(ada).getByText('2 (1 overdue)')).toBeDefined()
    expect(within(ada).getByText('−250 mL')).toBeDefined()
    expect(within(ada).getByText('2 readings')).toBeDefined()
    expect(within(ada).getByText('Breathing better on 2 L. Recheck glucose at 16:00.')).toBeDefined()
    const hidden = within(patients).getByRole('listitem', { name: 'B T' })
    expect(within(hidden).getByText('Open the record to read the note.')).toBeDefined()
    expect(within(hidden).queryByText('Fluid balance so far')).toBeNull()
    expect(within(hidden).queryByRole('button', { name: /note/ })).toBeNull()
    expect(screen.getByText('You')).toBeDefined()
    expect(screen.getByText('Draft')).toBeDefined()
    const url = new URL(String(vi.mocked(fetch).mock.calls.find(([address]) => String(address).includes('/handovers?'))![0]))
    expect(url.searchParams.get('wardId')).toBe(WARD)
    expect(url.searchParams.get('shiftId')).toBe(SHIFT)
    expect(url.searchParams.get('date')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(sentTo(sent, HANDOVERS)[0]!.headers.get('X-Purpose-Of-Use')).toBe('direct-care')
    noIdentityInAddresses()
  })

  it('writes the first note of a shift on a sheet not made yet, then gives the sheet', async () => {
    const member = nurse()
    const route = `PUT /api/v1/ehr/handovers/new/patients/${ADMISSION}`
    const sent = serve({
      [SESSION]: [sessionAt(member, [member])],
      [WARDS]: [wardsOf()],
      [SHIFTS]: [shiftsOf()],
      [HANDOVERS]: [() => json(sheet({ handoverId: null, rowVersion: null, patients: [{ ...sheet().patients[0], handoverNoteId: null, handoverNote: null, watch: false, itemRowVersion: null }] })),
        ...many(() => json(sheet()))],
      [route]: [() => json({ handoverId: HANDOVER, item: { admissionId: ADMISSION, handoverNoteId: 'n1', watch: true, rowVersion: 1 }, replayed: false })],
      [`POST /api/v1/ehr/handovers/${HANDOVER}/give`]: [() => json({ handover: { handoverId: HANDOVER, status: 'given', givenByMembershipId: ME,
        givenAt: '2026-12-03T13:20:00.000Z', acceptedByMembershipId: null, acceptedAt: null, rowVersion: 3 }, replayed: false })],
    })
    await openStaffApp('/provider/handover')
    expect(await screen.findByText('Write a note for a patient to start this shift’s sheet.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Give the handover' })).toBeNull()
    const ada = await screen.findByRole('listitem', { name: 'Ada Wardone' })
    // The note opens in place of its button, with focus in it; Go back puts focus on the button again.
    press(within(ada).getByRole('button', { name: 'Write a note' }))
    expect(document.activeElement).toBe(within(ada).getByLabelText('Handover note'))
    press(within(ada).getByRole('button', { name: 'Go back' }))
    expect(document.activeElement).toBe(within(ada).getByRole('button', { name: 'Write a note' }))
    press(within(ada).getByRole('button', { name: 'Write a note' }))
    fireEvent.change(within(ada).getByLabelText('Handover note'), { target: { value: 'Breathing better on 2 L.' } })
    fireEvent.click(within(ada).getByRole('checkbox', { name: 'Watch closely next shift' }))
    press(within(ada).getByRole('button', { name: 'Save the note' }))
    await waitFor(() => expect(sentTo(sent, route)).toHaveLength(1))
    const put = sentTo(sent, route)[0]!
    expect(put.body).toEqual({ note: 'Breathing better on 2 L.', watch: true, wardId: WARD, date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), shiftId: SHIFT })
    expect(put.headers.get('Idempotency-Key')).toBeTruthy()
    press(await screen.findByRole('button', { name: 'Give the handover' }))
    expect(await screen.findByText('Handover given. A nurse on the next shift accepts it.')).toBeDefined()
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: /^Handover for / }))
    expect(sentTo(sent, `POST /api/v1/ehr/handovers/${HANDOVER}/give`)[0]!.body).toEqual({ expectedRowVersion: 2 })
  })

  it('opens a note from the sheet as last read and saves it against that version, never over a colleague’s newer note', async () => {
    const member = nurse()
    const route = `PUT /api/v1/ehr/handovers/${HANDOVER}/patients/${ADMISSION}`
    const OLD = 'Old note from the morning.'
    const COLLEAGUES = 'Fever 38.9 at 12:00, paracetamol given.'
    const withNote = (note: string, version: number) => () => json(sheet({ patients: [{ ...sheet().patients[0], watch: false,
      handoverNote: note, itemRowVersion: version }] }))
    const sent = serve({
      [SESSION]: [sessionAt(member, [member])],
      [WARDS]: [wardsOf()],
      [SHIFTS]: [shiftsOf()],
      // Read first, read again as the note opens, then a colleague's note (version 2) from Refresh on.
      [HANDOVERS]: [withNote(OLD, 1), withNote(OLD, 1), ...many(withNote(COLLEAGUES, 2), 8)],
      [route]: [() => problem(412, 'NURSING_VERSION_CONFLICT', 'Precondition Failed')],
    })
    await openStaffApp('/provider/handover')
    let ada = await screen.findByRole('listitem', { name: 'Ada Wardone' })
    await within(ada).findByText(OLD)
    fireEvent.click(within(ada).getByRole('button', { name: 'Change the note' }))
    await waitFor(() => expect(sentTo(sent, HANDOVERS)).toHaveLength(2))
    const box = () => within(screen.getByRole('listitem', { name: 'Ada Wardone' })).getByLabelText('Handover note') as HTMLTextAreaElement
    fireEvent.change(box(), { target: { value: `${OLD} Stable.` } })
    // The colleague's note arrives while this one is being written: saving it would write over theirs.
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    ada = screen.getByRole('listitem', { name: 'Ada Wardone' })
    await within(ada).findByText(COLLEAGUES)
    fireEvent.click(within(ada).getByRole('button', { name: 'Save the note' }))
    expect(await within(ada).findByText(/Someone else changed this note while you were writing/)).toBeDefined()
    expect(sentTo(sent, route)).toHaveLength(0)
    // Opened again, it starts from the colleague's note, and is saved against its version.
    fireEvent.click(within(ada).getByRole('button', { name: 'Go back' }))
    fireEvent.click(within(ada).getByRole('button', { name: 'Change the note' }))
    expect(box().value).toBe(COLLEAGUES)
    fireEvent.change(box(), { target: { value: `${COLLEAGUES} Stable since.` } })
    fireEvent.click(within(ada).getByRole('button', { name: 'Save the note' }))
    await waitFor(() => expect(sentTo(sent, route)).toHaveLength(1))
    expect(sentTo(sent, route)[0]!.body).toEqual({ note: `${COLLEAGUES} Stable since.`, watch: false, expectedRowVersion: 2 })
    // A note changed again meanwhile: the server's 412 is said the same way.
    expect(await within(ada).findByText(/Someone else changed this note while you were writing/)).toBeDefined()
  })

  it('opens a patient’s chart from the sheet, whose back arrow comes back to the same ward, day and shift', async () => {
    const member = nurse()
    const sent = serve({
      [SESSION]: [sessionAt(member, [member])],
      [WARDS]: many(wardsOf()),
      [SHIFTS]: many(shiftsOf(shift(), shift({ shiftId: SHIFT_NEXT, name: 'Afternoon', startsAt: '14:00', endsAt: '21:00' }))),
      [HANDOVERS]: many(() => json(sheet()), 10),
      [ADMISSION_READ]: many(() => json({ admission: card(), movements: [] })),
      [CHART]: many(() => json({ admissionId: ADMISSION, encounterId: 'e1', wardType: 'general', from: '2026-12-02T08:00:00.000Z',
        to: '2026-12-03T08:00:00.000Z', readings: [], rangesVersion: '2026-11-adult-1', score: null })),
    })
    await openStaffApp('/provider/handover')
    await screen.findByRole('list', { name: 'Patients' })
    // An earlier day's afternoon sheet, not the shift on now.
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-12-01' } })
    fireEvent.change(screen.getByLabelText('Shift'), { target: { value: SHIFT_NEXT } })
    const asked = () => sentTo(sent, HANDOVERS).length
    const read = (at: number) => new URL(String(vi.mocked(fetch).mock.calls.filter(([address]) => String(address).includes('/handovers?'))[at]![0])).searchParams
    await waitFor(() => expect(read(asked() - 1).get('shiftId')).toBe(SHIFT_NEXT))
    expect(read(asked() - 1).get('date')).toBe('2026-12-01')
    const patients = await screen.findByRole('list', { name: 'Patients' })
    fireEvent.click(within(within(patients).getByRole('listitem', { name: 'Ada Wardone' })).getByRole('link', { name: 'Ada Wardone' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Ada Wardone' })).toBeDefined()
    const before = asked()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Shift handover' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Shift handover' })).toBeDefined()
    await waitFor(() => expect(asked()).toBeGreaterThan(before))
    expect(read(asked() - 1).get('date')).toBe('2026-12-01')
    expect(read(asked() - 1).get('shiftId')).toBe(SHIFT_NEXT)
    expect((screen.getByLabelText('Day') as HTMLInputElement).value).toBe('2026-12-01')
    expect((screen.getByLabelText('Shift') as HTMLSelectElement).value).toBe(SHIFT_NEXT)
    noIdentityInAddresses()
  })

  it('says only a nurse on the next shift can accept, and that a given sheet takes no more notes', async () => {
    const member = nurse()
    serve({
      [SESSION]: [sessionAt(member, [member])],
      [WARDS]: [wardsOf()],
      [SHIFTS]: [shiftsOf()],
      [HANDOVERS]: many(() => json(sheet({ status: 'given', givenByMembershipId: COLLEAGUE, givenAt: '2026-12-03T13:20:00.000Z', rowVersion: 3 }))),
      [`POST /api/v1/ehr/handovers/${HANDOVER}/accept`]: [() => problem(409, 'HANDOVER_NOT_YOURS', 'Conflict')],
    })
    await openStaffApp('/provider/handover')
    expect(await screen.findByText('Given, waiting to be accepted')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Change the note' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Accept the handover' }))
    expect(await screen.findByText('Only a nurse on the next shift for this ward can accept the handover.')).toBeDefined()
  })

  it('says when no clinical shifts are set up yet, and where they are set up', async () => {
    const member = nurse()
    serve({ [SESSION]: [sessionAt(member, [member])], [WARDS]: [wardsOf()], [SHIFTS]: [() => json({ items: [], fluidDayStartsAtHour: 7 })] })
    await openStaffApp('/provider/handover')
    expect(await screen.findByText(/No clinical shifts are set up yet/)).toBeDefined()
    expect(screen.getAllByRole('link', { name: 'Clinical shifts' }).some(link => link.getAttribute('href') === '/provider/clinical-shifts')).toBe(true)
  })
})

describe('Clinical shifts in the frame', () => {
  it('adds a shift again once stopped as a new request, never as the first one replayed', async () => {
    const admin = facility(REAL_FACILITY, 'Fictional Hospital', ADMIN, ['admin'])
    const sent = serve({
      [SESSION]: [sessionAt(admin, [admin])],
      // None yet; then Morning, stopped by mistake.
      [SHIFTS]: [() => json({ items: [], fluidDayStartsAtHour: 7 }), ...many(shiftsOf(shift({ active: false })))],
      [NEW_SHIFT]: [() => json({ shiftId: SHIFT, replayed: false }, 201), () => json({ shiftId: SHIFT_NEXT, replayed: false }, 201)],
      [WARDS]: many(() => json({ items: [] })),
    })
    await openStaffApp('/provider/clinical-shifts')
    press(await screen.findByRole('button', { name: 'Add Morning 07:30 to 14:30' }))
    expect(await screen.findByText('Morning added.')).toBeDefined()
    // A suggestion added is no longer offered once the shifts are read again: focus goes to its section's heading.
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Add a shift' }))
    expect(await screen.findByText('Stopped')).toBeDefined()
    press(screen.getByRole('button', { name: 'Add Morning 07:30 to 14:30' }))
    await waitFor(() => expect(sentTo(sent, NEW_SHIFT)).toHaveLength(2))
    const [first, second] = sentTo(sent, NEW_SHIFT)
    expect(second!.body).toEqual(first!.body)
    expect(second!.headers.get('Idempotency-Key')).not.toBe(first!.headers.get('Idempotency-Key'))
  })

  it('lets an admin add the suggested shifts under healthcare operations, and says the limit in plain words', async () => {
    const admin = facility(REAL_FACILITY, 'Fictional Hospital', ADMIN, ['admin'])
    const sent = serve({
      [SESSION]: [sessionAt(admin, [admin])],
      [SHIFTS]: [() => json({ items: [], fluidDayStartsAtHour: 7 }), ...many(shiftsOf())],
      [NEW_SHIFT]: [() => json({ shiftId: SHIFT, replayed: false }, 201), () => problem(409, 'SHIFT_LIMIT_REACHED', 'Conflict')],
      [WARDS]: many(() => json({ items: [] })),
      [ASSIGNMENTS]: many(() => json({ date: '2026-12-03', shiftId: SHIFT, wardId: WARD, from: '', to: '', version: 0, assignments: [] })),
    })
    await openStaffApp('/provider/clinical-shifts')
    expect(await screen.findByRole('heading', { level: 1, name: 'Clinical shifts' })).toBeDefined()
    expect(await screen.findByText('No shifts set up yet')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Add Morning 07:30 to 14:30' }))
    expect(await screen.findByText('Morning added.')).toBeDefined()
    const created = sentTo(sent, NEW_SHIFT)[0]!
    expect(created.body).toEqual({ name: 'Morning', startsAt: '07:30', endsAt: '14:30' })
    expect(created.headers.get('X-Purpose-Of-Use')).toBe('healthcare-operations')
    expect(sentTo(sent, SHIFTS)[0]!.headers.get('X-Purpose-Of-Use')).toBe('healthcare-operations')
    // Morning is set up now: the other two are still offered.
    expect(await screen.findByRole('listitem', { name: 'Morning' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Add Morning 07:30 to 14:30' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add Night 20:30 to 08:00' }))
    expect(await screen.findByText('This facility already has 8 active shifts. Stop one first.')).toBeDefined()

    const form = screen.getByRole('form', { name: 'Add a shift' })
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Long day' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add shift' }))
    expect(await within(form).findByText('Enter a start and end time. A shift can run past midnight.')).toBeDefined()
    expect(sentTo(sent, NEW_SHIFT)).toHaveLength(2)
  })

  it('lets a nurse in charge say who is on a ward’s shift, with their patients, and shows the ICU warning', async () => {
    const member = nurse()
    const sent = serve({
      [SESSION]: [sessionAt(member, [member])],
      [SHIFTS]: many(shiftsOf()),
      [WARDS]: many(wardsOf()),
      // Bed 7 is ready for discharge and still on the ward: still allocated to a nurse.
      [ADMISSIONS]: many(() => json({ items: [card(), { ...hiddenCard(), status: 'discharge_ready' }], hasMore: false, limit: 500 })),
      [ASSIGNMENTS]: many(() => json({ date: '2026-12-03', shiftId: SHIFT, wardId: WARD, from: '2026-12-03T06:30:00.000Z', to: '2026-12-03T13:30:00.000Z',
        version: 4, assignments: [{ membershipId: ME, duty: 'nurse_in_charge', admissionIds: [ADMISSION] }] })),
      [SET_ASSIGNMENTS]: [() => json({ list: { version: 5 }, warnings: ['icu_nurse_over_two'], replayed: false })],
    })
    await openStaffApp('/provider/clinical-shifts')
    expect(await screen.findByRole('listitem', { name: 'Morning' })).toBeDefined()
    // A nurse sees the shifts but does not set them up.
    expect(screen.queryByRole('button', { name: 'Stop this shift' })).toBeNull()
    expect(screen.queryByRole('form', { name: 'Add a shift' })).toBeNull()
    const onShift = await screen.findByRole('list', { name: 'On this shift' })
    await waitFor(() => expect(within(onShift).getAllByRole('checkbox').length).toBe(2))
    const asked = new URL(String(vi.mocked(fetch).mock.calls.find(([address]) => String(address).includes('/ehr/admissions?'))![0]))
    expect(asked.searchParams.get('status')).toBe('open')
    // A new line takes focus on who it is for; a line removed gives it to the next line, or "Add someone".
    press(screen.getByRole('button', { name: 'Add someone' }))
    expect(document.activeElement).toBe(within(screen.getByRole('listitem', { name: 'Someone new, nurse' })).getByLabelText('Who'))
    press(screen.getByRole('button', { name: 'Remove this new line as nurse' }))
    expect(document.activeElement).toBe(within(screen.getByRole('listitem', { name: 'You, nurse in charge' })).getByLabelText('Who'))
    press(screen.getByRole('button', { name: 'Add someone' }))
    const rows = within(screen.getByRole('list', { name: 'On this shift' })).getAllByRole('listitem')
    fireEvent.change(within(rows[1]!).getByLabelText('Who'), { target: { value: COLLEAGUE } })
    fireEvent.click(within(rows[1]!).getByRole('checkbox', { name: 'Bed 7 · B T' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save who is on' }))
    expect(await screen.findByText('Saved. An ICU nurse has more than two patients.')).toBeDefined()
    expect(sentTo(sent, SET_ASSIGNMENTS)[0]!.body).toEqual({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), shiftId: SHIFT, wardId: WARD,
      expectedVersion: 4, assignments: [
        { membershipId: ME, duty: 'nurse_in_charge', admissionIds: [ADMISSION] },
        { membershipId: COLLEAGUE, duty: 'nurse', admissionIds: [ADMISSION_HIDDEN] },
      ] })
    expect(sentTo(sent, SHIFTS)[0]!.headers.get('X-Purpose-Of-Use')).toBe('direct-care')
  })

  it('never shows or saves one shift’s list under another, warns the list is staff only, and names each line', async () => {
    const member = nurse()
    const morning = { date: '2026-12-03', shiftId: SHIFT, wardId: WARD, from: '2026-12-03T06:30:00.000Z', to: '2026-12-03T13:30:00.000Z',
      version: 1, assignments: [{ membershipId: ME, duty: 'nurse_in_charge', admissionIds: [ADMISSION] }] }
    const afternoon = { ...morning, shiftId: SHIFT_NEXT, version: 3, assignments: [] }
    const sent = serve({
      [SESSION]: [sessionAt(member, [member])],
      [SHIFTS]: many(shiftsOf(shift(), shift({ shiftId: SHIFT_NEXT, name: 'Afternoon', startsAt: '14:00', endsAt: '21:00' }))),
      [WARDS]: many(wardsOf()),
      [ADMISSIONS]: many(() => json({ items: [card()], hasMore: false, limit: 500 }), 10),
      // Morning, then Afternoon refused (a read is tried three times), then Morning again and Afternoon read.
      [ASSIGNMENTS]: [() => json(morning), ...many(() => problem(503, 'SERVICE_UNAVAILABLE', 'Service unavailable'), 3), () => json(morning),
        () => json(afternoon)],
      [SET_ASSIGNMENTS]: [() => json({ list: { version: 4 }, warnings: [], replayed: false })],
    })
    await openStaffApp('/provider/clinical-shifts')
    const onShift = await screen.findByRole('list', { name: 'On this shift' })
    expect(screen.getByText('Do not show this list on a screen patients or visitors can see.')).toBeDefined()
    const mine = within(onShift).getByRole('listitem', { name: 'You, nurse in charge' })
    expect(within(mine).getByRole('button', { name: 'Remove yourself as nurse in charge' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Add someone' }))
    expect(screen.getByRole('listitem', { name: 'Someone new, nurse' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Remove this new line as nurse' })).toBeDefined()

    // Afternoon is read, then refused: Morning's list is neither shown under it nor saved as it.
    fireEvent.change(screen.getByLabelText('Shift'), { target: { value: SHIFT_NEXT } })
    expect(screen.queryByRole('list', { name: 'On this shift' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save who is on' })).toBeNull()
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toBeDefined()
    expect(screen.queryByRole('list', { name: 'On this shift' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save who is on' })).toBeNull()

    fireEvent.change(screen.getByLabelText('Shift'), { target: { value: SHIFT } })
    await screen.findByRole('list', { name: 'On this shift' })
    fireEvent.change(screen.getByLabelText('Shift'), { target: { value: SHIFT_NEXT } })
    expect(await screen.findByText('No one is on this shift yet')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Save who is on' }))
    await waitFor(() => expect(sentTo(sent, SET_ASSIGNMENTS)).toHaveLength(1))
    expect(sentTo(sent, SET_ASSIGNMENTS)[0]!.body).toEqual({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), shiftId: SHIFT_NEXT, wardId: WARD,
      expectedVersion: 3, assignments: [] })
  })

  const listOf = (version: number, assignments: unknown[]) => () => json({ date: '2026-12-03', shiftId: SHIFT, wardId: WARD,
    from: '2026-12-03T06:30:00.000Z', to: '2026-12-03T13:30:00.000Z', version, assignments })
  /** An admission allocated at 07:30 and discharged since: no longer on the ward, still on the list as read. */
  const GONE = 'd0000000-0000-4000-8000-0000000000d9'

  it('shows a patient who has left the ward as gone from their line, and leaves them out of what is saved', async () => {
    const member = nurse()
    const sent = serve({
      [SESSION]: [sessionAt(member, [member])],
      [SHIFTS]: many(shiftsOf()),
      [WARDS]: many(wardsOf()),
      [ADMISSIONS]: many(() => json({ items: [card()], hasMore: false, limit: 500 })),
      [ASSIGNMENTS]: many(listOf(4, [{ membershipId: ME, duty: 'nurse_in_charge', admissionIds: [] },
        { membershipId: COLLEAGUE, duty: 'nurse', admissionIds: [ADMISSION, GONE] }])),
      [SET_ASSIGNMENTS]: [() => json({ list: { version: 5 }, warnings: [], replayed: false })],
    })
    await openStaffApp('/provider/clinical-shifts')
    const onShift = await screen.findByRole('list', { name: 'On this shift' })
    const line = await within(onShift).findByRole('listitem', { name: 'A staff member here, nurse' })
    await waitFor(() => expect(within(line).getAllByRole('checkbox')).toHaveLength(1))
    expect((within(line).getByRole('checkbox', { name: 'Bed 4 · Ada Wardone' }) as HTMLInputElement).checked).toBe(true)
    expect(within(line).getByText('1 patient on this line has left the ward, and comes off it when you save.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Save who is on' }))
    expect(await screen.findByText('Saved.')).toBeDefined()
    expect(sentTo(sent, SET_ASSIGNMENTS)[0]!.body).toEqual({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), shiftId: SHIFT, wardId: WARD,
      expectedVersion: 4, assignments: [
        { membershipId: ME, duty: 'nurse_in_charge', admissionIds: [] },
        { membershipId: COLLEAGUE, duty: 'nurse', admissionIds: [ADMISSION] },
      ] })
  })

  it('tells an admin who cannot see the ward’s patients that only someone who can may save a list with one who has left', async () => {
    const admin = facility(REAL_FACILITY, 'Fictional Hospital', ADMIN, ['admin'])
    const sent = serve({
      [SESSION]: [sessionAt(admin, [admin])],
      [SHIFTS]: many(shiftsOf()),
      [WARDS]: many(wardsOf()),
      [ASSIGNMENTS]: many(listOf(4, [{ membershipId: COLLEAGUE, duty: 'nurse', admissionIds: [ADMISSION, GONE] }])),
      [SET_ASSIGNMENTS]: [() => new Response(JSON.stringify({ type: 'about:blank', title: 'Bad request', status: 400, code: 'VALIDATION_FAILED',
        detail: 'Some details were not accepted', errors: [{ field: 'assignments', messages: ['each patient must be an open admission on this ward'] }] }),
        { status: 400, headers: { 'Content-Type': 'application/problem+json' } })],
    })
    await openStaffApp('/provider/clinical-shifts')
    await screen.findByRole('list', { name: 'On this shift' })
    expect(screen.getByText(/If one has left the ward, only someone who can see the ward’s patients, such as the nurse in charge, can save the list\./)).toBeDefined()
    expect(sent.some(call => call.route === ADMISSIONS)).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Save who is on' }))
    expect(await screen.findByText('A patient on this list may have left the ward. Someone who can see the ward’s patients, such as the nurse in charge, must save it.')).toBeDefined()
    // Nothing it cannot see is taken off.
    expect((sentTo(sent, SET_ASSIGNMENTS)[0]!.body as { assignments: unknown[] }).assignments)
      .toEqual([{ membershipId: COLLEAGUE, duty: 'nurse', admissionIds: [ADMISSION, GONE] }])
  })

  it('reads the list again after someone else saved it, so the next Save sends its version; and Refresh reads it on asking', async () => {
    const member = nurse()
    const sent = serve({
      [SESSION]: [sessionAt(member, [member])],
      [SHIFTS]: many(shiftsOf()),
      [WARDS]: many(wardsOf()),
      [ADMISSIONS]: many(() => json({ items: [card(), hiddenCard()], hasMore: false, limit: 500 }), 10),
      [ASSIGNMENTS]: [listOf(4, [{ membershipId: ME, duty: 'nurse_in_charge', admissionIds: [] }]),
        ...many(listOf(5, [{ membershipId: ME, duty: 'nurse_in_charge', admissionIds: [] }, { membershipId: COLLEAGUE, duty: 'nurse', admissionIds: [ADMISSION] }]))],
      [SET_ASSIGNMENTS]: [() => problem(412, 'NURSING_VERSION_CONFLICT', 'Precondition failed'),
        () => json({ list: { version: 6 }, warnings: [], replayed: false })],
    })
    await openStaffApp('/provider/clinical-shifts')
    await screen.findByRole('list', { name: 'On this shift' })
    fireEvent.click(screen.getByRole('button', { name: 'Add someone' }))
    fireEvent.change(within(screen.getByRole('listitem', { name: 'Someone new, nurse' })).getByLabelText('Who'), { target: { value: COLLEAGUE } })
    fireEvent.click(screen.getByRole('button', { name: 'Save who is on' }))
    expect(await screen.findByText('Someone else changed who is on this shift. Their list has been read again, and your changes were not saved: make them again, then save.')).toBeDefined()
    // Their list, read again: a colleague with Bed 4.
    const theirs = await screen.findByRole('listitem', { name: 'A staff member here, nurse' })
    await waitFor(() => expect((within(theirs).getByRole('checkbox', { name: 'Bed 4 · Ada Wardone' }) as HTMLInputElement).checked).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Save who is on' }))
    expect(await screen.findByText('Saved.')).toBeDefined()
    const [first, second] = sentTo(sent, SET_ASSIGNMENTS)
    expect(first!.body).toMatchObject({ expectedVersion: 4 })
    expect(second!.body).toMatchObject({ expectedVersion: 5 })

    // Refresh reads the list again, setting aside a change not saved.
    fireEvent.click(screen.getByRole('button', { name: 'Add someone' }))
    expect(screen.getByRole('listitem', { name: 'Someone new, nurse' })).toBeDefined()
    const reads = sentTo(sent, ASSIGNMENTS).length
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(sentTo(sent, ASSIGNMENTS).length).toBeGreaterThan(reads))
    expect(screen.queryByRole('listitem', { name: 'Someone new, nurse' })).toBeNull()
  })

  it('asks for one line for each person and one nurse for each patient before saving', async () => {
    const member = nurse()
    const sent = serve({
      [SESSION]: [sessionAt(member, [member])],
      [SHIFTS]: many(shiftsOf()),
      [WARDS]: many(wardsOf()),
      [ADMISSIONS]: many(() => json({ items: [card(), hiddenCard()], hasMore: false, limit: 500 })),
      [ASSIGNMENTS]: many(listOf(4, [{ membershipId: ME, duty: 'nurse_in_charge', admissionIds: [ADMISSION] }])),
    })
    await openStaffApp('/provider/clinical-shifts')
    const onShift = await screen.findByRole('list', { name: 'On this shift' })
    await waitFor(() => expect(within(onShift).getAllByRole('checkbox')).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: 'Add someone' }))
    const added = () => within(screen.getByRole('list', { name: 'On this shift' })).getAllByRole('listitem')[1]!
    fireEvent.change(within(added()).getByLabelText('Who'), { target: { value: ME } })
    fireEvent.click(screen.getByRole('button', { name: 'Save who is on' }))
    expect(await screen.findByText('You are on two lines. Keep one line for each person.')).toBeDefined()
    fireEvent.change(within(added()).getByLabelText('Who'), { target: { value: COLLEAGUE } })
    fireEvent.click(within(added()).getByRole('checkbox', { name: 'Bed 4 · Ada Wardone' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save who is on' }))
    expect(await screen.findByText('Bed 4 · Ada Wardone is ticked for two nurses. Give each patient to one nurse.')).toBeDefined()
    expect(sentTo(sent, SET_ASSIGNMENTS)).toHaveLength(0)
  })

  it('reads the shifts again when a shift was changed by someone else, so a second press sends its new version', async () => {
    const admin = facility(REAL_FACILITY, 'Fictional Hospital', ADMIN, ['admin'])
    const UPDATE = `PATCH /api/v1/ehr/clinical-shifts/${SHIFT}`
    const sent = serve({
      [SESSION]: [sessionAt(admin, [admin])],
      [SHIFTS]: [shiftsOf(shift()), ...many(shiftsOf(shift({ rowVersion: 2 })))],
      [WARDS]: many(() => json({ items: [] })),
      [UPDATE]: [() => problem(412, 'NURSING_VERSION_CONFLICT', 'Precondition failed'), () => json({ shift: shift({ active: false, rowVersion: 3 }), replayed: false })],
    })
    await openStaffApp('/provider/clinical-shifts')
    const morning = await screen.findByRole('listitem', { name: 'Morning' })
    fireEvent.click(within(morning).getByRole('button', { name: 'Stop this shift' }))
    expect(await screen.findByText('Someone else changed this shift. The shifts have been read again: check it, then try again.')).toBeDefined()
    await waitFor(() => expect(sentTo(sent, SHIFTS).length).toBeGreaterThan(1))
    fireEvent.click(within(screen.getByRole('listitem', { name: 'Morning' })).getByRole('button', { name: 'Stop this shift' }))
    await waitFor(() => expect(sentTo(sent, UPDATE)).toHaveLength(2))
    expect(sentTo(sent, UPDATE).map(call => (call.body as { expectedRowVersion: number }).expectedRowVersion)).toEqual([1, 2])
  })

  it('is not open to a doctor, who neither sets shifts up nor assigns them', async () => {
    const doctor = facility(REAL_FACILITY, 'Fictional Hospital', ['ehr.mar.read', 'ehr.nursing-task.read'], ['doctor'])
    const sent = serve({ [SESSION]: [sessionAt(doctor, [doctor])] })
    await openStaffApp('/provider/clinical-shifts')
    expect(await screen.findByText('Only the facility’s admins can set up clinical shifts, and nurses in charge assign them.')).toBeDefined()
    expect(sent.filter(call => call.route.includes('clinical-shifts'))).toEqual([])
  })
})
