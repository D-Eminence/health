import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { formatDate, formatDateTime } from '@hid/ui/display'
import { EhrBadge, EhrButton, EhrEmptyState, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import { workforceApi, type LeaveRequest, type LeaveType } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { useDepartments, useIdempotencyKeys, useStaffNames } from './hooks'
import {
  LEAVE_DATES_RULE, LEAVE_TYPES, LEAVE_TYPE_WORDS, OWN_DECISION, RELOAD_AFTER, cancelOffered, clashDates, dayText, departmentText,
  lagosToday, leaveDatesProblem, leaveDatesText, leaveStatusText, leaveStatusTone, leaveTypeText, learnFrom, personText, refusalWords,
} from './rosterRules'

const NO_REASON = 'Leave has a type and dates only. Nobody is asked for a reason or any medical detail.'

/**
 * My leave (routes 9-11): ask for leave (a type and dates, and optionally which department's in-charge decides; no
 * reason, Q244 A), see each request and its decision, and cancel one before it is decided, or approved leave before it
 * starts. Duties already on the roster are not put back.
 */
export function MyLeave({ facilityId }: { readonly facilityId: string }) {
  const keyFor = useIdempotencyKeys()
  const focus = useFocusById()
  const departments = useDepartments(facilityId)
  const [items, setItems] = useState<LeaveRequest[] | null>(null)
  const [readProblem, setReadProblem] = useState<string | null>(null)
  const [leaveType, setLeaveType] = useState<LeaveType | ''>('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [departmentCode, setDepartmentCode] = useState('')
  const [problems, setProblems] = useState<{ type?: string; dates?: string; form?: string }>({})
  const [sending, setSending] = useState(false)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [cancelProblem, setCancelProblem] = useState<{ id: string; text: string } | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const load = useCallback(async () => {
    setReadProblem(null)
    try {
      const answer = await workforceApi.myLeave(facilityId)
      learnFrom(facilityId)
      setItems(answer.items)
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      learnFrom(facilityId, caught)
      setReadProblem(refusalWords(caught, 'Your leave could not be loaded. Try again.'))
    }
  }, [facilityId])
  useEffect(() => { void load() }, [load])

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending) return
    const found: typeof problems = {}
    if (!leaveType) found.type = 'Choose the type of leave.'
    const dates = leaveDatesProblem(startsOn, endsOn)
    if (dates) found.dates = dates
    setProblems(found)
    if (found.type) { focus('leave-type'); return }
    if (found.dates) { focus('leave-starts'); return }
    const body = { leaveType: leaveType as LeaveType, startsOn, endsOn, ...(departmentCode ? { departmentCode } : {}) }
    setSending(true)
    setAnnouncement('')
    try {
      const answer = await workforceApi.askForLeave(facilityId, body, keyFor('ask', body))
      setItems(current => [answer.leaveRequest, ...(current ?? []).filter(item => item.leaveRequestId !== answer.leaveRequest.leaveRequestId)])
      setLeaveType(''); setStartsOn(''); setEndsOn(''); setDepartmentCode('')
      setAnnouncement(`Leave requested: ${leaveTypeText(answer.leaveRequest.leaveType)}, ${leaveDatesText(answer.leaveRequest)}.`)
    } catch (caught) {
      learnFrom(facilityId, caught)
      setProblems({ form: refusalWords(caught, 'The leave request could not be sent. Try again.') })
      focus('leave-form-problem')
    } finally { setSending(false) }
  }

  async function cancel(request: LeaveRequest) {
    if (cancelling) return
    setCancelling(request.leaveRequestId)
    setCancelProblem(null)
    setAnnouncement('')
    try {
      const answer = await workforceApi.cancelLeave(facilityId, request, keyFor(`cancel-${request.leaveRequestId}`, request.rowVersion))
      setItems(current => (current ?? []).map(item => item.leaveRequestId === request.leaveRequestId ? answer.leaveRequest : item))
      setAnnouncement('Leave cancelled.')
    } catch (caught) {
      learnFrom(facilityId, caught)
      setCancelProblem({ id: request.leaveRequestId, text: refusalWords(caught, 'The leave could not be cancelled. Try again.') })
      if (isHidApiError(caught) && RELOAD_AFTER.has(caught.code)) void load()
    } finally { setCancelling(null) }
  }

  const today = lagosToday()
  return (
    <DeptPage title="My leave" description={NO_REASON} className="hid-ehr-dept-roster">
      <p className="hid-ehr-sr-only" role="status">{announcement}</p>
      <DeptSection title="Ask for leave" headingId="leave-ask-title">
        <form className="hid-ehr-dept-form" noValidate onSubmit={event => void ask(event)} aria-labelledby="leave-ask-title">
          <div className="hid-ehr-dept-form-grid">
            <EhrField label={<>Type of leave<span aria-hidden="true"> *</span></>} controlId="leave-type" error={problems.type}>
              <EhrSelect value={leaveType} required onChange={event => setLeaveType(event.target.value as LeaveType | '')}>
                <option value="">Choose…</option>
                {LEAVE_TYPES.map(type => <option key={type} value={type}>{LEAVE_TYPE_WORDS[type]}</option>)}
              </EhrSelect>
            </EhrField>
            <EhrField label="Who decides" controlId="leave-department" hint="An administrator decides when no department is chosen.">
              <EhrSelect value={departmentCode} onChange={event => setDepartmentCode(event.target.value)}>
                <option value="">An administrator</option>
                {departments.map(code => <option key={code} value={code}>{`${departmentText(code)}’s in-charge`}</option>)}
              </EhrSelect>
            </EhrField>
            <EhrField label={<>First day<span aria-hidden="true"> *</span></>} controlId="leave-starts" error={problems.dates}
              hint={startsOn ? dayText(startsOn) : LEAVE_DATES_RULE}>
              <EhrInput type="date" value={startsOn} required onChange={event => setStartsOn(event.target.value)} />
            </EhrField>
            <EhrField label={<>Last day<span aria-hidden="true"> *</span></>} controlId="leave-ends" hint={endsOn ? dayText(endsOn) : undefined}>
              <EhrInput type="date" value={endsOn} required min={startsOn || undefined} onChange={event => setEndsOn(event.target.value)} />
            </EhrField>
          </div>
          {problems.form ? <DeptNotice id="leave-form-problem" tabIndex={-1} role="alert" tone="critical">{problems.form}</DeptNotice> : null}
          <div className="hid-ehr-dept-form-actions"><EhrButton type="submit" busy={sending}>Ask for leave</EhrButton></div>
        </form>
      </DeptSection>

      <DeptSection title="Your leave requests" headingId="leave-mine-title">
        {readProblem ? (
          <DeptNotice role="alert" tone="critical">
            <p>{readProblem}</p>
            <EhrButton variant="secondary" size="sm" onClick={() => void load()}>Try again</EhrButton>
          </DeptNotice>
        ) : null}
        {items === null && !readProblem ? <p className="hid-ehr-state-message" role="status">Loading your leave…</p> : null}
        {items?.length === 0 ? <EhrEmptyState title="No leave requests" message="Leave you ask for here is listed with its decision." /> : null}
        {items && items.length > 0 ? (
          <ul className="hid-ehr-dept-roster-requests" aria-label="Your leave requests">
            {items.map(request => {
              const headingId = `leave-${request.leaveRequestId}`
              return (
                <li key={request.leaveRequestId} aria-labelledby={headingId}>
                  <div>
                    <h3 id={headingId}>{leaveTypeText(request.leaveType)}</h3>
                    <p>{leaveDatesText(request)}</p>
                    <p className="hid-ehr-dept-muted">
                      {request.departmentCode ? `Sent to ${departmentText(request.departmentCode)}’s in-charge` : 'Sent to an administrator'}
                      {` · Asked ${formatDate(request.requestedAt)}`}
                    </p>
                    {cancelProblem?.id === request.leaveRequestId ? <DeptNotice role="alert" tone="critical">{cancelProblem.text}</DeptNotice> : null}
                  </div>
                  <div className="hid-ehr-dept-roster-request-actions">
                    <EhrBadge tone={leaveStatusTone(request.status)}>{leaveStatusText(request.status)}</EhrBadge>
                    {cancelOffered(request, today) ? (
                      <EhrButton size="sm" variant="secondary" busy={cancelling === request.leaveRequestId} aria-describedby={headingId}
                        onClick={() => void cancel(request)}>Cancel leave</EhrButton>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}
      </DeptSection>
    </DeptPage>
  )
}

/**
 * Leave to decide (routes 12-14): an administrator sees every request here, an in-charge those sent to their
 * departments. Approve or decline, never one's own; approving is refused while the person has duties on those days
 * that have not started, and the days are said.
 */
export function LeaveToDecide({ facilityId }: { readonly facilityId: string }) {
  const { membershipId } = useDeptAccess()
  const keyFor = useIdempotencyKeys()
  const departments = useDepartments(facilityId)
  const [status, setStatus] = useState<'requested' | 'decided'>('requested')
  const [departmentCode, setDepartmentCode] = useState('')
  const [answer, setAnswer] = useState<{ key: string; items: LeaveRequest[]; hasMore: boolean } | null>(null)
  const [readProblem, setReadProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [problem, setProblem] = useState<{ id: string; text: string; dates: string[] } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const key = `${status}|${departmentCode}`

  const load = useCallback(async () => {
    setReadProblem(null)
    try {
      const read = await workforceApi.leaveToDecide(facilityId, { status, departmentCode: departmentCode || undefined })
      learnFrom(facilityId)
      setAnswer({ key, items: read.items, hasMore: read.hasMore })
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      learnFrom(facilityId, caught)
      setReadProblem(refusalWords(caught, 'The leave requests could not be loaded. Try again.'))
    }
  }, [facilityId, status, departmentCode, key])
  useEffect(() => { void load() }, [load])

  const items = answer?.key === key ? answer.items : []
  const names = useStaffNames(facilityId, items.flatMap(item => [item.membershipId, item.decidedByMembershipId]))

  async function decide(request: LeaveRequest, decision: 'approve' | 'decline') {
    if (busy) return
    setBusy(request.leaveRequestId)
    setProblem(null)
    setAnnouncement('')
    try {
      const done = await workforceApi.decideLeave(facilityId, request, decision, keyFor(`${decision}-${request.leaveRequestId}`, request.rowVersion))
      setConfirming(null)
      setAnswer(current => current && current.key === key ? { ...current,
        items: status === 'requested' ? current.items.filter(item => item.leaveRequestId !== request.leaveRequestId)
          : current.items.map(item => item.leaveRequestId === request.leaveRequestId ? done.leaveRequest : item) } : current)
      setAnnouncement(`${decision === 'approve' ? 'Approved' : 'Declined'}: ${personText(request.membershipId, names, membershipId)}, ${leaveDatesText(request)}.`)
    } catch (caught) {
      learnFrom(facilityId, caught)
      setProblem({ id: request.leaveRequestId, text: refusalWords(caught, 'The decision could not be saved. Try again.'), dates: clashDates(caught) })
      if (isHidApiError(caught) && RELOAD_AFTER.has(caught.code)) void load()
    } finally { setBusy(null) }
  }

  return (
    <DeptPage title="Leave to decide" description="Approve or decline leave sent to you. Nobody decides their own leave."
      className="hid-ehr-dept-roster"
      secondaryActions={<EhrButton variant="secondary" onClick={() => void load()}>Refresh</EhrButton>}>
      <p className="hid-ehr-sr-only" role="status">{announcement}</p>
      <DeptSection title="Which requests" headingId="leave-filters-title">
        <div className="hid-ehr-dept-form-grid" role="group" aria-labelledby="leave-filters-title">
          <EhrField label="Show" controlId="leave-status">
            <EhrSelect value={status} onChange={event => setStatus(event.target.value === 'decided' ? 'decided' : 'requested')}>
              <option value="requested">Waiting for a decision</option>
              <option value="decided">Decided in the last 90 days</option>
            </EhrSelect>
          </EhrField>
          <EhrField label="Department" controlId="leave-filter-department">
            <EhrSelect value={departmentCode} onChange={event => setDepartmentCode(event.target.value)}>
              <option value="">Every department</option>
              {departments.map(code => <option key={code} value={code}>{departmentText(code)}</option>)}
            </EhrSelect>
          </EhrField>
        </div>
      </DeptSection>
      <DeptSection title={status === 'requested' ? 'Waiting for a decision' : 'Decided'} headingId="leave-decide-title">
        {readProblem ? (
          <DeptNotice role="alert" tone="critical">
            <p>{readProblem}</p>
            <EhrButton variant="secondary" size="sm" onClick={() => void load()}>Try again</EhrButton>
          </DeptNotice>
        ) : null}
        {answer?.key !== key && !readProblem ? <p className="hid-ehr-state-message" role="status">Loading leave requests…</p> : null}
        {answer?.key === key && items.length === 0
          ? <EhrEmptyState title="No leave requests" message={status === 'requested' ? 'Nothing is waiting for a decision.' : 'Nothing was decided in the last 90 days.'} />
          : null}
        {items.length > 0 ? (
          <ul className="hid-ehr-dept-roster-requests" aria-label="Leave requests">
            {items.map(request => {
              const headingId = `decide-${request.leaveRequestId}`
              const own = Boolean(membershipId) && request.membershipId.toLowerCase() === membershipId!.toLowerCase()
              const name = personText(request.membershipId, names, membershipId)
              return (
                <li key={request.leaveRequestId} aria-labelledby={headingId}>
                  <div>
                    <h3 id={headingId}>{name}</h3>
                    <p>{leaveTypeText(request.leaveType)} · {leaveDatesText(request)}</p>
                    <p className="hid-ehr-dept-muted">
                      {request.departmentCode ? departmentText(request.departmentCode) : 'No department'}
                      {` · Asked ${formatDateTime(request.requestedAt)}`}
                      {request.decidedAt ? ` · Decided ${formatDate(request.decidedAt)} by ${personText(request.decidedByMembershipId, names, membershipId)}` : ''}
                    </p>
                    {problem?.id === request.leaveRequestId ? (
                      <DeptNotice role="alert" tone="critical">
                        <p>{problem.text}</p>
                        {problem.dates.length > 0 ? <p>On the roster on {problem.dates.map(dayText).join(', ')}.</p> : null}
                      </DeptNotice>
                    ) : null}
                  </div>
                  <div className="hid-ehr-dept-roster-request-actions">
                    <EhrBadge tone={leaveStatusTone(request.status)}>{leaveStatusText(request.status)}</EhrBadge>
                    {request.status !== 'requested' ? null : own ? <p className="hid-ehr-dept-muted">{OWN_DECISION}</p> : confirming === request.leaveRequestId ? (
                      <>
                        <EhrButton size="sm" variant="danger" busy={busy === request.leaveRequestId} aria-describedby={headingId}
                          onClick={() => void decide(request, 'decline')}>Decline leave</EhrButton>
                        <EhrButton size="sm" variant="quiet" onClick={() => setConfirming(null)}>Keep it waiting</EhrButton>
                      </>
                    ) : (
                      <>
                        <EhrButton size="sm" busy={busy === request.leaveRequestId} aria-describedby={headingId}
                          onClick={() => void decide(request, 'approve')}>Approve</EhrButton>
                        <EhrButton size="sm" variant="secondary" aria-describedby={headingId} onClick={() => setConfirming(request.leaveRequestId)}>Decline</EhrButton>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}
        {answer?.key === key && answer.hasMore ? <p className="hid-ehr-dept-muted">Only the first 200 are shown. Choose a department to see fewer.</p> : null}
      </DeptSection>
    </DeptPage>
  )
}
