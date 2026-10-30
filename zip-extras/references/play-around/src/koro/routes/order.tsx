import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Badge, Button, Icon } from '../../components/ui'
import { getOrder, listOrders } from '../lib/db'
import { formatNaira } from '../lib/money'
import { resetPaymentForRetry } from '../lib/payments'
import type { Order, OrderStatus, PaymentStatus } from '../lib/types'

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function statusLabel(s: string): string {
  return s.replace(/_/g, ' ')
}

export function paymentTone(s: PaymentStatus): 'success' | 'error' | 'warning' | 'info' | 'neutral' {
  switch (s) {
    case 'successful': return 'success'
    case 'failed': return 'error'
    case 'processing': return 'info'
    case 'refunded': return 'warning'
    default: return 'neutral'
  }
}

export function orderTone(s: OrderStatus): 'success' | 'error' | 'warning' | 'info' | 'neutral' {
  switch (s) {
    case 'paid':
    case 'delivered': return 'success'
    case 'cancelled':
    case 'refunded': return 'error'
    case 'shipped':
    case 'processing': return 'info'
    default: return 'neutral'
  }
}

/* ------------------------------ Order detail ---------------------------- */

export function OrderPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const order = id ? getOrder(id) : undefined

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
    <div className="koro-container koro-section" style={{ maxWidth: 860 }}>
      <div className="koro-between">
        <div>
          <h1 className="koro-page-title" style={{ fontSize: 'var(--font-size-title)', letterSpacing: '-0.02em' }}>
            Order {order.orderNumber}
          </h1>
          <p className="koro-muted" style={{ marginTop: 'var(--space-2)' }}>Placed {formatDate(order.createdAt)}</p>
        </div>
        <div className="koro-row" style={{ gap: 'var(--space-2)' }}>
          <Badge tone={orderTone(order.status)}>Order: {statusLabel(order.status)}</Badge>
          <Badge tone={paymentTone(order.payment.status)}>Payment: {statusLabel(order.payment.status)}</Badge>
        </div>
      </div>

      <div className="koro-card-panel koro-stack" style={{ marginTop: 'var(--space-5)' }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 400 }}>Items</h3>
        <table className="koro-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Qty</th>
              <th style={{ textAlign: 'right' }}>Unit</th>
              <th style={{ textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((it) => (
              <tr key={it.id}>
                <td>{it.productName}</td>
                <td>{it.quantity}</td>
                <td className="num" style={{ textAlign: 'right' }}>{formatNaira(it.unitPrice)}</td>
                <td className="num" style={{ textAlign: 'right' }}>{formatNaira(it.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="koro-summary-row"><span>Subtotal</span><strong>{formatNaira(order.subtotal)}</strong></div>
        <div className="koro-summary-row"><span>Delivery</span><strong>{formatNaira(order.deliveryFee)}</strong></div>
        {order.discount > 0 && (
          <div className="koro-summary-row"><span>Discount</span><strong className="koro-discount">−{formatNaira(order.discount)}</strong></div>
        )}
        <div className="koro-summary-total"><span className="label">Total</span><span className="value">{formatNaira(order.total)}</span></div>
      </div>

      <div className="koro-form-grid cols-2" style={{ marginTop: 'var(--space-5)' }}>
        <div className="koro-card-panel">
          <div className="koro-eyebrow">Deliver to</div>
          <p className="koro-strong" style={{ margin: '4px 0 0' }}>{order.recipient.name}</p>
          <p className="koro-muted" style={{ margin: '2px 0 0' }}>
            {order.recipient.phone}{order.recipient.email ? ` · ${order.recipient.email}` : ''}
          </p>
          <p className="koro-muted" style={{ margin: '2px 0 0' }}>{order.delivery.address}, {order.delivery.city}, {order.delivery.state}</p>
          {order.delivery.instructions && <p className="koro-muted" style={{ margin: '2px 0 0' }}>{order.delivery.instructions}</p>}
        </div>
        <div className="koro-card-panel">
          <div className="koro-eyebrow">Contact & payment</div>
          <p className="koro-strong" style={{ margin: '4px 0 0' }}>{order.contact.name}</p>
          <p className="koro-muted" style={{ margin: '2px 0 0' }}>{order.contact.email} · {order.contact.phone}</p>
          <p className="koro-muted" style={{ margin: '2px 0 0' }}>Ref: {order.payment.reference}</p>
        </div>
      </div>

      {order.status === 'pending_payment' && (
        <div style={{ marginTop: 'var(--space-5)' }}>
          <Button
            variant="accent"
            icon="refresh"
            onClick={() => {
              resetPaymentForRetry(order.id)
              navigate(`/checkout/payment?order=${order.id}`)
            }}
          >
            Retry payment
          </Button>
        </div>
      )}
    </div>
  )
}

/* ------------------------------ Order history --------------------------- */

export function AccountPage() {
  const navigate = useNavigate()
  const [orders] = useState<Order[]>(() => listOrders())

  return (
    <div className="koro-container koro-section">
      <h1 className="koro-page-title" style={{ fontSize: 'var(--font-size-title)', letterSpacing: '-0.02em' }}>
        Your account
      </h1>
      <p className="koro-muted" style={{ marginTop: 'var(--space-2)' }}>Order history is stored in this browser.</p>

      {orders.length === 0 ? (
        <div className="koro-empty">
          <span className="icon"><Icon name="box" /></span>
          <h2>No orders yet</h2>
          <p>Your placed orders will appear here.</p>
          <Button variant="accent" icon="arrow" onClick={() => navigate('/shop')}>Start shopping</Button>
        </div>
      ) : (
        <div className="koro-card-panel" style={{ marginTop: 'var(--space-5)' }}>
          <table className="koro-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Order</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/orders/${o.id}`)}>
                  <td><Link to={`/orders/${o.id}`} style={{ color: 'inherit', fontWeight: 500, textDecoration: 'none' }}>{o.orderNumber}</Link></td>
                  <td>{formatDate(o.createdAt)}</td>
                  <td className="num" style={{ textAlign: 'right' }}>{formatNaira(o.total)}</td>
                  <td><Badge tone={orderTone(o.status)}>{statusLabel(o.status)}</Badge></td>
                  <td><Badge tone={paymentTone(o.payment.status)}>{statusLabel(o.payment.status)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
