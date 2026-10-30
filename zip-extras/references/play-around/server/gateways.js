// server/gateways.js — Bachs.io and Flutterwave server-side integration.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { PRODUCT, getMeta, setMeta } from './lib.js'

export const BACHS_API_BASE = process.env.BACHS_API_BASE || 'https://sandbox-api.bachs.io'
export const FLUTTERWAVE_API_BASE = process.env.FLUTTERWAVE_API_BASE || 'https://api.flutterwave.com/v3'

/* ------------------------------- Bachs.io ------------------------------- */

function bachsHeaders(secret, idempotencyKey) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  return headers
}

/**
 * Resolves the Bachs product id for our catalog item: an explicit
 * BACHS_PRODUCT_ID wins, otherwise the id is cached, otherwise the product is
 * created once via POST /v1/products (Idempotency-Key keeps that safe).
 */
export async function ensureBachsProduct() {
  if (process.env.BACHS_PRODUCT_ID) return process.env.BACHS_PRODUCT_ID
  const cached = getMeta('bachs_product_id')
  if (cached) return cached

  const secret = process.env.BACHS_SECRET_KEY
  if (!secret) throw new Error('BACHS_SECRET_KEY is not configured.')

  const res = await fetch(`${BACHS_API_BASE}/v1/products`, {
    method: 'POST',
    headers: bachsHeaders(secret, `koro-product-${PRODUCT.id}`),
    body: JSON.stringify({
      name: PRODUCT.name,
      // Money is a decimal string in major units — never minor units.
      price: { currency: 'NGN', price_type: 'fixed', amount: PRODUCT.price.toFixed(2) },
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Bachs product creation failed (${res.status}): ${text}`)
  const data = JSON.parse(text)
  const id = data.id || data.product_id
  if (!id) throw new Error('Bachs returned no product id.')
  setMeta('bachs_product_id', id)
  return id
}

/**
 * Creates a Bachs checkout session and returns its checkoutUrl.
 * Endpoint confirmed: POST /v1/checkout-sessions (docs.bachs.io).
 *
 * The cart item carries an ad-hoc `pricing` override so the checkout charges
 * our server-calculated order total (product + delivery), not just the catalog
 * price — the client can never influence this number.
 */
export async function createBachsCheckoutSession(order, { successUrl, cancelUrl }) {
  const secret = process.env.BACHS_SECRET_KEY
  if (!secret) throw new Error('BACHS_SECRET_KEY is not configured.')

  const productId = await ensureBachsProduct()
  const checkoutPath = process.env.BACHS_CHECKOUT_PATH || '/v1/checkout-sessions'
  const quantity = order.items.reduce((n, it) => n + it.quantity, 0)

  const res = await fetch(`${BACHS_API_BASE}${checkoutPath}`, {
    method: 'POST',
    headers: bachsHeaders(secret, `session-${order.reference}`),
    body: JSON.stringify({
      product_cart: [
        {
          product_id: productId,
          quantity,
          pricing: { currency: 'NGN', price_type: 'fixed', amount: Number(order.total).toFixed(2) },
        },
      ],
      customer: { email: order.contact?.email, name: order.contact?.name },
      success_url: successUrl,
      cancel_url: cancelUrl,
    }),
  })

  const text = await res.text()
  if (!res.ok) throw new Error(`Bachs checkout creation failed (${res.status}): ${text}`)
  return JSON.parse(text) // expect { checkout_url, checkout_id }
}

/** Verifies X-Bachs-Signature = HMAC-SHA256("{timestamp}.{raw_body}"). */
export function verifyBachsWebhook(rawBody, timestamp, signature, secret) {
  if (!secret || !timestamp || !signature) return false
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}

/* ------------------------------ Flutterwave ----------------------------- */

/** Verifies a Flutterwave transaction server-side. */
export async function verifyFlutterwaveTransaction(transactionId) {
  const secret = process.env.FLUTTERWAVE_SECRET_KEY
  if (!secret) throw new Error('FLUTTERWAVE_SECRET_KEY is not configured.')
  const res = await fetch(
    `${FLUTTERWAVE_API_BASE}/transactions/${encodeURIComponent(transactionId)}/verify`,
    { headers: { Authorization: `Bearer ${secret}` } },
  )
  return res.json() // { status, data: { status, amount, currency, tx_ref } }
}

/** Flutterwave webhook authenticity via the `verif-hash` header. */
export function verifyFlutterwaveWebhook(hashHeader) {
  const secret = process.env.FLUTTERWAVE_ENCRYPTION_KEY
  return Boolean(secret && hashHeader && hashHeader === secret)
}
