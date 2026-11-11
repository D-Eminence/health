import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { AdminActor } from '../api'

/**
 * "Outreach organisers to check" (open sign-up on outreach., owner decisions of 11 November 2026): support's queue of
 * groups waiting for their one-time check, the check in one click, pausing a group with a reason, rescuing a campaign
 * whose admin has gone, and the switch's name. No limits and no billing (decisions 2 and 6). Fictional data only.
 */
vi.mock('../env', () => ({ environment: () => ({ name: 'local', turnstileSiteKey: null, apiBaseUrl: 'https://gateway.example.test' }) }))

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const actor = (permissions: string[]): AdminActor => ({ accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada',
  email: 'ada@example.test', platformRoles: [], platformPermissions: permissions })
const SUPPORT = ['platform.admin.access', 'platform.facility.read', 'platform.facility.unlock', 'platform.facility.manage']
const ORG = '0e7c0000-0000-4000-8000-0000000000aa'
const CAMPAIGN = '0e7c0000-0000-4000-8000-0000000000bb'
const MEMBER = '0e7c0000-0000-4000-8000-0000000000cc'
const GROUP = { organizationId: ORG, facilityId: '0e7c0000-0000-4000-8000-000000000001', version: 4, displayName: null, groupName: 'Ajegunle Health Volunteers',
  kind: 'group', registrationNumber: 'IT123456', organiserName: 'Funke Ade', organiserEmail: 'funke@example.test', phone: '+2348012345678',
  reviewState: 'pending', label: 'Unverified organiser', reviewedAt: null, suspendedAt: null, createdAt: '2026-11-11T08:00:00.000Z',
  termsVersion: '2026-11-01', campaigns: 1, activeCampaigns: 0, members: 2, pendingInvitations: 1 }

interface Call { path: string; search: string; method: string; body: unknown; ifMatch: string | null }
const problem = (status: number, code: string, detail: string) => json({ status, code, detail }, status)

function serve(permissions: string[], organisers: unknown[] = [GROUP], answer?: (path: string) => Response | undefined) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const target = new URL(url)
    const ifMatch = new Headers(init.headers).get('If-Match')
    calls.push({ path: target.pathname, search: target.search, method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : null, ifMatch })
    if (target.pathname === '/api/v1/admin/session') return json({ actor: actor(permissions), expiresAt: '2026-11-11T20:00:00Z' })
    const special = answer?.(target.pathname)
    if (special) return special
    if (target.pathname === '/api/v1/admin/outreach-organisers') return json({ organisers })
    // As identity-api: review, pause and close need the version (If-Match), else 428.
    if (/\/(review|suspend|close)$/.test(target.pathname) && !ifMatch) return problem(428, 'OUTREACH_ADMIN_VERSION_REQUIRED', 'Reload the list, then try again.')
    if (target.pathname.endsWith('/review')) return json({ organizationId: ORG, version: 5, reviewState: 'reviewed', label: 'Checked by Health ID' })
    if (target.pathname.endsWith('/suspend')) return json({ organizationId: ORG, version: 5, reviewState: 'suspended', label: 'Paused', revokedRoles: 2 })
    if (target.pathname.endsWith('/close')) return json({ campaignId: CAMPAIGN, status: 'closed', alreadyClosed: false })
    if (target.pathname.endsWith('/admins')) return json({ campaignId: CAMPAIGN, membershipId: MEMBER, role: 'admin' })
    return json({ status: 404, code: 'NOT_FOUND', detail: `Cannot ${String(init.method)} ${target.pathname}` }, 404)
  }))
  return calls
}

