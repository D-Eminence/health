import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type * as BlueRoutes from '../../../../ehr-blue/routes'
import { REAL_FACILITY, SESSION, facility, json, openStaffApp, problem, serve, sessionAt, type Sent } from '../../frame/blueHarness'

/*
 * The waiting list (hid-system 0135, EHR-C7) inside the blue EHR's real frame, joined as departments/pages.ts joins it:
 * listed under Front desk for the roles the backend lets use it, reading and changing the list with the contract's
 * bodies and headers, and never a Health ID in an address. Every account, facility, patient and reference is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => {
  vi.doMock('../../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../../ehr-blue/frame/pages')
    const home = await import('../../../../ehr-blue/home/pages')
    const { waitingListPage } = await import('../../../../ehr-blue/departments/waiting/page')
    return {
      ...actual,
      BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home, './departments/pages.ts': { pages: [waitingListPage] } }),
    }
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const LIST = 'GET /api/v1/ehr/visit-queue'
const CHECK_IN = 'POST /api/v1/ehr/visit-queue/check-in'
const SEARCH = 'POST /api/v1/identity/patient-search'
const ENTRY = 'a0000000-0000-4000-8000-0000000000e1'
const PATCH = `PATCH /api/v1/ehr/visit-queue/${ENTRY}`
const FRONT_DESK = ['ehr.encounter.read', 'ehr.encounter.write', 'identity.registration.write', 'identity.patient.read']
const NURSE = ['ehr.encounter.read', 'ehr.encounter.write', 'ehr.note.write', 'identity.patient.read']
const MATCH_REF = `psr_${'A'.repeat(43)}`
const nav = () => screen.getByRole('navigation', { name: 'Main navigation' })
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

function card(overrides: Record<string, unknown> = {}) {
  return {
    entryId: ENTRY, patientId: 'b0000000-0000-4000-8000-0000000000f1', fullName: 'Testa Queueperson', sex: 'female',
    dateOfBirth: '1990-01-02', healthIdLast4: 'ZZ22', stage: 'waiting', triageLevel: null, assignedMembershipId: null,
    checkInBasis: 'search', checkedInAt: '2026-11-23T09:00:00.000Z', checkInDay: '2026-11-23',
    stageChangedAt: '2026-11-23T09:00:00.000Z', closedAt: null, rowVersion: 3, chartBlocked: false, ...overrides,
  }
}
const listOf = (...items: unknown[]) => () => json({ items, hasMore: false, limit: 200 })

/** No request carried a Health ID, a matchRef or a patient's name in its address. */
function noIdentityInAddresses() {
  for (const [url] of vi.mocked(fetch).mock.calls) expect(String(url)).not.toMatch(/HID-|psr_|Queueperson|healthId/i)
}

function directCare(sent: readonly Sent[], route: string) {
  const call = sent.find(item => item.route === route)!
  expect(call.headers.get('X-Purpose-Of-Use')).toBe('direct-care')
  expect(call.headers.get('X-Facility-ID')).toBe(REAL_FACILITY)
}

