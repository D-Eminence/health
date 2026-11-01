import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
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

/*
 * Each event reads as a plain sentence (docs/AUDIT_ACTION_LABELS.md, owner rule of 1 Nov 2026): what was done, by whom,
 * when, and Allowed, Refused or Failed, in the same words as the blue Audit & Compliance page (audit/auditRow.ts). Its
 * action code, correlation ID and resource type are never shown; the code can still be searched for. Fictional data only.
 */
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

    expect(await screen.findByText('Looked up a patient by Health ID')).toBeTruthy()
    expect(mocks.facilityAudit).toHaveBeenCalledWith('facility-1', undefined)
    expect(screen.getAllByRole('columnheader').map(header => header.textContent)).toEqual(['When', 'What happened', 'By', 'Outcome'])
    const [, first, second] = screen.getAllByRole('row')
    expect(within(first!).getAllByRole('cell').slice(1).map(cell => cell.textContent))
      .toEqual(['Looked up a patient by Health ID', 'Staff member', 'Allowed'])
    // A code the spec does not list is worded by its fallback rule.
    expect(within(second!).getAllByRole('cell').slice(1).map(cell => cell.textContent))
      .toEqual(['Patient access and registration activity', 'Staff member', 'Refused'])
    for (const withheld of ['patient-secret', 'sensitive reason', 'sensitive payload', 'identity.patient.lookup', 'identity.access.denied',
      'corr-51', 'corr-50', '>patient<', '>staff<', '>success<', '>denied<']) {
      expect(document.body.innerHTML).not.toContain(withheld)
    }

    fireEvent.change(screen.getByRole('combobox', { name: 'Outcome on this page' }), { target: { value: 'denied' } })
    expect(screen.queryByText('Looked up a patient by Health ID')).toBeNull()
    expect(screen.getByText('Patient access and registration activity')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Older page' }))
    await waitFor(() => expect(mocks.facilityAudit).toHaveBeenCalledWith('facility-1', '50'))
    expect(await screen.findByText('No audit events')).toBeTruthy()
  })

  it('searches the page by what happened, who did it, the outcome or the action code, which is never shown', async () => {
    mocks.facilityAudit.mockResolvedValueOnce({ items: [
      { sequenceId: '3', occurredAt: '2026-01-01T12:00:00.000Z', correlationId: 'corr-3', actorType: 'staff',
        action: 'ehr.encounter.create', outcome: 'failure', resourceType: 'encounter' },
      { sequenceId: '2', occurredAt: '2026-01-01T11:00:00.000Z', correlationId: 'corr-2', actorType: 'patient',
        action: 'identity.access-request.approve', outcome: 'success', resourceType: 'access-request' },
    ], nextBeforeSequenceId: null })
    render(<FacilityAudit />)
    const search = await screen.findByRole('searchbox', { name: 'Search this page' })
    expect(search.getAttribute('placeholder')).toBe('What happened, who or outcome')
    await screen.findByText('Tried to start a new visit')
    expect(within(screen.getByRole('table')).getByText('Failed')).toBeTruthy()
    const shown = () => screen.queryAllByRole('row').slice(1).map(row => within(row).getAllByRole('cell')[1]?.textContent)

    fireEvent.change(search, { target: { value: 'encounter' } })
    expect(shown()).toEqual(['Tried to start a new visit'])
    fireEvent.change(search, { target: { value: 'patient approved' } })
    expect(shown()).toEqual(['Patient approved an access request'])
    fireEvent.change(search, { target: { value: 'failed' } })
    expect(shown()).toEqual(['Tried to start a new visit'])
    fireEvent.change(search, { target: { value: 'corr-2' } })
    expect(shown()).toEqual([])
    expect(screen.getByText('No matching events on this page')).toBeTruthy()
    expect(within(screen.getByRole('combobox', { name: 'Outcome on this page' })).getAllByRole('option').map(option => option.textContent))
      .toEqual(['All outcomes', 'Allowed', 'Refused', 'Failed'])
  })

  it('says a failed read in its own words, never the server’s', async () => {
    mocks.facilityAudit.mockRejectedValueOnce(new HidApiError(500, 'Audit store timeout on shard 3', { code: 'INTERNAL_ERROR' }))
    render(<FacilityAudit />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Audit events could not be loaded. Try again')
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('shard')
    expect(document.body.textContent).not.toContain('INTERNAL_ERROR')
  })

  it('does not request events without the active facility permission, and says so without naming a permission', () => {
    mocks.useStaff.mockReturnValue(session([]))
    render(<FacilityAudit />)

    expect(screen.getByText('Audit access unavailable')).toBeTruthy()
    expect(screen.getByText('Your role at this facility doesn’t include reviewing audit events. Ask your facility administrator.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('audit.read')
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
