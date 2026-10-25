import { useCallback, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  adminApi, type AdminActor, type SelfServiceApplication, type SelfServiceFacility, type SelfServiceFacilityState,
} from './api'
import { failure, isProblem } from './problems'
import { Page, Refresh, ResourceView, Status, date, has, label, useGovernedSubmit, useResource, useUrlFilters } from './ui'

/**
 * New facility sign-ups (P4, which only Novu serves). A hospital, laboratory
 * or pharmacy signs itself up with a CAC number QoreID confirms and an email
 * code, and its administrator is active at once (owner decision "alert + daily
 * review"). Support checks each one within a working day here: the lists need
 * platform.identity-review.read, as Applications does; "Mark reviewed",
 * "Release" and "Reject" need platform.facility.manage, as rejecting an
 * application does. A facility that looks wrong is suspended on its facility
 * page and its administrator disabled in Users & roles, with the commands
 * those pages already have; once both are done, releasing the sign-up frees
 * its CAC number and legal name for the real company (P4 round 2). The open
 * applications view lists sign-ups not activated yet, each holding its CAC
 * number for 24 hours, so support can reject one that isn't the company's.
 */
type View = SelfServiceFacilityState | 'open'
const VIEWS: ReadonlyArray<{ value: View; title: string }> = [
  { value: 'unreviewed', title: 'To review' },
  { value: 'reviewed', title: 'Reviewed or released' },
  { value: 'all', title: 'All' },
  { value: 'open', title: 'Open applications' },
]
/** The most rows Identity lists at once. */
const LIST_LIMIT = 200

const REASON_INVALID = 'Enter a reason of 8 to 500 characters.'

const REVIEW_FAILED = 'The review could not be saved. Try again.'
/** The refusals of "Mark reviewed" after which the list is read again, so it shows what is true now. */
const REVIEW_REFRESHING = ['VERSION_CONFLICT', 'SELF_SERVICE_FACILITY_ALREADY_REVIEWED', 'SELF_SERVICE_FACILITY_NOT_FOUND'] as const
const REVIEW_PROBLEMS: Readonly<Record<string, string>> = {
  VERSION_CONFLICT: 'This sign-up changed after the list was loaded. The list has been refreshed: check it again before '
    + 'marking it reviewed.',
  PERMISSION_DENIED: 'Marking a sign-up reviewed needs the platform.facility.manage permission. Ask a Super Admin.',
}

const RELEASE_FAILED = 'The sign-up could not be released. Try again.'
const RELEASE_REFRESHING = ['VERSION_CONFLICT', 'SELF_SERVICE_FACILITY_ALREADY_RELEASED', 'SELF_SERVICE_FACILITY_NOT_FOUND',
  'SELF_SERVICE_FACILITY_RELEASE_REQUIRES_SUSPENSION'] as const
const RELEASE_PROBLEMS: Readonly<Record<string, string>> = {
  VERSION_CONFLICT: 'This sign-up changed after the list was loaded. The list has been refreshed: check it again before '
    + 'releasing it.',
  PERMISSION_DENIED: 'Releasing a sign-up needs the platform.facility.manage permission. Ask a Super Admin.',
  SELF_SERVICE_FACILITY_REQUEST_INVALID: REASON_INVALID,
}

const REJECT_FAILED = 'The sign-up could not be rejected. Try again.'
const REJECT_REFRESHING = ['VERSION_CONFLICT', 'SELF_SERVICE_APPLICATION_NOT_FOUND'] as const
const REJECT_PROBLEMS: Readonly<Record<string, string>> = {
  VERSION_CONFLICT: 'This sign-up changed after the list was loaded, for example its administrator confirmed the email. '
    + 'The list has been refreshed: check it again before rejecting it.',
  PERMISSION_DENIED: 'Rejecting a sign-up needs the platform.facility.manage permission. Ask a Super Admin.',
  SELF_SERVICE_FACILITY_REQUEST_INVALID: REASON_INVALID,
}

type Done = (notice: { text: string; tone: 'success' | 'error' }) => void

/**
 * A version-checked command on one sign-up that takes a note or reason of 8 to 500 characters. A refusal in
 * `refreshing` means the list is out of date: the list is read again and the page says why, once. Any other
 * refusal stays on the form.
 */
