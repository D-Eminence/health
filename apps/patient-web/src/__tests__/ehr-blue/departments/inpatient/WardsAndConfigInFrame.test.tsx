import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { REAL_FACILITY, SESSION, facility, json, openStaffApp, problem, serve, sessionAt, where, type Sent } from '../../frame/blueHarness'
import {
  ADMIN, BED_1, BED_4, BED_9, BOARD, CENSUS, NURSE, WARDS, WARD_FEMALE, WARD_MALE, card, many, noIdentityInAddresses, waiting, ward,
  withInpatientPages,
} from './fixtures'

/*
 * Wards & Beds (the bed board and the census) and Ward configuration (hid-system ADT-1 routes 1-9) inside the blue EHR's
 * real frame, in place of Akos's samples: statuses in words, the three bed actions, counts only in the census, Lagos
 * days, and the admins' ward setup under healthcare operations. Fictional data only.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => { withInpatientPages() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const nav = () => screen.getByRole('navigation', { name: 'Main navigation' })
const sentTo = (sent: readonly Sent[], route: string) => sent.filter(call => call.route === route)
const purposeOf = (call: Sent) => call.headers.get('X-Purpose-Of-Use')

const wardList = () => json({ items: [ward(WARD_FEMALE, 'Female Medical Ward', { takes: 'female', available: 1 }),
  ward(WARD_MALE, 'Male Ward', { available: 0 }), ward('d0000000-0000-4000-8000-0000000000d9', 'Old Ward', { active: false })] })

function boardOf(wardId = WARD_FEMALE, name = 'Female Medical Ward') {
  return () => json({ wards: [{ wardId, name, wardType: 'general', takes: 'female', active: true, beds: [
    { bedId: BED_4, name: 'Bed 4', kind: 'bed', status: 'occupied', statusSince: '2026-12-01T23:30:00.000Z', rowVersion: 3,
      patient: card({ status: 'discharge_ready', dischargeReady: true }) },
    { bedId: BED_1, name: 'Bed 1', kind: 'bed', status: 'cleaning', statusSince: '2026-12-03T07:00:00.000Z', rowVersion: 7, patient: null },
    { bedId: BED_9, name: 'Extra mattress 1', kind: 'overflow', status: 'available', statusSince: null, rowVersion: 1, patient: null },
  ] }], waitingForBed: [waiting({ admissionId: 'a0000000-0000-4000-8000-0000000000a5', fullName: null, nameHidden: true, initials: 'K O' })] })
}

describe('Wards & Beds', () => {
  it('shows the first open ward’s beds with statuses in words, the patient and day of the stay, and who waits for a bed', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    const sent = serve({ [SESSION]: [sessionAt(nurse, [nurse])], [WARDS]: [wardList], [BOARD]: [boardOf()] })
    await openStaffApp('/provider/wards')
    expect(await screen.findByRole('heading', { level: 1, name: 'Wards & Beds' })).toBeDefined()
    expect(within(nav()).getByRole('link', { name: 'Wards & Beds' }).getAttribute('href')).toBe('/provider/wards')
    expect(screen.getByText('Do not show this list on a screen patients or visitors can see.')).toBeDefined()
    // Only open wards are offered.
    expect(within(await screen.findByRole('combobox', { name: 'Ward' })).getAllByRole('option').map(option => option.textContent))
      .toEqual(['Female Medical Ward (General): 1 free', 'Male Ward (General): 0 free'])
    const beds = await screen.findByRole('list', { name: 'Female Medical Ward: 1 of 3 beds occupied' })
    const occupied = within(beds).getByRole('listitem', { name: 'Bed 4' })
    expect(within(occupied).getByText('Occupied')).toBeDefined()
    expect(within(occupied).getByText('Discharge ready')).toBeDefined()
    expect(within(occupied).getByText('Day 3 of the stay')).toBeDefined()
    expect(within(occupied).getByText('Since 2 Dec 2026, 00:30')).toBeDefined()
    expect(within(occupied).getByRole('link', { name: 'Ada Wardone' })).toBeDefined()
    expect(within(occupied).queryByRole('button')).toBeNull()
    expect(within(beds).getByRole('listitem', { name: 'Extra mattress 1' }).textContent).toContain('Overflow space')
    expect(within(screen.getByRole('list', { name: 'Waiting for a bed (1)' })).getByRole('listitem', { name: 'K O' })).toBeDefined()
    const board = sentTo(sent, BOARD)[0]!
    expect(purposeOf(board)).toBe('direct-care')
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url)).find(url => url.includes('/bed-board'))).toContain(`wardId=${WARD_FEMALE}`)
    noIdentityInAddresses()
  })

  it('completes a bed turnover, and places a bed in maintenance only with a reason', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    const status = (id: string) => `POST /api/v1/ehr/beds/${id}/status`
    const sent = serve({
      [SESSION]: [sessionAt(nurse, [nurse])], [WARDS]: [wardList], [BOARD]: many(boardOf(), 4),
      [status(BED_1)]: [() => json({ bed: { bedId: BED_1, name: 'Bed 1', kind: 'bed', status: 'available', statusSince: null, rowVersion: 8 }, replayed: false })],
      [status(BED_9)]: [() => problem(409, 'BED_OCCUPIED', 'x'),
        () => json({ bed: { bedId: BED_9, name: 'Extra mattress 1', kind: 'overflow', status: 'maintenance', statusSince: null, rowVersion: 2 }, replayed: false })],
    })
    await openStaffApp('/provider/wards')
    const turnoverButton = await screen.findByRole('button', { name: 'Complete bed turnover: Bed 1' })
    turnoverButton.focus()
    fireEvent.click(turnoverButton)
    const done = await screen.findByText('Bed 1 is available again.')
    // The button pressed goes with the bed's new status: focus goes to the result, never to the top of the page.
    const doneNotice = done.closest('[role="status"]') as HTMLElement
    await waitFor(() => expect(document.activeElement).toBe(doneNotice))
    expect(doneNotice.getAttribute('tabindex')).toBe('-1')
    const turnover = sentTo(sent, status(BED_1))[0]!
    expect(turnover.body).toEqual({ expectedRowVersion: 7, status: 'available' })
    expect(purposeOf(turnover)).toBe('direct-care')
    expect(turnover.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)

    fireEvent.click(screen.getByRole('button', { name: 'Place in maintenance: Extra mattress 1' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Why is the bed out of use?' }), { target: { value: 'Torn' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Place in maintenance' }).at(-1)!)
    expect(await screen.findByText('Enter why the bed is out of use of at least 8 characters.')).toBeDefined()
    expect(sentTo(sent, status(BED_9))).toEqual([])
    fireEvent.change(screen.getByRole('textbox', { name: 'Why is the bed out of use?' }), { target: { value: 'Mattress torn, waiting for a new one' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Place in maintenance' }).at(-1)!)
    expect(await screen.findByText('A patient is in this bed. Move or discharge them first.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Place in maintenance: Extra mattress 1' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Why is the bed out of use?' }), { target: { value: 'Mattress torn, waiting for a new one' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Place in maintenance' }).at(-1)!)
    const maintained = await screen.findByText('Extra mattress 1 is under maintenance.')
    // The maintenance form closes on success: focus goes to what happened.
    await waitFor(() => expect(document.activeElement).toBe(maintained.closest('[role="status"]')))
    expect(sentTo(sent, status(BED_9)).at(-1)!.body).toEqual({ expectedRowVersion: 1, status: 'maintenance', note: 'Mattress torn, waiting for a new one' })
  })

  it('says when there are no wards yet, and that the routes are not switched on (503)', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    serve({ [SESSION]: [sessionAt(nurse, [nurse]), sessionAt(nurse, [nurse])], [WARDS]: [() => json({ items: [] }),
      ...many(() => problem(503, 'INPATIENT_NOT_AVAILABLE', 'x'))] })
    const view = await openStaffApp('/provider/wards')
    expect(await screen.findByText('This facility has no wards yet. An admin sets them up in Ward configuration.')).toBeDefined()
    view.unmount()
    await openStaffApp('/provider/wards')
    expect(await screen.findByText('Inpatient care is not switched on yet.')).toBeDefined()
  })

  it('shows the census for today or a Lagos day up to 90 days back, counts only', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    const counts = { beds: 64, occupied: 51, available: 9, cleaning: 3, maintenance: 1, overflowInUse: 2, admitted: 7, transfersIn: 3,
      transfersOut: 3, discharged: 6, died: 1, waitingForBed: 2, midnightCount: 50 }
    const censusOf = (date: string) => () => json({ date, facility: counts,
      wards: [{ wardId: WARD_FEMALE, name: 'Female Medical Ward', wardType: 'general', ...counts, beds: 20 }] })
    const sent = serve({ [SESSION]: [sessionAt(nurse, [nurse])], [WARDS]: [wardList], [BOARD]: [boardOf()],
      [CENSUS]: [censusOf('2026-11-25'), censusOf('2026-11-01')] })
    await openStaffApp('/provider/wards')
    fireEvent.click(await screen.findByRole('button', { name: 'Census' }))
    expect(where()).toBe('/provider/wards/census')
    const facilityCounts = await screen.findByRole('heading', { name: 'The facility on 25 Nov 2026' })
    expect(facilityCounts).toBeDefined()
    const totals = document.querySelector<HTMLElement>('dl[aria-labelledby="census-facility"]')!
    expect(within(totals).getByText('Under maintenance').nextSibling?.textContent).toBe('1')
    expect(screen.getByRole('row', { name: /Female Medical Ward/ }).textContent).toContain('20')
    // Today is asked for with no date.
    expect(sentTo(sent, CENSUS)).toHaveLength(1)
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url)).find(url => url.includes('/census'))).not.toContain('date=')
    const day = screen.getByLabelText('Day')
    fireEvent.change(day, { target: { value: '2026-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(await screen.findByText('Choose today or a day up to 90 days back.')).toBeDefined()
    fireEvent.change(day, { target: { value: '2026-11-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(await screen.findByRole('heading', { name: 'The facility on 1 Nov 2026' })).toBeDefined()
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url)).filter(url => url.includes('/census')).at(-1)).toContain('date=2026-11-01')
    expect(document.body.textContent).not.toContain('Ada Wardone')
  })
})

describe('Ward configuration', () => {
  const configured = () => json({ items: [
    { ...ward(WARD_FEMALE, 'Female Medical Ward', { takes: 'female' }), staffMembershipIds: ['m0000000-0000-4000-8000-000000000001'], beds: [
      { bedId: BED_4, name: 'Bed 4', kind: 'bed', status: 'occupied', active: true, rowVersion: 3 },
      { bedId: BED_1, name: 'Bed 1', kind: 'bed', status: 'available', active: true, rowVersion: 2 }] },
    { ...ward(WARD_MALE, 'Old ICU', { wardType: 'icu', active: false }), beds: [], staffMembershipIds: [] },
  ] })
  const staff = () => json({ facility: { id: REAL_FACILITY }, canInvite: true, limits: {}, inviteOptions: { roles: [], attestation: null },
    administratorLicence: null, administratorLicenceBodies: [], invitations: [], members: [
      { membershipId: 'm0000000-0000-4000-8000-000000000001', version: 1, accountId: 'a1', name: 'Nurse Bisi Fiction', email: 'b@example.test',
        roles: ['nurse'], isAdministrator: false, isSelf: false, joinedAt: null, licence: null },
      { membershipId: 'm0000000-0000-4000-8000-000000000002', version: 1, accountId: 'a2', name: 'Dr Femi Fiction', email: 'f@example.test',
        roles: ['doctor'], isAdministrator: false, isSelf: false, joinedAt: null, licence: null },
      { membershipId: 'm0000000-0000-4000-8000-000000000003', version: 1, accountId: 'a3', name: 'Cashier Tolu Fiction', email: 't@example.test',
        roles: ['cashier'], isAdministrator: false, isSelf: false, joinedAt: null, licence: null },
    ] })

  /** An admin at a facility that signed itself up: the only kind whose staff list Identity reads (the team's choices). */
  const selfServiceAdmin = () => ({ ...facility(REAL_FACILITY, 'Fictional Hospital', ADMIN, ['admin']),
    selfService: { review: 'reviewed', organizationType: 'hospital' } })
  const STAFF = 'GET /api/v1/identity/facility-staff'
  const notRetried = (status: number, code: string) => () => new Response(JSON.stringify({ type: 'about:blank', title: code, status, code,
    detail: 'x', retryable: false }), { status, headers: { 'Content-Type': 'application/problem+json' } })

  it('is the admins’ page: lists every ward with its beds under healthcare operations, and sets up a new one', async () => {
    const admin = facility(REAL_FACILITY, 'Fictional Hospital', ADMIN, ['admin'])
    const sent = serve({
      [SESSION]: [sessionAt(admin, [admin])], [WARDS]: many(configured, 4), ['GET /api/v1/identity/facility-staff']: [staff],
      ['POST /api/v1/ehr/wards']: [() => problem(409, 'WARD_NAME_TAKEN', 'x'), () => json({ ward: ward(WARD_MALE, 'ICU A'), replayed: false }, 201)],
    })
    await openStaffApp('/provider/ward-config')
    expect(await screen.findByRole('heading', { level: 1, name: 'Ward configuration' })).toBeDefined()
    expect(within(nav()).getByRole('link', { name: 'Ward configuration' })).toBeDefined()
    expect(within(nav()).queryByRole('link', { name: 'Inpatient / Wards' })).toBeNull()
    expect(await screen.findByRole('heading', { name: 'Female Medical Ward' })).toBeDefined()
    expect(screen.getByText('Closed')).toBeDefined()
    expect(screen.getByText('ICU')).toBeDefined()
    const list = sentTo(sent, WARDS)[0]!
    expect(purposeOf(list)).toBe('healthcare-operations')
    const url = vi.mocked(fetch).mock.calls.map(([address]) => String(address)).find(address => address.includes('/ehr/wards'))!
    expect(url).toContain('includeInactive=true')
    expect(url).toContain('includeBeds=true')

    fireEvent.click(screen.getByRole('button', { name: 'New ward' }))
    // Its own section: an h2 after the page's h1, as each ward's, never an h3 straight under the h1.
    expect(screen.getByRole('heading', { level: 2, name: 'New ward' })).toBeDefined()
    expect(screen.queryByRole('heading', { level: 3, name: 'New ward' })).toBeNull()
    expect(screen.getByRole('form', { name: 'New ward' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Set up ward' }))
    expect(await screen.findByText('Enter a ward name of at least 2 characters.')).toBeDefined()
    fireEvent.change(screen.getByRole('textbox', { name: 'Ward name' }), { target: { value: ' ICU A ' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Ward type' }), { target: { value: 'icu' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set up ward' }))
    expect(await screen.findByText('This name is already used. Choose another.')).toBeDefined()
    fireEvent.change(screen.getByRole('textbox', { name: 'Ward name' }), { target: { value: 'ICU B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set up ward' }))
    expect(await screen.findByText('ICU B is set up. Add its beds next.')).toBeDefined()
    const made = sentTo(sent, 'POST /api/v1/ehr/wards')
    expect(made.map(call => call.body)).toEqual([{ name: 'ICU A', wardType: 'icu', takes: 'any' }, { name: 'ICU B', wardType: 'icu', takes: 'any' }])
    expect(purposeOf(made[0]!)).toBe('healthcare-operations')
    expect(made[1]!.headers.get('Idempotency-Key')).not.toBe(made[0]!.headers.get('Idempotency-Key'))
  })

  it('adds a bed, takes one out of use (never deletes it), and saves the ward’s team of nurses, clinicians and doctors', async () => {
    const admin = selfServiceAdmin()
    const sent = serve({
      [SESSION]: [sessionAt(admin, [admin])], [WARDS]: many(configured, 6), ['GET /api/v1/identity/facility-staff']: [staff],
      [`POST /api/v1/ehr/wards/${WARD_FEMALE}/beds`]: [() => json({ bedId: BED_9, ward: ward(WARD_FEMALE, 'Female Medical Ward'), replayed: false }, 201)],
      [`PATCH /api/v1/ehr/beds/${BED_4}`]: [() => problem(409, 'BED_OCCUPIED', 'x')],
      [`PUT /api/v1/ehr/wards/${WARD_FEMALE}/staff`]: [() => json({ ward: ward(WARD_FEMALE, 'Female Medical Ward'), replayed: false })],
    })
    await openStaffApp('/provider/ward-config')
    const section = (await screen.findByRole('heading', { name: 'Female Medical Ward' })).closest('section')!
    fireEvent.click(within(section).getByRole('button', { name: 'Add bed' }))
    fireEvent.change(within(section).getByRole('textbox', { name: 'Bed name' }), { target: { value: 'Extra mattress 1' } })
    fireEvent.change(within(section).getByRole('combobox', { name: 'Kind' }), { target: { value: 'overflow' } })
    fireEvent.click(within(section).getAllByRole('button', { name: 'Add bed' }).at(-1)!)
    expect(await screen.findByText('Extra mattress 1 is added to Female Medical Ward.')).toBeDefined()
    expect(sentTo(sent, `POST /api/v1/ehr/wards/${WARD_FEMALE}/beds`)[0]!.body).toEqual({ name: 'Extra mattress 1', kind: 'overflow' })

    fireEvent.click(within(section).getByRole('button', { name: 'Take out of use: Bed 4' }))
    expect(await screen.findByText('A patient is in this bed. Move or discharge them first.')).toBeDefined()
    expect(sentTo(sent, `PATCH /api/v1/ehr/beds/${BED_4}`)[0]!.body).toEqual({ expectedRowVersion: 3, active: false })
    expect(sent.some(call => call.route.startsWith('DELETE'))).toBe(false)

    fireEvent.click(within(section).getByRole('button', { name: 'Ward team' }))
    // Only nurses, clinicians and doctors are offered; the cashier is not.
    expect(await within(section).findByRole('checkbox', { name: 'Nurse Bisi Fiction' })).toHaveProperty('checked', true)
    expect(within(section).queryByRole('checkbox', { name: 'Cashier Tolu Fiction' })).toBeNull()
    fireEvent.click(within(section).getByRole('checkbox', { name: 'Dr Femi Fiction' }))
    fireEvent.click(within(section).getByRole('button', { name: 'Save team' }))
    expect(await screen.findByText('Female Medical Ward’s team is saved.')).toBeDefined()
    const team = sentTo(sent, `PUT /api/v1/ehr/wards/${WARD_FEMALE}/staff`)[0]!
    expect(team.body).toEqual({ expectedRowVersion: 4, membershipIds: ['m0000000-0000-4000-8000-000000000001', 'm0000000-0000-4000-8000-000000000002'] })
    expect(purposeOf(team)).toBe('healthcare-operations')
  })

  it('drops team members who no longer hold a ward role (or left), says who, and saves the rest', async () => {
    const admin = selfServiceAdmin()
    // Tolu's role is now a cashier's (no longer a ward role); ...0009's membership ended (the staff list no longer has them).
    const stale = () => json({ items: [
      { ...ward(WARD_FEMALE, 'Female Medical Ward', { takes: 'female' }), beds: [], staffMembershipIds: [
        'm0000000-0000-4000-8000-000000000002', 'M0000000-0000-4000-8000-000000000003', 'm0000000-0000-4000-8000-000000000009'] },
    ] })
    const sent = serve({
      [SESSION]: [sessionAt(admin, [admin])], [WARDS]: many(stale, 4), ['GET /api/v1/identity/facility-staff']: [staff],
      [`PUT /api/v1/ehr/wards/${WARD_FEMALE}/staff`]: [() => json({ ward: ward(WARD_FEMALE, 'Female Medical Ward'), replayed: false })],
    })
    await openStaffApp('/provider/ward-config')
    const section = (await screen.findByRole('heading', { name: 'Female Medical Ward' })).closest('section')!
    fireEvent.click(within(section).getByRole('button', { name: 'Ward team' }))
    expect(await within(section).findByRole('checkbox', { name: 'Dr Femi Fiction' })).toHaveProperty('checked', true)
    expect(within(section).getByRole('checkbox', { name: 'Nurse Bisi Fiction' })).toHaveProperty('checked', false)
    expect(within(section).getByText('Cashier Tolu Fiction and 1 former staff member no longer work here as nurses, clinicians or doctors. Saving the team takes them off it.')).toBeDefined()
    fireEvent.click(within(section).getByRole('button', { name: 'Save team' }))
    expect(await screen.findByText('Female Medical Ward’s team is saved.')).toBeDefined()
    // Only those the backend takes (WARD_STAFF_INVALID otherwise, for the whole list).
    expect(sentTo(sent, `PUT /api/v1/ehr/wards/${WARD_FEMALE}/staff`)[0]!.body).toEqual({ expectedRowVersion: 4,
      membershipIds: ['m0000000-0000-4000-8000-000000000002'] })
    expect(document.body.textContent).not.toContain('m0000000-0000-4000-8000-000000000009')
  })

  it('cannot change a team while the staff list cannot be read, so no one is dropped by mistake', async () => {
    const admin = selfServiceAdmin()
    const sent = serve({
      [SESSION]: [sessionAt(admin, [admin])], [WARDS]: many(configured, 4),
      // Not retried by the client: the page itself must offer the read again.
      [STAFF]: [notRetried(503, 'UPSTREAM_UNAVAILABLE'), staff],
    })
    await openStaffApp('/provider/ward-config')
    const section = (await screen.findByRole('heading', { name: 'Female Medical Ward' })).closest('section')!
    fireEvent.click(within(section).getByRole('button', { name: 'Ward team' }))
    expect(await within(section).findByText('The staff list could not be loaded, so the team cannot be changed now. Select Refresh to try again.')).toBeDefined()
    expect(within(section).getByRole('button', { name: 'Save team' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await within(section).findByRole('checkbox', { name: 'Nurse Bisi Fiction' })).toHaveProperty('checked', true)
    expect(within(section).getByRole('button', { name: 'Save team' })).toHaveProperty('disabled', false)
    expect(sent.filter(call => call.route.startsWith('PUT'))).toEqual([])
  })

  it('adds a bed again under a name used before as a new request, with a key of its own', async () => {
    const admin = facility(REAL_FACILITY, 'Fictional Hospital', ADMIN, ['admin'])
    const beds = `POST /api/v1/ehr/wards/${WARD_FEMALE}/beds`
    const sent = serve({
      [SESSION]: [sessionAt(admin, [admin])], [WARDS]: many(configured, 6), ['GET /api/v1/identity/facility-staff']: [staff],
      [beds]: [() => json({ bedId: BED_9, ward: ward(WARD_FEMALE, 'Female Medical Ward'), replayed: false }, 201),
        () => json({ bedId: 'c0000000-0000-4000-8000-0000000000c8', ward: ward(WARD_FEMALE, 'Female Medical Ward'), replayed: false }, 201)],
    })
    await openStaffApp('/provider/ward-config')
    const section = (await screen.findByRole('heading', { name: 'Female Medical Ward' })).closest('section')!
    for (let round = 0; round < 2; round += 1) {
      fireEvent.click(within(section).getByRole('button', { name: 'Add bed' }))
      fireEvent.change(within(section).getByRole('textbox', { name: 'Bed name' }), { target: { value: 'Bed 7' } })
      fireEvent.click(within(section).getAllByRole('button', { name: 'Add bed' }).at(-1)!)
      await waitFor(() => expect(sentTo(sent, beds)).toHaveLength(round + 1))
      expect(await screen.findByText('Bed 7 is added to Female Medical Ward.')).toBeDefined()
      await waitFor(() => expect(within(section).queryByRole('textbox', { name: 'Bed name' })).toBeNull())
    }
    // Same body, but the first was answered: the second is a new bed (renamed or taken out of use in between), not a replay.
    const [first, second] = sentTo(sent, beds)
    expect(second!.body).toEqual(first!.body)
    expect(second!.headers.get('Idempotency-Key')).not.toBe(first!.headers.get('Idempotency-Key'))
  })

  it('closes a ward only when empty, and says so in plain words', async () => {
    const admin = facility(REAL_FACILITY, 'Fictional Hospital', ADMIN, ['admin'])
    const sent = serve({
      [SESSION]: [sessionAt(admin, [admin])], [WARDS]: many(configured, 4), ['GET /api/v1/identity/facility-staff']: [staff],
      [`PATCH /api/v1/ehr/wards/${WARD_FEMALE}`]: [() => problem(409, 'WARD_NOT_EMPTY', 'x')],
    })
    await openStaffApp('/provider/ward-config')
    const section = (await screen.findByRole('heading', { name: 'Female Medical Ward' })).closest('section')!
    fireEvent.click(within(section).getByRole('button', { name: 'Close ward' }))
    expect(await screen.findByText('Move every patient out of this ward first.')).toBeDefined()
    expect(sentTo(sent, `PATCH /api/v1/ehr/wards/${WARD_FEMALE}`)[0]!.body).toEqual({ expectedRowVersion: 4, active: false })
    await waitFor(() => expect(sentTo(sent, WARDS).length).toBeGreaterThan(1))
    expect(document.body.textContent).not.toMatch(/permission/i)
  })

  it('says Health ID support manages the staff where the facility did not sign itself up, without reading it or offering Refresh', async () => {
    // A governed facility (no self sign-up): Identity refuses its staff list (403 STAFF_MANAGEMENT_NOT_AVAILABLE).
    const admin = facility(REAL_FACILITY, 'Fictional Hospital', ADMIN, ['admin'])
    const sent = serve({ [SESSION]: [sessionAt(admin, [admin])], [WARDS]: many(configured, 4), [STAFF]: [staff] })
    await openStaffApp('/provider/ward-config')
    const section = (await screen.findByRole('heading', { name: 'Female Medical Ward' })).closest('section')!
    fireEvent.click(within(section).getByRole('button', { name: 'Ward team' }))
    expect(within(section).getByText('Health ID support manages who works at Fictional Hospital, so a ward’s team cannot be set here yet.')).toBeDefined()
    expect(within(section).queryByRole('button', { name: 'Save team' })).toBeNull()
    expect(within(section).queryByRole('checkbox')).toBeNull()
    expect(document.body.textContent).not.toContain('Select Refresh')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(sentTo(sent, WARDS).length).toBeGreaterThan(1))
    expect(sentTo(sent, STAFF)).toEqual([])
    fireEvent.click(within(section).getByRole('button', { name: 'Close' }))
    expect(within(section).queryByText(/Health ID support manages/)).toBeNull()
  })

  it('takes the staff list’s own refusal as final too: support manages the staff, so Refresh does not read it again', async () => {
    const admin = selfServiceAdmin()
    const sent = serve({ [SESSION]: [sessionAt(admin, [admin])], [WARDS]: many(configured, 4),
      [STAFF]: [() => problem(403, 'STAFF_MANAGEMENT_NOT_AVAILABLE', 'x'), staff] })
    await openStaffApp('/provider/ward-config')
    const section = (await screen.findByRole('heading', { name: 'Female Medical Ward' })).closest('section')!
    fireEvent.click(within(section).getByRole('button', { name: 'Ward team' }))
    expect(await within(section).findByText('Health ID support manages who works at Fictional Hospital, so a ward’s team cannot be set here yet.')).toBeDefined()
    expect(within(section).queryByRole('button', { name: 'Save team' })).toBeNull()
    expect(document.body.textContent).not.toContain('Select Refresh')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(sentTo(sent, WARDS).length).toBeGreaterThan(1))
    expect(sentTo(sent, STAFF)).toHaveLength(1)
    expect(document.body.textContent).not.toMatch(/permission/i)
  })

  it('saves a team with the version its form was opened from: a change read since is refused, the form closes, and opens again from it', async () => {
    const admin = selfServiceAdmin()
    const BISI = 'm0000000-0000-4000-8000-000000000001'
    const FEMI = 'm0000000-0000-4000-8000-000000000002'
    const teamAt = (rowVersion: number, staffMembershipIds: string[]) => () => json({ items: [
      { ...ward(WARD_FEMALE, 'Female Medical Ward', { takes: 'female', rowVersion }), beds: [], staffMembershipIds }] })
    const team = `PUT /api/v1/ehr/wards/${WARD_FEMALE}/staff`
    const sent = serve({
      // Read with Bisi on the team (version 4); then another admin took her off (version 5).
      [SESSION]: [sessionAt(admin, [admin])], [WARDS]: [teamAt(4, [BISI]), ...many(teamAt(5, []), 4)], [STAFF]: [staff],
      [team]: [() => problem(412, 'WARD_VERSION_CONFLICT', 'x'), () => json({ ward: ward(WARD_FEMALE, 'Female Medical Ward', { rowVersion: 6 }), replayed: false })],
    })
    await openStaffApp('/provider/ward-config')
    const section = (await screen.findByRole('heading', { name: 'Female Medical Ward' })).closest('section')!
    fireEvent.click(within(section).getByRole('button', { name: 'Ward team' }))
    expect(await within(section).findByRole('checkbox', { name: 'Nurse Bisi Fiction' })).toHaveProperty('checked', true)
    // The list is read again while the form is open: the form still shows what it was opened from.
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(sentTo(sent, WARDS)).toHaveLength(2))
    fireEvent.click(within(section).getByRole('checkbox', { name: 'Dr Femi Fiction' }))
    fireEvent.click(within(section).getByRole('button', { name: 'Save team' }))
    expect(await screen.findByText('Someone else changed this. Reload it and try again.')).toBeDefined()
    // Sent with version 4, so the other admin's change is refused rather than overwritten with Bisi put back.
    expect(sentTo(sent, team)[0]!.body).toEqual({ expectedRowVersion: 4, membershipIds: [BISI, FEMI] })
    await waitFor(() => expect(within(section).queryByRole('button', { name: 'Save team' })).toBeNull())
    expect(sentTo(sent, WARDS)).toHaveLength(3)

    fireEvent.click(within(section).getByRole('button', { name: 'Ward team' }))
    expect(within(section).getByRole('checkbox', { name: 'Nurse Bisi Fiction' })).toHaveProperty('checked', false)
    fireEvent.click(within(section).getByRole('checkbox', { name: 'Dr Femi Fiction' }))
    fireEvent.click(within(section).getByRole('button', { name: 'Save team' }))
    expect(await screen.findByText('Female Medical Ward’s team is saved.')).toBeDefined()
    expect(sentTo(sent, team)[1]!.body).toEqual({ expectedRowVersion: 5, membershipIds: [FEMI] })
  })

  it('changes a ward or renames a bed with the version its form was opened from, and closes the form when that changed', async () => {
    const admin = facility(REAL_FACILITY, 'Fictional Hospital', ADMIN, ['admin'])
    const wardAt = (rowVersion: number, takes: string, bedName: string, bedVersion: number) => () => json({ items: [
      { ...ward(WARD_FEMALE, 'Female Medical Ward', { takes, rowVersion }), staffMembershipIds: [],
        beds: [{ bedId: BED_1, name: bedName, kind: 'bed', status: 'available', active: true, rowVersion: bedVersion }] }] })
    const sent = serve({
      // Another admin made the ward take anyone (version 5) and renamed Bed 1 (version 3) while these forms were open.
      [SESSION]: [sessionAt(admin, [admin])], [WARDS]: [wardAt(4, 'female', 'Bed 1', 2), ...many(wardAt(5, 'any', 'Bed 1B', 3), 4)],
      [`PATCH /api/v1/ehr/wards/${WARD_FEMALE}`]: [() => problem(412, 'WARD_VERSION_CONFLICT', 'x')],
      [`PATCH /api/v1/ehr/beds/${BED_1}`]: [() => problem(412, 'WARD_VERSION_CONFLICT', 'x')],
    })
    await openStaffApp('/provider/ward-config')
    const section = (await screen.findByRole('heading', { name: 'Female Medical Ward' })).closest('section')!
    fireEvent.click(within(section).getByRole('button', { name: 'Change ward' }))
    fireEvent.click(within(section).getByRole('button', { name: 'Rename Bed 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await within(section).findByRole('heading', { name: 'Bed 1B' })).toBeDefined()

    fireEvent.change(within(section).getByRole('textbox', { name: 'Ward name' }), { target: { value: 'Women’s Medical Ward' } })
    fireEvent.click(within(section).getByRole('button', { name: 'Save ward' }))
    expect(await screen.findByText('Someone else changed this. Reload it and try again.')).toBeDefined()
    // Only the name, which this admin changed, and version 4: not "takes: female" again under version 5.
    expect(sentTo(sent, `PATCH /api/v1/ehr/wards/${WARD_FEMALE}`)[0]!.body).toEqual({ expectedRowVersion: 4, name: 'Women’s Medical Ward' })
    await waitFor(() => expect(within(section).queryByRole('button', { name: 'Save ward' })).toBeNull())

    fireEvent.change(within(section).getByRole('textbox', { name: 'New name' }), { target: { value: 'Bed 1A' } })
    fireEvent.click(within(section).getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(sentTo(sent, `PATCH /api/v1/ehr/beds/${BED_1}`)).toHaveLength(1))
    expect(sentTo(sent, `PATCH /api/v1/ehr/beds/${BED_1}`)[0]!.body).toEqual({ expectedRowVersion: 2, name: 'Bed 1A' })
    await waitFor(() => expect(within(section).queryByRole('button', { name: 'Save name' })).toBeNull())
    // Opened again, the rename starts from the name as it is now.
    fireEvent.click(within(section).getByRole('button', { name: 'Rename Bed 1B' }))
    expect(within(section).getByRole('textbox', { name: 'New name' })).toHaveProperty('value', 'Bed 1B')
  })

  it('tells a nurse only the facility’s admins set up wards, without reading', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    const sent = serve({ [SESSION]: [sessionAt(nurse, [nurse])] })
    await openStaffApp('/provider/ward-config')
    expect(await screen.findByText('Only the facility’s admins can set up wards and beds.')).toBeDefined()
    expect(within(nav()).queryByRole('link', { name: 'Ward configuration' })).toBeNull()
    expect(sent.filter(call => call.route.includes('/ehr/'))).toEqual([])
  })
})
