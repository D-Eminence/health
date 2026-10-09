import { useCallback, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { adminApi, type AdminActor, type CursorPage, type PlatformOverview } from './api'
import { APPROVAL_PERMISSIONS, UNAVAILABLE_CAPABILITIES, visibleNavigation } from './navigation'
import { Page, Refresh, ResourceView, has, useResource, type Resource } from './ui'

const number = (value: number) => new Intl.NumberFormat('en-NG').format(value)

/** `GET /admin/overview` totals, labelled as the backend defines them. */
const TOTALS: ReadonlyArray<{ key: keyof PlatformOverview; title: string; link?: string }> = [
  { key: 'registeredPatients', title: 'Registered patients' },
  { key: 'facilities', title: 'Facilities', link: '/admin/facilities' },
  { key: 'verifiedFacilities', title: 'Verified facilities', link: '/admin/facilities?status=verified' },
  { key: 'suspendedFacilities', title: 'Suspended facilities', link: '/admin/facilities?status=suspended' },
  { key: 'activeStaffMemberships', title: 'Active staff memberships' },
  { key: 'pendingIdentityReviews', title: 'Pending identity reviews', link: '/admin/reviews' },
]

/** Waiting work is read one page at a time: "100+" when the list has more than this page. */
const ATTENTION_PAGE = 100
function counted(page: CursorPage<unknown>) {
  return page.nextCursor ? `${number(page.items.length)}+` : number(page.items.length)
}

function AttentionTile<T>({ title, to, resource, children }: {
  title: string; to: string; resource: Resource<T>; children: (value: T) => ReactNode
}) {
  return <article className="admin-tile admin-attention">
    <h3><Link to={to}>{title}</Link></h3>
    {resource.loading ? <p role="status">Loading…</p>
      : resource.error ? <p className="admin-error" role="alert">{resource.error}</p>
        : resource.data !== null ? children(resource.data) : <p>No information was returned.</p>}
  </article>
}

function PendingApprovals() {
  const load = useCallback((signal?: AbortSignal) => adminApi.approvals('pending', { limit: ATTENTION_PAGE }, signal), [])
  const resource = useResource(load, 'Approvals could not be loaded.')
  return <AttentionTile title="Pending approvals" to="/admin/approvals" resource={resource}>{value =>
    <p><strong className="admin-attention-count">{counted(value)}</strong> waiting for a second Super Admin</p>}
  </AttentionTile>
}

function OpenApplications() {
  const load = useCallback((signal?: AbortSignal) => adminApi.applications(undefined, signal), [])
  const resource = useResource(load, 'Applications could not be loaded.')
  return <AttentionTile title="Organization applications" to="/admin/applications" resource={resource}>{value => {
    const ready = value.items.filter(item => item.status === 'ready_for_review').length
    const verifying = value.items.filter(item => item.status === 'pending_verification').length
    return <p><strong className="admin-attention-count">{number(ready)}</strong> ready for review ·{' '}
      {number(verifying)} awaiting CAC verification</p>
  }}</AttentionTile>
}

function NewDemoRequests() {
  const load = useCallback((signal?: AbortSignal) => adminApi.demos({ status: 'new' }, { limit: ATTENTION_PAGE }, signal), [])
  const resource = useResource(load, 'Demo requests could not be loaded.')
  return <AttentionTile title="New demo requests" to="/admin/demos?status=new" resource={resource}>{value =>
    <p><strong className="admin-attention-count">{counted(value)}</strong> not yet contacted</p>}
  </AttentionTile>
}

function IntegrationHealth() {
  const resource = useResource(adminApi.integrations, 'Integrations could not be loaded.')
  return <AttentionTile title="Integrations" to="/admin/integrations" resource={resource}>{value => {
    const failed = value.items.filter(item => item.health === 'failed').length
    const enabled = value.items.filter(item => item.enabled).length
    return <p><strong className="admin-attention-count">{number(failed)}</strong> with a failed last test ·{' '}
      {number(enabled)} of {number(value.items.length)} enabled</p>
  }}</AttentionTile>
}

/**
 * The dashboard shows only what the backend reports. Each count comes from
 * the endpoint of the page it links to and is shown only to administrators
 * who may open that page.
 */
export function OverviewPage({ actor }: { actor: AdminActor }) {
  const totals = useResource(adminApi.overview, 'The platform overview could not be loaded.')
  const areas = visibleNavigation(actor).flatMap(section => section.items).filter(item => item.path !== '/admin/overview')
  const attention = [
    APPROVAL_PERMISSIONS.some(code => has(actor, code)) && <PendingApprovals key="approvals" />,
    has(actor, 'platform.identity-review.read') && <OpenApplications key="applications" />,
    has(actor, 'platform.demo.read') && <NewDemoRequests key="demos" />,
    has(actor, 'platform.integration.read') && <IntegrationHealth key="integrations" />,
  ].filter(Boolean)

  return <Page eyebrow="Platform" title="Overview" description="Current totals and the work waiting for administrators."
    action={<Refresh onClick={totals.reload} disabled={totals.loading} />}>
    <div className="admin-stack">
      <section aria-labelledby="admin-totals-title">
        <h2 id="admin-totals-title" className="admin-section-title">Platform totals</h2>
        <ResourceView resource={totals}>{overview => <div className="admin-metric-grid">
          {TOTALS.map(metric => <article className="admin-metric" key={metric.key}>
            <span>{metric.link ? <Link to={metric.link}>{metric.title}</Link> : metric.title}</span>
            <strong>{number(overview[metric.key])}</strong>
          </article>)}
        </div>}</ResourceView>
      </section>
      {attention.length > 0 && <section aria-labelledby="admin-attention-title">
        <h2 id="admin-attention-title" className="admin-section-title">Waiting for attention</h2>
        <div className="admin-tile-grid">{attention}</div>
      </section>}
      <section aria-labelledby="admin-areas-title">
        <h2 id="admin-areas-title" className="admin-section-title">Your areas</h2>
        <ul className="admin-area-list">{areas.map(item => <li key={item.path}>
          <Link to={item.path}>{item.title}</Link><span>{item.description}</span></li>)}</ul>
      </section>
      <section className="admin-panel" aria-labelledby="admin-unavailable-title">
        <h2 id="admin-unavailable-title">Not available yet</h2>
        <p className="admin-note">These capabilities have no backend support yet, so this console does not show them.</p>
        <ul className="admin-area-list">{UNAVAILABLE_CAPABILITIES.map(item => <li key={item.title}>
          <strong>{item.title}</strong><span>{item.detail}</span></li>)}</ul>
      </section>
    </div>
  </Page>
}
