import { useId, useState, type FormEvent } from 'react'
import { Download, LogOut } from 'lucide-react'
import { adminApi, type ApprovalRequested, type PlatformSessionInfo, type Principal, type PrincipalExport } from './api'
import { saveFile } from './download'
import { failure } from './problems'
import { ConfirmAction, Subject, date, label, unlessDialogAbove, useGovernedSubmit } from './ui'
import { Alert, Button, Field, Select, Textarea } from '../kasuwa/ui'
import { Drawer } from '../kasuwa/interactive'
import { LoadingRows } from '../kasuwa/parts'
import { useToast } from '../kasuwa/toast'

const nameOf = (principal: Principal) => principal.displayName || principal.email || 'This account'

const REQUEST_COPY = {
  'super-admin': {
    button: 'Request Super Admin',
    title: 'Request Super Admin?',
    effect: (name: string) => `A different Super Admin must approve this within 24 hours. Then ${name} becomes a Super Admin.`,
    undo: 'If nobody approves it, it expires and nothing changes.',
    confirm: 'Send request',
    fallback: 'The request could not be sent.',
  },
  'mfa-reset': {
    button: 'Request authenticator reset',
    title: 'Reset their authenticator?',
    effect: (name: string) => `For a lost authenticator. Once a different Super Admin approves, ${name}’s authenticator and recovery codes stop working, `
      + 'they’re signed out everywhere, and they set up a new one at next sign-in. Their password stays the same.',
    undo: 'If nobody approves it within 24 hours, it expires and nothing changes.',
    confirm: 'Send request',
    fallback: 'The reset request could not be sent.',
  },
} as const

/** Step one of a two-person change; the backend enforces who may request and approve. */
export function ApprovalRequestForm({ kind, principal }: { kind: 'super-admin' | 'mfa-reset'; principal: Principal }) {
  const copy = REQUEST_COPY[kind]
  return <ConfirmAction label={copy.button} fallback={copy.fallback}
    spec={{ title: copy.title, subject: <Subject name={nameOf(principal)} detail={principal.email} />, effect: copy.effect(nameOf(principal)),
      undo: copy.undo, confirmLabel: copy.confirm, stepUp: `${copy.button.toLowerCase()} for ${nameOf(principal)}`,
      done: result => {
        const created = result as ApprovalRequested
        return `${created.replayed ? 'Already requested' : 'Request sent'}. It waits for a second Super Admin until ${date(created.expiresAt)}.`
      } }}
    onSubmit={(reason, idempotencyKey) => kind === 'super-admin'
      ? adminApi.requestSuperAdmin(principal.id, reason, idempotencyKey)
      : adminApi.requestMfaReset(principal.id, reason, idempotencyKey)} />
}

function SessionRevoke({ principal, session, onRevoked }: {
  principal: Principal; session: PlatformSessionInfo; onRevoked: () => void
}) {
  const [compromised, setCompromised] = useState(false)
  const id = useId()
  return <ConfirmAction label="Sign out" icon={LogOut} variant="danger" fallback="The session could not be ended."
    spec={{ title: 'End this session?', subject: <Subject name={nameOf(principal)} detail={`${label(session.kind)} · signed in ${date(session.signedInAt)}`} />,
      effect: 'That device is signed out at once.', undo: 'They can sign in again.', confirmLabel: 'End session', destructive: true,
      stepUp: `end a session of ${nameOf(principal)}`,
      done: result => (result as { revokedCount: number }).revokedCount > 0 ? `Session ended for ${nameOf(principal)}.` : 'That session had already ended.' }}
    onSubmit={async (reason, idempotencyKey) => {
      const result = await adminApi.revokePrincipalSession(principal.id, session.sessionId, { reason, compromised }, idempotencyKey)
      onRevoked()
      return result
    }}>
    <label htmlFor={`${id}-compromised`} className="flex items-start gap-2.5 text-sm text-ink">
      <input id={`${id}-compromised`} type="checkbox" className="mt-0.5 size-4 accent-[var(--color-brand)]" checked={compromised}
        onChange={event => setCompromised(event.target.checked)} />This session may be compromised</label>
    {compromised && <Alert intent="warning" size="sm" live={false}>It’s marked as compromised in the security log. Think about disabling the account too.</Alert>}
  </ConfirmAction>
}

