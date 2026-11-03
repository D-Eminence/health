import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { EhrButton, EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import { useStaff } from '../../../staff/App'
import { pageAllowed } from '../../frame/pageAccess'
import { useBluePages, useOpenPages } from '../../frame/pageContext'
import { pageHrefOf } from '../../frame/pageHref'
import { modulePath } from '../../frame/sample/paths'
import { DeptNotice } from '../parts/DeptNotice'
import { dateText } from '../parts/format'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { DeptActions, DeptContextLine, DeptFacts, DeptRecordLayout, type DeptFact } from '../parts/DeptRecord'
import { FIELD, type CaseLoading, type ReviewAction, type ShownError, type VisitCase } from './registrationModel'
import { ErrorBox, UnavailableAction, type FormProblems } from './registrationParts'
import {
  APPROVE, APPROVE_REASON_LABEL, BACK_TO_LIST, CANDIDATE_LABEL, candidateLine, candidateOption, CANDIDATES_UNAVAILABLE, candidatesText,
  caseTitle, caseWhen, COMPLETED, CORRECT_DEMOGRAPHICS, EMAIL_LABEL, ENROLL, ENROLL_REASON_LABEL, ENROLL_TEXT, ENROLL_TITLE, enrolledText,
  ENROLLING, LINK, LINK_REASON_LABEL, LOADING, NEXT_STEPS, NO_ACTIONS, NO_CANDIDATE_NOTICE, NO_CORRECTION, REFRESH_CASE, REVIEW_NOTICE,
  MORE_DETAILS, OPEN_IN_PATIENTS, REFERENCE_HINT, REFERENCE_LABEL, SAVED_RECORD, SAVING, SELECT_CANDIDATE, statusLabel,
} from './registrationText'

type OpenForm = ReviewAction | 'enroll'

/**
 * The design's next steps from a patient's record (workflows.tsx 589-603), in its words. Each is offered only where it
 * leads to a live page this session may open; none carries anything of the case with it.
 */
const NEXT: ReadonlyArray<{ readonly module: string; readonly label: string }> = [
  { module: 'appointments', label: 'Open appointments' },
  { module: 'journey', label: 'Register walk-in visit' },
  { module: 'consent', label: 'Open consent' },
]

function useNextSteps() {
  const { state } = useStaff()
  const session = state.status === 'ready' ? state.session : null
  const pages = useBluePages()
  return NEXT.flatMap(step => {
    const href = modulePath(step.module)
    const page = pages.find(candidate => pageHrefOf(candidate) === href)
    return page && page.status !== 'sample' && pageAllowed(page, session) ? [{ ...step, href }] : []
  })
}

/**
 * Where Patients opens for this session in this product (its permission held, and the product's site opening it), or
 * null. Classic registration's hand-off (staff/routes/Registration.tsx 265-267) goes there with the Health ID.
 */
function usePatientsHref(): string | null {
  const { state } = useStaff()
  const session = state.status === 'ready' ? state.session : null
  const pages = useOpenPages()
  const href = modulePath('patients')
  const page = pages.find(candidate => pageHrefOf(candidate) === href)
  return page && page.status !== 'sample' && pageAllowed(page, session) ? href : null
}

/**
 * One registration case as the design's saved record (04-patient-created): its status line, "Saved record" with what
 * today's case card shows (Registration.tsx 248-258), and "Available actions" with today's decisions and account
 * enrollment, each as the design's inline action form with today's fields and words.
 */
export function RegistrationRecord({ visit, canApprove, busy, caseLoading, message, error, reviewProblems, enrollProblems, onBack, onRefresh, onReview, onEnroll }: {
  readonly visit: VisitCase
  readonly canApprove: boolean
  readonly busy: boolean
  /** The case read running, if any: a find asked from the list before this case was opened, or this case's refresh. */
  readonly caseLoading: CaseLoading
  /** What the last step said, shown here too (the page's status region says it once). */
  readonly message: string
  readonly error: ShownError | null
  readonly reviewProblems: FormProblems
  readonly enrollProblems: FormProblems
  readonly onBack: () => void
  readonly onRefresh: () => void
  readonly onReview: (event: FormEvent<HTMLFormElement>, action: ReviewAction) => void
  readonly onEnroll: (event: FormEvent<HTMLFormElement>) => void
}) {
  const registration = visit.item
  const { enrollment } = visit
  const [open, setOpen] = useState<OpenForm | null>(null)
  const next = useNextSteps()
  const patientsHref = usePatientsHref()
  // The patient's Health ID once the case has one, or the account just made gives one.
  const hid = enrollment?.hid ?? registration.patient?.hid ?? null
  const findPatient = hid && patientsHref ? hid : null
  const nextHere = registration.patient ? next : []
  const completed = COMPLETED.has(registration.status)
  const candidates = registration.candidates ?? []
  // Registration.tsx 253, 255, 256: who may decide, and what this state of the case allows.
  const offered: Record<OpenForm, boolean> = {
    link: canApprove && registration.status === 'review_required' && candidates.length > 0,
    approve: canApprove && registration.status === 'pending_new_identity_approval',
    enroll: canApprove && completed && !enrollment,
  }
  const shownForm = open && offered[open] ? open : null
  // A refusal is said in the form that sent it while that form is open, and otherwise at the top of the record.
  const errorHere = error && error.at !== 'find' && error.at !== 'resolve' && error.at !== shownForm ? error.text : ''
  const errorIn = (form: OpenForm) => (error?.at === form ? error.text : '')
  const refreshing = caseLoading === 'refresh'
  // Back is unavailable while a step or this case's refresh runs, so its answer is not lost.
  const unavailable = busy || refreshing

  const facts: DeptFact[] = [
    { label: 'Status', value: statusLabel(registration.status) },
    { label: visit.started ? 'Started' : 'Reopened', value: dateText(visit.at) },
    { label: 'Possible matches', value: candidatesText(registration) },
    ...(registration.patient ? [{ label: 'Health ID', value: registration.patient.hid }] : []),
  ]

  const toggle = (form: OpenForm, label: string) => (
    // Unavailable, not closed, while a step runs: closing would take away the button the user is on.
    <EhrButton variant="secondary" className="hid-ehr-dept-registration-unavailable" aria-expanded={shownForm === form}
      aria-controls={shownForm === form ? `registration-${form}-form` : undefined} aria-disabled={busy || undefined}
      onClick={() => { if (!busy) setOpen(current => (current === form ? null : form)) }}>{label}</EhrButton>
  )

  return (
    <DeptPage title={caseTitle(visit.name)} className="hid-ehr-dept-registration-page"
      secondaryActions={(
        // Today's "Refresh current case" (Registration.tsx 244): unavailable while it reads, keeping its focus.
        <EhrButton variant="secondary" busy={refreshing} className="hid-ehr-dept-registration-unavailable"
          aria-disabled={busy || caseLoading !== null || undefined} onClick={onRefresh}>{refreshing ? LOADING : REFRESH_CASE}</EhrButton>
      )}
      primaryAction={(
        // Unavailable while a step runs, so its answer is not lost.
        <EhrButton variant="secondary" className="hid-ehr-dept-registration-unavailable" aria-disabled={unavailable || undefined}
          onClick={() => { if (!unavailable) onBack() }}>{BACK_TO_LIST}</EhrButton>
      )}>
      <DeptContextLine status={statusLabel(registration.status)} tone={completed ? 'positive' : 'brand'}
        items={[caseWhen(visit.started, visit.at), registration.patient ? `Health ID ${registration.patient.hid}` : null]} />
      {message ? <DeptNotice tone="positive">{message}</DeptNotice> : null}
      <ErrorBox message={errorHere} />
      {registration.status === 'review_required' ? <DeptNotice tone="caution">{REVIEW_NOTICE}</DeptNotice> : null}
      {registration.status === 'pending_new_identity_approval' ? <DeptNotice>{NO_CANDIDATE_NOTICE}</DeptNotice> : null}
      {enrollment ? <DeptNotice tone="positive">{enrolledText(enrollment.hid)}</DeptNotice> : null}
      <DeptRecordLayout
        main={(
          <DeptSection title={SAVED_RECORD}>
            <DeptFacts facts={facts} />
            {registration.status === 'review_required' ? (
              candidates.length ? (
                <ul className="hid-ehr-dept-rows hid-ehr-dept-registration-candidates">
                  {candidates.map(candidate => (
                    <li key={candidate.patientId}>
                      <div className="hid-ehr-dept-row-main">
                        <strong className="hid-ehr-dept-row-title">{candidate.fullName}</strong>
                        <span className="hid-ehr-dept-muted">{candidateLine(candidate.dateOfBirth)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="hid-ehr-dept-registration-error">{CANDIDATES_UNAVAILABLE}</p>
            ) : null}
            {/* The case's reference, out of the way: Health ID keeps no list of registrations, so it is how this one is
                reopened on a later visit ("Find registration case"). */}
            <details className="hid-ehr-dept-registration-more">
              <summary>{MORE_DETAILS}</summary>
              <DeptFacts facts={[{ label: REFERENCE_LABEL, value: registration.caseId }]} />
              <p className="hid-ehr-dept-muted">{REFERENCE_HINT}</p>
            </details>
          </DeptSection>
        )}
        aside={(
          <DeptActions>
            {/* The design's Available actions: its action buttons, then the form of the one chosen under them all, then
                its line when no action is open to this permission and record state, then Next steps. */}
            {offered.link ? toggle('link', LINK) : null}
            {offered.approve ? toggle('approve', APPROVE) : null}
            {offered.enroll ? toggle('enroll', ENROLL_TITLE) : null}
            <UnavailableAction label={CORRECT_DEMOGRAPHICS} reason={NO_CORRECTION} wide />
            {shownForm === 'link' ? (
              <form id="registration-link-form" className="hid-ehr-dept-action-form" noValidate aria-label={LINK}
                onSubmit={event => onReview(event, 'link')}>
                <EhrField label={CANDIDATE_LABEL} controlId={FIELD.candidate} error={reviewProblems.error(FIELD.candidate)}>
                  <EhrSelect name="patientId" required>
                    <option value="">{SELECT_CANDIDATE}</option>
                    {candidates.map(candidate => (
                      <option value={candidate.patientId} key={candidate.patientId}>{candidateOption(candidate.fullName, candidate.dateOfBirth)}</option>
                    ))}
                  </EhrSelect>
                </EhrField>
                <EhrField label={LINK_REASON_LABEL} controlId={FIELD.linkReason} error={reviewProblems.error(FIELD.linkReason)}>
                  <EhrTextarea name="reason" rows={3} minLength={8} maxLength={500} required />
                </EhrField>
                <ErrorBox message={errorIn('link')} />
                <EhrButton type="submit" busy={busy}>{busy ? SAVING : LINK}</EhrButton>
              </form>
            ) : null}
            {shownForm === 'approve' ? (
              <form id="registration-approve-form" className="hid-ehr-dept-action-form" noValidate aria-label={APPROVE}
                onSubmit={event => onReview(event, 'approve')}>
                <EhrField label={APPROVE_REASON_LABEL} controlId={FIELD.approveReason} error={reviewProblems.error(FIELD.approveReason)}>
                  <EhrTextarea name="reason" rows={3} minLength={8} maxLength={500} required />
                </EhrField>
                <ErrorBox message={errorIn('approve')} />
                <EhrButton type="submit" busy={busy}>{busy ? SAVING : APPROVE}</EhrButton>
              </form>
            ) : null}
            {shownForm === 'enroll' ? (
              <form id="registration-enroll-form" className="hid-ehr-dept-action-form" noValidate aria-label={ENROLL_TITLE} onSubmit={onEnroll}>
                <p className="hid-ehr-dept-muted">{ENROLL_TEXT}</p>
                <EhrField label={EMAIL_LABEL} controlId={FIELD.email} error={enrollProblems.error(FIELD.email)}>
                  <EhrInput name="email" type="email" maxLength={254} autoComplete="off" required />
                </EhrField>
                <EhrField label={ENROLL_REASON_LABEL} controlId={FIELD.enrollReason} error={enrollProblems.error(FIELD.enrollReason)}>
                  <EhrTextarea name="reason" rows={3} minLength={8} maxLength={500} required />
                </EhrField>
                <ErrorBox message={errorIn('enroll')} />
                <EhrButton type="submit" busy={busy}>{busy ? ENROLLING : ENROLL}</EhrButton>
              </form>
            ) : null}
            {offered.link || offered.approve || offered.enroll ? null : <p className="hid-ehr-dept-muted">{NO_ACTIONS}</p>}
            {findPatient || nextHere.length ? (
              <div className="hid-ehr-dept-registration-next">
                <h3>{NEXT_STEPS}</h3>
                {/* Patients reads the handed Health ID from navigation state and puts it in Find a patient. */}
                {findPatient && patientsHref ? (
                  <p><Link className="hid-ehr-button" to={patientsHref} state={{ hid: findPatient }}>{OPEN_IN_PATIENTS}</Link></p>
                ) : null}
                {nextHere.map(step => (
                  <p key={step.module}><Link className="hid-ehr-button hid-ehr-button-secondary" to={step.href}>{step.label}</Link></p>
                ))}
              </div>
            ) : null}
          </DeptActions>
        )}
      />
    </DeptPage>
  )
}
