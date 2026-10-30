import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Icon } from '../../components/ui'
import { listOrders, updateOrderStatus } from '../lib/db'
import { formatNaira } from '../lib/money'
import { useToast } from '../store/ToastContext'
import { formatDate, orderTone, paymentTone, statusLabel } from './order'
import type { Order, OrderStatus } from '../lib/types'

const ADVANCE: Partial<Record<OrderStatus, { next: OrderStatus; label: string }>> = {
  paid: { next: 'processing', label: 'Mark processing' },
  processing: { next: 'shipped', label: 'Mark shipped' },
  shipped: { next: 'delivered', label: 'Mark delivered' },
}

export function AdminPage() {
  const toast = useToast()
  const [orders, setOrders] = useState<Order[]>(() => listOrders())
  const payments = orders.map((o) => o.payment)

  function advance(o: Order) {
    const step = ADVANCE[o.status]
    if (!step) return
    const updated = updateOrderStatus(o.id, step.next)
    if (updated) {
      setOrders(listOrders())
      toast.success('Order updated', `${o.orderNumber} is now marked as ${statusLabel(step.next)}.`)
    }
  }

  return (
    <div className="koro-container koro-section">
      <div className="koro-notice koro-notice--warning" style={{ marginBottom: 'var(--space-6)' }}>
        <Icon name="info" />
        <span>
          Development dashboard. Data is read from the local (simulated) backend in this browser;
          no authentication is enforced in this prototype.
        </span>
      </div>

      <h1 className="koro-page-title" style={{ fontSize: 'var(--font-size-title)', letterSpacing: '-0.02em' }}>
        Admin
      </h1>

      <section style={{ marginTop: 'var(--space-6)' }}>
        <h2 className="koro-eyebrow" style={{ margin: '0 0 var(--space-3)' }}>Orders</h2>
        {orders.length === 0 ? (
          <p className="koro-muted">No orders yet.</p>
        ) : (
          <table className="koro-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Payment</th>
                <th>Order</th>
                <th>Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td><Link to={`/orders/${o.id}`} style={{ color: 'inherit', fontWeight: 500, textDecoration: 'none' }}>{o.orderNumber}</Link></td>
                  <td>{o.contact.name}</td>
                  <td className="num" style={{ textAlign: 'right' }}>{formatNaira(o.total)}</td>
                  <td><Badge tone={paymentTone(o.payment.status)}>{statusLabel(o.payment.status)}</Badge></td>
                  <td><Badge tone={orderTone(o.status)}>{statusLabel(o.status)}</Badge></td>
                  <td>{formatDate(o.createdAt)}</td>
                  <td>
                    {ADVANCE[o.status] ? (
                      <Button size="sm" variant="secondary" onClick={() => advance(o)}>
                        {ADVANCE[o.status]!.label}
                      </Button>
                    ) : (
                      <span className="koro-muted" style={{ fontSize: 'var(--font-size-caption)' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginTop: 'var(--space-8)' }}>
        <h2 className="koro-eyebrow" style={{ margin: '0 0 var(--space-3)' }}>Payments</h2>
        {payments.length === 0 ? (
          <p className="koro-muted">No payments yet.</p>
        ) : (
          <table className="koro-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Order</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Provider</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="num">{p.reference}</td>
                  <td>{orders.find((o) => o.payment.id === p.id)?.orderNumber ?? '—'}</td>
                  <td className="num" style={{ textAlign: 'right' }}>{formatNaira(p.amount)}</td>
                  <td>{p.provider}</td>
                  <td><Badge tone={paymentTone(p.status)}>{statusLabel(p.status)}</Badge></td>
                  <td>{formatDate(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

/* ------------------------------- 404 ---------------------------------- */

export function NotFoundPage() {
  return (
    <div className="koro-container koro-section">
      <div className="koro-empty">
        <span className="icon"><Icon name="error" /></span>
        <h2>Page not found</h2>
        <p>The page you&apos;re looking for doesn&apos;t exist.</p>
        <Link to="/" className="ui-button ui-button--accent ui-button--md" style={{ textDecoration: 'none' }}>
          Back home
        </Link>
      </div>
    </div>
  )
}
