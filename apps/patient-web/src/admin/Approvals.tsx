import { useCallback, useState } from 'react'
import { Button, Card, DescriptionList, FilterTabs } from '../kasuwa/ui'
import {
  adminApi, type AdminActor, type ApprovalDecided, type ApprovalDecision, type ApprovalRequest, type ApprovalStatus,
} from './api'
import {
  LoadMore, Page, ReasonConfirm, Refresh, ResourceView, Status, Subject, date, label, useCursorPages, useResource, type ConfirmSpec,
} from './ui'

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
      ? `Approved. ${target} is signed out and sets up a new authenticator at next sign-in.`
      : `Approved. ${target} is now a Super Admin.`
  }
  if (result.status === 'rejected') return 'Request rejected. Nothing changed.'
  if (result.status === 'cancelled') return 'Request cancelled. Nothing changed.'
  return `The request is now ${label(result.status).toLowerCase()}.`
}

function targetName(request: ApprovalRequest) {
  return request.targetDisplayName || request.targetEmail || 'The administrator'
}

/** What a decision does, said before it is made. */
function decisionSpec(request: ApprovalRequest, decision: ApprovalDecision): ConfirmSpec {
  const name = targetName(request)
  const subject = <Subject name={describe(request)} detail={`For ${name} · requested ${date(request.requestedAt)}`} />
  const done = (result: unknown) => outcome(result as ApprovalDecided, request)
  if (decision === 'approve') return request.action === 'mfa.reset'
    ? { title: 'Approve the authenticator reset?', subject, effect: `${name}’s authenticator and recovery codes stop working, and they’re signed out everywhere.`,
      undo: 'This can’t be undone. They set up a new authenticator at next sign-in.', confirmLabel: 'Approve reset', destructive: true,
      stepUp: `approve the authenticator reset for ${name}`, done }
    : { title: `Make ${name} a Super Admin?`, subject, effect: `${name} becomes a Super Admin at once.`,
      undo: 'You can remove the role later from Users & roles.', confirmLabel: 'Approve', stepUp: `make ${name} a Super Admin`, done }
  if (decision === 'reject') return { title: 'Reject this request?', subject, effect: 'The request closes. Nothing changes.',
    undo: 'A new request can be made later.', confirmLabel: 'Reject', stepUp: 'reject this request', done }
  return { title: 'Cancel your request?', subject, effect: 'The request closes. Nothing changes.', undo: 'You can make a new request later.',
    confirmLabel: 'Cancel request', stepUp: 'cancel this request', done }
}

function DecisionForm({ request, actor, onDecided }: {
  request: ApprovalRequest; actor: AdminActor; onDecided: () => void
}) {
  // Each button opens its own decision's confirmation, so a confirm can never send another button's decision.
  const [deciding, setDeciding] = useState<ApprovalDecision | null>(null)
  const requester = request.requestedBy === actor.accountId
  const target = request.targetAccountId === actor.accountId
  const superAdmin = actor.platformRoles.includes('platform_super_admin')
  const rule = requester ? 'You made this request, so another Super Admin must decide. You can cancel it.'
    : target ? 'This changes your own account, so another Super Admin must decide.'
      : !superAdmin ? 'Only a Super Admin who didn’t make the request can decide.' : null

  return <div className="flex flex-col gap-3 border-t border-line pt-4">
    {rule && <p className="m-0 text-caption text-ink-3">{rule}</p>}
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      <Button className="sm:min-w-32" onClick={() => setDeciding('approve')}>Approve</Button>
      <Button className="sm:min-w-32" onClick={() => setDeciding('reject')}>Reject</Button>
      {requester && <Button variant="ghost" className="col-span-2" onClick={() => setDeciding('cancel')}>Cancel request</Button>}
    </div>
    {deciding && <ReasonConfirm open onClose={() => setDeciding(null)} spec={decisionSpec(request, deciding)}
      fallback="The decision could not be recorded."
      onSubmit={async (reason, idempotencyKey) => {
        const decided = await adminApi.decideApproval(request, deciding, reason, idempotencyKey)
        onDecided()
        return decided
      }} />}
  </div>
}

function ApprovalCard({ request, actor, onDecided }: {
  request: ApprovalRequest; actor: AdminActor; onDecided: () => void
}) {
  const target = request.targetDisplayName || request.targetEmail || request.targetAccountId
  return <Card as="article" className="flex flex-col gap-4 p-5" data-status={request.status}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 className="m-0 text-title-3 text-ink">{describe(request)}</h2>
        <p className="m-0 text-caption text-ink-3">For {target}{request.targetEmail && request.targetDisplayName ? ` · ${request.targetEmail}` : ''}</p></div>
      <Status value={request.status} />
    </div>
    <div className="-mx-5"><DescriptionList items={[
      ['Requested by', `${who(request.requestedBy, actor)} · ${date(request.requestedAt)}`],
      ['Reason', request.reason],
      [request.status === 'pending' ? 'Expires' : 'Expiry', date(request.expiresAt)],
      request.decidedAt ? ['Decided', `${who(request.decidedBy, actor)} · ${date(request.decidedAt)}`] : null,
      request.decisionReason ? ['Decision reason', request.decisionReason] : null,
      request.executedAt ? ['Carried out', date(request.executedAt)] : null,
    ]} /></div>
    {request.status === 'expired' && <p className="m-0 text-caption text-ink-3">Nobody decided within 24 hours, so nothing changed.</p>}
    {request.status === 'pending' && <DecisionForm request={request} actor={actor} onDecided={onDecided} />}
  </Card>
}

/** Two-person approvals. The backend decides who may request, approve, reject or cancel. */
export function ApprovalsPage({ actor }: { actor: AdminActor }) {
  const [filter, setFilter] = useState<ApprovalStatus | null>('pending')
  const load = useCallback((signal?: AbortSignal) => adminApi.approvals(filter, {}, signal), [filter])
  const resource = useResource(load, 'Approval requests could not be loaded.')
  const pages = useCursorPages(resource, (cursor, signal) => adminApi.approvals(filter, { cursor }, signal),
    'More approval requests could not be loaded.')

  return <Page eyebrow="People and access" title="Approvals"
    description="Making a Super Admin or resetting an authenticator needs a second Super Admin. Requests expire after 24 hours."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <FilterTabs label="Request status" value={filter ?? 'all'} onChange={value => setFilter(value === 'all' ? null : value as ApprovalStatus)}
      options={FILTERS.map(item => ({ value: item.value ?? 'all', label: item.title }))} />
    <ResourceView resource={resource} emptyTitle={filter === 'pending' ? 'Nothing waiting for a decision' : 'No requests'} empty={result => result.items.length === 0}>{() => <div className="flex flex-col gap-4">
      <p className="m-0 text-caption text-ink-3">{pages.items.length} requests, newest first{pages.hasMore ? '. More below.' : ''}</p>
      {pages.items.map(request => <ApprovalCard key={`${request.id}:${request.version}`} request={request} actor={actor}
        onDecided={resource.reload} />)}
      <LoadMore pages={pages} label="Load more requests" />
    </div>}</ResourceView>
  </Page>
}
