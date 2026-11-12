import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AllergiesCard, NOTHING_REPORTED, SEVERITY_HINT, SEVERITY_TONES, allergyAlreadyEnteredInError, allergyChangedSinceShown,
  allergyChangedText,
} from '../../../ehr-blue/clinical/patients/AllergiesCard'
import { NOT_A_SUBSTANCE } from '../../../ehr-blue/clinical/parts/allergyWarning'
import type { Chart } from '../../../ehr-blue/clinical/parts/chart'
import { formatWhen } from '../../../ehr-blue/clinical/parts/format'
import { TONE_OUTLINE } from '../../../kasuwa/ui'
import { parseAllergyCheck, parseAllergyList, warningMessages } from '../../../staff/allergies'

/** The chart's Allergies card (hid-system 0124) and its parsers. Everything is fictional. */

const api = vi.hoisted(() => ({
  allergies: vi.fn(), reportedHealthProfile: vi.fn(), addAllergy: vi.fn(), markAllergyEnteredInError: vi.fn(),
}))
vi.mock('../../../staff/api', () => ({ staffApi: api }))

const FACILITY_ID = 'f0000000-0000-4000-8000-000000000001'
const PATIENT_ID = 'p0000000-0000-4000-8000-000000000001'

function chartWith(permissions: string[], canWrite = true): Chart {
  return {
    facilityId: FACILITY_ID, facilityName: 'Demo Hospital', patientId: PATIENT_ID, purpose: 'direct-care', canWrite,
    writeNotice: null, can: (...wanted: string[]) => wanted.every(permission => permissions.includes(permission)),
    verify: vi.fn(async () => undefined), endAccess: vi.fn(), patient: {} as never, facts: { name: 'Ada Example' } as never,
  }
}

const here = { id: 'a0000000-0000-4000-8000-000000000001', substance: 'Penicillin', reaction: 'Hives', severity: 'severe',
  status: 'active', rowVersion: 1, createdAt: '2026-11-01T09:00:00.000Z', enteredInErrorReason: null, recordedHere: true }
const elsewhere = { ...here, id: 'a0000000-0000-4000-8000-000000000002', substance: 'Sulfa drugs', reaction: 'Rash', severity: 'mild', recordedHere: false }

