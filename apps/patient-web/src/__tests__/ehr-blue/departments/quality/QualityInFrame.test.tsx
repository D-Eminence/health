import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DEMO_HOSPITAL, REAL_FACILITY, SESSION, facility, json, openStaffApp, problem, serve, sessionAt, where, type Sent } from '../../frame/blueHarness'
import {
  ADMIN_CODES, INCIDENT, LIST, ME, PATIENT, READ, REPORT, REVIEWER, STAFF, STAFF_CODES, card, me, record, reporterCard, reporterMe,
  reviewerCard, staffNames, step, summary, withQualityPage,
} from './qualityFixtures'

/*
 * Quality & Safety (hid-system QUAL-1, 0197 and 0198) inside the blue EHR's real frame, joined as departments/pages.ts
 * joins it: switched off (today's sample at the demo facilities, "not switched on yet" anywhere else), the list, filing a
 * report with the contract's body and headers and an Idempotency-Key, and the incident page in the manager's, the
 * reviewer's and the reporter's views. Never a Health ID, a name or a patient in an address, and never "permission" on
 * screen. Every account, facility, patient and incident is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(async () => {
  withQualityPage()
  const { forgetQualityServed } = await import('../../../../ehr-blue/departments/quality/qualityRules')
  forgetQualityServed()
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const nav = () => screen.getByRole('navigation', { name: 'Main navigation' })
const qualityCalls = (sent: readonly Sent[]) => sent.filter(call => call.route.includes('/quality'))
function sentTo(sent: readonly Sent[], route: string) { return sent.filter(call => call.route === route) }
function checkHeaders(call: Sent) {
  expect(call.headers.get('X-Purpose-Of-Use')).toBe('healthcare-operations')
  expect(call.headers.get('X-Facility-ID')).toBe(REAL_FACILITY)
}
function noIdentityInAddresses() {
  for (const [url] of vi.mocked(fetch).mock.calls) expect(String(url)).not.toMatch(/HID-|Tunde|Fictional|healthId|patientId|b0000000/i)
}
function noPermissionWords() {
  expect(document.body.textContent).not.toMatch(/permission/i)
}
const admin = () => facility(REAL_FACILITY, 'Fictional Hospital', ADMIN_CODES, ['org_admin'])
const nurse = () => facility(REAL_FACILITY, 'Fictional Hospital', STAFF_CODES, ['nurse'])

describe('Quality & Safety while it is switched off', () => {
  it('says it is not switched on yet at a real facility (503), sends nothing else, and stops listing it', async () => {
    const member = nurse()
    const sent = serve({
      [SESSION]: [sessionAt(member, [member])],
      // The client asks again after a 503 (a read it may repeat): every answer says the same.
      [ME]: Array.from({ length: 6 }, () => () => problem(503, 'QUALITY_NOT_AVAILABLE', 'Quality and safety reporting is not switched on yet.')),
    })
    await openStaffApp('/provider/quality')
    expect(await screen.findByText('Quality and safety reporting is not switched on yet.')).toBeDefined()
    expect(screen.getByRole('heading', { level: 1, name: 'Quality & Safety' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Report an incident' })).toBeNull()
    await waitFor(() => expect(within(nav()).queryByRole('link', { name: 'Quality & Safety' })).toBeNull())
    expect(new Set(qualityCalls(sent).map(call => call.route))).toEqual(new Set([ME]))
    noPermissionWords()
  })

  it('says the same for an ehr-api without it (404)', async () => {
    const member = admin()
    serve({ [SESSION]: [sessionAt(member, [member])], [ME]: [() => problem(404, 'NOT_FOUND', 'Cannot GET /api/v1/ehr/quality/me')] })
    await openStaffApp('/provider/quality')
    expect(await screen.findByText('Quality and safety reporting is not switched on yet.')).toBeDefined()
  })

  it('keeps today’s sample at a demo facility, with its notice and fictional incidents, sending nothing after route 1', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ADMIN_CODES, ['org_admin'])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])],
      [ME]: Array.from({ length: 6 }, () => () => problem(503, 'QUALITY_NOT_AVAILABLE', 'Off')) })
    await openStaffApp('/provider/quality')
    expect(await screen.findByText('Sample only: not connected to Health ID yet. Nothing you do here is saved.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Near-miss labelling (fictional)' })).toBeDefined()
    expect(new Set(qualityCalls(sent).map(call => call.route))).toEqual(new Set([ME]))
  })

  it('keeps today’s sample for a demo facility member without the code (before 0198), reading nothing', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'], ['org_admin'])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])], 'GET /api/v1/identity/access-requests': [() => json([]), () => json([])] })
    await openStaffApp('/provider/quality')
    expect(await screen.findByRole('button', { name: 'Wet floor near ward entrance (fictional)' })).toBeDefined()
    expect(qualityCalls(sent)).toEqual([])
  })

  it('is not open at a real facility to a member without the code, and reads nothing', async () => {
    const member = facility(REAL_FACILITY, 'Fictional Hospital', ['ehr.encounter.read'], ['scanner'])
    const sent = serve({ [SESSION]: [sessionAt(member, [member])] })
    await openStaffApp('/provider/quality')
    expect(await screen.findByText('Quality and safety reporting is not open to you here.')).toBeDefined()
    expect(within(nav()).queryByRole('link', { name: 'Quality & Safety' })).toBeNull()
    expect(qualityCalls(sent)).toEqual([])
    noPermissionWords()
  })
})

describe('the incident list', () => {
  it('is listed under Administration for a manager, with the counts, the five views and the draft list banner', async () => {
    const member = admin()
    const sent = serve({
      [SESSION]: [sessionAt(member, [member])],
      [ME]: [() => json(me())],
      [LIST]: [() => json({ items: [summary(), summary({ incidentId: 'e0000000-0000-4000-8000-00000000a002', incidentNumber: 13,
        title: 'Wet floor at the entrance (fictional)', category: 'facility_environment', harmLevel: 'near_miss', departmentCode: null,
        status: 'reported', reviewerMembershipId: null, patientLinked: false, openActions: 0, overdueActions: 0 })],
      nextCursor: null, limit: 50, counts: { reported: 1, assigned: 1, investigated: 0, resolved: 14 } }),
      () => json({ items: [], nextCursor: null, limit: 50, counts: { reported: 1, assigned: 1, investigated: 0, resolved: 14 } })],
      [STAFF]: [() => json(staffNames())],
    })
    await openStaffApp('/provider/quality')
    expect(await screen.findByRole('heading', { level: 1, name: 'Quality & Safety' })).toBeDefined()
    expect(within(nav()).getByRole('link', { name: 'Quality & Safety' }).getAttribute('href')).toBe('/provider/quality')
    const views = await screen.findByRole('navigation', { name: 'Quality & Safety views' })
    expect(within(views).getAllByRole('link').map(link => link.textContent))
      .toEqual(['All reports', 'Reported by me', 'Assigned to me', 'Monthly counts', 'Quality leads'])
    expect(screen.getByText('Draft list, awaiting clinical sign-off')).toBeDefined()

    const table = await screen.findByRole('table')
    const first = within(table).getByRole('link', { name: 'Wrong strength dispensed (fictional)' })
    expect(first.getAttribute('href')).toBe(`/provider/quality/${INCIDENT}`)
    const row = first.closest('tr')!
    // 08:10 UTC is 09:10 in Lagos, whatever the device's zone.
    expect(within(row).getByText('3 Dec 2026, 09:10')).toBeDefined()
    expect(within(row).getByText('Medication')).toBeDefined()
    expect(within(row).getByText('No harm')).toBeDefined()
    expect(within(row).getByText('Pharmacy')).toBeDefined()
    expect(within(row).getByText('Patient linked')).toBeDefined()
    expect(within(row).getByText('2 open, 1 overdue')).toBeDefined()
    expect(await within(row).findByText('Chidi Reviewer')).toBeDefined()
    expect(within(table).getByText('Not given')).toBeDefined()
    expect(within(table).getByText('Not assigned')).toBeDefined()

    checkHeaders(sentTo(sent, LIST)[0]!)
    expect(sentTo(sent, LIST)[0]!.route).toBe(LIST)
    // A count filters the list by its status.
    fireEvent.click(screen.getByRole('button', { name: /^Resolved/ }))
    await waitFor(() => expect(sentTo(sent, LIST)).toHaveLength(2))
    const query = new URL(String(vi.mocked(fetch).mock.calls.map(([url]) => String(url)).filter(url => url.includes('/quality/incidents'))[1]))
    expect(Object.fromEntries(query.searchParams)).toEqual({ status: 'resolved' })
    noPermissionWords()
    noIdentityInAddresses()
  })

  it('shows a member only their own reports, with two views and no counts, asking with mine=reported', async () => {
    // A manager's views are not open to them: their addresses lead back to the list.
    const member = nurse()
    serve({
      [SESSION]: [sessionAt(member, [member])],
      [ME]: [() => json(reporterMe())],
      [LIST]: [() => json({ items: [summary({ reportedByMe: true, reviewerMembershipId: null, patientLinked: false, openActions: 0,
        overdueActions: 0 })], nextCursor: null, limit: 50, counts: null })],
    })
    await openStaffApp('/provider/quality/counts')
    const views = await screen.findByRole('navigation', { name: 'Quality & Safety views' })
    await waitFor(() => expect(where()).toBe('/provider/quality'))
    expect(within(views).getAllByRole('link').map(link => link.textContent)).toEqual(['My reports', 'Assigned to me'])
    expect(await screen.findByText('Reported by you')).toBeDefined()
    expect(screen.queryByRole('columnheader', { name: 'Reviewer' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Reported/ })).toBeNull()
    const listUrl = vi.mocked(fetch).mock.calls.map(([url]) => String(url)).find(url => url.includes('/quality/incidents'))!
    expect(new URL(listUrl).searchParams.get('mine')).toBe('reported')
  })
})

describe('filing a report', () => {
  it('checks the form, then sends the contract’s body with an Idempotency-Key and opens the new incident', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-03T10:00:00.000Z'))
    const member = nurse()
    const sent = serve({
      [SESSION]: [sessionAt(member, [member])],
      [ME]: [() => json(reporterMe())],
      [REPORT]: [() => json({ incident: reporterCard({ status: 'reported', harmLevel: 'moderate', patientOrFamilyTold: 'yes' }), actions: [],
        history: [{ kind: 'reported', at: '2026-12-03T10:00:00.000Z', fromStatus: null, toStatus: 'reported' }], replayed: false }, 201)],
      [READ]: [() => json(record(reporterCard({ status: 'reported', harmLevel: 'moderate', patientOrFamilyTold: 'yes' }), [],
        [{ kind: 'reported', at: '2026-12-03T10:00:00.000Z', fromStatus: null, toStatus: 'reported' }]))],
    })
    await openStaffApp('/provider/quality/new')
    expect(await screen.findByRole('heading', { level: 1, name: 'Report an incident' })).toBeDefined()
    expect(screen.getByText('Write what happened, not who is to blame. Do not write any patient’s or colleague’s name or Health ID.')).toBeDefined()
    expect(screen.getByText('Draft list, awaiting clinical sign-off')).toBeDefined()
    // The form starts at now, Lagos time: 10:00 UTC is 11:00 in Lagos.
    expect((screen.getByLabelText('Day it happened') as HTMLInputElement).value).toBe('2026-12-03')
    expect((screen.getByLabelText('Time it happened') as HTMLInputElement).value).toBe('11:00')

    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
    expect(await screen.findByText('Enter a short title.')).toBeDefined()
    expect(screen.getByText('Say where it happened: choose a department, describe the place, or both.')).toBeDefined()
    expect(screen.getByText('Choose a category from the list.')).toBeDefined()
    expect(screen.getByText('Choose how much harm was done from the list.')).toBeDefined()
    expect(sentTo(sent, REPORT)).toEqual([])

    fireEvent.change(screen.getByRole('textbox', { name: 'Short title' }), { target: { value: '  Wrong strength dispensed (fictional) ' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'What happened' }), { target: { value: 'A 10 mg tablet was handed over (fictional).' } })
    fireEvent.change(screen.getByLabelText('Time it happened'), { target: { value: '09:10' } })
    expect(screen.getByText('Lagos time: 3 Dec 2026, 09:10')).toBeDefined()
    fireEvent.change(screen.getByRole('combobox', { name: 'Department' }), { target: { value: 'pharmacy' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'medication' } })
    expect(screen.getByText('Wrong medicine, dose, strength, route, time or patient.')).toBeDefined()
    fireEvent.click(screen.getByRole('radio', { name: /^Moderate harm/ }))
    // Moderate harm needs "patient or family told" (Q252 A).
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
    expect(await screen.findByText('For moderate harm, severe harm or death, say whether the patient or family was told.')).toBeDefined()
    expect(sentTo(sent, REPORT)).toEqual([])
    fireEvent.click(screen.getByRole('radio', { name: 'Yes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))

    expect(await screen.findByText('Report sent: incident 12.')).toBeDefined()
    expect(where()).toBe(`/provider/quality/${INCIDENT}`)
    const report = sentTo(sent, REPORT)[0]!
    expect(report.body).toEqual({ title: 'Wrong strength dispensed (fictional)', description: 'A 10 mg tablet was handed over (fictional).',
      occurredAt: '2026-12-03T08:10:00.000Z', departmentCode: 'pharmacy', category: 'medication', harmLevel: 'moderate',
      patientOrFamilyTold: 'yes' })
    checkHeaders(report)
    expect(report.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)

    // The reporter's own view: the report and where it is up to, never the investigation.
    expect(screen.getByText('You reported this. You can see where it is up to. The investigation and its actions are seen by the reviewer and quality leads.')).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Investigation' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Corrective actions' })).toBeNull()
    expect(screen.getByText('Confidential. Only quality leads and administrators see who reported this.')).toBeDefined()
    noIdentityInAddresses()
    noPermissionWords()
  })

  it('sends the same key again after a lost answer, and says a refusal for a field beside it', async () => {
    const member = nurse()
    const sent = serve({
      [SESSION]: [sessionAt(member, [member])],
      [ME]: [() => json(reporterMe())],
      [REPORT]: [() => problem(503, 'SERVICE_UNAVAILABLE', 'Try again'),
        () => problem(400, 'QUALITY_TIME_INVALID', 'The time it happened can be up to a year ago, and not in the future.')],
    })
    await openStaffApp('/provider/quality/new')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Short title' }), { target: { value: 'Fall in the corridor (fictional)' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'What happened' }), { target: { value: 'A patient slipped near the lift (fictional).' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Where exactly (optional)' }), { target: { value: 'Corridor by the lift' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'patient_fall' } })
    fireEvent.click(screen.getByRole('radio', { name: /^Near miss/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
    expect(await screen.findByText('The report could not be sent. Try again.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
    expect(await screen.findByText('The time it happened can be up to a year ago, and not in the future.')).toBeDefined()
    const [first, second] = sentTo(sent, REPORT)
    expect(second!.headers.get('Idempotency-Key')).toBe(first!.headers.get('Idempotency-Key'))
    expect(first!.body).toMatchObject({ locationText: 'Corridor by the lift', category: 'patient_fall', harmLevel: 'near_miss' })
    expect(first!.body).not.toHaveProperty('departmentCode')
    expect(first!.body).not.toHaveProperty('patientId')
  })

  it('takes the patient from the page’s state only while the link is on, and never puts it in the address', async () => {
    const member = nurse()
    const sent = serve({
      [SESSION]: [sessionAt(member, [member])],
      [ME]: [() => json(reporterMe({ patientLinkAvailable: true }))],
      [REPORT]: [() => problem(403, 'QUALITY_PATIENT_LINK_REFUSED', 'Refused'),
        () => json({ incident: reporterCard({ status: 'reported', patientLinked: false }), actions: [], history: [], replayed: false }, 201)],
      [READ]: [() => json(record(reporterCard({ status: 'reported', patientLinked: false }), [], []))],
    })
    await openStaffApp({ pathname: '/provider/quality/new', state: { qualityPatient: { patientId: PATIENT, name: 'Tunde Fictional' } } })
    expect(await screen.findByText('Tunde Fictional')).toBeDefined()
    fireEvent.change(screen.getByRole('textbox', { name: 'Short title' }), { target: { value: 'Wrong wristband (fictional)' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'What happened' }), { target: { value: 'The wristband named another patient (fictional).' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Department' }), { target: { value: 'emergency' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'other' } })
    fireEvent.click(screen.getByRole('radio', { name: /^No harm/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
    expect(await screen.findByText(/^Only a patient of this facility can be linked\./)).toBeDefined()
    expect(sentTo(sent, REPORT)[0]!.body).toMatchObject({ patientId: PATIENT })
    fireEvent.click(screen.getByRole('button', { name: 'Report without the patient' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
    await waitFor(() => expect(where()).toBe(`/provider/quality/${INCIDENT}`))
    expect(sentTo(sent, REPORT)[1]!.body).not.toHaveProperty('patientId')
    noIdentityInAddresses()
  })

  it('says the link is not switched on yet, and sends no patient, while the link is off', async () => {
    const member = nurse()
    serve({ [SESSION]: [sessionAt(member, [member])], [ME]: [() => json(reporterMe())] })
    await openStaffApp({ pathname: '/provider/quality/new', state: { qualityPatient: { patientId: PATIENT, name: 'Tunde Fictional' } } })
    expect(await screen.findByText('Linking a patient is not switched on yet. Report without the patient, and do not write their name.')).toBeDefined()
    expect(screen.queryByText('Tunde Fictional')).toBeNull()
  })
})

describe('the incident page', () => {
  it('shows a manager the reporter, the patient’s identity details only, the investigation and the history', async () => {
    const member = admin()
    serve({
      [SESSION]: [sessionAt(member, [member])],
      [ME]: [() => json(me())],
      [READ]: [() => json(record())],
      [STAFF]: [() => json(staffNames())],
    })
    await openStaffApp(`/provider/quality/${INCIDENT}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Incident 12' })).toBeDefined()
    expect(screen.getByText('Confidential. Only quality leads and administrators see who reported this.')).toBeDefined()
    const report = screen.getByRole('region', { name: 'The report' })
    expect(within(report).getByText('3 Dec 2026, 09:10')).toBeDefined()
    expect(within(report).getByText('Pharmacy: Dispensary counter 2')).toBeDefined()
    expect(await within(report).findByText('Bola Reporter')).toBeDefined()
    const patient = screen.getByRole('region', { name: 'Patient' })
    expect(within(patient).getByText('Tunde Fictional')).toBeDefined()
    expect(within(patient).getByText('9 Mar 1984')).toBeDefined()
    expect(within(patient).getByLabelText('Health ID ending BB33').textContent).toBe('•••• BB33')
    const history = screen.getByRole('region', { name: 'History' })
    expect(within(history).getByText('A patient was linked.')).toBeDefined()
    expect(within(history).getByText('Reported to Assigned')).toBeDefined()
    expect(await within(history).findByText('Reviewer: none to Chidi Reviewer')).toBeDefined()
    expect(within(history).queryByText(/Tunde/)).toBeNull()
    for (const name of ['Change reviewer', 'Change investigation', 'Add corrective action', 'Resolve', 'Correct the report']) {
      expect(screen.getByRole('button', { name })).toBeDefined()
    }
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull()
    noPermissionWords()
  })

  it('shows the reviewer neither the reporter nor the patient', async () => {
    const member = nurse()
    serve({
      [SESSION]: [sessionAt(member, [member])],
      [ME]: [() => json(reporterMe())],
      [READ]: [() => json(record(reviewerCard(), [], [{ kind: 'reported', at: '2026-12-03T09:02:00.000Z', byMembershipId: null,
        fromStatus: null, toStatus: 'reported', reason: null, text: null, actionId: null, changes: null }]))],
      [STAFF]: [() => json(staffNames())],
    })
    await openStaffApp(`/provider/quality/${INCIDENT}`)
    expect(await screen.findByText('Not shown to reviewers')).toBeDefined()
    expect(screen.getByText('A patient is linked to this report. Only quality leads and administrators see who.')).toBeDefined()
    expect(screen.queryByText('Tunde Fictional')).toBeNull()
    expect(screen.queryByText('Bola Reporter')).toBeNull()
    expect(screen.getByRole('button', { name: 'Change investigation' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull()
  })

  it('assigns a reviewer chosen by name from the facility’s staff, with the card’s row version', async () => {
    const member = admin()
    const assigned = card({ status: 'assigned', investigation: null, reviewerMembershipId: REVIEWER, rowVersion: 2 })
    const sent = serve({
      [SESSION]: [sessionAt(member, [member])],
      [ME]: [() => json(me())],
      [READ]: [() => json(record(card({ status: 'reported', reviewerMembershipId: null, assignedAt: null, investigation: null, rowVersion: 1,
        can: { assign: true, investigate: false, addAction: false, resolve: false, reopen: false, correct: true } }), [], []))],
      [STAFF]: [() => json(staffNames())],
      [step('assign')]: [() => json({ ...record(assigned, [], []), replayed: false })],
    })
    await openStaffApp(`/provider/quality/${INCIDENT}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Assign reviewer' }))
    const drawer = await screen.findByRole('dialog', { name: 'Assign reviewer' })
    const picker = within(drawer).getByRole('combobox', { name: 'Reviewer' })
    await waitFor(() => expect(within(picker).getByRole('option', { name: 'Chidi Reviewer' })).toBeDefined())
    // Only current members, by name; never a typed id.
    expect(within(picker).queryByRole('option', { name: 'Former Fictional' })).toBeNull()
    expect(within(drawer).queryByRole('textbox')).toBeNull()
    fireEvent.change(picker, { target: { value: REVIEWER } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Assign reviewer' }))
    expect(await screen.findByText('The reviewer is assigned.')).toBeDefined()
    const call = sentTo(sent, step('assign'))[0]!
    expect(call.body).toEqual({ expectedRowVersion: 1, reviewerMembershipId: REVIEWER })
    checkHeaders(call)
    expect(call.headers.get('Idempotency-Key')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reads the incident again when someone else changed it first (412), and says so in plain words', async () => {
    const member = admin()
    const sent = serve({
      [SESSION]: [sessionAt(member, [member])],
      [ME]: [() => json(me())],
      [READ]: [() => json(record()), () => json(record(card({ rowVersion: 6 })))],
      [STAFF]: [() => json(staffNames())],
      [step('investigation')]: [() => problem(412, 'QUALITY_VERSION_CONFLICT', 'Version conflict')],
    })
    await openStaffApp(`/provider/quality/${INCIDENT}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Change investigation' }))
    const drawer = await screen.findByRole('dialog', { name: 'Change investigation' })
    fireEvent.change(within(drawer).getByRole('textbox', { name: 'Findings' }), { target: { value: 'The two strengths were stored on one shelf (fictional).' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save investigation' }))
    expect(await screen.findByText('Someone else changed this incident. Reload it and try again.')).toBeDefined()
    await waitFor(() => expect(sentTo(sent, READ)).toHaveLength(2))
    expect(sentTo(sent, step('investigation'))[0]!.body).toEqual({ expectedRowVersion: 5,
      findings: 'The two strengths were stored on one shelf (fictional).' })
  })

  it('adds a corrective action with an owner and a due date, marks it done, and resolves only once none is open', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-03T10:00:00.000Z'))
    const member = admin()
    const withAction = card({ openActions: 1, rowVersion: 6 })
    const open = { actionId: 'e0000000-0000-4000-8000-00000000b001', description: 'Separate the two strengths (fictional)',
      ownerMembershipId: 'd0000000-0000-4000-8000-0000000000d3', dueDate: '2026-12-20', status: 'open', overdue: false, completedAt: null,
      note: null, createdAt: '2026-12-03T10:00:00.000Z', createdByMembershipId: `member-${REAL_FACILITY}` }
    const sent = serve({
      [SESSION]: [sessionAt(member, [member])],
      [ME]: [() => json(me())],
      [READ]: [() => json(record())],
      [STAFF]: [() => json(staffNames())],
      [step('actions')]: [() => json({ ...record(withAction, [open]), replayed: false }, 201)],
      [`${step('actions')}/${open.actionId}`]: [() => json({ ...record(card({ rowVersion: 7 }), [{ ...open, status: 'done',
        completedAt: '2026-12-03T10:05:00.000Z' }]), replayed: false })],
      [step('resolve')]: [() => json({ ...record(card({ status: 'resolved', rowVersion: 8, can: { assign: false, investigate: false,
        addAction: false, resolve: false, reopen: true, correct: false }, resolution: { text: 'Shelves separated (fictional).',
        resolvedAt: '2026-12-03T10:10:00.000Z', resolvedByMembershipId: `member-${REAL_FACILITY}` } })), replayed: false })],
    })
    await openStaffApp(`/provider/quality/${INCIDENT}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Add corrective action' }))
    let drawer = await screen.findByRole('dialog', { name: 'Add corrective action' })
    fireEvent.change(within(drawer).getByRole('textbox', { name: 'What will be done' }), { target: { value: 'Separate the two strengths (fictional)' } })
    const owner = within(drawer).getByRole('combobox', { name: 'Owner' })
    await waitFor(() => expect(within(owner).getByRole('option', { name: 'Ada Owner' })).toBeDefined())
    fireEvent.change(owner, { target: { value: 'd0000000-0000-4000-8000-0000000000d3' } })
    fireEvent.change(within(drawer).getByLabelText('Due'), { target: { value: '2027-12-20' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add action' }))
    expect(await within(drawer).findByText('Choose a due date from today up to a year ahead.')).toBeDefined()
    fireEvent.change(within(drawer).getByLabelText('Due'), { target: { value: '2026-12-20' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add action' }))
    expect(await screen.findByText('The corrective action is added.')).toBeDefined()
    expect(sentTo(sent, step('actions'))[0]!.body).toEqual({ expectedRowVersion: 5, description: 'Separate the two strengths (fictional)',
      ownerMembershipId: 'd0000000-0000-4000-8000-0000000000d3', dueDate: '2026-12-20' })
    const item = screen.getByRole('listitem', { name: 'Separate the two strengths (fictional)' })
    expect(within(item).getByText('20 Dec 2026')).toBeDefined()

    // Resolve is held while an action is open (Q-QUAL-6 A).
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    drawer = await screen.findByRole('dialog', { name: 'Resolve incident' })
    expect(within(drawer).getByText('Mark every corrective action done or cancelled before resolving.')).toBeDefined()
    expect((within(drawer).getByRole('button', { name: 'Resolve incident' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(drawer).getByRole('button', { name: 'Cancel' }))

    fireEvent.click(within(item).getByRole('button', { name: 'Mark done' }))
    expect(await screen.findByText('The corrective action is marked done.')).toBeDefined()
    expect(sentTo(sent, `${step('actions')}/${open.actionId}`)[0]!.body).toEqual({ expectedRowVersion: 6, status: 'done' })

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    drawer = await screen.findByRole('dialog', { name: 'Resolve incident' })
    fireEvent.change(within(drawer).getByRole('textbox', { name: 'Resolution' }), { target: { value: 'Shelves separated (fictional).' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Resolve incident' }))
    expect(await screen.findByText('The incident is resolved.')).toBeDefined()
    expect(sentTo(sent, step('resolve'))[0]!.body).toEqual({ expectedRowVersion: 7, resolution: 'Shelves separated (fictional).' })
    expect(screen.getByRole('region', { name: 'Resolution' }).textContent).toContain('Resolved 3 Dec 2026, 11:10 by You')
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeDefined()
  })

  it('corrects only what changed, with a reason, and clears the patient link with null', async () => {
    const member = admin()
    const sent = serve({
      [SESSION]: [sessionAt(member, [member])],
      [ME]: [() => json(me())],
      [READ]: [() => json(record())],
      [STAFF]: [() => json(staffNames())],
      [step('correction')]: [() => json({ ...record(card({ harmLevel: 'moderate', patientOrFamilyTold: 'yes', patientLinked: false,
        patient: null, rowVersion: 6 })), replayed: false })],
    })
    await openStaffApp(`/provider/quality/${INCIDENT}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Correct the report' }))
    const drawer = await screen.findByRole('dialog', { name: 'Correct the report' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save correction' }))
    expect(await within(drawer).findByText('Change at least one thing.')).toBeDefined()
    fireEvent.change(within(drawer).getByRole('combobox', { name: 'Harm' }), { target: { value: 'moderate' } })
    fireEvent.change(within(drawer).getByRole('textbox', { name: 'Why it is corrected' }), { target: { value: 'The patient needed extra checks (fictional).' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save correction' }))
    expect(await within(drawer).findByText('For moderate harm, severe harm or death, say whether the patient or family was told.')).toBeDefined()
    fireEvent.change(within(drawer).getByRole('combobox', { name: 'Patient or family told' }), { target: { value: 'yes' } })
    fireEvent.click(within(drawer).getByRole('checkbox', { name: 'Remove the patient link' }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save correction' }))
    expect(await screen.findByText('The correction is saved.')).toBeDefined()
    expect(sentTo(sent, step('correction'))[0]!.body).toEqual({ expectedRowVersion: 5, reason: 'The patient needed extra checks (fictional).',
      harmLevel: 'moderate', patientOrFamilyTold: 'yes', patientId: null })
  })

  it('says an incident the member may not see is not available (404)', async () => {
    const member = nurse()
    serve({
      [SESSION]: [sessionAt(member, [member])],
      [ME]: [() => json(reporterMe())],
      [READ]: [() => problem(404, 'QUALITY_INCIDENT_NOT_FOUND', 'Not found')],
    })
    await openStaffApp(`/provider/quality/${INCIDENT}`)
    expect(await screen.findByText('This incident report is not available.')).toBeDefined()
  })
})
