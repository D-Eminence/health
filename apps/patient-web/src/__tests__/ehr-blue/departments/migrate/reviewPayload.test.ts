import { describe, expect, it } from 'vitest'
import { parsePaperReading, type PaperReading } from '../../../../ehr-blue/departments/migrate/paperReading'
import {
  CANDIDATE_TYPES, NOTE_TITLE, NOTE_TYPE, buildRejection, buildValidation, initialDecisions, itemCardId, itemResultId, itemTestId, itemTextId,
  offeredDomains, readingLine, reviewItems, visitsForNote, type Decisions, type ReviewChoices, type SaveAs,
} from '../../../../ehr-blue/departments/migrate/reviewPayload'
import type { OcrValidationInput } from '../../../../staff/api'
import { handwrittenPage, paperReading } from './paperReadingPayload'

/*
 * What staff choose on the check becomes the review ocr-api takes. The checks below are ocr-api's own, copied from
 * hid-system origin/staging-novu-ci-20261005 605e971e, the branch production is built from, so a payload this page builds is held to what the service validates:
 * - services/ocr-api/src/ocr/dto/validate-ocr-job.dto.ts:12-35 (the body's shape)
 * - services/ocr-api/src/ocr/ocr-publication-policy.ts:7-20 (assertCandidateClassification)
 * - services/ocr-api/src/ocr/ocr-publication-policy.ts:32-120 (importedMedicationCandidate, importedLabCandidate,
 *   clinicalNoteCandidate, assertPublishableCandidate), which ocr.service.ts:297 runs on acceptedFields before saving.
 * - lab-api dto/create-lab-import.dto.ts:12 (Lab's flag words) and ehr-api ocr-integration/dto/import-ocr-clinical-note.dto.ts:7
 *   (a version 4 visit ID), which publication then meets.
 * Fictional data only.
 */

class Refused extends Error {
  constructor(readonly code: string) { super(code) }
}

const isObject = (value: unknown) => typeof value === 'object' && value !== null && !Array.isArray(value)

/** validate-ocr-job.dto.ts:12-35 and ocr-publication-policy.ts:7-20. */
function assertBody(input: OcrValidationInput) {
  if (!isObject(input.validatedPayload)) throw new Refused('validatedPayload @IsObject')
  if (!['validated', 'rejected'].includes(input.disposition)) throw new Refused('disposition @IsIn')
  if (!isObject(input.acceptedFields)) throw new Refused('acceptedFields @IsObject')
  if (!Array.isArray(input.rejectedFields)) throw new Refused('rejectedFields @IsArray')
  if (!Array.isArray(input.corrections)) throw new Refused('corrections @IsArray')
  if (typeof input.reason !== 'string' || input.reason.length < 8 || input.reason.length > 500) throw new Refused('reason @Length(8, 500)')
  const expected: Record<string, string> = { EHR: 'clinical_note', LAB: 'lab_document', PHARMACY: 'historical_medication_evidence',
    DOCUMENT_ONLY: 'document_only', UNCLASSIFIED: 'unclassified' }
  if (expected[input.targetDomain] !== input.candidateType) throw new Refused('OCR_CLASSIFICATION_MISMATCH')
  if (input.disposition === 'validated' && input.targetDomain === 'UNCLASSIFIED') throw new Refused('OCR_UNCLASSIFIED_CANDIDATE')
  // The database holds them to the same shapes, and the stored arrays hold objects (ehr-api migrations 0013, 0016).
  for (const entry of [...input.rejectedFields, ...input.corrections]) if (!isObject(entry)) throw new Refused('array of objects')
}

/** ocr-publication-policy.ts:32-55. */
function importedMedicationCandidate(fields: Record<string, unknown>) {
  const text = (name: string, maximum: number, required = false) => {
    const value = fields[name]
    if (value === undefined || value === null || value === '') { if (required) throw new Refused('OCR_INVALID_MEDICATION_EVIDENCE'); return undefined }
    if (typeof value !== 'string' || value.trim().length < 1 || value.length > maximum) throw new Refused('OCR_INVALID_MEDICATION_EVIDENCE')
    return value.trim()
  }
  return { medicationText: text('medicationText', 500, true), strengthText: text('strengthText', 240), doseText: text('doseText', 240),
    frequencyText: text('frequencyText', 240), historicalContext: text('historicalContext', 2_000) }
}

const LAB_FLAGS = ['normal', 'low', 'high', 'critical', 'abnormal', 'unknown']

