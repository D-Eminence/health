import { useCallback, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  adminApi, type AdminActor, type SelfServiceFacility, type SelfServiceFacilityState,
} from './api'
import { failure, isProblem } from './problems'
import { Page, Refresh, ResourceView, Status, date, has, label, useGovernedSubmit, useResource, useUrlFilters } from './ui'

/**
 * New facility sign-ups (P4, which only Novu serves). A hospital, laboratory
 * or pharmacy signs itself up with a CAC number QoreID confirms and an email
 * code, and its administrator is active at once (owner decision "alert + daily
 * review"). Support checks each one within a working day here: the list needs
 * platform.identity-review.read, as Applications does; "Mark reviewed" needs
 * platform.facility.manage, as rejecting an application does. A facility that
 * looks wrong is suspended on its facility page and its administrator disabled
 * in Users & roles, with the commands those pages already have.
 */
const FILTERS: ReadonlyArray<{ value: SelfServiceFacilityState; title: string }> = [
  { value: 'unreviewed', title: 'To review' },
  { value: 'reviewed', title: 'Reviewed' },
  { value: 'all', title: 'All' },
]
/** The most rows Identity lists at once. */
const LIST_LIMIT = 200

/** The refusals of "Mark reviewed" after which the list is read again, so it shows what is true now. */
const REFRESHING = ['VERSION_CONFLICT', 'SELF_SERVICE_FACILITY_ALREADY_REVIEWED', 'SELF_SERVICE_FACILITY_NOT_FOUND'] as const
const REVIEW_FAILED = 'The review could not be saved. Try again.'
const REVIEW_PROBLEMS: Readonly<Record<string, string>> = {
  VERSION_CONFLICT: 'This sign-up changed after the list was loaded. The list has been refreshed: check it again before '
    + 'marking it reviewed.',
  PERMISSION_DENIED: 'Marking a sign-up reviewed needs the platform.facility.manage permission. Ask a Super Admin.',
}

type Done = (notice: { text: string; tone: 'success' | 'error' }) => void

function ReviewForm({ facility, onDone }: { facility: SelfServiceFacility; onDone: Done }) {
  const [note, setNote] = useState('')
  const governed = useGovernedSubmit()
  const id = `self-service-note-${facility.applicationId}`
  const ready = note.trim().length >= 8 && note.trim().length <= 500

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (governed.busy || !ready) return
    let refused: unknown = null
    const done = await governed.submit(async () => {
      try { return await adminApi.reviewSelfServiceFacility(facility, note.trim()) }
      catch (caught) { refused = caught; throw caught }
    }, REVIEW_FAILED, REVIEW_PROBLEMS)
    if (done) { setNote(''); onDone({ text: `Marked ${facility.facilityName} reviewed.`, tone: 'success' }) }
    // The list is read again, which may remove or replace this card: the page says why.
    else if (REFRESHING.some(code => isProblem(refused, code))) {
      governed.setError(null)
      onDone({ text: failure(refused, REVIEW_FAILED, REVIEW_PROBLEMS), tone: 'error' })
    }
  }

  return <details className="admin-action">
    <summary>Mark reviewed</summary>
    <form className="admin-action-form" onSubmit={event => void submit(event)}>
      <label htmlFor={id}>What you checked</label>
      <textarea id={id} required minLength={8} maxLength={500} rows={3} value={note}
        aria-describedby={`${id}-hint`} onChange={event => setNote(event.target.value)} />
      <small id={`${id}-hint`} className="admin-note">8 to 500 characters, kept with the review. For example: “Called the
        hospital’s published number; the medical director confirmed Ada Obi is their administrator.”</small>
      <button type="submit" className="admin-primary" disabled={governed.busy || !ready}>
        {governed.busy ? 'Saving…' : 'Mark reviewed'}</button>
      {governed.error && <p role="alert" className="admin-error">{governed.error}</p>}
    </form>
  </details>
}

