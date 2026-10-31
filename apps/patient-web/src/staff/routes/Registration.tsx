import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Field, Input, Select, Textarea } from '@hid/ui'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CircleCheck, History, IdCard, Lock, RotateCcw, Search } from 'lucide-react'
import { Alert, Badge as KBadge, Button as KButton, Card as KCard, CardHeader, EmptyState as KEmpty } from '../../kasuwa/ui'
import { FormActions, FormPage } from '../../kasuwa/parts'
import { isHidApiError } from '@hid/http'
import { staffApi, type RegistrationCapabilities, type RegistrationCase, type RegistrationEnrollment, type ResolveNinInput } from '../api'
import { useStaff } from '../App'
import { BUSY, UNAVAILABLE, useFocusById } from '../focus'
import { useFieldProblems } from '../useFieldProblems'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const completed = new Set<RegistrationCase['status']>(['approved_new_identity', 'linked_existing', 'resolved_existing_identity'])

function safeError(error: unknown, fallback: string) {
  return isHidApiError(error) ? error.message : fallback
}

function statusLabel(status: RegistrationCase['status']) {
  return ({
    pending_new_identity_approval: 'Needs approval',
    review_required: 'Possible match',
    resolved_existing_identity: 'Already on Health ID',
    linked_existing: 'Linked',
    approved_new_identity: 'New Health ID',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
  })[status]
}

/** Idempotency keys stay in component memory only and are reused for an unchanged retry. */
function useCommandKey() {
  const previous = useRef<{ signature: string; key: string } | null>(null)
  return {
    forInput(signature: string) {
      if (previous.current?.signature !== signature) previous.current = { signature, key: crypto.randomUUID() }
      return previous.current.key
    },
    clear() { previous.current = null },
  }
}

