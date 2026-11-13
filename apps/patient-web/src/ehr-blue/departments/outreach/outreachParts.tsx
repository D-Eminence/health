import type { ReactNode } from 'react'
import { isHidApiError } from '@hid/http'
import type { OutreachCampaign, OutreachCampaignMember, OutreachCampaignRole, OutreachCase } from '../../../staff/api'
import type { Tone } from '../../../kasuwa/ui'
import type { DeptFact } from '../parts/DeptRecord'
import { errorText } from '../parts/errors'
import { dateText } from '../parts/format'

/*
 * Words and small parts the Outreach views share, in the design's voice (the target's
 * workflows.tsx, ui.tsx and feedback.tsx). Live decides the data and the rules; these only
 * say them.
 */

/** The line when a record offers nothing to do. */
export const NO_ACTIONS = 'Nothing else to do here.'
/** The design's line under a form whose save was refused. */
export const RETRY_NOTE = 'Correct the issue or retry using the same button. No success is reported until saved.'
/** The design's word for a required field left empty. */
export const COMPLETE_FIELD = 'Complete this field.'
/** At least this many characters, as Outreach takes notes for the team (CreateRegistrationCaseDto). */
export const AT_LEAST_THREE = 'Enter at least 3 characters, or leave this blank.'
export const AGE_RANGE = 'Enter an age in whole years, from 0 to 130.'
/** The phone field's hint, and its refusal in the same words: what Outreach takes (normalizeOutreachPhone below). */
export const PHONE_HINT = 'A mobile number: 11 digits starting with 0, or starting with +234.'
export const PHONE_FORMAT = 'Enter a mobile number with 11 digits starting with 0, or starting with +234.'

/** A phone number as Outreach keeps it (create-registration-case.dto.ts E164_PHONE): + and 7 to 15 digits. */
const E164_PHONE = /^\+[1-9]\d{6,14}$/

/**
 * A phone number as Outreach reads it before checking it (hid-system services/outreach-api create-registration-case.dto.ts
 * normalizeOutreachPhone, ported exactly): a Nigerian local number (0 and 10 digits) is read as +234, a trunk 0 typed
 * after +234 is dropped, and spaces, dots, dashes and brackets are ignored. Anything else is left as typed, so the E.164
 * check refuses it. Nothing typed but those is no phone number at all.
 */
export function normalizeOutreachPhone(raw: string): string | undefined {
  const compact = raw.trim().replace(/[\s().-]/g, '')
  if (compact === '') return undefined
  if (/^0\d{10}$/.test(compact)) return `+234${compact.slice(1)}`
  if (/^234\d{10}$/.test(compact)) return `+${compact}`
  const trunk = /^\+2340(\d{10})$/.exec(compact)
  if (trunk) return `+234${trunk[1]}`
  return E164_PHONE.test(compact) ? compact : raw.trim()
}

/** Whether Outreach takes a phone number as typed (CreateRegistrationCaseDto): none, or one that reads as E.164. */
export function outreachPhoneAccepted(raw: string): boolean {
  const phone = normalizeOutreachPhone(raw)
  return phone === undefined || E164_PHONE.test(phone)
}

/** Outreach takes a resolution reason of 8 characters or more. */
export const REASON_LENGTH = 'Enter at least 8 characters.'

/** No working facility: nothing at a facility can be opened. */
export const NO_FACILITY = 'No facility is selected. Choose the facility you are working at to open Outreach.'
/** Under a refused link: the case was read again, so the next attempt is checked against its latest version. */
export const LINK_RETRY_NOTE = 'The case has been read again, so a retry uses its latest version. Check the details, then retry using the same button. No success is reported until saved.'

export const CASES_NOT_LOADED = 'Registration cases could not be loaded. Refresh to try again.'
export const CAMPAIGNS_NOT_LOADED = 'Campaigns could not be loaded. Refresh to try again.'
/**
 * Why the form can list no campaign when it is not that the person is in none: the campaigns, or a running campaign's
 * members, are still being read, or couldn't be read (with no signal, or otherwise). Never said as "not in a campaign".
 */
export type CampaignsUnread = 'loading' | 'offline' | 'failed'
export const MEMBERS_NOT_LOADED = 'Campaign members could not be loaded. Try again.'
export const CREATE_FAILED = 'The registration case could not be saved. Please retry.'
export const LINK_FAILED = 'The patient could not be linked. Check your access to this patient, then refresh the case.'

