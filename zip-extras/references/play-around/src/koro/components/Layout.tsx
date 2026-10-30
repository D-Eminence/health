import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '../../components/ui'
import { useCart } from '../store/CartContext'

function Logo() {
  return (
    <Link to="/" className="koro-logo" aria-label="KORO — home">
      <span className="koro-logo-mark" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff">
          <path d="M12 3c.7 4 3.3 6.7 7 7.3-3.7.6-6.3 3.3-7 7.3-.7-4-3.3-6.7-7-7.3 3.7-.6 6.3-3.3 7-7.3Z" />
        </svg>
      </span>
      KORO
    </Link>
  )
}

function SearchForm({ id = 'koro-search', placeholder = 'Search products' }: { id?: string; placeholder?: string }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  function submit(e: FormEvent) {
    e.preventDefault()
    navigate(q.trim() ? `/shop?q=${encodeURIComponent(q.trim())}` : '/shop')
  }
  return (
    <form className="koro-search" role="search" onSubmit={submit}>
      <label className="sr-only" htmlFor={id}>
        Search products, brands and stores
      </label>
      <div className="koro-search-field">
        <Icon name="search" />
        <input
          id={id}
          className="koro-search-field-input"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
        />
      </div>
    </form>
  )
}

const NAV = [
  { to: '/shop', label: 'Shop' },
]

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export function Layout({ children }: { children?: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { itemCount } = useCart()
  const location = useLocation()

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname, location.search])

  return (
    <div className="koro-app">
      <ScrollToTop />
      <header className="koro-header">
        <div className="koro-container koro-header-inner">
          <Logo />

          <div className="koro-search-wide">
            <SearchForm id="koro-search-desktop" placeholder="Search products, brands and stores" />
          </div>

          <div className="koro-header-actions">
            <Link to="/account" className="koro-icon-btn" aria-label="Account">
              <Icon name="user" />
            </Link>
            <Link
              to="/cart"
              className="koro-icon-btn"
              aria-label={`Cart, ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`}
            >
              <Icon name="cart" />
              {itemCount > 0 && <span className="koro-cart-badge">{itemCount}</span>}
            </Link>
            <button
              type="button"
              className="koro-icon-btn koro-menu-btn"
              aria-label="Menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <Icon name={menuOpen ? 'close' : 'menu'} />
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="koro-mobile-menu">
            <SearchForm id="koro-search-mobile" />
            {NAV.map((item) => (
              <NavLink key={`m-${item.label}`} to={item.to} end={item.to === '/shop'}>
                {item.label}
              </NavLink>
            ))}
            <NavLink to="/account">Account</NavLink>
          </div>
        )}
      </header>

      <main className="koro-main">{children ?? <Outlet />}</main>

      <footer className="koro-footer">
        <div className="koro-container koro-footer-inner">
          <div>
            <div className="brand">KORO</div>
            <div className="meta">Good products. Simple shopping.</div>
          </div>
          <nav aria-label="Footer">
            <Link to="/shop">Shop</Link>
            <Link to="/cart">Cart</Link>
            <Link to="/account">Account</Link>
            <Link to="/admin">Admin</Link>
            <Link to="/design-system">Design system</Link>
          </nav>
          <div className="meta">© {new Date().getFullYear()} KORO · Lagos, Nigeria</div>
        </div>
      </footer>
    </div>
  )
}
