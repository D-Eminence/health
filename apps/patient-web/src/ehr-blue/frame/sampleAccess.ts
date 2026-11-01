import type { StaffSession } from '../../staff/api'
import { useStaff } from '../../staff/App'
import { isDemoFacility } from '../blueFacilities'
import { basePath } from './pageHref'
import { useRoleView, type DemoRole } from './roleView'
import type { EhrBluePage } from './types'

/**
 * Who may open a sample workspace, and do what in it: the design's role mapping (design/ehr-target src/catalog.ts
 * permissions(role)), not Health ID's. A sample sends nothing and saves nothing, so no live permission guards it; this
 * only keeps each role's sidebar and actions the design's. Live and partial pages keep their live permission check.
 */

const CLINICAL = [
  'patients', 'appointments', 'journey', 'triage', 'consult', 'inpatient', 'wards', 'nursing', 'emergency', 'maternity',
  'surgery', 'icu', 'dental', 'referrals', 'telemedicine', 'consent',
]
const ADMINISTRATION = ['services', 'ward-config', 'vehicles', 'shifts', 'hr', 'quality', 'inventory', 'procurement', 'ambulance']
const MANAGE = ['view', 'create', 'edit', 'assign', 'approve', 'export']

/** The design's grants for one role, as `module.verb` (design src/catalog.ts permissions(role), line for line). */
export function designGrants(role: DemoRole): ReadonlySet<string> {
  const p = new Set<string>(['dashboard.view', 'notifications.view', 'profile.view'])
  const grant = (ids: readonly string[], actions: readonly string[]) => ids.forEach(id => actions.forEach(action => p.add(`${id}.${action}`)))
  const is = (...roles: DemoRole[]) => roles.includes(role)
  if (is('Nurse', 'Doctor', 'Consultant', 'Medical Director')) grant(['nursing-tasks'], ['view', 'create', 'edit', 'assign'])
  if (is('Hospital Owner', 'Hospital Admin', 'Billing Officer')) grant(['subscription'], ['view', 'edit'])
  if (is('Hospital Owner', 'Hospital Admin')) grant(['facility'], ['view', 'edit'])
  if (role === 'Platform Super Admin') {
    grant(['platform', 'staff', 'setup', 'audit'], MANAGE)
    return p
  }
  if (is('Hospital Owner', 'Hospital Admin')) {
    grant(['setup', 'staff', 'reports', 'audit', ...ADMINISTRATION], MANAGE)
    grant(['billing', 'insurance', 'policies'], role === 'Hospital Owner' ? [...MANAGE, 'refund', 'collect-payment'] : ['view'])
  }
  if (is('Doctor', 'Consultant', 'Medical Director')) {
    grant(CLINICAL, ['view', 'create', 'edit', 'assign', 'sign', 'export', 'request-external', 'emergency'])
    grant(['lab', 'radiology', 'pharmacy'], ['view', 'create'])
    grant(['quality'], MANAGE)
  }
  if (role === 'Medical Director') {
    grant(['referrals'], ['approve'])
    grant(['audit', 'reports', 'staff', 'hr'], ['view', 'approve', 'export'])
    grant(['radiology'], ['approve', 'publish'])
  }
  if (role === 'Nurse') {
    grant(['patients', 'appointments', 'journey'], ['view'])
    grant(['triage', 'nursing', 'inpatient', 'wards', 'icu', 'maternity'], ['view', 'create', 'edit', 'assign'])
  }
  if (role === 'Receptionist') grant(['patients', 'appointments', 'journey'], ['view', 'create', 'edit', 'assign'])
  if (role === 'Records Officer') {
    grant(['patients'], MANAGE)
    grant(['audit', 'reports'], ['view', 'export'])
  }
  if (is('Lab Scientist', 'Lab Manager')) {
    grant(['lab'], ['view', 'collect', 'process', 'edit'])
    grant(['bloodbank'], ['view', 'create', 'edit'])
    grant(['inventory'], ['view'])
    if (role === 'Lab Manager') {
      grant(['lab'], ['approve', 'publish'])
      grant(['bloodbank'], ['approve', 'assign', 'publish'])
      grant(['inventory', 'procurement'], MANAGE)
    }
  }
  if (role === 'Radiology Reporter') grant(['radiology'], ['view', 'edit', 'approve', 'publish'])
  if (is('Pharmacist', 'Pharmacy Manager')) {
    grant(['pharmacy'], ['view', 'edit', 'dispense'])
    grant(['inventory'], ['view'])
    if (role === 'Pharmacy Manager') {
      grant(['pharmacy'], ['controlled'])
      grant(['inventory', 'procurement'], MANAGE)
    }
  }
  if (role === 'Billing Officer') {
    grant(['billing', 'insurance', 'policies'], MANAGE)
    grant(['reports'], ['view', 'export'])
  }
  if (role === 'Cashier') {
    grant(['billing'], ['view', 'collect-payment'])
    grant(['insurance'], ['view', 'collect-payment'])
    grant(['reports'], ['view'])
  }
  return p
}

