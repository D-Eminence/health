import type { ReactNode } from 'react'
import type { OutreachCampaign, OutreachCampaignMember, OutreachCase } from '../../../staff/api'
import type { DeptFact } from '../parts/DeptRecord'
import { dateText } from '../parts/format'
import './outreach.css'

/*
 * Words and small parts the Outreach views share, in the design's voice (the target's
 * workflows.tsx, ui.tsx and feedback.tsx). Live decides the data and the rules; these only
 * say them.
 */

/** The design's line when a record offers nothing to do. */
export const NO_ACTIONS = 'No further actions for your permission and this record state.'
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
/** The membership reads neither campaigns nor registration cases here. */
export const NO_READ_PERMISSION = 'Permission denied. This membership or branch cannot open this module: it needs outreach campaign or registration read permission.'
/** Under a refused link: the case was read again, so the next attempt is checked against its latest version. */
export const LINK_RETRY_NOTE = 'The case has been read again, so a retry uses its latest version. Check the details, then retry using the same button. No success is reported until saved.'

export const CASES_NOT_LOADED = 'Registration cases could not be loaded. Refresh to try again.'
export const CAMPAIGNS_NOT_LOADED = 'Campaigns could not be loaded. Refresh to try again.'
export const MEMBERS_NOT_LOADED = 'Campaign members could not be loaded. Try again.'
export const CREATE_FAILED = 'The registration case could not be saved. Please retry.'
export const LINK_FAILED = 'The patient could not be linked. Check your access to this patient, then refresh the case.'

/** Identity does not authorize campaign writes yet, so none is offered; said where campaigns show. */
export const CAMPAIGNS_READ_ONLY_TITLE = 'Campaigns are read only'
export const CAMPAIGNS_READ_ONLY = 'You can view campaigns and their members here. Creating, activating or closing a campaign, and adding members, is not available yet.'

export const PENDING = 'identity_resolution_pending'

/** A status as the design's badges say it: lowercase words. */
export function statusWords(status: string) {
  return status.replaceAll('_', ' ').toLowerCase()
}

/** A record's short reference under its name, as the design's lists show it. */
export function reference(id: string) {
  return id.slice(0, 8)
}

export function caseName(item: OutreachCase) {
  return item.fullName ?? 'Registrant'
}

export function ageText(item: OutreachCase) {
  return item.ageYears == null ? 'Not recorded' : `${item.ageYears} years`
}

export function sexText(item: OutreachCase) {
  return item.sex ?? 'Not recorded'
}

/** The words a list search looks in: what a row shows, and its full references. */
export function caseSearchText(item: OutreachCase) {
  return [caseName(item), statusWords(item.status), item.id, ageText(item), sexText(item), item.temporaryPatientId, dateText(item.createdAt)]
}

export function campaignSearchText(campaign: OutreachCampaign) {
  return [campaign.name, statusWords(campaign.status), campaign.id, campaign.services.join(' '), dateText(campaign.startsAt)]
}

/** A registration case's saved fields, as the design's "Saved record" and quick view list them. */
export function caseFacts(item: OutreachCase, campaign: OutreachCampaign | undefined): DeptFact[] {
  return [
    { label: 'Full name', value: caseName(item) },
    { label: 'Age', value: ageText(item) },
    { label: 'Sex', value: sexText(item) },
    { label: 'Status', value: statusWords(item.status) },
    { label: 'Temporary patient ID', value: item.temporaryPatientId ?? 'Not assigned' },
    { label: 'Campaign', value: item.campaignId ? (campaign?.name ?? reference(item.campaignId)) : 'No campaign' },
    { label: 'Created', value: dateText(item.createdAt) },
  ]
}

export function campaignFacts(campaign: OutreachCampaign): DeptFact[] {
  return [
    { label: 'Name', value: campaign.name },
    { label: 'Status', value: statusWords(campaign.status) },
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
