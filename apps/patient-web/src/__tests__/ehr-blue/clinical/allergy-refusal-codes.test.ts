import { HidApiError } from '@hid/http'
import { describe, expect, it, vi } from 'vitest'
import {
  BY_A_CLINICIAN, coveredLine, membershipAt, overrideLine, overridesTitle, patientWordsLine, reasonLine, unreadLine,
} from '../../../ehr-blue/clinical/consult/orders/AllergyOverrides'
import { readAllergyRefusal } from '../../../ehr-blue/clinical/parts/allergyWarning'
import { formatWhen } from '../../../ehr-blue/clinical/parts/format'
import type { AllergiesState } from '../../../ehr-blue/clinical/patients/AllergiesCard'
import {
  parsePrescriptionAllergyAcknowledgements, refusalRejections, warningMessages, type PrescriptionAllergyAcknowledgement,
  type RecordedAllergy,
} from '../../../staff/allergies'

// The page's words are pure; the allergy read they sit beside is never called here.
vi.mock('../../../staff/api', () => ({ staffApi: {} }))

/**
 * What hid-system#218 at 7fbb04aa adds to the allergy check at prescribing, read by the blue EHR: the refused parts of
 * the 409 (allergyAcknowledgement.rejected, read by code), and the reasons stored with a prescription
 * (allergyAcknowledgements) with the words the prescription's page says them in. An EHR at 76283f57 sends neither: it
 * is read as before, never as "none". Every id, token, name and date is fictional.
 */

const TOKEN = 'd'.repeat(64)
const LINE = 'Penicillin allergy: SEVERE (Anaphylaxis). This medicine is one of the penicillins, the same group. Recorded by a clinician at this facility on 3 Mar 2026.'

function rejected(code: string, message = 'A sentence that is never shown.') {
  return { field: 'allergyAcknowledgement.rejected', code, messages: [message] }
}

/** The 409 as the http client gives it: warnings, the token, then the refused parts (none from an EHR at 76283f57). */
function refusal(...parts: object[]) {
  return new HidApiError(409, 'Conflict', {
    code: 'ALLERGY_ACKNOWLEDGEMENT_REQUIRED', detail: 'Never read.',
    details: [{ field: 'allergyAcknowledgement', messages: [LINE] }, { field: 'allergyAcknowledgement.warningToken', messages: [TOKEN] }, ...parts],
  })
}

