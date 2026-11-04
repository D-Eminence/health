import { useSyncExternalStore } from 'react'
import { isHidApiError, plainErrorText, retryAfterSeconds } from '@hid/http'
import { parseImportedHealthProfile, parseImportedRecords, type ImportedHealthProfile, type ImportedMedicalRecord } from './importedRecords'
import { parsePatientEntries, type PatientEntry, type PatientRecords } from './api'
import { HEALTH_FIELDS, type HealthFields } from './profileParity'

/**
 * Step 8 (hid-system 0118; BACKEND-NEEDS.md §2): the patient sends their Health ID card by email to any address, and
 * whoever has the link opens it, read only, with a 6-digit code emailed to that same address. Built but switched off until
 * legal signs off (D13): the build's switch (cardSharesFlag.ts) and the backend's answer (404 NOT_FOUND while off) must
 * both say on. The owner's answers of 4 Nov 2026 (all the recommended options) and the critique's fixes are built here:
 * 24 hours or 7 days (no 30 days in v1); a new link to the same address ends the old one; email only, never a link to
 * copy; card only, or card and records (including anything added while it is open); the label is the patient's alone.
 */

export type CardShareScope = 'card' | 'card_and_records'
export type CardShareDuration = '24h' | '7d' | '30d'
export type CardShareStatus = 'active' | 'locked' | 'ended' | 'expired'
export type CardShareDelivery = 'sent' | 'not_sent' | 'pending' | 'failed'
export type CardShareEndedReason = 'patient_ended' | 'replaced' | 'expired' | 'account_deleted' | 'patient_inactive' | 'address_blocked'
  | 'too_many_wrong_codes'

/** One card link as the patient's list shows it. The address and label are null once it has ended (erased). */
export interface CardShare {
  id: string
  reference: string
  recipientEmail: string | null
  label: string | null
  recipientHint: string
  scope: CardShareScope
  duration: CardShareDuration
  createdAt: string
  expiresAt: string
  status: CardShareStatus
  endedAt: string | null
  endedReason: CardShareEndedReason | null
  lockedUntil: string | null
  delivery: CardShareDelivery
  openCount: number
  lastOpenedAt: string | null
}

export interface CardShareList {
  items: CardShare[]
  createdToday: number
  dailyLimit: number
  liveCount: number
  liveLimit: number
}

export interface CardShareInput {
  email: string
  label?: string
  scope: CardShareScope
  duration: '24h' | '7d'
}

export interface CardShareCreated {
  share: CardShare
  delivery: CardShareDelivery
  replacedId: string | null
  /** True when the server answered a send it had already made under the same Idempotency-Key: nothing new was sent. */
  replayed: boolean
}

/**
 * The version of the check step's wording that the backend records with each link as the patient's consent (critique
 * fix 19; hid-system 0118 card-links.service.ts CARD_SHARE_CONSENT_VERSION). The backend keeps it itself: it is not sent,
 * and the backend refuses any field it does not know (review F1). A new wording of the check step needs a new version
 * on both sides.
 */
export const CARD_SHARE_CONSENT_VERSION = 'card-share-v1'

/** The choices offered: 24 hours first. 30 days is not offered in v1 (it would need a reminder at day 7). */
export const CARD_SHARE_DURATIONS: ReadonlyArray<{ value: '24h' | '7d'; label: string }> = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
]
export const cardShareDurationLabel = (value: CardShareDuration) => value === '24h' ? '24 hours' : value === '7d' ? '7 days' : '30 days'

export const CARD_SHARE_SCOPES: ReadonlyArray<{ value: CardShareScope; label: string; description: string }> = [
  // No photo: the backend's card view carries none (review F5).
  { value: 'card', label: 'Card only', description: 'Your card: name, Health ID, blood group, genotype and allergies.' },
  { value: 'card_and_records', label: 'Card and records',
    description: 'Your card and your records: visits, signed notes, older records, the health information you entered and the records you added. It includes anything added while the link is open.' },
]
export const cardShareScopeLabel = (value: CardShareScope) => value === 'card' ? 'Card only' : 'Card and records'

const text = (value: unknown, limit = 320): string | null =>
  typeof value === 'string' && value.trim() !== '' && value.length <= limit ? value.trim() : null
const time = (value: unknown): string | null => {
  const found = text(value, 64)
  return found && !Number.isNaN(Date.parse(found)) ? found : null
}
const oneOf = <T extends string>(values: readonly T[], value: unknown): T | null =>
  typeof value === 'string' && (values as readonly string[]).includes(value) ? value as T : null
const count = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0

