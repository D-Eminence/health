import { describe, expect, it } from 'vitest'
import { READING_DELETED, readingDeleted } from '../../../../ehr-blue/departments/migrate/readingDeleted'

const NOW = Date.parse('2026-11-11T12:00:00.000Z')
const blank = { id: 'extraction-1', version: 1, provider: 'textract', rawText: null, structuredPayload: {} }

describe('readingDeleted (hid-system 0110)', () => {
  it('says its sentence', () => expect(READING_DELETED).toBe('Reading deleted after 24 hours'))

  it('takes null text and an empty payload, 24 hours old or more, for a deleted reading', () => {
    expect(readingDeleted({ ...blank, createdAt: '2026-11-10T12:00:00.000Z' }, NOW)).toBe(true)
    expect(readingDeleted({ ...blank, createdAt: '2026-10-01T09:00:00.000Z' }, NOW)).toBe(true)
    expect(readingDeleted(blank, NOW)).toBe(true)
  })

  it('never takes a reading of the last 24 hours for a deleted one', () => {
    expect(readingDeleted({ ...blank, createdAt: '2026-11-10T12:00:01.000Z' }, NOW)).toBe(false)
  })

  it.each([
    ['text', { rawText: 'Haemoglobin 12.1' }],
    ['empty text', { rawText: '' }],
    ['no text field', { rawText: undefined }],
    ['a payload with a member', { structuredPayload: { title: 'Full blood count' } }],
    ['a null payload', { structuredPayload: null }],
    ['no payload', { structuredPayload: undefined }],
    ['an array payload', { structuredPayload: [] }],
  ])('leaves a reading with %s as it is', (_said, fields) => {
    expect(readingDeleted({ ...blank, createdAt: '2026-10-01T09:00:00.000Z', ...fields }, NOW)).toBe(false)
  })
})
