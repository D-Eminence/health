import { describe, expect, it } from 'vitest'
import { isUnreadable, parsePaperReading, type PaperReading } from '../../../../ehr-blue/departments/migrate/paperReading'
import {
  MISSED_FIELD, buildRejection, buildValidation, initialDecisions, itemMedicineId, missedTotal, readingLine, reviewItems, type Decisions,
  type ReviewChoices, type ReviewLearning, type SaveAs,
} from '../../../../ehr-blue/departments/migrate/reviewPayload'
import { SERVED_FLAG, saysReviewLearning } from '../../../../readingLearningContract'
import { paperReading, unreadablePage } from './paperReadingPayload'

/*
 * Migrate learning, phase 1: the review signals a check sends once the backend serves them, in Session B's names and
 * codes (reviewConfirmed, missedItems, removedItems, rejectionReasonCode; corrections[].fields and changeReason), and
 * nothing new while it does not. Owner decision Q43: nothing is ever required, and only what the reviewer did or said is
 * sent. Fictional data only.
 */

const EXTRACTION = '7f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f'
const reading = parsePaperReading(paperReading()) as PaperReading
const items = reviewItems(reading)
const byId = (id: string) => items.find(item => item.id === id)!
const AMLODIPINE = 'it-00000000000000a1'
const METFORMIN = 'it-00000000000000a2'
const ALLERGY = 'it-00000000000000c1'
const indexOf = (id: string) => items.findIndex(item => item.id === id)

/** Every item to check decided Keep, then the given decisions. */
function decided(overrides: Decisions = {}): Decisions {
  const start = initialDecisions(items)
  for (const item of items) if (!start[item.id]!.choice) start[item.id] = { ...start[item.id]!, choice: 'keep' }
  return { ...start, ...overrides }
}

const LEARNING: ReviewLearning = { itemsSeen: [], missed: '' }

function choices(saveAs: SaveAs, overrides: Partial<ReviewChoices> = {}): ReviewChoices {
  return { extractionId: EXTRACTION, reading, decisions: decided(), saveAs, encounterId: '', reason: 'Checked against the paper record', ...overrides }
}

function input(result: ReturnType<typeof buildValidation>) {
  if ('problem' in result) throw new Error(`Expected a review, got a problem at ${result.problem.field}: ${result.problem.message}`)
  return result.input
}

describe('Migrate learning while the backend does not serve it', () => {
  it('sends exactly today’s review: no learning key, and no reason on any removed or changed item', () => {
    const decisions = decided({
      [METFORMIN]: { choice: 'change', text: 'Metformin 850 mg twice a day', changeReason: 'misread' },
      [ALLERGY]: { choice: 'remove', text: readingLine(byId(ALLERGY)), removalReason: 'not_on_paper' },
    })
    const sent = input(buildValidation(choices('PHARMACY', { decisions })))
    expect(Object.keys(sent).sort()).toEqual(['acceptedFields', 'candidateType', 'corrections', 'disposition', 'extractionId', 'reason',
      'rejectedFields', 'targetDomain', 'validatedPayload'])
    expect(sent.corrections).toEqual([{ itemId: METFORMIN, kind: 'medicine', page: 1, field: 'reading',
      oldValue: 'Metformin 500 mg twice a day', newValue: 'Metformin 850 mg twice a day' }])
    expect(sent.rejectedFields).toEqual([{ itemId: ALLERGY, kind: 'allergy', page: 2, asWritten: 'Allergic to penicillin - rash',
      reading: 'Penicillin allergy', decision: 'removed' }])
    // The medicine is today's one line, not the structured form.
    expect((sent.acceptedFields.medications as Array<Record<string, unknown>>)[1]).toMatchObject({ itemId: METFORMIN, medicationText: 'Metformin 850 mg twice a day' })
  })

  it('a rejection is today’s, with no reason code asked or sent', () => {
    const sent = buildRejection(EXTRACTION, 'The scan is unreadable')
    expect(sent).toEqual({ input: { extractionId: EXTRACTION, validatedPayload: {}, acceptedFields: {}, rejectedFields: [], corrections: [],
      disposition: 'rejected', targetDomain: 'UNCLASSIFIED', candidateType: 'unclassified', reason: 'The scan is unreadable' } })
  })

  it('is learned only from an extraction whose flag is exactly true', () => {
    expect(saysReviewLearning({ id: EXTRACTION, version: 1, [SERVED_FLAG]: true })).toBe(true)
    expect(saysReviewLearning({ id: EXTRACTION, version: 1 })).toBe(false)
    expect(saysReviewLearning({ id: EXTRACTION, version: 1, [SERVED_FLAG]: 'true' })).toBe(false)
    expect(saysReviewLearning(null)).toBe(false)
  })
})

