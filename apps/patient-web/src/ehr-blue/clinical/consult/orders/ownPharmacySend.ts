import type { ClinicalRecord, PharmacyHandoff } from '../../../../staff/api'
import { text } from './orders'

/**
 * "Send to pharmacy" for the prescriber (hid-system 0133, live at ehr-api 06f98040; INTERFACE_CONTRACT.md "EHR API:
 * pharmacyHandoff" and `POST .../prescriptions/:prescriptionId/own-pharmacy-send`): an active prescription goes to this
 * hospital's own pharmacy by itself when its prescriber activates it. When that send is pending or could not reach the
 * pharmacy, or the prescription was activated by a colleague or written before the hospital had pharmacy staff, the
 * prescriber sends it here.
 */

const STATUSES: ReadonlySet<string> = new Set(['sent', 'pending', 'not_sent'])
const REASONS: ReadonlySet<string> = new Set(['no_pharmacy', 'routed', 'not_prescriber', 'changed', 'superseded', 'not_allowed', 'unavailable'])

/**
 * The contract's table in the page's own words (the same sentences): the server's message is never shown. It is read
 * in one place only, to tell the two `sent` rows apart (handoffText: a message that starts "This hospital" is said as
 * "already has", any other as "Sent"). A `not_sent` whose reason this page does not know is said as "could not be
 * reached", as ehr-api itself answers anything unexpected.
 */
const SENT = 'Sent to this hospital’s pharmacy.'
const PENDING = 'Not sent to the pharmacy yet. Use Send to pharmacy to try again.'
const NOT_SENT: Readonly<Record<NonNullable<PharmacyHandoff['reason']>, string>> = {
  no_pharmacy: 'Not sent: nobody at this facility works on pharmacy orders on Health ID.',
  routed: 'Not sent: this prescription has been sent to another pharmacy.',
  not_prescriber: 'Not sent: only the person who wrote this prescription can send it to the pharmacy.',
  changed: 'Not sent: this prescription changed. Reload it and try again.',
  superseded: 'Not sent: this hospital’s pharmacy has an earlier version of this prescription, which it can no longer dispense.',
  not_allowed: 'Not sent: your role at this facility does not allow sending prescriptions to the pharmacy.',
  unavailable: 'Not sent: the pharmacy could not be reached. Use Send to pharmacy to try again.',
}
const ALREADY_HAS = 'This hospital’s pharmacy already has this prescription.'

/** `pharmacyHandoff` as the EHR answered it, or null when it sent none (a database before 0133) or nothing readable. */
export function readPharmacyHandoff(value: unknown): PharmacyHandoff | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.status !== 'string' || !STATUSES.has(raw.status)) return null
  const status = raw.status as PharmacyHandoff['status']
  const message = typeof raw.message === 'string' ? raw.message : ''
  if (status !== 'not_sent') return { status, message }
  const reason = typeof raw.reason === 'string' && REASONS.has(raw.reason) ? raw.reason as NonNullable<PharmacyHandoff['reason']> : 'unavailable'
  return { status, reason, message }
}

/**
 * What the page says of a hand-off. A `sent` answer's message is read (not shown) to choose between its two rows,
 * "Sent" and "already has"; every other answer is said by its status and reason alone.
 */
export function handoffText(handoff: PharmacyHandoff): string {
  if (handoff.status === 'pending') return PENDING
  if (handoff.status === 'sent') return handoff.message.trim().startsWith('This hospital') ? ALREADY_HAS : SENT
  return NOT_SENT[handoff.reason ?? 'unavailable']
}

/** Whether pressing "Send to pharmacy" again can help: only a pending send or one that could not reach the pharmacy. */
export function handoffRetryable(handoff: PharmacyHandoff): boolean {
  return handoff.status === 'pending' || (handoff.status === 'not_sent' && handoff.reason === 'unavailable')
}

/** The signed-in member as the staff session gives them: the account id (EHR's createdBy) and their memberships. */
export interface Prescriber {
  readonly accountId?: unknown
  readonly facility?: { readonly id: string; readonly membershipId?: unknown } | null
  readonly facilities?: ReadonlyArray<{ readonly id: string; readonly membershipId?: unknown }>
}

