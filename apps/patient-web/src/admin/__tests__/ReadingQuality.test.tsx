import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { AdminActor } from '../api'

/**
 * "Reading quality" (Migrate learning, phase 1): plain-word tiles from Session B's review-outcome summary, added up over
 * its groups, read from the proposed admin read, for super admins only (Session B's two permissions and
 * platform.dashboard.read), dormant until served: a 404 says "Not available yet" calmly and the sidebar stops listing
 * it. Fictional data only.
 */
vi.mock('../env', () => ({ environment: () => ({ name: 'local', turnstileSiteKey: null, apiBaseUrl: 'https://gateway.example.test' }) }))

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const actor = (permissions: string[]): AdminActor => ({ accountId: 'admin-1', subject: 'staff:1', displayName: 'Demo Admin',
  email: 'admin@example.test', platformRoles: [], platformPermissions: permissions })
const SUPER = ['platform.admin.access', 'platform.operations.read', 'platform.dashboard.read']
const READING_QUALITY = '/api/v1/admin/ocr/quality/summary'
const FACILITY = '98d00002-0000-4000-8000-000000000001'

const reviews = (week: string, counts: object) => ({ week, facilityId: FACILITY, promptVersion: 'demo-prompt-1', estimated: 0, summaryFailed: 0,
  correctionFields: {}, ...counts })
const items = (week: string, kind: string, decisions: Record<string, number>) => ({ week, facilityId: FACILITY, kind, promptVersion: 'demo-prompt-1',
  items: Object.values(decisions).reduce((sum, count) => sum + count, 0), decisions, byConfidence: {}, byReadBy: {}, hardPage: {}, fieldChanges: {},
  checkReasons: {} })

/** Session B's answer (hid.ocr.quality-summary/v1): two weeks shown, one held back, and some small reason counts left out. */
const ANSWER = {
  schema: 'hid.ocr.quality-summary/v1', from: '2026-10-12', to: '2026-11-08', scope: 'bound_facility', minGroupSize: 20, truncated: false,
  reviewGroups: [
    reviews('2026-W42', { reviews: 120, validated: 110, rejected: 10, reviewConfirmed: 90, missedItems: 9,
      rejectionReasons: { wrong_patient: 5, duplicate_document: 5 }, removalReasons: { not_on_paper: 9, duplicate: 14, some_later_code: 5 },
      changeReasons: { misread: 80 }, smallCellsHidden: 2 }),
    reviews('2026-W43', { reviews: 90, validated: 88, rejected: 2, reviewConfirmed: 70, missedItems: 4,
      rejectionReasons: {}, removalReasons: { unreadable: 21 }, changeReasons: { misread: 7, clinical_update: 12 } }),
    { week: '2026-W44', facilityId: FACILITY, promptVersion: 'demo-prompt-1', suppressed: true },
  ],
  itemGroups: [
    items('2026-W42', 'medicine', { kept_unchanged: 700, kept_changed: 80, removed: 23 }),
    items('2026-W43', 'lab_result', { kept_unchanged: 540, kept_changed: 19, removed: 21 }),
    { week: '2026-W44', facilityId: FACILITY, kind: 'allergy', promptVersion: 'demo-prompt-1', suppressed: true },
  ],
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
  it('is linked under Operations for super admins only', async () => {
    const { visibleNavigation } = await import('../navigation')
    const titles = (permissions: string[]) => visibleNavigation(actor(permissions)).flatMap(section => section.items.map(item => item.title))
    expect(titles(SUPER)).toContain('Reading quality')
    expect(titles(['platform.admin.access', 'platform.operations.read', 'platform.audit.read', 'platform.facility.read'])).not.toContain('Reading quality')
    expect(titles(['platform.admin.access', 'platform.dashboard.read'])).not.toContain('Reading quality')
  })

  it('shows its counts as plain-word tiles, and no code or ID', async () => {
    const calls = serve(SUPER, () => json(ANSWER))
    await openAt('/admin/reading-quality')
    await screen.findByRole('heading', { name: 'Items read from paper' })
    // No facility is sent: the admin application never sends one.
    expect(calls.filter(call => call.path === READING_QUALITY).map(call => call.search)).toEqual([''])
    expect(screen.getByText('Weeks from 12 October 2026 to 8 November 2026.')).toBeTruthy()
    expect(within(tile('Documents checked and saved')).getByText('198')).toBeTruthy()
    expect(within(tile('Checks with every page ticked')).getByText('160 of 198')).toBeTruthy()
    expect(within(tile('Items kept as read')).getByText('1,240')).toBeTruthy()
    expect(within(tile('Items changed because the AI misread the paper')).getByText('87')).toBeTruthy()
    expect(within(tile('Items changed because the paper was out of date')).getByText('12')).toBeTruthy()
    // A reason the page has no words for is never shown; one the server left out isn't listed.
    const removed = within(tile('Items removed, and why'))
    expect(removed.getByText('44')).toBeTruthy()
    expect(within(removed.getByRole('list', { name: 'Items removed, by reason' })).getAllByRole('listitem').map(item => item.textContent))
      .toEqual(['Not on the paper9', 'Written twice14', 'Can’t read it21'])
    expect(within(tile('Items the reading missed')).getByText('13')).toBeTruthy()
    const rejected = within(tile('Documents rejected, and why'))
    expect(rejected.getByText('12')).toBeTruthy()
    expect(within(rejected.getByRole('list')).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Wrong patient5',
      'Same document twice5'])
    // What was held back is said in words.
    const leftOut = within(screen.getByRole('region', { name: 'What these figures leave out' }))
    expect(leftOut.getByText(/too few checks to show/)).toBeTruthy()
    expect(leftOut.getByText(/fewer than 5 times in a week/)).toBeTruthy()
    const page = document.getElementById('admin-main')!.textContent ?? ''
    expect(page).not.toMatch(/misread\b(?! the)|clinical_update|not_on_paper|lab_result|wrong_patient|some_later_code|kept_unchanged|W4\d|demo-prompt|98d00002|suppressed|quality\/summary/)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says “Too few to show” for a change reason the server left out, and counts nothing from an empty answer', async () => {
    const parsed = (await import('../ReadingQuality')).parseReadingQuality
    expect(parsed({ reviewGroups: [], itemGroups: [] })).toMatchObject({ anyShown: false, heldBack: 0, validated: 0 })
    serve(SUPER, () => json({ ...ANSWER, reviewGroups: [reviews('2026-W43', { reviews: 30, validated: 30, rejected: 0, reviewConfirmed: 0,
      missedItems: 0, rejectionReasons: {}, removalReasons: {}, changeReasons: { misread: 7 } })], itemGroups: [] }))
    await openAt('/admin/reading-quality')
    await screen.findByRole('heading', { name: 'Items read from paper' })
    expect(within(tile('Items changed because the paper was out of date')).getByText('Too few to show')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'What these figures leave out' })).toBeNull()
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
