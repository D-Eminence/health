/**
 * The design's role templates and their permission scopes, shown read-only on the Roles step as a sample: the design's
 * words, not Health ID's roles. Health ID's own roles are the ones Staff & access offers below them. Ported from
 * design/ehr-target src/model.ts:122-139 (roles, less Platform Super Admin, as src/admin.tsx:655 leaves it out) and
 * src/catalog.ts:1320-1442 (clinical, administration and permissions()), unchanged but for the types.
 */

export const ROLE_TEMPLATES = ['Hospital Owner', 'Medical Director', 'Hospital Admin', 'Consultant', 'Doctor', 'Nurse',
  'Receptionist', 'Records Officer', 'Lab Manager', 'Lab Scientist', 'Pharmacy Manager', 'Pharmacist', 'Billing Officer',
  'Cashier', 'Radiology Reporter'] as const

export type RoleTemplate = (typeof ROLE_TEMPLATES)[number]

const CLINICAL = ['patients', 'appointments', 'journey', 'triage', 'consult', 'inpatient', 'wards', 'nursing', 'emergency',
  'maternity', 'surgery', 'icu', 'dental', 'referrals', 'telemedicine', 'consent']

const ADMINISTRATION = ['services', 'ward-config', 'vehicles', 'shifts', 'hr', 'quality', 'inventory', 'procurement', 'ambulance']

/** The design's permission scopes of a role template, in its order. */
export function templateScopes(role: RoleTemplate): string[] {
  const p = new Set<string>(['dashboard.view', 'notifications.view', 'profile.view'])
  const grant = (ids: readonly string[], actions: readonly string[]) => ids.forEach(k => actions.forEach(a => p.add(`${k}.${a}`)))
  const is = (...roles: readonly RoleTemplate[]) => roles.includes(role)
  if (is('Nurse', 'Doctor', 'Consultant', 'Medical Director')) grant(['nursing-tasks'], ['view', 'create', 'edit', 'assign'])
  const manage = ['view', 'create', 'edit', 'assign', 'approve', 'export']
  if (is('Hospital Owner', 'Hospital Admin', 'Billing Officer')) grant(['subscription'], ['view', 'edit'])
  if (is('Hospital Owner', 'Hospital Admin')) grant(['facility'], ['view', 'edit'])
  if (is('Hospital Owner', 'Hospital Admin')) {
    grant(['setup', 'staff', 'reports', 'audit', ...ADMINISTRATION], manage)
    grant(['billing', 'insurance', 'policies'], role === 'Hospital Owner' ? [...manage, 'refund', 'collect-payment'] : ['view'])
  }
  if (is('Doctor', 'Consultant', 'Medical Director')) {
    grant(CLINICAL, ['view', 'create', 'edit', 'assign', 'sign', 'export', 'request-external', 'emergency'])
    grant(['lab', 'radiology', 'pharmacy'], ['view', 'create'])
    grant(['quality'], manage)
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
    grant(['patients'], manage)
    grant(['audit', 'reports'], ['view', 'export'])
  }
  if (is('Lab Scientist', 'Lab Manager')) {
    grant(['lab'], ['view', 'collect', 'process', 'edit'])
    grant(['bloodbank'], ['view', 'create', 'edit'])
    grant(['inventory'], ['view'])
    if (role === 'Lab Manager') {
      grant(['lab'], ['approve', 'publish'])
      grant(['bloodbank'], ['approve', 'assign', 'publish'])
      grant(['inventory', 'procurement'], manage)
    }
  }
  if (role === 'Radiology Reporter') grant(['radiology'], ['view', 'edit', 'approve', 'publish'])
  if (is('Pharmacist', 'Pharmacy Manager')) {
    grant(['pharmacy'], ['view', 'edit', 'dispense'])
    grant(['inventory'], ['view'])
    if (role === 'Pharmacy Manager') {
      grant(['pharmacy'], ['controlled'])
      grant(['inventory', 'procurement'], manage)
    }
  }
  if (role === 'Billing Officer') {
    grant(['billing', 'insurance', 'policies'], manage)
    grant(['reports'], ['view', 'export'])
  }
  if (role === 'Cashier') {
    grant(['billing'], ['view', 'collect-payment'])
    grant(['insurance'], ['view', 'collect-payment'])
    grant(['reports'], ['view'])
  }
  return [...p]
}
