import { useCallback, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { adminApi, PAGE_SIZE, type AdminActor, type AuditFilters, type Facility } from './api'
import {
  ActionForm, Page, Pager, Refresh, ResourceView, Status, Table, date, has, label, pageNumber, useResource, useUrlFilters,
} from './ui'

/** `ListFacilitiesDto` statuses. */
const FACILITY_STATUSES = ['pending', 'verified', 'rejected', 'suspended'] as const
/** `FacilityStatusCommandDto` targets. */
const FACILITY_TRANSITIONS = ['verified', 'rejected', 'suspended'] as const
/** The backend accepts only UUID v4 facility IDs. */
const FACILITY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function FacilityStatusAction({ facility, reload }: { facility: Facility; reload: () => void }) {
  return <ActionForm title="Change facility status"
    note={<p className="admin-note">Suspending or rejecting a facility affects everyone who works there. The change needs
      your authenticator confirmation and is recorded with your reason.</p>}
    options={FACILITY_TRANSITIONS.filter(status => status !== facility.status).map(value => ({ value, title: label(value) }))}
    onSubmit={async (status, reason, idempotencyKey) => {
      await adminApi.command(`/api/v1/admin/facilities/${encodeURIComponent(facility.id)}/status`,
        { status, reason }, { version: facility.version, idempotencyKey })
      reload()
    }} />
}

export function FacilitiesPage({ actor }: { actor: AdminActor }) {
  const [filters, setFilters] = useUrlFilters(['status', 'query', 'page'] as const)
  const [input, setInput] = useState(filters.query)
  const page = pageNumber(filters.page)
  const load = useCallback((signal?: AbortSignal) => adminApi.facilities({ page, pageSize: PAGE_SIZE,
    ...(filters.status ? { status: filters.status } : {}), ...(filters.query ? { query: filters.query } : {}) }, signal),
  [page, filters.status, filters.query])
  const resource = useResource(load, 'Facilities could not be loaded.')

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = input.trim()
    if (value.length === 1) return
    setFilters({ query: value, page: '' })
  }

  return <Page eyebrow="Organizations" title="Facilities" description="Facility status, organization and membership counts from the platform record."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <form className="admin-filters" onSubmit={search} role="search" aria-label="Filter facilities">
      <label>Status<select value={filters.status} onChange={event => setFilters({ status: event.target.value, page: '' })}>
        <option value="">Any status</option>
        {FACILITY_STATUSES.map(value => <option key={value} value={value}>{label(value)}</option>)}
      </select></label>
      <label>Name or code<input type="search" value={input} minLength={2} placeholder="At least two characters"
        onChange={event => setInput(event.target.value)} /></label>
      <button type="submit" className="admin-secondary" disabled={input.trim().length === 1}>Search</button>
      {(filters.status || filters.query) && <button type="button" className="admin-link"
        onClick={() => { setInput(''); setFilters({ status: '', query: '', page: '' }) }}>Clear filters</button>}
    </form>
    <ResourceView resource={resource} empty={result => result.items.length === 0}>{result => <>
      <p className="admin-result-count">Showing {result.items.length} of {result.total} facilities</p>
      <Table headings={['Facility', 'Organization', 'Status', 'Members', 'Status changed', 'Action']}>
        {result.items.map(facility => <tr key={facility.id}>
          <td><Link to={`/admin/facilities/${encodeURIComponent(facility.id)}`}><strong>{facility.name}</strong></Link><small>{facility.code}</small></td>
          <td>{facility.organizationName}</td>
          <td><Status value={facility.status} />{facility.statusReason ? <small>{facility.statusReason}</small> : null}</td>
          <td>{facility.membershipCount}</td>
          <td>{date(facility.statusChangedAt)}</td>
          <td>{has(actor, 'platform.facility.manage')
            ? <FacilityStatusAction facility={facility} reload={resource.reload} /> : 'View only'}</td>
        </tr>)}
      </Table>
      <Pager page={result.page} pageSize={result.pageSize} total={result.total} disabled={resource.loading}
        onPage={next => setFilters({ page: String(next) })} />
    </>}</ResourceView>
  </Page>
}

