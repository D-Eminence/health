import { useCallback, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import {
  adminApi, type AdminActor, type ClinicianApplicationDetail, type ClinicianApplicationFilter,
  type ClinicianApplicationSummary, type ClinicianAttestationChecklist, type ClinicianDecisionCode,
} from './api'
import { problemCode } from './problems'
import {
  LoadMore, Page, Refresh, ResourceView, date, label, useCursorPages, useGovernedSubmit, useResource, useUrlFilters,
} from './ui'
import { isSixDigitCode, sixDigitCode } from '../mfa/codes'
import { decisionCopy, lagosToday, REGULATOR_NAME } from '../staff/clinician/copy'

/**
 * The clinician verification queue (hid-system ADR-066, branch
 * claude/clinician-self-signup at fa58e2b): doctors and nurses who applied by
 * themselves at /provider/join. One Super Admin checks the licence, the person
 * (with a live code from the applicant's own authenticator, read out on the
 * call) and the employment, and records step 1; a different Super Admin, who
 * does not work at the facility either, approves (step 2), which attaches the
 * account and grants the role step 1 attested. Any of them may reject an open
 * application with a reason the applicant sees.
 *
 * The backend decides everything: the caller hints only choose which panel is
 * shown, and each command checks the session, step-up, permission, version,
 * reason, idempotency and the two-person rule again. A command is one
 * submission (one Idempotency-Key, repeated only by the step-up); an
 * application that changed is reloaded, and an answer that was lost is never
 * read as success or failure.
 */

const FILTERS: ReadonlyArray<{ value: ClinicianApplicationFilter; title: string }> = [
  { value: 'open', title: 'Open' }, { value: 'awaiting_authenticator', title: 'Waiting for authenticator' },
  { value: 'submitted', title: 'Submitted' }, { value: 'under_review', title: 'Under review' },
  { value: 'approved', title: 'Approved' }, { value: 'rejected', title: 'Rejected' },
  { value: 'withdrawn', title: 'Withdrawn' }, { value: 'expired', title: 'Expired' },
]
const STATE_TITLE: Readonly<Record<string, string>> = Object.fromEntries(
  FILTERS.filter(item => item.value !== 'open').map(item => [item.value, item.title]))
const OPEN_STATES: ReadonlySet<string> = new Set(['awaiting_authenticator', 'submitted', 'under_review'])
const PROFESSION_TITLE: Readonly<Record<string, string>> = { doctor: 'Doctor', nurse: 'Nurse or midwife' }
const APPLICATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const IDENTITY_METHODS = [
  { value: 'video_call_photo_id', title: 'Video call with photo ID' },
  { value: 'in_person_photo_id', title: 'In person with photo ID' },
] as const
const EMPLOYMENT_CHANNELS = [
  { value: 'facility_public_phone', title: 'Facility phone number from a public record',
    detail: ' (CAC record, regulator or facility register, published listing)' },
  { value: 'in_person_visit', title: 'In-person visit', detail: '' },
] as const
type IdentityMethod = ClinicianAttestationChecklist['identityMethod']
type EmploymentChannel = ClinicianAttestationChecklist['employmentChannel']

/** The nine reasons an applicant can be shown (RejectClinicianApplicationDto), in the backend's order. */
const DECISIONS: ReadonlyArray<{ value: ClinicianDecisionCode; title: string }> = [
  { value: 'licence_not_verified', title: 'Licence not verified' },
  { value: 'licence_not_current', title: 'Licence not current' },
  { value: 'details_mismatch', title: 'Details don’t match the register' },
  { value: 'identity_not_confirmed', title: 'Identity not confirmed' },
  { value: 'employment_not_confirmed', title: 'Employment not confirmed' },
  { value: 'facility_not_available', title: 'Facility not available' },
  { value: 'duplicate', title: 'Duplicate' },
  { value: 'existing_account', title: 'Existing account' },
  { value: 'other', title: 'Other' },
]

/** identity.clinician_application_access_state for an approved application. */
const ACCESS_TITLE: Readonly<Record<string, string>> = {
  active: 'Active: they can sign in at this facility',
  lapsed: 'Lapsed: the role is held but its licence check expired, so it gives no access',
  ended: 'Ended: the membership or role at this facility ended',
  account_unavailable: 'Account unavailable: the account is not active or is locked',
}

/** Role permissions in plain words for step 2; several codes can share one. */
const PERMISSION_LABELS: Readonly<Record<string, string>> = {
  'identity.patient.read': 'find patients by Health ID',
  'identity.consent.read': 'request and check patient consent',
  'identity.consent.write': 'request and check patient consent',
  'identity.authorization.check': 'request and check patient consent',
  'identity.patient-access-pin.verify': 'request and check patient consent',
  'identity.registration.write': 'register patients',
  'identity.break-glass.write': 'open emergency summaries without consent when break-glass is on',
  'ehr.encounter.write': 'open encounters',
  'ehr.note.write': 'write clinical notes',
  'ehr.vital.write': 'record vital signs',
  'ehr.diagnosis.write': 'record diagnoses',
  'ehr.prescription.write': 'write prescriptions',
  'ehr.lab-request.write': 'request laboratory tests',
  'ehr.document.write': 'add documents to patient records',
}

const REVIEW_NOTE = 'Each step is checked again by the server, needs your authenticator confirmation and is recorded in '
  + 'the audit log.'
const CHANGED = 'This application changed; here is its current state.'
const UNANSWERED = 'We couldn’t confirm whether this step was recorded. The application was reloaded: check its state '
  + 'before trying again.'
const INELIGIBLE = 'This applicant’s account can’t be verified: it is not active, or an application of it was refused '
  + 'for identity.'
const AUTHENTICATOR_RESET = 'The applicant’s authenticator was reset after step 1. Reject the application with ‘Other’; '
  + 'they can apply again.'

/** A value of a fixed map, never one inherited from Object.prototype. */
function own<T>(map: Readonly<Record<string, T>>, key: string | null | undefined): T | undefined {
  return key != null && Object.hasOwn(map, key) ? map[key] : undefined
}

const professionTitle = (code: string) => own(PROFESSION_TITLE, code) ?? label(code)
const regulatorTitle = (regulator: { code: string; name: string }) =>
  own<string>(REGULATOR_NAME, regulator.code) ?? `${regulator.name} (${regulator.code})`

function permissionLabel(code: string): string {
  const known = own(PERMISSION_LABELS, code)
  if (known) return known
  if (code.startsWith('ehr.') && code.endsWith('.read')) return 'read patient records with consent'
  if (code.startsWith('lab.')) return 'see laboratory work and released results'
  if (code.startsWith('pharmacy.')) return 'see pharmacy work and dispensing'
  if (code.startsWith('ocr.')) return 'digitise paper records'
  if (code.startsWith('outreach.')) return 'take part in outreach registration'
  return code
}

const DAY = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'UTC' })
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** A calendar date (`YYYY-MM-DD`, as the licence expiry is) without a time or a time-zone shift. */
function day(value: string | null | undefined) {
  if (!value || !ISO_DAY.test(value)) return date(value)
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? 'Not available' : DAY.format(parsed)
}

