import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { RotateCcw } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader, DescriptionList, EmptyState, PageHeader, cx, type Tone } from '../../kasuwa/ui'
import { PageState } from '../../kasuwa/parts'
import { billingApi } from '../../staff/api'
import { useStaff } from '../../staff/App'
import {
  canPayNow, formatDate, formatMoney, formatPrice, paystackCheckoutUrl, readInvoices, readSubscription, TRIAL_DAYS,
  billingProblem, type BillingRead, type Invoice, type Subscription,
} from '../../staff/billing'
import { PRODUCT_LABELS, STATUS, statusDetail } from '../../staff/routes/Billing'
import { blueForAll } from '../blueFacilities'
import { LivePage } from './LivePages'

const TONE: Record<(typeof STATUS)[keyof typeof STATUS]['tone'], Tone> = {
  success: 'success', warning: 'warn', danger: 'danger', neutral: 'neutral', information: 'info',
}

const TITLE = 'Facility subscription'
const EYEBROW = <p className="m-0 text-[13px] font-medium text-ink-3">Separate from patient billing</p>

/**
 * /provider/billing in the blue EHR: today's page (LivePage) until the clinic switch is on, and the design's Facility
 * subscription page after it (screens/6-subscription).
 */
export function FacilitySubscriptionPage() {
  return blueForAll() ? <BlueSubscription /> : <LivePage />
}

/**
 * Facility subscription in the redesign's look, on today's billing: the same reads (the plan and the invoices), the
 * same actions (start the free trial, pay through Paystack's checkout), the same return from Paystack and today's words
 * for every state and refusal (staff/routes/Billing.tsx). Its cards: Current plan, Renewal reminders (Health ID sends
 * none yet, and the card says so) and Subscription history (the invoices).
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

  if (!facility || !canRead) return <div className="flex flex-col gap-6">
    <PageHeader title={TITLE} />
    <EmptyState title="Billing access unavailable" description="Your facility administrator manages the plan and billing for this facility." />
  </div>

  if (subscription.kind === 'unavailable') return <div className="flex flex-col gap-6">
    <PageHeader title={TITLE} />
    <EmptyState title="Billing isn't available yet" description="Plans, free trials and payment aren’t switched on yet." />
  </div>

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
    {payable && <Button variant={plan.status === 'none' ? 'secondary' : 'primary'} loading={busy === 'pay'} onClick={() => void payNow()}
      disabled={busy !== null}>{busy === 'pay' ? 'Opening payment…' : 'Pay now'}</Button>}
    {plan.status === 'none' && <Button variant="primary" loading={busy === 'trial'} onClick={() => void startTrial()} disabled={busy !== null}>
      {busy === 'trial' ? 'Starting your trial…' : `Start ${TRIAL_DAYS}-day free trial`}</Button>}
  </> : null
  const urgent = plan !== null && (plan.status === 'past_due' || plan.status === 'read_only')
  const reread = () => setReload(value => value + 1)

  return <div className="@container flex flex-col gap-6">
    <PageHeader eyebrow={EYEBROW} title={TITLE} description="Your facility’s plan, free trial and invoices. Patients are never charged for Health ID." />

    {returnNote && plan && (plan.status === 'active'
      ? <Alert intent="success">Payment received. Thank you.</Alert>
      : <Alert intent="info" action={<Button size="sm" icon={RotateCcw} onClick={reread}>Check again</Button>}>
        We have not confirmed your payment yet. This page shows it once Paystack confirms it.</Alert>)}

    <PageState loading={subscription.kind === 'loading'} error={subscription.kind === 'error' ? subscription.message : null}
      hasData={plan !== null} onRetry={reread} what="your plan" rows={2}>
      {plan && <>
        <Card aria-labelledby="blue-plan-title" data-urgent={urgent || undefined}
          className={cx('flex flex-col gap-4 p-5 @2xl:flex-row @2xl:items-center @2xl:justify-between', urgent && 'ring-2 ring-danger/40')}>
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="m-0 text-[13px] font-medium text-ink-3">{PRODUCT_LABELS[plan.productCode] ?? plan.productCode}</p>
            <h2 id="blue-plan-title" className="m-0 text-title-2 text-ink">{STATUS[plan.status].label}</h2>
            <p className="m-0 text-sm text-ink-2">{statusDetail(plan)}</p>
          </div>
          {actions ? <div className="flex flex-col gap-2 @md:flex-row @md:flex-wrap [&>*]:w-full @md:[&>*]:w-auto">{actions}</div> : null}
        </Card>

        <Card data-subscription-card="">
          <CardHeader as="h2" title="Current plan" />
          <DescriptionList items={[
            ['Plan', PRODUCT_LABELS[plan.productCode] ?? plan.productCode],
            ['Status', <Badge key="status" tone={TONE[STATUS[plan.status].tone]}>{STATUS[plan.status].label}</Badge>],
            priceText ? ['Price', priceText] : null,
            plan.trialEndsAt ? ['Trial ends', formatDate(plan.trialEndsAt)] : null,
            plan.currentPeriodEndsAt ? ['Renews on', formatDate(plan.currentPeriodEndsAt)] : null,
            plan.graceEndsAt ? ['Pay by', formatDate(plan.graceEndsAt)] : null,
          ]} />
          <div className="flex flex-col gap-3 border-t border-line px-5 py-4 empty:hidden">
            {canManage && !plan.selfServePayment && plan.status !== 'active' &&
              <p className="m-0 text-[13px] text-ink-3">This plan is priced by Health ID sales. Contact Health ID sales to pay for it.</p>}
            {!canManage && plan.status !== 'active' && <p className="m-0 text-[13px] text-ink-3">Only your facility administrator can start a trial or pay.</p>}
            {actionError && <Alert intent="error" size="sm">{actionError}</Alert>}
            {payable && <p className="m-0 text-[13px] text-ink-3">Payment opens Paystack’s secure checkout.</p>}
          </div>
        </Card>

        {/* Health ID sends no renewal reminders yet, so the card says so, with no sample rows on a live page. */}
        <Card data-subscription-card="">
          <CardHeader as="h2" title="Renewal reminders" />
          <div className="flex flex-col gap-1 px-5 py-4">
            <p className="m-0 text-sm text-ink">No renewal reminders yet.</p>
            <p className="m-0 text-[13px] text-ink-3">Health ID does not send renewal reminders by email or text message yet.</p>
          </div>
        </Card>
      </>}
    </PageState>

    {/* The facility's invoices, as today's billing page lists them. */}
    <Card data-subscription-card="">
      <CardHeader as="h2" title="Subscription history" />
      {invoices.kind === 'loading' && <p role="status" className="m-0 px-5 py-4 text-[13px] text-ink-3">Loading invoices…</p>}
      {invoices.kind === 'error' && <div className="px-5 py-4"><Alert intent="error" size="sm">{invoices.message}</Alert></div>}
      {invoices.kind === 'unavailable' && <p className="m-0 px-5 py-4 text-[13px] text-ink-3">Invoices aren’t available yet.</p>}
      {invoices.kind === 'ready' && (invoices.value.length === 0
        ? <p className="m-0 px-5 py-4 text-[13px] text-ink-3">No invoices yet. Your first one shows here after you pay.</p>
        : <InvoiceTable invoices={invoices.value} />)}
    </Card>
  </div>
}

