import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PricingSection } from '@/components/provider/Pricing'

/** The billing control is a radio group, so it is found by role and label. */
function billingOption(name: RegExp): HTMLInputElement {
  return screen.getByRole('radio', { name }) as HTMLInputElement
}

describe('PricingSection', () => {
  it('opens on monthly billing with the headline rates', () => {
    render(<PricingSection />)

    expect(billingOption(/monthly/i).checked).toBe(true)
    expect(screen.getByText('₦50,000')).toBeDefined()
    expect(screen.getByText('₦75,000')).toBeDefined()
  })

  it('shows no annual saving until yearly billing is chosen', () => {
    render(<PricingSection />)
    expect(screen.queryByText(/save .* annually/i)).toBeNull()
  })

  it('applies the discount to both plans when yearly is chosen', () => {
    render(<PricingSection />)

    billingOption(/yearly/i).click()

    expect(screen.getByText('₦40,000')).toBeDefined()
    expect(screen.getByText('₦60,000')).toBeDefined()
    expect(screen.queryByText('₦50,000')).toBeNull()
  })

  it('states what each plan saves over a year', () => {
    render(<PricingSection />)
    billingOption(/yearly/i).click()

    expect(screen.getByText('Save ₦120,000 annually')).toBeDefined()
    expect(screen.getByText('Save ₦180,000 annually')).toBeDefined()
  })

  it('announces the change politely rather than moving focus', () => {
    const { container } = render(<PricingSection />)
    billingOption(/yearly/i).click()

    const live = container.querySelectorAll('[aria-live="polite"]')
    expect(live.length).toBe(2)
  })

  it('switches back to monthly without leaving stale figures on screen', () => {
    render(<PricingSection />)

    billingOption(/yearly/i).click()
    billingOption(/monthly/i).click()

    expect(screen.getByText('₦50,000')).toBeDefined()
    expect(screen.queryByText('₦40,000')).toBeNull()
    expect(screen.queryByText(/save .* annually/i)).toBeNull()
  })

  it('labels the billing choice for assistive technology', () => {
    render(<PricingSection />)
    expect(screen.getByRole('group', { name: /billing period/i })).toBeDefined()
  })

  it('gives every plan a way to act', () => {
    render(<PricingSection />)
    const actions = screen.getAllByRole('link', { name: /book an ehr demo/i })
    expect(actions.length).toBeGreaterThanOrEqual(2)
  })
})
