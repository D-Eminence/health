import { describe, expect, it } from 'vitest'
import { isUnreadable, parsePaperReading, type PaperReading } from '../../../../ehr-blue/departments/migrate/paperReading'
import {
  REJECTION_REASON_FIELD, buildRejection, buildValidation, initialDecisions, itemChangeReasonId, itemMedicineId, itemRemovalReasonId,
  missedCount, missedId, readingLine, readingPages, reviewItems, type Decisions, type ReviewChoices, type ReviewLearning, type SaveAs,
} from '../../../../ehr-blue/departments/migrate/reviewPayload'
import { SERVED_FLAG, saysReviewLearning } from '../../../../readingLearningContract'
import { paperReading, unreadablePage } from './paperReadingPayload'

/*
 * Migrate learning, phase 1: the review signals a check sends once the backend serves them, in Session B's names and
 * codes (reviewConfirmed, missedItems, removedItems, rejectionReasonCode; corrections[].fields and changeReason), and
 * nothing new while it does not. Fictional data only.
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

const LEARNING: ReviewLearning = { itemsSeen: [], pagesChecked: [], missed: {} }

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

  it('is learned only from an answer whose flag is exactly true', () => {
    expect(saysReviewLearning({ items: [], [SERVED_FLAG]: true })).toBe(true)
    expect(saysReviewLearning({ items: [] })).toBe(false)
    expect(saysReviewLearning({ items: [], [SERVED_FLAG]: 'true' })).toBe(false)
    expect(saysReviewLearning(null)).toBe(false)
  })
})

describe('Migrate learning once served', () => {
  it('asks why an item is removed, then why one is changed, at that item’s own reason', () => {
    const removed = buildValidation(choices('DOCUMENT_ONLY', { learning: LEARNING,
      decisions: decided({ [ALLERGY]: { choice: 'remove', text: readingLine(byId(ALLERGY)) } }) }))
    expect(removed).toEqual({ problem: { field: itemRemovalReasonId(indexOf(ALLERGY)), message: 'Choose why you’re removing it.' } })
    const changed = buildValidation(choices('DOCUMENT_ONLY', { learning: LEARNING,
      decisions: decided({ [ALLERGY]: { choice: 'change', text: 'Penicillin allergy, hives' } }) }))
    expect(changed).toEqual({ problem: { field: itemChangeReasonId(indexOf(ALLERGY)), message: 'Choose why you’re changing it.' } })
  })

  it('sends each removal’s reason in removedItems and each change’s on its correction, and a line that couldn’t be read as Can’t read it', () => {
    const page = parsePaperReading(unreadablePage()) as PaperReading
    const pageItems = reviewItems(page)
    const unreadable = pageItems.filter(isUnreadable).map(item => item.id)
    expect(unreadable.length).toBeGreaterThan(0)
    const decisions = Object.fromEntries(pageItems.map(item => [item.id, { ...initialDecisions([item])[item.id]!,
      ...(isUnreadable(item) ? {} : { choice: 'keep' as const }) }]))
    const sent = input(buildValidation({ ...choices('DOCUMENT_ONLY'), reading: page, decisions, learning: LEARNING }))
    expect(sent.removedItems).toEqual(unreadable.map(itemId => ({ itemId, removalReason: 'unreadable' })))
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

  it('says the check was complete only with every page ticked and every item it could check seen, and sends the missed total', () => {
    const readable = items.filter(item => !isUnreadable(item)).map(item => item.id)
    const signals = (learning: ReviewLearning) => {
      const sent = input(buildValidation(choices('DOCUMENT_ONLY', { learning })))
      return { reviewConfirmed: sent.reviewConfirmed, missedItems: sent.missedItems }
    }
    expect(signals({ itemsSeen: [...readable, 'it-ffffffffffffffff'], pagesChecked: [2, 9, 1, 2], missed: { medicine: '2', allergy: ' ', lab_result: '40' } }))
      .toEqual({ reviewConfirmed: true, missedItems: 42 })
    expect(signals({ itemsSeen: readable, pagesChecked: [1], missed: {} })).toEqual({ reviewConfirmed: false, missedItems: 0 })
    expect(signals({ itemsSeen: readable.slice(1), pagesChecked: [1, 2], missed: {} })).toEqual({ reviewConfirmed: false, missedItems: 0 })
    const sent = input(buildValidation(choices('DOCUMENT_ONLY', { learning: LEARNING })))
    for (const key of ['learning', 'itemsSeen', 'pagesChecked', 'removedItems', 'rejectionReasonCode']) expect(sent).not.toHaveProperty(key)
  })

  it('refuses a missed count that isn’t a whole number from 0 to 40, at its own box', () => {
    for (const typed of ['-1', '1.5', 'two', '41', '100']) {
      expect(buildValidation(choices('DOCUMENT_ONLY', { learning: { ...LEARNING, missed: { diagnosis: typed } } })))
        .toEqual({ problem: { field: missedId('diagnosis'), message: 'Enter a number from 0 to 40.' } })
    }
    expect(missedCount('')).toBe(0)
    expect(missedCount(' 7 ')).toBe(7)
  })

  it('doesn’t need every page ticked to save', () => {
    expect('input' in buildValidation(choices('DOCUMENT_ONLY', { learning: LEARNING }))).toBe(true)
    expect(readingPages(reading)).toEqual([1, 2])
  })

  it('a rejection asks what is wrong first, then sends its code beside the reason in words', () => {
    expect(buildRejection(EXTRACTION, 'The scan is unreadable', { rejectionReason: '' }))
      .toEqual({ problem: { field: REJECTION_REASON_FIELD, message: 'Choose what’s wrong with this reading.' } })
    const sent = buildRejection(EXTRACTION, 'Belongs to Patient One’s sister', { rejectionReason: 'wrong_patient' })
    expect(sent).toEqual({ input: { extractionId: EXTRACTION, validatedPayload: {}, acceptedFields: {}, rejectedFields: [], corrections: [],
      disposition: 'rejected', targetDomain: 'UNCLASSIFIED', candidateType: 'unclassified', reason: 'Belongs to Patient One’s sister',
      rejectionReasonCode: 'wrong_patient' } })
  })
})
