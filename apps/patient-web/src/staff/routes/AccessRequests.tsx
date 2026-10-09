import { useEffect, useState } from 'react'
import { isHidApiError } from '@hid/http'
import { Badge, Button, Card, EmptyState, Field, Select } from '@hid/ui'
import { ACCESS_REQUEST_STATUSES, staffApi, type AccessRequest, type AccessRequestStatus } from '../api'
import { useStaff } from '../App'

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

function outcome(request: AccessRequest) {
  const key = request.effectiveStatus ?? request.status
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

export function AccessRequests() {
  const { state } = useStaff()
  const facility = state.status === 'ready' ? state.session.actor.facility : undefined
  const [status, setStatus] = useState<AccessRequestStatus | ''>('')
  const [requests, setRequests] = useState<AccessRequest[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [closing, setClosing] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  async function load(signal?: { active: boolean }) {
    if (!facility) return
    setLoading(true); setError('')
    try {
      const items = await staffApi.listAccessRequests(facility.id, status || undefined)
      if (signal?.active !== false) setRequests(items)
    } catch (caught) { if (signal?.active !== false) { setRequests(null); setError(accessRequestsError(caught)) } }
    finally { if (signal?.active !== false) setLoading(false) }
  }

  async function closeAccess(request: AccessRequest) {
    if (!facility || !request.consentGrantId || closing) return
    setClosing(request.accessRequestId); setError(''); setNotice('')
    try {
      await staffApi.closeGrant(facility.id, request.consentGrantId, 'Clinician closed completed patient access')
      setNotice('Access was closed by the backend.')
      await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Access could not be closed.') }
    finally { setClosing(null) }
  }

  useEffect(() => {
    const signal = { active: true }
    setRequests(null)
    void load(signal)
    return () => { signal.active = false }
  }, [facility?.id, status])
  return <>
    <div className="staff-page-head"><p className="staff-eyebrow">Patient consent</p><h1>Access requests.</h1><p>Requests are scoped to your active facility and staff account. A pending request never grants record access.</p></div>
    <div className="staff-row staff-toolbar">
      <Field label="Status" htmlFor="access-request-status"><Select id="access-request-status" value={status}
        onChange={event => setStatus(event.target.value as AccessRequestStatus | '')}>
        <option value="">Any status</option>
        {ACCESS_REQUEST_STATUSES.map(value => <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>)}
      </Select></Field>
      <Button tone="secondary" size="sm" onClick={() => void load()} disabled={loading}>Refresh</Button>
    </div>
    {error && <p className="staff-error" role="alert">{error}</p>}
    {notice && <p className="staff-success" role="status">{notice}</p>}
    {loading && !requests && <p className="staff-muted" role="status">Loading requests…</p>}
    {requests && requests.length === 0 && <EmptyState title={status ? `No ${status} access requests` : 'No access requests'} description="Requests you send for this facility will appear here." />}
    {requests && requests.length > 0 && <Card className="staff-table-wrap"><table className="staff-table"><thead><tr><th>Requested</th><th>Patient context</th><th>Scope</th><th>Reason</th><th>Status</th></tr></thead><tbody>{requests.map(request => <tr key={request.accessRequestId}><td>{new Date(request.requestedAt).toLocaleString()}</td><td>Patient ••••{request.patientId.slice(-4)}</td><td>{request.scope.replace('_', ' ')}</td><td>{request.reason}</td><td><Badge tone={outcome(request).tone}>{outcome(request).label}</Badge>
      {request.authorizationMethod && <small className="staff-muted"> {request.authorizationMethod === 'patient_access_pin' ? 'Patient PIN' : 'Patient approval'}</small>}
      {request.effectiveStatus === 'active' && request.grantExpiresAt && <small className="staff-muted"> until {new Date(request.grantExpiresAt).toLocaleString()}</small>}
      {request.status === 'denied' && request.deniedReason && <small className="staff-muted"> {request.deniedReason}</small>}
      {request.effectiveStatus === 'active' && request.consentGrantId && <Button tone="secondary" size="sm"
        onClick={() => void closeAccess(request)} disabled={closing !== null}>{closing === request.accessRequestId ? 'Closing…' : 'Close access'}</Button>}</td></tr>)}</tbody></table></Card>}
    {requests && requests.length === 100 && <p className="staff-muted">Showing the 100 most recent requests.</p>}
  </>
}
