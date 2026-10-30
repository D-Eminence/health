import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Icon, SelectField, StatePanel } from '../../components/ui'
import { ProductCard } from '../components/ProductCard'
import { CATEGORIES, PRODUCTS, getCategoryBySlug } from '../lib/products'
import type { Product } from '../lib/types'

/* ------------------------------- Home -------------------------------- */

export function HomePage() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const products = PRODUCTS.filter((p) => p.active)

  function submit(e: FormEvent) {
    e.preventDefault()
    navigate(q.trim() ? `/shop?q=${encodeURIComponent(q.trim())}` : '/shop')
  }

  return (
    <div className="koro-container">
      <section className="koro-hero-search">
        <h1>Discover products, brands, and sellers</h1>
        <p className="sub">One marketplace for verified Nigerian sellers — search, compare and buy in seconds.</p>
        <form className="koro-search-hero" role="search" onSubmit={submit}>
          <label className="sr-only" htmlFor="koro-hero-search">
            Search products, brands and stores
          </label>
          <div className="koro-search-field">
            <Icon name="search" />
            <input
              id="koro-hero-search"
              className="koro-search-field-input"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search products, brands and stores"
              autoComplete="off"
            />
            <button type="submit" className="koro-search-field-submit">
              Search
            </button>
          </div>
        </form>
      </section>

      <nav className="koro-cat-pills" aria-label="Categories">
        <Link to="/" className="is-active">All</Link>
        {CATEGORIES.map((c) => (
          <Link key={c.id} to={`/categories/${c.slug}`}>{c.name}</Link>
        ))}
      </nav>

      <section className="koro-section">
        <div className="koro-section-head">
          <h2>Discover</h2>
          <span className="koro-muted" style={{ fontSize: 'var(--font-size-caption)' }}>
            {products.length} products from verified sellers
          </span>
        </div>
        <div className="koro-grid">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>
    </div>
  )
}

/* --------------------------- Shared listing --------------------------- */

function useShopQuery() {
  const [searchParams] = useSearchParams()
  return {
    q: (searchParams.get('q') ?? '').trim().toLowerCase(),
    filter: searchParams.get('filter') ?? '',
    sort: searchParams.get('sort') ?? 'featured',
  }
}

function ProductListing({ activeCategoryId }: { activeCategoryId?: string }) {
  const { q, filter, sort } = useShopQuery()
  const [, setSearchParams] = useSearchParams()

  const products = useMemo<Product[]>(() => {
    let list = PRODUCTS.filter((p) => p.active)
    if (activeCategoryId) list = list.filter((p) => p.categoryId === activeCategoryId)
    if (filter === 'new') list = list.filter((p) => p.tags?.includes('new'))
    if (filter === 'deal') list = list.filter((p) => p.tags?.includes('deal') || (p.compareAtPrice && p.compareAtPrice > p.price))
    if (q) {
      const needle = q
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          p.description.toLowerCase().includes(needle) ||
          p.sku.toLowerCase().includes(needle) ||
          p.seller.name.toLowerCase().includes(needle),
      )
    }
    const sorted = [...list]
    if (sort === 'price-asc') sorted.sort((a, b) => a.price - b.price)
    else if (sort === 'price-desc') sorted.sort((a, b) => b.price - a.price)
    else if (sort === 'rating') sorted.sort((a, b) => b.seller.rating - a.seller.rating)
    else sorted.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0))
    return sorted
  }, [activeCategoryId, q, filter, sort])

  const title = activeCategoryId ? getCategoryBySlug(activeCategoryId)?.name ?? 'Shop' : 'All products'

  return (
    <div className="koro-container">
      <nav className="koro-cat-pills" aria-label="Categories">
        <Link to="/shop" className={!activeCategoryId ? 'is-active' : ''}>All</Link>
        {CATEGORIES.map((c) => (
          <Link key={c.id} to={`/categories/${c.slug}`} className={activeCategoryId === c.slug ? 'is-active' : ''}>
            {c.name}
          </Link>
        ))}
      </nav>

      <section className="koro-section">
        <div className="koro-section-head">
          <h2>{title}</h2>
          <SelectField
            label="Sort"
            value={sort}
            onChange={(e) => setSearchParams((prev) => { const p = new URLSearchParams(prev); p.set('sort', e.target.value); return p })}
          >
            <option value="featured">Featured</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
            <option value="rating">Top rated sellers</option>
          </SelectField>
        </div>

        {products.length === 0 ? (
          <StatePanel state="empty" title="No products found" action="Clear search">
            Try a different search or browse a category.
          </StatePanel>
        ) : (
          <div className="koro-grid">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/* ------------------------------- Shop -------------------------------- */

export function ShopPage() {
  return <ProductListing />
}

/* ----------------------------- Category ------------------------------ */

export function CategoryPage() {
  const { slug } = useParams()
  return <ProductListing activeCategoryId={slug} />
}