/** ocr-publication-policy.ts:57-95, with Lab's flag words (create-lab-import.dto.ts:12). */
function importedLabCandidate(fields: Record<string, unknown>) {
  if (!Array.isArray(fields.observations) || fields.observations.length < 1 || fields.observations.length > 200) throw new Refused('OCR_INVALID_LAB_EVIDENCE')
  return fields.observations.map((item: unknown) => {
    if (!isObject(item)) throw new Refused('OCR_INVALID_LAB_EVIDENCE')
    const value = item as Record<string, unknown>
    const text = (name: string, maximum: number) => {
      const candidate = value[name]
      if (candidate === undefined || candidate === null || candidate === '') return undefined
      if (typeof candidate !== 'string' || candidate.trim().length < 1 || candidate.length > maximum) throw new Refused('OCR_INVALID_LAB_EVIDENCE')
      return candidate.trim()
    }
    const testName = text('testName', 240)
    if (!testName || (!text('value', 240) && !text('valueText', 2_000))) throw new Refused('OCR_INVALID_LAB_EVIDENCE')
    text('unit', 80); text('referenceRange', 240); text('testCode', 120); text('reportedAt', 40)
    const flag = text('abnormalFlag', 20)
    if (flag !== undefined && !LAB_FLAGS.includes(flag)) throw new Refused('lab abnormalFlag @IsIn')
    if (value.reportedAt !== undefined) throw new Refused('lab reportedAt @IsDateString')
    return testName
  })
}

/** ocr-publication-policy.ts:97-109, with EHR's version 4 visit ID (import-ocr-clinical-note.dto.ts:7). */
function clinicalNoteCandidate(fields: Record<string, unknown>) {
  const { encounterId, noteType, title, content } = fields
  if (typeof encounterId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(encounterId)
    || typeof noteType !== 'string' || noteType.trim().length < 1 || noteType.length > 80
    || typeof title !== 'string' || title.trim().length < 1 || title.length > 240
    || typeof content !== 'string' || content.trim().length < 1 || content.length > 100_000) throw new Refused('OCR_INVALID_CLINICAL_NOTE')
}

/** ocr.service.ts:297, assertPublishableCandidate (ocr-publication-policy.ts:116-120). */
function assertAccepted(input: OcrValidationInput) {
  assertBody(input)
  if (input.disposition !== 'validated') return
  if (input.targetDomain === 'EHR') clinicalNoteCandidate(input.acceptedFields)
  else if (input.targetDomain === 'LAB') importedLabCandidate(input.acceptedFields)
  else if (input.targetDomain === 'PHARMACY') importedMedicationCandidate(input.acceptedFields)
}

const EXTRACTION = 'e0000000-0000-4000-8000-000000000001'
const VISIT = 'c0000000-0000-4000-8000-000000000001'
const reading = parsePaperReading(paperReading()) as PaperReading
const items = reviewItems(reading)
const byId = (id: string) => items.find(item => item.id === id)!
const METFORMIN = 'it-00000000000000a2'
const ALLERGY = 'it-00000000000000c1'
const HAEMOGLOBIN = 'it-00000000000000d1'

/** Every item decided: the clear ones kept as they start, the careful ones as given (kept by default). */
function decided(changes: Decisions = {}): Decisions {
  const start = initialDecisions(items)
  for (const item of items) if (!start[item.id]!.choice) start[item.id] = { ...start[item.id]!, choice: 'keep' }
  return { ...start, ...changes }
}

function choices(saveAs: SaveAs, overrides: Partial<ReviewChoices> = {}): ReviewChoices {
  return { extractionId: EXTRACTION, reading, decisions: decided(), saveAs, encounterId: '', reason: 'Checked against the paper record', ...overrides }
}

function built(value: ReturnType<typeof buildValidation>): OcrValidationInput {
  if (!('input' in value)) throw new Error(`Expected a review, got: ${value.problem.message}`)
  return value.input
}

