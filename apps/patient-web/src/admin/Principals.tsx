import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ChevronRight, Search } from 'lucide-react'
import { Alert, Button, DescriptionList, EmptyState, Field, Input, Select } from '../kasuwa/ui'
import { Drawer } from '../kasuwa/interactive'
import { LoadingRows } from '../kasuwa/parts'
import { usesNovuBackend } from '../backendContract'
import { adminApi, type AdminActor, type Page as ResultPage, type Principal } from './api'
import { failure } from './problems'
import { ApprovalRequestForm, ExportPanel, PrincipalSessions } from './PrincipalSecurity'
import {
  ConfirmAction, Page, Pager, ReasonConfirm, Refresh, Status, Subject, Table, date, has, label, pageNumber, unlessDialogAbove,
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
 * the frontend host's request logs on a reload. Another page can hand one over
 * in the navigation's state (New facility sign-ups gives an administrator's
 * email): it is searched once, and the state is cleared at once.
 */
export function PrincipalsPage({ actor }: { actor: AdminActor }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [handedOver] = useState(() => handedOverQuery(location.state))
  const [filters, setFilterState] = useState({ query: handedOver, status: '', page: '' })
  const setFilters = (next: Partial<typeof filters>) => setFilterState(current => ({ ...current, ...next }))
  const [input, setInput] = useState(handedOver)
  useEffect(() => {
    if (handedOver) navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
    // Once, as the page opens: handedOver never changes.
  }, [handedOver])
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
  // The open user is looked up in the current results, so the drawer shows what a reload read.
  const [openId, setOpenId] = useState<string | null>(null)
  const opened = result?.items.find(item => item.id === openId) ?? null
  return <Page eyebrow="People and access" title="Users & roles"
    description="Find an account by name or email. You see account details only, never health records."
    action={<div className="flex flex-wrap gap-2">{has(actor, 'platform.principal.export') && <ExportPanel query={query} />}
      {query ? <Refresh onClick={reload} disabled={loading} /> : null}</div>}>
    <form className="flex flex-col gap-3 rounded-xl bg-surface p-4 ring-1 ring-line sm:flex-row sm:items-end" onSubmit={submitSearch} role="search" aria-label="User search">
      <Field label="Name or email" htmlFor="admin-principal-query" className="min-w-0 flex-1">
        <Input id="admin-principal-query" type="search" minLength={2} value={input} icon={Search}
          onChange={event => setInput(event.target.value)} placeholder="At least 2 characters" /></Field>
      <Field label="Status" htmlFor="admin-principal-status" className="sm:w-44">
        <Select id="admin-principal-status" value={filters.status} onChange={event => setFilters({ status: event.target.value, page: '' })}>
          <option value="">Any status</option>
          {ACCOUNT_STATUSES.map(value => <option key={value} value={value}>{label(value)}</option>)}
        </Select></Field>
      <Button variant="primary" type="submit" disabled={loading || input.trim().length < 2}>Search</Button>
    </form>
    {!query && !error && <EmptyState compact icon={Search} title="Search to find a user" description="Enter at least 2 characters." />}
    {loading && !result && <div className="overflow-hidden rounded-xl bg-surface ring-1 ring-line"><LoadingRows label="Searching users" /></div>}
    {loading && result && <p className="sr-only" role="status">Refreshing…</p>}
    {error && !loading && <Alert intent="error" title="Couldn’t search" action={query ? <Button size="sm" onClick={reload}>Try again</Button> : undefined}>{error}</Alert>}
    {result && !error && (result.items.length === 0 ? <EmptyState compact icon={Search} title={`No users match “${query}”`} /> : <>
      <p className="m-0 text-caption text-ink-3">{result.items.length} of {result.total} matching users</p>
      <Table headings={['User', 'Status', 'Platform roles', 'Two-step sign-in', '']}>
        {result.items.map(principal => <tr key={principal.id}>
          <td><strong>{principal.displayName || principal.email || 'Account'}</strong><small>{principal.email || 'No email'}</small></td>
          <td><Status value={principal.status} /></td>
          <td>{principal.platformRoles.length ? principal.platformRoles.map(label).join(', ') : 'None'}</td>
          <td>{twoStep(principal)}</td>
          <td className="text-right"><Button size="sm" iconRight={ChevronRight} onClick={() => setOpenId(principal.id)}
            aria-label={`Open ${principal.displayName || principal.email || 'account'}`}>Open</Button></td>
        </tr>)}
      </Table>
      <Pager page={result.page} pageSize={result.pageSize} total={result.total} disabled={loading}
        onPage={next => setFilters({ page: String(next) })} />
    </>)}
    <Drawer open={opened !== null} onClose={unlessDialogAbove(() => setOpenId(null))} title={opened ? nameOf(opened) : ''}
      description={opened?.email ?? undefined}>
      {opened && <PrincipalDetail principal={opened} actor={actor} reload={reload} />}
    </Drawer>
  </Page>
}

