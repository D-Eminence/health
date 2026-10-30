import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { App as DesignSystem } from '../app'
import { Layout } from './components/Layout'
import { ToastViewport } from './components/Toasts'
import { CartProvider } from './store/CartContext'
import { ToastProvider } from './store/ToastContext'
import { AdminPage, NotFoundPage } from './routes/admin'
import { CartPage } from './routes/cart'
import { CategoryPage, HomePage, ShopPage } from './routes/catalog'
import { CheckoutPage, PaymentPage } from './routes/checkout'
import { AccountPage, OrderPage } from './routes/order'
import { PaymentCallbackPage, PaymentFailedPage, PaymentSuccessPage } from './routes/payment'
import { ProductPage } from './routes/product'
import './styles/toast.css'
import './styles/checkout.css'

export function KoroApp() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <CartProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="shop" element={<ShopPage />} />
              <Route path="categories/:slug" element={<CategoryPage />} />
              <Route path="products/:slug" element={<ProductPage />} />
              <Route path="cart" element={<CartPage />} />
              <Route path="payment/callback" element={<PaymentCallbackPage />} />
              <Route path="payment/success" element={<PaymentSuccessPage />} />
              <Route path="payment/failed" element={<PaymentFailedPage />} />
              <Route path="orders/:id" element={<OrderPage />} />
              <Route path="account" element={<AccountPage />} />
              <Route path="admin" element={<AdminPage />} />
              <Route path="design-system" element={<DesignSystem />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
            {/* Standalone premium checkout — no store chrome. */}
            <Route path="checkout" element={<CheckoutPage />} />
            <Route path="checkout/payment" element={<PaymentPage />} />
          </Routes>
          <ToastViewport />
        </CartProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