export function Registration() {
  const { state } = useStaff()
  const facility = state.status === 'ready' ? state.session.actor.facility : undefined
  const facilityId = facility?.id ?? ''
  const canWrite = facility?.permissions.includes('identity.registration.write') ?? false
  const canApprove = facility?.permissions.includes('identity.registration.approve') ?? false
  const navigate = useNavigate()
  const currentFacility = useRef(facilityId)
  currentFacility.current = facilityId

  const [capabilities, setCapabilities] = useState<RegistrationCapabilities | null>(null)
  const [capabilityError, setCapabilityError] = useState('')
  const [capabilityLoading, setCapabilityLoading] = useState(false)
  const [caseIdInput, setCaseIdInput] = useState('')
  const [registrationCase, setRegistrationCase] = useState<RegistrationCase | null>(null)
  const [enrollment, setEnrollment] = useState<RegistrationEnrollment | null>(null)
  const [caseLoading, setCaseLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  // A case decision removes the form that made it: focus goes to the case.
  const focus = useFocusById()
  // A value refused before sending is reported at its field (PEHR-04). Each form keeps
  // its own refusals: submitting one leaves another's in place.
  const ninProblems = useFieldProblems()
  const caseProblems = useFieldProblems()
  const reviewProblems = useFieldProblems()
  const enrollProblems = useFieldProblems()
  const { clear: clearReview } = reviewProblems
  const { clear: clearEnroll } = enrollProblems
  // The review and enrollment forms act on the case shown: another case starts them afresh. They are cleared
  // where the case shown changes, not in an effect after it: a refusal made before such an effect ran was lost.
  const showNoCase = () => { setRegistrationCase(null); setEnrollment(null); clearReview(); clearEnroll() }
  const resolveKey = useRef(crypto.randomUUID())
  const reviewKey = useCommandKey()
  const enrollmentKey = useCommandKey()

  useEffect(() => {
    setCapabilities(null)
    setCapabilityError('')
    setCaseIdInput('')
    showNoCase()
    setMessage('')
    setError('')
    setBusy(false)
    setCaseLoading(false)
    resolveKey.current = crypto.randomUUID()
    reviewKey.clear()
    enrollmentKey.clear()
    if (!facilityId || !canWrite) return
    let active = true
    setCapabilityLoading(true)
    void staffApi.registrationCapabilities(facilityId)
      .then(value => { if (active) setCapabilities(value) })
      .catch(caught => { if (active) setCapabilityError(safeError(caught, 'We couldn’t check whether NIN checks are working.')) })
      .finally(() => { if (active) setCapabilityLoading(false) })
    return () => { active = false }
  }, [facilityId, canWrite])

  async function refreshCapabilities() {
    if (!facilityId) return
    setCapabilityError('')
    setCapabilityLoading(true)
    try {
      const value = await staffApi.registrationCapabilities(facilityId)
      if (currentFacility.current === facilityId) setCapabilities(value)
    } catch (caught) {
      if (currentFacility.current === facilityId) setCapabilityError(safeError(caught, 'We couldn’t check whether NIN checks are working.'))
    } finally { if (currentFacility.current === facilityId) setCapabilityLoading(false) }
  }

  async function loadCase(caseId: string) {
    if (!facilityId || !canWrite) return
    const normalized = caseId.trim()
    setMessage('')
    setError(''); caseProblems.clear()
    if (!UUID.test(normalized)) { caseProblems.refuse('registration-case-id', 'Enter a valid registration case ID.'); return }
    if (registrationCase?.caseId !== normalized) showNoCase()
    setCaseLoading(true)
    try {
      const value = await staffApi.registrationCase(facilityId, normalized)
      if (currentFacility.current !== facilityId) return
      setRegistrationCase(value)
      setCaseIdInput(value.caseId)
      setEnrollment(previous => registrationCase?.caseId === value.caseId ? previous : null)
    } catch (caught) {
      if (currentFacility.current === facilityId) setError(safeError(caught, 'We couldn’t open that registration.'))
    } finally { if (currentFacility.current === facilityId) setCaseLoading(false) }
  }

  async function resolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!facilityId || !canWrite || !capabilities?.nin.enabled || busy) return
    const form = event.currentTarget
    const data = new FormData(form)
    const nin = String(data.get('nin') ?? '').trim()
    const firstName = String(data.get('firstName') ?? '').trim()
    const lastName = String(data.get('lastName') ?? '').trim()
    const dateOfBirth = String(data.get('dateOfBirth') ?? '')
    const gender = String(data.get('gender') ?? '') as ResolveNinInput['gender'] | ''
    setError(''); setMessage(''); ninProblems.clear()
    if (!/^\d{11}$/.test(nin)) { ninProblems.refuse('registration-nin', 'Enter the 11 digit NIN.'); return }
    if (!firstName || !lastName || !dateOfBirth) {
      ninProblems.refuse(!firstName ? 'registration-first' : !lastName ? 'registration-last' : 'registration-dob', 'Enter the patient’s name and date of birth.'); return
    }
    setBusy(true)
    try {
      const result = await staffApi.resolveNin(facilityId,
        { nin, firstName, lastName, dateOfBirth, ...(gender ? { gender } : {}) }, resolveKey.current)
      if (currentFacility.current !== facilityId) return
      form.reset()
      resolveKey.current = crypto.randomUUID()
      setCaseIdInput(result.caseId)
      showNoCase()
      setMessage('NIN checked. See the result below.')
      try {
        const detail = await staffApi.registrationCase(facilityId, result.caseId)
        if (currentFacility.current === facilityId) setRegistrationCase(detail)
      } catch { if (currentFacility.current === facilityId) setMessage('NIN checked. Refresh to see the result.') }
    } catch (caught) {
      if (currentFacility.current === facilityId) setError(safeError(caught, 'We couldn’t check that NIN. Try again.'))
    } finally { if (currentFacility.current === facilityId) setBusy(false) }
  }

  async function review(event: FormEvent<HTMLFormElement>, action: 'approve' | 'link') {
    event.preventDefault()
    if (!facilityId || !registrationCase || !canApprove || busy) return
    const data = new FormData(event.currentTarget)
    const reason = String(data.get('reason') ?? '').trim()
    const patientId = String(data.get('patientId') ?? '')
    setError(''); setMessage(''); reviewProblems.clear()
    if (action === 'link' && !registrationCase.candidates?.some(candidate => candidate.patientId === patientId)) {
      reviewProblems.refuse('registration-candidate', 'Select a candidate returned by this registration case.'); return
    }
    if (reason.length < 8 || reason.length > 500) {
      reviewProblems.refuse(action === 'link' ? 'registration-link-reason' : 'registration-approve-reason', 'Enter a review reason between 8 and 500 characters.'); return
    }
    const key = reviewKey.forInput(JSON.stringify([action, facilityId, registrationCase.caseId, registrationCase.version, patientId, reason]))
    setBusy(true)
    try {
      const result = action === 'approve'
        ? await staffApi.approveNewRegistration(facilityId, registrationCase, reason, key)
        : await staffApi.linkExistingRegistration(facilityId, registrationCase, patientId, reason, key)
      if (currentFacility.current !== facilityId) return
      setRegistrationCase(result)
      setMessage(action === 'approve' ? 'New Health ID created.' : 'Linked to the existing patient.')
      focus('registration-case-title', true)
      reviewKey.clear()
    } catch (caught) {
      if (currentFacility.current === facilityId) setError(safeError(caught, 'That didn’t save. Refresh and try again.'))
    } finally { if (currentFacility.current === facilityId) setBusy(false) }
  }

  async function enroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!facilityId || !registrationCase || !canApprove || busy || !completed.has(registrationCase.status)) return
    const data = new FormData(event.currentTarget)
    const email = String(data.get('email') ?? '').trim().toLowerCase()
    const reason = String(data.get('reason') ?? '').trim()
    setError(''); setMessage(''); enrollProblems.clear()
    if (!email || reason.length < 8 || reason.length > 500) {
      enrollProblems.refuse(!email ? 'registration-email' : 'registration-enroll-reason', 'Enter a valid email and an enrollment reason between 8 and 500 characters.'); return
    }
    const key = enrollmentKey.forInput(JSON.stringify([facilityId, registrationCase.caseId, registrationCase.version, email, reason]))
    setBusy(true)
    try {
      const result = await staffApi.enrollRegistration(facilityId, registrationCase, email, reason, key)
      if (currentFacility.current !== facilityId) return
      setEnrollment(result)
      setMessage('Account created. The patient will get an email to set their password.')
      focus('registration-case-title', true)
    } catch (caught) {
      if (currentFacility.current === facilityId) setError(safeError(caught, 'We couldn’t create the account. They may already have one.'))
    } finally { if (currentFacility.current === facilityId) setBusy(false) }
  }

  if (!facilityId || !canWrite) return <KEmpty icon={Lock} title="You can’t register patients here" description="Ask your facility admin to give you registration access." />
  const registration = registrationCase
  const done = registration ? completed.has(registration.status) : false
  const hid = registration?.patient?.hid
  return <FormPage title="Register a patient" description="Check their NIN, then give them a Health ID or link them to the one they already have.">
    {/* Rarely needed: continuing a registration from its ID, as a small disclosure under the heading. */}
    <details className="group -mt-3 self-start [&[open]]:w-full" open={caseProblems.error('registration-case-id') ? true : undefined}>
      <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-[13px] font-medium text-brand-ink sm:min-h-0"><History className="size-4" aria-hidden />Continue a registration</summary>
      <form className="staff-form mt-2 rounded-xl bg-surface p-4 ring-1 ring-line" onSubmit={event => { event.preventDefault(); if (!caseLoading && !busy) void loadCase(caseIdInput) }}>
        <Field label="Registration ID" htmlFor="registration-case-id" hint="Shown on the registration when it was started." error={caseProblems.error('registration-case-id')} required><Input {...caseProblems.control('registration-case-id')} id="registration-case-id" value={caseIdInput} onChange={event => setCaseIdInput(event.target.value)} autoComplete="off" required /></Field>
        <FormActions sticky={false}><KButton type="submit" aria-disabled={caseLoading || busy || undefined} className={BUSY}>{caseLoading ? 'Opening…' : 'Open'}</KButton></FormActions>
      </form>
    </details>
    {/* Only when NIN checks are not working: a working service needs no card. */}
    {capabilityError ? <Alert intent="error" title="Can’t check NINs right now" action={<KButton size="sm" aria-disabled={capabilityLoading || undefined} className={UNAVAILABLE} onClick={() => { if (!capabilityLoading) void refreshCapabilities() }}>{capabilityLoading ? 'Checking…' : 'Try again'}</KButton>}>{capabilityError}</Alert>
      : !capabilities ? <p className="m-0 text-[13px] text-ink-3" role="status">Checking NIN checks are working…</p>
      : !capabilities.nin.enabled ? <Alert intent="warning" title="NIN checks are off" action={<KButton size="sm" aria-disabled={capabilityLoading || undefined} className={UNAVAILABLE} onClick={() => { if (!capabilityLoading) void refreshCapabilities() }}>{capabilityLoading ? 'Checking…' : 'Check again'}</KButton>}>New registrations can’t start until they’re back on.</Alert> : null}

        {capabilities?.nin.enabled && !registration && <KCard>
          <CardHeader as="h2" title="1. Check their NIN" description="Type it as it is on their NIN slip. It isn’t kept here." icon={IdCard} iconTone="brand" />
          <form className="staff-form p-5" onInput={() => { resolveKey.current = crypto.randomUUID() }} onSubmit={event => void resolve(event)}>
            {/* Not disabled while the NIN is verified, which would take focus from the button: read-only. */}
            <fieldset className="staff-form">
              <Field label="NIN (11 digits)" htmlFor="registration-nin" error={ninProblems.error('registration-nin')} required><Input {...ninProblems.control('registration-nin')} id="registration-nin" name="nin" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{11}" minLength={11} maxLength={11} readOnly={busy} required /></Field>
              <div className="staff-form-row"><Field label="First name" htmlFor="registration-first" error={ninProblems.error('registration-first')} required><Input {...ninProblems.control('registration-first')} id="registration-first" name="firstName" maxLength={100} autoComplete="off" readOnly={busy} required /></Field><Field label="Last name" htmlFor="registration-last" error={ninProblems.error('registration-last')} required><Input {...ninProblems.control('registration-last')} id="registration-last" name="lastName" maxLength={100} autoComplete="off" readOnly={busy} required /></Field></div>
              <div className="staff-form-row"><Field label="Date of birth" htmlFor="registration-dob" error={ninProblems.error('registration-dob')} required><Input {...ninProblems.control('registration-dob')} id="registration-dob" name="dateOfBirth" type="date" readOnly={busy} required /></Field><Field label="Gender (optional)" htmlFor="registration-gender"><Select id="registration-gender" name="gender"><option value="">Not given</option><option value="female">Female</option><option value="male">Male</option><option value="intersex">Intersex</option><option value="other">Other</option><option value="unknown">Unknown</option></Select></Field></div>
              <FormActions sticky={false}><KButton type="submit" variant="primary" icon={Search} aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Checking…' : 'Check NIN'}</KButton></FormActions>
            </fieldset>
          </form>
        </KCard>}

        {registration && <KCard>
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <h2 id="registration-case-title" tabIndex={-1} className="m-0 text-title-3 text-ink outline-none">{done ? '3. Done' : '2. Check the result'}</h2>
            <div className="flex items-center gap-2">
              <KBadge size="sm" tone={done ? 'success' : registration.status === 'rejected' || registration.status === 'cancelled' ? 'danger' : 'warn'}>{statusLabel(registration.status)}</KBadge>
              <KButton size="sm" variant="ghost" icon={RotateCcw} aria-disabled={caseLoading || busy || undefined} className={UNAVAILABLE} onClick={() => { if (!caseLoading && !busy) void loadCase(registration.caseId) }}>{caseLoading ? 'Refreshing…' : 'Refresh'}</KButton>
            </div>
          </div>
          <div className="flex flex-col gap-4 p-5">
            {hid && <div className="flex items-center gap-3 rounded-xl bg-success-soft/60 px-4 py-3 ring-1 ring-line">
              <CircleCheck className="size-5 shrink-0 text-success-ink" aria-hidden />
              <div className="min-w-0 flex-1"><p className="m-0 text-[12px] text-ink-3">Health ID</p><p className="m-0 text-base font-semibold tracking-[.06em] text-ink">{hid}</p></div>
            </div>}

            {registration.status === 'review_required' && <>
              <p className="m-0 text-sm text-ink-2">This person may already be on Health ID. Pick the right one to link them.</p>
              {registration.candidates?.length ? <ul className="m-0 list-none divide-y divide-line rounded-xl p-0 ring-1 ring-line">{registration.candidates.map(candidate => <li key={candidate.patientId} className="px-4 py-3">
                <p className="m-0 text-sm font-medium text-ink">{candidate.fullName}</p><p className="m-0 text-[12px] text-ink-3">Born {candidate.dateOfBirth ?? 'unknown'}</p></li>)}</ul>
                : <Alert intent="warning" title="Can’t show the matches">Refresh to try again.</Alert>}
              {canApprove && Boolean(registration.candidates?.length) && <form className="staff-form" onSubmit={event => void review(event, 'link')}><Field label="Which person is it?" htmlFor="registration-candidate" error={reviewProblems.error('registration-candidate')} required><Select {...reviewProblems.control('registration-candidate')} id="registration-candidate" name="patientId" required><option value="">Choose</option>{registration.candidates?.map(candidate => <option value={candidate.patientId} key={candidate.patientId}>{candidate.fullName} · {candidate.dateOfBirth ?? 'date unknown'}</option>)}</Select></Field><Field label="Why (for the record)" htmlFor="registration-link-reason" error={reviewProblems.error('registration-link-reason')} required><Textarea {...reviewProblems.control('registration-link-reason')} id="registration-link-reason" name="reason" minLength={8} maxLength={500} required /></Field><FormActions sticky={false}><KButton type="submit" variant="primary" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Saving…' : 'Link to this person'}</KButton></FormActions></form>}
            </>}

            {registration.status === 'pending_new_identity_approval' && <>
              <p className="m-0 text-sm text-ink-2">No match found. {canApprove ? 'You can give them a new Health ID.' : 'Someone with approval rights must give them a new Health ID.'}</p>
              {canApprove && <form className="staff-form" onSubmit={event => void review(event, 'approve')}><Field label="Why (for the record)" htmlFor="registration-approve-reason" error={reviewProblems.error('registration-approve-reason')} required><Textarea {...reviewProblems.control('registration-approve-reason')} id="registration-approve-reason" name="reason" minLength={8} maxLength={500} required /></Field><FormActions sticky={false}><KButton type="submit" variant="primary" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Saving…' : 'Create Health ID'}</KButton></FormActions></form>}
            </>}

            {/* The hand-off: a registered patient goes straight on to their page. */}
            {done && hid && <div className="flex flex-wrap gap-2">
              <KButton variant="primary" icon={ArrowRight} onClick={() => navigate('/provider/patients', { state: { hid } })}>Find {hid} and open their chart</KButton>
              <KButton onClick={() => { setRegistrationCase(null); setEnrollment(null); setMessage('') }}>Register someone else</KButton>
            </div>}

            {done && canApprove && !enrollment && <details className="rounded-xl ring-1 ring-line [&[open]>summary]:border-b [&[open]>summary]:border-line">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink">No phone or app? Create their account <span className="font-normal text-ink-3">· optional</span></summary>
              <form className="staff-form p-4" onSubmit={event => void enroll(event)}><p className="m-0 text-[13px] text-ink-3">They get an email to set a password. Use their own email, not yours.</p><Field label="Their email" htmlFor="registration-email" error={enrollProblems.error('registration-email')} required><Input {...enrollProblems.control('registration-email')} id="registration-email" name="email" type="email" maxLength={254} autoComplete="off" required /></Field><Field label="Why (for the record)" htmlFor="registration-enroll-reason" error={enrollProblems.error('registration-enroll-reason')} required><Textarea {...enrollProblems.control('registration-enroll-reason')} id="registration-enroll-reason" name="reason" minLength={8} maxLength={500} required /></Field><FormActions sticky={false}><KButton type="submit" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Creating…' : 'Create account'}</KButton></FormActions></form>
            </details>}
            {enrollment && <p className="m-0 text-[13px] text-success-ink">Account created for {enrollment.hid}. They’ll get an email to finish.</p>}
          </div>
        </KCard>}
        {error && <Alert intent="error" title="That didn’t work">{error}</Alert>}
        {/* Mounted throughout, so what a step says is announced. */}
        <div id="registration-status" role="status" className="empty:hidden">{message && <p className="m-0 text-[13px] text-ink-2">{message}</p>}</div>
  </FormPage>
}