describe('Migrate learning once served', () => {
  it('never asks why: a removal or change with no reason saves, and sends no reason', () => {
    const sent = input(buildValidation(choices('DOCUMENT_ONLY', { learning: LEARNING, decisions: decided({
      [ALLERGY]: { choice: 'remove', text: readingLine(byId(ALLERGY)) },
      'it-00000000000000f1': { choice: 'change', text: 'Come back in three weeks' },
    }) })))
    expect(sent).not.toHaveProperty('removedItems')
    expect(sent.rejectedFields.map(entry => entry.itemId)).toEqual([ALLERGY])
    expect(sent.corrections).toEqual([{ itemId: 'it-00000000000000f1', kind: 'note', page: 2, field: 'reading',
      oldValue: 'Come back in two weeks', newValue: 'Come back in three weeks' }])
    // A reason chosen and then cleared (tapped again) is the same as none.
    const cleared = input(buildValidation(choices('DOCUMENT_ONLY', { learning: LEARNING, decisions: decided({
      [ALLERGY]: { choice: 'remove', text: readingLine(byId(ALLERGY)), removalReason: '' },
    }) })))
    expect(cleared).not.toHaveProperty('removedItems')
  })

  it('sends each removal’s reason chosen in removedItems and each change’s on its correction; a line the reading couldn’t read gets no reason', () => {
    const page = parsePaperReading(unreadablePage()) as PaperReading
    const pageItems = reviewItems(page)
    const unreadable = pageItems.filter(isUnreadable).map(item => item.id)
    expect(unreadable.length).toBeGreaterThan(0)
    const decisions = Object.fromEntries(pageItems.map(item => [item.id, { ...initialDecisions([item])[item.id]!,
      ...(isUnreadable(item) ? {} : { choice: 'keep' as const }) }]))
    const sent = input(buildValidation({ ...choices('DOCUMENT_ONLY'), reading: page, decisions, learning: LEARNING }))
    // The reviewer said nothing about those lines, so nothing is sent for them.
    expect(sent).not.toHaveProperty('removedItems')
    expect(sent.rejectedFields.map(entry => entry.itemId)).toEqual(unreadable)

    const both = input(buildValidation(choices('DOCUMENT_ONLY', { learning: LEARNING, decisions: decided({
      [ALLERGY]: { choice: 'remove', text: readingLine(byId(ALLERGY)), removalReason: 'other_patient' },
      'it-00000000000000f1': { choice: 'change', text: 'Come back in three weeks', changeReason: 'clinical_update' },
    }) })))
    // rejectedFields is today's; the reason goes in removedItems.
    expect(both.rejectedFields).toEqual([{ itemId: ALLERGY, kind: 'allergy', page: 2, asWritten: 'Allergic to penicillin - rash',
      reading: 'Penicillin allergy', decision: 'removed' }])
    expect(both.removedItems).toEqual([{ itemId: ALLERGY, removalReason: 'other_patient' }])
    // One line of words names no field class.
    expect(both.corrections).toEqual([{ itemId: 'it-00000000000000f1', kind: 'note', page: 2, field: 'reading',
      oldValue: 'Come back in two weeks', newValue: 'Come back in three weeks', changeReason: 'clinical_update' }])
  })

  it('changes a medicine field by field: past medicines get each field, each changed field is its own correction, and the reason is said once', () => {
    const sent = input(buildValidation(choices('PHARMACY', { learning: LEARNING, decisions: decided({
      [METFORMIN]: { choice: 'change', text: '', changeReason: 'misread', medicine: { strength: '850 mg', dose: ' 1 tablet ' } },
    }) })))
    const medications = sent.acceptedFields.medications as Array<Record<string, unknown>>
    expect(medications.find(entry => entry.itemId === METFORMIN)).toEqual({ itemId: METFORMIN, page: 1, medicationText: 'Metformin',
      strengthText: '850 mg', doseText: '1 tablet', frequencyText: 'twice a day', historicalContext: expect.stringContaining('From a paper record, page 1') })
    expect(sent.corrections).toEqual([
      { itemId: METFORMIN, kind: 'medicine', page: 1, field: 'strengthText', oldValue: '500 mg', newValue: '850 mg', fields: ['strength'], changeReason: 'misread' },
      { itemId: METFORMIN, kind: 'medicine', page: 1, field: 'doseText', oldValue: '', newValue: '1 tablet', fields: ['dose'] },
    ])
    const accepted = sent.acceptedFields.items as Array<{ itemId: string; reading: string }>
    expect(accepted.find(item => item.itemId === METFORMIN)?.reading).toBe('Metformin 850 mg 1 tablet twice a day')
    // A medicine kept as read is sent as today.
    expect(medications.find(entry => entry.itemId === AMLODIPINE)).toMatchObject({ medicationText: 'Amlodipine', strengthText: '5 mg', frequencyText: 'once a day' })
  })

  it('a lab result’s Change names its test as the name and its result as the value', () => {
    const lab = 'it-00000000000000d1'
    const sent = input(buildValidation(choices('LAB', { learning: LEARNING, decisions: decided({
      [lab]: { choice: 'change', text: '', changeReason: 'misread', test: 'HbA1c', result: '6.9 %' },
    }) })))
    expect(sent.corrections.map(entry => [entry.itemId, entry.field, entry.fields, entry.changeReason]))
      .toEqual([[lab, 'test', ['name'], 'misread'], [lab, 'result', ['value'], undefined]])
  })

  it('a medicine’s Change needs its name, and keeps each field within what past medicines takes', () => {
    const at = indexOf(METFORMIN)
    const change = (medicine: Record<string, string>) => buildValidation(choices('PHARMACY', { learning: LEARNING,
      decisions: decided({ [METFORMIN]: { choice: 'change', text: '', changeReason: 'misread', medicine } }) }))
    expect(change({ name: '  ' })).toEqual({ problem: { field: itemMedicineId(at, 'name'), message: 'Enter the medicine’s name, or choose Keep or Remove.' } })
    expect(change({ frequency: 'x'.repeat(241) })).toEqual({ problem: { field: itemMedicineId(at, 'frequency'), message: 'Shorten this to 240 characters or fewer.' } })
  })

  it('says every item was looked at from the items seen alone, and sends the missed total only when typed', () => {
    const readable = items.filter(item => !isUnreadable(item)).map(item => item.id)
    const signals = (learning: ReviewLearning) => {
      const sent = input(buildValidation(choices('DOCUMENT_ONLY', { learning })))
      return { reviewConfirmed: sent.reviewConfirmed, missedItems: sent.missedItems, missedSent: 'missedItems' in sent }
    }
    expect(signals({ itemsSeen: [...readable, 'it-ffffffffffffffff'], missed: ' 42 ' })).toEqual({ reviewConfirmed: true, missedItems: 42, missedSent: true })
    expect(signals({ itemsSeen: readable, missed: '0' })).toEqual({ reviewConfirmed: true, missedItems: 0, missedSent: true })
    expect(signals({ itemsSeen: readable.slice(1), missed: '' })).toEqual({ reviewConfirmed: false, missedItems: undefined, missedSent: false })
    // Nothing given: only what the page counted itself.
    const sent = input(buildValidation(choices('DOCUMENT_ONLY', { learning: LEARNING })))
    expect(sent.reviewConfirmed).toBe(false)
    for (const key of ['learning', 'itemsSeen', 'pagesChecked', 'missedItems', 'removedItems', 'rejectionReasonCode']) expect(sent).not.toHaveProperty(key)
  })

  it('sends no reviewConfirmed when there was nothing to check', () => {
    const sent = input(buildValidation(choices('DOCUMENT_ONLY', { reading: null, decisions: {}, learning: { itemsSeen: [], missed: '' } })))
    expect(sent).not.toHaveProperty('reviewConfirmed')
    expect(sent).not.toHaveProperty('missedItems')
  })

  it('refuses a missed total that isn’t a whole number from 0 to 200, at its own box; blank is nothing', () => {
    for (const typed of ['-1', '1.5', 'two', '201', '1000']) {
      expect(buildValidation(choices('DOCUMENT_ONLY', { learning: { ...LEARNING, missed: typed } })))
        .toEqual({ problem: { field: MISSED_FIELD, message: 'Enter a number from 0 to 200, or leave it blank.' } })
    }
    expect(missedTotal('')).toBeUndefined()
    expect(missedTotal('   ')).toBeUndefined()
    expect(missedTotal(' 7 ')).toBe(7)
    expect(missedTotal('200')).toBe(200)
  })

  it('a rejection saves without a reason chosen, and sends the code only when one is', () => {
    expect(buildRejection(EXTRACTION, 'The scan is unreadable', { rejectionReason: '' })).toEqual({ input: { extractionId: EXTRACTION,
      validatedPayload: {}, acceptedFields: {}, rejectedFields: [], corrections: [], disposition: 'rejected', targetDomain: 'UNCLASSIFIED',
      candidateType: 'unclassified', reason: 'The scan is unreadable' } })
    const sent = buildRejection(EXTRACTION, 'Belongs to Patient One’s sister', { rejectionReason: 'wrong_patient' })
    expect(sent).toEqual({ input: { extractionId: EXTRACTION, validatedPayload: {}, acceptedFields: {}, rejectedFields: [], corrections: [],
      disposition: 'rejected', targetDomain: 'UNCLASSIFIED', candidateType: 'unclassified', reason: 'Belongs to Patient One’s sister',
      rejectionReasonCode: 'wrong_patient' } })
  })
})
