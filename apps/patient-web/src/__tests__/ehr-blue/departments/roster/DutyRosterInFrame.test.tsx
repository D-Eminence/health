import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type * as BlueRoutes from '../../../../ehr-blue/routes'
import {
  DEMO_HOSPITAL, REAL_FACILITY, SESSION, facility, json, openStaffApp, problem, serve, sessionAt, where, type Sent,
} from '../../frame/blueHarness'
import { addDays, forgetDutyRosterServed, thisWeek } from '../../../../ehr-blue/departments/roster/rosterRules'

/*
 * The Duty roster (hid-system ROS-1, 0200-0202) inside the blue EHR's real frame, joined as departments/pages.ts joins
 * it beside the Shifts & Roster sample: the week's rosters, one roster's duties saved all at once and published,
 * attendance, leave and its decisions, own duties and the in-charges, with the contract's bodies and headers, every day
 * and time in Lagos while the device is set to New York, never a Health ID in an address, and never the word
 * "permission" on screen. Switched off (404 or 503), the page says so and leaves the sidebar, and the sample stays where
 * it was. Every account, facility and person is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeAll(() => { process.env.TZ = 'America/New_York' })
beforeEach(() => {
  vi.doMock('../../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../../ehr-blue/frame/pages')
    const home = await import('../../../../ehr-blue/home/pages')
    const { dutyRosterPage } = await import('../../../../ehr-blue/departments/roster/page')
    const { samplePages } = await import('../../../../ehr-blue/departments/sample/pages')
    return {
      ...actual,
      BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home,
        './departments/pages.ts': { pages: [dutyRosterPage, ...samplePages] } }),
    }
  })
})
afterEach(() => { forgetDutyRosterServed(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const ROSTER = 'd0000000-0000-4000-8000-0000000000d1'
const ADA = 'a0000000-0000-4000-8000-0000000000a1'
const BOLA = 'b0000000-0000-4000-8000-0000000000b2'
const ME = `member-${REAL_FACILITY}`
const MORNING = 'e0000000-0000-4000-8000-0000000000e1'
const NIGHT = 'e0000000-0000-4000-8000-0000000000e2'
const LEAVE = 'f0000000-0000-4000-8000-0000000000f1'
const OWN_LEAVE = 'f0000000-0000-4000-8000-0000000000f2'
const IN_CHARGE = 'c0000000-0000-4000-8000-0000000000c1'

const ROSTERS = 'GET /api/v1/identity/duty-rosters'
const CREATE = 'POST /api/v1/identity/duty-rosters'
const READ = `GET /api/v1/identity/duty-rosters/${ROSTER}`
const SAVE = `PUT /api/v1/identity/duty-rosters/${ROSTER}/assignments`
const PUBLISH = `POST /api/v1/identity/duty-rosters/${ROSTER}/publish`
const NAMES = 'GET /api/v1/identity/facility-staff-names'
const IN_CHARGES = 'GET /api/v1/identity/duty-roster/in-charges'
const ADD_IN_CHARGE = 'POST /api/v1/identity/duty-roster/in-charges'
const END_IN_CHARGE = `POST /api/v1/identity/duty-roster/in-charges/${IN_CHARGE}/end`
const MY_LEAVE = 'GET /api/v1/identity/me/leave-requests'
const ASK = 'POST /api/v1/identity/me/leave-requests'
const CANCEL = `POST /api/v1/identity/me/leave-requests/${OWN_LEAVE}/cancel`
const TO_DECIDE = 'GET /api/v1/identity/leave-requests'
const APPROVE = `POST /api/v1/identity/leave-requests/${LEAVE}/approve`
const DECLINE = `POST /api/v1/identity/leave-requests/${LEAVE}/decline`
const MY_DUTIES = 'GET /api/v1/identity/me/duties'
const ON_DUTY = 'GET /api/v1/identity/duty-roster/on-duty'

const STAFF_CODES = ['workforce.roster.read', 'workforce.leave.request']
const ADMIN_CODES = ['workforce.roster.read', 'workforce.roster.manage', 'workforce.leave.request', 'workforce.manage']
const nav = () => screen.getByRole('navigation', { name: 'Main navigation' })
/** The People group's page links, opening the group first when the sidebar has it closed (a demo facility closes it). */
function peopleLinks(): string[] {
  const group = within(nav()).queryByRole('button', { name: 'People' })
  if (group?.getAttribute('aria-expanded') === 'false') fireEvent.click(group)
  return within(nav()).getAllByRole('link').map(link => link.textContent?.trim() ?? '')
}
/** Opens the staff app at `path` and waits for the frame (its lazy chunk loads first, which takes a while cold). */
async function openAt(path: string) {
  await openStaffApp(path)
  await screen.findByRole('navigation', { name: 'Main navigation' }, { timeout: 15_000 })
}
const many = <T,>(answer: T, count = 6): T[] => Array.from({ length: count }, () => answer)
const names = () => json({ facilityId: REAL_FACILITY, staff: [
  { membershipId: ADA, name: 'Ada Fictional', current: true }, { membershipId: BOLA, name: 'Bola Fictional', current: true },
  { membershipId: ME, name: 'Demo Clinician', current: true }], complete: true })
