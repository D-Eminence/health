import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FacilityAudit } from '../Audit'

const mocks = vi.hoisted(() => ({
  facilityAudit: vi.fn(),
  useStaff: vi.fn(),
}))

vi.mock('../../api', () => ({ staffApi: { facilityAudit: mocks.facilityAudit } }))
vi.mock('../../App', () => ({ useStaff: mocks.useStaff }))

function session(permissions: string[]) {
  return { state: { status: 'ready', session: { actor: {
    facility: { id: 'facility-1', name: 'Example Clinic', permissions },
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
    expect(mocks.facilityAudit).not.toHaveBeenCalled()
  })

  it('says when a page held only request records, and still offers the older page', async () => {
    mocks.facilityAudit.mockResolvedValueOnce({ items: [], nextBeforeSequenceId: '40' })
    render(<FacilityAudit />)

    expect(await screen.findByText('Nothing to show on this page')).toBeTruthy()
    expect(screen.queryByText('No audit events')).toBeNull()
    expect(screen.getByRole('button', { name: 'Older page' })).toBeTruthy()
  })
})
