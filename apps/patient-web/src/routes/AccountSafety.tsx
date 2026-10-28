import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import {
  EMERGENCY_CONTACT_RELATIONSHIPS, type AccountDeletionBlockedReason, type AccountDeletionRequested, type AccountDeletionStatus,
  type EmergencyContact, type EmergencyContactChannel, type EmergencyContactRelationship, type EmergencyContactsAvailability,
  type PatientApi,
} from '../api'
import { usesNovuBackend } from '../backendContract'
import { learnAccountDeletionServed, useAccountDeletionServed } from '../accountDeletionServed'
import { describedBy } from '../authSteps'
import { useSession } from '../session'
import { ItemName } from '../ItemName'
import { usePatientResource } from './usePatientResource'
import { CodeBoxes, codeComplete } from '../CodeBoxes'
import { useActionFocus, useRetryFocus } from './actionFocus'
import { ProfileSection } from './ProfileSection'

/*
 * Patient-facing account deletion and emergency-contact management. The
 * backend enforces ownership, fresh sign-in, verification, retention, and
 * eligibility; these screens only explain the consequences and collect intent.
 * Emergency contacts read availability first (hid-system #109): the card says
 * what is on, and offers only what Identity will accept now.
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

/** The deletion card's dates, in WAT as the deletion emails give them (contract b45-contract.md §3.3). */
function watDateTime(value: string | null | undefined) {
  if (!value) return 'Not available'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value
    : `${new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(parsed)} WAT`
}

/**
 * A refused deletion step, in the card's own words for the two sign-in rules (contract §3.1): a sign-in more than 10
 * minutes old, and (hid-system 0096 on Novu) an account recovered in the last 24 hours. Any other refusal says its detail.
 */
function deletionProblem(cause: unknown, fallback: string) {
  switch (problemCode(cause)) {
    case 'PATIENT_RECENT_AUTH_REQUIRED':
      return 'For your security, sign out, sign in again, and return here within 10 minutes to delete your account.'
    case 'PATIENT_RECENT_RECOVERY_HOLD':
      return 'For your security, account deletion is not available for 24 hours after you recover your account.'
    default: return problem(cause, fallback)
  }
}

const BLOCKED_REASONS: Record<AccountDeletionBlockedReason, string> = {
  LEGAL_HOLD: 'Your account can’t be deleted now: some of your records are under a legal hold. Contact Health ID support.',
  RETENTION_POLICY_UNAVAILABLE: 'Nothing was deleted: we couldn’t confirm how your records must be kept. Try again later or contact Health ID support.',
  WORKFORCE_ACCOUNT: 'This sign-in is also used for staff access, so it can’t be deleted here. Contact your organisation or Health ID support.',
}

const RELATIONSHIP_LABELS: Record<EmergencyContactRelationship, string> = {
  spouse: 'Spouse', partner: 'Partner', parent: 'Parent', child: 'Child', sibling: 'Sibling', relative: 'Relative',
  guardian: 'Guardian', caregiver: 'Caregiver', friend: 'Friend', other: 'Other',
}
const CHANNEL_LABELS: Record<EmergencyContactChannel, string> = { sms: 'SMS', email: 'Email' }
const CHANNEL_WORDS: Record<EmergencyContactChannel, string> = { sms: 'SMS', email: 'email' }
const DESTINATION_LABELS: Record<EmergencyContactChannel, string> = { sms: 'phone number', email: 'email address' }

/**
 * What each backend's alert to a verified contact says, in short: Novu's (hid-system #109's emergencyContactAlertContent)
 * gives the patient's name, the last four characters of their Health ID, the health worker, the facility, its phone
 * and the time; main's the first name, the facility and the time. Neither gives medical details or the reason.
 */
const NOVU_ALERT = 'If a health worker opens your record in an emergency, verified contacts are told who opened it, where and when. Never medical details.'
const MAIN_ALERT = 'If a provider opens your record in an emergency, verified contacts are told your first name, where and when. Never medical details.'

/** hid-system main does not serve availability (404): its card stays as it was, with both channels. */
const MAIN_OFFER: EmergencyContactsAvailability = { delivery: true, channels: ['sms', 'email'] }

