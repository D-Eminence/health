import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import {
  staffApi, type RegistrationCapabilities, type RegistrationCase, type RegistrationEnrollment, type ResolveNinInput,
} from '../../../staff/api'
import { useStaff } from '../../../staff/App'
import { focusLost } from '../../../pageFocus'
import { useDeptAccess } from '../parts/access'
import { DeptUnavailable } from '../parts/DeptPage'
import { RegistrationList } from './RegistrationList'
import { RegistrationNew } from './RegistrationNew'
import { RegistrationRecord } from './RegistrationRecord'
import { FIELD, START_HEADING, type Availability, type CaseLoading, type ReviewAction, type ShownError, type VisitCase } from './registrationModel'
import { useCommandKey, useFormProblems } from './registrationParts'
import {
  APPROVE_PERMISSION, APPROVED, CAPABILITY_FAILED, CANDIDATE_REFUSED, CASE_CREATED, CASE_CREATED_RELOAD, CASE_ID_REFUSED,
  CASE_LOAD_FAILED, COMPLETED, ENROLL_FAILED, ENROLL_REFUSED, ENROLLED, LINKED, NAME_DATE_REFUSED, NIN_REFUSED, REVIEW_FAILED,
  REVIEW_REASON_REFUSED, safeError, UNAVAILABLE_MESSAGE, UNAVAILABLE_TITLE, UUID, VERIFY_FAILED, WRITE_PERMISSION,
} from './registrationText'
import './registration.css'

/*
 * Patient registration in the blue Hospital EHR: the design's patients workspace (list, "New patients" form, the saved
 * record with its Available actions) on today's page, staff/routes/Registration.tsx, which is not exported in reusable
 * pieces and is ported here: the same requests, the same Idempotency-Keys, the same checks before sending and the same
 * words. Where this file names a line, it is a line of that page.
 */

/** Where the page is. In memory only: nothing about a case goes in the address or the history. */
type View = { kind: 'list' } | { kind: 'new' } | { kind: 'case'; caseId: string }

/** Today's refusal without a facility or the write permission (Registration.tsx 215): also the frame's at the address. */
export function RegistrationUnavailable() {
  return <DeptUnavailable title={UNAVAILABLE_TITLE} message={UNAVAILABLE_MESSAGE} />
}

export function PatientRegistration() {
  const { facilityId, permissions } = useDeptAccess()
  // Registration.tsx 42-44, 88, 215: nothing is read without a facility and the write permission.
  if (!facilityId || !permissions.includes(WRITE_PERMISSION)) return <RegistrationUnavailable />
  // Registration.tsx 79-96: another facility starts the page afresh (its answers, its case, its keys), so the page is
  // keyed by it; an answer for the facility left behind arrives at a page no longer shown, and changes nothing.
  return <RegistrationAt key={facilityId} facilityId={facilityId} canApprove={permissions.includes(APPROVE_PERMISSION)} />
}

