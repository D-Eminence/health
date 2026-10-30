import { useEffect, useRef, useState } from 'react'
import { isHidApiError } from '@hid/http'
import { Badge, Button, Card, EmptyState, Field, Select } from '@hid/ui'
import { ACCESS_OUTCOME_FILTERS, ACCESS_REQUEST_STATUSES, staffApi, type AccessRequest, type AccessRequestStatus } from '../api'
import { useStaff } from '../App'
import { UNAVAILABLE, useFocusById } from '../focus'
import { ehrCommands } from '../offline/ehrCommands'

/** How a request ended up, from its effective status (hid-system 0074) or, before that, its own status. */
const OUTCOMES: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  pending: { label: 'Waiting for the patient', tone: 'warning' },
  active: { label: 'Access active', tone: 'success' },
  approved: { label: 'Approved', tone: 'success' },
  expired: { label: 'Access expired', tone: 'neutral' },
  closed: { label: 'Closed by you', tone: 'neutral' },
  revoked: { label: 'Access revoked', tone: 'danger' },
  denied: { label: 'Denied by the patient', tone: 'neutral' },
}

/** Filter wording: the backend matches the request status or the approval's outcome. */
const FILTER_LABELS: Record<AccessRequestStatus, string> = {
  pending: 'Waiting for the patient', approved: 'Approved (any outcome)', denied: 'Denied',
  active: 'Access active', expired: 'Expired', closed: 'Closed by you', revoked: 'Revoked',
}

export function outcome(request: AccessRequest) {
  const key = request.effectiveStatus ?? request.status
  // A request that expired before the patient answered never gave access.
  if (key === 'expired' && !request.consentGrantId) return { label: 'Request expired', tone: 'neutral' as const }
  return OUTCOMES[key] ?? { label: key, tone: 'neutral' as const }
}

/** The backend's refusals of GET /identity/access-requests, in words a clinician can act on. */
export function accessRequestsError(caught: unknown): string {
  if (isHidApiError(caught)) {
    if (caught.code === 'CONSENT_COMMAND_DENIED' || caught.code === 'PERMISSION_DENIED') {
      return 'Your role at this facility cannot list access requests. Ask an administrator to review your assignment.'
    }
    if (caught.code === 'FACILITY_ACCESS_DENIED' || caught.code === 'FACILITY_REQUIRED') {
      return 'Select a facility where you are an active member to see your access requests.'
    }
  }
  return caught instanceof Error ? caught.message : 'Requests could not be loaded.'
}

function closeError(caught: unknown): string {
  if (isHidApiError(caught) && (caught.code === 'CONSENT_RESOURCE_NOT_FOUND' || caught.code === 'CONSENT_COMMAND_CONFLICT')) {
    return 'This access had already ended. The list has been refreshed.'
  }
  return caught instanceof Error ? caught.message : 'Access could not be closed.'
}

