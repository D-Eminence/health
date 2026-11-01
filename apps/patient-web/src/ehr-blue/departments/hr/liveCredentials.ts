import { useCallback, useEffect, useState } from 'react'
import { isHidApiError } from '@hid/http'
import { facilityStaffApi, type Facility, type FacilityStaff, type FacilityStaffMember } from '../../../staff/api'
import { heldRoleNames, isLicenceBody, LICENCE_BODIES, selfServiceReview } from '../../../staff/staffAccess'
import { isRouteMissing, isUnavailable, staffProblemText } from '../../../staff/staffProblems'
import type { DeptFact } from '../parts/DeptRecord'

/*
 * The live half of HR & Credentials: who works at the facility and the licence on record for each, from today's one
 * Staff read (facilityStaffApi.read, as staff/routes/Staff.tsx makes it). Read only: role and licence changes stay on
 * Staff & access. The read's conditions and refusal paths are today's, line for line; the words are the design's.
 */

/** "12 Oct 2026, 14:05", in the browser's time zone (staff/routes/Staff.tsx `when`). */
export function when(value: string | null | undefined): string {
  if (!value) return 'Not available'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'Not available'
    : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

/** "12 Oct 2026" (staff/routes/Staff.tsx `dateOnly`). */
export function dateOnly(value: string | null | undefined): string {
  if (!value) return 'an unknown date'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'an unknown date' : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(parsed)
}

type Loaded =
  | { facilityId: string; status: 'loading' }
  | { facilityId: string; status: 'ready'; staff: FacilityStaff }
  | { facilityId: string; status: 'failed'; caught: unknown }

/**
 * What the live list shows: a line in place of the list, the list loading, a refused read with a retry, or the staff.
 * `read` is the answer itself, new for each one, so a page can tell a repeated refusal from the one before.
 */
export type LiveStaff =
  | { kind: 'notice'; tone: 'info' | 'critical'; message: string }
  | { kind: 'loading' }
  | { kind: 'failed'; message: string; retry: () => void; read: object }
  | { kind: 'ready'; staff: FacilityStaff; read: object }

export const LIVE_LOADING = 'Loading staff records…'

/**
 * Today's Staff page read (StaffPage): only for a facility that signed itself up and a membership holding
 * workforce.manage there, again on `retry`; an answer for an earlier facility is dropped, and a list already read stays
 * shown while it is read again. `waiting` holds the read back while the address is going back to the page's base, where
 * the frame draws the page anew and it reads then.
 */
export function useLiveStaff(facility: Facility | undefined, waiting = false): LiveStaff {
  const facilityId = facility?.id ?? ''
  const canManage = facility?.permissions.includes('workforce.manage') ?? false
  const selfService = selfServiceReview(facility) !== null
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision(value => value + 1), [])

  useEffect(() => {
    if (waiting || !facilityId || !canManage || !selfService) return
    let active = true
    setLoaded(previous => previous?.facilityId === facilityId && previous.status === 'ready' ? previous
      : { facilityId, status: 'loading' })
    facilityStaffApi.read(facilityId).then(
      staff => { if (active) setLoaded({ facilityId, status: 'ready', staff }) },
      caught => { if (active) setLoaded({ facilityId, status: 'failed', caught }) })
    return () => { active = false }
  }, [waiting, facilityId, canManage, selfService, revision])

  if (!facility) return { kind: 'notice', tone: 'info', message: 'Choose the facility you are working at first.' }
  if (!canManage) return { kind: 'notice', tone: 'critical', message: `Permission denied. Only ${facility.name}’s administrator can open its staff records.` }
  const notAvailable: LiveStaff = { kind: 'notice', tone: 'info', message: `Health ID support manages who works at ${facility.name}. `
    + 'Contact Health ID support to add or remove staff.' }
  if (!selfService) return notAvailable
  const current = loaded?.facilityId === facilityId ? loaded : null
  if (!current || current.status === 'loading') return { kind: 'loading' }
  if (current.status === 'failed') {
    const { caught } = current
    if (isRouteMissing(caught)) return { kind: 'notice', tone: 'info', message: 'Staff records aren’t set up for your facility. Contact support.' }
    if (isHidApiError(caught) && caught.code === 'STAFF_MANAGEMENT_NOT_AVAILABLE') return notAvailable
    return { kind: 'failed', retry: reload, read: current, message: isUnavailable(caught) ? staffProblemText(caught, { facility: facility.name })
      : `${facility.name}’s staff couldn’t be loaded. ${staffProblemText(caught, { facility: facility.name })}` }
  }
  return { kind: 'ready', staff: current.staff, read: current }
}

