/* ---------------------------------------------------------------------------
 * Data access layer (simulated backend).
 *
 * This project is a Vite single-page app with no server process, so the
 * "database" is localStorage-backed persistence behind the same function
 * signatures a real API/database layer would expose. Swapping this file for
 * fetch()/Supabase calls does not change any call site.
 * ------------------------------------------------------------------------- */
import { PRODUCTS } from './products'
import type { Order, OrderStatus, Payment } from './types'

const ORDERS_KEY = 'koro.orders.v1'
const STOCK_KEY = 'koro.stock.v1'
const COUNTER_KEY = 'koro.order.counter.v1'

/** Simulated network latency so loading states are exercised honestly. */
export function delay(ms = 400): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full / unavailable — ignore */
  }
}

export function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/* ------------------------------- Orders -------------------------------- */

export function listOrders(): Order[] {
  return read<Order[]>(ORDERS_KEY, [])
}

export function getOrder(id: string): Order | undefined {
  return listOrders().find((o) => o.id === id)
}

export function getOrderByNumber(orderNumber: string): Order | undefined {
  return listOrders().find((o) => o.orderNumber === orderNumber)
}

export function getPaymentByReference(reference: string): Payment | undefined {
  return findOrderByReference(reference)?.payment
}

export function findOrderByReference(reference: string): Order | undefined {
  return listOrders().find((o) => o.payment.reference === reference)
}

export function upsertOrder(order: Order): void {
  const orders = listOrders()
  const idx = orders.findIndex((o) => o.id === order.id)
  if (idx >= 0) orders[idx] = order
  else orders.unshift(order)
  write(ORDERS_KEY, orders)
}

export function updateOrderStatus(orderId: string, status: OrderStatus): Order | undefined {
  const order = getOrder(orderId)
  if (!order) return undefined
  const updated: Order = { ...order, status, updatedAt: new Date().toISOString() }
  upsertOrder(updated)
  return updated
}

/** Marks an order as paid (simulated successful payment for this prototype). */
export function markOrderPaid(orderId: string): Order | undefined {
  const order = getOrder(orderId)
  if (!order) return undefined
  const now = new Date().toISOString()
  const updated: Order = {
    ...order,
    status: 'paid',
    payment: { ...order.payment, status: 'successful', paidAt: now, updatedAt: now },
    updatedAt: now,
  }
  upsertOrder(updated)
  return updated
}

/** Records which gateway the customer chose for this order's payment. */
export function setPaymentProvider(orderId: string, provider: 'bachs' | 'flutterwave'): Order | undefined {
  const order = getOrder(orderId)
  if (!order) return undefined
  const now = new Date().toISOString()
  const updated: Order = {
    ...order,
    payment: { ...order.payment, provider, updatedAt: now },
    updatedAt: now,
  }
  upsertOrder(updated)
  return updated
}

/* --------------------------- Order numbers ----------------------------- */

export function nextOrderNumber(): string {
  const n = read<number>(COUNTER_KEY, 10480) + 1
  write(COUNTER_KEY, n)
  return `KORO-${n}`
}

/* ------------------------------- Stock --------------------------------- */

/** Live stock, honoring any purchases already decremented. */
export function effectiveStock(productId: string): number {
  const overrides = read<Record<string, number>>(STOCK_KEY, {})
  if (productId in overrides) return overrides[productId]!
  return PRODUCTS.find((p) => p.id === productId)?.stockQuantity ?? 0
}

/** Positive delta restocks, negative delta decrements. Persisted. */
export function adjustStock(productId: string, delta: number): void {
  const overrides = read<Record<string, number>>(STOCK_KEY, {})
  overrides[productId] = effectiveStock(productId) + delta
  write(STOCK_KEY, overrides)
}
