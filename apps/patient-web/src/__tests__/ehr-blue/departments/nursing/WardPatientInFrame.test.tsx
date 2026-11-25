import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { REAL_FACILITY, SESSION, facility, json, openStaffApp, problem, serve, sessionAt, where } from '../../frame/blueHarness'
import {
  ADMISSION, ADMISSION_READ, CHART, DOCTOR, DOSE, FLUIDS, MAR, NEW_FLUID, NURSE, ORDER, TASKS, VITALS, card, doseRecord, hiddenCard, many,
  noIdentityInAddresses, order, sentTo, task, withNursingPages,
} from './nursingFixtures'

/*
 * One patient's ward chart (hid-system NUR-1 routes 1, 2, 4, 6, 7 and 11-13) inside the blue EHR's real frame: the
 * observation chart with each value's own soft flag and never a score, the medicine administration record with the
 * pharmacy state beside each dose, and fluid balance with unmeasured entries kept out of the totals. Every account,
 * facility, patient and reference is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => withNursingPages())
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const nurse = () => facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])
const BASE = `/provider/ward-patient/${ADMISSION}`

function chartOf(overrides: Record<string, unknown> = {}) {
  return () => json({ admissionId: ADMISSION, encounterId: 'e1', wardType: 'general', from: '2026-12-02T08:00:00.000Z', to: '2026-12-03T08:00:00.000Z',
    readings: [
      { vitalId: 'v1', recordedAt: '2026-12-03T06:00:00.000Z', status: 'recorded', corrected: false,
        values: { systolicMmhg: 90, diastolicMmhg: 60, pulseBpm: 128, oxygenSaturationPercent: 93, oxygenDevice: 'nasal_cannula',
          oxygenFlowLPerMin: 2, painScore: 4, avpu: 'voice', gcsEye: 3, gcsVerbal: 4, gcsMotor: 6, bloodGlucoseMmolL: 7.2 },
        flags: [{ measure: 'pulseBpm', level: 'far_outside_usual' }, { measure: 'oxygenSaturationPercent', level: 'outside_usual' }],
        recordedByMembershipId: `member-${REAL_FACILITY}`, rowVersion: 1 },
      { vitalId: 'v2', recordedAt: '2026-12-03T02:00:00.000Z', status: 'entered_in_error', corrected: false,
        values: { pulseBpm: 190 }, flags: [{ measure: 'pulseBpm', level: 'check_entry' }], recordedByMembershipId: null, rowVersion: 2 },
    ], rangesVersion: '2026-11-adult-1', score: null, ...overrides })
}

describe('the observation chart', () => {
  it('shows each value with its own soft flag in words, MAP and the GCS total, and never a score', async () => {
    const member = nurse()
    const sent = serve({ [SESSION]: [sessionAt(member, [member])], [ADMISSION_READ]: [() => json({ admission: card(), movements: [] })],
      [CHART]: many(chartOf()) })
    await openStaffApp(`${BASE}/observations`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Ada Wardone' })).toBeDefined()
    expect(screen.getByText('Female Medical Ward · A-2026-000123')).toBeDefined()
    expect(screen.getByText('Do not show this list on a screen patients or visitors can see.')).toBeDefined()
    const reading = await screen.findByRole('listitem', { name: '3 Dec 2026, 07:00' })
    expect(within(reading).getByText('90/60 mmHg (MAP 70)')).toBeDefined()
    expect(within(reading).getByText('Far outside the usual range')).toBeDefined()
    expect(within(reading).getByText('Outside the usual range')).toBeDefined()
    expect(within(reading).getByText('Nasal cannula (2 L/min)')).toBeDefined()
    expect(within(reading).getByText('E3 V4 M6 (13)')).toBeDefined()
    expect(within(reading).getByText('Responds to voice')).toBeDefined()
    expect(within(reading).getByText('7.2 mmol/L')).toBeDefined()
    expect(within(reading).getByText('You')).toBeDefined()
    // A reading entered in error is shown with its status and no flag.
    const wrong = screen.getByRole('listitem', { name: '3 Dec 2026, 03:00' })
    expect(within(wrong).getByText('Entered in error')).toBeDefined()
    expect(within(wrong).queryByText('Check this entry')).toBeNull()
    expect(screen.getByText(/No early-warning score is worked out/)).toBeDefined()
    expect(document.body.textContent).not.toMatch(/NEWS|score:|far_outside_usual/)
    const tabs = screen.getByRole('navigation', { name: 'Ward chart' })
    expect(within(tabs).getAllByRole('link').map(link => link.textContent)).toEqual(['Observations', 'Medicines', 'Fluid balance', 'Tasks'])
    expect(sentTo(sent, CHART)[0]!.headers.get('X-Purpose-Of-Use')).toBe('direct-care')
    noIdentityInAddresses()
  })

  it('asks for the hourly grid on a general ward, and shows the ICU grid with fluid and running balance', async () => {
    const member = nurse()
    serve({ [SESSION]: [sessionAt(member, [member])], [ADMISSION_READ]: [() => json({ admission: card(), movements: [] })],
      [CHART]: [chartOf(), ...many(chartOf({ hours: [{ hourStart: '2026-12-03T06:00:00.000Z', readingIds: ['v1'], fluidInMl: 120, fluidOutMl: 300, runningBalanceMl: -180 }] }))] })
    await openStaffApp(`${BASE}/observations`)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Hourly grid' }))
    const grid = await screen.findByRole('region', { name: 'Hours' })
    expect(within(grid).getByText('07:00')).toBeDefined()
    expect(within(grid).getByText('−180 mL')).toBeDefined()
    expect(vi.mocked(fetch).mock.calls.some(([address]) => String(address).includes('view=hourly'))).toBe(true)
  })

  it('records observations with the new fields on the stay’s visit, and checks the oxygen and GCS rules first', async () => {
    const member = nurse()
    const sent = serve({ [SESSION]: [sessionAt(member, [member])], [ADMISSION_READ]: [() => json({ admission: card(), movements: [] })],
      [CHART]: many(chartOf({ readings: [] })),
      [VITALS]: [() => problem(400, 'NURSING_FIELDS_NOT_AVAILABLE', 'Bad request'), () => json({ id: 'v9', warnings: [] }, 201)] })
    await openStaffApp(`${BASE}/observations`)
    expect(await screen.findByText('No observations yet')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Record observations' }))
    const form = screen.getByRole('form', { name: 'Record observations' })
    fireEvent.change(within(form).getByLabelText('Time (Lagos time)'), { target: { value: '2026-12-03T10:15' } })
    fireEvent.change(within(form).getByLabelText('Oxygen'), { target: { value: 'simple_mask' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save observations' }))
    expect(await within(form).findByText('Enter the flow or FiO2 with an oxygen device, or 21% on room air.')).toBeDefined()
    fireEvent.change(within(form).getByLabelText('Oxygen flow (L a minute)'), { target: { value: '6' } })
    fireEvent.change(within(form).getByLabelText('GCS eye (1 to 4)'), { target: { value: '4' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save observations' }))
    expect(await within(form).findByText('Enter all three GCS parts, or mark the verbal part as not testable.')).toBeDefined()
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Verbal not testable (VT)' }))
    fireEvent.change(within(form).getByLabelText('GCS motor (1 to 6)'), { target: { value: '5' } })
    fireEvent.change(within(form).getByLabelText('Pain (0 to 10)'), { target: { value: '3' } })
    expect(sentTo(sent, VITALS)).toHaveLength(0)
    fireEvent.click(within(form).getByRole('button', { name: 'Save observations' }))
    expect(await within(form).findByText(/These fields are not switched on yet/)).toBeDefined()
    fireEvent.click(within(form).getByRole('button', { name: 'Save observations' }))
    expect(await screen.findByText('Observations saved.')).toBeDefined()
    const [first, second] = sentTo(sent, VITALS)
    expect(first!.body).toEqual({ painScore: 3, oxygenDevice: 'simple_mask', oxygenFlowLPerMin: 6, gcsEye: 4, gcsMotor: 5,
      gcsVerbalNotTestable: true, recordedAt: '2026-12-03T09:15:00.000Z' })
    // The same body again after a refusal carries the same key: the server never records it twice.
    expect(second!.headers.get('Idempotency-Key')).toBe(first!.headers.get('Idempotency-Key'))
  })

  it('says to open the record first when the chart is not open to this member', async () => {
    const member = nurse()
    serve({ [SESSION]: [sessionAt(member, [member])], [ADMISSION_READ]: [() => json({ admission: { ...hiddenCard(), admissionId: ADMISSION }, movements: [] })],
      [CHART]: many(() => problem(403, 'CHART_ACCESS_REQUIRED', 'Forbidden')) })
    await openStaffApp(`${BASE}/observations`)
    expect(await screen.findByRole('heading', { level: 1, name: 'B T' })).toBeDefined()
    expect(await screen.findByText(/Open this patient’s record first, then try again./)).toBeDefined()
    expect(screen.getByRole('link', { name: 'Find the patient on Patients' }).getAttribute('href')).toBe('/provider/patients')
    expect(document.body.textContent).not.toMatch(/permission|ward-stay/i)
  })
})

describe('the medicine administration record', () => {
  const marOf = (orders = [order()], administrations = [doseRecord()]) => () =>
    json({ admissionId: ADMISSION, from: '2026-12-02T08:00:00.000Z', to: '2026-12-04T08:00:00.000Z', orders, administrations })

  it('shows each order’s due doses and pharmacy state, and records a late dose with where it came from', async () => {
    const member = nurse()
    const sent = serve({ [SESSION]: [sessionAt(member, [member])], [ADMISSION_READ]: [() => json({ admission: card(), movements: [] })],
      [MAR]: many(marOf([order(), order({ prescriptionId: 'f0000000-0000-4000-8000-0000000000f2', medicationDisplay: 'Paracetamol',
        strength: '1 g', doseForm: 'tablet', schedule: { kind: 'as_needed', times: null, firstDueAt: null, infusion: null }, doses: [],
        asNeeded: { reason: 'Pain or fever', minIntervalMinutes: 240, maxDosesPer24h: 4, givenLast24h: 4 }, pharmacyState: 'dispensed',
        nextAllowedAt: '2026-12-03T15:00:00.000Z' })])),
      [DOSE]: [() => json({ administration: doseRecord({ administrationId: 'n1', scheduledFor: '2026-12-03T13:00:00.000Z' }), warnings: ['late', 'before_dispensing'], replayed: false }, 201)] })
    await openStaffApp(`${BASE}/medicines`)
    const medicines = await screen.findByRole('list', { name: 'Medicines' })
    const amoxicillin = within(medicines).getByRole('listitem', { name: 'Amoxicillin 500 mg capsule' })
    expect(within(amoxicillin).getByText('Sent to the pharmacy')).toBeDefined()
    expect(within(amoxicillin).getByText('Set times: 06:00, 14:00, 22:00')).toBeDefined()
    expect(within(amoxicillin).getByText('Late')).toBeDefined()
    expect(within(amoxicillin).getByText('Upcoming')).toBeDefined()
    // An upcoming dose waits until it is due.
    expect(within(amoxicillin).queryByRole('button', { name: 'Record 22:00 dose' })).toBeNull()
    const paracetamol = within(medicines).getByRole('listitem', { name: 'Paracetamol 1 g tablet' })
    expect(within(paracetamol).getByText('4 of at most 4')).toBeDefined()
    expect(within(paracetamol).getByText('Pain or fever')).toBeDefined()
    // The recorded dose: given before dispensing, from ward stock.
    const recorded = within(screen.getByRole('list', { name: 'Doses recorded' })).getByRole('listitem', { name: 'Amoxicillin 500 mg capsule' })
    expect(within(recorded).getByText('Ward stock')).toBeDefined()
    expect(within(recorded).getByText('Given before the pharmacy dispensed it.')).toBeDefined()

    fireEvent.click(within(amoxicillin).getByRole('button', { name: 'Record 14:00 dose' }))
    const form = screen.getByRole('form', { name: 'Record a dose' })
    fireEvent.change(within(form).getByLabelText('Time (Lagos time)'), { target: { value: '2026-12-03T15:05' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save the dose' }))
    expect(await within(form).findByText('The pharmacy has not dispensed this medicine. Say where it came from.')).toBeDefined()
    expect(sentTo(sent, DOSE)).toHaveLength(0)
    fireEvent.change(within(form).getByLabelText('Where the medicine came from'), { target: { value: 'patient_own' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save the dose' }))
    expect(await screen.findByText('Given more than 60 minutes after the due time.')).toBeDefined()
    expect(sentTo(sent, DOSE)[0]!.body).toEqual({ prescriptionId: ORDER, scheduledFor: '2026-12-03T13:00:00.000Z', outcome: 'given',
      givenAt: '2026-12-03T14:05:00.000Z', dose: { quantity: 1, unit: 'capsule' }, route: 'oral', supplySource: 'patient_own' })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(await screen.findByText('Given: Amoxicillin 500 mg capsule recorded.')).toBeDefined()
  })

  it('needs a reason for a dose not given, a reason to give sooner than ordered, and says a dose already recorded', async () => {
    const member = nurse()
    const sent = serve({ [SESSION]: [sessionAt(member, [member])], [ADMISSION_READ]: [() => json({ admission: card(), movements: [] })],
      [MAR]: many(marOf([order({ pharmacyState: 'dispensed' }), order({ prescriptionId: 'f0000000-0000-4000-8000-0000000000f2',
        medicationDisplay: 'Paracetamol', strength: '1 g', doseForm: 'tablet', schedule: { kind: 'as_needed', times: null, firstDueAt: null, infusion: null },
        doses: [], asNeeded: { reason: 'Pain or fever', minIntervalMinutes: 240, maxDosesPer24h: 4, givenLast24h: 1 }, pharmacyState: 'dispensed',
        dose: { quantity: 1, unit: 'tablet' }, nextAllowedAt: '2999-12-03T15:00:00.000Z' })], [])),
      [DOSE]: [() => problem(409, 'DOSE_ALREADY_RECORDED', 'Conflict')] })
    await openStaffApp(`${BASE}/medicines`)
    const amoxicillin = await screen.findByRole('listitem', { name: 'Amoxicillin 500 mg capsule' })
    fireEvent.click(within(amoxicillin).getByRole('button', { name: 'Record 14:00 dose' }))
    let form = screen.getByRole('form', { name: 'Record a dose' })
    fireEvent.change(within(form).getByLabelText('What happened'), { target: { value: 'held' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save the dose' }))
    expect(await within(form).findByText('Choose a reason for a dose that was not given.')).toBeDefined()
    expect(within(form).getAllByRole('option').map(option => option.textContent)).toContain('Nil by mouth')
    fireEvent.change(within(form).getByLabelText('Reason'), { target: { value: 'clinical_decision' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save the dose' }))
    expect(await within(form).findByText('Say more about the reason, in at least 8 characters.')).toBeDefined()
    fireEvent.change(within(form).getByLabelText('More about the reason'), { target: { value: 'Blood pressure too low this morning' } })
    fireEvent.change(within(form).getByLabelText('Time (Lagos time)'), { target: { value: '2026-12-03T14:10' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save the dose' }))
    expect(await within(form).findByText('This dose is already recorded. Mark it entered in error if it is wrong.')).toBeDefined()
    expect(sentTo(sent, DOSE)[0]!.body).toEqual({ prescriptionId: ORDER, scheduledFor: '2026-12-03T13:00:00.000Z', outcome: 'held',
      givenAt: '2026-12-03T13:10:00.000Z', reasonCode: 'clinical_decision', reasonText: 'Blood pressure too low this morning' })
    fireEvent.click(within(form).getByRole('button', { name: 'Go back' }))

    const paracetamol = screen.getByRole('listitem', { name: 'Paracetamol 1 g tablet' })
    fireEvent.click(within(paracetamol).getByRole('button', { name: 'Record an as-needed dose' }))
    form = screen.getByRole('form', { name: 'Record a dose' })
    expect(within(form).getByLabelText('Why it is given sooner or more often than ordered')).toBeDefined()
    expect(within(form).queryByLabelText('Where the medicine came from')).toBeNull()
  })

  it('marks a dose entered in error with a reason, and offers no recording to a member who can only read', async () => {
    const member = nurse()
    const sent = serve({ [SESSION]: [sessionAt(member, [member])], [ADMISSION_READ]: [() => json({ admission: card(), movements: [] })],
      [MAR]: many(marOf()),
      ['POST /api/v1/ehr/medicine-administrations/90000000-0000-4000-8000-000000000091/entered-in-error']: [
        () => json({ administration: doseRecord({ status: 'entered_in_error' }), replayed: false })] })
    await openStaffApp(`${BASE}/medicines`)
    const recorded = await screen.findByRole('list', { name: 'Doses recorded' })
    fireEvent.click(within(recorded).getByRole('button', { name: 'Mark entered in error' }))
    fireEvent.change(within(recorded).getByLabelText('Why is this entered in error?'), { target: { value: 'Recorded on the wrong patient' } })
    fireEvent.click(within(recorded).getAllByRole('button', { name: 'Mark entered in error' }).at(-1)!)
    await waitFor(() => expect(sentTo(sent, 'POST /api/v1/ehr/medicine-administrations/90000000-0000-4000-8000-000000000091/entered-in-error')).toHaveLength(1))
    expect(sentTo(sent, 'POST /api/v1/ehr/medicine-administrations/90000000-0000-4000-8000-000000000091/entered-in-error')[0]!.body)
      .toEqual({ expectedRowVersion: 1, reason: 'Recorded on the wrong patient' })
  })

  it('records nothing for a member without ehr.mar.record', async () => {
    const reader = facility(REAL_FACILITY, 'Fictional Hospital', ['ehr.mar.read', 'ehr.ward.read'], ['clinician'])
    serve({ [SESSION]: [sessionAt(reader, [reader])], [ADMISSION_READ]: [() => json({ admission: card(), movements: [] })], [MAR]: many(marOf()) })
    await openStaffApp(`${BASE}/medicines`)
    const amoxicillin = within(await screen.findByRole('list', { name: 'Medicines' })).getByRole('listitem', { name: 'Amoxicillin 500 mg capsule' })
    expect(within(amoxicillin).queryByRole('button', { name: /^Record/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mark entered in error' })).toBeNull()
    // Only the tabs its codes read.
    expect(screen.queryByRole('navigation', { name: 'Ward chart' })).toBeNull()
  })
})

describe('fluid balance', () => {
  const dayOf = () => json({ admissionId: ADMISSION, day: '2026-12-03', dayStartsAtHour: 7, from: '2026-12-03T06:00:00.000Z', to: '2026-12-04T06:00:00.000Z',
    entries: [
      { entryId: 'x1', direction: 'in', kind: 'iv', volumeMl: 1000, notMeasured: false, recordedAt: '2026-12-03T08:00:00.000Z', note: null,
        status: 'recorded', enteredInErrorReason: null, enteredInErrorAt: null, recordedByMembershipId: null, rowVersion: 1 },
      { entryId: 'x2', direction: 'out', kind: 'urine', volumeMl: null, notMeasured: true, recordedAt: '2026-12-03T09:00:00.000Z', note: 'Wet bed',
        status: 'recorded', enteredInErrorReason: null, enteredInErrorAt: null, recordedByMembershipId: null, rowVersion: 1 },
      { entryId: 'x3', direction: 'out', kind: 'vomit', volumeMl: 200, notMeasured: false, recordedAt: '2026-12-03T10:00:00.000Z', note: null,
        status: 'entered_in_error', enteredInErrorReason: 'Wrong patient chart', enteredInErrorAt: '2026-12-03T10:30:00.000Z', recordedByMembershipId: null, rowVersion: 2 },
    ],
    totals: { intakeMl: 1000, outputMl: 350, balanceMl: 650, unmeasuredIntakeCount: 0, unmeasuredOutputCount: 1 },
    byHour: [], byShift: [{ shiftId: 's1', name: 'Morning', shiftDate: '2026-12-03', from: '2026-12-03T06:30:00.000Z', to: '2026-12-03T13:30:00.000Z', inMl: 1000, outMl: 350 }] })

  it('shows the fluid day’s totals, unmeasured entries apart and entries in error struck through, and records an output', async () => {
    const member = nurse()
    const sent = serve({ [SESSION]: [sessionAt(member, [member])], [ADMISSION_READ]: [() => json({ admission: card(), movements: [] })],
      [FLUIDS]: many(dayOf), [NEW_FLUID]: [() => problem(400, 'FLUID_ENTRY_INVALID', 'Bad'), () => json({ entryId: 'x9', replayed: false }, 201)] })
    await openStaffApp(`${BASE}/fluids`)
    const totals = await screen.findByLabelText('Fluid totals')
    expect(totals.textContent).toBe('In1000 mLOut350 mLBalance+650 mL')
    expect(screen.getByText('Not measured, and not in the totals: 0 in, 1 out.')).toBeDefined()
    expect(screen.getByText('Morning (07:30 to 14:30)')).toBeDefined()
    expect(screen.getByRole('listitem', { name: 'Out: Urine, Not measured' })).toBeDefined()
    const wrong = screen.getByRole('listitem', { name: 'Out: Vomit, 200 mL' })
    expect(wrong.className).toContain('hid-ehr-dept-nursing-struck')
    expect(within(wrong).getByText('Entered in error')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Add intake or output' }))
    const form = screen.getByRole('form', { name: 'Add intake or output' })
    fireEvent.change(within(form).getByLabelText('In or out'), { target: { value: 'out' } })
    fireEvent.change(within(form).getByLabelText('What'), { target: { value: 'drain' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(await within(form).findByText('Enter the amount in mL, or mark it as not measured.')).toBeDefined()
    expect(sentTo(sent, NEW_FLUID)).toHaveLength(0)
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-12-03T12:00:00.000Z'))
    fireEvent.change(within(form).getByLabelText('Amount (mL)'), { target: { value: '150' } })
    fireEvent.change(within(form).getByLabelText('Time (Lagos time)'), { target: { value: '2026-12-03T12:40' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(await within(form).findByText('Enter the amount in mL, or mark it as not measured.')).toBeDefined()
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Output saved.')).toBeDefined()
    expect(sentTo(sent, NEW_FLUID)[0]!.body).toEqual({ direction: 'out', kind: 'drain', volumeMl: 150, recordedAt: '2026-12-03T11:40:00.000Z' })
  })

  it('reads another fluid day by its date in the query, never a patient detail', async () => {
    const member = nurse()
    serve({ [SESSION]: [sessionAt(member, [member])], [ADMISSION_READ]: [() => json({ admission: card(), movements: [] })], [FLUIDS]: many(dayOf) })
    await openStaffApp(`${BASE}/fluids`)
    fireEvent.change(await screen.findByLabelText('Fluid day'), { target: { value: '2026-12-02' } })
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([address]) => String(address).includes('day=2026-12-02'))).toBe(true))
    noIdentityInAddresses()
  })
})

describe('the ward chart’s tasks and its address', () => {
  it('lists the stay’s tasks and adds one for this patient', async () => {
    const doctor = facility(REAL_FACILITY, 'Fictional Hospital', DOCTOR, ['doctor'])
    const sent = serve({ [SESSION]: [sessionAt(doctor, [doctor])], [ADMISSION_READ]: [() => json({ admission: card(), movements: [] })],
      'GET /api/v1/ehr/wards': many(() => json({ items: [] })),
      [TASKS]: many(() => json({ items: [task()] })),
      [`POST /api/v1/ehr/admissions/${ADMISSION}/nursing-tasks`]: [() => json({ task: task(), replayed: false }, 201)] })
    await openStaffApp(`${BASE}/tasks`)
    expect(await screen.findByRole('listitem', { name: 'Turn the patient' })).toBeDefined()
    const url = String(vi.mocked(fetch).mock.calls.find(([address]) => String(address).includes('/nursing-tasks?'))![0])
    expect(new URL(url).searchParams.get('admissionId')).toBe(ADMISSION)
    fireEvent.click(screen.getByRole('button', { name: 'New task' }))
    const form = screen.getByRole('form', { name: 'New task' })
    expect(within(form).queryByLabelText('Patient')).toBeNull()
    fireEvent.change(within(form).getByLabelText('Task'), { target: { value: 'Wound dressing check' } })
    fireEvent.change(within(form).getByLabelText('Due (Lagos time)'), { target: { value: '2026-12-04T00:30' } })
    fireEvent.change(within(form).getByLabelText('For'), { target: { value: `member-${REAL_FACILITY}` } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add task' }))
    await waitFor(() => expect(sentTo(sent, `POST /api/v1/ehr/admissions/${ADMISSION}/nursing-tasks`)).toHaveLength(1))
    expect(sentTo(sent, `POST /api/v1/ehr/admissions/${ADMISSION}/nursing-tasks`)[0]!.body)
      .toEqual({ name: 'Wound dressing check', dueAt: '2026-12-03T23:30:00.000Z', assignedMembershipId: `member-${REAL_FACILITY}` })
  })

  it('sends an address that is not an admission’s id to Nursing tasks', async () => {
    const member = nurse()
    serve({ [SESSION]: [sessionAt(member, [member])], 'GET /api/v1/ehr/wards': many(() => json({ items: [] })) })
    await openStaffApp('/provider/ward-patient/HID-1234-5678')
    await waitFor(() => expect(where()).toBe('/provider/nursing-tasks'))
  })

  it('says a discharged stay can still be read', async () => {
    const member = nurse()
    serve({ [SESSION]: [sessionAt(member, [member])], [ADMISSION_READ]: [() => json({ admission: card({ status: 'discharged' }), movements: [] })],
      [CHART]: many(chartOf({ readings: [] })) })
    await openStaffApp(`${BASE}/observations`)
    expect(await screen.findByText('This patient has been discharged. The record can still be read.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Record observations' })).toBeNull()
  })
})
