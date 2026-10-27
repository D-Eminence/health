import { useState } from 'react'

/**
 * A Health ID as hid-1.0 showed it: the code large in a dashed box, selectable in one
 * press, with a "Copy HID" button. Copying happens only when the person asks.
 */
export function HealthIdCode({ code }: { code: string }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopyState('copied') }
    catch { setCopyState('failed') }
  }

  return <div className="patient-hid">
    <strong className="patient-hid-code">{code}</strong>
    <button type="button" className="patient-secondary-button" onClick={() => void copy()}>{copyState === 'copied' ? 'Copied' : 'Copy HID'}</button>
    {copyState === 'copied' && <p role="status" className="patient-hid-note">Health ID copied.</p>}
    {copyState === 'failed' && <p role="alert" className="patient-hid-note">Copying is not available here. Press and hold your Health ID to copy it, or write it down.</p>}
  </div>
}