/** #109's answer, or null for any other 200: it does not say whether delivery is on. */
function offerOf(value: unknown): EmergencyContactsAvailability | null {
  if (typeof value !== 'object' || value === null) return null
  const { delivery, channels } = value as { delivery?: unknown; channels?: unknown }
  if (typeof delivery !== 'boolean' || !Array.isArray(channels)) return null
  return { delivery, channels: [...new Set(channels.filter((channel): channel is EmergencyContactChannel =>
    channel === 'email' || channel === 'sms'))] }
}

/**
 * What this patient is offered. A backend without the route (a 404, or a 200 that is not #109's answer) is main's:
 * its card stays as it was; on Novu nothing is offered and no list is read.
 */
async function readOffer(api: PatientApi, signal?: AbortSignal): Promise<EmergencyContactsAvailability | null> {
  const unserved = usesNovuBackend() ? null : MAIN_OFFER
  try {
    return offerOf(await api.emergencyContactsAvailability(signal)) ?? unserved
  } catch (reason) {
    if (isHidApiError(reason) && reason.status === 404) return unserved
    throw reason
  }
}

export interface ContactsView { offer: EmergencyContactsAvailability | null; contacts: EmergencyContact[] }

/**
 * Availability, then the list. Availability is read once, and again only after its read failed or when an action
 * finds delivery off, so 'Try again' repeats what failed and a reload after an action reads the list only.
 */
function contactsSource(api: PatientApi) {
  let offer: EmergencyContactsAvailability | null | undefined
  return {
    forget: () => { offer = undefined },
    load: async (signal?: AbortSignal): Promise<ContactsView> => {
      if (offer === undefined) offer = await readOffer(api, signal)
      const current = offer
      return { offer: current, contacts: current ? await api.emergencyContacts(signal) : [] }
    },
  }
}

/**
 * Availability, then the list, read afresh: what the profile's completion and the overview count (hid-1.0 parity B3).
 * Kept under the card's own name ('emergency-contacts'), so the profile's card shows it at once.
 */
export const readEmergencyContacts = (api: PatientApi) => (signal?: AbortSignal): Promise<ContactsView> => contactsSource(api).load(signal)

/**
 * The contacts the completion counts, or null where the patient can't add one now (the routes are not served, or
 * delivery is off and they have none): the item is then left out rather than counted as missing.
 */
export function contactsToCount(view: ContactsView | null | undefined): readonly EmergencyContact[] | null {
  if (!view?.offer) return null
  if (!view.offer.delivery && view.contacts.length === 0) return null
  return view.contacts
}

/**
 * `reachable`: Identity sends on the contact's channel now. #109's dispatcher does not send on a channel switched off
 * since the contact was verified, though the list still says the contact is eligible.
 */
function contactStatus(contact: EmergencyContact, paused: boolean, reachable: boolean) {
  if (contact.eligibleForEmergencyNotification) {
    if (paused) return 'Verified · alerts are paused'
    return reachable ? 'Verified · will be notified in an emergency' : `Verified · alerts by ${CHANNEL_WORDS[contact.channel]} are paused`
  }
  return contact.status === 'verified' ? 'Verified · notifications off' : 'Not verified · will not be notified'
}

/** A code still open after a reload: its challenge is not held here, so entering a code needs a new one. */
function pendingCode(pending: NonNullable<EmergencyContact['pendingVerification']>) {
  return `A verification code is pending until ${dateTime(pending.expiresAt)}.${pending.deliveryOutcome === 'accepted' ? ''
    : ' We could not confirm the code was delivered.'} To enter a code here, send a new one.`
}

/**
 * The last emergency alert to a contact, by identity.list_my_emergency_contacts's statuses. Its time is when the
 * alert was raised. The list does not say whether an attempt was made: an attempt with an unknown outcome is retried
 * and may have reached the contact, so only `delivered` (the provider accepted it) is certain. Failed: definitively
 * refused, or 8 attempts without a confirmed outcome. Expired: not confirmed within its 24-hour window. Suppressed:
 * the contact's notifications were turned off before it was confirmed.
 */
const LAST_ALERT: Readonly<Record<string, string>> = {
  delivered: 'delivered', pending: 'not yet confirmed as delivered', failed: 'not confirmed as delivered',
  expired: 'not confirmed as delivered within 24 hours',
  suppressed: 'stopped, because notifications were turned off for this contact',
}

