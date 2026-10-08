import { useState } from 'react'
import { adminApi, type PlatformSessionInfo } from './api'
import { failure } from './problems'
import { RecoveryCodes } from './RecoveryCodes'
import { Page, Refresh, ResourceView, Table, date, label, useGovernedSubmit, useResource } from './ui'

const LOW_RECOVERY_CODES = 3

function MfaPanel() {
  const status = useResource(adminApi.mfaStatus, 'Your authenticator status could not be loaded.')
  const [codes, setCodes] = useState<string[] | null>(null)
  const governed = useGovernedSubmit()

  async function regenerate() {
    const result = await governed.submit(() => adminApi.regenerateRecoveryCodes(), 'New recovery codes could not be created.')
    if (result) setCodes(result.recoveryCodes)
  }

  if (codes) return <section className="admin-panel">
    <RecoveryCodes codes={codes} doneLabel="Done" onDone={() => { setCodes(null); status.reload() }} />
  </section>

  return <section className="admin-panel" aria-labelledby="admin-mfa-title">
    <div className="admin-panel-head"><h2 id="admin-mfa-title">Authenticator</h2>
      <Refresh onClick={status.reload} disabled={status.loading} /></div>
    <ResourceView resource={status}>{mfa => <>
      <dl className="admin-detail-grid">
        <div><dt>Status</dt><dd>{mfa.enrolled ? 'Authenticator app enrolled' : 'No active authenticator'}</dd></div>
        <div><dt>Enrolled</dt><dd>{date(mfa.activatedAt)}</dd></div>
        <div><dt>Last used</dt><dd>{date(mfa.lastUsedAt)}</dd></div>
        <div><dt>Unused recovery codes</dt><dd>{mfa.recoveryCodesRemaining}</dd></div>
        {mfa.session && <>
          <div><dt>This session verified with</dt><dd>{mfa.session.mfaMethod === 'totp' ? 'Authenticator app' : 'Recovery code'} · {date(mfa.session.mfaVerifiedAt)}</dd></div>
          <div><dt>High-risk confirmation</dt><dd>{mfa.session.stepUpExpiresAt
            ? `Valid until ${date(mfa.session.stepUpExpiresAt)}` : 'None in the last 5 minutes'}</dd></div>
          <div><dt>Ends without activity</dt><dd>{date(mfa.session.idleExpiresAt)}</dd></div>
          <div><dt>Ends at the latest</dt><dd>{date(mfa.session.absoluteExpiresAt)}</dd></div>
        </>}
      </dl>
      {mfa.session?.mfaMethod === 'recovery_code' && <p className="admin-warning" role="note">You signed in with a recovery
        code. High-risk actions still need your authenticator app. If you have lost it, ask another administrator to
        request an authenticator reset; a second Super Admin must approve it.</p>}
      {mfa.enrolled && mfa.recoveryCodesRemaining <= LOW_RECOVERY_CODES && <p className="admin-warning" role="note">
        {mfa.recoveryCodesRemaining === 0 ? 'You have no unused recovery codes.' : `Only ${mfa.recoveryCodesRemaining} recovery codes are left.`}
        {' '}Create new ones while you still have your authenticator.</p>}
      <div className="admin-action-row">
        <button type="button" className="admin-secondary" disabled={governed.busy || !mfa.enrolled}
          onClick={() => void regenerate()}>{governed.busy ? 'Creating…' : 'Create new recovery codes'}</button>
      </div>
      <p className="admin-note">New codes replace every unused code. This needs your authenticator confirmation.
        To replace a lost authenticator, another administrator requests an authenticator reset that a second Super Admin
        approves; you then set up a new one at your next sign-in.</p>
      {governed.error && <p role="alert" className="admin-error">{governed.error}</p>}
    </>}</ResourceView>
  </section>
}

function familyHeads(items: PlatformSessionInfo[]) {
  const seen = new Set<string>()
  return items.filter(item => !seen.has(item.familyId) && Boolean(seen.add(item.familyId)))
}

function SessionsPanel({ onSignOut }: { onSignOut: () => void }) {
  const sessions = useResource(adminApi.sessions, 'Your sessions could not be loaded.')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function revoke(targets: PlatformSessionInfo[]) {
    if (busy || targets.length === 0) return
    setBusy(targets.length === 1 ? targets[0]!.sessionId : 'others'); setError(null); setNotice(null)
    let revoked = 0
    try {
      for (const target of targets) { await adminApi.revokeOwnSession(target.sessionId); revoked += 1 }
      setNotice(revoked === 1 ? 'Session revoked.' : `${revoked} sessions revoked.`)
    } catch (caught) {
      setError(`${revoked > 0 ? `${revoked} of ${targets.length} sessions were revoked. ` : ''}${failure(caught, 'The session could not be revoked.')}`)
    } finally { setBusy(null); sessions.reload() }
  }

  return <section className="admin-panel" aria-labelledby="admin-sessions-title">
    <div className="admin-panel-head"><h2 id="admin-sessions-title">Your sessions</h2>
      <Refresh onClick={sessions.reload} disabled={sessions.loading} /></div>
    <p className="admin-note">Platform sessions end after 15 minutes without activity and always within 8 hours of
      sign-in. If you see a session you do not recognise, revoke it, change your password and tell your security team.</p>
    {notice && <p role="status" className="admin-success">{notice}</p>}
    {error && <p role="alert" className="admin-error">{error}</p>}
    <ResourceView resource={sessions} empty={list => list.items.length === 0}>{list => {
      const heads = familyHeads(list.items)
      const others = heads.filter(item => !item.current)
      return <>
        <Table headings={['Session', 'Signed in', 'Last refreshed', 'Ends', 'MFA', 'Source', 'Action']}>
          {heads.map(item => <tr key={item.sessionId} aria-current={item.current ? 'true' : undefined}>
            <td>{item.current ? <strong>This session</strong> : label(item.kind)}<small>{item.sessionId}</small></td>
            <td>{date(item.signedInAt)}</td><td>{date(item.lastRefreshedAt)}</td>
            <td>Idle {date(item.idleExpiresAt)}<small>Limit {date(item.absoluteExpiresAt)}</small></td>
            <td>{item.mfaMethod ? `${label(item.mfaMethod)} · ${date(item.mfaVerifiedAt)}` : 'None'}
              {item.lastStepUpAt ? <small>Last confirmation {date(item.lastStepUpAt)}</small> : null}</td>
            <td>{item.sourceIp ?? 'Not recorded'}</td>
            <td>{item.current
              ? <button type="button" className="admin-secondary" onClick={onSignOut}>Sign out</button>
              : <button type="button" className="admin-secondary" disabled={busy !== null}
                onClick={() => void revoke([item])}>{busy === item.sessionId ? 'Revoking…' : 'Revoke'}</button>}</td>
          </tr>)}
        </Table>
        {others.length > 0 && <button type="button" className="admin-secondary" disabled={busy !== null}
          onClick={() => void revoke(others)}>{busy === 'others' ? 'Revoking…' : 'Sign out all other sessions'}</button>}
      </>
    }}</ResourceView>
  </section>
}

export function SecurityPage({ onSignOut }: { onSignOut: () => void }) {
  return <Page eyebrow="Your account" title="Security"
    description="Your authenticator, recovery codes and platform sessions. The server enforces every rule shown here.">
    <div className="admin-stack"><MfaPanel /><SessionsPanel onSignOut={onSignOut} /></div>
  </Page>
}
