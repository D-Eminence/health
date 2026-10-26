import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { adminApi, type AdminActor, type FacilityOrderRouteSummary, type FoundOrderRoute } from './api'
import { failure, isProblem } from './problems'
import { Page, ResourceView, Table, date, has, useGovernedSubmit, useResource } from './ui'
import { FacilityWrongPatientCount, LATE_CASE_NOTE } from './WrongPatientReports'
import { learnWrongPatientServed, useWrongPatientServed } from '../wrongPatientServed'

/**
 * Support's tools for orders between facilities (Novu, P4c, SPEC-FINAL §8.7 C20-C23, §13.6): a facility's summary and
 * whether it is listed for orders from other facilities, finding an order by its reference or the patient's Health ID,
 * and closing one. Identity audits every read and change; none shows a patient's name or what was ordered.
 */

/** What an order's effective state means, in support's words. */
const STATE_WORDS: Readonly<Record<string, string>> = {
  sent: 'Waiting to be accepted', accepted: 'Accepted', completed: 'Result or dispensing returned', declined: 'Declined',
  withdrawn: 'Withdrawn', expired: 'Expired', cancelled: 'Cancelled',
}

export function stateWord(state: string): string {
  return STATE_WORDS[state] ?? state.replaceAll('_', ' ')
}

/** How an order ended, in support's words (item 3, §9.5). */
const ENDED_WORDS: Readonly<Record<string, string>> = {
  wrong_patient: 'the receiving facility accepted it for the wrong person',
  support: 'closed by support',
  order_changed: 'the order changed',
  entered_in_error: 'the order was marked entered in error',
  receiving_released: 'the receiving facility was released',
  ordering_released: 'the ordering facility was released',
  orderer: 'withdrawn by the clinician',
  patient: 'stopped by the patient',
  order_in_work: 'already in work at the ordering facility',
  not_accepted: 'not accepted in time',
}

export function endedWord(kind: string): string {
  return ENDED_WORDS[kind] ?? kind.replaceAll('_', ' ')
}

/** The states with access in force: support can close only these (C22). */
const LIVE: ReadonlySet<string> = new Set(['sent', 'accepted', 'completed'])

/** A completed order's access ends at least(first return + 14 days, acceptance + 45 days): 45 days after acceptance at the latest. */
const ACCESS_CAP_MS = 45 * 24 * 60 * 60 * 1000

/**
 * Whether a completed order's access has certainly ended, so there is nothing to close (C22 refuses it with
 * ORDER_ROUTE_ALREADY_CLOSED, and C21 still answers `completed`): support or a release ended it (`endedAt`), or 45 days
 * have passed since it was accepted. C21 does not say when access ends, so between 14 and 45 days after acceptance the
 * console can't tell, and offers Close; a refusal then marks it ended (OrderRoutesPage).
 */
export function accessEnded(route: Pick<FoundOrderRoute, 'effectiveState' | 'endedAt' | 'acceptedAt'>, now = Date.now()): boolean {
  if (route.effectiveState !== 'completed') return false
  if (route.endedAt) return true
  const accepted = route.acceptedAt ? Date.parse(route.acceptedAt) : Number.NaN
  return Number.isFinite(accepted) && now >= accepted + ACCESS_CAP_MS
}

const LISTING_PROBLEMS: Readonly<Record<string, string>> = {
  ORDER_ROUTE_DESTINATION_UNCHANGED: 'It is already listed that way. The summary has been refreshed.',
  ADMIN_FACILITY_NOT_FOUND: 'Only a facility that signed up, or was approved, as a laboratory or pharmacy can be listed for '
    + 'orders from other facilities.',
  PERMISSION_DENIED: 'Listing a facility for orders needs the platform.facility.manage and platform.facility.unlock '
    + 'permissions. Ask a Super Admin.',
  VALIDATION_FAILED: 'Enter a reason of 8 to 500 characters.',
  ORDER_ROUTE_DESTINATION_INVALID: 'Enter a reason of 8 to 500 characters.',
}

/** "2 waiting to be accepted, 1 accepted": a counterpart's last 30 days. */
function stateCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts ?? {}).filter(([, count]) => typeof count === 'number' && count > 0)
  return entries.length ? entries.map(([state, count]) => `${count} ${stateWord(state).toLowerCase()}`).join(', ') : 'None'
}

