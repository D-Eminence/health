import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { findEndpoint, type EndpointMethod } from '@hid/contracts'
import { Badge, Button, Card, Field, Input, Select, Textarea } from '@hid/ui'
import { isAllowedPatientLookup, staffApi } from '../api'
import { useStaff } from '../App'
import { BUSY, useFocusById } from '../focus'
import { useFieldProblems } from '../useFieldProblems'
import { staffSessionGeneration, untilStaffSessionReady } from '../session'

const HID_PATTERN = /^HID-[A-HJ-NP-Z2-9]{6,32}$/
const HID_FORMAT = 'Starts with HID-, then 6 to 32 letters and digits. Health IDs never use 0, 1, I or O.'

type AccessMethod = 'request' | 'pin' | 'emergency'

interface MethodRoute { readonly route: string; readonly method: EndpointMethod; readonly purpose?: string }
interface Action { readonly routes: readonly MethodRoute[]; readonly action: string }

// Each backend route a method calls, whose every listed permission the role must
// hold (contracts registry, verified in hid-system): the access step itself, where
// emergency access needs identity.consent.write as well as identity.break-glass.write
// (identity consent.controller.ts); then, for the PIN and emergency access, the
// patient lookup that opens the record (identity.controller.ts), and for emergency
// access the summary that record is (ehr patient-records.controller.ts). Without
// those, the grant would be made, audited and perhaps told to the patient, and the
// record still refused.
const METHOD_ROUTES: Record<AccessMethod, Action> = {
  request: { routes: [{ route: 'access.staffRequests', method: 'POST' }], action: 'send access requests' },
  pin: { routes: [{ route: 'access.verifyPin', method: 'POST' },
    { route: 'identity.patientLookup', method: 'POST', purpose: 'to open the record' }], action: 'verify a patient’s PIN' },
  emergency: { routes: [{ route: 'access.breakGlass', method: 'POST' },
    { route: 'identity.patientLookup', method: 'POST', purpose: 'to open the record' },
    { route: 'ehr.emergencyRecords', method: 'GET', purpose: 'to read the emergency summary' }], action: 'activate emergency access' },
}
// Closing the grant that opened the record (identity consent.controller.ts closeOwnGrant).
const CLOSE_GRANT: Action = { routes: [{ route: 'access.closeOwnGrant', method: 'POST' }], action: 'close this grant' }

/** Why the role cannot take `action`, or null when it holds every permission its routes require. */
function actionUnavailable({ routes, action }: Action, permissions: readonly string[]): string | null {
  const needs = routes.map(item => ({ ...item, required: findEndpoint(item.route)?.permissions?.[item.method] ?? [] }))
  // A route the registry does not describe is never offered.
  if (needs.some(item => item.required.length === 0)) return `This portal cannot ${action} here.`
  const required = new Set(needs.flatMap(item => item.required))
  const missing = needs.flatMap(item => {
    const lacking = item.required.filter(permission => !permissions.includes(permission))
    return lacking.length ? [`${lacking.join(' and ')}${item.purpose ? ` ${item.purpose}` : ''}`] : []
  })
  const missingCount = [...required].filter(permission => !permissions.includes(permission)).length
  return missing.length === 0 ? null
    : `Your role at this facility cannot ${action}: it ${missingCount < required.size ? 'also ' : ''}needs ${missing.join(', and ')}. Ask your organization administrator.`
}