/**
 * Whether the signed-in member wrote the prescription: its `createdByMembershipId` is their membership at the chart's
 * facility and, when the session carries an account id, its `createdBy` is that account (the contract asks both). A
 * membership the session does not name: no.
 */
export function writtenBy(record: ClinicalRecord, actor: Prescriber | null, facilityId: string): boolean {
  if (!actor) return false
  const membership = [actor.facility, ...(actor.facilities ?? [])].find(facility => facility?.id === facilityId)
  const membershipId = text(membership?.membershipId)
  if (!membershipId || text(record.createdByMembershipId) !== membershipId) return false
  const accountId = text(actor.accountId)
  return !accountId || text(record.createdBy) === accountId
}

/** The prescription's own pharmacy progress status (ORD-3), or '' when the EHR sent none. */
function progressStatus(record: ClinicalRecord): string {
  const progress = record.ownProgress
  if (typeof progress !== 'object' || progress === null) return ''
  return text((progress as Record<string, unknown>).status)
}

/**
 * Whether the page offers "Send to pharmacy". Never unless the prescription is active, nobody is offered it on a
 * prescription sent to another facility (`routed`), and the member may write prescriptions here. After an answer on this
 * page (`handoff`), only while it can help (pending, or the pharmacy could not be reached), as its words say ("Use Send
 * to pharmacy to try again"): such an answer already passed the EHR's own `no_pharmacy` test, so it is offered even when
 * the prescription's read could not say whether somebody here works on pharmacy items; the other answers hold until the
 * prescription is opened again. With no answer yet, only where somebody here works on pharmacy items
 * (`ownPharmacyStaffed` true: absent or false, never, so nobody is offered a send that answers `no_pharmacy`), to the
 * member who wrote it, while the pharmacy has not received it (`ownProgress.status` `not_received`).
 */
export function ownSendOffered({ record, actor, facilityId, canWrite, routed, handoff }: {
  readonly record: ClinicalRecord
  readonly actor: Prescriber | null
  readonly facilityId: string
  readonly canWrite: boolean
  readonly routed: boolean
  readonly handoff: PharmacyHandoff | null
}): boolean {
  if (text(record.status) !== 'active' || !canWrite || routed) return false
  if (handoff) return handoffRetryable(handoff)
  if (record.ownPharmacyStaffed !== true) return false
  return writtenBy(record, actor, facilityId) && progressStatus(record) === 'not_received'
}

/**
 * Whether today's pharmacist hand-off ("Send to Pharmacy") may still be offered: Pharmacy keeps one item of its own per
 * prescription and refuses the hand-off once it holds one (sent by itself on activation, or with Send to pharmacy). So
 * only while this hospital's pharmacy has not received it (`ownProgress.status` `not_received`), or the EHR could not
 * say (no `ownProgress`, from an EHR before it, or `unknown`), and no answer on this page says it was sent.
 */
export function pharmacistHandoffOffered(record: ClinicalRecord, handoff: PharmacyHandoff | null): boolean {
  if (handoff?.status === 'sent') return false
  const status = progressStatus(record)
  return status === '' || status === 'not_received' || status === 'unknown'
}

/** 503 OWN_PHARMACY_SEND_UNAVAILABLE: a database without 0133. */
export const OWN_SEND_UNAVAILABLE = 'Send to pharmacy isn’t available here yet. Try again later.'
export const OWN_SEND_FAILED = 'Send to pharmacy could not be completed.'
/** 409 VISIT_ENTERED_IN_ERROR: the visit was marked entered in error, so nothing more is sent from it (EHR-C8a). */
export const OWN_SEND_VISIT_IN_ERROR = 'This visit was marked entered in error, so nothing more can be sent from it.'
/** 404: the prescription was not found to send (CLINICAL_RESOURCE_NOT_FOUND or PRESCRIPTION_NOT_FOUND). */
export const OWN_SEND_NOT_FOUND = 'This prescription was not found, so it was not sent to the pharmacy.'

/**
 * 403 CONSENT_REQUIRED: the patient's approval for changes ended after the page's own check, in the chart's words for
 * the same refusal of a send to another facility (staff/orderRoutes.ts sendRefusal).
 */
export function ownSendConsentEnded(patient: string): string {
  return `${patient}’s approval for changes to their record has ended. Ask them to approve a read-and-write request first.`
}
