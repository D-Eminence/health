import { usesNovuBackend } from '../backendContract'
import type { Facility } from './api'
import { roleInSentence, selfServiceReview, selfServiceType, type OrganizationType } from './staffAccess'

/**
 * The staff roles ROLE_LABELS (staffAccess.ts) names, the administrator's apart. A refusal names the role that does the
 * work by those words, and roleInSentence says "a staff member" for a code it has no words for, which would tell an
 * administrator to add nobody in particular: so only these can be named. Add a role here once ROLE_LABELS names it, and
 * to refusedWork.test.ts, which checks each has words.
 */
export type NamedRole = 'doctor' | 'clinician' | 'nurse' | 'lab' | 'pharmacist' | 'receptionist'

/**
 * Work a role may not hold at a facility, as its refusal names it: the department (`name`), the `work` the role doesn't
 * include, the role whose holders do that work, and the kinds of self-signed-up facility that get it once Health ID
 * support has checked them, the ones whose locked list names it (staff/routes/ReviewBanner.tsx LOCKED). A facility of
 * another kind is never promised it. When no locked list names the work, no kind waits for the check to get it (`gets`
 * is empty), so it has no Staff step and no role to name (`doneBy` is null): the administrator is never told it opens
 * after the check, nor to add someone.
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
 * kind, is never promised it. A refusal of Prescriptions names it by pharmacyWorkFor; the blue Pharmacy names a refused
 * dispensing more closely ("dispensing medicines": ehr-blue/departments/pharmacy/pharmacyText.ts), by the same rule.
 */
export const PHARMACY_WORK: RefusedWork = {
  name: 'Pharmacy', work: 'pharmacy work', doneBy: 'pharmacist', gets: new Set(['pharmacy', 'hospital', 'clinic']),
}

/**
 * The permissions of the blue Pharmacy's pages besides Prescriptions (Sell, Sales & receipts, Stock, Products & prices,
 * Till / End of day, Payment setup: ehr-blue/departments/pharmacy/page.tsx, whose test keeps the two the same), written
 * out here so the classic portal words its refusal as the blue one does without loading the blue pages.
 */
export const OTHER_PHARMACY_PAGE_PERMISSIONS: readonly string[] = ['pharmacy.walk-in.create', 'billing.bill.read',
  'pharmacy.stock.read', 'billing.catalogue.read', 'billing.shift.own', 'billing.settings.manage']

/**
 * Pharmacy's work as a refusal of Prescriptions names it, in the blue Pharmacy and the classic page alike: a role that
 * may open another Pharmacy page (it sells, keeps stock or takes payment) does pharmacy work, so it is told only that
 * prescriptions are not in it.
 */
export function pharmacyWorkFor(permissions: readonly string[]): RefusedWork {
  return permissions.some(permission => OTHER_PHARMACY_PAGE_PERMISSIONS.includes(permission))
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
 * What a role without `refused` work reads at its facility, by who reads it: the one rule the Pharmacy's, Laboratory's
 * and Audit's refusals follow, in the blue EHR and the classic portal alike, so both say the same. The
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
