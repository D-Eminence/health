import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Badge, Button, Card, EmptyState } from '@hid/ui'
import { billingApi } from '../api'
import { useStaff } from '../App'
import {
  billingNotice, billingProblem, canPayNow, daysLeft, formatDate, formatMoney, formatPrice, paystackCheckoutUrl,
  readInvoices, readSubscription, TRIAL_DAYS, type BillingRead, type Invoice, type Subscription,
} from '../billing'

const PRODUCT_LABELS: Record<string, string> = {
  ehr: 'Health ID EHR', laboratory: 'Health ID Laboratory', pharmacy: 'Health ID Pharmacy', migrate: 'Health ID Migrate',
}

const STATUS: Record<Subscription['status'], { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'information' }> = {
  none: { label: 'No plan yet', tone: 'neutral' },
  trialing: { label: 'Free trial', tone: 'information' },
  active: { label: 'Active', tone: 'success' },
  past_due: { label: 'Payment due', tone: 'danger' },
  read_only: { label: 'Read-only', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

function statusDetail(subscription: Subscription): string {
  switch (subscription.status) {
    case 'none': return `Start a ${TRIAL_DAYS}-day free trial, or pay now. No card is needed for the trial.`
    case 'trialing': {
      const end = subscription.trialEndsAt!
      const days = daysLeft(end)
      return `${days === 0 ? 'Ends today' : `${days} ${days === 1 ? 'day' : 'days'} left`}. Your trial ends on ${formatDate(end)}.`
    }
    case 'active': return subscription.currentPeriodEndsAt ? `Paid. Renews on ${formatDate(subscription.currentPeriodEndsAt)}.` : 'Paid.'
    case 'past_due': return subscription.graceEndsAt ? `Your renewal did not go through. Pay by ${formatDate(subscription.graceEndsAt)} to keep full access.` : 'Your renewal did not go through. Pay now to keep full access.'
    case 'read_only': return 'Your plan is not paid, so staff can view records but cannot add or change them. Pay to restore full access.'
    case 'cancelled': return 'This plan has been cancelled. Contact Health ID to start a new one.'
  }
}

/** /provider/billing: the facility's plan, trial and invoices (docs/BILLING_SPEC.md). */
export function Billing() {
  const { state } = useStaff()
  const location = useLocation()
  const navigate = useNavigate()
  const facility = state.status === 'ready' ? state.session.actor.facility : undefined
  const facilityId = facility?.id ?? ''
  const canRead = facility?.permissions.includes('billing.subscription.read') ?? false
  const canManage = facility?.permissions.includes('billing.subscription.manage') ?? false
  const [subscription, setSubscription] = useState<BillingRead<Subscription>>({ kind: 'loading' })
  const [invoices, setInvoices] = useState<BillingRead<Invoice[]>>({ kind: 'loading' })
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState<'trial' | 'pay' | null>(null)
  const [actionError, setActionError] = useState('')
  // Back from Paystack (?reference=): only the server's answer says whether the payment went through.
  const returned = useRef(new URLSearchParams(location.search).has('reference'))
  const [returnNote] = useState(returned.current)

  useEffect(() => {
    if (returned.current) navigate('/provider/billing', { replace: true })
  }, [navigate])

  useEffect(() => {
    if (!facilityId || !canRead) return
    let active = true
    setSubscription({ kind: 'loading' })
    setInvoices({ kind: 'loading' })
    billingApi.subscription(facilityId).then(readSubscription)
      .then(value => { if (active) setSubscription({ kind: 'ready', value }) })
      .catch(caught => { if (active) setSubscription(billingProblem(caught, 'Your plan could not be loaded.')) })
    billingApi.invoices(facilityId).then(readInvoices)
      .then(value => { if (active) setInvoices({ kind: 'ready', value }) })
      .catch(caught => { if (active) setInvoices(billingProblem(caught, 'Invoices could not be loaded.')) })
    return () => { active = false }
  }, [facilityId, canRead, reload])

  if (!facility || !canRead) return <EmptyState titleAs="h1" title="Billing access unavailable"
    description="Your facility administrator manages the plan and billing for this facility." />

  if (subscription.kind === 'unavailable') return <EmptyState titleAs="h1" title="Billing isn't available yet"
    description="Plans, free trials and payment are not switched on for Health ID yet. Your facility can keep using the Provider Portal in the meantime." />

  async function startTrial() {
    if (busy) return
    setBusy('trial')
    setActionError('')
    try {
      const value = readSubscription(await billingApi.startTrial(facilityId))
      setSubscription({ kind: 'ready', value })
    } catch (caught) {
      const problem = billingProblem(caught, 'Your free trial could not be started. Try again.')
      setActionError(problem.kind === 'error' ? problem.message : 'Free trials are not available yet.')
    } finally { setBusy(null) }
  }

  async function payNow() {
    if (busy) return
    setBusy('pay')
    setActionError('')
    try {
      const url = paystackCheckoutUrl(await billingApi.checkout(facilityId))
      if (!url) throw new Error('Payment could not be started. Try again later.')
      window.location.assign(url)
    } catch (caught) {
      const problem = billingProblem(caught, 'Payment could not be started. Try again.')
      setActionError(problem.kind === 'error' ? problem.message : 'Online payment is not available yet.')
      setBusy(null)
    }
  }

  const plan = subscription.kind === 'ready' ? subscription.value : null
  const priceText = plan ? formatPrice(plan.price) : null
  const payable = plan !== null && canManage && canPayNow(plan) && plan.price !== null && plan.price.amount_minor !== null

  return <>
    <div className="staff-page-head">
      <p className="staff-eyebrow">{facility.name}</p>
      <h1>Plan &amp; billing.</h1>
      <p>Your facility&rsquo;s plan, free trial and invoices. Patients are never charged for Health ID.</p>
    </div>

    {returnNote && plan && <p role="status" className={plan.status === 'active' ? 'staff-success billing-note' : 'staff-notice billing-note'}>
      {plan.status === 'active' ? 'Payment received. Thank you.'
        : 'We have not confirmed your payment yet. This page shows it once Paystack confirms it.'}
      {plan.status !== 'active' && <> <Button tone="quiet" size="sm" onClick={() => setReload(value => value + 1)}>Check again</Button></>}
    </p>}

    <section aria-labelledby="billing-plan-title" className="billing-section">
      <h2 id="billing-plan-title" className="billing-heading">Your plan</h2>
      {subscription.kind === 'loading' && <p role="status" className="staff-muted">Loading your plan…</p>}
      {subscription.kind === 'error' && <div className="billing-problem"><p role="alert" className="staff-error">{subscription.message}</p>
        <Button tone="secondary" size="sm" onClick={() => setReload(value => value + 1)}>Try again</Button></div>}
      {plan && <Card className="billing-plan">
        <div className="billing-plan-row">
          <span className="billing-product">{PRODUCT_LABELS[plan.productCode] ?? plan.productCode}</span>
          <Badge tone={STATUS[plan.status].tone}>{STATUS[plan.status].label}</Badge>
        </div>
        <p className="billing-detail">{statusDetail(plan)}</p>
        {priceText && <p className="billing-price">{priceText}</p>}
        {canManage && <div className="billing-actions">
          {plan.status === 'none' && <Button onClick={() => void startTrial()} disabled={busy !== null}>
            {busy === 'trial' ? 'Starting your trial…' : `Start ${TRIAL_DAYS}-day free trial`}</Button>}
          {payable && <Button tone={plan.status === 'none' ? 'secondary' : 'primary'} onClick={() => void payNow()} disabled={busy !== null}>
            {busy === 'pay' ? 'Opening payment…' : 'Pay now'}</Button>}
          {!plan.selfServePayment && plan.status !== 'active' && <p className="staff-muted">This plan is priced by Health ID sales. Contact Health ID sales to pay for it.</p>}
        </div>}
        {!canManage && plan.status !== 'active' && <p className="staff-muted">Only your facility administrator can start a trial or pay.</p>}
        {actionError && <p role="alert" className="staff-error">{actionError}</p>}
        {payable && <p className="staff-muted">Payment opens Paystack&rsquo;s secure checkout. Card details never pass through Health ID.</p>}
      </Card>}
    </section>

    <section aria-labelledby="billing-invoices-title" className="billing-section">
      <h2 id="billing-invoices-title" className="billing-heading">Invoices</h2>
      {invoices.kind === 'loading' && <p role="status" className="staff-muted">Loading invoices…</p>}
      {invoices.kind === 'error' && <p role="alert" className="staff-error">{invoices.message}</p>}
      {invoices.kind === 'unavailable' && <p className="staff-muted">Invoices are not available yet.</p>}
      {invoices.kind === 'ready' && (invoices.value.length === 0
        ? <p className="staff-muted">No invoices yet. Your first invoice appears here after you pay.</p>
        : <div className="billing-table-wrap"><table className="billing-table">
          <thead><tr><th scope="col">Invoice</th><th scope="col">Date</th><th scope="col">Amount</th><th scope="col">Status</th></tr></thead>
          <tbody>{invoices.value.map(invoice => <tr key={invoice.id}>
            <td>{invoice.number}</td>
            <td>{formatDate(invoice.issuedAt)}</td>
            <td className="billing-amount">{formatMoney(invoice.amount_minor, invoice.currency)}</td>
            <td><Badge tone={invoice.status === 'paid' ? 'success' : invoice.status === 'open' ? 'warning' : 'neutral'}>
              {invoice.status === 'paid' ? 'Paid' : invoice.status === 'open' ? 'Open' : 'Void'}</Badge></td>
          </tr>)}</tbody>
        </table></div>)}
    </section>
  </>
}

/**
 * The workspace banner (docs/BILLING_SPEC.md). For a facility administrator
 * whose facility has no plan yet (just after sign-up), it invites them to start
 * the free trial; for anyone who can read the plan, it warns of a trial in its
 * last days, a payment due, or a read-only facility. Never shown while billing
 * is not available.
 */
export function BillingBanner() {
  const { state } = useStaff()
  const { pathname } = useLocation()
  const facility = state.status === 'ready' ? state.session.actor.facility : undefined
  const facilityId = facility?.id ?? ''
  const canRead = facility?.permissions.includes('billing.subscription.read') ?? false
  const canManage = facility?.permissions.includes('billing.subscription.manage') ?? false
  const [plan, setPlan] = useState<{ facilityId: string; value: Subscription } | null>(null)

  useEffect(() => {
    if (!facilityId || !canRead) return
    let active = true
    void (async () => {
      try {
        const value = readSubscription(await billingApi.subscription(facilityId))
        if (active) setPlan({ facilityId, value })
      } catch { if (active) setPlan(null) }
    })()
    return () => { active = false }
  }, [facilityId, canRead])

  if (!canRead || !plan || plan.facilityId !== facilityId || pathname.startsWith('/provider/billing')) return null
  const status = plan.value.status
  const notice = status === 'none'
    ? canManage ? { tone: 'information', text: `Your facility has no plan yet. Start your ${TRIAL_DAYS}-day free trial. No card is needed.` } : null
    : billingNotice(plan.value)
  if (!notice) return null
  return <div role="status" className={`billing-banner billing-banner-${notice.tone}`}>
    <span>{notice.text}</span>
    <Link to="/provider/billing">{status === 'none' ? 'Choose how to start' : status === 'trialing' ? 'Choose a plan' : 'Pay now'}</Link>
  </div>
}
