import { describe, expect, it } from 'vitest'
import { parseNovuPatientChat, parseNovuPatientChatHistory, parseNovuPatientChatSource } from '../novuPatientChat'
import { HID_ENDPOINTS } from '../registry'

// Fictional records only (Patient One, HID-ZDEMAAA2).
const id = '22222222-2222-4222-8222-222222222222'
const source = { number: 2, kind: 'lab_result', id, version: '3', title: 'Full blood count', recordedAt: '2026-10-01T10:00:00Z',
  effectiveAt: '2026-09-30', provenance: 'Laboratory result', quality: 'released', origin: 'health_worker' }
const answer = 'Your haemoglobin was 11.2 g/dL [2].\n\nTalk to your doctor about what this result means.'

describe('the patient chat answer on a Novu build (hid-system #167)', () => {
  it('keeps each source\'s origin label as the server wrote it', () => {
    const reply = parseNovuPatientChat({ status: 'ready', answer, sources: [{ ...source, originLabel: 'Recorded by a health worker', hash: 'private' }] })
    expect(reply.answer).toBe(answer)
    expect(reply.sources).toEqual([{ ...source, originLabel: 'Recorded by a health worker' }])
  })
  it('leaves out a label that is not plain text, without refusing the answer', () => {
    for (const originLabel of ['', 7, null, 'Bad\u0000label', 'x'.repeat(201)]) {
      const reply = parseNovuPatientChat({ status: 'ready', answer, sources: [{ ...source, originLabel }] })
      expect('originLabel' in reply.sources[0]!).toBe(false)
    }
  })
  it('reads an answer with no status or sources as a ready answer with none, as the page did before', () => {
    expect(parseNovuPatientChat({ answer: 'Plain answer.' })).toEqual({ status: 'ready', answer: 'Plain answer.', sources: [] })
  })
  it('still refuses another contract\'s answer and malformed sources', () => {
    expect(() => parseNovuPatientChat({ status: 'answered', answer, sources: [] })).toThrow()
    expect(() => parseNovuPatientChat({ status: 'ready', answer, sources: [{ ...source, id: 'other' }] })).toThrow()
    expect(() => parseNovuPatientChat('text')).toThrow()
  })
  it('reads saved conversations with their labels', () => {
    const history = parseNovuPatientChatHistory({ retentionDays: 30, limit: 10, exchanges: [{ id: '00000000-0000-4000-8000-000000000001',
      question: 'My blood count?', createdAt: '2026-11-01T10:00:00Z',
      reply: { status: 'ready', answer, sources: [{ ...source, originLabel: 'Recorded by a health worker' }] } }] })
    expect(history.exchanges[0]!.reply.sources[0]).toMatchObject({ originLabel: 'Recorded by a health worker' })
    expect(() => parseNovuPatientChatHistory({ retentionDays: 30, limit: 50, exchanges: [] })).toThrow()
  })
})

describe('the patient chat source viewer read', () => {
  const view = { kind: 'lab_result', id, kindLabel: 'Lab result', title: 'Full blood count', recordedAt: '2026-10-01T10:00:00Z',
    effectiveAt: null, originLabel: 'Recorded by a health worker', provenance: 'Laboratory result',
    items: [{ label: 'Test', value: 'Haemoglobin' }, { label: 'Value', value: '11.2' }],
    notices: ['The lab is correcting this result.', 'Not checked by a clinician.'] }
  it('keeps every item and every notice', () => {
    expect(parseNovuPatientChatSource({ ...view, hash: 'private', fields: { raw: true } }, { kind: 'lab_result', id })).toEqual(view)
  })
  it('refuses a source other than the one asked for, or a malformed one', () => {
    expect(() => parseNovuPatientChatSource(view, { kind: 'note', id })).toThrow()
    expect(() => parseNovuPatientChatSource(view, { kind: 'lab_result', id: '33333333-3333-4333-8333-333333333333' })).toThrow()
    expect(() => parseNovuPatientChatSource({ ...view, notices: [''] }, { kind: 'lab_result', id })).toThrow()
    expect(() => parseNovuPatientChatSource({ ...view, items: [{ label: 'Test' }] }, { kind: 'lab_result', id })).toThrow()
    expect(() => parseNovuPatientChatSource({ ...view, originLabel: undefined }, { kind: 'lab_result', id })).toThrow()
  })
  it('opens a long scanned document: a value up to 200,000 characters is kept whole, a longer one is cut, never refused', () => {
    const long = 'Discharge summary for Patient One. '.repeat(715).slice(0, 25_000)
    const read = parseNovuPatientChatSource({ ...view, kind: 'document', items: [{ label: 'Text', value: long }] }, { kind: 'document', id })
    expect(read.items[0]!.value).toBe(long)
    const longest = parseNovuPatientChatSource({ ...view, items: [{ label: 'Text', value: 'a'.repeat(250_000) }] }, { kind: 'lab_result', id })
    expect(longest.items[0]!.value).toBe(`${'a'.repeat(200_000)}…`)
  })
  it('reads a source from a service before #167 (the raw record, no items or notices) as a plain view', () => {
    const old = { kind: 'lab_result', id, version: '3:pending:1', hash: 'private', title: 'Full blood count',
      recordedAt: '2026-10-01T10:00:00Z', effectiveAt: '2026-09-30', provenance: 'Released laboratory result',
      quality: 'verified and released', origin: 'health_worker', originLabel: 'Recorded by a health worker', content: 'raw',
      fields: { test: 'Haemoglobin', numericValue: 11.2, unit: 'g/dL', correctionPending: true, _internal: 'x', flagged: false,
        specimen: null, range: { low: 12, high: 16 } } }
    expect(parseNovuPatientChatSource(old, { kind: 'lab_result', id })).toEqual({ kind: 'lab_result', id, kindLabel: 'Lab result',
      title: 'Full blood count', recordedAt: '2026-10-01T10:00:00Z', effectiveAt: '2026-09-30',
      originLabel: 'Recorded by a health worker', provenance: 'Released laboratory result',
      items: [{ label: 'Test', value: 'Haemoglobin' }, { label: 'Numeric value', value: '11.2' }, { label: 'Unit', value: 'g/dL' },
        { label: 'Flagged', value: 'No' }, { label: 'Range: Low', value: '12' }, { label: 'Range: High', value: '16' }],
      notices: ['The lab is correcting this result.'] })
    const added = parseNovuPatientChatSource({ ...old, kind: 'document', version: '1', origin: 'patient', originLabel: undefined,
      fields: { text: 'x'.repeat(25_000) } }, { kind: 'document', id })
    expect(added).toMatchObject({ kindLabel: 'Clinical document', originLabel: 'You added this', notices: ['Not checked by a clinician.'] })
    expect(added.items).toEqual([{ label: 'Text', value: 'x'.repeat(25_000) }])
    expect(() => parseNovuPatientChatSource(old, { kind: 'note', id })).toThrow()
  })
  it('stays registered as proposed, with its answer and its 404 named', () => {
    const endpoint = HID_ENDPOINTS.find(item => item.name === 'ehr.patientChatSource')
    expect(endpoint?.status).toBe('proposed')
    expect(endpoint?.note).toMatch(/CHAT_SOURCE_UNAVAILABLE/)
    expect(HID_ENDPOINTS.find(item => item.name === 'ehr.patientChat')?.note).toMatch(/PATIENT_CHAT_RATE_LIMITED/)
  })
})
