import { useLayoutEffect, useRef, useState } from 'react'
import { Button, Card } from '@hid/ui'
import { CHOICE } from './copy'

/**
 * The one-time choice after an online sign-in at a pilot facility on a device with no offline copy yet (amendment
 * A5). Nothing is kept unless the person chooses to keep it; declining drops the key derived at sign-in.
 */
export function KeepOfflineChoice({ onKeep, onDecline }: { onKeep: () => Promise<void>; onDecline: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => { heading.current?.focus() }, [])
  async function keep() {
    if (busy) return
    setError(''); setBusy(true)
    try { await onKeep() }
    catch { setError(CHOICE.failed) }
    finally { setBusy(false) }
  }
  return <Card className="staff-card offline-choice"><section aria-labelledby="offline-choice-title" data-testid="offline-choice">
    <h2 id="offline-choice-title" ref={heading} tabIndex={-1}>{CHOICE.title}</h2>
    <p>{CHOICE.body}</p>
    {error && <p role="alert" className="staff-error">{error}</p>}
    <div className="staff-row">
      <Button size="sm" data-testid="offline-choice-keep" onClick={() => void keep()} aria-disabled={busy || undefined}>{busy ? CHOICE.working : CHOICE.keep}</Button>
      <Button size="sm" tone="quiet" data-testid="offline-choice-decline" onClick={onDecline} disabled={busy}>{CHOICE.decline}</Button>
    </div>
  </section></Card>
}
