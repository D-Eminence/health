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
import { Alert, Badge, Button, Card, Field, Input, Select } from '../kasuwa/ui'
import { LoadingRows } from '../kasuwa/parts'
import { UserPlus } from 'lucide-react'
import { SAY } from '../copy'
import { Actions, ButtonR, Hint, InputR, LoadProblem, Problem, Saved } from './profileParts'

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
      return SAY.signInAgain
    case 'PATIENT_RECENT_RECOVERY_HOLD':
      return 'For your safety, you can’t delete your account for 24 hours after you recover it.'
    default: return problem(cause, fallback)
  }
}

const BLOCKED_REASONS: Record<AccountDeletionBlockedReason, string> = {
  LEGAL_HOLD: 'Your account can’t be deleted now because some records are on legal hold. Contact Health ID support.',
  RETENTION_POLICY_UNAVAILABLE: 'Nothing was deleted. Try again later or contact Health ID support.',
  WORKFORCE_ACCOUNT: 'You also use this sign-in for staff work, so it can’t be deleted here. Contact your workplace or Health ID support.',
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
const NOVU_ALERT = 'If a health worker opens your records in an emergency, verified contacts are told who, where and when. Never your medical details.'
const MAIN_ALERT = 'If a hospital opens your records in an emergency, verified contacts are told your first name, where and when. Never your medical details.'

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
    if (paused) return 'Verified · alerts paused'
    return reachable ? 'Verified · will be told in an emergency' : `Verified · ${CHANNEL_WORDS[contact.channel]} alerts paused`
  }
  return contact.status === 'verified' ? 'Verified · alerts off' : 'Not verified · won’t be told'
}

/** A code still open after a reload: its challenge is not held here, so entering a code needs a new one. */
function pendingCode(pending: NonNullable<EmergencyContact['pendingVerification']>) {
  return `A code was sent and works until ${dateTime(pending.expiresAt)}.${pending.deliveryOutcome === 'accepted' ? ''
    : ' We aren’t sure it arrived.'} To enter a code here, send a new one.`
}

/**
 * The last emergency alert to a contact, by identity.list_my_emergency_contacts's statuses. Its time is when the
 * alert was raised. The list does not say whether an attempt was made: an attempt with an unknown outcome is retried
 * and may have reached the contact, so only `delivered` (the provider accepted it) is certain. Failed: definitively
 * refused, or 8 attempts without a confirmed outcome. Expired: not confirmed within its 24-hour window. Suppressed:
 * the contact's notifications were turned off before it was confirmed.
 */
const LAST_ALERT: Readonly<Record<string, string>> = {
  delivered: 'delivered', pending: 'not confirmed yet', failed: 'not confirmed',
  expired: 'not confirmed within 24 hours',
  suppressed: 'stopped, because alerts were turned off for this contact',
}

function LastAlert({ notice }: { notice: EmergencyContact['lastNotification'] }) {
  if (!notice || !LAST_ALERT[notice.status]) return null
  return <p className="m-0 mt-1 text-[13px] text-ink-3">Last emergency alert ({dateTime(notice.createdAt)}): {LAST_ALERT[notice.status]}</p>
}

