import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AllergyWarningPanel } from '../../../ehr-blue/clinical/parts/AllergyWarningPanel'
import {
  ACK_NOT_ACCEPTED, ACK_REASON_HIDDEN, ACK_REASON_HINT, ACK_REASON_LONG, ACK_REASON_NO_WORD, ACK_REASON_SHORT, ALLERGY_WARNING_CHANGED,
  acknowledgementReasonProblem, acknowledgementRefused, allergyCheckInput, allergyWarningTitle, checkAcknowledgement, isNotASubstanceRefusal,
  isSevereLine, messageLines, normaliseAcknowledgementReason, readAllergyRefusal, sameMedicine, tickError, useAllergyAcknowledgement,
  warningFromCheck, warningFromRefusal, warningLines, withAllergyAcknowledgement, type ShownAllergyWarning,
} from '../../../ehr-blue/clinical/parts/allergyWarning'
import { RecordForm } from '../../../ehr-blue/clinical/parts/RecordForm'
import {
  isNoKnownAllergy, parseAllergyCheck, refusalWarningToken, warningMessages, type AllergyCheck,
} from '../../../staff/allergies'

/**
 * The allergy warning's foundation (hid-system#218 at 7fbb04aa): the check's answer, the 409 that asks for (or again
 * for) a reason, the reason's rule, and the shared panel the prescribing form, Activate, Resume and Send show. The
 * messages are the backend's format word for word; every id, token, date and name is fictional.
 */

const TOKEN_A = 'a'.repeat(64)
const TOKEN_B = 'b'.repeat(64)
const ID_1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const ID_2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const ID_3 = 'aaaaaaaa-0000-4000-8000-000000000003'
const ID_4 = 'aaaaaaaa-0000-4000-8000-000000000004'

const SEVERE_HERE = {
  source: 'recorded', allergyId: ID_1, allergyIds: [ID_1], substance: 'Penicillin', reaction: 'Anaphylaxis', severity: 'severe',
  matchKind: 'same_class', className: 'penicillins', recordedHere: true, recordedOn: '2026-03-03T09:15:00.000Z',
  message: 'Penicillin allergy: SEVERE (Anaphylaxis). This medicine is one of the penicillins, the same group. Recorded by a clinician at this facility on 3 Mar 2026.',
}
const MODERATE_ELSEWHERE = {
  source: 'recorded', allergyId: ID_2, allergyIds: [ID_2], substance: 'Cefalexin', reaction: 'Hives', severity: 'moderate',
  matchKind: 'cross_reactivity', className: 'penicillins', recordedHere: false, recordedOn: '2026-02-10T23:30:00.000Z',
  message: 'Cefalexin allergy: moderate (Hives). This medicine is a penicillin. Some people allergic to cephalosporins also react to penicillins: a risk, not a certainty. Recorded by a clinician at another facility on 11 Feb 2026.',
}
const GROUPED_UNKNOWN = {
  source: 'recorded', allergyId: ID_3, allergyIds: [ID_3, ID_4], substance: 'Amoxicillin', reaction: null, severity: 'unknown',
  matchKind: 'same_medicine', recordedHere: true, recordedOn: '2026-04-20T10:00:00.000Z',
  message: 'Amoxicillin allergy: severity not known. This medicine may be, or may contain, the same medicine. Recorded by clinicians (recorded at 2 facilities), most recently on 20 Apr 2026.',
}
const PATIENT_TERM = {
  source: 'patient_reported', substance: 'Augmentin', reaction: null, severity: null, matchKind: 'same_medicine',
  message: 'Patient-reported allergy: “Augmentin”. This medicine may be, or may contain, the same medicine. Entered by the patient in their Health ID portal, not checked by a clinician.',
}
const SULFA_TERM = {
  source: 'patient_reported', substance: 'Sulfa drugs', reaction: null, severity: null, matchKind: 'same_class', className: 'sulfonamides (“sulfa” medicines)',
  message: 'Patient-reported allergy: “Sulfa drugs”. This medicine is one of the sulfonamides (“sulfa” medicines), the same group. Entered by the patient in their Health ID portal, not checked by a clinician.',
}
const MILD_NSAID = {
  source: 'recorded', allergyId: ID_4, allergyIds: [ID_4], substance: 'Aspirin', reaction: 'Rash', severity: 'mild',
  matchKind: 'same_class', className: 'NSAIDs, the anti-inflammatory painkillers', recordedHere: false, recordedOn: '2026-01-05T08:00:00.000Z',
  message: 'Aspirin allergy: mild (Rash). This medicine is one of the NSAIDs, the anti-inflammatory painkillers, the same group. Recorded by a clinician at another facility on 5 Jan 2026.',
}