const STATUSES = ['active', 'locked', 'ended', 'expired'] as const
const DELIVERIES = ['sent', 'not_sent', 'pending', 'failed'] as const
const REASONS = ['patient_ended', 'replaced', 'expired', 'account_deleted', 'patient_inactive', 'address_blocked', 'too_many_wrong_codes'] as const

/** One link, or null when it is missing what the list needs: a row is never shown half. */
export function parseCardShare(value: unknown): CardShare | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const id = text(row.id, 100), reference = text(row.reference, 20), hint = text(row.recipientHint, 320)
  const createdAt = time(row.createdAt), expiresAt = time(row.expiresAt)
  const scope = oneOf(['card', 'card_and_records'] as const, row.scope), duration = oneOf(['24h', '7d', '30d'] as const, row.duration)
  const status = oneOf(STATUSES, row.status)
  if (!id || !reference || !hint || !createdAt || !expiresAt || !scope || !duration || !status) return null
  return {
    id, reference, recipientHint: hint, scope, duration, createdAt, expiresAt, status,
    recipientEmail: text(row.recipientEmail, 254), label: text(row.label, 80),
    endedAt: time(row.endedAt), endedReason: oneOf(REASONS, row.endedReason), lockedUntil: time(row.lockedUntil),
    delivery: oneOf(DELIVERIES, row.delivery) ?? 'pending', openCount: count(row.openCount), lastOpenedAt: time(row.lastOpenedAt),
  }
}

export function parseCardShareList(value: unknown): CardShareList {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { items?: unknown }).items)) {
    throw new Error('Your shared links could not be read.')
  }
  const list = value as Record<string, unknown> & { items: unknown[] }
  return {
    items: list.items.flatMap(item => { const read = parseCardShare(item); return read ? [read] : [] }),
    createdToday: count(list.createdToday), dailyLimit: count(list.dailyLimit) || 5,
    liveCount: count(list.liveCount), liveLimit: count(list.liveLimit) || 20,
  }
}

export function parseCardShareCreated(value: unknown): CardShareCreated {
  const answer = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const share = parseCardShare(answer.share)
  if (!share) throw new Error('The card link could not be read.')
  return { share, delivery: oneOf(DELIVERIES, answer.delivery) ?? share.delivery, replacedId: text(answer.replacedId, 100),
    replayed: answer.replayed === true }
}

/** The words for a refused send or end, by code: ours, never the server's. */
const PATIENT_REFUSALS: Readonly<Record<string, string>> = {
  CARD_SHARE_EMAIL_INVALID: 'Enter an email address like name@example.com.',
  CARD_SHARE_OWN_EMAIL: 'That’s your own email address. To see your card, open it in Health ID.',
  CARD_SHARE_DURATION_INVALID: 'Choose how long they can open it.',
  CARD_SHARE_SCOPE_INVALID: 'Choose what they’ll see.',
  CARD_SHARE_LABEL_INVALID: 'Use letters, spaces, apostrophes, dots or hyphens for who this is.',
  PATIENT_RECENT_AUTH_REQUIRED: 'For your security, sign out, sign in again, and send it within 10 minutes.',
  PATIENT_RECENT_RECOVERY_HOLD: 'Sharing is not available in the 24 hours after you recover your account. Please try again later.',
  IDEMPOTENCY_KEY_REUSED: 'Something changed while sending. Check your shared links before trying again.',
  CARD_SHARE_LIVE_LIMIT: 'You have 20 card links open. End one to send another.',
  CARD_SHARE_CREATE_LIMITED: 'You’ve sent 5 card links today. Try again tomorrow.',
  CARD_SHARE_ADDRESS_LIMITED: 'You’ve sent your card to this address twice today. Try again tomorrow.',
  CARD_SHARE_NOT_FOUND: 'We couldn’t find that link. It may have ended already.',
}

export function cardShareProblem(cause: unknown, fallback: string): string {
  return plainErrorText(cause, fallback, { codes: PATIENT_REFUSALS })
}

/** Common providers whose names are easy to mistype, and the mistakes seen most. */
const DOMAIN_TYPOS: Readonly<Record<string, string>> = {
  'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com',
  'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmaill.com': 'gmail.com', 'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com',
  'yahoo.co': 'yahoo.com', 'yhoo.com': 'yahoo.com', 'hotmal.com': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'hotmail.co': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outlook.co': 'outlook.com', 'iclod.com': 'icloud.com', 'icloud.co': 'icloud.com',
}

/** The address the patient probably meant, when its domain is a common typo; null otherwise (critique fix 24). */
export function emailTypoSuggestion(address: string): string | null {
  const [local, domain, ...rest] = address.trim().split('@')
  if (!local || !domain || rest.length) return null
  const meant = DOMAIN_TYPOS[domain.toLowerCase()]
  return meant ? `${local}@${meant}` : null
}

