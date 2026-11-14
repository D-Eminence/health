import { isHidApiError, plainErrorText } from '@hid/http'

/**
 * Facility billing as specified in docs/BILLING_SPEC.md: a 14-day free trial
 * with no payment details, then a paid plan through Paystack's hosted checkout.
 *
 * hid-system does not serve these routes yet. A 404 or 501 from them means "not
 * available yet", and the portal says so: it never shows a trial, a price or a
 * payment the server did not report. Patients are never billed.
 */

export const TRIAL_DAYS = 14

/** The trial banner appears when this many days or fewer are left. */
export const TRIAL_REMINDER_DAYS = 7

export type SubscriptionStatus = 'none' | 'trialing' | 'active' | 'past_due' | 'read_only' | 'cancelled'

export interface BillingPrice {
  visibility: 'fixed' | 'starting_from' | 'contact_sales' | 'custom_quote'
  amount_minor: number | null
  currency: string
  billing_period: string | null
  unit: string | null
}

export interface Subscription {
  organizationId: string
  productCode: string
  status: SubscriptionStatus
  trialEndsAt: string | null
  currentPeriodEndsAt: string | null
  graceEndsAt: string | null
  price: BillingPrice | null
  selfServePayment: boolean
}

export interface Invoice {
  id: string
  number: string
  issuedAt: string
  amount_minor: number
  currency: string
  status: 'paid' | 'open' | 'void'
}

export interface Checkout {
  authorizationUrl: string
  reference: string
}

/** One read of a billing route. */
export type BillingRead<T> =
  | { kind: 'loading' }
  | { kind: 'ready'; value: T }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }

/** The route is not served yet (hid-system without docs/BILLING_SPEC.md). */
export function isBillingUnavailable(caught: unknown): boolean {
  return isHidApiError(caught) && (caught.status === 404 || caught.status === 501)
}

export function billingProblem(caught: unknown, fallback: string): BillingRead<never> {
  if (isBillingUnavailable(caught)) return { kind: 'unavailable' }
  if (isHidApiError(caught) && caught.status === 403) {
    return { kind: 'error', message: 'Only your facility administrator can manage billing.' }
  }
  return { kind: 'error', message: plainErrorText(caught, fallback, { audience: 'facility' }) }
}

const STATUSES: readonly SubscriptionStatus[] = ['none', 'trialing', 'active', 'past_due', 'read_only', 'cancelled']
const VISIBILITIES: readonly BillingPrice['visibility'][] = ['fixed', 'starting_from', 'contact_sales', 'custom_quote']

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const optionalTime = (value: unknown) => value === null || (typeof value === 'string' && !Number.isNaN(Date.parse(value)))

function readPrice(value: unknown): BillingPrice | null {
  if (value === null) return null
  if (!isObject(value) || !VISIBILITIES.includes(value.visibility as BillingPrice['visibility'])
    || typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency)) throw malformed()
  const amount = value.amount_minor
  const priced = value.visibility === 'fixed' || value.visibility === 'starting_from'
  // An amount only where the catalogue gives one: a quote never becomes a number.
  if (priced ? !(typeof amount === 'number' && Number.isInteger(amount) && amount >= 0) : amount !== null) throw malformed()
  return {
    visibility: value.visibility as BillingPrice['visibility'],
    amount_minor: priced ? amount as number : null,
    currency: value.currency,
    billing_period: typeof value.billing_period === 'string' ? value.billing_period : null,
    unit: typeof value.unit === 'string' ? value.unit : null,
  }
}

function malformed() {
  return new Error('Billing details could not be read. Try again later.')
}

/** Checks the subscription the server answered; anything else is refused rather than guessed at. */
export function readSubscription(value: unknown): Subscription {
  if (!isObject(value) || typeof value.organizationId !== 'string' || typeof value.productCode !== 'string'
    || !STATUSES.includes(value.status as SubscriptionStatus)
    || !optionalTime(value.trialEndsAt) || !optionalTime(value.currentPeriodEndsAt) || !optionalTime(value.graceEndsAt ?? null)) {
    throw malformed()
  }
  if (value.status === 'trialing' && value.trialEndsAt === null) throw malformed()
  return {
    organizationId: value.organizationId,
    productCode: value.productCode,
    status: value.status as SubscriptionStatus,
    trialEndsAt: value.trialEndsAt as string | null,
    currentPeriodEndsAt: value.currentPeriodEndsAt as string | null,
    graceEndsAt: (value.graceEndsAt ?? null) as string | null,
    price: readPrice(value.price ?? null),
    selfServePayment: value.selfServePayment === true,
  }
}

