import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { Route, Routes, useLocation } from 'react-router-dom'
import { fakeFacility, renderDept, staffContext } from '../harness'
import { PatientAppointmentsCard } from '../../../../ehr-blue/departments/appointments/PatientAppointmentsCard'
import { AppointmentClinics } from '../../../../ehr-blue/departments/appointments/AppointmentClinics'
import {
  forgetAppointmentsServed, learnAppointmentsServed, takeHandedPatient,
} from '../../../../ehr-blue/departments/appointments/appointmentRules'

/*
 * The patient page's "Appointments" card and Facility profile's "Appointment clinics" (hid-system APPT-1 routes 4 and 9),
 * each on its own with the staff API mocked. The device is set to Lagos's far side (Los Angeles); times are Lagos's.
 * Every name and id is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
const session = vi.hoisted(() => ({ permissions: [] as string[] }))
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility: make, staffContext: context } = await import('../harness')
  return { useStaff: () => context(make(session.permissions, { name: 'Fictional Clinic' })) }
})
const api = vi.hoisted(() => ({
  forPatient: vi.fn(), clinics: vi.fn(), settings: vi.fn(), createClinic: vi.fn(), updateClinic: vi.fn(), saveSettings: vi.fn(),
}))
vi.mock('../../../../staff/api', async importOriginal => ({ ...(await importOriginal<object>()), appointmentsApi: api }))

beforeAll(() => { process.env.TZ = 'America/Los_Angeles' })
afterEach(() => { vi.clearAllMocks(); forgetAppointmentsServed(); session.permissions = [] })

const PATIENT = 'b0000000-0000-4000-8000-00000000b001'
const APPOINTMENT = 'a0000000-0000-4000-8000-00000000a001'
const CLINIC = 'c0000000-0000-4000-8000-00000000c001'
const refused = (status: number, code: string) => new HidApiError(status, 'Refused.', { code })
void fakeFacility; void staffContext

function Where() { return <output data-testid="where">{useLocation().pathname}</output> }
function renderCard() {
  return renderDept(<><Where /><Routes><Route path="*" element={<PatientAppointmentsCard patientId={PATIENT} fullName="Testa Bookperson" />} /></Routes></>)
}

const appointment = {
  appointmentId: APPOINTMENT, patientId: PATIENT, fullName: 'Testa Bookperson', sex: 'female', dateOfBirth: '1990-01-02',
  healthIdLast4: 'ZZ33', chartBlocked: false, departmentCode: 'general_outpatient', clinicId: CLINIC, clinicName: 'Medical outpatients',
  clinicianMembershipId: null, startsAt: '2026-12-03T08:00:00.000Z', endsAt: '2026-12-03T08:30:00.000Z', lengthMinutes: 30,
  appointmentDay: '2026-12-03', visitType: 'follow_up', reason: null, status: 'booked', bookingBasis: 'own-facility',
  visitQueueEntryId: null, bookedAt: '2026-11-26T10:00:00.000Z', bookedByMembershipId: 'membership-demo-1',
  statusChangedAt: '2026-11-26T10:00:00.000Z', reminderSentAt: null, rowVersion: 1,
}

describe('the patient page’s Appointments card', () => {
  it('lists this facility’s appointments in Lagos time, and hands the patient to New appointment in memory only', async () => {
    session.permissions = ['ehr.appointment.read', 'ehr.appointment.write']
    api.forPatient.mockResolvedValue({ items: [appointment] })
    renderCard()
    const row = await screen.findByRole('button', { name: /Thursday 3 Dec 2026, 09:00 to 09:30/ })
    expect(within(row).getByText('Booked')).toBeDefined()
    expect(within(row).getByText('Medical outpatients · Follow-up')).toBeDefined()
    expect(api.forPatient).toHaveBeenCalledWith('98d00002-0000-4000-8000-000000000002', PATIENT)
    fireEvent.click(row)
    expect(screen.getByTestId('where').textContent).toBe(`/provider/appointments/${APPOINTMENT}`)

    fireEvent.click(screen.getByRole('button', { name: 'Book an appointment' }))
    expect(screen.getByTestId('where').textContent).toBe('/provider/appointments/new')
    expect(takeHandedPatient('98d00002-0000-4000-8000-000000000002')).toEqual({ patientId: PATIENT, fullName: 'Testa Bookperson',
      facilityId: '98d00002-0000-4000-8000-000000000002' })
  })

  it('offers no booking to a nurse, and says when there are none', async () => {
    session.permissions = ['ehr.appointment.read']
    api.forPatient.mockResolvedValue({ items: [] })
    renderCard()
    expect(await screen.findByText('No appointments here in the last 90 days or to come.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Book an appointment' })).toBeNull()
  })

  it('shows nothing, reading nothing, to a member who does not see appointments', () => {
    session.permissions = ['identity.patient.read']
    renderCard()
    expect(screen.queryByText('Appointments')).toBeNull()
    expect(api.forPatient).not.toHaveBeenCalled()
  })

  it('shows nothing where appointments are switched off or not served', async () => {
    session.permissions = ['ehr.appointment.read']
    api.forPatient.mockRejectedValue(refused(503, 'APPOINTMENTS_NOT_AVAILABLE'))
    renderCard()
    await waitFor(() => expect(api.forPatient).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText('Appointments')).toBeNull())
  })

  it('says a refused read in plain words', async () => {
    session.permissions = ['ehr.appointment.read']
    api.forPatient.mockRejectedValue(refused(403, 'APPOINTMENT_NOT_ALLOWED'))
    renderCard()
    expect(await screen.findByText('Only the front desk, nurses, clinicians and doctors of this facility can see appointments.')).toBeDefined()
    expect(document.body.textContent).not.toMatch(/permission/i)
  })

  it('asks nothing on the next patient once the page has learned appointments are not served', async () => {
    session.permissions = ['ehr.appointment.read', 'ehr.appointment.write']
    api.forPatient.mockRejectedValue(refused(503, 'APPOINTMENTS_NOT_AVAILABLE'))
    const first = renderCard()
    await waitFor(() => expect(api.forPatient).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText('Appointments')).toBeNull())
    first.unmount()

    // Another patient's page, the same page load: nothing is asked for and nothing shows, not even for a moment.
    renderCard()
    expect(screen.queryByText('Appointments')).toBeNull()
    expect(screen.queryByText('Loading appointments…')).toBeNull()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(api.forPatient).toHaveBeenCalledTimes(1)
  })

  it('shows no loading card until the page knows appointments are served, then shows it while reading', async () => {
    session.permissions = ['ehr.appointment.read']
    let answer: ((value: unknown) => void) | null = null
    api.forPatient.mockImplementation(() => new Promise(resolve => { answer = resolve }))
    const first = renderCard()
    await waitFor(() => expect(answer).not.toBeNull())
    // Not yet known: a facility without appointments never sees a card come and go.
    expect(screen.queryByText('Appointments')).toBeNull()
    expect(screen.queryByText('Loading appointments…')).toBeNull()
    answer!({ items: [] })
    expect(await screen.findByText('No appointments here in the last 90 days or to come.')).toBeDefined()
    first.unmount()

    answer = null
    renderCard()
    expect(screen.getByText('Loading appointments…')).toBeDefined()
    await waitFor(() => expect(answer).not.toBeNull())
    answer!({ items: [] })
    expect(await screen.findByText('No appointments here in the last 90 days or to come.')).toBeDefined()
  })
})

describe('Facility profile’s Appointment clinics', () => {
  const clinic = { clinicId: CLINIC, name: 'Medical outpatients', departmentCode: 'general_outpatient', defaultLengthMinutes: null, active: true, rowVersion: 3 }
  const FACILITY = '98d00002-0000-4000-8000-000000000002'

  it('lists the clinics and adds one with a fresh Idempotency-Key', async () => {
    session.permissions = ['organization.manage']
    api.clinics.mockResolvedValue({ items: [clinic] })
    api.settings.mockResolvedValue({ defaultLengthMinutes: 30, rowVersion: 2 })
    api.createClinic.mockResolvedValue({ clinic: { ...clinic, clinicId: 'c2', name: 'Antenatal clinic' }, replayed: false })
    renderDept(<AppointmentClinics facilityId={FACILITY} permissions={session.permissions} />)
    const row = await screen.findByRole('listitem', { name: 'Medical outpatients' })
    expect(within(row).getByText('The facility’s default length')).toBeDefined()
    expect(within(row).getByText('Open for bookings')).toBeDefined()
    expect(api.clinics).toHaveBeenCalledWith(FACILITY, true)

    const form = screen.getByRole('form', { name: 'Add a clinic' })
    fireEvent.click(within(form).getByRole('button', { name: 'Add clinic' }))
    expect(within(form).getByText('Give the clinic a name of 2 to 80 characters.')).toBeDefined()
    fireEvent.change(within(form).getByRole('textbox', { name: 'New clinic name' }), { target: { value: ' Antenatal clinic ' } })
    fireEvent.change(within(form).getByRole('combobox', { name: 'Department' }), { target: { value: 'maternity' } })
    fireEvent.change(within(form).getByRole('textbox', { name: /Usual length/ }), { target: { value: '7' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add clinic' }))
    expect(within(form).getByText('Enter minutes from 5 to 240, in steps of 5.')).toBeDefined()
    fireEvent.change(within(form).getByRole('textbox', { name: /Usual length/ }), { target: { value: '20' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add clinic' }))
    expect(await screen.findByText('Antenatal clinic added.')).toBeDefined()
    expect(api.createClinic).toHaveBeenCalledWith(FACILITY, { name: 'Antenatal clinic', departmentCode: 'maternity', defaultLengthMinutes: 20 },
      expect.stringMatching(/^[A-Za-z0-9-]{16,128}$/))
  })

  it('closes a clinic to new bookings with its row version, and saves the default length', async () => {
    session.permissions = ['organization.manage']
    api.clinics.mockResolvedValue({ items: [clinic] })
    api.settings.mockResolvedValue({ defaultLengthMinutes: 30, rowVersion: 2 })
    api.updateClinic.mockResolvedValue({ clinic: { ...clinic, active: false, rowVersion: 4 }, replayed: false })
    api.saveSettings.mockRejectedValue(refused(412, 'APPOINTMENT_SETTINGS_VERSION_CONFLICT'))
    renderDept(<AppointmentClinics facilityId={FACILITY} permissions={session.permissions} />)
    const row = await screen.findByRole('listitem', { name: 'Medical outpatients' })
    fireEvent.click(within(row).getByRole('button', { name: 'Stop new bookings at Medical outpatients' }))
    expect(await screen.findByText('Medical outpatients is closed to new bookings.')).toBeDefined()
    expect(api.updateClinic).toHaveBeenCalledWith(FACILITY, clinic, { active: false }, expect.any(String))

    fireEvent.change(screen.getByRole('textbox', { name: 'Default length (minutes)' }), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save length' }))
    expect(await screen.findByText('Someone else changed the default length. Reload it and try again.')).toBeDefined()
    expect(api.saveSettings).toHaveBeenCalledWith(FACILITY, { defaultLengthMinutes: 30, rowVersion: 2 }, 20, expect.any(String))
    await waitFor(() => expect(api.clinics.mock.calls.length).toBeGreaterThanOrEqual(3))
  })

  it('names its clinic on each row button, and the form’s Cancel never starts like the button that changes the clinic', async () => {
    session.permissions = ['organization.manage']
    api.clinics.mockResolvedValue({ items: [clinic, { ...clinic, clinicId: 'c2', name: 'Antenatal clinic', active: false }] })
    api.settings.mockResolvedValue({ defaultLengthMinutes: 30, rowVersion: 2 })
    renderDept(<AppointmentClinics facilityId={FACILITY} permissions={session.permissions} />)
    const row = await screen.findByRole('listitem', { name: 'Medical outpatients' })
    const other = screen.getByRole('listitem', { name: 'Antenatal clinic' })
    expect(within(other).getByRole('button', { name: 'Change Antenatal clinic' }).textContent).toBe('Change')
    expect(within(other).getByRole('button', { name: 'Open for bookings: Antenatal clinic' }).textContent).toBe('Open for bookings')

    fireEvent.click(within(row).getByRole('button', { name: 'Change Medical outpatients' }))
    const form = within(row).getByRole('form', { name: 'Change Medical outpatients' })
    const cancel = within(row).getByRole('button', { name: 'Cancel changes to Medical outpatients' })
    expect(cancel.textContent).toBe('Cancel')
    expect(cancel.getAttribute('aria-expanded')).toBe('true')
    const stop = within(row).getByRole('button', { name: 'Stop new bookings at Medical outpatients' })
    expect(stop.textContent).toBe('Stop new bookings')
    // No two of the row's buttons start with the same word.
    const firstWords = within(row).getAllByRole('button').map(button => button.textContent?.trim().split(' ')[0])
    expect(new Set(firstWords).size).toBe(firstWords.length)

    // Cancel leaves the form, keeps nothing typed in it, and changes nothing.
    fireEvent.change(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: 'Typed but not kept' } })
    fireEvent.click(cancel)
    expect(within(row).queryByRole('form')).toBeNull()
    expect(api.updateClinic).not.toHaveBeenCalled()
    fireEvent.click(within(row).getByRole('button', { name: 'Change Medical outpatients' }))
    expect((within(row).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Medical outpatients')
  })

  it('asks nothing once the page has learned appointments are not served, and shows no loading section before it knows', async () => {
    session.permissions = ['organization.manage']
    learnAppointmentsServed(false)
    const { unmount } = renderDept(<AppointmentClinics facilityId={FACILITY} permissions={session.permissions} />)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(api.clinics).not.toHaveBeenCalled()
    expect(api.settings).not.toHaveBeenCalled()
    expect(screen.queryByText('Appointment clinics')).toBeNull()
    unmount()

    forgetAppointmentsServed()
    let answer: ((value: unknown) => void) | null = null
    api.clinics.mockImplementation(() => new Promise(resolve => { answer = resolve }))
    api.settings.mockResolvedValue({ defaultLengthMinutes: 30, rowVersion: 2 })
    renderDept(<AppointmentClinics facilityId={FACILITY} permissions={session.permissions} />)
    await waitFor(() => expect(answer).not.toBeNull())
    expect(screen.queryByText('Appointment clinics')).toBeNull()
    expect(screen.queryByText('Loading the clinics…')).toBeNull()
    answer!({ items: [clinic] })
    expect(await screen.findByRole('listitem', { name: 'Medical outpatients' })).toBeDefined()
  })

  it('is not shown without organization.manage, or where appointments are not served', async () => {
    session.permissions = ['ehr.appointment.read']
    const { unmount } = renderDept(<AppointmentClinics facilityId={FACILITY} permissions={session.permissions} />)
    expect(screen.queryByText('Appointment clinics')).toBeNull()
    expect(api.clinics).not.toHaveBeenCalled()
    unmount()

    session.permissions = ['organization.manage']
    api.clinics.mockRejectedValue(refused(404, 'NOT_FOUND'))
    api.settings.mockRejectedValue(refused(404, 'NOT_FOUND'))
    renderDept(<AppointmentClinics facilityId={FACILITY} permissions={session.permissions} />)
    await waitFor(() => expect(api.clinics).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText('Appointment clinics')).toBeNull())
  })
})
