import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '../kasuwa/ui'

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
  if (copyButton) return <div className="flex flex-col gap-2">
    <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-line bg-brand-soft/50 px-4 py-3">
      <strong className="text-[22px] font-semibold tracking-[.08em] text-ink tabular">{code}</strong>
      <Button size="sm" icon={copyState === 'copied' ? Check : Copy} onClick={() => void copy()}>{copyState === 'copied' ? 'Copied' : 'Copy'}{' '}<span className="sr-only">your Health ID</span></Button>
    </div>
    <p role="status" className="sr-only">{copyState === 'copied' ? 'Health ID copied.' : ''}</p>
    {copyState === 'failed' && <p role="alert" className="m-0 text-[13px] text-danger-ink">Copying isn’t available here. Press and hold it to copy, or write it down.</p>}
  </div>
  return <div className="patient-hid">
    <strong className="patient-hid-code patient-hid-plain" role="button" tabIndex={0} title="Click or press Enter to copy"
      onClick={() => void copy()}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void copy() } }}>{code}</strong>
    <p role="status" className="patient-hid-note">{copyState === 'copied' ? 'Health ID copied.' : ''}</p>
    {copyState === 'failed' && <p role="alert" className="patient-hid-note">Copying is not available here. Press and hold your Health ID to copy it, or write it down.</p>}
  </div>
}
