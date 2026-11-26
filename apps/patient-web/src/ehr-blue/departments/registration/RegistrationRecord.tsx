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
import { FIELD, type Availability, type CaseLoading, type ReviewAction, type ShownError, type VisitCase } from './registrationModel'
import { ErrorBox, UnavailableAction, type FormProblems } from './registrationParts'
import { VerifyNinForm, VerifyNinNotOffered } from './RegistrationVerifyNin'
import { VERIFY_NIN, verifyNinOffer } from './verifyNinLater'
import {
  APPROVE, APPROVE_REASON_LABEL, BACK_TO_LIST, CANDIDATE_LABEL, candidateLine, candidateOption, CANDIDATES_UNAVAILABLE,
  CANDIDATES_UNAVAILABLE_TITLE, candidatesText, caseTitle, caseWhen, COMPLETED, CORRECT_DEMOGRAPHICS, EMAIL_LABEL, ENROLL, ENROLL_NEEDS_NIN,
  ENROLL_REASON_LABEL, ENROLL_TEXT, ENROLL_TITLE, ENROLL_WITHOUT_NIN, enrolledText, ENROLLING, findPatientText, GIVE_NEW_HID, LINK, LINK_REASON_LABEL, NEXT_STEPS,
  NO_ACTIONS, noCandidateNotice, NO_CORRECTION, REFRESH_CASE, REFRESHING, REGISTER_ANOTHER, REVIEW_NOTICE, MORE_DETAILS, NIN_FACT, ninStatusText,
  REFERENCE_HINT, REFERENCE_LABEL, SAVED_RECORD, SAVING, SELECT_CANDIDATE, SENT_FOR_REVIEW_NOTICE, statusLabel, WITHOUT_NIN_REVIEW_NOTICE,
  WITHOUT_NIN_UNLISTED_NOTICE,
} from './registrationText'

type OpenForm = ReviewAction | 'enroll' | 'verifyNin'