describe('the refused parts of a 409 ALLERGY_ACKNOWLEDGEMENT_REQUIRED (7fbb04aa)', () => {
  it('reads the codes in the EHR’s order, by code alone, and leaves out other fields and codes it does not know', () => {
    const details = refusal(rejected('ALLERGY_ACKNOWLEDGEMENT_REASON_INVALID'), rejected('ALLERGY_WARNING_TOKEN_STALE'),
      rejected('ALLERGY_SOMETHING_NEW'), { field: 'allergyAcknowledgement', code: 'ALLERGY_WARNING_TOKEN_INVALID', messages: [] }).details
    expect(refusalRejections(details)).toEqual(['ALLERGY_ACKNOWLEDGEMENT_REASON_INVALID', 'ALLERGY_WARNING_TOKEN_STALE'])
    // The refused parts are never warning lines.
    expect(warningMessages(details)).toEqual([LINE])
  })

  it('is null when no refused part is named (an EHR at 76283f57), or only parts it does not know', () => {
    expect(refusalRejections(refusal().details)).toBeNull()
    expect(refusalRejections(refusal(rejected('ALLERGY_SOMETHING_NEW')).details)).toBeNull()
    expect(refusalRejections([{ field: 'allergyAcknowledgement.rejected', messages: ['no code'] }])).toBeNull()
    expect(refusalRejections(null)).toBeNull()
  })

  it.each([
    ['ALLERGY_ACKNOWLEDGEMENT_MISSING', false, { changedSinceShown: false }],
    ['ALLERGY_WARNING_TOKEN_STALE', true, { changedSinceShown: true }],
    ['ALLERGY_ACKNOWLEDGEMENT_REASON_MISSING', true, { changedSinceShown: false, reasonRefused: 'missing' }],
    ['ALLERGY_ACKNOWLEDGEMENT_REASON_INVALID', true, { changedSinceShown: false, reasonRefused: 'invalid' }],
    ['ALLERGY_WARNING_TOKEN_INVALID', true, { changedSinceShown: false, tokenRefused: true }],
  ])('%s: read for what it says, whatever was sent', (code, sent, said) => {
    expect(readAllergyRefusal(refusal(rejected(code)), sent)).toEqual({ messages: [LINE], warningToken: TOKEN, ...said })
  })

  it('reads a reason and a token refused together, each one', () => {
    expect(readAllergyRefusal(refusal(rejected('ALLERGY_ACKNOWLEDGEMENT_REASON_INVALID'), rejected('ALLERGY_WARNING_TOKEN_STALE')), true))
      .toEqual({ messages: [LINE], warningToken: TOKEN, changedSinceShown: true, reasonRefused: 'invalid' })
    expect(readAllergyRefusal(refusal(rejected('ALLERGY_ACKNOWLEDGEMENT_REASON_MISSING'), rejected('ALLERGY_WARNING_TOKEN_INVALID')), true))
      .toEqual({ messages: [LINE], warningToken: TOKEN, changedSinceShown: false, reasonRefused: 'missing', tokenRefused: true })
  })

  it('from an EHR at 76283f57 (no refused part named): "changed" exactly when the refused request carried an acknowledgement', () => {
    expect(readAllergyRefusal(refusal(), true)).toEqual({ messages: [LINE], warningToken: TOKEN, changedSinceShown: true })
    expect(readAllergyRefusal(refusal(), false)).toEqual({ messages: [LINE], warningToken: TOKEN, changedSinceShown: false })
    expect(readAllergyRefusal(refusal(rejected('ALLERGY_SOMETHING_NEW')), true)!.changedSinceShown).toBe(true)
  })
})

/** The session's actor.id (the sign-in's subject), the account id the EHR stores, and the membership here: all apart. */
const SESSION_ID = 'staff-1'
const MY_ACCOUNT = 'e0000000-0000-4000-8000-0000000000a4'
const MY_MEMBERSHIP = 'e0000000-0000-4000-8000-0000000000f4'
const OTHER_MEMBERSHIP = 'e0000000-0000-4000-8000-0000000000f5'
const PENICILLIN_ID = 'a1240000-0000-4000-8000-000000000041'
const LATEX_ID = 'a1240000-0000-4000-8000-000000000042'

const STORED = {
  id: 'e1240000-0000-4000-8000-000000000041', stage: 'activate', reason: 'Has taken amoxicillin since 2024 with no reaction',
  createdBy: MY_ACCOUNT, createdByMembershipId: MY_MEMBERSHIP, createdAt: '2026-11-10T09:00:00.000Z',
  matchedRecordedAllergyIds: [PENICILLIN_ID, PENICILLIN_ID, LATEX_ID], patientReportedMatched: true, patientReportedTerms: ['penicillin'],
}

