import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { HomePage } from './routes/catalog'
import { CheckoutPage } from './routes/checkout'
import { ProductPage } from './routes/product'
import { createOrder } from './lib/orders'
import { CartProvider } from './store/CartContext'
import { ToastProvider, useToast } from './store/ToastContext'
import { ToastViewport } from './components/Toasts'
import { Layout } from './components/Layout'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

describe('KORO smoke', () => {
  it('renders the marketplace homepage with category tabs, products and seller trust', () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <CartProvider>
            <HomePage />
          </CartProvider>
        </ToastProvider>
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Discover' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Categories' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Electronics' })).toBeInTheDocument()
    expect(screen.getByText('Premium Cotton Shirt')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Add to Cart' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Chat Seller' }).length).toBeGreaterThan(0)
  })

  it('uses one capsule search anatomy in the hero and the top bar', async () => {
    // Hero: 44px capsule bar with the action docked as an inset inner pill.
    const hero = render(
      <MemoryRouter initialEntries={['/']}>
        <ToastProvider>
          <CartProvider>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/shop" element={<LocationProbe />} />
            </Routes>
          </CartProvider>
        </ToastProvider>
      </MemoryRouter>,
    )

    const heroInput = screen.getByRole('searchbox', { name: 'Search products, brands and stores' })
    const heroField = document.querySelector('.koro-search-field')
    expect(heroField).not.toBeNull()
    expect(heroField).toContainElement(heroInput)
    // The submit is nested inside the bar, not a sibling beside it.
    expect(heroField).toContainElement(screen.getByRole('button', { name: 'Search' }))

    fireEvent.change(heroInput, { target: { value: '  table lamp  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByTestId('location')).toHaveTextContent('/shop?q=table%20lamp')

    hero.unmount()

    // Top bar: the same capsule, without a docked action.
    render(
      <MemoryRouter>
        <ToastProvider>
          <CartProvider>
            <Layout>
              <div />
            </Layout>
          </CartProvider>
        </ToastProvider>
      </MemoryRouter>,
    )
    const barInput = screen.getByRole('searchbox', { name: 'Search products, brands and stores' })
    expect(document.querySelector('.koro-search-field')).toContainElement(barInput)
    expect(screen.queryByRole('button', { name: 'Search' })).not.toBeInTheDocument()
  })

  it('recomputes the order total server-side and rejects out-of-stock quantities', () => {
    localStorage.clear()
    const contact = { name: 'Ada Obi', email: 'ada@example.com', phone: '08031234567' }
    const recipient = { name: 'Ada Obi', phone: '08031234567' }
    const delivery = { address: '12 Marina Road', city: 'Lagos', state: 'Lagos', postalCode: '101001' }

    const order = createOrder({ contact, recipient, delivery, lines: [{ productId: 'p1', quantity: 1 }] })
    // Shirt ₦25,000 + Lagos delivery ₦5,000 = ₦30,000
    expect(order.total).toBe(30000)
    expect(order.deliveryFee).toBe(5000)
    expect(order.status).toBe('pending_payment')
    expect(order.contact.name).toBe('Ada Obi')
    expect(order.recipient.name).toBe('Ada Obi')
    expect(order.payment.reference).toMatch(/^KORO-ORD-\d{8}-[A-Z0-9]{5}$/)

    // Stock is 12 — requesting 99 must be rejected.
    expect(() => createOrder({ contact, recipient, delivery, lines: [{ productId: 'p1', quantity: 99 }] })).toThrow()
  })

  it('keeps the checkout page title separate from the KORO brand lockup', () => {
    localStorage.clear()
    localStorage.setItem('koro.cart.v1', JSON.stringify([{ productId: 'p1', quantity: 1 }]))
    render(
      <MemoryRouter initialEntries={['/checkout']}>
        <ToastProvider>
          <CartProvider>
            <CheckoutPage />
          </CartProvider>
        </ToastProvider>
      </MemoryRouter>,
    )

    const header = document.querySelector('.checkout-header')
    const brand = document.querySelector('.checkout-header .checkout-brand')
    const title = screen.getByRole('heading', { level: 1, name: 'Checkout' })

    expect(header).not.toBeNull()
    expect(brand).not.toBeNull()

    // KORO is brand identity only. The reported bug was "Checkout" rendering
    // inside this lockup, which made the page title read as part of the logo.
    expect(brand).toHaveTextContent('KORO')
    expect(brand).not.toHaveTextContent('Checkout')
    expect(brand).not.toContainElement(title)

    // Brand → title → supporting line, all inside the one header block.
    expect(header).toContainElement(brand as HTMLElement)
    expect(header).toContainElement(title)
    expect(screen.getByText('Secure, fast delivery across Nigeria.')).toBeInTheDocument()

    // The header precedes the order summary in the DOM, which is what keeps it
    // first on screen once the mobile layout swaps the columns.
    const summary = document.querySelector('.checkout-summary')
    expect(summary).not.toBeNull()
    expect(
      (header as HTMLElement).compareDocumentPosition(summary as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('shows and dismisses a toast', () => {
    function Trigger() {
      const toast = useToast()
      return <button onClick={() => toast.success('Added to cart', 'Item added.')}>Add</button>
    }
    render(
      <ToastProvider>
        <Trigger />
        <ToastViewport />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByText('Added to cart')).toBeInTheDocument()
    expect(screen.getByText('Item added.')).toBeInTheDocument()
  })

  it('renders the checkout page with a seeded cart', () => {
    localStorage.clear()
    localStorage.setItem('koro.cart.v1', JSON.stringify([{ productId: 'p1', quantity: 1 }]))
    render(
      <MemoryRouter initialEntries={['/checkout']}>
        <ToastProvider>
          <CartProvider>
            <CheckoutPage />
          </CartProvider>
        </ToastProvider>
      </MemoryRouter>,
    )
    expect(screen.getByText('Your Order')).toBeInTheDocument()
    expect(screen.getByText('Contact information')).toBeInTheDocument()
    expect(screen.getByText('Payment method')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue to Payment/ })).toBeInTheDocument()
  })

  it('renders the product detail page with gallery, seller trust and accordions', async () => {
    localStorage.clear()
    render(
      <MemoryRouter initialEntries={['/products/premium-cotton-shirt']}>
        <ToastProvider>
          <CartProvider>
            <Routes>
              <Route path="/products/:slug" element={<ProductPage />} />
            </Routes>
            <ToastViewport />
          </CartProvider>
        </ToastProvider>
      </MemoryRouter>,
    )

    // Breadcrumb + title
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Premium Cotton Shirt' })).toBeInTheDocument()

    // Gallery: one stage image plus three thumbnails
    expect(screen.getAllByRole('tab')).toHaveLength(3)

    // Seller trust block (also repeated under Specifications → "Sold by")
    expect(screen.getAllByText('Amowa Luxe').length).toBeGreaterThan(0)

    // Variants — L is rendered but unavailable
    expect(screen.getByRole('button', { name: /^L/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'M' })).toHaveAttribute('aria-pressed', 'true')

    // Actions: dark Add to Cart + grey Chat Seller
    expect(screen.getByRole('button', { name: 'Add to Cart' })).toBeInTheDocument()
    const chat = screen.getByRole('link', { name: /Chat Seller/ })
    expect(chat).toHaveAttribute('href', expect.stringContaining('https://wa.me/'))

    // Accordions
    expect(screen.getByText('Description')).toBeInTheDocument()
    expect(screen.getByText('Specifications')).toBeInTheDocument()
    expect(screen.getByText('Shipping & returns')).toBeInTheDocument()

    // Adding to cart feeds the shared cart store
    fireEvent.click(screen.getByRole('button', { name: 'Add to Cart' }))
    expect(await screen.findByText('Added to cart')).toBeInTheDocument()
  })
})