const CELL = 'px-5 py-3 align-middle @max-lg:flex @max-lg:items-center @max-lg:justify-between @max-lg:gap-4 @max-lg:px-0 @max-lg:py-1'

/** The invoices: a table, each row a small card of labelled lines once the page is narrow. */
function InvoiceTable({ invoices }: { readonly invoices: readonly Invoice[] }) {
  return <div className="@container">
    <table className="w-full border-collapse text-left text-sm @max-lg:block">
      <caption className="sr-only">Invoices</caption>
      <thead className="@max-lg:sr-only"><tr className="border-b border-line text-[13px] text-ink-3">
        <th scope="col" className="px-5 py-2.5 font-medium">Invoice</th><th scope="col" className="px-5 py-2.5 font-medium">Date</th>
        <th scope="col" className="px-5 py-2.5 font-medium">Amount</th><th scope="col" className="px-5 py-2.5 font-medium">Status</th>
      </tr></thead>
      <tbody className="divide-y divide-line @max-lg:block">{invoices.map(invoice => <tr key={invoice.id} className="@max-lg:block @max-lg:px-5 @max-lg:py-3">
        <td className={cx(CELL, 'font-medium text-ink')}>{invoice.number}</td>
        <td className={CELL}><span className="text-ink-3 @lg:sr-only">Date</span>{formatDate(invoice.issuedAt)}</td>
        <td className={cx(CELL, 'tabular-nums')}><span className="text-ink-3 @lg:sr-only">Amount</span>{formatMoney(invoice.amount_minor, invoice.currency)}</td>
        <td className={CELL}><span className="text-ink-3 @lg:sr-only">Status</span>
          <Badge tone={invoice.status === 'paid' ? 'success' : invoice.status === 'open' ? 'warn' : 'neutral'}>
            {invoice.status === 'paid' ? 'Paid' : invoice.status === 'open' ? 'Open' : 'Void'}</Badge></td>
      </tr>)}</tbody>
    </table>
  </div>
}
