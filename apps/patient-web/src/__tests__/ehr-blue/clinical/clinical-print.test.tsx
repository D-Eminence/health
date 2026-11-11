import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DischargeSummaryPaper, LabResultPaper, PrescriptionPaper, clinicianName, doseText, drugLine, durationText, heldDrugs, isListedTest, isPrintable,
  labPaperLines, paperPatient, prescriberName, printableDrugs, routeText, shown, usePaperPrint, type DischargeSummary,
} from '../../../ehr-blue/clinical/parts/clinicalPrint'
import type { ClinicalRecord, LabResultRevision } from '../../../staff/api'

/** Clinical paper: prescription, discharge summary and lab result. Every person and value here is fictional. */

function rx(overrides: Record<string, unknown> = {}): ClinicalRecord {
  return {
    id: 'rx-1', patientId: 'p-1', encounterId: 'e-1', createdAt: '2026-11-10T09:00:00.000Z', createdBy: 'staff-1',
    medicationDisplay: 'Amoxicillin', doseQuantity: '500', doseUnit: 'mg', routeCode: 'oral', frequency: 'Three times a day',
    instructions: 'After meals', startsOn: '2026-11-10', endsOn: '2026-11-16', status: 'active', ...overrides,
  }
}

function revision(overrides: Partial<LabResultRevision> = {}): LabResultRevision {
  return {
    version: 1, resultType: 'numeric', numericValue: 9.8, textValue: null, unit: 'g/dL', referenceRange: '12.0-15.5', abnormalFlag: 'low',
    entrySource: 'manual', verificationStatus: 'verified', releaseStatus: 'released', enteredAt: '2026-11-10T10:00:00.000Z',
    releasedAt: '2026-11-10T11:00:00.000Z', correctionReason: null, ...overrides,
  }
}

const PATIENT = { name: 'Ada Example', hid: 'HID-AB12CD', ageSex: '36 years · Female' }

afterEach(() => { vi.restoreAllMocks() })

describe('clinical paper words', () => {
  it('writes how long a medicine is for from its start and end dates', () => {
    expect(durationText('2026-11-10', '2026-11-16')).toBe('7 days (10 Nov 2026 to 16 Nov 2026)')
    expect(durationText('2026-11-10', '2026-11-10')).toBe('1 day (10 Nov 2026 to 10 Nov 2026)')
    expect(durationText(null, '2026-11-16')).toBe('Until 16 Nov 2026')
    expect(durationText('2026-11-10', undefined)).toBe('From 10 Nov 2026')
    expect(durationText(null, null)).toBe('')
  })

  it('writes the dose with its unit and a leading zero, and the route in plain words', () => {
    expect(doseText('.5', 'mg')).toBe('0.5 mg')
    expect(doseText(2, 'tablets')).toBe('2 tablets')
    expect(doseText('', 'mg')).toBe('')
    expect(routeText('oral')).toBe('By mouth')
    expect(routeText('rectal-ish')).toBe('rectal-ish')
  })

  it('prints only an active prescription: never a draft, one on hold, completed, cancelled or entered in error', () => {
    const records = ['active', 'draft', 'on_hold', 'completed', 'cancelled', 'entered_in_error', 'stopped', ''].map((status, index) => rx({ id: `rx-${index + 1}`, status }))
    expect(printableDrugs(records).map(drug => drug.key)).toEqual(['rx-1'])
    expect(records.filter(isPrintable).map(record => record.id)).toEqual(['rx-1'])
    expect(heldDrugs(records).map(drug => drug.key)).toEqual(['rx-3'])
    expect(isListedTest(rx({ status: 'draft' }))).toBe(true)
    expect(isListedTest(rx({ status: 'cancelled' }))).toBe(false)
    expect(drugLine(rx())).toEqual({
      key: 'rx-1', medicine: 'Amoxicillin', dose: '500 mg', route: 'By mouth', frequency: 'Three times a day',
      duration: '7 days (10 Nov 2026 to 16 Nov 2026)', instructions: 'After meals',
    })
  })

  it('names the prescriber only when the signed-in member wrote every printed prescription', () => {
    const actor = { id: 'staff-1', displayName: 'Dr Demo Clinician' }
    expect(prescriberName([rx()], actor)).toBe('Dr Demo Clinician')
    expect(prescriberName([rx(), rx({ id: 'rx-2', createdBy: 'staff-9' })], actor)).toBeNull()
    expect(prescriberName([rx()], { id: 'staff-1' })).toBeNull()
    expect(prescriberName([], actor)).toBeNull()
  })

  it('names the clinician on the discharge summary only when the signed-in member wrote the consultation note', () => {
    const note = rx({ id: 'note-1', createdBy: 'staff-1' })
    expect(clinicianName(note, { id: 'staff-1', displayName: 'Dr Demo Clinician' })).toBe('Dr Demo Clinician')
    expect(clinicianName(note, { id: 'staff-2', displayName: 'Nurse Demo' })).toBeNull()
    expect(clinicianName(null, { id: 'staff-1', displayName: 'Dr Demo Clinician' })).toBeNull()
  })

  it('writes the patient’s age and sex when the lookup carries them', () => {
    const today = new Date('2026-11-11T12:00:00Z')
    expect(paperPatient({ name: 'Ada Example', hid: 'HID-AB12CD', dateOfBirth: '1990-05-01', sex: 'female' }, today))
      .toEqual({ name: 'Ada Example', hid: 'HID-AB12CD', ageSex: '36 years · Female' })
    expect(paperPatient({ name: 'Ada Example', hid: 'HID-AB12CD' }, today).ageSex).toBeNull()
  })

  it('prints the latest released version of each lab result, never one entered in error', () => {
    const lines = labPaperLines([
      { id: 'r1', status: 'released', revisions: [revision({ version: 1, numericValue: 8.1 }), revision({ version: 2 }), revision({ version: 3, releaseStatus: 'not_released', numericValue: 1 })] },
      { id: 'r2', status: 'entered_in_error', revisions: [revision()] },
      { id: 'r3', status: 'released', revisions: [revision({ resultType: 'text', textValue: 'Negative', numericValue: null, unit: null, referenceRange: null, abnormalFlag: 'normal' })] },
    ])
    expect(lines).toEqual([
      expect.objectContaining({ key: 'r1', value: '9.8 g/dL', range: '12.0-15.5', flag: 'Low' }),
      expect.objectContaining({ key: 'r3', value: 'Negative', range: '', flag: '' }),
    ])
  })
})

