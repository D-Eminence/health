import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  HEALTH_ID_PREFIX, healthIdOrOtherInput, isBlankHealthIdInput, isCompleteHealthId, normalizeHealthIdInput,
} from '@hid/contracts'
import {
  adminApi, type AdminActor, type DestinationReview, type FacilityNotCompletedCounts, type FacilityOrderRouteSummary,
  type FoundOrderRoute,
} from './api'
import { failure, isProblem } from './problems'
import { Page, ResourceView, Table, date, has, useGovernedSubmit, useResource } from './ui'
import { FacilityWrongPatientCount, lateCaseNote } from './WrongPatientReports'
import { learnWrongPatientServed, useWrongPatientServed } from '../wrongPatientServed'
import { correctableUntilOf, learnLateCorrectionFrom, useLateCorrectionServed, wrongPatientReportOf } from '../lateCorrectionServed'
import { learnCannotCompleteFrom, useCannotCompleteServed } from '../cannotCompleteServed'

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
  // D18 (hid-system 0091): the receiving facility accepted it and couldn't complete it.
  receiving_unable: 'the receiving facility couldn’t complete it',
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

/**
 * Why a laboratory or pharmacy couldn't complete an order, in support's own neutral words (D18-5, SPEC-FINAL §4.3; WB9):
 * one per code whatever the kind (the summary's counts carry no kind). An unknown code is said with spaces.
 */
const NOT_COMPLETED_WORDS: Readonly<Record<string, string>> = {
  test_not_offered: 'test not offered', supplies_unavailable: 'supplies ran out', equipment_unavailable: 'equipment out of service',
  sample_unusable: 'sample unusable', sample_not_obtained: 'sample not obtained', cannot_meet_priority: 'couldn’t meet the priority',
  patient_declined: 'patient chose not to go ahead', patient_did_not_return: 'patient left or didn’t come back',
  other: 'another reason', out_of_stock: 'out of stock', medicine_unavailable: 'medicine unavailable',
  needs_prescriber_review: 'needs the prescriber’s review', controlled_requirements: 'controlled-medicine paperwork',
}

