import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import { MyAppointments, appointmentStatus, appointmentWhen } from '../routes/MyAppointments'
import { notificationAction, notificationTitle } from '../routes/notificationTitles'
import { forgetMyAppointmentsServed, myAppointmentsServed } from '../appointmentsServed'
import type { PatientNotification } from '../api'
import { json, press, problem, renderPortal } from './portalHarness'

/*
 * "My appointments" in the portal (hid-system APPT-1 route 12, 0161): read only, Upcoming and Past, every time in Lagos
 * while the device is set to Los Angeles; and the inbox titles of the four appointment notices. Every facility, clinic
 * and clinician is fictional.
 */
beforeAll(() => { process.env.TZ = 'America/Los_Angeles' })
afterEach(() => forgetMyAppointmentsServed())

const MINE = '/ehr/me/appointments'
const item = (overrides: Record<string, unknown> = {}) => ({
  appointmentId: 'a0000000-0000-4000-8000-00000000a001', facilityName: 'Fictional General Hospital', clinicName: 'Medical outpatients',
  departmentCode: 'general_outpatient', clinicianName: 'Dr Fiction Adeyemi', startsAt: '2026-12-03T08:00:00.000Z',
  endsAt: '2026-12-03T08:30:00.000Z', lengthMinutes: 30, visitType: 'follow_up', reason: 'Blood pressure review', status: 'booked', ...overrides,
})

describe('My appointments', () => {
  it('lists upcoming appointments in Lagos time, read only, then past ones on asking', async () => {
    let reads = 0
    const { sent } = renderPortal(<MyAppointments />, path => {
      if (path !== MINE) return json({})
      reads += 1
      return reads === 1
        ? json({ items: [item()], nextCursor: null })
        : json({ items: [item({ appointmentId: 'a2', status: 'no_show', clinicianName: null, reason: null, startsAt: '2026-11-02T13:00:00.000Z',
          endsAt: '2026-11-02T13:20:00.000Z', lengthMinutes: 20 })], nextCursor: null })
    })
    expect(await screen.findByRole('heading', { name: 'My appointments' })).toBeDefined()
    const upcoming = await screen.findByRole('list', { name: 'Upcoming appointments' })
    const row = within(upcoming).getByRole('listitem')
    // 08:00 UTC is 09:00 in Lagos (and midnight in Los Angeles).
    expect(row.textContent).toMatch(/Thursday 3 Dec 2026, 09:00 to 09:30/)
    expect(row.textContent).toContain('Medical outpatients, Fictional General Hospital')
    expect(row.textContent).toContain('Follow-up · with Dr Fiction Adeyemi · 30 minutes')
    expect(within(row).getByText('Booked')).toBeDefined()
    // Read only: nothing to change or cancel here.
    expect(within(row).queryByRole('button')).toBeNull()
    expect(myAppointmentsServed()).toBe(true)

    await press(screen.getByRole('button', { name: 'Past' }))
    const past = await screen.findByRole('list', { name: 'Past appointments' })
    expect(within(past).getByText('Missed')).toBeDefined()
    expect(within(past).getByRole('listitem').textContent).toMatch(/2 Nov 2026, 14:00 to 14:20/)
    expect(sent.filter(request => request.path === MINE).map(request => request.method)).toEqual(['GET', 'GET'])
  })

  it('says when there are none', async () => {
    renderPortal(<MyAppointments />, () => json({ items: [], nextCursor: null }))
    expect(await screen.findByText('No upcoming appointments')).toBeDefined()
  })

  it('says appointments are not available yet while they are switched off, and the menu stops listing them', async () => {
    const { sent } = renderPortal(<MyAppointments />, () => problem(503, 'APPOINTMENTS_NOT_AVAILABLE', 'Appointments are not available yet.'))
    expect(await screen.findByText('Appointments are not available yet')).toBeDefined()
    await waitFor(() => expect(myAppointmentsServed()).toBe(false))
    expect(screen.queryByRole('button', { name: 'Past' })).toBeNull()
    // Asked once: a 503 is not tried again.
    expect(sent.filter(request => request.path === MINE)).toHaveLength(1)
  })

  it('offers Try again when the read fails', async () => {
    let reads = 0
    renderPortal(<MyAppointments />, () => {
      reads += 1
      return reads <= 1 ? problem(500, 'INTERNAL_ERROR', 'Something went wrong.') : json({ items: [item()], nextCursor: null })
    })
    await press(await screen.findByRole('button', { name: /Try again/ }))
    expect(await screen.findByRole('list', { name: 'Upcoming appointments' })).toBeDefined()
    // Sent once, then once more on Try again: the read is never tried again by itself.
    expect(reads).toBe(2)
  })

  it('keeps the tab chosen last when a slow Show more for the other tab answers after it', async () => {
    let releaseMore: ((response: Response) => void) | null = null
    let reads = 0
    const { sent } = renderPortal(<MyAppointments />, path => {
      if (path !== MINE) return json({})
      reads += 1
      if (reads === 1) return json({ items: [item()], nextCursor: 'upcoming-page-2' })
      // Show more on Upcoming: held back, as a slow connection delivers it after the Past answer.
      if (reads === 2) return new Promise<Response>(resolve => { releaseMore = resolve })
      return json({ items: [item({ appointmentId: 'a3', status: 'checked_in', startsAt: '2026-11-02T13:00:00.000Z', endsAt: '2026-11-02T13:20:00.000Z' })],
        nextCursor: null })
    })
    await screen.findByRole('list', { name: 'Upcoming appointments' })
    await press(screen.getByRole('button', { name: 'Show more' }))
    await waitFor(() => expect(reads).toBe(2))
    await press(screen.getByRole('button', { name: 'Past' }))
    const past = await screen.findByRole('list', { name: 'Past appointments' })
    expect(within(past).getByText('You checked in')).toBeDefined()

    await act(async () => {
      releaseMore?.(json({ items: [item({ appointmentId: 'a2', clinicName: 'Late Upcoming Clinic' })], nextCursor: null }))
      await new Promise(resolve => setTimeout(resolve, 50))
    })
    // Past keeps its own list: not blank, and not Upcoming's second page.
    expect(within(screen.getByRole('list', { name: 'Past appointments' })).getByText('You checked in')).toBeDefined()
    expect(screen.queryByText(/Late Upcoming Clinic/)).toBeNull()
    expect(sent.filter(request => request.path === MINE)).toHaveLength(3)
  })

  it('never calls a status it does not know "Booked"', () => {
    expect(appointmentStatus('booked')).toEqual({ label: 'Booked', tone: 'brand' })
    expect(appointmentStatus('no_show')).toEqual({ label: 'Missed', tone: 'warn' })
    for (const status of ['completed', 'ended_elsewhere', '', 'toString', 'constructor']) {
      expect(appointmentStatus(status)).toEqual({ label: 'Status not known', tone: 'neutral' })
    }
  })

  it('shows a status it does not know as not known, never as booked', async () => {
    renderPortal(<MyAppointments />, () => json({ items: [item({ status: 'completed' })], nextCursor: null }))
    const list = await screen.findByRole('list', { name: 'Upcoming appointments' })
    expect(within(list).getByText('Status not known')).toBeDefined()
    expect(within(list).queryByText('Booked')).toBeNull()
  })

  it('says each time in Lagos', () => {
    expect(appointmentWhen({ startsAt: '2026-12-02T23:30:00.000Z', endsAt: '2026-12-03T00:00:00.000Z' })).toMatch(/^Thursday 3 Dec 2026, 00:30 to 01:00$/)
    expect(appointmentWhen({ startsAt: 'not a time', endsAt: '' })).toBe('Time not known')
  })
})

