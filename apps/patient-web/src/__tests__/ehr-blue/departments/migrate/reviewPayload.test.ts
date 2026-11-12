import { describe, expect, it } from 'vitest'
import { parsePaperReading, type PaperReading } from '../../../../ehr-blue/departments/migrate/paperReading'
import {
  CANDIDATE_TYPES, MAX_MEDICINES, NOTE_TITLE, REPORT_DATE_FIELD, NOTE_TYPE, buildRejection, buildValidation, initialDecisions, itemCardId, itemResultId, itemTestId, itemTextId,
  keptItemsGo, keptMedicines, keptText, labFlag, offeredDomains, readingLine, reviewItems, visitsForNote, type Decisions, type ReviewChoices, type SaveAs,
} from '../../../../ehr-blue/departments/migrate/reviewPayload'
import type { OcrValidationInput } from '../../../../staff/api'
import { handwrittenPage, hardHandwrittenPage, medicinesPaper, paperReading, unreadablePage } from './paperReadingPayload'

/*
 * What staff choose on the check becomes the review ocr-api takes. The checks below are ocr-api's own, copied from
 * hid-system origin/staging-novu-ci-20261005 550c09d9, the branch production is built from, so a payload this page builds is held to what the service validates:
 * - services/ocr-api/src/ocr/dto/validate-ocr-job.dto.ts:12-35 (the body's shape)
 * - services/ocr-api/src/ocr/ocr-publication-policy.ts:9-22 (assertCandidateClassification)
 * - services/ocr-api/src/ocr/ocr-publication-policy.ts:43-137 (MAX_IMPORTED_MEDICATIONS, medicineFields,
 *   importedMedicationCandidates), 208-274 (importedLabCandidate, with labDate 150-200), 276-288 (clinicalNoteCandidate)
 *   and 295-300 (assertPublishableCandidate), which ocr.service.ts:297-303 runs on acceptedFields before saving, with
 *   assertMedicinesWereRead (ocr.service.ts:659-691) for the medicines' itemId and page;
 *   reading/paper-reading.contract.ts:60 (ITEM_ID).
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

/** reading/paper-reading.contract.ts:60. */
const ITEM_ID = /^it-[0-9a-f]{16}(-[2-9]|-[1-9][0-9]+)?$/

/** ocr-publication-policy.ts:52-76 (medicineFields). */
function medicineFields(fields: Record<string, unknown>, contextRequired = false) {
  const text = (name: string, maximum: number, required = false) => {
    const value = fields[name]
    if (value === undefined || value === null || value === '') { if (required) throw new Refused('OCR_INVALID_MEDICATION_EVIDENCE'); return undefined }
    if (typeof value !== 'string' || value.trim().length < 1 || value.length > maximum) throw new Refused('OCR_INVALID_MEDICATION_EVIDENCE')
    return value.trim()
  }
  return { medicationText: text('medicationText', 500, true), strengthText: text('strengthText', 240), doseText: text('doseText', 240),
    frequencyText: text('frequencyText', 240), historicalContext: text('historicalContext', 2_000, contextRequired) }
}

/** ocr-publication-policy.ts:43-46 and 102-137 (importedMedicationCandidates). */
function importedMedicationCandidates(fields: Record<string, unknown>) {
  if (fields.medications === undefined) return { legacy: true, entries: [] as Array<{ itemId?: string; page: number }> }
  const list = fields.medications
  if (!Array.isArray(list) || list.length < 1 || list.length > 50) throw new Refused('OCR_INVALID_MEDICATION_EVIDENCE list of 1 to 50')
  if (['medicationText', 'strengthText', 'doseText', 'frequencyText', 'historicalContext'].some(name => fields[name] !== undefined)) {
    throw new Refused('OCR_INVALID_MEDICATION_EVIDENCE both shapes')
  }
  const seen = new Set<string>()
  const entries = list.map((entry: unknown) => {
    if (!isObject(entry)) throw new Refused('OCR_INVALID_MEDICATION_EVIDENCE entry')
    const value = entry as Record<string, unknown>
    const page = value.page
    if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > 10_000) throw new Refused('OCR_INVALID_MEDICATION_EVIDENCE page')
    const itemId = value.itemId
    medicineFields(value, true)
    if (itemId === undefined || itemId === null) return { page }
    if (typeof itemId !== 'string' || !ITEM_ID.test(itemId)) throw new Refused('OCR_INVALID_MEDICATION_EVIDENCE itemId')
    if (seen.has(itemId)) throw new Refused('OCR_INVALID_MEDICATION_EVIDENCE repeats')
    seen.add(itemId)
    return { itemId, page }
  })
  return { legacy: false, entries }
}

/** ocr.service.ts:659-691 (assertMedicinesWereRead), against the extraction's structured payload. */
function assertMedicinesWereRead(payload: { items: ReadonlyArray<{ id: string; kind: string; page: number }>; pages: ReadonlyArray<{ page: number }> },
  entries: ReadonlyArray<{ itemId?: string; page: number }>) {
  const read = new Map(payload.items.filter(item => item.kind === 'medicine').map(item => [item.id, item.page]))
  const pages = new Set(payload.pages.map(page => page.page))
  for (const entry of entries) {
    if (entry.itemId === undefined) { if (!pages.has(entry.page)) throw new Refused('OCR_MEDICATION_PAGE_NOT_FOUND') }
    else if (read.get(entry.itemId) !== entry.page) throw new Refused('OCR_MEDICATION_NOT_READ')
  }
}