describe('clinical paper', () => {
  it('prints a prescription with the facility, patient, Health ID, each medicine, the prescriber and a signature line', () => {
    const { container } = render(<PrescriptionPaper facility="Demo Hospital" patient={PATIENT} drugs={printableDrugs([rx()])}
      prescriber="Dr Demo Clinician" printedAt="11 Nov 2026, 09:00" />)
    const paper = container.textContent ?? ''
    for (const words of ['Demo Hospital', 'Prescription', 'Ada Example', 'HID-AB12CD', '36 years · Female', 'Amoxicillin 500 mg',
      'By mouth · Three times a day · for 7 days (10 Nov 2026 to 16 Nov 2026)', 'After meals', 'Dr Demo Clinician', 'Licence number', 'Signature',
      'Date: 11 Nov 2026, 09:00']) {
      expect(paper).toContain(words)
    }
  })

  it('leaves the prescriber’s name to be written when it is not known', () => {
    render(<PrescriptionPaper facility="Demo Hospital" patient={PATIENT} drugs={[]} prescriber={null} printedAt="11 Nov 2026, 09:00" />)
    expect(screen.getByText('No medicine to print.')).toBeTruthy()
    expect(screen.getByText('Prescriber’s name').previousElementSibling?.textContent).toBe('')
  })

  it('prints a discharge summary from the visit', () => {
    const summary: DischargeSummary = {
      facility: 'Demo Hospital', patient: PATIENT, visitType: 'Outpatient', startedAt: '2026-11-10T08:00:00.000Z', status: 'Completed',
      complaint: 'Fever for two days', diagnoses: shown(['Malaria (fictional)']), note: shown({ content: 'Treated and improving.', signed: false }),
      tests: shown(['Haemoglobin']), drugs: shown(printableDrugs([rx()])), held: heldDrugs([rx({ id: 'rx-9', status: 'on_hold', medicationDisplay: 'Ibuprofen' })]),
      clinician: 'Dr Demo Clinician', printedAt: '11 Nov 2026, 09:00',
    }
    const { container } = render(<DischargeSummaryPaper summary={summary} />)
    const paper = container.textContent ?? ''
    for (const words of ['Discharge summary', 'Ada Example', 'HID-AB12CD', 'Outpatient', 'Fever for two days', 'Malaria (fictional)',
      'This note is a draft and has not been signed.', 'Treated and improving.', 'Haemoglobin', 'Medicines on discharge', 'Amoxicillin 500 mg',
      'Follow-up', 'Dr Demo Clinician', 'Licence number', 'Medicines on hold', 'not to be taken unless a clinician says so', 'Ibuprofen']) {
      expect(paper).toContain(words)
    }
    // The held medicine is under its own heading, never among the medicines on discharge.
    const onDischarge = [...container.querySelectorAll('section')].find(item => item.querySelector('h2')?.textContent === 'Medicines on discharge')
    expect(onDischarge?.textContent).not.toContain('Ibuprofen')
  })

  it('says plainly what a discharge summary has none of', () => {
    const { container } = render(<DischargeSummaryPaper summary={{
      facility: 'Demo Hospital', patient: PATIENT, visitType: 'Outpatient', startedAt: '2026-11-10T08:00:00.000Z', status: 'In progress',
      complaint: '', diagnoses: shown([]), note: shown(null), tests: shown([]), drugs: shown([]), held: [], clinician: null, printedAt: '11 Nov 2026, 09:00',
    }} />)
    const paper = container.textContent ?? ''
    expect(paper).toContain('None recorded')
    expect(paper).toContain('No consultation note recorded')
    expect(paper).toContain('None active at this visit')
    expect(paper).not.toContain('Tests requested')
    expect(paper).not.toContain('Medicines on hold')
  })

  it.each([
    ['no-right', 'Not available to you. Check the patient’s record.'],
    ['failed', 'Could not be loaded. Check the patient’s record.'],
    ['loading', 'Still loading when this was printed. Check the patient’s record.'],
  ] as const)('never says "none" for a part it could not read (%s)', (state, words) => {
    const { container } = render(<DischargeSummaryPaper summary={{
      facility: 'Demo Hospital', patient: PATIENT, visitType: 'Outpatient', startedAt: '2026-11-10T08:00:00.000Z', status: 'In progress',
      complaint: 'Fever', diagnoses: { state }, note: { state }, tests: { state }, drugs: { state }, held: [], clinician: null, printedAt: '11 Nov 2026, 09:00',
    }} />)
    const paper = container.textContent ?? ''
    for (const none of ['None recorded', 'No consultation note recorded', 'None active at this visit']) expect(paper).not.toContain(none)
    expect(paper.split(words).length - 1).toBe(4)
  })

  it('says when the record holds more than the paper lists', () => {
    const { container } = render(<DischargeSummaryPaper summary={{
      facility: 'Demo Hospital', patient: PATIENT, visitType: 'Outpatient', startedAt: '2026-11-10T08:00:00.000Z', status: 'In progress',
      complaint: 'Fever', diagnoses: shown(['Malaria (fictional)']), note: shown(null), tests: shown([]), drugs: shown(printableDrugs([rx()]), true), held: [],
      clinician: null, printedAt: '11 Nov 2026, 09:00',
    }} />)
    expect(container.textContent).toContain('More are on later pages of the record and are not on this paper.')
    render(<PrescriptionPaper facility="Demo Hospital" patient={PATIENT} drugs={printableDrugs([rx()])} prescriber={null} printedAt="11 Nov 2026, 09:00" more />)
    expect(screen.getByText(/This visit has more prescriptions on later pages of the record/)).toBeTruthy()
  })

  it('prints a lab result', () => {
    const { container } = render(<LabResultPaper facility="Demo Hospital" patient={PATIENT} test="Haemoglobin"
      lines={labPaperLines([{ id: 'r1', status: 'released', revisions: [revision()] }])} printedAt="11 Nov 2026, 09:00" />)
    const paper = container.textContent ?? ''
    for (const words of ['Laboratory result', 'Ada Example', 'HID-AB12CD', 'Haemoglobin', '9.8 g/dL', '12.0-15.5', 'Low']) expect(paper).toContain(words)
  })
})

function Printer() {
  const { print, area } = usePaperPrint()
  return <>
    <button type="button" onClick={() => print('prescription', <p>Paper body</p>)}>Print</button>
    {area}
  </>
}

describe('usePaperPrint', () => {
  it('puts the paper on the page, opens the print dialog, and takes the paper away after printing', () => {
    let shown: string | null = null
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {
      shown = document.querySelector('[data-clinical-print]')?.getAttribute('data-clinical-print') ?? null
    })
    render(<Printer />)
    expect(document.querySelector('[data-clinical-print]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Print' }))
    expect(printSpy).toHaveBeenCalledTimes(1)
    expect(shown).toBe('prescription')
    // The paper is a child of <body>, in normal flow, so its page size applies when it prints.
    const paper = document.querySelector('[data-clinical-print]')
    expect(paper?.getAttribute('aria-hidden')).toBe('true')
    expect(paper?.parentElement).toBe(document.body)
    act(() => { window.dispatchEvent(new Event('afterprint')) })
    expect(document.querySelector('[data-clinical-print]')).toBeNull()
  })
})