describe('the check starts from the reading', () => {
  it('shows careful items first, undecided; clear items start as Keep', () => {
    expect(items.map(item => item.id).slice(0, 2)).toEqual([METFORMIN, ALLERGY])
    const start = initialDecisions(items)
    expect(start[METFORMIN]).toEqual({ choice: null, text: 'Metformin 500 mg twice a day' })
    expect(start[ALLERGY]!.choice).toBeNull()
    expect(start[HAEMOGLOBIN]).toEqual({ choice: 'keep', text: 'Haemoglobin 11.2 g/dL', test: 'Haemoglobin', result: '11.2 g/dL' })
  })

  it('offers Clinical note only when a visit can be chosen, past lab results when results were read, past medicines for one medicine', () => {
    expect(offeredDomains(reading, true)).toEqual(['DOCUMENT_ONLY', 'EHR', 'LAB'])
    expect(offeredDomains(reading, false)).toEqual(['DOCUMENT_ONLY', 'LAB'])
    expect(offeredDomains(parsePaperReading(handwrittenPage()), true)).toEqual(['DOCUMENT_ONLY', 'EHR', 'PHARMACY'])
  })

  it('offers only Keep the document only when nothing was picked out, or the payload is not a paper reading', () => {
    expect(offeredDomains(null, true)).toEqual(['DOCUMENT_ONLY'])
    expect(offeredDomains(parsePaperReading({ ...paperReading(), items: [] }), true)).toEqual(['DOCUMENT_ONLY'])
  })
})