/** What a refused or failed send means for the contact. Main's gateway passes its 5xx codes through; Novu's does not. */
function sendFailure(cause: unknown, contact: EmergencyContact) {
  const unverified = 'They stay unverified and won’t be told in an emergency.'
  switch (problemCode(cause)) {
    case 'EMERGENCY_CONTACT_DELIVERY_UNAVAILABLE': return `Codes can’t be sent right now. ${unverified}`
    case 'EMERGENCY_CONTACT_CHANNEL_UNAVAILABLE':
      return `Codes can’t be sent by ${CHANNEL_WORDS[contact.channel]} right now. ${unverified}`
    case 'EMERGENCY_CONTACT_VERIFICATION_UNDELIVERABLE': return `The code didn’t reach ${contact.destinationHint}. `
      + `${unverified} If the ${DESTINATION_LABELS[contact.channel]} is wrong, remove this contact and add it again.`
    default:
  }
  // Behind Novu's gateway every 502, 503 and 504 is 503 UPSTREAM_UNAVAILABLE, whatever the cause.
  if (isHidApiError(cause) && cause.status >= 500) {
    return `The code couldn’t be sent. ${unverified} Try again later.`
  }
  return problem(cause, 'The code couldn’t be sent. Try again.')
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
const NOTIFICATIONS_OFF = 'Alerts are off for this contact, so they won’t be told in an emergency.'

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
      setNotice(notify ? 'Contact added. Now send them a code to verify them.'
        : `Contact added. ${NOTIFICATIONS_OFF} To change this, verify them and turn alerts on in Edit.`)
      await card.reload()
    }, (cause): Refusal => {
      switch (problemCode(cause)) {
        case 'EMERGENCY_CONTACT_DELIVERY_UNAVAILABLE':
          setAdding(false)
          return { message: 'Emergency contacts aren’t available right now. This contact wasn’t added.', focus: toHeading,
            read: 'availability' }
        case 'EMERGENCY_CONTACT_CHANNEL_UNAVAILABLE':
          setDraft(value => ({ ...value, channel: null, destination: '' }))
          return { message: `Contacts can’t be reached by ${CHANNEL_WORDS[channel]} right now. This contact wasn’t added.`,
            focus: orHeading('contact-destination'), read: 'availability' }
        case 'EMERGENCY_CONTACT_DESTINATION_INVALID': case 'VALIDATION_FAILED':
          return { message: `Enter a valid ${DESTINATION_LABELS[channel]}.`, focus: byId('contact-destination'), field: true }
        default: return { message: problem(cause, 'The contact couldn’t be added. Try again.'), focus: () => addName.current }
      }
    })
  }

  const sendCode = (contact: EmergencyContact) => void run(async () => {
    const sent = await api.sendEmergencyContactVerification(contact.contactId)
    setVerifying({ contactId: contact.contactId, challengeId: sent.challengeId, expiresAt: sent.expiresAt }); setCode('')
    const expires = `It works until ${dateTime(sent.expiresAt)}.`
    setNotice(sent.deliveryOutcome === 'unknown'
      ? `We aren’t sure the code reached ${contact.destinationHint}. If ${contact.name} got it, ask them to read it to you. ${expires}`
      : `Code sent to ${contact.destinationHint}. Ask ${contact.name} to read it to you. ${expires}`)
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
      setNotice(notify ? 'Contact verified. They will be told if your records are opened in an emergency.'
        : `Contact verified. ${NOTIFICATIONS_OFF} To change this, turn alerts on in Edit.`)
      await card.reload()
    }, (cause): Refusal => {
      if (problemCode(cause) !== 'EMERGENCY_CONTACT_NOT_FOUND') {
        return { message: problem(cause, 'The code couldn’t be checked. Try again.'), focus: byId(`contact-code-${contactId}`) }
      }
      // Removed elsewhere since the list was read.
      setVerifying(null); setCode('')
      return { message: problem(cause, 'The code couldn’t be checked.'), focus: toHeading, read: 'list' }
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
        return { message: problem(cause, 'The contact couldn’t be saved.'), focus: orHeading(`contact-edit-${contactId}`), read: 'list' }
      }
      if (problemCode(cause) !== 'EMERGENCY_CONTACT_VERSION_CONFLICT') {
        return { message: problem(cause, 'The contact couldn’t be saved. Try again.'), focus: byId(`contact-name-${contactId}`) }
      }
      // Changed elsewhere since it was read: the list is read again, so Edit opens with the current version.
      setEditing(null)
      return { message: 'This contact was changed somewhere else, so your change wasn’t saved. '
        + 'Check the details below and edit again if needed.',
      focus: orHeading(`contact-edit-${contactId}`), read: 'list' }
    })
  }

  const remove = (contactId: string) => void run(async () => {
    await api.deactivateEmergencyContact(contactId)
    setRemoving(null); setNotice('Contact removed.'); await card.reload()
  }, cause => ({ message: problem(cause, 'The contact couldn’t be removed. Try again.'), focus: byId(`contact-confirm-remove-${contactId}`) }))

  // Nothing is offered where the routes are not served (Novu), or while delivery is off for a patient with no
  // contacts, and nothing shows on Novu before that is known. An action's own outcome is still said, and so is the
  // outcome of 'Try again', whose heading then takes focus.
  const hidden = !card.error && (card.data ? !offer || (paused && listed?.length === 0) : usesNovuBackend() && !retried)
  if (hidden && !error && !notice && !retried) return null
  const unoffered = hidden && retried && Boolean(card.data) && !error && !notice

  // Only the list is busy while it reloads: a notice outside it is not held back.
  const relationship = (value: EmergencyContactRelationship, onChange: (next: EmergencyContactRelationship) => void, id: string) =>
    <Field label="Relationship" htmlFor={id}><Select id={id} value={value} onChange={event => onChange(event.target.value as EmergencyContactRelationship)}>
      {EMERGENCY_CONTACT_RELATIONSHIPS.map(item => <option key={item} value={item}>{RELATIONSHIP_LABELS[item]}</option>)}</Select></Field>
  const notifyBox = (checked: boolean, onChange: (next: boolean) => void) => <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
    <input type="checkbox" className="size-5 shrink-0 accent-[var(--color-brand-fill)]" checked={checked} onChange={event => onChange(event.target.checked)} />
    Tell them if my records are opened in an emergency</label>
  const block = <div id="emergency-contacts" className="flex flex-col gap-4" aria-labelledby="emergency-contacts-heading">
    <h3 ref={heading} tabIndex={-1} id="emergency-contacts-heading" className="m-0 text-title-3 text-ink outline-none">Emergency contacts</h3>
    {!hidden && <Hint>{paused ? 'Alerts are paused. For now you can only remove contacts.' : usesNovuBackend() ? NOVU_ALERT : MAIN_ALERT}</Hint>}
    {error && <Problem id="emergency-contacts-error">{error}</Problem>}
    <div role="status" className="empty:hidden">{notice && <Alert intent="success" size="sm" live={false}>{notice}</Alert>}
      {unoffered && <Hint>Emergency contacts aren’t available for your account right now.</Hint>}</div>
    {!hidden && card.loading && !card.data && <LoadingRows rows={1} label="Loading your contacts" />}
    {!hidden && card.error && <LoadProblem what="your contacts" error={card.error} buttonRef={retryFocus.button}
      onRetry={() => { setRetried(true); retryFocus.retry(card.reload) }} />}
    {!hidden && listed && !card.error && <div aria-busy={card.loading || undefined}>{listed.length === 0
      ? <Hint>No emergency contacts yet.</Hint>
      : <ul className="m-0 flex list-none flex-col gap-2 p-0">{listed.map(contact => { const ok = contact.eligibleForEmergencyNotification && reachable(contact)
        return <li key={contact.contactId} className="flex flex-col gap-3 rounded-xl p-4 ring-1 ring-line">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-semibold text-ink">{contact.name}</p>
            <p className="m-0 text-[13px] text-ink-3">{RELATIONSHIP_LABELS[contact.relationship]} · {CHANNEL_LABELS[contact.channel]} {contact.destinationHint}</p>
            {reachable(contact) && contact.status === 'unverified' && contact.pendingVerification && verifying?.contactId !== contact.contactId
              && <Hint className="mt-1">{pendingCode(contact.pendingVerification)}</Hint>}
            {!paused && !reachable(contact) && contact.status === 'unverified'
              && <Hint className="mt-1">Codes can’t be sent by {CHANNEL_WORDS[contact.channel]} right now.</Hint>}
            <LastAlert notice={contact.lastNotification} />
          </div>
          <Badge size="sm" tone={ok ? 'success' : 'warn'}>{contactStatus(contact, paused, reachable(contact))}</Badge>
        </div>
        {verifying?.contactId !== contact.contactId && editing?.contactId !== contact.contactId && removing !== contact.contactId && <Actions>
          {reachable(contact) && contact.status === 'unverified' && <Button id={`contact-send-${contact.contactId}`} size="sm" variant="soft" disabled={busy}
            onClick={() => sendCode(contact)}>Send code <ItemName>to {contact.name}, {contact.destinationHint}</ItemName></Button>}
          {!paused && <Button id={`contact-edit-${contact.contactId}`} size="sm" disabled={busy} onClick={() => setEditing({ contactId: contact.contactId, version: contact.version,
            name: contact.name, relationship: contact.relationship, notifyOnEmergencyAccess: contact.notifyOnEmergencyAccess })}>Edit <ItemName>{contact.name}, {contact.destinationHint}</ItemName></Button>}
          <Button id={`contact-remove-${contact.contactId}`} size="sm" variant="danger" disabled={busy} onClick={() => setRemoving(contact.contactId)}>Remove <ItemName>{contact.name}, {contact.destinationHint}</ItemName></Button>
        </Actions>}
        {!paused && verifying?.contactId === contact.contactId && <form className="flex flex-col gap-3" onSubmit={confirmCode}>
          <CodeBoxes id={`contact-code-${contact.contactId}`} label={`Code from ${contact.name}`} value={code} onChange={setCode} busy={busy} autoFocus />
          <Actions><Button type="submit" variant="primary" disabled={busy || !codeComplete(code)}>Verify contact</Button>
            <Button variant="ghost" disabled={busy} onClick={() => { setVerifying(null); setCode(''); focusAfter(orHeading(`contact-send-${contact.contactId}`)) }}>Cancel</Button></Actions></form>}
        {!paused && editing?.contactId === contact.contactId && <form className="flex flex-col gap-4" onSubmit={saveEdit}>
          <Field label="Name" htmlFor={`contact-name-${contact.contactId}`} hintId={`contact-name-hint-${contact.contactId}`} hint="At least 2 characters.">
            <Input id={`contact-name-${contact.contactId}`} autoFocus required minLength={2} maxLength={120} value={editing.name}
              onChange={event => setEditing({ ...editing, name: event.target.value })} aria-describedby={`contact-name-hint-${contact.contactId}`} /></Field>
          {relationship(editing.relationship, next => setEditing({ ...editing, relationship: next }), `contact-relationship-${contact.contactId}`)}
          {notifyBox(editing.notifyOnEmergencyAccess, next => setEditing({ ...editing, notifyOnEmergencyAccess: next }))}
          <Hint>To change their number or email, remove them and add them again.</Hint>
          <Actions><Button type="submit" variant="primary" disabled={busy || editing.name.trim().length < 2}>Save contact</Button>
            <Button variant="ghost" disabled={busy}
              onClick={() => { setEditing(null); focusAfter(byId(`contact-edit-${contact.contactId}`)) }}>Cancel</Button></Actions>
        </form>}
        {removing === contact.contactId && <div className="flex flex-col gap-3 rounded-lg bg-danger-soft/50 p-3">
          <p className="m-0 text-sm text-ink">Remove {contact.name}? They won’t get alerts any more.</p>
          <Actions><Button id={`contact-confirm-remove-${contact.contactId}`} size="sm" variant="destructive" disabled={busy} onClick={() => remove(contact.contactId)}>Yes, remove</Button>
            <Button size="sm" disabled={busy} onClick={() => { setRemoving(null); focusAfter(byId(`contact-remove-${contact.contactId}`)) }}>Keep contact</Button></Actions></div>}
      </li> })}</ul>}</div>}
    {!hidden && channels.length > 0 && <>
      {!adding ? <div className="flex flex-col gap-1.5 self-start">
        <ButtonR ref={addButton} icon={UserPlus} disabled={busy || (listed?.length ?? 0) >= 5}
          aria-describedby="emergency-contacts-limit" onClick={() => setAdding(true)}>Add emergency contact</ButtonR>
        <Hint id="emergency-contacts-limit">Up to 5 contacts.</Hint></div>
        : <form className="flex flex-col gap-4 rounded-xl bg-subtle p-4 ring-1 ring-line" onSubmit={add}>
          <Field label="Name" htmlFor="contact-name" hintId="contact-name-hint" hint="At least 2 characters.">
            <InputR id="contact-name" ref={addName} autoFocus required minLength={2} maxLength={120} autoComplete="off" value={draft.name}
              onChange={event => setDraft({ ...draft, name: event.target.value })} aria-describedby="contact-name-hint" /></Field>
          {relationship(draft.relationship, next => setDraft({ ...draft, relationship: next }), 'contact-relationship')}
          {/* Only the channels Identity can deliver on now (#109); with one, it is not asked. */}
          {channels.length > 1 && <Field label="How should we reach them?" htmlFor="contact-channel"><Select id="contact-channel" value={channel}
            onChange={event => { setDraft({ ...draft, channel: event.target.value as EmergencyContactChannel, destination: '' }); setDestinationInvalid(false) }}>
            {channels.map(value => <option key={value} value={value}>{CHANNEL_LABELS[value]}</option>)}</Select></Field>}
          <Field label={channel === 'sms' ? 'Phone number' : 'Email address'} htmlFor="contact-destination"
            hintId={channel === 'sms' ? 'contact-destination-hint' : undefined} hint={channel === 'sms' ? 'Like 0803 123 4567 or +234 803 123 4567.' : undefined}>
            <Input id="contact-destination" required minLength={5} maxLength={254} autoComplete="off"
              type={channel === 'sms' ? 'tel' : 'email'} inputMode={channel === 'sms' ? 'tel' : 'email'} value={draft.destination}
              onChange={event => { setDraft({ ...draft, destination: event.target.value }); setDestinationInvalid(false) }}
              aria-invalid={destinationInvalid || undefined}
              aria-describedby={describedBy(channel === 'sms' && 'contact-destination-hint', destinationInvalid && 'emergency-contacts-error')} /></Field>
          {notifyBox(draft.notifyOnEmergencyAccess, next => setDraft({ ...draft, notifyOnEmergencyAccess: next }))}
          <Actions><Button type="submit" variant="primary"
            disabled={busy || draft.name.trim().length < 2 || draft.destination.trim().length < 5}>Save contact</Button>
            <Button variant="ghost" disabled={busy}
              onClick={() => { setAdding(false); focusAfter(() => addButton.current) }}>Cancel</Button></Actions>
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
      setError(deletionProblem(cause, 'Couldn’t start deleting your account. Try again.'))
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
      setError(deletionProblem(cause, 'Your account wasn’t deleted. Please start again.'))
      await status.reload()
      focusAfter(() => heading.current)
    } finally { setBusy(false) }
  }

  const cancel = async (requestId: string, control: HTMLElement) => {
    if (busy) return
    setBusy(true); setError(null); setNotice(null)
    try {
      await api.cancelAccountDeletion(requestId); setPending(null); setNotice('Deletion cancelled. Your account stays open.')
      await status.reload()
      focusAfter(() => heading.current)
    } catch (cause) { setError(problem(cause, 'Couldn’t cancel. Try again.')); focusAfter(() => control) }
    finally { setBusy(false) }
  }

  const finish = async () => {
    // The backend has already revoked every session; clear local state only.
    try { await signOut() } catch { /* the session is already closed */ }
    navigate('/sign-in', { replace: true })
  }

  if (completed) {
    return <Card role="status" aria-labelledby="account-deletion-heading" className="flex flex-col gap-3 p-5">
      <h2 ref={completedHeading} tabIndex={-1} id="account-deletion-heading" className="m-0 text-title-3 text-ink outline-none">Your account is deleted</h2>
      <p className="m-0 text-sm text-ink-2">You are signed out on all devices. Your Health ID and medical records are kept, for your care and by law.</p>
      <Button variant="primary" className="self-start" onClick={() => void finish()}>Finish</Button>
    </Card>
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
  // Said in the heading too: the card's alert, or the date, is not seen while it is closed.
  return <ProfileSection id="account-deletion" title="Delete account" tone="danger" headingRef={heading}
    headingId="account-deletion-heading" state={status.error ? 'Could not load' : scheduled ? 'Scheduled' : null}>
    {error && <Problem>{error}</Problem>}
    <Saved>{notice}</Saved>
    {status.loading && !status.data && <LoadingRows rows={1} label="Checking your account" />}
    {status.error && <LoadProblem what="this" error={status.error} buttonRef={retryFocus.button}
      onRetry={() => { setRetried(true); retryFocus.retry(status.reload) }} />}
    {unserved && <Hint>You can’t delete your account here right now.</Hint>}
    {status.data && !status.error && <div aria-busy={status.loading || undefined} className="flex flex-col gap-4">{scheduled
      ? <>
        <p className="m-0 text-sm text-ink">Your account will be deleted on <strong>{watDateTime(current.scheduledFor)}</strong>. You can cancel until then.</p>
        <Button variant="primary" className="self-start" disabled={busy || status.loading} onClick={event => void cancel(current.requestId, event.currentTarget as HTMLElement)}>Cancel deletion</Button>
      </>
      : <>
        {current?.state === 'blocked' && current.blockedReasonCode && <Problem>{BLOCKED_REASONS[current.blockedReasonCode]}</Problem>}
        {/* hid-system 0096 (Novu) also closes sharing invitations and emergency contacts; main's 0064 does not. */}
        <p className="m-0 text-sm text-ink-2">This signs you out everywhere and removes your Access PIN{usesNovuBackend() ? ', share invites, emergency contacts' : ''} and the access you gave. Your Health ID and medical records are kept. You have {waiting} to change your mind; after that, it can’t be undone.</p>
        {!pending ? <>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink"><input type="checkbox" className="size-5 shrink-0 accent-[var(--color-danger)]" checked={acknowledged}
            onChange={event => setAcknowledged(event.target.checked)} />I understand what deleting my account means</label>
          <Hint>{SAY.signInAgain}</Hint>
          <ButtonR ref={proceedButton} variant="destructive" className="self-start" disabled={busy || status.loading || !acknowledged} onClick={() => void request()}>Continue to delete account</ButtonR>
        </> : <form className="flex flex-col gap-4" onSubmit={event => void confirm(event)}>
          <Field label={`Type ${CONFIRMATION_PHRASE} to confirm`} htmlFor="account-deletion-phrase" hintId="account-deletion-phrase-hint" hint={`Finish before ${watDateTime(pending.confirmationExpiresAt)}.`}>
            <Input id="account-deletion-phrase" autoFocus required autoComplete="off" spellCheck={false} value={phrase}
              onChange={event => setPhrase(event.target.value)} aria-describedby="account-deletion-phrase-hint" /></Field>
          <Actions>
            <Button type="submit" variant="destructive" disabled={busy || phrase.trim().toUpperCase() !== CONFIRMATION_PHRASE}>Delete my account</Button>
            <Button disabled={busy} onClick={event => void cancel(pending.requestId, event.currentTarget as HTMLElement)}>Keep my account</Button>
          </Actions>
        </form>}
      </>}</div>}
  </ProfileSection>
}
