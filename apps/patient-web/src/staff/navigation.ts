import type { Facility, StaffSession } from './api'
import { facilityChoiceNeeded } from './facilitySelection'
import { usesNovuBackend } from '../backendContract'

/**
 * The provider workspace's sidebar, in order: each page with the permission the
 * working facility must hold for the page to be listed (none for the Overview).
 * The In-person check's is routes/InPersonCheck's ASSISTED_REGISTRATION_PERMISSION
 * (a test keeps them equal; this module imports no page). A `selfServiceOnly`
 * page is listed only at a facility that signed itself up (Novu, P4b): governed
 * facilities' administrators also hold workforce.manage, and Health ID support
 * manages their staff.
 */
export const PROVIDER_NAVIGATION: ReadonlyArray<{ to: string; label: string; permission: string; selfServiceOnly?: boolean }> = [
  { to: '/provider', label: 'Overview', permission: '' },
  { to: '/provider/patients', label: 'Patient access', permission: 'identity.patient.read' },
  { to: '/provider/registration', label: 'Patient registration', permission: 'identity.registration.write' },
  // Facility-assisted registration (hid-system #85, ADR-063): doctors, clinicians and nurses.
  { to: '/provider/in-person-check', label: 'In-person check', permission: 'identity.patient.assisted_registration' },
  { to: '/provider/requests', label: 'Access requests', permission: 'identity.consent.write' },
  { to: '/provider/audit', label: 'Facility audit', permission: 'audit.read' },
  // A self-signed-up facility's staff and invitations (Novu, P4b).
  { to: '/provider/staff', label: 'Staff', permission: 'workforce.manage', selfServiceOnly: true },
  { to: '/provider/clinical', label: 'Clinical record', permission: 'ehr.encounter.read' },
  { to: '/provider/laboratory', label: 'Laboratory', permission: 'lab.work-item.read' },
  { to: '/provider/pharmacy', label: 'Pharmacy', permission: 'pharmacy.work-item.read' },
  { to: '/provider/ocr', label: 'Document OCR', permission: 'ocr.job.read' },
  { to: '/provider/outreach', label: 'Outreach', permission: 'outreach.registration.read' },
  { to: '/provider/billing', label: 'Plan & billing', permission: 'billing.subscription.read' },
]

/**
 * The sidebar for the working facility: the pages its permissions open, and a self-signed-up facility's own pages only
 * there, and only on Novu (main has neither the field nor the pages).
 */
export function visibleNavigation(facility: Pick<Facility, 'permissions' | 'selfService'> | undefined) {
  const permissions = facility?.permissions ?? []
  return PROVIDER_NAVIGATION.filter(item => (!item.permission || permissions.includes(item.permission))
    && (!item.selfServiceOnly || (usesNovuBackend() && Boolean(facility?.selfService))))
}

/**
 * The page a staff sign-in opens instead of `wanted` (the product host's own
 * page): `wanted`, or the Overview when the working facility lacks the
 * permission that page needs in the sidebar. A facility administrator who
 * signed the facility up (org_admin on Novu) holds no ehr.encounter.read, so the
 * EHR site's Clinical record would only say "Choose a patient first" and link
 * to Patient access, which they cannot use either (P4). While the working
 * facility is still to be chosen, or not reported, its permissions are not
 * known, and the page asked for is kept.
 */
export function staffLandingPath(wanted: string, session: StaffSession): string {
  const facility = session.actor.facility
  if (!facility || facilityChoiceNeeded(session)) return wanted
  const page = PROVIDER_NAVIGATION.find(item => item.to === wanted)
  return !page?.permission || facility.permissions.includes(page.permission) ? wanted : '/provider'
}