function SignUpCard({ facility, actor, onDone }: { facility: SelfServiceFacility; actor: AdminActor; onDone: Done }) {
  const canReview = has(actor, 'platform.facility.manage')
  const canOpenFacility = has(actor, 'platform.facility.read')
  const canFindAdministrator = has(actor, 'platform.principal.read')
  return <article className="admin-tile" aria-labelledby={`self-service-${facility.applicationId}`}>
    <div className="admin-panel-head">
      <h2 id={`self-service-${facility.applicationId}`}>{facility.facilityName}</h2>
      <Status value={facility.facilityLifecycleStatus} />
    </div>
    <dl className="admin-detail-grid">
      <div><dt>Legal name (CAC)</dt><dd>{facility.organizationName}</dd></div>
      <div><dt>CAC number</dt><dd>{facility.cacHint || 'Not shown'}</dd></div>
      <div><dt>Product</dt><dd>{label(facility.productCode)}</dd></div>
      <div><dt>Organization type</dt><dd>{facility.organizationType ? label(facility.organizationType) : 'Not provided'}</dd></div>
      <div><dt>Administrator</dt><dd>{facility.administratorName}<small>{facility.administratorEmail}</small></dd></div>
      <div><dt>Account status</dt><dd>{facility.administratorAccountStatus ? label(facility.administratorAccountStatus) : 'No account'}</dd></div>
      <div><dt>Signed up</dt><dd>{date(facility.activatedAt)}</dd></div>
      <div><dt>Reviewed</dt><dd>{facility.reviewedAt ? date(facility.reviewedAt) : 'Not yet'}</dd></div>
    </dl>
    {facility.reviewNote && <p className="admin-note">Review note: {facility.reviewNote}</p>}
    {(canOpenFacility || canFindAdministrator) && <p className="admin-note admin-inline-links">If it looks wrong,{' '}
      {canOpenFacility && <>suspend the facility on its <Link to={`/admin/facilities/${encodeURIComponent(facility.facilityId)}`}>
        facility page</Link></>}
      {canOpenFacility && canFindAdministrator && ' and '}
      {/* The email goes in the page's state, never in the URL, as Users & roles keeps its search. */}
      {canFindAdministrator && <>disable the administrator’s account in <Link to="/admin/principals"
        state={{ principalQuery: facility.administratorEmail }}>Users &amp; roles</Link></>}.</p>}
    {!facility.reviewedAt && (canReview ? <ReviewForm facility={facility} onDone={onDone} />
      : <p className="admin-note">View only: marking a sign-up reviewed needs the platform.facility.manage permission.</p>)}
  </article>
}

export function SelfServiceFacilitiesPage({ actor }: { actor: AdminActor }) {
  const [filters, setFilters] = useUrlFilters(['state'] as const)
  const state = FILTERS.find(item => item.value === filters.state)?.value ?? 'unreviewed'
  const load = useCallback((signal?: AbortSignal) => adminApi.selfServiceFacilities(state, signal), [state])
  const resource = useResource(load, 'New facility sign-ups could not be loaded.')
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error' } | null>(null)
  const items = resource.data?.items ?? null
  // How many are still to be checked, while the list shown includes them all.
  const waiting = items && state !== 'reviewed' ? items.filter(item => !item.reviewedAt).length : null
  const title = waiting === null ? 'New facility sign-ups'
    : `New facility sign-ups (${waiting}${items!.length >= LIST_LIMIT ? ' or more' : ''} to review)`

  // After a review, or a refusal that means the list is out of date, the list is read again.
  function done(next: { text: string; tone: 'success' | 'error' }) {
    setNotice(next)
    resource.reload()
  }

  return <Page eyebrow="Organizations" title={title}
    description="Hospitals, laboratories and pharmacies that signed themselves up. Check each one within one working day."
    action={<Refresh onClick={() => { setNotice(null); resource.reload() }} disabled={resource.loading} />}>
    <section className="admin-panel" aria-labelledby="self-service-check-title">
      <div className="admin-panel-head"><div><h2 id="self-service-check-title">What to check</h2>
        <p>The CAC check proves that the company exists and is active. It does not prove that the person who signed up
          works there.</p>
        <p>Check that the administrator’s name and email fit the company, for example an email address at the company’s
          own domain, or a call to the company’s published phone number.</p>
        <p>A mistyped CAC number can sign up another, real company under its legal name. If the legal name is not the
          administrator’s own organization, treat the sign-up as wrong.</p>
        <p>If anything looks wrong, suspend the facility and disable the administrator’s account, then mark the sign-up
          reviewed with what you found.</p></div></div>
    </section>
    <div className="admin-filter" role="group" aria-label="Review status">
      {FILTERS.map(item => <button key={item.value} type="button" aria-pressed={state === item.value}
        className={state === item.value ? 'admin-primary' : 'admin-secondary'}
        onClick={() => { setNotice(null); setFilters({ state: item.value === 'unreviewed' ? '' : item.value }) }}>{item.title}</button>)}
    </div>
    <div role="status">{notice?.tone === 'success' && <p className="admin-success">{notice.text}</p>}</div>
    {notice?.tone === 'error' && <p role="alert" className="admin-error">{notice.text}</p>}
    <ResourceView resource={resource}>{result => result.items.length === 0
      ? <div className="admin-state">{state === 'unreviewed' ? 'No new facility sign-ups are waiting for review.'
        : state === 'reviewed' ? 'No facility sign-up has been reviewed yet.' : 'No facility has signed itself up yet.'}</div>
      : <div className="admin-stack">
        {result.items.map(facility => <SignUpCard key={`${facility.applicationId}:${facility.version}`} facility={facility}
          actor={actor} onDone={done} />)}
      </div>}</ResourceView>
  </Page>
}