function ReasonForm({ id, summary, fieldLabel, hint, explanation, confirmation, action, run, refreshing, problems, fallback,
  done, onDone }: {
  id: string; summary: string; fieldLabel: string; hint: ReactNode; explanation?: ReactNode; confirmation?: string
  action: string; run: (text: string) => Promise<unknown>; refreshing: readonly string[]
  problems: Readonly<Record<string, string>>; fallback: string; done: string; onDone: Done
}) {
  const [text, setText] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const governed = useGovernedSubmit()
  const length = text.trim().length
  const ready = length >= 8 && length <= 500 && (!confirmation || confirmed)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (governed.busy || !ready) return
    let refused: unknown = null
    const completed = await governed.submit(async () => {
      try { await run(text.trim()); return true }
      catch (caught) { refused = caught; throw caught }
    }, fallback, problems)
    if (completed) { setText(''); setConfirmed(false); onDone({ text: done, tone: 'success' }) }
    // The list is read again, which may remove or replace this card: the page says why.
    else if (refreshing.some(code => isProblem(refused, code))) {
      governed.setError(null)
      onDone({ text: failure(refused, fallback, problems), tone: 'error' })
    }
  }

  return <details className="admin-action">
    <summary>{summary}</summary>
    <form className="admin-action-form" onSubmit={event => void submit(event)}>
      {explanation}
      <label htmlFor={id}>{fieldLabel}</label>
      <textarea id={id} required minLength={8} maxLength={500} rows={3} value={text}
        aria-describedby={`${id}-hint`} onChange={event => setText(event.target.value)} />
      <small id={`${id}-hint`} className="admin-note">{hint}</small>
      {confirmation && <label className="admin-checkbox"><input type="checkbox" checked={confirmed}
        onChange={event => setConfirmed(event.target.checked)} /> {confirmation}</label>}
      <button type="submit" className="admin-primary" disabled={governed.busy || !ready}>
        {governed.busy ? 'Saving…' : action}</button>
      {governed.error && <p role="alert" className="admin-error">{governed.error}</p>}
    </form>
  </details>
}

/**
 * Identity releases a sign-up only once every facility of its organization is inactive (on Novu a facility is
 * active only while verified) and its administrator's account is disabled or deleted (hid-system 0086, R2).
 */
function releaseSteps(facility: SelfServiceFacility) {
  return {
    facilitySuspended: facility.facilityLifecycleStatus !== 'verified',
    accountDisabled: facility.administratorAccountStatus === 'disabled' || facility.administratorAccountStatus === 'deleted',
  }
}

function SignUpCard({ facility, actor, onDone }: { facility: SelfServiceFacility; actor: AdminActor; onDone: Done }) {
  const canManage = has(actor, 'platform.facility.manage')
  const canOpenFacility = has(actor, 'platform.facility.read')
  const canFindAdministrator = has(actor, 'platform.principal.read')
  const released = Boolean(facility.releasedAt)
  const { facilitySuspended, accountDisabled } = releaseSteps(facility)
  const id = facility.applicationId
  return <article className="admin-tile" aria-labelledby={`self-service-${id}`}>
    <div className="admin-panel-head">
      <h2 id={`self-service-${id}`}>{facility.facilityName}</h2>
      <span className="admin-inline-statuses"><Status value={facility.facilityLifecycleStatus} />
        {released && <Status value="released" />}</span>
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
      {released && <div><dt>Released</dt><dd>{date(facility.releasedAt)}</dd></div>}
    </dl>
    {facility.reviewNote && <p className="admin-note">Review note: {facility.reviewNote}</p>}
    {facility.releaseReason && <p className="admin-note">Release reason: {facility.releaseReason}</p>}
    {!released && (canOpenFacility || canFindAdministrator) && <p className="admin-note admin-inline-links">If it looks wrong,{' '}
      {canOpenFacility && <>suspend the facility on its <Link to={`/admin/facilities/${encodeURIComponent(facility.facilityId)}`}>
        facility page</Link></>}
      {canOpenFacility && canFindAdministrator && ' and '}
      {/* The email goes in the page's state, never in the URL, as Users & roles keeps its search. */}
      {canFindAdministrator && <>disable the administrator’s account in <Link to="/admin/principals"
        state={{ principalQuery: facility.administratorEmail }}>Users &amp; roles</Link></>}.</p>}
    {!released && !facility.reviewedAt && canManage && <ReasonForm id={`self-service-note-${id}`} summary="Mark reviewed"
      fieldLabel="What you checked" action="Mark reviewed"
      hint={<>8 to 500 characters, kept with the review. For example: “Called the hospital’s published number; the medical
        director confirmed Ada Obi is their administrator.”</>}
      run={note => adminApi.reviewSelfServiceFacility(facility, note)} refreshing={REVIEW_REFRESHING}
      problems={REVIEW_PROBLEMS} fallback={REVIEW_FAILED} done={`Marked ${facility.facilityName} reviewed.`} onDone={onDone} />}
    {!released && canManage && facilitySuspended && accountDisabled && <ReasonForm id={`self-service-release-${id}`}
      summary="Release this sign-up" fieldLabel="Reason for releasing" action="Release sign-up"
      confirmation="I understand that releasing can’t be undone."
      explanation={<p className="admin-note">Releasing frees this CAC number and legal name, so the real company can sign up.
        It closes this sign-up, unlinks the CAC number, suspends the product, deactivates and renames the organization, and
        removes the administrator’s access. It can’t be undone. The administrator’s email stays with the disabled account
        and can’t be used to sign up again.</p>}
      hint={<>8 to 500 characters, kept with the release and in the audit log. For example: “The company confirmed by phone
        that it did not sign up.”</>}
      run={reason => adminApi.releaseSelfServiceFacility(facility, reason)} refreshing={RELEASE_REFRESHING}
      problems={RELEASE_PROBLEMS} fallback={RELEASE_FAILED}
      done={`Released ${facility.facilityName}. Its CAC number and legal name are free for the real company to sign up.`}
      onDone={onDone} />}
    {/* Once support has started stopping a sign-up, it says what the release still needs. */}
    {!released && canManage && facilitySuspended !== accountDisabled && <p className="admin-note">To release this sign-up for
      the real company, also {facilitySuspended ? 'disable the administrator’s account' : 'suspend the facility'}.</p>}
    {!released && !canManage && <p className="admin-note">View only: reviewing or releasing a sign-up needs the
      platform.facility.manage permission.</p>}
  </article>
}

