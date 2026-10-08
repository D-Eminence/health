import { useEffect, useState, type FormEvent } from 'react'
import {
  adminApi,
  type AdminActor,
  type AuditEvent,
  type CommercialPrice,
  type DemoRequest,
  type Facility,
  type IntegrationCapability,
  type IntegrationProvider,
  type PlatformControl,
  type Principal,
} from './api'
import { failure } from './problems'
import { ApprovalRequestForm, ExportPanel, PrincipalSessions } from './PrincipalSecurity'
import {
  ActionForm, Page, Refresh, ResourceView, Status, Table, date, has, label, useGovernedSubmit, useResource,
} from './ui'

export function OverviewPage() {
  const resource = useResource(adminApi.overview, 'The platform overview could not be loaded.')
  return <Page eyebrow="Platform" title="Overview" description="Current totals from the Health ID administration service."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <ResourceView resource={resource}>{overview => <div className="admin-metric-grid">
      {Object.entries(overview).map(([key, value]) => <article className="admin-metric" key={key}>
        <span>{label(key)}</span><strong>{new Intl.NumberFormat('en-NG').format(value)}</strong>
      </article>)}
    </div>}</ResourceView>
  </Page>
}

function FacilityStatusAction({ facility, reload }: { facility: Facility; reload: () => void }) {
  return <ActionForm title="Change facility status" options={[
    { value: 'verified', title: 'Verified' }, { value: 'rejected', title: 'Rejected' },
    { value: 'suspended', title: 'Suspended' },
  ].filter(option => option.value !== facility.status)} onSubmit={async (status, reason, idempotencyKey) => {
    await adminApi.command(`/api/v1/admin/facilities/${encodeURIComponent(facility.id)}/status`,
      { status, reason }, { version: facility.version, idempotencyKey })
    reload()
  }} />
}

export function FacilitiesPage({ actor }: { actor: AdminActor }) {
  const resource = useResource(adminApi.facilities, 'Facilities could not be loaded.')
  return <Page eyebrow="Governance" title="Facilities" description="Facility status and membership counts come from the platform record."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <ResourceView resource={resource} empty={page => page.items.length === 0}>{page => <>
      <p className="admin-result-count">Showing {page.items.length} of {page.total} facilities</p>
      <Table headings={['Facility', 'Organization', 'Status', 'Members', 'Action']}>
        {page.items.map(facility => <tr key={facility.id}>
          <td><strong>{facility.name}</strong><small>{facility.code}</small></td>
          <td>{facility.organizationName}</td><td><Status value={facility.status} /></td>
          <td>{facility.membershipCount}</td><td>{has(actor, 'platform.facility.manage')
            ? <FacilityStatusAction facility={facility} reload={resource.reload} /> : 'View only'}</td>
        </tr>)}
      </Table>
    </>}</ResourceView>
  </Page>
}