const MEDICINE = { display: 'Amoxicillin 500 mg capsules' }

function answer(matches: unknown[], token = TOKEN_A) {
  return { matches, acknowledgementRequired: matches.length > 0, warningToken: token }
}

function check(matches: unknown[], token = TOKEN_A): AllergyCheck {
  return parseAllergyCheck(answer(matches, token))
}

/** The 409 as the http client gives it: the problem's errors are the error's details. */
function refusal(messages: string[], token: string | null = TOKEN_B, detail = 'This medicine may match an allergy on the patient\'s record.') {
  return new HidApiError(409, 'Conflict', {
    code: 'ALLERGY_ACKNOWLEDGEMENT_REQUIRED', detail,
    details: [...messages.map(message => ({ field: 'allergyAcknowledgement', messages: [message] })),
      ...(token === null ? [] : [{ field: 'allergyAcknowledgement.warningToken', messages: [token] }])],
  })
}

describe('the allergy check’s answer (7fbb04aa)', () => {
  it('keeps every field of a recorded line, a grouped line and a patient-reported line, and the token', () => {
    const read = check([SEVERE_HERE, GROUPED_UNKNOWN, SULFA_TERM])
    expect(read.acknowledgementRequired).toBe(true)
    expect(read.warningToken).toBe(TOKEN_A)
    expect(read.matches[0]).toEqual(SEVERE_HERE)
    expect(read.matches[1]).toEqual(GROUPED_UNKNOWN)
    expect(read.matches[1]!.allergyIds).toEqual([ID_3, ID_4])
    // A patient-reported line has no ids, recordedHere or recordedOn.
    expect(read.matches[2]).toEqual(SULFA_TERM)
    expect(Object.keys(read.matches[2]!)).not.toContain('allergyIds')
    expect(Object.keys(read.matches[2]!)).not.toContain('recordedHere')
  })

  it('reads an answer with no match, which still has a token, as nothing to acknowledge', () => {
    const read = check([])
    expect(read).toEqual({ matches: [], acknowledgementRequired: false, warningToken: TOKEN_A })
    expect(warningFromCheck(read, MEDICINE)).toBeNull()
  })

  it('takes an answer it cannot read as a failure, never as “no allergies”', () => {
    for (const bad of [
      { ...answer([SEVERE_HERE]), warningToken: undefined },
      { ...answer([SEVERE_HERE]), warningToken: 'A'.repeat(64) },
      { ...answer([SEVERE_HERE]), warningToken: 'a'.repeat(63) },
      { ...answer([]), warningToken: 'not a token' },
      { ...answer([SEVERE_HERE]), acknowledgementRequired: 'yes' },
      { ...answer([SEVERE_HERE]), acknowledgementRequired: false },
      { ...answer([]), acknowledgementRequired: true },
      answer([{ ...SEVERE_HERE, message: '' }]),
      answer([{ ...SEVERE_HERE, matchKind: 'similar' }]),
      answer([{ ...SEVERE_HERE, source: 'pharmacy' }]),
      answer([SEVERE_HERE, 'not a line']),
      { matches: 'none', acknowledgementRequired: false, warningToken: TOKEN_A },
      null,
    ]) expect(() => parseAllergyCheck(bad)).toThrow()
  })

  it('reads an odd severity as not known, a lone allergyId as its ids, and keeps a long message whole', () => {
    const long = `Patient-reported allergy: “${'x'.repeat(1200)}”. This medicine may be, or may contain, the same medicine.`
    const read = check([{ ...SEVERE_HERE, severity: 'extreme', allergyIds: undefined }, { ...PATIENT_TERM, message: long }])
    expect(read.matches[0]!.severity).toBe('unknown')
    expect(read.matches[0]!.allergyIds).toEqual([ID_1])
    expect(read.matches[1]!.message).toBe(long)
  })

  it('reads the class names as the EHR writes them, carbapenems included', () => {
    const carbapenem = { ...MODERATE_ELSEWHERE, className: 'carbapenems' }
    expect(check([SULFA_TERM, MILD_NSAID, carbapenem]).matches.map(match => match.className))
      .toEqual(['sulfonamides (“sulfa” medicines)', 'NSAIDs, the anti-inflammatory painkillers', 'carbapenems'])
  })
})

