import { useCallback, useMemo, useState, type FormEvent } from 'react'
import {
  adminApi,
  type AdminActor,
  type CommercialPrice,
  type DemoRequest,
  type DemoStatus,
  type PlatformControl,
} from './api'
import {
  ActionForm, LoadMore, Page, Pager, Refresh, ResourceView, Status, Table, date, has, label, pageNumber, useCursorPages,
  useGovernedSubmit, useResource, useUrlFilters,
} from './ui'

/** `ListIdentityReviewsDto` statuses. */
const REVIEW_STATUSES = ['pending_new_identity_approval', 'review_required', 'resolved_existing_identity',
  'linked_existing', 'approved_new_identity', 'rejected', 'cancelled'] as const
/** `ListDemoRequestsDto` values. */
const DEMO_STATUSES: readonly DemoStatus[] = ['new', 'contacted', 'qualified', 'closed']
const DEMO_PRODUCTS = ['ehr', 'migrate', 'laboratory', 'pharmacy', 'outreach', 'api', 'general'] as const
/** The public site's "Earn with Health ID" referrals (apps/public-web/lib/referral.ts REFERRAL_SECTION). */
const REFERRAL_SECTION = 'referral'

export function ReviewsPage() {
  const [filters, setFilters] = useUrlFilters(['status', 'page'] as const)
  const page = pageNumber(filters.page)
  const load = useCallback((signal?: AbortSignal) => adminApi.reviews({ page,
    ...(filters.status ? { status: filters.status } : {}) }, signal), [page, filters.status])
  const resource = useResource(load, 'Identity reviews could not be loaded.')
  return <Page eyebrow="People and access" title="Identity review"
    description="Registration cases that need identity oversight. Decisions are made in the facility workflow; this view is read-only."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <div className="admin-filters">
      <label>Status<select value={filters.status} onChange={event => setFilters({ status: event.target.value, page: '' })}>
        <option value="">Any status</option>
        {REVIEW_STATUSES.map(value => <option key={value} value={value}>{label(value)}</option>)}
      </select></label>
    </div>
    <ResourceView resource={resource} empty={result => result.items.length === 0}>{result => <>
      <p className="admin-result-count">Showing {result.items.length} of {result.total} reviews</p>
      <Table headings={['Case', 'Facility', 'Provider', 'Candidates', 'Status', 'Opened', 'Updated']}>
        {result.items.map(review => <tr key={review.id}><td>{review.maskedNin}</td><td>{review.facilityName}</td>
          <td>{label(review.provider)}</td><td>{review.candidateCount}</td><td><Status value={review.status} /></td>
          <td>{date(review.createdAt)}</td><td>{date(review.updatedAt)}</td></tr>)}
      </Table>
      <Pager page={result.page} pageSize={result.pageSize} total={result.total} disabled={resource.loading}
        onPage={next => setFilters({ page: String(next) })} />
    </>}</ResourceView>
  </Page>
}

export function OperationsPage() {
  const services = useResource(adminApi.services, 'Service status could not be loaded.')
  const events = useResource(adminApi.events, 'Event delivery status could not be loaded.')
  return <Page eyebrow="Operations" title="Service health" description="Current backend service checks and event delivery state."
    action={<Refresh onClick={() => { services.reload(); events.reload() }} disabled={services.loading || events.loading} />}>
    <div className="admin-stack"><section className="admin-panel"><h2>Services</h2>
      <ResourceView resource={services} empty={result => result.services.length === 0}>{result => <>
        <p className="admin-result-count">Checked {date(result.checkedAt)}</p>
        <Table headings={['Service', 'State', 'Detail', 'Checked']}>
          {result.services.map(item => <tr key={item.service}><td><strong>{item.service}</strong></td>
            <td><Status value={item.state} /></td><td>{item.code ? label(item.code) : 'Not available'}</td>
            <td>{date(item.checkedAt)}</td></tr>)}
        </Table>
      </>}</ResourceView>
    </section><section className="admin-panel"><h2>Event delivery</h2>
      <ResourceView resource={events}>{result => <>
        <p><Status value={result.state} /> {result.code ? label(result.code) : null}</p>
        {result.metrics && <dl className="admin-detail-grid">{Object.entries(result.metrics).map(([key, value]) =>
          <div key={key}><dt>{label(key)}</dt><dd>{typeof value === 'boolean' ? value ? 'Yes' : 'No' : new Intl.NumberFormat('en-NG').format(value)}</dd></div>)}</dl>}
        {result.failures.length === 0 ? <p className="admin-note">No recent delivery failures reported.</p> : <>
          <p className="admin-note">{result.failures.length} recent delivery failures (newest 50 from the event dispatcher).</p>
          <Table headings={['Failed', 'Event type', 'Producer', 'Attempts', 'Error']}>
            {result.failures.map((item, index) => <tr key={item.eventId ?? index}><td>{date(item.failedAt)}</td>
              <td>{item.eventType ?? 'Unknown'}</td><td>{item.producer ?? 'Unknown'}</td><td>{item.attemptCount ?? '—'}</td>
              <td>{item.errorCode ? label(item.errorCode) : 'Not reported'}{item.errorSummary ? <small>{item.errorSummary}</small> : null}</td></tr>)}
          </Table>
        </>}
      </>}</ResourceView>
    </section></div>
  </Page>
}