export function PrincipalsPage({ actor }: { actor: AdminActor }) {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [revision, setRevision] = useState(0)
  const [page, setPage] = useState<Awaited<ReturnType<typeof adminApi.principals>> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (query.length < 2) return
    const controller = new AbortController()
    setLoading(true); setError(null)
    void adminApi.principals(query, controller.signal).then(value => {
      if (!controller.signal.aborted) setPage(value)
    }).catch(reason => {
      if (!controller.signal.aborted) setError(failure(reason, 'Users could not be loaded.'))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [query, revision])

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = input.trim()
    if (value.length < 2) { setError('Enter at least two characters to search users.'); return }
    setPage(null); setQuery(value); setRevision(current => current + 1)
  }

  return <Page eyebrow="Access governance" title="Users and roles" description="Search by account name, email, or subject. Searches are limited to authorized administrators."
    action={query ? <Refresh onClick={() => setRevision(value => value + 1)} disabled={loading} /> : null}>
    <form className="admin-search" onSubmit={search}><label htmlFor="admin-principal-query">Search users</label>
      <div><input id="admin-principal-query" type="search" minLength={2} value={input}
        onChange={event => setInput(event.target.value)} placeholder="At least two characters" />
        <button className="admin-primary" type="submit" disabled={loading || input.trim().length < 2}>Search</button></div>
    </form>
    {has(actor, 'platform.principal.export') && <ExportPanel query={query} />}
    {!query && !error && <div className="admin-state">Enter at least two characters to search.</div>}
    {loading && <div className="admin-state" role="status">Searching users…</div>}
    {error && !loading && <div className="admin-state admin-state-error" role="alert"><p>{error}</p>
      {query && <Refresh onClick={() => setRevision(value => value + 1)} />}</div>}
    {page && !loading && !error && (page.items.length === 0 ? <div className="admin-state">No users match “{query}”.</div> : <>
      <p className="admin-result-count">Showing {page.items.length} of {page.total} matching users</p>
      <Table headings={['User', 'Status', 'Platform roles', 'Sessions', 'Facility memberships', 'Actions']}>
        {page.items.map(principal => <tr key={principal.id}>
          <td><strong>{principal.displayName || principal.email || 'Account'}</strong><small>{principal.email || principal.id}</small></td>
          <td><Status value={principal.status} /></td>
          <td>{principal.platformRoles.length ? principal.platformRoles.map(label).join(', ') : 'None'}</td>
          <td>{principal.activeSessionCount}</td>
          <td>{principal.memberships.length ? principal.memberships.map(item => `${item.facilityName} · ${label(item.role)}`).join('; ') : 'None'}</td>
          <td><PrincipalActions principal={principal} actor={actor} reload={() => setRevision(value => value + 1)} /></td>
        </tr>)}
      </Table>
    </>)}
  </Page>
}

const PLATFORM_ROLES = [
  'platform_super_admin', 'platform_operations_admin', 'identity_review_admin',
  'facility_review_admin', 'security_auditor', 'support_admin',
] as const

function RoleAction({ principal, reload }: { principal: Principal; reload: () => void }) {
  const [role, setRole] = useState<(typeof PLATFORM_ROLES)[number]>('support_admin')
  const [action, setAction] = useState<'grant' | 'revoke'>('grant')
  const [reason, setReason] = useState('')
  const governed = useGovernedSubmit()
  // A one-step Super Admin grant is refused by the backend (two-person rule);
  // that grant is made through an elevation request instead.
  const roles = action === 'grant' ? PLATFORM_ROLES.filter(value => value !== 'platform_super_admin') : PLATFORM_ROLES

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (governed.busy || reason.trim().length < 8) return
    const done = await governed.submit(idempotencyKey => adminApi.command(
      `/api/v1/admin/principals/${encodeURIComponent(principal.id)}/platform-roles`,
      { roleCode: role, action, reason: reason.trim() }, { version: principal.version, idempotencyKey }),
    'The role change could not be saved.')
    if (done !== null) { setReason(''); reload() }
  }

  function changeAction(value: 'grant' | 'revoke') {
    setAction(value)
    if (value === 'grant' && role === 'platform_super_admin') setRole('support_admin')
  }

  return <details className="admin-action"><summary>Change platform role</summary>
    <form className="admin-action-form" onSubmit={event => void submit(event)}>
      <label>Action<select value={action} onChange={event => changeAction(event.target.value as 'grant' | 'revoke')}>
        <option value="grant">Grant</option><option value="revoke">Revoke</option>
      </select></label>
      <label>Role<select value={role} onChange={event => setRole(event.target.value as (typeof PLATFORM_ROLES)[number])}>
        {roles.map(value => <option key={value} value={value}>{label(value)}</option>)}
      </select></label>
      {action === 'grant' && <p className="admin-note">Super Admin is granted only through an elevation request that a
        second Super Admin approves.</p>}
      <label>Reason for this change<textarea required minLength={8} maxLength={500} rows={3}
        value={reason} onChange={event => setReason(event.target.value)} /></label>
      <button className="admin-primary" type="submit" disabled={governed.busy || reason.trim().length < 8}>
        {governed.busy ? 'Saving…' : 'Confirm role change'}
      </button>
      {governed.error && <p role="alert" className="admin-error">{governed.error}</p>}
    </form>
  </details>
}

