import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { FacilityAudit } from '../Audit'

const mocks = vi.hoisted(() => ({
  facilityAudit: vi.fn(),
  useStaff: vi.fn(),
}))

vi.mock('../../api', () => ({ staffApi: { facilityAudit: mocks.facilityAudit } }))
vi.mock('../../App', () => ({ useStaff: mocks.useStaff }))

function session(permissions: string[], selfService?: { review: string; organizationType: string }) {
  return { state: { status: 'ready', session: { actor: {
    facility: { id: 'facility-1', name: 'Example Clinic', permissions, ...(selfService ? { selfService } : {}) },
  } } } }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useStaff.mockReturnValue(session(['audit.read']))
})

describe('facility audit review', () => {
  it('requests an operations-scoped page and withholds sensitive event fields from the screen', async () => {
    mocks.facilityAudit.mockResolvedValueOnce({ items: [
      { sequenceId: '51', occurredAt: '2026-01-01T12:00:00.000Z', correlationId: 'corr-51',
        actorType: 'staff', action: 'identity.patient.lookup', outcome: 'success',
        resourceType: 'patient', patientId: 'patient-secret', reason: 'sensitive reason',
        details: { note: 'sensitive payload' } },
      { sequenceId: '50', occurredAt: '2026-01-01T11:00:00.000Z', correlationId: 'corr-50',
        actorType: 'staff', action: 'identity.access.denied', outcome: 'denied', resourceType: 'patient' },
    ], nextBeforeSequenceId: '50' })
    mocks.facilityAudit.mockResolvedValueOnce({ items: [], nextBeforeSequenceId: null })

    render(<FacilityAudit />)

    expect(await screen.findByText('identity.patient.lookup')).toBeTruthy()
    expect(mocks.facilityAudit).toHaveBeenCalledWith('facility-1', undefined)
    expect(screen.getByText('corr-51')).toBeTruthy()
    expect(screen.queryByText('patient-secret')).toBeNull()
    expect(screen.queryByText('sensitive reason')).toBeNull()
    expect(screen.queryByText('sensitive payload')).toBeNull()

    fireEvent.change(screen.getByRole('combobox', { name: 'Outcome on this page' }), { target: { value: 'denied' } })
    expect(screen.queryByText('identity.patient.lookup')).toBeNull()
    expect(screen.getByText('identity.access.denied')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Older page' }))
    await waitFor(() => expect(mocks.facilityAudit).toHaveBeenCalledWith('facility-1', '50'))
    expect(await screen.findByText('No audit events')).toBeTruthy()
  })

  it('does not request events without the active facility permission', () => {
    mocks.useStaff.mockReturnValue(session([]))
    render(<FacilityAudit />)

    expect(screen.getByText('Audit access unavailable')).toBeTruthy()
    // In plain words, naming no permission (owner's rule: no codes on screen).
    expect(screen.getByText('Your role at this facility doesn’t include reviewing audit events. Ask your facility administrator.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('audit.read')
    expect(mocks.facilityAudit).not.toHaveBeenCalled()
  })

  it('asks for a facility before one is chosen, requesting nothing', () => {
    mocks.useStaff.mockReturnValue({ state: { status: 'ready', session: { actor: { facility: undefined } } } })
    render(<FacilityAudit />)
    expect(screen.getByText('Choose the facility you are working at to review its audit events.')).toBeTruthy()
    expect(mocks.facilityAudit).not.toHaveBeenCalled()
  })

  it('says a refused read in the refusal\'s own plain words, never the server\'s text or code', async () => {
    mocks.facilityAudit.mockRejectedValueOnce(new HidApiError(403, 'Missing permission audit.read for facility-1', { code: 'PERMISSION_DENIED' }))
    render(<FacilityAudit />)

    expect(await screen.findByText('Your role at this facility doesn’t include reviewing audit events. Ask your facility administrator.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/audit\.read|PERMISSION_DENIED|Missing permission|facility-1|403/)
  })

  it('says when a page held only request records, and still offers the older page', async () => {
    mocks.facilityAudit.mockResolvedValueOnce({ items: [], nextBeforeSequenceId: '40' })
    render(<FacilityAudit />)

    expect(await screen.findByText('Nothing to show on this page')).toBeTruthy()
    expect(screen.queryByText('No audit events')).toBeNull()
    expect(screen.getByRole('button', { name: 'Older page' })).toBeTruthy()
  })
})

/*
 * Who reads the refusal (#104's rule, the owner's decision for #107), in the blue page's words: every kind of facility
 * has its own audit trail from the start (its administrator holds audit review while Health ID support checks it, and
 * after), so a facility's own administrator is never told to ask themselves, to wait for the check, or to add someone.
 * A refused read says the same as the refusal, whoever reads it. Every facility here is fictional.
 */
describe('facility audit refusal, by who reads it', () => {
  const ROLE = 'Your role at this facility doesn’t include reviewing audit events.'
  const ASK = `${ROLE} Ask your facility administrator.`
  /** A self-signed-up facility's administrator whose role here holds no audit review (fictional: theirs holds it today). */
  const ADMINISTRATOR = ['organization.manage', 'workforce.manage', 'outreach.registration.read']
  const NO_CODES = /permission|membership|workforce|audit\.read|PERMISSION_DENIED|_|\/provider/i
  beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1') })
  afterEach(() => { vi.unstubAllEnvs() })

  /** The refusal as `permissions` reads it, at a facility that signed itself up when `selfService` says so. */
  function refusalAs(permissions: string[], selfService?: { review: string; organizationType: string }) {
    mocks.useStaff.mockReturnValue(session(permissions, selfService))
    render(<FacilityAudit />)
    const heading = screen.getByRole('heading', { level: 1, name: 'Audit access unavailable' })
    expect(document.body.textContent).not.toMatch(NO_CODES)
    expect(mocks.facilityAudit).not.toHaveBeenCalled()
    return heading.parentElement?.textContent?.replace('Audit access unavailable', '')
  }

  it.each(['hospital', 'clinic', 'laboratory', 'pharmacy', 'other'])('the administrator of a checked facility (%s): the role sentence only', organizationType => {
    expect(refusalAs(ADMINISTRATOR, { review: 'reviewed', organizationType })).toBe(ROLE)
  })

  it('the administrator of a facility Health ID support is still checking: the role sentence only', () => {
    expect(refusalAs(['workforce.manage', 'outreach.registration.read'], { review: 'pending', organizationType: 'clinic' })).toBe(ROLE)
  })

  it('anyone else at a checked facility: told to ask its administrator', () => {
    expect(refusalAs(['ehr.encounter.read'], { review: 'reviewed', organizationType: 'clinic' })).toBe(ASK)
  })

  it('an administrator at a facility Health ID support manages: told to ask its administrator', () => {
    expect(refusalAs(ADMINISTRATOR)).toBe(ASK)
  })

  it.each(['', 'main-v1'])('the administrator of a checked facility on today’s backend (%j): told to ask its administrator', contract => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', contract)
    expect(refusalAs(ADMINISTRATOR, { review: 'reviewed', organizationType: 'clinic' })).toBe(ASK)
  })

  it('says a refused read to the administrator of a checked facility in the same words, never asking them to ask themselves', async () => {
    mocks.useStaff.mockReturnValue(session(['workforce.manage', 'audit.read'], { review: 'reviewed', organizationType: 'clinic' }))
    mocks.facilityAudit.mockRejectedValueOnce(new HidApiError(403, 'Missing permission audit.read for facility-1', { code: 'PERMISSION_DENIED' }))
    render(<FacilityAudit />)
    expect(await screen.findByText(ROLE)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Ask your facility administrator/)
    expect(document.body.textContent).not.toMatch(/audit\.read|PERMISSION_DENIED|Missing permission|facility-1|403/)
  })
})