const nameOf = (principal: Principal) => principal.displayName || principal.email || 'This account'
const twoStep = (principal: Principal) => principal.mfaEnrolled === undefined ? 'Not reported' : principal.mfaEnrolled ? 'On' : 'Off'

/** One user: the facts, then what can be done, each through its confirmation. */
function PrincipalDetail({ principal, actor, reload }: { principal: Principal; actor: AdminActor; reload: () => void }) {
  return <div className="flex flex-col gap-6">
    <div className="-mx-5 -mt-2"><DescriptionList items={[
      ['Status', <Status key="s" value={principal.status} />],
      ['Platform roles', principal.platformRoles.length ? principal.platformRoles.map(label).join(', ') : 'None'],
      ['Two-step sign-in', twoStep(principal)],
      ['Signed in on', `${principal.activeSessionCount} ${principal.activeSessionCount === 1 ? 'device' : 'devices'}`],
      ['Facilities', principal.memberships.length ? principal.memberships.map(item =>
        `${item.facilityName} (${label(item.role)}${item.active ? '' : ', inactive'})`).join('; ') : 'None'],
      ['Created', date(principal.createdAt)],
    ]} /></div>
    {has(actor, 'platform.audit.read') && <Link className="self-start text-sm font-medium text-brand-ink" to={`/admin/audit?actor=${encodeURIComponent(principal.subject)}`}>See their activity in Audit</Link>}
    <PrincipalActions principal={principal} actor={actor} reload={reload} />
  </div>
}

/** A search another page handed over: a string of 2 to 254 characters, else none. */
function handedOverQuery(state: unknown): string {
  const query = typeof state === 'object' && state !== null ? (state as { principalQuery?: unknown }).principalQuery : undefined
  return typeof query === 'string' && query.trim().length >= 2 && query.trim().length <= 254 ? query.trim() : ''
}

const PLATFORM_ROLES = [
  'platform_super_admin', 'platform_operations_admin', 'identity_review_admin',
  'facility_review_admin', 'security_auditor', 'support_admin',
] as const