/**
 * What the console knows of a facility that signed itself up, from the list support opened it from ("New facility
 * sign-ups" passes it in the link's state). C20 says only whether the facility is listed (H3), which is true by default
 * for any governed facility and any checked sign-up, whatever its type, and false for a sign-up not checked yet as for
 * one checked as "Other". Without this the panel says only what the summary proves.
 */
export interface KnownSignUp {
  facilityId: string
  organizationType: string | null
  reviewedAt: string | null
  verificationMethod: string | null
  releasedAt: string | null
}

/** Reads the sign-up a link from "New facility sign-ups" carried, for this facility only. */
export function knownSignUp(state: unknown, facilityId: string): KnownSignUp | null {
  const value = state && typeof state === 'object' ? (state as { selfServiceFacility?: unknown }).selfServiceFacility : null
  if (!value || typeof value !== 'object') return null
  const known = value as Partial<KnownSignUp>
  if (known.facilityId !== facilityId || typeof known.organizationType !== 'string') return null
  const text = (field: unknown) => typeof field === 'string' ? field : null
  return { facilityId, organizationType: known.organizationType, reviewedAt: text(known.reviewedAt),
    verificationMethod: text(known.verificationMethod), releasedAt: text(known.releasedAt) }
}

const RECEIVING_TYPES: ReadonlySet<string> = new Set(['laboratory', 'pharmacy'])
const TYPE_WORDS: Readonly<Record<string, string>> = { hospital: 'a hospital', clinic: 'a clinic', other: 'another kind of facility' }

/**
 * The listing in words, and whether listing can change anything: only a facility whose organization signed up, or was
 * approved, as a laboratory or pharmacy is ever found (H4), and C23 refuses any other.
 */
function listingText(summary: FacilityOrderRouteSummary, facilityName: string, known: KnownSignUp | null):
  { line: string; listable: boolean } {
  const { value, byDefault, reason, setAt } = summary.listed
  if (known && !RECEIVING_TYPES.has(known.organizationType ?? '')) return { listable: false,
    line: `Only laboratories and pharmacies receive orders from other facilities. ${facilityName} signed up as `
      + `${TYPE_WORDS[known.organizationType ?? ''] ?? 'another kind of facility'}, so clinicians at other facilities never find it.` }
  if (known?.releasedAt) return { listable: false,
    line: `${facilityName}’s sign-up was released, so clinicians at other facilities no longer find it.` }
  if (!byDefault) return { listable: true, line: value
    ? `Listed for orders from other facilities by Health ID support on ${date(setAt)}${reason ? `: ${reason}` : '.'}`
    : `Not listed: Health ID support stopped listing it on ${date(setAt)}${reason ? `: ${reason}` : '.'}` }
  if (known) {
    if (value) return { listable: true, line: 'Listed for orders from other facilities, by default.' }
    return { listable: true, line: !known.reviewedAt
      ? 'Not listed until Health ID support has checked it: marking it reviewed lists it, unless the check is recorded as “Other”.'
      : known.verificationMethod === 'other'
        ? 'Not listed for orders from other facilities, by default: Health ID support recorded its check as “Other”.'
        : 'Not listed for orders from other facilities, by default.' }
  }
  // Opened from anywhere else: the summary does not say the facility's type, or whether a sign-up was checked.
  return { listable: true, line: value
    ? 'Listed by default: clinicians at other facilities find it if it is a laboratory or pharmacy. A hospital or clinic is '
      + 'never found, listed or not.'
    : 'Not listed for orders from other facilities, by default: Health ID support has not checked this sign-up yet, or recorded '
      + 'its check as “Other”.' }
}

/**
 * A facility's orders with other facilities (C20), read only when asked: Identity audits each read. With
 * platform.facility.manage and platform.facility.unlock support lists it for orders, or stops listing it (C23);
 * accepted work is unaffected.
 */
