import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient, PlainError } from '@hid/http'
import { getEnvironment } from './env'

export type ProductCode = 'identity' | 'ehr' | 'laboratory' | 'pharmacy' | 'migrate' | 'outreach' | 'api' | 'general'

export interface PublicPrice {
  product_slug: Exclude<ProductCode, 'general'>
  context: string
  visibility: 'fixed' | 'starting_from' | 'contact_sales' | 'custom_quote'
  amount_minor: number | null
  currency: string
  billing_period: string | null
  unit: string | null
}

export interface DemoSubmission {
  contactName: string
  contactEmail: string
  productCode: Exclude<ProductCode, 'identity'>
  contactPhone?: string
  contactRole?: string
  organizationName?: string
  /** hid-system's CreateDemoRequestDto.organizationType values. */
  organizationType?: 'clinic' | 'hospital' | 'laboratory' | 'pharmacy' | 'other'
  message?: string
  sourcePage?: string
  sourceSection?: string
  ctaLabel?: string
  turnstileAction: 'book-demo'
  turnstileToken: string
}

function publicClient() {
  return createRegisteredBrowserClient(createApiClient({
    baseUrl: getEnvironment().apiBaseUrl,
    clientId: 'public-web',
    sessionMode: 'cookie',
  }), 'public-web')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The products the site presents prices for, keyed by the slug type that
 * Pricing.tsx names, so a product added to one fails typecheck until both list it.
 */
const PRICED_PRODUCTS: Readonly<Record<PublicPrice['product_slug'], true>> = {
  identity: true, ehr: true, laboratory: true, pharmacy: true, migrate: true, outreach: true, api: true,
}

function isPricedProduct(slug: string): slug is PublicPrice['product_slug'] {
  return Object.hasOwn(PRICED_PRODUCTS, slug)
}

/**
 * The backend starts with quote prices. A missing or null amount is never guessed.
 * A malformed row refuses the whole catalogue. A well-formed row for a product
 * this site does not present (one a later migration added) is left out, so it
 * cannot hide the prices of the products the site does present.
 */
export function parsePublicPrices(value: unknown): PublicPrice[] {
  if (!isObject(value) || !Array.isArray(value.data)) throw new PlainError('Pricing is temporarily unavailable.')
  return value.data.flatMap((item: unknown) => {
    if (!isObject(item) || typeof item.product_slug !== 'string'
      || typeof item.context !== 'string' || typeof item.visibility !== 'string'
      || typeof item.currency !== 'string' || !/^[A-Z]{3}$/.test(item.currency)
      || !['fixed', 'starting_from', 'contact_sales', 'custom_quote'].includes(item.visibility)
      || !(item.amount_minor === null || (Number.isSafeInteger(item.amount_minor) && Number(item.amount_minor) >= 0))
      || !(item.billing_period === null || typeof item.billing_period === 'string')
      || !(item.unit === null || typeof item.unit === 'string')) {
      throw new PlainError('Pricing is temporarily unavailable.')
    }
    if (['fixed', 'starting_from'].includes(item.visibility) !== (item.amount_minor !== null)) {
      throw new PlainError('Pricing is temporarily unavailable.')
    }
    return isPricedProduct(item.product_slug) ? [item as unknown as PublicPrice] : []
  })
}

export async function readPublicPrices(signal?: AbortSignal): Promise<PublicPrice[]> {
  const payload = await publicClient().request<unknown>({
    method: 'GET', path: '/api/v1/commercial/pricing', auth: 'none', signal,
  })
  return parsePublicPrices(payload)
}

export function formatPublicPrice(price: PublicPrice): string {
  if (price.visibility === 'contact_sales') return 'Contact sales'
  if (price.visibility === 'custom_quote') return 'Custom quote'
  if (price.amount_minor === null) return 'Contact sales'
  const amount = new Intl.NumberFormat('en-NG', {
    style: 'currency', currency: price.currency, maximumFractionDigits: 2,
  }).format(price.amount_minor / 100)
  return price.visibility === 'starting_from' ? `From ${amount}` : amount
}

export async function submitDemoRequest(body: DemoSubmission, idempotencyKey: string): Promise<void> {
  const payload = await publicClient().request<unknown>({
    method: 'POST', path: '/api/v1/commercial/demo-requests', auth: 'none', body,
    headers: { 'Idempotency-Key': idempotencyKey },
  })
  if (!isObject(payload) || payload.accepted !== true) {
    throw new PlainError('The request could not be confirmed. Please try again.')
  }
}