async function openAt(path: string) {
  const { App } = await import('../App')
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/admin/*" element={<App />} /></Routes></MemoryRouter>)
}

beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1'); vi.resetModules() })
afterEach(() => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
})

describe('Outreach organisers to check', () => {
  it('lists the groups waiting for their check, with the organiser’s phone, and no limits', async () => {
    const calls = serve(SUPPORT)
    await openAt('/admin/outreach-organisers')
    const row = (await screen.findByText('Ajegunle Health Volunteers')).closest('tr')!
    expect(within(row).getByText('Funke Ade')).toBeTruthy()
    expect(within(row).getByText('+2348012345678')).toBeTruthy()
    expect(within(row).getByText('Unverified organiser')).toBeTruthy()
    expect(within(row).getByText('CAC or IT number IT123456 (not checked)')).toBeTruthy()
    expect(within(row).getByText('1 invitation waiting')).toBeTruthy()
    expect(row.textContent).not.toContain('undefined')
    expect(calls.find(call => call.path === '/api/v1/admin/outreach-organisers')?.search).toBe('?reviewState=pending')
    expect(document.body.textContent).not.toMatch(/raise|limit|per day|₦/i)
  })

  it('marks a group checked in one click, with an empty body and the list’s version as If-Match', async () => {
    const calls = serve(SUPPORT)
    await openAt('/admin/outreach-organisers')
    await screen.findByText('Ajegunle Health Volunteers')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark checked' })) })
    expect(await screen.findByText('Ajegunle Health Volunteers is checked. Its campaigns can now start registering people.')).toBeTruthy()
    const review = calls.find(call => call.path === `/api/v1/admin/outreach-organisers/${ORG}/review`)!
    expect(review.method).toBe('POST')
    expect(review.body).toEqual({})
    expect(review.ifMatch).toBe('"4"')
  })

  it('says a version conflict in plain words', async () => {
    serve(SUPPORT, [GROUP], path => path.endsWith('/review')
      ? problem(409, 'OUTREACH_ORGANISER_VERSION_CONFLICT', 'Someone else changed this outreach group just now.') : undefined)
    await openAt('/admin/outreach-organisers')
    await screen.findByText('Ajegunle Health Volunteers')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark checked' })) })
    expect((await screen.findByRole('alert')).textContent).toContain('Someone else changed this outreach group just now. Refresh the list and try again.')
  })

  it('offers no check or pause without both platform.facility.manage and platform.facility.unlock', async () => {
    serve(['platform.admin.access', 'platform.facility.read', 'platform.facility.unlock'])
    await openAt('/admin/outreach-organisers')
    await screen.findByText('Ajegunle Health Volunteers')
    expect(screen.queryByRole('button', { name: 'Mark checked' })).toBeNull()
    expect(screen.getByText(/needs platform.facility.manage and platform.facility.unlock/)).toBeTruthy()
  })

  it('pauses a group only with a reason of 8 characters or more and a confirmation', async () => {
    const calls = serve(SUPPORT)
    await openAt('/admin/outreach-organisers')
    await screen.findByText('Ajegunle Health Volunteers')
    fireEvent.click(screen.getByText('Pause group', { selector: 'summary' }))
    const pause = screen.getByRole('button', { name: 'Pause group' }) as HTMLButtonElement
    expect(pause.disabled).toBe(true)
    const row = screen.getByText('Ajegunle Health Volunteers').closest('tr')!
    fireEvent.change(within(row).getByLabelText('Why'), { target: { value: 'Collecting phone numbers for a raffle' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pause Ajegunle Health Volunteers' }))
    await act(async () => { fireEvent.click(pause) })
    await waitFor(() => expect(calls.some(call => call.path.endsWith('/suspend'))).toBe(true))
    expect(calls.find(call => call.path.endsWith('/suspend'))!.body).toEqual({ reason: 'Collecting phone numbers for a raffle' })
    expect(calls.find(call => call.path.endsWith('/suspend'))!.ifMatch).toBe('"4"')
    expect(await screen.findByText(/is paused\. Nobody in it can register people/)).toBeTruthy()
  })

  it('closes a campaign whose admin has gone, or makes a member its admin, with a reason', async () => {
    const calls = serve(SUPPORT)
    await openAt('/admin/outreach-organisers')
    const rescue = await screen.findByRole('region', { name: 'A campaign has lost its admin' })
    fireEvent.change(within(rescue).getByLabelText('Campaign reference'), { target: { value: CAMPAIGN } })
    await act(async () => { fireEvent.click(within(rescue).getByRole('button', { name: 'Close campaign' })) })
    expect(within(rescue).getByRole('alert').textContent).toMatch(/its version and a reason of 8 to 500 characters/)
    fireEvent.change(within(rescue).getByLabelText('Why'), { target: { value: 'The only admin left the group' } })
    await act(async () => { fireEvent.click(within(rescue).getByRole('button', { name: 'Close campaign' })) })
    expect(calls.some(call => call.path.endsWith('/close'))).toBe(false)
    fireEvent.change(within(rescue).getByLabelText('Campaign version (to close it)'), { target: { value: '7' } })
    await act(async () => { fireEvent.click(within(rescue).getByRole('button', { name: 'Close campaign' })) })
    await waitFor(() => expect(calls.some(call => call.path === `/api/v1/admin/outreach-campaigns/${CAMPAIGN}/close`)).toBe(true))
    expect(calls.find(call => call.path.endsWith('/close'))!.ifMatch).toBe('"7"')
    expect(calls.find(call => call.path.endsWith('/close'))!.body).toEqual({ reason: 'The only admin left the group' })
    fireEvent.change(within(rescue).getByLabelText('Member reference (to make them admin)'), { target: { value: MEMBER } })
    fireEvent.change(within(rescue).getByLabelText('Why'), { target: { value: 'The only admin left the group' } })
    await act(async () => { fireEvent.click(within(rescue).getByRole('button', { name: 'Make admin' })) })
    await waitFor(() => expect(calls.some(call => call.path === `/api/v1/admin/outreach-campaigns/${CAMPAIGN}/admins`)).toBe(true))
    expect(calls.find(call => call.path.endsWith('/admins'))!.body).toEqual({ membershipId: MEMBER, reason: 'The only admin left the group' })
  })

  it('says plainly when this Identity has no outreach groups yet (404)', async () => {
    serve(SUPPORT, [], path => path === '/api/v1/admin/outreach-organisers' ? json({ status: 404, code: 'NOT_FOUND', detail: 'x' }, 404) : undefined)
    await openAt('/admin/outreach-organisers')
    expect(await screen.findByText(/not available from this Identity yet/)).toBeTruthy()
  })

  it('is listed under Organizations for platform.facility.read, and never on main', async () => {
    const { visibleNavigation, NAVIGATION_ITEMS, isServed } = await import('../navigation')
    const titles = visibleNavigation(actor(['platform.admin.access', 'platform.facility.read']))
      .find(section => section.title === 'Organizations')?.items.map(item => item.title) ?? []
    expect(titles).toContain('Outreach organisers to check')
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    expect(isServed(NAVIGATION_ITEMS.find(item => item.path === '/admin/outreach-organisers')!)).toBe(false)
  })
})