export const PENDING = 'identity_resolution_pending'

/*
 * Campaign management (hid-system#222, 0111): a campaign's own admins open, close and staff it. Every refusal Outreach
 * gives it is said in words that tell the person what to do next, never its code.
 */
export const STAFF_NOT_LOADED = 'Who is in this campaign could not be checked. Try again.'
export const CAMPAIGN_CREATE_FAILED = 'The campaign could not be saved. Please retry.'
/** A create whose answer never came: the campaign may be saved, and Outreach would make a second one if it were sent again. */
export const CAMPAIGN_CREATE_UNSURE = 'The campaign list has been read again. Check it for this campaign before you retry: if the answer was lost, it may already be saved.'
export const CAMPAIGN_STATUS_FAILED = 'The campaign could not be changed. Please retry.'
export const MEMBER_ADD_FAILED = 'The person could not be added. Please retry.'
/** Outreach takes a campaign name of 2 to 200 characters (CreateCampaignDto). */
export const NAME_LENGTH = 'Enter at least 2 characters.'
export const CHOOSE_SERVICE = 'Choose at least one service.'
export const END_AFTER_START = 'Choose an end date on or after the start date.'

const CAMPAIGN_REFUSALS: Readonly<Record<string, string>> = {
  OUTREACH_CAMPAIGN_ADMIN_REQUIRED: 'Only this campaign’s admins can do this. Ask one of them.',
  VERSION_CONFLICT: 'This campaign changed since you opened it. It has been read again: check it, then try again.',
  OUTREACH_CAMPAIGN_STATE_CONFLICT: 'This campaign has already changed. It has been read again: check it, then try again.',
  OUTREACH_CAMPAIGN_NOT_STARTED: 'This campaign can’t be opened before its start date.',
  OUTREACH_CAMPAIGN_CLOSED: 'This campaign is finished. A finished campaign can’t be opened again.',
  OUTREACH_STAFF_NOT_AVAILABLE: 'That person isn’t active staff at this facility now. Choose someone else.',
  OUTREACH_CAMPAIGN_MEMBER_EXISTS: 'That person is already in this campaign.',
  OUTREACH_CAMPAIGN_DATES_INVALID: END_AFTER_START,
  // An outreach group (open sign-up on outreach.) that Health ID has paused.
  OUTREACH_ORGANISER_SUSPENDED: 'This outreach group has been paused by Health ID. Contact Health ID support.',
}
/** The refusals after which the campaign is read again, since what the page shows is out of date. */
export const CAMPAIGN_STALE: ReadonlySet<string> = new Set(['VERSION_CONFLICT', 'OUTREACH_CAMPAIGN_STATE_CONFLICT', 'OUTREACH_CAMPAIGN_CLOSED',
  'OUTREACH_CAMPAIGN_NOT_STARTED', 'OUTREACH_CAMPAIGN_ADMIN_REQUIRED'])

/** A campaign write's refusal in plain words. */
export function campaignErrorText(error: unknown, fallback: string): string {
  if (isHidApiError(error) && Object.hasOwn(CAMPAIGN_REFUSALS, error.code)) return CAMPAIGN_REFUSALS[error.code]!
  return errorText(error, fallback)
}

/** The services Outreach takes on a campaign (CreateCampaignDto), in the order the form offers them, with their words. */
export const CAMPAIGN_SERVICES: ReadonlyArray<{ readonly value: string; readonly label: string; readonly hint?: string }> = [
  { value: 'registration', label: 'Registration', hint: 'Members can register people they meet into this campaign.' },
  { value: 'vitals', label: 'Vital signs' },
  { value: 'vaccination', label: 'Vaccination' },
  { value: 'lab_sample', label: 'Lab samples' },
  { value: 'referral', label: 'Referrals' },
]
const SERVICE_WORDS: Readonly<Record<string, string>> = Object.fromEntries(CAMPAIGN_SERVICES.map(service => [service.value, service.label]))

/** A campaign's services in words: "Registration, Lab samples". One with no word here is said as written, never with underscores. */
export function servicesText(services: readonly string[], none = 'No services listed') {
  if (!services.length) return none
  return services.map(service => (Object.hasOwn(SERVICE_WORDS, service) ? SERVICE_WORDS[service] : undefined)
    ?? service.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase())).join(', ')
}

