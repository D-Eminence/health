import { describe, expect, it } from 'vitest'
import {
  HEALTH_ID_PATTERN, HEALTH_ID_PREFIX, emailOrHealthId, healthIdOrOtherInput, isBlankHealthIdInput, isCompleteHealthId,
  normalizeHealthIdInput,
} from '../index'

/** The owner's rule (2026-10-27): a Health ID is HID- and 6 characters, and every field starts with HID- filled in. */
describe('a field that takes only a Health ID', () => {
  it('keeps the prefix, once, whatever is typed or pasted', () => {
    expect(HEALTH_ID_PREFIX).toBe('HID-')
    expect(normalizeHealthIdInput('HID-')).toBe('HID-')
    expect(normalizeHealthIdInput('HID-7KQ2M9')).toBe('HID-7KQ2M9')
    // Typed after the prefill, without it, or with the hyphen deleted.
    expect(normalizeHealthIdInput('7KQ2M9')).toBe('HID-7KQ2M9')
    expect(normalizeHealthIdInput('HID7KQ2M9')).toBe('HID-7KQ2M9')
    expect(normalizeHealthIdInput('-7KQ2M9')).toBe('HID-7KQ2M9')
  })

  it('puts what is typed in capitals and removes spaces', () => {
    expect(normalizeHealthIdInput('HID-abc234')).toBe('HID-ABC234')
    expect(normalizeHealthIdInput('  HID - 7kq 2m9 ')).toBe('HID-7KQ2M9')
    expect(normalizeHealthIdInput('HID-\t7KQ\n2M9')).toBe('HID-7KQ2M9')
  })

  it('collapses a Health ID pasted after the prefill, in capitals or not', () => {
    expect(normalizeHealthIdInput('HID-HID-ABC234')).toBe('HID-ABC234')
    expect(normalizeHealthIdInput('HID-hid-abc234')).toBe('HID-ABC234')
    expect(normalizeHealthIdInput('hid-abc234')).toBe('HID-ABC234')
    expect(normalizeHealthIdInput('HID-HID-HID-ABC234')).toBe('HID-ABC234')
    expect(normalizeHealthIdInput('HID--ABC234')).toBe('HID-ABC234')
  })

  it('gives the prefix back when the field is emptied or cut back into it', () => {
    expect(normalizeHealthIdInput('')).toBe('HID-')
    expect(normalizeHealthIdInput('   ')).toBe('HID-')
    expect(normalizeHealthIdInput('HID')).toBe('HID-')
    expect(normalizeHealthIdInput('hid')).toBe('HID-')
    expect(normalizeHealthIdInput('-')).toBe('HID-')
  })

  it('leaves a mistyped Health ID to be refused, as typed', () => {
    expect(normalizeHealthIdInput('HID-K0LO1I')).toBe('HID-K0LO1I')
    expect(normalizeHealthIdInput('HID-4471-08')).toBe('HID-4471-08')
  })
})

describe('a complete Health ID', () => {
  it('is HID- and 6 to 32 characters without 0, 1, I or O, once normalized', () => {
    expect(isCompleteHealthId('HID-7KQ2M9')).toBe(true)
    expect(isCompleteHealthId('hid-7kq2m9')).toBe(true)
    expect(isCompleteHealthId('7KQ2M9')).toBe(true)
    expect(isCompleteHealthId('HID-HID-7KQ2M9')).toBe(true)
    // Older Health IDs stay valid.
    expect(isCompleteHealthId('HID-ABCDEFGH23456789')).toBe(true)
    expect(isCompleteHealthId(`HID-${'A'.repeat(32)}`)).toBe(true)
    expect(isCompleteHealthId(`HID-${'A'.repeat(33)}`)).toBe(false)
    expect(isCompleteHealthId('HID-7KQ2M')).toBe(false)
    expect(isCompleteHealthId('HID-')).toBe(false)
    expect(isCompleteHealthId('')).toBe(false)
    expect(isCompleteHealthId('HID-K0LO1I')).toBe(false)
    expect(isCompleteHealthId('HID-4471-08')).toBe(false)
  })

  it('is what Identity checks: in capitals only', () => {
    expect(HEALTH_ID_PATTERN.test('HID-7KQ2M9')).toBe(true)
    expect(HEALTH_ID_PATTERN.test('HID-7kq2m9')).toBe(false)
    expect(HEALTH_ID_PATTERN.test('hid-7KQ2M9')).toBe(false)
  })

  it('is missing while the field holds only the prefix', () => {
    expect(isBlankHealthIdInput('HID-')).toBe(true)
    expect(isBlankHealthIdInput('')).toBe(true)
    expect(isBlankHealthIdInput(' hid- ')).toBe(true)
    expect(isBlankHealthIdInput('HID-7')).toBe(false)
    expect(isBlankHealthIdInput('ada@example.test')).toBe(false)
  })
})

describe('a field that takes a Health ID or something else', () => {
  it('keeps what is typed after the prefill as typed, in its own case', () => {
    expect(healthIdOrOtherInput('HID-')).toBe('HID-')
    expect(healthIdOrOtherInput('HID-abc234')).toBe('HID-abc234')
    expect(healthIdOrOtherInput('HID-ada')).toBe('HID-ada')
  })

  it('drops the prefix once an email is typed after it, keeping the email’s case', () => {
    expect(healthIdOrOtherInput('HID-ada@')).toBe('ada@')
    expect(healthIdOrOtherInput('HID-Ada.Obi@Example.test')).toBe('Ada.Obi@Example.test')
    // An email typed or pasted in place of the prefix, and one that itself starts with hid-, are kept.
    expect(healthIdOrOtherInput('ada@example.test')).toBe('ada@example.test')
    expect(healthIdOrOtherInput('HID-hid-team@example.test')).toBe('hid-team@example.test')
    expect(healthIdOrOtherInput('hid-team@example.test')).toBe('hid-team@example.test')
  })

  it('lets the prefix be deleted to type an order reference', () => {
    expect(healthIdOrOtherInput('HID')).toBe('HID')
    expect(healthIdOrOtherInput('')).toBe('')
    expect(healthIdOrOtherInput('3F2A9C1B')).toBe('3F2A9C1B')
    expect(healthIdOrOtherInput('3f2a9c1b')).toBe('3f2a9c1b')
  })

  it('keeps one prefix when a Health ID is pasted after the prefill', () => {
    expect(healthIdOrOtherInput('HID-HID-ABC234')).toBe('HID-ABC234')
    expect(healthIdOrOtherInput('HID-HID-HID-ABC234')).toBe('HID-ABC234')
  })

  it('sends an email as typed, and anything else as a Health ID in capitals', () => {
    expect(emailOrHealthId(' Ada@Example.test ')).toBe('Ada@Example.test')
    expect(emailOrHealthId('HID-abc234')).toBe('HID-ABC234')
    expect(emailOrHealthId('hid-abc234 ')).toBe('HID-ABC234')
    expect(emailOrHealthId('HID-hid-abc234')).toBe('HID-ABC234')
    expect(emailOrHealthId('abc234')).toBe('HID-ABC234')
  })
})
