import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DischargeSummaryPaper, LabResultPaper, PrescriptionPaper, clinicianName, doseText, drugLine, durationText, heldDrugs, isListedTest, isPrintable,
  labPaperLines, paperPatient, prescriberName, printableDrugs, routeText, shown, usePaperPrint, type DischargeSummary,
} from '../../../ehr-blue/clinical/parts/clinicalPrint'
import type { ClinicalRecord, LabResultRevision } from '../../../staff/api'
import { COLLEAGUE, SIGNED_IN } from './harness'

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

  describe('who wrote the records', () => {
    // As production has them: the session's actor.id is the sign-in subject; EHR writes a record's createdBy as the
    // author's account id and createdByMembershipId as their membership at the facility (hid-system ehr-api).
    const FACILITY = 'f1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b'
    const OTHER_FACILITY = 'f9e8d7c6-b5a4-4392-8a1b-0c2d3e4f5a6b'
    const actor = {
      id: SIGNED_IN.subject, subject: SIGNED_IN.subject, accountId: SIGNED_IN.accountId, sessionId: SIGNED_IN.sessionId, displayName: 'Dr Demo Clinician',
      roles: ['doctor'], permissions: [],
      facility: { id: FACILITY, membershipId: SIGNED_IN.membershipId, organizationId: 'org-1', name: 'Demo Hospital', roles: ['doctor'], permissions: [], isPrimary: true },
      facilities: [
        { id: FACILITY, membershipId: SIGNED_IN.membershipId, organizationId: 'org-1', name: 'Demo Hospital', roles: ['doctor'], permissions: [], isPrimary: true },
        { id: OTHER_FACILITY, membershipId: '8b7a6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d', organizationId: 'org-1', name: 'Demo Clinic', roles: ['doctor'], permissions: [], isPrimary: false },
      ],
    }
    const mine = (overrides: Record<string, unknown> = {}) => rx({ createdBy: SIGNED_IN.accountId, createdByMembershipId: SIGNED_IN.membershipId, ...overrides })
    const theirs = (overrides: Record<string, unknown> = {}) => rx({ id: 'rx-2', createdBy: COLLEAGUE.accountId, createdByMembershipId: COLLEAGUE.membershipId, ...overrides })
    const { accountId: _accountId, ...withoutAccount } = actor

    it('names the prescriber when the signed-in member’s account wrote every printed prescription', () => {
      expect(new Set([actor.id, actor.accountId, actor.sessionId, actor.facility.membershipId]).size).toBe(4)
      expect(prescriberName([mine()], actor, FACILITY)).toBe('Dr Demo Clinician')
      expect(prescriberName([mine(), mine({ id: 'rx-2' })], actor, FACILITY)).toBe('Dr Demo Clinician')
      // One printed record by someone else, and the name is left for handwriting.
      expect(prescriberName([mine(), theirs()], actor, FACILITY)).toBeNull()
      expect(prescriberName([theirs()], actor, FACILITY)).toBeNull()
      expect(prescriberName([], actor, FACILITY)).toBeNull()
      expect(prescriberName([mine()], { ...actor, displayName: '  ' }, FACILITY)).toBeNull()
      expect(prescriberName([mine()], null, FACILITY)).toBeNull()
    })

    it('never takes the sign-in subject for the author', () => {
      expect(prescriberName([mine({ createdBy: SIGNED_IN.subject })], actor, FACILITY)).toBeNull()
      expect(clinicianName(mine({ createdBy: SIGNED_IN.subject }), actor, FACILITY)).toBeNull()
      // An actor with only its sign-in subject: no account or membership to compare, so nothing is guessed.
      const subjectOnly = { id: SIGNED_IN.subject, displayName: 'Dr Demo Clinician' }
      expect(prescriberName([rx({ createdBy: SIGNED_IN.subject })], subjectOnly, FACILITY)).toBeNull()
    })

    it('decides by account when the session carries one, whatever the membership says', () => {
      expect(prescriberName([mine({ createdByMembershipId: COLLEAGUE.membershipId })], actor, FACILITY)).toBe('Dr Demo Clinician')
      expect(prescriberName([theirs({ createdByMembershipId: SIGNED_IN.membershipId })], actor, FACILITY)).toBeNull()
    })

    it('without an account on the session, compares the membership at the chart’s facility, when the records carry one', () => {
      expect(prescriberName([mine()], withoutAccount, FACILITY)).toBe('Dr Demo Clinician')
      expect(prescriberName([mine()], { ...actor, accountId: '' }, FACILITY)).toBe('Dr Demo Clinician')
      expect(prescriberName([mine(), theirs()], withoutAccount, FACILITY)).toBeNull()
      // The member's membership at another facility is not the one this chart's records were written under.
      expect(prescriberName([mine()], withoutAccount, OTHER_FACILITY)).toBeNull()
      expect(prescriberName([mine()], { ...withoutAccount, facility: undefined, facilities: [] }, FACILITY)).toBeNull()
      // A record without its membership is not shown to be theirs.
      expect(prescriberName([mine({ createdByMembershipId: undefined })], withoutAccount, FACILITY)).toBeNull()
      // The working facility alone is enough (the list may not repeat it).
      expect(prescriberName([mine()], { ...withoutAccount, facilities: [] }, FACILITY)).toBe('Dr Demo Clinician')
    })

    it('names the clinician on the discharge summary only when the signed-in member wrote the consultation note', () => {
      const note = (overrides: Record<string, unknown> = {}) => mine({ id: 'note-1', ...overrides })
      expect(clinicianName(note(), actor, FACILITY)).toBe('Dr Demo Clinician')
      expect(clinicianName(note({ createdBy: COLLEAGUE.accountId, createdByMembershipId: COLLEAGUE.membershipId }), actor, FACILITY)).toBeNull()
      expect(clinicianName(note(), withoutAccount, FACILITY)).toBe('Dr Demo Clinician')
      expect(clinicianName(note(), withoutAccount, OTHER_FACILITY)).toBeNull()
      expect(clinicianName(null, actor, FACILITY)).toBeNull()
      expect(clinicianName(note(), { ...actor, displayName: undefined }, FACILITY)).toBeNull()
    })
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
