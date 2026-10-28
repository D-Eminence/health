import { useState } from 'react'

/**
 * A Health ID. On the profile and the dashboard it is plain text in the card's own colour: one press selects all of it,
 * and a click, or Enter or Space once it has focus, copies it. The sign-up screens show it as hid-1.0 did, large in a
 * dashed box with a "Copy HID" button (`copyButton`). Copying happens only when the person asks.
 */
export function HealthIdCode({ code, copyButton = false }: { code: string; copyButton?: boolean }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopyState('copied') }
    catch { setCopyState('failed') }
  }

  if (!code) return null
  return <div className="patient-hid">
    {copyButton ? <>
      <strong className="patient-hid-code">{code}</strong>
      <button type="button" className="patient-secondary-button" onClick={() => void copy()}>{copyState === 'copied' ? 'Copied' : 'Copy HID'}</button>
    </> : <strong className="patient-hid-code patient-hid-plain" role="button" tabIndex={0} title="Click or press Enter to copy"
      onClick={() => void copy()}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void copy() } }}>{code}</strong>}
    <p role="status" className="patient-hid-note">{copyState === 'copied' ? 'Health ID copied.' : ''}</p>
    {copyState === 'failed' && <p role="alert" className="patient-hid-note">Copying is not available here. Press and hold your Health ID to copy it, or write it down.</p>}
  </div>
}