function shiftDay(value: string, years: number, days = 0): string {
  const [year, month, dayOfMonth] = value.split('-').map(Number)
  return new Date(Date.UTC(year! + years, month! - 1, dayOfMonth! + days)).toISOString().slice(0, 10)
}

const earlier = (left: string, right: string) => left < right ? left : right

/**
 * When step 1's verification may lapse: after today, no later than the end of
 * the licence's expiry date and within three years (the backend refuses
 * anything else); by default the earlier of the licence expiry and one year.
 */
function validityWindow(licenceValidUntil: string) {
  const today = lagosToday()
  if (!ISO_DAY.test(licenceValidUntil) || licenceValidUntil < today) return null
  return { today, latest: earlier(licenceValidUntil, shiftDay(today, 3, -1)), initial: earlier(licenceValidUntil, shiftDay(today, 1)) }
}

/** What a step's form still needs, said beside its disabled button and tied to it. */
function StillNeeded({ id, missing }: { id: string; missing: readonly string[] }) {
  return missing.length > 0 ? <p id={id} className="admin-note">Still needed: {missing.join(', ')}.</p> : null
}

const REASON_NEEDED = 'a reason (8 to 500 characters)'
const reasonMissing = (reason: string) => reason.trim().length < 8 || reason.trim().length > 500

function ClinicianStatus({ state }: { state: string }) {
  return <span className="admin-status" data-state={state}>{own(STATE_TITLE, state) ?? label(state)}</span>
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return <section className="admin-panel" aria-labelledby={id}><h2 id={id}>{title}</h2>{children}</section>
}

function ApplicationCard({ application, actor }: { application: ClinicianApplicationSummary; actor: AdminActor }) {
  const titleId = useId()
  const name = application.applicant.fullName
  const step1 = application.step1
  const mine = step1?.by.accountId === actor.accountId
  return <article className="admin-tile" aria-labelledby={titleId}>
    <div className="admin-panel-head"><h2 id={titleId}>{name}</h2><ClinicianStatus state={application.state} /></div>
    <dl className="admin-detail-grid">
      <div><dt>Email</dt><dd>{application.applicant.email}</dd></div>
      <div><dt>Profession</dt><dd>{professionTitle(application.profession)}<small>{regulatorTitle(application.regulator)}</small></dd></div>
      <div><dt>Licence</dt><dd>{application.licenceNumber}<small>Valid until {day(application.licenceValidUntil)}</small></dd></div>
      <div><dt>Facility</dt><dd>{application.facility.name}<small>{application.facility.organizationName}</small></dd></div>
      <div><dt>Applied</dt><dd>{date(application.submittedAt)}</dd></div>
      <div><dt>{OPEN_STATES.has(application.state) ? 'Closes if undecided' : 'Closing date'}</dt><dd>{date(application.expiresAt)}</dd></div>
      <div><dt>Authenticator</dt><dd>{application.authenticatorReady ? 'Set up' : 'Not set up'}</dd></div>
      <div><dt>Step 1 by</dt><dd>{step1 ? mine ? 'You' : step1.by.displayName ?? 'Another Super Admin' : 'Not yet'}
        {step1 ? <small>{date(step1.at)}</small> : null}</dd></div>
    </dl>
    {mine && application.state === 'under_review' && <p className="admin-note">Needs a different Super Admin</p>}
    <Link to={`/admin/clinicians/${encodeURIComponent(application.applicationId)}`}>Open {name}’s application</Link>
  </article>
}

