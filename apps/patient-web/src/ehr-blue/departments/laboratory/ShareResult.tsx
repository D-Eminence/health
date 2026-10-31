import { useRef, useState, type ReactNode } from 'react'
import { CircleCheck, Send } from 'lucide-react'
import { ConfirmSheet, FormActions } from '../../../kasuwa/parts'
import { Alert, Button, Field, Input } from '../../../kasuwa/ui'
import { useFocusById } from '../../../staff/focus'
import { commerce, type ResultShare } from '../commerce/api'
import { NotSwitchedOn } from '../commerce/NotSwitchedOn'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const dayText = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

/**
 * "Send to doctor" on a published result (POINT_OF_CARE_SPEC §6, POST accessions/:id/result-shares): the referring
 * doctor's email, filled in from the outside order when it has one, confirmed against the patient, then "Sent to …".
 * The email carries a link to the released result only. A 404 says it isn't switched on: nothing is pretended sent.
 */
export function ShareResult({ facilityId, accessionId, testName, email: given, doctor, subject }: {
  readonly facilityId: string; readonly accessionId: string; readonly testName: string
  /** The referring doctor's email and name from the outside order, when it has them. */
  readonly email?: string | null; readonly doctor?: string | null
  /** Who the result is about (the compact patient banner), for the confirm. */
  readonly subject?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState(given ?? '')
  const [error, setError] = useState('')
  const [sendError, setSendError] = useState('')
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<ResultShare | null>(null)
  const [off, setOff] = useState(false)
  // One key per address: sending to the same doctor again after a lost answer sends the same request.
  const attempt = useRef<{ email: string; key: string } | null>(null)
  const focus = useFocusById()
  const base = `lab-share-${accessionId}-${testName.replace(/\W+/g, '-').toLowerCase()}`

  function check() {
    const value = email.trim()
    if (!EMAIL.test(value)) { setError('Type the doctor’s email, like dr.bello@clinic.ng.'); focus(`${base}-email`); return }
    setError(''); setSendError(''); setAsking(true)
  }
  async function send() {
    if (busy) return
    const value = email.trim().toLowerCase()
    if (attempt.current?.email !== value) attempt.current = { email: value, key: crypto.randomUUID() }
    setBusy(true)
    const result = await commerce.shareLabResult(facilityId, accessionId, value, attempt.current.key)
    setBusy(false); setAsking(false)
    if (result.ok) { setSent(result.data); setOpen(false); focus(`${base}-sent`); return }
    if (result.notAvailable) { setOff(true); focus(`${base}-off`); return }
    setSendError(result.error)
  }

  if (sent) return <p id={`${base}-sent`} tabIndex={-1} role="status" className="m-0 inline-flex items-start gap-2 text-[15px] font-medium text-success-ink outline-none">
    <CircleCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
    <span>Sent to {sent.sentTo}. The link opens this result until {dayText(sent.expiresAt)}.</span>
  </p>
  if (off) return <div id={`${base}-off`} tabIndex={-1} className="outline-none">
    <NotSwitchedOn compact message="Sending results to doctors isn’t switched on for this facility yet. Nothing was sent." /></div>
  if (!open) return <Button icon={Send} className="self-start" aria-expanded={false}
    onClick={() => { setOpen(true); focus(`${base}-email`) }}>Send to doctor<span className="sr-only">: {testName}</span></Button>
  return <div className="flex flex-col gap-3 rounded-lg p-4 ring-1 ring-inset ring-line">
    <Field label={doctor ? `${doctor}’s email` : 'Doctor’s email'} htmlFor={`${base}-email`} error={error} errorId={`${base}-email-error`}
      hint={given ? 'From the request form.' : 'The doctor who asked for the test.'} hintId={`${base}-email-hint`}>
      <Input id={`${base}-email`} type="email" inputMode="email" autoComplete="off" value={email} maxLength={254} className="h-11"
        aria-invalid={error ? true : undefined} aria-describedby={error ? `${base}-email-error` : `${base}-email-hint`}
        onChange={event => { setEmail(event.target.value); setError('') }} />
    </Field>
    <p className="m-0 text-[13px] text-ink-3">They get a link to this published result only. The patient always sees it on their Health ID.</p>
    {sendError ? <Alert intent="error" size="sm">{sendError} Try again: it won’t be sent twice.</Alert> : null}
    <FormActions sticky={false}>
      <Button onClick={() => { setOpen(false); setError(''); setSendError('') }}>Cancel</Button>
      <Button variant="primary" icon={Send} onClick={check}>Send</Button>
    </FormActions>
    <ConfirmSheet open={asking} onClose={() => setAsking(false)} title="Send the result" subject={subject} busy={busy}
      effect={<>Send the {testName} result to <strong className="[overflow-wrap:anywhere]">{email.trim()}</strong>?</>}
      undo="Check the address: the link can’t be taken back once it is sent." confirmLabel="Send result" onConfirm={() => void send()} />
  </div>
}