describe('the 409 ALLERGY_ACKNOWLEDGEMENT_REQUIRED', () => {
  const MESSAGES = [SEVERE_HERE.message, PATIENT_TERM.message]

  it('reads one warning per allergyAcknowledgement entry and the token from allergyAcknowledgement.warningToken', () => {
    const caught = refusal(MESSAGES)
    expect(warningMessages(caught.details)).toEqual(MESSAGES)
    expect(refusalWarningToken(caught.details)).toBe(TOKEN_B)
    expect(readAllergyRefusal(caught, false)).toEqual({ messages: MESSAGES, warningToken: TOKEN_B, changedSinceShown: false })
  })

  it('says “changed since it was shown” exactly when the refused request carried an acknowledgement', () => {
    // The code and status are the same; the detail is never read or shown.
    const changed = refusal(MESSAGES, TOKEN_B, 'The allergy warning changed since it was shown. Check the allergies again and give a reason to go ahead.')
    expect(readAllergyRefusal(changed, true)!.changedSinceShown).toBe(true)
    expect(readAllergyRefusal(refusal(MESSAGES), true)!.changedSinceShown).toBe(true)
    expect(readAllergyRefusal(changed, false)!.changedSinceShown).toBe(false)
  })

  it('is null for any other refusal, and reads no token that is not 64 lower-case hex', () => {
    expect(readAllergyRefusal(new HidApiError(409, 'Conflict', { code: 'VERSION_CONFLICT' }), false)).toBeNull()
    expect(readAllergyRefusal(new HidApiError(400, 'Bad', { code: 'ALLERGY_ACKNOWLEDGEMENT_REQUIRED' }), false)).toBeNull()
    expect(readAllergyRefusal(new Error('offline'), false)).toBeNull()
    expect(readAllergyRefusal(refusal(MESSAGES, TOKEN_B.toUpperCase()), false)!.warningToken).toBeNull()
    expect(readAllergyRefusal(refusal(MESSAGES, null), false)!.warningToken).toBeNull()
    expect(refusalWarningToken([{ field: 'allergyAcknowledgement.warningToken', messages: [42] }])).toBeNull()
    expect(refusalWarningToken(null)).toBeNull()
  })

  it('shows the check’s structured lines and newest token after a 409, else the 409’s own sentences and token', () => {
    const read = readAllergyRefusal(refusal(MESSAGES), true)!
    const withCheck = warningFromRefusal(read, MEDICINE, check([PATIENT_TERM, SEVERE_HERE], TOKEN_A))!
    expect(withCheck.warningToken).toBe(TOKEN_A)
    expect(withCheck.changedSinceShown).toBe(true)
    expect(withCheck.lines.map(line => line.match?.source)).toEqual(['recorded', 'patient_reported'])

    const alone = warningFromRefusal(read, MEDICINE, null)!
    expect(alone).toEqual({ medicine: MEDICINE, warningToken: TOKEN_B, changedSinceShown: true,
      lines: [{ key: 'message:0', message: SEVERE_HERE.message, match: null }, { key: 'message:1', message: PATIENT_TERM.message, match: null }] })
    // A check that now finds nothing does not hide the 409's warning.
    expect(warningFromRefusal(read, MEDICINE, check([]))!.warningToken).toBe(TOKEN_B)
    // No token anywhere: nothing can be acknowledged.
    expect(warningFromRefusal(readAllergyRefusal(refusal(MESSAGES, null), false)!, MEDICINE, null)).toBeNull()
  })

  it('tells the other allergy refusals apart', () => {
    const notAccepted = new HidApiError(400, 'Bad', { code: 'VALIDATION_FAILED', details: [{ field: 'allergyAcknowledgement', messages: [] }] })
    expect(acknowledgementRefused(notAccepted)).toBe(true)
    expect(acknowledgementRefused(new HidApiError(400, 'Bad', { code: 'VALIDATION_FAILED', details: [{ field: 'frequency', messages: ['x'] }] }))).toBe(false)
    expect(isNotASubstanceRefusal(new HidApiError(400, 'Bad', { code: 'ALLERGY_NOT_A_SUBSTANCE' }))).toBe(true)
    expect(isNotASubstanceRefusal(new HidApiError(400, 'Bad', { code: 'VALIDATION_FAILED' }))).toBe(false)
    expect(isNotASubstanceRefusal(new Error('x'))).toBe(false)
  })
})