/** A1: the queue by state, one page at a time with the backend's cursor for that state. */
export function ClinicianApplicationsPage({ actor }: { actor: AdminActor }) {
  const [filters, setFilters] = useUrlFilters(['state'] as const)
  const state = FILTERS.find(item => item.value === filters.state)?.value ?? 'open'
  const load = useCallback((signal?: AbortSignal) => adminApi.clinicianApplications(state, {}, signal), [state])
  const resource = useResource(load, 'Clinician applications could not be loaded.')
  const pages = useCursorPages(resource, (cursor, signal) => adminApi.clinicianApplications(state, { cursor }, signal),
    'More clinician applications could not be loaded.')

  return <Page eyebrow="People and access" title="Clinician applications"
    description="Doctors and nurses who applied by themselves. One Super Admin checks the licence, the person and their employment (step 1); a different Super Admin approves and gives access (step 2)."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <div className="admin-filter" role="group" aria-label="Application state">
      {FILTERS.map(item => <button key={item.value} type="button" aria-pressed={state === item.value}
        className={state === item.value ? 'admin-primary' : 'admin-secondary'}
        onClick={() => setFilters({ state: item.value === 'open' ? '' : item.value })}>{item.title}</button>)}
    </div>
    <p className="admin-note">{REVIEW_NOTE}</p>
    <ResourceView resource={resource} empty={result => result.items.length === 0}>{() => <div className="admin-stack">
      <p className="admin-result-count">Showing {pages.items.length} applications, {state === 'open' ? 'oldest first' : 'newest first'}
        {pages.hasMore ? '; more are available' : ''}</p>
      {pages.items.map(item => <ApplicationCard key={`${item.applicationId}:${item.version}`} application={item} actor={actor} />)}
      <LoadMore pages={pages} label="Load more applications" />
    </div>}</ResourceView>
  </Page>
}

/** A2: one application, linkable by its ID (never by a name, an email address or a licence number). */
export function ClinicianApplicationPage({ actor }: { actor: AdminActor }) {
  const { applicationId = '' } = useParams()
  if (!APPLICATION_ID.test(applicationId)) {
    return <Page eyebrow="Clinician application" title="Application not found" description="This link does not contain a valid application ID.">
      <p><Link to="/admin/clinicians">← All clinician applications</Link></p>
    </Page>
  }
  return <ApplicationReview key={applicationId} applicationId={applicationId} actor={actor} />
}

interface Outcome { text: string; alert?: boolean }

function ApplicationReview({ applicationId, actor }: { applicationId: string; actor: AdminActor }) {
  const load = useCallback((signal?: AbortSignal) => adminApi.clinicianApplication(applicationId, signal), [applicationId])
  const resource = useResource(load, 'This application could not be loaded.')
  const [notice, setNotice] = useState<Outcome | null>(null)
  const noticeRef = useRef<HTMLParagraphElement>(null)
  const { reload } = resource
  // In the commit that shows the outcome, not an effect a task later: a check made as soon as it is shown finds the
  // focus moved.
  useLayoutEffect(() => { if (notice) noticeRef.current?.focus() }, [notice])

  // Every outcome reloads the application: its state, version and the caller's hints come from the server.
  const outcome = (next: Outcome) => { setNotice(next); reload() }

  return <Page eyebrow="Clinician application" title={resource.data?.applicant.fullName ?? 'Clinician application'}
    description="Check the licence, the person and their employment before step 1. A different Super Admin approves in step 2."
    action={<Refresh onClick={reload} disabled={resource.loading} />}>
    <p><Link to="/admin/clinicians">← All clinician applications</Link></p>
    {notice && <p ref={noticeRef} tabIndex={-1} role={notice.alert ? 'alert' : 'status'}
      className={notice.alert ? 'admin-warning' : 'admin-success'}>{notice.text}</p>}
    <ResourceView resource={resource}>{application => <ApplicationDetail application={application} actor={actor}
      onOutcome={outcome} onStart={() => setNotice(null)} />}</ResourceView>
  </Page>
}

function warningsFor(application: ClinicianApplicationDetail): string[] {
  const flags = application.flags
  const warnings: string[] = []
  const accounts = flags?.sameLicenceKeyOtherAccounts ?? 0
  if (accounts > 0) warnings.push(`This licence number appears on ${accounts} other ${accounts === 1 ? 'account' : 'accounts'}.`)
  const open = flags?.sameLicenceKeyOtherOpenApplications ?? 0
  if (open > 0) warnings.push(`${open} other open ${open === 1 ? 'application uses' : 'applications use'} this licence.`)
  if (flags?.sameLicenceAttestedElsewhere) warnings.push('This licence is attested on another account.')
  if (flags?.orgAdminNameMatch) {
    warnings.push('The applicant’s name matches an administrator of this facility’s organisation: confirm employment '
      + 'especially carefully.')
  }
  if (flags?.orgAdminEmailDomainMatch) {
    warnings.push('The applicant’s email address has the same domain as a facility administrator’s. That doesn’t confirm '
      + 'employment.')
  }
  if (application.account.identityRejection) warnings.push('This account was refused for identity: it can’t be verified.')
  if (application.account.status !== 'active') {
    warnings.push(`This account is not active (${label(application.account.status).toLowerCase()}), so it can’t be given access.`)
  }
  if (application.authenticator.enrolledAfterRecovery) {
    warnings.push('The authenticator was set up after a password reset. Confirm the person especially carefully.')
  }
  if (application.facility.lifecycleStatus !== 'verified' || !application.facility.active) {
    warnings.push('This facility isn’t verified and active, so it can’t take clinicians now.')
  }
  return warnings
}

