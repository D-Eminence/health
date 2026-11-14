/**
 * Money at the point of care (docs/POINT_OF_CARE_SPEC.md): an integer in kobo, shown in naira with two decimals.
 * Health ID records payments; it never moves money.
 */

const NAIRA = new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 1250000 → "₦12,500.00". A negative amount keeps its sign before the ₦: "-₦500.00". */
export function naira(kobo: number): string {
  const safe = Number.isFinite(kobo) ? Math.round(kobo) : 0
  const text = `₦${NAIRA.format(Math.abs(safe) / 100)}`
  return safe < 0 ? `-${text}` : text
}

/**
 * What someone typed as an amount → kobo, or null when it isn't one. Takes "12500", "12,500", "₦12,500.50", "N 500",
 * " 500.5 "; refuses negatives, more than two decimals, letters and empty text.
 */
export function parseNaira(text: string): number | null {
  const cleaned = text.trim().replace(/^(₦|NGN|N)\s*/i, '').replace(/,/g, '').replace(/\s+/g, '')
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(cleaned)) return null
  const [whole = '0', part = ''] = cleaned.split('.')
  const kobo = Number(whole || '0') * 100 + Number((part + '00').slice(0, 2))
  return Number.isSafeInteger(kobo) ? kobo : null
}
