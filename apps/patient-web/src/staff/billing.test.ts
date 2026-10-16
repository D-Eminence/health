import { describe, expect, it } from 'vitest'
import { HidApiError } from '@hid/http'
import { billingNotice, catalogPrice, daysLeft, formatPrice, isBillingUnavailable, paystackCheckoutUrl, readSubscription } from './billing'

const BASE = {
  organizationId: 'org-1', productCode: 'ehr', status: 'trialing', trialEndsAt: '2026-10-30T00:00:00Z',
  currentPeriodEndsAt: null, graceEndsAt: null, selfServePayment: true,
  price: { visibility: 'fixed', amount_minor: 2_500_000, currency: 'NGN', billing_period: 'month', unit: null },
}

describe('billing rules', () => {
  it('treats an unserved route as not available, and nothing else', () => {
    expect(isBillingUnavailable(new HidApiError(404, 'Not found'))).toBe(true)
    expect(isBillingUnavailable(new HidApiError(501, 'Not implemented'))).toBe(true)
    expect(isBillingUnavailable(new HidApiError(403, 'Forbidden'))).toBe(false)
    expect(isBillingUnavailable(new Error('network'))).toBe(false)
  })

  it('refuses a subscription it cannot read rather than guessing', () => {
    expect(readSubscription(BASE).status).toBe('trialing')
    expect(() => readSubscription({ ...BASE, status: 'free' })).toThrow()
    expect(() => readSubscription({ ...BASE, trialEndsAt: null })).toThrow()
    // A quote price never carries an amount, and a fixed price always does.
    expect(() => readSubscription({ ...BASE, price: { ...BASE.price, visibility: 'custom_quote' } })).toThrow()
    expect(() => readSubscription({ ...BASE, price: { ...BASE.price, amount_minor: null } })).toThrow()
  })

  it('opens Paystack checkout only', () => {
    expect(paystackCheckoutUrl({ authorizationUrl: 'https://checkout.paystack.com/abc' })).toBe('https://checkout.paystack.com/abc')
    expect(paystackCheckoutUrl({ authorizationUrl: 'http://checkout.paystack.com/abc' })).toBeNull()
    expect(paystackCheckoutUrl({ authorizationUrl: 'https://checkout.paystack.com.evil.test/abc' })).toBeNull()
    expect(paystackCheckoutUrl({ authorizationUrl: 'https://user@checkout.paystack.com/abc' })).toBeNull()
    expect(paystackCheckoutUrl({ authorizationUrl: 'javascript:alert(1)' })).toBeNull()
    expect(paystackCheckoutUrl({})).toBeNull()
  })

  it('states prices as the catalogue does', () => {
    expect(formatPrice({ visibility: 'starting_from', amount_minor: 1_000_000, currency: 'NGN', billing_period: 'month', unit: null })).toMatch(/^From .*10,000\.00 per month$/)
    expect(formatPrice({ visibility: 'contact_sales', amount_minor: null, currency: 'NGN', billing_period: null, unit: null })).toBe('Contact sales for pricing')
    expect(formatPrice(null)).toBeNull()
  })

  it('counts trial days and warns only near the end', () => {
    const now = Date.parse('2026-10-20T12:00:00Z')
    expect(daysLeft('2026-10-30T00:00:00Z', now)).toBe(10)
    expect(daysLeft('2026-10-01T00:00:00Z', now)).toBe(0)
    expect(billingNotice(readSubscription(BASE), now)).toBeNull()
    expect(billingNotice(readSubscription({ ...BASE, trialEndsAt: '2026-10-22T00:00:00Z' }), now)?.text).toBe('Your free trial ends in 2 days.')
    expect(billingNotice(readSubscription({ ...BASE, status: 'read_only', trialEndsAt: null }), now)?.tone).toBe('danger')
  })

  it('prefers the catalogue row for the kind of facility', () => {
    const rows = { data: [
      { product_slug: 'ehr', context: 'clinic', visibility: 'fixed', amount_minor: 1_000_000, currency: 'NGN', billing_period: 'month', unit: null },
      { product_slug: 'ehr', context: 'hospital', visibility: 'fixed', amount_minor: 5_000_000, currency: 'NGN', billing_period: 'month', unit: null },
      { product_slug: 'lab', context: 'hospital', visibility: 'hidden', amount_minor: null, currency: 'NGN', billing_period: null, unit: null },
    ] }
    expect(catalogPrice(rows, 'ehr', 'hospital')?.amount_minor).toBe(5_000_000)
    expect(catalogPrice(rows, 'ehr', 'pharmacy')?.amount_minor).toBe(1_000_000)
    expect(catalogPrice(rows, 'lab', 'hospital')).toBeNull()
  })
})