// ------------------------------------------------------------------ served --

/**
 * Whether the backend serves card links, as this page has learned it: GET identity/me/card-shares answering 200 says
 * served; its 404 (NOT_FOUND, as if unrouted, while the backend's switch is off) says not, only while nothing has said
 * otherwise. Asked only while the build's switch is on. Held in memory for the page's life, as shareServed.ts holds its
 * own. `null` until an answer has said either (treated as not served).
 */
type Served = boolean | null
let served: Served = null
const listeners = new Set<() => void>()
function changed() { for (const listener of listeners) listener() }

export function learnCardSharesServed(value: boolean): void {
  if (served === true || served === value) return
  served = value
  changed()
}
export function cardSharesServed(): Served { return served }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useCardSharesServed(): Served { return useSyncExternalStore(subscribe, cardSharesServed, cardSharesServed) }
/** For tests: forget what was learned, as a new page would. */
export function forgetCardSharesServed(): void { served = null; changed() }

/** Whether a refusal says the routes are not served: a 404 whose code is NOT_FOUND (or none). */
export const saysCardSharesNotServed = (error: unknown) => isHidApiError(error) && error.status === 404 && error.code === 'NOT_FOUND'

// ---------------------------------------------------------------- receiver --

/** The link's secret: 32 random bytes, base64url, 43 characters. Anything else is a link that isn't complete. */
export const isCardToken = (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value)

/**
 * The "Stop these emails" token in E5 and E6 (/card/stop#<stopToken>): the link's id, a dot, and 43 base64url characters
 * (hid-system 0118 card-links.service.ts STOP_TOKEN). It is not the card's token and cannot open the card (review F2).
 */
export const isStopToken = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/.test(value)

/**
 * What verify (and every later view read) answers: who the card is, what the link allows and until when. No photo: the
 * backend shares none (review F5).
 */
export interface CardView {
  viewId: string
  card: { fullName: string; healthId: string; ninVerified: boolean | null }
  scope: CardShareScope
  sharedBy: string
  recipientHint: string
  reference: string
  expiresAt: string
  viewExpiresAt: string
}

export function parseCardView(value: unknown): CardView {
  const answer = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const card = (typeof answer.card === 'object' && answer.card !== null ? answer.card : {}) as Record<string, unknown>
  const viewId = text(answer.viewId, 100), fullName = text(card.fullName, 200), healthId = text(card.healthId, 40)
  const scope = oneOf(['card', 'card_and_records'] as const, answer.scope)
  const expiresAt = time(answer.expiresAt), viewExpiresAt = time(answer.viewExpiresAt)
  if (!viewId || !fullName || !healthId || !scope || !expiresAt || !viewExpiresAt) throw new Error('The card could not be read.')
  return {
    viewId, scope, expiresAt, viewExpiresAt,
    card: { fullName, healthId, ninVerified: typeof card.ninVerified === 'boolean' ? card.ninVerified : null },
    // The backend's name is sharedByFirstName (null when it has none); then the first word of the card's name.
    sharedBy: text(answer.sharedByFirstName, 100) ?? fullName.split(' ')[0] ?? fullName,
    recipientHint: text(answer.recipientHint, 320) ?? 'the address it was sent to',
    reference: text(answer.reference, 20) ?? '',
  }
}

/** The records a card-and-records link shows. Every list read as empty when it is missing or not a list. */
export interface CardRecords {
  encounters: PatientRecords['encounters']
  notes: PatientRecords['notes']
  importedRecords: ImportedMedicalRecord[]
  importedHealthProfile: ImportedHealthProfile | null
  healthProfile: HealthFields | null
  /** The health fields the answer left out (not sent at all, as opposed to sent empty): shown as "Not available". */
  healthProfileAbsent: ReadonlyArray<keyof HealthFields>
  patientEntries: PatientEntry[]
  patientEntriesMore: boolean
  limit: number
}

/**
 * ehr-api's names for the health fields in a card link's records answer (hid-system 0118 card-share-records.service.ts):
 * `medications` and `notes` where the patient's own profile says `currentMedications` and `medicalNotes` (review F3).
 * Either name is read, the answer's own first.
 */
const CARD_HEALTH_NAMES: Readonly<Record<keyof HealthFields, readonly string[]>> = {
  bloodGroup: ['bloodGroup'], genotype: ['genotype'], allergies: ['allergies'], chronicConditions: ['chronicConditions'],
  currentMedications: ['medications', 'currentMedications'], medicalNotes: ['notes', 'medicalNotes'],
}