describe('the review built from the choices', () => {
  it('kept items are accepted, removed ones rejected, changed ones accepted with the new words and listed as corrections', () => {
    const input = built(buildValidation(choices('DOCUMENT_ONLY', { decisions: decided({
      [METFORMIN]: { choice: 'change', text: '  Metformin 850 mg twice a day ' },
      [ALLERGY]: { choice: 'remove', text: readingLine(byId(ALLERGY)) },
    }) })))
    expect(() => assertAccepted(input)).not.toThrow()
    expect(input).toMatchObject({ extractionId: EXTRACTION, disposition: 'validated', targetDomain: 'DOCUMENT_ONLY', candidateType: 'document_only',
      reason: 'Checked against the paper record' })
    expect(input.corrections).toEqual([{ itemId: METFORMIN, kind: 'medicine', page: 1, field: 'reading',
      oldValue: 'Metformin 500 mg twice a day', newValue: 'Metformin 850 mg twice a day' }])
    expect(input.rejectedFields).toEqual([{ itemId: ALLERGY, kind: 'allergy', page: 2, asWritten: 'Allergic to penicillin - rash',
      reading: 'Penicillin allergy', decision: 'removed' }])
    const accepted = input.acceptedFields.items as Array<{ itemId: string; reading: string }>
    expect(accepted.map(item => item.itemId)).not.toContain(ALLERGY)
    expect(accepted.find(item => item.itemId === METFORMIN)?.reading).toBe('Metformin 850 mg twice a day')
    expect(input.validatedPayload).toEqual({ contract: 'hid-paper-reading-v2', identity: reading.identity, items: accepted })
  })

  it('Change with the same words is a Keep: no correction', () => {
    const input = built(buildValidation(choices('DOCUMENT_ONLY', { decisions: decided({ [METFORMIN]: { choice: 'change', text: 'Metformin 500 mg twice a day' } }) })))
    expect(input.corrections).toEqual([])
  })

  it('past lab results: observations Lab and OCR take, a flag in Lab\'s words, and no date as written', () => {
    const input = built(buildValidation(choices('LAB')))
    expect(() => assertAccepted(input)).not.toThrow()
    expect(input.candidateType).toBe(CANDIDATE_TYPES.LAB)
    expect(input.acceptedFields.observations).toEqual([{ testName: 'Haemoglobin', value: '11.2', unit: 'g/dL', referenceRange: '12-16', abnormalFlag: 'low' }])
  })

  it('past lab results: a changed result carries only the words typed; a flag written another way is not sent', () => {
    const payload = paperReading()
    payload.items = payload.items.map(item => item.id === HAEMOGLOBIN ? { ...item, fields: { ...item.fields, flag: 'L' } } : item)
    const flagged = parsePaperReading(payload) as PaperReading
    const kept = built(buildValidation({ ...choices('LAB'), reading: flagged }))
    expect(kept.acceptedFields.observations).toEqual([{ testName: 'Haemoglobin', value: '11.2', unit: 'g/dL', referenceRange: '12-16' }])
    const changed = built(buildValidation(choices('LAB', { decisions: decided({
      [HAEMOGLOBIN]: { choice: 'change', text: '', test: 'Haemoglobin', result: '11.4 g/dL' } }) })))
    expect(() => assertAccepted(changed)).not.toThrow()
    expect(changed.acceptedFields.observations).toEqual([{ testName: 'Haemoglobin', valueText: '11.4 g/dL' }])
    expect(changed.corrections).toEqual([{ itemId: HAEMOGLOBIN, kind: 'lab_result', page: 2, field: 'result', oldValue: '11.2 g/dL', newValue: '11.4 g/dL' }])
  })

  it('past lab results: a changed test name is the test the result is filed under, and is listed as a correction', () => {
    const input = built(buildValidation(choices('LAB', { decisions: decided({
      [HAEMOGLOBIN]: { choice: 'change', text: '', test: ' Haematocrit ', result: '11.2 g/dL' } }) })))
    expect(() => assertAccepted(input)).not.toThrow()
    expect(input.acceptedFields.observations).toEqual([{ testName: 'Haematocrit', valueText: '11.2 g/dL' }])
    expect(input.corrections).toEqual([{ itemId: HAEMOGLOBIN, kind: 'lab_result', page: 2, field: 'test', oldValue: 'Haemoglobin', newValue: 'Haematocrit' }])
    const accepted = input.acceptedFields.items as Array<{ itemId: string; reading: string }>
    expect(accepted.find(item => item.itemId === HAEMOGLOBIN)?.reading).toBe('Haematocrit 11.2 g/dL')
  })

  it('past lab results: an empty or too long test name is refused at the Test text, before sending', () => {
    const at = items.findIndex(item => item.id === HAEMOGLOBIN)
    const change = (test: string, result = '11.2 g/dL') => buildValidation(choices('LAB', { decisions: decided({ [HAEMOGLOBIN]: { choice: 'change', text: '', test, result } }) }))
    expect(change(' ')).toEqual({ problem: { field: itemTestId(at), message: 'Enter the test, or choose Keep or Remove.' } })
    expect(change('Haemoglobin', '')).toEqual({ problem: { field: itemResultId(at), message: 'Enter the result, or choose Keep or Remove.' } })
    expect(change('H'.repeat(241))).toEqual({ problem: { field: itemTestId(at),
      message: 'This test name is too long to add to past lab results. Use Change to shorten the test name to 240 characters or fewer.' } })
    expect('input' in change('H'.repeat(240))).toBe(true)
  })

  it('past lab results with every result removed is refused at Save as, before sending', () => {
    const result = buildValidation(choices('LAB', { decisions: decided({ [HAEMOGLOBIN]: { choice: 'remove', text: '' } }) }))
    expect(result).toEqual({ problem: { field: 'ocr-review-domain', message: expect.stringMatching(/^No lab result is kept/) } })
  })

  it('a clinical note: the visit, a note type and title, and the kept items as its content', () => {
    expect(buildValidation(choices('EHR'))).toEqual({ problem: { field: 'ocr-review-visit', message: 'Choose the visit to attach this note to.' } })
    const input = built(buildValidation(choices('EHR', { encounterId: VISIT, decisions: decided({ [ALLERGY]: { choice: 'remove', text: '' } }) })))
    expect(() => assertAccepted(input)).not.toThrow()
    expect(input).toMatchObject({ targetDomain: 'EHR', candidateType: 'clinical_note' })
    expect(input.acceptedFields).toMatchObject({ encounterId: VISIT, noteType: NOTE_TYPE, title: NOTE_TITLE })
    const content = input.acceptedFields.content as string
    expect(content).toContain('Medicines\n- Amlodipine 5 mg once a day (page 1)\n- Metformin 500 mg twice a day (page 1)')
    expect(content).toContain('Lab results\n- Haemoglobin 11.2 g/dL (page 2)')
    expect(content).not.toContain('Penicillin')
  })

  it('past medicines: the one medicine, with its strength and how often, and where it was read', () => {
    const one = parsePaperReading(handwrittenPage()) as PaperReading
    const id = 'it-00000000000000a3'
    const kept = built(buildValidation({ ...choices('PHARMACY'), reading: one, decisions: { [id]: { choice: 'keep', text: '' } } }))
    expect(() => assertAccepted(kept)).not.toThrow()
    expect(kept.acceptedFields).toMatchObject({ medicationText: 'Possibly ceftriaxone IV; dose and frequency unreadable',
      historicalContext: 'From a paper record, page 1. As written: Ceftriaxone ? IV' })
    const changed = built(buildValidation({ ...choices('PHARMACY'), reading: one, decisions: { [id]: { choice: 'change', text: 'Ceftriaxone 1 g into a vein once a day' } } }))
    expect(() => assertAccepted(changed)).not.toThrow()
    expect(changed.acceptedFields).toMatchObject({ medicationText: 'Ceftriaxone 1 g into a vein once a day' })
    expect(changed.corrections).toHaveLength(1)
    const removed = buildValidation({ ...choices('PHARMACY'), reading: one, decisions: { [id]: { choice: 'remove', text: '' } } })
    expect('problem' in removed && removed.problem.field).toBe('ocr-review-domain')
  })

  it('past medicines from the fixture\'s first medicine carries strength and frequency as read', () => {
    const payload = paperReading()
    payload.items = payload.items.filter(item => item.id !== METFORMIN)
    const single = parsePaperReading(payload) as PaperReading
    const decisions = Object.fromEntries(reviewItems(single).map(item => [item.id, { choice: 'keep' as const, text: readingLine(item) }]))
    const input = built(buildValidation({ ...choices('PHARMACY'), reading: single, decisions }))
    expect(() => assertAccepted(input)).not.toThrow()
    expect(input.acceptedFields).toMatchObject({ medicationText: 'Amlodipine', strengthText: '5 mg', frequencyText: 'once a day',
      historicalContext: 'From a paper record, page 1. As written: Amlodipine 5mg od x 30/7. For 30 days. Prescribed by Dr Ade Fictional. Prescribed on 02/03/2025' })
  })

  it('every domain\'s review passes ocr-api\'s checks', () => {
    for (const saveAs of ['DOCUMENT_ONLY', 'EHR', 'LAB'] as const) {
      expect(() => assertAccepted(built(buildValidation(choices(saveAs, { encounterId: VISIT }))))).not.toThrow()
    }
    expect(() => assertAccepted(built(buildValidation({ ...choices('DOCUMENT_ONLY'), reading: null, decisions: {} })))).not.toThrow()
  })

  it('a reading that is not a paper reading keeps the document only, with empty objects', () => {
    const input = built(buildValidation({ ...choices('DOCUMENT_ONLY'), reading: null, decisions: {} }))
    expect(input).toMatchObject({ validatedPayload: {}, acceptedFields: {}, rejectedFields: [], corrections: [] })
  })
})