/** The design role each of Health ID's staff roles works as. A role not named here opens no sample workspace. */
const DESIGN_ROLE_OF: Readonly<Record<string, DemoRole>> = {
  org_admin: 'Hospital Admin',
  doctor: 'Doctor',
  clinician: 'Doctor',
  nurse: 'Nurse',
  lab: 'Lab Scientist',
  pharmacist: 'Pharmacist',
  receptionist: 'Receptionist',
  records_officer: 'Records Officer',
  billing: 'Billing Officer',
}

/**
 * The design roles a session works as: the demo role whose Home is being viewed (useRoleView, at a demo facility only,
 * as Home shows it), else each of the person's roles at the working facility, as the design names it.
 */
export function designRolesOf(session: StaffSession | null, viewing: DemoRole | null): readonly DemoRole[] {
  if (viewing && isDemoFacility(session?.actor.facility?.id)) return [viewing]
  const roles = session?.actor.facility?.roles ?? session?.actor.roles ?? []
  return [...new Set(roles.flatMap(role => DESIGN_ROLE_OF[role] ?? []))]
}

/** Whether any of these design roles may do `verb` in a design module ('billing', 'inventory', 'dashboard'…). */
export function sampleCan(roles: readonly DemoRole[], moduleId: string, verb = 'view'): boolean {
  return roles.some(role => designGrants(role).has(`${moduleId}.${verb}`))
}

/** The design's modules: its workspaces (src/catalog.ts allModules) and its other sidebar pages (src/navigation.ts). */
const DESIGN_MODULES: ReadonlySet<string> = new Set([
  ...CLINICAL, ...ADMINISTRATION, 'lab', 'radiology', 'pharmacy', 'billing', 'insurance', 'policies', 'bloodbank', 'nursing-tasks',
  'dashboard', 'platform', 'staff', 'reports', 'audit', 'facility', 'setup', 'subscription',
])

/** The frame's addresses that are not the design's module ids; every other page's address is its module id. */
const MODULE_OF_PATH: Readonly<Record<string, string>> = {
  '': 'dashboard', 'patient-billing': 'billing', supply: 'inventory', clinical: 'consult', requests: 'consent',
  laboratory: 'lab', billing: 'subscription',
}

/** The design module a page is, or null for a page the design has no module for (the Design tour). */
export function moduleOf(page: EhrBluePage): string | null {
  const base = basePath(page.path)
  const id = MODULE_OF_PATH[base] ?? base
  return DESIGN_MODULES.has(id) ? id : null
}

/** Whether a sample page is open to these design roles: a page the design has no module for is open to all. */
export function samplePageOpen(page: EhrBluePage, roles: readonly DemoRole[]): boolean {
  const id = moduleOf(page)
  return id === null || sampleCan(roles, id)
}

/**
 * The design's check for actions on a sample page (Create record, Continue care, history rows): whether the signed-in
 * person, or the demo role whose Home is being viewed, may do `verb` in `moduleId`.
 */
export function useSampleCan(): (moduleId: string, verb?: string) => boolean {
  const { state } = useStaff()
  const { viewing } = useRoleView()
  const roles = designRolesOf(state.status === 'ready' ? state.session : null, viewing)
  return (moduleId, verb = 'view') => sampleCan(roles, moduleId, verb)
}