function authenticatorStatus(application: ClinicianApplicationDetail): ReactNode {
  const factor = application.authenticator
  if (!factor.enrolled) return 'Not set up: step 1 is unavailable'
  if (factor.enrolledAfterRecovery) return <>Set up after a password reset<small>{date(factor.activatedAt)}</small></>
  return `Set up on ${date(factor.activatedAt)}`
}

function ApplicationDetail({ application, actor, onOutcome, onStart }: {
  application: ClinicianApplicationDetail; actor: AdminActor; onOutcome: (outcome: Outcome) => void; onStart: () => void
}) {
  const warnings = warningsFor(application)
  const { attestation, approval, decision, facility } = application
  const who = (accountId: string | null | undefined, name?: string | null) =>
    accountId && accountId === actor.accountId ? 'You' : name ?? 'Another Super Admin'
  const decisionTitle = DECISIONS.find(item => item.value === decision?.code)
  const panel = { application, actor, onOutcome, onStart }

  return <div className="admin-stack">
    <Section title="Application">
      <p><ClinicianStatus state={application.state} /></p>
      <dl className="admin-detail-grid">
        <div><dt>Email</dt><dd>{application.applicant.email}</dd></div>
        <div><dt>Profession</dt><dd>{professionTitle(application.profession)}</dd></div>
        <div><dt>Regulator</dt><dd>{regulatorTitle(application.regulator)}</dd></div>
        <div><dt>Licence or registration number</dt><dd>{application.licenceNumber}</dd></div>
        <div><dt>Licence valid until</dt><dd>{day(application.licenceValidUntil)}</dd></div>
        <div><dt>Facility</dt><dd>{facility.name}<small>{facility.organizationName}</small></dd></div>
        <div><dt>Applied</dt><dd>{date(application.submittedAt)}</dd></div>
        <div><dt>{OPEN_STATES.has(application.state) ? 'Closes if undecided' : 'Closing date'}</dt>
          <dd>{date(application.expiresAt)}</dd></div>
        {application.state === 'approved' && <div><dt>Access</dt>
          <dd>{own(ACCESS_TITLE, application.accessState) ?? 'Not reported'}</dd></div>}
      </dl>
    </Section>

    {warnings.length > 0 && <Section title="Warnings">
      <div className="admin-stack">{warnings.map(text => <p key={text} className="admin-warning">{text}</p>)}</div>
    </Section>}

    <Section title="Account">
      <dl className="admin-detail-grid">
        <div><dt>Account status</dt><dd>{label(application.account.status)}</dd></div>
        <div><dt>Created</dt><dd>{date(application.account.createdAt)}</dd></div>
        <div><dt>Email confirmed</dt><dd>{date(application.account.emailVerifiedAt)}</dd></div>
        <div><dt>Patient record on this account</dt><dd>{application.account.patientAccount ? 'Yes' : 'No'}</dd></div>
        <div><dt>Staff record</dt><dd>{application.staff ? label(application.staff.verificationStatus) : 'None yet'}</dd></div>
        <div><dt>Authenticator</dt><dd>{authenticatorStatus(application)}</dd></div>
        <div><dt>Other facilities</dt><dd>{application.otherMemberships.length === 0 ? 'None'
          : <ul className="admin-plain-list">{application.otherMemberships.map((membership, index) =>
            <li key={`${membership.facilityName}:${index}`}>{`${membership.facilityName}: ${label(membership.state)}`
              + (membership.roles.length ? ` (${membership.roles.map(label).join(', ')})` : '')}</li>)}</ul>}</dd></div>
      </dl>
    </Section>

    <Section title="Facility">
      <dl className="admin-detail-grid">
        <div><dt>Facility</dt><dd>{facility.name}</dd></div>
        <div><dt>Organisation</dt><dd>{facility.organizationName}</dd></div>
        <div><dt>Status</dt><dd>{label(facility.lifecycleStatus)}{facility.active ? '' : ', inactive'}</dd></div>
        <div><dt>CAC registration</dt><dd>{facility.cacHint ?? 'Not recorded'}
          {facility.cacHint ? <small>Use it to look up the facility’s public phone number.</small> : null}</dd></div>
      </dl>
      <h3>Facility administrators (not sufficient alone to confirm employment)</h3>
      {facility.orgAdmins.length === 0 ? <p className="admin-note">No active administrator is recorded.</p>
        : <ul className="admin-plain-list">{facility.orgAdmins.map(admin => <li key={admin.email}>
          <strong>{admin.displayName ?? 'Name not recorded'}</strong> <span>{admin.email}</span></li>)}</ul>}
    </Section>

    {attestation && <Section title="Step 1 record">
      <dl className="admin-detail-grid">
        <div><dt>Recorded by</dt><dd>{who(attestation.reviewerAccountId, attestation.reviewerName)}</dd></div>
        <div><dt>Recorded</dt><dd>{date(attestation.recordedAt)}</dd></div>
        <div><dt>Applicant’s code confirmed</dt><dd>{date(attestation.factorConfirmedAt)}</dd></div>
        <div><dt>Verification valid until</dt><dd>{date(attestation.validUntil)}</dd></div>
        <div><dt>Identity confirmed by</dt><dd>{IDENTITY_METHODS.find(item =>
          item.value === attestation.checklist?.identityMethod)?.title ?? 'Not recorded'}</dd></div>
        <div><dt>Employment confirmed through</dt><dd>{EMPLOYMENT_CHANNELS.find(item =>
          item.value === attestation.checklist?.employmentChannel)?.title ?? 'Not recorded'}</dd></div>
        <div><dt>Evidence reference</dt><dd>{attestation.evidenceReference}</dd></div>
        <div><dt>Reason</dt><dd>{attestation.reason}</dd></div>
      </dl>
    </Section>}

    {approval && <Section title="Approval">
      <dl className="admin-detail-grid">
        <div><dt>Approved by</dt><dd>{who(approval.by)}</dd></div>
        <div><dt>Approved</dt><dd>{date(approval.at)}</dd></div>
      </dl>
    </Section>}

    {decision && <Section title="Decision">
      <dl className="admin-detail-grid">
        {decision.code && <div><dt>Reason shown to the applicant</dt><dd>{decisionTitle?.title ?? label(decision.code)}
          {decisionTitle ? <small>{decisionCopy(decisionTitle.value, application)}</small> : null}</dd></div>}
        {decision.reason && <div><dt>Internal reason (never shown to the applicant)</dt><dd>{decision.reason}</dd></div>}
        {decision.by && <div><dt>Decided by</dt><dd>{who(decision.by)}</dd></div>}
        <div><dt>Decided</dt><dd>{date(decision.at)}</dd></div>
      </dl>
    </Section>}

    {(application.state === 'submitted' || application.state === 'awaiting_authenticator') && <AttestPanel
      key={`attest:${application.version}`} {...panel} />}
    {application.state === 'under_review' && <ApprovePanel key={`approve:${application.version}`} {...panel} />}
    {OPEN_STATES.has(application.state) && <RejectPanel key={`reject:${application.version}`} {...panel} />}
  </div>
}

