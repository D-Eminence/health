import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type * as BlueRoutes from '../../../../ehr-blue/routes'
import { REAL_FACILITY, SESSION, facility, json, openStaffApp, problem, serve, sessionAt, where, type Sent } from '../../frame/blueHarness'
import { lagosToday } from '../../../../ehr-blue/departments/waiting/waitingRules'
import { forgetAppointmentsServed } from '../../../../ehr-blue/departments/appointments/appointmentRules'

/*
 * Appointments (hid-system APPT-1, 0160 and 0161) inside the blue EHR's real frame, joined as departments/pages.ts joins
 * it: listed under Front desk for the roles the backend lets see appointments, reading and changing them with the
 * contract's bodies and headers, every day and time in Lagos while the device is set to New York, and never a Health ID
 * in an address or the word "permission" on screen. Every account, facility, patient and reference is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeAll(() => { process.env.TZ = 'America/New_York' })
beforeEach(() => {
  vi.doMock('../../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../../ehr-blue/frame/pages')
    const home = await import('../../../../ehr-blue/home/pages')
    const { appointmentsPage } = await import('../../../../ehr-blue/departments/appointments/page')
    const { waitingListPage } = await import('../../../../ehr-blue/departments/waiting/page')
    return {
      ...actual,
      BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home,
        './departments/pages.ts': { pages: [waitingListPage, appointmentsPage] } }),
    }
  })
})
afterEach(() => { forgetAppointmentsServed(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const APPOINTMENT = 'a0000000-0000-4000-8000-00000000a001'
const PATIENT = 'b0000000-0000-4000-8000-00000000b001'
const CLINIC = 'c0000000-0000-4000-8000-00000000c001'
const DOCTOR = 'd0000000-0000-4000-8000-00000000d001'
const LIST = 'GET /api/v1/ehr/appointments'
const BOOK = 'POST /api/v1/ehr/appointments'
const READ = `GET /api/v1/ehr/appointments/${APPOINTMENT}`
const CHECK_IN = `POST /api/v1/ehr/appointments/${APPOINTMENT}/check-in`
const RESCHEDULE = `POST /api/v1/ehr/appointments/${APPOINTMENT}/reschedule`
const CANCEL = `POST /api/v1/ehr/appointments/${APPOINTMENT}/cancel`
const NO_SHOW = `POST /api/v1/ehr/appointments/${APPOINTMENT}/no-show`
const CLINICS = 'GET /api/v1/ehr/appointment-clinics'
const STAFF = 'GET /api/v1/ehr/appointments/bookable-staff'
const NAMES = 'GET /api/v1/identity/facility-staff-names'
const CALL_LIST = 'GET /api/v1/identity/appointment-call-list'
const SEARCH = 'POST /api/v1/identity/patient-search'
const VISIT_QUEUE = 'GET /api/v1/ehr/visit-queue'
const FRONT_DESK = ['ehr.appointment.read', 'ehr.appointment.write', 'ehr.encounter.read', 'ehr.encounter.write',
  'identity.registration.write', 'identity.patient.read']
const NURSE = ['ehr.appointment.read', 'ehr.encounter.read', 'ehr.encounter.write', 'ehr.note.write', 'identity.patient.read']
const MATCH_REF = `psr_${'B'.repeat(43)}`
const OTHER_REF = `psr_${'C'.repeat(43)}`
const nav = () => screen.getByRole('navigation', { name: 'Main navigation' })
const today = () => lagosToday()

function card(overrides: Record<string, unknown> = {}) {
  return {
    appointmentId: APPOINTMENT, patientId: PATIENT, fullName: 'Testa Bookperson', sex: 'female', dateOfBirth: '1990-01-02',
    healthIdLast4: 'ZZ33', chartBlocked: false, departmentCode: 'general_outpatient', clinicId: CLINIC, clinicName: 'Medical outpatients',
    clinicianMembershipId: DOCTOR, startsAt: '2026-12-03T08:00:00.000Z', endsAt: '2026-12-03T08:30:00.000Z', lengthMinutes: 30,
    appointmentDay: '2026-12-03', visitType: 'follow_up', reason: 'Blood pressure review', status: 'booked', bookingBasis: 'search',
    visitQueueEntryId: null, bookedAt: '2026-11-26T10:00:00.000Z', bookedByMembershipId: `member-${REAL_FACILITY}`,
    statusChangedAt: '2026-11-26T10:00:00.000Z', reminderSentAt: null, rowVersion: 1, ...overrides,
  }
}
/** An appointment today in Lagos, starting now (so it can be checked in, and marked a no-show). */
function todays(overrides: Record<string, unknown> = {}) {
  const start = new Date(Date.now() - 60_000)
  return card({ appointmentDay: today(), startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 30 * 60_000).toISOString(), ...overrides })
}
const listOf = (...items: unknown[]) => () => json({ items, nextCursor: null })
const readOf = (appointment: unknown, history: unknown[] = []) => () => json({ appointment, history })
const clinics = () => json({ items: [{ clinicId: CLINIC, name: 'Medical outpatients', departmentCode: 'general_outpatient',
  defaultLengthMinutes: 20, active: true, rowVersion: 1 }] })
