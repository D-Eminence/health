import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { json, problem, serve, type Sent } from '../../frame/blueHarness'
import { ENCOUNTER, NURSE, PATIENT, REQUEST, WARDS, WARD_FEMALE, ADMISSION, card, ward, waiting } from './fixtures'

/*
 * New admission (hid-system ADT-1 route 10): a doctor or clinician asks for an admission for the patient whose record is
 * open in this session under direct care, from a visit, today's waiting list or directly, with the reason, care team,
 * responsible doctor ("Me"), ward wanted and, for a newborn, the mother's admission. The patient goes by UUID in the
 * body; nothing about them goes in an address. Fictional data only.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
const FACILITY = 'f0000000-0000-4000-8000-000000000001'
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown }))
vi.mock('../../../../staff/App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { id: 'staff-1', displayName: 'Dr Demo Fiction', roles: ['doctor'], permissions: staff.permissions,
      facilities: [], facility: { id: FACILITY, membershipId: 'm0000000-0000-4000-8000-0000000000aa', organizationId: 'o', name: 'Fictional Hospital',
        roles: ['doctor'], permissions: staff.permissions, isPrimary: true } } } },
    lock: null, activePatient: staff.activePatient, setActivePatient: () => true,
  }),
}))

const DOCTOR = [...NURSE, 'ehr.admission.decide', 'ehr.encounter.write']
const open = (purpose = 'direct-care') => ({ hid: 'HID-FICT0042', purpose,
  lookup: { authorization: { decision: 'allow' }, patient: { patientId: PATIENT, hid: 'HID-FICT0042', fullName: 'Ada Wardone' } } })
const ENCOUNTERS = `GET /api/v1/ehr/patients/${PATIENT}/encounters`
const QUEUE = 'GET /api/v1/ehr/visit-queue'

function Where() { return <output data-testid="where">{useLocation().pathname}</output> }
async function renderNew() {
  const { NewAdmission } = await import('../../../../ehr-blue/departments/inpatient/NewAdmission')
  return render(<MemoryRouter initialEntries={['/provider/inpatient/new']}><Where /><div className="hid-ehr"><Routes>
    <Route path="/provider/inpatient/new" element={<NewAdmission facilityId={FACILITY} />} />
    <Route path="*" element={<p>Elsewhere</p>} />
  </Routes></div></MemoryRouter>)
}
const sentTo = (sent: readonly Sent[], route: string) => sent.filter(call => call.route === route)

beforeEach(async () => {
  staff.permissions = DOCTOR
  staff.activePatient = open()
  // The staff client waits for a ready session (the frame sets it once the session is read); this page is shown alone.
  const { setStaffSessionReady } = await import('../../../../staff/session')
  setStaffSessionReady(true)
})
// The staff client takes the fetch of its first request: each test loads it afresh.
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

describe('New admission', () => {
  it('requests an admission for the open patient from a visit, with the reason, team, ward and "Me", and opens it', async () => {
    const sent = serve({
      [WARDS]: [() => json({ items: [ward(WARD_FEMALE, 'Female Medical Ward', { available: 3 }), ward('d0000000-0000-4000-8000-0000000000d7', 'Closed Ward', { active: false })] })],
      [ENCOUNTERS]: [() => json({ items: [
        { id: ENCOUNTER, patientId: PATIENT, facilityId: FACILITY, encounterType: 'ambulatory', status: 'in_progress', startedAt: '2026-11-24T08:00:00.000Z', chiefComplaint: 'Cough', rowVersion: 1 },
        { id: 'e0000000-0000-4000-8000-0000000000e9', patientId: PATIENT, facilityId: FACILITY, encounterType: 'ambulatory', status: 'completed', startedAt: '2026-10-01T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 },
      ], nextCursor: null })],
      [QUEUE]: [() => json({ items: [], hasMore: false, limit: 200 })],
      [REQUEST]: [() => json({ admission: waiting(), replayed: false }, 201)],
    })
    await renderNew()
    expect(screen.getByText('Ada Wardone')).toBeDefined()
    expect(document.body.textContent).not.toContain('HID-FICT0042')
    await waitFor(() => expect(screen.getByRole('radio', { name: /From a visit/ })).toHaveProperty('disabled', false))
    expect(screen.getByRole('radio', { name: /From today’s waiting list \(not on the list\)/ })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('radio', { name: /From a visit/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Request admission' }))
    expect(await screen.findByText('Enter the admission reason.')).toBeDefined()
    fireEvent.change(screen.getByRole('textbox', { name: 'Admission reason' }), { target: { value: 'Community-acquired pneumonia' } })
    fireEvent.click(screen.getByRole('button', { name: 'Request admission' }))
    expect(await screen.findByText('Choose the visit the admission comes from.')).toBeDefined()
    // Only open visits; Lagos time.
    const visit = screen.getByRole('combobox', { name: 'Visit' })
    expect(Array.from((visit as HTMLSelectElement).options, option => option.textContent)).toEqual(['Choose the visit', '24 Nov 2026, 09:00: Cough'])
    fireEvent.change(visit, { target: { value: ENCOUNTER } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Assigned care team (optional)' }), { target: { value: 'Medical team A' } })
    expect(Array.from((screen.getByRole('combobox', { name: 'Ward wanted (optional)' }) as HTMLSelectElement).options, option => option.textContent))
      .toEqual(['Any ward', 'Female Medical Ward (General): 3 free'])
    fireEvent.change(screen.getByRole('combobox', { name: 'Ward wanted (optional)' }), { target: { value: WARD_FEMALE } })
    fireEvent.click(screen.getByRole('button', { name: 'Request admission' }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`/provider/inpatient/${ADMISSION}`))
    const request = sentTo(sent, REQUEST)[0]!
    expect(request.body).toEqual({ patientId: PATIENT, source: 'consultation', fromEncounterId: ENCOUNTER, reason: 'Community-acquired pneumonia',
      careTeam: 'Medical team A', responsibleMembershipId: 'm0000000-0000-4000-8000-0000000000aa', requestedWardId: WARD_FEMALE })
    expect(request.headers.get('X-Purpose-Of-Use')).toBe('direct-care')
    expect(request.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)
    for (const [url] of vi.mocked(fetch).mock.calls) expect(String(url)).not.toMatch(/HID-|Wardone/)
  })

  it('takes the patient’s place on today’s waiting list, and a newborn with the mother’s admission', async () => {
    const sent = serve({
      [WARDS]: [() => json({ items: [] })],
      [ENCOUNTERS]: [() => json({ items: [], nextCursor: null })],
      [QUEUE]: [() => json({ items: [{ entryId: 'q0000000-0000-4000-8000-000000000001', patientId: PATIENT, stage: 'ready' }], hasMore: false, limit: 200 })],
      ['GET /api/v1/ehr/admissions']: [() => json({ items: [card({ admissionId: 'a0000000-0000-4000-8000-0000000000m1', fullName: 'Bisi Mother',
        admissionNumber: 'A-2026-000100' })], hasMore: false, limit: 500 })],
      [REQUEST]: [() => problem(409, 'ADMISSION_ALREADY_OPEN', 'x')],
    })
    await renderNew()
    const fromList = screen.getByRole('radio', { name: /From today’s waiting list/ })
    await waitFor(() => expect(fromList).toHaveProperty('disabled', false))
    fireEvent.click(fromList)
    fireEvent.change(screen.getByRole('textbox', { name: 'Admission reason' }), { target: { value: 'Neonatal jaundice' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /newborn baby/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Request admission' }))
    expect(await screen.findByText('Choose the mother’s admission.')).toBeDefined()
    const mother = screen.getByRole('combobox', { name: 'Mother’s admission' })
    await waitFor(() => expect((mother as HTMLSelectElement).options).toHaveLength(2))
    fireEvent.change(mother, { target: { value: 'a0000000-0000-4000-8000-0000000000m1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Request admission' }))
    expect(await screen.findByText('This patient is already admitted or waiting for a bed here.')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Find their admission on the list' }).getAttribute('href')).toBe('/provider/inpatient')
    expect(sentTo(sent, REQUEST)[0]!.body).toEqual({ patientId: PATIENT, source: 'waiting_list', visitQueueEntryId: 'q0000000-0000-4000-8000-000000000001',
      reason: 'Neonatal jaundice', responsibleMembershipId: 'm0000000-0000-4000-8000-0000000000aa', motherAdmissionId: 'a0000000-0000-4000-8000-0000000000m1' })
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url)).find(url => url.includes('/admissions'))).toContain('wardType=maternity')
  })

  it('needs the patient’s record open under direct care, and is a doctor’s or clinician’s', async () => {
    serve({})
    staff.activePatient = open('emergency')
    const view = await renderNew()
    expect(screen.getByText('Open the patient’s record first')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Request admission' })).toBeNull()
    view.unmount()
    staff.permissions = NURSE
    staff.activePatient = open()
    await renderNew()
    expect(screen.getByText('Only doctors and clinicians can admit, change or discharge a patient.')).toBeDefined()
  })

  it('says a refusal of chart access in plain words', async () => {
    serve({
      [WARDS]: [() => json({ items: [] })], [ENCOUNTERS]: [() => json({ items: [], nextCursor: null })], [QUEUE]: [() => json({ items: [], hasMore: false, limit: 200 })],
      [REQUEST]: [() => problem(403, 'ADMISSION_CHART_ACCESS_REQUIRED', 'x')],
    })
    await renderNew()
    fireEvent.change(screen.getByRole('textbox', { name: 'Admission reason' }), { target: { value: 'Observation after a fall' } })
    fireEvent.click(screen.getByRole('button', { name: 'Request admission' }))
    expect(await screen.findByText('Open this patient’s record first, then try again.')).toBeDefined()
    expect(document.body.textContent).not.toMatch(/permission/i)
  })
})

describe('Transfer bed with the patient’s record open', () => {
  it('offers the nursing handover and sends it with the move', async () => {
    const BED = 'c0000000-0000-4000-8000-0000000000c1'
    const sent = serve({
      [`GET /api/v1/ehr/admissions/${ADMISSION}`]: [() => json({ admission: card(), movements: [] }), () => json({ admission: card({ rowVersion: 4 }), movements: [] })],
      [WARDS]: [() => json({ items: [{ ...ward('d0000000-0000-4000-8000-0000000000d2', 'Ward B'), beds: [
        { bedId: BED, name: 'Bed 1', kind: 'bed', status: 'available', active: true, rowVersion: 1 }] }] })],
      [`POST /api/v1/ehr/admissions/${ADMISSION}/transfer`]: [() => json({ admission: card({ rowVersion: 4 }), replayed: false })],
    })
    const { AdmissionRecordPage } = await import('../../../../ehr-blue/departments/inpatient/AdmissionRecord')
    render(<MemoryRouter><div className="hid-ehr"><AdmissionRecordPage facilityId={FACILITY} admissionId={ADMISSION} base="/provider/inpatient" /></div></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Transfer bed' }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Move to' }), { target: { value: BED } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Nursing handover (optional)' }), { target: { value: ' On 2 L oxygen; review at 14:00. ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move patient' }))
    expect(await screen.findByText('Ada Wardone has moved to Ward B, Bed 1. The old bed is marked for cleaning.')).toBeDefined()
    expect(sentTo(sent, `POST /api/v1/ehr/admissions/${ADMISSION}/transfer`)[0]!.body)
      .toEqual({ expectedRowVersion: 3, bedId: BED, handover: 'On 2 L oxygen; review at 14:00.' })
  })
})
