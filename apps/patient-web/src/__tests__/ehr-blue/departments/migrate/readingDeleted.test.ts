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

  describe('with the server\'s contentDeleted flag (hid-system#226)', () => {
    const read = { id: 'extraction-1', version: 1, provider: 'textract', rawText: 'Haemoglobin 12.1', structuredPayload: { title: 'Full blood count' } }

    it('takes contentDeleted true for a deleted reading whatever its shape or age', () => {
      expect(readingDeleted({ ...read, contentDeleted: true, createdAt: '2026-11-11T11:59:00.000Z' }, NOW)).toBe(true)
      expect(readingDeleted({ ...read, contentDeleted: true }, NOW)).toBe(true)
      expect(readingDeleted({ ...blank, contentDeleted: true, createdAt: '2026-11-11T11:59:00.000Z' }, NOW)).toBe(true)
      expect(readingDeleted({ ...read, rawText: '', structuredPayload: null, contentDeleted: true }, NOW)).toBe(true)
    })

    it('takes contentDeleted false for a kept reading even when it looks blank and old', () => {
      expect(readingDeleted({ ...blank, contentDeleted: false, createdAt: '2026-10-01T09:00:00.000Z' }, NOW)).toBe(false)
      expect(readingDeleted({ ...blank, contentDeleted: false }, NOW)).toBe(false)
    })

    it.each([
      ['absent', {}],
      ['undefined', { contentDeleted: undefined }],
      ['null', { contentDeleted: null }],
    ])('falls back to the shape and age when the flag is %s', (_said, flag) => {
      expect(readingDeleted({ ...blank, ...flag, createdAt: '2026-10-01T09:00:00.000Z' }, NOW)).toBe(true)
      expect(readingDeleted({ ...blank, ...flag, createdAt: '2026-11-10T12:00:01.000Z' }, NOW)).toBe(false)
      expect(readingDeleted({ ...read, ...flag, createdAt: '2026-10-01T09:00:00.000Z' }, NOW)).toBe(false)
    })
  })
})