export function FacilityOrderRoutesPanel({ facilityId, facilityName, actor, known = null }: { facilityId: string; facilityName: string
  actor: AdminActor; known?: KnownSignUp | null }) {
  const [shown, setShown] = useState(false)
  return <section className="admin-panel" aria-labelledby={`facility-order-routes-${facilityId}`}>
    <div className="admin-panel-head"><div><h2 id={`facility-order-routes-${facilityId}`}>Orders with other facilities</h2>
      <p>Lab requests and prescriptions this facility sent to, or received from, other facilities, and whether clinicians at
        other facilities can find it to send orders to. No patient or order details are shown. Each time you open it, Health ID
        records it in the audit log.</p></div></div>
    {shown ? <FacilityOrderRoutesSummary facilityId={facilityId} facilityName={facilityName} actor={actor} known={known} />
      : <button type="button" className="admin-secondary" onClick={() => setShown(true)}>Show orders with other facilities</button>}
  </section>
}

function FacilityOrderRoutesSummary({ facilityId, facilityName, actor, known }: { facilityId: string; facilityName: string
  actor: AdminActor; known: KnownSignUp | null }) {
  const load = useCallback((signal?: AbortSignal) => adminApi.facilityOrderRouteSummary(facilityId, signal), [facilityId])
  const resource = useResource(load, 'This facility’s orders with other facilities could not be loaded.')
  const canList = has(actor, 'platform.facility.manage') && has(actor, 'platform.facility.unlock')
  return <ResourceView resource={resource}>{summary => {
    const listing = listingText(summary, facilityName, known)
    return <div className="admin-stack">
    <p>{listing.line}</p>
    <p className="admin-note">A facility can receive orders only while it is an active, reviewed (or support-approved)
      laboratory or pharmacy that is listed and has a laboratory scientist or pharmacist on Health ID.</p>
    <p>{facilityName} accepted {summary.receivedAcceptedLifetime} {summary.receivedAcceptedLifetime === 1 ? 'order' : 'orders'} from
      other facilities, for {summary.receivedPatientsLifetime} {summary.receivedPatientsLifetime === 1 ? 'patient' : 'patients'}.</p>
    {/* Item 3: the reports it made that it accepted an order for the wrong person (none shown where the backend has no list). */}
    <FacilityWrongPatientCount facilityId={facilityId} />
    <h3>Last 30 days, by facility</h3>
    {summary.counterparts.length === 0 ? <p className="admin-state">No orders with other facilities in the last 30 days.</p>
      : <Table headings={['Direction', 'Facility', 'Orders']}>
        {summary.counterparts.map(counterpart => <tr key={`${counterpart.direction}-${counterpart.facilityId}`}>
          <td>{counterpart.direction === 'sent' ? 'Sent to' : 'Received from'}</td>
          <td><Link to={`/admin/facilities/${encodeURIComponent(counterpart.facilityId)}`}>{counterpart.facilityName ?? 'Facility'}</Link></td>
          <td>{stateCounts(counterpart.last30Days)}</td>
        </tr>)}
      </Table>}
    {/* Listing changes nothing for a facility that can never receive, and C23 refuses it. */}
    {!listing.listable ? null : canList ? <ListingForm facilityId={facilityId} facilityName={facilityName} listed={summary.listed.value} onDone={resource.reload} />
      : <p className="admin-note">Listing it for orders needs the platform.facility.manage and platform.facility.unlock permissions.</p>}
    </div>
  }}</ResourceView>
}

function ListingForm({ facilityId, facilityName, listed, onDone }: { facilityId: string; facilityName: string; listed: boolean; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const governed = useGovernedSubmit()
  const length = reason.trim().length
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (governed.busy || length < 8 || length > 500) return
    setNotice(null)
    let refused: unknown = null
    const saved = await governed.submit(async () => {
      try { return await adminApi.setOrderDestination(facilityId, !listed, reason.trim()) }
      catch (caught) { refused = caught; throw caught }
    }, 'The listing could not be changed. Try again.', LISTING_PROBLEMS)
    if (saved) {
      setReason('')
      setNotice(saved.listed ? `${facilityName} is listed for orders from other facilities.`
        : `${facilityName} is no longer listed. Orders it has already accepted are not affected.`)
      onDone()
    } else if (isProblem(refused, 'ORDER_ROUTE_DESTINATION_UNCHANGED')) onDone()
  }
  const id = `order-destination-${facilityId}`
  return <details className="admin-action">
    <summary>{listed ? 'Stop listing it for orders' : 'List it for orders'}</summary>
    <form className="admin-action-form" onSubmit={event => void submit(event)}>
      <p className="admin-note">{listed
        ? `Clinicians at other facilities will no longer find ${facilityName} to send orders to. Orders it has already accepted continue.`
        : `Clinicians at other facilities will find ${facilityName} and can send it lab requests or prescriptions, with each patient’s name, sex and date of birth once it accepts them. List it only once you are satisfied it is a real laboratory or pharmacy.`}</p>
      <label htmlFor={id}>Reason</label>
      <textarea id={id} required minLength={8} maxLength={500} rows={3} value={reason} aria-describedby={`${id}-hint`}
        onChange={event => setReason(event.target.value)} />
      <small id={`${id}-hint`} className="admin-note">8 to 500 characters, kept in the audit log.</small>
      <button type="submit" className="admin-primary" disabled={governed.busy || length < 8 || length > 500}>
        {governed.busy ? 'Saving…' : listed ? 'Stop listing' : 'List for orders'}</button>
      {governed.error && <p role="alert" className="admin-error">{governed.error}</p>}
      <div role="status">{notice && <p className="admin-success">{notice}</p>}</div>
    </form>
  </details>
}

