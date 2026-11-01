import { usesNovuBackend } from '../backendContract'
import type { Facility } from './api'
import { roleInSentence, selfServiceReview, selfServiceType, type OrganizationType } from './staffAccess'

/**
 * The staff roles ROLE_LABELS (staffAccess.ts) names, the administrator's apart. A refusal names the role that does the
 * work by those words, and roleInSentence says "a member of staff" for a code it has no words for, which would tell an
 * administrator to add nobody in particular: so only these can be named. Add a role here once ROLE_LABELS names it, and
 * to refusedWork.test.ts, which checks each has words.
 */
export type NamedRole = 'doctor' | 'clinician' | 'nurse' | 'lab' | 'pharmacist' | 'receptionist'

/**
 * Work a role may not hold at a facility, as its refusal names it: the department (`name`), the `work` the role doesn't
 * include, the role whose holders do that work, and the kinds of self-signed-up facility that get it once Health ID
 * support has checked them, the ones whose locked list names it (staff/routes/ReviewBanner.tsx LOCKED). A facility of
 * another kind is never promised it. Work every kind has from the day it signs up is in no locked list, so no kind gets
 * it only after the check (`gets` is empty) and no role is named (`doneBy` is null): the administrator is never told it
 * opens after the check, nor to add someone who would not give it to them.
 */
export interface RefusedWork {
  readonly name: string
  readonly work: string
  readonly doneBy: NamedRole | null
  readonly gets: ReadonlySet<OrganizationType>
}

/** The Laboratory's work list and results: a laboratory gets the Laboratory workspace, a hospital or clinic its work list. */
export const LAB_WORK: RefusedWork = {
  name: 'Laboratory', work: 'the lab’s work list and results', doneBy: 'lab', gets: new Set(['laboratory', 'hospital', 'clinic']),
}

/**
 * Pharmacy's work: a pharmacy gets the Pharmacy workspace, a hospital or clinic its work list; a laboratory, or another
 * kind, is never promised it. The classic Pharmacy page says this; the blue Pharmacy names the work it refuses more
 * closely ("prescriptions", "dispensing medicines": ehr-blue/departments/pharmacy/pharmacyText.ts), by the same rule.
 */
export const PHARMACY_WORK: RefusedWork = {
  name: 'Pharmacy', work: 'pharmacy work', doneBy: 'pharmacist', gets: new Set(['pharmacy', 'hospital', 'clinic']),
}

/**
 * Outreach: its campaigns, and the people registered in the field, in the words the page itself uses ("People
 * registered in the field"). Every kind of facility has it from the day it signs up: its administrator holds it while
 * Health ID support checks the facility (org_admin_awaiting_review) and after (org_admin), and no locked list names it.
 */
export const OUTREACH_WORK: RefusedWork = {
  name: 'Outreach', work: 'outreach campaigns or registering people in the field', doneBy: null, gets: new Set(),
}

/**
 * Reviewing the facility's audit events: every product keeps the page (ehr-blue/frame/product.ts SHARED), and every kind
 * of facility has it from the day it signs up: its administrator holds it while Health ID support checks the facility
 * and after, and no locked list names it.
 */
export const AUDIT_WORK: RefusedWork = {
  name: 'Audit', work: 'reviewing audit events', doneBy: null, gets: new Set(),
}

/**
 * What a role without `refused` work reads at its facility, by who reads it: the one rule the Pharmacy's, Laboratory's,
 * Outreach's and Audit's refusals follow, in the blue EHR and the classic portal alike, so both say the same. The
 * administrator of a facility that signed itself up (the only role there that manages staff) is never told to ask the
 * facility administrator, which they are. While Health ID support checks a facility that will get the work, it is locked
 * for them too (the banner above says so): it opens after the check. Once the facility is checked, they add the staff who
 * do it on the Staff page. A facility that will not get it, or work every kind has from the start, has no step. Everyone
 * else, and every facility Health ID support manages, is told to ask the facility administrator.
 */
export function refusedWorkText(facility: Pick<Facility, 'selfService'> | undefined, permissions: readonly string[], refused: RefusedWork): string {
  const review = usesNovuBackend() ? selfServiceReview(facility) : null
  const type = selfServiceType(facility)
  const getsIt = type !== null && refused.gets.has(type)
  if (review === 'pending' && getsIt) return `${refused.name} opens once Health ID support has checked your facility.`
  const administrator = review !== null && permissions.includes('workforce.manage')
  const next = !administrator ? ' Ask your facility administrator.'
    : review === 'reviewed' && getsIt && refused.doneBy !== null ? ` Add ${roleInSentence(refused.doneBy)} on the Staff page.` : ''
  return `Your role at this facility doesn’t include ${refused.work}.${next}`
}
