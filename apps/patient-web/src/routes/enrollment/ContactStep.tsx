import type { FormEvent } from 'react'
import { describedBy } from '../../authSteps'
import type { StepProps } from './stepProps'
import { Button, Field } from '../../kasuwa/ui'
import { Segmented } from '../../kasuwa/interactive'
import { InputR } from '../profileParts'

interface ContactStepProps extends StepProps {
  channel: 'phone' | 'email'
  onChannel: (channel: 'phone' | 'email') => void
  contact: string
  onContact: (contact: string) => void
  onSubmit: (event: FormEvent) => void
  /** The page's notice that led here (the facility's check recorded), read when focus lands on the field. */
  noticeId?: string
  /** The name on the NIN record shown above (RecordName), read after the field's own error. */
  recordNameId?: string
}

/** The contact Identity sends a code to, which becomes the account's. */
export function ContactStep({ focusTarget, busy, invalid, errorId, channel, onChannel, contact, onContact, onSubmit, noticeId, recordNameId }: ContactStepProps) {
  return <form onSubmit={onSubmit} className="flex flex-col gap-4">
    <h2 className="m-0 text-title-2 text-ink">Where should we send your code?</h2>
    <Segmented ariaLabel="Contact method" value={channel} onChange={onChannel} options={[{ value: 'phone', label: 'Phone' }, { value: 'email', label: 'Email' }]} />
    <Field label={channel === 'phone' ? 'Phone number' : 'Email address'} htmlFor="enroll-contact">
      <InputR id="enroll-contact" ref={focusTarget} required type={channel === 'phone' ? 'tel' : 'email'} autoComplete={channel === 'phone' ? 'tel' : 'email'} value={contact} onChange={event => onContact(event.target.value)}
        aria-invalid={invalid} aria-describedby={describedBy(noticeId, errorId, recordNameId)} />
    </Field>
    <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy}>{busy ? 'Sending…' : 'Send code'}</Button>
  </form>
}
