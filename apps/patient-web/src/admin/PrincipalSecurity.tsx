import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { adminApi, type ApprovalRequested, type PlatformSessionInfo, type Principal, type PrincipalExport } from './api'
import { saveFile } from './download'
import { failure } from './problems'
import { Table, date, label, useGovernedSubmit } from './ui'

const REQUEST_COPY = {
  'super-admin': {
    title: 'Request Super Admin elevation',
    note: 'Super Admin is never granted in one step. This creates a request that a different Super Admin must approve '
      + 'within 24 hours, or it expires and nothing changes. Nobody can approve a request they made or one for their own account.',
    submit: 'Create elevation request',
    fallback: 'The elevation request could not be created.',
  },
  'mfa-reset': {
    title: 'Request authenticator reset',
    note: 'Use this when this administrator has lost their authenticator. A different Super Admin must approve within 24 hours. '
      + 'When approved, their authenticator and unused recovery codes stop working, all of their sessions end, and they set up '
      + 'a new authenticator at their next sign-in. Their password is not changed.',
    submit: 'Create reset request',
    fallback: 'The authenticator reset request could not be created.',
  },
} as const

/** Step one of a two-person change; the backend enforces who may request and approve. */
export function ApprovalRequestForm({ kind, principal }: { kind: 'super-admin' | 'mfa-reset'; principal: Principal }) {
  const copy = REQUEST_COPY[kind]
  const [reason, setReason] = useState('')
  const [created, setCreated] = useState<ApprovalRequested | null>(null)
  const governed = useGovernedSubmit()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (governed.busy || reason.trim().length < 8) return
    setCreated(null)
    const result = await governed.submit(idempotencyKey => kind === 'super-admin'
      ? adminApi.requestSuperAdmin(principal.id, reason.trim(), idempotencyKey)
      : adminApi.requestMfaReset(principal.id, reason.trim(), idempotencyKey), copy.fallback)
    if (result) { setCreated(result); setReason('') }
  }

  return <details className="admin-action"><summary>{copy.title}</summary>
    <form className="admin-action-form" onSubmit={event => void submit(event)}>
      <p className="admin-note">{copy.note}</p>
      <label>Reason for this request<textarea required minLength={8} maxLength={500} rows={3}
        value={reason} onChange={event => setReason(event.target.value)} /></label>
      <button className="admin-primary" type="submit" disabled={governed.busy || reason.trim().length < 8}>
        {governed.busy ? 'Submitting…' : copy.submit}
      </button>
      {governed.error && <p role="alert" className="admin-error">{governed.error}</p>}
      {created && <p role="status" className="admin-success">
        {created.replayed ? 'This request was already submitted. ' : 'Request created. '}
        It waits for another Super Admin until {date(created.expiresAt)}. <Link to="/admin/approvals">View approvals</Link>
      </p>}
    </form>
  </details>
}

function SessionRevokeForm({ principal, session, onRevoked }: {
  principal: Principal; session: PlatformSessionInfo; onRevoked: (count: number) => void
}) {
  const [reason, setReason] = useState('')
  const [compromised, setCompromised] = useState(false)
  const governed = useGovernedSubmit()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (governed.busy || reason.trim().length < 8) return
    const result = await governed.submit(idempotencyKey => adminApi.revokePrincipalSession(principal.id, session.sessionId,
      { reason: reason.trim(), compromised }, idempotencyKey), 'The session could not be revoked.')
    if (result) onRevoked(result.revokedCount)
  }

  return <details className="admin-action"><summary>Revoke</summary>
    <form className="admin-action-form" onSubmit={event => void submit(event)}>
      <label>Reason<textarea required minLength={8} maxLength={500} rows={2}
        value={reason} onChange={event => setReason(event.target.value)} /></label>
      <label className="admin-checkbox"><input type="checkbox" checked={compromised}
        onChange={event => setCompromised(event.target.checked)} /> This session may be compromised</label>
      {compromised && <p className="admin-warning" role="note">The session is recorded as compromised in the security log.
        Also consider disabling the account or requesting an authenticator reset.</p>}
      <button className="admin-primary" type="submit" disabled={governed.busy || reason.trim().length < 8}>
        {governed.busy ? 'Revoking…' : 'Revoke session'}</button>
      {governed.error && <p role="alert" className="admin-error">{governed.error}</p>}
    </form>
  </details>
}

