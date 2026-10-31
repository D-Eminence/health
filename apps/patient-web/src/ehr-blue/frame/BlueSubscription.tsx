import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  EhrBadge, EhrButton, EhrCard, EhrDataTable, EhrEmptyState, EhrPageHeading, type EhrBadgeTone,
} from '@hid/ui/ehr'
import { billingApi } from '../../staff/api'
import { useStaff } from '../../staff/App'
import {
  canPayNow, formatDate, formatMoney, formatPrice, paystackCheckoutUrl, readInvoices, readSubscription, TRIAL_DAYS,
  billingProblem, type BillingRead, type Invoice, type Subscription,
} from '../../staff/billing'
import { PRODUCT_LABELS, STATUS, statusDetail } from '../../staff/routes/Billing'
import { blueForAll } from '../blueFacilities'
import { LivePage } from './LivePages'

const TONE: Record<(typeof STATUS)[keyof typeof STATUS]['tone'], EhrBadgeTone> = {
  success: 'positive', warning: 'caution', danger: 'critical', neutral: 'neutral', information: 'brand',
}

/**
 * /provider/billing in the blue EHR: today's page (LivePage) until the clinic switch is on, and the design's Facility
 * subscription page after it (screens/6-subscription).
 */
export function FacilitySubscriptionPage() {
  return blueForAll() ? <BlueSubscription /> : <LivePage />
}

/**
 * The design's Facility subscription (screens/6-subscription), on today's billing: the same reads (the plan and the
 * invoices), the same actions (start the free trial, pay through Paystack's checkout), the same return from Paystack and
 * today's words for every state and refusal (staff/routes/Billing.tsx). Its cards are the design's: Current plan,
 * Renewal reminders (Health ID sends none yet, and the card says so) and Subscription history (the invoices). The
 * design's simulated plan and its controls are not drawn.
 */