describe('“No known allergies” is not an allergy', () => {
  it('matches the EHR’s list exactly', () => {
    for (const refused of ['NKDA', 'nkda.', 'No known allergies.', 'None!', 'N/A', 'Not known', ' nkda', 'nil', 'No known drug allergies', 'none known'])
      expect(isNoKnownAllergy(refused)).toBe(true)
    for (const kept of ['no known allergy', 'Nil known', 'No known allergies to medicines', 'Penicillin', 'Nuts'])
      expect(isNoKnownAllergy(kept)).toBe(false)
  })
})

describe('warning lines and the title', () => {
  it('orders lines severe, not known, moderate, mild, then the patient’s words, keyed by their ids', () => {
    const lines = warningLines(check([PATIENT_TERM, MILD_NSAID, MODERATE_ELSEWHERE, GROUPED_UNKNOWN, SEVERE_HERE]).matches)
    expect(lines.map(line => line.match!.substance)).toEqual(['Penicillin', 'Amoxicillin', 'Cefalexin', 'Aspirin', 'Augmentin'])
    expect(lines.map(line => line.key)).toEqual([`recorded:${ID_1}`, `recorded:${ID_3},${ID_4}`, `recorded:${ID_2}`, `recorded:${ID_4}`, 'patient_reported:0'])
    expect(new Set(lines.map(line => line.key)).size).toBe(lines.length)
  })

  it('calls severe, or not known, or a serious reaction severe (Ola, wording #0), from the check and from a 409 alone alike', () => {
    const [severe, unknown, moderate, patient] = warningLines(check([SEVERE_HERE, MODERATE_ELSEWHERE, GROUPED_UNKNOWN, PATIENT_TERM]).matches)
    expect(isSevereLine(severe!)).toBe(true)
    // Not known: a reaction nobody graded may have been severe.
    expect(isSevereLine(unknown!)).toBe(true)
    expect(isSevereLine(moderate!)).toBe(false)
    expect(isSevereLine(patient!)).toBe(false)
    const [swelling] = warningLines(check([{ ...MODERATE_ELSEWHERE, reaction: 'Swelling of the lips' }]).matches)
    expect(isSevereLine(swelling!)).toBe(true)
    // The patient's own words name a serious reaction.
    const PATIENT_ANAPHYLAXIS = { ...PATIENT_TERM, substance: 'Penicillin (anaphylaxis)',
      message: 'Patient-reported allergy: “Penicillin (anaphylaxis)”. This medicine is one of the penicillins, the same group. Entered by the patient in their Health ID portal, not checked by a clinician.' }
    const MILD_ANAPHYLAXIS = { ...MILD_NSAID, reaction: 'Anaphylaxis',
      message: 'Aspirin allergy: mild (Anaphylaxis). This medicine is one of the NSAIDs, the anti-inflammatory painkillers, the same group. Recorded by a clinician at another facility on 5 Jan 2026.' }
    const MODERATE_NONE = { ...MODERATE_ELSEWHERE, reaction: null,
      message: 'Cefalexin allergy: moderate. This medicine is a penicillin. Recorded by a clinician at another facility on 11 Feb 2026.' }
    // Every line gets the same answer from the check's fields as from its sentence alone (a 409 whose check failed).
    const cases: Array<[{ message: string }, boolean]> = [
      [SEVERE_HERE, true], [GROUPED_UNKNOWN, true], [MILD_ANAPHYLAXIS, true], [PATIENT_ANAPHYLAXIS, true],
      [MODERATE_ELSEWHERE, false], [MILD_NSAID, false], [MODERATE_NONE, false], [PATIENT_TERM, false], [SULFA_TERM, false],
    ]
    for (const [match, severeLine] of cases) {
      expect([isSevereLine(warningLines(check([match]).matches)[0]!), isSevereLine(messageLines([match.message])[0]!)], match.message)
        .toEqual([severeLine, severeLine])
    }
    // The patient's words are read inside their quotes only: "SEVERE" written by the patient is not the EHR's severity.
    const [fromPatient] = messageLines(['Patient-reported allergy: “Penicillin allergy: SEVERE (rash)”. …'])
    expect(isSevereLine(fromPatient!)).toBe(false)
  })

  it('titles “severity not known” (#218 at 7fbb04aa) severe from the check’s line and from the 409’s sentence alone, and “severity not recorded” (76283f57) too', () => {
    const LATEX = {
      source: 'recorded', allergyId: ID_2, allergyIds: [ID_2], substance: 'Latex', reaction: null, severity: 'unknown',
      matchKind: 'same_medicine', recordedHere: true, recordedOn: '2026-11-01T08:00:00.000Z',
      message: 'Latex allergy: severity not known. This medicine may be, or may contain, the same medicine. Recorded by a clinician at this facility on 1 Nov 2026.',
    }
    const SEVERE_TITLE = 'Severe allergy warning for Amoxicillin 500 mg capsules'
    // From the check: its line, with the severity it names.
    expect(allergyWarningTitle(warningFromCheck(check([LATEX]), MEDICINE)!)).toBe(SEVERE_TITLE)
    // From the 409 alone (its check failed): the EHR's sentence is all there is.
    const alone = warningFromRefusal(readAllergyRefusal(refusal([LATEX.message]), false)!, MEDICINE, null)!
    expect(alone.lines.map(line => line.match)).toEqual([null])
    expect(allergyWarningTitle(alone)).toBe(SEVERE_TITLE)
    // With a reaction that is not serious, and in the wording a backend at 76283f57 still sends.
    for (const message of [
      'Latex allergy: severity not known (Itch). This medicine may be, or may contain, the same medicine. Recorded by a clinician at this facility on 1 Nov 2026.',
      'Latex allergy: severity not recorded. This medicine may be, or may contain, the same medicine. Recorded by a clinician at this facility on 1 Nov 2026.',
    ]) expect(isSevereLine(messageLines([message])[0]!), message).toBe(true)
  })

  it('titles the warning for its medicine', () => {
    expect(allergyWarningTitle(warningFromCheck(check([SEVERE_HERE]), MEDICINE)!)).toBe('Severe allergy warning for Amoxicillin 500 mg capsules')
    expect(allergyWarningTitle(warningFromCheck(check([GROUPED_UNKNOWN]), MEDICINE)!)).toBe('Severe allergy warning for Amoxicillin 500 mg capsules')
    expect(allergyWarningTitle(warningFromCheck(check([MILD_NSAID, PATIENT_TERM]), { display: ' Ibuprofen 400 mg ' })!)).toBe('Allergy warning for Ibuprofen 400 mg')
  })
})