/** Another account's sessions: safe metadata only, as the backend returns it. */
export function PrincipalSessions({ principal }: { principal: Principal }) {
  const [sessions, setSessions] = useState<PlatformSessionInfo[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function load() {
    setLoading(true); setError(null)
    try { setSessions((await adminApi.principalSessions(principal.id)).items) }
    catch (caught) { setError(failure(caught, 'Sessions could not be loaded.')) }
    finally { setLoading(false) }
  }

  return <details className="admin-action" onToggle={event => {
    if ((event.currentTarget as HTMLDetailsElement).open && !sessions && !loading) void load()
  }}><summary>Review sessions</summary>
    <div className="admin-action-form">
      {loading && <p role="status">Loading sessions…</p>}
      {error && <p role="alert" className="admin-error">{error}</p>}
      {notice && <p role="status" className="admin-success">{notice}</p>}
      {sessions && (sessions.length === 0 ? <p className="admin-note">No active sessions.</p> :
        <Table headings={['Session', 'Signed in', 'Last refreshed', 'Ends', 'MFA', 'Source', 'Action']}>
          {sessions.map(session => <tr key={session.sessionId}>
            <td>{label(session.kind)}<small>{session.sessionId}</small></td>
            <td>{date(session.signedInAt)}</td><td>{date(session.lastRefreshedAt)}</td>
            <td>Idle {date(session.idleExpiresAt)}<small>Limit {date(session.absoluteExpiresAt)}</small></td>
            <td>{session.mfaMethod ? `${label(session.mfaMethod)} · ${date(session.mfaVerifiedAt)}` : 'None'}</td>
            <td>{session.sourceIp ?? 'Not recorded'}</td>
            <td><SessionRevokeForm principal={principal} session={session} onRevoked={count => {
              setNotice(count > 0 ? 'Session revoked. That device must sign in again.' : 'That session had already ended.')
              setSessions(null); void load()
            }} /></td>
          </tr>)}
        </Table>)}
    </div>
  </details>
}

/** The backend's export ceiling (hid-system PRINCIPAL_EXPORT_MAX_ROWS); the response header is preferred. */
export const PRINCIPAL_EXPORT_ROW_LIMIT = 5000
const EXPORT_STATUSES = ['active', 'pending_reset', 'locked', 'disabled', 'deleted'] as const

export function ExportPanel({ query }: { query: string }) {
  const [useSearch, setUseSearch] = useState(false)
  const [status, setStatus] = useState('')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [result, setResult] = useState<PrincipalExport | null>(null)
  const governed = useGovernedSubmit()
  const searchApplies = useSearch && query.length >= 2
  const ready = reason.trim().length >= 8 && confirmed && !governed.busy

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready) return
    setResult(null)
    const exported = await governed.submit(() => adminApi.exportPrincipals({ reason: reason.trim(),
      ...(searchApplies ? { query } : {}), ...(status ? { status } : {}) }), 'The export could not be completed.',
    { PERMISSION_DENIED: 'Exports are restricted to Super Admins with the export permission.' })
    if (!exported) return
    saveFile(exported.blob, `hid-principals-${new Date().toISOString().slice(0, 10)}.csv`)
    setResult(exported); setReason(''); setConfirmed(false)
  }

  const limit = result?.rowLimit ?? PRINCIPAL_EXPORT_ROW_LIMIT
  return <details className="admin-action admin-export"><summary>Export users (CSV)</summary>
    <form className="admin-action-form" onSubmit={event => void submit(event)}>
      <p className="admin-warning" role="note">The file contains email addresses, names, account status and platform roles.
        Once downloaded it is outside Health ID’s control: store and share it only as policy allows.</p>
      <ul className="admin-note">
        <li>The server requires the export permission and a fresh authenticator confirmation (step-up, valid 5 minutes),
          because exports are a critical action.</li>
        <li>Your reason is recorded in the audit log with the number of rows exported.</li>
        <li>At most {new Intl.NumberFormat('en-NG').format(PRINCIPAL_EXPORT_ROW_LIMIT)} rows. Larger results are cut off; narrow the filter.</li>
        <li>Passwords, sessions, tokens, subjects and facility memberships are never included.</li>
      </ul>
      <label className="admin-checkbox"><input type="checkbox" checked={useSearch} disabled={query.length < 2}
        onChange={event => setUseSearch(event.target.checked)} /> Only users matching the current search{query.length >= 2 ? ` (“${query}”)` : ''}</label>
      <label>Account status<select value={status} onChange={event => setStatus(event.target.value)}>
        <option value="">Any status</option>
        {EXPORT_STATUSES.map(value => <option key={value} value={value}>{label(value)}</option>)}
      </select></label>
      <label>Reason for this export<textarea required minLength={8} maxLength={500} rows={3}
        value={reason} onChange={event => setReason(event.target.value)} /></label>
      <label className="admin-checkbox"><input type="checkbox" checked={confirmed}
        onChange={event => setConfirmed(event.target.checked)} /> I confirm this export is necessary and I will handle the file as policy requires.</label>
      <button className="admin-primary" type="submit" disabled={!ready}>{governed.busy ? 'Exporting…' : 'Export CSV'}</button>
      {governed.error && <p role="alert" className="admin-error">{governed.error}</p>}
      {result && <p role="status" className={result.truncated ? 'admin-warning' : 'admin-success'}>
        {result.rowCount === null
          ? `Export downloaded. The server did not share its row count with this browser; exports stop at ${new Intl.NumberFormat('en-NG').format(limit)} rows.`
          : `Exported ${new Intl.NumberFormat('en-NG').format(result.rowCount)} ${result.rowCount === 1 ? 'row' : 'rows'}.`}
        {result.truncated ? ` The export was cut off at the ${new Intl.NumberFormat('en-NG').format(limit)}-row limit. Narrow the filter to export the rest.` : ''}
      </p>}
    </form>
  </details>
}