/** The newest audit events for a filter, with a link to the full search in Audit. */
function AuditExcerpt({ id, title, description, filters, search, withReason = false }: {
  id: string; title: string; description: string; filters: AuditFilters; search: string; withReason?: boolean
}) {
  const key = JSON.stringify(filters)
  const load = useCallback((signal?: AbortSignal) => adminApi.audit(JSON.parse(key) as AuditFilters, undefined, signal), [key])
  const resource = useResource(load, 'Audit events for this facility could not be loaded.')
  return <section className="admin-panel" aria-labelledby={id}>
    <div className="admin-panel-head"><div><h2 id={id}>{title}</h2><p>{description}</p></div>
      <Link to={`/admin/audit?${search}`}>Open in Audit</Link></div>
    <ResourceView resource={resource} empty={result => result.items.length === 0}>{result =>
      <Table headings={['Occurred', 'Action', 'Outcome', 'Actor']}>
        {result.items.slice(0, 10).map(item => <tr key={item.eventId}><td>{date(item.occurredAt)}</td>
          <td>{label(item.action)}{withReason && item.reason ? <small>{item.reason}</small> : null}</td>
          <td><Status value={item.outcome} /></td><td>{item.actorSubject || 'System'}</td></tr>)}
      </Table>}</ResourceView>
  </section>
}

function FacilityAudit({ facilityId }: { facilityId: string }) {
  const target = new URLSearchParams({ resourceType: 'facility', resourceId: facilityId }).toString()
  return <>
    <AuditExcerpt id="admin-facility-platform-audit-title" title="Platform changes to this facility"
      description="Platform administration commands that targeted this facility, such as status changes, with their reasons."
      filters={{ resourceType: 'facility', resourceId: facilityId }} search={target} withReason />
    <AuditExcerpt id="admin-facility-audit-title" title="Activity inside this facility"
      description="Audit events recorded in this facility's scope, such as staff activity."
      filters={{ facilityId }} search={new URLSearchParams({ facilityId }).toString()} />
  </>
}

/** One facility, linkable by ID. */
export function FacilityDetailPage({ actor }: { actor: AdminActor }) {
  const { facilityId = '' } = useParams()
  if (!FACILITY_ID.test(facilityId)) {
    return <Page eyebrow="Facility" title="Facility not found" description="This link does not contain a valid facility ID.">
      <p><Link to="/admin/facilities">← All facilities</Link></p>
    </Page>
  }
  return <FacilityDetail facilityId={facilityId} actor={actor} />
}

function FacilityDetail({ facilityId, actor }: { facilityId: string; actor: AdminActor }) {
  const load = useCallback((signal?: AbortSignal) => adminApi.facility(facilityId, signal), [facilityId])
  const resource = useResource(load, 'This facility could not be loaded.')
  return <Page eyebrow="Facility" title={resource.data?.name ?? 'Facility'} description="The platform record for one facility."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <p><Link to="/admin/facilities">← All facilities</Link></p>
    <ResourceView resource={resource}>{facility => <div className="admin-stack">
      <section className="admin-panel">
        <dl className="admin-detail-grid">
          <div><dt>Organization</dt><dd>{facility.organizationName}<small>{facility.organizationId}</small></dd></div>
          <div><dt>Code</dt><dd>{facility.code}</dd></div>
          <div><dt>Status</dt><dd><Status value={facility.status} /></dd></div>
          <div><dt>Status reason</dt><dd>{facility.statusReason ?? 'Not recorded'}</dd></div>
          <div><dt>Status changed</dt><dd>{date(facility.statusChangedAt)}</dd></div>
          <div><dt>Created</dt><dd>{date(facility.createdAt)}</dd></div>
          <div><dt>Active staff memberships</dt><dd>{facility.membershipCount}</dd></div>
        </dl>
        {has(actor, 'platform.facility.manage') && <FacilityStatusAction facility={facility} reload={resource.reload} />}
      </section>
      {has(actor, 'platform.audit.read') && <FacilityAudit facilityId={facility.id} />}
    </div>}</ResourceView>
  </Page>
}
