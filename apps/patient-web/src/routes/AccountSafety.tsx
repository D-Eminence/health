import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import {
  EMERGENCY_CONTACT_RELATIONSHIPS, type AccountDeletionBlockedReason, type AccountDeletionRequested,
  type EmergencyContact, type EmergencyContactRelationship,
} from '../api'
import { useSession } from '../session'
import { usePatientResource } from './usePatientResource'
import { useActionFocus, useRetryFocus } from './actionFocus'

/*
 * Patient-facing account deletion and emergency-contact management. The
 * backend enforces ownership, fresh sign-in, verification, retention, and
 * eligibility; these screens only explain the consequences and collect intent.
 */

const CONFIRMATION_PHRASE = 'DELETE MY ACCOUNT'

function dateTime(value: string | null | undefined) {
  if (!value) return 'Not available'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value
    : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

function days(seconds: number) {
  const value = Math.round(seconds / 86_400)
  return value === 1 ? '1 day' : `${value} days`
}

function problem(cause: unknown, fallback: string) {
  return isHidApiError(cause) ? cause.message : fallback
}

function problemCode(cause: unknown): string | undefined {
  return isHidApiError(cause) ? cause.code : undefined
}

const BLOCKED_REASONS: Record<AccountDeletionBlockedReason, string> = {
  LEGAL_HOLD: 'Some of your records must be kept for a legal or regulatory reason, so this account cannot be deleted right now. Contact Health ID support for help.',
  RETENTION_POLICY_UNAVAILABLE: 'We could not confirm how your records must be kept, so nothing was deleted. Try again later or contact Health ID support.',
  WORKFORCE_ACCOUNT: 'This sign-in is also used for provider or administrator access, so it cannot be deleted from the patient portal. Contact your organisation or Health ID support.',
}

/** The contact a repeated button acts on, for assistive technology only (NEW-AMBIGUOUS-ACTION-NAMES). */
function ItemName({ children }: { children: ReactNode }) {
  return <span className="patient-visually-hidden">{children}</span>
}

const RELATIONSHIP_LABELS: Record<EmergencyContactRelationship, string> = {
  spouse: 'Spouse', partner: 'Partner', parent: 'Parent', child: 'Child', sibling: 'Sibling', relative: 'Relative',
  guardian: 'Guardian', caregiver: 'Caregiver', friend: 'Friend', other: 'Other',
}

export function EmergencyContactsCard() {
  const { api } = useSession()
  const contacts = usePatientResource(api.emergencyContacts)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', relationship: 'relative' as EmergencyContactRelationship,
    channel: 'sms' as 'sms' | 'email', destination: '', notifyOnEmergencyAccess: true })
  const [verifying, setVerifying] = useState<{ contactId: string; challengeId: string; expiresAt: string } | null>(null)
  const [code, setCode] = useState('')
  const [editing, setEditing] = useState<{ contactId: string; version: number; name: string;
    relationship: EmergencyContactRelationship; notifyOnEmergencyAccess: boolean } | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const addName = useRef<HTMLInputElement>(null)
  const focusAfter = useActionFocus()
  const retryFocus = useRetryFocus(contacts.loading, contacts.error, heading)
  const byId = (id: string) => () => document.getElementById(id)
  const toHeading = (): HTMLElement | null => heading.current

  // Each action ends once the list shows its outcome; focus then goes to the
  // heading, or back to the field or button that ran it when it was refused.
  const run = async (action: () => Promise<void>, fallback: string, refused: () => HTMLElement | null) => {
    if (busy) return
    setBusy(true); setError(null); setNotice(null)
    let target = toHeading
    try { await action() } catch (cause) { setError(problem(cause, fallback)); target = refused }
    finally { setBusy(false); focusAfter(target) }
  }

  const add = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      await api.addEmergencyContact({ ...draft, name: draft.name.trim(), destination: draft.destination.trim() })
      setDraft(value => ({ ...value, name: '', destination: '' })); setAdding(false)
      setNotice('Contact added. Send a verification code so they can be notified in an emergency.')
      await contacts.reload()
    }, 'The contact could not be added.', () => addName.current)
  }

  const sendCode = async (contact: EmergencyContact) => {
    if (busy) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const sent = await api.sendEmergencyContactVerification(contact.contactId)
      setVerifying({ contactId: contact.contactId, challengeId: sent.challengeId, expiresAt: sent.expiresAt }); setCode('')
      setNotice(`A code was sent to ${contact.destinationHint}. Ask ${contact.name} to read it to you.`)
      focusAfter(byId(`contact-code-${contact.contactId}`))
    } catch (cause) {
      setError(problemCode(cause) === 'EMERGENCY_CONTACT_DELIVERY_UNAVAILABLE'
        ? 'Contact verification is not available yet. This contact stays unverified and will not be notified.'
        : problem(cause, 'The verification code could not be sent.'))
      focusAfter(byId(`contact-send-${contact.contactId}`))
    } finally { setBusy(false) }
  }

  const confirmCode = (event: FormEvent) => {
    event.preventDefault()
    if (!verifying || !/^\d{6}$/.test(code)) return
    void run(async () => {
      await api.confirmEmergencyContactVerification(verifying.contactId, verifying.challengeId, code)
      setVerifying(null); setCode('')
      setNotice('Contact verified. They will be notified if emergency access to your record is used.')
      await contacts.reload()
    }, 'The code could not be verified.', byId(`contact-code-${verifying.contactId}`))
  }

  const saveEdit = (event: FormEvent) => {
    event.preventDefault()
    if (!editing) return
    void run(async () => {
      await api.updateEmergencyContact(editing.contactId, { expectedVersion: editing.version, name: editing.name.trim(),
        relationship: editing.relationship, notifyOnEmergencyAccess: editing.notifyOnEmergencyAccess })
      setEditing(null); setNotice('Contact updated.'); await contacts.reload()
    }, 'The contact could not be updated.', byId(`contact-name-${editing.contactId}`))
  }

  const remove = (contactId: string) => void run(async () => {
    await api.deactivateEmergencyContact(contactId)
    setRemoving(null); setNotice('Contact removed. They will no longer be notified.'); await contacts.reload()
  }, 'The contact could not be removed.', byId(`contact-confirm-remove-${contactId}`))

  return <div className="patient-card" aria-labelledby="emergency-contacts-heading" aria-busy={contacts.loading || undefined}>
    <h2 ref={heading} tabIndex={-1} id="emergency-contacts-heading">Emergency contacts</h2>
    <p className="patient-field-hint">If a provider uses emergency access to your record, verified contacts are told
      your first name, the facility, and the time. They never receive medical details. A contact is only notified
      after they confirm a verification code and while notifications are on.</p>
    {error && <p role="alert" className="patient-inline-error">{error}</p>}
    <div role="status">{notice && <p className="patient-inline-success">{notice}</p>}</div>
    {contacts.loading && !contacts.data && <p role="status" className="patient-loading">Loading your contacts…</p>}
    {contacts.error && <div role="alert"><p>{contacts.error}</p><button ref={retryFocus.button} type="button" onClick={() => { retryFocus.retried(); void contacts.reload() }}>Try again</button></div>}
    {contacts.data && !contacts.error && (contacts.data.length === 0
      ? <p className="patient-empty">You have no emergency contacts.</p>
      : <ul className="patient-list">{contacts.data.map(contact => <li key={contact.contactId} className="patient-access-item">
        <div><strong>{contact.name}</strong>
          <span>{RELATIONSHIP_LABELS[contact.relationship]} · {contact.channel === 'sms' ? 'SMS' : 'Email'} {contact.destinationHint}</span>
          <span className={contact.eligibleForEmergencyNotification ? 'patient-status-tag patient-status-tag-ok' : 'patient-status-tag'}>
            {contact.eligibleForEmergencyNotification ? 'Verified · will be notified in an emergency'
              : contact.status === 'verified' ? 'Verified · notifications off' : 'Not verified · will not be notified'}</span>
        </div>
        <div className="patient-decision-actions">
          {contact.status === 'unverified' && <button id={`contact-send-${contact.contactId}`} type="button" className="patient-secondary-button" disabled={busy}
            onClick={() => void sendCode(contact)}>Send verification code <ItemName>to {contact.name}, {contact.destinationHint}</ItemName></button>}
          <button id={`contact-edit-${contact.contactId}`} type="button" disabled={busy} onClick={() => setEditing({ contactId: contact.contactId, version: contact.version,
            name: contact.name, relationship: contact.relationship, notifyOnEmergencyAccess: contact.notifyOnEmergencyAccess })}>Edit <ItemName>{contact.name}, {contact.destinationHint}</ItemName></button>
          <button id={`contact-remove-${contact.contactId}`} type="button" disabled={busy} onClick={() => setRemoving(contact.contactId)}>Remove <ItemName>{contact.name}, {contact.destinationHint}</ItemName></button>
        </div>
        {verifying?.contactId === contact.contactId && <form className="patient-deny-form" onSubmit={confirmCode}>
          <label>Code from {contact.name}<input id={`contact-code-${contact.contactId}`} autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
            required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
          <button type="submit" disabled={busy || !/^\d{6}$/.test(code)}>Verify contact</button></form>}
        {editing?.contactId === contact.contactId && <form className="patient-form patient-contact-form" onSubmit={saveEdit}>
          <label>Name<input id={`contact-name-${contact.contactId}`} autoFocus required minLength={2} maxLength={120} value={editing.name}
            onChange={event => setEditing({ ...editing, name: event.target.value })} aria-describedby={`contact-name-hint-${contact.contactId}`} /></label>
          <p id={`contact-name-hint-${contact.contactId}`} className="patient-field-hint">At least 2 characters.</p>
          <label>Relationship<select value={editing.relationship}
            onChange={event => setEditing({ ...editing, relationship: event.target.value as EmergencyContactRelationship })}>
            {EMERGENCY_CONTACT_RELATIONSHIPS.map(value => <option key={value} value={value}>{RELATIONSHIP_LABELS[value]}</option>)}</select></label>
          <label className="patient-checkbox"><input type="checkbox" checked={editing.notifyOnEmergencyAccess}
            onChange={event => setEditing({ ...editing, notifyOnEmergencyAccess: event.target.checked })} />
            Notify this contact if emergency access is used</label>
          <p className="patient-field-hint">To change the phone number or email, remove this contact and add a new one.</p>
          <div className="patient-decision-actions"><button type="submit" className="patient-primary-button" disabled={busy || editing.name.trim().length < 2}>Save contact</button>
            <button type="button" className="patient-secondary-button" disabled={busy}
              onClick={() => { setEditing(null); focusAfter(byId(`contact-edit-${contact.contactId}`)) }}>Cancel</button></div>
        </form>}
        {removing === contact.contactId && <div className="patient-decision-actions">
          <span>Remove {contact.name}? They will no longer be notified.</span>
          <button id={`contact-confirm-remove-${contact.contactId}`} type="button" className="patient-secondary-button" disabled={busy} onClick={() => remove(contact.contactId)}>Confirm removal</button>
          <button type="button" disabled={busy} onClick={() => { setRemoving(null); focusAfter(byId(`contact-remove-${contact.contactId}`)) }}>Keep contact</button></div>}
      </li>)}</ul>)}
    <p id="emergency-contacts-limit" className="patient-field-hint">You can add up to 5 emergency contacts.</p>
    {!adding ? <button ref={addButton} type="button" className="patient-secondary-button" disabled={busy || (contacts.data?.length ?? 0) >= 5}
      aria-describedby="emergency-contacts-limit"
      onClick={() => setAdding(true)}>Add emergency contact</button>
      : <form className="patient-form patient-contact-form" onSubmit={add}>
        <label>Contact name<input ref={addName} autoFocus required minLength={2} maxLength={120} autoComplete="off" value={draft.name}
          onChange={event => setDraft({ ...draft, name: event.target.value })} aria-describedby="contact-name-hint" /></label>
        <p id="contact-name-hint" className="patient-field-hint">At least 2 characters.</p>
        <label>Relationship<select value={draft.relationship}
          onChange={event => setDraft({ ...draft, relationship: event.target.value as EmergencyContactRelationship })}>
          {EMERGENCY_CONTACT_RELATIONSHIPS.map(value => <option key={value} value={value}>{RELATIONSHIP_LABELS[value]}</option>)}</select></label>
        <label>How should we reach them?<select value={draft.channel}
          onChange={event => setDraft({ ...draft, channel: event.target.value as 'sms' | 'email', destination: '' })}>
          <option value="sms">SMS</option><option value="email">Email</option></select></label>
        <label>{draft.channel === 'sms' ? 'Phone number' : 'Email address'}<input required autoComplete="off"
          type={draft.channel === 'sms' ? 'tel' : 'email'} inputMode={draft.channel === 'sms' ? 'tel' : 'email'}
          maxLength={254} value={draft.destination} onChange={event => setDraft({ ...draft, destination: event.target.value })} /></label>
        <label className="patient-checkbox"><input type="checkbox" checked={draft.notifyOnEmergencyAccess}
          onChange={event => setDraft({ ...draft, notifyOnEmergencyAccess: event.target.checked })} />
          Notify this contact if emergency access is used</label>
        <div className="patient-decision-actions"><button type="submit" className="patient-primary-button"
          disabled={busy || draft.name.trim().length < 2 || !draft.destination.trim()}>Save contact</button>
          <button type="button" className="patient-secondary-button" disabled={busy}
            onClick={() => { setAdding(false); focusAfter(() => addButton.current) }}>Cancel</button></div>
      </form>}
  </div>
}