export function readInvoices(value: unknown): Invoice[] {
  if (!isObject(value) || !Array.isArray(value.items)) throw malformed()
  return value.items.map(item => {
    if (!isObject(item) || typeof item.id !== 'string' || typeof item.number !== 'string'
      || typeof item.issuedAt !== 'string' || typeof item.amount_minor !== 'number'
      || typeof item.currency !== 'string' || !['paid', 'open', 'void'].includes(item.status as string)) throw malformed()
    return item as unknown as Invoice
  })
}

/** Only Paystack's own hosted checkout is opened; any other address is refused. */
export function paystackCheckoutUrl(value: unknown): string | null {
  if (!isObject(value) || typeof value.authorizationUrl !== 'string') return null
  try {
    const url = new URL(value.authorizationUrl)
    return url.protocol === 'https:' && url.hostname === 'checkout.paystack.com' && !url.username && !url.password
      ? url.href : null
  } catch { return null }
}

export function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amountMinor / 100)
}

const PERIODS: Record<string, string> = { month: 'per month', monthly: 'per month', year: 'per year', yearly: 'per year', annual: 'per year' }

/** The price as the catalogue states it: an amount only where one is given. */
export function formatPrice(price: BillingPrice | null): string | null {
  if (!price) return null
  if (price.visibility === 'contact_sales') return 'Contact sales for pricing'
  if (price.visibility === 'custom_quote') return 'Priced by quote'
  if (price.amount_minor === null) return null
  const amount = formatMoney(price.amount_minor, price.currency)
  const period = price.billing_period ? PERIODS[price.billing_period] ?? `per ${price.billing_period}` : ''
  const unit = price.unit ? ` ${price.unit}` : ''
  return `${price.visibility === 'starting_from' ? 'From ' : ''}${amount}${unit}${period ? ` ${period}` : ''}`
}

/** Whole days left until `end`, never below zero. */
export function daysLeft(end: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(end) - now) / 86_400_000))
}

export function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date unavailable'
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Whether "Pay now" applies: a self-serve price on a plan that is not already paid up. */
export function canPayNow(subscription: Subscription): boolean {
  return subscription.selfServePayment && subscription.status !== 'active' && subscription.status !== 'cancelled'
}

/**
 * What the workspace banner says, or null for none: a trial in its last days,
 * a payment due, or a facility that has become read-only.
 */
export function billingNotice(subscription: Subscription, now = Date.now()): { tone: 'warning' | 'danger'; text: string } | null {
  if (subscription.status === 'read_only') {
    return { tone: 'danger', text: 'Your facility is read-only because its plan is not paid. Staff can view records but cannot add or change them.' }
  }
  if (subscription.status === 'past_due') {
    const end = subscription.graceEndsAt
    return { tone: 'danger', text: end ? `Your payment is due. Pay by ${formatDate(end)} to keep full access.` : 'Your payment is due. Pay now to keep full access.' }
  }
  if (subscription.status === 'trialing' && subscription.trialEndsAt) {
    const days = daysLeft(subscription.trialEndsAt, now)
    if (days > TRIAL_REMINDER_DAYS) return null
    return { tone: 'warning', text: days === 0 ? 'Your free trial ends today.' : `Your free trial ends in ${days} ${days === 1 ? 'day' : 'days'}.` }
  }
  return null
}

/** Picks the catalogue price for a product, preferring the row for this kind of facility. */
export function catalogPrice(rows: unknown, productCode: string, organizationType?: string): BillingPrice | null {
  // The HTTP client unwraps `{ data }`; a raw response is read too.
  const data: unknown[] = Array.isArray(rows) ? rows : isObject(rows) && Array.isArray(rows.data) ? rows.data : []
  const forProduct = data.filter(row => isObject(row) && row.product_slug === productCode && row.visibility !== 'hidden')
  const row = forProduct.find(item => isObject(item) && item.context === organizationType) ?? forProduct[0]
  try { return row ? readPrice(row) : null } catch { return null }
}
