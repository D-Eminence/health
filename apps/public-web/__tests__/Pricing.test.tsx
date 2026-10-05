import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PricingSection } from '@/components/provider/Pricing'
import { readPublicPrices } from '@/lib/commercial-api'

vi.mock('@/lib/commercial-api', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  readPublicPrices: vi.fn(),
}))

const read = vi.mocked(readPublicPrices)

beforeEach(() => read.mockReset())

describe('PricingSection', () => {
  it('shows the backend quote rather than a historic static plan amount', async () => {
    read.mockResolvedValue([{ product_slug: 'ehr', context: 'core', visibility: 'contact_sales',
      amount_minor: null, currency: 'NGN', billing_period: null, unit: null }])
    render(<PricingSection />)

    expect(await screen.findByText('Contact sales')).toBeDefined()
    expect(screen.getByText('Health ID EHR')).toBeDefined()
    expect(screen.queryByText('₦50,000')).toBeNull()
    expect(screen.getByRole('link', { name: 'Setup Your Facility' }).getAttribute('href'))
      .toBe('/provider/apply?product=ehr')
  })

  it('offers a retry when pricing cannot be loaded', async () => {
    read.mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([{ product_slug: 'migrate', context: 'standalone', visibility: 'custom_quote',
        amount_minor: null, currency: 'NGN', billing_period: null, unit: null }])
    render(<PricingSection />)

    expect(await screen.findByRole('alert')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Custom quote')).toBeDefined()
  })

  it('preserves the API demo action while routing facility products to applications', async () => {
    read.mockResolvedValue([
      { product_slug: 'api', context: 'standalone', visibility: 'custom_quote',
        amount_minor: null, currency: 'NGN', billing_period: null, unit: null },
      { product_slug: 'pharmacy', context: 'standalone', visibility: 'custom_quote',
        amount_minor: null, currency: 'NGN', billing_period: null, unit: null },
    ])
    render(<PricingSection />)
    expect((await screen.findByRole('link', { name: 'Book a demo' })).getAttribute('href')).toBe('#demo')
    expect(screen.getByRole('link', { name: 'Setup Your Facility' }).getAttribute('href'))
      .toBe('/provider/apply?product=pharmacy')
  })
})
