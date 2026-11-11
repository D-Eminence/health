import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DischargeSummaryPaper, LabResultPaper, PrescriptionPaper, doseText, drugLine, durationText, labPaperLines, paperPatient, prescriberName,
  printableDrugs, routeText, usePaperPrint, type DischargeSummary,
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

  it('leaves cancelled and entered-in-error prescriptions off the paper', () => {
    const drugs = printableDrugs([rx(), rx({ id: 'rx-2', status: 'cancelled' }), rx({ id: 'rx-3', status: 'entered_in_error' }), rx({ id: 'rx-4', status: 'draft' })])
    expect(drugs.map(drug => drug.key)).toEqual(['rx-1', 'rx-4'])
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
      complaint: 'Fever for two days', diagnoses: ['Malaria (fictional)'], note: { content: 'Treated and improving.', signed: false },
      tests: ['Haemoglobin'], drugs: printableDrugs([rx()]), clinician: 'Dr Demo Clinician', printedAt: '11 Nov 2026, 09:00',
    }
    const { container } = render(<DischargeSummaryPaper summary={summary} />)
    const paper = container.textContent ?? ''
    for (const words of ['Discharge summary', 'Ada Example', 'HID-AB12CD', 'Outpatient', 'Fever for two days', 'Malaria (fictional)',
      'This note is a draft and has not been signed.', 'Treated and improving.', 'Haemoglobin', 'Medicines on discharge', 'Amoxicillin 500 mg',
      'Follow-up', 'Dr Demo Clinician', 'Licence number']) {
      expect(paper).toContain(words)
    }
  })

  it('says plainly what a discharge summary has none of', () => {
    const { container } = render(<DischargeSummaryPaper summary={{
      facility: 'Demo Hospital', patient: PATIENT, visitType: 'Outpatient', startedAt: '2026-11-10T08:00:00.000Z', status: 'In progress',
      complaint: '', diagnoses: [], note: null, tests: [], drugs: [], clinician: null, printedAt: '11 Nov 2026, 09:00',
    }} />)
    const paper = container.textContent ?? ''
    expect(paper).toContain('None recorded')
    expect(paper).toContain('No consultation note recorded')
    expect(paper).toContain('None prescribed at this visit')
    expect(paper).not.toContain('Tests requested')
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
    const { container } = render(<Printer />)
    expect(container.querySelector('[data-clinical-print]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Print' }))
    expect(printSpy).toHaveBeenCalledTimes(1)
    expect(shown).toBe('prescription')
    expect(container.querySelector('[data-clinical-print]')?.getAttribute('aria-hidden')).toBe('true')
    act(() => { window.dispatchEvent(new Event('afterprint')) })
    expect(container.querySelector('[data-clinical-print]')).toBeNull()
  })
})
