import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy } from 'lucide-react'
import { Button } from '../kasuwa/ui'

/** How long "Copied" is said after a copy, before the control offers to copy again. */
export const COPIED_FOR_MS = 3_000

/**
 * A Health ID. On the profile and the dashboard it is plain text in the card's own colour: one press selects all of it,
 * and a click, or Enter or Space once it has focus, copies it. Its name is the code, as it reads; a screen reader also
 * hears that pressing it copies. The sign-up screens show it as hid-1.0 did, large in a dashed box with a "Copy HID"
 * button (`copyButton`), on one line however narrow the screen: Copy goes under it when the two do not fit side by side.
 * Copying happens only when the person asks. "Copied" is said for a few seconds; the advice to copy by hand, when the
 * browser will not copy, stays until the next try. On the card face there is no room for that advice (it was cut off at the
 * card's edge and pushed the name under the photo pill): `adviceIn` is a place outside the card to print it, whole.
 */
export function HealthIdCode({ code, copyButton = false, adviceIn = null }: { code: string; copyButton?: boolean; adviceIn?: HTMLElement | null }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const hint = useId()

  // A copy that is said once, then left: the card does not keep saying it for as long as the page is open.
  useEffect(() => {
    if (copyState !== 'copied') return
    const timer = setTimeout(() => setCopyState('idle'), COPIED_FOR_MS)
    return () => clearTimeout(timer)
  }, [copyState])

  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopyState('copied') }
    catch { setCopyState('failed') }
  }

  if (!code) return null
  const advice = <p role="alert" className="patient-hid-note">Copying is not available here. Press and hold your Health ID to copy it, or write it down.</p>
  if (copyButton) return <div className="flex flex-col gap-2">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-line bg-brand-soft/50 px-4 py-3">
      <strong className="text-[clamp(18px,6vw,22px)] font-semibold tracking-[.08em] whitespace-nowrap text-ink tabular">{code}</strong>
      <Button size="sm" icon={copyState === 'copied' ? Check : Copy} onClick={() => void copy()}>{copyState === 'copied' ? 'Copied' : 'Copy'}{' '}<span className="sr-only">your Health ID</span></Button>
    </div>
    <p role="status" className="sr-only">{copyState === 'copied' ? 'Health ID copied.' : ''}</p>
    {copyState === 'failed' && <p role="alert" className="m-0 text-[13px] text-danger-ink">Copying isn’t available here. Press and hold it to copy, or write it down.</p>}
  </div>
  return <div className="patient-hid">
    <strong className="patient-hid-code patient-hid-plain" role="button" tabIndex={0} title="Click or press Enter to copy" aria-describedby={hint}
      onClick={() => void copy()}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void copy() } }}>{code}</strong>
    <span id={hint} hidden>Copies your Health ID</span>
    <p role="status" className="patient-hid-note">{copyState === 'copied' ? 'Health ID copied.' : ''}</p>
    {copyState === 'failed' && (adviceIn ? createPortal(advice, adviceIn) : advice)}
  </div>
}
