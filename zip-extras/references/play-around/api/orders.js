// POST /api/orders      — create an order server-side (authoritative pricing).
// GET  /api/orders?reference=…  — order/payment status (for polling after redirect).
//
// The client's totals are ignored: prices, quantities and the delivery fee are
// re-derived here, and this server-calculated `total` is what payment uses.
import {
  createReference,
  deliveryFeeFor,
  getOrderByReference,
  nextOrderNumber,
  productById,
  readJson,
  saveOrder,
} from '../server/lib.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const digits = (v) => String(v || '').replace(/\D/g, '')

function validate(body) {
  const errors = {}
  const c = body.contact || {}
  if (!c.name) errors.contactName = 'Full name is required.'
  if (!EMAIL_RE.test(String(c.email || ''))) errors.contactEmail = 'Enter a valid email address.'
  if (digits(c.phone).length < 10) errors.contactPhone = 'Enter a valid phone number.'

  const r = body.recipient || {}
  if (!r.name) errors.recipientName = "Enter the recipient's full name."
  if (digits(r.phone).length < 10) errors.recipientPhone = 'Enter a valid recipient phone number.'
  if (r.email && !EMAIL_RE.test(String(r.email))) errors.recipientEmail = 'Enter a valid email address.'

  const d = body.delivery || {}
  if (!d.address) errors.address = 'Enter a delivery address.'
  if (!d.city) errors.city = 'Enter a city.'
  if (!d.state) errors.state = 'Select a state.'
  return errors
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const reference = req.query?.reference
    const order = reference ? getOrderByReference(String(reference)) : null
    if (!order) return res.status(404).json({ error: 'Order not found.' })
    return res.status(200).json({ order })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' })

  try {
    const body = await readJson(req)

    const errors = validate(body)
    if (Object.keys(errors).length) return res.status(400).json({ errors })

    const lines = Array.isArray(body.lines) ? body.lines : []
    if (!lines.length) return res.status(400).json({ error: 'Your cart is empty.' })

    // Re-price every line from the server catalog — the client total is ignored.
    const items = []
    let subtotal = 0
    for (const line of lines) {
      const product = productById(String(line.productId))
      if (!product) return res.status(400).json({ error: 'Unknown product.' })
      const quantity = Number(line.quantity)
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        return res.status(400).json({ error: 'Invalid quantity.' })
      }
      const lineSubtotal = product.price * quantity
      items.push({
        id: id('item'),
        productId: product.id,
        productName: product.name,
        quantity,
        unitPrice: product.price,
        subtotal: lineSubtotal,
        imageUrl: product.imageUrl,
      })
      subtotal += lineSubtotal
    }

    const deliveryFee = deliveryFeeFor(body.delivery.state, Boolean(body.express))
    const total = subtotal + deliveryFee
    const now = new Date().toISOString()
    const reference = createReference()
    const orderId = id('ord')
    const gateway = body.gateway === 'flutterwave' ? 'flutterwave' : 'bachs'

    const order = {
      id: orderId,
      orderNumber: nextOrderNumber(),
      accountUserId: body.accountUserId || null,
      contact: body.contact,
      recipient: body.recipient,
      delivery: body.delivery,
      items,
      subtotal,
      deliveryFee,
      discount: 0,
      total,
      status: 'pending_payment',
      payment: {
        id: id('pay'),
        orderId,
        reference,
        provider: gateway,
        amount: total,
        currency: 'NGN',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    }

    saveOrder(order)
    return res.status(201).json({ order })
  } catch (e) {
    return res.status(400).json({ error: e?.message || 'Could not create the order.' })
  }
}