describe('appointment notices in the inbox', () => {
  const notice = (code: string, metadata: Record<string, unknown>): PatientNotification => ({
    id: 'n1', notificationCode: code, resourceType: 'appointment', resourceId: 'a0000000-0000-4000-8000-00000000a001', metadata,
    readAt: null, createdAt: '2026-11-26T10:00:00.000Z',
  })

  it('names the facility and the Lagos time, never the clinic or reason, and opens My appointments', () => {
    const metadata = { facilityName: 'Fictional General Hospital', startsAt: '2026-12-03T08:00:00.000Z' }
    expect(notificationTitle(notice('APPOINTMENT_BOOKED', metadata))).toMatch(/^Fictional General Hospital booked an appointment for you on Thursday 3 Dec 2026, 09:00$/)
    expect(notificationTitle(notice('APPOINTMENT_RESCHEDULED', metadata))).toMatch(/^Fictional General Hospital moved your appointment to Thu/)
    expect(notificationTitle(notice('APPOINTMENT_CANCELLED', metadata))).toMatch(/^Fictional General Hospital cancelled your appointment on/)
    expect(notificationTitle(notice('APPOINTMENT_REMINDER', metadata))).toMatch(/^Reminder: you have an appointment at Fictional General Hospital on/)
    expect(notificationTitle(notice('APPOINTMENT_BOOKED', {}))).toBe('A hospital booked an appointment for you')
    expect(notificationAction(notice('APPOINTMENT_BOOKED', metadata))).toEqual({ to: '/appointments', label: 'Open My appointments' })
  })
})
