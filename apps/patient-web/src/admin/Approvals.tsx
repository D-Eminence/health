import { useCallback, useState, type FormEvent } from 'react'
import {
  adminApi, type AdminActor, type ApprovalDecided, type ApprovalDecision, type ApprovalRequest, type ApprovalStatus,
} from './api'
import { LoadMore, Page, Refresh, ResourceView, Status, date, label, useCursorPages, useGovernedSubmit, useResource } from './ui'

const FILTERS: Array<{ value: ApprovalStatus | null; title: string }> = [
  { value: 'pending', title: 'Pending' }, { value: null, title: 'All' }, { value: 'approved', title: 'Approved' },
  { value: 'rejected', title: 'Rejected' }, { value: 'cancelled', title: 'Cancelled' }, { value: 'expired', title: 'Expired' },
]

function describe(request: ApprovalRequest) {
  if (request.action === 'mfa.reset') return 'Reset authenticator'
  return request.roleCode === 'platform_super_admin' ? 'Grant Super Admin' : `Grant ${label(request.roleCode ?? 'platform role')}`
}

function who(accountId: string | null, actor: AdminActor) {
  if (!accountId) return 'Not recorded'
  return accountId === actor.accountId ? 'You' : accountId
}

function outcome(result: ApprovalDecided, request: ApprovalRequest) {
  const target = request.targetDisplayName || request.targetEmail || 'The administrator'
  if (result.status === 'approved' && result.executed) {
    return request.action === 'mfa.reset'
      ? `Approved and carried out. ${target}’s authenticator and sessions were revoked; they set up a new authenticator at next sign-in.`
      : `Approved and carried out. ${target} is now a Super Admin.`
  }
  if (result.status === 'rejected') return 'Request rejected. Nothing was changed.'
  if (result.status === 'cancelled') return 'Request cancelled. Nothing was changed.'
  return `Request is now ${label(result.status).toLowerCase()}.`
}

function DecisionForm({ request, actor, onDecided }: {
  request: ApprovalRequest; actor: AdminActor; onDecided: (message: string) => void
}) {
  const [reason, setReason] = useState('')
  // The decision being submitted, for button labels only. Each button passes
  // its own decision, so a click can never send another button's decision.
  const [pending, setPending] = useState<ApprovalDecision | null>(null)
  const governed = useGovernedSubmit()
  const requester = request.requestedBy === actor.accountId
  const target = request.targetAccountId === actor.accountId
  const superAdmin = actor.platformRoles.includes('platform_super_admin')
  const ready = !governed.busy && reason.trim().length >= 8

  async function decide(decision: ApprovalDecision) {
    if (!ready) return
    setPending(decision)
    const decided = await governed.submit(idempotencyKey => adminApi.decideApproval(request, decision, reason.trim(), idempotencyKey),
      'The decision could not be recorded.')
    setPending(null)
    if (decided) { setReason(''); onDecided(outcome(decided, request)) }
  }

  return <form className="admin-action-form" onSubmit={(event: FormEvent<HTMLFormElement>) => event.preventDefault()}>
    {requester && <p className="admin-note">You made this request. A different Super Admin must approve or reject it;
      you can cancel it.</p>}
    {target && !requester && <p className="admin-note">This request changes your own account, so another Super Admin
      must decide it.</p>}
    {!superAdmin && !requester && <p className="admin-note">Only a Super Admin other than the requester and the affected
      administrator can decide. The server checks this when you submit.</p>}
    <p className="admin-note">Deciding is a critical action: it needs your authenticator confirmation and is recorded
      in the audit log with your reason.</p>
    <label>Reason for your decision<textarea required minLength={8} maxLength={500} rows={2}
      value={reason} onChange={event => setReason(event.target.value)} /></label>
    <div className="admin-action-row">
      <button type="button" className="admin-primary" onClick={() => void decide('approve')}
        disabled={!ready}>{pending === 'approve' ? 'Approving…' : 'Approve'}</button>
      <button type="button" className="admin-secondary" onClick={() => void decide('reject')}
        disabled={!ready}>{pending === 'reject' ? 'Rejecting…' : 'Reject'}</button>
      {requester && <button type="button" className="admin-secondary" onClick={() => void decide('cancel')}
        disabled={!ready}>{pending === 'cancel' ? 'Cancelling…' : 'Cancel request'}</button>}
    </div>
    {governed.error && <p role="alert" className="admin-error">{governed.error}</p>}
  </form>
}

