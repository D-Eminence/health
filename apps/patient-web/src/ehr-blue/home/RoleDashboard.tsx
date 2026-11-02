import { useState, useSyncExternalStore, type ReactElement } from 'react'
import { EhrBackButton, EhrButton, EhrCard, EhrPageHeading, EhrSampleBanner } from '@hid/ui/ehr'
import { useBluePages, useOpenPages } from '../frame/pageContext'
import { basePath, pageHrefOf } from '../frame/pageHref'
import { useRoleView, type DemoRole } from '../frame/roleView'
import { sampleModule, sampleRecords, sampleVersion, subscribeSamples } from '../frame/sample/store'
import {
  CustomizeShortcuts, FacilityReviewCard, Figure, NO_ATTENTION, NOTHING_TODAY, PatientBillingCard, PeopleCard, PinnedShortcuts,
  ReportingPeriod, SAMPLE_STAFF_COUNT, SampleWorklist, type WorklistRow,
} from './dashboardCards'

/**
 * Each demo role's dashboard (design: screens/roles, src/dashboard.tsx), as a sample: the cards the design gives the
 * role, counted and listed from the in-memory sample records, so creating a sample record shows here. Nothing is read
 * from Health ID. The way back to the person's own Home is "My own dashboard", with the demo's other controls.
 */

/** The workspaces each role's Needs attention and Today draw from (the design's permissions(role)). */
const ROLE_MODULES: Record<DemoRole, readonly string[]> = {
  'Platform Super Admin': [],
  'Hospital Owner': ['billing', 'insurance', 'ambulance', 'shifts', 'hr', 'quality', 'procurement'],
  'Medical Director': ['patients', 'appointments', 'journey', 'consult', 'lab', 'radiology', 'referrals', 'quality'],
  'Hospital Admin': ['insurance', 'ambulance', 'shifts', 'hr', 'quality', 'services', 'ward-config', 'inventory', 'procurement'],
  Consultant: ['patients', 'appointments', 'journey', 'triage', 'consult', 'lab', 'referrals'],
  Doctor: ['patients', 'appointments', 'journey', 'triage', 'consult', 'lab', 'referrals'],
  Nurse: ['patients', 'triage', 'nursing', 'nursing-tasks', 'inpatient', 'wards'],
  Receptionist: ['patients', 'appointments', 'journey'],
  'Records Officer': ['patients'],
  'Lab Manager': ['lab', 'bloodbank', 'inventory', 'procurement'],
  'Lab Scientist': ['lab', 'bloodbank', 'inventory'],
  'Pharmacy Manager': ['pharmacy', 'inventory', 'procurement'],
  Pharmacist: ['pharmacy', 'inventory'],
  'Billing Officer': ['billing', 'insurance', 'policies'],
  Cashier: ['billing', 'insurance'],
  'Radiology Reporter': ['radiology'],
}

/** Activity in period's workspaces, for a role without Patient billing. */
const CLINICAL_ACTIVITY = ['patients', 'appointments', 'journey', 'triage']
const ACTIVITY: Partial<Record<DemoRole, readonly string[]>> = {
  Doctor: CLINICAL_ACTIVITY, Consultant: CLINICAL_ACTIVITY, 'Medical Director': CLINICAL_ACTIVITY, Nurse: CLINICAL_ACTIVITY,
  Receptionist: ['patients', 'appointments', 'journey'],
  'Records Officer': ['patients'],
  'Lab Manager': ['lab', 'inventory', 'procurement', 'bloodbank'],
  'Lab Scientist': ['lab', 'inventory', 'bloodbank'],
  'Pharmacy Manager': ['pharmacy', 'inventory', 'procurement'],
  Pharmacist: ['pharmacy', 'inventory'],
  'Radiology Reporter': ['radiology'],
}

const BILLING_ROLES: readonly DemoRole[] = ['Hospital Owner', 'Hospital Admin', 'Billing Officer', 'Cashier']
const PEOPLE_ROLES: readonly DemoRole[] = ['Platform Super Admin', 'Hospital Owner', 'Hospital Admin', 'Medical Director']

