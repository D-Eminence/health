// POST /api/webhooks/flutterwave — Flutterwave webhook receiver.
// Authenticity is checked with the `verif-hash` header against
// FLUTTERWAVE_ENCRYPTION_KEY, then the transaction is re-verified server-side.
import { readRaw, transitionOrder } from '../../server/lib.js'
import { verifyFlutterwaveTransaction, verifyFlutterwaveWebhook } from '../../server/gateways.js'

export const config = { api: { bodyParser: false } }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' })

  const rawBody = await readRaw(req)
  const hash = String(req.headers['verif-hash'] || '')
  if (!verifyFlutterwaveWebhook(hash)) return res.status(401).json({ error: 'Invalid signature.' })

  let event
  try {
    event = JSON.parse(rawBody)
  } catch {
    return res.status(400).json({ error: 'Invalid payload.' })
  }

  const data = event?.data || {}
  const reference = data.tx_ref
  if (!reference) return res.status(200).json({ received: true })

  try {
    if (data.status === 'successful') {
      // Re-verify with Flutterwave rather than trusting the webhook body.
      const verified = await verifyFlutterwaveTransaction(String(data.id))
      const d = verified?.data || {}
      if (verified?.status === 'success' && d.status === 'successful' && String(d.currency).toUpperCase() === 'NGN') {
        transitionOrder(reference, 'successful', String(d.id))
      }
    } else if (data.status === 'failed') {
      transitionOrder(reference, 'failed')
    }
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Could not reconcile the order.' })
  }

  return res.status(200).json({ received: true })
}