describe('the medicine and the body', () => {
  it('treats any edit of the text or the code as another medicine, and leaves a blank code out of the check', () => {
    expect(sameMedicine({ display: 'Amoxicillin 500 mg ' }, { display: 'Amoxicillin 500 mg', code: ' ' })).toBe(true)
    expect(sameMedicine({ display: 'Amoxicillin 500 mg' }, { display: 'Amoxicillin 250 mg' })).toBe(false)
    expect(sameMedicine({ display: 'Amoxicillin 500 mg' }, { display: 'Amoxicillin 500 mg', code: '723' })).toBe(false)
    expect(allergyCheckInput({ display: ' Amoxicillin 500 mg ', code: '  ' })).toEqual({ medicationDisplay: 'Amoxicillin 500 mg' })
    expect(allergyCheckInput({ display: 'Amoxicillin 500 mg', code: ' 723 ' })).toEqual({ medicationDisplay: 'Amoxicillin 500 mg', medicationCode: '723' })
  })

  it('adds the acknowledgement only when there is one, with its two members only', () => {
    const body = { medicationDisplay: 'Amoxicillin 500 mg', status: 'draft' }
    expect(withAllergyAcknowledgement(body, null)).toBe(body)
    expect('allergyAcknowledgement' in withAllergyAcknowledgement(body, undefined)).toBe(false)
    const extra = { reason: 'Tolerated amoxicillin in 2024', warningToken: TOKEN_A, more: 1 } as never
    expect(withAllergyAcknowledgement(body, extra)).toEqual({ ...body, allergyAcknowledgement: { reason: 'Tolerated amoxicillin in 2024', warningToken: TOKEN_A } })
  })
})

