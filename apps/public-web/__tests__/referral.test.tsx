import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EMPTY_REFERRAL, FACILITY_FIELDS, REFERRER_FIELDS, referralMessage, stepErrors, toReferralSubmission, validateReferral, type ReferralRequest } from '../lib/referral'

const submitDemoRequest = vi.hoisted(() => vi.fn())
vi.mock('@/lib/commercial-api', () => ({ submitDemoRequest }))
vi.mock('@/lib/env', () => ({ getEnvironment: () => ({ name: 'local', turnstileSiteKey: '', appOrigin: 'http://localhost:3100' }) }))
vi.mock('@/components/shared/TurnstileWidget', () => ({ TurnstileWidget: () => null }))

import { ReferralForm } from '../components/referral/ReferralForm'

const FILLED: ReferralRequest = {
  ...EMPTY_REFERRAL,
  referrerName: ' Ada Okafor ', referrerEmail: ' Ada@Example.TEST ', facilityName: ' Lagos General Hospital ',
  facilityType: 'hospital', facilityLocation: 'Ikeja', facilityContact: 'Dr Bello, medical director', consent: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  submitDemoRequest.mockResolvedValue(undefined)
})

describe('referral rules', () => {
  it('needs the referrer, the facility, its type and the referrer’s confirmation', () => {
    const errors = validateReferral(EMPTY_REFERRAL)
    expect(Object.keys(errors).sort()).toEqual(['consent', 'facilityName', 'facilityType', 'referrerEmail', 'referrerName'])
    expect(validateReferral(FILLED)).toEqual({})
    expect(validateReferral({ ...FILLED, consent: false }).consent).toBeTruthy()
  })

  it('splits the problems between the facility step and the referrer step', () => {
    const errors = validateReferral(EMPTY_REFERRAL)
    expect(Object.keys(stepErrors(errors, FACILITY_FIELDS)).sort()).toEqual(['facilityName', 'facilityType'])
    expect(Object.keys(stepErrors(errors, REFERRER_FIELDS)).sort()).toEqual(['consent', 'referrerEmail', 'referrerName'])
  })

  it('sends the referrer as the contact, tagged as a referral', () => {
    const body = toReferralSubmission(FILLED, '/earn', 'token')
    expect(body).toMatchObject({
      contactName: 'Ada Okafor', contactEmail: 'ada@example.test', contactRole: 'Referral partner',
      organizationName: 'Lagos General Hospital', productCode: 'general', sourcePage: '/earn',
      sourceSection: 'referral', ctaLabel: 'Refer a facility', turnstileAction: 'book-demo', turnstileToken: 'token',
    })
    expect(body.message).toContain('Referral from Ada Okafor')
    expect(body.message).toContain('Facility type: Hospital.')
    expect(body.message).toContain('Who to speak to: Dr Bello, medical director')
    expect(body.message).toContain('knows about this introduction')
  })

  it('keeps the message within the backend limit and refuses an incomplete referral', () => {
    expect(referralMessage({ ...FILLED, facilityContact: 'y'.repeat(300) }).length).toBeLessThanOrEqual(2000)
    expect(() => toReferralSubmission({ ...FILLED, consent: false }, '/earn', 't')).toThrow()
    expect(() => toReferralSubmission(FILLED, '/earn', '')).toThrow()
  })
})

describe('referral form', () => {
  function fill(name: string, value: string) {
    fireEvent.change(document.querySelector(`[name="${name}"]`)!, { target: { value } })
  }

  it('asks about the facility first, and shows what is missing', () => {
    render(<ReferralForm />)
    expect(screen.getByText('Step 1 of 2')).toBeTruthy()
    expect(document.querySelector('[name="referrerName"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Enter the facility’s name.')).toBeTruthy()
    expect(screen.getByText('Choose the type of facility.')).toBeTruthy()
    expect(screen.queryByText('Enter your full name.')).toBeNull()
    expect(screen.getByText('Step 1 of 2')).toBeTruthy()
  })

  it('moves to the referrer step, lets you go back, and keeps what you typed', () => {
    render(<ReferralForm />)
    fill('facilityName', 'Lagos General Hospital')
    fill('facilityType', 'clinic')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Step 2 of 2')).toBeTruthy()
    expect(screen.getByText('Lagos General Hospital')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect((document.querySelector('[name="facilityName"]') as HTMLInputElement).value).toBe('Lagos General Hospital')
  })

  it('sends nothing until the referrer step is complete', () => {
    render(<ReferralForm />)
    fill('facilityName', 'Lagos General Hospital')
    fill('facilityType', 'clinic')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send referral' }))
    expect(screen.getByText('Enter your full name.')).toBeTruthy()
    expect(screen.getByText('Confirm the facility knows you are introducing them.')).toBeTruthy()
    expect(submitDemoRequest).not.toHaveBeenCalled()
  })

  it('sends a complete referral and thanks the referrer', async () => {
    render(<ReferralForm />)
    fill('facilityName', 'Lagos General Hospital')
    fill('facilityType', 'clinic')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fill('referrerName', 'Ada Okafor')
    fill('referrerEmail', 'ada@example.test')
    fireEvent.click(screen.getByRole('checkbox', { name: 'The facility knows I am introducing them to Health ID.' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send referral' }))
    expect(await screen.findByText('Thank you. Your referral is in.')).toBeTruthy()
    await waitFor(() => expect(submitDemoRequest).toHaveBeenCalledTimes(1))
    const [body, key] = submitDemoRequest.mock.calls[0]!
    expect(body).toMatchObject({ sourceSection: 'referral', organizationName: 'Lagos General Hospital', productCode: 'general' })
    expect(typeof key).toBe('string')
    fireEvent.click(screen.getByRole('button', { name: 'Refer another facility' }))
    expect(screen.getByText('Step 1 of 2')).toBeTruthy()
  })
})