function LastAlert({ notice }: { notice: EmergencyContact['lastNotification'] }) {
  if (!notice || !LAST_ALERT[notice.status]) return null
  return <span>Last emergency alert ({dateTime(notice.createdAt)}): {LAST_ALERT[notice.status]}</span>
}

/** What a refused or failed send means for the contact. Main's gateway passes its 5xx codes through; Novu's does not. */
function sendFailure(cause: unknown, contact: EmergencyContact) {
  const unverified = 'This contact stays unverified and will not be notified.'
  switch (problemCode(cause)) {
    case 'EMERGENCY_CONTACT_DELIVERY_UNAVAILABLE': return `Contact verification is not available yet. ${unverified}`
    case 'EMERGENCY_CONTACT_CHANNEL_UNAVAILABLE':
      return `Verification codes cannot be sent by ${CHANNEL_WORDS[contact.channel]} yet. ${unverified}`
    case 'EMERGENCY_CONTACT_VERIFICATION_UNDELIVERABLE': return `The code could not be delivered to ${contact.destinationHint}. `
      + `${unverified} If the ${DESTINATION_LABELS[contact.channel]} is wrong, remove this contact and add it again.`
    default:
  }
  // Behind Novu's gateway every 502, 503 and 504 is 503 UPSTREAM_UNAVAILABLE, whatever the cause.
  if (isHidApiError(cause) && cause.status >= 500) {
    return 'The code could not be sent right now. This contact stays unverified and will not be notified until it is verified. Try again later.'
  }
  return problem(cause, 'The verification code could not be sent.')
}

/**
 * What a refused send changed, so the card reads it again: delivery or the channel may have just been switched off
 * (the card then offers no code for it), or the contact was removed or verified elsewhere, or #109 invalidated the
 * pending code (a definitive refusal closes the new one, and a resend has already closed the old). A 429 changes
 * nothing, and after a 5xx the read would most likely fail too.
 */
const SEND_READS: Readonly<Record<string, 'list' | 'availability'>> = {
  EMERGENCY_CONTACT_DELIVERY_UNAVAILABLE: 'availability', EMERGENCY_CONTACT_CHANNEL_UNAVAILABLE: 'availability',
  EMERGENCY_CONTACT_VERIFICATION_UNDELIVERABLE: 'list', EMERGENCY_CONTACT_NOT_FOUND: 'list',
  EMERGENCY_CONTACT_ALREADY_VERIFIED: 'list',
}

/** An added or verified contact whose 'Notify this contact' is unticked: #109 alerts only those with it ticked. */
const NOTIFICATIONS_OFF = 'Notifications are off for this contact, so they will not be notified in an emergency.'

type Find = () => HTMLElement | null
/** What a refused action says, where focus goes, whether the destination field is at fault, and what is read again first. */
interface Refusal { message: string; focus: Find; field?: boolean; read?: 'list' | 'availability' }