function PrincipalActions({ principal, actor, reload }: {
  principal: Principal; actor: AdminActor; reload: () => void
}) {
  const canStatus = has(actor, 'platform.principal.manage')
  const canRole = has(actor, 'platform.role.manage')
  const canRevoke = has(actor, 'platform.session.revoke')
  const canResetMfa = has(actor, 'platform.mfa.reset')
  const canElevate = canRole && !principal.platformRoles.includes('platform_super_admin')
  if (!canStatus && !canRole && !canRevoke && !canResetMfa) return <>View only</>
  return <div className="admin-principal-actions">
    {canStatus && <ActionForm title="Change account status" options={[
      { value: 'active', title: 'Active' }, { value: 'disabled', title: 'Disabled' },
    ].filter(option => option.value !== principal.status)} onSubmit={async (status, reason, idempotencyKey) => {
      await adminApi.command(`/api/v1/admin/principals/${encodeURIComponent(principal.id)}/status`,
        { status, reason }, { version: principal.version, idempotencyKey })
      reload()
    }} />}
    {canRole && <RoleAction principal={principal} reload={reload} />}
    {canElevate && <ApprovalRequestForm kind="super-admin" principal={principal} />}
    {canResetMfa && <ApprovalRequestForm kind="mfa-reset" principal={principal} />}
    {canRevoke && <PrincipalSessions principal={principal} />}
    {canRevoke && principal.activeSessionCount > 0 && <ActionForm title="Revoke all sessions"
      note={<p className="admin-note">Signs this account out everywhere. Use it when an account may be compromised.</p>}
      onSubmit={async (_, reason, idempotencyKey) => {
        await adminApi.command(`/api/v1/admin/principals/${encodeURIComponent(principal.id)}/sessions/revoke`,
          { reason }, { idempotencyKey })
        reload()
      }} />}
  </div>
}

export function ApplicationsPage({ actor }: { actor: AdminActor }) {
  const resource = useResource(adminApi.applications, 'Organization applications could not be loaded.')
  return <Page eyebrow="Provider admission" title="Applications" description="Review submitted organization applications and their verification state."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <ResourceView resource={resource} empty={result => result.items.length === 0}>{result => <Table headings={['Organization', 'Product', 'Administrator', 'Status', 'Verification']}>
      {result.items.map(item => <tr key={item.applicationId}>
        <td><strong>{item.organizationName || 'Name pending'}</strong><small>{item.applicationId}</small></td>
        <td>{label(item.productCode)}</td><td>{item.administratorEmail}</td>
        <td><Status value={item.status} /></td><td>{item.verificationResult ? label(item.verificationResult) : 'Pending'}</td>
      </tr>)}
    </Table>}</ResourceView>
    {has(actor, 'platform.facility.manage') && <p className="admin-note">Approval requires verified legal details and an administrator review. This summary does not expose a partial approval command.</p>}
  </Page>
}

export function ReviewsPage() {
  const resource = useResource(adminApi.reviews, 'Identity reviews could not be loaded.')
  return <Page eyebrow="Identity governance" title="Identity review" description="Current registration cases requiring platform oversight."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <ResourceView resource={resource} empty={page => page.items.length === 0}>{page => <>
      <p className="admin-result-count">Showing {page.items.length} of {page.total} reviews</p>
      <Table headings={['Case', 'Facility', 'Provider', 'Candidates', 'Status', 'Updated']}>
        {page.items.map(review => <tr key={review.id}><td>{review.maskedNin}</td><td>{review.facilityName}</td>
          <td>{label(review.provider)}</td><td>{review.candidateCount}</td><td><Status value={review.status} /></td>
          <td>{date(review.updatedAt)}</td></tr>)}
      </Table>
    </>}</ResourceView>
  </Page>
}

