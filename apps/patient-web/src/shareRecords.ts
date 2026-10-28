import type { HidShareDurationPreset, HidSharePermissionTier } from '@hid/contracts'

/**
 * Share my records (hid-1.0 parity B4, hid-system 0095 on Novu; contract b45-contract.md §2): the patient shares their
 * record with one clinician at one facility, at a level and for a duration, or invites one by email who is not on Health
 * ID yet. Every answer is read field by field: a row that is not what the contract says is left out, never shown as
 * something else. Held in memory only.
 */
export type ShareLevel = HidSharePermissionTier
export type ShareDuration = HidShareDurationPreset
export type ShareProviderRole = 'doctor' | 'clinician' | 'nurse'

export const SHARE_LEVELS: ReadonlyArray<{ value: ShareLevel; label: string; description: string }> = [
  // hid-1.0's labels and descriptions (src/lib/shareUtils.ts); Clinical Collaboration also says what write access allows here.
  { value: 'view_only', label: 'View Only', description: 'Can view your profile and records, but cannot make changes.' },
  { value: 'clinical_review', label: 'Clinical Review', description: 'Can view your profile and records for clinical review.' },
  { value: 'clinical_collaboration', label: 'Clinical Collaboration', description: 'Can view and add to your records.' },
]

/** D1: a write grant also lets the clinician send orders to another facility (P4c), so the page says so under it. */
export const COLLABORATION_WARNING = 'Can also add to your records and send your test requests or prescriptions to another facility.'

export const SHARE_DURATIONS: ReadonlyArray<{ value: ShareDuration; label: string }> = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  // D2: a grant must end, so "until revoked" lasts at most a year; the page never shows it as forever.
  { value: 'until_revoked', label: 'Until you end it (up to 1 year)' },
]

export const SHARE_ROLE_LABELS: Readonly<Record<ShareProviderRole, string>> = { doctor: 'Doctor', clinician: 'Clinician', nurse: 'Nurse' }

export const shareLevelLabel = (level: unknown): string | null => SHARE_LEVELS.find(item => item.value === level)?.label ?? null
export const shareDurationLabel = (duration: unknown): string | null => SHARE_DURATIONS.find(item => item.value === duration)?.label ?? null

export interface ShareProvider {
  membershipId: string
  clinicianName: string
  role: ShareProviderRole
  facilityName: string
  organizationName: string
  newOnHealthId: boolean
}

export interface ShareCreated {
  consentGrantId: string
  membershipId?: string
  scope: 'read_records' | 'write_records' | string
  level: ShareLevel
  duration: ShareDuration
  startsAt: string
  expiresAt: string
  clinicianName: string | null
  facilityName: string
  replacedConsentGrantId: string | null
  replayed: boolean
}

export type ShareInvitationStatus = 'pending' | 'accepted' | 'confirmed' | 'cancelled' | 'expired'

export interface ShareInvitationOffer {
  clinicianName: string | null
  role: ShareProviderRole
  facilityName: string
  organizationName: string
  newOnHealthId: boolean
}

export interface ShareInvitation {
  invitationId: string
  reference: string
  inviteeEmail: string
  inviteeName: string | null
  level: ShareLevel
  duration: ShareDuration
  status: ShareInvitationStatus
  createdAt: string
  expiresAt: string
  acceptedAt: string | null
  deliveryOutcome: 'pending' | 'sent' | 'not_confirmed'
  offer: ShareInvitationOffer | null
  consentGrantId: string | null
}

export interface ShareInvitationList {
  items: ShareInvitation[]
  limits: { maxOpen: number; maxNewPerDay: number; remainingToday: number } | null
}

export interface ShareInvitationCreated {
  invitationId: string
  reference: string
  status: 'pending'
  expiresAt: string
  deliveryOutcome: 'sent' | 'not_confirmed'
  replayed: boolean
}

export type ShareInvitationConfirmed = ShareCreated & { invitationId: string; status: 'confirmed' }

/** What the portal sends to share: no free text (contract P2). */
export interface ShareInput { membershipId: string; level: ShareLevel; duration: ShareDuration }
/** What the portal sends to invite (contract P5): the name only when given. */
export interface ShareInvitationInput { email: string; name?: string; level: ShareLevel; duration: ShareDuration }

type Row = Record<string, unknown>
const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown, limit = 320): string | null =>
  typeof value === 'string' && value.trim() !== '' && value.length <= limit ? value.trim() : null
