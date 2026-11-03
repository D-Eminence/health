import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { EMPTY_REFERRAL, FACILITY_FIELDS, REFERRER_FIELDS, referralMessage, stepErrors, toReferralSubmission, validateReferral, type ReferralRequest } from '../lib/referral'

const submitDemoRequest = vi.hoisted(() => vi.fn())
vi.mock('@/lib/commercial-api', () => ({ submitDemoRequest }))
vi.mock('@/lib/env', () => ({ getEnvironment: () => ({ name: 'local', turnstileSiteKey: '', appOrigin: 'http://localhost:3100' }) }))
vi.mock('@/components/shared/TurnstileWidget', () => ({ TurnstileWidget: () => null }))

import { ReferralForm } from '../components/referral/ReferralForm'
import { focusWhenShown } from './focusWhenShown'

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
      organizationName: 'Lagos General Hospital', organizationType: 'hospital', productCode: 'general', sourcePage: '/earn',
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

  // hid-system answers a field it refuses with 400 VALIDATION_FAILED and the
  // field's name in the problem's `errors` (HidApiError.details). The form used
  // to show only "One or more request fields are invalid." at the bottom.
  const refused = (...fields: string[]) => new HidApiError(400, 'One or more request fields are invalid.', {
    code: 'VALIDATION_FAILED', details: fields.map(field => ({ field, messages: [`${field} is invalid`] })),
  })
  async function sendFilled() {
    fill('facilityName', 'Lagos General Hospital')
    fill('facilityType', 'clinic')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fill('referrerName', 'Ada Okafor')
    fill('referrerEmail', 'ada@example.test')
    fill('referrerPhone', '+234 803 000 0000')
    fireEvent.click(screen.getByRole('checkbox', { name: 'The facility knows I am introducing them to Health ID.' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send referral' }))
    await waitFor(() => expect(submitDemoRequest).toHaveBeenCalledTimes(1))
  }

  it.each([
    ['contactEmail', 'referrerEmail', 'Enter a valid email address.'],
    ['contactPhone', 'referrerPhone', 'Enter a valid phone number.'],
    ['contactName', 'referrerName', 'Enter your full name.'],
  ])('marks and focuses the field hid-system refused (%s)', async (backendField, formField, message) => {
    submitDemoRequest.mockRejectedValueOnce(refused(backendField))
    render(<ReferralForm />)
    await sendFilled()
    expect(await screen.findByText(message)).toBeTruthy()
    const input = document.querySelector(`[name="${formField}"]`)!
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe(`${formField}-error`)
    await waitFor(() => expect(document.activeElement).toBe(input))
    expect(screen.queryByText('One or more request fields are invalid.')).toBeNull()
    expect(screen.queryByText('Thank you. Your referral is in.')).toBeNull()
  })

  it('takes the referrer back to the facility step when hid-system refuses the facility’s name', async () => {
    submitDemoRequest.mockRejectedValueOnce(refused('organizationName'))
    render(<ReferralForm />)
    await sendFilled()
    expect(await screen.findByText('Enter the facility’s name.')).toBeTruthy()
    expect(screen.getByText('Step 1 of 2')).toBeTruthy()
    const input = document.querySelector('[name="facilityName"]')!
    expect(input.getAttribute('aria-invalid')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(input))
  })

  // What follows a sent referral takes focus in the commit that shows it. From an
  // effect, after the request's answer, it took focus a task later, and a check
  // made as soon as it was shown found focus still on the page. Each answer here
  // arrives outside act, as a fetch's does.
  describe('when the answer arrives', () => {
    const environment = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    afterEach(() => { environment.IS_REACT_ACT_ENVIRONMENT = undefined })
    function pending() {
      let resolve!: () => void
      let reject!: (reason: Error) => void
      submitDemoRequest.mockReturnValueOnce(new Promise<void>((done, fail) => { resolve = done; reject = fail }))
      return {
        resolve: () => { environment.IS_REACT_ACT_ENVIRONMENT = false; resolve() },
        reject: (reason: Error) => { environment.IS_REACT_ACT_ENVIRONMENT = false; reject(reason) },
      }
    }

    it('has focus on the thanks as soon as it is shown', async () => {
      const answer = pending()
      render(<ReferralForm />)
      await sendFilled()
      const shown = focusWhenShown(() => screen.queryByRole('heading', { name: 'Thank you. Your referral is in.' }))
      answer.resolve()
      const { element, focused } = await shown
      expect(focused).toBe(element)
    })

    it('has focus on the refused facility’s name as soon as its step is shown', async () => {
      const answer = pending()
      render(<ReferralForm />)
      await sendFilled()
      const shown = focusWhenShown('[name="facilityName"]')
      answer.reject(refused('organizationName'))
      const { element, focused } = await shown
      expect(focused).toBe(element)
    })
  })

  it('says a refused field the referrer did not type in the form’s own words, never the backend’s', async () => {
    submitDemoRequest.mockRejectedValueOnce(refused('sourcePage'))
    render(<ReferralForm />)
    await sendFilled()
    expect(await screen.findByText('Your referral could not be sent. Please try again.')).toBeTruthy()
    expect(screen.queryByText(/request fields|sourcePage/)).toBeNull()
    expect(screen.getByText('Step 2 of 2')).toBeTruthy()
  })
})
