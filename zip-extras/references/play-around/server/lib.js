// server/lib.js — shared store, catalog, reference, and helpers (Node ESM).
// NOTE: this is a JSON file store for the prototype. It works locally with
// `vercel dev`; on deployed Vercel the filesystem is ephemeral, so swap this
// module for Vercel KV/Postgres in production (the call sites won't change).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const STORE_PATH = process.env.KORO_STORE_PATH || join(tmpdir(), 'koro-store.json')

function read() {
  try {
    if (!existsSync(STORE_PATH)) return { orders: [], seq: 10480 }
    return JSON.parse(readFileSync(STORE_PATH, 'utf8'))
  } catch {
    return { orders: [], seq: 10480 }
  }
}

function write(data) {
  writeFileSync(STORE_PATH, JSON.stringify(data, null, 2))
}

export function listOrders() {
  return read().orders
}

export function getOrder(id) {
  return listOrders().find((o) => o.id === id)
}

export function getOrderByReference(reference) {
  return listOrders().find((o) => o.payment?.reference === reference)
}

export function saveOrder(order) {
  const data = read()
  const i = data.orders.findIndex((o) => o.id === order.id)
  if (i >= 0) data.orders[i] = order
  else data.orders.unshift(order)
  write(data)
  return order
}

export function nextOrderNumber() {
  const data = read()
  data.seq += 1
  write(data)
  return `KORO-${data.seq}`
}

/** Small key/value cache (e.g. the auto-created Bachs product id). */
export function getMeta(key) {
  return read().meta?.[key] ?? null
}

export function setMeta(key, value) {
  const data = read()
  data.meta = { ...(data.meta || {}), [key]: value }
  write(data)
  return value
}

export function createReference(date = new Date()) {
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, '')
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let rand = ''
  for (let i = 0; i < 5; i++) rand += alphabet[Math.floor(Math.random() * alphabet.length)]
  return `KORO-ORD-${ymd}-${rand}`
}

/* ------------------------- Authoritative catalog ------------------------- */

const IMG = 'https://images.unsplash.com/'
const q = '?auto=format&fit=crop&w=900&q=80'

/** Server-side catalog — authoritative prices (the client's are never trusted). */
export const PRODUCTS = {
  p1: { name: 'Premium Cotton Shirt', price: 25000, imageUrl: `${IMG}photo-1521572163474-6864f9cf17ab${q}` },
  p2: { name: 'Minimal Leather Sneakers', price: 95000, imageUrl: `${IMG}photo-1542291026-7eec264c27ff${q}` },
  p3: { name: 'Wireless Noise-Cancelling Headphones', price: 185000, imageUrl: `${IMG}photo-1505740420928-5e560c06d30e${q}` },
  p4: { name: 'Smart Watch Pro', price: 98000, imageUrl: `${IMG}photo-1523275335684-37898b6baf30${q}` },
  p5: { name: 'Portable Bluetooth Speaker', price: 64500, imageUrl: `${IMG}photo-1608043152269-423dbba4e7e1${q}` },
  p6: { name: 'Daily Skincare Set', price: 58000, imageUrl: `${IMG}photo-1556228720-195a672e8a03${q}` },
  p7: { name: 'Body Care Essentials', price: 24000, imageUrl: `${IMG}photo-1608571423902-eed4a5ad8108${q}` },
  p8: { name: 'Single-Origin Cocoa Box', price: 18000, imageUrl: `${IMG}photo-1511381939415-e44015466834${q}` },
  p9: { name: 'Cold-Pressed Palm Oil 2L', price: 12500, imageUrl: `${IMG}photo-1474979266404-7eaacbcd87c5${q}` },
  p10: { name: 'Ceramic Table Lamp', price: 54000, imageUrl: `${IMG}photo-1507473885765-e6ed057f782c${q}` },
  p11: { name: 'Portable Blender', price: 36000, imageUrl: `${IMG}photo-1570222094114-d054a817e56b${q}` },
  p12: { name: 'Studio Product Photography', price: 45000, imageUrl: `${IMG}photo-1520390138845-fd2d229dd553${q}` },
}

/** The catalog product used as the Bachs checkout container (ad-hoc pricing sets the amount). */
export const PRODUCT = { id: 'p1', slug: 'premium-cotton-shirt', ...PRODUCTS.p1 }

export function productById(id) {
  const p = PRODUCTS[id]
  return p ? { id, ...p } : null
}

export function deliveryFeeFor(state, express = false) {
  const base = String(state || '').trim().toLowerCase() === 'lagos' ? 5000 : 8000
  return base + (express ? 4000 : 0)
}

/* ------------------------------ Transitions ------------------------------ */

/** Idempotent payment transition. Returns the updated order or null. */
export function transitionOrder(reference, status, transactionId) {
  const order = getOrderByReference(reference)
  if (!order) return null
  if (order.payment.status === 'successful') return order // never reprocess
  order.payment.status = status
  if (status === 'successful') {
    order.status = 'paid'
    order.payment.paidAt = new Date().toISOString()
    order.payment.transactionId = transactionId || null
  }
  if (status === 'failed') {
    order.status = 'pending_payment'
  }
  order.updatedAt = new Date().toISOString()
  return saveOrder(order)
}

/* ------------------------------ HTTP helpers ----------------------------- */

/**
 * Vercel's Node runtime may hand the handler an already-parsed `req.body` and a
 * consumed stream, while `vercel dev` and plain Node servers hand over the raw
 * stream. Reading only the stream hangs on the former; reading only `req.body`
 * breaks the latter. So: prefer a pre-parsed body when one exists, otherwise
 * drain the stream. Every route therefore works under either behaviour.
 */
function bodyFromBufferOrString(body) {
  if (Buffer.isBuffer(body)) return body.toString('utf8')
  if (typeof body === 'string') return body
  return null
}

function drain(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 1e6) req.destroy()
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

/** Reads the request body and parses it as JSON. */
export async function readJson(req) {
  // Already parsed by the platform: an object (or a JSON string/Buffer).
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body
  const raw = bodyFromBufferOrString(req.body) ?? (await drain(req))
  if (!raw) return {}
  return JSON.parse(raw)
}

export function json(res, status, payload) {
  res.status(status).json(payload)
}

/** Raw body reader — required for webhook signature verification (never parse first). */
export async function readRaw(req) {
  const raw = bodyFromBufferOrString(req.body)
  if (raw !== null) return raw
  return drain(req)
}