const departments = () => json({ departments: [
  { departmentCode: 'maternity', inCharges: [{ inChargeId: IN_CHARGE, departmentCode: 'maternity', membershipId: ADA, since: '2026-11-02',
    setByMembershipId: ME, rowVersion: 1 }] },
  { departmentCode: 'general_outpatient', inCharges: [] }] })
/** A refusal with the contract's details member (the duty refused, or the days a leave approval clashes with). */
const refused = (status: number, code: string, details: unknown) => new Response(JSON.stringify({ type: 'about:blank', title: code, status, code,
  detail: 'A refusal.', details }), { status, headers: { 'Content-Type': 'application/problem+json' } })
const noPermissionWord = () => expect(document.body.textContent).not.toMatch(/permission/i)
function noIdsInAddresses() {
  for (const [url] of vi.mocked(fetch).mock.calls) expect(String(url)).not.toMatch(/HID-|healthId|nin=|Fictional/i)
}
function operations(sent: readonly Sent[], route: string) {
  const call = sent.find(item => item.route === route)!
  expect(call.headers.get('X-Facility-ID')).toBe(REAL_FACILITY)
  expect(call.headers.get('X-Purpose-Of-Use')).toBe('healthcare-operations')
}
const keysOf = (sent: readonly Sent[], route: string) => sent.filter(item => item.route === route).map(item => item.headers.get('Idempotency-Key'))
const at = (permissions: readonly string[], roles: readonly string[] = ['nurse'], id = REAL_FACILITY, name = 'Fictional Clinic') =>
  facility(id, name, permissions, roles)

const NEXT_WEEK = addDays(thisWeek(), 7)
const shifts = [
  { shiftId: MORNING, name: 'Morning', startsAt: '07:30', endsAt: '14:30', active: true },
  { shiftId: NIGHT, name: 'Night', startsAt: '20:30', endsAt: '08:00', active: true },
]
/** A duty on `dutyDate` of a shift, with its Lagos moments worked out as the server does. */
function duty(id: string, membershipId: string, shiftId: string, dutyDate: string, overrides: Record<string, unknown> = {}) {
  const shift = shifts.find(item => item.shiftId === shiftId)!
  const startsAt = new Date(`${dutyDate}T${shift.startsAt}:00+01:00`).toISOString()
  const endDay = shift.endsAt <= shift.startsAt ? addDays(dutyDate, 1) : dutyDate
  return { assignmentId: id, membershipId, shiftId, dutyDate, startsAt, endsAt: new Date(`${endDay}T${shift.endsAt}:00+01:00`).toISOString(),
    attendance: 'not_marked', coveredByMembershipId: null, attendanceMarkedAt: null, attendanceMarkedByMembershipId: null, rowVersion: 1, ...overrides }
}
function roster(overrides: Record<string, unknown> = {}) {
  return { rosterId: ROSTER, departmentCode: 'maternity', weekStart: NEXT_WEEK, weekEnd: addDays(NEXT_WEEK, 6), status: 'draft',
    publishedAt: null, publishedByMembershipId: null, publishCount: 0, changedSincePublished: false, rowVersion: 3, canEdit: true,
    rules: { minRestHours: 8, status: 'draft' }, shifts,
    assignments: [duty('aa000000-0000-4000-8000-000000000001', ADA, MORNING, NEXT_WEEK)],
    unavailable: [{ membershipId: BOLA, from: addDays(NEXT_WEEK, 3), to: addDays(NEXT_WEEK, 4), kind: 'leave_approved' }], ...overrides }
}

