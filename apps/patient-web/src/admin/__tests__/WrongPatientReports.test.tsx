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
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn’t load this.*Wrong-patient reports are not available from this Identity yet\./)
  })
})

describe('wrong-patient reports elsewhere in the console', () => {
  it('counts the reports to review on the Overview, linked to the list', async () => {
    const calls = serve(READER)
    await openAt('/admin/overview')
    const attention = await screen.findByRole('region', { name: 'Waiting for attention' })
    const row = await within(attention).findByRole('link', { name: /^Wrong-patient reports/ })
    expect(row.textContent).toContain('2 to review')
    expect(row.getAttribute('href')).toBe('/admin/wrong-patient-reports')
    expect(lists(calls)).toEqual(['?status=unreviewed'])
  })

  it('shows no tile where the backend has no such list (404)', async () => {
    const calls = serve(READER, { 'GET /api/v1/admin/wrong-patient-reports': missing })
    await openAt('/admin/overview')
    await screen.findByRole('heading', { name: 'Overview' })
    await waitFor(() => expect(lists(calls)).toHaveLength(1))
    await waitFor(() => expect(screen.queryByText(/\d+ to review/)).toBeNull())
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading waiting work' })).toBeNull())
    expect(screen.queryByRole('region', { name: 'Waiting for attention' })?.textContent ?? '').not.toMatch(/Wrong-patient/)
    expect(document.body.textContent).not.toMatch(/not available from this Identity/)
    // Nor is the page listed in the navigation any more (D15: dormant until the backend serves it).
    await waitFor(() => expect(screen.queryAllByRole('link', { name: 'Wrong-patient reports' })).toHaveLength(0))
    expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Overview' })).toBeTruthy()
  })

  it('keeps the page listed in the navigation where the backend serves the list', async () => {
    serve(READER)
    await openAt('/admin/overview')
    const attention = await screen.findByRole('region', { name: 'Waiting for attention' })
    await within(attention).findByText(/to review/)
    // The navigation (one for every screen width) lists it.
    const navigation = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(navigation).getByRole('link', { name: 'Wrong-patient reports' })).toBeTruthy()
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

/**
 * D17 (hid-system 0090; SPEC-FINAL §9.4, owner decision D17-6): late reports in support's list. A page opened at the list
 * learns from C26's `lateCorrection: true` that the late correction is served, and says so; a late row says how the order
 * had ended, how and when the facility found out, the reporter's late reports and whether the sender is still active; the
 * review form requires what Identity says a late report requires, and says Identity's refusal in words.
 */
describe('late reports (D17)', () => {
  const late = (overrides: Record<string, unknown> = {}) => report({ late: true, endedKindBefore: 'support', discoveredBy: 'patient',
    discoveredOn: '2026-10-20', reporterLateReportsLast30Days: 2, orderingSenderActive: false,
    requiredActions: ['referred_to_dpo', 'ordering_facility_told'],
    flags: ['late_correction', 'something_came_back', 'patient_prompted', 'patient_reported_before'], ...overrides })
  const listing = (items: unknown[], fields: Record<string, unknown> = { lateCorrection: true }) =>
    ({ 'GET /api/v1/admin/wrong-patient-reports': () => json({ items, ...fields }) })

  it('says it serves late reports, from the list’s answer, with the case note naming the 180 days', async () => {
    serve(READER, listing([late()]))
    await openAt('/admin/wrong-patient-reports')
    await screen.findByText('9C1B2D3E')
    expect(await screen.findByText('Orders a laboratory or pharmacy accepted for someone who was not the patient, and ended, or '
      + 'reported after the order had ended.')).toBeTruthy()
    expect(screen.getByText(/^A laboratory or pharmacy reports an order it accepted for someone who was not the order’s patient\. While it may still work on the order, it ends it; after the order has ended, it can still withdraw what it recorded\./)).toBeTruthy()
    expect(screen.getByText(/^A report made after the order had ended is flagged “Reported after the order had ended”\./)).toBeTruthy()
    expect(screen.getByText(/It can use “Correct an order that has ended” on its Laboratory or Pharmacy page until 180 days after it accepted the order; Find shows the date\./)).toBeTruthy()
    expect(screen.queryByText(/^If a patient or clinician tells you a result or dispensing went to the wrong person and the facility can no longer end the order/)).toBeNull()
  })

  it('says a late row’s flags, earlier ending, how and when it was found out, the reporter’s count and the sender', async () => {
    serve(READER, listing([late(), late({ reportId: 'aa000000-0000-4000-8000-000000000003', reference: '5E6F7A8B',
      endedKindBefore: null, discoveredBy: 'own_check', orderingSenderActive: true, flags: ['late_correction'] })]))
    await openAt('/admin/wrong-patient-reports')
    const row = (await screen.findByText('9C1B2D3E')).closest('tr')!
    for (const words of ['Reported after the order had ended', 'A result or dispensing had come back',
      'Reported late, prompted by the patient or someone else, and something had come back',
      'Another report about the same patient in the last 90 days']) expect(within(row).getByText(words)).toBeTruthy()
    expect(within(row).getByText(/^Ended before the report: closed by support\. Found out on 20 Oct 2026: the patient told them\. 2 result versions marked/)).toBeTruthy()
    expect(within(row).getByText('The reporter made 2 late reports in 30 days.')).toBeTruthy()
    expect(within(row).getByText('The clinician who sent the order is no longer active at General Hospital: ask for the clinician now '
      + 'responsible.')).toBeTruthy()
    const lapsed = screen.getByText('5E6F7A8B').closest('tr')!
    expect(within(lapsed).getByText(/^Its time for work had run out\. Found out on 20 Oct 2026: they found it themselves\./)).toBeTruthy()
    expect(within(lapsed).queryByText(/no longer active/)).toBeNull()
  })

  it('requires the referral and the call for a late report where something came back, not “No further action” (D17-6)', async () => {
    const calls = serve(REVIEWER, listing([late()]))
    await openAt('/admin/wrong-patient-reports')
    const row = (await screen.findByText('9C1B2D3E')).closest('tr')!
    fireEvent.click(within(row).getByText('Mark reviewed', { selector: 'summary' }))
    expect(within(row).getByText('A late report where something had come back, or a “pretending” one, needs: Referred to the data '
      + 'protection officer and Ordering facility told.')).toBeTruthy()
    expect((within(row).getByRole('checkbox', { name: 'No further action' }) as HTMLInputElement).disabled).toBe(true)
    const submit = within(row).getByRole('button', { name: 'Mark reviewed' }) as HTMLButtonElement
    fireEvent.click(within(row).getByRole('checkbox', { name: 'Referred to the data protection officer (required)' }))
    fireEvent.change(within(row).getByLabelText('Review note'), { target: { value: 'Referred to the DPO the same day' } })
    fireEvent.click(within(row).getByRole('checkbox', { name: 'I have reviewed this report.' }))
    expect(submit.disabled).toBe(true)
    fireEvent.click(within(row).getByRole('checkbox', { name: 'Ordering facility told (required)' }))
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    expect(await screen.findByText('Report on order 9C1B2D3E marked reviewed.')).toBeTruthy()
    expect(calls.find(call => call.path.endsWith('/review'))?.body).toMatchObject({ actions: ['referred_to_dpo', 'ordering_facility_told'] })
  })

  it('says Identity’s referral refusal in words, naming what is missing', async () => {
    serve(REVIEWER, { ...listing([late({ requiredActions: ['ordering_facility_told'] })]),
      [`POST /api/v1/admin/wrong-patient-reports/${REPORT_ID}/review`]: () => json({ status: 400,
        code: 'WRONG_PATIENT_REVIEW_REFERRAL_REQUIRED', detail: 'Referral required', required: 'referred_to_dpo' }, 400) })
    await openAt('/admin/wrong-patient-reports')
    const row = (await screen.findByText('9C1B2D3E')).closest('tr')!
    fireEvent.click(within(row).getByText('Mark reviewed', { selector: 'summary' }))
    fireEvent.click(within(row).getByRole('checkbox', { name: 'Ordering facility told (required)' }))
    fireEvent.change(within(row).getByLabelText('Review note'), { target: { value: 'Phoned General Hospital' } })
    fireEvent.click(within(row).getByRole('checkbox', { name: 'I have reviewed this report.' }))
    fireEvent.click(within(row).getByRole('button', { name: 'Mark reviewed' }))
    expect((await within(row).findByRole('alert')).textContent).toBe('Tick Referred to the data protection officer before you mark it reviewed.')
  })

  it('keeps item 3’s words and form against today’s Identity, without lateCorrection or the new fields', async () => {
    serve(REVIEWER, listing([report()], {}))
    await openAt('/admin/wrong-patient-reports')
    const row = (await screen.findByText('9C1B2D3E')).closest('tr')!
    expect(screen.getByText('Orders a laboratory or pharmacy accepted for someone who was not the patient, and ended.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Reported after the order had ended|Correct an order that has ended|180 days|late report/)
    fireEvent.click(within(row).getByText('Mark reviewed', { selector: 'summary' }))
    expect((within(row).getByRole('checkbox', { name: 'No further action' }) as HTMLInputElement).disabled).toBe(false)
    expect(within(row).queryByText(/needs:/)).toBeNull()
  })
})

/**
 * D18-12 (hid-system 0091; SPEC-FINAL §9.4): a wrong-patient report made after "We can't complete this order". Identity
 * flags it as any late report (and sorts it first); the row says the order had ended because the facility couldn't
 * complete it, after confirming it was the order's patient: the facility said both.
 */
describe('a report after the facility said it couldn’t complete the order (D18-12)', () => {
  it('says the earlier ending and that the facility had confirmed it was the order’s patient', async () => {
    serve(READER, { 'GET /api/v1/admin/wrong-patient-reports': () => json({ items: [report({ late: true,
      endedKindBefore: 'receiving_unable', stateBefore: 'cancelled', discoveredBy: 'own_check', discoveredOn: '2026-10-20',
      resultsVoided: 0, resultReportsMarked: 0, specimensCollected: 0, requiredActions: [], flags: ['late_correction'] })],
    lateCorrection: true }) })
    await openAt('/admin/wrong-patient-reports')
    const row = (await screen.findByText('9C1B2D3E')).closest('tr')!
    expect(within(row).getByText('Reported after the order had ended')).toBeTruthy()
    expect(within(row).getByText(/^Ended before the report: the receiving facility couldn’t complete it, after confirming it was the order’s patient\. Found out on 20 Oct 2026: they found it themselves\. Nothing had come back to the ordering facility\./)).toBeTruthy()
  })
})