const strOrNull = (value: unknown, limit = 320): string | null => str(value, limit)
const isLevel = (value: unknown): value is ShareLevel => SHARE_LEVELS.some(item => item.value === value)
const isDuration = (value: unknown): value is ShareDuration => SHARE_DURATIONS.some(item => item.value === value)
const isRole = (value: unknown): value is ShareProviderRole => value === 'doctor' || value === 'clinician' || value === 'nurse'
const STATUSES: readonly ShareInvitationStatus[] = ['pending', 'accepted', 'confirmed', 'cancelled', 'expired']
const isStatus = (value: unknown): value is ShareInvitationStatus => STATUSES.includes(value as ShareInvitationStatus)

/** The most results a search shows (contract P1, D4). */
export const SHARE_SEARCH_MAX_RESULTS = 10

/** A search's answer: well-formed rows only, at most ten. */
export function parseShareProviders(value: unknown): ShareProvider[] {
  const items = isRow(value) && Array.isArray(value.items) ? value.items : null
  if (!items) throw new Error('The search results could not be read.')
  return items.flatMap((entry): ShareProvider[] => {
    if (!isRow(entry)) return []
    const membershipId = str(entry.membershipId, 64), clinicianName = str(entry.clinicianName, 200)
    const facilityName = str(entry.facilityName, 200), organizationName = str(entry.organizationName, 200) ?? ''
    if (!membershipId || !clinicianName || !facilityName || !isRole(entry.role)) return []
    return [{ membershipId, clinicianName, role: entry.role, facilityName, organizationName, newOnHealthId: entry.newOnHealthId === true }]
  }).slice(0, SHARE_SEARCH_MAX_RESULTS)
}

function parseOffer(value: unknown): ShareInvitationOffer | null {
  if (!isRow(value)) return null
  const facilityName = str(value.facilityName, 200)
  if (!facilityName || !isRole(value.role)) return null
  return { clinicianName: strOrNull(value.clinicianName, 200), role: value.role, facilityName,
    organizationName: str(value.organizationName, 200) ?? '', newOnHealthId: value.newOnHealthId === true }
}

/** The invitations list (contract P4), the portal's probe for sharing: a 200 that is not this shape is refused. */
export function parseShareInvitations(value: unknown): ShareInvitationList {
  if (!isRow(value) || !Array.isArray(value.items)) throw new Error('Your invitations could not be read.')
  const items = value.items.flatMap((entry): ShareInvitation[] => {
    if (!isRow(entry)) return []
    const invitationId = str(entry.invitationId, 64), inviteeEmail = str(entry.inviteeEmail, 320)
    const createdAt = str(entry.createdAt, 64), expiresAt = str(entry.expiresAt, 64)
    if (!invitationId || !inviteeEmail || !createdAt || !expiresAt || !isLevel(entry.level) || !isDuration(entry.duration)
      || !isStatus(entry.status)) return []
    const delivery = entry.deliveryOutcome === 'sent' || entry.deliveryOutcome === 'pending' ? entry.deliveryOutcome : 'not_confirmed'
    return [{ invitationId, reference: str(entry.reference, 16) ?? '', inviteeEmail, inviteeName: strOrNull(entry.inviteeName, 120),
      level: entry.level, duration: entry.duration, status: entry.status, createdAt, expiresAt,
      acceptedAt: strOrNull(entry.acceptedAt, 64), deliveryOutcome: delivery,
      offer: entry.status === 'accepted' ? parseOffer(entry.offer) : null, consentGrantId: strOrNull(entry.consentGrantId, 64) }]
  })
  const limits = isRow(value.limits) && typeof value.limits.remainingToday === 'number' ? {
    maxOpen: Number(value.limits.maxOpen) || 20, maxNewPerDay: Number(value.limits.maxNewPerDay) || 5,
    remainingToday: Math.max(0, Math.floor(value.limits.remainingToday)) } : null
  return { items, limits }
}

/**
 * What the invite form takes for an email (contract P5): 3 to 254 characters, one @ with something on each side, no spaces
 * or control characters. The server trims and lowercases it, and decides.
 */
