import { EhrBadge, EhrButton, EhrCard, EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { staffApi, type RegistrationCase, type RegistrationEnrollment } from '../../../staff/api'
import { focusIsLost } from '../../../staff/focus'
import { useFieldProblems } from '../../../staff/useFieldProblems'
import { ActionList, DetailGrid, DetailMeta, SubHeading } from '../parts/Detail'
import { KeyValueList } from '../parts/KeyValueList'
import { ErrorBox, Loading, RecordHeading, RecordNotFound } from '../parts/Notices'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'
import {
  APPROVED, CANDIDATE_PROBLEM, CASE_FAILED, CASE_ID_PROBLEM, CREATED, CREATED_UNREAD, ENROLLED, ENROLL_FAILED, ENROLL_INTRO, ENROLL_PROBLEM,
  ENROLL_TITLE, LINKED, NO_CANDIDATES, PENDING_NOTICE, REASON_PROBLEM, REVIEW_FAILED, REVIEW_NOTICE, UUID, candidateDetails, candidateOption,
  completed, createdAt, enrolledLine, mayApprove, mayEnroll, mayLink, mayWrite, safeError, statusLabel, useCommandKey, versionLine,
} from './registration'
import { RegistrationUnavailable, Required, ResumeCard } from './RegistrationParts'

/**
 * One registration case, at `registration/:caseId` (a case ID is a record's ID, not the patient's): the design's
 * record page. Its status and version under the heading, what the case holds as "Saved record", and the one step
 * today's page offers for its status under "Available actions". A case NIN verification has just created says so.
 */
export function RegistrationCasePage() {
  const { caseId = '' } = useParams()
  const location = useLocation()
  const href = useWorkspaceHref()
  const { facility, permissions } = useClinical()
  // Today's page starts afresh for another facility, and shows no case until one is loaded there: so does this one.
  const [openedAt] = useState(facility?.id)
  if (!facility || !mayWrite(permissions)) return <RegistrationUnavailable />
  if (facility.id !== openedAt) return <Navigate replace to={href()} />
  // A case the backend has just created opens whatever its ID; one typed into the address must be one "Load case" accepts.
  const created = createdAt(location.state) === facility.id
  if (!created && !UUID.test(caseId)) return <RecordNotFound backHref={href()} />
  return <CasePage key={caseId} facilityId={facility.id} caseId={caseId} created={created} permissions={permissions} />
}

function CasePage({ facilityId, caseId, created, permissions }: {
  facilityId: string
  caseId: string
  created: boolean
  permissions: readonly string[]
}) {
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const { lock } = useClinical()
  const canLink = mayLink(permissions)
  const canApprove = mayApprove(permissions)
  const canEnroll = mayEnroll(permissions)
  const [arrived] = useState(created)
  const [registrationCase, setRegistrationCase] = useState<RegistrationCase | null>(null)
  const [enrollment, setEnrollment] = useState<RegistrationEnrollment | null>(null)
  const [caseIdInput, setCaseIdInput] = useState(caseId)
  const [caseLoading, setCaseLoading] = useState(true)
  const [read, setRead] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const caseProblems = useFieldProblems()
  const reviewProblems = useFieldProblems()
  const enrollProblems = useFieldProblems()
  const reviewKey = useCommandKey()
  const enrollmentKey = useCommandKey()
  const live = useRef(true)

  // A decision or an enrollment removes the form that made it: focus goes to the case, if it was lost, once the
  // workspace is open (today's focus('registration-case-title', true)).
  const title = useRef<HTMLSpanElement>(null)
  const focusCase = useRef(false)
  const [settled, setSettled] = useState(0)
  useLayoutEffect(() => {
    if (!focusCase.current || lock !== null) return
    focusCase.current = false
    const heading = title.current?.closest('h1')
    if (!heading || !focusIsLost(heading)) return
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
    heading.focus()
  }, [settled, lock])
  function caseFocus() {
    focusCase.current = true
    setSettled(value => value + 1)
  }

  // The case is read as the page opens; one just created says so first (today's resolve, then its read).
  useEffect(() => {
    live.current = true
    let active = true
    if (arrived) setMessage(CREATED)
    void staffApi.registrationCase(facilityId, caseId)
      .then(value => { if (!active) return; setRegistrationCase(value); setCaseIdInput(value.caseId) })
      .catch(caught => {
        if (!active) return
        if (arrived) setMessage(CREATED_UNREAD)
        else setError(safeError(caught, CASE_FAILED))
      })
      .finally(() => { if (active) { setCaseLoading(false); setRead(true) } })
    return () => { active = false; live.current = false }
  }, [facilityId, caseId, arrived])

  /** Today's loadCase: "Refresh current case", or "Load case" while no case is shown. Another case opens on its own page. */
  async function loadCase(id: string) {
    const normalized = id.trim()
    setMessage('')
    setError(''); caseProblems.clear()
    if (!UUID.test(normalized)) { caseProblems.refuse('registration-case-id', CASE_ID_PROBLEM); return }
    if (normalized !== (registrationCase?.caseId ?? caseId)) { navigate(href(normalized)); return }
    setCaseLoading(true)
    try {
      const value = await staffApi.registrationCase(facilityId, normalized)
      if (!live.current) return
      setRegistrationCase(value)
      setCaseIdInput(value.caseId)
      setEnrollment(previous => registrationCase?.caseId === value.caseId ? previous : null)
    } catch (caught) {
      if (live.current) setError(safeError(caught, CASE_FAILED))
    } finally { if (live.current) setCaseLoading(false) }
  }

  async function review(event: FormEvent<HTMLFormElement>, action: 'approve' | 'link') {
    event.preventDefault()
    if (!registrationCase || !(action === 'link' ? canLink : canApprove) || busy) return
    const data = new FormData(event.currentTarget)
    const reason = String(data.get('reason') ?? '').trim()
    const patientId = String(data.get('patientId') ?? '')
    setError(''); setMessage(''); reviewProblems.clear()
    if (action === 'link' && !registrationCase.candidates?.some(candidate => candidate.patientId === patientId)) {
      reviewProblems.refuse('registration-candidate', CANDIDATE_PROBLEM); return
    }
    if (reason.length < 8 || reason.length > 500) {
      reviewProblems.refuse(action === 'link' ? 'registration-link-reason' : 'registration-approve-reason', REASON_PROBLEM); return
    }
    const key = reviewKey.forInput(JSON.stringify([action, facilityId, registrationCase.caseId, registrationCase.version, patientId, reason]))
    setBusy(true)
    try {
      const result = action === 'approve'
        ? await staffApi.approveNewRegistration(facilityId, registrationCase, reason, key)
        : await staffApi.linkExistingRegistration(facilityId, registrationCase, patientId, reason, key)
      if (!live.current) return
      setRegistrationCase(result)
      setMessage(action === 'approve' ? APPROVED : LINKED)
      caseFocus()
      reviewKey.clear()
    } catch (caught) {
      if (live.current) setError(safeError(caught, REVIEW_FAILED))
    } finally { if (live.current) setBusy(false) }
  }

  async function enroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!registrationCase || !canEnroll || busy || !completed.has(registrationCase.status)) return
    const data = new FormData(event.currentTarget)
    const email = String(data.get('email') ?? '').trim().toLowerCase()
    const reason = String(data.get('reason') ?? '').trim()
    setError(''); setMessage(''); enrollProblems.clear()
    if (!email || reason.length < 8 || reason.length > 500) {
      enrollProblems.refuse(!email ? 'registration-email' : 'registration-enroll-reason', ENROLL_PROBLEM); return
    }
    const key = enrollmentKey.forInput(JSON.stringify([facilityId, registrationCase.caseId, registrationCase.version, email, reason]))
    setBusy(true)
    try {
      const result = await staffApi.enrollRegistration(facilityId, registrationCase, email, reason, key)
      if (!live.current) return
      setEnrollment(result)
      setMessage(ENROLLED)
      caseFocus()
    } catch (caught) {
      if (live.current) setError(safeError(caught, ENROLL_FAILED))
    } finally { if (live.current) setBusy(false) }
  }

  const shown = registrationCase
  return (
    <>
      <RecordHeading title={<span ref={title}>Case {shown?.caseId ?? caseId}</span>} backHref={href()} />
      {shown ? (
        <DetailMeta>
          <EhrBadge className="hid-ehr-clinical-badge" tone={completed.has(shown.status) ? 'positive' : 'brand'}>{statusLabel(shown.status)}</EhrBadge>
          {/* Where the design's sync note and saved time sit, in their small muted type. */}
          <span className="hid-ehr-clinical-meta-saved">{versionLine(shown)}</span>
        </DetailMeta>
      ) : null}
      {/* Mounted throughout, so what a step says is announced. */}
      <div id="registration-status" role="status">{message ? <p className="hid-ehr-clinical-status">{message}</p> : null}</div>
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      {shown ? (
        <DetailGrid>
          <EhrCard title="Saved record">
            <KeyValueList items={[{ label: 'Case ID', value: shown.caseId }, ...(shown.patient ? [{ label: 'Health ID', value: shown.patient.hid }] : [])]} />
            {shown.status === 'review_required' ? (
              shown.candidates?.length ? (
                <ul className="hid-ehr-clinical-registration-candidates">
                  {shown.candidates.map(candidate => (
                    <li key={candidate.patientId}>
                      <strong>{candidate.fullName}</strong>
                      <p>{candidateDetails(candidate)}</p>
                    </li>
                  ))}
                </ul>
              ) : <p className="hid-ehr-clinical-registration-problem">{NO_CANDIDATES}</p>
            ) : null}
          </EhrCard>
          <EhrCard title="Available actions">
            <ActionList>
              <EhrButton
                variant="secondary"
                busy={caseLoading}
                aria-disabled={busy || undefined}
                onClick={() => { if (!caseLoading && !busy) void loadCase(shown.caseId) }}
              >
                Refresh current case
              </EhrButton>
            </ActionList>
            {shown.status === 'review_required' ? <p className="hid-ehr-clinical-note">{REVIEW_NOTICE}</p> : null}
            {shown.status === 'review_required' && canLink && Boolean(shown.candidates?.length) ? (
              <form className="hid-ehr-clinical-form" noValidate onSubmit={event => void review(event, 'link')}>
                <div className="hid-ehr-clinical-form-grid">
                  <EhrField controlId="registration-candidate" label={<Required>Candidate to link</Required>} error={reviewProblems.error('registration-candidate')}>
                    <EhrSelect name="patientId" required>
                      <option value="">Select a candidate</option>
                      {shown.candidates?.map(candidate => <option value={candidate.patientId} key={candidate.patientId}>{candidateOption(candidate)}</option>)}
                    </EhrSelect>
                  </EhrField>
                  <EhrField className="hid-ehr-clinical-form-full" controlId="registration-link-reason" label={<Required>Review reason</Required>} error={reviewProblems.error('registration-link-reason')}>
                    <EhrTextarea name="reason" rows={3} minLength={8} maxLength={500} required />
                  </EhrField>
                </div>
                <div className="hid-ehr-clinical-form-footer">
                  <EhrButton type="submit" busy={busy}>{busy ? 'Saving…' : 'Link selected patient'}</EhrButton>
                </div>
              </form>
            ) : null}
            {shown.status === 'pending_new_identity_approval' ? <p className="hid-ehr-clinical-note">{PENDING_NOTICE}</p> : null}
            {shown.status === 'pending_new_identity_approval' && canApprove ? (
              <form className="hid-ehr-clinical-form" noValidate onSubmit={event => void review(event, 'approve')}>
                <div className="hid-ehr-clinical-form-grid">
                  <EhrField className="hid-ehr-clinical-form-full" controlId="registration-approve-reason" label={<Required>Approval reason</Required>} error={reviewProblems.error('registration-approve-reason')}>
                    <EhrTextarea name="reason" rows={3} minLength={8} maxLength={500} required />
                  </EhrField>
                </div>
                <div className="hid-ehr-clinical-form-footer">
                  <EhrButton type="submit" busy={busy}>{busy ? 'Saving…' : 'Approve new Health ID'}</EhrButton>
                </div>
              </form>
            ) : null}
            {completed.has(shown.status) && canEnroll && !enrollment ? (
              <form className="hid-ehr-clinical-form" noValidate onSubmit={event => void enroll(event)}>
                <SubHeading>{ENROLL_TITLE}</SubHeading>
                <p className="hid-ehr-clinical-note">{ENROLL_INTRO}</p>
                <div className="hid-ehr-clinical-form-grid">
                  <EhrField controlId="registration-email" label={<Required>Patient email</Required>} error={enrollProblems.error('registration-email')}>
                    <EhrInput name="email" type="email" maxLength={254} autoComplete="off" required />
                  </EhrField>
                  <EhrField className="hid-ehr-clinical-form-full" controlId="registration-enroll-reason" label={<Required>Enrollment reason</Required>} error={enrollProblems.error('registration-enroll-reason')}>
                    <EhrTextarea name="reason" rows={3} minLength={8} maxLength={500} required />
                  </EhrField>
                </div>
                <div className="hid-ehr-clinical-form-footer">
                  <EhrButton type="submit" busy={busy}>{busy ? 'Enrolling…' : 'Create pending patient account'}</EhrButton>
                </div>
              </form>
            ) : null}
            {enrollment ? <p className="hid-ehr-clinical-note">{enrolledLine(enrollment.hid)}</p> : null}
          </EhrCard>
        </DetailGrid>
      ) : !read ? <Loading label="Loading…" /> : (
        <ResumeCard
          value={caseIdInput}
          onChange={setCaseIdInput}
          onLoad={() => void loadCase(caseIdInput)}
          loading={caseLoading}
          unavailable={busy}
          error={caseProblems.error('registration-case-id')}
        />
      )}
    </>
  )
}
