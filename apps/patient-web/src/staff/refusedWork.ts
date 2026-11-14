import { usesNovuBackend } from '../backendContract'
import { pointOfCareOpen } from '../ehr-blue/departments/commerce/served'
import type { Facility } from './api'
import { roleInSentence, roleLabel, selfServiceReview, selfServiceType, type OrganizationType } from './staffAccess'

/**
 * The staff roles ROLE_LABELS (staffAccess.ts) names, the administrator's apart. A refusal names the role that does the
 * work by those words, and roleInSentence says "a staff member" for a code it has no words for, which would tell an
 * administrator to add nobody in particular: so only these can be named. Add a role here once ROLE_LABELS names it, and
 * to refusedWork.test.ts, which checks each has words.
 */
export type NamedRole = 'doctor' | 'clinician' | 'nurse' | 'lab' | 'pharmacist' | 'receptionist' | 'records_officer' | 'billing'
  | 'outreach_officer'

/**
 * Work a role may not hold at a facility, as its refusal names it: the department (`name`), the `work` the role doesn't
 * include, the roles whose holders do that work (at least one, as the administrator's step names them), and the kinds of
 * self-signed-up facility that get it once Health ID support has checked them, the ones whose locked list names it
 * (staff/routes/ReviewBanner.tsx LOCKED). A facility of another kind is never promised it. With `askForRole`, everyone
 * else is told which of those roles to ask the administrator for, where one would bring the work; without it, they are
 * only told to ask, as the Laboratory's refusal has always said. When no locked list names the work, no kind waits for
 * the check to get it (`gets` is empty), so it has no Staff step and no role to name (`doneBy` is null): the
 * administrator is never told it opens after the check, nor to add someone, and nobody is told to ask for a role.
 */
