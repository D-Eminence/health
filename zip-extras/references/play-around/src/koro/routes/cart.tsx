import { Link, useNavigate } from 'react-router-dom'
import { Button, Icon } from '../../components/ui'
import { ProductImage } from '../components/ProductCard'
import { QuantityStepper } from '../components/QuantityStepper'
import { cartSubtotal, hydrateCart, type HydratedLine } from '../lib/cart'
import { effectiveStock } from '../lib/db'
import { formatNaira } from '../lib/money'
import { useCart } from '../store/CartContext'
import { useToast } from '../store/ToastContext'

export function CartPage() {
  const { lines, setQuantity, removeItem, addItem } = useCart()
  const toast = useToast()
  const navigate = useNavigate()

  const hydrated = hydrateCart(lines)
  const subtotal = cartSubtotal(hydrated)

  if (hydrated.length === 0) {
    return (
      <div className="koro-container">
        <div className="koro-empty">
          <span className="icon"><Icon name="cart" /></span>
          <h2>Your cart is empty</h2>
          <p>Add something you love and come back when you&apos;re ready to checkout.</p>
          <Button variant="accent" icon="arrow" onClick={() => navigate('/shop')}>Start shopping</Button>
        </div>
      </div>
    )
  }

  function handleRemove(line: HydratedLine) {
    removeItem(line.product.id)
    toast.success('Removed from cart', `${line.product.name} was removed from your cart.`, {
      action: { label: 'Undo', onAction: () => addItem(line.product.id, line.quantity) },
    })
  }

  return (
    <div className="koro-container koro-section">
      <h1 className="koro-page-title" style={{ fontSize: 'var(--font-size-title)', letterSpacing: '-0.02em' }}>
        Your cart
      </h1>

      <div className="koro-cart-layout" style={{ marginTop: 'var(--space-6)' }}>
        <div>
          <div className="koro-card-panel" style={{ padding: 'var(--space-3) var(--space-5)' }}>
            {hydrated.map((l) => (
              <div key={l.product.id} className="koro-cart-line">
                <Link to={`/products/${l.product.slug}`} className="koro-cart-thumb">
                  <ProductImage product={l.product} />
                </Link>
                <div className="koro-cart-line-info">
                  <div className="name">
                    <Link to={`/products/${l.product.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                      {l.product.name}
                    </Link>
                  </div>
                  <div className="meta">{formatNaira(l.product.price)} each · {l.product.sku}</div>
                </div>
                <div className="koro-cart-line-right">
                  <span className="koro-line-price">{formatNaira(l.lineTotal)}</span>
                  <div className="koro-row" style={{ gap: 'var(--space-2)' }}>
                    <QuantityStepper
                      value={l.quantity}
                      onChange={(v) => setQuantity(l.product.id, v)}
                      min={1}
                      max={Math.max(1, effectiveStock(l.product.id))}
                    />
                    <button
                      type="button"
                      className="koro-line-remove"
                      aria-label={`Remove ${l.product.name}`}
                      onClick={() => handleRemove(l)}
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="koro-between" style={{ marginTop: 'var(--space-5)' }}>
            <Button variant="secondary" onClick={() => navigate('/shop')}>Continue shopping</Button>
            <Button variant="primary" icon="arrow" onClick={() => navigate('/checkout')}>Proceed to checkout</Button>
          </div>
        </div>

        <div className="koro-summary">
          <h3>Order summary</h3>
          <div className="koro-summary-row"><span>Subtotal</span><strong>{formatNaira(subtotal)}</strong></div>
          <div className="koro-summary-row"><span>Delivery</span><strong className="koro-muted">Calculated at checkout</strong></div>
          <div className="koro-summary-total"><span className="label">Total</span><span className="value">{formatNaira(subtotal)}</span></div>
          <p className="koro-muted" style={{ margin: 'var(--space-3) 0 0', fontSize: 'var(--font-size-caption)' }}>
            Delivery and any applicable fees are added at checkout.
          </p>
        </div>
      </div>
    </div>
  )
}
