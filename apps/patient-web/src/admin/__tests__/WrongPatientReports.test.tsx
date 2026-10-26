import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { AdminActor } from '../api'

/**
 * Support's "Wrong-patient reports" through the console's own client (item 3, owner decisions D7, D11, D12, D14;
 * SPEC-FINAL §8.4, §9.5): the unreviewed reports, flagged first as the backend orders them, and the recent ones; each
 * with who accepted it and how, the reason, the reporter's note (support only), who recorded the work, what was undone
 * and the 30-day counts; "Mark reviewed" with platform.facility.manage (If-Match, one or more actions or "No further
 * action" alone, a note, removing the reporter's note); the Overview tile; a facility page's 30-day count. An Identity
 * without the list (today's backend) answers 404: the page says so, and the tile and the count show nothing.
 */
vi.mock('../env', () => ({ environment: () => ({ name: 'local', turnstileSiteKey: null, apiBaseUrl: 'https://gateway.example.test' }) }))

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const actor = (permissions: string[]): AdminActor => ({ accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada',
  email: 'ada@example.test', platformRoles: [], platformPermissions: permissions })
const READER = ['platform.admin.access', 'platform.facility.read']
const REVIEWER = [...READER, 'platform.facility.manage']
const FACILITY_ID = '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f'
const ORDERING_ID = '11111111-1111-4111-8111-111111111111'
const REPORT_ID = '3b5e7a90-1c2d-4e3f-8a9b-0c1d2e3f4a5b'
const DAY = 24 * 60 * 60 * 1000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

const report = (overrides: Record<string, unknown> = {}) => ({ reportId: REPORT_ID, version: 1,
  routeId: '9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e', reference: '9C1B2D3E', kind: 'lab_request',
  receivingFacility: { id: FACILITY_ID, name: 'Yaba Diagnostics' }, orderingFacility: { id: ORDERING_ID, name: 'General Hospital' },
  reportedAt: ago(1), reportedBy: { accountId: 'acc-2', name: 'Kemi Scientist' }, acceptedBy: { accountId: 'acc-3', name: 'Tayo Clerk' },
  sameMember: false, acceptedWith: 'date_of_birth', acceptedAt: ago(2), reason: 'wrong_order_chosen',
  note: 'Two patients with the same date of birth at the counter', noteRemoved: false, stateBefore: 'completed', resultsVoided: 2,
  resultReportsMarked: 1, dispensingReversed: false, specimensCollected: 1, recordedBy: [{ accountId: 'acc-2', name: 'Kemi Scientist' },
    { accountId: 'acc-4', name: 'Uche Verifier' }], reporterRecordedWork: true, flags: ['something_came_back', 'reporter_recorded_work'],
  facilityReportsLast30Days: 3, memberReportsLast30Days: 1, review: null, ...overrides })
const quiet = report({ reportId: 'aa000000-0000-4000-8000-000000000001', reference: '1A2B3C4D', kind: 'prescription',
  reportedAt: ago(40), stateBefore: 'accepted', resultsVoided: 0, resultReportsMarked: 0, specimensCollected: 0, recordedBy: [],
  reporterRecordedWork: false, flags: [], reason: 'someone_elses_details', acceptedWith: 'health_id', sameMember: true,
  facilityReportsLast30Days: 1, note: 'Said they were the patient and showed a card' })

interface Call { path: string; search: string; method: string; headers: Headers; body: unknown }

