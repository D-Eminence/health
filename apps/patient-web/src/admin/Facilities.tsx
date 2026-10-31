import { useCallback, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { usesNovuBackend } from '../backendContract'
import { adminApi, PAGE_SIZE, type AdminActor, type AuditFilters, type Facility } from './api'
import { AssistedRegistrationPanel } from './AssistedRegistration'
import { FacilityStaffPanel } from './FacilityStaffPanel'
import { FacilityOrderRoutesPanel, knownSignUp } from './OrderRoutes'
import { isProblem } from './problems'
import { Search } from 'lucide-react'
import { Button, Field, FilterTabs, Input } from '../kasuwa/ui'
import {
  ActionForm, Subject, type ConfirmSpec, Page, Pager, Refresh, ResourceView, Status, Table, date, has, label, pageNumber, useGovernedSubmit, useResource,
  useUrlFilters,
} from './ui'

/** `ListFacilitiesDto` statuses. */
const FACILITY_STATUSES = ['pending', 'verified', 'rejected', 'suspended'] as const
/** `FacilityStatusCommandDto` targets. */
const FACILITY_TRANSITIONS = ['verified', 'rejected', 'suspended'] as const
/** The backend accepts only UUID v4 facility IDs. */
const FACILITY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const STATUS_CHOICE: Readonly<Record<(typeof FACILITY_TRANSITIONS)[number], (name: string) => Partial<ConfirmSpec>>> = {
  verified: name => ({ title: `Verify ${name}?`, effect: `${name} becomes verified, and its staff can use Health ID.`,
    undo: 'You can suspend it later from this page.', confirmLabel: 'Verify facility', done: `${name} is verified.`, stepUp: `verify ${name}` }),
  suspended: name => ({ title: `Suspend ${name}?`, effect: `Everyone at ${name} loses access to Health ID at once.`,
    undo: 'To restore access, verify it again from this page.', confirmLabel: 'Suspend facility', destructive: true,
    done: `${name} is suspended. Its staff can’t use Health ID.`, stepUp: `suspend ${name}` }),
  rejected: name => ({ title: `Reject ${name}?`, effect: `${name} is rejected. Its staff can’t use Health ID.`,
    undo: 'If this was a mistake, verify it later from this page.', confirmLabel: 'Reject facility', destructive: true,
    done: `${name} is rejected.`, stepUp: `reject ${name}` }),
}

function FacilityStatusAction({ facility, reload }: { facility: Facility; reload: () => void }) {
  return <ActionForm title="Change status" subject={<Subject name={facility.name} detail={`${facility.organizationName} · now ${label(facility.status).toLowerCase()}`} />}
    options={FACILITY_TRANSITIONS.filter(status => status !== facility.status).map(value => ({ value, title: label(value) }))}
    describe={choice => choice ? STATUS_CHOICE[choice.value as (typeof FACILITY_TRANSITIONS)[number]](facility.name) : {}}
    onSubmit={async (status, reason, idempotencyKey) => {
      await adminApi.command(`/api/v1/admin/facilities/${encodeURIComponent(facility.id)}/status`,
        { status, reason }, { version: facility.version, idempotencyKey })
      reload()
    }} />
}

/** Health ID support's number, which an alert gives for a facility without its own (hid-system #109). */
const SUPPORT_PHONE = '+234 702 671 7252'
/** This section's explanations of the alert phone command's refusals (hid-system #109 admin.service.ts). */
const ALERT_PHONE_PROBLEMS: Readonly<Record<string, string>> = {
  ADMIN_INVALID_FACILITY_PHONE: 'Enter the facility phone in international format (+234...) or as an 11-digit number starting with 0.',
  VERSION_CONFLICT: 'This facility changed since it was read. It has been read again: check it, then make your change again.',
  PERMISSION_DENIED: 'Your roles don’t let you change this. Ask a Super Admin.',
  // ADMIN_NO_STATE_CHANGE: the number given is the one already set (after normalising, so 0803... matches +234803...).
  ADMIN_STATE_CONFLICT: 'The facility already has this alert phone number, or none if you are clearing it. Nothing was changed.',
}
const ALERT_PHONE = 'admin-facility-alert-phone'

/**
 * The phone an emergency-contact alert gives for this facility (hid-system #109, which only Novu serves: main has
 * neither the field nor the route). Changing it needs platform.facility.manage, a reason, the submission's
 * Idempotency-Key and If-Match with the facility's version, which it bumps as a status change does. Cleared, alerts
 * give Health ID support's number.
 */
function FacilityAlertPhone({ facility, actor, reload }: { facility: Facility; actor: AdminActor; reload: () => void }) {
  const [phone, setPhone] = useState('')
  const [clearing, setClearing] = useState(false)
  const [reason, setReason] = useState('')
  const [phoneRefused, setPhoneRefused] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const phoneInput = useRef<HTMLInputElement>(null)
  const governed = useGovernedSubmit()
  const current = facility.alertPhoneE164 ?? null
  // Clearing applies only while a number is set: a reload may find it already cleared, and the checkbox gone.
  const clearingNow = clearing && current !== null
  const ready = reason.trim().length >= 8 && (clearingNow || phone.trim().length > 0)
  // Said at the field, and focus moves there in the commit that shows it, so its description is read and a check made
  // as soon as it shows finds it there.
  useLayoutEffect(() => { if (phoneRefused) phoneInput.current?.focus() }, [phoneRefused])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (governed.busy || !ready) return
    setNotice(null); setPhoneRefused(false)
    let refused: unknown = null
    const saved = await governed.submit(async idempotencyKey => {
      try { return await adminApi.setFacilityAlertPhone(facility, clearingNow ? null : phone.trim(), reason.trim(), idempotencyKey) }
      catch (caught) { refused = caught; throw caught }
    }, 'The alert phone number could not be saved. Try again.', ALERT_PHONE_PROBLEMS)
    if (saved) {
      setPhone(''); setReason(''); setClearing(false)
      setNotice(saved.alertPhoneE164 ? `Saved. Alerts about emergency access here now give ${saved.alertPhoneE164}.`
        : `Cleared. Alerts about emergency access here now give Health ID support's number (${SUPPORT_PHONE}).`)
      reload()
    } else if (isProblem(refused, 'ADMIN_INVALID_FACILITY_PHONE')) {
      setPhoneRefused(true)
    } else if (isProblem(refused, 'VERSION_CONFLICT')) reload()
  }

  return <section className="admin-panel" aria-labelledby={`${ALERT_PHONE}-title`}>
    <div className="admin-panel-head"><div><h2 id={`${ALERT_PHONE}-title`}>Alert phone number</h2>
      <p>The number a patient's emergency contacts are told to call when a health worker here uses emergency access to the
        patient's record.</p></div></div>
    <dl className="admin-detail-grid">
      <div><dt>Current number</dt><dd>{current ?? `Not set: alerts give Health ID support's number (${SUPPORT_PHONE})`}
        {current && <small>Changed {date(facility.alertPhoneUpdatedAt)}</small>}</dd></div>
    </dl>
    {has(actor, 'platform.facility.manage') ? <details className="admin-action">
      <summary>Change the alert phone number</summary>
      <form onSubmit={event => void submit(event)} className="admin-action-form">
        {current && <label className="admin-checkbox"><input type="checkbox" checked={clearing}
          onChange={event => { setClearing(event.target.checked); setPhoneRefused(false) }} />
          Clear it: alerts then give Health ID support's number</label>}
        <label>Facility phone number<input ref={phoneInput} type="tel" autoComplete="off" maxLength={32} value={phone}
          disabled={clearingNow} onChange={event => { setPhone(event.target.value); setPhoneRefused(false) }}
          aria-invalid={phoneRefused || undefined}
          aria-describedby={phoneRefused ? `${ALERT_PHONE}-hint ${ALERT_PHONE}-error` : `${ALERT_PHONE}-hint`} /></label>
        <small id={`${ALERT_PHONE}-hint`} className="admin-note">In international format (+234...) or as an 11-digit number
          starting with 0.</small>
        <label>Reason for changing the alert phone number<textarea required minLength={8} maxLength={500} rows={3}
          value={reason} onChange={event => setReason(event.target.value)} /></label>
        <button type="submit" className="admin-primary" disabled={governed.busy || !ready}>
          {governed.busy ? 'Saving…' : clearingNow ? 'Clear alert phone number' : 'Save alert phone number'}
        </button>
        {governed.error && <p id={`${ALERT_PHONE}-error`} className="admin-error" role="alert">{governed.error}</p>}
        <div role="status">{notice && <p className="admin-success">{notice}</p>}</div>
      </form>
    </details> : <p className="admin-note">Your roles don’t let you change it.</p>}
  </section>
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

  const manage = has(actor, 'platform.facility.manage')
  return <Page eyebrow="Organizations" title="Facilities" description="Every facility, its status and its staff count."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <FilterTabs label="Facility status" value={filters.status} onChange={value => setFilters({ status: value, page: '' })}
      options={[{ value: '', label: 'All' }, ...FACILITY_STATUSES.map(value => ({ value, label: label(value) }))]} />
    <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={search} role="search" aria-label="Filter facilities">
      <Field label="Name or code" htmlFor="admin-facility-query" className="min-w-0 flex-1 sm:max-w-md">
        <Input id="admin-facility-query" type="search" icon={Search} value={input} minLength={2} placeholder="At least 2 characters"
          onChange={event => setInput(event.target.value)} /></Field>
      <Button type="submit" disabled={input.trim().length === 1}>Search</Button>
      {(filters.status || filters.query) && <Button variant="ghost"
        onClick={() => { setInput(''); setFilters({ status: '', query: '', page: '' }) }}>Clear filters</Button>}
    </form>
    <ResourceView resource={resource} emptyTitle="No facilities match" empty={result => result.items.length === 0}>{result => <>
      <p className="m-0 text-caption text-ink-3">{result.items.length} of {result.total} facilities</p>
      <Table headings={['Facility', 'Organization', 'Status', 'Staff', 'Status changed', ...(manage ? [''] : [])]}>
        {result.items.map(facility => <tr key={facility.id}>
          <td><Link to={`/admin/facilities/${encodeURIComponent(facility.id)}`}><strong>{facility.name}</strong></Link><small>{facility.code}</small></td>
          <td>{facility.organizationName}</td>
          <td><Status value={facility.status} />{facility.statusReason ? <small>{facility.statusReason}</small> : null}</td>
          <td>{facility.membershipCount}</td>
          <td>{date(facility.statusChangedAt)}</td>
          {manage && <td className="text-right"><FacilityStatusAction facility={facility} reload={resource.reload} /></td>}
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
      <Table headings={['When', 'What happened', 'Result', 'Who']}>
        {result.items.slice(0, 10).map(item => <tr key={item.eventId}><td>{date(item.occurredAt)}</td>
          <td>{label(item.action)}{withReason && item.reason ? <small>{item.reason}</small> : null}</td>
          <td><Status value={item.outcome} /></td><td>{item.actorSubject || 'System'}</td></tr>)}
      </Table>}</ResourceView>
  </section>
}

function FacilityAudit({ facilityId }: { facilityId: string }) {
  const target = new URLSearchParams({ resourceType: 'facility', resourceId: facilityId }).toString()
  // Novu's audit read has no target filter (it refuses resourceType and resourceId with 400).
  return <>
    {!usesNovuBackend() && <AuditExcerpt id="admin-facility-platform-audit-title" title="Platform changes to this facility"
      description="Platform administration commands that targeted this facility, such as status changes, with their reasons."
      filters={{ resourceType: 'facility', resourceId: facilityId }} search={target} withReason />}
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
      <Link className="self-start text-sm font-medium text-brand-ink" to="/admin/facilities">← All facilities</Link>
    </Page>
  }
  return <FacilityDetail facilityId={facilityId} actor={actor} />
}

function FacilityDetail({ facilityId, actor }: { facilityId: string; actor: AdminActor }) {
  // Opened from "New facility sign-ups": what that list says of the sign-up (its type and review), for the panel of
  // orders with other facilities; the facility record itself does not carry them.
  const signUp = knownSignUp(useLocation().state, facilityId)
  const load = useCallback((signal?: AbortSignal) => adminApi.facility(facilityId, signal), [facilityId])
  const resource = useResource(load, 'This facility could not be loaded.')
  // A refresh or status change reloads the audit excerpts too: the change is audited with it.
  const [revision, setRevision] = useState(0)
  // ... and the designation for registration in person, which its own change reads again by itself.
  const [refreshes, setRefreshes] = useState(0)
  const reload = () => { resource.reload(); setRevision(value => value + 1); setRefreshes(value => value + 1) }
  return <Page eyebrow="Facility" title={resource.data?.name ?? 'Facility'} description="The platform record for one facility."
    action={<Refresh onClick={reload} disabled={resource.loading} />}>
    <Link className="self-start text-sm font-medium text-brand-ink" to="/admin/facilities">← All facilities</Link>
    <ResourceView resource={resource}>{facility => <div className="admin-stack">
      <section className="admin-panel">
        <dl className="admin-detail-grid">
          <div><dt>Organization</dt><dd>{facility.organizationName}<small>{facility.organizationId}</small></dd></div>
          <div><dt>Code</dt><dd>{facility.code}</dd></div>
          <div><dt>Status</dt><dd><Status value={facility.status} /></dd></div>
          <div><dt>Status reason</dt><dd>{facility.statusReason ?? 'Not recorded'}</dd></div>
          <div><dt>Status changed</dt><dd>{date(facility.statusChangedAt)}</dd></div>
          <div><dt>Created</dt><dd>{date(facility.createdAt)}</dd></div>
          <div><dt>Active staff</dt><dd>{facility.membershipCount}</dd></div>
        </dl>
        {has(actor, 'platform.facility.manage') && <div className="mt-4"><FacilityStatusAction facility={facility} reload={reload} /></div>}
      </section>
      {/* hid-system #109, which only Novu serves: main has neither the field nor the route. A change is audited
          against the facility, so the page's reload reads the audit excerpts again too. */}
      {usesNovuBackend() && <FacilityAlertPhone facility={facility} actor={actor} reload={reload} />}
      {/* A self-signed-up facility's staff and the licences it vouched for (Novu, P4b); read only when asked: every read is audited. */}
      {usesNovuBackend() && has(actor, 'platform.principal.read') && <FacilityStaffPanel facilityId={facility.id} />}
      {/* Orders sent to, or received from, other facilities, and the listing for them (Novu, P4c); read only when asked. */}
      {usesNovuBackend() && has(actor, 'platform.facility.read') && <FacilityOrderRoutesPanel facilityId={facility.id}
        facilityName={facility.name} actor={actor} known={signUp} />}
      {/* A designation change is audited against the facility: the audit excerpts are read again with it. */}
      <AssistedRegistrationPanel facilityId={facility.id} facilityStatus={facility.status} refresh={refreshes} actor={actor}
        onChanged={() => setRevision(value => value + 1)} />
      {has(actor, 'platform.audit.read') && <FacilityAudit key={revision} facilityId={facility.id} />}
    </div>}</ResourceView>
  </Page>
}