export function notCompletedWord(reason: string): string {
  return NOT_COMPLETED_WORDS[reason] ?? reason.replaceAll('_', ' ')
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

/**
 * The facility summary's `notCompleted` (D18, C32), only when every count is a whole number of at least 0 and `byReason`
 * an object of such counts; null otherwise (an earlier Identity sends none).
 */
export function notCompletedCounts(summary: Pick<FacilityOrderRouteSummary, 'notCompleted'>): FacilityNotCompletedCounts | null {
  const value: unknown = summary.notCompleted
  if (!value || typeof value !== 'object') return null
  const fields = value as Record<string, unknown>
  const last30Days = count(fields.last30Days)
  const soonAfterAcceptance = count(fields.soonAfterAcceptance)
  const afterSevenDays = count(fields.afterSevenDays)
  const laterReportedWrongPatient = count(fields.laterReportedWrongPatient)
  const reasons = fields.byReason
  if (last30Days === null || soonAfterAcceptance === null || afterSevenDays === null || laterReportedWrongPatient === null
    || !reasons || typeof reasons !== 'object' || Array.isArray(reasons)) return null
  const byReason: Record<string, number> = {}
  for (const [reason, value] of Object.entries(reasons as Record<string, unknown>)) {
    const n = count(value)
    if (n === null) return null
    byReason[reason] = n
  }
  return { last30Days, soonAfterAcceptance, afterSevenDays, laterReportedWrongPatient, byReason }
}

/**
 * The orders this facility accepted and ended because it couldn't complete them, last 30 days (D18-11): counts only, no
 * order and no patient, on its own facility page; lines with 0 left out but the first. What support looks for: endings
 * soon after accepting with nothing recorded (accepting just to see who the patient is), late ones (sitting on orders),
 * and ones later reported as the wrong person (D18-12).
 */
function FacilityNotCompleted({ counts }: { counts: FacilityNotCompletedCounts }) {
  const reasons = Object.entries(counts.byReason).filter(([, n]) => n > 0).sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
  return <div className="admin-stack">
    <p className="admin-note">A laboratory or pharmacy ends an order it accepted with “We can’t complete this order” when it can’t
      finish it; the ordering facility sees why. Health ID shows these counts per facility only.</p>
    <ul className="admin-notes">
      <li>Orders it accepted but couldn’t complete, last 30 days: <strong>{counts.last30Days}</strong>.</li>
      {counts.soonAfterAcceptance > 0 && <li>Within an hour of accepting, with nothing recorded: <strong>{counts.soonAfterAcceptance}</strong>.
        <small className="admin-note">Common when a patient changes their mind at the counter; a concern when it happens across
          many patients.</small></li>}
      {counts.afterSevenDays > 0 && <li>More than 7 days after accepting: <strong>{counts.afterSevenDays}</strong>.</li>}
      {counts.laterReportedWrongPatient > 0 && <li>Later reported as accepted for the wrong person:
        {' '}<strong>{counts.laterReportedWrongPatient}</strong>.</li>}
      {reasons.length > 0 && <li>By reason:<ul>{reasons.map(([reason, n]) => <li key={reason}>{notCompletedWord(reason)}: {n}</li>)}</ul></li>}
    </ul>
  </div>
}

/** The states with access in force: support can close only these (C22). */
const LIVE: ReadonlySet<string> = new Set(['sent', 'accepted', 'completed'])

/** A completed order's access ends at least(first return + 14 days, acceptance + 45 days): 45 days after acceptance at the latest. */
const ACCESS_CAP_MS = 45 * 24 * 60 * 60 * 1000

/**
 * Whether an order's access has ended, so there is nothing to close (C22 refuses it with ORDER_ROUTE_ALREADY_CLOSED, and
 * C21 may still answer `completed`).
 * - Since item 4 (hid-system 0089) C21 says whether Close would act (`closable`), exactly, at the database's clock, when
 *   the order was found: a live order that is not closable has ended. No browser clock is used then (CC3); an order found
 *   closable whose access ends before Close is pressed is refused, and marked ended (OrderRoutesPage).
 * - From an earlier Identity, a completed order has certainly ended when support or a release ended it (`endedAt`), or
 *   45 days have passed since it was accepted. Between 14 and 45 days after acceptance the console can't tell, and offers
 *   Close; a refusal then marks it ended.
 */
export function accessEnded(route: Pick<FoundOrderRoute, 'effectiveState' | 'endedAt' | 'acceptedAt' | 'closable'>,
  now = Date.now()): boolean {
  if (typeof route.closable === 'boolean') return !route.closable && LIVE.has(route.effectiveState)
  if (route.effectiveState !== 'completed') return false
  if (route.endedAt) return true
  const accepted = route.acceptedAt ? Date.parse(route.acceptedAt) : Number.NaN
  return Number.isFinite(accepted) && now >= accepted + ACCESS_CAP_MS
}

/**
 * What support may tell the receiving facility of an order whose access has ended (D17, CT10; SPEC-FINAL §9.4): that it
 * can still withdraw what it recorded until the date Find carries, with the reference, if it accepted the order for the
 * wrong person; or, past it, D17-3's stop-gap, again only if someone says so, and only where something came back
 * (completed): on an order nothing came back on there is no value for the clinician to note, and nothing to refer. Once
 * the receiving facility was released from Health ID it can no longer act: the stop-gap, on the same conditions. Null
 * from an earlier Identity, and for any other state.
 */
function correctionAdvice(route: FoundOrderRoute): string | null {
  const receiving = route.receivingFacilityName?.trim() || 'The receiving facility'
  // Released from Health ID (D17-3): its memberships ended, so it can no longer withdraw anything, whatever date an
  // answer carries. Identity says receiver_released; an order the release ended is so whatever else it says.
  if (route.correction === 'receiver_released' || (route.endedKind === 'receiving_released'
    && (route.correction === 'correctable' || route.correction === 'too_late'))) {
    return route.effectiveState === 'completed' ? `${receiving} is no longer on Health ID, so it can no longer withdraw it. If `
      + `a patient or clinician says it accepted this for the wrong person, ${STOP_GAP}` : null
  }
  const until = correctableUntilOf(route)
  if (typeof until !== 'string') return null
  if (route.correction === 'correctable') return `${receiving} can still withdraw what it recorded on it, until ${date(until)}: `
    + `if it accepted this for the wrong person, give it reference ${route.reference}.`
  if (route.correction === 'too_late' && route.effectiveState === 'completed') return 'If a patient or clinician says '
    + `${route.receivingFacilityName?.trim() || 'the receiving facility'} accepted this for the wrong person, it can no longer `
    + `withdraw it (past ${date(until)}): ${STOP_GAP}`
  return null
}

/** D17-3's stop-gap, in support's words. */
const STOP_GAP = 'ask the ordering clinician to record in the patient’s notes that it was not theirs, without repeating its '
  + 'value, and refer it to the data protection officer the same day.'

/** When the order's access ended or ends, as C21 says (item 4), or null when it said nothing that reads as a time. */
function accessEndsAt(route: Pick<FoundOrderRoute, 'accessEndsAt'>): string | null {
  return typeof route.accessEndsAt === 'string' && Number.isFinite(Date.parse(route.accessEndsAt)) ? route.accessEndsAt : null
}

const LISTING_PROBLEMS: Readonly<Record<string, string>> = {
  ORDER_ROUTE_DESTINATION_UNCHANGED: 'It is already listed that way. The summary has been refreshed.',
  ADMIN_FACILITY_NOT_FOUND: 'Only a facility that signed up, or was approved, as a laboratory or pharmacy can be listed for '
    + 'orders from other facilities.',
  PERMISSION_DENIED: 'Your roles don’t allow this. Ask a Super Admin.',
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
const REVIEWS: ReadonlySet<string> = new Set<DestinationReview>(['pending', 'reviewed', 'released', 'governed', 'legacy'])
/** The reviews under which listing can change whether the facility is found (H4 step 2); C23 accepts each. */
const LISTABLE_REVIEWS: ReadonlySet<string> = new Set<DestinationReview>(['pending', 'reviewed', 'governed'])

/**
 * What the summary says the facility is as a destination (Novu since item 4, hid-system 0089: C20's `destination`), when
 * it says it in the right shape: `receivingTypes` an array of strings and `review` one of the five words. Null before
 * 0089 (Identity passes the summary through, so an earlier Identity on 0089 sends it too), or for any other shape: the
 * panel then goes by the link's sign-up and the hedge.
 */
export function summaryDestination(summary: Pick<FacilityOrderRouteSummary, 'destination'>):
  { receivingTypes: string[]; review: DestinationReview } | null {
  const destination: unknown = summary.destination
  if (!destination || typeof destination !== 'object') return null
  const { receivingTypes, review } = destination as { receivingTypes?: unknown; review?: unknown }
  if (!Array.isArray(receivingTypes) || !receivingTypes.every(type => typeof type === 'string')) return null
  if (typeof review !== 'string' || !REVIEWS.has(review)) return null
  return { receivingTypes: receivingTypes as string[], review: review as DestinationReview }
}

/** "Health ID support listed it on 3 Oct 2026, 10:00: reason." for a listing support set itself. */
function supportSetText(listed: FacilityOrderRouteSummary['listed']): string {
  return `Health ID support ${listed.value ? 'listed it' : 'stopped listing it'} on ${date(listed.setAt)}${listed.reason ? `: ${listed.reason}` : '.'}`
}

/** The line for a listing support set itself, where listing can change whether the facility is found. */
function supportListedLine({ value, reason, setAt }: FacilityOrderRouteSummary['listed']): string {
  return value ? `Listed for orders from other facilities by Health ID support on ${date(setAt)}${reason ? `: ${reason}` : '.'}`
    : `Not listed: Health ID support stopped listing it on ${date(setAt)}${reason ? `: ${reason}` : '.'}`
}

/**
 * The listing in words, and whether listing can change anything: only a facility whose organization signed up, or was
 * approved, as a laboratory or pharmacy is ever found (H4), and C23 refuses any other. With the summary's `destination`
 * (item 4) the words are exact however the page was opened, and the form is offered only where listing can change
 * whether the facility is found (CC7: a laboratory or pharmacy product, and a pending, reviewed or support-approved
 * sign-up), which C23 always accepts. Without it, what the link from "New facility sign-ups" carried, else a hedge.
 */
function listingText(summary: FacilityOrderRouteSummary, facilityName: string, known: KnownSignUp | null):
  { line: string; listable: boolean } {
  const { value, byDefault } = summary.listed
  const destination = summaryDestination(summary)
  if (destination) {
    const { receivingTypes, review } = destination
    // Support's own setting, said beside a line that says listing changes nothing here (CC7b).
    const own = byDefault ? '' : ` ${supportSetText(summary.listed)}`
    if (review === 'released') return { listable: false,
      line: `${facilityName}’s sign-up was released, so clinicians at other facilities no longer find it.${own}` }
    if (receivingTypes.length === 0) {
      const signedUpAs = known && !RECEIVING_TYPES.has(known.organizationType ?? '') && TYPE_WORDS[known.organizationType ?? '']
      return { listable: false, line: 'Only laboratories and pharmacies receive orders from other facilities. '
        + (signedUpAs ? `${facilityName} signed up as ${signedUpAs} and has` : `${facilityName} has`)
        + ` no laboratory or pharmacy service on Health ID, so clinicians at other facilities don’t find it.${own}` }
    }
    if (review === 'legacy') return { listable: false, line: `${facilityName} has no reviewed or support-approved sign-up on Health ID, `
      + `so clinicians at other facilities don’t find it, listed or not.${own}` }
    const listable = LISTABLE_REVIEWS.has(review)
    if (!byDefault) return { listable, line: supportListedLine(summary.listed) }
    if (review === 'pending') return { listable, line: 'Not listed until Health ID support has checked it: marking it reviewed '
      + 'lists it, unless the check is recorded as “Other”.' }
    if (review === 'reviewed') return { listable, line: value ? 'Listed for orders from other facilities, by default.'
      : 'Not listed for orders from other facilities, by default: Health ID support recorded its check as “Other”.' }
    return { listable, line: value ? 'Listed for orders from other facilities, by default (approved by Health ID support).'
      : 'Not listed for orders from other facilities, by default.' }
  }
  if (known && !RECEIVING_TYPES.has(known.organizationType ?? '')) return { listable: false,
    line: `Only laboratories and pharmacies receive orders from other facilities. ${facilityName} signed up as `
      + `${TYPE_WORDS[known.organizationType ?? ''] ?? 'another kind of facility'}, so clinicians at other facilities never find it.` }
  if (known?.releasedAt) return { listable: false,
    line: `${facilityName}’s sign-up was released, so clinicians at other facilities no longer find it.` }
  if (!byDefault) return { listable: true, line: supportListedLine(summary.listed) }
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
  // An Identity that serves "We can't complete this order" (D18) says so in the summary.
  const load = useCallback((signal?: AbortSignal) => adminApi.facilityOrderRouteSummary(facilityId, signal).then(summary => {
    learnCannotCompleteFrom(summary)
    return summary
  }), [facilityId])
  const resource = useResource(load, 'This facility’s orders with other facilities could not be loaded.')
  const canList = has(actor, 'platform.facility.manage') && has(actor, 'platform.facility.unlock')
  return <ResourceView resource={resource}>{summary => {
    const listing = listingText(summary, facilityName, known)
    const notCompleted = notCompletedCounts(summary)
    return <div className="admin-stack">
    <p>{listing.line}</p>
    <p className="admin-note">A facility can receive orders only while it is an active, reviewed (or support-approved)
      laboratory or pharmacy that is listed and has a laboratory scientist or pharmacist on Health ID.</p>
    <p>{facilityName} accepted {summary.receivedAcceptedLifetime} {summary.receivedAcceptedLifetime === 1 ? 'order' : 'orders'} from
      other facilities, for {summary.receivedPatientsLifetime} {summary.receivedPatientsLifetime === 1 ? 'patient' : 'patients'}.</p>
    {/* Item 3: the reports it made that it accepted an order for the wrong person (none shown where the backend has no list). */}
    <FacilityWrongPatientCount facilityId={facilityId} />
    {notCompleted && <FacilityNotCompleted counts={notCompleted} />}
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
      : <p className="admin-note">Your roles don’t let you list it for orders.</p>}
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
const LOOKUP_INVALID = 'Enter the 8-character order reference, for example 3F2A9C1B, or the patient’s Health ID, for example HID-7KQ2M9.'

const CLOSE_PROBLEMS: Readonly<Record<string, string>> = {
  VERSION_CONFLICT: 'This order changed after it was found. It has been found again: check it before closing it.',
  ORDER_ROUTE_ALREADY_CLOSED: 'This order’s access has already ended, so there is nothing to close.',
  ORDER_ROUTE_NOT_FOUND: 'This order was not found. Find it again.',
  PERMISSION_DENIED: 'Your roles don’t allow this. Ask a Super Admin.',
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
  // Starts at HID- (owner decision, 2026-10-27), which is deleted to type a reference.
  const [input, setInput] = useState(HEALTH_ID_PREFIX)
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
      // Item 3: an Identity that lets a laboratory or pharmacy end an order accepted for the wrong person says so (D15);
      // and D17's, that it serves the late correction, or its rows carry their deadline.
      learnWrongPatientServed(answer.wrongPatientReports === true)
      learnLateCorrectionFrom(answer, answer.items)
      // D18: and one that serves "We can't complete this order" says that (only `true` is learned).
      learnCannotCompleteFrom(answer)
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
      const answer = await adminApi.findOrderRoutes({ reference: route.reference })
      learnCannotCompleteFrom(answer)
      const fresh = answer.items.filter(item => item.routeId === route.routeId)
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
    // D17: what the receiving facility can still do about an order whose access has ended.
    const advice = correctionAdvice(route)
    const withAdvice = (said: string) => advice ? <>{said}<small>{advice}</small></> : said
    if (!LIVE.has(route.effectiveState)) return withAdvice('Closed')
    if (accessEnded(route) || ended.has(`${route.routeId}-${route.version}`)) {
      // When access ended: a release may come after it had run out, so C21's time comes first (CC4).
      const when = accessEndsAt(route) ?? route.endedAt
      return withAdvice(when ? `Access ended ${date(when)}` : 'Access ended')
    }
    return has(actor, 'platform.facility.manage') ? <CloseForm route={route} onDone={outcome => closeDone(route, outcome)} />
      : 'Closing needs platform.facility.manage'
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = input.trim().toUpperCase()
    // 8 characters are a reference, typed after the prefilled HID- or with it deleted: Health IDs were issued with 16
    // characters, then 6, never 8. Anything else is a Health ID, with its prefix once.
    const bare = value.startsWith(HEALTH_ID_PREFIX) ? value.slice(HEALTH_ID_PREFIX.length) : value
    const healthId = normalizeHealthIdInput(value)
    const next = REFERENCE.test(bare) ? { reference: bare } : isCompleteHealthId(healthId) ? { healthId } : null
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
          aria-invalid={invalid} aria-describedby={invalid ? 'order-routes-lookup-hint order-routes-lookup-error' : 'order-routes-lookup-hint'}
          onChange={event => { setInput(healthIdOrOtherInput(event.target.value)); setInvalid(false) }} placeholder="For example 3F2A9C1B" />
          <button className="admin-primary" type="submit" disabled={busy || isBlankHealthIdInput(input)}>{busy ? 'Finding…' : 'Find'}</button></div>
        <p id="order-routes-lookup-hint" className="admin-note">HID- is filled in for a Health ID. An 8-character order reference works with it or without it.</p>
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
            {route.endedAt ? <small>Ended {date(route.endedAt)}{route.endedKind ? ` (${endedWord(route.endedKind)})` : ''}</small> : null}
            {route.endedKind !== 'wrong_patient' && wrongPatientReportOf(route) ? <small>Reported {date(wrongPatientReportOf(route)!.reportedAt)}:
              the receiving facility accepted it for the wrong person</small> : null}</td>
          <td>{date(route.createdAt)}</td>
          <td>{action(route)}</td>
        </tr>)}
      </Table>}
    </section>
  </Page>
}

function CloseForm({ route, onDone }: { route: FoundOrderRoute; onDone: (outcome: CloseOutcome) => void }) {
  // Support is sent to the laboratory or pharmacy first only where it can end the order (item 3, hid-system 0088): until
  // then Close is the remedy, and the form must not discourage it (D15). Since D17 (hid-system 0090) closing no longer
  // stops it withdrawing what it recorded, until the order's date.
  const wrongPatientServed = useWrongPatientServed() === true
  const lateServed = useLateCorrectionServed() === true
  // D18: an accepted order the facility can't complete, it ends itself; support closes one only past its daily limit.
  const cannotComplete = useCannotCompleteServed() === true && route.effectiveState === 'accepted'
  const until = correctableUntilOf(route)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const governed = useGovernedSubmit()
  const length = reason.trim().length
  const ready = length >= 8 && length <= 500 && confirmed
  const ends = accessEndsAt(route)
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
        {route.effectiveState === 'completed' && (route.closable === true && ends
          ? ` Its access ends on ${date(ends)}: closing ends it now.`
          : ' A completed order’s access ends 14 days after its first result or dispensing, and at the latest 45 days after it '
            + 'was accepted: if it has already ended, Health ID says so and nothing changes.')}</p>
      <label htmlFor={id}>Reason for closing</label>
      <textarea id={id} required minLength={8} maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)}
        aria-describedby={`${id}-hint`} />
      <small id={`${id}-hint`} className="admin-note">8 to 500 characters, kept in the audit log. For example: “The patient says they
        never agreed to send it there.”</small>
      {lateServed ? <p className="admin-note">If a laboratory or pharmacy accepted it for the wrong person, ask them to end it from
        their work list instead. Closing it does not stop them withdrawing it later{typeof until === 'string' ? `, until ${date(until)}` : ''}.</p>
        : wrongPatientServed && <p className="admin-note">If a laboratory or pharmacy accepted it for the wrong person, ask them to end it
        from their work list instead: only they can withdraw a result or dispensing they sent back. If you close it first, they
        can’t.</p>}
      {cannotComplete && <p className="admin-note">If the laboratory or pharmacy accepted it but can’t complete it, it can end it
        itself with “We can’t complete this order” on its work list; the ordering facility then sees why. Close it here only when
        it asks you to because it has reached its daily limit.{route.kind === 'lab_request'
          ? ` Before you close it, ask ${route.receivingFacilityName} whether a result was recorded on it: a checked result waiting `
            + `to be released, it should release instead; about any other result, it should phone ${route.orderingFacilityName} `
            + `first. Closing ends its access at once, and ${route.orderingFacilityName} is not told that a result was recorded.`
          : ''}</p>}
      <p className="admin-note">{lateCaseNote(lateServed)}</p>
      <label className="admin-checkbox"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I
        understand that closing can’t be undone.</label>
      <button type="submit" className="admin-primary" disabled={governed.busy || !ready}>{governed.busy ? 'Closing…' : 'Close order'}</button>
      {governed.error && <p role="alert" className="admin-error">{governed.error}</p>}
    </form>
  </details>
}