const staff = () => json({ items: [{ membershipId: DOCTOR }] })
const names = () => json({ facilityId: REAL_FACILITY, staff: [{ membershipId: DOCTOR, name: 'Dr Fiction Adeyemi', current: true }], complete: true })
const found = (matchRef = MATCH_REF) => () => json({ mode: 'standard', outcome: 'found', reach: 'everywhere', message: null, patients: [{
  matchRef, matchRefExpiresAt: '2999-01-01T00:00:00.000Z', fullName: 'Testa Bookperson', sex: 'female', dateOfBirth: '1990-01-02',
  healthIdLast4: 'ZZ33', ninStatus: 'verified' }] })
const deskAt = (permissions = FRONT_DESK, roles = ['receptionist']) => facility(REAL_FACILITY, 'Fictional Clinic', permissions, roles)

/** No request carried a Health ID, a matchRef or a patient's name in its address. */
function noIdentityInAddresses() {
  for (const [url] of vi.mocked(fetch).mock.calls) expect(String(url)).not.toMatch(/HID-|psr_|Bookperson|healthId/i)
}
function urlsOf(route: string) {
  const [method, path] = route.split(' ')
  return vi.mocked(fetch).mock.calls.filter(([url, init]) => String(init?.method ?? 'GET') === method && new URL(String(url)).pathname === path)
    .map(([url]) => new URL(String(url)))
}
function directCare(sent: readonly Sent[], route: string) {
  const call = sent.find(item => item.route === route)!
  expect(call.headers.get('X-Purpose-Of-Use')).toBe('direct-care')
  expect(call.headers.get('X-Facility-ID')).toBe(REAL_FACILITY)
}
const keyOf = (sent: readonly Sent[], route: string, index = 0) => sent.filter(item => item.route === route)[index]!.headers.get('Idempotency-Key')
const noPermissionWord = () => expect(document.body.textContent).not.toMatch(/permission/i)