function ApprovalCard({ request, actor, onDecided }: {
  request: ApprovalRequest; actor: AdminActor; onDecided: (message: string) => void
}) {
  const target = request.targetDisplayName || request.targetEmail || request.targetAccountId
  return <article className="admin-tile admin-approval" data-status={request.status}>
    <div className="admin-panel-head"><h2>{describe(request)}</h2><Status value={request.status} /></div>
    <dl className="admin-detail-grid">
      <div><dt>Administrator</dt><dd>{target}{request.targetEmail && request.targetDisplayName ? <small>{request.targetEmail}</small> : null}</dd></div>
      <div><dt>Requested by</dt><dd>{who(request.requestedBy, actor)}</dd></div>
      <div><dt>Requested</dt><dd>{date(request.requestedAt)}</dd></div>
      <div><dt>{request.status === 'pending' ? 'Expires' : 'Expiry'}</dt><dd>{date(request.expiresAt)}</dd></div>
      <div><dt>Reason</dt><dd>{request.reason}</dd></div>
      {request.decidedAt && <div><dt>Decided</dt><dd>{who(request.decidedBy, actor)} · {date(request.decidedAt)}</dd></div>}
      {request.decisionReason && <div><dt>Decision reason</dt><dd>{request.decisionReason}</dd></div>}
      {request.executedAt && <div><dt>Carried out</dt><dd>{date(request.executedAt)}</dd></div>}
    </dl>
    {request.status === 'expired' && <p className="admin-note">This request expired 24 hours after it was made and was
      never carried out. Create a new request if the change is still needed.</p>}
    {request.status === 'pending' && <DecisionForm request={request} actor={actor} onDecided={onDecided} />}
  </article>
}

/** Two-person approvals. The backend decides who may request, approve, reject or cancel. */
export function ApprovalsPage({ actor }: { actor: AdminActor }) {
  const [filter, setFilter] = useState<ApprovalStatus | null>('pending')
  const load = useCallback((signal?: AbortSignal) => adminApi.approvals(filter, {}, signal), [filter])
  const resource = useResource(load, 'Approval requests could not be loaded.')
  const pages = useCursorPages(resource, (cursor, signal) => adminApi.approvals(filter, { cursor }, signal),
    'More approval requests could not be loaded.')
  const [notice, setNotice] = useState<string | null>(null)

  return <Page eyebrow="Two-person control" title="Approvals"
    description="Granting Super Admin and resetting an administrator’s authenticator need a second Super Admin. Requests expire after 24 hours."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <div className="admin-filter" role="group" aria-label="Request status">
      {FILTERS.map(item => <button key={item.title} type="button" aria-pressed={filter === item.value}
        className={filter === item.value ? 'admin-primary' : 'admin-secondary'}
        onClick={() => { setNotice(null); setFilter(item.value) }}>{item.title}</button>)}
    </div>
    {notice && <p role="status" className="admin-success">{notice}</p>}
    <ResourceView resource={resource} empty={result => result.items.length === 0}>{() => <div className="admin-stack">
      <p className="admin-result-count">Showing {pages.items.length} requests, newest first{pages.hasMore ? '; more are available' : ''}</p>
      {pages.items.map(request => <ApprovalCard key={`${request.id}:${request.version}`} request={request} actor={actor}
        onDecided={message => { setNotice(message); resource.reload() }} />)}
      <LoadMore pages={pages} label="Load more requests" />
    </div>}</ResourceView>
  </Page>
}