/** What the CAC check of an open application found. */
function cacCheck(application: SelfServiceApplication): string {
  if (!application.verificationResult) return 'Not checked yet'
  return application.verificationResult === 'verified' ? 'Verified' : label(application.verificationResult)
}

function OpenApplicationCard({ application, actor, onDone }: { application: SelfServiceApplication; actor: AdminActor; onDone: Done }) {
  const id = application.applicationId
  const title = application.organizationName ?? `${application.cacHint || 'CAC number not shown'} (legal name not verified)`
  return <article className="admin-tile" aria-labelledby={`self-service-application-${id}`}>
    <div className="admin-panel-head">
      <h2 id={`self-service-application-${id}`}>{title}</h2>
      <span className="admin-status" data-state="pending">Not activated</span>
    </div>
    <dl className="admin-detail-grid">
      <div><dt>Legal name (CAC)</dt><dd>{application.organizationName ?? 'Not verified yet'}</dd></div>
      <div><dt>CAC number</dt><dd>{application.cacHint || 'Not shown'}</dd></div>
      <div><dt>Product</dt><dd>{label(application.productCode)}</dd></div>
      <div><dt>Organization type</dt><dd>{application.organizationType ? label(application.organizationType) : 'Not provided'}</dd></div>
      <div><dt>Administrator</dt><dd>{application.administratorName}<small>{application.administratorEmail}</small></dd></div>
      <div><dt>CAC check</dt><dd>{cacCheck(application)}</dd></div>
      <div><dt>Email confirmed</dt><dd>{application.emailVerified ? 'Yes' : 'Not yet'}</dd></div>
      <div><dt>Submitted</dt><dd>{date(application.submittedAt)}</dd></div>
      <div><dt>Holds the CAC number until</dt><dd>{date(application.lapsesAt)}</dd></div>
    </dl>
    {has(actor, 'platform.facility.manage')
      ? <ReasonForm id={`self-service-reject-${id}`} summary="Reject" fieldLabel="Reason for rejecting" action="Reject sign-up"
        explanation={<p className="admin-note">Rejecting closes this sign-up at once: its codes stop working, and the CAC number
          is free for the real company. This sign-up’s email and network can’t sign up this CAC number and product again for
          7 days.</p>}
        hint={<>8 to 500 characters, kept with the application and in the audit log. For example: “Not the company’s own:
          the company confirmed by phone that it did not sign up.”</>}
        run={reason => adminApi.rejectSelfServiceApplication(application, reason)} refreshing={REJECT_REFRESHING}
        problems={REJECT_PROBLEMS} fallback={REJECT_FAILED} done={`Rejected the sign-up for ${title}.`} onDone={onDone} />
      : <p className="admin-note">View only: rejecting a sign-up needs the platform.facility.manage permission.</p>}
  </article>
}

/** One view's list: activated sign-ups by review state, or the open applications. */
type Listed = { view: 'open'; items: SelfServiceApplication[] } | { view: SelfServiceFacilityState; items: SelfServiceFacility[] }