const LAB_FLAGS = ['normal', 'low', 'high', 'critical', 'abnormal', 'unknown']

/**
 * ocr-publication-policy.ts:208-274, with Lab's flag words (create-lab-import.dto.ts:12). Of labDate (150-200), the
 * checks of the text: reportedAtAsWritten 1-120 characters, reportedAt up to 40. Turning the text into a date is
 * ocr-api's (paper-date.ts), so the website sends no reportedAt at all: one sent here would be a date the page guessed.
 */
function importedLabCandidate(fields: Record<string, unknown>) {
  if (!Array.isArray(fields.observations) || fields.observations.length < 1 || fields.observations.length > 200) throw new Refused('OCR_INVALID_LAB_EVIDENCE')
  fields.observations.forEach((item: unknown) => {
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
    text('unit', 80); text('referenceRange', 240); text('testCode', 120); text('reportedAt', 40); text('reportedAtAsWritten', 120)
    if (value.page !== undefined && (typeof value.page !== 'number' || !Number.isInteger(value.page) || value.page < 1 || value.page > 10_000)) {
      throw new Refused('OCR_INVALID_LAB_EVIDENCE page')
    }
    if (value.itemId !== undefined && (typeof value.itemId !== 'string' || !ITEM_ID.test(value.itemId))) throw new Refused('OCR_INVALID_LAB_EVIDENCE itemId')
    const flag = text('abnormalFlag', 20)
    if (flag !== undefined && !LAB_FLAGS.includes(flag)) throw new Refused('lab abnormalFlag @IsIn')
    if (value.reportedAt !== undefined) throw new Refused('a reportedAt the page guessed')
  })
  for (const name of ['collectedAtAsWritten', 'reportedAtAsWritten']) {
    const written = fields[name]
    if (written === undefined || written === null || written === '') continue
    if (typeof written !== 'string' || written.trim().length < 1 || written.length > 120) throw new Refused('OCR_INVALID_LAB_EVIDENCE')
  }
  if (fields.collectedAt !== undefined || fields.reportedAt !== undefined) throw new Refused('a date the page guessed')
}

/** ocr-publication-policy.ts:276-288, with EHR's version 4 visit ID (import-ocr-clinical-note.dto.ts:7). */
function clinicalNoteCandidate(fields: Record<string, unknown>) {
  const { encounterId, noteType, title, content } = fields
  if (typeof encounterId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(encounterId)
    || typeof noteType !== 'string' || noteType.trim().length < 1 || noteType.length > 80
    || typeof title !== 'string' || title.trim().length < 1 || title.length > 240
    || typeof content !== 'string' || content.trim().length < 1 || content.length > 100_000) throw new Refused('OCR_INVALID_CLINICAL_NOTE')
}

/** ocr.service.ts:297-303, assertPublishableCandidate (ocr-publication-policy.ts:295-300), against the reading reviewed. */
type Extraction = Parameters<typeof assertMedicinesWereRead>[0]
function assertAccepted(input: OcrValidationInput, extraction: Extraction = paperReading()) {
  assertBody(input)
  if (input.disposition !== 'validated') return
  if (input.targetDomain === 'EHR') clinicalNoteCandidate(input.acceptedFields)
  else if (input.targetDomain === 'LAB') importedLabCandidate(input.acceptedFields)
  else if (input.targetDomain === 'PHARMACY') {
    const { legacy, entries } = importedMedicationCandidates(input.acceptedFields)
    // The website sends only the list: the single-medicine shape is not used.
    if (legacy) throw new Refused('the single-medicine shape')
    assertMedicinesWereRead(extraction, entries)
  }
}

const EXTRACTION = 'e0000000-0000-4000-8000-000000000001'
const VISIT = 'c0000000-0000-4000-8000-000000000001'
const reading = parsePaperReading(paperReading()) as PaperReading
const items = reviewItems(reading)
const byId = (id: string) => items.find(item => item.id === id)!
const METFORMIN = 'it-00000000000000a2'
const ALLERGY = 'it-00000000000000c1'
const HAEMOGLOBIN = 'it-00000000000000d1'
const AMLODIPINE = 'it-00000000000000a1'
/** Where the fixture's haemoglobin was read, and its date as written on the paper. */
const HB_SOURCE = { page: 2, itemId: HAEMOGLOBIN, reportedAtAsWritten: '01/03/2025' }

function keepAll(paper: PaperReading): Record<string, { choice: 'keep'; text: string }> {
  return Object.fromEntries(reviewItems(paper).map(item => [item.id, { choice: 'keep' as const, text: readingLine(item) }]))
}

