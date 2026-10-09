import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { adminApi, type AdminActor, type Page as ResultPage, type Principal } from './api'
import { failure } from './problems'
import { ApprovalRequestForm, ExportPanel, PrincipalSessions } from './PrincipalSecurity'
import {
  ActionForm, Page, Pager, Refresh, Status, Table, date, has, label, pageNumber, useGovernedSubmit,
} from './ui'

/** `ListPrincipalsDto` statuses. */
const ACCOUNT_STATUSES = ['active', 'pending_reset', 'locked', 'disabled', 'deleted'] as const

/**
 * Account lookup and governance. Support administrators use the same page:
 * it shows identity and lifecycle data only (no clinical records), and every
 * change is a governed, audited backend command.
 */
/**
 * The search lives in page state, not the URL: a search term can be a name or
 * an email address, which would otherwise stay in browser history and reach
 * the frontend host's request logs on a reload.
 */
export function PrincipalsPage({ actor }: { actor: AdminActor }) {
  const [filters, setFilterState] = useState({ query: '', status: '', page: '' })
  const setFilters = (next: Partial<typeof filters>) => setFilterState(current => ({ ...current, ...next }))
  const [input, setInput] = useState('')
  const [revision, setRevision] = useState(0)
  const [loaded, setLoaded] = useState<{ search: string; page: ResultPage<Principal> } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const query = filters.query
  const page = pageNumber(filters.page)
  // Results stay on screen while the same search reloads (after a change), so
  // row actions keep their confirmations; a different search starts empty.
  const search = JSON.stringify([query, page, filters.status])
  const result = loaded?.search === search ? loaded.page : null

  useEffect(() => {
    if (query.length < 2) { setLoaded(null); return }
    const controller = new AbortController()
    setLoading(true); setError(null)
    void adminApi.principals(query, { page, ...(filters.status ? { status: filters.status } : {}) }, controller.signal).then(value => {
      if (!controller.signal.aborted) setLoaded({ search: JSON.stringify([query, page, filters.status]), page: value })
    }).catch(reason => {
      if (!controller.signal.aborted) setError(failure(reason, 'Users could not be loaded.'))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [query, page, filters.status, revision])

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = input.trim()
    if (value.length < 2) { setError('Enter at least two characters to search users.'); return }
    setError(null)
    setFilters({ query: value, page: '' }); setRevision(current => current + 1)
  }

  const reload = () => setRevision(value => value + 1)
  return <Page eyebrow="People and access" title="Users and roles"
    description="Search by account name, email or subject. Results show identity and lifecycle data only, never clinical records."
    action={query ? <Refresh onClick={reload} disabled={loading} /> : null}>
    <form className="admin-search" onSubmit={submitSearch} role="search" aria-label="User search">
      <label htmlFor="admin-principal-query">Search users</label>
      <div><input id="admin-principal-query" type="search" minLength={2} value={input}
        onChange={event => setInput(event.target.value)} placeholder="At least two characters" />
        <select aria-label="Account status" value={filters.status} onChange={event => setFilters({ status: event.target.value, page: '' })}>
          <option value="">Any status</option>
          {ACCOUNT_STATUSES.map(value => <option key={value} value={value}>{label(value)}</option>)}
        </select>
        <button className="admin-primary" type="submit" disabled={loading || input.trim().length < 2}>Search</button></div>
    </form>
    {has(actor, 'platform.principal.export') && <ExportPanel query={query} />}
    {!query && !error && <div className="admin-state">Enter at least two characters to search.</div>}
    {loading && !result && <div className="admin-state" role="status">Searching users…</div>}
    {loading && result && <p className="admin-note" role="status">Refreshing current information…</p>}
    {error && !loading && <div className="admin-state admin-state-error" role="alert"><p>{error}</p>
      {query && <Refresh onClick={reload} />}</div>}
    {result && !error && (result.items.length === 0 ? <div className="admin-state">No users match “{query}”.</div> : <>
      <p className="admin-result-count">Showing {result.items.length} of {result.total} matching users</p>
      <Table headings={['User', 'Status', 'Platform roles', 'Authenticator', 'Sessions', 'Facility memberships', 'Actions']}>
        {result.items.map(principal => <tr key={principal.id}>
          <td><strong>{principal.displayName || principal.email || 'Account'}</strong><small>{principal.email || principal.id}</small>
            <small>{principal.subject} · created {date(principal.createdAt)}</small>
            {has(actor, 'platform.audit.read') && <small><Link to={`/admin/audit?actor=${encodeURIComponent(principal.subject)}`}>Activity in audit</Link></small>}</td>
          <td><Status value={principal.status} /></td>
          <td>{principal.platformRoles.length ? principal.platformRoles.map(label).join(', ') : 'None'}</td>
          <td>{principal.mfaEnrolled ? 'Enrolled' : 'Not set up'}</td>
          <td>{principal.activeSessionCount}</td>
          <td>{principal.memberships.length ? principal.memberships.map(item =>
            `${item.facilityName} · ${label(item.role)}${item.active ? '' : ' (inactive)'}`).join('; ') : 'None'}</td>
          <td><PrincipalActions principal={principal} actor={actor} reload={reload} /></td>
        </tr>)}
      </Table>
      <Pager page={result.page} pageSize={result.pageSize} total={result.total} disabled={loading}
        onPage={next => setFilters({ page: String(next) })} />
    </>)}
  </Page>
}

const PLATFORM_ROLES = [
  'platform_super_admin', 'platform_operations_admin', 'identity_review_admin',
  'facility_review_admin', 'security_auditor', 'support_admin',
] as const

function RoleAction({ principal, reload }: { principal: Principal; reload: () => void }) {
  const [role, setRole] = useState<(typeof PLATFORM_ROLES)[number]>('support_admin')
  const [action, setAction] = useState<'grant' | 'revoke'>('grant')
  const [reason, setReason] = useState('')
  const governed = useGovernedSubmit()
  // A one-step Super Admin grant is refused by the backend (two-person rule);
  // that grant is made through an elevation request instead.
  const roles = action === 'grant' ? PLATFORM_ROLES.filter(value => value !== 'platform_super_admin') : PLATFORM_ROLES

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (governed.busy || reason.trim().length < 8) return
    const done = await governed.submit(idempotencyKey => adminApi.command(
      `/api/v1/admin/principals/${encodeURIComponent(principal.id)}/platform-roles`,
      { roleCode: role, action, reason: reason.trim() }, { version: principal.version, idempotencyKey }),
    'The role change could not be saved.')
    if (done !== null) { setReason(''); reload() }
  }

  function changeAction(value: 'grant' | 'revoke') {
    setAction(value)
    if (value === 'grant' && role === 'platform_super_admin') setRole('support_admin')
  }

  return <details className="admin-action"><summary>Change platform role</summary>
    <form className="admin-action-form" onSubmit={event => void submit(event)}>
      <label>Action<select value={action} onChange={event => changeAction(event.target.value as 'grant' | 'revoke')}>
        <option value="grant">Grant</option><option value="revoke">Revoke</option>
      </select></label>
      <label>Role<select value={role} onChange={event => setRole(event.target.value as (typeof PLATFORM_ROLES)[number])}>
        {roles.map(value => <option key={value} value={value}>{label(value)}</option>)}
      </select></label>
      {action === 'grant' && <p className="admin-note">Super Admin is granted only through an elevation request that a
        second Super Admin approves.</p>}
      <label>Reason for this change<textarea required minLength={8} maxLength={500} rows={3}
        value={reason} onChange={event => setReason(event.target.value)} /></label>
      <button className="admin-primary" type="submit" disabled={governed.busy || reason.trim().length < 8}>
        {governed.busy ? 'Saving…' : 'Confirm role change'}
      </button>
      {governed.error && <p role="alert" className="admin-error">{governed.error}</p>}
    </form>
  </details>
}

function PrincipalActions({ principal, actor, reload }: {
  principal: Principal; actor: AdminActor; reload: () => void
}) {
  const canStatus = has(actor, 'platform.principal.manage')
  const canRole = has(actor, 'platform.role.manage')
  const canRevoke = has(actor, 'platform.session.revoke')
  // A reset applies only to an administrator with an active authenticator; the
  // backend still refuses one without (MFA_NOT_ENROLLED) if this list is stale.
  const canResetMfa = has(actor, 'platform.mfa.reset') && principal.mfaEnrolled
  const canElevate = canRole && !principal.platformRoles.includes('platform_super_admin')
  if (!canStatus && !canRole && !canRevoke && !canResetMfa) return <>View only</>
  return <div className="admin-principal-actions">
    {canStatus && <ActionForm title="Change account status" options={[
      { value: 'active', title: 'Active' }, { value: 'disabled', title: 'Disabled' },
    ].filter(option => option.value !== principal.status)} onSubmit={async (status, reason, idempotencyKey) => {
      await adminApi.command(`/api/v1/admin/principals/${encodeURIComponent(principal.id)}/status`,
        { status, reason }, { version: principal.version, idempotencyKey })
      reload()
    }} />}
    {canRole && <RoleAction principal={principal} reload={reload} />}
    {canElevate && <ApprovalRequestForm kind="super-admin" principal={principal} />}
    {canResetMfa && <ApprovalRequestForm kind="mfa-reset" principal={principal} />}
    {canRevoke && <PrincipalSessions principal={principal} />}
    {canRevoke && principal.activeSessionCount > 0 && <ActionForm title="Revoke all sessions"
      note={<p className="admin-note">Signs this account out everywhere. Use it when an account may be compromised.</p>}
      onSubmit={async (_, reason, idempotencyKey) => {
        await adminApi.command(`/api/v1/admin/principals/${encodeURIComponent(principal.id)}/sessions/revoke`,
          { reason }, { idempotencyKey })
        reload()
      }} />}
  </div>
}
