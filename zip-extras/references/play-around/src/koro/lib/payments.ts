/* ---------------------------------------------------------------------------
 * Payment orchestration — abstracts Bachs.io and Flutterwave and owns the
 * order/payment state machine + idempotent webhook handling.
 *
 * HONEST ARCHITECTURE NOTE: this is a Vite single-page app with no server.
 * Flutterwave's inline checkout works client-side with a public key; Bachs.io
 * requires a server-created checkout session (secret key) returning a
 * checkoutUrl, which this SPA fetches from a configurable backend endpoint.
 * Server-side *verification* is simulated here and clearly marked — a
 * production backend replaces `settlePayment`/`verifyPayment` with API routes
 * that call the gateway verify endpoints using the secret keys.
 * ------------------------------------------------------------------------- */
import { openHostedCheckout, signBachsWebhook, verifyBachsWebhookSignature } from './bachs'
import { apiAvailable, apiInitPayment, apiVerifyPayment } from './api'
import { adjustStock, delay, findOrderByReference, getOrder, upsertOrder } from './db'
import { openFlutterwaveInline } from './flutterwave'
import type { Order } from './types'

/** DEMO ONLY. Production reads BACHS_WEBHOOK_SECRET server-side. */
export const DEMO_WEBHOOK_SECRET = 'koro-demo-webhook-secret'

export type GatewayId = 'bachs' | 'flutterwave'
export type PaymentResult = 'success' | 'failed' | 'processing'

type WebhookData = {
  reference: string
  status: 'success' | 'failed' | 'processing'
  amount: number // naira (major units)
  currency: string
  paid_at?: string
  transaction_id?: string
}

/* ------------------------------ Webhook ------------------------------- */

export async function handleWebhook(rawBody: string, timestamp: string, signature: string): Promise<Order> {
  const valid = await verifyBachsWebhookSignature(rawBody, timestamp, signature, DEMO_WEBHOOK_SECRET)
  if (!valid) throw new Error('Webhook signature validation failed.')

  const event = JSON.parse(rawBody) as { data: WebhookData }
  const { reference, status, amount, currency, paid_at, transaction_id } = event.data

  const order = findOrderByReference(reference)
  if (!order) throw new Error('Unknown payment reference.')

  // Idempotency — never process a terminal payment twice.
  if (order.payment.status === 'successful') return order

  // Authoritative amount + currency validation.
  if (currency !== 'NGN') throw new Error('Currency mismatch.')
  if (amount !== order.total) throw new Error('Amount mismatch.')

  const now = new Date().toISOString()

  if (status === 'success') {
    for (const it of order.items) adjustStock(it.productId, -it.quantity)
    const updated: Order = {
      ...order,
      status: 'paid',
      payment: {
        ...order.payment,
        status: 'successful',
        providerTransactionId: transaction_id ?? `bachs_${reference}`,
        paidAt: paid_at ?? now,
        updatedAt: now,
      },
      updatedAt: now,
    }
    upsertOrder(updated)
    return updated
  }

  if (status === 'failed') {
    const updated: Order = {
      ...order,
      status: 'pending_payment',
      payment: { ...order.payment, status: 'failed', updatedAt: now },
      updatedAt: now,
    }
    upsertOrder(updated)
    return updated
  }

  const updated: Order = {
    ...order,
    payment: { ...order.payment, status: 'processing', updatedAt: now },
    updatedAt: now,
  }
  upsertOrder(updated)
  return updated
}

/**
 * Simulates the gateway → server webhook (signed, idempotent). In production the
 * gateway sends this to the backend; here the client forwards the gateway result
 * to this simulated server so the full validation path still runs.
 */
export async function settlePayment(orderId: string, result: PaymentResult): Promise<Order> {
  const order = getOrder(orderId)
  if (!order) throw new Error('Order not found.')
  if (order.payment.status === 'successful') return order

  const status = result === 'success' ? 'success' : result === 'failed' ? 'failed' : 'processing'
  const data: WebhookData = {
    reference: order.payment.reference,
    status,
    amount: order.total,
    currency: 'NGN',
    paid_at: result === 'success' ? new Date().toISOString() : undefined,
    transaction_id: result === 'success' ? `bachs_${Date.now()}` : undefined,
  }
  const body = JSON.stringify({ event: status === 'success' ? 'collection.succeeded' : 'collection.failed', data })
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = await signBachsWebhook(body, timestamp, DEMO_WEBHOOK_SECRET)
  return handleWebhook(body, timestamp, signature)
}

/* ---------------------- Gateway initiation (real) ---------------------- */

export async function openGatewayPayment(
  gateway: GatewayId,
  order: Order,
  onResult: (result: PaymentResult | 'cancelled') => void,
): Promise<void> {
  if (gateway === 'bachs') {
    // Server creates the checkout session with the secret key and returns its URL.
    const { checkoutUrl } = await apiInitPayment(order.id, 'bachs')
    if (!checkoutUrl) throw new Error('Bachs returned no checkout URL.')
    // Hosted redirect — the customer completes payment on checkout.bachs.io and
    // is redirected back; fulfilment is confirmed by the collection.succeeded webhook.
    openHostedCheckout(checkoutUrl)
    return
  }

  await openFlutterwaveInline({
    email: order.contact.email,
    amountNaira: order.total,
    reference: order.payment.reference,
    onSuccess: async (res) => {
      if (res.status !== 'successful') {
        onResult(res.status === 'failed' ? 'failed' : 'cancelled')
        return
      }
      // Never trust the client-side callback: verify with Flutterwave's API
      // (secret key, server-side) before treating the order as paid.
      if (res.transaction_id && (await apiAvailable())) {
        try {
          const verified = await apiVerifyPayment('flutterwave', String(res.transaction_id))
          onResult(verified.status === 'successful' ? 'success' : 'failed')
        } catch {
          onResult('failed')
        }
        return
      }
      onResult('success') // no backend available — demo fallback
    },
    onClose: () => onResult('cancelled'),
  })
}

/* ---------------------- Verification (simulated) ---------------------- */

/**
 * Server-side verification. In production this calls the gateway verify
 * endpoint (Flutterwave GET /v3/transactions/{id}/verify; Bachs is confirmed
 * by the collection.succeeded webhook). Here it resolves the order's stored
 * payment state after realistic latency.
 */
export async function verifyPayment(reference: string): Promise<Order> {
  await delay(700)
  const order = findOrderByReference(reference)
  if (!order) throw new Error('Order not found.')
  return order
}

/** Retry reuses the existing pending order — never creates a duplicate. */
export function resetPaymentForRetry(orderId: string): Order {
  const order = getOrder(orderId)
  if (!order) throw new Error('Order not found.')
  if (order.status !== 'pending_payment') return order
  const now = new Date().toISOString()
  const updated: Order = {
    ...order,
    payment: { ...order.payment, status: 'pending', updatedAt: now },
    updatedAt: now,
  }
  upsertOrder(updated)
  return updated
}
