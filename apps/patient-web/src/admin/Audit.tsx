import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { usesNovuBackend } from '../backendContract'
import { adminApi, type AuditEvent, type AuditFilters } from './api'
import { failure } from './problems'
import { Page, Refresh, ResourceView, Status, Table, date, label, useResource, useUrlFilters } from './ui'
import { Alert, Button, Field, Input, Select } from '../kasuwa/ui'

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

  const extra = (['facilityId', 'resourceType', 'resourceId', 'correlationId', 'from', 'to'] as const).filter(name => values[name]).length
  return <Page eyebrow="Security" title="Audit" description="What happened on the platform and in facilities, newest first. Each search is recorded."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <form className="flex flex-col gap-4 rounded-xl bg-surface p-4 ring-1 ring-line" onSubmit={apply} role="search" aria-label="Filter audit events">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3">
        <Field label="Who" htmlFor="audit-actor"><Input id="audit-actor" {...field('actor')} placeholder="Their exact ID" /></Field>
        <Field label="What happened" htmlFor="audit-action"><Input id="audit-action" {...field('action')} placeholder="For example admin.account.status" /></Field>
        <Field label="Result" htmlFor="audit-outcome"><Select id="audit-outcome" {...field('outcome')}><option value="">Any result</option>
          {OUTCOMES.map(value => <option key={value} value={value}>{label(value)}</option>)}</Select></Field>
      </div>
      <details className="group" open={extra > 0 || invalidFacility || invalidTarget}>
        <summary className="cursor-pointer text-sm font-medium text-brand-ink">More filters{extra ? ` (${extra} on)` : ''}</summary>
        <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3">
          <Field label="From" htmlFor="audit-from"><Input id="audit-from" type="datetime-local" {...field('from')} /></Field>
          <Field label="To" htmlFor="audit-to"><Input id="audit-to" type="datetime-local" {...field('to')} /></Field>
          <Field label="Facility ID" htmlFor="audit-facility" error={invalidFacility ? 'Enter a full facility ID.' : undefined}>
            <Input id="audit-facility" {...field('facilityId')} aria-invalid={invalidFacility} /></Field>
          {servesTargetFilter() && <>
            <Field label="Item type" htmlFor="audit-type"><Input id="audit-type" {...field('resourceType')} placeholder="For example facility" aria-invalid={invalidTarget} /></Field>
            <Field label="Item ID" htmlFor="audit-id"><Input id="audit-id" {...field('resourceId')} aria-invalid={invalidTarget} /></Field></>}
          <Field label="Request code" htmlFor="audit-correlation"><Input id="audit-correlation" {...field('correlationId')} /></Field>
        </div>
      </details>
      {invalidTarget && <Alert intent="error" size="sm">Enter an item type (lower-case words, like facility) before an item ID.</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={invalidFacility || invalidTarget}>Apply filters</Button>
        <Button variant="ghost" onClick={clear}>Clear</Button>
      </div>
    </form>
    <ResourceView resource={resource} emptyTitle="No events match" empty={result => result.items.length === 0}>{result => <>
      <Table headings={['When', 'What happened', 'Result', 'Who', 'Where']}>
        {[...result.items, ...(older?.items ?? [])].map(item => <tr key={item.eventId}><td>{date(item.occurredAt)}</td>
          <td>{label(item.action)}{item.reason ? <small>{item.reason}</small> : null}
            <details className="mt-1"><summary className="cursor-pointer text-[12px] font-medium text-brand-ink">Details</summary>
              <small>Item: {item.resourceType ? label(item.resourceType) : 'Not recorded'}{item.resourceId ? ` · ${item.resourceId}` : ''}</small>
              <small>Purpose: {item.purposeOfUse ? label(item.purposeOfUse) : 'Not recorded'}</small>
              <small>Request code: <code>{item.correlationId}</code></small></details></td>
          <td><Status value={item.outcome} /></td>
          <td>{item.actorSubject || 'System'}{item.actorType ? <small>{label(item.actorType)}</small> : null}</td>
          <td><Scope event={item} /></td></tr>)}
      </Table>
      {olderError ? <Alert intent="error" size="sm">{olderError}</Alert> : null}
      {next ? <Button className="self-start" onClick={() => void loadOlder()} loading={loadingOlder} disabled={loadingOlder}>
        {loadingOlder ? 'Loading…' : 'Load older events'}</Button> : null}
    </>}</ResourceView>
  </Page>
}