describe('Duty roster switched off', () => {
  it('says so at a real facility and leaves the sidebar, after one read', async () => {
    const nurse = at(STAFF_CODES)
    const sent = serve({ [SESSION]: [sessionAt(nurse, [nurse])],
      [ROSTERS]: [() => problem(404, 'NOT_FOUND', 'Cannot GET /api/v1/identity/duty-rosters')] })
    await openAt('/provider/duty-roster')
    expect(await screen.findByText('The duty roster and leave are not switched on yet.')).toBeDefined()
    expect(screen.getByRole('heading', { level: 1, name: 'Duty roster' })).toBeDefined()
    await waitFor(() => expect(peopleLinks()).not.toContain('Duty roster'))
    expect(sent.filter(call => call.route === ROSTERS)).toHaveLength(1)
    noPermissionWord()
  }, 60_000)

  it('keeps the Shifts & Roster sample at a demo facility while the roster answers 503', async () => {
    const admin = at(ADMIN_CODES, ['org_admin'], DEMO_HOSPITAL, 'Demo Hospital')
    serve({ [SESSION]: [sessionAt(admin, [admin])],
      [ROSTERS]: many(() => problem(503, 'DUTY_ROSTER_NOT_AVAILABLE', 'The duty roster is not available.'), 3) })
    await openAt('/provider/duty-roster')
    expect(await screen.findByText('The duty roster and leave are not switched on yet.', {}, { timeout: 4000 })).toBeDefined()
    await waitFor(() => expect(peopleLinks()).not.toContain('Duty roster'))
    expect(peopleLinks()).toContain('Shifts & Roster')
    expect(within(nav()).getByRole('link', { name: 'Shifts & Roster' }).getAttribute('href')).toBe('/provider/shifts')
  })

  it('is not listed before the roster codes exist (before 0201), and the sample stays for the administrator', async () => {
    const admin = at(['workforce.manage'], ['org_admin'], DEMO_HOSPITAL, 'Demo Hospital')
    const sent = serve({ [SESSION]: [sessionAt(admin, [admin])] })
    await openAt('/provider/shifts')
    expect(await screen.findByRole('heading', { level: 1, name: 'Shifts & Roster' })).toBeDefined()
    expect(peopleLinks()).toContain('Shifts & Roster')
    expect(peopleLinks()).not.toContain('Duty roster')
    expect(sent.filter(call => call.route.includes('duty-roster'))).toEqual([])
  })
})