interface PanelProps {
  application: ClinicianApplicationDetail; actor: AdminActor; onOutcome: (outcome: Outcome) => void; onStart: () => void
}

type Submitted<T> = { done: true; value: T } | { done: false; code: string | null }

/**
 * An answer that may never have reached the server, or whose outcome the server did not say: no answer, an outage, or
 * this side giving up after its time budget (@hid/http's 408 REQUEST_TIMEOUT), which leaves the server running it.
 */
const unanswered = (error: unknown) => !isHidApiError(error) || error.status === 0 || error.status === 408 || error.status >= 500

/**
 * useGovernedSubmit (one key per submission, the step-up repeating that same
 * submission), plus what the review needs from a refusal: its code, so a panel
 * can clear a refused field, and the two outcomes the page states itself. An
 * application that changed (VERSION_CONFLICT, or no longer at this step) is
 * reloaded; an unanswered command is reloaded too and said to be unconfirmed,
 * since it may have been carried out.
 */
function useReviewCommand(onOutcome: (outcome: Outcome) => void) {
  const governed = useGovernedSubmit()

  async function submit<T>(command: (idempotencyKey: string) => Promise<T>, fallback: string,
    context?: Readonly<Record<string, string>>): Promise<Submitted<T>> {
    const attempt: { failed: unknown } = { failed: null }
    const value = await governed.submit(async idempotencyKey => {
      attempt.failed = null
      try { return await command(idempotencyKey) } catch (caught) { attempt.failed = caught; throw caught }
    }, fallback, context)
    if (value !== null) return { done: true, value }
    const code = problemCode(attempt.failed)
    if (code === 'VERSION_CONFLICT' || code === 'CLINICIAN_APPLICATION_STATE_INVALID') {
      governed.setError(null)
      onOutcome({ text: CHANGED })
    } else if (attempt.failed !== null && unanswered(attempt.failed)) {
      governed.setError(null)
      const reference = isHidApiError(attempt.failed) ? attempt.failed.requestId : undefined
      onOutcome({ text: reference ? `${UNANSWERED} Reference: ${reference}` : UNANSWERED, alert: true })
    }
    return { done: false, code }
  }

  return { submit, busy: governed.busy, error: governed.error }
}

const ATTEST_REFUSAL: Readonly<Record<string, string>> = {
  SELF: 'This is your own application.',
  WORKS_AT_FACILITY: 'You work at this facility, so another Super Admin must verify it.',
  AUTHENTICATOR_REQUIRED: 'The applicant hasn’t set up their authenticator.',
  ACCOUNT_INELIGIBLE: INELIGIBLE,
}

const NOT_CHECKED = 'Nothing was recorded, and the applicant’s code wasn’t checked'

/**
 * Step 1's refusals that Identity answers before it checks the applicant's
 * code (hid-system 9e981e4: the request's own fields, the key, the applicant
 * account and staff record), so such a call never counts against the
 * applicant: the code is kept for a submission made at once. The version,
 * state, identity refusal, facility, insider and self were already checked
 * first, and keep their console-wide words.
 */
