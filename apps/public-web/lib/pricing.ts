/**
 * Pricing arithmetic.
 *
 * Kept out of the component because money is worth testing directly: a rounding
 * mistake here is a number a customer reads and holds us to.
 */

import { PRICING } from '@/content/provider'

export type Billing = 'monthly' | 'yearly'

const NAIRA = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 0,
})

export function formatNaira(amount: number): string {
  return NAIRA.format(amount)
}

/** The per-month figure shown for a plan under the selected billing period. */
export function monthlyRate(monthlyNaira: number, billing: Billing): number {
  if (billing === 'monthly') return monthlyNaira
  return Math.round(monthlyNaira * (1 - PRICING.yearlyDiscount))
}

/** What a facility keeps across a year by paying yearly rather than monthly. */
export function annualSaving(monthlyNaira: number): number {
  return Math.round(monthlyNaira * 12 * PRICING.yearlyDiscount)
}

/** Total charged for a year under the selected billing period. */
export function annualTotal(monthlyNaira: number, billing: Billing): number {
  return monthlyRate(monthlyNaira, billing) * 12
}