/** The editor restarts from the server's values for each version; the confirmation outlives that reset. */
function PriceEdit({ price, reload }: { price: CommercialPrice; reload: () => void }) {
  const [notice, setNotice] = useState<string | null>(null)
  return <>
    <PriceEditor key={price.version} price={price} onEdit={() => setNotice(null)}
      onSaved={() => { setNotice('Pricing saved. Current catalog is being refreshed.'); reload() }} />
    {notice && <p role="status" className="admin-success">{notice}</p>}
  </>
}

function PriceEditor({ price, onEdit, onSaved }: { price: CommercialPrice; onEdit: () => void; onSaved: () => void }) {
  const [visibility, setVisibility] = useState<CommercialPrice['visibility']>(price.visibility)
  const [amount, setAmount] = useState(price.amount_minor === null ? '' : String(price.amount_minor))
  const [active, setActive] = useState(price.active)
  const [reason, setReason] = useState('')
  const governed = useGovernedSubmit()
  const { busy, error } = governed
  const needsAmount = visibility === 'fixed' || visibility === 'starting_from'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || reason.trim().length < 8) return
    const amountMinor = needsAmount ? Number(amount) : null
    if (needsAmount && (!/^(0|[1-9]\d*)$/.test(amount) || !Number.isSafeInteger(amountMinor))) {
      governed.setError('Enter a valid whole number of minor currency units.'); return
    }
    onEdit()
    const done = await governed.submit(idempotencyKey => adminApi.command(
      `/api/v1/admin/pricing/products/${encodeURIComponent(price.product_slug)}/prices/${encodeURIComponent(price.context)}`,
      { visibility, amountMinor, currency: price.currency, billingPeriod: price.billing_period,
        unit: price.unit, active, reason: reason.trim() },
      { version: price.version, idempotencyKey }), 'Pricing could not be updated.')
    if (done !== null) onSaved()
  }

  return <details className="admin-action"><summary>Edit price</summary><form className="admin-action-form" onSubmit={event => void submit(event)}>
    <label>Visibility<select value={visibility} onChange={event => setVisibility(event.target.value as CommercialPrice['visibility'])}>
      {['fixed', 'starting_from', 'contact_sales', 'custom_quote', 'hidden'].map(value => <option key={value} value={value}>{label(value)}</option>)}
    </select></label>
    {needsAmount && <label>Amount in minor {price.currency} units<input type="number" min="0" step="1" required
      value={amount} onChange={event => setAmount(event.target.value)} /></label>}
    <label className="admin-checkbox"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} /> Active</label>
    <label>Reason for this change<textarea minLength={8} maxLength={500} required rows={3}
      value={reason} onChange={event => setReason(event.target.value)} /></label>
    <button className="admin-primary" type="submit" disabled={busy || reason.trim().length < 8}>{busy ? 'Saving…' : 'Save price'}</button>
    {error && <p role="alert" className="admin-error">{error}</p>}
  </form></details>
}

