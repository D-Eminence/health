import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { AdminActor } from '../api'

/**
 * "Reading quality" (Migrate learning, phase 1): plain-word tiles from the proposed admin read, for super admins
 * (platform.dashboard.read) only, dormant until served: a 404 says "Not available yet" calmly and the sidebar stops
 * listing it. Fictional data only.
 */
vi.mock('../env', () => ({ environment: () => ({ name: 'local', turnstileSiteKey: null, apiBaseUrl: 'https://gateway.example.test' }) }))

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const actor = (permissions: string[]): AdminActor => ({ accountId: 'admin-1', subject: 'staff:1', displayName: 'Demo Admin',
  email: 'admin@example.test', platformRoles: [], platformPermissions: permissions })
const SUPER = ['platform.admin.access', 'platform.operations.read', 'platform.dashboard.read']
const READING_QUALITY = '/api/v1/admin/ocr/reading-quality'

const ANSWER = {
  days: 30, itemsKept: 1240,
  itemsChanged: { ai_misread: 87, paper_out_of_date: 12 },
  itemsRemoved: { not_on_paper: 9, written_twice: 14, not_needed: 3, cannot_read: 21, other_patient: 1, some_later_code: 5 },
  itemsMissed: { medicine: 6, allergy: 1, diagnosis: 2, lab_result: 4, other: 0 },
  itemsSeen: 1300, itemsShown: 1388, pagesChecked: 410, pagesTotal: 452, documentsChecked: 198,
  documentsRejected: { wrong_patient: 2, not_medical_record: 1, cannot_read: 3, duplicate: 4, other: null },
}

function serve(permissions: string[], quality: () => Response) {
  const calls: Array<{ path: string; search: string }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const target = new URL(url)
    calls.push({ path: target.pathname, search: target.search })
    if (target.pathname === '/api/v1/admin/session') return json({ actor: actor(permissions), expiresAt: '2026-11-11T20:00:00Z' })
    if (target.pathname === '/api/v1/admin/overview') return json({ registeredPatients: 3, facilities: 2, verifiedFacilities: 2,
      suspendedFacilities: 0, activeStaffMemberships: 1, pendingIdentityReviews: 0 })
    if (target.pathname === READING_QUALITY) return quality()
    return json({ status: 404, code: 'NOT_FOUND', detail: `Cannot ${String(init.method)} ${target.pathname}` }, 404)
  }))
  return calls
}

const missing = () => json({ status: 404, code: 'NOT_FOUND', detail: `Cannot GET ${READING_QUALITY}` }, 404)

async function openAt(path: string) {
  const { App } = await import('../App')
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/admin/*" element={<App />} /></Routes></MemoryRouter>)
}

const tile = (name: string) => screen.getByRole('article', { name })

beforeEach(() => {
  vi.resetModules()
  document.cookie = 'hid_access_admin_csrf=csrf-token; path=/'
})
afterEach(() => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules()
  document.cookie = 'hid_access_admin_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
})

describe('Reading quality', () => {
  it('is linked under Operations for platform.dashboard.read only', async () => {
    const { visibleNavigation } = await import('../navigation')
    const titles = (permissions: string[]) => visibleNavigation(actor(permissions)).flatMap(section => section.items.map(item => item.title))
    expect(titles(SUPER)).toContain('Reading quality')
    expect(titles(['platform.admin.access', 'platform.operations.read', 'platform.audit.read', 'platform.facility.read'])).not.toContain('Reading quality')
  })

  it('shows its counts as plain-word tiles, and no code or ID', async () => {
    const calls = serve(SUPER, () => json(ANSWER))
    await openAt('/admin/reading-quality')
    await screen.findByRole('heading', { name: 'Items read from paper' })
    expect(calls.filter(call => call.path === READING_QUALITY).map(call => call.search)).toEqual(['?days=30'])
    expect(within(tile('Items kept as read')).getByText('1,240')).toBeTruthy()
    expect(within(tile('Items changed because the AI misread the paper')).getByText('87')).toBeTruthy()
    expect(within(tile('Items changed because the paper was out of date')).getByText('12')).toBeTruthy()
    // A reason the page has no words for is never shown, nor counted.
    const removed = within(tile('Items removed, and why'))
    expect(removed.getByText('48')).toBeTruthy()
    expect(within(removed.getByRole('list', { name: 'Items removed, by reason' })).getAllByRole('listitem').map(item => item.textContent))
      .toEqual(['Not on the paper9', 'Written twice14', 'Not needed3', 'Can’t read it21', 'Belongs to another patient1'])
    expect(within(tile('Items the reading missed')).getByText('13')).toBeTruthy()
    expect(within(tile('Items staff looked at')).getByText('1,300 of 1,388')).toBeTruthy()
    expect(within(tile('Pages checked')).getByText('410 of 452')).toBeTruthy()
    const rejected = within(tile('Documents rejected, and why'))
    expect(rejected.getByText('10')).toBeTruthy()
    expect(within(rejected.getByRole('list')).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Wrong patient2',
      'Not a medical record1', 'Can’t be read3', 'Same document twice4', 'Something elseNot yet'])
    const page = document.getElementById('admin-main')!.textContent ?? ''
    expect(page).not.toMatch(/ai_misread|not_on_paper|lab_result|wrong_patient|some_later_code|itemsKept|reading-quality/)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('while the backend does not serve it (404): says it isn’t available yet, calmly, and stops listing it', async () => {
    serve(SUPER, missing)
    await openAt('/admin/reading-quality')
    expect(await screen.findByRole('heading', { name: 'Not available yet' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).not.toMatch(/404|NOT_FOUND|Cannot GET|not available from this Identity/)
    const navigation = screen.getByRole('navigation', { name: 'Main navigation' })
    await waitFor(() => expect(within(navigation).queryByRole('link', { name: 'Reading quality' })).toBeNull())
  })

  it('is not opened for an administrator without the permission, and nothing is read', async () => {
    const calls = serve(['platform.admin.access', 'platform.operations.read'], () => json(ANSWER))
    await openAt('/admin/reading-quality')
    expect(await screen.findByText('You can’t open Reading quality')).toBeTruthy()
    expect(calls.some(call => call.path === READING_QUALITY)).toBe(false)
  })

  it('says a failed read in plain words, with Try again', async () => {
    serve(SUPER, () => json({ status: 503, code: 'SERVICE_UNAVAILABLE', detail: 'upstream down' }, 503))
    await openAt('/admin/reading-quality')
    const alert = await screen.findByRole('alert', {}, { timeout: 5000 })
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(alert.textContent).not.toMatch(/SERVICE_UNAVAILABLE|upstream/)
  })
})
