/* ---------------------------------------------------------------------------
 * Bachs.io contract — the first payment gateway (SANDBOX/test mode).
 *
 * Reference: https://docs.bachs.io (sandbox API https://sandbox-api.bachs.io,
 * live https://api.bachs.io; keys prefixed sk_sandbox_ / sk_live_).
 *
 * Bachs has NO client-side public key. The correct architecture is:
 *   1. Your backend creates a Checkout Session with the SECRET key and returns
 *      a `checkoutUrl` (never expose the secret key to the browser).
 *   2. The SPA redirects the customer to that hosted checkout (or opens the
 *      @bachs/js overlay).
 *   3. Bachs redirects back to successUrl/cancelUrl; fulfilment is confirmed
 *      ONLY by the `collection.succeeded` webhook (HMAC-SHA256 signature).
 *
 * This SPA has no backend, so `requestCheckoutSession` calls a configurable
 * backend endpoint (VITE_BACHS_CHECKOUT_ENDPOINT). Without one, the checkout
 * runs the clearly-labelled sandbox simulation instead.
 * ------------------------------------------------------------------------- */

export const BACHS_SANDBOX_API = 'https://sandbox-api.bachs.io'
export const BACHS_API = 'https://api.bachs.io'
export const BACHS_CHECKOUT_ENDPOINT = import.meta.env.VITE_BACHS_CHECKOUT_ENDPOINT as string | undefined

/** Reference is always generated server-side and tied to the order. */
export function createPaymentReference(date = new Date()): string {
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, '')
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let rand = ''
  for (let i = 0; i < 5; i++) rand += alphabet[Math.floor(Math.random() * alphabet.length)]
  return `KORO-ORD-${ymd}-${rand}`
}

export type BachsCheckoutSessionInput = {
  reference: string
  amountNaira: number // Bachs uses decimal strings in major units (e.g. "30000.00")
  currency: 'NGN'
  email: string
  customerName: string
  successUrl: string
  cancelUrl: string
}

/**
 * Asks YOUR backend to create a Bachs checkout session and return its
 * checkoutUrl. The backend calls Bachs `POST /checkout-sessions` with the
 * secret key (see docs.bachs.io) and must never expose that key here.
 */
export async function requestCheckoutSession(input: BachsCheckoutSessionInput): Promise<string> {
  if (!BACHS_CHECKOUT_ENDPOINT) throw new Error('Bachs checkout endpoint is not configured.')
  const res = await fetch(BACHS_CHECKOUT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error('Could not create a Bachs checkout session.')
  const data = (await res.json()) as { checkoutUrl: string }
  if (!data.checkoutUrl) throw new Error('Bachs checkout session returned no URL.')
  return data.checkoutUrl
}

/** Hosted redirect — the simplest Bachs checkout (Option A in their docs). */
export function openHostedCheckout(checkoutUrl: string): void {
  window.location.assign(checkoutUrl)
}

/* ------------------------- Webhook signature --------------------------- */

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Constant-time comparison of X-Bachs-Signature = HMAC-SHA256("{timestamp}.{raw_body}"). */
export async function verifyBachsWebhookSignature(
  rawBody: string,
  timestamp: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const expected = await hmacSha256Hex(`${timestamp}.${rawBody}`, secret)
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  return diff === 0
}

export async function signBachsWebhook(rawBody: string, timestamp: string, secret: string): Promise<string> {
  return hmacSha256Hex(`${timestamp}.${rawBody}`, secret)
}
