import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Icon, InputField, SelectField, TextareaField } from '../../components/ui'
import { OrderSummaryFromOrder } from '../components/OrderSummary'
import { apiAvailable, apiCreateOrder } from '../lib/api'
import { cartSubtotal, hydrateCart } from '../lib/cart'
import { delay, getOrder, setPaymentProvider, upsertOrder } from '../lib/db'
import { FLUTTERWAVE_PUBLIC_KEY } from '../lib/flutterwave'
import { formatNaira } from '../lib/money'
import { createOrder } from '../lib/orders'
import { openGatewayPayment, settlePayment, type GatewayId, type PaymentResult } from '../lib/payments'
import { EXPRESS_SURCHARGE, NIGERIAN_STATES, deliveryFeeFor } from '../lib/products'
import { getContactFromProfile, getDefaultAddress, getProfile, saveProfileContact } from '../lib/session'
import {
  contactSchema,
  deliveryAddressSchema,
  flattenIssues,
  recipientSchema,
} from '../lib/validation'
import { useCart } from '../store/CartContext'
import { useToast } from '../store/ToastContext'
import type { Contact, Order, Recipient } from '../lib/types'

function Sparkle() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3c.7 4 3.3 6.7 7 7.3-3.7.6-6.3 3.3-7 7.3-.7-4-3.3-6.7-7-7.3 3.7-.6 6.3-3.3 7-7.3Z" />
    </svg>
  )
}

type ShipMethod = 'standard' | 'express'
type DeliverTo = 'me' | 'someone'

const GATEWAYS: { id: GatewayId; label: string; icon: 'credit' | 'bank'; sub: string }[] = [
  { id: 'bachs', label: 'Bachs.io', icon: 'credit', sub: 'Card · Bank · USSD' },
  { id: 'flutterwave', label: 'Flutterwave', icon: 'bank', sub: 'Card · Bank · USSD' },
]

