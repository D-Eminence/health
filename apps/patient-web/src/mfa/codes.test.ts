import { describe, expect, it } from 'vitest'
import { SIX_DIGIT_CODE_FIELD, formatSetupKey, isRecoveryCode, isSixDigitCode, sixDigitCode } from './codes'

/**
 * The code rules the platform console and the provider portal share. Identity
 * takes an authenticator or emailed code as exactly six digits, and a recovery
 * code as 10 to 16 characters once trimmed (hid-system platform-auth.dto.ts).
 */
describe('a six-digit code field', () => {
  it('keeps only the digits typed or pasted, at most six', () => {
    expect(sixDigitCode('12a34 56')).toBe('123456')
    expect(sixDigitCode('123 456 789')).toBe('123456')
    expect(sixDigitCode('abc')).toBe('')
  })

  it('is complete only with six digits', () => {
    expect(isSixDigitCode('123456')).toBe(true)
    expect(isSixDigitCode('12345')).toBe(false)
    expect(isSixDigitCode('1234567')).toBe(false)
    expect(isSixDigitCode('12345a')).toBe(false)
  })

  it('asks for a numeric keypad and offers the one-time code the browser or phone has', () => {
    expect(SIX_DIGIT_CODE_FIELD).toEqual({ inputMode: 'numeric', autoComplete: 'one-time-code', pattern: '[0-9]{6}' })
  })
})

describe('a recovery code', () => {
  it('is 10 to 16 characters once trimmed', () => {
    expect(isRecoveryCode(' ABCDE-FGHJK ')).toBe(true)
    expect(isRecoveryCode('ABCDEFGHJ')).toBe(false)
    expect(isRecoveryCode('ABCDEFGHJKMNPQRS')).toBe(true)
    expect(isRecoveryCode('ABCDEFGHJKMNPQRST')).toBe(false)
  })
})

describe('a setup key', () => {
  it('is grouped in fours for typing into an authenticator app', () => {
    expect(formatSetupKey('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')
    expect(formatSetupKey('ABCDEF')).toBe('ABCD EF')
  })
})