/**
 * The release card's line about a sign-up's orders with other facilities (P4c SPEC 13.6): the lifetime counts when the
 * summary can be read, and what releasing does to its open orders either way. Identity audits each summary read, so it
 * is read only once the release form around it is opened, never while the list is shown.
 */
export function ReleaseOrderRoutesNote({ facilityId, facilityName, canRead }: { facilityId: string; facilityName: string; canRead: boolean }) {
  const note = useRef<HTMLParagraphElement>(null)
  const [opened, setOpened] = useState(false)
  useEffect(() => {
    const around = note.current?.closest('details')
    if (!around) { setOpened(true); return }
    const sync = () => { if (around.open) setOpened(true) }
    sync()
    around.addEventListener('toggle', sync)
    return () => around.removeEventListener('toggle', sync)
  }, [])
  const load = useCallback(async (signal?: AbortSignal) => canRead && opened ? adminApi.facilityOrderRouteSummary(facilityId, signal) : null,
    [facilityId, canRead, opened])
  const resource = useResource(load, '')
  const summary = resource.data
  return <p ref={note} className="admin-note">{summary
    ? `${facilityName} accepted ${summary.receivedAcceptedLifetime} ${summary.receivedAcceptedLifetime === 1 ? 'order' : 'orders'} from other facilities for ${summary.receivedPatientsLifetime} ${summary.receivedPatientsLifetime === 1 ? 'patient' : 'patients'}. `
    : ''}Releasing it withdraws or cancels its open orders with other facilities, both ways, and tells those patients.</p>
}

const REFERENCE = /^[0-9A-F]{8}$/
const HEALTH_ID = /^HID-[A-HJ-NP-Z2-9]{6,32}$/
const LOOKUP_INVALID = 'Enter the 8-character order reference, for example 3F2A9C1B, or the patient’s Health ID, for example HID-7KQ2M9.'

const CLOSE_PROBLEMS: Readonly<Record<string, string>> = {
  VERSION_CONFLICT: 'This order changed after it was found. It has been found again: check it before closing it.',
  ORDER_ROUTE_ALREADY_CLOSED: 'This order’s access has already ended, so there is nothing to close.',
  ORDER_ROUTE_NOT_FOUND: 'This order was not found. Find it again.',
  PERMISSION_DENIED: 'Closing an order needs the platform.facility.manage permission. Ask a Super Admin.',
  VALIDATION_FAILED: 'Enter a reason of 8 to 500 characters.',
  ORDER_ROUTE_CLOSE_INVALID: 'Enter a reason of 8 to 500 characters.',
}
const CLOSE_REFRESHING = ['VERSION_CONFLICT', 'ORDER_ROUTE_NOT_FOUND'] as const

/** What became of a close: done, refused because access had already ended, or refused because the order changed or went. */
type CloseOutcome = 'closed' | 'ended' | 'stale'

/**
 * Orders between facilities: support finds an order by the reference shown on it, or every order of a patient by their
 * Health ID, and closes one that should not stand (C21, C22). Closing ends access at both facilities at once and tells
 * both, and the patient.
 *
 * A Health ID goes in the body of the lookup's POST, never in an address, once per Find (each lookup is audited).
 * After a close, or a close refused because the order changed, the page finds that one order again by its reference,
 * never by the Health ID again.
 */