/** A campaign role's words, as the form offers them. */
export const CAMPAIGN_ROLES: ReadonlyArray<{ readonly value: OutreachCampaignRole; readonly label: string }> = [
  { value: 'enumerator', label: 'Enumerator' },
  { value: 'health_worker', label: 'Health worker' },
  { value: 'admin', label: 'Campaign admin' },
]
const ROLE_WORDS: Readonly<Record<string, string>> = Object.fromEntries(CAMPAIGN_ROLES.map(role => [role.value, role.label]))

/** A campaign member's role in words: "Member" for one the page has no word for, never its code (parity report 3.1 #16). */
export function memberRoleLabel(role: string): string {
  return (Object.hasOwn(ROLE_WORDS, role) ? ROLE_WORDS[role] : undefined) ?? 'Member'
}

/**
 * A date picked on a form as the instant Outreach takes: the start of that day, or (`end`) its last second, in Nigerian
 * time (WAT, UTC+1 all year), so a campaign ending on a day runs to the end of it.
 */
export function lagosDayInstant(day: string, end = false): string {
  return new Date(`${day}T${end ? '23:59:59' : '00:00:00'}+01:00`).toISOString()
}

/** Whether a campaign may be opened now: Outreach refuses before its start time (OUTREACH_CAMPAIGN_NOT_STARTED). */
export function campaignStarted(campaign: OutreachCampaign, now = Date.now()) {
  const starts = Date.parse(campaign.startsAt)
  return Number.isNaN(starts) || starts <= now
}

/*
 * Linking by Health ID: the person is looked up first (Identity patient-lookup, which needs access to read their
 * record), confirmed by name and date of birth, then linked (which needs access to write it). Each refusal is said at
 * the Health ID field, in plain words.
 */
export const HEALTH_ID_HINT = 'The Health ID on their card or in their Health ID app. It starts with HID-.'
export const HEALTH_ID_FORMAT = 'Enter the Health ID as it’s written on their card or app. It starts with HID-.'
export const HEALTH_ID_NOT_FOUND = 'No one has this Health ID. Check it with them and try again.'
export const HEALTH_ID_NO_ACCESS = 'You can’t open this person’s record yet. Ask them to share their record with you, or approve your access request.'
export const HEALTH_ID_ROLE = 'Your role can’t look people up by Health ID. Ask your facility administrator to link this registration, or to change your role.'
export const LINK_NEEDS_SHARE = 'To link this registration, the person needs to share their record with your facility for care. A PIN only lets you view their record, not link it.'
export const LOOKUP_FAILED = 'We couldn’t check this Health ID. Try again.'

/** A Health ID as Identity takes it (patient-lookup.dto.ts): HID- and 6 to 32 letters and digits, no I, O, 0 or 1. */
const HEALTH_ID = /^HID-[A-HJ-NP-Z2-9]{6,32}$/

/** The Health ID typed, spaces removed and upper-cased, with HID- added when only the rest was typed; '' when it isn't one. */
export function healthIdFrom(typed: string): string {
  const compact = typed.replace(/\s+/g, '').toUpperCase()
  const hid = compact.startsWith('HID-') ? compact : compact.startsWith('HID') ? `HID-${compact.slice(3)}` : `HID-${compact}`
  return HEALTH_ID.test(hid) ? hid : ''
}

/**
 * A campaign takes registrations only inside its start and end times (outreach.service.ts
 * assertCampaignAcceptsRegistration). The list may not carry them (staff/api.ts OutreachCampaign has no endsAt): a time
 * not sent, or not readable, does not take a campaign off the list.
 */
export function campaignOpenNow(campaign: OutreachCampaign, now = Date.now()): boolean {
  const time = (value: unknown) => (typeof value === 'string' ? new Date(value).getTime() : Number.NaN)
  const startsAt = time((campaign as { startsAt?: unknown }).startsAt)
  const endsAt = time((campaign as { endsAt?: unknown }).endsAt)
  if (!Number.isNaN(startsAt) && now < startsAt) return false
  if (!Number.isNaN(endsAt) && now >= endsAt) return false
  return true
}

/** A campaign refused this registration: the person can be saved without it. */
export function campaignRefusedText(name: string | undefined) {
  return `${name ? `“${name}”` : 'This campaign'} isn’t taking this registration right now. You can save this person without the campaign. Everything you typed is kept.`
}