export function PricingPage({ actor }: { actor: AdminActor }) {
  const resource = useResource(adminApi.pricing, 'The pricing catalog could not be loaded.')
  const canManage = has(actor, 'platform.pricing.manage')
  return <Page eyebrow="Commercial" title="Pricing" description="The current catalog controls what the public website may display. Quote prices have no fabricated amount."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <ResourceView resource={resource} empty={catalog => catalog.products.length === 0}>{catalog => <div className="admin-stack">
      {catalog.products.map(product => <section className="admin-panel" key={product.slug}>
        <div className="admin-panel-head"><div><h2>{product.name}</h2><p>{product.slug}</p></div><Status value={product.status} /></div>
        {canManage && <ActionForm title="Change product status" options={
          ['active', 'coming_soon', 'draft', 'retired'].filter(value => value !== product.status)
            .map(value => ({ value, title: label(value) }))
        } onSubmit={async (status, reason, idempotencyKey) => {
          await adminApi.command(`/api/v1/admin/pricing/products/${encodeURIComponent(product.slug)}`,
            { name: product.name, status, reason }, { version: product.version, idempotencyKey })
          resource.reload()
        }} />}
        {catalog.prices.filter(price => price.product_slug === product.slug).length === 0
          ? <p className="admin-note">No price contexts are configured for this product.</p>
          : <div className="admin-price-list">{catalog.prices.filter(price => price.product_slug === product.slug).map(price =>
            <div className="admin-price" key={price.context}>
              <div><strong>{label(price.context)}</strong><span>{label(price.visibility)} · {price.active ? 'Active' : 'Inactive'}</span>
                <small>{price.amount_minor === null ? 'Amount available on request' : `${new Intl.NumberFormat('en-NG').format(price.amount_minor)} minor ${price.currency} units`}
                  {price.billing_period ? ` · ${label(price.billing_period)}` : ''}{price.unit ? ` · ${price.unit}` : ''}</small></div>
              {canManage && <div><PriceEdit price={price} reload={resource.reload} /></div>}
            </div>)}</div>}
      </section>)}
    </div>}</ResourceView>
  </Page>
}

/**
 * The confirmation is page-level because the reload starts the list again from
 * its first page, which removes a row loaded with "Load more".
 */
function DemoAction({ request, onSaved }: { request: DemoRequest; onSaved: (message: string) => void }) {
  return <ActionForm title="Change status" options={DEMO_STATUSES
    .filter(value => value !== request.status).map(value => ({ value, title: label(value) }))}
    onSubmit={async (status, reason) => {
      await adminApi.command(`/api/v1/admin/demo-requests/${encodeURIComponent(request.id)}/status`,
        { status, reason }, { version: request.version })
      onSaved(`The request from ${request.contactName} is now ${label(status).toLowerCase()}.`)
    }} />
}

