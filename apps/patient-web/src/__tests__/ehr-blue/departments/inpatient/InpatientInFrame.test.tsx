import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { REAL_FACILITY, SESSION, facility, json, openStaffApp, problem, serve, sessionAt, where, type Sent } from '../../frame/blueHarness'
import {
  ADMISSION, ADMISSIONS, ADMISSION_THREE, ADMISSION_TWO, BED_1, BED_4, BOARD, DOCTOR, NURSE, RECORD, WARDS, WARD_FEMALE, WARD_ICU, WARD_MALE,
  action, card, listOf, many, movement, noIdentityInAddresses, recordOf, waiting, ward, withInpatientPages, written,
} from './fixtures'

/*
 * Inpatient / Wards and ICU (hid-system ADT-1, 0170-0173) inside the blue EHR's real frame, in place of Akos's samples:
 * listed under "Wards & units" for the roles the backend lets use them, reading and changing admissions with the
 * contract's bodies and headers, every write with an Idempotency-Key and the row version it read, names under Q190 A,
 * Lagos time whatever the device's zone, and never a Health ID, NIN or name in an address. Fictional data only.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => { withInpatientPages() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const nav = () => screen.getByRole('navigation', { name: 'Main navigation' })
const sentTo = (sent: readonly Sent[], route: string) => sent.filter(call => call.route === route)
function checkHeaders(call: Sent, purpose = 'direct-care') {
  expect(call.headers.get('X-Purpose-Of-Use')).toBe(purpose)
  expect(call.headers.get('X-Facility-ID')).toBe(REAL_FACILITY)
}

describe('Inpatient / Wards in the frame', () => {
  it('lists waiting, admitted and today’s discharges with names under Q190 A, Lagos time, the NIN words and the staff-only line', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    const sent = serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      [ADMISSIONS]: [listOf(
        waiting({ admissionId: ADMISSION_TWO, fullName: null, nameHidden: true, initials: 'S P', sex: 'male', dateOfBirth: null,
          healthIdLast4: null, ninStatus: 'not_verified', ageYears: 41, reason: null, reasonHidden: false, careTeam: null }),
        card(),
        card({ admissionId: ADMISSION_THREE, fullName: 'Bola Leftone', status: 'discharged',
          discharge: { outcome: 'routine', dischargedAt: '2026-12-03T10:00:00.000Z', dischargedByMembershipId: null, summaryNoteId: null,
            referredToFacilityName: null, diedAt: null } }),
      )],
    })
    await openStaffApp('/provider/inpatient')
    expect(await screen.findByRole('heading', { level: 1, name: 'Inpatient / Wards' })).toBeDefined()
    for (const label of ['Inpatient / Wards', 'Wards & Beds', 'ICU']) expect(within(nav()).getByRole('link', { name: label })).toBeDefined()
    expect(within(nav()).queryByRole('link', { name: 'Ward configuration' })).toBeNull()
    expect(screen.getByText('Do not show this list on a screen patients or visitors can see.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'New admission' })).toBeNull()

    const waitingList = await screen.findByRole('list', { name: 'Waiting for a bed (1)' })
    const hidden = within(waitingList).getByRole('listitem', { name: 'S P' })
    expect(within(hidden).getByText('Name hidden')).toBeDefined()
    expect(within(hidden).getByText('Male · 41 years')).toBeDefined()
    expect(within(hidden).getByText('NIN Not Verified')).toBeDefined()
    expect(within(hidden).getByText('Waiting for a bed')).toBeDefined()
    // 21:00 UTC is 22:00 in Lagos, whatever the device's zone.
    expect(within(hidden).getByText('1 Dec 2026, 22:00')).toBeDefined()

    const wards = screen.getByRole('list', { name: 'On the wards (1)' })
    const ada = within(wards).getByRole('listitem', { name: 'Ada Wardone' })
    expect(within(ada).getByText('NIN Verified')).toBeDefined()
    expect(within(ada).getByLabelText('Health ID ending WW12').textContent).toBe('•••• WW12')
    expect(within(ada).getByText('Female Medical Ward, Bed 4')).toBeDefined()
    // 23:30 UTC on 1 Dec is 00:30 on 2 Dec in Lagos.
    expect(within(ada).getByText('2 Dec 2026, 00:30 (Day 3)')).toBeDefined()
    expect(within(ada).getByRole('link', { name: 'Ada Wardone' }).getAttribute('href')).toBe(`/provider/inpatient/${ADMISSION}`)
    expect(within(screen.getByRole('list', { name: 'Discharged or cancelled today (1)' })).getByText('Discharged')).toBeDefined()
    expect(document.body.textContent).not.toMatch(/discharge_ready|requested_|permission/i)
    checkHeaders(sentTo(sent, ADMISSIONS)[0]!)
    noIdentityInAddresses()
  })

  it('offers a doctor New admission, which first asks for the patient’s record to be opened', async () => {
    const doctor = facility(REAL_FACILITY, 'Fictional Hospital', DOCTOR, ['doctor'])
    serve({ [SESSION]: [sessionAt(doctor, [doctor])], [ADMISSIONS]: [listOf()] })
    await openStaffApp('/provider/inpatient')
    fireEvent.click(await screen.findByRole('button', { name: 'New admission' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'New admission' })).toBeDefined()
    expect(where()).toBe('/provider/inpatient/new')
    expect(screen.getByText('Open the patient’s record first')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Patients' }).getAttribute('href')).toBe('/provider/patients')
  })

  it('reads the list again with the chosen filter', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    const sent = serve({ [SESSION]: [sessionAt(nurse, [nurse])], [ADMISSIONS]: [listOf(card()), listOf()] })
    await openStaffApp('/provider/inpatient')
    await screen.findByRole('list', { name: 'On the wards (1)' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Show' }), { target: { value: 'discharged' } })
    expect(await screen.findByText('No admissions to show.')).toBeDefined()
    await waitFor(() => expect(sentTo(sent, ADMISSIONS)).toHaveLength(2))
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url)).some(url => url.includes('status=discharged'))).toBe(true)
  })

  it('is not listed for lab staff or the front desk, and its address says who can use it without reading', async () => {
    const lab = facility(REAL_FACILITY, 'Fictional Hospital', ['ehr.encounter.read', 'lab.work-item.read'], ['lab_scientist'])
    const sent = serve({ [SESSION]: [sessionAt(lab, [lab])] })
    await openStaffApp('/provider/inpatient')
    expect(await screen.findByText('Only nurses, clinicians and doctors of this facility can use the wards.')).toBeDefined()
    for (const label of ['Inpatient / Wards', 'Wards & Beds', 'ICU', 'Ward configuration']) {
      expect(within(nav()).queryByRole('link', { name: label })).toBeNull()
    }
    expect(sent.filter(call => call.route.includes('/admissions') || call.route.includes('/wards'))).toEqual([])
  })

  it('says inpatient care is not switched on yet (503), and stops listing the four pages', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      // The client may ask again after a 503: every answer says the same.
      [ADMISSIONS]: many(() => problem(503, 'INPATIENT_NOT_AVAILABLE', 'Service unavailable')),
    })
    await openStaffApp('/provider/inpatient')
    expect(await screen.findByText('Inpatient care is not switched on yet.')).toBeDefined()
    await waitFor(() => expect(within(nav()).queryByRole('link', { name: 'Inpatient / Wards' })).toBeNull())
    expect(within(nav()).queryByRole('link', { name: 'Wards & Beds' })).toBeNull()
    expect(within(nav()).queryByRole('link', { name: 'ICU' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Show' })).toBeNull()
  })

  it('says an ehr-api without inpatient care (404) is not switched on yet, and a guard’s 403 in plain words', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      [ADMISSIONS]: [() => problem(403, 'INPATIENT_NOT_ALLOWED', 'x'), () => problem(404, 'NOT_FOUND', 'Cannot GET /api/v1/ehr/admissions')],
    })
    await openStaffApp('/provider/inpatient')
    expect(await screen.findByText('Only nurses, clinicians and doctors of this facility can use the wards.')).toBeDefined()
    expect(document.body.textContent).not.toMatch(/permission/i)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('Inpatient care is not switched on yet.')).toBeDefined()
  })
})

describe('an admission’s record', () => {
  const freeWards = () => json({ items: [
    { ...ward(WARD_MALE, 'Male Ward', { takes: 'male' }), beds: [{ bedId: BED_1, name: 'Bed 1', kind: 'bed', status: 'available', active: true, rowVersion: 1 }] },
    { ...ward(WARD_FEMALE, 'Female Medical Ward', { takes: 'female' }), beds: [
      { bedId: BED_4, name: 'Bed 4', kind: 'bed', status: 'available', active: true, rowVersion: 2 },
      { bedId: 'c0000000-0000-4000-8000-0000000000c5', name: 'Bed 5', kind: 'bed', status: 'cleaning', active: true, rowVersion: 2 }] },
  ] })

  it('admits a man to a women’s ward only once confirmed, then prints the wristband with the Health ID on paper only', async () => {
    const print = vi.fn()
    vi.stubGlobal('print', print)
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    const man = waiting({ fullName: 'Tunde Wardtwo', sex: 'male', rowVersion: 3 })
    const admitted = card({ fullName: 'Tunde Wardtwo', sex: 'male', rowVersion: 4 })
    const sent = serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      [RECORD]: [recordOf(man, [movement('requested')]), recordOf(admitted, [movement('requested'), movement('admitted')]),
        recordOf(admitted, [movement('requested'), movement('admitted'), movement('wristband_printed', { printNumber: 1 })])],
      [WARDS]: [freeWards],
      [action('admit')]: [() => problem(409, 'WARD_SEX_MISMATCH', 'x'), written(admitted)],
      [action('wristband')]: [() => json({ fullName: 'Tunde Wardtwo', unknownLabel: null, sex: 'male', dateOfBirth: '1972-05-14',
        ageEstimated: false, healthId: 'HID-FICT0042', admissionNumber: 'A-2026-000123', facilityName: 'Fictional Hospital',
        wardName: 'Female Medical Ward', allergyAlert: true, barcode: 'A-2026-000123', pairCode: null, printNumber: 1,
        printedAt: '2026-12-03T09:00:00.000Z', replayed: false })],
    })
    await openStaffApp(`/provider/inpatient/${ADMISSION}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Tunde Wardtwo' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Discharge patient' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Admit and allocate bed' }))
    const bed = await screen.findByRole('combobox', { name: 'Bed' })
    // The ward asked for first; a bed being cleaned is not offered.
    expect(within(bed).getAllByRole('option').map(option => option.textContent))
      .toEqual(['Choose a bed', 'Bed 4 (Female Medical Ward)', 'Bed 1 (Male Ward)'])
    fireEvent.change(bed, { target: { value: BED_4 } })
    fireEvent.click(screen.getByRole('button', { name: 'Admit to this bed' }))
    expect(await screen.findByText('Confirm that this patient may go on this ward.')).toBeDefined()
    expect(sentTo(sent, action('admit'))).toEqual([])
    fireEvent.click(screen.getByRole('checkbox', { name: /Female Medical Ward takes women only/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Admit to this bed' }))
    // The server asks again (its own check): the confirmation is sent, then it admits.
    await waitFor(() => expect(sentTo(sent, action('admit'))).toHaveLength(1))
    fireEvent.click(await screen.findByRole('button', { name: 'Admit to this bed' }))
    expect(await screen.findByText('Tunde Wardtwo is admitted to Female Medical Ward, Bed 4.')).toBeDefined()
    const admits = sentTo(sent, action('admit'))
    expect(admits.map(call => call.body)).toEqual([
      { expectedRowVersion: 3, bedId: BED_4, confirmSexMismatch: true }, { expectedRowVersion: 3, bedId: BED_4, confirmSexMismatch: true }])
    checkHeaders(admits[0]!)
    // The same request sent again keeps its key, so the server answers it once.
    expect(admits[0]!.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)
    expect(admits[1]!.headers.get('Idempotency-Key')).toBe(admits[0]!.headers.get('Idempotency-Key'))

    await act(async () => { fireEvent.click(within(document.getElementById('admission-notice')!).getByRole('button', { name: 'Print wristband' })) })
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
    const band = document.querySelector('[data-inpatient-print="band"]')!
    expect(band.textContent).toContain('HID-FICT0042')
    expect(band.textContent).toContain('Allergy: check the chart')
    expect(sentTo(sent, action('wristband'))[0]!.body).toEqual({})
    await act(async () => { window.dispatchEvent(new Event('afterprint')) })
    // Printed and let go: the Health ID is nowhere on the page, in an address or in storage.
    expect(document.querySelector('[data-inpatient-print]')).toBeNull()
    expect(document.body.innerHTML).not.toContain('HID-FICT0042')
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('HID-FICT0042')
    expect(await screen.findByRole('button', { name: 'Print wristband again' })).toBeDefined()
    noIdentityInAddresses()
  })

  it('asks why a band is printed again', async () => {
    vi.stubGlobal('print', vi.fn())
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    const sent = serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      [RECORD]: many(recordOf(card(), [movement('admitted'), movement('wristband_printed', { printNumber: 1 })]), 3),
      [action('wristband')]: [() => problem(400, 'REPRINT_REASON_REQUIRED', 'x')],
    })
    await openStaffApp(`/provider/inpatient/${ADMISSION}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Print wristband again' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Print wristband' }).at(-1)!)
    expect(await screen.findByText('Say why the band is being printed again.')).toBeDefined()
    expect(sentTo(sent, action('wristband'))).toEqual([])
    fireEvent.change(screen.getByRole('combobox', { name: 'Why is it printed again?' }), { target: { value: 'damaged' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Print wristband' }).at(-1)!)
    await waitFor(() => expect(sentTo(sent, action('wristband'))).toHaveLength(1))
    expect(sentTo(sent, action('wristband'))[0]!.body).toEqual({ reprintReason: 'damaged' })
    expect(await screen.findByText('Say why the band is being printed again.')).toBeDefined()
    expect(screen.getByText('Wristband printed')).toBeDefined()
  })

  it('moves a patient, and on a change someone else made first says so and reads the record again', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    const sent = serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      [RECORD]: [recordOf(card({ sex: 'female' })), recordOf(card({ rowVersion: 5 })), recordOf(card({ rowVersion: 6, bedName: 'Bed 1', wardName: 'Male Ward' }))],
      [WARDS]: [freeWards, freeWards],
      [action('transfer')]: [() => problem(412, 'ADMISSION_VERSION_CONFLICT', 'x'),
        written(card({ rowVersion: 6, bedId: BED_1, bedName: 'Bed 1', wardName: 'Male Ward' }))],
    })
    await openStaffApp(`/provider/inpatient/${ADMISSION}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Transfer bed' }))
    // The chart is not open in this session: no handover box.
    expect(await screen.findByText('To write a nursing handover with the move, open this patient’s record first.')).toBeDefined()
    const bed = await screen.findByRole('combobox', { name: 'Move to' })
    // The current bed is never offered.
    expect(within(bed).queryByRole('option', { name: 'Bed 4 (Female Medical Ward)' })).toBeNull()
    fireEvent.change(bed, { target: { value: BED_1 } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Male Ward takes men only/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Move patient' }))
    expect(await screen.findByText('Someone else changed this. Reload it and try again.')).toBeDefined()
    await waitFor(() => expect(sentTo(sent, RECORD)).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: 'Transfer bed' }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Move to' }), { target: { value: BED_1 } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Male Ward takes men only/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Move patient' }))
    expect(await screen.findByText('Ada Wardone has moved to Male Ward, Bed 1. The old bed is marked for cleaning.')).toBeDefined()
    const moves = sentTo(sent, action('transfer'))
    expect(moves[0]!.body).toEqual({ expectedRowVersion: 3, bedId: BED_1, confirmSexMismatch: true })
    expect(moves[1]!.body).toEqual({ expectedRowVersion: 5, bedId: BED_1, confirmSexMismatch: true })
  })

  it('lets a doctor prepare the discharge, then discharge with a signed summary, and prints it with the last 4 characters only', async () => {
    const print = vi.fn()
    vi.stubGlobal('print', print)
    const doctor = facility(REAL_FACILITY, 'Fictional Hospital', DOCTOR, ['doctor'])
    const ready = card({ status: 'discharge_ready', dischargeReady: true, preparedAt: '2026-12-03T08:00:00.000Z', rowVersion: 5 })
    const done = card({ status: 'discharged', rowVersion: 6, discharge: { outcome: 'routine', dischargedAt: '2026-12-03T11:00:00.000Z',
      dischargedByMembershipId: null, summaryNoteId: 'n0000000-0000-4000-8000-000000000001', referredToFacilityName: null, diedAt: null } })
    const sent = serve({
      [SESSION]: [sessionAt(doctor, [doctor])],
      [RECORD]: [recordOf(), recordOf(ready), recordOf(done), recordOf(done)],
      [`GET /api/v1/ehr/patients/b0000000-0000-4000-8000-0000000000b1/encounters/e0000000-0000-4000-8000-0000000000e1/prescriptions`]: [
        () => json({ items: [
          { id: 'p0000000-0000-4000-8000-000000000001', patientId: 'x', encounterId: 'x', createdAt: '', status: 'active', medicationDisplay: 'Amoxicillin 500 mg', frequency: 'Three times a day' },
          { id: 'p0000000-0000-4000-8000-000000000002', patientId: 'x', encounterId: 'x', createdAt: '', status: 'cancelled', medicationDisplay: 'Old order' },
        ], nextCursor: null })],
      [action('prepare-discharge')]: [written(ready)],
      [action('discharge')]: [written(done, { summaryNoteId: 'n0000000-0000-4000-8000-000000000001' })],
      [`GET /api/v1/ehr/admissions/${ADMISSION}/discharge-summary`]: [() => json({
        facility: { name: 'Fictional Hospital', address: '1 Fiction Road, Lagos', phone: '+2348031234567' },
        patient: { fullName: 'Ada Wardone', sex: 'female', dateOfBirth: '1972-05-14', dateOfBirthEstimated: false, healthId: null,
          healthIdLast4: 'WW12', ninStatus: 'verified' },
        admissionNumber: 'A-2026-000123', admittedAt: '2026-12-01T23:30:00.000Z', dischargedAt: '2026-12-03T11:00:00.000Z',
        wards: ['Female Medical Ward'], responsibleDoctor: 'Dr Demo Fiction', outcome: 'routine', referredToFacilityName: null, diedAt: null,
        summary: { presentingProblem: 'Fever and cough', courseInHospital: 'Improved on antibiotics.', conditionAtDischarge: 'improved' },
        diagnoses: [{ display: 'Pneumonia', code: 'J18.9', codeSystem: 'ICD-10' }],
        medicinesOnDischarge: [{ prescriptionId: 'p1', medicationDisplay: 'Amoxicillin', strength: '500 mg', doseForm: 'capsule', dose: '1 capsule',
          frequency: 'Three times a day', duration: '5 days' }],
        signedBy: 'Dr Demo Fiction', signedAt: '2026-12-03T11:00:00.000Z', printedAt: '2026-12-03T11:05:00.000Z' })],
    })
    await openStaffApp(`/provider/inpatient/${ADMISSION}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Prepare discharge' }))
    const medicine = await screen.findByRole('checkbox', { name: 'Amoxicillin 500 mg · Three times a day' })
    expect(screen.queryByRole('checkbox', { name: /Old order/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save discharge plan' }))
    expect(await screen.findByText('Enter the follow-up plan.')).toBeDefined()
    fireEvent.change(screen.getByRole('textbox', { name: 'Follow-up plan' }), { target: { value: 'Clinic in 2 weeks.' } })
    fireEvent.change(screen.getByLabelText('Expected discharge date (optional)'), { target: { value: '2026-12-04' } })
    fireEvent.click(medicine)
    fireEvent.click(screen.getByRole('button', { name: 'Save discharge plan' }))
    expect(await screen.findByText('Ada Wardone’s discharge is prepared.')).toBeDefined()
    expect(sentTo(sent, action('prepare-discharge'))[0]!.body).toEqual({ expectedRowVersion: 3, followUpPlan: 'Clinic in 2 weeks.',
      expectedDischargeOn: '2026-12-04', dischargeMedicineIds: ['p0000000-0000-4000-8000-000000000001'] })

    fireEvent.click(await screen.findByRole('button', { name: 'Discharge patient' }))
    expect(screen.getByRole('radio', { name: 'Routine discharge' })).toHaveProperty('checked', true)
    expect(screen.getByText('A discharge never waits for the bill. Any balance stays on the bill after the patient leaves.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Sign and discharge' }))
    expect(await screen.findByText('Enter the presenting problem.')).toBeDefined()
    fireEvent.change(screen.getByRole('textbox', { name: 'Presenting problem' }), { target: { value: 'Fever and cough' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Course in hospital' }), { target: { value: 'Improved on antibiotics.' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Condition at discharge (optional)' }), { target: { value: 'improved' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign and discharge' }))
    expect(await screen.findByText('Type SIGN to sign.')).toBeDefined()
    fireEvent.change(screen.getByRole('textbox', { name: 'Type SIGN to sign the discharge' }), { target: { value: 'SIGN' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign and discharge' }))
    expect(await screen.findByText('Ada Wardone is discharged: routine discharge.')).toBeDefined()
    const discharge = sentTo(sent, action('discharge'))[0]!
    expect(discharge.body).toEqual({ expectedRowVersion: 5, outcome: 'routine', signature: 'SIGN',
      summary: { presentingProblem: 'Fever and cough', courseInHospital: 'Improved on antibiotics.', conditionAtDischarge: 'improved' } })
    checkHeaders(discharge)

    await act(async () => { fireEvent.click(within(document.getElementById('admission-notice')!).getByRole('button', { name: 'Print discharge summary' })) })
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
    const paper = document.querySelector('[data-inpatient-print="discharge"]')!
    for (const words of ['Discharge summary', 'Ada Wardone', 'WW12', 'NIN Verified', 'A-2026-000123', '2 Dec 2026, 00:30', '3 Dec 2026, 12:00',
      'Routine discharge', 'Pneumonia (ICD-10 J18.9)', 'Amoxicillin 500 mg capsule', '1 capsule · Three times a day · for 5 days',
      'Dr Demo Fiction', 'Improved', '0803 123 4567']) {
      expect(paper.textContent).toContain(words)
    }
    expect(paper.textContent).not.toMatch(/HID-/)
    await act(async () => { window.dispatchEvent(new Event('afterprint')) })
    expect(document.querySelector('[data-inpatient-print]')).toBeNull()
  })

  it('records a death with its time and says the death certificate is not switched on yet', async () => {
    const doctor = facility(REAL_FACILITY, 'Fictional Hospital', DOCTOR, ['doctor'])
    const died = card({ status: 'discharged', rowVersion: 4, discharge: { outcome: 'died', dischargedAt: '2026-11-20T05:00:00.000Z',
      dischargedByMembershipId: null, summaryNoteId: null, referredToFacilityName: null, diedAt: '2026-11-20T04:40:00.000Z' } })
    const sent = serve({
      [SESSION]: [sessionAt(doctor, [doctor])],
      [RECORD]: [recordOf(), recordOf(died)],
      [action('discharge')]: [() => problem(400, 'DIED_AT_REQUIRED', 'x'), written(died)],
    })
    await openStaffApp(`/provider/inpatient/${ADMISSION}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Discharge patient' }))
    // Not prepared yet: routine and referred out wait for Prepare discharge.
    expect(screen.getByRole('radio', { name: 'Routine discharge (prepare the discharge first)' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('radio', { name: 'Died' }))
    fireEvent.change(screen.getByLabelText('Time of death'), { target: { value: '2026-11-20T05:40' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Type SIGN to sign the discharge' }), { target: { value: 'SIGN' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign and discharge' }))
    await waitFor(() => expect(sentTo(sent, action('discharge'))).toHaveLength(1))
    expect(await screen.findByText('Enter the time of death.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Sign and discharge' }))
    expect(await screen.findByText('Ada Wardone is discharged: died.')).toBeDefined()
    expect(sentTo(sent, action('discharge'))[1]!.body).toEqual({ expectedRowVersion: 3, outcome: 'died', signature: 'SIGN', diedAt: '2026-11-20T04:40:00.000Z' })
    expect(await screen.findByText('The death certificate is not switched on yet. The outcome and time of death are recorded.')).toBeDefined()
    expect(screen.getByText('20 Nov 2026, 05:40')).toBeDefined()
    // No death record route is ever called (Q188 A: built but off).
    expect(sent.filter(call => call.route.includes('death-record'))).toEqual([])
  })

  it('cancels a request with a reason, and changes the details a doctor may change', async () => {
    const doctor = facility(REAL_FACILITY, 'Fictional Hospital', DOCTOR, ['doctor'])
    const request = waiting({ responsibleMembershipId: 'm0000000-0000-4000-8000-0000000000ff' })
    const sent = serve({
      [SESSION]: [sessionAt(doctor, [doctor])],
      [RECORD]: [recordOf(request), recordOf(waiting({ rowVersion: 4 })), recordOf(waiting({ status: 'cancelled', rowVersion: 5, cancelledAt: '2026-12-03T09:00:00.000Z' }))],
      [`PATCH /api/v1/ehr/admissions/${ADMISSION}`]: [written(waiting({ rowVersion: 4, careTeam: 'Medical team B' }))],
      [action('cancel')]: [written(waiting({ status: 'cancelled', rowVersion: 5, cancelledAt: '2026-12-03T09:00:00.000Z' }))],
    })
    await openStaffApp(`/provider/inpatient/${ADMISSION}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Change details' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Care team' }), { target: { value: 'Medical team B' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Make me the responsible doctor' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Ada Wardone’s admission is updated.')).toBeDefined()
    expect(sentTo(sent, `PATCH /api/v1/ehr/admissions/${ADMISSION}`)[0]!.body).toEqual({ expectedRowVersion: 3, careTeam: 'Medical team B',
      responsibleMembershipId: `member-${REAL_FACILITY}` })

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel request' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Why is the request cancelled?' }), { target: { value: 'short' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel request' }).at(-1)!)
    expect(await screen.findByText('Say why in at least 8 characters, and at most 500.')).toBeDefined()
    fireEvent.change(screen.getByRole('textbox', { name: 'Why is the request cancelled?' }), { target: { value: 'Treated as an outpatient instead.' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel request' }).at(-1)!)
    expect(await screen.findByText('Ada Wardone’s admission request is cancelled.')).toBeDefined()
    expect(sentTo(sent, action('cancel'))[0]!.body).toEqual({ expectedRowVersion: 4, reason: 'Treated as an outpatient instead.' })
  })

  it('reads a handover only on request, and says an admission of another facility is not here', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    const moved = movement('transferred', { handoverRecorded: true, movementId: 'f0000000-0000-4000-8000-000000000777' })
    serve({
      [SESSION]: [sessionAt(nurse, [nurse]), sessionAt(nurse, [nurse])],
      [RECORD]: [recordOf(card(), [moved])],
      [`GET /api/v1/ehr/admissions/${ADMISSION}/movements/f0000000-0000-4000-8000-000000000777/handover`]: [
        () => json({ movementId: moved.movementId, handover: 'Oxygen weaned to room air.', at: moved.at, byMembershipId: null })],
      [`GET /api/v1/ehr/admissions/${ADMISSION_TWO}`]: [() => problem(404, 'ADMISSION_NOT_FOUND', 'x')],
    })
    const view = await openStaffApp(`/provider/inpatient/${ADMISSION}`)
    expect(await screen.findByText('Moved bed')).toBeDefined()
    expect(screen.queryByText(/Oxygen weaned/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Read the handover' }))
    expect(await screen.findByText('Handover: Oxygen weaned to room air.')).toBeDefined()
    view.unmount()
    await openStaffApp(`/provider/inpatient/${ADMISSION_TWO}`)
    expect(await screen.findByText('This ward, bed or admission is not at this facility.')).toBeDefined()
  })
})

describe('ICU', () => {
  it('shows the ICU wards’ beds and admissions (ICU is a ward type), and links records under ICU', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    const sent = serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      [ADMISSIONS]: [listOf(card({ wardName: 'ICU A', bedName: 'ICU bed 2', wardId: WARD_ICU }))],
      [BOARD]: [() => json({ wards: [{ wardId: WARD_ICU, name: 'ICU A', wardType: 'icu', takes: 'any', active: true, beds: [
        { bedId: BED_4, name: 'ICU bed 2', kind: 'bed', status: 'occupied', statusSince: '2026-12-01T23:30:00.000Z', rowVersion: 2,
          patient: card({ wardName: 'ICU A', bedName: 'ICU bed 2' }) },
        { bedId: BED_1, name: 'ICU bed 3', kind: 'bed', status: 'cleaning', statusSince: '2026-12-03T07:00:00.000Z', rowVersion: 2, patient: null },
      ] }], waitingForBed: [] })],
    })
    await openStaffApp('/provider/icu')
    expect(await screen.findByRole('heading', { level: 1, name: 'ICU' })).toBeDefined()
    const beds = await screen.findByRole('list', { name: 'ICU A: 1 of 2 beds occupied' })
    const occupied = within(beds).getByRole('listitem', { name: 'ICU bed 2' })
    expect(within(occupied).getByRole('link', { name: 'Ada Wardone' }).getAttribute('href')).toBe(`/provider/icu/${ADMISSION}`)
    expect(within(beds).getByRole('listitem', { name: 'ICU bed 3' }).textContent).toContain('Since 3 Dec 2026, 08:00')
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url))
    expect(urls.some(url => url.includes('/bed-board') && url.includes('wardType=icu'))).toBe(true)
    expect(urls.some(url => url.includes('/admissions') && url.includes('wardType=icu'))).toBe(true)
    checkHeaders(sentTo(sent, BOARD)[0]!)
    expect(screen.queryByRole('button', { name: 'New admission' })).toBeNull()
  })

  it('says when the facility has no ICU ward yet', async () => {
    const nurse = facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
    serve({ [SESSION]: [sessionAt(nurse, [nurse])], [ADMISSIONS]: [listOf()], [BOARD]: [() => json({ wards: [], waitingForBed: [] })] })
    await openStaffApp('/provider/icu')
    expect(await screen.findByText('This facility has no ICU ward yet.')).toBeDefined()
    expect(screen.getByText('An admin can add one in Ward configuration.')).toBeDefined()
  })
})
