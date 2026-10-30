import { useState } from 'react'
import { cartSubtotal, hydrateCart } from '../lib/cart'
import { formatNaira } from '../lib/money'
import { ProductImage } from './ProductCard'
import type { CartLine, Order } from '../lib/types'

function OrderThumb({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return <div className="koro-media-fallback">{name.charAt(0).toUpperCase()}</div>
  }
  return <img src={url} alt={name} loading="lazy" onError={() => setFailed(true)} />
}

/** Cart/checkout preview — hydrates live catalog prices. */
export function OrderSummary({
  lines,
  deliveryFee = 0,
  discount = 0,
  total,
  showDelivery = true,
  title = 'Order summary',
}: {
  lines: CartLine[]
  deliveryFee?: number
  discount?: number
  total?: number
  showDelivery?: boolean
  title?: string
}) {
  const hydrated = hydrateCart(lines)
  const subtotal = cartSubtotal(hydrated)
  const finalTotal = total ?? subtotal + deliveryFee - discount

  return (
    <aside className="koro-summary" aria-label={title}>
      <h3>{title}</h3>

      {hydrated.length === 0 ? (
        <p className="koro-muted">Your cart is empty.</p>
      ) : (
        <div className="koro-summary-lines">
          {hydrated.map((l) => (
            <div key={l.product.id} className="koro-summary-line">
              <div className="koro-summary-thumb">
                <ProductImage product={l.product} />
              </div>
              <div className="koro-summary-line-info">
                <span className="name">{l.product.name}</span>
                <span className="meta">Qty {l.quantity}</span>
              </div>
              <span className="koro-summary-line-price">{formatNaira(l.lineTotal)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="koro-summary-row">
        <span>Subtotal</span>
        <strong>{formatNaira(subtotal)}</strong>
      </div>
      {showDelivery && (
        <div className="koro-summary-row">
          <span>Delivery</span>
          <strong>{formatNaira(deliveryFee)}</strong>
        </div>
      )}
      {discount > 0 && (
        <div className="koro-summary-row">
          <span>Discount</span>
          <strong className="koro-discount">−{formatNaira(discount)}</strong>
        </div>
      )}
      <div className="koro-summary-total">
        <span className="label">Total</span>
        <span className="value">{formatNaira(finalTotal)}</span>
      </div>
    </aside>
  )
}

/** Order/payment/success summary — renders the authoritative price snapshots. */
export function OrderSummaryFromOrder({ order, title = 'Order summary' }: { order: Order; title?: string }) {
  return (
    <aside className="koro-summary" aria-label={title}>
      <h3>{title}</h3>
      <div className="koro-summary-lines">
        {order.items.map((it) => (
          <div key={it.id} className="koro-summary-line">
            <div className="koro-summary-thumb">
              <OrderThumb url={it.imageUrl} name={it.productName} />
            </div>
            <div className="koro-summary-line-info">
              <span className="name">{it.productName}</span>
              <span className="meta">Qty {it.quantity}</span>
            </div>
            <span className="koro-summary-line-price">{formatNaira(it.subtotal)}</span>
          </div>
        ))}
      </div>
      <div className="koro-summary-row">
        <span>Subtotal</span>
        <strong>{formatNaira(order.subtotal)}</strong>
      </div>
      <div className="koro-summary-row">
        <span>Delivery</span>
        <strong>{formatNaira(order.deliveryFee)}</strong>
      </div>
      {order.discount > 0 && (
        <div className="koro-summary-row">
          <span>Discount</span>
          <strong className="koro-discount">−{formatNaira(order.discount)}</strong>
        </div>
      )}
      <div className="koro-summary-total">
        <span className="label">Total</span>
        <span className="value">{formatNaira(order.total)}</span>
      </div>
    </aside>
  )
}