describe('what must be fixed before anything is sent', () => {
  it('an item to check carefully left undecided, then an empty Change, then the reason', () => {
    const undecided = buildValidation({ ...choices('DOCUMENT_ONLY'), decisions: initialDecisions(items) })
    expect(undecided).toEqual({ problem: { field: itemCardId(0), message: 'Choose Keep, Change or Remove for this item.' } })
    const empty = buildValidation(choices('DOCUMENT_ONLY', { decisions: decided({ [ALLERGY]: { choice: 'change', text: '  ' } }) }))
    expect(empty).toEqual({ problem: { field: itemTextId(1), message: 'Enter what the paper says, or choose Keep or Remove.' } })
    expect(buildValidation(choices('DOCUMENT_ONLY', { reason: 'short' }))).toEqual({ problem: { field: 'ocr-review-reason', message: 'Write at least 8 characters.' } })
  })

  it('a rejection: a reason only, sent as unclassified, which ocr-api takes', () => {
    expect(buildRejection(EXTRACTION, ' ')).toEqual({ problem: { field: 'ocr-review-reason', message: 'Complete this field.' } })
    const result = buildRejection(EXTRACTION, 'The scan is unreadable')
    if (!('input' in result)) throw new Error('Expected a rejection')
    expect(() => assertAccepted(result.input)).not.toThrow()
    expect(result.input).toEqual({ extractionId: EXTRACTION, validatedPayload: {}, acceptedFields: {}, rejectedFields: [], corrections: [],
      disposition: 'rejected', targetDomain: 'UNCLASSIFIED', candidateType: 'unclassified', reason: 'The scan is unreadable' })
  })
})

describe('the visits a clinical note can be attached to', () => {
  const FACILITY = 'f0000000-0000-4000-8000-000000000001'
  const visit = (id: string, status: string, facilityId = FACILITY) => ({ id, status, facilityId })
  it('leaves out cancelled and entered-in-error visits and other facilities\' visits; a completed visit still takes a note', () => {
    const offered = visitsForNote([visit('a', 'in_progress'), visit('b', 'cancelled'), visit('c', 'entered_in_error'), visit('d', 'completed'),
      visit('e', 'planned'), visit('f', 'on_hold'), visit('g', 'in_progress', 'f0000000-0000-4000-8000-0000000000ff')], FACILITY.toUpperCase())
    expect(offered.map(item => item.id)).toEqual(['a', 'd', 'e', 'f'])
  })
})
