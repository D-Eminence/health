import { useCallback, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  adminApi, type AdminActor, type NamedAccount, type WrongPatientReport, type WrongPatientReviewAction,
} from './api'
import { isProblem } from './problems'
import { Page, Refresh, ResourceView, Table, date, has, useGovernedSubmit, useResource, useUrlFilters } from './ui'

/**
 * Support's "Wrong-patient reports" (item 3, owner decisions D7, D11, D12, D14; SPEC-FINAL §8.4, §9.5): every report by a
 * laboratory or pharmacy that it accepted an order for someone who was not the patient, the unreviewed ones flagged first,
 * with "Mark reviewed" for an administrator holding platform.facility.manage. Identity audits every read; no row shows a
 * patient or what was ordered. An Identity without the route (hid-system main, or Novu before 0088) answers 404: the page
 * says so, and the Overview tile and the facility page's count show nothing.
 */

const KIND_WORDS: Readonly<Record<string, string>> = { lab_request: 'Lab request', prescription: 'Prescription' }

const FLAG_WORDS: Readonly<Record<string, string>> = {
  something_came_back: 'A result or dispensing had come back',
  reporter_recorded_work: 'The reporter recorded the work',
  suspected_misuse: 'Suspected pretending',
  other_reason_nothing_recorded: 'Another reason, and nothing was recorded',
}

const REASON_WORDS: Readonly<Record<string, string>> = {
  wrong_order_chosen: 'Picked another patient’s order from the list',
  someone_elses_details: 'The person gave someone else’s Health ID or date of birth',
  suspected_misuse: 'Thinks the person was pretending to be the patient',
  other: 'Not the patient for another reason',
}

const ACCEPTED_WITH_WORDS: Readonly<Record<string, string>> = {
  health_id: 'Health ID', date_of_birth_with_reference: 'Date of birth and the order’s reference', date_of_birth: 'Date of birth only',
}

/** What support may record at review: one or more of these, or "No further action" alone (C27). */
export const REVIEW_ACTIONS: ReadonlyArray<{ value: WrongPatientReviewAction; label: string }> = [
  { value: 'ordering_facility_told', label: 'Ordering facility told' },
  { value: 'facility_contacted', label: 'Facility contacted' },
  { value: 'staff_access_changed', label: 'A member’s access changed' },
  { value: 'facility_suspended', label: 'Facility suspended' },
  { value: 'referred_to_dpo', label: 'Referred to the data protection officer' },
]
const NO_FURTHER_ACTION = { value: 'no_further_action' as const, label: 'No further action' }
const ACTION_WORDS: Readonly<Record<string, string>> = Object.fromEntries(
  [...REVIEW_ACTIONS, NO_FURTHER_ACTION].map(item => [item.value, item.label]))

/** When one facility or member reaches this many reports in 30 days, support contacts the facility (§9.5). */
const CONTACT_AT = 3

/** Said where support closes an order, and on the reports page: what to do when the facility can no longer end it (C7). */
export const LATE_CASE_NOTE = 'If a patient or clinician tells you a result or dispensing went to the wrong person and the '
  + 'facility can no longer end the order, ask the ordering clinician to record in the patient’s notes that it was not '
  + 'theirs, and refer it to the data protection officer the same day.'

