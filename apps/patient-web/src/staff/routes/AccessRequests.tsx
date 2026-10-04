import { useEffect, useState } from 'react'
import { Badge, Button, Card, EmptyState } from '@hid/ui'
import { staffApi, type AccessRequest } from '../api'
import { useStaff } from '../App'

export function AccessRequests() {
  const { state } = useStaff()
  const facility = state.status === 'ready' ? state.session.actor.facility : undefined
  const [requests, setRequests] = useState<AccessRequest[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function load() {
    if (!facility) return
    setLoading(true); setError('')
    try { setRequests(await staffApi.listAccessRequests(facility.id)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Requests could not be loaded.') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [facility?.id])
  return <>
    <div className="staff-page-head"><p className="staff-eyebrow">Patient consent</p><h1>Access requests.</h1><p>Requests are scoped to your active facility and staff account. A pending request never grants record access.</p></div>
    <div className="staff-row staff-toolbar"><Button tone="secondary" size="sm" onClick={() => void load()} disabled={loading}>Refresh</Button></div>
    {error && <p className="staff-error" role="alert">{error}</p>}
    {loading && !requests && <p className="staff-muted" role="status">Loading requests…</p>}
    {requests && requests.length === 0 && <EmptyState title="No access requests" description="Requests you send for this facility will appear here." />}
    {requests && requests.length > 0 && <Card className="staff-table-wrap"><table className="staff-table"><thead><tr><th>Requested</th><th>Patient context</th><th>Scope</th><th>Reason</th><th>Status</th></tr></thead><tbody>{requests.map(request => <tr key={request.accessRequestId}><td>{new Date(request.requestedAt).toLocaleString()}</td><td>Patient ••••{request.patientId.slice(-4)}</td><td>{request.scope.replace('_', ' ')}</td><td>{request.reason}</td><td><Badge tone={request.status === 'approved' ? 'success' : request.status === 'pending' ? 'warning' : 'neutral'}>{request.status}</Badge></td></tr>)}</tbody></table></Card>}
  </>
}