describe('Appointments in the frame', () => {
  it('is listed under Front desk and shows the day in Lagos time, with the default statuses asked for', async () => {
    const desk = deskAt()
    const sent = serve({
      [SESSION]: [sessionAt(desk, [desk])],
      [CLINICS]: [clinics], [STAFF]: [staff], [NAMES]: [names],
      [LIST]: [listOf(card({ chartBlocked: true }), card({ appointmentId: 'a0000000-0000-4000-8000-00000000a002', fullName: 'Other Bookperson',
        clinicianMembershipId: null, clinicName: null, departmentCode: 'maternity', status: 'checked_in',
        startsAt: '2026-12-03T09:15:00.000Z', endsAt: '2026-12-03T09:45:00.000Z' }))],
    })
    await openStaffApp('/provider/appointments')
    expect(await screen.findByRole('heading', { level: 1, name: 'Appointments' })).toBeDefined()
    expect(within(nav()).getByRole('link', { name: 'Appointments' }).getAttribute('href')).toBe('/provider/appointments')
    const list = await screen.findByRole('list', { name: 'Appointments on this day' })
    const first = within(list).getByRole('listitem', { name: 'Testa Bookperson' })
    // 08:00 UTC is 09:00 in Lagos, and 03:00 in New York: Lagos's is shown.
    expect(within(first).getByText('09:00 to 09:30')).toBeDefined()
    expect(within(first).getByText('Booked')).toBeDefined()
    expect(within(first).getByText('Chart cannot be opened')).toBeDefined()
    expect(within(first).getByLabelText('Health ID ending ZZ33').textContent).toBe('•••• ZZ33')
    expect(await within(first).findByText('Dr Fiction Adeyemi')).toBeDefined()
    const second = within(list).getByRole('listitem', { name: 'Other Bookperson' })
    expect(within(second).getByText('10:15 to 10:45')).toBeDefined()
    expect(within(second).getByText('Checked in')).toBeDefined()
    expect(within(second).getByText('Maternity')).toBeDefined()
    expect(within(second).getByText('Any clinician in the clinic')).toBeDefined()
    const query = urlsOf(LIST)[0]!.searchParams
    expect(query.get('day')).toBe(today())
    expect(query.get('status')).toBe('booked,checked_in')
    directCare(sent, LIST)
    noPermissionWord()
    noIdentityInAddresses()

    // Another day, and every status: the list is read again for it.
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-12-04' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cancelled' }))
    await waitFor(() => expect(urlsOf(LIST).length).toBeGreaterThanOrEqual(3))
    const last = urlsOf(LIST).at(-1)!.searchParams
    expect(last.get('day')).toBe('2026-12-04')
    expect(last.get('status')).toBe('booked,checked_in,cancelled')
  })

  it('is not listed for lab staff, and its address says who can see appointments without reading', async () => {
    const lab = facility(REAL_FACILITY, 'Fictional Clinic', ['lab.work-item.read', 'identity.patient.read'], ['lab_scientist'])
    const sent = serve({ [SESSION]: [sessionAt(lab, [lab])] })
    await openStaffApp('/provider/appointments')
    expect(await screen.findByText('Only the front desk, nurses, clinicians and doctors of this facility can see appointments.')).toBeDefined()
    expect(within(nav()).queryByRole('link', { name: 'Appointments' })).toBeNull()
    expect(sent.filter(call => call.route.includes('appointment'))).toEqual([])
    noPermissionWord()
  })

  it('says appointments are not available yet when they are switched off, and stops listing them', async () => {
    const desk = deskAt()
    serve({
      [SESSION]: [sessionAt(desk, [desk])],
      // A read is tried three times (the client's read retry); each answer says the same.
      [LIST]: [1, 2, 3].map(() => () => problem(503, 'APPOINTMENTS_NOT_AVAILABLE', 'Appointments are not available yet.')),
    })
    await openStaffApp('/provider/appointments')
    expect(await screen.findByText('Appointments are not available yet.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'New appointment' })).toBeNull()
    await waitFor(() => expect(within(nav()).queryByRole('link', { name: 'Appointments' })).toBeNull())
  })

  it('gives a nurse the list only: no booking, call list or actions', async () => {
    const nurse = deskAt(NURSE, ['nurse'])
    serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      [LIST]: [listOf(todays())],
      [READ]: [readOf(todays())],
    })
    await openStaffApp('/provider/appointments')
    const row = await screen.findByRole('listitem', { name: 'Testa Bookperson' })
    expect(screen.queryByRole('button', { name: 'New appointment' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Call list' })).toBeNull()
    fireEvent.click(within(row).getByRole('link', { name: 'Testa Bookperson' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Testa Bookperson' })).toBeDefined()
    expect(where()).toBe(`/provider/appointments/${APPOINTMENT}`)
    expect(screen.queryByRole('button', { name: 'Check in' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reschedule' })).toBeNull()
    expect(screen.getByText('Only the front desk, clinicians and doctors of this facility can change appointments.')).toBeDefined()
    noPermissionWord()
  })

  it('books from a search card by its matchRef, at the Lagos time typed, with one Idempotency-Key per body', async () => {
    const desk = deskAt()
    const sent = serve({
      [SESSION]: [sessionAt(desk, [desk])],
      [CLINICS]: [clinics, clinics], [STAFF]: [staff, staff], [NAMES]: [names, names],
      [LIST]: [listOf()],
      [SEARCH]: [found()],
      [BOOK]: [
        () => problem(409, 'APPOINTMENT_CLINICIAN_CLASH', 'This clinician already has an appointment at this time.'),
        () => problem(409, 'APPOINTMENT_CLINICIAN_CLASH', 'This clinician already has an appointment at this time.'),
        () => json({ appointment: card({ startsAt: '2026-12-03T08:30:00.000Z' }), replayed: false }, 201),
      ],
      [READ]: [readOf(card({ startsAt: '2026-12-03T08:30:00.000Z' }), [{ kind: 'booked', at: '2026-11-26T10:00:00.000Z',
        byMembershipId: `member-${REAL_FACILITY}`, fromStartsAt: null, toStartsAt: '2026-12-03T08:30:00.000Z',
        fromClinicianMembershipId: null, toClinicianMembershipId: DOCTOR, reason: null }])],
    })
    await openStaffApp('/provider/appointments')
    fireEvent.click(await screen.findByRole('button', { name: 'New appointment' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'New appointment' })).toBeDefined()

    // Nothing chosen yet: the form says what is missing and sends nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Book appointment' }))
    expect(await screen.findByText('Choose the patient first.', { selector: 'li' })).toBeDefined()
    expect(sent.filter(call => call.route === BOOK)).toEqual([])

    fireEvent.change(screen.getByRole('textbox', { name: 'Health ID' }), { target: { value: 'hid-zzzz33' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find patient' }))
    const result = await screen.findByRole('listitem', { name: 'Testa Bookperson' })
    expect(within(result).getByText('NIN Verified')).toBeDefined()
    expect(sent.find(call => call.route === SEARCH)!.body).toEqual({ healthId: 'HID-ZZZZ33' })
    expect(document.body.innerHTML).not.toContain(MATCH_REF)
    fireEvent.click(within(result).getByRole('button', { name: 'Choose Testa Bookperson' }))
    expect(await screen.findByText(/From your search/)).toBeDefined()

    await screen.findByRole('option', { name: 'Medical outpatients' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Clinic' }), { target: { value: CLINIC } })
    await screen.findByRole('option', { name: 'Dr Fiction Adeyemi' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Clinician' }), { target: { value: DOCTOR } })
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-12-03' } })
    fireEvent.change(screen.getByLabelText('Time (Lagos)'), { target: { value: '09:07' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Visit type' }), { target: { value: 'follow_up' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: ' Blood pressure review ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Book appointment' }))
    expect(await screen.findAllByText('Choose a time on a 5-minute step (for example 09:05 or 09:10).')).not.toHaveLength(0)
    expect(sent.filter(call => call.route === BOOK)).toEqual([])

    fireEvent.change(screen.getByLabelText('Time (Lagos)'), { target: { value: '09:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Book appointment' }))
    expect(await screen.findAllByText('This clinician already has an appointment at this time. Choose another time or clinician.')).not.toHaveLength(0)
    expect(sent.filter(call => call.route === BOOK)[0]!.body).toEqual({ matchRef: MATCH_REF, departmentCode: 'general_outpatient',
      clinicId: CLINIC, clinicianMembershipId: DOCTOR, startsAt: '2026-12-03T08:00:00.000Z', visitType: 'follow_up', reason: 'Blood pressure review' })
    directCare(sent, BOOK)
    // The same details sent again carry the same key (the server answers its first answer); new details a new one.
    fireEvent.click(screen.getByRole('button', { name: 'Book appointment' }))
    await waitFor(() => expect(sent.filter(call => call.route === BOOK)).toHaveLength(2))
    expect(keyOf(sent, BOOK, 1)).toBe(keyOf(sent, BOOK, 0))
    fireEvent.change(screen.getByLabelText('Time (Lagos)'), { target: { value: '09:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Book appointment' }))
    expect(await screen.findByText('Appointment booked. The patient will get a notice.')).toBeDefined()
    expect(sent.filter(call => call.route === BOOK)[2]!.body).toMatchObject({ startsAt: '2026-12-03T08:30:00.000Z' })
    expect(keyOf(sent, BOOK, 2)).not.toBe(keyOf(sent, BOOK, 0))
    expect(keyOf(sent, BOOK, 2)).toMatch(/^[A-Za-z0-9-]{16,128}$/)
    expect(where()).toBe(`/provider/appointments/${APPOINTMENT}`)
    expect(await screen.findByText('Booked', { selector: 'strong' })).toBeDefined()
    noIdentityInAddresses()
    noPermissionWord()
  })

  it('goes back to the search when the server asks for one before booking', async () => {
    const desk = deskAt()
    serve({
      [SESSION]: [sessionAt(desk, [desk])],
      [SEARCH]: [found()],
      [BOOK]: [() => problem(403, 'APPOINTMENT_NEEDS_SEARCH', 'Search for the patient first, then book.')],
    })
    await openStaffApp('/provider/appointments/new')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Last name' }), { target: { value: 'Bookperson' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'First name' }), { target: { value: 'Testa' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find patient' }))
    fireEvent.click(within(await screen.findByRole('listitem', { name: 'Testa Bookperson' })).getByRole('button', { name: 'Choose Testa Bookperson' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Department' }), { target: { value: 'general_outpatient' } })
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-12-03' } })
    fireEvent.change(screen.getByLabelText('Time (Lagos)'), { target: { value: '10:00' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Visit type' }), { target: { value: 'new_visit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Book appointment' }))
    expect(await screen.findByText('Search for the patient first, then book. A search result can be used for 10 minutes.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Find patient' })).toBeDefined()
    expect(screen.queryByText(/From your search/)).toBeNull()
  })

  it('checks a patient in from today’s appointment after the desk confirms who they are', async () => {
    const desk = deskAt()
    const sent = serve({
      [SESSION]: [sessionAt(desk, [desk])],
      [READ]: [readOf(todays()), readOf(todays({ status: 'checked_in', rowVersion: 2 }))],
      [CHECK_IN]: [() => json({ outcome: 'checked_in', appointment: todays({ status: 'checked_in', rowVersion: 2 }), entry: {}, replayed: false })],
    })
    await openStaffApp(`/provider/appointments/${APPOINTMENT}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Check in' }))
    const form = screen.getByRole('form', { name: 'Check in Testa Bookperson' })
    expect(within(form).getByText(/It does not open their chart/)).toBeDefined()
    fireEvent.click(within(form).getByRole('button', { name: 'Check in' }))
    expect(within(form).getByText('Confirm the patient’s name and date of birth with them before checking them in.', { selector: '[role="alert"] *, [role="alert"]' })).toBeDefined()
    expect(sent.filter(call => call.route === CHECK_IN)).toEqual([])
    fireEvent.click(within(form).getByRole('checkbox', { name: 'I have confirmed the patient’s name and date of birth with them' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Check in' }))
    expect(await screen.findByText('Testa Bookperson is checked in and on the waiting list.')).toBeDefined()
    expect(sent.find(call => call.route === CHECK_IN)!.body).toEqual({ expectedRowVersion: 1, identityConfirmed: true })
    directCare(sent, CHECK_IN)
    expect(keyOf(sent, CHECK_IN)).toBeTruthy()
    expect(await screen.findByRole('link', { name: 'Open the waiting list' })).toBeDefined()
  })

  it('offers "Search for the patient" when the appointment can no longer be the basis, and checks in by that card', async () => {
    const desk = deskAt()
    const sent = serve({
      [SESSION]: [sessionAt(desk, [desk])],
      [READ]: [readOf(todays()), readOf(todays({ status: 'checked_in', rowVersion: 2 }))],
      [SEARCH]: [found(OTHER_REF)],
      [CHECK_IN]: [
        () => problem(403, 'APPOINTMENT_CHECK_IN_NEEDS_SEARCH', 'Search for the patient to check them in.'),
        () => json({ outcome: 'already_on_list', appointment: todays({ status: 'checked_in', rowVersion: 2 }), entry: {}, replayed: false }),
      ],
    })
    await openStaffApp(`/provider/appointments/${APPOINTMENT}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Check in' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /I have confirmed/ }))
    fireEvent.click(within(screen.getByRole('form', { name: 'Check in Testa Bookperson' })).getByRole('button', { name: 'Check in' }))
    expect(await screen.findAllByText(/^Search for the patient to check them in\./)).not.toHaveLength(0)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: 'HID-ZZZZ33' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find patient' }))
    fireEvent.click(within(await screen.findByRole('listitem', { name: 'Testa Bookperson' })).getByRole('button', { name: 'Check in Testa Bookperson' }))
    expect(await screen.findByText('Testa Bookperson is checked in and on the waiting list.')).toBeDefined()
    const bodies = sent.filter(call => call.route === CHECK_IN).map(call => call.body)
    expect(bodies).toEqual([{ expectedRowVersion: 1, identityConfirmed: true }, { expectedRowVersion: 1, identityConfirmed: true, matchRef: OTHER_REF }])
    expect(keyOf(sent, CHECK_IN, 1)).not.toBe(keyOf(sent, CHECK_IN, 0))
    expect(document.body.innerHTML).not.toContain(OTHER_REF)
    noIdentityInAddresses()
  })

  it('reschedules with a reason, at the Lagos time typed, and reads the appointment again when someone changed it first', async () => {
    const desk = deskAt()
    const sent = serve({
      [SESSION]: [sessionAt(desk, [desk])],
      [STAFF]: [staff], [NAMES]: [names],
      [READ]: [readOf(card()), readOf(card({ rowVersion: 2, reason: 'Changed elsewhere' }))],
      [RESCHEDULE]: [() => problem(412, 'APPOINTMENT_VERSION_CONFLICT', 'Someone else changed this appointment.')],
    })
    await openStaffApp(`/provider/appointments/${APPOINTMENT}`)
    // Not today: no Check in; not started yet: no Mark no-show.
    expect(await screen.findByRole('button', { name: 'Reschedule' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Check in' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mark no-show' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reschedule' }))
    const form = screen.getByRole('form', { name: 'Reschedule' })
    // Opens on the appointment's own Lagos day and time.
    expect((within(form).getByLabelText('New day') as HTMLInputElement).value).toBe('2026-12-03')
    expect((within(form).getByLabelText('New time (Lagos)') as HTMLInputElement).value).toBe('09:00')
    fireEvent.change(within(form).getByLabelText('New time (Lagos)'), { target: { value: '11:15' } })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Reason for the change' }), { target: { value: 'short' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save new time' }))
    expect(within(form).getByText('Give a reason of at least 8 characters.')).toBeDefined()
    fireEvent.change(within(form).getByRole('textbox', { name: 'Reason for the change' }), { target: { value: 'Patient asked for later' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save new time' }))
    expect(await screen.findByText('Someone else changed this appointment. Reload it and try again.')).toBeDefined()
    expect(sent.find(call => call.route === RESCHEDULE)!.body).toEqual({ expectedRowVersion: 1, startsAt: '2026-12-03T10:15:00.000Z',
      reason: 'Patient asked for later' })
    await waitFor(() => expect(sent.filter(call => call.route === READ)).toHaveLength(2))
    expect(await screen.findByText('Changed elsewhere')).toBeDefined()
    noPermissionWord()
  })

  it('marks a no-show only once the time has passed', async () => {
    const desk = deskAt()
    const past = card({ startsAt: '2026-01-05T08:00:00.000Z', endsAt: '2026-01-05T08:30:00.000Z', appointmentDay: '2026-01-05' })
    const sent = serve({
      [SESSION]: [sessionAt(desk, [desk])],
      [READ]: [readOf(past), readOf({ ...past, status: 'no_show', rowVersion: 2 })],
      [NO_SHOW]: [() => json({ appointment: { ...past, status: 'no_show', rowVersion: 2 }, replayed: false })],
    })
    await openStaffApp(`/provider/appointments/${APPOINTMENT}`)
    // Another day than today: no Check in.
    expect(screen.queryByRole('button', { name: 'Check in' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Mark no-show' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Mark no-show' })).getByRole('button', { name: 'Mark no-show' }))
    expect(await screen.findByText('Marked as a no-show.')).toBeDefined()
    expect(sent.find(call => call.route === NO_SHOW)!.body).toEqual({ expectedRowVersion: 1 })
    directCare(sent, NO_SHOW)
    expect(await screen.findAllByText('No-show')).not.toHaveLength(0)
  })

  it('cancels with a reason of at least 8 characters', async () => {
    const desk = deskAt()
    const sent = serve({
      [SESSION]: [sessionAt(desk, [desk])],
      [READ]: [readOf(card()), readOf(card({ status: 'cancelled', rowVersion: 2 }))],
      [CANCEL]: [() => json({ appointment: card({ status: 'cancelled', rowVersion: 2 }), replayed: false })],
    })
    await openStaffApp(`/provider/appointments/${APPOINTMENT}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel appointment' }))
    const form = screen.getByRole('form', { name: 'Cancel appointment' })
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel appointment' }))
    expect(within(form).getByText('Give a reason of at least 8 characters.')).toBeDefined()
    fireEvent.change(within(form).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Patient travelled out of town' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel appointment' }))
    expect(await screen.findByText('Appointment cancelled. The patient will get a notice.')).toBeDefined()
    expect(sent.find(call => call.route === CANCEL)!.body).toEqual({ expectedRowVersion: 1, reason: 'Patient travelled out of town' })
    expect(keyOf(sent, CANCEL)).toBeTruthy()
    // Cancelled is final: no more actions.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reschedule' })).toBeNull())
  })

  it('says a missing appointment plainly, and sends a mistyped address back to the list', async () => {
    const desk = deskAt()
    serve({
      [SESSION]: [sessionAt(desk, [desk])],
      [READ]: [() => problem(404, 'APPOINTMENT_NOT_FOUND', 'No such appointment.')],
      [LIST]: [listOf()],
    })
    await openStaffApp(`/provider/appointments/${APPOINTMENT}`)
    expect(await screen.findByText('No such appointment.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('prints the call list with the phone this facility recorded, and its footer', async () => {
    const desk = deskAt()
    const print = vi.fn()
    vi.stubGlobal('print', print)
    const sent = serve({
      [SESSION]: [sessionAt(desk, [desk])],
      [NAMES]: [names],
      [CALL_LIST]: [() => json({ items: [
        { appointmentId: APPOINTMENT, startsAt: '2026-12-03T08:00:00.000Z', clinicName: 'Medical outpatients', clinicianMembershipId: DOCTOR,
          fullName: 'Testa Bookperson', healthIdLast4: 'ZZ33', phone: '+2348000000001', phoneSource: 'facility_contact' },
        { appointmentId: 'a0000000-0000-4000-8000-00000000a002', startsAt: '2026-12-03T09:00:00.000Z', clinicName: null,
          clinicianMembershipId: null, fullName: 'Other Bookperson', healthIdLast4: 'ZZ44', phone: null, phoneSource: null },
      ] })],
    })
    await openStaffApp('/provider/appointments/call-list')
    expect(await screen.findByRole('heading', { level: 1, name: 'Call list' })).toBeDefined()
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('link', { name: '+2348000000001' }).getAttribute('href')).toBe('tel:+2348000000001')
    expect(within(table).getByText('No phone recorded')).toBeDefined()
    expect(within(table).getByText('09:00')).toBeDefined()
    expect(screen.getAllByText('Contains patient phone numbers. Keep it at the desk and shred it after use.')).not.toHaveLength(0)
    expect(urlsOf(CALL_LIST)[0]!.searchParams.get('day')).toBe(today())
    directCare(sent, CALL_LIST)
    fireEvent.click(screen.getByRole('button', { name: 'Print' }))
    expect(print).toHaveBeenCalledTimes(1)
    // Nothing here sends a text message: SMS reminders are built but switched off.
    expect(document.body.textContent).not.toMatch(/text message|SMS/i)
    noIdentityInAddresses()
  })

  it('refuses the call list and New appointment to a nurse in plain words, reading nothing', async () => {
    const nurse = deskAt(NURSE, ['nurse'])
    const sent = serve({ [SESSION]: [sessionAt(nurse, [nurse])] })
    await openStaffApp('/provider/appointments/call-list')
    expect(await screen.findByText('Only the front desk, clinicians and doctors of this facility can book or change appointments.')).toBeDefined()
    expect(sent.filter(call => call.route === CALL_LIST)).toEqual([])
    noPermissionWord()
  })

  it('marks a waiting-list patient checked in from an appointment as "Booked appointment"', async () => {
    const desk = deskAt()
    serve({
      [SESSION]: [sessionAt(desk, [desk])],
      [VISIT_QUEUE]: [() => json({ items: [{ entryId: 'e0000000-0000-4000-8000-0000000000e1', patientId: PATIENT, fullName: 'Testa Bookperson',
        sex: 'female', dateOfBirth: '1990-01-02', healthIdLast4: 'ZZ33', stage: 'waiting', triageLevel: null, assignedMembershipId: null,
        checkInBasis: 'appointment', checkedInAt: new Date().toISOString(), checkInDay: today(), stageChangedAt: new Date().toISOString(),
        closedAt: null, rowVersion: 1, chartBlocked: false }], hasMore: false, limit: 200 })],
    })
    await openStaffApp('/provider/waiting-list')
    const row = await screen.findByRole('listitem', { name: 'Testa Bookperson' })
    expect(within(row).getByText('Booked appointment')).toBeDefined()
  })
})