export function OrderRoutesPage({ actor }: { actor: AdminActor }) {
  const [input, setInput] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [lookup, setLookup] = useState<{ reference: string } | { healthId: string } | null>(null)
  const [found, setFound] = useState<FoundOrderRoute[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  // Orders (route and version) whose close Identity refused because their access had already ended.
  const [ended, setEnded] = useState<ReadonlySet<string>>(() => new Set())

  async function find(next: { reference: string } | { healthId: string }) {
    setBusy(true); setError('')
    try {
      const answer = await adminApi.findOrderRoutes(next)
      // Item 3: an Identity that lets a laboratory or pharmacy end an order accepted for the wrong person says so (D15).
      learnWrongPatientServed(answer.wrongPatientReports === true)
      setFound(answer.items); setLookup(next)
    }
    catch (caught) {
      setFound(null)
      setError(isProblem(caught, 'ORDER_ROUTE_LOOKUP_INVALID') ? LOOKUP_INVALID : failure(caught, 'Orders could not be found. Try again.'))
    } finally { setBusy(false) }
  }

  /** Reads one order again by its reference and puts it back in its row; an order no longer found leaves the table. */
  async function findAgain(route: FoundOrderRoute) {
    try {
      const fresh = (await adminApi.findOrderRoutes({ reference: route.reference })).items.filter(item => item.routeId === route.routeId)
      setFound(current => current && current.flatMap(item => item.routeId === route.routeId ? fresh : [item]))
    } catch (caught) { setError(failure(caught, `Order ${route.reference} could not be found again. Find it again.`)) }
  }

  function closeDone(route: FoundOrderRoute, outcome: CloseOutcome) {
    if (outcome === 'closed') setNotice(`Closed order ${route.reference}. Access has ended at both facilities, and both, and the patient, are told.`)
    if (outcome === 'ended') {
      setEnded(current => new Set(current).add(`${route.routeId}-${route.version}`))
      setNotice(`Order ${route.reference}: its access has already ended, so there is nothing to close.`)
    }
    if (outcome === 'stale') setNotice(null)
    void findAgain(route)
  }

  function action(route: FoundOrderRoute) {
    if (!LIVE.has(route.effectiveState)) return 'Closed'
    if (accessEnded(route) || ended.has(`${route.routeId}-${route.version}`)) {
      return route.endedAt ? `Access ended ${date(route.endedAt)}` : 'Access ended'
    }
    return has(actor, 'platform.facility.manage') ? <CloseForm route={route} onDone={outcome => closeDone(route, outcome)} />
      : 'Closing needs platform.facility.manage'
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = input.trim().toUpperCase()
    const next = REFERENCE.test(value) ? { reference: value } : HEALTH_ID.test(value) ? { healthId: value } : null
    if (!next) { setInvalid(true); return }
    setInvalid(false); setNotice(null)
    void find(next)
  }

  const what = lookup && 'reference' in lookup ? `the reference ${lookup.reference}` : lookup ? `the Health ID ${lookup.healthId}` : ''
  return <Page eyebrow="Organizations" title="Orders between facilities"
    description="Lab requests and prescriptions clinicians sent to a laboratory or pharmacy at another facility.">
    <section className="admin-panel" aria-labelledby="order-routes-find-title">
      <div className="admin-panel-head"><div><h2 id="order-routes-find-title">Find an order</h2>
        <p>Each order shows an 8-character reference to the clinician, the laboratory or pharmacy, and the patient. Someone who
          reports an order they didn’t expect can give it to you, or the patient’s Health ID finds all of theirs. Health ID
          records every lookup in the audit log. Use the reference when you have it: it finds just that order, where a
          Health ID finds all of the patient’s.</p></div></div>
      <form className="admin-search" onSubmit={submit} role="search" aria-label="Orders by reference or Health ID">
        <label htmlFor="order-routes-lookup">Order reference (8 characters) or patient Health ID</label>
        <div><input id="order-routes-lookup" value={input} autoComplete="off" spellCheck={false} maxLength={40}
          aria-invalid={invalid} aria-describedby={invalid ? 'order-routes-lookup-error' : undefined}
          onChange={event => { setInput(event.target.value); setInvalid(false) }} placeholder="For example 3F2A9C1B" />
          <button className="admin-primary" type="submit" disabled={busy || !input.trim()}>{busy ? 'Finding…' : 'Find'}</button></div>
        {invalid && <p id="order-routes-lookup-error" role="alert" className="admin-error">{LOOKUP_INVALID}</p>}
      </form>
      {error && <p role="alert" className="admin-error">{error}</p>}
      <div role="status">{notice && <p className="admin-success">{notice}</p>}
        {found && found.length === 0 && <p className="admin-state">No order has {what}.</p>}</div>
      {found && found.length > 0 && <Table headings={['Order', 'From', 'To', 'State', 'Sent', 'Action']}>
        {found.map(route => <tr key={`${route.routeId}-${route.version}`}>
          <td><strong>{route.reference}</strong><small>{route.kind === 'lab_request' ? 'Lab request' : route.kind === 'prescription' ? 'Prescription' : route.kind}</small></td>
          <td><Link to={`/admin/facilities/${encodeURIComponent(route.orderingFacilityId)}`}>{route.orderingFacilityName}</Link></td>
          <td><Link to={`/admin/facilities/${encodeURIComponent(route.receivingFacilityId)}`}>{route.receivingFacilityName}</Link></td>
          <td><span className="admin-status" data-state={route.effectiveState}>{stateWord(route.effectiveState)}</span>{route.acceptedAt ? <small>Accepted {date(route.acceptedAt)}</small> : null}
            {route.endedAt ? <small>Ended {date(route.endedAt)}{route.endedKind ? ` (${endedWord(route.endedKind)})` : ''}</small> : null}</td>
          <td>{date(route.createdAt)}</td>
          <td>{action(route)}</td>
        </tr>)}
      </Table>}
    </section>
  </Page>
}

function CloseForm({ route, onDone }: { route: FoundOrderRoute; onDone: (outcome: CloseOutcome) => void }) {
  // Support is sent to the laboratory or pharmacy first only where it can end the order (item 3, hid-system 0088): until
  // then Close is the remedy, and the form must not discourage it (D15).
  const wrongPatientServed = useWrongPatientServed() === true
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const governed = useGovernedSubmit()
  const length = reason.trim().length
  const ready = length >= 8 && length <= 500 && confirmed
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (governed.busy || !ready) return
    let refused: unknown = null
    const closed = await governed.submit(async () => {
      try { return await adminApi.closeOrderRoute(route, reason.trim()) }
      catch (caught) { refused = caught; throw caught }
    }, 'The order could not be closed. Try again.', CLOSE_PROBLEMS)
    if (closed) onDone('closed')
    else if (isProblem(refused, 'ORDER_ROUTE_ALREADY_CLOSED')) onDone('ended')
    else if (CLOSE_REFRESHING.some(code => isProblem(refused, code))) onDone('stale')
  }
  const id = `order-route-close-${route.routeId}`
  return <details className="admin-action">
    <summary>Close</summary>
    <form className="admin-action-form" onSubmit={event => void submit(event)}>
      <p className="admin-note">Closing ends {route.receivingFacilityName}’s access to this order at once, and
        {' '}{route.orderingFacilityName}’s view of it from there. Both facilities and the patient are told. It can’t be undone.
        {route.effectiveState === 'completed' && ' A completed order’s access ends 14 days after its first result or dispensing, '
          + 'and at the latest 45 days after it was accepted: if it has already ended, Health ID says so and nothing changes.'}</p>
      <label htmlFor={id}>Reason for closing</label>
      <textarea id={id} required minLength={8} maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)}
        aria-describedby={`${id}-hint`} />
      <small id={`${id}-hint`} className="admin-note">8 to 500 characters, kept in the audit log. For example: “The patient says they
        never agreed to send it there.”</small>
      {wrongPatientServed && <p className="admin-note">If a laboratory or pharmacy accepted it for the wrong person, ask them to end it
        from their work list instead: only they can withdraw a result or dispensing they sent back. If you close it first, they
        can’t.</p>}
      <p className="admin-note">{LATE_CASE_NOTE}</p>
      <label className="admin-checkbox"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I
        understand that closing can’t be undone.</label>
      <button type="submit" className="admin-primary" disabled={governed.busy || !ready}>{governed.busy ? 'Closing…' : 'Close order'}</button>
      {governed.error && <p role="alert" className="admin-error">{governed.error}</p>}
    </form>
  </details>
}
