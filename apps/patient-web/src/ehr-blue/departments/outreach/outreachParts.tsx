import type { ReactNode } from 'react'
import type { OutreachCampaign, OutreachCampaignMember, OutreachCase } from '../../../staff/api'
import type { Tone } from '../../../kasuwa/ui'
import type { DeptFact } from '../parts/DeptRecord'
import { birthDateText, dateText } from '../parts/format'

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
/** At least this many characters, as Outreach takes a phone number or notes (CreateRegistrationCaseDto). */
export const AT_LEAST_THREE = 'Enter at least 3 characters, or leave this blank.'
export const AGE_RANGE = 'Enter an age in whole years, from 0 to 130.'
/** Outreach takes a resolution reason of 8 characters or more. */
export const REASON_LENGTH = 'Enter at least 8 characters.'

/** No working facility: nothing at a facility can be opened. */
export const NO_FACILITY = 'No facility is selected. Choose the facility you are working at to open Outreach.'
/** Under a refused link: the case was read again, so the next attempt is checked against its latest version. */
export const LINK_RETRY_NOTE = 'The case has been read again, so a retry uses its latest version. Check the details, then retry using the same button. No success is reported until saved.'

export const CASES_NOT_LOADED = 'Registration cases could not be loaded. Refresh to try again.'
export const CAMPAIGNS_NOT_LOADED = 'Campaigns could not be loaded. Refresh to try again.'
export const MEMBERS_NOT_LOADED = 'Campaign members could not be loaded. Try again.'
export const CREATE_FAILED = 'The registration case could not be saved. Please retry.'
export const LINK_FAILED = 'The patient could not be linked. Check your access to this patient, then refresh the case.'

export const PENDING = 'identity_resolution_pending'

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

/** A campaign refused this registration (or, before backend 0120, failed on it): the person can be saved without it. */
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
  return [caseName(item), statusLabel(item.status), ageText(item), sexText(item), item.temporaryPatientId, dateText(item.createdAt)]
}