export function AccountDeletionCard() {
  const { api, signOut } = useSession()
  const navigate = useNavigate()
  const status = usePatientResource(api.accountDeletionStatus)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [pending, setPending] = useState<AccountDeletionRequested | null>(null)
  const [phrase, setPhrase] = useState('')
  const [completed, setCompleted] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const completedHeading = useRef<HTMLHeadingElement>(null)
  const proceedButton = useRef<HTMLButtonElement>(null)
  const focusAfter = useActionFocus()
  const retryFocus = useRetryFocus(status.loading, status.error, heading)

  const request = async () => {
    if (busy || !acknowledged) return
    setBusy(true); setError(null); setNotice(null)
    // On success the confirmation opens with focus in its phrase field.
    try { setPending(await api.requestAccountDeletion()); setPhrase('') }
    catch (cause) {
      setError(problemCode(cause) === 'PATIENT_RECENT_AUTH_REQUIRED'
        ? 'For your security, sign out, sign in again, and return here within 10 minutes to delete your account.'
        : problem(cause, 'The deletion request could not be started.'))
      focusAfter(() => proceedButton.current)
    } finally { setBusy(false) }
  }

  const confirm = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !pending || phrase.trim().toUpperCase() !== CONFIRMATION_PHRASE) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const result = await api.confirmAccountDeletion(pending.requestId, pending.confirmationToken, phrase)
      setPending(null); setPhrase(''); setAcknowledged(false)
      if (result.state === 'completed') { setCompleted(true); focusAfter(() => completedHeading.current) }
      else { await status.reload(); focusAfter(() => heading.current) }
    } catch (cause) {
      setPending(null); setPhrase('')
      setError(problem(cause, 'The deletion could not be confirmed. Start again.'))
      await status.reload()
      focusAfter(() => heading.current)
    } finally { setBusy(false) }
  }

  const cancel = async (requestId: string, control: HTMLElement) => {
    if (busy) return
    setBusy(true); setError(null); setNotice(null)
    try {
      await api.cancelAccountDeletion(requestId); setPending(null); setNotice('Account deletion cancelled. Your account stays open.')
      await status.reload()
      focusAfter(() => heading.current)
    } catch (cause) { setError(problem(cause, 'The deletion could not be cancelled.')); focusAfter(() => control) }
    finally { setBusy(false) }
  }

  const finish = async () => {
    // The backend has already revoked every session; clear local state only.
    try { await signOut() } catch { /* the session is already closed */ }
    navigate('/sign-in', { replace: true })
  }

  if (completed) {
    return <div className="patient-card patient-danger-card" role="status" aria-labelledby="account-deletion-heading">
      <h2 ref={completedHeading} tabIndex={-1} id="account-deletion-heading">Your account has been deleted</h2>
      <p>You have been signed out everywhere and this sign-in can no longer be used.</p>
      <p className="patient-field-hint">Your Health ID and the records healthcare facilities hold about you were kept, as required for your care and the law.</p>
      <button type="button" className="patient-primary-button" onClick={() => void finish()}>Finish</button>
    </div>
  }

  const current = status.data?.request
  const waiting = status.data ? days(status.data.waitingPeriodSeconds) : null
  const scheduled = current?.state === 'pending' && current.scheduledFor

  return <div className="patient-card patient-danger-card" aria-labelledby="account-deletion-heading" aria-busy={status.loading || undefined}>
    <h2 ref={heading} tabIndex={-1} id="account-deletion-heading">Delete account</h2>
    {error && <p role="alert" className="patient-inline-error">{error}</p>}
    <div role="status">{notice && <p className="patient-inline-success">{notice}</p>}</div>
    {status.loading && !status.data && <p role="status" className="patient-loading">Checking your account…</p>}
    {status.error && <div role="alert"><p>{status.error}</p><button ref={retryFocus.button} type="button" onClick={() => { retryFocus.retried(); void status.reload() }}>Try again</button></div>}
    {status.data && !status.error && (scheduled
      ? <>
        <p>Your account is scheduled for deletion on <strong>{dateTime(current.scheduledFor)}</strong>.</p>
        <p className="patient-field-hint">Until then you can keep using Health ID and cancel at any time. After that date this cannot be undone.</p>
        <button type="button" className="patient-primary-button" disabled={busy || status.loading} onClick={event => void cancel(current.requestId, event.currentTarget)}>Cancel deletion</button>
      </>
      : <>
        {current?.state === 'blocked' && current.blockedReasonCode && <p role="alert" className="patient-inline-error">{BLOCKED_REASONS[current.blockedReasonCode]}</p>}
        <p>Deleting your account closes your Health ID sign-in. Before you continue:</p>
        <ul className="patient-consequences">
          <li>You will no longer be able to sign in, and every device you are signed in on will be signed out.</li>
          <li>Access you have given providers, and your Access PIN, will be withdrawn.</li>
          <li>Your Health ID and the medical records facilities hold about you are kept. Facilities may still need them to treat you, and emergency care rules still apply.</li>
          <li>Some security and audit records must be kept even after deletion.</li>
          <li>You have {waiting} to change your mind. After that, deletion cannot be undone.</li>
          <li>If any of your records are under a legal hold, deletion will be blocked and nothing is removed.</li>
        </ul>
        {!pending ? <>
          <label className="patient-checkbox"><input type="checkbox" checked={acknowledged}
            onChange={event => setAcknowledged(event.target.checked)} /> I understand what deleting my account means</label>
          <p className="patient-field-hint">You must have signed in within the last 10 minutes.</p>
          <button ref={proceedButton} type="button" className="patient-danger-button" disabled={busy || status.loading || !acknowledged} onClick={() => void request()}>Continue to delete account</button>
        </> : <form className="patient-form" onSubmit={event => void confirm(event)}>
          <p className="patient-field-hint">This confirmation expires at {dateTime(pending.confirmationExpiresAt)}.</p>
          <label>Type {CONFIRMATION_PHRASE} to confirm<input autoFocus required autoComplete="off" spellCheck={false} value={phrase}
            onChange={event => setPhrase(event.target.value)} /></label>
          <div className="patient-decision-actions">
            <button type="submit" className="patient-danger-button" disabled={busy || phrase.trim().toUpperCase() !== CONFIRMATION_PHRASE}>Delete my account</button>
            <button type="button" className="patient-secondary-button" disabled={busy} onClick={event => void cancel(pending.requestId, event.currentTarget)}>Keep my account</button>
          </div>
        </form>}
      </>)}
  </div>
}
