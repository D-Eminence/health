import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccessRequests } from '../AccessRequests'
import { Patients } from '../Patients'

/**
 * NEW-PEHR-ACTION-FOCUS on patient access and access requests. Closing a grant
 * removes the control that did it (the current-record card, or the request's
 * Close access button), and focus fell to the page; each confirmation was a
 * status node inserted with its text. Focus now moves to the page's heading
 * when it was lost, a status region mounted throughout says what happened, and
 * a submit button stays focusable while its request runs.
 */
const api = vi.hoisted(() => ({ lookupPatient: vi.fn(), requestAccess: vi.fn(), verifyPin: vi.fn(), breakGlass: vi.fn(), closeGrant: vi.fn(),
  listAccessRequests: vi.fn() }))
const staff = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const store = { activePatient: null as unknown, version: 0 }
  return {
    store,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    setActivePatient: (patient: unknown) => { store.activePatient = patient; store.version += 1; listeners.forEach(listener => listener()); return true },
  }
})

vi.mock('../../api', () => ({
  ACCESS_REQUEST_STATUSES: ['pending', 'approved', 'denied', 'revoked', 'expired'],
  ACCESS_OUTCOME_FILTERS: ['active', 'closed'],
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) => lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
}))
vi.mock('../../App', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useStaff: () => {
      useSyncExternalStore(staff.subscribe, () => staff.store.version)
      return {
        state: { status: 'ready', session: { actor: { displayName: 'Ada Clinician', facility: {
          id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'],
          permissions: ['identity.patient.read', 'identity.consent.write', 'identity.patient-access-pin.verify', 'identity.break-glass.write'],
        } } } },
        activePatient: staff.store.activePatient,
        setActivePatient: staff.setActivePatient,
        lock: null,
      }
    },
  }
})
vi.mock('../../session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const GRANT = 'c0000000-0000-4000-8000-000000000001'
const lookup = { patient: { patientId: PATIENT, hid: 'HID-ABCDEF23', fullName: 'Ada Patient', version: 1 },
  authorization: { decision: 'allow', consentGrantId: GRANT, breakGlass: false } }
const request = (effectiveStatus: string) => ({ accessRequestId: 'b0000000-0000-4000-8000-000000000001', patientId: PATIENT,
  scope: 'read_records', purposeOfUse: 'direct-care', reason: 'Follow-up consultation', status: 'approved', requestedDurationMinutes: 60,
  requestedAt: '2026-10-09T08:00:00.000Z', consentGrantId: GRANT, grantExpiresAt: '2026-10-09T09:00:00.000Z', effectiveStatus })

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}
const focused = () => document.activeElement
function region(id: string) {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Expected the status region ${id} to be mounted before the step.`)
  expect(element.getAttribute('role')).toBe('status')
  return element
}

beforeEach(() => {
  vi.clearAllMocks()
  staff.store.activePatient = null
})

describe('patient access', () => {
  it('closing the open record’s grant: focus moves to the page heading, and the page says it', async () => {
    staff.store.activePatient = { hid: 'HID-ABCDEF23', purpose: 'direct-care', lookup }
    api.closeGrant.mockResolvedValue({})
    render(<MemoryRouter><Patients /></MemoryRouter>)
    const status = region('patients-status')
    expect(status.textContent).toBe('')
    await press(screen.getByRole('button', { name: 'Close my grant' }))
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { level: 1, name: 'Open a patient record.' })))
    expect(screen.queryByRole('button', { name: 'Close my grant' })).toBeNull()
    expect(status.isConnected).toBe(true)
    expect(status.textContent).toBe('Access was closed by the backend.')
  })

  it('sending an access request keeps focus on the button, unavailable while it runs, and says what happened', async () => {
    const sending = deferred<unknown>()
    api.requestAccess.mockReturnValueOnce(sending.promise)
    render(<MemoryRouter><Patients /></MemoryRouter>)
    const status = region('patients-status')
    fireEvent.change(screen.getByRole('textbox', { name: 'Health ID' }), { target: { value: 'HID-ABCDEF23' } })
    fireEvent.change(screen.getByLabelText(/^Clinical reason/), { target: { value: 'Follow-up consultation' } })
    const button = screen.getByRole('button', { name: 'Send access request' })
    await press(button)
    const running = screen.getByRole('button', { name: 'Working…' })
    expect(running).toBe(button)
    expect(running.getAttribute('aria-disabled')).toBe('true')
    expect(focused()).toBe(running)
    await act(async () => { fireEvent.click(running) })
    expect(api.requestAccess).toHaveBeenCalledTimes(1)
    await act(async () => { sending.resolve({ accessRequestId: 'request-1', status: 'pending' }) })
    await waitFor(() => expect(status.textContent).toBe('Request request-1 is pending. The patient must approve before records are available.'))
    expect(focused()).toBe(button)
  })
})

describe('access requests', () => {
  it('closing a grant: focus moves to the page heading once its button goes, and the page says it', async () => {
    api.listAccessRequests.mockResolvedValueOnce([request('active')]).mockResolvedValue([request('closed')])
    api.closeGrant.mockResolvedValue({})
    render(<AccessRequests />)
    const close = await screen.findByRole('button', { name: 'Close access' })
    const status = region('access-requests-status')
    expect(status.textContent).toBe('')
    await press(close)
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { level: 1, name: 'Access requests.' })))
    expect(screen.queryByRole('button', { name: 'Close access' })).toBeNull()
    expect(status.isConnected).toBe(true)
    expect(status.textContent).toBe('Access was closed by the backend.')
  })
})
