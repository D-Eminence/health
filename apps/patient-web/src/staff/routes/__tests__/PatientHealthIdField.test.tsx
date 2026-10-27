import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Patients } from '../Patients'

/**
 * PEHR-03 (WCAG 3.3.1 Error Identification, 3.3.3 Error Suggestion). A Health ID
 * that did not match the format disabled both submit buttons and nothing said
 * why: no error, no aria-invalid and no format beyond the placeholder "HID-…".
 * The Health ID alphabet leaves out 0, 1, I and O, so one mistyped character
 * blocked access silently. The format check (HID_PATTERN, as hid-system's DTOs)
 * is unchanged; it now runs when either form is sent, and says what is wrong.
 */
const api = vi.hoisted(() => ({ lookupPatient: vi.fn(), requestAccess: vi.fn(), verifyPin: vi.fn(), breakGlass: vi.fn(), closeGrant: vi.fn() }))
const staff = vi.hoisted(() => ({ permissions: [] as string[] }))

vi.mock('../../api', () => ({
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) => lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
}))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'], permissions: staff.permissions,
    } } } },
    activePatient: null,
    setActivePatient: vi.fn(() => true),
  }),
}))
vi.mock('../../session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))

const FORMAT = 'Starts with HID-, then 6 to 32 letters and digits. Health IDs never use 0, 1, I or O.'
const MISTYPED = 'Check the Health ID: it starts with HID-, then 6 to 32 letters and digits, and never uses 0, 1, I or O.'
const EMPTY = 'Enter the patient’s Health ID.'

beforeEach(() => {
  vi.clearAllMocks()
  staff.permissions = ['identity.patient.read', 'identity.consent.write', 'identity.patient-access-pin.verify', 'identity.break-glass.write']
  api.lookupPatient.mockResolvedValue({ authorization: { decision: 'deny' } })
  api.requestAccess.mockResolvedValue({ accessRequestId: 'request-1', status: 'pending' })
})

function renderPatients() {
  render(<MemoryRouter><Patients /></MemoryRouter>)
  return screen.getByRole('textbox', { name: 'Health ID' }) as HTMLInputElement
}

const describedText = (element: HTMLElement) => (element.getAttribute('aria-describedby') ?? '').split(' ')
  .map(id => document.getElementById(id)?.textContent ?? '').join(' ')

describe('PEHR-03: the Health ID field says what it needs', () => {
  it('states the format in a hint tied to the field before anything is typed', () => {
    const field = renderPatients()
    expect(describedText(field)).toBe(FORMAT)
    expect(field.getAttribute('aria-invalid')).toBeNull()
  })

  it('keeps both buttons usable for a Health ID in the wrong format', () => {
    const field = renderPatients()
    fireEvent.change(field, { target: { value: 'HID-K0LO1I' } })
    expect((screen.getByRole('button', { name: 'Verify access' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Send access request' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('Verify access with a mistyped Health ID: says what is wrong at the field, marks it invalid, focuses it and sends nothing', async () => {
    const field = renderPatients()
    fireEvent.change(field, { target: { value: 'HID-K0LO1I' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))

    await waitFor(() => expect(document.activeElement).toBe(field))
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(describedText(field)).toBe(MISTYPED)
    expect(screen.getByText(MISTYPED).closest('#patient-hid-error')).toBeTruthy()
    // Focus moved to the field, whose description says it: an alert as well would be spoken twice.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(api.lookupPatient).not.toHaveBeenCalled()
    // The value is kept for correction.
    expect(field.value).toBe('HID-K0LO1I')
  })

  it('Send access request with a mistyped Health ID: the error is at the Health ID field, in the other card, and it takes focus', async () => {
    const field = renderPatients()
    fireEvent.change(field, { target: { value: 'HID-K0LO1I' } })
    fireEvent.change(screen.getByLabelText(/^Clinical reason/), { target: { value: 'Follow-up consultation' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send access request' }))

    await waitFor(() => expect(document.activeElement).toBe(field))
    expect(describedText(field)).toBe(MISTYPED)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(api.requestAccess).not.toHaveBeenCalled()
  })

  it('pressing Enter in the focused field announces the error as an alert, since focus does not move', async () => {
    const field = renderPatients()
    field.focus()
    fireEvent.change(field, { target: { value: 'HID-K0LO1I' } })
    fireEvent.submit(field.closest('form') as HTMLFormElement)
    const first = await screen.findByRole('alert')
    expect(first.textContent).toBe(MISTYPED)
    expect(first.closest('#patient-hid-error')).toBeTruthy()
    expect(document.activeElement).toBe(field)
    // Pressing Enter again, unchanged, announces it again.
    fireEvent.submit(field.closest('form') as HTMLFormElement)
    await waitFor(() => expect(screen.getByRole('alert')).not.toBe(first))
    expect(screen.getByRole('alert').textContent).toBe(MISTYPED)
    expect(api.lookupPatient).not.toHaveBeenCalled()
  })

  it('starts at HID-, keeps the prefix once and puts what is typed in capitals (owner decision, 2026-10-27)', () => {
    const field = renderPatients()
    expect(field.value).toBe('HID-')
    fireEvent.change(field, { target: { value: 'HID-abc234' } })
    expect(field.value).toBe('HID-ABC234')
    fireEvent.change(field, { target: { value: 'abc234' } })
    expect(field.value).toBe('HID-ABC234')
    fireEvent.change(field, { target: { value: 'HID-HID-7KQ2M9' } })
    expect(field.value).toBe('HID-7KQ2M9')
    fireEvent.change(field, { target: { value: 'HID' } })
    expect(field.value).toBe('HID-')
  })

  it('sends what was typed after the prefill as one Health ID, from either card', async () => {
    const field = renderPatients()
    fireEvent.change(field, { target: { value: 'HID-7kq2m9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))
    await waitFor(() => expect(api.lookupPatient).toHaveBeenCalledWith('facility-1', 'HID-7KQ2M9', 'direct-care'))
    fireEvent.change(screen.getByLabelText(/^Clinical reason/), { target: { value: 'Follow-up consultation' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send access request' }))
    await waitFor(() => expect(api.requestAccess).toHaveBeenCalledWith('facility-1', 'HID-7KQ2M9', 'read_records', 'Follow-up consultation', 60))
  })

  it('pressing Enter in the field with an empty Health ID asks for one', async () => {
    const field = renderPatients()
    // Nothing after the prefill is as empty as the field was before it was filled in.
    expect(field.value).toBe('HID-')
    fireEvent.submit(field.closest('form') as HTMLFormElement)
    await waitFor(() => expect(document.activeElement).toBe(field))
    expect(describedText(field)).toBe(EMPTY)
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(api.lookupPatient).not.toHaveBeenCalled()
  })

  it('clears the error once the Health ID changes, and shows the format again', async () => {
    const field = renderPatients()
    fireEvent.change(field, { target: { value: 'HID-K0LO1I' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))
    await waitFor(() => expect(field.getAttribute('aria-invalid')).toBe('true'))
    fireEvent.change(field, { target: { value: 'HID-KXLX' } })
    expect(field.getAttribute('aria-invalid')).toBeNull()
    expect(describedText(field)).toBe(FORMAT)
    expect(screen.queryByText(MISTYPED)).toBeNull()
  })

  it('sends a well-formed Health ID as before, normalised to capitals', async () => {
    const field = renderPatients()
    fireEvent.change(field, { target: { value: ' hid-abcdef23 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))
    await waitFor(() => expect(api.lookupPatient).toHaveBeenCalledWith('facility-1', 'HID-ABCDEF23', 'direct-care'))
    expect(field.getAttribute('aria-invalid')).toBeNull()
  })

  it('keeps the buttons disabled for a missing permission, which the format never decided', () => {
    staff.permissions = []
    const field = renderPatients()
    fireEvent.change(field, { target: { value: 'HID-ABCDEF23' } })
    expect((screen.getByRole('button', { name: 'Verify access' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Send access request' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