export function AuditPage() {
  const resource = useResource(adminApi.audit, 'Audit events could not be loaded.')
  const [older, setOlder] = useState<{ items: AuditEvent[]; next: string | null } | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderError, setOlderError] = useState<string | null>(null)
  useEffect(() => { setOlder(null); setOlderError(null) }, [resource.data])
  const next = older ? older.next : resource.data?.nextBeforeSequenceId ?? null

  async function loadOlder() {
    if (!next || loadingOlder) return
    setLoadingOlder(true); setOlderError(null)
    try {
      const page = await adminApi.audit(undefined, next)
      setOlder(current => ({ items: [...(current?.items ?? []), ...page.items], next: page.nextBeforeSequenceId }))
    } catch (caught) {
      setOlderError(failure(caught, 'Older audit events could not be loaded.'))
    } finally { setLoadingOlder(false) }
  }

  return <Page eyebrow="Accountability" title="Audit" description="Recent platform events. The backend controls visibility and the returned history."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <ResourceView resource={resource} empty={result => result.items.length === 0}>{result => <>
      <Table headings={['Occurred', 'Action', 'Outcome', 'Actor', 'Correlation']}>
        {[...result.items, ...(older?.items ?? [])].map(item => <tr key={item.eventId}><td>{date(item.occurredAt)}</td>
          <td>{label(item.action)}</td><td><Status value={item.outcome} /></td>
          <td>{item.actorSubject || 'System'}</td><td><code>{item.correlationId}</code></td></tr>)}
      </Table>
      {olderError ? <p role="alert" className="admin-error">{olderError}</p> : null}
      {next ? <button type="button" className="admin-secondary" onClick={() => void loadOlder()} disabled={loadingOlder}>
        {loadingOlder ? 'Loading older events…' : 'Load older events'}</button> : null}
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
        <p className="admin-note">{result.failures.length} recent delivery failures reported.</p>
      </>}</ResourceView>
    </section></div>
  </Page>
}

function PriceEditor({ price, reload }: { price: CommercialPrice; reload: () => void }) {
  const [visibility, setVisibility] = useState<CommercialPrice['visibility']>(price.visibility)
  const [amount, setAmount] = useState(price.amount_minor === null ? '' : String(price.amount_minor))
  const [active, setActive] = useState(price.active)
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
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
    setNotice(null)
    const done = await governed.submit(idempotencyKey => adminApi.command(
      `/api/v1/admin/pricing/products/${encodeURIComponent(price.product_slug)}/prices/${encodeURIComponent(price.context)}`,
      { visibility, amountMinor, currency: price.currency, billingPeriod: price.billing_period,
        unit: price.unit, active, reason: reason.trim() },
      { version: price.version, idempotencyKey }), 'Pricing could not be updated.')
    if (done !== null) { setReason(''); setNotice('Pricing saved. Current catalog is being refreshed.'); reload() }
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
    {error && <p role="alert" className="admin-error">{error}</p>}{notice && <p role="status" className="admin-success">{notice}</p>}
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
              {canManage && <PriceEditor key={`${price.context}:${price.version}`} price={price} reload={resource.reload} />}
            </div>)}</div>}
      </section>)}
    </div>}</ResourceView>
  </Page>
}

function DemoAction({ request, reload }: { request: DemoRequest; reload: () => void }) {
  return <ActionForm title="Change status" options={['new', 'contacted', 'qualified', 'closed']
    .filter(value => value !== request.status).map(value => ({ value, title: label(value) }))}
    onSubmit={async (status, reason) => {
      await adminApi.command(`/api/v1/admin/demo-requests/${encodeURIComponent(request.id)}/status`,
        { status, reason }, { version: request.version })
      reload()
    }} />
}

export function DemosPage({ actor }: { actor: AdminActor }) {
  const resource = useResource(adminApi.demos, 'Demo requests could not be loaded.')
  return <Page eyebrow="Commercial" title="Demo requests" description="Requests submitted through the public Health ID website."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <ResourceView resource={resource} empty={result => result.items.length === 0}>{result => <Table headings={['Contact', 'Organization', 'Product', 'Submitted', 'Status', 'Action']}>
      {result.items.map(item => <tr key={item.id}>
        <td><strong>{item.contactName}</strong><small>{item.contactEmail}</small></td>
        <td>{item.organizationName || 'Not provided'}</td><td>{label(item.productCode)}</td><td>{date(item.createdAt)}</td>
        <td><Status value={item.status} /></td>
        <td>{has(actor, 'platform.demo.manage') ? <DemoAction request={item} reload={resource.reload} /> : 'View only'}</td>
      </tr>)}
    </Table>}</ResourceView>
  </Page>
}

