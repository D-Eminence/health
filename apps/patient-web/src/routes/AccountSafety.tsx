import { useCallback, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { isConnectionFailure, isHidApiError, plainErrorText } from '@hid/http'
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
import { focusLost } from '../pageFocus'
import { ProfileSection } from './ProfileSection'
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Select } from '../kasuwa/ui'
import { LoadingRows } from '../kasuwa/parts'
import { PhoneCall, UserPlus } from 'lucide-react'
import { PATIENT_REFUSALS, SAY } from '../copy'
import { Actions, ButtonR, Hint, InputR, LoadProblem, Problem, Saved } from './profileParts'
import { needsRecentSignIn, SignInAgain } from './SignInAgain'

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

/** A contact the list no longer matches: said so, and the list is read again by the caller. */
const CONTACT_REFUSALS: Readonly<Record<string, string>> = {
  EMERGENCY_CONTACT_NOT_FOUND: 'This contact was removed. The list below is up to date.',
  EMERGENCY_CONTACT_ALREADY_VERIFIED: 'This contact is already verified. The list below is up to date.',
}

/** A refused step in plain words (never Identity's own text), or the step's own `fallback`. */
function problem(cause: unknown, fallback: string) {
  return plainErrorText(cause, fallback, { codes: { ...PATIENT_REFUSALS, ...CONTACT_REFUSALS } })
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
 * minutes old, and (hid-system 0096 on Novu) an account recovered in the last 24 hours. Any other refusal is said in
 * plain words (problem), never Identity's own text.
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

/**
 * A deletion confirmation that did not go through (PPS-12). Refused (a 4xx answer), the account was not deleted, and
 * that is said first. With no answer, or a failure on Identity's side, it may have gone through: the status is read
 * again, and the outcome taken from it (`afterLostConfirmation`).
 */
function confirmationRefused(cause: unknown) {
  return isHidApiError(cause) && cause.status >= 400 && cause.status < 500 && cause.status !== 408 && !isConnectionFailure(cause)
}
const notDeleted = (cause: unknown) => `Your account wasn’t deleted. ${deletionProblem(cause, 'Please start again.')}`

/**
 * What to say once the status was read again after a confirmation with no clear answer: nothing alarming when a
 * deletion is scheduled (its date says so), "wasn't deleted" when none is, and neither claim when the status could
 * not be read (`undefined`) or is not served (`null`).
 */
function afterLostConfirmation(cause: unknown, after: AccountDeletionStatus | null | undefined) {
  if (!after) return `We couldn’t confirm the deletion. ${deletionProblem(cause, 'Please check below, and start again if it isn’t scheduled.')}`
  const request = after.request
  if (request && (request.state === 'pending' || request.state === 'completed')) return null
  return notDeleted(cause)
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
/**
 * Where a refusal is said: beside what it is about (launch audit HE-05), so it is in view where focus lands. 'field' is
 * under the new contact's phone number or email; 'add', 'code' and 'edit' inside that open form, above its buttons;
 * `remove:<id>` in that contact's confirmation. 'top', or a place no longer shown, is under the card's heading.
 */
type Place = 'top' | 'field' | 'add' | 'code' | 'edit' | `remove:${string}`
/** What a refused action says, where focus goes, where it is said, and what is read again first. */
interface Refusal { message: string; focus: Find; at?: Place; read?: 'list' | 'availability' }
/** The action running, so only its button says what it is doing ('Saving…'), and every other waits. */
type Running = 'add' | 'confirm' | 'edit' | `send:${string}` | `remove:${string}`

export function EmergencyContactsCard({ alone = false }: { alone?: boolean }) {
  const { api } = useSession()
  const source = useMemo(() => contactsSource(api), [api])
  const card = usePatientResource(source.load, 'emergency-contacts')
  const [running, setRunning] = useState<Running | null>(null)
  const busy = running !== null
  // `alert`: focus was still on a control when the refusal came (Enter in a field), so it will not move and the words are read out.
  const [error, setError] = useState<{ message: string; at: Place; alert: boolean } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // The code just refused: its boxes are marked until changed (HE-10); an expired one offers a new code in its form (HE-01).
  const [codeInvalid, setCodeInvalid] = useState(false)
  const [codeExpired, setCodeExpired] = useState(false)
  // A link to this part of the profile (/profile#emergency-contacts, the + menu's "Add an emergency contact").
  const linked = useLocation().hash === '#emergency-contacts'
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
  const run = async (key: Running, action: () => Promise<Find | void>, refused: (cause: unknown) => Refusal) => {
    if (busy) return
    setRunning(key); setError(null); setNotice(null); setCodeInvalid(false)
    let target: Find = toHeading
    try { target = (await action()) ?? toHeading } catch (cause) {
      const refusal = refused(cause)
      setError({ message: refusal.message, at: refusal.at ?? 'top', alert: !focusLost() }); target = refusal.focus
      if (refusal.read === 'availability') source.forget()
      if (refusal.read) await card.reload()
    } finally { setRunning(null); focusAfter(target) }
  }

  const add = (event: FormEvent) => {
    event.preventDefault()
    const name = draft.name.trim(), destination = draft.destination.trim()
    if (name.length < 2 || destination.length < 5) return
    const notify = draft.notifyOnEmergencyAccess
    void run('add', async () => {
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
            focus: orHeading('contact-destination'), at: 'add', read: 'availability' }
        case 'EMERGENCY_CONTACT_DESTINATION_INVALID': case 'VALIDATION_FAILED':
          return { message: `Enter a valid ${DESTINATION_LABELS[channel]}.`, focus: byId('contact-destination'), at: 'field' }
        case 'EMERGENCY_CONTACT_DUPLICATE':
          return { message: 'This person is already one of your emergency contacts.', focus: byId('contact-destination'), at: 'field' }
        case 'EMERGENCY_CONTACT_LIMIT_REACHED':
          // Added elsewhere meanwhile: the list read again shows all 5, and Add waits until one is removed.
          setAdding(false)
          return { message: 'You already have 5 emergency contacts. Remove one to add another.', focus: toHeading, read: 'list' }
        default: return { message: problem(cause, 'The contact couldn’t be added. Try again.'), focus: () => addName.current, at: 'add' }
      }
    })
  }

  // `again`: from the code form, after a code expired; a refusal is then said there, by its Send a new code.
  const sendCode = (contact: EmergencyContact, again = false) => void run(`send:${contact.contactId}`, async () => {
    const sent = await api.sendEmergencyContactVerification(contact.contactId)
    setVerifying({ contactId: contact.contactId, challengeId: sent.challengeId, expiresAt: sent.expiresAt }); setCode(''); setCodeExpired(false)
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
    return { message: sendFailure(cause, contact), ...(read ? { read } : {}),
      ...(again ? { focus: orHeading(`contact-resend-${contact.contactId}`), at: 'code' as const }
        : { focus: orHeading(`contact-send-${contact.contactId}`) }) }
  })

  const confirmCode = (event: FormEvent) => {
    event.preventDefault()
    if (!verifying || !/^\d{6}$/.test(code)) return
    const { contactId, challengeId } = verifying
    const shown = listed?.find(item => item.contactId === contactId)
    const notify = shown?.notifyOnEmergencyAccess ?? true
    void run('confirm', async () => {
      await api.confirmEmergencyContactVerification(contactId, challengeId, code)
      // Verifying changes the contact's version: an edit open on it would be refused as a change made elsewhere.
      setVerifying(null); setCode(''); setEditing(value => value?.contactId === contactId ? null : value)
      setNotice(notify ? 'Contact verified. They will be told if your records are opened in an emergency.'
        : `Contact verified. ${NOTIFICATIONS_OFF} To change this, turn alerts on in Edit.`)
      await card.reload()
    }, (cause): Refusal => {
      const box = byId(`contact-code-${contactId}`)
      switch (problemCode(cause)) {
        // Identity answers both 403: said as what they are, never as access refused (HE-01).
        case 'EMERGENCY_CONTACT_CODE_INVALID':
          setCodeInvalid(true)
          return { message: `That code isn’t right. Check it with ${shown?.name ?? 'your contact'} and try again.`, focus: box, at: 'code' }
        case 'EMERGENCY_CONTACT_CODE_EXPIRED':
          // Verify gives way to Send a new code, which takes focus from the boxes: they hold nothing to correct.
          setCodeInvalid(true); setCodeExpired(true)
          if (document.activeElement instanceof HTMLElement && document.activeElement.closest('fieldset')) document.activeElement.blur()
          return { message: 'This code has expired. Send a new code.', focus: orHeading(`contact-resend-${contactId}`), at: 'code' }
        case 'EMERGENCY_CONTACT_NOT_FOUND': break
        default:
          setCodeInvalid(true)
          return { message: problem(cause, 'The code couldn’t be checked. Try again.'), focus: box, at: 'code' }
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
    void run('edit', async () => {
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
        return { message: problem(cause, 'The contact couldn’t be saved. Try again.'), focus: byId(`contact-name-${contactId}`), at: 'edit' }
      }
      // Changed elsewhere since it was read: the list is read again, so Edit opens with the current version.
      setEditing(null)
      return { message: 'This contact was changed somewhere else, so your change wasn’t saved. '
        + 'Check the details below and edit again if needed.',
      focus: orHeading(`contact-edit-${contactId}`), read: 'list' }
    })
  }

  const remove = (contactId: string) => void run(`remove:${contactId}`, async () => {
    await api.deactivateEmergencyContact(contactId)
    setRemoving(null); setNotice('Contact removed.'); await card.reload()
  }, cause => ({ message: problem(cause, 'The contact couldn’t be removed. Try again.'), focus: byId(`contact-confirm-remove-${contactId}`),
    at: `remove:${contactId}` }))

  // Nothing is offered where the routes are not served (Novu), or while delivery is off for a patient with no
  // contacts, and nothing shows on Novu before that is known. An action's own outcome is still said, and so is the
  // outcome of 'Try again', whose heading then takes focus.
  // A link here that finds them not offered says so (HE-04), rather than showing nothing under the menu's promise.
  const hidden = !card.error && (card.data ? !offer || (paused && listed?.length === 0) : usesNovuBackend() && !retried)
  const linkedUnoffered = hidden && linked && Boolean(card.data)
  if (hidden && !error && !notice && !retried && !linkedUnoffered) return null
  const unoffered = hidden && (retried || linked) && Boolean(card.data) && !error && !notice

  // Where the refusal is said: its own place while that is shown, otherwise under the heading.
  const listedId = (id: string | undefined) => !hidden && Boolean(id && listed?.some(item => item.contactId === id))
  const placeShown = (at: Place) => {
    if (at === 'field' || at === 'add') return !hidden && channels.length > 0 && adding
    if (at === 'code') return !paused && listedId(verifying?.contactId)
    if (at === 'edit') return !paused && listedId(editing?.contactId)
    if (at.startsWith('remove:')) return removing === at.slice('remove:'.length) && listedId(removing)
    return false
  }
  const errorAt: Place | null = error ? placeShown(error.at) ? error.at : 'top' : null
  const problemAt = (at: Place) => error && errorAt === at ? <Problem id="emergency-contacts-error">{error.message}</Problem> : null
  const destinationInvalid = errorAt === 'field'

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
    {problemAt('top')}
    <div role="status" className="empty:hidden">{notice && <Alert intent="success" size="sm" live={false}>{notice}</Alert>}
      {unoffered && <Hint>Emergency contacts aren’t available for your account right now.</Hint>}</div>
    {!hidden && card.loading && !card.data && <LoadingRows rows={1} label="Loading your contacts" />}
    {!hidden && card.error && <LoadProblem what="your contacts" error={card.error} buttonRef={retryFocus.button}
      onRetry={() => { setRetried(true); retryFocus.retry(card.reload) }} />}
    {!hidden && listed && !card.error && <div aria-busy={card.loading || undefined}>{listed.length === 0
      ? <EmptyState compact icon={PhoneCall} title="No emergency contacts yet"
        description="Add up to 5 people we can tell if your records are opened in an emergency." />
      : <ul className="m-0 flex list-none flex-col gap-2 p-0">{listed.map(contact => { const ok = contact.eligibleForEmergencyNotification && reachable(contact)
        return <li key={contact.contactId} className="flex flex-col gap-3 rounded-xl p-4 ring-1 ring-line">
        <div className="flex flex-wrap items-start gap-3">
          {/* A real width (as ListRow's), so on a phone the status wraps under the details instead of squeezing them (HE-02). */}
          <div className="min-w-0 flex-[1_1_12rem]">
            <p className="m-0 text-sm font-semibold [overflow-wrap:anywhere] text-ink">{contact.name}</p>
            <p className="m-0 text-[13px] [overflow-wrap:anywhere] text-ink-3">{RELATIONSHIP_LABELS[contact.relationship]} · {CHANNEL_LABELS[contact.channel]} {contact.destinationHint}</p>
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
            loading={running === `send:${contact.contactId}`}
            onClick={() => sendCode(contact)}>{running === `send:${contact.contactId}` ? 'Sending…' : 'Send code'} <ItemName>to {contact.name}, {contact.destinationHint}</ItemName></Button>}
          {!paused && <Button id={`contact-edit-${contact.contactId}`} size="sm" disabled={busy} onClick={() => setEditing({ contactId: contact.contactId, version: contact.version,
            name: contact.name, relationship: contact.relationship, notifyOnEmergencyAccess: contact.notifyOnEmergencyAccess })}>Edit <ItemName>{contact.name}, {contact.destinationHint}</ItemName></Button>}
          <Button id={`contact-remove-${contact.contactId}`} size="sm" variant="danger" disabled={busy}
            onClick={() => { setRemoving(contact.contactId); focusAfter(byId(`contact-remove-question-${contact.contactId}`)) }}>Remove <ItemName>{contact.name}, {contact.destinationHint}</ItemName></Button>
        </Actions>}
        {!paused && verifying?.contactId === contact.contactId && <form className="flex flex-col gap-3" onSubmit={confirmCode}>
          <CodeBoxes id={`contact-code-${contact.contactId}`} label={`Code from ${contact.name}`} value={code}
            onChange={value => { setCode(value); setCodeInvalid(false) }} busy={busy} autoFocus
            invalid={codeInvalid && errorAt === 'code' ? true : undefined} describedBy={codeInvalid && errorAt === 'code' ? 'emergency-contacts-error' : undefined} />
          {problemAt('code')}
          <Actions>{codeExpired
            ? <Button id={`contact-resend-${contact.contactId}`} variant="primary" disabled={busy} loading={running === `send:${contact.contactId}`}
              onClick={() => sendCode(contact, true)}>{running === `send:${contact.contactId}` ? 'Sending…' : 'Send a new code'} <ItemName>to {contact.name}, {contact.destinationHint}</ItemName></Button>
            : <Button type="submit" variant="primary" disabled={busy || !codeComplete(code)} loading={running === 'confirm'}>{running === 'confirm' ? 'Checking…' : 'Verify contact'}</Button>}
            <Button variant="ghost" disabled={busy} onClick={() => { setVerifying(null); setCode(''); setCodeInvalid(false); setCodeExpired(false); setError(null)
              focusAfter(orHeading(`contact-send-${contact.contactId}`)) }}>Cancel</Button></Actions></form>}
        {!paused && editing?.contactId === contact.contactId && <form className="flex flex-col gap-4" onSubmit={saveEdit}>
          <Field label="Name" htmlFor={`contact-name-${contact.contactId}`} hintId={`contact-name-hint-${contact.contactId}`} hint="At least 2 characters.">
            <Input id={`contact-name-${contact.contactId}`} autoFocus required minLength={2} maxLength={120} value={editing.name}
              onChange={event => setEditing({ ...editing, name: event.target.value })} aria-describedby={`contact-name-hint-${contact.contactId}`} /></Field>
          {relationship(editing.relationship, next => setEditing({ ...editing, relationship: next }), `contact-relationship-${contact.contactId}`)}
          {notifyBox(editing.notifyOnEmergencyAccess, next => setEditing({ ...editing, notifyOnEmergencyAccess: next }))}
          <Hint>To change their number or email, remove them and add them again.</Hint>
          {problemAt('edit')}
          <Actions><Button type="submit" variant="primary" disabled={busy || editing.name.trim().length < 2} loading={running === 'edit'}>{running === 'edit' ? 'Saving…' : 'Save contact'}</Button>
            <Button variant="ghost" disabled={busy}
              onClick={() => { setEditing(null); focusAfter(byId(`contact-edit-${contact.contactId}`)) }}>Cancel</Button></Actions>
        </form>}
        {/* Named by its question, which takes focus as it opens (HE-03), so the question is read first. */}
        {removing === contact.contactId && <div role="group" aria-labelledby={`contact-remove-question-${contact.contactId}`}
          className="flex flex-col gap-3 rounded-lg bg-danger-soft/50 p-3">
          <p id={`contact-remove-question-${contact.contactId}`} tabIndex={-1} className="m-0 text-sm text-ink outline-none">Remove {contact.name}? They won’t get alerts any more.</p>
          {problemAt(`remove:${contact.contactId}`)}
          <Actions><Button id={`contact-confirm-remove-${contact.contactId}`} size="sm" variant="destructive" disabled={busy}
            loading={running === `remove:${contact.contactId}`} onClick={() => remove(contact.contactId)}>{running === `remove:${contact.contactId}` ? 'Removing…' : 'Yes, remove'}</Button>
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
            onChange={event => { setDraft({ ...draft, channel: event.target.value as EmergencyContactChannel, destination: '' }); if (destinationInvalid) setError(null) }}>
            {channels.map(value => <option key={value} value={value}>{CHANNEL_LABELS[value]}</option>)}</Select></Field>}
          <Field label={channel === 'sms' ? 'Phone number' : 'Email address'} htmlFor="contact-destination"
            hintId={channel === 'sms' ? 'contact-destination-hint' : undefined} hint={channel === 'sms' ? 'Like 0803 123 4567 or +234 803 123 4567.' : undefined}>
            <Input id="contact-destination" required minLength={5} maxLength={254} autoComplete="off"
              type={channel === 'sms' ? 'tel' : 'email'} inputMode={channel === 'sms' ? 'tel' : 'email'} value={draft.destination}
              onChange={event => { setDraft({ ...draft, destination: event.target.value }); if (destinationInvalid) setError(null) }}
              aria-invalid={destinationInvalid || undefined}
              aria-describedby={describedBy(destinationInvalid && 'contact-destination-error', channel === 'sms' && 'contact-destination-hint')} />
            {/* After Enter in this box focus stays here and a new description alone is not read, so it is then an alert. The example stays below. */}
            {destinationInvalid && <p id="contact-destination-error" role={error?.alert ? 'alert' : undefined} className="m-0 text-xs font-medium text-danger-ink">{error?.message}</p>}</Field>
          {notifyBox(draft.notifyOnEmergencyAccess, next => setDraft({ ...draft, notifyOnEmergencyAccess: next }))}
          {problemAt('add')}
          <Actions><Button type="submit" variant="primary" loading={running === 'add'}
            disabled={busy || draft.name.trim().length < 2 || draft.destination.trim().length < 5}>{running === 'add' ? 'Saving…' : 'Save contact'}</Button>
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
  // What runs (Continue, Delete my account, or a cancel): only its button shows busy.
  const [working, setWorking] = useState<'request' | 'confirm' | 'cancel' | null>(null)
  const busy = working !== null
  const [error, setError] = useState<string | null>(null)
  const [signInAgain, setSignInAgain] = useState(false)
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
  // On the profile it is out of the way, under "More": a deletion that is scheduled, or a status that could not be read,
  // is not left folded away there, so the patient sees it.
  const mustShow = Boolean(status.error) || (status.data?.request?.state === 'pending' && Boolean(status.data.request.scheduledFor))
  useLayoutEffect(() => {
    const more = heading.current?.closest('details')
    if (mustShow && more && !more.open) more.open = true
  }, [mustShow])

  const request = async () => {
    if (busy || !acknowledged) return
    setWorking('request'); setError(null); setSignInAgain(false); setNotice(null)
    // On success the confirmation opens with focus in its phrase field.
    try { setPending(await api.requestAccountDeletion()); setPhrase('') }
    catch (cause) {
      setError(deletionProblem(cause, 'Couldn’t start deleting your account. Try again.')); setSignInAgain(needsRecentSignIn(cause))
      focusAfter(() => proceedButton.current)
    } finally { setWorking(null) }
  }

  const confirm = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !pending || phrase.trim().toUpperCase() !== CONFIRMATION_PHRASE) return
    setWorking('confirm'); setError(null); setSignInAgain(false); setNotice(null)
    try {
      const result = await api.confirmAccountDeletion(pending.requestId, pending.confirmationToken, phrase)
      setPending(null); setPhrase(''); setAcknowledged(false)
      if (result.state === 'completed') { setCompleted(true); focusAfter(() => completedHeading.current) }
      else { await status.reload(); focusAfter(() => heading.current) }
    } catch (cause) {
      setPending(null); setPhrase(''); setSignInAgain(needsRecentSignIn(cause))
      if (confirmationRefused(cause)) { setError(notDeleted(cause)); await status.reload() }
      else {
        // The answer was lost: the status read again says whether a deletion is scheduled, and the message follows it.
        let after: AccountDeletionStatus | null | undefined
        try { after = await load(); if (after) status.replace(after) } catch { after = undefined }
        if (after?.request?.state === 'completed') { setCompleted(true); focusAfter(() => completedHeading.current); return }
        setError(afterLostConfirmation(cause, after))
        // Not read: the card's own read says so, with Try again.
        if (after === undefined) await status.reload()
      }
      focusAfter(() => heading.current)
    } finally { setWorking(null) }
  }

  const cancel = async (requestId: string, control: HTMLElement) => {
    if (busy) return
    setWorking('cancel'); setError(null); setSignInAgain(false); setNotice(null)
    try {
      await api.cancelAccountDeletion(requestId); setPending(null); setNotice('Deletion cancelled. Your account stays open.')
      await status.reload()
      focusAfter(() => heading.current)
    } catch (cause) { setError(problem(cause, 'Couldn’t cancel. Try again.')); setSignInAgain(needsRecentSignIn(cause)); focusAfter(() => control) }
    finally { setWorking(null) }
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
    {error && signInAgain && <SignInAgain at="account-deletion" />}
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
          {/* The rule, as the Access PIN states it: how to sign in again is said, with a button, only if it is refused. */}
          <Hint>You must have signed in within the last 10 minutes to delete your account.</Hint>
          <ButtonR ref={proceedButton} variant="destructive" className="self-start" loading={working === 'request'} disabled={busy || status.loading || !acknowledged}
            onClick={() => void request()}>{working === 'request' ? 'Starting…' : 'Continue to delete account'}</ButtonR>
        </> : <form className="flex flex-col gap-4" onSubmit={event => void confirm(event)}>
          <Field label={`Type ${CONFIRMATION_PHRASE} to confirm`} htmlFor="account-deletion-phrase" hintId="account-deletion-phrase-hint" hint={`Finish before ${watDateTime(pending.confirmationExpiresAt)}.`}>
            <Input id="account-deletion-phrase" autoFocus required autoComplete="off" spellCheck={false} value={phrase}
              onChange={event => setPhrase(event.target.value)} aria-describedby="account-deletion-phrase-hint" /></Field>
          <Actions>
            <Button type="submit" variant="destructive" loading={working === 'confirm'} disabled={busy || phrase.trim().toUpperCase() !== CONFIRMATION_PHRASE}>
              {working === 'confirm' ? 'Deleting…' : 'Delete my account'}</Button>
            <Button disabled={busy} onClick={event => void cancel(pending.requestId, event.currentTarget as HTMLElement)}>Keep my account</Button>
          </Actions>
        </form>}
      </>}</div>}
  </ProfileSection>
}
