// POST /api/payments/verify — server-side transaction verification.
// Flutterwave: calls GET /v3/transactions/{id}/verify with the secret key and
// validates status + currency + amount against our stored order before marking
// it paid. Bachs.io is confirmed by the collection.succeeded webhook instead.
import { getOrderByReference, readJson, transitionOrder } from '../../server/lib.js'
import { verifyFlutterwaveTransaction } from '../../server/gateways.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' })

  try {
    const body = await readJson(req)
    if (body.gateway !== 'flutterwave') {
      return res.status(400).json({ error: 'Unsupported gateway for this verification path.' })
    }
    if (!body.transactionId) return res.status(400).json({ error: 'Missing transaction id.' })

    const result = await verifyFlutterwaveTransaction(body.transactionId)
    const data = result?.data || {}
    const reference = data.tx_ref
    const order = reference ? getOrderByReference(reference) : null
    if (!order) return res.status(404).json({ error: 'Order not found for this transaction.' })

    // Only trust a verified, matching, fully-paid transaction.
    const ok =
      result?.status === 'success' &&
      data.status === 'successful' &&
      String(data.currency).toUpperCase() === 'NGN' &&
      Number(data.amount) >= order.total

    if (!ok) {
      transitionOrder(reference, 'failed')
      return res.status(200).json({ status: 'failed' })
    }

    const updated = transitionOrder(reference, 'successful', String(data.id))
    return res.status(200).json({ status: updated ? 'successful' : 'failed', order: updated })
  } catch (e) {
    return res.status(502).json({ error: e?.message || 'Verification failed.' })
  }
}