function serve(permissions: string[], overrides: Partial<Record<string, () => Response>> = {}) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const target = new URL(url)
    calls.push({ path: target.pathname, search: target.search, method: String(init.method), headers: new Headers(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : null })
    const override = overrides[`${String(init.method)} ${target.pathname}`]
    if (override) return override()
    if (target.pathname === '/api/v1/admin/session') return json({ actor: actor(permissions), expiresAt: '2026-10-27T20:00:00Z' })
    if (target.pathname === '/api/v1/admin/overview') return json({ registeredPatients: 3, facilities: 2, verifiedFacilities: 2,
      suspendedFacilities: 0, activeStaffMemberships: 1, pendingIdentityReviews: 0 })
    if (target.pathname === '/api/v1/admin/wrong-patient-reports') return json({ items: [report(), quiet] })
    if (target.pathname === `/api/v1/admin/wrong-patient-reports/${REPORT_ID}/review`) return json({ reportId: REPORT_ID, version: 2,
      reviewedAt: new Date().toISOString(), actions: ['ordering_facility_told', 'referred_to_dpo'], noteRemoved: true })
    if (target.pathname === `/api/v1/admin/facilities/${FACILITY_ID}`) return json({ id: FACILITY_ID, organizationId: 'org-1',
      organizationName: 'Yaba Diagnostics Limited', name: 'Yaba Diagnostics', code: 'YD', status: 'verified', statusReason: null,
      statusChangedAt: null, createdAt: '2026-10-01T09:00:00.000Z', membershipCount: 3, version: 4 })
    if (target.pathname === `/api/v1/admin/facilities/${FACILITY_ID}/order-route-summary`) return json({ facilityId: FACILITY_ID,
      listed: { value: true, byDefault: true, reason: null, setAt: null }, receivedAcceptedLifetime: 3, receivedPatientsLifetime: 2, counterparts: [] })
    if (target.pathname === `/api/v1/admin/facilities/${FACILITY_ID}/assisted-registration`) return json({ facilityId: FACILITY_ID,
      designated: false, status: null, addressLine: null, town: null, lga: null, state: null, hours: null, reason: null, version: 0, updatedAt: null })
    if (target.pathname === '/api/v1/admin/audit/events') return json({ items: [], nextBeforeSequenceId: null })
    return json({ status: 404, code: 'NOT_FOUND', detail: `Cannot ${String(init.method)} ${target.pathname}` }, 404)
  }))
  return calls
}

/** What today's backend answers: no such route. */
const missing = () => json({ status: 404, code: 'NOT_FOUND', detail: 'Cannot GET /api/v1/admin/wrong-patient-reports' }, 404)