export function EmergencyContactsCard({ alone = false }: { alone?: boolean }) {
  const { api } = useSession()
  const source = useMemo(() => contactsSource(api), [api])
  const card = usePatientResource(source.load, 'emergency-contacts')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [destinationInvalid, setDestinationInvalid] = useState(false)
  const [adding, setAdding] = useState(false)
  // No channel chosen yet: the first one offered.
  const [draft, setDraft] = useState({ name: '', relationship: 'relative' as EmergencyContactRelationship,
    channel: null as EmergencyContactChannel | null, destination: '', notifyOnEmergencyAccess: true })
  const [verifying, setVerifying] = useState<{ contactId: string; challengeId: string; expiresAt: string } | null>(null)
  const [code, setCode] = useState('')
  const [editing, setEditing] = useState<{ contactId: string; version: number; name: string;
    relationship: EmergencyContactRelationship; notifyOnEmergencyAccess: boolean } | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  // 'Try again' was pressed: the card it was on stays while the read runs, on Novu too.
  const [retried, setRetried] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const addName = useRef<HTMLInputElement>(null)
  const focusAfter = useActionFocus()
  const retryFocus = useRetryFocus(heading)
  const byId = (id: string): Find => () => document.getElementById(id)
  const orHeading = (id: string): Find => () => document.getElementById(id) ?? heading.current
  const toHeading = (): HTMLElement | null => heading.current

  const offer = card.data?.offer ?? null
  const listed = card.data?.contacts ?? null
  // Delivery off (#109): contacts can only be removed, and nobody is said to be notified.
  const paused = offer?.delivery === false
  const channels = offer?.delivery ? offer.channels : []
  const channel = draft.channel && channels.includes(draft.channel) ? draft.channel : channels[0] ?? 'email'
  // A channel switched off since a contact was added (#109): no code is offered on it, and nobody on it is alerted.
  const reachable = (contact: EmergencyContact) => channels.includes(contact.channel)

  // Each action ends once the card shows its outcome; focus then goes to the heading, or where a refusal says. A
  // refusal may read the list again first, or availability and the list when delivery may have been switched off.
  const run = async (action: () => Promise<Find | void>, refused: (cause: unknown) => Refusal) => {
    if (busy) return
    setBusy(true); setError(null); setNotice(null); setDestinationInvalid(false)
    let target: Find = toHeading
    try { target = (await action()) ?? toHeading } catch (cause) {
      const refusal = refused(cause)
      setError(refusal.message); setDestinationInvalid(refusal.field ?? false); target = refusal.focus
      if (refusal.read === 'availability') source.forget()
      if (refusal.read) await card.reload()
    } finally { setBusy(false); focusAfter(target) }
  }

  const add = (event: FormEvent) => {
    event.preventDefault()
    const name = draft.name.trim(), destination = draft.destination.trim()
    if (name.length < 2 || destination.length < 5) return
    const notify = draft.notifyOnEmergencyAccess
    void run(async () => {
      await api.addEmergencyContact({ name, relationship: draft.relationship, channel, destination,
        notifyOnEmergencyAccess: notify })
      setDraft(value => ({ ...value, name: '', destination: '' })); setAdding(false)
      setNotice(notify ? 'Contact added. Send a verification code so they can be notified in an emergency.'
        : `Contact added. ${NOTIFICATIONS_OFF} To have them notified, send a verification code and turn notifications on in Edit.`)
      await card.reload()
    }, (cause): Refusal => {
      switch (problemCode(cause)) {
        case 'EMERGENCY_CONTACT_DELIVERY_UNAVAILABLE':
          setAdding(false)
          return { message: 'Emergency contacts are not available right now, so this contact was not added.', focus: toHeading,
            read: 'availability' }
        case 'EMERGENCY_CONTACT_CHANNEL_UNAVAILABLE':
          setDraft(value => ({ ...value, channel: null, destination: '' }))
          return { message: `Emergency contacts cannot be reached by ${CHANNEL_WORDS[channel]} yet, so this contact was not added.`,
            focus: orHeading('contact-destination'), read: 'availability' }
        case 'EMERGENCY_CONTACT_DESTINATION_INVALID': case 'VALIDATION_FAILED':
          return { message: `Enter a valid ${DESTINATION_LABELS[channel]}.`, focus: byId('contact-destination'), field: true }
        default: return { message: problem(cause, 'The contact could not be added.'), focus: () => addName.current }
      }
    })
  }

  const sendCode = (contact: EmergencyContact) => void run(async () => {
    const sent = await api.sendEmergencyContactVerification(contact.contactId)
    setVerifying({ contactId: contact.contactId, challengeId: sent.challengeId, expiresAt: sent.expiresAt }); setCode('')
    const expires = `It expires ${dateTime(sent.expiresAt)}.`
    setNotice(sent.deliveryOutcome === 'unknown'
      ? `We could not confirm the code was delivered to ${contact.destinationHint}. If ${contact.name} received it, ask them to read it to you. ${expires}`
      : `A code was sent to ${contact.destinationHint}. Ask ${contact.name} to read it to you. ${expires}`)
    return byId(`contact-code-${contact.contactId}`)
  }, (cause): Refusal => {
    // Delivery may have just been switched off for this patient (the card then lists contacts with Remove only), or
    // this contact's channel; or the list is out of date. A code form open for this contact then has no code left.
    const read = SEND_READS[problemCode(cause) ?? '']
    if (read === 'list') setVerifying(value => value?.contactId === contact.contactId ? null : value)
    return { message: sendFailure(cause, contact), focus: orHeading(`contact-send-${contact.contactId}`), ...(read ? { read } : {}) }
  })

  const confirmCode = (event: FormEvent) => {
    event.preventDefault()
    if (!verifying || !/^\d{6}$/.test(code)) return
    const { contactId, challengeId } = verifying
    const notify = listed?.find(item => item.contactId === contactId)?.notifyOnEmergencyAccess ?? true
    void run(async () => {
      await api.confirmEmergencyContactVerification(contactId, challengeId, code)
      // Verifying changes the contact's version: an edit open on it would be refused as a change made elsewhere.
      setVerifying(null); setCode(''); setEditing(value => value?.contactId === contactId ? null : value)
      setNotice(notify ? 'Contact verified. They will be notified if emergency access to your record is used.'
        : `Contact verified. ${NOTIFICATIONS_OFF} To have them notified, turn notifications on in Edit.`)
      await card.reload()
    }, (cause): Refusal => {
      if (problemCode(cause) !== 'EMERGENCY_CONTACT_NOT_FOUND') {
        return { message: problem(cause, 'The code could not be verified.'), focus: byId(`contact-code-${contactId}`) }
      }
      // Removed elsewhere since the list was read.
      setVerifying(null); setCode('')
      return { message: problem(cause, 'The code could not be verified.'), focus: toHeading, read: 'list' }
    })
  }

  const saveEdit = (event: FormEvent) => {
    event.preventDefault()
    if (!editing) return
    const { contactId } = editing
    void run(async () => {
      await api.updateEmergencyContact(contactId, { expectedVersion: editing.version, name: editing.name.trim(),
        relationship: editing.relationship, notifyOnEmergencyAccess: editing.notifyOnEmergencyAccess })
      setEditing(null); setNotice('Contact updated.'); await card.reload()
    }, (cause): Refusal => {
      if (problemCode(cause) === 'EMERGENCY_CONTACT_NOT_FOUND') {
        // Removed elsewhere since the list was read (by the patient, or by support at the contact's request).
        setEditing(null)
        return { message: problem(cause, 'The contact could not be updated.'), focus: orHeading(`contact-edit-${contactId}`), read: 'list' }
      }
      if (problemCode(cause) !== 'EMERGENCY_CONTACT_VERSION_CONFLICT') {
        return { message: problem(cause, 'The contact could not be updated.'), focus: byId(`contact-name-${contactId}`) }
      }
      // Changed elsewhere since it was read: the list is read again, so Edit opens with the current version.
      setEditing(null)
      return { message: 'This contact was changed in another window or on another device, so your change was not saved. '
        + 'Its current details are shown now: edit it again if you still want to change it.',
      focus: orHeading(`contact-edit-${contactId}`), read: 'list' }
    })
  }

  const remove = (contactId: string) => void run(async () => {
    await api.deactivateEmergencyContact(contactId)
    setRemoving(null); setNotice('Contact removed. They will no longer be notified.'); await card.reload()
  }, cause => ({ message: problem(cause, 'The contact could not be removed.'), focus: byId(`contact-confirm-remove-${contactId}`) }))

  // Nothing is offered where the routes are not served (Novu), or while delivery is off for a patient with no
  // contacts, and nothing shows on Novu before that is known. An action's own outcome is still said, and so is the
  // outcome of 'Try again', whose heading then takes focus.
  const hidden = !card.error && (card.data ? !offer || (paused && listed?.length === 0) : usesNovuBackend() && !retried)
  if (hidden && !error && !notice && !retried) return null
  const unoffered = hidden && retried && Boolean(card.data) && !error && !notice

  // Only the list is busy while it reloads: a notice outside it is not held back.
  const block = <div id="emergency-contacts" className="patient-emergency-contacts" aria-labelledby="emergency-contacts-heading">
    <h3 ref={heading} tabIndex={-1} id="emergency-contacts-heading">Emergency contacts</h3>
    {!hidden && <p className="patient-field-hint">{usesNovuBackend() ? NOVU_ALERT : MAIN_ALERT}</p>}
    {!hidden && paused && <p className="patient-field-hint">Alerts are paused. You can only remove contacts for now.</p>}
    {error && <p id="emergency-contacts-error" role="alert" className="patient-inline-error">{error}</p>}
    <div role="status">{notice && <p className="patient-inline-success">{notice}</p>}
      {unoffered && <p className="patient-field-hint">Emergency contacts are not available for your account right now.</p>}</div>
    {!hidden && card.loading && !card.data && <p role="status" className="patient-loading">Loading your contacts…</p>}
    {!hidden && card.error && <div role="alert"><p>{card.error}</p><button ref={retryFocus.button} type="button" onClick={() => { setRetried(true); retryFocus.retry(card.reload) }}>Try again</button></div>}
    {!hidden && listed && !card.error && <div aria-busy={card.loading || undefined}>{listed.length === 0
      ? <p className="patient-empty">You have no emergency contacts.</p>
      : <ul className="patient-list">{listed.map(contact => <li key={contact.contactId} className="patient-access-item">
        <div><strong>{contact.name}</strong>
          <span>{RELATIONSHIP_LABELS[contact.relationship]} · {CHANNEL_LABELS[contact.channel]} {contact.destinationHint}</span>
          <span className={contact.eligibleForEmergencyNotification && reachable(contact) ? 'patient-status-tag patient-status-tag-ok' : 'patient-status-tag'}>
            {contactStatus(contact, paused, reachable(contact))}</span>
          {reachable(contact) && contact.status === 'unverified' && contact.pendingVerification && verifying?.contactId !== contact.contactId
            && <span>{pendingCode(contact.pendingVerification)}</span>}
          {!paused && !reachable(contact) && contact.status === 'unverified'
            && <span>Verification codes cannot be sent by {CHANNEL_WORDS[contact.channel]} right now.</span>}
          <LastAlert notice={contact.lastNotification} />
        </div>
        <div className="patient-decision-actions">
          {reachable(contact) && contact.status === 'unverified' && <button id={`contact-send-${contact.contactId}`} type="button" className="patient-secondary-button" disabled={busy}
            onClick={() => sendCode(contact)}>Send verification code <ItemName>to {contact.name}, {contact.destinationHint}</ItemName></button>}
          {!paused && <button id={`contact-edit-${contact.contactId}`} type="button" disabled={busy} onClick={() => setEditing({ contactId: contact.contactId, version: contact.version,
            name: contact.name, relationship: contact.relationship, notifyOnEmergencyAccess: contact.notifyOnEmergencyAccess })}>Edit <ItemName>{contact.name}, {contact.destinationHint}</ItemName></button>}
          <button id={`contact-remove-${contact.contactId}`} type="button" disabled={busy} onClick={() => setRemoving(contact.contactId)}>Remove <ItemName>{contact.name}, {contact.destinationHint}</ItemName></button>
        </div>
        {!paused && verifying?.contactId === contact.contactId && <form className="patient-deny-form" onSubmit={confirmCode}>
          <CodeBoxes id={`contact-code-${contact.contactId}`} label={`Code from ${contact.name}`} value={code} onChange={setCode} busy={busy} autoFocus />
          <button type="submit" disabled={busy || !codeComplete(code)}>Verify contact</button></form>}
        {!paused && editing?.contactId === contact.contactId && <form className="patient-form patient-contact-form" onSubmit={saveEdit}>
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
      </li>)}</ul>}</div>}
    {!hidden && channels.length > 0 && <>
      <p id="emergency-contacts-limit" className="patient-field-hint">Up to 5 contacts.</p>
      {!adding ? <button ref={addButton} type="button" className="patient-secondary-button" disabled={busy || (listed?.length ?? 0) >= 5}
        aria-describedby="emergency-contacts-limit"
        onClick={() => setAdding(true)}>Add emergency contact</button>
        : <form className="patient-form patient-contact-form" onSubmit={add}>
          <label>Contact name<input ref={addName} autoFocus required minLength={2} maxLength={120} autoComplete="off" value={draft.name}
            onChange={event => setDraft({ ...draft, name: event.target.value })} aria-describedby="contact-name-hint" /></label>
          <p id="contact-name-hint" className="patient-field-hint">At least 2 characters.</p>
          <label>Relationship<select value={draft.relationship}
            onChange={event => setDraft({ ...draft, relationship: event.target.value as EmergencyContactRelationship })}>
            {EMERGENCY_CONTACT_RELATIONSHIPS.map(value => <option key={value} value={value}>{RELATIONSHIP_LABELS[value]}</option>)}</select></label>
          {/* Only the channels Identity can deliver on now (#109); with one, it is not asked. */}
          {channels.length > 1 && <label>How should we reach them?<select value={channel}
            onChange={event => { setDraft({ ...draft, channel: event.target.value as EmergencyContactChannel, destination: '' }); setDestinationInvalid(false) }}>
            {channels.map(value => <option key={value} value={value}>{CHANNEL_LABELS[value]}</option>)}</select></label>}
          <label>{channel === 'sms' ? 'Phone number' : 'Email address'}<input id="contact-destination" required minLength={5} maxLength={254} autoComplete="off"
            type={channel === 'sms' ? 'tel' : 'email'} inputMode={channel === 'sms' ? 'tel' : 'email'} value={draft.destination}
            onChange={event => { setDraft({ ...draft, destination: event.target.value }); setDestinationInvalid(false) }}
            aria-invalid={destinationInvalid || undefined}
            aria-describedby={describedBy(channel === 'sms' && 'contact-destination-hint', destinationInvalid && 'emergency-contacts-error')} /></label>
          {channel === 'sms' && <p id="contact-destination-hint" className="patient-field-hint">For example 0803 123 4567 or +234 803 123 4567.</p>}
          <label className="patient-checkbox"><input type="checkbox" checked={draft.notifyOnEmergencyAccess}
            onChange={event => setDraft({ ...draft, notifyOnEmergencyAccess: event.target.checked })} />
            Notify this contact if emergency access is used</label>
          <div className="patient-decision-actions"><button type="submit" className="patient-primary-button"
            disabled={busy || draft.name.trim().length < 2 || draft.destination.trim().length < 5}>Save contact</button>
            <button type="button" className="patient-secondary-button" disabled={busy}
              onClick={() => { setAdding(false); focusAfter(() => addButton.current) }}>Cancel</button></div>
        </form>}
    </>}
  </div>
  // On the profile, in Health information after its form; or, where that is not served, the section itself.
  return alone ? <ProfileSection id="health-information" title="Health information">{block}</ProfileSection> : block
}

/**
 * Delete account, on both backends: hid-system main's patient-safety routes (0064), and on Novu hid-system 0096
 * (contract b45-contract.md §3). The status read is its probe: a backend that does not serve it (Novu before 0096, or
 * with ACCOUNT_DELETION_ENABLED off) answers 404, and the card is not shown and says nothing. On Novu nothing shows
 * before an answer says it is served; main always serves it, so its loading line stays as it was.
 */
export function AccountDeletionCard() {
  const { api, signOut } = useSession()
  const navigate = useNavigate()
  const load = useCallback((signal?: AbortSignal) => api.accountDeletionStatus(signal).then(value => {
    learnAccountDeletionServed(true)
    return value
  }, (caught: unknown) => {
    if (isHidApiError(caught) && caught.status === 404) { learnAccountDeletionServed(false); return null }
    throw caught
  }), [api])
  // Kept for the account under its own name: `load` is made again each time the card is.
  const status = usePatientResource<AccountDeletionStatus | null>(load, 'account-deletion')
  const served = useAccountDeletionServed()
  const [retried, setRetried] = useState(false)
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
  const retryFocus = useRetryFocus(heading)

  const request = async () => {
    if (busy || !acknowledged) return
    setBusy(true); setError(null); setNotice(null)
    // On success the confirmation opens with focus in its phrase field.
    try { setPending(await api.requestAccountDeletion()); setPhrase('') }
    catch (cause) {
      setError(deletionProblem(cause, 'The deletion request could not be started.'))
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
      setError(deletionProblem(cause, 'The deletion could not be confirmed. Start again.'))
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
      <p>You are signed out everywhere, and this sign-in no longer works.</p>
      <p className="patient-field-hint">Your Health ID and medical records were kept, as your care and the law require.</p>
      <button type="button" className="patient-primary-button" onClick={() => void finish()}>Finish</button>
    </div>
  }

  // Not served (404), or on Novu not known yet: nothing is shown. An action's own outcome is still said, and so is the
  // outcome of 'Try again', whose heading then takes focus.
  const unserved = status.data === null && !status.error && !status.loading
  const unknown = status.data === null && !status.error && status.loading && usesNovuBackend() && served !== true
  if ((unserved || unknown) && !error && !notice && !retried) return null

  const current = status.data?.request
  const waiting = status.data ? days(status.data.waitingPeriodSeconds) : null
  const scheduled = current?.state === 'pending' && current.scheduledFor

  // Only the status is busy while it reloads: a notice outside it is not held back. On the profile, last: a section
  // closed until opened (ProfileSection.tsx), as hid-1.0's Danger Zone ended its profile.
  return <ProfileSection id="account-deletion" title="Delete account" className="patient-danger-card" headingRef={heading}
    headingId="account-deletion-heading">
    {error && <p role="alert" className="patient-inline-error">{error}</p>}
    <div role="status">{notice && <p className="patient-inline-success">{notice}</p>}</div>
    {status.loading && !status.data && <p role="status" className="patient-loading">Checking your account…</p>}
    {status.error && <div role="alert"><p>{status.error}</p><button ref={retryFocus.button} type="button"
      onClick={() => { setRetried(true); retryFocus.retry(status.reload) }}>Try again</button></div>}
    {unserved && <p>Deleting your account is not available here right now.</p>}
    {status.data && !status.error && <div aria-busy={status.loading || undefined}>{scheduled
      ? <>
        <p>Your account is scheduled for deletion on <strong>{watDateTime(current.scheduledFor)}</strong>.</p>
        <p className="patient-field-hint">Until then you can cancel. After that it can’t be undone. Your Health ID and medical records are kept.</p>
        <button type="button" className="patient-primary-button" disabled={busy || status.loading} onClick={event => void cancel(current.requestId, event.currentTarget)}>Cancel deletion</button>
      </>
      : <>
        {current?.state === 'blocked' && current.blockedReasonCode && <p role="alert" className="patient-inline-error">{BLOCKED_REASONS[current.blockedReasonCode]}</p>}
        <p>Deleting your account:</p>
        <ul className="patient-consequences">
          <li>Signs you out everywhere, and you can’t sign in again.</li>
          <li>Withdraws provider access and your Access PIN.</li>
          {/* hid-system 0096 (Novu) closes these too and sends these emails; main's 0064 does neither. */}
          {usesNovuBackend() && <li>Cancels your sharing invitations and removes your emergency contacts.</li>}
          <li>Keeps your Health ID, your medical records and some security records.</li>
          <li>Gives you {waiting} to cancel. After that it can’t be undone.</li>
          {usesNovuBackend() && <li>Emails you when it is scheduled and when it is done.</li>}
          <li>Is blocked, with nothing removed, if your records are under a legal hold.</li>
        </ul>
        {!pending ? <>
          <label className="patient-checkbox"><input type="checkbox" checked={acknowledged}
            onChange={event => setAcknowledged(event.target.checked)} /> I understand what deleting my account means</label>
          <p className="patient-field-hint">You must have signed in within the last 10 minutes.</p>
          <button ref={proceedButton} type="button" className="patient-danger-button" disabled={busy || status.loading || !acknowledged} onClick={() => void request()}>Continue to delete account</button>
        </> : <form className="patient-form" onSubmit={event => void confirm(event)}>
          <p className="patient-field-hint">This confirmation expires at {watDateTime(pending.confirmationExpiresAt)}.</p>
          <label>Type {CONFIRMATION_PHRASE} to confirm<input autoFocus required autoComplete="off" spellCheck={false} value={phrase}
            onChange={event => setPhrase(event.target.value)} /></label>
          <div className="patient-decision-actions">
            <button type="submit" className="patient-danger-button" disabled={busy || phrase.trim().toUpperCase() !== CONFIRMATION_PHRASE}>Delete my account</button>
            <button type="button" className="patient-secondary-button" disabled={busy} onClick={event => void cancel(pending.requestId, event.currentTarget)}>Keep my account</button>
          </div>
        </form>}
      </>}</div>}
  </ProfileSection>
}