function readHealthProfile(value: unknown): { fields: HealthFields | null; absent: Array<keyof HealthFields> } {
  if (typeof value !== 'object' || value === null) return { fields: null, absent: [] }
  const row = value as Record<string, unknown>
  const sent = (field: keyof HealthFields) => CARD_HEALTH_NAMES[field].find(name => Object.prototype.hasOwnProperty.call(row, name))
  const fields = Object.fromEntries(HEALTH_FIELDS.map(field => {
    const name = sent(field)
    return [field, name ? text(row[name], 2000) : null]
  })) as unknown as HealthFields
  const absent = HEALTH_FIELDS.filter(field => !sent(field))
  return HEALTH_FIELDS.every(field => fields[field] === null) ? { fields: null, absent: [] } : { fields, absent }
}

const listed = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : []

export function parseCardRecords(value: unknown): CardRecords {
  const answer = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  let imported: ImportedMedicalRecord[] = []
  try { imported = Array.isArray(answer.importedRecords) ? parseImportedRecords(answer.importedRecords) : [] } catch { imported = [] }
  let importedHealth: ImportedHealthProfile | null = null
  try { importedHealth = answer.importedHealthProfile ? parseImportedHealthProfile(answer.importedHealthProfile) : null } catch { importedHealth = null }
  const health = readHealthProfile(answer.healthProfile)
  return {
    encounters: listed(answer.encounters), notes: listed(answer.notes), importedRecords: imported, importedHealthProfile: importedHealth,
    healthProfile: health.fields, healthProfileAbsent: health.absent, patientEntries: parsePatientEntries(answer.patientEntries) ?? [],
    patientEntriesMore: answer.patientEntriesMore === true, limit: typeof answer.limit === 'number' ? answer.limit : 50,
  }
}

/**
 * What happened to a view, from a refusal of any of its reads: the link ended (everything is cleared), the view ended
 * (timed out or closed), another card was opened in this browser, or null for anything else (a passing failure).
 */
export type ViewEnding = 'link-ended' | 'view-ended' | 'view-changed'
export function viewEndingOf(error: unknown): ViewEnding | null {
  if (!isHidApiError(error)) return null
  if (error.code === 'CARD_SHARE_ENDED') return 'link-ended'
  if (error.code === 'CARD_SHARE_VIEW_CHANGED') return 'view-changed'
  if (error.code === 'CARD_SHARE_VIEW_ENDED' || error.status === 410) return 'view-ended'
  return null
}

const minutesOf = (seconds: number | null) => seconds && seconds > 0 ? Math.max(1, Math.ceil(seconds / 60)) : null

/** The words for a refused code request or verify, for the person who received the link. Never the server's. */
export function receiverProblem(error: unknown, step: 'code' | 'verify' | 'stop'): string {
  if (isHidApiError(error)) {
    switch (error.code) {
      case 'CARD_SHARE_LINK_INVALID': return 'This link isn’t complete. Open it again from your email.'
      case 'CARD_SHARE_ENDED': return 'This card is no longer shared.'
      case 'CARD_SHARE_CODE_LIMITED': {
        const minutes = minutesOf(retryAfterSeconds(error))
        return minutes ? `Too many codes asked for. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.` : 'Too many codes asked for. Try again later.'
      }
      case 'CARD_SHARE_CODE_EXPIRED': return 'That code has stopped working. Ask for a new one.'
      case 'CARD_SHARE_CODE_WRONG': {
        const left = error.attemptsLeft
        // A right code entered in a browser other than the one that asked for it counts as wrong (the backend's rule).
        return `That code isn’t right. Check the newest email, and enter the code in the browser where you asked for it.${left !== null ? ` ${left} ${left === 1 ? 'try' : 'tries'} left.` : ''}`
      }
      case 'CARD_SHARE_LOCKED': {
        // The wait comes from Retry-After, or the problem's retryAfterSeconds (the backend sends only that).
        const minutes = minutesOf(retryAfterSeconds(error))
        return minutes ? `Too many wrong codes. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.` : 'Too many wrong codes. Try again in an hour.'
      }
      default: break
    }
    if (error.code.startsWith('TURNSTILE_')) return 'We couldn’t check this browser. Try again.'
    if (error.status === 429) return 'Too many tries from this connection. Wait a minute and try again.'
  }
  return plainErrorText(error, step === 'stop' ? 'We couldn’t stop the emails. Try again.' : 'Something went wrong. Try again.',
    { statuses: { 400: 'Something went wrong. Try again.', 404: 'Something went wrong. Try again.', 410: 'This card is no longer shared.' } })
}
