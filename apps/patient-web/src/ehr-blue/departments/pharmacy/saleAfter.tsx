import { useRef, useState } from 'react'
import { UserPlus } from 'lucide-react'
import { Alert, Button } from '../../../kasuwa/ui'
import { useToast } from '../../../kasuwa/toast'
import { useFocusById } from '../../../staff/focus'
import { commerce, type Bill } from '../commerce/api'
import { MadeHealthIdPanel, NewHealthIdForm } from './newHealthId'
import type { MadeHealthId } from './walkIn'

/*
 * After a sale (never before it): the customer may be given a Health ID, made through the facility registration
 * (newHealthId.tsx), and the sale is then put on it (POST bills/:billId/patient), so it shows in their record. Offered
 * on the finished sale and on a sale opened from Sales & receipts, only while the sale has no Health ID.
 */

/** Whether a sale can still be given a Health ID: it has none, and the role may make one. */
export function canGiveHealthId(bill: Bill, permissions: readonly string[]): boolean {
  return !bill.patient?.healthId && permissions.includes('identity.registration.write') && permissions.includes('identity.registration.approve')
}

type Attach = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done' } | { kind: 'kept' } | { kind: 'error'; message: string }

/**
 * "Give them a Health ID": a closed button until asked, then the registration form, then the new Health ID with the
 * sale put on it. `onAttached` hears the bill as it now stands.
 */
export function GiveHealthId({ idBase, facilityId, bill, onAttached }: {
  readonly idBase: string; readonly facilityId: string; readonly bill: Bill; readonly onAttached: (bill: Bill) => void
}) {
  const [open, setOpen] = useState(false)
  const [made, setMade] = useState<MadeHealthId | null>(null)
  const [attach, setAttach] = useState<Attach>({ kind: 'idle' })
  // One key per Health ID put on this sale: a retry after a lost answer sends the same request.
  const key = useRef('')
  const toast = useToast()
  const focus = useFocusById()

  async function attachTo(hid: string) {
    if (attach.kind === 'busy') return
    setAttach({ kind: 'busy' })
    const result = await commerce.attachPatient(facilityId, bill.id, hid, key.current)
    if (result.ok) {
      setAttach({ kind: 'done' })
      onAttached(result.data)
      toast.success({ title: 'Sale added to their Health ID', message: `${hid} · Bill ${bill.number}` })
      return
    }
    // The Health ID stands either way; the sale keeps its receipt.
    setAttach(result.notAvailable ? { kind: 'kept' } : { kind: 'error', message: result.error })
  }

  if (!open) return <Button icon={UserPlus} onClick={() => { setOpen(true); focus(`${idBase}-hid-title`) }} aria-controls={`${idBase}-hid`}>Give them a Health ID</Button>
  return <section id={`${idBase}-hid`} aria-labelledby={`${idBase}-hid-title`} className="flex flex-col gap-4 rounded-xl bg-surface p-5 ring-1 ring-line">
    <h3 id={`${idBase}-hid-title`} tabIndex={-1} className="m-0 text-title-3 text-ink outline-none">Give them a Health ID</h3>
    {made ? <>
      <MadeHealthIdPanel idBase={idBase} made={made} />
      {attach.kind === 'busy' ? <p role="status" className="m-0 text-[14px] text-ink-2">Adding this sale to {made.hid}…</p> : null}
      {attach.kind === 'kept' ? <p role="status" className="m-0 text-[14px] text-ink-2">This sale stays on its receipt only.</p> : null}
      {attach.kind === 'error' ? <Alert intent="error" title="Sale not added to their Health ID"
        action={<Button size="sm" onClick={() => void attachTo(made.hid)}>Try again</Button>}>{attach.message}</Alert> : null}
    </> : <NewHealthIdForm idBase={idBase} facilityId={facilityId} place="pharmacy" otcFallback={false}
      onMade={next => { setMade(next); focus(`${idBase}-made`); key.current = crypto.randomUUID(); void attachTo(next.hid) }} />}
  </section>
}
