import { useRef, useState, type ReactNode } from 'react'
import { CircleCheck, Mail, MessageSquare, Send } from 'lucide-react'
import { Segmented } from '../../../kasuwa/interactive'
import { ConfirmSheet, FormActions } from '../../../kasuwa/parts'
import { Alert, Button, Field, Input } from '../../../kasuwa/ui'
import { useFocusById } from '../../../staff/focus'
import { commerce, type ResultShare, type ResultShareInput } from '../commerce/api'
import { NotSwitchedOn } from '../commerce/NotSwitchedOn'
import { normalizePhone } from './labText'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^\+\d{10,15}$/
const dayText = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

/**
 * Sends a released result (POINT_OF_CARE_SPEC §6, POST accessions/:id/result-shares { channel, to }): to the patient by
 * SMS or email, or to the referring doctor by email. The address is filled in when the request has it, confirmed
 * against the patient, then "Sent to …". The message carries a link to the released result only. A 404 says it isn't
 * set up: nothing is pretended sent.
 */
export function ShareResult({ facilityId, accessionId, testName, to: recipient, phone, email: given, doctor, subject, idBase }: {
  readonly facilityId: string; readonly accessionId: string; readonly testName: string
  /** Who it goes to. */
  readonly to: 'patient' | 'doctor'
  /** The patient's phone, or the doctor's email, when the request has it. */
  readonly phone?: string | null; readonly email?: string | null; readonly doctor?: string | null
  /** Who the result is about (the compact patient banner), for the confirm. */
  readonly subject?: ReactNode
  readonly idBase?: string
}) {
  const patient = recipient === 'patient'
  const [open, setOpen] = useState(false)
  const [channel, setChannel] = useState<ResultShareInput['channel']>(patient && (phone || !given) ? 'sms' : 'email')
  const [address, setAddress] = useState(() => channel === 'sms' ? phone ?? '' : given ?? '')
  const [error, setError] = useState('')
  const [sendError, setSendError] = useState('')
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<ResultShare | null>(null)
  const [off, setOff] = useState(false)
  // One key per address: sending to the same place again after a lost answer sends the same request.
  const attempt = useRef<{ target: string; key: string } | null>(null)
  const focus = useFocusById()
  const base = idBase ?? `lab-share-${recipient}-${accessionId}-${testName.replace(/\W+/g, '-').toLowerCase()}`
  const target = channel === 'sms' ? normalizePhone(address) : address.trim().toLowerCase()

  function pick(next: ResultShareInput['channel']) {
    setChannel(next); setError('')
    setAddress(next === 'sms' ? phone ?? '' : given ?? '')
  }
  function check() {
    if (channel === 'email' && !EMAIL.test(address.trim())) {
      setError(patient ? 'Type their email, like ada@example.com.' : 'Type the doctor’s email, like dr.bello@clinic.ng.'); focus(`${base}-to`); return
    }
    if (channel === 'sms' && !PHONE.test(target)) { setError('Type a phone number, like 0803 123 4567.'); focus(`${base}-to`); return }
    setError(''); setSendError(''); setAsking(true)
  }
  async function send() {
    if (busy) return
    const key = `${channel}:${target}`
    if (attempt.current?.target !== key) attempt.current = { target: key, key: crypto.randomUUID() }
    setBusy(true)
    const result = await commerce.shareLabResult(facilityId, accessionId, { channel, to: target }, attempt.current.key)
    setBusy(false); setAsking(false)
    if (result.ok) { setSent(result.data); setOpen(false); focus(`${base}-sent`); return }
    if (result.notAvailable) { setOff(true); focus(`${base}-off`); return }
    setSendError(result.error)
  }

  const label = patient ? 'Send to patient' : 'Send to doctor'
  if (sent) return <p id={`${base}-sent`} tabIndex={-1} role="status" className="m-0 inline-flex items-start gap-2 text-[15px] font-medium text-success-ink outline-none">
    <CircleCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
    <span>Sent to {sent.sentTo}. The link opens this result until {dayText(sent.expiresAt)}.</span>
  </p>
  if (off) return <div id={`${base}-off`} tabIndex={-1} className="outline-none">
    <NotSwitchedOn compact message="This isn’t set up for your facility, so nothing was sent. Contact support." /></div>
  if (!open) return <Button icon={Send} aria-expanded={false}
    onClick={() => { setOpen(true); focus(`${base}-to`) }}>{label}<span className="sr-only">: {testName}</span></Button>
  return <div className="flex flex-col gap-3 rounded-lg p-4 ring-1 ring-inset ring-line">
    {patient ? <Segmented ariaLabel="Send by" value={channel} onChange={pick} className="self-start"
      options={[{ value: 'sms', label: <><MessageSquare className="size-4" aria-hidden />SMS</> }, { value: 'email', label: <><Mail className="size-4" aria-hidden />Email</> }]} /> : null}
    <Field label={channel === 'sms' ? 'Phone' : patient ? 'Their email' : doctor ? `${doctor}’s email` : 'Doctor’s email'} htmlFor={`${base}-to`}
      error={error} errorId={`${base}-to-error`}
      hint={(channel === 'sms' ? phone : given) ? 'From the request.' : undefined} hintId={`${base}-to-hint`}>
      <Input id={`${base}-to`} type={channel === 'sms' ? 'tel' : 'email'} inputMode={channel === 'sms' ? 'tel' : 'email'} autoComplete="off" value={address}
        maxLength={254} className="h-11" aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${base}-to-error` : (channel === 'sms' ? phone : given) ? `${base}-to-hint` : undefined}
        onChange={event => { setAddress(event.target.value); setError('') }} />
    </Field>
    {sendError ? <Alert intent="error" size="sm">{sendError} Try again: it won’t be sent twice.</Alert> : null}
    <FormActions sticky={false}>
      <Button onClick={() => { setOpen(false); setError(''); setSendError('') }}>Cancel</Button>
      <Button variant="primary" icon={Send} onClick={check}>Send</Button>
    </FormActions>
    <ConfirmSheet open={asking} onClose={() => setAsking(false)} title="Send the result" subject={subject} busy={busy}
      effect={<>Send the {testName} result to <strong className="[overflow-wrap:anywhere]">{target}</strong>?</>}
      undo="Check the address: the link can’t be taken back once it is sent." confirmLabel="Send result" onConfirm={() => void send()} />
  </div>
}
