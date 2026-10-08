import { useState } from 'react'
import { saveFile } from './download'

/**
 * Shows recovery codes the backend returned, once. They live only in the
 * caller's state and are discarded when the administrator continues.
 */
export function RecoveryCodes({ codes, onDone, doneLabel = 'Continue' }: {
  codes: readonly string[]; onDone: () => void; doneLabel?: string
}) {
  const [saved, setSaved] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const text = `${codes.join('\n')}\n`

  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopyState('copied') }
    catch { setCopyState('failed') }
  }

  return <section className="admin-recovery" aria-labelledby="admin-recovery-title">
    <h2 id="admin-recovery-title">Save your recovery codes</h2>
    <p>These {codes.length} codes are shown only now. Each one signs you in once if you lose your authenticator.
      They cannot confirm high-risk actions. Store them offline, somewhere only you can reach.</p>
    <ol className="admin-recovery-codes">{codes.map(code => <li key={code}><code>{code}</code></li>)}</ol>
    <div className="admin-action-row">
      <button type="button" className="admin-secondary" onClick={() => void copy()}>Copy codes</button>
      <button type="button" className="admin-secondary"
        onClick={() => saveFile(new Blob([text], { type: 'text/plain' }), 'hid-admin-recovery-codes.txt')}>Download codes</button>
    </div>
    {copyState === 'copied' && <p role="status" className="admin-success">Codes copied.</p>}
    {copyState === 'failed' && <p role="alert" className="admin-error">Copying is not available here. Download the codes or write them down.</p>}
    <label className="admin-checkbox"><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)} />
      I have stored these recovery codes somewhere safe</label>
    <button type="button" className="admin-primary" disabled={!saved} onClick={onDone}>{doneLabel}</button>
  </section>
}
