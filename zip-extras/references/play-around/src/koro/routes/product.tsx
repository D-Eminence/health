import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, Icon, StatePanel } from '../../components/ui'
import { ProductImage, Stars } from '../components/ProductCard'
import { QuantityStepper } from '../components/QuantityStepper'
import { effectiveStock } from '../lib/db'
import { formatNaira } from '../lib/money'
import { CATEGORIES, getProductBySlug } from '../lib/products'
import { useAddToCart } from '../store/useAddToCart'

const SIZES = [
  { id: 's', label: 'S', available: true },
  { id: 'm', label: 'M', available: true },
  { id: 'l', label: 'L', available: false },
  { id: 'xl', label: 'XL', available: true },
]
const COLOURS = [
  { id: 'black', label: 'Black', hex: '#17171a', available: true },
  { id: 'white', label: 'White', hex: '#f4f4f5', available: true },
  { id: 'sand', label: 'Sand', hex: '#d9c7ad', available: false },
]

function galleryFor(url: string): string[] {
  // Prototype gallery: one photograph served at three crops.
  return [url, `${url}&fit=crop&w=900&h=900&crop=top`, `${url}&fit=crop&w=900&h=900&crop=bottom`]
}

export function ProductPage() {
  const { slug } = useParams()
  const product = getProductBySlug(slug ?? '')
  const navigate = useNavigate()
  const { add, addingId } = useAddToCart()
  const [active, setActive] = useState(0)
  const [size, setSize] = useState('m')
  const [colour, setColour] = useState('black')
  const [qty, setQty] = useState(1)

  if (!product || !product.active) {
    return (
      <div className="koro-container koro-section">
        <StatePanel state="empty" title="Product not found" action="Back to shop">
          The product you&apos;re looking for isn&apos;t available.
        </StatePanel>
      </div>
    )
  }

  const stock = effectiveStock(product.id)
  const out = stock <= 0
  const adding = addingId === product.id
  const category = CATEGORIES.find((c) => c.id === product.categoryId)
  const { seller } = product
  const gallery = galleryFor(product.imageUrl)
  const hasVariants = product.categoryId !== 'services'
  const discountPct =
    product.compareAtPrice && product.compareAtPrice > product.price
      ? Math.round((1 - product.price / product.compareAtPrice) * 100)
      : 0
  const chatHref = `https://wa.me/${seller.whatsapp}?text=${encodeURIComponent(`Hi ${seller.name}, I'm interested in "${product.name}" on KORO.`)}`

  function handleAdd() {
    if (!product || out) return
    add(product.id, qty)
  }
  async function buyNow() {
    if (!product || out) return
    const ok = await add(product.id, qty, { showViewCart: false })
    if (ok) navigate('/cart')
  }

  return (
    <div className="koro-container koro-pdp-wrap">
      <nav className="pdp-crumbs" aria-label="Breadcrumb">
        <Link to="/">Home</Link>
        <span aria-hidden="true">/</span>
        {category && <Link to={`/categories/${category.slug}`}>{category.name}</Link>}
        <span aria-hidden="true">/</span>
        <span className="current">{product.name}</span>
      </nav>

      <div className="pdp-layout">
        {/* ------------------------------ Gallery ------------------------------ */}
        <div className="pdp-gallery">
          <div className="pdp-stage">
            <img src={gallery[active]} alt={product.name} />
            {discountPct > 0 && <span className="pdp-flag">-{discountPct}%</span>}
          </div>
          <div className="pdp-thumbs" role="tablist" aria-label="Product images">
            {gallery.map((src, i) => (
              <button
                key={src}
                type="button"
                role="tab"
                aria-selected={i === active}
                aria-label={`View image ${i + 1}`}
                className={`pdp-thumb ${i === active ? 'is-active' : ''}`}
                onClick={() => setActive(i)}
              >
                <img src={src} alt="" />
              </button>
            ))}
          </div>
        </div>

        {/* ------------------------------ Details ----------------------------- */}
        <div className="pdp-details">
          <div className="pdp-seller">
            <span className="avatar">{seller.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
            <span className="info">
              <span className="line">
                <span className="store">{seller.name}</span>
                {seller.verified && (
                  <span className="verified" title="Verified seller">
                    <Icon name="check" />
                  </span>
                )}
              </span>
              <span className="meta">
                <Stars value={seller.rating} />
                {seller.rating.toFixed(1)} · {seller.orderCount.toLocaleString()} orders
              </span>
            </span>
            <a className="pdp-seller-link" href={chatHref} target="_blank" rel="noopener noreferrer">Visit store</a>
          </div>

          <h1 className="pdp-title">{product.name}</h1>

          <div className="pdp-price">
            <span className="amount">{formatNaira(product.price)}</span>
            {product.compareAtPrice && product.compareAtPrice > product.price && (
              <span className="was">{formatNaira(product.compareAtPrice)}</span>
            )}
          </div>
          <p className={`pdp-stock ${out ? 'is-out' : ''}`}>
            <Icon name={out ? 'error' : 'check'} />
            {out ? 'Out of stock' : `${stock} in stock`} · SKU {product.sku}
          </p>

          {hasVariants && (
            <div className="pdp-variants">
              <div className="pdp-variant">
                <span className="label">Size</span>
                <div className="options">
                  {SIZES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`pdp-opt ${size === s.id ? 'is-active' : ''}`}
                      disabled={!s.available}
                      aria-pressed={size === s.id}
                      onClick={() => setSize(s.id)}
                    >
                      {s.label}
                      {!s.available && <span className="sr-only"> (unavailable)</span>}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pdp-variant">
                <span className="label">Colour</span>
                <div className="options">
                  {COLOURS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`pdp-swatch ${colour === c.id ? 'is-active' : ''}`}
                      disabled={!c.available}
                      aria-pressed={colour === c.id}
                      aria-label={c.label}
                      title={c.available ? c.label : `${c.label} (unavailable)`}
                      onClick={() => setColour(c.id)}
                    >
                      <span style={{ background: c.hex }} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="pdp-qty">
            <span className="label">Quantity</span>
            <QuantityStepper value={qty} onChange={setQty} min={1} max={Math.max(1, stock)} disabled={out} />
          </div>

          <div className="pdp-actions">
            <button type="button" className="pdp-add" disabled={out || adding} onClick={handleAdd}>
              {adding ? 'Adding…' : out ? 'Out of stock' : 'Add to Cart'}
            </button>
            <a className="pdp-chat" href={chatHref} target="_blank" rel="noopener noreferrer">
              <Icon name="chat" /> Chat Seller
            </a>
          </div>
          <button type="button" className="pdp-buynow" disabled={out || adding} onClick={buyNow}>
            Buy now
          </button>

          <div className="pdp-assurance">
            <span><Icon name="truck" /> Lagos ₦5,000 · other states ₦8,000</span>
            <span><Icon name="refresh" /> 7-day returns</span>
            <span><Icon name="shield" /> Secure payment</span>
          </div>

          {/* Expandable details */}
          <div className="pdp-accordions">
            <details open>
              <summary>Description</summary>
              <p>{product.description}</p>
            </details>
            <details>
              <summary>Specifications</summary>
              <dl>
                <div><dt>Category</dt><dd>{category?.name}</dd></div>
                <div><dt>SKU</dt><dd>{product.sku}</dd></div>
                <div><dt>Rating</dt><dd>{product.rating.toFixed(1)} ({product.reviewCount} reviews)</dd></div>
                <div><dt>Availability</dt><dd>{out ? 'Out of stock' : `${stock} available`}</dd></div>
                <div><dt>Sold by</dt><dd>{seller.name}</dd></div>
              </dl>
            </details>
            <details>
              <summary>Shipping &amp; returns</summary>
              <p>
                Delivered nationwide from Lagos. Standard delivery is ₦5,000 within Lagos and ₦8,000 to
                other states (2–4 business days); express is available at checkout. Returns are accepted
                within 7 days of delivery in original condition.
              </p>
            </details>
          </div>
        </div>
      </div>
    </div>
  )
}