/** Each role's pinned shortcuts, by the frame's address of the page (the design's dashboard defaults). */
const CARE_SHORTCUTS = ['patients', 'appointments', 'journey', 'triage']
const SHORTCUTS: Record<DemoRole, readonly string[]> = {
  'Platform Super Admin': ['platform', 'staff', 'audit', 'setup'],
  'Hospital Owner': ['patient-billing', 'insurance', 'ambulance', 'shifts'],
  'Hospital Admin': ['patient-billing', 'insurance', 'ambulance', 'shifts'],
  'Medical Director': CARE_SHORTCUTS, Consultant: CARE_SHORTCUTS, Doctor: CARE_SHORTCUTS, Nurse: CARE_SHORTCUTS,
  Receptionist: ['patients', 'appointments', 'journey'],
  'Records Officer': ['patients', 'reports', 'audit'],
  'Lab Manager': ['laboratory', 'bloodbank', 'supply'],
  'Lab Scientist': ['laboratory', 'bloodbank', 'supply'],
  'Pharmacy Manager': ['pharmacy', 'supply'],
  Pharmacist: ['pharmacy', 'supply'],
  'Billing Officer': ['patient-billing', 'insurance', 'reports', 'billing'],
  Cashier: ['patient-billing', 'insurance', 'reports'],
  'Radiology Reporter': ['radiology'],
}

const titleOf = (moduleId: string) => sampleModule(moduleId)?.title ?? moduleId

export function RoleDashboard({ role }: { readonly role: DemoRole }) {
  useSyncExternalStore(subscribeSamples, sampleVersion, sampleVersion)
  const { view } = useRoleView()
  const pages = useBluePages()
  // Shortcuts to pages this session may open: the design checks each one every time it is shown.
  const open = useOpenPages()
  const [period, setPeriod] = useState('7')
  const [customizing, setCustomizing] = useState(false)
  const pathOf = (base: string) => open.find(page => basePath(page.path) === base)?.path
  const [chosen, setChosen] = useState<readonly string[]>(() => SHORTCUTS[role].flatMap(base => pathOf(base) ?? []))
  const modules = ROLE_MODULES[role].filter(id => sampleModule(id) !== undefined)
  // Records are not the patient register's work: Needs attention leaves Patients out (a Records Officer's is empty).
  const attention: WorklistRow[] = modules.filter(id => id !== 'patients')
    .flatMap(id => sampleRecords(id).slice(0, 1).map(record => ({ record, title: titleOf(id) }))).slice(0, 7)
  const today: WorklistRow[] = modules.slice(0, 2)
    .flatMap(id => sampleRecords(id).map(record => ({ record, title: titleOf(id) }))).slice(0, 6)
  const activity = (ACTIVITY[role] ?? []).filter(id => sampleModule(id) !== undefined)

  // The design's cards in its order; the sample notice sits in the first of them.
  const cards: ((notice: boolean) => ReactElement)[] = [
    ...(BILLING_ROLES.includes(role) ? [(notice: boolean) => <PatientBillingCard key="billing" notice={notice} />]
      : activity.length ? [(notice: boolean) => <EhrCard key="activity" title="Activity in period">
        {notice ? <EhrSampleBanner /> : null}
        <div className="hid-ehr-blue-activity">
          {activity.map(id => <Figure key={id} label={`${titleOf(id)} created`} value={sampleRecords(id).length} detail="No comparison yet" />)}
        </div>
      </EhrCard>] : []),
    ...(PEOPLE_ROLES.includes(role) ? [(notice: boolean) => <PeopleCard key="people" count={SAMPLE_STAFF_COUNT} notice={notice} />] : []),
    ...(role === 'Platform Super Admin' ? [(notice: boolean) => <FacilityReviewCard key="review" notice={notice} />] : []),
    (notice: boolean) => <EhrCard key="attention" title="Needs attention">
      {notice ? <EhrSampleBanner /> : null}<SampleWorklist rows={attention} empty={NO_ATTENTION} /></EhrCard>,
    (notice: boolean) => <EhrCard key="today" title="Today">
      {notice ? <EhrSampleBanner /> : null}<SampleWorklist rows={today} empty={NOTHING_TODAY} /></EhrCard>,
  ]
  const candidates = open.filter(page => page.path !== '' && !page.group.startsWith('Design') && !page.tabOf)
  const pinned = chosen.flatMap(path => {
    const page = pages.find(candidate => candidate.path === path)
    return page && open.includes(page) ? [{ href: pageHrefOf(page), label: page.label }] : []
  })

  return <>
    <EhrPageHeading title={`Welcome, Demo ${role}`} back={<EhrBackButton label="Back to my dashboard" onClick={() => view(null)} />}
      primaryAction={<EhrButton variant="secondary" onClick={() => setCustomizing(true)}>Customize shortcuts</EhrButton>} />
    <ReportingPeriod period={period} onChange={setPeriod} />
    <div className="hid-ehr-blue-grid">{cards.map((card, index) => card(index === 0))}</div>
    <PinnedShortcuts pages={pinned} />
    <CustomizeShortcuts open={customizing} onClose={() => setCustomizing(false)} candidates={candidates} current={chosen} onChange={setChosen} />
  </>
}