export function BlueSubscription() {
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

  if (!facility || !canRead) return <>
    <EhrPageHeading title="Facility subscription" />
    <EhrEmptyState title="Billing access unavailable" message="Your facility administrator manages the plan and billing for this facility." />
  </>

  if (subscription.kind === 'unavailable') return <>
    <EhrPageHeading title="Facility subscription" />
    <EhrEmptyState title="Billing isn't available yet"
      message="Plans, free trials and payment are not switched on for Health ID yet. Your facility can keep using the Provider Portal in the meantime." />
  </>

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
  const actions = plan && canManage ? <>
    {plan.status === 'none' && <EhrButton onClick={() => void startTrial()} disabled={busy !== null}>
      {busy === 'trial' ? 'Starting your trial…' : `Start ${TRIAL_DAYS}-day free trial`}</EhrButton>}
    {payable && <EhrButton variant={plan.status === 'none' ? 'secondary' : 'primary'} onClick={() => void payNow()} disabled={busy !== null}>
      {busy === 'pay' ? 'Opening payment…' : 'Pay now'}</EhrButton>}
  </> : null
  const urgent = plan !== null && (plan.status === 'past_due' || plan.status === 'read_only')

  return <>
    <EhrPageHeading eyebrow="Separate from patient billing" title="Facility subscription"
      description="Your facility’s plan, free trial and invoices. Patients are never charged for Health ID." />

    {returnNote && plan && <p role="status" className="hid-ehr-blue-flush">
      {plan.status === 'active' ? 'Payment received. Thank you.'
        : 'We have not confirmed your payment yet. This page shows it once Paystack confirms it.'}
      {plan.status !== 'active' && <> <EhrButton variant="quiet" size="sm" onClick={() => setReload(value => value + 1)}>Check again</EhrButton></>}
    </p>}

    {subscription.kind === 'loading' && <p role="status" className="hid-ehr-blue-muted">Loading your plan…</p>}
    {subscription.kind === 'error' && <div className="hid-ehr-blue-stack">
      <p role="alert" className="hid-ehr-error">{subscription.message}</p>
      <EhrButton variant="secondary" size="sm" onClick={() => setReload(value => value + 1)}>Try again</EhrButton>
    </div>}

    {plan && <section aria-labelledby="hid-ehr-blue-plan-title" className={urgent ? 'hid-ehr-blue-plan hid-ehr-blue-plan-urgent' : 'hid-ehr-blue-plan'}>
      <div className="hid-ehr-blue-plan-text">
        <p className="hid-ehr-blue-plan-eyebrow">{PRODUCT_LABELS[plan.productCode] ?? plan.productCode}</p>
        <h2 id="hid-ehr-blue-plan-title" className="hid-ehr-blue-plan-title">{STATUS[plan.status].label}</h2>
        <p className="hid-ehr-blue-flush">{statusDetail(plan)}</p>
      </div>
      {actions ? <div className="hid-ehr-actions">{actions}</div> : null}
    </section>}

    {plan && <EhrCard title="Current plan">
      <dl className="hid-ehr-blue-facts">
        <div className="hid-ehr-blue-fact"><dt>Plan</dt><dd>{PRODUCT_LABELS[plan.productCode] ?? plan.productCode}</dd></div>
        <div className="hid-ehr-blue-fact"><dt>Status</dt><dd><EhrBadge tone={TONE[STATUS[plan.status].tone]}>{STATUS[plan.status].label}</EhrBadge></dd></div>
        {priceText && <div className="hid-ehr-blue-fact"><dt>Price</dt><dd>{priceText}</dd></div>}
        {plan.trialEndsAt && <div className="hid-ehr-blue-fact"><dt>Trial ends</dt><dd>{formatDate(plan.trialEndsAt)}</dd></div>}
        {plan.currentPeriodEndsAt && <div className="hid-ehr-blue-fact"><dt>Renews on</dt><dd>{formatDate(plan.currentPeriodEndsAt)}</dd></div>}
        {plan.graceEndsAt && <div className="hid-ehr-blue-fact"><dt>Pay by</dt><dd>{formatDate(plan.graceEndsAt)}</dd></div>}
      </dl>
      {canManage && !plan.selfServePayment && plan.status !== 'active' &&
        <p className="hid-ehr-blue-muted">This plan is priced by Health ID sales. Contact Health ID sales to pay for it.</p>}
      {!canManage && plan.status !== 'active' && <p className="hid-ehr-blue-muted">Only your facility administrator can start a trial or pay.</p>}
      {actionError && <p role="alert" className="hid-ehr-error">{actionError}</p>}
      {payable && <p className="hid-ehr-blue-muted">Payment opens Paystack’s secure checkout. Card details never pass through Health ID.</p>}
    </EhrCard>}

    {/* The design's Renewal reminders: Health ID sends none yet, so the card says so, with no sample rows on a live page. */}
    {plan && <EhrCard title="Renewal reminders">
      <p className="hid-ehr-blue-flush">No renewal reminders yet.</p>
      <p className="hid-ehr-blue-muted">Health ID does not send renewal reminders by email or text message yet. The dates above are your plan’s.</p>
    </EhrCard>}

    {/* The design's Subscription history: the facility's invoices, as today's billing page lists them. */}
    <EhrCard title="Subscription history">
      {invoices.kind === 'loading' && <p role="status" className="hid-ehr-blue-muted">Loading invoices…</p>}
      {invoices.kind === 'error' && <p role="alert" className="hid-ehr-error">{invoices.message}</p>}
      {invoices.kind === 'unavailable' && <p className="hid-ehr-blue-muted">Invoices are not available yet.</p>}
      {invoices.kind === 'ready' && (invoices.value.length === 0
        ? <p className="hid-ehr-blue-muted">No invoices yet. Your first invoice appears here after you pay.</p>
        : <EhrDataTable caption="Invoices" captionHidden rows={invoices.value} rowKey={invoice => invoice.id} columns={[
          { id: 'number', header: 'Invoice', cell: invoice => invoice.number },
          { id: 'date', header: 'Date', cell: invoice => formatDate(invoice.issuedAt) },
          { id: 'amount', header: 'Amount', cell: invoice => formatMoney(invoice.amount_minor, invoice.currency) },
          { id: 'status', header: 'Status', cell: invoice => <EhrBadge
            tone={invoice.status === 'paid' ? 'positive' : invoice.status === 'open' ? 'caution' : 'neutral'}>
            {invoice.status === 'paid' ? 'Paid' : invoice.status === 'open' ? 'Open' : 'Void'}</EhrBadge> },
        ]} />)}
    </EhrCard>
  </>
}
