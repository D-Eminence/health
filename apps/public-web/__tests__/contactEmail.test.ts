import { describe, expect, it, vi } from 'vitest'
import { EMPTY_REFERRAL, validateReferral, type ReferralRequest } from '@/lib/referral'
import { validateDemoRequest, type DemoRequest } from '@/lib/demo-request'

const request = vi.hoisted(() => vi.fn())
vi.mock('@hid/api', () => ({ createRegisteredBrowserClient: () => ({ request }) }))
vi.mock('@/lib/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'http://localhost:3100' }) }))

import { startOrganizationCompletion } from '@/lib/provider-application'

/**
 * hid-system checks every public contact email with class-validator's
 * @IsEmail() and @MaxLength(254), after trimming (CreateDemoRequestDto
 * contactEmail; the organization application and completion DTOs'
 * administratorEmail). The site's check was one regex, so these addresses
 * passed it and were refused with a bare 400 VALIDATION_FAILED, "One or more
 * request fields are invalid.", with no field marked. Each case below was run
 * through validator 13.15.35's isEmail from hid-system's node_modules.
 */
const REFUSED = [
  'ada@gmail.c',
  'ada..okafor@gmail.com',
  '.ada@gmail.com',
  'ada.@gmail.com',
  'ada@gmail..com',
  'ada@gmail.com.',
  'ada@gmail,com.ng',
  'ada@exa_mple.com',
  'ada@123.456',
  'ada@-gmail.com',
  'ada@gmail-.com',
  'ada@gmail.c0m',
  'ada@localhost',
  'ada@[192.168.0.1]',
  'ada@1.2.3.4',
  'ada okafor@gmail.com',
  'ada@ex ample.com',
  'ada(x)@gmail.com',
  `${'a'.repeat(65)}@gmail.com`,
  `ada@${'a'.repeat(64)}.com`,
  `ada@${'abcdefghij.'.repeat(23)}com`,
  'ada@example.ｃｏｍ',
] as const

const ACCEPTED = [
  'ada@gmail.co',
  'ada.okafor@hospital.com.ng',
  'ada+referrals@gmail.com',
  "o'brien@example.ie",
  'ADA@EXAMPLE.ORG',
  'ada-okafor_1@sub.example-domain.com',
  'ada@xn--80ak6aa92e.com',
  'ada@例え.jp',
  `${'a'.repeat(64)}@gmail.com`,
  `ada@${'a'.repeat(63)}.com`,
] as const

const referral = (referrerEmail: string): ReferralRequest => ({ ...EMPTY_REFERRAL, referrerName: 'Ada Okafor',
  referrerEmail, facilityName: 'Lagos General Hospital', facilityType: 'hospital', consent: true })
const demo = (email: string): DemoRequest => ({ service: 'ehr', facility: 'Lagos General Hospital', contactName: 'Ada Okafor',
  role: 'Medical director', otherRole: '', email, phone: '', notes: '' })

describe('a contact email hid-system refuses', () => {
  it.each(REFUSED)('%s is refused on the referral form', email => {
    expect(validateReferral(referral(email)).referrerEmail).toBe('Enter a valid email address.')
  })

  it.each(REFUSED)('%s is refused on the demo form', email => {
    expect(validateDemoRequest(demo(email)).email).toBe('Enter a valid email address.')
  })

  it.each(REFUSED)('%s is refused before facility completion asks for a code', async email => {
    request.mockClear()
    await expect(startOrganizationCompletion({ productCode: 'ehr', cacRegistrationNumber: 'RC123456',
      administratorEmail: email, turnstileToken: 'widget-token' })).rejects.toThrow('Enter the administrator email used on the application.')
    expect(request).not.toHaveBeenCalled()
  })
})

describe('a contact email hid-system accepts', () => {
  it.each(ACCEPTED)('%s is accepted on the referral and demo forms', email => {
    expect(validateReferral(referral(email)).referrerEmail).toBeUndefined()
    expect(validateReferral(referral(` ${email} `)).referrerEmail).toBeUndefined()
    expect(validateDemoRequest(demo(email)).email).toBeUndefined()
  })
})