export function SelfServiceFacilitiesPage({ actor }: { actor: AdminActor }) {
  const [filters, setFilters] = useUrlFilters(['state'] as const)
  const view = VIEWS.find(item => item.value === filters.state)?.value ?? 'unreviewed'
  const load = useCallback(async (signal?: AbortSignal): Promise<Listed> => view === 'open'
    ? { view, items: (await adminApi.selfServiceApplications(signal)).items }
    : { view, items: (await adminApi.selfServiceFacilities(view, signal)).items }, [view])
  const resource = useResource(load, view === 'open' ? 'Open applications could not be loaded.'
    : 'New facility sign-ups could not be loaded.')
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error' } | null>(null)
  const facilities = resource.data && resource.data.view !== 'open' ? resource.data.items : null
  // How many are still to be checked, while the list shown includes them all.
  const waiting = facilities && view !== 'reviewed' && view !== 'open'
    ? facilities.filter(item => !item.reviewedAt && !item.releasedAt).length : null
  const title = waiting === null ? 'New facility sign-ups'
    : `New facility sign-ups (${waiting}${facilities!.length >= LIST_LIMIT ? ' or more' : ''} to review)`

  // After a command, or a refusal that means the list is out of date, the list is read again.
  function done(next: { text: string; tone: 'success' | 'error' }) {
    setNotice(next)
    resource.reload()
  }

  return <Page eyebrow="Organizations" title={title}
    description="Hospitals, laboratories and pharmacies that signed themselves up. Check each one within one working day."
    action={<Refresh onClick={() => { setNotice(null); resource.reload() }} disabled={resource.loading} />}>
    {view === 'open'
      ? <section className="admin-panel" aria-labelledby="self-service-open-title">
        <div className="admin-panel-head"><div><h2 id="self-service-open-title">Open applications</h2>
          <p>Sign-ups that haven’t been finished yet: the administrator hasn’t confirmed their email or chosen a password.
            Each one holds its CAC number and product for 24 hours after it was submitted, so nobody else can sign up that
            company meanwhile.</p>
          <p>If one isn’t the company’s own, for example because of a mistyped CAC number, reject it so the real company can
            sign up.</p></div></div>
      </section>
      : <section className="admin-panel" aria-labelledby="self-service-check-title">
        <div className="admin-panel-head"><div><h2 id="self-service-check-title">What to check</h2>
          <p>The CAC check proves that the company exists and is active. It does not prove that the person who signed up
            works there.</p>
          <p>Check that the administrator’s name and email fit the company, for example an email address at the company’s
            own domain, or a call to the company’s published phone number.</p>
          <p>A mistyped CAC number can sign up another, real company under its legal name. If the legal name is not the
            administrator’s own organization, treat the sign-up as wrong.</p>
          <p>If anything looks wrong, suspend the facility and disable the administrator’s account, then mark the sign-up
            reviewed with what you found.</p>
          <p>If it used another company’s CAC number, by mistake or not, also release it once the facility is suspended and
            the account disabled. That frees the CAC number and the legal name, so the real company can sign up.</p></div></div>
      </section>}
    <div className="admin-filter" role="group" aria-label="Which sign-ups">
      {VIEWS.map(item => <button key={item.value} type="button" aria-pressed={view === item.value}
        className={view === item.value ? 'admin-primary' : 'admin-secondary'}
        onClick={() => { setNotice(null); setFilters({ state: item.value === 'unreviewed' ? '' : item.value }) }}>{item.title}</button>)}
    </div>
    <div role="status">{notice?.tone === 'success' && <p className="admin-success">{notice.text}</p>}</div>
    {notice?.tone === 'error' && <p role="alert" className="admin-error">{notice.text}</p>}
    <ResourceView resource={resource}>{result => result.items.length === 0
      ? <div className="admin-state">{result.view === 'open' ? 'No sign-ups are waiting to be finished.'
        : result.view === 'unreviewed' ? 'No new facility sign-ups are waiting for review.'
          : result.view === 'reviewed' ? 'No facility sign-up has been reviewed or released yet.'
            : 'No facility has signed itself up yet.'}</div>
      : <div className="admin-stack">
        {result.view === 'open'
          ? result.items.map(application => <OpenApplicationCard key={`${application.applicationId}:${application.version}`}
            application={application} actor={actor} onDone={done} />)
          : result.items.map(facility => <SignUpCard key={`${facility.applicationId}:${facility.version}`} facility={facility}
            actor={actor} onDone={done} />)}
      </div>}</ResourceView>
  </Page>
}
