import { usesNovuBackend } from '../backendContract'
import type { Facility } from './api'
import { roleInSentence, selfServiceReview, selfServiceType, type OrganizationType } from './staffAccess'

/**
 * The staff roles ROLE_LABELS (staffAccess.ts) names, the administrator's apart. A refusal names the role that does the
 * work by those words, and roleInSentence shows a code it has no words for as the code, which no screen may show: so only
 * these can be named. Add a role here once ROLE_LABELS names it, and to refusedWork.test.ts, which checks each has words.
 */
export type NamedRole = 'doctor' | 'clinician' | 'nurse' | 'lab' | 'pharmacist' | 'receptionist'

/**
 * Work a role may not hold at a facility, as its refusal names it: the department (`name`), the `work` the role doesn't
 * include, the role whose holders do that work, and the kinds of self-signed-up facility that get it once Health ID
 * support has checked them, the ones whose locked list names it (staff/routes/ReviewBanner.tsx LOCKED). A facility of
 * another kind is never promised it.
 */
export interface RefusedWork {
  readonly name: string
  readonly work: string
  readonly doneBy: NamedRole
  readonly gets: ReadonlySet<OrganizationType>
}

/** The Laboratory's work list and results: a laboratory gets the Laboratory workspace, a hospital or clinic its work list. */
export const LAB_WORK: RefusedWork = {
  name: 'Laboratory', work: 'the lab’s work list and results', doneBy: 'lab', gets: new Set(['laboratory', 'hospital', 'clinic']),
}

/**
 * What a role without `refused` work reads at its facility, by who reads it: the rule the blue Pharmacy's refusal follows
 * (ehr-blue/departments/pharmacy/page.tsx), so the classic portal and the blue EHR say the same. The administrator of a
 * facility that signed itself up (the only role there that manages staff) is never told to ask the facility
 * administrator, which they are. While Health ID support checks a facility that will get the work, it is locked for them
 * too (the banner above says so): it opens after the check. Once the facility is checked, they add the staff who do it on
 * the Staff page. A facility that will not get it has no step. Everyone else, and every facility Health ID support
 * manages, is told to ask the facility administrator.
 */
export function refusedWorkText(facility: Pick<Facility, 'selfService'> | undefined, permissions: readonly string[], refused: RefusedWork): string {
  const review = usesNovuBackend() ? selfServiceReview(facility) : null
  const type = selfServiceType(facility)
  const getsIt = type !== null && refused.gets.has(type)
  if (review === 'pending' && getsIt) return `${refused.name} opens once Health ID support has checked your facility.`
  const administrator = review !== null && permissions.includes('workforce.manage')
  const next = !administrator ? ' Ask your facility administrator.'
    : review === 'reviewed' && getsIt ? ` Add ${roleInSentence(refused.doneBy)} on the Staff page.` : ''
  return `Your role at this facility doesn’t include ${refused.work}.${next}`
}