const ATTEST_PRECHECK: Readonly<Record<string, string>> = {
  CLINICIAN_APPLICATION_COMMAND_INVALID: `${NOT_CHECKED}. The server refused step 1 as incomplete: tick every check, choose `
    + 'how identity and employment were confirmed, and give an evidence reference, a reason of 8 to 500 characters, and a '
    + 'verification date after today, within three years and no later than the licence expiry.',
  IDEMPOTENCY_CONFLICT: `${NOT_CHECKED}: this submission’s key was already used for another verification. Record step 1 `
    + 'again; it is sent as a new submission.',
  WORKFORCE_ACCOUNT_INELIGIBLE: `${NOT_CHECKED}: the applicant’s account is disabled, locked or not active, or has no active `
    + 'staff record, so step 1 can’t be recorded for it. If it stays so, reject the application with ‘Other’.',
  WORKFORCE_STAFF_INELIGIBLE: `${NOT_CHECKED}: the applicant’s staff record can’t be verified in its current state. If it `
    + 'stays so, reject the application with ‘Other’.',
  WORKFORCE_STAFF_NOT_FOUND: `${NOT_CHECKED}: the applicant has no staff record. Reject the application with ‘Other’.`,
}

/** A3, step 1. Shown while the application waits for step 1; the form only when the server's hint allows it. */
function AttestPanel(props: PanelProps) {
  const { application } = props
  const hint = application.callerHints?.attest
  let body: ReactNode
  if (application.state === 'awaiting_authenticator') {
    body = <p className="admin-note">The applicant hasn’t set up their authenticator yet. Step 1 opens when they have.</p>
  } else if (!hint?.allowed) {
    body = <p className="admin-note">{own(ATTEST_REFUSAL, hint?.reason)
      ?? 'You can’t record step 1 for this application now. Refresh it to see why.'}</p>
  } else {
    const validity = validityWindow(application.licenceValidUntil)
    body = validity ? <AttestForm {...props} validity={validity} />
      : <p className="admin-note">The licence expired on {day(application.licenceValidUntil)}. Reject the application with
        ‘Licence not current’.</p>
  }
  return <Section title="Step 1 of 2: verify the licence and the person">{body}</Section>
}