export function CheckoutPage() {
  const { lines, clearCart } = useCart()
  const toast = useToast()
  const navigate = useNavigate()

  const profile = useMemo(() => getProfile(), [])
  const defaultAddress = useMemo(() => getDefaultAddress(), [])

  // Contact information — defaults to the authenticated account's profile.
  const [contact, setContact] = useState<Contact>(() => getContactFromProfile())
  const [contactDraft, setContactDraft] = useState<Contact>(() => getContactFromProfile())
  const [editingContact, setEditingContact] = useState(false)
  const [saveToProfile, setSaveToProfile] = useState(false)

  // Delivery — "deliver to me" (account user + default address) or someone else.
  const [deliverTo, setDeliverTo] = useState<DeliverTo>('me')
  const [recipientDraft, setRecipientDraft] = useState<Recipient>({ name: '', phone: '', email: '' })
  const [addressEditing, setAddressEditing] = useState(false)
  const [delivery, setDelivery] = useState({
    address: defaultAddress?.address ?? '',
    city: defaultAddress?.city ?? '',
    state: defaultAddress?.state ?? '',
    postalCode: defaultAddress?.postalCode ?? '',
    instructions: '',
  })

  const [shipMethod, setShipMethod] = useState<ShipMethod>('standard')
  const [gateway, setGateway] = useState<GatewayId>('bachs')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [placing, setPlacing] = useState(false)

  const setD = (k: keyof typeof delivery) => (v: string) => setDelivery((d) => ({ ...d, [k]: v }))
  const setR = (k: keyof Recipient) => (v: string) => setRecipientDraft((r) => ({ ...r, [k]: v }))

  const hydrated = hydrateCart(lines)
  const subtotal = cartSubtotal(hydrated)
  const baseFee = delivery.state ? deliveryFeeFor(delivery.state) : 0
  const deliveryFee = baseFee + (shipMethod === 'express' ? EXPRESS_SURCHARGE : 0)
  const total = subtotal + deliveryFee

  const isSelf = deliverTo === 'me'
  const recipient: Recipient = isSelf
    ? { name: profile.user.name, phone: profile.user.phone, email: profile.user.email }
    : recipientDraft

  if (hydrated.length === 0) {
    return (
      <div className="checkout-root">
        <div className="checkout-empty">
          <h2 style={{ fontFamily: 'var(--font-body)', fontWeight: 600 }}>Your cart is empty</h2>
          <p className="koro-muted" style={{ marginBottom: 'var(--space-5)' }}>
            Add something you love and come back when you&apos;re ready to checkout.
          </p>
          <Button variant="accent" icon="arrow" onClick={() => navigate('/shop')}>Start shopping</Button>
        </div>
      </div>
    )
  }

  function saveContact() {
    const parsed = contactSchema.safeParse(contactDraft)
    if (!parsed.success) {
      setErrors(flattenIssues(parsed.error))
      return
    }
    setErrors({})
    setContact(parsed.data)
    if (saveToProfile) {
      saveProfileContact(parsed.data)
      toast.success('Saved to your profile', 'Your account contact details were updated.')
    }
    setEditingContact(false)
  }

  async function handleContinue() {
    const nextErrors: Record<string, string> = {}
    const c = contactSchema.safeParse(contact)
    if (!c.success) Object.assign(nextErrors, flattenIssues(c.error))
    const r = recipientSchema.safeParse(recipient)
    if (!r.success) Object.assign(nextErrors, flattenIssues(r.error))
    const d = deliveryAddressSchema.safeParse(delivery)
    if (!d.success) Object.assign(nextErrors, flattenIssues(d.error))

    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      if (!isSelf) setAddressEditing(true)
      toast.error('Check your details', 'Some required information is missing. Review the highlighted fields.')
      return
    }

    setErrors({})
    setPlacing(true)
    const id = toast.loading('Placing your order…')
    try {
      await delay(300)
      const serverAvailable = await apiAvailable()
      const payload = {
        accountUserId: profile.user.id,
        contact,
        recipient,
        delivery,
        lines,
        express: shipMethod === 'express',
        gateway,
      }
      // With the API present the server re-prices and returns the authoritative
      // total; otherwise we fall back to the local (demo) order builder.
      const order = serverAvailable ? await apiCreateOrder(payload) : createOrder(payload)
      if (serverAvailable) upsertOrder(order) // mirror for the order/confirmation screens
      setPaymentProvider(order.id, gateway)
      toast.update(id, { type: 'success', title: 'Order created', message: `Order ${order.orderNumber} has been created.` })
      clearCart()
      navigate(`/checkout/payment?order=${order.id}`)
    } catch (e) {
      const message = e instanceof Error ? e.message : "We couldn't create your order. Please try again."
      toast.update(id, { type: 'error', title: 'Checkout failed', message, action: { label: 'Try again', onAction: () => handleContinue() } })
      setPlacing(false)
    }
  }

  return (
    <div className="checkout-root">
      <div className="checkout-layout">
        {/* ------------------------------- Header ------------------------------- */}
        {/* Brand lockup, then the page title, then one line of reassurance. The
            header spans both columns so it reads first at every breakpoint,
            instead of living inside the summary column and stacking below the
            form on mobile. */}
        <header className="checkout-header">
          <div className="checkout-brand">
            <span className="mark"><Sparkle /></span>
            <span className="name">KORO</span>
          </div>
          <h1 className="checkout-title">Checkout</h1>
          <p className="checkout-value-prop">Secure, fast delivery across Nigeria.</p>
        </header>

        {/* ------------------------------ Left: order summary ------------------------------ */}
        <aside className="checkout-summary">
          <section className="checkout-plans" aria-label="Order summary">
            <header className="checkout-plans-header">
              <h2>Your Order</h2>
              <button type="button" onClick={() => navigate('/cart')}>Edit cart</button>
            </header>
            {hydrated.map((l) => (
              <div key={l.product.id} className="checkout-plan">
                <span className="thumb">
                  {l.product.imageUrl && (
                    <img src={l.product.imageUrl} alt="" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  )}
                </span>
                <span className="checkout-plan-info">
                  <span className="name">{l.product.name}</span>
                  <span className="meta">Qty ×{l.quantity}</span>
                </span>
                <span className="checkout-plan-price">{formatNaira(l.lineTotal)}</span>
              </div>
            ))}
          </section>

          <div className="checkout-totals" aria-label="Order totals">
            <div className="checkout-total-row"><span>Subtotal</span><strong>{formatNaira(subtotal)}</strong></div>
            <div className="checkout-total-row"><span>Delivery</span><strong>{delivery.state ? formatNaira(deliveryFee) : '—'}</strong></div>
            <div className="checkout-grand-total">
              <span className="label">Total</span>
              <span className="value">{formatNaira(total)}</span>
            </div>
          </div>

          <footer className="checkout-footer">
            © 2026 · <a href="#">Privacy</a> · <a href="#">Terms</a>
          </footer>
        </aside>

        {/* ------------------------------ Right: checkout form ------------------------------ */}
        <main className="checkout-main">
          {/* Contact information */}
          <section className="checkout-card-panel">
            <div className="checkout-section-head">
              <h2 className="checkout-section-title">Contact information</h2>
              {!editingContact && (
                <button type="button" className="checkout-link" onClick={() => { setContactDraft(contact); setEditingContact(true) }}>
                  Edit
                </button>
              )}
            </div>

            {editingContact ? (
              <div className="checkout-form-grid">
                <InputField label="Full name" value={contactDraft.name} onChange={(e) => setContactDraft((c) => ({ ...c, name: e.target.value }))} error={errors.name} autoComplete="name" />
                <div className="checkout-form-grid cols-2">
                  <InputField label="Email address" type="email" value={contactDraft.email} onChange={(e) => setContactDraft((c) => ({ ...c, email: e.target.value }))} error={errors.email} autoComplete="email" />
                  <InputField label="Phone number" value={contactDraft.phone} onChange={(e) => setContactDraft((c) => ({ ...c, phone: e.target.value }))} error={errors.phone} hint="e.g. 0803 123 4567" autoComplete="tel" />
                </div>
                <label className="checkout-check">
                  <input type="checkbox" checked={saveToProfile} onChange={(e) => setSaveToProfile(e.target.checked)} />
                  <span>Save these details to my profile</span>
                </label>
                <div className="koro-row">
                  <Button variant="secondary" size="sm" onClick={() => { setEditingContact(false); setErrors({}) }}>Cancel</Button>
                  <Button variant="primary" size="sm" onClick={saveContact}>Save changes</Button>
                </div>
              </div>
            ) : (
              <div className="checkout-summary-card">
                <span className="checkout-summary-card-body">
                  <span className="line strong">{contact.name}</span>
                  <span className="line">{contact.email}</span>
                  <span className="line">{contact.phone}</span>
                </span>
              </div>
            )}
          </section>

          {/* Delivery information */}
          <section className="checkout-card-panel">
            <h2 className="checkout-section-title">Delivery information</h2>

            <div className="checkout-toggle" role="radiogroup" aria-label="Who is receiving this order">
              <button type="button" role="radio" aria-checked={isSelf} className={`checkout-toggle-option ${isSelf ? 'is-active' : ''}`} onClick={() => setDeliverTo('me')}>
                <Icon name="user" /> Deliver to me
              </button>
              <button type="button" role="radio" aria-checked={!isSelf} className={`checkout-toggle-option ${!isSelf ? 'is-active' : ''}`} onClick={() => setDeliverTo('someone')}>
                <Icon name="bag" /> Deliver to someone else
              </button>
            </div>

            {isSelf ? (
              <div className="checkout-summary-card" style={{ marginTop: 'var(--space-4)' }}>
                <span className="checkout-summary-card-body">
                  <span className="line strong">{recipient.name}</span>
                  <span className="line">{delivery.address ? `${delivery.address}, ${delivery.city}, ${delivery.state}` : 'No saved address — add one below'}</span>
                </span>
                <button type="button" className="checkout-link" onClick={() => setAddressEditing((v) => !v)}>
                  {addressEditing ? 'Done' : 'Edit'}
                </button>
              </div>
            ) : (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <div className="checkout-eyebrow">Recipient details</div>
                <div className="checkout-form-grid">
                  <div className="checkout-form-grid cols-2">
                    <InputField label="Full name" value={recipientDraft.name} onChange={(e) => setR('name')(e.target.value)} error={errors.name} placeholder="Recipient's full name" />
                    <InputField label="Phone number" value={recipientDraft.phone} onChange={(e) => setR('phone')(e.target.value)} error={errors.phone} placeholder="Recipient's phone" />
                  </div>
                  <InputField label="Email address (optional)" type="email" value={recipientDraft.email ?? ''} onChange={(e) => setR('email')(e.target.value)} error={errors.email} placeholder="Recipient's email" />
                </div>
              </div>
            )}

            {(isSelf ? addressEditing : true) && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <div className="checkout-eyebrow">Delivery address</div>
                <div className="checkout-form-grid">
                  <InputField label="Address" value={delivery.address} onChange={(e) => setD('address')(e.target.value)} error={errors.address} placeholder="Street address" autoComplete="street-address" />
                  <div className="checkout-form-grid cols-3">
                    <SelectField label="State" value={delivery.state} onChange={(e) => setD('state')(e.target.value)} error={errors.state}>
                      <option value="">Select state</option>
                      {NIGERIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </SelectField>
                    <InputField label="City" value={delivery.city} onChange={(e) => setD('city')(e.target.value)} error={errors.city} autoComplete="address-level2" />
                    <InputField label="Postal code (optional)" value={delivery.postalCode} onChange={(e) => setD('postalCode')(e.target.value)} autoComplete="postal-code" />
                  </div>
                  <TextareaField label="Additional delivery instructions (optional)" value={delivery.instructions} onChange={(e) => setD('instructions')(e.target.value)} rows={2} />
                </div>
              </div>
            )}
          </section>

          {/* Shipping method */}
          <section className="checkout-card-panel">
            <h2 className="checkout-section-title">Shipping method</h2>
            <div className="checkout-options">
              <button type="button" className={`checkout-option ${shipMethod === 'standard' ? 'checkout-option--selected' : ''}`} onClick={() => setShipMethod('standard')} aria-pressed={shipMethod === 'standard'}>
                <span className="head">
                  <Icon name="truck" />
                  {shipMethod === 'standard' && <span className="check"><Icon name="check" /></span>}
                </span>
                <span className="label">Standard</span>
                <span className="sub">2–4 business days · {baseFee ? formatNaira(baseFee) : '—'}</span>
              </button>
              <button type="button" className={`checkout-option ${shipMethod === 'express' ? 'checkout-option--selected' : ''}`} onClick={() => setShipMethod('express')} aria-pressed={shipMethod === 'express'}>
                <span className="head">
                  <Icon name="bolt" />
                  {shipMethod === 'express' && <span className="check"><Icon name="check" /></span>}
                </span>
                <span className="label">Express</span>
                <span className="sub">1–2 business days · {baseFee ? formatNaira(baseFee + EXPRESS_SURCHARGE) : '—'}</span>
              </button>
            </div>
          </section>

          {/* Payment method */}
          <section className="checkout-card-panel">
            <h2 className="checkout-section-title">Payment method</h2>
            <div className="checkout-options">
              {GATEWAYS.map((g) => (
                <button key={g.id} type="button" className={`checkout-option ${gateway === g.id ? 'checkout-option--selected' : ''}`} onClick={() => setGateway(g.id)} aria-pressed={gateway === g.id}>
                  <span className="head">
                    <Icon name={g.icon} />
                    {gateway === g.id && <span className="check"><Icon name="check" /></span>}
                  </span>
                  <span className="label">{g.label}</span>
                  <span className="sub">{g.sub}</span>
                </button>
              ))}
            </div>
          </section>

          <button type="button" className="checkout-pay" disabled={placing} onClick={handleContinue}>
            {placing ? 'Placing order…' : <>Continue to Payment · {formatNaira(total)} <Icon name="lock" /></>}
          </button>

          <div className="checkout-trust">
            <span className="ssl"><Icon name="shield" /> SSL Secured</span>
            <span><Icon name="truck" /> Fast Delivery</span>
            <span><Icon name="lock" /> Secure Payment</span>
            <span><Icon name="credit" /> PCI-DSS L1</span>
          </div>
        </main>
      </div>
    </div>
  )
}

