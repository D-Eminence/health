import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { adminApi, type EmergencyContactOptOut } from './api'
import { isProblem } from './problems'
import { Page, useGovernedSubmit } from './ui'

/**
 * Support stops emergency-access alerts to someone who asked (hid-system #109, which only Novu serves): every
 * patient's emergency contact at that email address or phone number is removed, its pending alerts close unsent, and
 * each patient is told in their inbox, without the contact's name or address. Needs
 * platform.emergency-contact.manage, a reason and the submission's Idempotency-Key. Support learns only the counts.
 * The address is held in this form's state only, never in the URL, an audit filter or browser storage, and is
 * cleared once the change is made.
 */
const OPT_OUT_PROBLEMS: Readonly<Record<string, string>> = {
  VALIDATION_FAILED: 'Check the values: the email address or phone number is 5 to 254 characters, and the reason 8 to 500.',
  PERMISSION_DENIED: 'Stopping alerts needs the platform.emergency-contact.manage permission. Ask a Super Admin.',
}
const OPT_OUT = 'admin-opt-out'

/** Counts only, as the command answers. */
function removed(result: EmergencyContactOptOut, channel: 'email' | 'sms') {
  if (result.contacts === 0) return `No emergency contact uses that ${channel === 'sms' ? 'phone number' : 'address'}.`
  const count = (value: number, noun: string) => `${value} ${noun}${value === 1 ? '' : 's'}`
  return `Removed ${count(result.contacts, 'contact')} for ${count(result.patients, 'patient')}. Each patient is told in their `
    + 'Health ID notifications.'
}

export function EmergencyContactAlertsPage() {
  const [channel, setChannel] = useState<'email' | 'sms'>('email')
  const [destination, setDestination] = useState('')
  const [reason, setReason] = useState('')
  const [destinationRefused, setDestinationRefused] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const destinationInput = useRef<HTMLInputElement>(null)
  const governed = useGovernedSubmit()
  const ready = destination.trim().length >= 5 && reason.trim().length >= 8
  // Identity's own words ("Enter a valid email address" or "... phone number"), said at the field. Focus moves there
  // in the commit that shows them, so its description is read and a check made as soon as they show finds it there.
  useLayoutEffect(() => { if (destinationRefused) destinationInput.current?.focus() }, [destinationRefused])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (governed.busy || !ready) return
    setResult(null); setDestinationRefused(false)
    let refused: unknown = null
    const done = await governed.submit(async idempotencyKey => {
      try { return await adminApi.optOutEmergencyContact({ channel, destination: destination.trim(), reason: reason.trim() }, idempotencyKey) }
      catch (caught) { refused = caught; throw caught }
    }, 'Alerts could not be stopped. Try again.', OPT_OUT_PROBLEMS)
    if (done) {
      setDestination(''); setReason('')
      setResult(removed(done, channel))
    } else if (isProblem(refused, 'EMERGENCY_CONTACT_DESTINATION_INVALID')) setDestinationRefused(true)
  }

  return <Page eyebrow="People and access" title="Emergency contact alerts"
    description="Stop emergency-access alerts to someone who asked Health ID support to stop them.">
    <section className="admin-panel" aria-labelledby={`${OPT_OUT}-title`}>
      <div className="admin-panel-head"><div><h2 id={`${OPT_OUT}-title`}>Stop alerts to a person</h2>
        <p>Every emergency contact with this email address or phone number is removed, for every patient, and alerts not yet
          sent to it are not sent. Each patient is told in their Health ID notifications, without the contact's name or
          address. You see only how many contacts and patients were affected.</p></div></div>
      <form onSubmit={event => void submit(event)} className="admin-action-form">
        <label>How they receive alerts<select value={channel}
          onChange={event => { setChannel(event.target.value as 'email' | 'sms'); setDestination(''); setDestinationRefused(false) }}>
          <option value="email">Email</option><option value="sms">SMS (phone)</option></select></label>
        <label>{channel === 'sms' ? 'Phone number' : 'Email address'}<input ref={destinationInput} type={channel === 'sms' ? 'tel' : 'email'}
          autoComplete="off" minLength={5} maxLength={254} value={destination}
          onChange={event => { setDestination(event.target.value); setDestinationRefused(false) }}
          aria-invalid={destinationRefused || undefined}
          aria-describedby={[channel === 'sms' && `${OPT_OUT}-hint`, destinationRefused && `${OPT_OUT}-error`].filter(Boolean).join(' ') || undefined} /></label>
        {channel === 'sms' && <small id={`${OPT_OUT}-hint`} className="admin-note">For example 0803 123 4567 or +234 803 123 4567.</small>}
        <label>Reason for stopping these alerts<textarea required minLength={8} maxLength={500} rows={3} value={reason}
          onChange={event => setReason(event.target.value)} aria-describedby={`${OPT_OUT}-reason-hint`} /></label>
        <small id={`${OPT_OUT}-reason-hint`} className="admin-note">8 to 500 characters. The audit log keeps a fixed reason, not
          this text: do not type the address here.</small>
        <button type="submit" className="admin-primary" disabled={governed.busy || !ready}>
          {governed.busy ? 'Stopping alerts…' : 'Stop alerts'}
        </button>
        {governed.error && <p id={`${OPT_OUT}-error`} className="admin-error" role="alert">{governed.error}</p>}
        <div role="status">{result && <p className="admin-success">{result}</p>}</div>
      </form>
    </section>
  </Page>
}
