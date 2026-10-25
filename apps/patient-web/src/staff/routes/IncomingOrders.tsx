import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { Badge, Button, Card, Field, Input, Select, Textarea } from '@hid/ui'
import {
  orderRoutesApi, type IncomingOrderRoute, type IncomingOrderRoutes, type OrderRouteAccepted, type OrderRouteDeclineReason,
  type ReceivingService,
} from '../api'
import {
  acceptRefusal, calendarDate, CONTROLLED_MEDICINE_CHECK, DECLINE_REASONS, declineRefusal, incomingProblem, licenceLine,
  priorityLabel, routeMoment,
} from '../orderRoutes'
import { BUSY, UNAVAILABLE } from '../focus'

/** A Health ID as Identity stores it (identity 0002). */
const HID_PATTERN = /^HID-[A-HJ-NP-Z2-9]{6,32}$/
const HID_PROBLEM = 'Check the Health ID: it starts with HID-, then 6 to 32 letters and digits, and never uses 0, 1, I or O.'
/** How often Incoming is read again while the page is in view (SPEC-FINAL §13.3). */
export const INCOMING_REFRESH_MS = 120_000

function normalizedHealthId(value: string): string {
  return value.trim().toUpperCase()
}

function today(): string {
  const now = new Date()
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** What the order is, in its card's title. */
function orderTitle(route: IncomingOrderRoute, service: ReceivingService): string {
  return (service === 'lab' ? route.test?.name : route.medication?.display) ?? (service === 'lab' ? 'Lab request' : 'Prescription')
}

/** The prescription's dose, route and frequency, as far as they were written. */
function doseLine(route: IncomingOrderRoute): string | null {
  const dose = route.doseQuantity === null || route.doseQuantity === undefined || route.doseQuantity === ''
    ? null : `${String(route.doseQuantity)} ${route.doseUnit ?? ''}`.trim()
  const parts = [dose, route.routeCode ? `Route: ${route.routeCode}` : null, route.frequency ?? null].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

/** "Tunde Bello, male, born 12 Mar 1985, Health ID ending 7KQ2". */
export function patientCard(patient: { fullName: string; sex: string | null; dateOfBirth: string | null; healthIdLast4: string | null }): string {
  return [patient.fullName, patient.sex, patient.dateOfBirth ? `born ${calendarDate(patient.dateOfBirth)}` : null,
    patient.healthIdLast4 ? `Health ID ending ${patient.healthIdLast4}` : null].filter(Boolean).join(', ')
}

/**
 * Orders other facilities sent here, waiting to be accepted (Novu, P4c, SPEC-FINAL §13.3): for a laboratory scientist
 * (lab.order-route.receive) or a pharmacist (pharmacy.order-route.receive). The patient is not named until the order
 * is accepted, with their Health ID or date of birth; five wrong tries lock that order here. Read when the page opens,
 * when the window comes back into focus, and every 2 minutes while the page is in view. A backend without the route
 * (404) shows nothing.
 *
 * Each read is audited (lab.order-route.list / pharmacy.order-route.list). With `probe` (a governed facility, whose
 * type the session does not say: it may be a hospital, which never receives), the list is read once, when the page
 * opens, and nothing is shown or read again unless an order is waiting: then `onFound` says so, and the page treats the
 * facility as receiving. A Health ID typed to find a patient's orders is sent only when Find or Refresh is pressed, or
 * an order is acted on: never by the timer or on focus, since the route takes it in the address (`?healthId=`).
 */
export function IncomingOrders({ service, facilityId, facilityName, onAccepted, probe = false, onFound }: {
  service: ReceivingService; facilityId: string; facilityName: string; onAccepted: () => void
  probe?: boolean; onFound?: () => void
}) {
  const [answer, setAnswer] = useState<IncomingOrderRoutes | null>(null)
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [healthId, setHealthId] = useState('')
  const [filter, setFilter] = useState('')
  const [filterError, setFilterError] = useState('')
  const [accepted, setAccepted] = useState<{ title: string; result: OrderRouteAccepted } | null>(null)
  const [notice, setNotice] = useState('')
  const sequence = useRef(0)

  const load = useCallback(async (forHealthId: string) => {
    const request = ++sequence.current
    setLoading(true)
    try {
      const read = await orderRoutesApi.incoming(facilityId, service, forHealthId || undefined)
      if (request !== sequence.current) return
      setAnswer({ items: Array.isArray(read?.items) ? read.items : [], crossFacilityOrders: read?.crossFacilityOrders === true,
        crossFacilityWork: read?.crossFacilityWork !== false })
      setError(''); setMissing(false)
    } catch (caught) {
      if (request !== sequence.current) return
      const problem = incomingProblem(caught)
      if (problem === null) setMissing(true)
      else setError(problem)
    } finally { if (request === sequence.current) setLoading(false) }
  }, [facilityId, service])

  // Read when the page opens, and once for each Health ID asked for.
  useEffect(() => {
    void load(filter)
    return () => { sequence.current += 1 }
  }, [load, filter])
  // Read again every 2 minutes and on focus: only at a facility that receives, and never with a Health ID.
  useEffect(() => {
    if (probe || filter) return
    const again = () => { if (document.visibilityState === 'visible') void load('') }
    const timer = window.setInterval(again, INCOMING_REFRESH_MS)
    window.addEventListener('focus', again)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', again) }
  }, [load, filter, probe])
  const waiting = Boolean(answer && answer.items.length > 0)
  useEffect(() => { if (probe && waiting) onFound?.() }, [probe, waiting, onFound])

  function find(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = normalizedHealthId(healthId)
    if (!value) { setFilterError(''); setFilter(''); return }
    if (!HID_PATTERN.test(value)) { setFilterError(HID_PROBLEM); return }
    setFilterError(''); setNotice(''); setFilter(value)
  }

  if (missing || (probe && !waiting)) return null
  const items = answer?.items ?? []
  const ordersOn = answer?.crossFacilityOrders !== false
  const word = service === 'lab' ? 'lab requests' : 'prescriptions'
  return <section className="staff-section staff-incoming" aria-labelledby={`${service}-incoming-title`}><Card className="staff-card staff-stack">
    <div className="staff-row"><h2 id={`${service}-incoming-title`} tabIndex={-1}>Incoming{answer ? ` (${items.length})` : ''}</h2>
      <Button tone="secondary" size="sm" aria-disabled={loading || undefined} className={UNAVAILABLE}
        onClick={() => { if (!loading) void load(filter) }}>Refresh incoming</Button></div>
    <p className="staff-muted">{service === 'lab' ? 'Lab requests' : 'Prescriptions'} that Health ID clinicians at other facilities
      sent to {facilityName}. Accept one when the patient is with you: you need their Health ID or date of birth.</p>
    {answer && !ordersOn && <p className="staff-notice">Health ID has paused orders between facilities. You can’t accept orders now;
      you can still decline them.</p>}
    <form className="staff-form staff-incoming-find" onSubmit={find} role="search" aria-label={`Find incoming ${word} by Health ID`}>
      <Field label="Find by Health ID" htmlFor={`${service}-incoming-hid`} error={filterError || undefined}
        hint="Ask for the patient’s Health ID to find their order.">
        <Input id={`${service}-incoming-hid`} value={healthId} autoComplete="off" spellCheck={false} maxLength={40}
          onChange={event => setHealthId(event.target.value)} placeholder="HID-…" />
      </Field>
      <div className="staff-row"><Button type="submit" tone="secondary" size="sm">Find</Button>
        {filter && <Button tone="quiet" size="sm" onClick={() => { setHealthId(''); setFilter(''); setFilterError('') }}>Show all</Button>}</div>
      {filter && <p className="staff-muted">Showing the orders for {filter} only. This list is not refreshed on its own while it
        shows one patient’s orders: press Refresh incoming, or Show all.</p>}
    </form>
    <div role="status">{notice && <p className="staff-success">{notice}</p>}{loading && !answer && <p className="staff-muted">Loading incoming orders…</p>}</div>
    {accepted && <AcceptedPanel service={service} title={accepted.title} result={accepted.result} onClose={() => setAccepted(null)} />}
    {error && <p className="staff-error" role="alert">{error}</p>}
    {answer && items.length === 0 && <p className="staff-muted">{filter ? `No order for ${filter} is waiting here.`
      : `No ${word} from other facilities are waiting.`}</p>}
    {items.length > 0 && <div className="staff-list">{items.map(route => <IncomingOrderCard key={`${route.id}-${route.version ?? 0}`}
      service={service} facilityId={facilityId} facilityName={facilityName} route={route} ordersOn={ordersOn}
      onAccepted={result => {
        setAccepted({ title: orderTitle(route, service), result }); setNotice('')
        onAccepted()
        // The patient's order is accepted: the list goes back to every order, without their Health ID.
        if (filter) { setHealthId(''); setFilter('') } else void load('')
      }}
      onDeclined={() => { setNotice(`Declined. ${route.orderingFacilityName ?? 'The ordering facility'} is told.`); void load(filter) }}
      onStale={() => void load(filter)} />)}</div>}
  </Card></section>
}

/** Who the patient is and what the sender wrote, once the order is accepted. */
function AcceptedPanel({ service, title, result, onClose }: {
  service: ReceivingService; title: string; result: OrderRouteAccepted; onClose: () => void
}) {
  const written = service === 'lab' ? result.clinicalInformation : result.instructions
  return <div className="staff-notice staff-stack" role="status">
    <strong>Accepted: {title}.</strong>
    {result.patient ? <p>{patientCard(result.patient)}.</p> : <p>The patient’s details are in the work list below.</p>}
    {written && <p className="staff-note-content">{service === 'lab' ? 'Clinical information' : 'Instructions'}: {written}</p>}
    <p>{licenceLine(result.orderer.licenceBody, result.orderer.licenceNumber)}.</p>
    <p>It is now in the work list below.</p>
    <div className="staff-row"><Button tone="quiet" size="sm" onClick={onClose}>Close</Button></div>
  </div>
}

type Identifier = 'health_id' | 'date_of_birth'

function IncomingOrderCard({ service, facilityId, facilityName, route, ordersOn, onAccepted, onDeclined, onStale }: {
  service: ReceivingService; facilityId: string; facilityName: string; route: IncomingOrderRoute; ordersOn: boolean
  onAccepted: (result: OrderRouteAccepted) => void; onDeclined: () => void; onStale: () => void
}) {
  const [mode, setMode] = useState<'none' | 'accept' | 'decline'>('none')
  const [kind, setKind] = useState<Identifier>('health_id')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [declineReason, setDeclineReason] = useState<OrderRouteDeclineReason | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fieldError, setFieldError] = useState<{ identifier?: string; reason?: string }>({})
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  const id = `incoming-${route.id}`
  const ordering = route.orderingFacilityName ?? 'The ordering facility'
  const title = orderTitle(route, service)
  const version = route.version ?? 0
  const kindWord = service === 'lab' ? 'lab_request' : 'prescription'

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(''); setFieldError({})
    const identifier = kind === 'health_id' ? normalizedHealthId(value) : value.trim()
    if (kind === 'health_id' && !HID_PATTERN.test(identifier)) { setFieldError({ identifier: HID_PROBLEM }); document.getElementById(`${id}-identifier`)?.focus(); return }
    if (kind === 'date_of_birth' && !/^\d{4}-\d{2}-\d{2}$/.test(identifier)) {
      setFieldError({ identifier: 'Enter the patient’s date of birth: day, month and year.' }); document.getElementById(`${id}-identifier`)?.focus(); return
    }
    const why = reason.trim()
    if (service === 'pharmacy' && (why.length < 8 || why.length > 500)) {
      setFieldError({ reason: 'Give a reason of 8 to 500 characters.' }); document.getElementById(`${id}-reason`)?.focus(); return
    }
    if (version < 1) { setError('Refresh the list before accepting this order.'); return }
    // The same details sent again after no answer are the same acceptance; changed details are a new one.
    const signature = JSON.stringify([kind, identifier, service === 'pharmacy' ? why : null])
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    setBusy(true)
    try {
      const result = await orderRoutesApi.accept(facilityId, service, { id: route.id, version },
        { kind, value: identifier }, service === 'pharmacy' ? why : undefined, attempt.current.key)
      attempt.current = null
      onAccepted(result)
    } catch (caught) {
      if (isHidApiError(caught) && caught.status > 0 && caught.status < 500 && caught.status !== 408) attempt.current = null
      const refusal = acceptRefusal(caught, ordering, facilityName)
      if (refusal.field) setFieldError({ [refusal.field]: refusal.text })
      else setError(refusal.text)
      if (refusal.reload) onStale()
    } finally { setBusy(false) }
  }

  async function decline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    if (!declineReason) { setError('Choose why you can’t take it.'); return }
    if (version < 1) { setError('Refresh the list before declining this order.'); return }
    setBusy(true)
    try {
      await orderRoutesApi.decline(facilityId, service, { id: route.id, version }, declineReason)
      onDeclined()
    } catch (caught) {
      const refusal = declineRefusal(caught)
      setError(refusal.text)
      if (refusal.reload) onStale()
    } finally { setBusy(false) }
  }

  const dose = service === 'pharmacy' ? doseLine(route) : null
  return <div className="staff-list-item staff-stack" aria-labelledby={`${id}-title`}>
    <div className="staff-row"><strong id={`${id}-title`} tabIndex={-1}>{title}</strong>
      {route.priority && route.priority !== 'routine' && <Badge tone="warning">{priorityLabel(route.priority)}</Badge>}
      {route.acceptLocked && <Badge tone="danger">Can’t be accepted here</Badge>}</div>
    <p>From {ordering}{route.orderer.name ? ` · Ordered by ${route.orderer.name}` : ''}{route.orderer.name || route.test || route.medication
      ? ` · ${licenceLine(route.orderer.licenceBody)}` : ''}</p>
    {service === 'lab' && route.test && <p className="staff-muted">{[route.test.codeSystem, route.test.code].filter(Boolean).join(' ')}
      {route.specimenTypeCode ? ` · Specimen: ${route.specimenTypeCode}` : ''}{route.priority ? ` · ${priorityLabel(route.priority)}` : ''}</p>}
    {dose && <p>{dose}</p>}
    {service === 'pharmacy' && (route.startsOn || route.endsOn) && <p className="staff-muted">{[route.startsOn && `Starts ${calendarDate(route.startsOn)}`,
      route.endsOn && `Ends ${calendarDate(route.endsOn)}`].filter(Boolean).join(' · ')}</p>}
    <p className="staff-muted">Sent {routeMoment(route.sentAt)} · Accept by {routeMoment(route.respondBy)}{route.reference ? ` · Ref ${route.reference}` : ''}</p>
    <p className="staff-muted">Patient shown after you accept.</p>
    {service === 'pharmacy' && <p className="staff-muted">{CONTROLLED_MEDICINE_CHECK}</p>}
    {route.acceptLocked && <p className="staff-notice staff-danger">Too many wrong tries: this order can’t be accepted here. {ordering} can send it again.</p>}
    {!route.acceptLocked && route.attemptsLeft !== null && route.attemptsLeft < 5 && <p className="staff-muted">{route.attemptsLeft} {route.attemptsLeft === 1 ? 'try' : 'tries'} left to confirm the patient.</p>}
    {mode === 'none' && <div className="staff-row">
      {ordersOn && !route.acceptLocked && <Button id={`${id}-accept-open`} size="sm" onClick={() => { setMode('accept'); setError('') }}>Accept</Button>}
      <Button id={`${id}-decline-open`} tone="secondary" size="sm" onClick={() => { setMode('decline'); setError('') }}>Decline</Button>
    </div>}
    {mode === 'accept' && <form className="staff-form" onSubmit={event => void accept(event)} aria-label={`Accept ${title}`}>
      <fieldset className="staff-order-choices">
        <legend>Confirm who the patient is, with their</legend>
        <label className="staff-choice"><input type="radio" name={`${id}-kind`} checked={kind === 'health_id'}
          onChange={() => { setKind('health_id'); setValue(''); setFieldError({}) }} /> Health ID</label>
        <label className="staff-choice"><input type="radio" name={`${id}-kind`} checked={kind === 'date_of_birth'}
          onChange={() => { setKind('date_of_birth'); setValue(''); setFieldError({}) }} /> Date of birth</label>
      </fieldset>
      <Field label={kind === 'health_id' ? 'Patient’s Health ID' : 'Patient’s date of birth'} htmlFor={`${id}-identifier`} error={fieldError.identifier}
        hint={kind === 'health_id' ? 'As on the patient’s Health ID card or app, for example HID-7KQ2M9.' : 'Ask the patient; check it against a document if you can.'}>
        {kind === 'health_id'
          ? <Input id={`${id}-identifier`} value={value} autoComplete="off" spellCheck={false} maxLength={40} onChange={event => setValue(event.target.value)} />
          : <Input id={`${id}-identifier`} type="date" value={value} max={today()} onChange={event => setValue(event.target.value)} />}
      </Field>
      {service === 'pharmacy' && <Field label="Reason for accepting" htmlFor={`${id}-reason`} error={fieldError.reason}
        hint="8 to 500 characters, kept with the record. For example: Patient at the counter with their Health ID card.">
        <Textarea id={`${id}-reason`} value={reason} maxLength={500} onChange={event => setReason(event.target.value)} />
      </Field>}
      <p className="staff-muted">Five details that don’t match lock this order here.</p>
      {error && <p className="staff-error" role="alert">{error}</p>}
      <div className="staff-row"><Button id={`${id}-accept`} type="submit" size="sm" aria-disabled={busy || undefined} className={BUSY}>
        {busy ? 'Accepting…' : 'Accept order'}</Button>
        <Button tone="quiet" size="sm" onClick={() => { setMode('none'); setError(''); setFieldError({}); setValue('') }}>Cancel</Button></div>
    </form>}
    {mode === 'decline' && <form className="staff-form" onSubmit={event => void decline(event)} aria-label={`Decline ${title}`}>
      <Field label="Why can’t you take it?" htmlFor={`${id}-decline-reason`}>
        <Select id={`${id}-decline-reason`} value={declineReason} onChange={event => setDeclineReason(event.target.value as OrderRouteDeclineReason | '')}>
          <option value="">Choose a reason</option>
          {DECLINE_REASONS.filter(item => item.kinds.includes(kindWord)).map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </Select>
      </Field>
      <p className="staff-muted">{ordering} is told, and can send it elsewhere.</p>
      {error && <p className="staff-error" role="alert">{error}</p>}
      <div className="staff-row"><Button id={`${id}-decline`} type="submit" tone="secondary" size="sm" aria-disabled={busy || undefined} className={UNAVAILABLE}>
        {busy ? 'Declining…' : 'Decline'}</Button>
        <Button tone="quiet" size="sm" onClick={() => { setMode('none'); setError('') }}>Cancel</Button></div>
    </form>}
    {mode === 'none' && error && <p className="staff-error" role="alert">{error}</p>}
  </div>
}
