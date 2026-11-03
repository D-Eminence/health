import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Laboratory, Outreach, Pharmacy } from '../Operations'

/**
 * Since hid-system #65 the gateway answers every Lab, Pharmacy, OCR and
 * Outreach route with 404 API_ROUTE_NOT_FOUND while that module is off
 * (gateway/nginx.conf.template; INTERFACE_CONTRACT.md "Launch module set"),
 * and a production deployment cannot turn one on. Its body has no
 * detail, so the client's message is its generic 404 one. The read
 * permissions stay seeded, so these workspaces still open: each must say
 * that the module is not in service, not that the work is missing.
 */
const api = vi.hoisted(() => ({
  labWorkItems: vi.fn(), pharmacyWorkItems: vi.fn(), outreachCampaigns: vi.fn(), outreachCases: vi.fn(),
  outreachCampaignMembers: vi.fn(),
}))
const permissions = vi.hoisted(() => ({ value: [] as string[] }))

vi.mock('../../api', () => ({ staffApi: api }))
vi.mock('../../App', () => ({
  useStaff: () => ({ state: { status: 'ready', session: { actor: { id: 'staff-1', facility: {
    id: 'facility-1', membershipId: 'member-1', permissions: permissions.value,
  } } } }, lock: null }),
}))

// The error the client builds from the gateway's body (packages/http envelope.ts, errors.ts).
const GENERIC_NOT_FOUND = 'We could not find what you were looking for.'
const routeClosed = () => new HidApiError(404, GENERIC_NOT_FOUND, { code: 'API_ROUTE_NOT_FOUND' })
// Plain words, never the deployment or the gateway's own (owner's rule, 1 Nov 2026).
const NOT_IN_SERVICE = 'This part of Health ID isn’t turned on for your facility. Contact Health ID support if you need it.'

beforeEach(() => {
  vi.clearAllMocks()
  for (const read of [api.labWorkItems, api.pharmacyWorkItems, api.outreachCampaigns, api.outreachCases]) {
    read.mockRejectedValue(routeClosed())
  }
})

async function alerts() {
  const shown = await screen.findAllByRole('alert')
  return shown.map(alert => alert.textContent)
}

describe('a workspace whose module the gateway has closed', () => {
  it('Laboratory says the module is not in service', async () => {
    permissions.value = ['lab.work-item.read']
    render(<Laboratory />)
    expect(await alerts()).toEqual([NOT_IN_SERVICE])
  })

  it('Pharmacy says the module is not in service', async () => {
    permissions.value = ['pharmacy.work-item.read']
    render(<Pharmacy />)
    expect(await alerts()).toEqual([NOT_IN_SERVICE])
  })

  it('Outreach says the module is not in service for both its lists', async () => {
    permissions.value = ['outreach.campaign.read', 'outreach.registration.read']
    render(<Outreach />)
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
    expect(await alerts()).toEqual([NOT_IN_SERVICE, NOT_IN_SERVICE])
  })

  it('keeps the message of a 404 the module itself sent', async () => {
    permissions.value = ['lab.work-item.read']
    api.labWorkItems.mockRejectedValue(new HidApiError(404, 'Lab work item was not found', { code: 'LAB_WORK_ITEM_NOT_FOUND' }))
    render(<Laboratory />)
    expect(await alerts()).toEqual(['We couldn’t find what you were looking for. It may have been moved or removed.'])
    expect(document.body.textContent).not.toContain('Lab work item was not found')
  })
})
