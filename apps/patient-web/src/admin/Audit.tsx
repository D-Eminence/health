import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { usesNovuBackend } from '../backendContract'
import { adminApi, type AuditEvent, type AuditFilters } from './api'
import { failure } from './problems'
import { Page, Refresh, ResourceView, Status, Table, date, label, useResource, useUrlFilters } from './ui'

const FILTER_KEYS = ['actor', 'action', 'outcome', 'facilityId', 'resourceType', 'resourceId', 'correlationId', 'from', 'to'] as const
const OUTCOMES = ['success', 'denied', 'failure'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
/** `ListPlatformAuditDto` target rules: a target ID needs its type. */
const RESOURCE_TYPE = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

function validTarget(values: { resourceType: string; resourceId: string }) {
  const type = values.resourceType.trim(); const id = values.resourceId.trim()
  if (type && (type.length > 80 || !RESOURCE_TYPE.test(type))) return false
  if (id && (!type || id.length > 255 || !RESOURCE_ID.test(id))) return false
  return true
}

/** A local datetime-input value as an ISO instant, or undefined when empty or invalid. */
function instant(value: string): string | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

/** Novu's audit read (ListPlatformAuditDto) has no target filter: it refuses resourceType and resourceId with 400. */
const servesTargetFilter = () => !usesNovuBackend()

function toFilters(values: Record<(typeof FILTER_KEYS)[number], string>): AuditFilters {
  const outcome = OUTCOMES.find(value => value === values.outcome)
  return {
    ...(values.actor ? { actor: values.actor } : {}),
    ...(values.action ? { action: values.action } : {}),
    ...(outcome ? { outcome } : {}),
    ...(UUID.test(values.facilityId) ? { facilityId: values.facilityId } : {}),
    ...(servesTargetFilter() && validTarget(values) && values.resourceType ? { resourceType: values.resourceType } : {}),
    ...(servesTargetFilter() && validTarget(values) && values.resourceType && values.resourceId ? { resourceId: values.resourceId } : {}),
    ...(values.correlationId ? { correlationId: values.correlationId } : {}),
    ...(instant(values.from) ? { from: instant(values.from) } : {}),
    ...(instant(values.to) ? { to: instant(values.to) } : {}),
  }
}

function Scope({ event }: { event: AuditEvent }) {
  if (!event.facilityId) return <>Platform</>
  return <Link to={`/admin/facilities/${encodeURIComponent(event.facilityId)}`}>Facility<small>{event.facilityId}</small></Link>
}

/** Platform and facility audit events, newest first, with the backend's filters. */
export function AuditPage() {
  const [values, setValues] = useUrlFilters(FILTER_KEYS)
  const [draft, setDraft] = useState(values)
  const filters = toFilters(values)
  // The serialized filters keep the loader stable until a filter actually changes.
  const key = JSON.stringify(filters)
  const load = useCallback((signal?: AbortSignal) => adminApi.audit(JSON.parse(key) as AuditFilters, undefined, signal), [key])
  const resource = useResource(load, 'Audit events could not be loaded.')
  const [older, setOlder] = useState<{ items: AuditEvent[]; next: string | null } | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderError, setOlderError] = useState<string | null>(null)
  useEffect(() => { setOlder(null); setOlderError(null) }, [resource.data])
  const next = older ? older.next : resource.data?.nextBeforeSequenceId ?? null
  const invalidFacility = Boolean(draft.facilityId) && !UUID.test(draft.facilityId)
  const invalidTarget = servesTargetFilter() && !validTarget(draft)

  async function loadOlder() {
    if (!next || loadingOlder) return
    setLoadingOlder(true); setOlderError(null)
    try {
      const page = await adminApi.audit(filters, next)
      setOlder(current => ({ items: [...(current?.items ?? []), ...page.items], next: page.nextBeforeSequenceId }))
    } catch (caught) {
      setOlderError(failure(caught, 'Older audit events could not be loaded.'))
    } finally { setLoadingOlder(false) }
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (invalidFacility || invalidTarget) return
    setValues(Object.fromEntries(FILTER_KEYS.map(name => [name, draft[name].trim()])))
  }

  function clear() {
    const empty = Object.fromEntries(FILTER_KEYS.map(name => [name, ''])) as typeof values
    setDraft(empty); setValues(empty)
  }

  const field = (name: (typeof FILTER_KEYS)[number]) => ({
    value: draft[name], onChange: (event: { target: { value: string } }) => setDraft(current => ({ ...current, [name]: event.target.value })),
  })

  return <Page eyebrow="Security" title="Audit" description="Platform and facility events, newest first. The backend controls what is visible and records each search."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <form className="admin-filters admin-audit-filters" onSubmit={apply} role="search" aria-label="Filter audit events">
      <label>Actor subject<input {...field('actor')} placeholder="Exact subject" /></label>
      <label>Action<input {...field('action')} placeholder="Exact action, for example admin.account.status" /></label>
      <label>Outcome<select {...field('outcome')}><option value="">Any outcome</option>
        {OUTCOMES.map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
      <label>Facility ID<input {...field('facilityId')} aria-invalid={invalidFacility} /></label>
      {servesTargetFilter() && <>
        <label>Target type<input {...field('resourceType')} placeholder="For example facility" aria-invalid={invalidTarget} /></label>
        <label>Target ID<input {...field('resourceId')} aria-invalid={invalidTarget} /></label></>}
      <label>Correlation ID<input {...field('correlationId')} /></label>
      <label>From<input type="datetime-local" {...field('from')} /></label>
      <label>To<input type="datetime-local" {...field('to')} /></label>
      <div className="admin-action-row">
        <button type="submit" className="admin-primary" disabled={invalidFacility || invalidTarget}>Apply filters</button>
        <button type="button" className="admin-secondary" onClick={clear}>Clear</button>
      </div>
      {invalidFacility && <p role="alert" className="admin-error">Enter a full facility ID.</p>}
      {invalidTarget && <p role="alert" className="admin-error">Enter a target type such as facility (lower-case words
        joined by hyphens) before a target ID; IDs use letters, digits, dots, colons, underscores and hyphens.</p>}
    </form>
    <ResourceView resource={resource} empty={result => result.items.length === 0}>{result => <>
      <Table headings={['Occurred', 'Action', 'Outcome', 'Actor', 'Target', 'Scope', 'Purpose', 'Correlation']}>
        {[...result.items, ...(older?.items ?? [])].map(item => <tr key={item.eventId}><td>{date(item.occurredAt)}</td>
          <td>{label(item.action)}{item.reason ? <small>{item.reason}</small> : null}</td>
          <td><Status value={item.outcome} /></td>
          <td>{item.actorSubject || 'System'}{item.actorType ? <small>{label(item.actorType)}</small> : null}</td>
          <td>{item.resourceType ? label(item.resourceType) : 'Not recorded'}{item.resourceId ? <small>{item.resourceId}</small> : null}</td>
          <td><Scope event={item} /></td>
          <td>{item.purposeOfUse ? label(item.purposeOfUse) : 'Not recorded'}</td>
          <td><code>{item.correlationId}</code></td></tr>)}
      </Table>
      {olderError ? <p role="alert" className="admin-error">{olderError}</p> : null}
      {next ? <button type="button" className="admin-secondary" onClick={() => void loadOlder()} disabled={loadingOlder}>
        {loadingOlder ? 'Loading older events…' : 'Load older events'}</button> : null}
    </>}</ResourceView>
  </Page>
}