export function DemosPage({ actor }: { actor: AdminActor }) {
  const [filters, setFilters] = useUrlFilters(['status', 'product'] as const)
  const status = DEMO_STATUSES.find(value => value === filters.status)
  const product = DEMO_PRODUCTS.find(value => value === filters.product)
  const query = useMemo(() => ({ ...(status ? { status } : {}), ...(product ? { productCode: product } : {}) }),
    [status, product])
  const load = useCallback((signal?: AbortSignal) => adminApi.demos(query, {}, signal), [query])
  const resource = useResource(load, 'Demo requests could not be loaded.')
  const pages = useCursorPages(resource, (cursor, signal) => adminApi.demos(query, { cursor }, signal),
    'More demo requests could not be loaded.')
  const [notice, setNotice] = useState<string | null>(null)
  const saved = (message: string) => { setNotice(message); resource.reload() }
  return <Page eyebrow="Commercial" title="Demo requests" description="Requests submitted through the public Health ID website."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <div className="admin-filters">
      <label>Status<select value={filters.status} onChange={event => { setNotice(null); setFilters({ status: event.target.value }) }}>
        <option value="">Any status</option>
        {DEMO_STATUSES.map(value => <option key={value} value={value}>{label(value)}</option>)}
      </select></label>
      <label>Product<select value={filters.product} onChange={event => { setNotice(null); setFilters({ product: event.target.value }) }}>
        <option value="">Any product</option>
        {DEMO_PRODUCTS.map(value => <option key={value} value={value}>{label(value)}</option>)}
      </select></label>
    </div>
    {notice && <p role="status" className="admin-success">{notice}</p>}
    <ResourceView resource={resource} empty={result => result.items.length === 0}>{() => <>
      <p className="admin-result-count">Showing {pages.items.length} requests, newest first{pages.hasMore ? '; more are available' : ''}</p>
      <Table headings={['Contact', 'Organization', 'Product', 'Submitted', 'Status', 'Action']}>
      {pages.items.map(item => <tr key={item.id}>
        <td><strong>{item.contactName}</strong><small>{item.contactEmail}</small>
          {item.contactPhone && <small>{item.contactPhone}</small>}{item.contactRole && <small>{item.contactRole}</small>}</td>
        <td>{item.sourceSection === REFERRAL_SECTION && <span className="admin-status" data-state="referral">Referral</span>}
          {item.organizationName ? <strong>{item.organizationName}</strong> : 'Not provided'}
          {item.organizationType && <small>{label(item.organizationType)}</small>}
          {item.message && <details className="admin-action"><summary>Message</summary>
            <p className="admin-demo-message">{item.message}</p></details>}</td>
        <td>{label(item.productCode)}</td><td>{date(item.createdAt)}</td>
        <td><Status value={item.status} /></td>
        <td>{has(actor, 'platform.demo.manage') ? <DemoAction request={item} onSaved={saved} /> : 'View only'}</td>
      </tr>)}
    </Table>
      <LoadMore pages={pages} label="Load more requests" /></>}</ResourceView>
  </Page>
}

/** What a control does, where its key alone does not say it. */
const CONTROL_NOTES: Readonly<Record<string, string>> = {
  // hid-system ADR-066 (0098), seeded off.
  clinician_signup_enabled: 'Lets doctors and nurses apply by themselves at /provider/join. Their applications wait in '
    + 'Clinician applications until one Super Admin verifies and a second approves, so open it only when the queue is '
    + 'staffed. Applying also needs the provider portal on and maintenance off.',
  // P4c (Novu), seeded off: switched on with facility sign-up and staff invitations after the closed-state checks.
  cross_facility_orders_enabled: 'Lets clinicians send lab requests and prescriptions to a reviewed laboratory or pharmacy '
    + 'at another facility, and lets those facilities accept them. Switching it off stops new sends and acceptances; work '
    + 'already accepted carries on.',
  // P4c (Novu), seeded on: off only to stop all work on accepted orders at once if something goes wrong.
  cross_facility_route_access_enabled: 'Lets laboratories and pharmacies work on orders from other facilities they have '
    + 'accepted. Switch it off only to stop all of that work at once, everywhere, if something goes wrong.',
}

function ControlAction({ control, reload }: { control: PlatformControl; reload: () => void }) {
  return <ActionForm title={control.enabled ? 'Disable control' : 'Enable control'} onSubmit={async (_, reason) => {
    await adminApi.command('/api/v1/admin/controls', { controlKey: control.controlKey,
      enabled: !control.enabled, reason }, { version: control.version })
    reload()
  }} />
}

export function ControlsPage({ actor }: { actor: AdminActor }) {
  const resource = useResource(adminApi.controls, 'Platform controls could not be loaded.')
  return <Page eyebrow="Configuration" title="Platform controls" description="Changes are version checked and recorded by the backend."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <ResourceView resource={resource} empty={controls => controls.length === 0}>{controls => <div className="admin-tile-grid">
      {controls.map(control => <article className="admin-tile" key={control.controlKey}>
        <div className="admin-panel-head"><h2>{label(control.controlKey)}</h2><Status value={control.enabled ? 'enabled' : 'disabled'} /></div>
        {Object.hasOwn(CONTROL_NOTES, control.controlKey) && <p className="admin-note">{CONTROL_NOTES[control.controlKey]}</p>}
        <p>{control.reason}</p><p className="admin-note">Updated {date(control.updatedAt)}</p>
        {has(actor, 'platform.control.manage') && <ControlAction control={control} reload={resource.reload} />}
      </article>)}
    </div>}</ResourceView>
  </Page>
}