async function openAt(path: string) {
  const { App } = await import('../App')
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/admin/*" element={<App />} /></Routes></MemoryRouter>)
}

const lists = (calls: Call[]) => calls.filter(call => call.path === '/api/v1/admin/wrong-patient-reports').map(call => call.search)

beforeEach(() => {
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1'); vi.resetModules()
  document.cookie = 'hid_access_csrf=csrf-token; path=/'
})
afterEach(() => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
})

describe('wrong-patient reports in the Novu console', () => {
  it('is linked under Organizations for platform.facility.read, and never on main', async () => {
    const { visibleNavigation, NAVIGATION_ITEMS, isServed } = await import('../navigation')
    const titles = (permissions: string[]) => visibleNavigation(actor(permissions)).flatMap(section => section.items.map(item => item.title))
    expect(titles(READER)).toContain('Wrong-patient reports')
    expect(titles(['platform.admin.access', 'platform.principal.read'])).not.toContain('Wrong-patient reports')
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    expect(isServed(NAVIGATION_ITEMS.find(item => item.path === '/admin/wrong-patient-reports')!)).toBe(false)
  })

  it('lists the unreviewed reports as the backend orders them, with no patient or order content', async () => {
    const calls = serve(READER)
    await openAt('/admin/wrong-patient-reports')
    const flagged = (await screen.findByText('9C1B2D3E')).closest('tr')!
    expect(lists(calls)).toEqual(['?status=unreviewed'])
    expect(screen.getByText('2 reports, flagged first, then oldest first.')).toBeTruthy()
    const rows = [...document.querySelectorAll('tbody tr')]
    expect(rows.map(row => row.querySelector('td:nth-child(3) strong')?.textContent)).toEqual(['9C1B2D3E', '1A2B3C4D'])
    expect(flagged.getAttribute('data-flagged')).toBe('true')
    expect(within(flagged).getByText('A result or dispensing had come back')).toBeTruthy()
    expect(within(flagged).getByText('The reporter recorded the work')).toBeTruthy()
    expect(within(flagged).getByText('Lab request')).toBeTruthy()
    expect(within(flagged).getByRole('link', { name: 'Yaba Diagnostics' }).getAttribute('href')).toBe(`/admin/facilities/${FACILITY_ID}`)
    expect(within(flagged).getByRole('link', { name: 'General Hospital' }).getAttribute('href')).toBe(`/admin/facilities/${ORDERING_ID}`)
    expect(within(flagged).getByText('Date of birth only')).toBeTruthy()
    expect(within(flagged).getByText(/^Accepted .* by Tayo Clerk$/)).toBeTruthy()
    expect(within(flagged).getByText('Picked another patient’s order from the list')).toBeTruthy()
    expect(within(flagged).getByText('Two patients with the same date of birth at the counter')).toBeTruthy()
    expect(within(flagged).getByText('Kemi Scientist, Uche Verifier (the reporter among them).')).toBeTruthy()
    expect(within(flagged).getByText('2 result versions marked entered in error at the laboratory. 1 version that had come back withdrawn '
      + 'at the ordering facility. 1 specimen taken.')).toBeTruthy()
    expect(within(flagged).getByText('Contact the facility')).toBeTruthy()
    const other = rows[1] as HTMLElement
    expect(other.getAttribute('data-flagged')).toBeNull()
    expect(within(other).getByText('None')).toBeTruthy()
    expect(within(other).getByText('Nothing had come back to the ordering facility. No dispensing was reversed.')).toBeTruthy()
    expect(within(other).getByText(/^Accepted .* by the reporter$/)).toBeTruthy()
    expect(within(other).getByText('No work was recorded.')).toBeTruthy()
    expect(within(other).queryByText('Contact the facility')).toBeNull()
    // Without platform.facility.manage, no review form.
    expect(within(flagged).getByText('Reviewing needs platform.facility.manage')).toBeTruthy()
    expect(screen.queryByText('Mark reviewed', { selector: 'summary' })).toBeNull()
    // What support does, and the late cases (C7, D14).
    expect(screen.getByText(/^When a result or dispensing had come back, phone the ordering facility the same day/)).toBeTruthy()
    expect(screen.getByText(/^If a patient or clinician tells you a result or dispensing went to the wrong person and the facility can no longer end the order/)).toBeTruthy()
  })

  it('shows the recent reports', async () => {
    const calls = serve(READER)
    await openAt('/admin/wrong-patient-reports')
    await screen.findByText('9C1B2D3E')
    fireEvent.click(screen.getByRole('button', { name: 'Recent (90 days)' }))
    await waitFor(() => expect(lists(calls)).toEqual(['?status=unreviewed', '?status=recent']))
    expect(await screen.findByText('2 reports, newest first.')).toBeTruthy()
  })

  it('shows one facility’s reports, from the link on its page', async () => {
    const calls = serve(READER)
    await openAt(`/admin/wrong-patient-reports?view=recent&facility=${FACILITY_ID}`)
    expect(await screen.findByText(/^Showing only the reports Yaba Diagnostics made\./)).toBeTruthy()
    expect(lists(calls)).toEqual([`?status=recent&facilityId=${FACILITY_ID}`])
    fireEvent.click(screen.getByRole('button', { name: 'Show every facility’s' }))
    await waitFor(() => expect(lists(calls)).toEqual([`?status=recent&facilityId=${FACILITY_ID}`, '?status=recent']))
  })

  it('marks a report reviewed with its version, one or more actions, a note and the reporter’s note removed', async () => {
    let listed = 0
    const calls = serve(REVIEWER, { 'GET /api/v1/admin/wrong-patient-reports': () => {
      listed += 1
      return json({ items: listed === 1 ? [report(), quiet] : [quiet] })
    } })
    await openAt('/admin/wrong-patient-reports')
    const row = (await screen.findByText('9C1B2D3E')).closest('tr')!
    fireEvent.click(within(row).getByText('Mark reviewed', { selector: 'summary' }))
    const submit = within(row).getByRole('button', { name: 'Mark reviewed' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    const box = (name: string) => within(row).getByRole('checkbox', { name }) as HTMLInputElement
    // "No further action" stands alone: choosing it clears the others, and choosing another clears it.
    fireEvent.click(box('Facility contacted'))
    fireEvent.click(box('No further action'))
    expect(box('Facility contacted').checked).toBe(false)
    fireEvent.click(box('Ordering facility told'))
    expect(box('No further action').checked).toBe(false)
    fireEvent.click(box('Referred to the data protection officer'))
    fireEvent.change(within(row).getByLabelText('Review note'), { target: { value: '  Phoned General Hospital; referred to the DPO.  ' } })
    expect(within(row).getByText(/^It is replaced by “Removed by Health ID support at review\.” and can’t be/)).toBeTruthy()
    fireEvent.click(box('Remove the reporter’s note'))
    expect(submit.disabled).toBe(true)
    fireEvent.click(box('I have reviewed this report.'))
    fireEvent.click(submit)
    expect(await screen.findByText('Report on order 9C1B2D3E marked reviewed.')).toBeTruthy()
    const sent = calls.find(call => call.path.endsWith('/review'))!
    expect(sent).toMatchObject({ method: 'POST', path: `/api/v1/admin/wrong-patient-reports/${REPORT_ID}/review`,
      body: { actions: ['ordering_facility_told', 'referred_to_dpo'], note: 'Phoned General Hospital; referred to the DPO.', removeNote: true } })
    expect(sent.headers.get('If-Match')).toBe('"1"')
    expect(sent.headers.get('Idempotency-Key')).toBeNull()
    await waitFor(() => expect(screen.queryByText('9C1B2D3E')).toBeNull())
  })

  it.each([
    ['WRONG_PATIENT_REPORT_ALREADY_REVIEWED', 409, 'Someone has already reviewed this report. The list has been refreshed.', 2],
    ['VERSION_CONFLICT', 409, 'This report changed after it was loaded. The list has been refreshed: check it before reviewing it.', 2],
    ['WRONG_PATIENT_REVIEW_INVALID', 400, 'Choose at least one action, or “No further action” alone, and write a note of 8 to 500 characters.', 1],
  ])('says a refused review (%s), and reads the list again when it changed', async (code, status, says, reads) => {
    const calls = serve(REVIEWER, { [`POST /api/v1/admin/wrong-patient-reports/${REPORT_ID}/review`]: () => json({ status, code, detail: 'No' }, status) })
    await openAt('/admin/wrong-patient-reports')
    const row = (await screen.findByText('9C1B2D3E')).closest('tr')!
    fireEvent.click(within(row).getByText('Mark reviewed', { selector: 'summary' }))
    fireEvent.click(within(row).getByRole('checkbox', { name: 'No further action' }))
    fireEvent.change(within(row).getByLabelText('Review note'), { target: { value: 'Checked with the laboratory' } })
    fireEvent.click(within(row).getByRole('checkbox', { name: 'I have reviewed this report.' }))
    fireEvent.click(within(row).getByRole('button', { name: 'Mark reviewed' }))
    expect((await within(row).findByRole('alert')).textContent).toBe(says)
    expect(calls.find(call => call.path.endsWith('/review'))?.body).toEqual({ actions: ['no_further_action'], note: 'Checked with the laboratory' })
    await waitFor(() => expect(lists(calls)).toHaveLength(reads))
  })

  it('shows a reviewed report’s review, and a note support removed as the fixed text', async () => {
    serve(REVIEWER, { 'GET /api/v1/admin/wrong-patient-reports': () => json({ items: [report({ noteRemoved: true,
      note: 'Removed by Health ID support at review.', review: { reviewedAt: ago(0), reviewedBy: { accountId: 'admin-1', name: 'Ada' },
        actions: ['ordering_facility_told', 'referred_to_dpo'], note: 'Phoned General Hospital' } })] }) })
    await openAt('/admin/wrong-patient-reports?view=recent')
    const row = (await screen.findByText('9C1B2D3E')).closest('tr')!
    expect(within(row).getByText('Removed by Health ID support at review.').tagName).toBe('EM')
    expect(within(row).getByText(/^Reviewed .* by Ada$/)).toBeTruthy()
    expect(within(row).getByText('Ordering facility told, Referred to the data protection officer')).toBeTruthy()
    expect(within(row).queryByText('Mark reviewed', { selector: 'summary' })).toBeNull()
  })

  it('says the list is not available from an Identity without it (today’s backend)', async () => {
    serve(READER, { 'GET /api/v1/admin/wrong-patient-reports': missing })
    await openAt('/admin/wrong-patient-reports')
    expect((await screen.findByRole('alert')).textContent).toMatch(/^Wrong-patient reports are not available from this Identity yet\./)
  })
})

describe('wrong-patient reports elsewhere in the console', () => {
  it('counts the reports to review on the Overview, linked to the list', async () => {
    const calls = serve(READER)
    await openAt('/admin/overview')
    const attention = await screen.findByRole('region', { name: 'Waiting for attention' })
    const tile = (await within(attention).findByRole('link', { name: 'Wrong-patient reports' })).closest('article')!
    expect(await within(tile).findByText('2')).toBeTruthy()
    expect(tile.textContent).toContain('2 to review')
    expect(within(tile).getByRole('link', { name: 'Wrong-patient reports' }).getAttribute('href')).toBe('/admin/wrong-patient-reports')
    expect(lists(calls)).toEqual(['?status=unreviewed'])
  })

  it('shows no tile where the backend has no such list (404)', async () => {
    const calls = serve(READER, { 'GET /api/v1/admin/wrong-patient-reports': missing })
    await openAt('/admin/overview')
    await screen.findByRole('heading', { name: 'Overview' })
    await waitFor(() => expect(lists(calls)).toHaveLength(1))
    await waitFor(() => expect(screen.queryByText(/to review|Loading…/)).toBeNull())
    expect(screen.queryByRole('region', { name: 'Waiting for attention' })?.textContent ?? '').not.toMatch(/Wrong-patient/)
    expect(document.body.textContent).not.toMatch(/not available from this Identity/)
  })

  it('counts a facility’s reports of the last 30 days on its page, only when its orders are shown', async () => {
    const calls = serve(READER)
    await openAt(`/admin/facilities/${FACILITY_ID}`)
    const panel = (await screen.findByRole('heading', { name: 'Orders with other facilities' })).closest('section')!
    expect(lists(calls)).toEqual([])
    fireEvent.click(within(panel).getByRole('button', { name: 'Show orders with other facilities' }))
    const count = await within(panel).findByText(/^Wrong-patient reports, last 30 days:/)
    // The 40-day-old report is outside the last 30 days.
    expect(count.textContent).toBe('Wrong-patient reports, last 30 days: 1 See its reports')
    expect(within(panel).getByRole('link', { name: 'See its reports' }).getAttribute('href'))
      .toBe(`/admin/wrong-patient-reports?view=recent&facility=${FACILITY_ID}`)
    expect(lists(calls)).toEqual([`?status=recent&facilityId=${FACILITY_ID}`])
  })

  it('says nothing of them on a facility page where the backend has no such list (404)', async () => {
    serve(READER, { 'GET /api/v1/admin/wrong-patient-reports': missing })
    await openAt(`/admin/facilities/${FACILITY_ID}`)
    const panel = (await screen.findByRole('heading', { name: 'Orders with other facilities' })).closest('section')!
    fireEvent.click(within(panel).getByRole('button', { name: 'Show orders with other facilities' }))
    expect(await within(panel).findByText(/accepted 3 orders from/)).toBeTruthy()
    await waitFor(() => expect(within(panel).queryByText(/Loading wrong-patient reports/)).toBeNull())
    expect(panel.textContent).not.toMatch(/Wrong-patient|not available/)
  })
})