/** One member as an HR & Credentials record: their licence, in the design's record shape. */
export interface LiveCredential {
  readonly key: string
  /** The membership's first 8 characters, as the design shows a record's reference. */
  readonly reference: string
  /** The credential: "MDCN licence", or "No licence on record". */
  readonly name: string
  readonly staff: string
  readonly roles: string
  readonly isSelf: boolean
  /** The design's lowercase status word. */
  readonly status: 'reviewed' | 'vouched' | 'recorded' | 'no licence'
  readonly updatedAt: string | null
  readonly facts: ReadonlyArray<DeptFact>
}

type Licence = { body: string; numberHint: string | null; vouchedBy: string | null; vouchedAt: string | null; method: string | null }

/**
 * The member's licence: their own, or, for the administrator of a facility support has not checked yet, the licence they
 * recorded for that check (FacilityStaff.administratorLicence), which support has not reviewed.
 */
function licenceOf(member: FacilityStaffMember, staff: FacilityStaff): { licence: Licence | null; awaitingCheck: boolean; recordedAt: string | null } {
  if (member.licence) return { licence: member.licence, awaitingCheck: false, recordedAt: null }
  const own = staff.administratorLicence
  if (own && member.isSelf && member.isAdministrator && staff.facility.reviewState !== 'reviewed') {
    return { licence: { body: own.body, numberHint: own.numberHint, vouchedBy: null, vouchedAt: null, method: null }, awaitingCheck: true, recordedAt: own.recordedAt }
  }
  return { licence: null, awaitingCheck: false, recordedAt: null }
}

/** Who checked the licence, in today's order (Staff.tsx licenceText): Health ID support's check, then a facility's word. */
function reviewOf(licence: Licence, awaitingCheck: boolean): string | null {
  if (awaitingCheck) return 'Waiting for Health ID support’s check'
  if (licence.method === 'platform_review') return `Checked by Health ID support on ${dateOnly(licence.vouchedAt)}`
  return licence.vouchedBy ? `Vouched by ${licence.vouchedBy} on ${dateOnly(licence.vouchedAt)}` : null
}

export function liveCredentials(staff: FacilityStaff): LiveCredential[] {
  return staff.members.map(member => {
    const { licence, awaitingCheck, recordedAt } = licenceOf(member, staff)
    // Every role counted: the administrator decides this member's access (heldRoleNames).
    const roles = heldRoleNames(member.roles)
    const name = licence ? `${licence.body} licence` : 'No licence on record'
    const review = licence ? reviewOf(licence, awaitingCheck) : null
    const status: LiveCredential['status'] = !licence ? 'no licence' : awaitingCheck ? 'recorded'
      : licence.method === 'platform_review' ? 'reviewed' : licence.vouchedBy ? 'vouched' : 'recorded'
    const facts: DeptFact[] = [
      { label: 'Staff', value: member.name },
      { label: 'Email', value: member.email },
      { label: 'Name', value: name },
      ...licence?.numberHint ? [{ label: 'Number', value: `ending ${licence.numberHint}` }] : [],
      ...licence ? [{ label: 'Issued by', value: isLicenceBody(licence.body) ? LICENCE_BODIES[licence.body].regulator : licence.body }] : [],
      { label: 'Employment', value: roles },
      { label: 'Joined', value: when(member.joinedAt) },
      ...review ? [{ label: 'Review', value: review }] : [],
    ]
    return {
      key: member.membershipId,
      reference: member.membershipId.slice(0, 8),
      name,
      staff: member.name,
      roles,
      isSelf: member.isSelf,
      status,
      updatedAt: licence?.vouchedAt ?? recordedAt ?? member.joinedAt,
      facts,
    }
  })
}

/** The facility support has not checked yet: what that means for its staff list, and the administrator's own licence. */
export function pendingCheckText(staff: FacilityStaff): string | null {
  if (staff.facility.reviewState === 'reviewed') return null
  const own = !staff.administratorLicence && staff.administratorLicenceBodies.some(isLicenceBody)
    ? ' To get clinical access yourself, add your licence on Staff & access.' : ''
  return `You can add staff once Health ID support has checked ${staff.facility.name}.${own}`
}