/* ------------------------------- Payment ------------------------------- */

export function PaymentPage() {
  const [searchParams] = useSearchParams()
  const orderId = searchParams.get('order')
  const navigate = useNavigate()
  const toast = useToast()
  const [order] = useState<Order | null>(() => (orderId ? getOrder(orderId) ?? null : null))
  const [gateway, setGateway] = useState<GatewayId>(() => {
    const o = orderId ? getOrder(orderId) : undefined
    return o?.payment.provider === 'flutterwave' ? 'flutterwave' : 'bachs'
  })
  const [busy, setBusy] = useState(false)
  const [apiReady, setApiReady] = useState(false)

  useEffect(() => {
    let alive = true
    apiAvailable()
      .then((ok) => { if (alive) setApiReady(ok) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  if (!order) {
    return (
      <div className="checkout-root">
        <div className="checkout-empty">
          <h2 style={{ fontFamily: 'var(--font-body)', fontWeight: 600 }}>Order not found</h2>
          <Button variant="primary" onClick={() => navigate('/shop')}>Continue shopping</Button>
        </div>
      </div>
    )
  }

  const realMode = gateway === 'bachs' ? apiReady : Boolean(FLUTTERWAVE_PUBLIC_KEY)
  const gatewayName = gateway === 'bachs' ? 'Bachs.io' : 'Flutterwave'
  const reference = order.payment.reference

  async function handlePay() {
    if (busy) {
      toast.info('Payment already in progress', "We're already processing this payment.")
      return
    }
    setBusy(true)
    setPaymentProvider(order!.id, gateway)
    const id = toast.loading('Opening secure payment…', `Redirecting you to ${gatewayName}.`)
    try {
      await openGatewayPayment(gateway, order!, async (result) => {
        if (result === 'cancelled') {
          toast.update(id, { type: 'info', title: 'Payment cancelled', message: 'No charge was made.' })
          setBusy(false)
          return
        }
        toast.update(id, { type: 'loading', title: 'Confirming payment…', message: "We're verifying your transaction." })
        const outcome: PaymentResult = result === 'success' ? 'success' : result === 'failed' ? 'failed' : 'processing'
        await settlePayment(order!.id, outcome)
        navigate(`/payment/callback?reference=${encodeURIComponent(reference)}`)
      })
    } catch {
      toast.update(id, { type: 'error', title: 'Payment failed to start', message: "We couldn't initialize your payment. You haven't been charged." })
      setBusy(false)
    }
  }

  async function simulate(result: PaymentResult) {
    if (busy) return
    setBusy(true)
    const id = toast.loading('Processing payment…')
    await settlePayment(order!.id, result)
    toast.dismiss(id)
    navigate(`/payment/callback?reference=${encodeURIComponent(reference)}`)
  }

  return (
    <div className="checkout-root">
      <div className="checkout-layout" style={{ maxWidth: 920 }}>
        <aside className="checkout-summary">
          <div className="checkout-brand">
            <span className="mark"><Sparkle /></span>
            <span>
              <span className="name">KORO</span>{' '}
              <span className="sub">Payment</span>
            </span>
          </div>
          <OrderSummaryFromOrder order={order} />
        </aside>

        <main className="checkout-main">
          <h2 className="checkout-section-title">Select payment provider</h2>

          <div className="checkout-options">
            {GATEWAYS.map((g) => (
              <button key={g.id} type="button" className={`checkout-option ${gateway === g.id ? 'checkout-option--selected' : ''}`} onClick={() => { setGateway(g.id); setPaymentProvider(order.id, g.id) }} aria-pressed={gateway === g.id}>
                <span className="head">
                  <Icon name={g.icon} />
                  {gateway === g.id && <span className="check"><Icon name="check" /></span>}
                </span>
                <span className="label">{g.label}</span>
                <span className="sub">{g.sub}</span>
              </button>
            ))}
          </div>

          {realMode ? (
            <>
              <div className="koro-notice koro-notice--info" style={{ margin: 'var(--space-5) 0' }}>
                <Icon name="shield" />
                <span>{gatewayName} test mode is active — no real charge will be made.</span>
              </div>
              <button type="button" className="checkout-pay" disabled={busy} onClick={handlePay}>
                {busy ? 'Processing…' : <>Pay {formatNaira(order.total)} <Icon name="lock" /></>}
              </button>
            </>
          ) : (
            <>
              <div className="koro-notice koro-notice--warning" style={{ margin: 'var(--space-5) 0' }}>
                <Icon name="info" />
                <span>No {gatewayName} sandbox key is configured — the gateway response is simulated below.</span>
              </div>
              <div className="checkout-card-panel koro-stack">
                <Button variant="primary" loading={busy} onClick={() => simulate('success')}>Simulate successful payment</Button>
                <Button variant="secondary" loading={busy} onClick={() => simulate('failed')}>Simulate failed payment</Button>
                <Button variant="secondary" loading={busy} onClick={() => simulate('processing')}>Simulate pending payment</Button>
              </div>
            </>
          )}

          <div className="checkout-trust" style={{ marginTop: 'var(--space-5)' }}>
            <span className="ssl"><Icon name="shield" /> SSL Secured</span>
            <span><Icon name="lock" /> Secure Payment</span>
            <span><Icon name="credit" /> PCI-DSS L1</span>
          </div>

          <div className="koro-row" style={{ justifyContent: 'center', marginTop: 'var(--space-3)' }}>
            <Link to="/checkout" style={{ fontSize: 'var(--font-size-body-sm)', color: 'var(--color-text-secondary)' }}>← Back to checkout</Link>
          </div>
        </main>
      </div>
    </div>
  )
}
