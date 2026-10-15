import type { FormEvent } from 'react'
import type { StepProps } from './stepProps'

interface ContactStepProps extends StepProps {
  channel: 'phone' | 'email'
  onChannel: (channel: 'phone' | 'email') => void
  contact: string
  onContact: (contact: string) => void
  onSubmit: (event: FormEvent) => void
}

/** The contact Identity sends a code to, which becomes the account's. */
export function ContactStep({ focusTarget, busy, invalid, errorId, channel, onChannel, contact, onContact, onSubmit }: ContactStepProps) {
  return <form onSubmit={onSubmit} className="patient-form">
    <h2>Where should we send your code?</h2>
    <label>Contact method<select value={channel} onChange={event => onChannel(event.target.value as 'phone' | 'email')}><option value="phone">Phone</option><option value="email">Email</option></select></label>
    <label>{channel === 'phone' ? 'Phone number' : 'Email address'}<input ref={focusTarget} required type={channel === 'phone' ? 'tel' : 'email'} autoComplete={channel === 'phone' ? 'tel' : 'email'} value={contact} onChange={event => onContact(event.target.value)}
      aria-invalid={invalid} aria-describedby={errorId} /></label>
    <button type="submit" className="patient-primary-button" disabled={busy}>{busy ? 'Sending…' : 'Send verification code'}</button>
  </form>
}