/** Verify NIN later (hid-system 0138, ID-6): what the record's form needs from the page that sends it. */
export interface VerifyNinProps {
  /** Whether NIN checks work (registration-capabilities), as the page last read them. */
  readonly availability: Availability
  /** A NIN was added to this case's patient on this visit (or Identity said they hold one): shown as NIN Verified. */
  readonly added: boolean
  readonly problems: FormProblems
  /** Identity named a time to try again: the button is off until then. */
  readonly held: boolean
  readonly stillChecking: boolean
  readonly onInput: (event: FormEvent<HTMLFormElement>) => void
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

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
export function RegistrationRecord({ visit, canApprove, busy, caseLoading, message, error, reviewProblems, enrollProblems, verify, onBack, onNew,
  onRefresh, onReview, onEnroll }: {
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
  readonly verify: VerifyNinProps
  readonly onBack: () => void
  /** Classic's "Register someone else" (Registration.tsx 291): a new registration, from a completed case. */
  readonly onNew: () => void
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
  const completed = COMPLETED.has(registration.status)
  // Registration.tsx 289-291: only a completed case with a Health ID hands its patient on to Patients, and offers to
  // register someone else.
  const handOff = completed && hid ? hid : null
  const findPatient = handOff && patientsHref ? handOff : null
  const nextHere = registration.patient ? next : []
  const candidates = registration.candidates ?? []
  // hid-system 0130: a registration without a NIN. Identity sets up a patient account only for a checked NIN
  // (0032 identity.enroll_registered_patient), so one without is never offered enrollment, and says why.
  const withoutNin = registration.identityEvidence === 'none'
  const ninChecked = !withoutNin && registration.ninStatus !== 'not_verified'
  // ID-0 as the page last knows it. Identity reads a case's NIN status from the case's own check, so a NIN added later
  // (0138) still reads Not Verified on the case: the page keeps what it was told, for this visit.
  const ninStatus = verify.added ? 'verified' : registration.ninStatus
  // ID-6 screen notes: "Verify NIN" for the registered patient whose NIN is not verified, while NIN checks are available.
  // The page opens only with identity.registration.write. Only a registration made here without a NIN that gave the
  // patient a new Health ID is surely this facility's own (0131: approved_new_identity is registered here; a link to an
  // existing patient counts only once the patient confirms it, which the case does not say). A case with a NIN is not
  // offered either: a patient account follows only that case's own NIN check (0032), which a NIN added later is not.
  const ownRegistration = withoutNin && registration.status === 'approved_new_identity'
  const ninOffer = verifyNinOffer({
    ninStatus: registration.patient ? ninStatus : undefined, canRegister: true, ownFacility: ownRegistration,
    capabilities: verify.availability.capabilities, capabilitiesAnswered: verify.availability.answered,
  })
  // 0130 identity.review_patient_without_nin: an approver other than the person who started a registration without a
  // NIN sent for review decides it (a new Health ID, or a link to a listed patient). Identity shows the person who
  // started it nobody else's details, so a case started on this visit waits for another approver.
  const reviewWithoutNin = withoutNin && registration.status === 'review_required'
  const decidesWithoutNin = canApprove && reviewWithoutNin && !visit.started
  const waitsForApprover = reviewWithoutNin && !decidesWithoutNin
  // Registration.tsx 253, 255, 256: who may decide, and what this state of the case allows.
  const offered: Record<OpenForm, boolean> = {
    link: canApprove && registration.status === 'review_required' && candidates.length > 0,
    approve: canApprove && (registration.status === 'pending_new_identity_approval' || decidesWithoutNin),
    enroll: canApprove && completed && !enrollment && ninChecked,
    verifyNin: ninOffer === 'offer',
  }
  const enrollNeedsNin = canApprove && completed && !enrollment && !ninChecked
  const verifyNinLine = ninOffer === 'off' || ninOffer === 'unknown' || ninOffer === 'loading'
  const approveLabel = decidesWithoutNin ? GIVE_NEW_HID : APPROVE
  const shownForm = open && offered[open] ? open : null
  // A refusal is said in the form that sent it while that form is open, and otherwise at the top of the record.
  const errorHere = error && error.at !== 'find' && error.at !== 'resolve' && error.at !== 'without' && error.at !== shownForm ? error.text : ''
  const reviewNotice = waitsForApprover ? SENT_FOR_REVIEW_NOTICE
    : decidesWithoutNin ? (candidates.length ? WITHOUT_NIN_REVIEW_NOTICE : WITHOUT_NIN_UNLISTED_NOTICE) : REVIEW_NOTICE
  const errorIn = (form: OpenForm) => (error?.at === form ? error.text : '')
  const refreshing = caseLoading === 'refresh'
  // Back is unavailable while a step or this case's refresh runs, so its answer is not lost.
  const unavailable = busy || refreshing

  const facts: DeptFact[] = [
    { label: 'Status', value: statusLabel(registration.status) },
    { label: visit.started ? 'Started' : 'Reopened', value: dateText(visit.at) },
    { label: 'Possible matches', value: candidatesText(registration) },
    ...(registration.patient ? [{ label: 'Health ID', value: registration.patient.hid }] : []),
    ...(ninStatus ? [{ label: NIN_FACT, value: ninStatusText(ninStatus) }] : []),
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
        // Classic's "Refresh" (Registration.tsx 264): unavailable while it reads, keeping its focus.
        <EhrButton variant="secondary" busy={refreshing} className="hid-ehr-dept-registration-unavailable"
          aria-disabled={busy || caseLoading !== null || undefined} onClick={onRefresh}>{refreshing ? REFRESHING : REFRESH_CASE}</EhrButton>
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
      {registration.status === 'review_required' ? <DeptNotice tone="caution">{reviewNotice}</DeptNotice> : null}
      {registration.status === 'pending_new_identity_approval' ? <DeptNotice>{noCandidateNotice(canApprove)}</DeptNotice> : null}
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
              ) : reviewWithoutNin ? null : (
                // Registration.tsx 279: classic's warning, its title and its line.
                <DeptNotice tone="caution" title={CANDIDATES_UNAVAILABLE_TITLE}>{CANDIDATES_UNAVAILABLE}</DeptNotice>
              )
            ) : null}
            {/* The case's reference, out of the way: Health ID keeps no list of registrations, so it is how this one is
                reopened on a later visit ("Continue a registration"). */}
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
            {offered.approve ? toggle('approve', approveLabel) : null}
            {offered.enroll ? toggle('enroll', ENROLL_TITLE) : null}
            {offered.verifyNin ? toggle('verifyNin', VERIFY_NIN) : null}
            <VerifyNinNotOffered offer={ninOffer} availability={verify.availability} />
            {enrollNeedsNin ? <p className="hid-ehr-dept-muted">{withoutNin ? ENROLL_WITHOUT_NIN : ENROLL_NEEDS_NIN}</p> : null}
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
              <form id="registration-approve-form" className="hid-ehr-dept-action-form" noValidate aria-label={approveLabel}
                onSubmit={event => onReview(event, 'approve')}>
                <EhrField label={APPROVE_REASON_LABEL} controlId={FIELD.approveReason} error={reviewProblems.error(FIELD.approveReason)}>
                  <EhrTextarea name="reason" rows={3} minLength={8} maxLength={500} required />
                </EhrField>
                <ErrorBox message={errorIn('approve')} />
                <EhrButton type="submit" busy={busy}>{busy ? SAVING : approveLabel}</EhrButton>
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
            {shownForm === 'verifyNin' ? (
              <VerifyNinForm id="registration-verifyNin-form" controlId={FIELD.verifyNin} busy={busy} held={verify.held}
                stillChecking={verify.stillChecking} problems={verify.problems} error={errorIn('verifyNin')} onInput={verify.onInput} onSubmit={verify.onSubmit} />
            ) : null}
            {offered.link || offered.approve || offered.enroll || offered.verifyNin || verifyNinLine || enrollNeedsNin
              ? null : <p className="hid-ehr-dept-muted">{NO_ACTIONS}</p>}
            {handOff || nextHere.length ? (
              <div className="hid-ehr-dept-registration-next">
                <h3>{NEXT_STEPS}</h3>
                {/* Registration.tsx 290: Patients reads the handed Health ID from navigation state (never the address) and
                    lands on the patient's page with the chart summary (owner decision Q139 B). */}
                {findPatient && patientsHref ? (
                  <p><Link className="hid-ehr-button" to={patientsHref} state={{ hid: findPatient }}>{findPatientText(findPatient)}</Link></p>
                ) : null}
                {/* Registration.tsx 291: a new registration straight from here, unavailable while a step runs. */}
                {handOff ? (
                  <p>
                    <EhrButton variant="secondary" className="hid-ehr-dept-registration-unavailable" aria-disabled={unavailable || undefined}
                      onClick={() => { if (!unavailable) onNew() }}>{REGISTER_ANOTHER}</EhrButton>
                  </p>
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