function AttestForm({ application, onOutcome, onStart, validity }: PanelProps & {
  validity: { today: string; latest: string; initial: string }
}) {
  const [registerChecked, setRegisterChecked] = useState(false)
  const [currentUntilRecorded, setCurrentUntilRecorded] = useState(false)
  const [identityMethod, setIdentityMethod] = useState<IdentityMethod | ''>('')
  const [identityConfirmed, setIdentityConfirmed] = useState(false)
  const [code, setCode] = useState('')
  const [employmentChannel, setEmploymentChannel] = useState<EmploymentChannel | ''>('')
  const [employmentConfirmed, setEmploymentConfirmed] = useState(false)
  const [evidence, setEvidence] = useState('')
  const [validUntil, setValidUntil] = useState(validity.initial)
  const [reason, setReason] = useState('')
  const codeRef = useRef<HTMLInputElement>(null)
  const command = useReviewCommand(onOutcome)
  const ids = { code: useId(), employment: useId(), evidence: useId(), validity: useId(), needed: useId() }
  const regulator = regulatorTitle(application.regulator)

  const missing = [
    !(registerChecked && currentUntilRecorded) && 'both licence checks',
    !identityMethod && 'how identity was confirmed',
    !identityConfirmed && 'the identity confirmation',
    !isSixDigitCode(code) && 'the applicant’s 6-digit code',
    !employmentChannel && 'how employment was confirmed',
    !employmentConfirmed && 'the employment confirmation',
    (evidence.trim().length < 8 || evidence.trim().length > 500) && 'an evidence reference (8 to 500 characters)',
    !(ISO_DAY.test(validUntil) && validUntil >= validity.today && validUntil <= validity.latest) && 'a verification date in range',
    reasonMissing(reason) && REASON_NEEDED,
  ].filter((item): item is string => Boolean(item))
  const ready = missing.length === 0 && Boolean(identityMethod) && Boolean(employmentChannel)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready || command.busy || !identityMethod || !employmentChannel) return
    onStart()
    const input = {
      // The end of the chosen day in Lagos (UTC+1 all year), which the backend caps at the licence's expiry date.
      validUntil: `${validUntil}T23:59:59+01:00`,
      evidenceReference: evidence.trim(),
      checklist: { registerChecked: true, licenceCurrentUntilRecorded: true, identityMethod, identityConfirmed: true,
        employmentChannel, employmentConfirmed: true } satisfies ClinicianAttestationChecklist,
      authenticatorCode: code,
      reason: reason.trim(),
    }
    const result = await command.submit(key => adminApi.attestClinicianApplication(application, input, key),
      'Step 1 could not be recorded. Try again.', ATTEST_PRECHECK)
    if (result.done) {
      onOutcome({ text: result.value.replayed
        ? 'Step 1 was already recorded with this submission. A different Super Admin must now approve it.'
        : 'Step 1 recorded. A different Super Admin must now approve it.' })
    } else if (result.code === 'CLINICIAN_APPLICATION_AUTHENTICATOR_CODE_INVALID'
      || result.code === 'CLINICIAN_APPLICATION_AUTHENTICATOR_RATE_LIMITED') {
      // A code is good once: only it is cleared, ready for the next one the applicant reads out.
      setCode('')
      codeRef.current?.focus()
    }
  }

  return <form className="admin-action-form admin-review-form" aria-busy={command.busy} onSubmit={event => void submit(event)}>
    <p className="admin-note">Record step 1 only after you have checked the register, spoken to the applicant by video call
      or in person with their photo ID, and confirmed their employment through the facility itself. {REVIEW_NOTE}</p>
    <fieldset>
      <legend>Licence</legend>
      <label className="admin-checkbox"><input type="checkbox" checked={registerChecked}
        onChange={event => setRegisterChecked(event.target.checked)} />I checked the licence on the {regulator} register and it is current</label>
      <label className="admin-checkbox"><input type="checkbox" checked={currentUntilRecorded}
        onChange={event => setCurrentUntilRecorded(event.target.checked)} />The register shows it valid at least until the date below</label>
    </fieldset>
    <fieldset>
      <legend>Identity</legend>
      {IDENTITY_METHODS.map(method => <label key={method.value} className="admin-checkbox"><input type="radio"
        name={`identity-${application.applicationId}`} value={method.value} checked={identityMethod === method.value}
        onChange={() => setIdentityMethod(method.value)} />{method.title}</label>)}
      <label className="admin-checkbox"><input type="checkbox" checked={identityConfirmed}
        onChange={event => setIdentityConfirmed(event.target.checked)} />The photo ID matches the name on the licence and the person I spoke to</label>
      <label>Applicant’s authenticator code<input ref={codeRef} value={code} inputMode="numeric" autoComplete="off"
        pattern="[0-9]{6}" aria-describedby={ids.code} onChange={event => setCode(sixDigitCode(event.target.value))} /></label>
      <p id={ids.code} className="admin-hint">Ask the applicant to read the current code from their authenticator app during
        your call. Codes change every 30 seconds. If you are asked to confirm with your own authenticator first, ask for a
        new code if theirs is refused.</p>
    </fieldset>
    <fieldset aria-describedby={ids.employment}>
      <legend>Employment</legend>
      {EMPLOYMENT_CHANNELS.map(channel => <label key={channel.value} className="admin-checkbox"><input type="radio"
        name={`employment-${application.applicationId}`} value={channel.value} checked={employmentChannel === channel.value}
        onChange={() => setEmploymentChannel(channel.value)} />{`${channel.title}${channel.detail}`}</label>)}
      <label className="admin-checkbox"><input type="checkbox" checked={employmentConfirmed}
        onChange={event => setEmploymentConfirmed(event.target.checked)} />The facility confirmed the applicant works there</label>
      <p id={ids.employment} className="admin-hint">The facility administrator’s own contact is not enough: use the facility’s
        public phone number or visit it.</p>
    </fieldset>
    <label>Evidence reference<input value={evidence} maxLength={500} aria-describedby={ids.evidence}
      onChange={event => setEvidence(event.target.value)} /></label>
    <p id={ids.evidence} className="admin-hint">Where your evidence is kept, for example ticket HID-VER-1234. Never paste
      documents or personal details.</p>
    <label>Verification valid until<input type="date" value={validUntil} min={validity.today} max={validity.latest}
      aria-describedby={ids.validity} onChange={event => setValidUntil(event.target.value)} /></label>
    <p id={ids.validity} className="admin-hint">No later than the licence expiry ({day(application.licenceValidUntil)}) and
      within three years; the server refuses anything later.</p>
    <label>Reason<textarea rows={2} minLength={8} maxLength={500} value={reason}
      onChange={event => setReason(event.target.value)} /></label>
    <StillNeeded id={ids.needed} missing={missing} />
    <button type="submit" className="admin-primary" disabled={!ready || command.busy}
      aria-describedby={missing.length > 0 ? ids.needed : undefined}>
      {command.busy ? 'Recording…' : 'Record verification (step 1)'}</button>
    {command.error && <p role="alert" className="admin-error">{command.error}</p>}
  </form>
}

const APPROVE_REFUSAL: Readonly<Record<string, string>> = {
  SELF: 'This is your own application.',
  WORKS_AT_FACILITY: 'You work at this facility, so another Super Admin must approve it.',
  AUTHENTICATOR_REQUIRED: AUTHENTICATOR_RESET,
  ACCOUNT_INELIGIBLE: `${INELIGIBLE} Reject the application.`,
}

/** A4, step 2. Never offered to the administrator who recorded step 1, whatever a hint says. */
function ApprovePanel(props: PanelProps) {
  const { application, actor } = props
  const hint = application.callerHints?.approve
  const stepOneByYou = application.attestation?.reviewerAccountId === actor.accountId || hint?.reason === 'STEP1_BY_YOU'
  let body: ReactNode
  if (stepOneByYou) body = <p className="admin-note">You verified this application. A different Super Admin must approve it.</p>
  else if (!hint?.allowed) {
    body = <p className="admin-note">{own(APPROVE_REFUSAL, hint?.reason)
      ?? 'You can’t approve this application now. Refresh it to see why.'}</p>
  } else body = <ApproveForm {...props} />
  return <Section title="Step 2 of 2: approve and give access">{body}</Section>
}

