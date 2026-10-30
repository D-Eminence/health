const naira = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/** Format a whole-Naira amount as ₦185,000. */
export function formatNaira(amount: number): string {
  return naira.format(Math.round(amount))
}

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Format a USD amount as $13,814.08. */
export function formatUsd(amount: number): string {
  return usd.format(amount)
}

/** Percentages are stored as fractions (0.10 = 10%). */
export function formatDiscountPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`
}
