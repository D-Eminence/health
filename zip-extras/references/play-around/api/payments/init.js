// POST /api/payments/init — initialize a gateway transaction for an order.
// Bachs.io: creates the checkout session server-side (secret key) and returns
// its checkoutUrl. Flutterwave: the client opens its inline checkout, so the
// server just acknowledges (verification happens in /verify + the webhook).
import { getOrder, readJson } from '../../server/lib.js'
import { createBachsCheckoutSession } from '../../server/gateways.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' })

  try {
    const body = await readJson(req)
    const order = getOrder(String(body.orderId || ''))
    if (!order) return res.status(404).json({ error: 'Order not found.' })
    if (order.payment.status === 'successful') return res.status(409).json({ error: 'This order is already paid.' })

    const origin = body.origin || `https://${req.headers.host}`
    const gateway = body.gateway === 'flutterwave' ? 'flutterwave' : 'bachs'

    if (gateway === 'bachs') {
      const session = await createBachsCheckoutSession(order, {
        successUrl: `${origin}/payment/callback?reference=${encodeURIComponent(order.reference)}`,
        cancelUrl: `${origin}/checkout/payment?order=${order.id}`,
      })
      const checkoutUrl = session.checkout_url || session.checkoutUrl
      if (!checkoutUrl) return res.status(502).json({ error: 'Bachs returned no checkout URL.' })
      return res.status(200).json({ mode: 'redirect', checkoutUrl })
    }

    return res.status(200).json({ mode: 'inline' })
  } catch (e) {
    return res.status(502).json({ error: e?.message || 'Could not initialize payment.' })
  }
}