/**
 * A campaign's status in plain words. Outreach sends planned, active or closed (campaign.types.ts CampaignStatus); the
 * others are words a campaign could plausibly be given. A status with no word here is never printed as its code.
 */
const CAMPAIGN_STATUS: Readonly<Record<string, string>> = {
  draft: 'Not started',
  planned: 'Not started',
  scheduled: 'Not started',
  active: 'Running',
  paused: 'Paused',
  closed: 'Finished',
  completed: 'Finished',
  ended: 'Finished',
  cancelled: 'Cancelled',
  archived: 'Finished',
}

export function campaignStatusLabel(status: string) {
  return (Object.hasOwn(CAMPAIGN_STATUS, status) ? CAMPAIGN_STATUS[status] : undefined) ?? 'Status not known'
}

export function caseName(item: OutreachCase) {
  return item.fullName ?? 'Registrant'
}

export function ageText(item: OutreachCase) {
  return item.ageYears == null ? 'Not recorded' : `${item.ageYears} years`
}

export function sexText(item: OutreachCase) {
  if (!item.sex) return 'Sex not recorded'
  return item.sex === 'unknown' ? 'Sex not known' : item.sex.replace(/^./, letter => letter.toUpperCase())
}

/** The words a list search looks in: what a row shows, and nothing that is not on screen. */
export function caseSearchText(item: OutreachCase) {
  return [caseName(item), statusLabel(item.status), ageText(item), sexText(item), dateText(item.createdAt)]
}

export function campaignSearchText(campaign: OutreachCampaign) {
  return [campaign.name, campaignStatusLabel(campaign.status), servicesText(campaign.services), dateText(campaign.startsAt)]
}

/**
 * A case's phone number as the case's own view shows it: in full, as Outreach sent it, so the team can call the person
 * back (owner, 2026-11-02). Only the case's view shows it: the list card never carries it and the search never matches
 * it. A number Outreach sends already masked is shown as it was sent.
 */
export function phoneText(phone: string | null | undefined): string {
  const given = phone?.trim()
  return given ? given : 'Not recorded'
}

/**
 * A registration case's saved fields, as the design's "Saved record" and quick view list them. The phone number and the
 * notes for the team are listed when Outreach sends them (null: none was given); a backend without them sends neither,
 * and they are left out.
 */
export function caseFacts(item: OutreachCase, campaign: OutreachCampaign | undefined): DeptFact[] {
  const notes = item.operationalNotes?.trim()
  return [
    { label: 'Full name', value: caseName(item) },
    { label: 'Age', value: ageText(item) },
    { label: 'Sex', value: sexText(item) },
    ...(item.phone !== undefined ? [{ label: 'Phone number', value: phoneText(item.phone) }] : []),
    { label: 'Status', value: statusLabel(item.status) },
    { label: 'Campaign', value: item.campaignId ? (campaign?.name ?? 'A campaign not listed here') : 'No campaign' },
    { label: 'Created', value: dateText(item.createdAt) },
    ...(item.operationalNotes !== undefined
      ? [{ label: 'Notes for the team', value: notes ? <span className="whitespace-pre-wrap break-words">{notes}</span> : 'None' }]
      : []),
  ]
}

export function campaignFacts(campaign: OutreachCampaign): DeptFact[] {
  return [
    { label: 'Name', value: campaign.name },
    { label: 'Status', value: campaignStatusLabel(campaign.status) },
    { label: 'Services', value: servicesText(campaign.services, 'None listed') },
    { label: 'Starts', value: dateText(campaign.startsAt) },
    // Outreach sends its end on every campaign (null: none set); an older answer leaves it out, and so does this.
    ...(campaign.endsAt !== undefined ? [{ label: 'Ends', value: campaign.endsAt ? dateText(campaign.endsAt) : 'No end date' }] : []),
    // What Health ID support asks for when a campaign has lost its only admin: its reference and, to close it, its version.
    { label: 'For Health ID support', value: <span className="break-all">Reference {campaign.id}, version {campaign.rowVersion}</span> },
  ]
}

/** One campaign's members as read for the page: the same read today's campaign card makes. */
export interface MembersRead {
  readonly facilityId: string
  readonly items: OutreachCampaignMember[] | null
  readonly loading: boolean
  readonly error: string
  /** The refusal itself, when the read failed. */
  readonly caught?: unknown
  readonly refresh: () => Promise<void>
}