export interface RefusedWork {
  readonly name: string
  readonly work: string
  readonly doneBy: readonly [NamedRole, ...NamedRole[]] | null
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
 * Pharmacy's work: a pharmacy gets the Pharmacy workspace, a hospital or clinic its work list; a laboratory, or another
 * kind, is never promised it. The classic page's refusal of Prescriptions names it by pharmacyWorkFor, the blue
 * Prescriptions' by the pages that open at the facility (ehr-blue/departments/pharmacy/page.tsx), which come to the
 * same; the blue Pharmacy names a refused dispensing more closely ("dispensing medicines":
 * ehr-blue/departments/pharmacy/pharmacyText.ts), by the same rule.
 */
export const PHARMACY_WORK: RefusedWork = {
  name: 'Pharmacy', work: 'pharmacy work', doneBy: ['pharmacist'], gets: new Set(['pharmacy', 'hospital', 'clinic']),
}

/**
 * The permissions of the blue Pharmacy's pages besides Prescriptions (Sell, Sales & receipts, Stock, Products & prices,
 * Till / End of day, Payment setup: ehr-blue/departments/pharmacy/page.tsx, whose test keeps the two the same, and keeps
 * each of those pages shown only where the point-of-care pages open), written out here so the classic portal words its
 * refusal as the blue one does without loading the blue pages.
 */
export const OTHER_PHARMACY_PAGE_PERMISSIONS: readonly string[] = ['pharmacy.walk-in.create', 'billing.bill.read',
  'pharmacy.stock.read', 'billing.catalogue.read', 'billing.shift.own', 'billing.settings.manage']

/**
 * Pharmacy's work as the classic page's refusal of Prescriptions names it, as the blue Prescriptions' does: a role that
 * may open another Pharmacy page at this facility (it sells, keeps stock or takes payment) does pharmacy work, so it is
 * told only that prescriptions are not in it. Those pages open only where the point-of-care pages do
 * (ehr-blue/departments/commerce/served.ts pointOfCareOpen, the demo facilities until Health ID serves their routes):
 * anywhere else no Pharmacy page is in the role, so a seller there is told their role doesn't include pharmacy work.
 */
export function pharmacyWorkFor(permissions: readonly string[], facilityId: string | null | undefined): RefusedWork {
  return pointOfCareOpen(facilityId) && permissions.some(permission => OTHER_PHARMACY_PAGE_PERMISSIONS.includes(permission))
    ? { ...PHARMACY_WORK, work: 'prescriptions' } : PHARMACY_WORK
}

/**
 * What Outreach says to a role without campaign or registration read, in the blue page and at its address and on the
 * classic page alike: one sentence for everyone, as Document OCR's is (ehr-blue/departments/migrate/Migrate.tsx
 * NO_DOCUMENT_OCR), not refusedWorkText's choice by who reads it (the owner's answer of 2 November). On hid-system main
 * no role has held any Outreach permission since migration 0091 (docs/ARCHITECTURE.md), so a facility administrator
 * could not give it, and nobody is told to ask anyone. On Novu a self-signed-up facility's administrator does hold
 * Outreach (P4b SPEC 3.3), so their staff without it read this sentence too while the administrator uses Outreach: the
 * owner chose one sentence for everyone. Written here so the classic portal says it without loading the blue pages.
 */
export const NO_OUTREACH = 'Outreach isn’t available at your facility yet.'

/**
 * Reviewing the facility's audit events: every product keeps the page (ehr-blue/frame/product.ts SHARED), and no locked
 * list names it, so no kind gets it only after the check, and no role is named. The administrator holds it (org_admin;
 * on Novu also while Health ID support checks the facility, P4b SPEC 3.3), so their words here are for an administrator
 * role without it.
 */
export const AUDIT_WORK: RefusedWork = {
  name: 'Audit', work: 'reviewing audit events', doneBy: null, gets: new Set(),
}

/**
 * What a role without `refused` work reads at its facility, by who reads it: the one rule the Pharmacy's, Laboratory's,
 * Patient registration's and Audit's refusals follow, in the blue EHR and the classic portal alike, so both say the same.
 * The administrator of a facility that signed itself up (the only role there that manages staff) is never told to ask
 * the facility administrator, which they are. While Health ID support checks a facility that will get the work, it is
 * locked for them too (the banner above says so): it opens after the check. Once the facility is checked, they add the
 * staff who do it on the Staff page. A facility that will not get it, or work every kind has from the start, has no
 * step. Everyone else, and every facility Health ID support manages, is told to ask the facility administrator. With
 * `askForRole`, they are told to ask for one of the roles that do the work, unless that could not help: at a facility
 * that will not get it, the role would not bring it, and someone who holds one of those roles already (a facility's own
 * grants can differ) would be asking for what they have.
 */
export function refusedWorkText(facility: Pick<Facility, 'selfService' | 'roles'> | undefined, permissions: readonly string[], refused: RefusedWork): string {
  const review = usesNovuBackend() ? selfServiceReview(facility) : null
  const type = selfServiceType(facility)
  const getsIt = type !== null && refused.gets.has(type)
  if (review === 'pending' && getsIt) return `${refused.name} opens once Health ID support has checked your facility.`
  const administrator = review !== null && permissions.includes('workforce.manage')
  // Work with no role to name (doneBy null) has no Staff step and is never asked for by role.
  const roles: readonly NamedRole[] = refused.doneBy ?? []
  // A role brings the work where the facility gets it or its kind is not known (Health ID support manages it, or there
  // is none), and only to someone who holds none of those roles yet.
  const held = facility?.roles ?? []
  const helps = roles.length > 0 && (type === null || getsIt) && !roles.some(role => held.includes(role))
  // The roles by their words in the role list ("the Receptionist or Records officer role"), so the sentence follows it.
  const ask = refused.askForRole && helps ? ` for the ${eitherOf(roles.map(roleLabel))} role` : ''
  const next = !administrator ? ` Ask your facility administrator${ask}.`
    : review === 'reviewed' && getsIt && roles.length > 0 ? ` Add ${eitherOf(roles.map(roleInSentence))} on the Staff page.` : ''
  return `Your role at this facility doesn’t include ${refused.work}.${next}`
}
