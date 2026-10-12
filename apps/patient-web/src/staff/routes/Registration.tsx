import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Badge, Button, Card, EmptyState, Field, Input, Select, Textarea } from '@hid/ui'
import { isHidApiError } from '@hid/http'
import { staffApi, type RegistrationCapabilities, type RegistrationCase, type RegistrationEnrollment, type ResolveNinInput } from '../api'
import { useStaff } from '../App'
import { BUSY, useFocusById } from '../focus'
import { useFieldProblems } from '../useFieldProblems'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const completed = new Set<RegistrationCase['status']>(['approved_new_identity', 'linked_existing', 'resolved_existing_identity'])

function safeError(error: unknown, fallback: string) {
  return isHidApiError(error) ? error.message : fallback
}

function statusLabel(status: RegistrationCase['status']) {
  return ({
    pending_new_identity_approval: 'Awaiting new patient approval',
    review_required: 'Possible existing patient review',
    resolved_existing_identity: 'Verified existing patient',
    linked_existing: 'Linked to existing patient',
    approved_new_identity: 'New patient approved',
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
  // A value refused before sending is reported at its field (PEHR-04).
  const problems = useFieldProblems()
  const resolveKey = useRef(crypto.randomUUID())
  const reviewKey = useCommandKey()
  const enrollmentKey = useCommandKey()

  useEffect(() => {
    setCapabilities(null)
    setCapabilityError('')
    setCaseIdInput('')
    setRegistrationCase(null)
    setEnrollment(null)
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
      .catch(caught => { if (active) setCapabilityError(safeError(caught, 'Registration capabilities could not be loaded.')) })
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
      if (currentFacility.current === facilityId) setCapabilityError(safeError(caught, 'Registration capabilities could not be loaded.'))
    } finally { if (currentFacility.current === facilityId) setCapabilityLoading(false) }
  }

  async function loadCase(caseId: string) {
    if (!facilityId || !canWrite) return
    const normalized = caseId.trim()
    setMessage('')
    setError(''); problems.clear()
    if (!UUID.test(normalized)) { problems.refuse('registration-case-id', 'Enter a valid registration case ID.'); return }
    if (registrationCase?.caseId !== normalized) { setRegistrationCase(null); setEnrollment(null) }
    setCaseLoading(true)
    try {
      const value = await staffApi.registrationCase(facilityId, normalized)
      if (currentFacility.current !== facilityId) return
      setRegistrationCase(value)
      setCaseIdInput(value.caseId)
      setEnrollment(previous => registrationCase?.caseId === value.caseId ? previous : null)
    } catch (caught) {
      if (currentFacility.current === facilityId) setError(safeError(caught, 'The registration case could not be loaded.'))
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
    setError(''); setMessage(''); problems.clear()
    if (!/^\d{11}$/.test(nin)) { problems.refuse('registration-nin', 'Enter the 11 digit NIN.'); return }
    if (!firstName || !lastName || !dateOfBirth) {
      problems.refuse(!firstName ? 'registration-first' : !lastName ? 'registration-last' : 'registration-dob', 'Enter the patient’s name and date of birth.'); return
    }
    setBusy(true)
    try {
      const result = await staffApi.resolveNin(facilityId,
        { nin, firstName, lastName, dateOfBirth, ...(gender ? { gender } : {}) }, resolveKey.current)
      if (currentFacility.current !== facilityId) return
      form.reset()
      resolveKey.current = crypto.randomUUID()
      setCaseIdInput(result.caseId)
      setRegistrationCase(null)
      setEnrollment(null)
      setMessage('NIN verification created a governed registration case. Review its status before continuing.')
      try {
        const detail = await staffApi.registrationCase(facilityId, result.caseId)
        if (currentFacility.current === facilityId) setRegistrationCase(detail)
      } catch { if (currentFacility.current === facilityId) setMessage('Case created. Reload its details before reviewing it.') }
    } catch (caught) {
      if (currentFacility.current === facilityId) setError(safeError(caught, 'NIN verification could not be completed.'))
    } finally { if (currentFacility.current === facilityId) setBusy(false) }
  }

  async function review(event: FormEvent<HTMLFormElement>, action: 'approve' | 'link') {
    event.preventDefault()
    if (!facilityId || !registrationCase || !canApprove || busy) return
    const data = new FormData(event.currentTarget)
    const reason = String(data.get('reason') ?? '').trim()
    const patientId = String(data.get('patientId') ?? '')
    setError(''); setMessage(''); problems.clear()
    if (action === 'link' && !registrationCase.candidates?.some(candidate => candidate.patientId === patientId)) {
      problems.refuse('registration-candidate', 'Select a candidate returned by this registration case.'); return
    }
    if (reason.length < 8 || reason.length > 500) {
      problems.refuse(action === 'link' ? 'registration-link-reason' : 'registration-approve-reason', 'Enter a review reason between 8 and 500 characters.'); return
    }
    const key = reviewKey.forInput(JSON.stringify([action, facilityId, registrationCase.caseId, registrationCase.version, patientId, reason]))
    setBusy(true)
    try {
      const result = action === 'approve'
        ? await staffApi.approveNewRegistration(facilityId, registrationCase, reason, key)
        : await staffApi.linkExistingRegistration(facilityId, registrationCase, patientId, reason, key)
      if (currentFacility.current !== facilityId) return
      setRegistrationCase(result)
      setMessage(action === 'approve' ? 'A new Health ID was approved.' : 'The verified identity was linked to the selected patient.')
      focus('registration-case-title', true)
      reviewKey.clear()
    } catch (caught) {
      if (currentFacility.current === facilityId) setError(safeError(caught, 'The case review could not be completed. Refresh the case before changing its decision.'))
    } finally { if (currentFacility.current === facilityId) setBusy(false) }
  }

  async function enroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!facilityId || !registrationCase || !canApprove || busy || !completed.has(registrationCase.status)) return
    const data = new FormData(event.currentTarget)
    const email = String(data.get('email') ?? '').trim().toLowerCase()
    const reason = String(data.get('reason') ?? '').trim()
    setError(''); setMessage(''); problems.clear()
    if (!email || reason.length < 8 || reason.length > 500) {
      problems.refuse(!email ? 'registration-email' : 'registration-enroll-reason', 'Enter a valid email and an enrollment reason between 8 and 500 characters.'); return
    }
    const key = enrollmentKey.forInput(JSON.stringify([facilityId, registrationCase.caseId, registrationCase.version, email, reason]))
    setBusy(true)
    try {
      const result = await staffApi.enrollRegistration(facilityId, registrationCase, email, reason, key)
      if (currentFacility.current !== facilityId) return
      setEnrollment(result)
      setMessage('A pending patient account was created. Contact ownership and password setup still require verification.')
      focus('registration-case-title', true)
    } catch (caught) {
      if (currentFacility.current === facilityId) setError(safeError(caught, 'Account enrollment could not be completed. The patient may already have an account.'))
    } finally { if (currentFacility.current === facilityId) setBusy(false) }
  }

  if (!facilityId || !canWrite) return <EmptyState titleAs="h1" title="Registration unavailable" description="This facility membership needs identity registration write permission." />
  const registration = registrationCase
  return <>
    <div className="staff-page-head"><p className="staff-eyebrow">Identity operations</p><h1>Patient registration.</h1><p>Verify a NIN, review possible matches, and link the verified identity to a governed Health ID. Every step is tied to your active facility and recorded by the backend.</p></div>
    <div className="staff-stack">
      <Card className="staff-card">
        <div className="staff-row"><h2>Verification availability</h2><Button tone="secondary" size="sm" aria-disabled={capabilityLoading || undefined} className={BUSY} onClick={() => { if (!capabilityLoading) void refreshCapabilities() }}>{capabilityLoading ? 'Checking…' : 'Check again'}</Button></div>
        {capabilityError && <p role="alert" className="staff-error">{capabilityError}</p>}
        {!capabilities && !capabilityError && <p className="staff-muted">Checking the backend’s registration capability…</p>}
        {capabilities && <p className="staff-muted">{capabilities.nin.enabled
          ? `NIN verification is enabled in ${capabilities.nin.state} mode.`
          : `NIN verification is ${capabilities.nin.state}. New cases cannot be started here until the backend enables a verification provider.`}</p>}
      </Card>

      {capabilities?.nin.enabled && <Card className="staff-card"><h2>Start with verified identity</h2><p>Enter the NIN and matching demographic claims. The NIN is sent directly to the identity service and is cleared from this form after a successful response.</p>
        <form className="staff-form" onInput={() => { resolveKey.current = crypto.randomUUID() }} onSubmit={event => void resolve(event)}>
          {/* Not disabled while the NIN is verified, which would take focus from the button: read-only. */}
          <fieldset className="staff-form">
            <Field label="National Identity Number" htmlFor="registration-nin" error={problems.error('registration-nin')} required><Input {...problems.control('registration-nin')} id="registration-nin" name="nin" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{11}" minLength={11} maxLength={11} readOnly={busy} required /></Field>
            <div className="staff-form-row"><Field label="First name" htmlFor="registration-first" error={problems.error('registration-first')} required><Input {...problems.control('registration-first')} id="registration-first" name="firstName" maxLength={100} autoComplete="off" readOnly={busy} required /></Field><Field label="Last name" htmlFor="registration-last" error={problems.error('registration-last')} required><Input {...problems.control('registration-last')} id="registration-last" name="lastName" maxLength={100} autoComplete="off" readOnly={busy} required /></Field></div>
            <div className="staff-form-row"><Field label="Date of birth" htmlFor="registration-dob" error={problems.error('registration-dob')} required><Input {...problems.control('registration-dob')} id="registration-dob" name="dateOfBirth" type="date" readOnly={busy} required /></Field><Field label="Gender (optional)" htmlFor="registration-gender"><Select id="registration-gender" name="gender"><option value="">Not supplied</option><option value="female">Female</option><option value="male">Male</option><option value="intersex">Intersex</option><option value="other">Other</option><option value="unknown">Unknown</option></Select></Field></div>
            <Button type="submit" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Verifying…' : 'Verify and create case'}</Button>
          </fieldset>
        </form>
      </Card>}

      <Card className="staff-card"><h2>Resume a registration case</h2><p>Use the case ID supplied when verification completed. The backend does not provide a searchable case list.</p>
        <form className="staff-form" onSubmit={event => { event.preventDefault(); if (!caseLoading && !busy) void loadCase(caseIdInput) }}>
          <Field label="Registration case ID" htmlFor="registration-case-id" error={problems.error('registration-case-id')} required><Input {...problems.control('registration-case-id')} id="registration-case-id" value={caseIdInput} onChange={event => setCaseIdInput(event.target.value)} autoComplete="off" required /></Field>
          <div className="staff-row"><Button type="submit" aria-disabled={caseLoading || busy || undefined} className={BUSY}>{caseLoading ? 'Loading…' : 'Load case'}</Button>{registration && <Button type="button" tone="secondary" aria-disabled={caseLoading || busy || undefined} className={BUSY} onClick={() => { if (!caseLoading && !busy) void loadCase(registration.caseId) }}>Refresh current case</Button>}</div>
        </form>
      </Card>

      {registration && <Card className="staff-card"><div className="staff-row"><h2 id="registration-case-title" tabIndex={-1}>Case {registration.caseId}</h2><Badge tone={completed.has(registration.status) ? 'success' : 'information'}>{statusLabel(registration.status)}</Badge></div>
        <p>Version {registration.version}. {registration.candidateCount > 0 ? `${registration.candidateCount} possible existing patient${registration.candidateCount === 1 ? '' : 's'}.` : 'No possible existing patients reported.'}</p>
        {registration.patient && <p><strong>Health ID:</strong> {registration.patient.hid}</p>}
        {registration.status === 'review_required' && <div className="staff-stack"><p className="staff-notice">A possible existing patient was found. Only a listed candidate may be linked. This API does not support overriding the match review to create a new identity.</p>
          {registration.candidates?.length ? <div className="staff-list">{registration.candidates.map(candidate => <div className="staff-list-item" key={candidate.patientId}><strong>{candidate.fullName}</strong><p>Date of birth: {candidate.dateOfBirth ?? 'Not provided'} · Patient ID: {candidate.patientId}</p></div>)}</div> : <p className="staff-error">Candidate details are unavailable. Refresh this case before reviewing it.</p>}
          {canApprove && Boolean(registration.candidates?.length) && <form className="staff-form" onSubmit={event => void review(event, 'link')}><Field label="Candidate to link" htmlFor="registration-candidate" error={problems.error('registration-candidate')} required><Select {...problems.control('registration-candidate')} id="registration-candidate" name="patientId" required><option value="">Select a candidate</option>{registration.candidates?.map(candidate => <option value={candidate.patientId} key={candidate.patientId}>{candidate.fullName} · {candidate.dateOfBirth ?? 'date unknown'}</option>)}</Select></Field><Field label="Review reason" htmlFor="registration-link-reason" error={problems.error('registration-link-reason')} required><Textarea {...problems.control('registration-link-reason')} id="registration-link-reason" name="reason" minLength={8} maxLength={500} required /></Field><Button type="submit" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Saving…' : 'Link selected patient'}</Button></form>}
        </div>}
        {registration.status === 'pending_new_identity_approval' && <><p className="staff-notice">Verification found no candidate. An authorized reviewer may approve a new Health ID.</p>{canApprove && <form className="staff-form" onSubmit={event => void review(event, 'approve')}><Field label="Approval reason" htmlFor="registration-approve-reason" error={problems.error('registration-approve-reason')} required><Textarea {...problems.control('registration-approve-reason')} id="registration-approve-reason" name="reason" minLength={8} maxLength={500} required /></Field><Button type="submit" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Saving…' : 'Approve new Health ID'}</Button></form>}</>}
        {completed.has(registration.status) && canApprove && !enrollment && <form className="staff-form" onSubmit={event => void enroll(event)}><h3>Enroll patient account</h3><p>This creates a pending account for a patient who does not already have one. The email must belong to the patient; contact verification and password setup follow separately.</p><Field label="Patient email" htmlFor="registration-email" error={problems.error('registration-email')} required><Input {...problems.control('registration-email')} id="registration-email" name="email" type="email" maxLength={254} autoComplete="off" required /></Field><Field label="Enrollment reason" htmlFor="registration-enroll-reason" error={problems.error('registration-enroll-reason')} required><Textarea {...problems.control('registration-enroll-reason')} id="registration-enroll-reason" name="reason" minLength={8} maxLength={500} required /></Field><Button type="submit" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Enrolling…' : 'Create pending patient account'}</Button></form>}
        {enrollment && <p className="staff-success">Pending account created for {enrollment.hid}. Contact verification is required.</p>}
      </Card>}
      {error && <div role="alert"><p className="staff-error">{error}</p></div>}
      {/* Mounted throughout, so what a step says is announced. */}
      <div id="registration-status" role="status">{message && <p className="staff-success">{message}</p>}</div>
    </div>
  </>
}
