import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Icon, Spinner } from '../../components/ui'
import { OrderSummaryFromOrder } from '../components/OrderSummary'
import { apiAvailable, apiGetOrder } from '../lib/api'
import { getOrder, upsertOrder } from '../lib/db'
import { formatNaira } from '../lib/money'
import { resetPaymentForRetry, verifyPayment } from '../lib/payments'
import { useToast } from '../store/ToastContext'
import type { Order } from '../lib/types'

/* ------------------------------- Callback ------------------------------ */

export function PaymentCallbackPage() {
  const [searchParams] = useSearchParams()
  const reference = searchParams.get('reference')
  const navigate = useNavigate()
  const toast = useToast()
  const [order, setOrder] = useState<Order | null>(null)
  const [state, setState] = useState<'loading' | 'processing' | 'error'>('loading')

  useEffect(() => {
    if (!reference) {
      setState('error')
      return
    }
    let cancelled = false
    // Prefer the authoritative server record (written by verify + webhooks) and
    // mirror it locally; fall back to the local store when there's no backend.
    const load = async (): Promise<Order> => {
      if (await apiAvailable()) {
        const serverOrder = await apiGetOrder(reference)
        if (serverOrder) {
          upsertOrder(serverOrder)
          return serverOrder
        }
      }
      return verifyPayment(reference)
    }
    load()
      .then((o) => {
        if (cancelled) return
        setOrder(o)
        if (o.payment.status === 'successful') navigate(`/payment/success?order=${o.id}`, { replace: true })
        else if (o.payment.status === 'failed') navigate(`/payment/failed?order=${o.id}`, { replace: true })
        else {
          setState('processing')
          toast.info('Confirming payment…', "We're checking your payment status. This may take a moment.", {
            key: `confirm-${reference}`,
          })
        }
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [reference, navigate])

  if (state === 'loading') {
    return (
      <div className="koro-container koro-section">
        <div className="koro-empty">
          <span className="icon"><Spinner /></span>
          <h2>Confirming your payment…</h2>
          <p>We&apos;re verifying the transaction with our server. Please don&apos;t close this page.</p>
        </div>
      </div>
    )
  }

  if (state === 'error' || !order) {
    return (
      <div className="koro-container koro-section">
        <div className="koro-empty">
          <span className="icon"><Icon name="error" /></span>
          <h2>We couldn&apos;t confirm your payment</h2>
          <p>You haven&apos;t been charged. Please try again or contact support.</p>
          <Button variant="accent" onClick={() => navigate('/shop')}>Continue shopping</Button>
        </div>
      </div>
    )
  }

  // processing — payment is not yet confirmed.
  return (
    <div className="koro-container koro-section">
      <div className="koro-result">
        <span className="mark" style={{ background: 'var(--color-warning)' }}><Icon name="pending" /></span>
        <h1>Payment pending</h1>
        <p>We&apos;re waiting for final confirmation. Your order will update automatically once it&apos;s confirmed.</p>
        <div className="koro-result-actions">
          <Button variant="primary" onClick={() => navigate(`/orders/${order.id}`)}>View order</Button>
          <Button variant="secondary" onClick={() => { resetPaymentForRetry(order.id); navigate(`/checkout/payment?order=${order.id}`) }}>Try payment again</Button>
        </div>
      </div>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <OrderSummaryFromOrder order={order} />
      </div>
    </div>
  )
}

/* -------------------------------- Success ------------------------------ */

export function PaymentSuccessPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const orderId = searchParams.get('order')
  const [order] = useState<Order | null>(() => (orderId ? getOrder(orderId) ?? null : null))
  const notified = useRef(false)

  useEffect(() => {
    if (order && !notified.current) {
      notified.current = true
      toast.success('Order confirmed', `Order ${order.orderNumber} has been confirmed.`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order])

  if (!order) {
    return (
      <div className="koro-container koro-section">
        <div className="koro-empty">
          <span className="icon"><Icon name="error" /></span>
          <h2>Order not found</h2>
          <p>We couldn&apos;t find that order.</p>
          <Button variant="accent" onClick={() => navigate('/shop')}>Continue shopping</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="koro-container koro-section">
      <div className="koro-result">
        <span className="mark success"><Icon name="success" /></span>
        <h1>Payment successful</h1>
        <p>Thank you, {order.contact.name.split(' ')[0]}. Your order has been confirmed.</p>
        <div className="koro-card-panel koro-stack" style={{ textAlign: 'left' }}>
          <div className="koro-summary-row"><span>Order</span><strong>{order.orderNumber}</strong></div>
          <div className="koro-summary-row"><span>Amount paid</span><strong>{formatNaira(order.total)}</strong></div>
          <div className="koro-summary-row">
            <span>Payment method</span>
            <strong>{order.payment.provider === 'flutterwave' ? 'Bank · Flutterwave' : 'Card · Bachs.io'}</strong>
          </div>
          <div className="koro-summary-row"><span>Payment reference</span><strong>{order.payment.reference}</strong></div>
        </div>
        <div style={{ marginTop: 'var(--space-5)', textAlign: 'left' }}>
          <OrderSummaryFromOrder order={order} />
        </div>
        <div className="koro-result-actions" style={{ marginTop: 'var(--space-5)' }}>
          <Button variant="primary" onClick={() => navigate(`/orders/${order.id}`)}>View order</Button>
          <Link to="/shop" className="ui-button ui-button--secondary ui-button--md" style={{ textDecoration: 'none' }}>Continue shopping</Link>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------- Failed ------------------------------- */

export function PaymentFailedPage() {
  const [searchParams] = useSearchParams()
  const orderId = searchParams.get('order')
  const navigate = useNavigate()
  const toast = useToast()
  const [order] = useState<Order | null>(() => (orderId ? getOrder(orderId) ?? null : null))
  const notified = useRef(false)

  useEffect(() => {
    if (order && !notified.current) {
      notified.current = true
      toast.error(
        'Payment failed',
        "We couldn't confirm your payment. You haven't been charged. Please try again.",
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order])

  if (!order) {
    return (
      <div className="koro-container koro-section">
        <div className="koro-empty">
          <span className="icon"><Icon name="error" /></span>
          <h2>Order not found</h2>
          <Button variant="accent" onClick={() => navigate('/shop')}>Continue shopping</Button>
        </div>
      </div>
    )
  }

  function retry() {
    resetPaymentForRetry(order!.id)
    navigate(`/checkout/payment?order=${order!.id}`)
  }

  return (
    <div className="koro-container koro-section">
      <div className="koro-result">
        <span className="mark failed"><Icon name="error" /></span>
        <h1>Payment failed</h1>
        <p>We couldn&apos;t complete your payment. You haven&apos;t been charged — your order is saved so you can try again.</p>
        <div className="koro-result-actions">
          <Button variant="accent" icon="refresh" onClick={retry}>Try payment again</Button>
          <Button variant="secondary" onClick={() => navigate('/shop')}>Continue shopping</Button>
        </div>
      </div>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <OrderSummaryFromOrder order={order} />
      </div>
    </div>
  )
}