describe('the reason, by the EHR’s rule', () => {
  it('asks for 10 to 500 characters with a real word, and says which rule failed', () => {
    expect(acknowledgementReasonProblem('')).toBe(ACK_REASON_SHORT)
    expect(acknowledgementReasonProblem('Tolerated')).toBe(ACK_REASON_SHORT)
    expect(acknowledgementReasonProblem('1234567890')).toBe(ACK_REASON_NO_WORD)
    expect(acknowledgementReasonProblem('ok ok ok ok ok')).toBe(ACK_REASON_NO_WORD)
    expect(acknowledgementReasonProblem('...........')).toBe(ACK_REASON_NO_WORD)
    expect(acknowledgementReasonProblem(`Tolerated ${'x'.repeat(491)}`)).toBe(ACK_REASON_LONG)
    expect(acknowledgementReasonProblem(`Tolerated ${'x'.repeat(490)}`)).toBeNull()
    expect(acknowledgementReasonProblem('Été 2024 ok')).toBeNull()
    expect(acknowledgementReasonProblem('Tolerated before.\nObserve for 30 minutes.')).toBeNull()
    expect(acknowledgementReasonProblem('Tolerated\u0007 before')).toBe(ACK_REASON_HIDDEN)
    expect(acknowledgementReasonProblem('Tolerated\tbefore')).toBe(ACK_REASON_HIDDEN)
    // Counted as the EHR counts: a character outside the basic plane is one.
    expect(acknowledgementReasonProblem(`abc${'😀'.repeat(497)}`)).toBeNull()
    expect(acknowledgementReasonProblem(`abc${'😀'.repeat(498)}`)).toBe(ACK_REASON_LONG)
  })

  it('sends line ends as new lines and tabs as spaces, drops hidden characters and trims', () => {
    expect(normaliseAcknowledgementReason('  Tolerated\r\nbefore\rand\tafter\u0007  ')).toBe('Tolerated\nbefore\nand after')
  })

  it('gives the tick and the reason their own errors', () => {
    expect(checkAcknowledgement({ ticked: false, reason: 'ok', lines: 2 }).errors)
      .toEqual({ tick: tickError(2), reason: ACK_REASON_SHORT })
    expect(checkAcknowledgement({ ticked: false, reason: 'Tolerated amoxicillin last year; will monitor', lines: 1 }).errors)
      .toEqual({ tick: 'Tick the box to confirm you have checked this allergy with the patient.' })
    expect(checkAcknowledgement({ ticked: true, reason: '1234567890', lines: 1 }).errors).toEqual({ reason: ACK_REASON_NO_WORD })
    expect(checkAcknowledgement({ ticked: true, reason: '  Tolerated amoxicillin last year  ', lines: 1 }))
      .toEqual({ reason: 'Tolerated amoxicillin last year', errors: {} })
  })
})

function shown(matches: unknown[], token = TOKEN_A, changedSinceShown = false): ShownAllergyWarning {
  return warningFromCheck(check(matches, token), MEDICINE, changedSinceShown)!
}