export function AccessRequests() {
  const { state, activePatient, setActivePatient } = useStaff()
  const facility = state.status === 'ready' ? state.session.actor.facility : undefined
  const [status, setStatus] = useState<AccessRequestStatus | ''>('')
  const [requests, setRequests] = useState<AccessRequest[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [closing, setClosing] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  // Closing a grant takes its Close access button away: focus goes to the page heading.
  const focus = useFocusById()
  // Outcome filters need an Identity build with hid-system 0074, which reports outcomes.
  const [outcomesReported, setOutcomesReported] = useState(false)
  // Only the latest load may update the list, whatever triggered it.
  const sequence = useRef(0)

  async function load() {
    if (!facility) return
    const current = ++sequence.current
    setLoading(true)
    try {
      const items = await staffApi.listAccessRequests(facility.id, status || undefined)
      if (current !== sequence.current) return
      setRequests(items); setError('')
      if (items.some(item => item.effectiveStatus !== undefined)) setOutcomesReported(true)
    } catch (caught) {
      if (current === sequence.current) { setRequests(null); setError(accessRequestsError(caught)) }
    } finally { if (current === sequence.current) setLoading(false) }
  }

  async function closeAccess(request: AccessRequest) {
    if (!facility || !request.consentGrantId || closing) return
    const grantId = request.consentGrantId
    setClosing(request.accessRequestId); setError(''); setNotice('')
    let failure = ''
    let saved = false
    try {
      // Through the device when offline is in use, so the close waits for the patient's unsent work and the patient
      // leaves this device first (A12.6, §2.8); without it, the staffApi call as before.
      saved = (await ehrCommands.closeGrant(facility.id, request.patientId, grantId, 'Clinician closed completed patient access')).kind === 'saved'
      // The open record, if this grant opened it, has ended too.
      if (activePatient?.lookup.authorization.consentGrantId === grantId) setActivePatient(null)
    } catch (caught) { failure = closeError(caught) }
    finally { setClosing(null) }
    // Reload either way, then report the close (the reload clears earlier messages).
    await load()
    if (failure) setError(failure)
    else setNotice(saved ? 'The patient was removed from this device. Access is closed when Health ID can be reached.'
      : 'Access was closed by the backend.')
    focus('access-requests-title', true)
  }

  useEffect(() => {
    setRequests(null)
    void load()
    return () => { sequence.current += 1 }
  }, [facility?.id, status])
  const filters = outcomesReported || ACCESS_OUTCOME_FILTERS.includes(status as never)
    ? [...ACCESS_REQUEST_STATUSES, ...ACCESS_OUTCOME_FILTERS] : ACCESS_REQUEST_STATUSES
  return <>
    <div className="staff-page-head"><p className="staff-eyebrow">Patient consent</p><h1 id="access-requests-title" tabIndex={-1}>Access requests.</h1><p>Requests are scoped to your active facility and staff account. A pending request never grants record access.</p></div>
    <div className="staff-row staff-toolbar">
      <Field label="Status" htmlFor="access-request-status"><Select id="access-request-status" value={status}
        onChange={event => setStatus(event.target.value as AccessRequestStatus | '')}>
        <option value="">Any status</option>
        {filters.map(value => <option key={value} value={value}>{FILTER_LABELS[value]}</option>)}
      </Select></Field>
      {/* Focusable while the list is read, when a second press does nothing. */}
      <Button tone="secondary" size="sm" aria-disabled={loading || undefined} className={UNAVAILABLE} onClick={() => { if (!loading) void load() }}>Refresh</Button>
    </div>
    {error && <p className="staff-error" role="alert">{error}</p>}
    {/* Mounted throughout, so what a close says is announced. */}
    <div id="access-requests-status" role="status">{notice ? <p className="staff-success">{notice}</p> : loading && !requests && <p className="staff-muted">Loading requests…</p>}</div>
    {requests && requests.length === 0 && <EmptyState title={status ? `No access requests: ${FILTER_LABELS[status].toLowerCase()}` : 'No access requests'} description="Requests you send for this facility will appear here." />}
    {requests && requests.length > 0 && <Card className="staff-table-wrap"><table className="staff-table"><thead><tr><th>Requested</th><th>Patient context</th><th>Scope</th><th>Reason</th><th>Status</th></tr></thead><tbody>{requests.map(request => <tr key={request.accessRequestId}><td>{new Date(request.requestedAt).toLocaleString()}</td><td>Patient ••••{request.patientId.slice(-4)}</td><td>{request.scope.replace('_', ' ')}</td><td>{request.reason}</td><td><Badge tone={outcome(request).tone}>{outcome(request).label}</Badge>
      {request.authorizationMethod && <small className="staff-muted"> {request.authorizationMethod === 'patient_access_pin' ? 'Patient PIN' : 'Patient approval'}</small>}
      {request.effectiveStatus === 'active' && request.grantExpiresAt && <small className="staff-muted"> until {new Date(request.grantExpiresAt).toLocaleString()}</small>}
      {request.status === 'denied' && request.deniedReason && <small className="staff-muted"> {request.deniedReason}</small>}
      {request.effectiveStatus === 'active' && request.consentGrantId && <Button tone="secondary" size="sm"
        onClick={() => void closeAccess(request)} disabled={closing !== null && closing !== request.accessRequestId}
        aria-disabled={closing === request.accessRequestId || undefined} className={UNAVAILABLE}>{closing === request.accessRequestId ? 'Closing…' : 'Close access'}</Button>}</td></tr>)}</tbody></table></Card>}
    {requests && requests.length === 100 && <p className="staff-muted">Showing the 100 most recent requests.</p>}
  </>
}