/** Another account's sessions: safe metadata only, as the backend returns it. Read when asked. */
export function PrincipalSessions({ principal }: { principal: Principal }) {
  const [sessions, setSessions] = useState<PlatformSessionInfo[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true); setError(null)
    try { setSessions((await adminApi.principalSessions(principal.id)).items) }
    catch (caught) { setError(failure(caught, 'Sessions could not be loaded.')) }
    finally { setLoading(false) }
  }

  if (!sessions && !loading && !error) return <Button size="sm" className="self-start" onClick={() => void load()}>Show sessions</Button>
  return <div className="flex flex-col gap-2">
    {loading && !sessions && <LoadingRows rows={2} label="Loading sessions" />}
    {error && <Alert intent="error" size="sm" action={<Button size="sm" onClick={() => void load()}>Try again</Button>}>{error}</Alert>}
    {sessions && (sessions.length === 0 ? <p className="m-0 text-sm text-ink-3">No active sessions.</p> :
      <ul className="m-0 list-none divide-y divide-line overflow-hidden rounded-lg p-0 ring-1 ring-line">
        {sessions.map(session => <li key={session.sessionId} className="flex items-start justify-between gap-3 px-3.5 py-3">
          <div className="min-w-0 text-sm">
            <p className="m-0 font-medium text-ink">{label(session.kind)} · {session.sourceIp ?? 'Address not recorded'}</p>
            <p className="m-0 text-caption text-ink-3">Signed in {date(session.signedInAt)} · ends {date(session.absoluteExpiresAt)}</p>
            <p className="m-0 text-caption text-ink-3">Two-step: {session.mfaMethod ? `${label(session.mfaMethod)}, ${date(session.mfaVerifiedAt)}` : 'not used'}</p>
          </div>
          <SessionRevoke principal={principal} session={session} onRevoked={() => { setSessions(null); void load() }} />
        </li>)}
      </ul>)}
  </div>
}

/** The backend's export ceiling (hid-system PRINCIPAL_EXPORT_MAX_ROWS); the response header is preferred. */
export const PRINCIPAL_EXPORT_ROW_LIMIT = 5000
const EXPORT_STATUSES = ['active', 'pending_reset', 'locked', 'disabled', 'deleted'] as const
const rows = (value: number) => new Intl.NumberFormat('en-NG').format(value)

/** The audited CSV export, in a drawer: a form of several fields. */
export function ExportPanel({ query }: { query: string }) {
  const [open, setOpen] = useState(false)
  const [useSearch, setUseSearch] = useState(false)
  const [status, setStatus] = useState('')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [result, setResult] = useState<PrincipalExport | null>(null)
  const governed = useGovernedSubmit()
  const toast = useToast()
  const searchApplies = useSearch && query.length >= 2
  const ready = reason.trim().length >= 8 && confirmed && !governed.busy

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready) return
    setResult(null)
    const exported = await governed.submit(() => adminApi.exportPrincipals({ reason: reason.trim(),
      ...(searchApplies ? { query } : {}), ...(status ? { status } : {}) }), 'The export could not be completed.',
    { PERMISSION_DENIED: 'Only Super Admins with the export permission can export.' }, 'export users')
    if (!exported) return
    saveFile(exported.blob, `hid-principals-${new Date().toISOString().slice(0, 10)}.csv`)
    setReason(''); setConfirmed(false)
    if (exported.truncated) { setResult(exported); return }
    toast.success(exported.rowCount === null ? 'Export downloaded.' : `Exported ${rows(exported.rowCount)} ${exported.rowCount === 1 ? 'user' : 'users'}.`)
    setOpen(false)
  }

  const limit = result?.rowLimit ?? PRINCIPAL_EXPORT_ROW_LIMIT
  return <>
    <Button icon={Download} onClick={() => setOpen(true)}>Export</Button>
    <Drawer open={open} onClose={unlessDialogAbove(() => { if (!governed.busy) setOpen(false) })} title="Export users (CSV)"
      description="Emails, names, status and roles. Never passwords or sessions."
      footer={<><Button onClick={() => setOpen(false)} disabled={governed.busy}>Cancel</Button>
        <Button type="submit" form="admin-export-form" variant="primary" loading={governed.busy} disabled={!ready}>{governed.busy ? 'Exporting…' : 'Export CSV'}</Button></>}>
      <form id="admin-export-form" onSubmit={event => void submit(event)} className="flex flex-col gap-4">
        <Alert intent="warning" size="sm" live={false}>Once downloaded, the file is outside Health ID’s control. Store and share it only as policy allows.</Alert>
        <p className="m-0 text-caption text-ink-3">At most {rows(PRINCIPAL_EXPORT_ROW_LIMIT)} rows. Your reason and the row count go in the audit log.</p>
        <label className="flex items-start gap-2.5 text-sm text-ink"><input type="checkbox" className="mt-0.5 size-4" checked={useSearch} disabled={query.length < 2}
          onChange={event => setUseSearch(event.target.checked)} />Only users matching the search{query.length >= 2 ? ` “${query}”` : ''}</label>
        <Field label="Account status" htmlFor="admin-export-status">
          <Select id="admin-export-status" value={status} onChange={event => setStatus(event.target.value)}>
            <option value="">Any status</option>
            {EXPORT_STATUSES.map(value => <option key={value} value={value}>{label(value)}</option>)}
          </Select></Field>
        <Field label="Reason for this export" htmlFor="admin-export-reason" hint="At least 8 characters.">
          <Textarea id="admin-export-reason" required minLength={8} maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)} /></Field>
        <label className="flex items-start gap-2.5 text-sm text-ink"><input type="checkbox" className="mt-0.5 size-4" checked={confirmed}
          onChange={event => setConfirmed(event.target.checked)} />I need this export and will handle the file as policy requires.</label>
        {governed.error && <Alert intent="error" size="sm">{governed.error}</Alert>}
        {result?.truncated && <Alert intent="warning" size="sm">Downloaded, but cut off at {rows(limit)} rows. Narrow the filter to export the rest.</Alert>}
      </form>
    </Drawer>
  </>
}
