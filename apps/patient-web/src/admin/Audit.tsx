import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { usesNovuBackend } from '../backendContract'
import { adminApi, type AuditEvent, type AuditFilters } from './api'
import { failure } from './problems'
import { Page, Refresh, ResourceView, Status, Table, date, useResource, useUrlFilters } from './ui'
import { ACTION_GROUPS, OUTCOME_CHOICES, adminAuditRow, isListedAction, purposeText } from './auditWords'
import { Alert, Button, Field, Input, Select } from '../kasuwa/ui'

const FILTER_KEYS = ['actor', 'action', 'outcome', 'facilityId', 'resourceType', 'resourceId', 'correlationId', 'from', 'to'] as const
const OUTCOMES = ['success', 'denied', 'failure'] as const
/** Filters set only by a link (a person, a facility, an item), never typed: their IDs are not shown. */
const LINK_ONLY = ['actor', 'facilityId', 'resourceType', 'resourceId'] as const
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
  return <Link to={`/admin/facilities/${encodeURIComponent(event.facilityId)}`}>A facility</Link>
}

/** A filter that came from a link (a person, a facility, an item), said in words with a button that removes it. */
function LinkedFilter({ text, clear, clearText }: { text: string; clear: () => void; clearText: string }) {
  return <p className="m-0 flex flex-wrap items-center gap-2 text-sm text-ink-2">{text}
    <Button size="sm" variant="ghost" onClick={clear}>{clearText}</Button></p>
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
    // A person, facility or item comes only from a link: kept while it is sent, dropped when it is not.
    setValues(Object.fromEntries(FILTER_KEYS.map(name => [name, (LINK_ONLY as readonly string[]).includes(name)
      ? (filters[name as (typeof LINK_ONLY)[number]] ? values[name] : '') : draft[name].trim()])))
  }

  function clear() {
    const empty = Object.fromEntries(FILTER_KEYS.map(name => [name, ''])) as typeof values
    setDraft(empty); setValues(empty)
  }

  const field = (name: (typeof FILTER_KEYS)[number]) => ({
    value: draft[name], onChange: (event: { target: { value: string } }) => setDraft(current => ({ ...current, [name]: event.target.value })),
  })

  /** Removes filters that came from a link, keeping the rest. */
  function drop(names: ReadonlyArray<(typeof FILTER_KEYS)[number]>) {
    const empty = Object.fromEntries(names.map(name => [name, ''])) as Partial<typeof values>
    setDraft(current => ({ ...current, ...empty })); setValues(empty)
  }

  const extra = (['correlationId', 'from', 'to'] as const).filter(name => values[name]).length
  // An action from a link that has no words of its own is chosen, and said, without its code.
  const linkedAction = values.action && !isListedAction(values.action) ? values.action : ''
  return <Page eyebrow="Security" title="Audit" description="What happened on the platform and in facilities, newest first. Each search is recorded."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <form className="flex flex-col gap-4 rounded-xl bg-surface p-4 ring-1 ring-line" onSubmit={apply} role="search" aria-label="Filter audit events">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3">
        <Field label="What happened" htmlFor="audit-action"><Select id="audit-action" {...field('action')}>
          <option value="">Any action</option>
          {linkedAction && <option value={linkedAction}>The action from your link</option>}
          {ACTION_GROUPS.map(group => <optgroup key={group.area} label={group.area}>
            {group.choices.map(choice => <option key={choice.code} value={choice.code}>{choice.text}</option>)}</optgroup>)}
        </Select></Field>
        <Field label="Result" htmlFor="audit-outcome"><Select id="audit-outcome" {...field('outcome')}><option value="">Any result</option>
          {OUTCOME_CHOICES.map(choice => <option key={choice.value} value={choice.value}>{choice.text}</option>)}</Select></Field>
      </div>
      {filters.actor && <LinkedFilter text="Showing one person's activity." clear={() => drop(['actor'])} clearText="Show everyone" />}
      {filters.facilityId && <LinkedFilter text="Showing one facility's activity." clear={() => drop(['facilityId'])} clearText="Show all facilities" />}
      {filters.resourceType && <LinkedFilter text={filters.resourceType === 'facility' ? 'Showing changes to one facility.' : 'Showing changes to one item.'}
        clear={() => drop(['resourceType', 'resourceId'])} clearText="Show every item" />}
      <details className="group" open={extra > 0}>
        <summary className="cursor-pointer text-sm font-medium text-brand-ink">More filters{extra ? ` (${extra} on)` : ''}</summary>
        <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3">
          <Field label="From" htmlFor="audit-from"><Input id="audit-from" type="datetime-local" {...field('from')} /></Field>
          <Field label="To" htmlFor="audit-to"><Input id="audit-to" type="datetime-local" {...field('to')} /></Field>
          <Field label="Error reference" htmlFor="audit-correlation" hint="The reference from an error message, to find what happened then.">
            <Input id="audit-correlation" {...field('correlationId')} /></Field>
        </div>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary">Apply filters</Button>
        <Button variant="ghost" onClick={clear}>Clear</Button>
      </div>
    </form>
    <ResourceView resource={resource} emptyTitle="No events match" empty={result => result.items.length === 0}>{result => <>
      <Table headings={['When', 'What happened', 'Result', 'Who', 'Where']}>
        {[...result.items, ...(older?.items ?? [])].map(item => {
          const row = adminAuditRow(item)
          const purpose = purposeText(item.purposeOfUse)
          return <tr key={item.eventId}><td>{date(item.occurredAt)}</td>
            <td>{row.what}{item.reason ? <small>{item.reason}</small> : null}
              {purpose ? <small>Purpose: {purpose}</small> : null}</td>
            <td><Status value={row.outcome} text={row.outcomeText} /></td>
            <td>{row.who}</td>
            <td><Scope event={item} /></td></tr>
        })}
      </Table>
      {olderError ? <Alert intent="error" size="sm">{olderError}</Alert> : null}
      {next ? <Button className="self-start" onClick={() => void loadOlder()} loading={loadingOlder} disabled={loadingOlder}>
        {loadingOlder ? 'Loading…' : 'Load older events'}</Button> : null}
    </>}</ResourceView>
  </Page>
}