function ApproveForm({ application, onOutcome, onStart }: PanelProps) {
  const [reason, setReason] = useState('')
  const command = useReviewCommand(onOutcome)
  const name = application.applicant.fullName
  const can = [...new Set(application.rolePermissions.map(permissionLabel))]
  const missing = reasonMissing(reason) ? [REASON_NEEDED] : []
  const ready = missing.length === 0
  const neededId = useId()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready || command.busy) return
    onStart()
    const result = await command.submit(key => adminApi.approveClinicianApplication(application, reason.trim(), key),
      'The application could not be approved. Try again.')
    if (result.done) {
      onOutcome({ text: result.value.replayed
        ? `This application was already approved with this submission. ${name} can sign in to the provider portal with `
          + 'their password and authenticator.'
        : `Approved. ${name} can now sign in to the provider portal with their password and authenticator.` })
    }
  }

  return <form className="admin-action-form admin-review-form" aria-busy={command.busy} onSubmit={event => void submit(event)}>
    <p>Grants {professionTitle(application.profession)} at {application.facility.name} to {name}.</p>
    {can.length === 0 ? <p className="admin-note">The server lists no permissions for this role.</p> : <>
      <p>This role can:</p>
      <ul className="admin-plain-list" aria-label="This role can">{can.map(item => <li key={item}>{item}</li>)}</ul>
    </>}
    <p className="admin-note">Approving attaches the account to the facility and grants the role step 1 verified, in one
      step. {REVIEW_NOTE}</p>
    <label>Reason for approval<textarea rows={2} minLength={8} maxLength={500} value={reason}
      onChange={event => setReason(event.target.value)} /></label>
    <StillNeeded id={neededId} missing={missing} />
    <button type="submit" className="admin-primary" disabled={!ready || command.busy}
      aria-describedby={missing.length > 0 ? neededId : undefined}>
      {command.busy ? 'Approving…' : 'Approve and give access'}</button>
    {command.error && <p role="alert" className="admin-error">{command.error}</p>}
  </form>
}

const REJECT_REFUSAL: Readonly<Record<string, string>> = {
  SELF: 'This is your own application.',
  WORKS_AT_FACILITY: 'You work at this facility, so another Super Admin must decide it.',
}

/** A5, for any open application the caller is not an insider of. */
function RejectPanel(props: PanelProps) {
  const hint = props.application.callerHints?.reject
  return <Section title="Reject this application">{hint?.allowed ? <RejectForm {...props} />
    : <p className="admin-note">{own(REJECT_REFUSAL, hint?.reason)
      ?? 'You can’t reject this application now. Refresh it to see why.'}</p>}</Section>
}

function RejectForm({ application, onOutcome, onStart }: PanelProps) {
  const [decision, setDecision] = useState<ClinicianDecisionCode | ''>('')
  const [reason, setReason] = useState('')
  const command = useReviewCommand(onOutcome)
  const missing = [
    decision === '' && 'the reason shown to the applicant',
    reasonMissing(reason) && 'an internal reason (8 to 500 characters)',
  ].filter((item): item is string => Boolean(item))
  const ready = missing.length === 0
  const neededId = useId()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready || command.busy || !decision) return
    onStart()
    const result = await command.submit(key => adminApi.rejectClinicianApplication(application, decision, reason.trim(), key),
      'The application could not be rejected. Try again.')
    if (result.done) {
      const recorded = DECISIONS.find(item => item.value === result.value.decisionCode)?.value ?? decision
      const seen = decisionCopy(recorded, application)
      onOutcome({ text: result.value.replayed
        ? `This application was already rejected with this submission. The applicant sees: ‘${seen}’`
        : `Rejected. The applicant sees: ‘${seen}’` })
    }
  }

  return <form className="admin-action-form admin-review-form" aria-busy={command.busy} onSubmit={event => void submit(event)}>
    <label>Reason shown to the applicant<select value={decision} required
      onChange={event => setDecision(DECISIONS.find(item => item.value === event.target.value)?.value ?? '')}>
      <option value="">Choose a reason</option>
      {DECISIONS.map(item => <option key={item.value} value={item.value}>
        {`${item.title}: “${decisionCopy(item.value, application)}”`}</option>)}
    </select></label>
    {decision === 'identity_not_confirmed' && <p className="admin-warning">This account won’t be able to apply again. To
      also stop it signing in anywhere, lock it in <Link to="/admin/principals">Users & roles</Link>.</p>}
    <label>Internal reason (never shown to the applicant)<textarea rows={2} minLength={8} maxLength={500} value={reason}
      onChange={event => setReason(event.target.value)} /></label>
    <p className="admin-note">Rejecting changes nothing else: no role, membership or licence check is touched. {REVIEW_NOTE}</p>
    <StillNeeded id={neededId} missing={missing} />
    <button type="submit" className="admin-secondary" disabled={!ready || command.busy}
      aria-describedby={missing.length > 0 ? neededId : undefined}>
      {command.busy ? 'Rejecting…' : 'Reject application'}</button>
    {command.error && <p role="alert" className="admin-error">{command.error}</p>}
  </form>
}