describe('a prescription’s stored reasons (allergyAcknowledgements, 7fbb04aa)', () => {
  it('is null when the member is absent or not a list (an EHR before 7fbb04aa): never "none"', () => {
    expect(parsePrescriptionAllergyAcknowledgements(undefined)).toBeNull()
    expect(parsePrescriptionAllergyAcknowledgements(null)).toBeNull()
    expect(parsePrescriptionAllergyAcknowledgements({})).toBeNull()
  })

  it('reads [] as none, and an item whole, the ids once each', () => {
    expect(parsePrescriptionAllergyAcknowledgements([])).toEqual({ items: [], unread: 0 })
    expect(parsePrescriptionAllergyAcknowledgements([STORED])).toEqual({ unread: 0, items: [{
      id: STORED.id, stage: 'activate', reason: STORED.reason, createdBy: MY_ACCOUNT, createdByMembershipId: MY_MEMBERSHIP, createdAt: STORED.createdAt,
      matchedRecordedAllergyIds: [PENICILLIN_ID, LATEX_ID], patientReportedMatched: true, patientReportedTerms: ['penicillin'],
    }] })
  })

  it('reads every step the EHR stores, the hand-off to this facility’s Pharmacy (handoff, #218) included, and says it in plain words', () => {
    const steps = ['create', 'activate', 'resume', 'send', 'handoff'] as const
    const read = parsePrescriptionAllergyAcknowledgements(steps.map((stage, index) => ({ ...STORED, id: `${STORED.id}-${index}`, stage })))!
    expect(read.unread).toBe(0)
    expect(read.items.map(stored => stored.stage)).toEqual([...steps])
    expect(read.items.map(stored => overrideLine(stored, MY_MEMBERSHIP))).toEqual([
      'when it was prescribed', 'when it was activated', 'when it was resumed', 'when it was sent to a pharmacy',
      'when it was sent to this facility’s Pharmacy',
    ].map(words => `By you on ${formatWhen(STORED.createdAt)}, ${words}.`))
  })

  it('counts an item it cannot read (no id or no reason) rather than dropping it in silence, and keeps a step it does not know as none', () => {
    const read = parsePrescriptionAllergyAcknowledgements([{ ...STORED, reason: ' ' }, { ...STORED, id: undefined }, 'x', { ...STORED, stage: 'later' }])!
    expect(read.unread).toBe(3)
    expect(read.items.map(item => item.stage)).toEqual([null])
  })
})

function item(overrides: Partial<PrescriptionAllergyAcknowledgement> = {}): PrescriptionAllergyAcknowledgement {
  return { ...parsePrescriptionAllergyAcknowledgements([STORED])!.items[0]!, ...overrides }
}

function recorded(id: string, substance: string, status: RecordedAllergy['status'] = 'active'): RecordedAllergy {
  return { id, substance, reaction: null, severity: 'moderate', status, rowVersion: 1, createdAt: null, enteredInErrorReason: null, recordedHere: true }
}

function shown(list: RecordedAllergy[]): AllergiesState {
  return { status: 'shown', recordedOffered: true, recorded: list, patientReported: null, reportedAt: null }
}

