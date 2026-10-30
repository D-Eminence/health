import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../components/ui'
import { effectiveStock } from '../lib/db'
import { formatNaira } from '../lib/money'
import { CATEGORIES } from '../lib/products'
import { useAddToCart } from '../store/useAddToCart'
import type { Product } from '../lib/types'

export function Stars({ value, size = 12 }: { value: number; size?: number }) {
  const rounded = Math.round(value)
  return (
    <span className="koro-stars" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ color: i < rounded ? '#f5a623' : 'var(--color-border-strong)' }}>
          <path d="M12 2.5l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.34l-5.81 3.06 1.11-6.47L2.6 9.35l6.5-.95L12 2.5Z" />
        </svg>
      ))}
    </span>
  )
}

export function Rating({ value, count }: { value: number; count?: number }) {
  return (
    <span className="koro-rating" aria-label={`Rated ${value} out of 5`}>
      <Stars value={value} />
      <span>{value.toFixed(1)}</span>
      {typeof count === 'number' && <span>({count})</span>}
    </span>
  )
}

export function ProductImage({ product, className }: { product: Product; className?: string }) {
  const [failed, setFailed] = useState(false)
  const category = CATEGORIES.find((c) => c.id === product.categoryId)
  if (failed) {
    return (
      <div className={`koro-media-fallback ${className ?? ''}`}>
        <span>{category?.name ?? 'KORO'}</span>
      </div>
    )
  }
  return (
    <img
      src={product.imageUrl}
      alt={product.name}
      loading="lazy"
      className={className}
      onError={() => setFailed(true)}
    />
  )
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

function compactCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)
}

export function ProductCard({ product }: { product: Product }) {
  const { add, addingId } = useAddToCart()
  const stock = effectiveStock(product.id)
  const out = stock <= 0
  const adding = addingId === product.id
  const category = CATEGORIES.find((c) => c.id === product.categoryId)
  const discountPct =
    product.compareAtPrice && product.compareAtPrice > product.price
      ? Math.round((1 - product.price / product.compareAtPrice) * 100)
      : 0
  const { seller } = product
  const chatHref = `https://wa.me/${seller.whatsapp}?text=${encodeURIComponent(`Hi ${seller.name}, I'm interested in "${product.name}" on KORO.`)}`

  return (
    <article className="pcard">
      <Link to={`/products/${product.slug}`} className="pcard-media" aria-label={product.name}>
        <ProductImage product={product} />
        {discountPct > 0 && <span className="pcard-flag">-{discountPct}%</span>}
      </Link>

      <div className="pcard-body">
        <span className="pcard-category">{category?.name}</span>
        <h3 className="pcard-name">
          <Link to={`/products/${product.slug}`}>{product.name}</Link>
        </h3>

        <div className="pcard-price">
          <span className="amount">{formatNaira(product.price)}</span>
          {product.compareAtPrice && product.compareAtPrice > product.price && (
            <span className="was">{formatNaira(product.compareAtPrice)}</span>
          )}
        </div>

        <div className="pcard-seller">
          <span className="avatar">{initials(seller.name)}</span>
          <span className="seller-info">
            <span className="seller-line">
              <span className="store">{seller.name}</span>
              {seller.verified && (
                <span className="verified" title="Verified seller" aria-label="Verified seller">
                  <Icon name="check" />
                </span>
              )}
            </span>
            <span className="seller-meta">
              <Stars value={seller.rating} />
              {seller.rating.toFixed(1)} · {compactCount(seller.orderCount)} orders
            </span>
          </span>
        </div>

        <div className="pcard-actions">
          <button
            type="button"
            className="pcard-add"
            disabled={out || adding}
            onClick={() => add(product.id, 1)}
          >
            {adding ? 'Adding…' : out ? 'Out of stock' : 'Add to Cart'}
          </button>
          <a className="pcard-chat" href={chatHref} target="_blank" rel="noopener noreferrer">
            Chat Seller
          </a>
        </div>
      </div>
    </article>
  )
}