/** Why `normalized` is not a Health ID, or null when it is one. */
function healthIdProblem(normalized: string): string | null {
  if (!normalized) return 'Enter the patient’s Health ID.'
  return HID_PATTERN.test(normalized) ? null
    : 'Check the Health ID: it starts with HID-, then 6 to 32 letters and digits, and never uses 0, 1, I or O.'
}

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
  const [mode, setMode] = useState<AccessMethod>('request')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  // Closing the open record's grant removes the card that did it: focus goes to the page heading.
  const focus = useFocusById()
  // A reason or PIN refused before sending is reported at its field (PEHR-04).
  const problems = useFieldProblems()
  // A Health ID refused before sending is reported at its field, which takes focus,
  // and the field's description announces it. Refused from Enter in the field, focus
  // does not move, so the message is an alert instead, new for each refusal; as both
  // it would be spoken twice.
  const [hidError, setHidError] = useState('')
  const [hidAlert, setHidAlert] = useState(false)
  const [focusHid, setFocusHid] = useState(0)
  useEffect(() => { if (focusHid) document.getElementById('patient-hid')?.focus() }, [focusHid])
  const normalized = hid.trim().toUpperCase()
  // The grant that authorized the open record, however it was obtained (an
  // approved request, the patient's PIN or emergency access), as the lookup
  // reported it, so it can be closed after a reload or from a later visit.
  const grantId = activePatient?.lookup.authorization.consentGrantId ?? null
  // A method the backend would refuse is not offered, and the reason is shown with it.
  const unavailable = actionUnavailable(METHOD_ROUTES[mode], permissions)
  const closeUnavailable = actionUnavailable(CLOSE_GRANT, permissions)

  function clearFeedback() { setMessage(''); setError(''); problems.clear() }

  /** False, with the reason shown at the Health ID field and focus there, when the Health ID cannot be sent. */
  function healthIdAccepted(): boolean {
    const problem = healthIdProblem(normalized)
    setHidError(problem ?? '')
    setHidAlert(problem !== null && document.activeElement?.id === 'patient-hid')
    if (problem) setFocusHid(value => value + 1)
    return problem === null
  }

  async function openPatient(purpose: 'direct-care' | 'emergency', candidate = normalized) {
    if (!facility) throw new Error('Select an active facility first.')
    const lookup = await staffApi.lookupPatient(facility.id, candidate, purpose)
    if (!isAllowedPatientLookup(lookup)) {
      setActivePatient(null)
      throw new Error('The backend has not granted access to this patient. Request approval, verify their PIN, or use documented emergency access when justified.')
    }
    // A lookup answered after the session or facility changed opens nothing.
    if (setActivePatient({ hid: candidate, lookup, purpose })) navigate('/provider/clinical')
  }

  async function checkAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // A button stays focusable while its request runs; a second press does nothing.
    if (busy) return
    clearFeedback()
    if (!healthIdAccepted()) return
    setBusy(true)
    try { await openPatient('direct-care') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Patient access could not be verified.') }
    finally { setBusy(false) }
  }

  async function submitAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    clearFeedback()
    if (!healthIdAccepted()) return
    if (mode === 'request' && reason.trim().length < 8) return problems.refuse('request-reason', 'Enter a clinical reason of at least 8 characters.')
    // Identity removes every space from a PIN before checking it (VerifyPatientAccessPinDto), so a PIN typed in groups is one PIN.
    const compactPin = pin.replace(/\s+/g, '')
    if (mode === 'pin' && !/^\d{4,8}$/.test(compactPin)) return problems.refuse('patient-pin', 'Enter the patient’s 4 to 8 digit access PIN.')
    if (mode === 'emergency' && emergencyReason.trim().length < 8) return problems.refuse('emergency-reason', 'Document the emergency reason in at least 8 characters.')
    setBusy(true)
    // The record opens after the grant only while the session that obtained it is
    // ready: it waits while that session is checked, and never opens once it ended.
    const sentIn = staffSessionGeneration()
    try {
      if (!facility) throw new Error('Select a facility first.')
      if (mode === 'request') {
        const request = await staffApi.requestAccess(facility.id, normalized, scope, reason.trim(), 60)
        setMessage(`Request ${request.accessRequestId} is ${request.status}. The patient must approve before records are available.`)
      } else if (mode === 'pin') {
        await staffApi.verifyPin(facility.id, normalized, compactPin)
        await untilStaffSessionReady(sentIn)
        await openPatient('direct-care')
      } else {
        await staffApi.breakGlass(facility.id, normalized, emergencyReason.trim())
        await untilStaffSessionReady(sentIn)
        await openPatient('emergency')
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The access command failed.') }
    finally { setBusy(false) }
  }

  async function closeGrant() {
    if (!facility || !grantId || busy || closeUnavailable) return
    clearFeedback(); setBusy(true)
    try {
      await staffApi.closeGrant(facility.id, grantId, 'Clinician closed completed patient access'); setActivePatient(null); setMessage('Access was closed by the backend.')
      focus('patients-title', true)
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Grant could not be closed.') }
    finally { setBusy(false) }
  }

  return <>
    <div className="staff-page-head"><p className="staff-eyebrow">Governed access</p><h1 id="patients-title" tabIndex={-1}>Open a patient record.</h1><p>Enter the patient’s Health ID. Their identity and records remain hidden until the backend authorizes this facility and purpose.</p></div>
    {activePatient && <Card className="staff-card staff-current"><h2>{activePatient.purpose === 'emergency' ? 'Current emergency summary' : 'Current authorized record'}</h2><div className="staff-row"><strong>{activePatient.lookup.patient.fullName ?? activePatient.hid}</strong><Badge tone={activePatient.purpose === 'emergency' ? 'danger' : 'success'}>{activePatient.purpose === 'emergency' ? 'Emergency access' : 'Access allowed'}</Badge><Link to="/provider/clinical" className="staff-text-link">{activePatient.purpose === 'emergency' ? 'Open read-only emergency summary →' : 'Open clinical record →'}</Link></div>{grantId && <>{closeUnavailable && <p id="close-grant-unavailable" className="staff-muted">{closeUnavailable}</p>}<Button tone="secondary" size="sm" onClick={() => void closeGrant()} disabled={closeUnavailable !== null} aria-disabled={busy || undefined} className={BUSY} aria-describedby={closeUnavailable ? 'close-grant-unavailable' : undefined}>Close my grant</Button></>}</Card>}
    <div className="staff-two-col">
      <Card className="staff-card"><h2>Check current access</h2><p>Already approved? Verify with the server before opening the chart.</p><form className="staff-form" noValidate onSubmit={event => void checkAccess(event)}><Field label="Health ID" htmlFor="patient-hid" hint={HID_FORMAT} error={hidError ? hidAlert ? <span key={focusHid} role="alert">{hidError}</span> : hidError : undefined} required><Input id="patient-hid" autoComplete="off" placeholder="HID-…" value={hid} onChange={event => { setHid(event.target.value.toUpperCase()); setHidError('') }} required invalid={!!hidError} aria-describedby={hidError ? 'patient-hid-error' : 'patient-hid-hint'} /></Field><Button type="submit" disabled={!facility || !permissions.includes('identity.patient.read')} aria-disabled={busy || undefined} className={BUSY}>Verify access</Button></form></Card>
      <Card className="staff-card"><h2>Obtain access</h2><div className="staff-tabs" role="group" aria-label="Access method"><button type="button" aria-pressed={mode === 'request'} onClick={() => { problems.clear(); setMode('request') }}>Request</button><button type="button" aria-pressed={mode === 'pin'} onClick={() => { problems.clear(); setMode('pin') }}>Patient PIN</button><button type="button" aria-pressed={mode === 'emergency'} onClick={() => { problems.clear(); setMode('emergency') }}>Emergency</button></div>
        {/* The page checks each method's fields itself and says what is wrong at the field. */}
        <form className="staff-form" noValidate onSubmit={event => void submitAccess(event)}>
          {mode === 'request' && <><p className="staff-muted">Ask the patient to approve access. A pending request does not expose their record.</p><Field label="Access scope" htmlFor="request-scope"><Select id="request-scope" value={scope} onChange={event => setScope(event.target.value as 'read_records' | 'write_records')}><option value="read_records">Read records</option><option value="write_records">Read and write records</option></Select></Field><Field label="Clinical reason" htmlFor="request-reason" error={problems.error('request-reason')} required><Textarea id="request-reason" value={reason} onChange={event => setReason(event.target.value)} minLength={8} maxLength={500} required {...problems.control('request-reason')} /></Field></>}
          {mode === 'pin' && <><p className="staff-muted">Only the patient should share their access PIN. Verification and grant creation happen on the server.</p><Field label="Patient access PIN" htmlFor="patient-pin" hint="4 to 8 digits." error={problems.error('patient-pin')} required><Input id="patient-pin" type="password" inputMode="numeric" autoComplete="off" pattern="\s*(\d\s*){4,8}" maxLength={16} value={pin} onChange={event => setPin(event.target.value)} required aria-describedby="patient-pin-hint" {...problems.control('patient-pin')} /></Field></>}
          {mode === 'emergency' && <><div className="staff-notice staff-danger">Use emergency access only when the patient cannot consent and care cannot wait. The action is time limited and audited. It opens a read-only summary from this facility: completed encounters and signed notes, and the diagnoses, prescriptions, lab requests and documents your role may read. It shows no vital signs and opens no files.</div><Field label="Emergency reason" htmlFor="emergency-reason" error={problems.error('emergency-reason')} required><Textarea id="emergency-reason" value={emergencyReason} onChange={event => setEmergencyReason(event.target.value)} minLength={8} maxLength={500} required {...problems.control('emergency-reason')} /></Field></>}
          {unavailable && <p id="access-method-unavailable" className="staff-muted">{unavailable}</p>}
          <Button type="submit" disabled={!facility || unavailable !== null} aria-disabled={busy || undefined} className={BUSY} aria-describedby={unavailable ? 'access-method-unavailable' : undefined}>{busy ? 'Working…' : mode === 'request' ? 'Send access request' : mode === 'pin' ? 'Verify PIN and open' : 'Activate emergency access'}</Button>
        </form>
      </Card>
    </div>
    {error && <div className="staff-feedback" role="alert"><p className="staff-error">{error}</p></div>}
    {/* Mounted throughout, so what an access step says is announced. */}
    <div id="patients-status" role="status">{message && <div className="staff-feedback"><p className="staff-success">{message}</p></div>}</div>
  </>
}