function nameOf(person: NamedAccount | null | undefined, fallback = 'A member'): string {
  return person?.name?.trim() || fallback
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/** What the report withdrew, in support's words: never what the result or medicine was. */
function undoneText(report: WrongPatientReport): string {
  const parts: string[] = []
  if (report.stateBefore !== 'completed') parts.push('Nothing had come back to the ordering facility.')
  if (report.kind === 'lab_request') {
    if (report.resultsVoided > 0) parts.push(`${plural(report.resultsVoided, 'result version')} marked entered in error at the laboratory.`)
    if (report.resultReportsMarked > 0) parts.push(`${plural(report.resultReportsMarked, 'version')} that had come back withdrawn at the ordering facility.`)
    parts.push(`${plural(report.specimensCollected, 'specimen')} taken.`)
  } else if (report.dispensingReversed) parts.push('The dispensing was reversed.')
  else parts.push('No dispensing was reversed.')
  return parts.join(' ')
}

function recordedText(report: WrongPatientReport): string {
  const names = (Array.isArray(report.recordedBy) ? report.recordedBy : []).map(person => nameOf(person))
  if (names.length === 0) return 'No work was recorded.'
  return `${names.join(', ')}${report.reporterRecordedWork ? ' (the reporter among them)' : ''}.`
}

/** The page's filter: the reports one facility made, from its facility page's link. */
const FACILITY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function WrongPatientReportsPage({ actor }: { actor: AdminActor }) {
  const [filters, setFilters] = useUrlFilters(['view', 'facility'] as const)
  const view = filters.view === 'recent' ? 'recent' : 'unreviewed'
  const facilityId = FACILITY_ID.test(filters.facility) ? filters.facility : undefined
  const load = useCallback((signal?: AbortSignal) => adminApi.wrongPatientReports(view, facilityId, signal), [view, facilityId])
  const resource = useResource(load, 'Wrong-patient reports could not be loaded.')
  const [notice, setNotice] = useState<string | null>(null)
  const canReview = has(actor, 'platform.facility.manage')
  const facilityName = resource.data?.items.find(item => item.receivingFacility.id === facilityId)?.receivingFacility.name ?? null

  return <Page eyebrow="Organizations" title="Wrong-patient reports"
    description="Orders a laboratory or pharmacy accepted for someone who was not the patient, and ended."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <section className="admin-panel" aria-labelledby="wrong-patient-intro-title">
      <div className="admin-panel-head"><div><h2 id="wrong-patient-intro-title">What to do</h2>
        <p>A laboratory or pharmacy ends an order it accepted for someone who was not the order’s patient. Its access ended at
          once, and any result or dispensing it had sent back was withdrawn.</p></div></div>
      <ul className="admin-notes">
        <li>Review each report within one business day. Flagged reports come first.</li>
        <li>When a result or dispensing had come back, phone the ordering facility the same day, tell them, and tick
          “Ordering facility told”. Refer the report to the data protection officer the same day.</li>
        <li>Refer every “pretending” report to the data protection officer the same day as well.</li>
        <li>When the reporter recorded the work themselves, ask the facility how the mistake was found.</li>
        <li>Contact the facility when one facility or member has three or more reports in 30 days; you can unlist or suspend
          the facility from its page.</li>
        <li>If the note contains names, tests, medicines or health details, remove it when you review.</li>
        <li>{LATE_CASE_NOTE}</li>
      </ul>
    </section>
    <div className="admin-filter" role="group" aria-label="Reports">
      {(['unreviewed', 'recent'] as const).map(item => <button key={item} type="button" aria-pressed={view === item}
        className={view === item ? 'admin-primary' : 'admin-secondary'}
        onClick={() => { setNotice(null); setFilters({ view: item === 'unreviewed' ? '' : item }) }}>
        {item === 'unreviewed' ? 'Unreviewed' : 'Recent (90 days)'}</button>)}
    </div>
    {facilityId && <p className="admin-note">Showing only the reports {facilityName ?? 'this facility'} made.{' '}
      <button type="button" className="admin-link" onClick={() => setFilters({ facility: '' })}>Show every facility’s</button></p>}
    <div role="status">{notice && <p className="admin-success">{notice}</p>}</div>
    <ResourceView resource={resource}>{({ items }) => items.length === 0
      ? <p className="admin-state">{view === 'unreviewed' ? 'No report is waiting for review.' : 'No report in the last 90 days.'}</p>
      : <><p className="admin-result-count">{plural(items.length, 'report')}, {view === 'unreviewed'
        ? 'flagged first, then oldest first' : 'newest first'}.</p>
      <Table headings={['Reported', 'Flags', 'Order', 'At', 'From', 'Accepted with', 'Reason', 'Note', 'Who recorded the work',
        'What was undone', 'Last 30 days', 'Review']}>
        {items.map(report => <ReportRow key={`${report.reportId}-${report.version}`} report={report} canReview={canReview}
          onReviewed={reference => { setNotice(`Report on order ${reference} marked reviewed.`); resource.reload() }}
          onStale={resource.reload} />)}
      </Table></>}</ResourceView>
  </Page>
}

function ReportRow({ report, canReview, onReviewed, onStale }: { report: WrongPatientReport; canReview: boolean
  onReviewed: (reference: string) => void; onStale: () => void }) {
  const flags = (Array.isArray(report.flags) ? report.flags : []).filter(flag => FLAG_WORDS[flag])
  const facilityCount = report.facilityReportsLast30Days
  const memberCount = report.memberReportsLast30Days
  return <tr data-flagged={flags.length > 0 || undefined}>
    <td>{date(report.reportedAt)}<small>by {nameOf(report.reportedBy)}</small></td>
    <td>{flags.length === 0 ? 'None' : <ul className="admin-flags">{flags.map(flag => <li key={flag}><strong>{FLAG_WORDS[flag]}</strong></li>)}</ul>}</td>
    <td><strong>{report.reference}</strong><small>{KIND_WORDS[report.kind] ?? report.kind}</small></td>
    <td><Link to={`/admin/facilities/${encodeURIComponent(report.receivingFacility.id)}`}>{report.receivingFacility.name ?? 'Facility'}</Link></td>
    <td><Link to={`/admin/facilities/${encodeURIComponent(report.orderingFacility.id)}`}>{report.orderingFacility.name ?? 'Facility'}</Link></td>
    <td>{ACCEPTED_WITH_WORDS[report.acceptedWith] ?? report.acceptedWith}<small>Accepted {date(report.acceptedAt)} by
      {' '}{report.sameMember ? 'the reporter' : nameOf(report.acceptedBy)}</small></td>
    <td>{REASON_WORDS[report.reason] ?? report.reason}</td>
    <td>{report.noteRemoved ? <em>{report.note}</em> : <span className="admin-note-content">{report.note}</span>}</td>
    <td>{recordedText(report)}</td>
    <td>{undoneText(report)}</td>
    <td>{plural(facilityCount, 'report')} by {report.receivingFacility.name ?? 'this facility'}
      <small>{plural(memberCount, 'report')} on orders {nameOf(report.acceptedBy, 'the same member')} accepted</small>
      {(facilityCount >= CONTACT_AT || memberCount >= CONTACT_AT) && <strong className="admin-flag-text">Contact the facility</strong>}</td>
    <td>{report.review ? <ReviewDone review={report.review} />
      : canReview ? <ReviewForm report={report} onReviewed={() => onReviewed(report.reference)} onStale={onStale} />
        : 'Reviewing needs platform.facility.manage'}</td>
  </tr>
}

function ReviewDone({ review }: { review: NonNullable<WrongPatientReport['review']> }) {
  const actions = (Array.isArray(review.actions) ? review.actions : []).map(action => ACTION_WORDS[action] ?? action)
  return <>Reviewed {date(review.reviewedAt)} by {nameOf(review.reviewedBy)}<small>{actions.join(', ')}</small>
    <small className="admin-note-content">{review.note}</small></>
}

const REVIEW_PROBLEMS: Readonly<Record<string, string>> = {
  WRONG_PATIENT_REVIEW_INVALID: 'Choose at least one action, or “No further action” alone, and write a note of 8 to 500 characters.',
  VALIDATION_FAILED: 'Choose at least one action, or “No further action” alone, and write a note of 8 to 500 characters.',
  WRONG_PATIENT_REPORT_NOT_FOUND: 'This report was not found. The list has been refreshed.',
  WRONG_PATIENT_REPORT_ALREADY_REVIEWED: 'Someone has already reviewed this report. The list has been refreshed.',
  VERSION_CONFLICT: 'This report changed after it was loaded. The list has been refreshed: check it before reviewing it.',
  PERMISSION_DENIED: 'Reviewing a report needs the platform.facility.manage permission. Ask a Super Admin.',
}
const REVIEW_REFRESHING = ['WRONG_PATIENT_REPORT_NOT_FOUND', 'WRONG_PATIENT_REPORT_ALREADY_REVIEWED', 'VERSION_CONFLICT'] as const

/**
 * "Mark reviewed" (C27): one or more actions, or "No further action" alone; a note of 8 to 500 characters; whether to
 * remove the reporter's note (once, replaced by fixed text, D7); and a confirmation. If-Match with the report's version.
 */
function ReviewForm({ report, onReviewed, onStale }: { report: WrongPatientReport; onReviewed: () => void; onStale: () => void }) {
  const [actions, setActions] = useState<ReadonlySet<WrongPatientReviewAction>>(() => new Set())
  const [note, setNote] = useState('')
  const [removeNote, setRemoveNote] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const governed = useGovernedSubmit()
  const length = note.trim().length
  const ready = actions.size > 0 && length >= 8 && length <= 500 && confirmed
  const id = `wrong-patient-review-${report.reportId}`

  function toggle(action: WrongPatientReviewAction, checked: boolean) {
    setActions(current => {
      // "No further action" stands alone; any other action replaces it.
      if (action === 'no_further_action') return checked ? new Set([action]) : new Set()
      const next = new Set(current)
      next.delete('no_further_action')
      if (checked) next.add(action)
      else next.delete(action)
      return next
    })
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (governed.busy || !ready) return
    let refused: unknown = null
    const reviewed = await governed.submit(async () => {
      try {
        return await adminApi.reviewWrongPatientReport(report, { actions: [...actions], note: note.trim(), removeNote })
      } catch (caught) { refused = caught; throw caught }
    }, 'The report could not be marked reviewed. Try again.', REVIEW_PROBLEMS)
    if (reviewed) onReviewed()
    else if (REVIEW_REFRESHING.some(code => isProblem(refused, code))) onStale()
  }

  return <details className="admin-action">
    <summary>Mark reviewed</summary>
    <form className="admin-action-form admin-review-form" onSubmit={event => void submit(event)}>
      <fieldset><legend>What was done</legend>
        {REVIEW_ACTIONS.map(item => <label key={item.value} className="admin-checkbox"><input type="checkbox"
          checked={actions.has(item.value)} onChange={event => toggle(item.value, event.target.checked)} /> {item.label}</label>)}
        <label className="admin-checkbox"><input type="checkbox" checked={actions.has(NO_FURTHER_ACTION.value)}
          onChange={event => toggle(NO_FURTHER_ACTION.value, event.target.checked)} /> {NO_FURTHER_ACTION.label}</label>
      </fieldset>
      <label htmlFor={`${id}-note`}>Review note</label>
      <textarea id={`${id}-note`} required minLength={8} maxLength={500} rows={3} value={note} aria-describedby={`${id}-note-hint`}
        onChange={event => setNote(event.target.value)} />
      <small id={`${id}-note-hint`} className="admin-note">8 to 500 characters, kept with the report and in the audit log.</small>
      {!report.noteRemoved && <><label className="admin-checkbox"><input type="checkbox" checked={removeNote}
        aria-describedby={`${id}-remove-hint`} onChange={event => setRemoveNote(event.target.checked)} /> Remove the reporter’s note</label>
      <small id={`${id}-remove-hint`} className="admin-note">It is replaced by “Removed by Health ID support at review.” and can’t be
        recovered.</small></>}
      <label className="admin-checkbox"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I
        have reviewed this report.</label>
      <button type="submit" className="admin-primary" disabled={governed.busy || !ready}>{governed.busy ? 'Saving…' : 'Mark reviewed'}</button>
      {governed.error && <p role="alert" className="admin-error">{governed.error}</p>}
    </form>
  </details>
}

/**
 * The Overview tile (D11): how many reports wait for review. Shown only where the backend serves the list: an Identity
 * without it (404) shows no tile.
 */
export function WrongPatientReportsTile() {
  const load = useCallback((signal?: AbortSignal) => unlessUnavailable(adminApi.wrongPatientReports('unreviewed', undefined, signal)), [])
  const resource = useResource(load, 'Wrong-patient reports could not be loaded.')
  if (!resource.loading && !resource.error && resource.data === null) return null
  return <article className="admin-tile admin-attention">
    <h3><Link to="/admin/wrong-patient-reports">Wrong-patient reports</Link></h3>
    {resource.loading && resource.data === null ? <p role="status">Loading…</p>
      : resource.error ? <p className="admin-error" role="alert">{resource.error}</p>
        : resource.data ? <p><strong className="admin-attention-count">{new Intl.NumberFormat('en-NG').format(resource.data.items.length)}</strong> to review</p>
          : null}
  </article>
}

/** The list, or null from an Identity without the route (404, said as WRONG_PATIENT_REPORTS_UNAVAILABLE): shown as nothing. */
async function unlessUnavailable(read: Promise<{ items: WrongPatientReport[] }>): Promise<{ items: WrongPatientReport[] } | null> {
  try { return await read } catch (caught) {
    if (isProblem(caught, 'WRONG_PATIENT_REPORTS_UNAVAILABLE')) return null
    throw caught
  }
}

/**
 * A facility page's count (§8.4): the reports this facility made in the last 30 days, linked to the list of them. Read
 * with the facility's orders summary, only when support opens it (each read is audited); nothing where the backend has
 * no such list.
 */
export function FacilityWrongPatientCount({ facilityId }: { facilityId: string }) {
  const load = useCallback((signal?: AbortSignal) => unlessUnavailable(adminApi.wrongPatientReports('recent', facilityId, signal)), [facilityId])
  const resource = useResource(load, 'This facility’s wrong-patient reports could not be loaded.')
  if (resource.error) return <p className="admin-error" role="alert">{resource.error}</p>
  if (!resource.data) return resource.loading ? <p className="admin-note" role="status">Loading wrong-patient reports…</p> : null
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000
  const count = resource.data.items.filter(item => Date.parse(item.reportedAt) >= since).length
  return <p>Wrong-patient reports, last 30 days: <strong>{count}</strong>{' '}
    <Link to={`/admin/wrong-patient-reports?view=recent&facility=${encodeURIComponent(facilityId)}`}>See its reports</Link></p>
}