function RoleAction({ principal, reload }: { principal: Principal; reload: () => void }) {
  const [role, setRole] = useState<(typeof PLATFORM_ROLES)[number]>('support_admin')
  const [action, setAction] = useState<'grant' | 'revoke'>('grant')
  const [open, setOpen] = useState(false)
  // A one-step Super Admin grant is refused by the backend (two-person rule);
  // that grant is made through an elevation request instead.
  const roles = action === 'grant' ? PLATFORM_ROLES.filter(value => value !== 'platform_super_admin') : PLATFORM_ROLES
  const name = nameOf(principal)

  function changeAction(value: 'grant' | 'revoke') {
    setAction(value)
    if (value === 'grant' && role === 'platform_super_admin') setRole('support_admin')
  }

  const roleName = label(role)
  return <>
    <Button size="sm" onClick={() => setOpen(true)}>Change roles</Button>
    <ReasonConfirm open={open} onClose={() => setOpen(false)} fallback="The role change could not be saved."
      spec={{ title: 'Change platform roles', subject: <Subject name={name} detail={principal.email} />,
        effect: action === 'grant' ? `${name} gets the ${roleName} role at once.` : `${name} loses the ${roleName} role at once.`,
        undo: action === 'grant' ? 'You can remove it later from this page.' : 'You can give it back later from this page.',
        confirmLabel: action === 'grant' ? `Give ${roleName}` : `Remove ${roleName}`, destructive: action === 'revoke',
        stepUp: `${action === 'grant' ? 'give' : 'remove'} the ${roleName} role ${action === 'grant' ? 'to' : 'from'} ${name}`,
        done: action === 'grant' ? `${name} now has the ${roleName} role.` : `${name} no longer has the ${roleName} role.` }}
      onSubmit={async (reason, idempotencyKey) => {
        await adminApi.command(`/api/v1/admin/principals/${encodeURIComponent(principal.id)}/platform-roles`,
          { roleCode: role, action, reason }, { version: principal.version, idempotencyKey })
        reload()
      }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Change" htmlFor="admin-role-action"><Select id="admin-role-action" value={action} onChange={event => changeAction(event.target.value as 'grant' | 'revoke')}>
          <option value="grant">Give a role</option><option value="revoke">Remove a role</option>
        </Select></Field>
        <Field label="Role" htmlFor="admin-role-code"><Select id="admin-role-code" value={role} onChange={event => setRole(event.target.value as (typeof PLATFORM_ROLES)[number])}>
          {roles.map(value => <option key={value} value={value}>{label(value)}</option>)}
        </Select></Field>
      </div>
      {action === 'grant' && <p className="m-0 text-caption text-ink-3">{usesNovuBackend()
        ? 'Super Admin can’t be given here.'
        : 'Super Admin needs a request that a second Super Admin approves.'}</p>}
    </ReasonConfirm>
  </>
}

function PrincipalActions({ principal, actor, reload }: {
  principal: Principal; actor: AdminActor; reload: () => void
}) {
  const canStatus = has(actor, 'platform.principal.manage')
  const canRole = has(actor, 'platform.role.manage')
  const canRevoke = has(actor, 'platform.session.revoke')
  // A reset applies only to an administrator with an active authenticator; the
  // backend still refuses one without (MFA_NOT_ENROLLED) if this list is stale.
  // It stays offered when the backend does not report enrolment (before Stage 4A).
  const canResetMfa = has(actor, 'platform.mfa.reset') && principal.mfaEnrolled !== false
  // Novu has no two-person approvals and lists no single session: it revokes all of an account's sessions at once.
  const onMain = !usesNovuBackend()
  // After "Revoke all sessions" succeeds, the reload reports no sessions; the
  // form stays (disabled) so its confirmation is not removed with it.
  const [revokedAll, setRevokedAll] = useState(false)
  const canElevate = canRole && !principal.platformRoles.includes('platform_super_admin')
  const offersRevokeAll = canRevoke && (principal.activeSessionCount > 0 || revokedAll)
  const name = nameOf(principal)
  if (!canStatus && !canRole && !offersRevokeAll && !(onMain && (canRevoke || canResetMfa))) return null
  return <section aria-labelledby="admin-principal-actions" className="flex flex-col gap-5 border-t border-line pt-5">
    <h3 id="admin-principal-actions" className="m-0 text-title-3 text-ink">Actions</h3>
    <div className="flex flex-wrap gap-2">
      {canStatus && principal.status !== 'active' && <ConfirmAction label="Restore account" fallback="The account could not be restored."
        spec={{ title: `Restore ${name}?`, subject: <Subject name={name} detail={principal.email} />, effect: `${name} can sign in again at once.`,
          undo: 'You can disable it again later.', confirmLabel: 'Restore account', stepUp: `restore ${name}`, done: `${name} can sign in again.` }}
        onSubmit={async (reason, idempotencyKey) => {
          await adminApi.command(`/api/v1/admin/principals/${encodeURIComponent(principal.id)}/status`,
            { status: 'active', reason }, { version: principal.version, idempotencyKey })
          reload()
        }} />}
      {canRole && <RoleAction principal={principal} reload={reload} />}
      {onMain && canElevate && <ApprovalRequestForm kind="super-admin" principal={principal} />}
      {onMain && canResetMfa && <ApprovalRequestForm kind="mfa-reset" principal={principal} />}
    </div>
    {onMain && canRevoke && <div className="flex flex-col gap-2"><h4 className="m-0 text-sm font-semibold text-ink">Sessions</h4>
      <PrincipalSessions principal={principal} /></div>}
    {(offersRevokeAll || (canStatus && principal.status !== 'disabled')) && <div className="flex flex-col gap-2 rounded-lg p-4 ring-1 ring-danger/25">
      <h4 className="m-0 text-sm font-semibold text-danger-ink">If this account may be compromised</h4>
      <div className="flex flex-wrap gap-2">
        {offersRevokeAll && <ConfirmAction label="Sign out everywhere" variant="danger" disabled={principal.activeSessionCount === 0}
          fallback="The sessions could not be ended."
          spec={{ title: `Sign ${name} out everywhere?`, subject: <Subject name={name} detail={principal.email} />,
            effect: `${name} is signed out on every device at once.`, undo: 'They can sign in again.', confirmLabel: 'Sign out everywhere',
            destructive: true, stepUp: `sign ${name} out everywhere`, done: `${name} is signed out everywhere.` }}
          onSubmit={async (reason, idempotencyKey) => {
            await adminApi.command(`/api/v1/admin/principals/${encodeURIComponent(principal.id)}/sessions/revoke`,
              { reason }, { idempotencyKey })
            setRevokedAll(true)
            reload()
          }} />}
        {canStatus && principal.status !== 'disabled' && <ConfirmAction label="Disable account" variant="danger" fallback="The account could not be disabled."
          spec={{ title: `Disable ${name}?`, subject: <Subject name={name} detail={principal.email} />,
            effect: `${name} can’t sign in from now on.`, undo: 'You can restore the account later from this page.',
            confirmLabel: 'Disable account', destructive: true, stepUp: `disable ${name}`, done: `${name} is disabled and can’t sign in.` }}
          onSubmit={async (reason, idempotencyKey) => {
            await adminApi.command(`/api/v1/admin/principals/${encodeURIComponent(principal.id)}/status`,
              { status: 'disabled', reason }, { version: principal.version, idempotencyKey })
            reload()
          }} />}
      </div>
    </div>}
  </section>
}
