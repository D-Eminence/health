import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { AuditPage } from '../Audit'

const mocks = vi.hoisted(() => ({ audit: vi.fn() }))
vi.mock('../api', () => ({ adminApi: { audit: mocks.audit } }))

const event = (sequenceId: string, action: string) => ({ sequenceId, eventId: `event-${sequenceId}`,
  occurredAt: '2026-10-08T12:00:00.000Z', action, outcome: 'success', actorSubject: 'staff:admin',
  correlationId: `corr-${sequenceId}` })

beforeEach(() => vi.clearAllMocks())

describe('platform audit page', () => {
  it('pages to older events with the returned cursor', async () => {
    mocks.audit.mockResolvedValueOnce({ items: [event('52', 'admin.audit.list')], nextBeforeSequenceId: '52' })
    mocks.audit.mockResolvedValueOnce({ items: [event('51', 'admin.account.disabled')], nextBeforeSequenceId: null })

    render(<MemoryRouter><AuditPage /></MemoryRouter>)
    expect(await screen.findByText('corr-52')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Load older events' }))
    expect(await screen.findByText('corr-51')).toBeTruthy()
    expect(mocks.audit).toHaveBeenLastCalledWith({}, '52')
    expect(screen.getByText('corr-52')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Load older events' })).toBeNull()
  })

  it('surfaces an audit failure with its reference and a retry', async () => {
    mocks.audit.mockRejectedValueOnce(new HidApiError(503, 'unavailable', { code: 'SERVICE_UNAVAILABLE', requestId: 'corr-503' }))
    mocks.audit.mockResolvedValueOnce({ items: [event('60', 'admin.overview')], nextBeforeSequenceId: null })

    render(<MemoryRouter><AuditPage /></MemoryRouter>)
    expect(await screen.findByText('Audit events could not be loaded. Reference: corr-503')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' }).at(-1)!)
    await waitFor(() => expect(screen.getByText('corr-60')).toBeTruthy())
  })
})