describe('the words of a stored reason', () => {
  it('says who, when and at which step; never an id', () => {
    expect(overrideLine(item(), MY_MEMBERSHIP)).toBe(`By you on ${formatWhen(STORED.createdAt)}, when it was activated.`)
    expect(overrideLine(item(), OTHER_MEMBERSHIP)).toBe(`By ${BY_A_CLINICIAN} on ${formatWhen(STORED.createdAt)}, when it was activated.`)
    expect(overrideLine(item(), null)).toBe(`By ${BY_A_CLINICIAN} on ${formatWhen(STORED.createdAt)}, when it was activated.`)
    expect(overrideLine(item({ createdByMembershipId: null }), MY_MEMBERSHIP)).toBe(`By ${BY_A_CLINICIAN} on ${formatWhen(STORED.createdAt)}, when it was activated.`)
    // The account id is never compared with the session's id, even when they happen to be equal.
    expect(overrideLine(item({ createdBy: SESSION_ID, createdByMembershipId: OTHER_MEMBERSHIP }), MY_MEMBERSHIP))
      .toBe(`By ${BY_A_CLINICIAN} on ${formatWhen(STORED.createdAt)}, when it was activated.`)
    expect(overrideLine(item({ createdAt: null, stage: null }), MY_MEMBERSHIP)).toBe('By you.')
    expect(overridesTitle(1)).toBe('Allergy warning overridden')
    expect(overridesTitle(2)).toBe('Allergy warnings overridden')
  })

  it('takes the membership at the chart’s facility from the session’s facilities, else its selected facility; none elsewhere', () => {
    const facility = (id: string, membershipId: string) => ({ id, membershipId, organizationId: 'org-1', name: 'Demo', roles: [], permissions: [], isPrimary: false })
    const HERE = 'f0000000-0000-4000-8000-000000000001'
    const THERE = 'f0000000-0000-4000-8000-000000000002'
    expect(membershipAt({ facilities: [facility(THERE, OTHER_MEMBERSHIP), facility(HERE, MY_MEMBERSHIP)] }, HERE)).toBe(MY_MEMBERSHIP)
    expect(membershipAt({ facilities: [], facility: facility(HERE, MY_MEMBERSHIP) }, HERE)).toBe(MY_MEMBERSHIP)
    expect(membershipAt({ facilities: [], facility: facility(THERE, OTHER_MEMBERSHIP) }, HERE)).toBeNull()
    expect(membershipAt({ facilities: [facility(HERE, ' ')] }, HERE)).toBeNull()
    expect(membershipAt(null, HERE)).toBeNull()
  })

  it('quotes the reason as written', () => {
    expect(reasonLine('Tolerated <b>it</b>\nObserve')).toBe('Reason given: “Tolerated <b>it</b>\nObserve”.')
  })

  it('names the allergies it covered from the list, says plainly of one no longer on it, and never guesses a name it can’t read', () => {
    const list = shown([recorded(PENICILLIN_ID, 'Penicillin'), recorded(LATEX_ID, 'Latex', 'entered_in_error')])
    expect(coveredLine([PENICILLIN_ID], list)).toBe('Recorded allergy it covered: Penicillin (moderate).')
    // Marked entered in error only where the list says so; an id missing from the list (marked since, or past the list's
    // 200) is said to be missing, and only "may" have been marked.
    expect(coveredLine([PENICILLIN_ID, LATEX_ID, 'gone-1', 'gone-2'], list))
      .toBe('Recorded allergies it covered: Penicillin (moderate); Latex (moderate), since marked entered in error; '
        + '2 more recorded allergies no longer on the patient’s list (they may have been marked entered in error).')
    expect(coveredLine([PENICILLIN_ID, 'gone-1'], list))
      .toBe('Recorded allergies it covered: Penicillin (moderate); 1 more recorded allergy no longer on the patient’s list (it may have been marked entered in error).')
    expect(coveredLine(['gone-1'], list)).toBe('Recorded allergy it covered: one no longer on the patient’s list (it may have been marked entered in error).')
    expect(coveredLine(['gone-1', 'gone-2'], list)).toBe('Recorded allergies it covered: 2 no longer on the patient’s list (they may have been marked entered in error).')
    expect(coveredLine([PENICILLIN_ID, LATEX_ID], { status: 'loading' })).toBe('Recorded allergies it covered: 2.')
    expect(coveredLine([PENICILLIN_ID], { status: 'hidden' })).toBe('Recorded allergy it covered: 1 (their names can’t be shown here).')
    expect(coveredLine([PENICILLIN_ID], { status: 'failed', recordedOffered: true, retry: () => undefined }))
      .toBe('Recorded allergy it covered: 1 (their names could not be loaded).')
  })

  it('labels the patient’s own words as theirs', () => {
    expect(patientWordsLine(['augmentin', 'amoxil'])).toBe('The patient’s own words it covered, from their Health ID portal: “augmentin”, “amoxil”.')
    expect(patientWordsLine([])).toBe('It covered allergies the patient entered in their Health ID portal.')
    expect(unreadLine(1, true)).toBe('1 more allergy warning override can’t be shown here.')
    expect(unreadLine(2, true)).toBe('2 more allergy warning overrides can’t be shown here.')
    // With none shown above it, nothing is "more".
    expect(unreadLine(1, false)).toBe('An allergy warning override on this prescription can’t be shown here.')
    expect(unreadLine(2, false)).toBe('2 allergy warning overrides on this prescription can’t be shown here.')
  })
})