describe('Duty roster', () => {
  it('lists the week\'s rosters, makes a draft for a department and opens it', async () => {
    const admin = at(ADMIN_CODES, ['org_admin'])
    const sent = serve({
      [SESSION]: [sessionAt(admin, [admin])],
      [ROSTERS]: [() => json({ weekStart: thisWeek(), inChargeOf: [], items: [
        { rosterId: ROSTER, departmentCode: 'maternity', status: 'published', assignmentCount: 12, publishedAt: `${addDays(thisWeek(), -3)}T09:00:00.000Z`,
          changedSincePublished: true, canEdit: true },
        { rosterId: null, departmentCode: 'general_outpatient', status: 'none', assignmentCount: 0, publishedAt: null, changedSincePublished: false, canEdit: true },
      ] })],
      [CREATE]: [() => json({ outcome: 'created', roster: roster({ rosterId: ROSTER, departmentCode: 'general_outpatient', assignments: [] }), replayed: false }, 201)],
      [READ]: [() => json(roster({ departmentCode: 'general_outpatient', assignments: [] }))],
      [NAMES]: many(names),
    })
    await openAt('/provider/duty-roster')
    expect(await screen.findByRole('heading', { level: 1, name: 'Duty roster' })).toBeDefined()
    expect(within(nav()).getByRole('link', { name: 'Duty roster' }).getAttribute('href')).toBe('/provider/duty-roster')
    // Once it answers here, the Shifts & Roster sample leaves the sidebar (a real facility never listed it).
    expect(peopleLinks()).not.toContain('Shifts & Roster')
    const list = await screen.findByRole('list', { name: 'Rosters this week' })
    expect(within(list).getByRole('link', { name: 'Maternity' }).getAttribute('href')).toBe(`/provider/duty-roster/${ROSTER}`)
    expect(within(list).getByText('Changed since published')).toBeDefined()
    expect(within(list).getByText('No roster yet')).toBeDefined()
    expect(new URL(String(vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('/duty-rosters'))![0])).searchParams.get('weekStart')).toBe(thisWeek())
    operations(sent, ROSTERS)
    // Administrators see Leave to decide and In-charges too.
    expect(screen.getByRole('link', { name: 'Leave to decide' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'In-charges' })).toBeDefined()

    fireEvent.click(within(list).getByRole('button', { name: 'Make a draft roster for General Outpatient' }))
    await waitFor(() => expect(where()).toBe(`/provider/duty-roster/${ROSTER}`))
    expect(sent.find(call => call.route === CREATE)!.body).toEqual({ departmentCode: 'general_outpatient', weekStart: thisWeek() })
    expect(keysOf(sent, CREATE)[0]).toMatch(/^[0-9a-f-]{36}$/)
    expect(await screen.findByRole('heading', { level: 1, name: 'General Outpatient roster' })).toBeDefined()
    noPermissionWord()
    noIdsInAddresses()
  })

  it('saves a week\'s duties all at once, says a refusal with who and when, and publishes', async () => {
    const admin = at(ADMIN_CODES, ['org_admin'])
    const saved = roster({ rowVersion: 4, assignments: [duty('aa000000-0000-4000-8000-000000000001', ADA, MORNING, NEXT_WEEK),
      duty('aa000000-0000-4000-8000-000000000002', BOLA, NIGHT, addDays(NEXT_WEEK, 1))] })
    const sent = serve({
      [SESSION]: [sessionAt(admin, [admin])],
      [READ]: [() => json(roster())],
      [NAMES]: many(names),
      [SAVE]: [
        () => refused(409, 'ROSTER_OVERLAP', { membershipId: BOLA, dutyDate: addDays(NEXT_WEEK, 1), shiftId: NIGHT }),
        () => json({ roster: saved, changes: { added: 1, removed: 0, kept: 1 }, replayed: false }),
      ],
      [PUBLISH]: [() => json({ outcome: 'published', roster: { ...saved, status: 'published', rowVersion: 5, publishCount: 1,
        publishedAt: new Date().toISOString(), publishedByMembershipId: ME }, replayed: false })],
    })
    await openAt(`/provider/duty-roster/${ROSTER}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Maternity roster' })).toBeDefined()
    expect(screen.getByText('At least 8 hours between duties (draft, awaiting the clinical lead)')).toBeDefined()
    // Shift times are Lagos's (the device is in New York), and a night shift says it ends the next day.
    expect(screen.getByText('20:30 to 08:00 next day')).toBeDefined()
    expect(await screen.findByText('Ada Fictional')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Change duties' }))
    // Approved leave can't be chosen, and says so; never the type of leave.
    const onLeaveDay = screen.getByRole('combobox', { name: new RegExp(`^Add someone to Night on .* ${Number(addDays(NEXT_WEEK, 3).slice(8))} `) })
    expect(within(onLeaveDay).getByRole('option', { name: 'Bola Fictional (on leave)' }).hasAttribute('disabled')).toBe(true)
    const tuesday = screen.getAllByRole('combobox', { name: /^Add someone to Night on Tuesday/ })[0]!
    fireEvent.change(tuesday, { target: { value: BOLA } })
    fireEvent.click(screen.getByRole('button', { name: 'Save duties' }))
    expect(await screen.findByText(/^This person is already on duty at that time\. Bola Fictional: Night, Tuesday /)).toBeDefined()
    const body = { expectedRowVersion: 3, assignments: expect.arrayContaining([
      { membershipId: ADA, shiftId: MORNING, dutyDate: NEXT_WEEK }, { membershipId: BOLA, shiftId: NIGHT, dutyDate: addDays(NEXT_WEEK, 1) }]) }
    expect(sent.find(call => call.route === SAVE)!.body).toEqual(body)
    operations(sent, SAVE)

    // The same duties sent again carry the same key; the second answer saves them.
    fireEvent.click(screen.getByRole('button', { name: 'Save duties' }))
    expect(await screen.findByText('Duties saved: 1 added, 0 removed.')).toBeDefined()
    const keys = keysOf(sent, SAVE)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(await screen.findByText('Roster published.')).toBeDefined()
    expect(sent.find(call => call.route === PUBLISH)!.body).toEqual({ expectedRowVersion: 4 })
    expect(screen.getAllByText('Published').length).toBeGreaterThan(0)
    noPermissionWord()
  })

  it('refuses two duties too close together before sending them', async () => {
    const admin = at(ADMIN_CODES, ['org_admin'])
    const sent = serve({ [SESSION]: [sessionAt(admin, [admin])], [READ]: [() => json(roster({ unavailable: [] }))], [NAMES]: many(names) })
    await openAt(`/provider/duty-roster/${ROSTER}`)
    await screen.findByText('Ada Fictional')
    fireEvent.click(screen.getByRole('button', { name: 'Change duties' }))
    // Night on Monday after Morning on Monday: 6 hours apart.
    fireEvent.change(screen.getAllByRole('combobox', { name: /^Add someone to Night on Monday/ })[0]!, { target: { value: ADA } })
    fireEvent.click(screen.getByRole('button', { name: 'Save duties' }))
    expect(await screen.findByText(/^This person needs at least 8 hours between duties\. Ada Fictional: Night, Monday /)).toBeDefined()
    expect(sent.filter(call => call.route === SAVE)).toEqual([])
  })

  it('marks attendance on a published roster, never one\'s own, with who worked instead', async () => {
    const admin = at(ADMIN_CODES, ['org_admin'])
    const week = thisWeek()
    const now = Date.now()
    const running = (id: string, membershipId: string) => ({ ...duty(id, membershipId, MORNING, week), startsAt: new Date(now - 30 * 60_000).toISOString(),
      endsAt: new Date(now + 6 * 60 * 60_000).toISOString() })
    const published = roster({ weekStart: week, weekEnd: addDays(week, 6), status: 'published', publishCount: 1, rowVersion: 7,
      publishedAt: new Date(now - 86_400_000).toISOString(), publishedByMembershipId: ME, unavailable: [],
      assignments: [running('aa000000-0000-4000-8000-000000000003', BOLA), running('aa000000-0000-4000-8000-000000000004', ME)] })
    const ATTEND = `POST /api/v1/identity/duty-rosters/${ROSTER}/assignments/aa000000-0000-4000-8000-000000000003/attendance`
    const sent = serve({
      [SESSION]: [sessionAt(admin, [admin])], [READ]: [() => json(published)], [NAMES]: many(names),
      [ATTEND]: [() => json({ assignment: { ...running('aa000000-0000-4000-8000-000000000003', BOLA), attendance: 'swapped',
        coveredByMembershipId: ADA, rowVersion: 2 }, replayed: false })],
    })
    await openAt(`/provider/duty-roster/${ROSTER}`)
    const lines = await screen.findByRole('list', { name: 'Duties to mark' })
    const own = within(lines).getByRole('listitem', { name: 'You' })
    expect(within(own).getByText('Another in-charge or an administrator marks your own attendance.')).toBeDefined()
    expect(within(own).queryByRole('button', { name: 'Mark attendance' })).toBeNull()
    const bola = await within(lines).findByRole('listitem', { name: 'Bola Fictional' })
    fireEvent.click(within(bola).getByRole('button', { name: 'Mark attendance' }))
    fireEvent.click(within(bola).getByRole('radio', { name: 'Swapped: someone else worked it' }))
    fireEvent.change(within(bola).getByRole('combobox', { name: 'Who worked instead' }), { target: { value: ADA } })
    fireEvent.click(within(bola).getByRole('button', { name: 'Save attendance' }))
    expect(await within(bola).findByText('Covered by Ada Fictional')).toBeDefined()
    expect(sent.find(call => call.route === ATTEND)!.body).toEqual({ expectedRowVersion: 1, attendance: 'swapped', coveredByMembershipId: ADA })
    expect(keysOf(sent, ATTEND)[0]).toBeTruthy()
    noPermissionWord()
  })

  it('shows a nurse a published roster as it is: no changes, no leave, no attendance', async () => {
    const nurse = at(STAFF_CODES)
    serve({ [SESSION]: [sessionAt(nurse, [nurse])], [READ]: [() => json(roster({ status: 'published', canEdit: false, unavailable: [],
      publishedAt: `${NEXT_WEEK}T08:00:00.000Z`, publishedByMembershipId: ADA }))], [NAMES]: many(names) })
    await openAt(`/provider/duty-roster/${ROSTER}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Maternity roster' })).toBeDefined()
    expect(await screen.findByText(/^Published .* by Ada Fictional$/)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Change duties' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Leave this week' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Attendance' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Leave to decide' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'In-charges' })).toBeNull()
    expect(screen.getByRole('link', { name: 'My leave' })).toBeDefined()
  })

  it('prints the roster on its own paper', async () => {
    const admin = at(ADMIN_CODES, ['org_admin'])
    serve({ [SESSION]: [sessionAt(admin, [admin])], [READ]: [() => json(roster())], [NAMES]: many(names) })
    const print = vi.fn()
    vi.stubGlobal('print', print)
    await openAt(`/provider/duty-roster/${ROSTER}`)
    await screen.findByText('Ada Fictional')
    fireEvent.click(screen.getByRole('button', { name: 'Print' }))
    await waitFor(() => expect(print).toHaveBeenCalled())
    const paper = document.querySelector('[data-roster-print]')!
    expect(paper.textContent).toContain('Duty roster: Maternity')
    expect(paper.textContent).toContain('Draft, not published')
    expect(paper.textContent).toContain('Ada Fictional')
    expect(paper.textContent).not.toContain('You')
  })
})

