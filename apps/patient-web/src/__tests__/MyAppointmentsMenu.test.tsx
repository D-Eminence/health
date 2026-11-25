import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { PortalShell } from '../routes/Portal'
import { forgetMyAppointmentsServed, myAppointmentsServed } from '../appointmentsServed'
import { json, problem, renderPortal, type Handler } from './portalHarness'

const build = vi.hoisted(() => ({ novu: true }))
vi.mock('../backendContract', () => ({ usesNovuBackend: () => build.novu }))
vi.mock('../chatFeatures', () => ({ patientChatEnabled: () => false, patientChatHost: () => false }))
vi.mock('../env', () => ({ getEnvironment: () => ({ name: 'production' }) }))

/*
 * "Appointments" in the portal's menu (hid-system APPT-1 route 12, 0161) is listed only once an answer says the
 * backend serves it and it is switched on, as "Add a record" is: today's backend has no such route (404), and one with
 * APPOINTMENTS_ENABLED off answers 503 until the owner's go-live. Nobody is offered a page that can only say "not
 * available yet". Every patient and answer here is fictional.
 */

const MINE = '/ehr/me/appointments'

function gateway(appointments: () => Response | Promise<Response>): Handler {
  return (path, method) => path === MINE && method === 'GET' ? appointments()
    : path === '/identity/me' ? json({ hid: 'HID-ABC234', fullName: 'Ada Example', firstName: 'Ada' })
    : problem(404, 'NOT_FOUND', `Cannot ${method} ${path}`)
}

const portal = (appointments: () => Response | Promise<Response>) => renderPortal(<Routes>
  <Route path="/" element={<PortalShell />}><Route index element={<p>Home page</p>} /></Route>
</Routes>, gateway(appointments))

const sidebar = () => screen.getByRole('navigation', { name: 'Main navigation' })
const appointmentsLink = () => within(sidebar()).queryByRole('link', { name: 'Appointments' })
const asked = (sent: ReadonlyArray<{ path: string }>) => sent.filter(request => request.path === MINE).length

beforeEach(() => { build.novu = true })
afterEach(() => forgetMyAppointmentsServed())

describe('"Appointments" in the portal menu', () => {
  it('is not listed where the backend has no such route (today’s: 404)', async () => {
    const { sent } = portal(() => problem(404, 'NOT_FOUND', 'Cannot GET /api/v1/ehr/me/appointments'))
    expect(await screen.findByText('Home page')).toBeDefined()
    await waitFor(() => expect(myAppointmentsServed()).toBe(false))
    expect(appointmentsLink()).toBeNull()
    expect(asked(sent)).toBeGreaterThan(0)
  })

  it('is not listed while appointments are switched off (503)', async () => {
    portal(() => problem(503, 'APPOINTMENTS_NOT_AVAILABLE', 'Appointments are not available yet.'))
    expect(await screen.findByText('Home page')).toBeDefined()
    await waitFor(() => expect(myAppointmentsServed()).toBe(false))
    expect(appointmentsLink()).toBeNull()
  })

  it('is not listed before an answer comes, and is once one says appointments are served', async () => {
    let answer: ((response: Response) => void) | null = null
    portal(() => new Promise<Response>(resolve => { answer = resolve }))
    expect(await screen.findByText('Home page')).toBeDefined()
    await waitFor(() => expect(answer).not.toBeNull())
    expect(appointmentsLink()).toBeNull()
    await act(async () => { answer?.(json({ items: [], nextCursor: null })) })
    await waitFor(() => expect(appointmentsLink()?.getAttribute('href')).toBe('/appointments'))
    expect(myAppointmentsServed()).toBe(true)
  })

  it('is not listed when the read fails for another reason, which says nothing either way', async () => {
    portal(() => problem(500, 'INTERNAL_ERROR', 'Something went wrong.'))
    expect(await screen.findByText('Home page')).toBeDefined()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(myAppointmentsServed()).toBeNull()
    expect(appointmentsLink()).toBeNull()
  })

  it('is never asked for or listed on a build for hid-system main, which has no appointments', async () => {
    build.novu = false
    const { sent } = portal(() => json({ items: [], nextCursor: null }))
    expect(await screen.findByText('Home page')).toBeDefined()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(asked(sent)).toBe(0)
    expect(appointmentsLink()).toBeNull()
  })
})