function IntegrationAction({ provider, reload, actor }: {
  provider: IntegrationProvider; reload: () => void; actor: AdminActor
}) {
  const options = provider.availableActions.filter(action => action === 'enable' || action === 'pause')
    .map(value => ({ value, title: label(value) }))
  return <div className="admin-action-row">
    {has(actor, 'platform.integration.manage') && options.length > 0 && <ActionForm title="Change provider state" options={options}
      onSubmit={async (action, reason, idempotencyKey) => {
        await adminApi.command(`/api/v1/admin/integrations/${encodeURIComponent(provider.provider)}/${action}`,
          { reason }, { version: provider.version, idempotencyKey })
        reload()
      }} />}
    {has(actor, 'platform.integration.test') && provider.availableActions.includes('test') && <ActionForm title="Test connection"
      onSubmit={async (_, reason, idempotencyKey) => {
        await adminApi.command(`/api/v1/admin/integrations/${encodeURIComponent(provider.provider)}/test`,
          { reason }, { version: provider.version, idempotencyKey })
        reload()
      }} />}
  </div>
}

function CapabilityAction({ capability, actor, reload }: {
  capability: IntegrationCapability; actor: AdminActor; reload: () => void
}) {
  if (!has(actor, 'platform.integration.manage') || capability.eligibleProviders.length === 0) return null
  const options = capability.eligibleProviders.map(provider => ({ value: provider, title: label(provider) }))
  return <div className="admin-action-row">
    <ActionForm title="Select active provider" options={options} onSubmit={async (provider, reason, idempotencyKey) => {
      await adminApi.command(`/api/v1/admin/integrations/capabilities/${encodeURIComponent(capability.capability)}/selection`,
        { provider, reason }, { version: capability.version, idempotencyKey })
      reload()
    }} />
    <ActionForm title="Select fallback provider" options={options} onSubmit={async (provider, reason, idempotencyKey) => {
      await adminApi.command(`/api/v1/admin/integrations/capabilities/${encodeURIComponent(capability.capability)}/fallback`,
        { provider, reason }, { version: capability.version, idempotencyKey })
      reload()
    }} />
  </div>
}

export function IntegrationsPage({ actor }: { actor: AdminActor }) {
  const resource = useResource(adminApi.integrations, 'Integration configuration could not be loaded.')
  return <Page eyebrow="Configuration" title="Integrations" description="Provider health and active routing from the platform configuration service."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <ResourceView resource={resource} empty={catalog => catalog.items.length === 0 && catalog.capabilities.length === 0}>{catalog => <div className="admin-stack">
      <section className="admin-panel"><h2>Providers</h2>{catalog.items.length === 0 ? <p className="admin-note">No providers are configured.</p> :
        <div className="admin-tile-grid">{catalog.items.map(provider => <article className="admin-tile" key={provider.provider}>
          <div className="admin-panel-head"><h3>{provider.name}</h3><Status value={provider.enabled ? 'enabled' : 'paused'} /></div>
          <p>Health: <Status value={provider.health} /></p><p>Management: {label(provider.managementMode)}</p>
          <IntegrationAction provider={provider} reload={resource.reload} actor={actor} />
        </article>)}</div>}</section>
      <section className="admin-panel"><h2>Capability routing</h2>{catalog.capabilities.length === 0 ? <p className="admin-note">No capability routes are configured.</p> :
        <div className="admin-tile-grid">{catalog.capabilities.map(capability => <article className="admin-tile" key={capability.capability}>
          <h3>{label(capability.capability)}</h3><p>Active: <strong>{capability.activeProvider ? label(capability.activeProvider) : 'None'}</strong></p>
          <p>Fallback: <strong>{capability.fallbackProvider ? label(capability.fallbackProvider) : 'None'}</strong></p>
          <CapabilityAction capability={capability} actor={actor} reload={resource.reload} />
        </article>)}</div>}</section>
    </div>}</ResourceView>
  </Page>
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
        <p>{control.reason}</p><p className="admin-note">Updated {date(control.updatedAt)}</p>
        {has(actor, 'platform.control.manage') && <ControlAction control={control} reload={resource.reload} />}
      </article>)}
    </div>}</ResourceView>
  </Page>
}