describe('leave', () => {
  it('asks for leave with a type and dates only, and cancels it', async () => {
    const nurse = at(STAFF_CODES)
    const start = addDays(NEXT_WEEK, 7)
    const asked = { leaveRequestId: OWN_LEAVE, membershipId: ME, leaveType: 'annual', startsOn: start, endsOn: addDays(start, 4), days: 5,
      departmentCode: 'maternity', status: 'requested', requestedAt: new Date().toISOString(), decidedAt: null, decidedByMembershipId: null,
      cancelledAt: null, rowVersion: 1 }
    const sent = serve({
      [SESSION]: [sessionAt(nurse, [nurse])], [IN_CHARGES]: [departments], [MY_LEAVE]: [() => json({ items: [] })],
      [ASK]: [() => json({ leaveRequest: asked, replayed: false }, 201)],
      [CANCEL]: [() => json({ leaveRequest: { ...asked, status: 'cancelled', cancelledAt: new Date().toISOString(), rowVersion: 2 }, replayed: false })],
    })
    await openAt('/provider/duty-roster/my-leave')
    expect(await screen.findByRole('heading', { level: 1, name: 'My leave' })).toBeDefined()
    expect(screen.getByText('Leave has a type and dates only. Nobody is asked for a reason or any medical detail.')).toBeDefined()
    await screen.findByText('No leave requests')
    fireEvent.click(screen.getByRole('button', { name: 'Ask for leave' }))
    expect(await screen.findByText('Choose the type of leave.')).toBeDefined()
    expect(sent.filter(call => call.route === ASK)).toEqual([])

    fireEvent.change(screen.getByRole('combobox', { name: /Type of leave/ }), { target: { value: 'annual' } })
    await screen.findByRole('option', { name: 'Maternity’s in-charge' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Who decides' }), { target: { value: 'maternity' } })
    fireEvent.change(screen.getByLabelText(/First day/), { target: { value: start } })
    fireEvent.change(screen.getByLabelText(/Last day/), { target: { value: addDays(start, 4) } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask for leave' }))
    const mine = await screen.findByRole('list', { name: 'Your leave requests' })
    expect(sent.find(call => call.route === ASK)!.body).toEqual({ leaveType: 'annual', startsOn: start, endsOn: addDays(start, 4), departmentCode: 'maternity' })
    operations(sent, ASK)
    const request = within(mine).getByRole('listitem', { name: 'Annual leave' })
    expect(within(request).getByText('Waiting for a decision')).toBeDefined()
    expect(within(request).getByText('Sent to Maternity’s in-charge', { exact: false })).toBeDefined()

    fireEvent.click(within(request).getByRole('button', { name: 'Cancel leave' }))
    expect(await within(request).findByText('Cancelled')).toBeDefined()
    expect(sent.find(call => call.route === CANCEL)!.body).toEqual({ expectedRowVersion: 1 })
    noPermissionWord()
  })

  it('lets an administrator approve or decline others\' leave, never their own, and says the days on the roster', async () => {
    const admin = at(ADMIN_CODES, ['org_admin'])
    const request = (id: string, membershipId: string, overrides: Record<string, unknown> = {}) => ({ leaveRequestId: id, membershipId,
      leaveType: 'sick', startsOn: addDays(NEXT_WEEK, 1), endsOn: addDays(NEXT_WEEK, 2), days: 2, departmentCode: 'maternity', status: 'requested',
      requestedAt: new Date().toISOString(), decidedAt: null, decidedByMembershipId: null, cancelledAt: null, rowVersion: 1, ...overrides })
    const sent = serve({
      [SESSION]: [sessionAt(admin, [admin])], [IN_CHARGES]: [departments], [NAMES]: many(names),
      [TO_DECIDE]: [() => json({ items: [request(LEAVE, BOLA), request(OWN_LEAVE, ME)], hasMore: false, limit: 200 })],
      [APPROVE]: [() => refused(409, 'LEAVE_CLASHES_WITH_ROSTER', { dates: [addDays(NEXT_WEEK, 1)] })],
      [DECLINE]: [() => json({ leaveRequest: request(LEAVE, BOLA, { status: 'declined', decidedAt: new Date().toISOString(), rowVersion: 2 }), replayed: false })],
    })
    await openAt('/provider/duty-roster/leave')
    const list = await screen.findByRole('list', { name: 'Leave requests' })
    const own = await within(list).findByRole('listitem', { name: 'You' })
    expect(within(own).getByText('Someone else must approve or decline your own leave.')).toBeDefined()
    expect(within(own).queryByRole('button', { name: 'Approve' })).toBeNull()
    const bola = await within(list).findByRole('listitem', { name: 'Bola Fictional' })
    expect(within(bola).getByText(/^Sick leave · /)).toBeDefined()

    fireEvent.click(within(bola).getByRole('button', { name: 'Approve' }))
    expect(await within(bola).findByText('This person is on the roster during this leave. Take them off those duties first.')).toBeDefined()
    expect(within(bola).getByText(/^On the roster on Tuesday /)).toBeDefined()
    expect(sent.find(call => call.route === APPROVE)!.body).toEqual({ expectedRowVersion: 1 })

    fireEvent.click(within(bola).getByRole('button', { name: 'Decline' }))
    fireEvent.click(within(bola).getByRole('button', { name: 'Decline leave' }))
    await waitFor(() => expect(within(list).queryByRole('listitem', { name: 'Bola Fictional' })).toBeNull())
    expect(sent.find(call => call.route === DECLINE)!.body).toEqual({ expectedRowVersion: 1 })
    noPermissionWord()
  })
})

describe('own duties, who is on duty, and the in-charges', () => {
  it('shows a nurse their own duties in Lagos time', async () => {
    const nurse = at(STAFF_CODES)
    const day = addDays(NEXT_WEEK, 2)
    serve({ [SESSION]: [sessionAt(nurse, [nurse])], [MY_DUTIES]: [() => json({ items: [{ assignmentId: 'aa000000-0000-4000-8000-000000000009',
      departmentCode: 'maternity', shiftName: 'Night', dutyDate: day, startsAt: `${day}T19:30:00.000Z`, endsAt: `${addDays(day, 1)}T07:00:00.000Z`,
      attendance: 'not_marked' }] })] })
    await openAt('/provider/duty-roster/my-duties')
    const list = await screen.findByRole('list', { name: 'Duties coming up' })
    expect(within(list).getByText('Night · 20:30 to 08:00 next day')).toBeDefined()
    expect(within(list).getByText('Maternity')).toBeDefined()
  })

  it('shows who is on duty now, with who is covering', async () => {
    const nurse = at(STAFF_CODES)
    const now = Date.now()
    serve({ [SESSION]: [sessionAt(nurse, [nurse])], [IN_CHARGES]: [departments], [NAMES]: many(names),
      [ON_DUTY]: [() => json({ at: new Date(now).toISOString(), items: [
        { departmentCode: 'maternity', membershipId: ADA, shiftId: MORNING, shiftName: 'Morning', startsAt: new Date(now - 3_600_000).toISOString(),
          endsAt: new Date(now + 3_600_000).toISOString(), attendance: 'swapped', coveringForMembershipId: BOLA }] })] })
    await openAt('/provider/duty-roster/on-duty')
    expect(await screen.findByRole('heading', { level: 2, name: 'Maternity' })).toBeDefined()
    expect(await screen.findByText('Covering for Bola Fictional')).toBeDefined()
    expect(screen.getByText('Ada Fictional')).toBeDefined()
  })

  it('lets an administrator put someone in charge of a department and end it', async () => {
    const admin = at(ADMIN_CODES, ['org_admin'])
    const sent = serve({
      [SESSION]: [sessionAt(admin, [admin])], [IN_CHARGES]: [departments], [NAMES]: many(names),
      [ADD_IN_CHARGE]: [() => json({ inCharge: { inChargeId: 'c0000000-0000-4000-8000-0000000000c2', departmentCode: 'general_outpatient',
        membershipId: BOLA, since: lagosTodayText(), setByMembershipId: ME, rowVersion: 1 }, replayed: false }, 201)],
      [END_IN_CHARGE]: [() => json({ inCharge: { inChargeId: IN_CHARGE, endedAt: new Date().toISOString() }, replayed: false })],
    })
    await openAt('/provider/duty-roster/in-charges')
    const maternity = await screen.findByRole('list', { name: 'Maternity' })
    await within(maternity).findByText('Ada Fictional')
    fireEvent.click(screen.getByRole('button', { name: 'End Ada Fictional in charge of Maternity' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'End Ada Fictional in charge of Maternity' })).toBeNull())
    expect(sent.find(call => call.route === END_IN_CHARGE)!.body).toEqual({ expectedRowVersion: 1 })

    await screen.findAllByRole('option', { name: 'Bola Fictional' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Put someone in charge of General Outpatient' }), { target: { value: BOLA } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add in-charge' })[1]!)
    expect(await screen.findByText('Bola Fictional is now in charge of General Outpatient.')).toBeDefined()
    expect(sent.find(call => call.route === ADD_IN_CHARGE)!.body).toEqual({ departmentCode: 'general_outpatient', membershipId: BOLA })
    noPermissionWord()
  })
})

function lagosTodayText() {
  return new Date(Date.now() + 3_600_000).toISOString().slice(0, 10)
}