function RegistrationAt({ facilityId, canApprove }: { readonly facilityId: string; readonly canApprove: boolean }) {
  const { lock } = useStaff()
  // Registration.tsx 45-46 (currentFacility): an answer is taken only while this facility's page is still shown.
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => { live.current = false }
  }, [])

  const [capabilities, setCapabilities] = useState<RegistrationCapabilities | null>(null)
  const [capabilityError, setCapabilityError] = useState('')
  const [capabilityLoading, setCapabilityLoading] = useState(false)
  // Whether any capability read has answered (a value or a refusal): only the first read is drawn as a bare skeleton.
  const [capabilityAnswered, setCapabilityAnswered] = useState(false)
  const [caseIdInput, setCaseIdInput] = useState('')
  const [visits, setVisits] = useState<readonly VisitCase[]>([])
  const nextSeq = useRef(0)
  // Registration.tsx 55: one case read at a time, and which control asked for it.
  const [caseLoading, setCaseLoading] = useState<CaseLoading>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<ShownError | null>(null)
  // A value refused before sending is reported at its field (PEHR-04). Each form keeps its own refusals: submitting
  // one leaves another's in place (Registration.tsx 61-66).
  const ninProblems = useFormProblems()
  const caseProblems = useFormProblems()
  const reviewProblems = useFormProblems()
  const enrollProblems = useFormProblems()
  const { clear: clearReview } = reviewProblems
  const { clear: clearEnroll } = enrollProblems
  // Registration.tsx 72, 230: the resolve key is renewed by any change to the form, so an unchanged retry reuses it.
  const resolveKey = useRef(crypto.randomUUID())
  const reviewKey = useCommandKey()
  const enrollmentKey = useCommandKey()

  const [view, setView] = useState<View>({ kind: 'list' })
  const shown = view.kind === 'case' ? visits.find(visit => visit.item.caseId === view.caseId) ?? null : null
  // Each view shown, counted, and the kind shown last: a read answers the view that asked for it only if it is still
  // the one shown (a case found while the user went on to "Create record" is listed, not opened over the form).
  const viewSeq = useRef(0)
  const viewKind = useRef<View['kind']>('list')

  // Focus moves with the view, in the commit that shows it: to the new view's heading, or to a control named. After a
  // step that removes its own form (a decision, an enrollment), to the case's heading only if focus was lost
  // (Registration.tsx 185, 209). A request made while the workspace is locked waits until it opens.
  const root = useRef<HTMLDivElement>(null)
  const [focusRequest, setFocusRequest] = useState<{ readonly id?: string; readonly ifLost: boolean } | null>(null)
  useLayoutEffect(() => {
    if (!focusRequest || lock != null) return
    setFocusRequest(null)
    if (focusRequest.ifLost && !focusLost()) return
    const target = (focusRequest.id ? document.getElementById(focusRequest.id) : null) ?? root.current?.querySelector<HTMLElement>('h1') ?? null
    if (!target) return
    if (target.tagName === 'H1' && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
    target.focus()
  }, [focusRequest, lock])

  const show = useCallback((next: View, focusId?: string) => {
    viewSeq.current += 1
    viewKind.current = next.kind
    setView(next)
    setFocusRequest({ id: focusId, ifLost: false })
  }, [])
  const { clear: clearNin } = ninProblems
  /**
   * A view the user chose: what the last step said belongs to the view it was said on, and a case's review and
   * enrollment forms start afresh (Registration.tsx 69-71, where the case shown changes, not in an effect after it).
   * So does the NIN form: its values go with the view, so its refusals go too (a new form is not shown refused).
   */
  const go = useCallback((next: View, focusId?: string) => {
    setMessage('')
    setError(null)
    clearNin()
    clearReview()
    clearEnroll()
    show(next, focusId)
  }, [clearNin, clearReview, clearEnroll, show])

  /** Keeps a case as Identity last answered it, first in the list when it is new to this visit. */
  const remember = useCallback((item: RegistrationCase) => {
    nextSeq.current += 1
    const seq = nextSeq.current
    setVisits(previous => previous.some(visit => visit.item.caseId === item.caseId)
      ? previous.map(visit => (visit.item.caseId === item.caseId ? { ...visit, item } : visit))
      : [{ seq, item, enrollment: null }, ...previous])
  }, [])
  const rememberEnrollment = useCallback((caseId: string, enrollment: RegistrationEnrollment) => {
    setVisits(previous => previous.map(visit => (visit.item.caseId === caseId ? { ...visit, enrollment } : visit)))
  }, [])

  // Registration.tsx 79-96: the capability is read as the page opens.
  useEffect(() => {
    let active = true
    setCapabilityLoading(true)
    void staffApi.registrationCapabilities(facilityId)
      .then(value => { if (active) setCapabilities(value) })
      .catch(caught => { if (active) setCapabilityError(safeError(caught, CAPABILITY_FAILED)) })
      .finally(() => { if (active) { setCapabilityLoading(false); setCapabilityAnswered(true) } })
    return () => { active = false }
  }, [facilityId])

  // Registration.tsx 98-108: Check again.
  async function refreshCapabilities() {
    setCapabilityError('')
    setCapabilityLoading(true)
    try {
      const value = await staffApi.registrationCapabilities(facilityId)
      if (!live.current) return
      setCapabilities(value)
      // On the new form, Check again stands in for the form until a read answers: the form takes its place, so focus
      // goes to the form's heading if it was on the button.
      if (viewKind.current === 'new') setFocusRequest({ id: START_HEADING, ifLost: true })
    } catch (caught) {
      if (live.current) setCapabilityError(safeError(caught, CAPABILITY_FAILED))
    } finally { if (live.current) { setCapabilityLoading(false); setCapabilityAnswered(true) } }
  }

  // Registration.tsx 110-127: a case by its ID, from "Find registration case" (which opens it, as the design opens a
  // saved record) or the case's own "Refresh current case" (which keeps focus where it is).
  async function loadCase(caseId: string, from: 'find' | 'refresh') {
    const normalized = caseId.trim()
    setMessage('')
    setError(null); caseProblems.clear()
    if (!UUID.test(normalized)) { caseProblems.refuse([[FIELD.caseId, CASE_ID_REFUSED]]); return }
    if (shown?.item.caseId !== normalized) { clearReview(); clearEnroll() }
    const asked = viewSeq.current
    setCaseLoading(from)
    try {
      const value = await staffApi.registrationCase(facilityId, normalized)
      if (!live.current) return
      remember(value)
      setCaseIdInput(value.caseId)
      // Opened only over the list it was asked from: a user who has gone on (a new form, another case) stays there.
      if (from === 'find' && viewSeq.current === asked) show({ kind: 'case', caseId: value.caseId })
    } catch (caught) {
      if (live.current && viewSeq.current === asked) setError({ text: safeError(caught, CASE_LOAD_FAILED), at: from })
    } finally { if (live.current) setCaseLoading(null) }
  }

  // Registration.tsx 129-161: NIN verification.
  async function resolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!capabilities?.nin.enabled || busy) return
    const form = event.currentTarget
    const data = new FormData(form)
    const nin = String(data.get('nin') ?? '').trim()
    const firstName = String(data.get('firstName') ?? '').trim()
    const lastName = String(data.get('lastName') ?? '').trim()
    const dateOfBirth = String(data.get('dateOfBirth') ?? '')
    const gender = String(data.get('gender') ?? '') as ResolveNinInput['gender'] | ''
    setError(null); setMessage(''); ninProblems.clear()
    // Registration.tsx 140-143: today's two refusals, each at its field, drawn as the design draws its validation
    // (every refused field at once, focus on the first). Listed in this form's order (NIN | Date of birth, then First |
    // Last name), so focus goes to the first refused field the user meets, not one after another refused field.
    const refused: Array<readonly [string, string]> = []
    if (!/^\d{11}$/.test(nin)) refused.push([FIELD.nin, NIN_REFUSED])
    if (!dateOfBirth) refused.push([FIELD.dob, NAME_DATE_REFUSED])
    if (!firstName) refused.push([FIELD.first, NAME_DATE_REFUSED])
    if (!lastName) refused.push([FIELD.last, NAME_DATE_REFUSED])
    if (refused.length) { ninProblems.refuse(refused); return }
    setBusy(true)
    try {
      const result = await staffApi.resolveNin(facilityId,
        { nin, firstName, lastName, dateOfBirth, ...(gender ? { gender } : {}) }, resolveKey.current)
      if (!live.current) return
      // The NIN is cleared from the form after a successful response, and the next verification gets a new key.
      form.reset()
      resolveKey.current = crypto.randomUUID()
      setCaseIdInput(result.caseId)
      clearReview(); clearEnroll()
      setMessage(CASE_CREATED)
      try {
        const detail = await staffApi.registrationCase(facilityId, result.caseId)
        if (!live.current) return
        remember(detail)
        // The design opens the saved record.
        show({ kind: 'case', caseId: detail.caseId })
      } catch {
        if (!live.current) return
        setMessage(CASE_CREATED_RELOAD)
        // Its ID is in "Find registration case", ready to load.
        show({ kind: 'list' }, FIELD.caseId)
      }
    } catch (caught) {
      if (live.current) setError({ text: safeError(caught, VERIFY_FAILED), at: 'resolve' })
    } finally { if (live.current) setBusy(false) }
  }

  // Registration.tsx 163-190: link a listed candidate, or approve a new Health ID.
  async function review(event: FormEvent<HTMLFormElement>, action: ReviewAction) {
    event.preventDefault()
    const registration = shown?.item
    if (!registration || !canApprove || busy) return
    const data = new FormData(event.currentTarget)
    const reason = String(data.get('reason') ?? '').trim()
    const patientId = String(data.get('patientId') ?? '')
    setError(null); setMessage(''); reviewProblems.clear()
    const refused: Array<readonly [string, string]> = []
    if (action === 'link' && !registration.candidates?.some(candidate => candidate.patientId === patientId)) {
      refused.push([FIELD.candidate, CANDIDATE_REFUSED])
    }
    if (reason.length < 8 || reason.length > 500) {
      refused.push([action === 'link' ? FIELD.linkReason : FIELD.approveReason, REVIEW_REASON_REFUSED])
    }
    if (refused.length) { reviewProblems.refuse(refused); return }
    const key = reviewKey.forInput(JSON.stringify([action, facilityId, registration.caseId, registration.version, patientId, reason]))
    setBusy(true)
    try {
      const result = action === 'approve'
        ? await staffApi.approveNewRegistration(facilityId, registration, reason, key)
        : await staffApi.linkExistingRegistration(facilityId, registration, patientId, reason, key)
      if (!live.current) return
      remember(result)
      setMessage(action === 'approve' ? APPROVED : LINKED)
      setFocusRequest({ ifLost: true })
      reviewKey.clear()
    } catch (caught) {
      if (live.current) setError({ text: safeError(caught, REVIEW_FAILED), at: action })
    } finally { if (live.current) setBusy(false) }
  }

  // Registration.tsx 192-213: a pending patient account for the case's Health ID.
  async function enroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const registration = shown?.item
    if (!registration || !canApprove || busy || !COMPLETED.has(registration.status)) return
    const form = event.currentTarget
    const data = new FormData(form)
    const email = String(data.get('email') ?? '').trim().toLowerCase()
    const reason = String(data.get('reason') ?? '').trim()
    setError(null); setMessage(''); enrollProblems.clear()
    // Registration.tsx 199-201, with the browser's own email check its form left on (type="email"): this form, drawn
    // in the design's look, checks itself, so an email the browser would not take is refused in the same words.
    const control = form.elements.namedItem('email')
    const malformed = control instanceof HTMLInputElement && control.validity.typeMismatch
    const refused: Array<readonly [string, string]> = []
    if (!email || malformed) refused.push([FIELD.email, ENROLL_REFUSED])
    if (reason.length < 8 || reason.length > 500) refused.push([FIELD.enrollReason, ENROLL_REFUSED])
    if (refused.length) { enrollProblems.refuse(refused); return }
    const key = enrollmentKey.forInput(JSON.stringify([facilityId, registration.caseId, registration.version, email, reason]))
    setBusy(true)
    try {
      const result = await staffApi.enrollRegistration(facilityId, registration, email, reason, key)
      if (!live.current) return
      rememberEnrollment(registration.caseId, result)
      setMessage(ENROLLED)
      setFocusRequest({ ifLost: true })
    } catch (caught) {
      if (live.current) setError({ text: safeError(caught, ENROLL_FAILED), at: 'enroll' })
    } finally { if (live.current) setBusy(false) }
  }

  const availability: Availability = {
    capabilities, error: capabilityError, loading: capabilityLoading, answered: capabilityAnswered,
    refresh: () => { if (!capabilityLoading) void refreshCapabilities() },
  }

  let content
  if (view.kind === 'new') {
    content = (
      <RegistrationNew availability={availability} busy={busy} problems={ninProblems} error={error?.at === 'resolve' ? error.text : ''}
        onInput={() => { resolveKey.current = crypto.randomUUID() }} onSubmit={event => void resolve(event)} onBack={() => go({ kind: 'list' })} />
    )
  } else if (view.kind === 'case' && shown) {
    content = (
      <RegistrationRecord key={shown.item.caseId} visit={shown} canApprove={canApprove} busy={busy} caseLoading={caseLoading}
        message={message} error={error} reviewProblems={reviewProblems} enrollProblems={enrollProblems}
        onBack={() => go({ kind: 'list' }, `registration-visit-${shown.seq}-open`)}
        onRefresh={() => { if (!caseLoading && !busy) void loadCase(shown.item.caseId, 'refresh') }}
        onReview={(event, action) => void review(event, action)} onEnroll={event => void enroll(event)} />
    )
  } else {
    content = (
      <RegistrationList availability={availability} caseIdInput={caseIdInput} onCaseIdInput={setCaseIdInput} caseLoading={caseLoading}
        busy={busy} problems={caseProblems} error={error?.at === 'find' ? error.text : ''} message={message} visits={visits}
        onFind={() => { if (!caseLoading && !busy) void loadCase(caseIdInput, 'find') }}
        onNew={() => go({ kind: 'new' })}
        onOpen={visit => go({ kind: 'case', caseId: visit.item.caseId })} />
    )
  }

  return (
    <div ref={root}>
      {content}
      {/* Mounted throughout, so what a step says is announced whichever view shows next (Registration.tsx 260-261). */}
      <div id="registration-status" role="status" className="hid-ehr-sr-only">{message}</div>
    </div>
  )
}
