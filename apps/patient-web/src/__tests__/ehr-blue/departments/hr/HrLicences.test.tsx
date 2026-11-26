import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type * as BlueRoutes from '../../../../ehr-blue/routes'
import { DEMO_HOSPITAL, SESSION, facility, json, openStaffApp, problem, serve, sessionAt, type Sent } from '../../frame/blueHarness'
import { forgetLicencesServed } from '../../../../ehr-blue/departments/hr/licenceRules'

/*
 * HR & Credentials with licence renewals (hid-system ROS-1 routes 1-5, 0199) inside the blue EHR's frame: each member's
 * licence status, the banner that says an expired licence changes no role, the CSV export, one member's renewals with
 * the withdrawn ones marked, recording a renewal and withdrawing one. Switched off (404 or 503
 * HR_CREDENTIALS_NOT_AVAILABLE), the page is today's, sample rows and all. Every account, facility and licence is
 * fictional; no licence number but its last 4 characters appears anywhere.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
const saved = vi.hoisted(() => ({ files: [] as Array<{ name: string; size: number }> }))
vi.mock('../../../../download', () => ({ saveFile: (blob: Blob, name: string) => { saved.files.push({ name, size: blob.size }) } }))
beforeAll(() => { process.env.TZ = 'America/New_York' })
beforeEach(() => {
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  saved.files = []
  vi.doMock('../../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../../ehr-blue/frame/pages')
    const home = await import('../../../../ehr-blue/home/pages')
    const { hrPage } = await import('../../../../ehr-blue/departments/hr/page')
    return { ...actual, BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home, './departments/pages.ts': { pages: [hrPage] } }) }
  })
})
afterEach(() => { forgetLicencesServed(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const NURSE = '7c3d4e5f-0000-4000-8000-00000000a002'
const ADMIN = '5e0a1b2c-0000-4000-8000-00000000a001'
const DESK = '9a8b7c6d-0000-4000-8000-00000000a003'
const RENEWAL = 'aa000000-0000-4000-8000-000000000001'
const OLD_RENEWAL = 'aa000000-0000-4000-8000-000000000002'
const LIST = 'GET /api/v1/identity/staff-licences'
const MEMBER = `GET /api/v1/identity/staff-licences/${NURSE}`
const EXPORT = 'GET /api/v1/identity/staff-licences/export'
const RECORD = 'POST /api/v1/identity/staff-licences/renewals'
const WITHDRAW = `POST /api/v1/identity/staff-licences/renewals/${RENEWAL}/withdraw`
const STAFF = 'GET /api/v1/identity/facility-staff'

const renewal = (overrides: Record<string, unknown> = {}) => ({ renewalId: RENEWAL, period: 'licence_year', licenceYear: 2026,
  validUntil: '2026-12-31', checkedHow: 'regulator_register', checkedOn: '2026-01-10', checkedByMembershipId: ADMIN,
  checkedByName: 'Demo Administrator', selfRecorded: false, recordedAt: '2026-01-10T09:12:00.000Z', ...overrides })
const nurseLicence = (overrides: Record<string, unknown> = {}) => ({ role: 'nurse', body: 'NMCN', numberHint: '8765', status: 'expiring_30',
  validUntil: '2026-12-31', daysLeft: 28, renewal: renewal(), ...overrides })
const list = () => json({ facilityId: DEMO_HOSPITAL, asOf: '2026-12-03',
  counts: { valid: 1, expiring60: 0, expiring30: 1, expired: 1, notRecorded: 0, noLicence: 0 },
  members: [
    { membershipId: ADMIN, name: 'Demo Administrator', roles: ['org_admin', 'doctor'], isSelf: true, licences: [{ role: 'doctor', body: 'MDCN',
      numberHint: '2345', status: 'expired', validUntil: '2025-12-31', daysLeft: -2, renewal: renewal({ validUntil: '2025-12-31', licenceYear: 2025, selfRecorded: true }) }] },
    { membershipId: NURSE, name: 'Demo Nurse', roles: ['nurse'], isSelf: false, licences: [nurseLicence()] },
    { membershipId: DESK, name: 'Demo Receptionist', roles: ['receptionist'], isSelf: false, licences: [] },
  ] })
const member = (licences = [{ ...nurseLicence(), renewals: [{ ...renewal(), withdrawn: null },
  { ...renewal({ renewalId: OLD_RENEWAL, licenceYear: 2025, validUntil: '2025-12-31', checkedHow: 'certificate_seen' }),
    withdrawn: { reasonCode: 'wrong_dates', withdrawnAt: '2026-01-09T10:00:00.000Z', withdrawnByMembershipId: ADMIN } }] }]) =>
  () => json({ membershipId: NURSE, name: 'Demo Nurse', roles: ['nurse'], isSelf: false, licences })

function administrator(review = 'reviewed') {
  return { ...facility(DEMO_HOSPITAL, 'Demo Hospital', ['workforce.manage'], ['org_admin']), selfService: { review, organizationType: 'hospital' } }
}
/** Opens the staff app at `path` and waits for the frame (its lazy chunk loads first, which takes a while cold). */
async function openAt(path: string) {
  await openStaffApp(path)
  await screen.findByRole('navigation', { name: 'Main navigation' }, { timeout: 15_000 })
}
const noPermissionWord = () => expect(document.body.textContent).not.toMatch(/permission/i)
const keyOf = (sent: readonly Sent[], route: string) => sent.find(call => call.route === route)!.headers.get('Idempotency-Key')

