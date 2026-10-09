import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge, Button, Card, Field, Input, Select, Textarea } from '@hid/ui'
import { isAllowedPatientLookup, staffApi } from '../api'
import { useStaff } from '../App'

const HID_PATTERN = /^HID-[A-HJ-NP-Z2-9]{6,32}$/

export function Patients() {
  const { state, activePatient, setActivePatient } = useStaff()
  const navigate = useNavigate()
  const facility = state.status === 'ready' ? state.session.actor.facility : undefined
  const permissions = facility?.permissions ?? []
  const [hid, setHid] = useState('')
  const [reason, setReason] = useState('')
  const [emergencyReason, setEmergencyReason] = useState('')
  const [pin, setPin] = useState('')
  const [scope, setScope] = useState<'read_records' | 'write_records'>('read_records')
  const [mode, setMode] = useState<'request' | 'pin' | 'emergency'>('request')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const normalized = hid.trim().toUpperCase()
  // The grant that authorized the open record, however it was obtained (an
  // approved request, the patient's PIN or emergency access), as the lookup
  // reported it, so it can be closed after a reload or from a later visit.
  const grantId = activePatient?.lookup.authorization.consentGrantId ?? null

  function clearFeedback() { setMessage(''); setError('') }

  async function openPatient(purpose: 'direct-care' | 'emergency', candidate = normalized) {
    if (!facility) throw new Error('Select an active facility first.')
    const lookup = await staffApi.lookupPatient(facility.id, candidate, purpose)
    if (!isAllowedPatientLookup(lookup)) {
      setActivePatient(null)
      throw new Error('The backend has not granted access to this patient. Request approval, verify their PIN, or use documented emergency access when justified.')
    }
    setActivePatient({ hid: candidate, lookup, purpose })
    navigate('/provider/clinical')
  }

  async function checkAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); clearFeedback(); setBusy(true)
    try { await openPatient('direct-care') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Patient access could not be verified.') }
    finally { setBusy(false) }
  }

  async function submitAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); clearFeedback(); setBusy(true)
    try {
      if (!facility) throw new Error('Select a facility first.')
      if (mode === 'request') {
        if (reason.trim().length < 8) throw new Error('Enter a clinical reason of at least 8 characters.')
        const request = await staffApi.requestAccess(facility.id, normalized, scope, reason.trim(), 60)
        setMessage(`Request ${request.accessRequestId} is ${request.status}. The patient must approve before records are available.`)
      } else if (mode === 'pin') {
        if (!/^\d{4,8}$/.test(pin.trim())) throw new Error('Enter the patient’s 4 to 8 digit access PIN.')
        await staffApi.verifyPin(facility.id, normalized, pin.trim())
        await openPatient('direct-care')
      } else {
        if (emergencyReason.trim().length < 8) throw new Error('Document the emergency reason in at least 8 characters.')
        await staffApi.breakGlass(facility.id, normalized, emergencyReason.trim())
        await openPatient('emergency')
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The access command failed.') }
    finally { setBusy(false) }
  }

  async function closeGrant() {
    if (!facility || !grantId) return
    clearFeedback(); setBusy(true)
    try { await staffApi.closeGrant(facility.id, grantId, 'Clinician closed completed patient access'); setActivePatient(null); setMessage('Access was closed by the backend.') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Grant could not be closed.') }
    finally { setBusy(false) }
  }

  return <>
    <div className="staff-page-head"><p className="staff-eyebrow">Governed access</p><h1>Open a patient record.</h1><p>Enter the patient’s Health ID. Their identity and records remain hidden until the backend authorizes this facility and purpose.</p></div>
    {activePatient && <Card className="staff-card staff-current"><h2>{activePatient.purpose === 'emergency' ? 'Current emergency summary' : 'Current authorized record'}</h2><div className="staff-row"><strong>{activePatient.lookup.patient.fullName ?? activePatient.hid}</strong><Badge tone={activePatient.purpose === 'emergency' ? 'danger' : 'success'}>{activePatient.purpose === 'emergency' ? 'Emergency access' : 'Access allowed'}</Badge><Link to="/provider/clinical" className="staff-text-link">{activePatient.purpose === 'emergency' ? 'Open read-only emergency summary →' : 'Open clinical record →'}</Link></div>{grantId && <Button tone="secondary" size="sm" onClick={() => void closeGrant()} disabled={busy}>Close my grant</Button>}</Card>}
    <div className="staff-two-col">
      <Card className="staff-card"><h2>Check current access</h2><p>Already approved? Verify with the server before opening the chart.</p><form className="staff-form" onSubmit={event => void checkAccess(event)}><Field label="Health ID" htmlFor="patient-hid" required><Input id="patient-hid" autoComplete="off" placeholder="HID-…" value={hid} onChange={event => setHid(event.target.value.toUpperCase())} required /></Field><Button type="submit" disabled={busy || !facility || !HID_PATTERN.test(normalized) || !permissions.includes('identity.patient.read')}>Verify access</Button></form></Card>
      <Card className="staff-card"><h2>Obtain access</h2><div className="staff-tabs" role="tablist" aria-label="Access method"><button type="button" role="tab" aria-selected={mode === 'request'} className={mode === 'request' ? 'active' : ''} onClick={() => setMode('request')}>Request</button><button type="button" role="tab" aria-selected={mode === 'pin'} className={mode === 'pin' ? 'active' : ''} onClick={() => setMode('pin')}>Patient PIN</button><button type="button" role="tab" aria-selected={mode === 'emergency'} className={mode === 'emergency' ? 'active' : ''} onClick={() => setMode('emergency')}>Emergency</button></div>
        <form className="staff-form" onSubmit={event => void submitAccess(event)}>
          {mode === 'request' && <><p className="staff-muted">Ask the patient to approve access. A pending request does not expose their record.</p><Field label="Access scope" htmlFor="request-scope"><Select id="request-scope" value={scope} onChange={event => setScope(event.target.value as 'read_records' | 'write_records')}><option value="read_records">Read records</option><option value="write_records">Read and write records</option></Select></Field><Field label="Clinical reason" htmlFor="request-reason" required><Textarea id="request-reason" value={reason} onChange={event => setReason(event.target.value)} minLength={8} required /></Field></>}
          {mode === 'pin' && <><p className="staff-muted">Only the patient should share their access PIN. Verification and grant creation happen on the server.</p><Field label="Patient access PIN" htmlFor="patient-pin" required><Input id="patient-pin" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={event => setPin(event.target.value)} required /></Field></>}
          {mode === 'emergency' && <><div className="staff-notice staff-danger">Use emergency access only when the patient cannot consent and care cannot wait. The action is time limited and audited. The available EHR view contains completed encounters and signed notes only.</div><Field label="Emergency reason" htmlFor="emergency-reason" required><Textarea id="emergency-reason" value={emergencyReason} onChange={event => setEmergencyReason(event.target.value)} minLength={8} required /></Field></>}
          <Button type="submit" disabled={busy || !facility || !HID_PATTERN.test(normalized) || (mode === 'request' && !permissions.includes('identity.consent.write')) || (mode === 'pin' && !permissions.includes('identity.patient-access-pin.verify')) || (mode === 'emergency' && !permissions.includes('identity.break-glass.write'))}>{busy ? 'Working…' : mode === 'request' ? 'Send access request' : mode === 'pin' ? 'Verify PIN and open' : 'Activate emergency access'}</Button>
        </form>
      </Card>
    </div>
    {(error || message) && <div className="staff-feedback" role={error ? 'alert' : 'status'}><p className={error ? 'staff-error' : 'staff-success'}>{error || message}</p></div>}
  </>
}
