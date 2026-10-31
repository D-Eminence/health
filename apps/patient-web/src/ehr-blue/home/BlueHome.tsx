import { useEffect, useState, useSyncExternalStore } from 'react'
import { EhrButton, EhrCard, EhrPageHeading, EhrSampleBanner } from '@hid/ui/ehr'
import { useStaff } from '../../staff/App'
import { holdsClinicalModule } from '../../staff/routes/Dashboard'
import { FacilityCheckCard } from '../../staff/routes/ReviewBanner'
import { usesNovuBackend } from '../../backendContract'
import { isDemoFacility } from '../blueFacilities'
import { useReloadAccessRequests } from '../frame/attention'
import { useBluePages } from '../frame/pageContext'
import { pageHrefOf } from '../frame/pageHref'
import { pageAllowed } from '../frame/pageAccess'
import { useRoleView } from '../frame/roleView'
import { sampleModule, sampleRecords, sampleVersion, subscribeSamples } from '../frame/sample/store'
import { CustomizeShortcuts, Figure, LivePeopleCard, MAX_SHORTCUTS, PatientBillingCard, PinnedShortcuts, ReportingPeriod } from './dashboardCards'
import { AttentionLines, IncomingOrdersCard, TodayCard, TodayLinks, useIncomingServices, WrongPatientOrdersCard } from './liveCards'
import { RoleDashboard } from './RoleDashboard'

const ACTIVITY = ['patients', 'appointments', 'journey', 'triage'] as const

/**
 * Home, as the design draws it (screens/roles/*-dashboard.png): the welcome heading with Customize shortcuts, the
 * reporting period and Activity in period, Needs attention, Today and Pinned shortcuts.
 * - Live: Needs attention (access requests, the current patient; incoming orders and orders accepted for the wrong
 *   person as their own cards, in today's words) and Today (laboratory and pharmacy work), each under today's
 *   permission and read as today's Overview and work pages read them.
 * - Sample: the reporting period and its activity counts (Health ID serves no such counts yet), and the shortcuts a
 *   person picks, kept in memory only.
 * Each demo role's dashboard replaces it from the account menu ("View Home as").
 */
export function BlueHome() {
  const { state, activePatient } = useStaff()
  const role = useRoleView()
  const pages = useBluePages()
  const session = state.status === 'ready' ? state.session : null
  const facility = session?.actor.facility
  const permissions = facility?.permissions ?? []
  const incoming = useIncomingServices(facility)
  const [period, setPeriod] = useState('7')
  const [customizing, setCustomizing] = useState(false)
  const [chosen, setChosen] = useState<readonly string[] | null>(null)
  useSyncExternalStore(subscribeSamples, sampleVersion, sampleVersion)
  // Home reads the access requests each time it opens, as today's Overview does.
  const reloadRequests = useReloadAccessRequests()
  useEffect(() => { reloadRequests() }, [reloadRequests])
  // A sample dashboard is the demo's alone, even when chosen there before a switch to a clinic.
  if (role.viewing && isDemoFacility(facility?.id)) return <RoleDashboard key={role.viewing} role={role.viewing} />
  if (!session) return null
  const name = session.actor.displayName ?? 'colleague'
  const candidates = pages.filter(page => page.path !== '' && !page.group.startsWith('Design') && pageAllowed(page, session)
    && (page.listed?.(session) ?? true))
  const shortcuts = chosen
    ? candidates.filter(page => chosen.includes(page.path))
    : candidates.filter(page => page.status === 'live').slice(0, MAX_SHORTCUTS)
  const lab = permissions.includes('lab.work-item.read')
  const pharmacy = permissions.includes('pharmacy.work-item.read')

  return <>
    <EhrPageHeading title={`Welcome, ${name}`}
      primaryAction={<EhrButton variant="secondary" onClick={() => setCustomizing(true)}>Customize shortcuts</EhrButton>} />
    <ReportingPeriod period={period} onChange={setPeriod} />
    <div className="hid-ehr-blue-grid">
      {/* A facility administrator's Home shows Patient billing where a clinician's shows Activity in period. */}
      {facility?.roles.includes('org_admin') ? <PatientBillingCard notice /> : (
        <EhrCard title="Activity in period">
          <EhrSampleBanner />
          <div className="hid-ehr-blue-activity">
            {ACTIVITY.map(id => <Figure key={id} label={`${sampleModule(id)?.title} created`} value={sampleRecords(id).length} detail="No comparison yet" />)}
          </div>
        </EhrCard>
      )}
      {facility && permissions.includes('workforce.manage') ? <LivePeopleCard facility={facility} /> : null}
      <EhrCard title="Needs attention">
        <ul className="hid-ehr-blue-list">
          <AttentionLines activePatient={activePatient} />
        </ul>
        {/* Only when the list is empty: no access requests to count and no patient open. */}
        {!permissions.includes('identity.consent.write') && !activePatient ? <p className="hid-ehr-blue-muted">Nothing needs your attention here.</p> : null}
      </EhrCard>
      {/* Today's card and its once-only "Done" rule, at a self-signed-up facility (Novu). */}
      {facility ? <FacilityCheckCard facility={facility} /> : null}
      {/* Live work counts are audited reads: only at the demo facilities. */}
      {facility ? isDemoFacility(facility.id) ? <TodayCard facilityId={facility.id} lab={lab} pharmacy={pharmacy} />
        : <TodayLinks lab={lab} pharmacy={pharmacy} /> : null}
      {facility && usesNovuBackend() && incoming.services.length > 0
        ? <IncomingOrdersCard facility={facility} services={incoming.services} unsure={incoming.unsure} sure={incoming.sure} /> : null}
      {facility && usesNovuBackend() && permissions.includes('ehr.order-route.send')
        ? <WrongPatientOrdersCard key={facility.id} facilityId={facility.id} facilityName={facility.name} /> : null}
    </div>
    <PinnedShortcuts pages={shortcuts.map(page => ({ href: pageHrefOf(page), label: page.label }))} after={
      // Today's Overview rule: none of the six clinical modules' permissions held (an administrator's audit and billing are not).
      facility && !holdsClinicalModule(permissions) ? (
        <p className="hid-ehr-blue-muted">Your active facility has no clinical module permissions. Ask an administrator to review your assignment.</p>
      ) : null} />
    <CustomizeShortcuts open={customizing} onClose={() => setCustomizing(false)} candidates={candidates}
      current={chosen ?? shortcuts.map(shortcut => shortcut.path)} onChange={setChosen} />
  </>
}