describe('HR & Credentials switched off', () => {
  it('is today\'s page, staff read and sample rows, when the licence routes answer 503', async () => {
    const admin = administrator()
    const staff = { facility: { id: DEMO_HOSPITAL, name: 'Demo Hospital', organizationType: 'hospital', reviewState: 'reviewed', firstThirtyDaysEndAt: null,
      invitationsOpen: true, deliveryPaused: false }, canInvite: true,
    limits: { pendingInvitations: 0, pendingLimit: 100, invitationsToday: 0, invitationsPerDay: 30, emailsToday: 0, emailsPerDay: 60 },
    inviteOptions: { roles: [], attestation: null }, administratorLicence: null, administratorLicenceBodies: [],
    members: [{ membershipId: ADMIN, version: 1, accountId: 'account-demo-1', name: 'Demo Administrator', email: 'demo.admin@example.test',
      roles: ['org_admin'], isAdministrator: true, isSelf: true, joinedAt: '2026-10-20T09:00:00.000Z', licence: null }], invitations: [] }
    const sent = serve({ [SESSION]: [sessionAt(admin, [admin])],
      [LIST]: [1, 2, 3].map(() => () => problem(503, 'HR_CREDENTIALS_NOT_AVAILABLE', 'Licence renewals are not available.')),
      [STAFF]: [() => json(staff)] })
    await openAt('/provider/hr')
    expect(await screen.findByRole('button', { name: 'No licence on record' }, { timeout: 8000 })).toBeDefined()
    expect(screen.getByText('f8f25d2e · sample')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull()
    expect(sent.filter(call => call.route === STAFF)).toHaveLength(1)
  }, 60_000)
})

describe('HR & Credentials with licence renewals', () => {
  it('lists each licence with its status, warns without changing roles, and exports the list', async () => {
    const admin = administrator()
    const csv = '﻿Staff name,Roles\r\n'
    const sent = serve({ [SESSION]: [sessionAt(admin, [admin])], [LIST]: [list],
      [EXPORT]: [() => new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="licence-check-2026-12-03.csv"' } })] })
    await openAt('/provider/hr')
    expect(await screen.findByText('1 licence has expired, 1 expires within 30 days.', {}, { timeout: 8000 })).toBeDefined()
    expect(screen.getByText('A licence that has expired does not change anyone’s role or access. Check the licence, then record its renewal here.')).toBeDefined()
    const table = screen.getByRole('table', { name: 'Licences' })
    const nurseRow = within(table).getByRole('button', { name: 'Demo Nurse' }).closest('tr') as HTMLElement
    expect(within(nurseRow).getByText('NMCN licence, ending 8765')).toBeDefined()
    expect(within(nurseRow).getByText('Expires within 30 days')).toBeDefined()
    expect(within(nurseRow).getByText('31 Dec 2026')).toBeDefined()
    expect(within(nurseRow).getByText('Checked on the regulator’s register on 10 Jan 2026')).toBeDefined()
    const adminRow = within(table).getByRole('button', { name: 'Demo Administrator' }).closest('tr') as HTMLElement
    expect(within(adminRow).getByText('Expired')).toBeDefined()
    expect(within(table).getByText('No licence needed')).toBeDefined()
    // No sample row once the licences are served.
    expect(screen.queryByText(/· sample/)).toBeNull()
    const call = sent.find(item => item.route === LIST)!
    expect(call.headers.get('X-Facility-ID')).toBe(DEMO_HOSPITAL)
    expect(call.headers.get('X-Purpose-Of-Use')).toBe('healthcare-operations')

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(await screen.findByText('The licence list was downloaded.')).toBeDefined()
    expect(saved.files).toEqual([{ name: 'licence-check-2026-12-03.csv', size: new Blob([csv]).size }])
    expect(sent.filter(item => item.route === EXPORT)).toHaveLength(1)
    noPermissionWord()
  })

  it('opens a member: every renewal with the withdrawn one marked, then records a renewal and withdraws one', async () => {
    const admin = administrator()
    const sent = serve({ [SESSION]: [sessionAt(admin, [admin])], [LIST]: [list, list], [MEMBER]: [member(), member(), member()],
      [RECORD]: [() => json({ renewal: renewal({ renewalId: 'aa000000-0000-4000-8000-000000000003', licenceYear: 2027, validUntil: '2027-12-31' }),
        licence: nurseLicence({ status: 'valid' }), replayed: false }, 201)],
      [WITHDRAW]: [() => json({ licence: nurseLicence({ status: 'not_recorded', renewal: null, validUntil: null, daysLeft: null }), replayed: false })] })
    await openAt('/provider/hr')
    fireEvent.click(await screen.findByRole('button', { name: 'Demo Nurse' }, { timeout: 8000 }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Demo Nurse' })).toBeDefined()
    const renewals = await screen.findByRole('list', { name: 'Renewals of the NMCN licence' })
    const current = within(renewals).getByRole('listitem', { name: 'Valid until 31 Dec 2026 (licence year 2026)' })
    expect(within(current).getByText('Checked on the regulator’s register on 10 Jan 2026')).toBeDefined()
    const old = within(renewals).getByRole('listitem', { name: 'Valid until 31 Dec 2025 (licence year 2025)' })
    expect(within(old).getByText('Withdrawn')).toBeDefined()
    expect(within(old).getByText(/Wrong dates/)).toBeDefined()
    expect(within(old).queryByRole('button', { name: 'Withdraw' })).toBeNull()

    // Record a renewal: nothing is sent until every field is filled and confirmed.
    fireEvent.click(screen.getByRole('button', { name: 'Record renewal' }))
    const form = screen.getByRole('form', { name: 'Record a renewal of the NMCN licence' })
    fireEvent.click(within(form).getByRole('button', { name: 'Record renewal' }))
    expect(await within(form).findByText('Choose whether the licence has a licence year or an expiry date.')).toBeDefined()
    expect(within(form).getByText('Confirm that you checked the licence.')).toBeDefined()
    expect(sent.filter(call => call.route === RECORD)).toEqual([])
    const year = new Date().getUTCFullYear()
    fireEvent.click(within(form).getByRole('radio', { name: 'A licence year (valid to 31 December)' }))
    fireEvent.change(within(form).getByRole('combobox', { name: /Licence year/ }), { target: { value: String(year + 1) } })
    fireEvent.change(within(form).getByRole('combobox', { name: /How you checked it/ }), { target: { value: 'certificate_seen' } })
    const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10)
    fireEvent.change(within(form).getByLabelText(/Day you checked it/), { target: { value: today } })
    fireEvent.click(within(form).getByRole('checkbox', { name: /^I confirm that I checked Demo Nurse’s practising licence/ }))
    fireEvent.click(within(form).getByRole('button', { name: 'Record renewal' }))
    expect(await screen.findByText('Renewal recorded.')).toBeDefined()
    expect(sent.find(call => call.route === RECORD)!.body).toEqual({ membershipId: NURSE, role: 'nurse', period: 'licence_year',
      licenceYear: year + 1, validUntil: null, checkedHow: 'certificate_seen', checkedOn: today, attested: true })
    expect(keyOf(sent, RECORD)).toBeTruthy()

    // Withdraw the current renewal, with a reason from the list.
    const again = await screen.findByRole('listitem', { name: 'Valid until 31 Dec 2026 (licence year 2026)' })
    fireEvent.click(within(again).getByRole('button', { name: 'Withdraw' }))
    fireEvent.change(within(again).getByRole('combobox', { name: 'Why is it withdrawn?' }), { target: { value: 'wrong_member' } })
    fireEvent.click(within(again).getByRole('button', { name: 'Withdraw renewal' }))
    expect(await screen.findByText('Renewal withdrawn.')).toBeDefined()
    expect(sent.find(call => call.route === WITHDRAW)!.body).toEqual({ reasonCode: 'wrong_member' })
    for (const [url] of vi.mocked(fetch).mock.calls) expect(String(url)).not.toMatch(/HID-|8765|Demo/)
    noPermissionWord()
  })

  it('records no renewal before Health ID support has checked the facility, and says so', async () => {
    const admin = administrator('pending')
    serve({ [SESSION]: [sessionAt(admin, [admin])], [LIST]: [list], [MEMBER]: [member()] })
    await openAt('/provider/hr')
    expect(await screen.findByText('You can record licence renewals once Health ID support has checked Demo Hospital.', {}, { timeout: 8000 })).toBeDefined()
    fireEvent.click(await screen.findByRole('button', { name: 'Demo Nurse' }))
    await screen.findByRole('list', { name: 'Renewals of the NMCN licence' })
    expect(screen.queryByRole('button', { name: 'Record renewal' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull()
  })

  it('says a refused list in its own words, with a retry', async () => {
    const admin = administrator()
    serve({ [SESSION]: [sessionAt(admin, [admin])], [LIST]: [() => problem(403, 'HR_CREDENTIALS_NOT_ALLOWED', 'A refusal naming a permission.'), list] })
    await openAt('/provider/hr')
    expect(await screen.findByText('Only this facility’s administrator can see and record licence renewals.', {}, { timeout: 8000 })).toBeDefined()
    noPermissionWord()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('table', { name: 'Licences' })).toBeDefined()
  })
})
