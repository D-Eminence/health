// POST /api/webhooks/bachs — Bachs.io webhook receiver.
// Verifies X-Bachs-Signature = HMAC-SHA256("{timestamp}.{raw_body}") against
// BACHS_WEBHOOK_SECRET, then reconciles the order. Idempotent by design.
import { readRaw, transitionOrder } from '../../server/lib.js'
import { verifyBachsWebhook } from '../../server/gateways.js'

// Signature verification needs the raw body — disable Vercel's body parser.
export const config = { api: { bodyParser: false } }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' })

  const rawBody = await readRaw(req)
  const timestamp = String(req.headers['x-bachs-timestamp'] || '')
  const signature = String(req.headers['x-bachs-signature'] || '')

  if (!verifyBachsWebhook(rawBody, timestamp, signature, process.env.BACHS_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Invalid signature.' })
  }

  let event
  try {
    event = JSON.parse(rawBody)
  } catch {
    return res.status(400).json({ error: 'Invalid payload.' })
  }

  const data = event?.data || {}
  const reference = data.reference

  try {
    if (event.type === 'collection.succeeded') {
      transitionOrder(reference, 'successful', data.charge_id || data.id) // idempotent
    } else if (event.type === 'collection.failed' || event.type === 'collection.abandoned') {
      transitionOrder(reference, 'failed')
    }
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Could not reconcile the order.' })
  }

  return res.status(200).json({ received: true })
}
