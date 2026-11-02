import { usesNovuBackend } from '../backendContract'
import type { Facility } from './api'
import { roleInSentence, roleLabel, selfServiceReview, selfServiceType, type OrganizationType } from './staffAccess'

/**
 * The staff roles ROLE_LABELS (staffAccess.ts) names, the administrator's apart. A refusal names the role that does the
 * work by those words, and roleInSentence shows a code it has no words for as the code, which no screen may show: so only
 * these can be named. Add a role here once ROLE_LABELS names it, and to refusedWork.test.ts, which checks each has words.
 */
export type NamedRole = 'doctor' | 'clinician' | 'nurse' | 'lab' | 'pharmacist' | 'receptionist' | 'records_officer' | 'billing'
  | 'outreach_officer'

/**
 * Work a role may not hold at a facility, as its refusal names it: the department (`name`), the `work` the role doesn't
 * include, the roles whose holders do that work (at least one, as the administrator's step names them), and the kinds of
 * self-signed-up facility that get it once Health ID support has checked them, the ones whose locked list names it
 * (staff/routes/ReviewBanner.tsx LOCKED). A facility of another kind is never promised it. With `askForRole`, everyone
 * else is told which of those roles to ask the administrator for, where one would bring the work; without it, they are
 * only told to ask, as the Laboratory's refusal has always said.
 */
export interface RefusedWork {
  readonly name: string
  readonly work: string
  readonly doneBy: readonly [NamedRole, ...NamedRole[]]
  readonly askForRole?: boolean
  readonly gets: ReadonlySet<OrganizationType>
}

/** The Laboratory's work list and results: a laboratory gets the Laboratory workspace, a hospital or clinic its work list. */
export const LAB_WORK: RefusedWork = {
  name: 'Laboratory', work: 'the lab’s work list and results', doneBy: ['lab'], gets: new Set(['laboratory', 'hospital', 'clinic']),
}

/** Any one of the roles, in a sentence: "a doctor", "a receptionist or a records officer", "a, b or c". */
function eitherOf(words: readonly string[]): string {
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}` : words.join('')
}

/**
 * What a role without `refused` work reads at its facility, by who reads it: the rule the blue Pharmacy's refusal follows
 * (ehr-blue/departments/pharmacy/page.tsx), so the classic portal and the blue EHR say the same. The administrator of a
 * facility that signed itself up (the only role there that manages staff) is never told to ask the facility
 * administrator, which they are. While Health ID support checks a facility that will get the work, it is locked for them
 * too (the banner above says so): it opens after the check. Once the facility is checked, they add the staff who do it on
 * the Staff page. A facility that will not get it has no step. Everyone else, and every facility Health ID support
 * manages, is told to ask the facility administrator. With `askForRole`, they are told to ask for one of the roles that
 * do the work, unless that could not help: at a facility that will not get it, the role would not bring it, and someone
 * who holds one of those roles already (a facility's own grants can differ) would be asking for what they have.
 */
export function refusedWorkText(facility: Pick<Facility, 'selfService' | 'roles'> | undefined, permissions: readonly string[], refused: RefusedWork): string {
  const review = usesNovuBackend() ? selfServiceReview(facility) : null
  const type = selfServiceType(facility)
  const getsIt = type !== null && refused.gets.has(type)
  if (review === 'pending' && getsIt) return `${refused.name} opens once Health ID support has checked your facility.`
  const administrator = review !== null && permissions.includes('workforce.manage')
  // A role brings the work where the facility gets it or its kind is not known (Health ID support manages it, or there
  // is none), and only to someone who holds none of those roles yet.
  const held = facility?.roles ?? []
  const helps = (type === null || getsIt) && !refused.doneBy.some(role => held.includes(role))
  // The roles by their words in the role list ("the Receptionist or Records officer role"), so the sentence follows it.
  const ask = refused.askForRole && helps ? ` for the ${eitherOf(refused.doneBy.map(roleLabel))} role` : ''
  const next = !administrator ? ` Ask your facility administrator${ask}.`
    : review === 'reviewed' && getsIt ? ` Add ${eitherOf(refused.doneBy.map(roleInSentence))} on the Staff page.` : ''
  return `Your role at this facility doesn’t include ${refused.work}.${next}`
}