describe('Waiting list in the frame', () => {
  it('is listed under Front desk after In-person check’s group pages and shows the list in plain words', async () => {
    const desk = facility(REAL_FACILITY, 'Fictional Clinic', FRONT_DESK, ['receptionist'])
    const sent = serve({
      [SESSION]: [sessionAt(desk, [desk])],
      [LIST]: [listOf(card({ stage: 'triage', triageLevel: 2, chartBlocked: true }), card({ entryId: 'a0000000-0000-4000-8000-0000000000e2',
        fullName: 'Other Queueperson', stage: 'ready', assignedMembershipId: `member-${REAL_FACILITY}` }))],
    })
    await openStaffApp('/provider/waiting-list')
    expect(await screen.findByRole('heading', { level: 1, name: 'Waiting list' })).toBeDefined()
    const link = within(nav()).getByRole('link', { name: 'Waiting list' })
    expect(link.getAttribute('href')).toBe('/provider/waiting-list')
    const names = within(nav()).getAllByRole('link').map(item => item.textContent?.trim())
    expect(names.indexOf('Waiting list')).toBe(names.indexOf('Patients') + 2)
    expect(within(nav()).getByText('Front desk')).toBeDefined()

    const list = await screen.findByRole('list', { name: 'Patients waiting' })
    const first = within(list).getByRole('listitem', { name: 'Testa Queueperson' })
    expect(within(first).getByText('In triage')).toBeDefined()
    expect(within(first).getByText('Level 2: very urgent')).toBeDefined()
    expect(within(first).getByText('Chart cannot be opened')).toBeDefined()
    expect(within(first).getByLabelText('Health ID ending ZZ22').textContent).toBe('•••• ZZ22')
    expect(within(first).getByText('No one yet')).toBeDefined()
    const second = within(list).getByRole('listitem', { name: 'Other Queueperson' })
    expect(within(second).getByText('Ready to be seen')).toBeDefined()
    expect(within(second).getByText('You')).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Waiting now (2)' })).toBeDefined()
    expect(document.body.textContent).not.toMatch(/unverified|with_clinician|permission/i)
    directCare(sent, LIST)
    noIdentityInAddresses()
  })

  it('is not listed for lab staff, who hold encounter read only, and its address says who can use it without reading', async () => {
    const lab = facility(REAL_FACILITY, 'Fictional Clinic', ['ehr.encounter.read', 'lab.work-item.read', 'identity.patient.read'], ['lab_scientist'])
    const sent = serve({ [SESSION]: [sessionAt(lab, [lab])] })
    await openStaffApp('/provider/waiting-list')
    expect(await screen.findByText('Only the front desk, nurses, clinicians and doctors of this facility can use the waiting list.')).toBeDefined()
    expect(within(nav()).queryByRole('link', { name: 'Waiting list' })).toBeNull()
    await settle()
    expect(sent.filter(call => call.route.includes('visit-queue'))).toEqual([])
  })

  it('checks a patient in from a search card by its matchRef, with the Health ID only in the search body', async () => {
    const desk = facility(REAL_FACILITY, 'Fictional Clinic', FRONT_DESK, ['receptionist'])
    const sent = serve({
      [SESSION]: [sessionAt(desk, [desk])],
      [LIST]: [listOf(), listOf(card())],
      [SEARCH]: [() => json({ mode: 'standard', outcome: 'found', reach: 'here', message: null, patients: [{
        matchRef: MATCH_REF, matchRefExpiresAt: '2999-01-01T00:00:00.000Z', fullName: 'Testa Queueperson', sex: 'female',
        dateOfBirth: '1990-01-02', healthIdLast4: 'ZZ22', ninStatus: 'not_verified' }] })],
      [CHECK_IN]: [() => json({ outcome: 'checked_in', entry: card() })],
    })
    await openStaffApp('/provider/waiting-list')
    expect(await screen.findByText('No one is waiting')).toBeDefined()
    fireEvent.change(screen.getByRole('textbox', { name: 'Health ID' }), { target: { value: ' hid-zzzz22 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find patient' }))
    const found = await screen.findByRole('listitem', { name: 'Testa Queueperson' })
    expect(within(found).getByText('NIN Not Verified')).toBeDefined()
    expect(sent.find(call => call.route === SEARCH)!.body).toEqual({ healthId: 'HID-ZZZZ22' })
    directCare(sent, SEARCH)
    // The matchRef stays out of the page's markup.
    expect(document.body.innerHTML).not.toContain(MATCH_REF)

    fireEvent.click(within(found).getByRole('button', { name: 'Check in Testa Queueperson' }))
    expect(await screen.findByText('Testa Queueperson is checked in and waiting.')).toBeDefined()
    expect(sent.find(call => call.route === CHECK_IN)!.body).toEqual({ matchRef: MATCH_REF })
    directCare(sent, CHECK_IN)
    await waitFor(() => expect(sent.filter(call => call.route === LIST)).toHaveLength(2))
    expect(await screen.findByRole('list', { name: 'Patients waiting' })).toBeDefined()
    // What was typed and found is cleared once the patient is checked in.
    expect((screen.getByRole('textbox', { name: 'Health ID' }) as HTMLInputElement).value).toBe('')
    noIdentityInAddresses()
  })

  it('on CHECK_IN_NEEDS_SEARCH says so and goes back to the search box', async () => {
    const desk = facility(REAL_FACILITY, 'Fictional Clinic', FRONT_DESK, ['receptionist'])
    serve({
      [SESSION]: [sessionAt(desk, [desk])],
      [LIST]: [listOf()],
      [SEARCH]: [() => json({ mode: 'standard', outcome: 'found', reach: 'everywhere', message: null, patients: [{
        matchRef: MATCH_REF, matchRefExpiresAt: '2999-01-01T00:00:00.000Z', fullName: 'Testa Queueperson', sex: null,
        dateOfBirth: null, healthIdLast4: 'ZZ22', ninStatus: 'verified' }] })],
      [CHECK_IN]: [() => problem(403, 'CHECK_IN_NEEDS_SEARCH', 'Search for the patient first, then check them in.')],
    })
    await openStaffApp('/provider/waiting-list')
    fireEvent.change(await screen.findByRole('textbox', { name: 'First name' }), { target: { value: 'Testa' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Last name' }), { target: { value: 'Queueperson' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find patient' }))
    const found = await screen.findByRole('listitem', { name: 'Testa Queueperson' })
    expect(within(found).getByText('NIN Verified')).toBeDefined()
    fireEvent.click(within(found).getByRole('button', { name: 'Check in Testa Queueperson' }))
    expect(await screen.findByText('Search for the patient first, then check them in. A search result can be used for 10 minutes.')).toBeDefined()
    expect(screen.queryByRole('listitem', { name: 'Testa Queueperson' })).toBeNull()
    await waitFor(() => expect(document.activeElement?.id).toBe('waiting-search-first-name'))
  })

  it('moves a patient on with the row version the card showed, and reloads when someone else changed it first', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Clinic', NURSE, ['nurse'])
    const sent = serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      [LIST]: [listOf(card()), listOf(card({ stage: 'triage', rowVersion: 4 })), listOf(card({ stage: 'triage', rowVersion: 5 }))],
      [PATCH]: [
        () => json(card({ stage: 'triage', rowVersion: 4 })),
        () => problem(409, 'VISIT_QUEUE_ENTRY_CHANGED', 'Someone else changed this patient.'),
      ],
    })
    await openStaffApp('/provider/waiting-list')
    // A nurse does not search for patients here: the front desk checks them in.
    expect(await screen.findByText(/Ask the front desk to check the patient in/)).toBeDefined()
    const row = await screen.findByRole('listitem', { name: 'Testa Queueperson' })
    fireEvent.click(within(row).getByRole('button', { name: 'Start triage' }))
    expect(await screen.findByText('Testa Queueperson: in triage.')).toBeDefined()
    const patches = () => sent.filter(call => call.route === PATCH)
    expect(patches()[0]!.body).toEqual({ expectedRowVersion: 3, stage: 'triage' })
    directCare(sent, PATCH)

    // The nurse puts themselves down to see the patient and sets the triage level: only what changed is sent.
    const again = await screen.findByRole('listitem', { name: 'Testa Queueperson' })
    await waitFor(() => expect(within(again).getByText('In triage')).toBeDefined())
    fireEvent.click(within(again).getByRole('button', { name: 'Change' }))
    const form = within(again).getByRole('form', { name: 'Change Testa Queueperson' })
    fireEvent.change(within(form).getByRole('combobox', { name: /Triage level/ }), { target: { value: '1' } })
    fireEvent.change(within(form).getByRole('combobox', { name: 'Who will see them' }), { target: { value: 'mine' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Someone else changed this patient’s place on the waiting list. The list has been loaded again: check it and try again.')).toBeDefined()
    expect(patches()[1]!.body).toEqual({ expectedRowVersion: 4, triageLevel: 1, assignedMembershipId: `member-${REAL_FACILITY}` })
    await waitFor(() => expect(sent.filter(call => call.route === LIST)).toHaveLength(3))
    noIdentityInAddresses()
  })

  it('sends the row version the Change form opened with, so a change read in meanwhile is refused, not overwritten', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Clinic', NURSE, ['nurse'])
    const sent = serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      // Someone else sets triage level 3 while the form is open; the page reads it in (here by Refresh, as the poll would).
      [LIST]: [listOf(card()), listOf(card({ triageLevel: 3, rowVersion: 4 })), listOf(card({ triageLevel: 3, rowVersion: 4 }))],
      [PATCH]: [() => problem(409, 'VISIT_QUEUE_ENTRY_CHANGED', 'Someone else changed this patient.')],
    })
    await openStaffApp('/provider/waiting-list')
    const row = await screen.findByRole('listitem', { name: 'Testa Queueperson' })
    fireEvent.click(within(row).getByRole('button', { name: 'Change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(within(row).getByText('Level 3: urgent')).toBeDefined())
    const form = within(row).getByRole('form', { name: 'Change Testa Queueperson' })
    fireEvent.change(within(form).getByRole('combobox', { name: 'Who will see them' }), { target: { value: 'mine' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText(/Someone else changed this patient’s place on the waiting list/)).toBeDefined()
    // Only what the nurse changed, against the version the form showed: never triageLevel null over the new level 3.
    expect(sent.filter(call => call.route === PATCH)[0]!.body)
      .toEqual({ expectedRowVersion: 3, assignedMembershipId: `member-${REAL_FACILITY}` })
    await waitFor(() => expect(sent.filter(call => call.route === LIST)).toHaveLength(3))
    expect(within(row).queryByRole('form')).toBeNull()
  })

  it('says a refused or missing waiting list in plain words, never the guard’s own text', async () => {
    const desk = facility(REAL_FACILITY, 'Fictional Clinic', FRONT_DESK, ['receptionist'])
    serve({
      [SESSION]: [sessionAt(desk, [desk])],
      [LIST]: [() => problem(403, 'PERMISSION_DENIED', 'Required permission is missing'),
        () => problem(404, 'NOT_FOUND', 'Cannot GET /api/v1/ehr/visit-queue')],
    })
    await openStaffApp('/provider/waiting-list')
    expect(await screen.findByText('Only the front desk, nurses, clinicians and doctors of this facility can use the waiting list.')).toBeDefined()
    expect(document.body.textContent).not.toMatch(/permission/i)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('The waiting list is not available yet. Try again later.')).toBeDefined()
    expect(screen.queryByText('No one is waiting')).toBeNull()
  })

  it('shows the patients who finished or left today only from a list read with them, and an estimated birth date as one', async () => {
    const desk = facility(REAL_FACILITY, 'Fictional Clinic', FRONT_DESK, ['receptionist'])
    let answerClosed: (response: Response) => void = () => {}
    const sent = serve({
      [SESSION]: [sessionAt(desk, [desk])],
      [LIST]: [
        listOf(card({ fullName: 'Unknown patient U-0007', recordKind: 'unknown', dateOfBirth: '1980-01-01', dateOfBirthEstimated: true })),
        () => new Promise<Response>(resolve => { answerClosed = resolve }),
      ],
    })
    await openStaffApp('/provider/waiting-list')
    const row = await screen.findByRole('listitem', { name: 'Unknown patient U-0007' })
    expect(within(row).getByText(/Born about 1 Jan 1980 \(estimated\)/)).toBeDefined()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show patients who finished or left today' }))
    expect(await screen.findByText('Loading patients who finished or left today…')).toBeDefined()
    expect(screen.queryByRole('heading', { name: /Finished or left today/ })).toBeNull()
    await waitFor(() => expect(sent.filter(call => call.route === LIST)).toHaveLength(2))
    expect(new URL(String(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/visit-queue')).at(-1)![0]))
      .searchParams.get('includeClosedToday')).toBe('true')
    await act(async () => {
      answerClosed(json({ items: [card({ entryId: 'a0000000-0000-4000-8000-0000000000e3', fullName: 'Gone Queueperson',
        stage: 'left', closedAt: '2026-11-23T10:00:00.000Z' })], hasMore: false, limit: 200 }))
    })
    const closed = await screen.findByRole('list', { name: 'Patients who finished or left today' })
    expect(within(closed).getByText('Left before being seen')).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Finished or left today (1)' })).toBeDefined()
  })
})