export function campaignSearchText(campaign: OutreachCampaign) {
  return [campaign.name, campaignStatusLabel(campaign.status), campaign.services.join(' '), dateText(campaign.startsAt)]
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
export function caseFacts(item: OutreachCase, campaign: OutreachCampaign | undefined, served = false): DeptFact[] {
  const notes = item.operationalNotes?.trim()
  // Once 0115 is served, the case answer names its campaign itself (for a membership that can't read campaigns too), and
  // its next follow-up date.
  const extra = item as { campaignName?: unknown; nextFollowUpOn?: unknown }
  const answerCampaign = served && typeof extra.campaignName === 'string' && extra.campaignName.trim() ? extra.campaignName.trim() : undefined
  const followUp = served && typeof extra.nextFollowUpOn === 'string' ? dayText(extra.nextFollowUpOn) : ''
  return [
    { label: 'Full name', value: caseName(item) },
    { label: 'Age', value: ageText(item) },
    { label: 'Sex', value: sexText(item) },
    ...(item.phone !== undefined ? [{ label: 'Phone number', value: phoneText(item.phone) }] : []),
    { label: 'Status', value: statusLabel(item.status) },
    { label: 'Temporary patient ID', value: item.temporaryPatientId ?? 'Not assigned' },
    { label: 'Campaign', value: item.campaignId || answerCampaign ? (campaign?.name ?? answerCampaign ?? 'A campaign not listed here') : 'No campaign' },
    { label: 'Created', value: dateText(item.createdAt) },
    ...(followUp ? [{ label: 'Next follow-up', value: followUp }] : []),
    ...(item.operationalNotes !== undefined
      ? [{ label: 'Notes for the team', value: notes ? <span className="whitespace-pre-wrap break-words">{notes}</span> : 'None' }]
      : []),
  ]
}

export function campaignFacts(campaign: OutreachCampaign): DeptFact[] {
  return [
    { label: 'Name', value: campaign.name },
    { label: 'Status', value: campaignStatusLabel(campaign.status) },
    { label: 'Services', value: campaign.services.length ? campaign.services.join(', ') : 'None listed' },
    { label: 'Starts', value: dateText(campaign.startsAt) },
  ]
}

/** One campaign's members as read for the page: the same read today's campaign card makes. */
export interface MembersRead {
  readonly facilityId: string
  readonly items: OutreachCampaignMember[] | null
  readonly loading: boolean
  readonly error: string
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

/** A case's tone, with its word always beside it: waiting is amber, linked is green, anything else neutral. */
export function caseTone(status: string): Tone {
  if (status === PENDING) return 'warn'
  return LINKED_STATUSES.has(status) ? 'success' : 'neutral'
}

/** What happens next on a case, said on its card: the one next step, or that it is done. */
export function nextStepText(item: OutreachCase, canLink: boolean): string {
  if (item.status !== PENDING) return Object.hasOwn(STATUS_LABEL, item.status) ? 'Done: nothing more to do' : 'Nothing else to do here.'
  return canLink ? 'Next: link their Health ID' : 'Waiting for someone to link their Health ID'
}

/** A case is waiting while its identity is unresolved; every other status is done here. */
export function caseWaiting(item: OutreachCase) {
  return item.status === PENDING
}

/*
 * Follow-up visits, member names and linking by Health ID (hid-system 0115): the words the page says only once the
 * backend serves them (outreachVisitsServed.ts). Never a code, an ID or a kind as it is sent.
 */

/** A visit's kind in words. A kind with no word here is said as a visit, never printed as its code. */
const VISIT_KIND: Readonly<Record<string, string>> = { visit: 'Visit', referral: 'Referral', follow_up: 'Follow-up' }
export function visitKindText(kind: string): string {
  return (Object.hasOwn(VISIT_KIND, kind) ? VISIT_KIND[kind] : undefined) ?? 'Visit'
}

/** A calendar day (YYYY-MM-DD) as "5 Nov 2026"; '' when it isn't one. */
export function dayText(value: string | null | undefined): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? birthDateText(value) : ''
}

/** "Next follow-up 12 Nov 2026", or '' when none is set. */
export function followUpText(value: string | null | undefined): string {
  const day = dayText(value)
  return day ? `Next follow-up ${day}` : ''
}

/** Today in Lagos as YYYY-MM-DD: the day Outreach takes as the latest a visit can have happened. */
export function lagosToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** The earliest day Outreach takes for a visit. */
export const FIRST_VISIT_DAY = '2020-01-01'

export const VISITS_NOT_LOADED = 'Visits and follow-ups could not be loaded. Try again.'
export const VISIT_FAILED = 'The visit could not be saved. Please retry.'
export const VISIT_CONFLICT = 'The visit could not be saved because something changed at the same time. Check the details and save it again.'
/** The case is no longer there (removed, or out of this membership's reach). */
export const CASE_GONE = 'This registration is no longer here. It may have been removed. Go back to the list.'
export const VISIT_DAY_REQUIRED = 'Enter the date it happened.'
export const VISIT_DAY_INVALID = 'Enter a valid date.'
export const VISIT_DAY_FUTURE = 'The date can’t be later than today.'
export const VISIT_DAY_TOO_EARLY = 'Enter a date from 1 Jan 2020 onwards.'
export const FOLLOW_UP_AFTER = 'Choose a date after the date it happened, or leave this blank.'
export const REFERRED_TO_LENGTH = 'Enter at least 2 characters, or leave this blank.'

/** Linking by Health ID once served: the preview's and the link's refusals, in plain words. */
export const HEALTH_ID_LIMIT = 'You’ve checked a lot of Health IDs in the last hour. Try again later.'
export const LINK_ALREADY_DONE = 'This registration has already been linked or closed. The case has been read again.'
export const LINK_CHANGED = 'Someone changed this registration just now. It has been read again: check it, then try again.'

/** "Registered by Ada Obi", when the answer names who registered the case. */
export function registeredByText(item: { createdBy?: { name?: unknown } | null }): string {
  const name = typeof item.createdBy?.name === 'string' ? item.createdBy.name.trim() : ''
  return name ? `Registered by ${name}` : ''
}