/** What an element's aria-describedby points to, read out. */
function described(element: Element) {
  return (element.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map(id => document.getElementById(id)?.textContent ?? '').join(' ')
}

beforeEach(() => {
  vi.clearAllMocks()
  api.allergies.mockResolvedValue({ recorded: [here, elsewhere], patientReported: { allergies: 'Peanuts', updatedAt: null } })
  api.reportedHealthProfile.mockResolvedValue({ allergies: 'Peanuts', updatedAt: null })
})

describe('Allergies card', () => {
  it('shows recorded and patient-reported allergies apart, each labelled, and who may mark which', async () => {
    render(<AllergiesCard chart={chartWith(['ehr.note.read', 'ehr.note.write'])} />)
    expect(await screen.findByText('Recorded by clinicians')).toBeTruthy()
    expect(screen.getByText('Penicillin')).toBeTruthy()
    expect(screen.getByText('Reaction: Hives')).toBeTruthy()
    expect(screen.getByText('Severe')).toBeTruthy()
    expect(screen.getByText('Sulfa drugs')).toBeTruthy()
    expect(screen.getByText(/^Recorded at another facility/)).toBeTruthy()
    expect(screen.getByText('Reported by the patient')).toBeTruthy()
    expect(screen.getByText('Peanuts')).toBeTruthy()
    // Only the allergy recorded here can be marked here.
    expect(screen.getAllByRole('button', { name: 'Mark as entered in error' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Add allergy' })).toBeTruthy()
    expect(api.reportedHealthProfile).not.toHaveBeenCalled()
  })

  it('labels each source as the emergency summary does, and says the date is the patient’s health profile’s, not the allergies’', async () => {
    api.allergies.mockResolvedValue({ recorded: [here], patientReported: { allergies: 'Peanuts', updatedAt: '2026-10-02T08:30:00.000Z' } })
    render(<AllergiesCard chart={chartWith(['ehr.note.read'])} />)
    const recorded = (await screen.findByRole('heading', { level: 3, name: 'Recorded by clinicians' })).closest('section')!
    expect(within(recorded).getByText('Clinician-recorded')).toBeTruthy()
    const reported = screen.getByRole('heading', { level: 3, name: 'Reported by the patient' }).closest('section')!
    expect(within(reported).getByText('Patient-reported')).toBeTruthy()
    expect(within(reported).getByText(`Entered by the patient in their Health ID portal, not clinically verified. Health profile last updated ${formatWhen('2026-10-02T08:30:00.000Z')}.`)).toBeTruthy()
    expect(document.body.textContent).not.toContain('Last updated')
  })

  it('before 0124 (404) shows what the patient reported only, with no add button', async () => {
    api.allergies.mockRejectedValue(new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' }))
    render(<AllergiesCard chart={chartWith(['ehr.note.read', 'ehr.note.write'])} />)
    expect(await screen.findByText('Reported by the patient')).toBeTruthy()
    expect(screen.getByText('Peanuts')).toBeTruthy()
    expect(screen.queryByText('Recorded by clinicians')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add allergy' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mark as entered in error' })).toBeNull()
  })

  it('offers no add or mark without ehr.note.write, or under read-only access, and nothing without ehr.note.read', async () => {
    const { unmount } = render(<AllergiesCard chart={chartWith(['ehr.note.read'])} />)
    expect(await screen.findByText('Penicillin')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add allergy' })).toBeNull()
    unmount()
    const second = render(<AllergiesCard chart={chartWith(['ehr.note.read', 'ehr.note.write'], false)} />)
    expect(await screen.findByText('Penicillin')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add allergy' })).toBeNull()
    second.unmount()
    api.allergies.mockClear()
    render(<AllergiesCard chart={chartWith([])} />)
    expect(screen.queryByText('Allergies')).toBeNull()
    expect(api.allergies).not.toHaveBeenCalled()
  })

  it('records an allergy with an idempotency key, then reads the list again', async () => {
    api.addAllergy.mockResolvedValue(here)
    render(<AllergiesCard chart={chartWith(['ehr.note.read', 'ehr.note.write'])} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add allergy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Record allergy' }))
    expect(await screen.findByText('Enter the medicine or substance.')).toBeTruthy()
    expect(api.addAllergy).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Medicine or substance'), { target: { value: ' Latex ' } })
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'moderate' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record allergy' }))
    await waitFor(() => expect(api.addAllergy).toHaveBeenCalledTimes(1))
    expect(api.addAllergy).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, { substance: 'Latex', severity: 'moderate' }, expect.any(String))
    expect(await screen.findByText('Allergy to Latex recorded.')).toBeTruthy()
    await waitFor(() => expect(api.allergies).toHaveBeenCalledTimes(2))
  })

  it('marks an allergy entered in error with a reason and its version', async () => {
    api.markAllergyEnteredInError.mockResolvedValue({ ...here, status: 'entered_in_error' })
    render(<AllergiesCard chart={chartWith(['ehr.note.read', 'ehr.note.write'])} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as entered in error' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark as entered in error' })[0]!)
    expect(await screen.findByText('Say why this allergy was recorded in error.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Why was this recorded in error?'), { target: { value: 'Recorded for the wrong patient' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark as entered in error' })[0]!)
    await waitFor(() => expect(api.markAllergyEnteredInError).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, here.id,
      { expectedRowVersion: 1, reason: 'Recorded for the wrong patient' }))
  })

  /** Opens the mark form on the allergy recorded here, gives a reason and sends it. */
  async function markHere(reason = 'Recorded for the wrong patient') {
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as entered in error' }))
    fireEvent.change(screen.getByLabelText('Why was this recorded in error?'), { target: { value: reason } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark as entered in error' })[0]!)
  }

  it('412 VERSION_CONFLICT on marking: reads the list again, says plainly the allergy changed, and a second try sends its new version', async () => {
    api.markAllergyEnteredInError
      .mockRejectedValueOnce(new HidApiError(412, 'Allergy changed since it was loaded', { code: 'VERSION_CONFLICT' }))
      .mockResolvedValueOnce({ ...here, status: 'entered_in_error', rowVersion: 3 })
    api.allergies
      .mockResolvedValueOnce({ recorded: [here, elsewhere], patientReported: { allergies: 'Peanuts', updatedAt: null } })
      .mockResolvedValueOnce({ recorded: [{ ...here, rowVersion: 2 }, elsewhere], patientReported: { allergies: 'Peanuts', updatedAt: null } })
    render(<AllergiesCard chart={chartWith(['ehr.note.read', 'ehr.note.write'])} />)
    await markHere()
    const said = await screen.findByText(allergyChangedText('Penicillin'))
    expect(said.textContent).toBe('The allergy to Penicillin changed since it was shown, so it was not marked as entered in error. '
      + 'The allergies have been loaded again: check them before you try again.')
    // Said where the closed form was, so it is read out; never "Please try again", and never the EHR's own words.
    expect(document.activeElement).toBe(said)
    expect(screen.queryByLabelText('Why was this recorded in error?')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Please try again|changed since it was loaded|VERSION_CONFLICT/)
    await waitFor(() => expect(api.allergies).toHaveBeenCalledTimes(2))
    // Tried again, it sends the version the list now holds, with what was written.
    fireEvent.click(screen.getByRole('button', { name: 'Mark as entered in error' }))
    expect((screen.getByLabelText('Why was this recorded in error?') as HTMLInputElement).value).toBe('Recorded for the wrong patient')
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark as entered in error' })[0]!)
    await waitFor(() => expect(api.markAllergyEnteredInError).toHaveBeenCalledTimes(2))
    expect(api.markAllergyEnteredInError).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, here.id,
      { expectedRowVersion: 2, reason: 'Recorded for the wrong patient' })
    // Done: the list is read again, and the card no longer says it changed.
    await waitFor(() => expect(api.allergies).toHaveBeenCalledTimes(3))
    expect(screen.queryByText(allergyChangedText('Penicillin'))).toBeNull()
  })

  it('409 ALLERGY_ALREADY_ENTERED_IN_ERROR: reads the list again and says above it that the allergy is already marked, though its row is gone', async () => {
    api.markAllergyEnteredInError.mockRejectedValueOnce(new HidApiError(409, 'Allergy is already entered in error', { code: 'ALLERGY_ALREADY_ENTERED_IN_ERROR' }))
    api.allergies
      .mockResolvedValueOnce({ recorded: [here, elsewhere], patientReported: { allergies: 'Peanuts', updatedAt: null } })
      .mockResolvedValueOnce({ recorded: [elsewhere, { ...here, status: 'entered_in_error', rowVersion: 2 }], patientReported: { allergies: 'Peanuts', updatedAt: null } })
    render(<AllergiesCard chart={chartWith(['ehr.note.read', 'ehr.note.write'])} />)
    await markHere()
    const said = await screen.findByText(allergyChangedText('Penicillin', true))
    // Said as done, never as "changed" or "not marked", which could read as an allergy still active.
    expect(said.textContent).toBe('The allergy to Penicillin has already been marked as entered in error. The allergies have been loaded again.')
    expect(document.activeElement).toBe(said)
    expect(screen.queryByText(allergyChangedText('Penicillin'))).toBeNull()
    expect(document.body.textContent).not.toMatch(/changed since it was shown|not marked as entered in error/)
    await waitFor(() => expect(api.allergies).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('Penicillin')).toBeNull())
    // Still said, in the card, above the list it is about.
    expect(said.isConnected).toBe(true)
    const recorded = screen.getByRole('heading', { level: 3, name: 'Recorded by clinicians' })
    expect(said.compareDocumentPosition(recorded) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mark as entered in error' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/Please try again|already entered in error|ALLERGY_ALREADY/)
  })

  it('keeps saying it when the list read after it fails, beside the read’s own failure', async () => {
    api.markAllergyEnteredInError.mockRejectedValueOnce(new HidApiError(412, 'Changed', { code: 'VERSION_CONFLICT' }))
    api.allergies
      .mockResolvedValueOnce({ recorded: [here], patientReported: { allergies: null, updatedAt: null } })
      .mockRejectedValueOnce(new HidApiError(503, 'Unavailable', { code: 'UNAVAILABLE' }))
    render(<AllergiesCard chart={chartWith(['ehr.note.read', 'ehr.note.write'])} />)
    await markHere()
    expect(await screen.findByText(/could not be loaded\. Confirm allergies with the patient\./)).toBeTruthy()
    expect(screen.getByText(allergyChangedText('Penicillin'))).toBeTruthy()
  })

  it('any other refusal stays in the form, as before, and reads nothing again', async () => {
    api.markAllergyEnteredInError.mockRejectedValueOnce(new HidApiError(409, 'Recorded elsewhere', { code: 'ALLERGY_RECORDED_ELSEWHERE' }))
    render(<AllergiesCard chart={chartWith(['ehr.note.read', 'ehr.note.write'])} />)
    await markHere()
    await waitFor(() => expect(api.markAllergyEnteredInError).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(screen.getByLabelText('Why was this recorded in error?')).toBeTruthy()
    expect(screen.queryByText(allergyChangedText('Penicillin'))).toBeNull()
    expect(api.allergies).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['412 VERSION_CONFLICT', new HidApiError(412, 'x', { code: 'VERSION_CONFLICT' }), true],
    ['409 VERSION_CONFLICT', new HidApiError(409, 'x', { code: 'VERSION_CONFLICT' }), true],
    ['409 ALLERGY_ALREADY_ENTERED_IN_ERROR', new HidApiError(409, 'x', { code: 'ALLERGY_ALREADY_ENTERED_IN_ERROR' }), true],
    ['409 ALLERGY_RECORDED_ELSEWHERE', new HidApiError(409, 'x', { code: 'ALLERGY_RECORDED_ELSEWHERE' }), false],
    ['412 with another code', new HidApiError(412, 'x', { code: 'PRECONDITION_FAILED' }), false],
    ['a failure that is not the EHR’s', new TypeError('x'), false],
  ])('reads %s as “changed since it was shown”: %s', (_label, caught, changed) => {
    expect(allergyChangedSinceShown(caught)).toBe(changed)
    // Of those, only 409 ALLERGY_ALREADY_ENTERED_IN_ERROR is said as already marked.
    expect(allergyAlreadyEnteredInError(caught)).toBe(caught instanceof HidApiError && caught.code === 'ALLERGY_ALREADY_ENTERED_IN_ERROR')
  })

  it('keeps the EHR’s order (most serious first), never sorting again, and shows where and when each was recorded', async () => {
    // As the EHR answers: severe, not known, moderate, mild. Neither by name nor by date, so a sort here would show.
    const row = (n: number, substance: string, severity: string, createdAt: string, recordedHere: boolean) =>
      ({ ...here, id: `a0000000-0000-4000-8000-00000000001${n}`, substance, severity, createdAt, recordedHere, reaction: null })
    api.allergies.mockResolvedValue({ recorded: [
      row(1, 'Penicillin', 'severe', '2026-01-05T09:00:00.000Z', true),
      row(2, 'Latex', 'unknown', '2026-06-01T09:00:00.000Z', false),
      row(3, 'Aspirin', 'moderate', '2026-03-01T09:00:00.000Z', true),
      row(4, 'Codeine', 'mild', '2026-07-01T09:00:00.000Z', false),
    ], patientReported: { allergies: null, updatedAt: null } })
    render(<AllergiesCard chart={chartWith(['ehr.note.read'])} />)
    const list = (await screen.findByText('Penicillin')).closest('ul')!
    expect(Array.from(list.querySelectorAll(':scope > li')).map(item => item.querySelector('span')?.textContent))
      .toEqual(['Penicillin', 'Latex', 'Aspirin', 'Codeine'])
    expect(within(list).getAllByText(/^Recorded at (this|another) facility on /).map(line => line.textContent!.split(' on ')[0]))
      .toEqual(['Recorded at this facility', 'Recorded at another facility', 'Recorded at this facility', 'Recorded at another facility'])
  })

  it('shows "Severity not known" in amber, as moderate, never as quietly as mild; each badge says its severity in words', async () => {
    expect(SEVERITY_TONES).toEqual({ severe: 'danger', unknown: 'warn', moderate: 'warn', mild: 'neutral' })
    api.allergies.mockResolvedValue({ recorded: [
      { ...here, severity: 'severe' },
      { ...here, id: 'a0000000-0000-4000-8000-000000000021', substance: 'Latex', severity: 'unknown' },
      { ...here, id: 'a0000000-0000-4000-8000-000000000022', substance: 'Codeine', severity: 'mild' },
    ], patientReported: { allergies: null, updatedAt: null } })
    render(<AllergiesCard chart={chartWith(['ehr.note.read'])} />)
    const badge = async (words: string) => (await screen.findByText(words)).className.split(' ')
    for (const [words, tone] of [['Severe', 'danger'], ['Severity not known', 'warn'], ['Mild', 'neutral']] as const) {
      expect(await badge(words)).toEqual(expect.arrayContaining(TONE_OUTLINE[tone].split(' ')))
    }
    expect(await badge('Severity not known')).not.toEqual(expect.arrayContaining(TONE_OUTLINE.neutral.split(' ')))
    // The patient's own text is empty: it says whose list is empty, not that there are no allergies.
    expect(screen.getByText(NOTHING_REPORTED)).toBeTruthy()
    expect(screen.queryByText('Nothing reported.')).toBeNull()
  })

  it('says under Severity what severe means and when to choose “Severity not known”; an error takes its place and gets focus', async () => {
    render(<AllergiesCard chart={chartWith(['ehr.note.read', 'ehr.note.write'])} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add allergy' }))
    const severity = screen.getByLabelText('Severity')
    expect(described(severity)).toBe(SEVERITY_HINT)
    expect(SEVERITY_HINT).toContain('choose “Severity not known”')
    expect(severity.getAttribute('aria-invalid')).toBeNull()
    expect(described(screen.getByLabelText(/^Reaction/))).toBe('For example: rash, swelling, difficulty breathing.')
    fireEvent.change(screen.getByLabelText('Medicine or substance'), { target: { value: 'Latex' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record allergy' }))
    const error = 'Choose how severe the reaction is, or “Severity not known”.'
    expect(await screen.findByText(error)).toBeTruthy()
    expect(described(severity)).toBe(error)
    expect(severity.getAttribute('aria-invalid')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(severity))
    expect(screen.queryByText(SEVERITY_HINT)).toBeNull()
    expect(api.addAllergy).not.toHaveBeenCalled()
  })

  it('does not record "NKDA" or "No known allergies": it says why at the field, points to the patient’s own Allergies field, and sends nothing', async () => {
    render(<AllergiesCard chart={chartWith(['ehr.note.read', 'ehr.note.write'])} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add allergy' }))
    const substance = screen.getByLabelText('Medicine or substance')
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'unknown' } })
    for (const words of ['NKDA', ' No known allergies. ', 'none!', 'N/A']) {
      fireEvent.change(substance, { target: { value: words } })
      fireEvent.click(screen.getByRole('button', { name: 'Record allergy' }))
      expect(await screen.findByText(NOT_A_SUBSTANCE)).toBeTruthy()
      expect(described(substance)).toBe(NOT_A_SUBSTANCE)
      expect(substance.getAttribute('aria-invalid')).toBe('true')
      await waitFor(() => expect(document.activeElement).toBe(substance))
    }
    expect(api.addAllergy).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
    // The pointer names what exists: the patient's Allergies field in their Health ID portal, shown on this card.
    expect(NOT_A_SUBSTANCE).toContain('“No known allergies” is not recorded as an allergy.')
    expect(NOT_A_SUBSTANCE).toContain('Allergies field of their Health ID portal')
    expect(screen.getByText('Reported by the patient')).toBeTruthy()
  })

  it('shows the EHR’s 400 ALLERGY_NOT_A_SUBSTANCE at the field in its own words, never as "please try again"', async () => {
    api.addAllergy.mockRejectedValue(new HidApiError(400, 'Record the medicine or substance the patient reacts to.', { code: 'ALLERGY_NOT_A_SUBSTANCE' }))
    render(<AllergiesCard chart={chartWith(['ehr.note.read', 'ehr.note.write'])} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add allergy' }))
    const substance = screen.getByLabelText('Medicine or substance')
    // A phrase this page's copy of the list does not hold: the EHR refuses it, and the page says why.
    fireEvent.change(substance, { target: { value: 'Nothing known to us' } })
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'mild' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record allergy' }))
    expect(await screen.findByText(NOT_A_SUBSTANCE)).toBeTruthy()
    expect(api.addAllergy).toHaveBeenCalledTimes(1)
    expect(described(substance)).toBe(NOT_A_SUBSTANCE)
    await waitFor(() => expect(document.activeElement).toBe(substance))
    expect(screen.queryByText(/could not be recorded|try again/i)).toBeNull()
    expect(screen.queryByText('Record the medicine or substance the patient reacts to.')).toBeNull()

    // Any other refusal keeps the form's own sentence.
    api.addAllergy.mockRejectedValueOnce(new HidApiError(503, 'Unavailable', { code: 'UNAVAILABLE' }))
    fireEvent.change(substance, { target: { value: 'Latex' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record allergy' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText(NOT_A_SUBSTANCE)).toBeNull()
  })

  it('says a failed read plainly, with a retry', async () => {
    api.allergies.mockRejectedValueOnce(new HidApiError(503, 'Unavailable', { code: 'UNAVAILABLE' }))
    render(<AllergiesCard chart={chartWith(['ehr.note.read'])} />)
    expect(await screen.findByText(/could not be loaded/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Penicillin')).toBeTruthy()
  })

  it.each([
    ['an answer it cannot read', () => api.allergies.mockResolvedValueOnce({ recorded: 'not a list' })],
    ['a list with one recorded allergy it cannot read (L9)', () => api.allergies.mockImplementationOnce(async () =>
      parseAllergyList({ recorded: [here, { ...elsewhere, rowVersion: 'two' }], patientReported: { allergies: 'Peanuts', updatedAt: null } }))],
    ['no answer at all', () => api.allergies.mockResolvedValueOnce(null)],
    ['a failure that is not the EHR’s (a parse error)', () => api.allergies.mockRejectedValueOnce(new TypeError('The answer could not be read.'))],
    ['the patient’s text before 0124 not read', () => {
      api.allergies.mockRejectedValueOnce(new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' }))
      api.reportedHealthProfile.mockRejectedValueOnce(new TypeError('The answer could not be read.'))
    }],
  ])('keeps the card after %s: it says the allergies could not be loaded, with a retry, never nothing', async (_label, arrange) => {
    arrange()
    render(<AllergiesCard chart={chartWith(['ehr.note.read'])} />)
    expect(await screen.findByRole('heading', { name: 'Allergies' })).toBeTruthy()
    expect(screen.getByText(/could not be loaded\. Confirm allergies with the patient\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Penicillin')).toBeTruthy()
  })

  it('hides the card only when the EHR refuses (403) or serves neither read (404)', async () => {
    api.allergies.mockRejectedValueOnce(new HidApiError(403, 'Forbidden', { code: 'FORBIDDEN' }))
    const refused = render(<AllergiesCard chart={chartWith(['ehr.note.read'])} />)
    await waitFor(() => expect(api.allergies).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText(/could not be loaded/)).toBeNull())
    expect(screen.queryByRole('heading', { name: 'Allergies' })).toBeNull()
    refused.unmount()
    api.allergies.mockRejectedValueOnce(new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' }))
    api.reportedHealthProfile.mockRejectedValueOnce(new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' }))
    render(<AllergiesCard chart={chartWith(['ehr.note.read'])} />)
    await waitFor(() => expect(api.reportedHealthProfile).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(screen.queryByRole('heading', { name: 'Allergies' })).toBeNull()
  })
})

describe('allergy parsers', () => {
  it('reads the list, an odd severity as not known', () => {
    const list = parseAllergyList({ recorded: [here, { ...here, id: 'y', severity: 'odd' }], patientReported: { allergies: '  ', updatedAt: 'nope' } })
    expect(list.recorded.map(item => item.id)).toEqual([here.id, 'y'])
    expect(list.recorded[1]!.severity).toBe('unknown')
    expect(list.patientReported).toEqual({ allergies: null, updatedAt: null })
    expect(parseAllergyList({ recorded: [], patientReported: null })).toEqual({ recorded: [], patientReported: { allergies: null, updatedAt: null } })
    expect(() => parseAllergyList({})).toThrow()
  })

  it.each([
    ['with no substance', { ...here, substance: ' ' }],
    ['with no id', { ...here, id: undefined }],
    ['with no version', { ...here, rowVersion: null }],
    ['with a status it does not know', { ...here, status: 'refuted' }],
    ['that is not an object', 'Penicillin'],
  ])('fails the whole list for one recorded allergy %s, never dropping it in silence (L9)', (_label, odd) => {
    expect(() => parseAllergyList({ recorded: [here, odd, elsewhere], patientReported: { allergies: 'Peanuts', updatedAt: null } }))
      .toThrow('The allergies could not be read.')
  })

  it('reads the check and a refusal’s warning messages; a line it cannot read fails the whole answer', () => {
    const token = 'c'.repeat(64)
    const reported = { source: 'patient_reported', substance: 'penicillin', reaction: null, severity: null, matchKind: 'same_medicine', message: 'M' }
    expect(parseAllergyCheck({ matches: [reported], acknowledgementRequired: true, warningToken: token }).matches)
      .toEqual([{ source: 'patient_reported', substance: 'penicillin', reaction: null, severity: null, matchKind: 'same_medicine', message: 'M' }])
    expect(() => parseAllergyCheck({ matches: [reported, { message: '' }], acknowledgementRequired: true, warningToken: token })).toThrow()
    expect(warningMessages([{ field: 'allergyAcknowledgement', messages: ['One', 2, ''] }, { field: 'other', messages: ['x'] },
      { field: 'allergyAcknowledgement.warningToken', messages: [token] }])).toEqual(['One'])
    expect(warningMessages(null)).toEqual([])
  })
})