/** The design's ErrorBox: a refusal after an action, or a read that failed. */
export function ErrorBox({ message, id }: { readonly message: string; readonly id?: string }) {
  return message ? <div id={id} role="alert" className="hid-ehr-dept-outreach-error">{message}</div> : null
}

/**
 * A form field as the design draws it: its label (with " *" when required), the control,
 * and its error under it. The control takes `id`, and is described by `${id}-error` while
 * refused, or `${id}-hint`. `alert`: the field was refused while focus was already in it,
 * so the error is said as an alert there (`seq` makes it new each time).
 */
export function OutreachField({ id, label, required = false, error, hint, alert = false, seq = 0, full = false, children }: {
  readonly id: string
  readonly label: string
  readonly required?: boolean
  readonly error?: string
  readonly hint?: string
  readonly alert?: boolean
  readonly seq?: number
  readonly full?: boolean
  readonly children: ReactNode
}) {
  return (
    <div className={['hid-ehr-field', full ? 'hid-ehr-dept-full' : undefined].filter(Boolean).join(' ')}>
      <label className="hid-ehr-label" htmlFor={id}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
      {children}
      {error ? <p id={`${id}-error`} className="hid-ehr-error">{alert ? <span key={seq} role="alert">{error}</span> : error}</p> : null}
      {!error && hint ? <p id={`${id}-hint`} className="hid-ehr-hint">{hint}</p> : null}
    </div>
  )
}

/** The props a control in an OutreachField takes: invalid and described by its error while refused. */
export function controlProps(id: string, error: string | undefined, hint = false) {
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  }
}

/**
 * Field errors for a form that checks itself: every refused field at once, focus on the
 * first. Refused while focus is already on that field (Enter in it), focus cannot move, so
 * its error is an alert there instead.
 */
export interface FieldErrors<Field extends string> {
  readonly errors: Partial<Record<Field, string>>
  readonly alert?: Field
  readonly seq: number
}

/** A case's status in plain words, as the cards and record say it: "Waiting to link", "Linked". Never its code. */
const STATUS_LABEL: Readonly<Record<string, string>> = {
  [PENDING]: 'Waiting to link',
  identity_resolved: 'Linked',
  resolved: 'Linked',
  linked_existing: 'Linked',
  resolved_existing_identity: 'Already on Health ID',
  // Cases that ended without a link: said in words too, rather than read as unknown.
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  closed: 'Closed',
  duplicate: 'Duplicate',
}
/** The statuses that mean the person was linked to a Health ID: the only green ones. */
const LINKED_STATUSES: ReadonlySet<string> = new Set(['identity_resolved', 'resolved', 'linked_existing', 'resolved_existing_identity'])

export function statusLabel(status: string) {
  return (Object.hasOwn(STATUS_LABEL, status) ? STATUS_LABEL[status] : undefined) ?? 'Status not known'
}

/** What the create form's answer said, on the blue page and today's: the case made, and where its identity stands. */
export function createdText(created: OutreachCase | undefined) {
  if (!created?.status) return 'Registration case created.'
  return created.status === PENDING
    ? 'Registration case created. It stays pending until it is linked to a verified Health ID patient.'
    : `Registration case created. Its status is ${statusLabel(created.status).toLowerCase()}.`
}

/** A case's tone, with its word always beside it: waiting is amber, linked is green, anything else neutral. */
export function caseTone(status: string): Tone {
  if (status === PENDING) return 'warn'
  return LINKED_STATUSES.has(status) ? 'success' : 'neutral'
}

/** What happens next on a case, said on its card: the one next step, or that it is done. */
export function nextStepText(item: OutreachCase, canLink: boolean, group = false): string {
  if (item.status !== PENDING) return Object.hasOwn(STATUS_LABEL, item.status) ? 'Done: nothing more to do' : 'Nothing else to do here.'
  // At an outreach group nobody here links it: the person links their own Health ID later.
  if (group) return 'They link their own Health ID later'
  return canLink ? 'Next: link their Health ID' : 'Waiting for someone to link their Health ID'
}

/** A case is waiting while its identity is unresolved; every other status is done here. */
export function caseWaiting(item: OutreachCase) {
  return item.status === PENDING
}