export function inviteEmailProblem(value: string): string | null {
  const email = value.trim()
  // eslint-disable-next-line no-control-regex
  if (email.length < 3 || email.length > 254 || /[\s\u0000-\u001f\u007f]/.test(email)) return 'Enter a valid email address.'
  const parts = email.split('@')
  if (parts.length !== 2 || !parts[0] || !parts[1] || !parts[1].includes('.')) return 'Enter a valid email address.'
  return null
}

/** The invitee's name as Identity takes it (PERSON_NAME): letters, spaces, apostrophes, dots and hyphens, 1 to 120. */
export const PERSON_NAME = /^[\p{L}\p{M}][\p{L}\p{M}' .-]{0,119}$/u

/** The day a share or invitation ends, in WAT. */
export function shareDay(value: string | null | undefined): string {
  if (!value) return 'Not available'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value
    : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'Africa/Lagos' }).format(parsed)
}

/** "until 4 Nov 2026", or, for "until revoked", "until you end it, up to 1 year". */
export function shareUntil(duration: ShareDuration | null | undefined, expiresAt: string | null | undefined): string {
  return duration === 'until_revoked' ? 'until you end it, up to 1 year' : `until ${shareDay(expiresAt)}`
}

/**
 * The clinician's side of sharing (contract S1 to S3, the provider portal's Patients page). "Shared with you" names the
 * patient, because the patient chose this clinician; an invitation never does before the patient confirms it.
 */
export interface SharedPatient {
  consentGrantId: string
  patientId: string
  hid: string
  fullName: string
  level: ShareLevel
  duration: ShareDuration
  scope: string
  startsAt: string
  expiresAt: string
}

export interface StaffShareInvitation {
  invitationId: string
  reference: string
  inviteeName: string | null
  level: ShareLevel
  duration: ShareDuration
  createdAt: string
  expiresAt: string
}

export interface StaffShareInvitationList { eligible: boolean; items: StaffShareInvitation[] }

export interface ShareInvitationAccepted { invitationId: string; status: 'accepted'; acceptedAt: string; replayed: boolean }

/** S1: the active shares to the caller's membership, well-formed rows only. A 200 that is not this shape is refused. */
export function parseSharedWithMe(value: unknown): SharedPatient[] {
  if (!isRow(value) || !Array.isArray(value.items)) throw new Error('The patients shared with you could not be read.')
  return value.items.flatMap((entry): SharedPatient[] => {
    if (!isRow(entry)) return []
    const consentGrantId = str(entry.consentGrantId, 64), patientId = str(entry.patientId, 64), hid = str(entry.hid, 40)
    const fullName = str(entry.fullName, 200), startsAt = str(entry.startsAt, 64), expiresAt = str(entry.expiresAt, 64)
    if (!consentGrantId || !patientId || !hid || !fullName || !startsAt || !expiresAt || !isLevel(entry.level)
      || !isDuration(entry.duration)) return []
    return [{ consentGrantId, patientId, hid, fullName, level: entry.level, duration: entry.duration,
      scope: str(entry.scope, 64) ?? '', startsAt, expiresAt }]
  }).slice(0, 100)
}

/** S2: the invitations to the caller's verified email; none unless the membership may receive shares. */
export function parseStaffShareInvitations(value: unknown): StaffShareInvitationList {
  if (!isRow(value) || !Array.isArray(value.items)) throw new Error('Your invitations could not be read.')
  const eligible = value.eligible === true
  const items = eligible ? value.items.flatMap((entry): StaffShareInvitation[] => {
    if (!isRow(entry)) return []
    const invitationId = str(entry.invitationId, 64), createdAt = str(entry.createdAt, 64), expiresAt = str(entry.expiresAt, 64)
    if (!invitationId || !createdAt || !expiresAt || !isLevel(entry.level) || !isDuration(entry.duration)) return []
    return [{ invitationId, reference: str(entry.reference, 16) ?? '', inviteeName: strOrNull(entry.inviteeName, 120),
      level: entry.level, duration: entry.duration, createdAt, expiresAt }]
  }).slice(0, 50) : []
  return { eligible, items }
}

/** S3's answer. */
export function parseShareInvitationAccepted(value: unknown): ShareInvitationAccepted {
  const invitationId = isRow(value) ? str(value.invitationId, 64) : null
  if (!isRow(value) || !invitationId || value.status !== 'accepted') throw new Error('The answer to Accept could not be read.')
  return { invitationId, status: 'accepted', acceptedAt: str(value.acceptedAt, 64) ?? '', replayed: value.replayed === true }
}
