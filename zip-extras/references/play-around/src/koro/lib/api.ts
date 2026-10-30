/* ---------------------------------------------------------------------------
 * API client — calls the serverless routes so the order amount is calculated
 * and validated server-side (the client total is never trusted).
 *
 * When the API isn't reachable (plain `vite dev` without `vercel dev`), the
 * checkout falls back to the local simulation so the prototype stays usable.
 * ------------------------------------------------------------------------- */
import type { CartLine, Contact, DeliveryAddress, Order, Recipient } from './types'

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

let cached: boolean | null = null

/**
 * Probes /api/health once so we know whether the real backend is present.
 * NOTE: a SPA dev server (vite) answers *every* unmatched path with index.html
 * and HTTP 200 — so `res.ok` alone is not enough. We require a JSON response
 * that actually identifies as our API.
 */
export async function apiAvailable(): Promise<boolean> {
  if (cached !== null) return cached
  try {
    const res = await fetch(`${BASE}/api/health`, { headers: { accept: 'application/json' } })
    const type = res.headers.get('content-type') || ''
    if (!res.ok || !type.includes('application/json')) {
      cached = false
      return cached
    }
    const data = (await res.json().catch(() => null)) as { ok?: boolean; service?: string } | null
    cached = Boolean(data?.ok === true && data?.service === 'koro-api')
  } catch {
    cached = false
  }
  return cached
}

function isJson(res: Response): boolean {
  return (res.headers.get('content-type') || '').includes('application/json')
}

export type CreateOrderPayload = {
  accountUserId?: string
  contact: Contact
  recipient: Recipient
  delivery: DeliveryAddress
  lines: CartLine[]
  express?: boolean
  gateway?: 'bachs' | 'flutterwave'
}

/** Creates the order on the server — it re-prices and returns the authoritative total. */
export async function apiCreateOrder(payload: CreateOrderPayload): Promise<Order> {
  const res = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = (isJson(res) ? await res.json().catch(() => ({})) : {}) as {
    order?: Order
    error?: string
    errors?: Record<string, string>
  }
  if (!res.ok || !data.order) {
    const fieldErrors = data.errors ? Object.values(data.errors).join(' ') : ''
    throw new Error(fieldErrors || data.error || 'The server could not create this order.')
  }
  return data.order
}

export type InitResult = { mode: 'redirect' | 'inline'; checkoutUrl?: string }

export async function apiInitPayment(
  orderId: string,
  gateway: 'bachs' | 'flutterwave',
): Promise<InitResult> {
  const res = await fetch(`${BASE}/api/payments/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, gateway, origin: window.location.origin }),
  })
  const data = (await res.json().catch(() => ({}))) as InitResult & { error?: string }
  if (!res.ok) throw new Error(data.error || 'Could not initialize payment.')
  return data
}

export async function apiGetOrder(reference: string): Promise<Order | null> {
  const res = await fetch(`${BASE}/api/orders?reference=${encodeURIComponent(reference)}`)
  if (!res.ok) return null
  const data = (await res.json().catch(() => ({}))) as { order?: Order }
  return data.order ?? null
}

/**
 * Server-side transaction verification (uses the gateway secret key).
 * The client never sees the secret — it only receives the verdict.
 */
export async function apiVerifyPayment(
  gateway: 'flutterwave',
  transactionId: string,
): Promise<{ status: string }> {
  const res = await fetch(`${BASE}/api/payments/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gateway, transactionId }),
  })
  const data = (await res.json().catch(() => ({}))) as { status?: string; error?: string }
  if (!res.ok) throw new Error(data.error || 'Verification failed.')
  return { status: data.status || 'failed' }
}