describe('the allergy warning panel', () => {
  function renderPanel(warning: ShownAllergyWarning, props: Partial<Parameters<typeof AllergyWarningPanel>[0]> = {}) {
    const onTickedChange = vi.fn()
    const onReasonChange = vi.fn()
    const view = render(<AllergyWarningPanel idPrefix="rx" warning={warning} ticked={false} reason="" errors={{}}
      onTickedChange={onTickedChange} onReasonChange={onReasonChange} {...props} />)
    return { ...view, onTickedChange, onReasonChange }
  }

  it('titles a severe warning, shows each line whole as one item, and moves focus to the title', () => {
    renderPanel(shown([PATIENT_TERM, GROUPED_UNKNOWN, SEVERE_HERE]))
    const title = screen.getByRole('heading', { level: 3, name: 'Severe allergy warning for Amoxicillin 500 mg capsules' })
    expect(document.activeElement).toBe(title)
    const panel = screen.getByRole('region', { name: 'Severe allergy warning for Amoxicillin 500 mg capsules' })
    const items = within(panel).getAllByRole('listitem').map(item => item.textContent)
    // Severe first; the grouped line is one line; nothing is added beside the EHR's sentence.
    expect(items).toEqual([SEVERE_HERE.message, GROUPED_UNKNOWN.message, PATIENT_TERM.message])
    expect(within(panel).queryByText('Severe')).toBeNull()
    expect(within(panel).queryByText(/Reaction:/)).toBeNull()
    expect(within(panel).getByText('Ask the patient about these allergies before you go ahead.')).toBeTruthy()
    // No announcement of its own (Ola, W8): the page's error box is the one, and focus is on the title.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(document.querySelector('[aria-live]')).toBeNull()
    expect(panel.className).toContain('hid-ehr-clinical-allergy-warning-severe')
  })

  it('keeps today’s title for a warning with no severe line', () => {
    renderPanel(shown([MILD_NSAID]))
    expect(screen.getByRole('heading', { name: 'Allergy warning for Amoxicillin 500 mg capsules' })).toBeTruthy()
    expect(screen.getByText('Ask the patient about this allergy before you go ahead.')).toBeTruthy()
  })

  it('asks for the tick and a reason in a text box with examples, each tied to its own error', () => {
    const { onTickedChange, onReasonChange } = renderPanel(shown([SEVERE_HERE]),
      { errors: { tick: tickError(1), reason: ACK_REASON_NO_WORD } })
    const box = screen.getByRole('checkbox', { name: 'I have checked this allergy with the patient and want to go ahead with Amoxicillin 500 mg capsules.' })
    expect(box.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(box.getAttribute('aria-describedby')!)!.textContent).toBe(tickError(1))
    const reason = screen.getByRole('textbox', { name: 'Why is it safe to go ahead?' })
    expect(reason.tagName).toBe('TEXTAREA')
    expect(reason.getAttribute('maxlength')).toBe('500')
    expect(reason.getAttribute('aria-invalid')).toBe('true')
    const described = reason.getAttribute('aria-describedby')!.split(' ').map(id => document.getElementById(id)!.textContent)
    expect(described).toEqual([ACK_REASON_NO_WORD, ACK_REASON_HINT])
    expect(described).not.toContain(tickError(1))
    fireEvent.click(box)
    expect(onTickedChange).toHaveBeenCalledWith(true)
    fireEvent.change(reason, { target: { value: 'Tolerated amoxicillin in 2024' } })
    expect(onReasonChange).toHaveBeenCalledWith('Tolerated amoxicillin in 2024')
  })

  it('says when the warning changed since it was shown, and takes focus again for a new warning', () => {
    const { rerender } = renderPanel(shown([MILD_NSAID]))
    const box = screen.getByRole('checkbox')
    box.focus()
    const props = { idPrefix: 'rx', ticked: false, reason: '', errors: {}, onTickedChange: vi.fn(), onReasonChange: vi.fn() }
    // The same warning again (the same token) leaves focus where it is.
    rerender(<AllergyWarningPanel {...props} warning={shown([MILD_NSAID])} />)
    expect(document.activeElement).toBe(box)
    rerender(<AllergyWarningPanel {...props} warning={shown([MILD_NSAID, SEVERE_HERE], TOKEN_B, true)} />)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Severe allergy warning for Amoxicillin 500 mg capsules' }))
    expect(screen.getByText(ALLERGY_WARNING_CHANGED)).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})

describe('useAllergyAcknowledgement with the panel', () => {
  let sent: unknown[] = []

  function Form() {
    const ack = useAllergyAcknowledgement()
    const [medicine, setMedicine] = useState(MEDICINE.display)
    return (
      <div>
        <label>Medication<input value={medicine} onChange={event => { setMedicine(event.target.value); ack.medicineChanged({ display: event.target.value }) }} /></label>
        <button type="button" onClick={() => ack.show(shown([SEVERE_HERE]))}>Warn A</button>
        <button type="button" onClick={() => ack.show(shown([SEVERE_HERE], 'c'.repeat(64)))}>Warn A again</button>
        <button type="button" onClick={() => ack.show(shown([SEVERE_HERE, PATIENT_TERM], TOKEN_B, true))}>Warn B</button>
        <button type="button" onClick={() => ack.refuseReason()}>Refuse reason</button>
        <button type="button" onClick={() => { sent.push(ack.acknowledgement()) }}>Save</button>
        {ack.warning ? <AllergyWarningPanel idPrefix="rx" warning={ack.warning} ticked={ack.ticked} reason={ack.reason} errors={ack.errors}
          focus={ack.focus} onTickedChange={ack.setTicked} onReasonChange={ack.setReason} /> : null}
      </div>
    )
  }

  const tick = () => screen.getByRole('checkbox') as HTMLInputElement
  const reason = () => screen.getByRole('textbox', { name: 'Why is it safe to go ahead?' })

  it('sends nothing without a warning, and refuses a missing tick and a short reason separately', () => {
    sent = []
    render(<Form />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(sent).toEqual([null])
    fireEvent.click(screen.getByRole('button', { name: 'Warn A' }))
    fireEvent.change(reason(), { target: { value: 'ok' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(sent).toEqual([null, null])
    expect(screen.getByText(tickError(1))).toBeTruthy()
    expect(screen.getByText(ACK_REASON_SHORT)).toBeTruthy()
    // Each error clears as its own answer changes.
    fireEvent.click(tick())
    expect(screen.queryByText(tickError(1))).toBeNull()
    expect(screen.getByText(ACK_REASON_SHORT)).toBeTruthy()
    fireEvent.change(reason(), { target: { value: ' Tolerated amoxicillin last year; will monitor ' } })
    expect(screen.queryByText(ACK_REASON_SHORT)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(sent[2]).toEqual({ reason: 'Tolerated amoxicillin last year; will monitor', warningToken: TOKEN_A })
  })

  it('unticks the box for a new warning (another token), keeps it for the same one, and empties the reason when the warning changed', () => {
    sent = []
    render(<Form />)
    fireEvent.click(screen.getByRole('button', { name: 'Warn A' }))
    fireEvent.click(tick())
    fireEvent.change(reason(), { target: { value: 'Tolerated amoxicillin last year; will monitor' } })
    fireEvent.click(screen.getByRole('button', { name: 'Warn A' }))
    expect(tick().checked).toBe(true)
    // Another token for the same warning: unticked, the reason kept.
    fireEvent.click(screen.getByRole('button', { name: 'Warn A again' }))
    expect(tick().checked).toBe(false)
    expect((reason() as HTMLTextAreaElement).value).toBe('Tolerated amoxicillin last year; will monitor')
    fireEvent.click(tick())
    // The EHR says the warning changed since it was shown: unticked, and the reason, written for the old one, emptied.
    fireEvent.click(screen.getByRole('button', { name: 'Warn B' }))
    expect(tick().checked).toBe(false)
    expect(screen.getByText(ALLERGY_WARNING_CHANGED)).toBeTruthy()
    expect((reason() as HTMLTextAreaElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(sent).toEqual([null])
    fireEvent.click(tick())
    fireEvent.change(reason(), { target: { value: 'Checked the new allergy with the patient; will monitor' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(sent[1]).toEqual({ reason: 'Checked the new allergy with the patient; will monitor', warningToken: TOKEN_B })
  })

  it('moves focus to the first answer refused, the tick before the reason, each time, and to the reason the EHR refused', () => {
    sent = []
    render(<Form />)
    fireEvent.click(screen.getByRole('button', { name: 'Warn A' }))
    const save = screen.getByRole('button', { name: 'Save' })
    save.focus()
    fireEvent.click(save)
    expect(document.activeElement).toBe(tick())
    expect(tick().getAttribute('aria-describedby')).toBeTruthy()
    fireEvent.click(tick())
    fireEvent.change(reason(), { target: { value: '1234567890' } })
    save.focus()
    fireEvent.click(save)
    expect(document.activeElement).toBe(reason())
    expect(reason().getAttribute('aria-describedby')!.split(' ').map(id => document.getElementById(id)!.textContent)).toContain(ACK_REASON_NO_WORD)
    // Refused again in the same way: focus is moved again.
    save.focus()
    fireEvent.click(save)
    expect(document.activeElement).toBe(reason())
    expect(sent).toEqual([null, null, null])
    save.focus()
    fireEvent.click(screen.getByRole('button', { name: 'Refuse reason' }))
    expect(document.activeElement).toBe(reason())
  })

  it('drops the warning, the tick, the reason and the token as soon as the medicine is edited', () => {
    sent = []
    render(<Form />)
    fireEvent.click(screen.getByRole('button', { name: 'Warn A' }))
    fireEvent.click(tick())
    fireEvent.change(reason(), { target: { value: 'Tolerated amoxicillin last year' } })
    // Spaces round the name are the same medicine.
    fireEvent.change(screen.getByLabelText('Medication'), { target: { value: `${MEDICINE.display} ` } })
    expect(screen.getByRole('region')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Medication'), { target: { value: 'Amoxicillin 250 mg capsules' } })
    expect(screen.queryByRole('region')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(sent).toEqual([null])
    fireEvent.click(screen.getByRole('button', { name: 'Warn A' }))
    expect(tick().checked).toBe(false)
    expect((reason() as HTMLTextAreaElement).value).toBe('')
  })

  it('says the EHR did not accept the reason, on the reason', () => {
    render(<Form />)
    fireEvent.click(screen.getByRole('button', { name: 'Warn A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refuse reason' }))
    expect(screen.getByText(ACK_NOT_ACCEPTED)).toBeTruthy()
    expect(reason().getAttribute('aria-invalid')).toBe('true')
  })
})

describe('RecordForm tells the page of each change', () => {
  it('calls onFieldChange with the field and its value as kept', async () => {
    const onFieldChange = vi.fn()
    render(<RecordForm fields={[{ key: 'medicationDisplay', label: 'Medication', required: true }]} onSubmit={() => undefined} onFieldChange={onFieldChange} />)
    await act(async () => { fireEvent.change(screen.getByLabelText(/Medication/), { target: { value: 'Ibuprofen 400 mg' } }) })
    expect(onFieldChange).toHaveBeenCalledWith('medicationDisplay', 'Ibuprofen 400 mg')
  })
})