const LEGACY = ['medicationText', 'strengthText', 'doseText', 'frequencyText', 'historicalContext']

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

  it('offers Clinical note only when a visit can be chosen, past lab results when results were read, past medicines when medicines were', () => {
    expect(offeredDomains(reading, true)).toEqual(['DOCUMENT_ONLY', 'EHR', 'LAB', 'PHARMACY'])
    expect(offeredDomains(reading, false)).toEqual(['DOCUMENT_ONLY', 'LAB', 'PHARMACY'])
    const noMedicine = paperReading()
    noMedicine.items = noMedicine.items.filter(item => item.kind !== 'medicine')
    expect(offeredDomains(parsePaperReading(noMedicine), false)).toEqual(['DOCUMENT_ONLY', 'LAB'])
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

  it('past lab results: observations Lab and OCR take, a flag in Lab\'s words, and the date only as written', () => {
    const input = built(buildValidation(choices('LAB')))
    expect(() => assertAccepted(input)).not.toThrow()
    expect(input.candidateType).toBe(CANDIDATE_TYPES.LAB)
    expect(input.acceptedFields.observations).toEqual([{ testName: 'Haemoglobin', value: '11.2', unit: 'g/dL', referenceRange: '12-16', abnormalFlag: 'low', ...HB_SOURCE }])
    // No date is guessed: no ISO date anywhere, and no top-level dates, which the reading does not have.
    expect(JSON.stringify(input.acceptedFields)).not.toMatch(/"(reportedAt|collectedAt)"|\d{4}-\d{2}-\d{2}/)
    expect(input.acceptedFields).not.toHaveProperty('collectedAtAsWritten')
    expect(input.acceptedFields).not.toHaveProperty('reportedAtAsWritten')
    // The copied check: as-written text up to 120 characters, and no date the page worked out.
    const observations = input.acceptedFields.observations as object[]
    expect(() => assertAccepted({ ...input, acceptedFields: { observations: [{ ...observations[0], reportedAtAsWritten: 'x'.repeat(121) }] } })).toThrow('OCR_INVALID_LAB_EVIDENCE')
    expect(() => assertAccepted({ ...input, acceptedFields: { observations: [{ ...observations[0], reportedAt: '2025-03-01' }] } })).toThrow('guessed')
  })

  it('past lab results: a result with no date on the paper is sent without one; a date too long to send is left with the document', () => {
    const payload = paperReading()
    payload.items = payload.items.map(item => item.id === HAEMOGLOBIN ? { ...item, dateAsWritten: null } : item) as typeof payload.items
    const undated = built(buildValidation({ ...choices('LAB'), reading: parsePaperReading(payload) as PaperReading }))
    expect(() => assertAccepted(undated)).not.toThrow()
    expect(undated.acceptedFields.observations).toEqual([expect.not.objectContaining({ reportedAtAsWritten: expect.anything() })])
    payload.items = payload.items.map(item => item.id === HAEMOGLOBIN ? { ...item, dateAsWritten: 'x'.repeat(121) } : item) as typeof payload.items
    const long = built(buildValidation({ ...choices('LAB'), reading: parsePaperReading(payload) as PaperReading }))
    expect(() => assertAccepted(long)).not.toThrow()
    expect((long.acceptedFields.observations as object[])[0]).not.toHaveProperty('reportedAtAsWritten')
  })

  it('past lab results: a changed result carries only the words typed; a flag written another way is not sent', () => {
    const payload = paperReading()
    payload.items = payload.items.map(item => item.id === HAEMOGLOBIN ? { ...item, fields: { ...item.fields, flag: 'see note' } } : item) as typeof payload.items
    const flagged = parsePaperReading(payload) as PaperReading
    const kept = built(buildValidation({ ...choices('LAB'), reading: flagged }))
    expect(kept.acceptedFields.observations).toEqual([{ testName: 'Haemoglobin', value: '11.2', unit: 'g/dL', referenceRange: '12-16', ...HB_SOURCE }])
    const changed = built(buildValidation(choices('LAB', { decisions: decided({
      [HAEMOGLOBIN]: { choice: 'change', text: '', test: 'Haemoglobin', result: '11.4 g/dL' } }) })))
    expect(() => assertAccepted(changed)).not.toThrow()
    expect(changed.acceptedFields.observations).toEqual([{ testName: 'Haemoglobin', valueText: '11.4 g/dL', ...HB_SOURCE }])
    expect(changed.corrections).toEqual([{ itemId: HAEMOGLOBIN, kind: 'lab_result', page: 2, field: 'result', oldValue: '11.2 g/dL', newValue: '11.4 g/dL' }])
  })

  // Rehearsal finding 5: the paper's L was dropped. Papers write L, LOW, H, HIGH, * and !; Lab takes its own words.
  it.each([['L', 'low'], ['low', 'low'], ['LOW', 'low'], ['H', 'high'], ['High', 'high'], ['*', 'abnormal'], ['!', 'abnormal'], ['critical', 'critical']])(
    'past lab results: the paper\'s flag %s is sent as Lab\'s %s', (written, sent) => {
      const payload = paperReading()
      payload.items = payload.items.map(item => item.id === HAEMOGLOBIN ? { ...item, fields: { ...item.fields, flag: written } } : item) as typeof payload.items
      const input = built(buildValidation({ ...choices('LAB'), reading: parsePaperReading(payload) as PaperReading }))
      expect(() => assertAccepted(input)).not.toThrow()
      expect((input.acceptedFields.observations as Array<{ abnormalFlag?: string }>)[0]!.abnormalFlag).toBe(sent)
      expect(labFlag(written)).toBe(sent)
    })

  it('past lab results: a changed test name is the test the result is filed under, and is listed as a correction', () => {
    const input = built(buildValidation(choices('LAB', { decisions: decided({
      [HAEMOGLOBIN]: { choice: 'change', text: '', test: ' Haematocrit ', result: '11.2 g/dL' } }) })))
    expect(() => assertAccepted(input)).not.toThrow()
    expect(input.acceptedFields.observations).toEqual([{ testName: 'Haematocrit', valueText: '11.2 g/dL', ...HB_SOURCE }])
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

  it('past medicines, one medicine: a list of one, with its strength and how often, its page, item and where it was read', () => {
    const payload = handwrittenPage()
    const one = parsePaperReading(payload) as PaperReading
    const id = 'it-00000000000000a3'
    const kept = built(buildValidation({ ...choices('PHARMACY'), reading: one, decisions: { [id]: { choice: 'keep', text: '' } } }))
    expect(() => assertAccepted(kept, payload)).not.toThrow()
    expect(kept.acceptedFields.medications).toEqual([{ itemId: id, page: 1, medicationText: 'Possibly ceftriaxone IV; dose and frequency unreadable',
      historicalContext: 'From a paper record, page 1. Read as: Ceftriaxone ? IV' }])
    for (const key of LEGACY) expect(kept.acceptedFields).not.toHaveProperty(key)
    const changed = built(buildValidation({ ...choices('PHARMACY'), reading: one, decisions: { [id]: { choice: 'change', text: 'Ceftriaxone 1 g into a vein once a day' } } }))
    expect(() => assertAccepted(changed, payload)).not.toThrow()
    expect(changed.acceptedFields.medications).toEqual([{ itemId: id, page: 1, medicationText: 'Ceftriaxone 1 g into a vein once a day',
      historicalContext: 'From a paper record, page 1. Read as: Ceftriaxone ? IV' }])
    expect(changed.corrections).toHaveLength(1)
    const removed = buildValidation({ ...choices('PHARMACY'), reading: one, decisions: { [id]: { choice: 'remove', text: '' } } })
    expect(removed).toEqual({ problem: { field: 'ocr-review-domain', message: expect.stringMatching(/^No medicine is kept/) } })
  })

  it('past medicines, the fixture\'s medicines mixed: the kept one as read, the changed one as typed, each its own entry in paper order', () => {
    const input = built(buildValidation(choices('PHARMACY', { decisions: decided({ [METFORMIN]: { choice: 'change', text: 'Metformin 850 mg twice a day' } }) })))
    expect(() => assertAccepted(input)).not.toThrow()
    expect(input.acceptedFields.medications).toEqual([
      { itemId: AMLODIPINE, page: 1, medicationText: 'Amlodipine', strengthText: '5 mg', frequencyText: 'once a day',
        historicalContext: 'From a paper record, page 1. Read as: Amlodipine 5mg od x 30/7. For 30 days. Prescribed by Dr Ade Fictional. Prescribed on 02/03/2025' },
      { itemId: METFORMIN, page: 1, medicationText: 'Metformin 850 mg twice a day', historicalContext: 'From a paper record, page 1. Read as: Metf?rmin 500 bd' },
    ])
    for (const key of LEGACY) expect(input.acceptedFields).not.toHaveProperty(key)
    // The copied check refuses both shapes together, and the single-medicine shape on its own.
    expect(() => assertAccepted({ ...input, acceptedFields: { ...input.acceptedFields, medicationText: 'Amlodipine' } })).toThrow('both shapes')
    expect(() => assertAccepted({ ...input, acceptedFields: { medicationText: 'Amlodipine' } })).toThrow('the single-medicine shape')
    // Only medicines go to past medicines; everything kept is still recorded with the check.
    expect(input.acceptedFields.items).toHaveLength(7)
  })

  it('past medicines: a removed medicine is not sent, and is listed as removed', () => {
    const input = built(buildValidation(choices('PHARMACY', { decisions: decided({ [METFORMIN]: { choice: 'remove', text: '' } }) })))
    expect(() => assertAccepted(input)).not.toThrow()
    expect((input.acceptedFields.medications as Array<{ itemId: string }>).map(entry => entry.itemId)).toEqual([AMLODIPINE])
    expect(input.rejectedFields).toEqual([expect.objectContaining({ itemId: METFORMIN, decision: 'removed' })])
  })

  it('past medicines, three medicines on two pages: three entries, each with the page it was read on', () => {
    const payload = medicinesPaper(3)
    const paper = parsePaperReading(payload) as PaperReading
    const ids = paper.items.map(item => item.id)
    const input = built(buildValidation({ ...choices('PHARMACY'), reading: paper, decisions: { ...keepAll(paper),
      [ids[1]!]: { choice: 'change', text: 'Testamol 20 mg once a day' } } }))
    expect(() => assertAccepted(input, payload)).not.toThrow()
    const medications = input.acceptedFields.medications as Array<Record<string, unknown>>
    expect(medications.map(entry => [entry.itemId, entry.page, entry.medicationText])).toEqual([
      [ids[0], 1, 'Testamol 1'], [ids[1], 1, 'Testamol 20 mg once a day'], [ids[2], 2, 'Testamol 3']])
    expect(medications[0]).toMatchObject({ strengthText: '10 mg', frequencyText: 'once a day', historicalContext: 'From a paper record, page 1. Read as: Testamol 1 10mg od' })
    expect(medications[1]).not.toHaveProperty('strengthText')
    expect(medications[2]!.historicalContext).toBe('From a paper record, page 2. Read as: Testamol 3 10mg od')
    for (const key of LEGACY) expect(input.acceptedFields).not.toHaveProperty(key)
    // The copied check refuses a medicine that was not read on the page it names.
    const moved = { ...input, acceptedFields: { ...input.acceptedFields, medications: medications.map((entry, at) => at === 2 ? { ...entry, page: 1 } : entry) } }
    expect(() => assertAccepted(moved, payload)).toThrow('OCR_MEDICATION_NOT_READ')
  })

  it('past medicines: a medicine read as stopped or taken in the past carries that status, kept or changed', () => {
    const payload = medicinesPaper(2)
    ;(payload.items[0]!.fields as { status: string }).status = 'stopped'
    ;(payload.items[1]!.fields as { status: string }).status = 'past'
    const paper = parsePaperReading(payload) as PaperReading
    const ids = paper.items.map(item => item.id)
    expect(readingLine(paper.items[0]!)).toBe('Testamol 1 10 mg once a day (stopped)')
    const input = built(buildValidation({ ...choices('PHARMACY'), reading: paper, decisions: { ...keepAll(paper),
      [ids[1]!]: { choice: 'change', text: 'Testamol 2 20 mg once a day' } } }))
    expect(() => assertAccepted(input, payload)).not.toThrow()
    const medications = input.acceptedFields.medications as Array<Record<string, unknown>>
    expect(medications[0]).toMatchObject({ medicationText: 'Testamol 1',
      historicalContext: 'From a paper record, page 1. Read as: Testamol 1 10mg od. Status: Stopped' })
    expect(medications[1]).toMatchObject({ medicationText: 'Testamol 2 20 mg once a day',
      historicalContext: 'From a paper record, page 2. Read as: Testamol 2 10mg od. Status: Taken in the past' })
  })

  it('past medicines, 51 kept: the first 50 on the paper are sent, the last stays with the document, and the form says so', () => {
    const payload = medicinesPaper(51)
    const paper = parsePaperReading(payload) as PaperReading
    const decisions = keepAll(paper)
    expect(keptMedicines(reviewItems(paper), decisions)).toBe(51)
    const input = built(buildValidation({ ...choices('PHARMACY'), reading: paper, decisions }))
    expect(() => assertAccepted(input, payload)).not.toThrow()
    const medications = input.acceptedFields.medications as Array<{ itemId: string }>
    expect(medications).toHaveLength(MAX_MEDICINES)
    expect(medications.map(entry => entry.itemId)).toEqual(paper.items.slice(0, 50).map(item => item.id))
    expect((input.acceptedFields.items as unknown[]).length).toBe(51)
    expect(input.rejectedFields).toEqual([])
    // Removing one brings it back to 50: all of them go.
    const fifty = built(buildValidation({ ...choices('PHARMACY'), reading: paper, decisions: { ...decisions, [paper.items[0]!.id]: { choice: 'remove', text: '' } } }))
    expect((fifty.acceptedFields.medications as Array<{ itemId: string }>).map(entry => entry.itemId)).toEqual(paper.items.slice(1).map(item => item.id))
    // ocr-api's own limit, which the page keeps to.
    expect(() => assertAccepted({ ...input, acceptedFields: { medications: [...medications, medications[0]] } }, payload)).toThrow('list of 1 to 50')
  })

  it('past medicines: a medicine too long to add is refused at its card, before sending', () => {
    const payload = medicinesPaper(2)
    payload.items[1] = { ...payload.items[1]!, plain: 'T'.repeat(501) }
    const paper = parsePaperReading(payload) as PaperReading
    const at = reviewItems(paper).findIndex(item => item.id === paper.items[1]!.id)
    expect(buildValidation({ ...choices('PHARMACY'), reading: paper, decisions: keepAll(paper) })).toEqual({ problem: { field: itemCardId(at),
      message: 'This medicine is too long to add to past medicines. Use Change to shorten it to 500 characters or fewer.' } })
  })

  it('every domain\'s review passes ocr-api\'s checks', () => {
    for (const saveAs of ['DOCUMENT_ONLY', 'EHR', 'LAB', 'PHARMACY'] as const) {
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

describe('lines that could not be read are never saved', () => {
  const payload = unreadablePage()
  const page = parsePaperReading(payload) as PaperReading
  const pageItems = reviewItems(page)
  const CEFTRIAXONE = 'it-00000000000000a3'
  const unreadableIds = pageItems.filter(item => item.id !== CEFTRIAXONE).map(item => item.id)
  /** Every item kept: what a careless or scripted Keep on everything would send. */
  const keepEverything = () => Object.fromEntries(pageItems.map(item => [item.id, { choice: 'keep' as const, text: readingLine(item) }]))

  it('start as removed, whatever the reader said of them, so they never wait for a choice', () => {
    expect(unreadableIds).toHaveLength(9)
    const start = initialDecisions(pageItems)
    for (const id of unreadableIds) expect(start[id]!.choice).toBe('remove')
    expect(start[CEFTRIAXONE]!.choice).toBeNull()
    // Only the one line that was read waits for a choice: it is the first, and only, card to ask.
    expect(buildValidation({ ...choices('DOCUMENT_ONLY'), reading: page, decisions: start }))
      .toEqual({ problem: { field: itemCardId(pageItems.findIndex(item => item.id === CEFTRIAXONE)), message: 'Choose Keep, Change or Remove for this item.' } })
  })

  it('are rejected, never accepted or published, even when Keep or Change is sent for them', () => {
    const decisions = { ...keepEverything(), [unreadableIds[0]!]: { choice: 'change' as const, text: 'Paracetamol 1 g' } }
    for (const saveAs of ['DOCUMENT_ONLY', 'EHR', 'PHARMACY'] as const) {
      const input = built(buildValidation({ ...choices(saveAs), reading: page, decisions, encounterId: VISIT }))
      expect(() => assertAccepted(input, payload)).not.toThrow()
      expect((input.acceptedFields.items as Array<{ itemId: string }>).map(item => item.itemId)).toEqual([CEFTRIAXONE])
      expect((input.validatedPayload.items as Array<{ itemId: string }>).map(item => item.itemId)).toEqual([CEFTRIAXONE])
      expect(input.rejectedFields.map(field => (field as { itemId: string; decision: string }).itemId).sort()).toEqual([...unreadableIds].sort())
      expect(input.rejectedFields.every(field => (field as { decision: string }).decision === 'removed')).toBe(true)
      expect(input.corrections).toEqual([])
      if (saveAs === 'PHARMACY') expect((input.acceptedFields.medications as Array<{ itemId: string }>).map(entry => entry.itemId)).toEqual([CEFTRIAXONE])
      if (saveAs === 'EHR') expect(input.acceptedFields.content).not.toMatch(/\[unreadable\]|could not be read/i)
    }
  })

  it('offer nothing to save them as, and are not counted as medicines kept', () => {
    expect(keptMedicines(pageItems, keepEverything())).toBe(1)
    const onlyUnreadable = { ...payload, items: payload.items.filter(item => item.id !== CEFTRIAXONE) }
    expect(offeredDomains(parsePaperReading(onlyUnreadable), true)).toEqual(['DOCUMENT_ONLY'])
    const unreadableMedicines = { ...payload, items: [payload.items.find(item => item.kind === 'note')!, ...payload.items.filter(item => item.kind === 'medicine' && item.id !== CEFTRIAXONE)] }
    expect(offeredDomains(parsePaperReading(unreadableMedicines), true)).toEqual(['DOCUMENT_ONLY'])
    expect(offeredDomains(page, true)).toEqual(['DOCUMENT_ONLY', 'EHR', 'PHARMACY'])
  })

  it('a lab result that couldn’t be read is rejected, never added to past lab results, even with Keep', () => {
    const base = paperReading()
    const lab = base.items.find(item => item.kind === 'lab_result')!
    const blank = { ...lab, id: 'it-0000000000000d99', asWritten: '[unreadable]', fields: { test: null, value: null, unit: null, referenceRange: null, flag: null } }
    const payloadWithBlank = paperReading({ items: [lab, blank], reading: { ...base.reading, itemCount: 2 } })
    const reading = parsePaperReading(payloadWithBlank) as PaperReading
    const items = reviewItems(reading)
    expect(initialDecisions(items)[blank.id]!.choice).toBe('remove')
    const decisions = Object.fromEntries(items.map(item => [item.id, { choice: 'keep' as const, text: readingLine(item) }]))
    const input = built(buildValidation({ ...choices('LAB'), reading, decisions }))
    expect(() => assertAccepted(input, payloadWithBlank)).not.toThrow()
    expect((input.acceptedFields.observations as Array<{ itemId?: string }>).map(entry => entry.itemId)).toEqual([lab.id])
    expect(input.rejectedFields.map(field => (field as { itemId: string }).itemId)).toEqual([blank.id])
  })
})

describe('a line read in part', () => {
  it('waits for a choice even when the reader called it clear, so it is never kept unseen', () => {
    const base = paperReading()
    const partly = { ...base.items[0], asWritten: 'Metro[unreadable] 500' }
    const reading = parsePaperReading(paperReading({ items: [partly], reading: { ...base.reading, itemCount: 1 } })) as PaperReading
    expect(reading.items[0]!.confidence).toBe('clear')
    expect(initialDecisions(reading.items)[reading.items[0]!.id]!.choice).toBeNull()
  })
})

describe('what Keep saves', () => {
  const items = (parsePaperReading(paperReading()) as PaperReading).items
  const byId = (id: string) => items.find(item => item.id === id)!

  it('is the reading line, or a lab result’s test and result as they go to past lab results', () => {
    expect(keptText(byId('it-00000000000000a1'))).toBe('Amlodipine 5 mg once a day')
    expect(keptText(byId('it-00000000000000d1'))).toBe('Haemoglobin 11.2 g/dL')
    expect(keptText(byId('it-00000000000000f1'))).toBe('Come back in two weeks')
  })

  it('is what a validation built with Keep accepts', () => {
    const reading = parsePaperReading(paperReading()) as PaperReading
    const decisions = Object.fromEntries(reading.items.map(item => [item.id, { choice: 'keep' as const, text: readingLine(item) }]))
    const input = built(buildValidation({ ...choices('DOCUMENT_ONLY'), reading, decisions }))
    for (const accepted of input.acceptedFields.items as Array<{ itemId: string; reading: string }>) {
      const item = byId(accepted.itemId)
      if (item.kind !== 'lab_result') expect(accepted.reading).toBe(keptText(item))
    }
  })
})

describe('a hard handwritten page: Keep saves the clean reading, with no reader\'s "?"', () => {
  const payload = hardHandwrittenPage()
  const hard = parsePaperReading(payload) as PaperReading
  const hardItems = reviewItems(hard)
  const hardChoices = (saveAs: SaveAs, decisions: Decisions = keepAll(hard)): ReviewChoices =>
    ({ extractionId: EXTRACTION, reading: hard, decisions, saveAs, encounterId: VISIT, reason: 'Checked against the paper record' })
  const noReaderMarks = (value: string) => {
    expect(value).not.toMatch(/\w\?/)
    expect(value).not.toMatch(/\(or |\[(dose|freq|route|drug)?\?\]|crossed out|…/)
  }

  it('keeps the main reading only: no "?", no other readings, no unreadable parts, nothing crossed out', () => {
    expect(hardItems.map(keptText)).toEqual([
      'IV Ampiclox 500mg 8hrly',
      'Gentamicin 80mg 12hrly',
      'IV Omeprazole 40mg daily',
      'Dc Gentamicin (stopped)',
      'Paracetamol 1g (? on paper)',
      'Admit',
      '21/8 - Transfer to the ward',
    ])
    for (const item of hardItems) noReaderMarks(keptText(item))
    // What Keep saves starts as the words to change, so Change starts clean too.
    expect(Object.values(initialDecisions(hardItems)).map(decision => decision.text)).toEqual(hardItems.map(readingLine))
  })

  it('saves the same clean words in a clinical note, the record of the check and past medicines', () => {
    const note = built(buildValidation(hardChoices('EHR')))
    expect(() => assertAccepted(note, payload)).not.toThrow()
    const content = note.acceptedFields.content as string
    expect(content).toContain('Medicines\n- IV Ampiclox 500mg 8hrly (page 1)\n- Gentamicin 80mg 12hrly (page 1)\n- IV Omeprazole 40mg daily (page 1)'
      + '\n- Dc Gentamicin (stopped) (page 1)\n- Paracetamol 1g (? on paper) (page 1)')
    expect(content).toContain('Notes\n- Admit (page 1)\n- 21/8 - Transfer to the ward (page 1)')
    expect(content.match(/\?/g)).toHaveLength(1)
    const accepted = note.acceptedFields.items as Array<{ reading: string }>
    for (const item of accepted) noReaderMarks(item.reading)

    const medicines = built(buildValidation(hardChoices('PHARMACY')))
    expect(() => assertAccepted(medicines, payload)).not.toThrow()
    const medications = medicines.acceptedFields.medications as Array<Record<string, string>>
    expect(medications.map(entry => [entry.medicationText, entry.strengthText, entry.frequencyText])).toEqual([
      ['IV Ampiclox 500mg 8hrly', undefined, undefined],
      ['Gentamicin', '80mg', '12hrly'],
      ['IV Omeprazole 40mg daily', undefined, undefined],
      ['Dc Gentamicin', undefined, undefined],
      ['Paracetamol 1g (? on paper)', undefined, undefined],
    ])
    expect(medications[1]!.historicalContext).toBe('From a paper record, page 1. Read as: IV Gentamicin 80mg 12hrly')
    for (const entry of medications) for (const value of Object.values(entry)) if (typeof value === 'string') noReaderMarks(value)
  })

  it('changes nothing about Change: the words typed are saved as typed', () => {
    const [first] = hardItems
    const decisions = { ...keepAll(hard), [first!.id]: { choice: 'change' as const, text: 'Ampiclox 500 mg into a vein every 8 hours' } }
    const input = built(buildValidation(hardChoices('EHR', decisions)))
    expect(input.corrections).toEqual([{ itemId: first!.id, kind: 'medicine', page: 1, field: 'reading',
      oldValue: 'IV Ampiclox 500mg 8hrly', newValue: 'Ampiclox 500 mg into a vein every 8 hours' }])
  })

  it('never saves a line of only parts that couldn\'t be read', () => {
    const gaps = { ...payload, items: [...payload.items, { ...payload.items[5]!, id: 'it-0000000000000908', asWritten: '[drug?] [dose?]' }] }
    const withGaps = parsePaperReading(gaps) as PaperReading
    const input = built(buildValidation({ ...hardChoices('EHR', keepAll(withGaps)), reading: withGaps }))
    expect((input.acceptedFields.items as Array<{ itemId: string }>).map(item => item.itemId)).not.toContain('it-0000000000000908')
    expect(input.rejectedFields.map(item => (item as { itemId: string }).itemId)).toContain('it-0000000000000908')
  })
})

/** Rehearsal finding 2: where the kept items of each kind go, said beside the save chosen. Fictional data only. */
describe('where kept items go, by the save chosen', () => {
  const items = reviewItems(parsePaperReading(paperReading()) as PaperReading)
  const keepAll: Decisions = Object.fromEntries(items.map(item => [item.id, { choice: 'keep', text: '' }]))
  const keepOnly = (...kinds: string[]): Decisions => Object.fromEntries(items.map(item => [item.id, { choice: kinds.includes(item.kind) ? 'keep' : 'remove', text: '' }]))

  it('a clinical note says allergies, diagnoses and vitals are written into the note only, and where to record them', () => {
    expect(keptItemsGo('EHR', items, keepAll)).toBe('Allergies, diagnoses and vitals are written into the note only. Record them in Allergies, Diagnoses or Vitals too.')
    expect(keptItemsGo('EHR', items, keepOnly('allergy', 'diagnosis', 'medicine'))).toBe('Allergies and diagnoses are written into the note only. Record them in Allergies or Diagnoses too.')
    expect(keptItemsGo('EHR', items, keepOnly('medicine', 'note'))).toBe('')
  })

  it('past medicines and past lab results say which kinds are saved nowhere but the document', () => {
    expect(keptItemsGo('PHARMACY', items, keepAll)).toBe('Diagnoses, allergies, lab results, vitals and notes you keep are not saved anywhere but this document.')
    expect(keptItemsGo('LAB', items, keepOnly('lab_result', 'allergy'))).toBe('Allergies you keep are not saved anywhere but this document.')
    expect(keptItemsGo('PHARMACY', items, keepOnly('medicine'))).toBe('')
  })

  it('says nothing for the document only, nor for removed items', () => {
    expect(keptItemsGo('DOCUMENT_ONLY', items, keepAll)).toBe('')
    expect(keptItemsGo('EHR', items, keepOnly())).toBe('')
  })
})


describe('the report date typed from the paper (past lab results)', () => {
  it('is sent at the top level, trimmed, only as typed, and never in place of an item\'s own date', () => {
    const input = built(buildValidation(choices('LAB', { reportedAtAsWritten: '  14/02/2024 ' })))
    expect(() => assertAccepted(input)).not.toThrow()
    expect(input.acceptedFields.reportedAtAsWritten).toBe('14/02/2024')
    expect(input.acceptedFields).not.toHaveProperty('reportedAt')
    expect(input.acceptedFields).not.toHaveProperty('collectedAtAsWritten')
    // Each result keeps the date read beside it, unchanged.
    expect(input.acceptedFields.observations).toEqual([expect.objectContaining(HB_SOURCE)])
  })

  it('is not sent when left blank or only spaces, and is never filled in from the items read', () => {
    for (const typed of [undefined, '', '   ']) {
      const input = built(buildValidation(choices('LAB', typed === undefined ? {} : { reportedAtAsWritten: typed })))
      expect(input.acceptedFields).not.toHaveProperty('reportedAtAsWritten')
    }
    // The reading has a result dated 01/03/2025: that date stays with its result, never the paper's.
    const input = built(buildValidation(choices('LAB')))
    expect(input.acceptedFields).not.toHaveProperty('reportedAtAsWritten')
  })

  it('is sent as written, whatever its form: ocr-api keeps text it cannot read as a date', () => {
    for (const typed of ['Mar 2025', '12th March 2025', '3/4/25', 'see page 2']) {
      const input = built(buildValidation(choices('LAB', { reportedAtAsWritten: typed })))
      expect(() => assertAccepted(input)).not.toThrow()
      expect(input.acceptedFields.reportedAtAsWritten).toBe(typed)
    }
  })

  it('is refused at its field only when longer than ocr-api keeps (120 characters)', () => {
    expect(built(buildValidation(choices('LAB', { reportedAtAsWritten: 'x'.repeat(120) }))).acceptedFields.reportedAtAsWritten).toBe('x'.repeat(120))
    expect(buildValidation(choices('LAB', { reportedAtAsWritten: 'x'.repeat(121) })))
      .toEqual({ problem: { field: REPORT_DATE_FIELD, message: 'Write the date in 120 characters or fewer.' } })
  })

  it('is only for past lab results: no other save sends it', () => {
    for (const saveAs of ['DOCUMENT_ONLY', 'PHARMACY'] as const) {
      const input = built(buildValidation(choices(saveAs, { reportedAtAsWritten: '14/02/2024' })))
      expect(input.acceptedFields).not.toHaveProperty('reportedAtAsWritten')
    }
  })
})
