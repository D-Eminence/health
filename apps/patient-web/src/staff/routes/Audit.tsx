import { useEffect, useState } from 'react'
import { Badge, Button, Card, EmptyState, Field, Input, Select } from '@hid/ui'
import { isHidApiError } from '@hid/http'
import { staffApi, type FacilityAuditPage } from '../api'
import { useStaff } from '../App'

type PagePosition = { facilityId: string; cursors: Array<string | undefined> }
type LoadedPage = { facilityId: string; cursor: string | undefined; page: FacilityAuditPage }
type LoadProblem = { facilityId: string; cursor: string | undefined; message: string }

function displayTime(value: string): string {
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? 'Time unavailable' : time.toLocaleString()
}

function outcomeTone(outcome: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (outcome === 'success') return 'success'
  if (outcome === 'denied') return 'warning'
  if (outcome === 'failure') return 'danger'
  return 'neutral'
}

export function FacilityAudit() {
  const { state } = useStaff()
  const facility = state.status === 'ready' ? state.session.actor.facility : undefined
  const facilityId = facility?.id ?? ''
  const allowed = facility?.permissions.includes('audit.read') ?? false
  const [position, setPosition] = useState<PagePosition>({ facilityId: '', cursors: [undefined] })
  const [loaded, setLoaded] = useState<LoadedPage | null>(null)
  const [problem, setProblem] = useState<LoadProblem | null>(null)
  const [loading, setLoading] = useState(false)
  const [reload, setReload] = useState(0)
  const [search, setSearch] = useState('')
  const [outcome, setOutcome] = useState('all')
  const cursors = position.facilityId === facilityId ? position.cursors : [undefined]
  const cursor = cursors[cursors.length - 1]
  const page = loaded?.facilityId === facilityId && loaded.cursor === cursor ? loaded.page : null
  const error = problem?.facilityId === facilityId && problem.cursor === cursor ? problem.message : ''

  useEffect(() => {
    if (!facilityId || !allowed) return
    let active = true
    setLoading(true)
    setProblem(null)
    void staffApi.facilityAudit(facilityId, cursor).then(next => {
      if (active) setLoaded({ facilityId, cursor, page: next })
    }).catch(caught => {
      if (!active) return
      setProblem({ facilityId, cursor, message: isHidApiError(caught) && caught.status === 403
        ? 'Your current facility membership cannot review audit events.'
        : caught instanceof Error ? caught.message : 'Audit events could not be loaded.' })
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [facilityId, allowed, cursor, reload])

  if (!facility || !allowed) return <EmptyState titleAs="h1" title="Audit access unavailable" description="Your active facility membership needs audit.read permission to review its events." />

  const query = search.trim().toLocaleLowerCase()
  const visible = page?.items.filter(event =>
    (outcome === 'all' || event.outcome === outcome)
    && (!query || [event.action, event.correlationId, event.resourceType ?? '', event.actorType]
      .some(value => value.toLocaleLowerCase().includes(query)))) ?? []

  return <>
    <div className="staff-page-head">
      <p className="staff-eyebrow">Healthcare operations</p>
      <h1>Facility audit.</h1>
      <p>Review events for {facility.name}. The server checks your current membership and records each review. Patient identifiers, free-text reasons, and event details are withheld from this view.</p>
    </div>
    <div className="staff-row staff-toolbar">
      <Button tone="secondary" size="sm" onClick={() => setReload(value => value + 1)} disabled={loading}>Refresh events</Button>
      {cursors.length > 1 && <Button tone="quiet" size="sm" onClick={() => setPosition({ facilityId, cursors: cursors.slice(0, -1) })} disabled={loading}>Newer page</Button>}
      {page?.nextBeforeSequenceId && <Button tone="quiet" size="sm" onClick={() => setPosition({ facilityId, cursors: [...cursors, page.nextBeforeSequenceId ?? undefined] })} disabled={loading}>Older page</Button>}
      {page && <span className="staff-muted">Page {cursors.length} · {page.items.length} events</span>}
    </div>
    <div className="staff-form-row" style={{ maxWidth: 650, margin: '18px 0 7px' }}>
      <Field label="Search this page" htmlFor="audit-search">
        <Input id="audit-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Action, actor type, resource, correlation ID" />
      </Field>
      <Field label="Outcome on this page" htmlFor="audit-outcome">
        <Select id="audit-outcome" value={outcome} onChange={event => setOutcome(event.target.value)}>
          <option value="all">All outcomes</option><option value="success">Success</option>
          <option value="denied">Denied</option><option value="failure">Failure</option>
        </Select>
      </Field>
    </div>
    <p className="staff-muted">Search and outcome filters apply to the current page only. Use Older page to review earlier events.</p>
    {loading && <p className="staff-muted" role="status">Loading audit events…</p>}
    {error && <p className="staff-error" role="alert">{error} <Button tone="quiet" size="sm" onClick={() => setReload(value => value + 1)}>Try again</Button></p>}
    {!loading && page?.items.length === 0 && <EmptyState title="No audit events" description="The server returned no events for this page and facility." />}
    {!loading && page && page.items.length > 0 && visible.length === 0 && <EmptyState title="No matching events on this page" description="Change the search or outcome filter, or review another page." />}
    {page && visible.length > 0 && <Card className="staff-table-wrap"><table className="staff-table">
      <thead><tr><th>Occurred</th><th>Action</th><th>Outcome</th><th>Actor type</th><th>Resource type</th><th>Correlation ID</th></tr></thead>
      <tbody>{visible.map(event => <tr key={event.sequenceId}>
        <td data-label="Occurred">{displayTime(event.occurredAt)}</td>
        <td data-label="Action">{event.action}</td>
        <td data-label="Outcome"><Badge tone={outcomeTone(event.outcome)}>{event.outcome}</Badge></td>
        <td data-label="Actor type">{event.actorType}</td>
        <td data-label="Resource type">{event.resourceType ?? 'Not recorded'}</td>
        <td data-label="Correlation ID"><code>{event.correlationId}</code></td>
      </tr>)}</tbody>
    </table></Card>}
  </>
}
