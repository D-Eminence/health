import { useEffect, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { EhrButton, EhrCard, EhrDrawer, EhrField, EhrPageHeading, EhrSampleBanner, EhrSelect } from '@hid/ui/ehr'
import { useStaff } from '../../staff/App'
import { FacilityCheckCard } from '../../staff/routes/ReviewBanner'
import { usesNovuBackend } from '../../backendContract'
import { isDemoFacility } from '../blueFacilities'
import { useReloadAccessRequests } from '../frame/attention'
import { useBluePages } from '../frame/pageContext'
import { pageHrefOf } from '../frame/pageHref'
import { pageAllowed } from '../frame/pageAccess'
import { useRoleView } from '../frame/roleView'
import { sampleModule, sampleRecords, sampleVersion, subscribeSamples } from '../frame/sample/store'
import { AttentionLines, IncomingOrdersCard, TodayCard, TodayLinks, useIncomingServices, WrongPatientOrdersCard } from './liveCards'
import { RoleDashboard } from './RoleDashboard'

const ACTIVITY = ['patients', 'appointments', 'journey', 'triage'] as const
const MAX_SHORTCUTS = 6

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
  if (role.viewing) return <RoleDashboard role={role.viewing} />
  if (!session) return null
  const name = session.actor.displayName ?? 'colleague'
  const candidates = pages.filter(page => page.path !== '' && !page.group.startsWith('Design') && pageAllowed(page, session))
  const shortcuts = chosen
    ? candidates.filter(page => chosen.includes(page.path))
    : candidates.filter(page => page.status === 'live').slice(0, MAX_SHORTCUTS)
  // As today's Overview says when none of its workspaces is open to the member: here, no live or partial page.
  const holdsLivePage = pages.some(page => page.status !== 'sample' && page.permission !== undefined && permissions.includes(page.permission))
  const lab = permissions.includes('lab.work-item.read')
  const pharmacy = permissions.includes('pharmacy.work-item.read')

  return <>
    <EhrPageHeading title={`Welcome, ${name}`}
      primaryAction={<EhrButton variant="secondary" onClick={() => setCustomizing(true)}>Customize shortcuts</EhrButton>} />
    <div className="hid-ehr-blue-period">
      <EhrField label="Reporting period">
        <EhrSelect value={period} onChange={event => setPeriod(event.target.value)}>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
        </EhrSelect>
      </EhrField>
      <span className="hid-ehr-blue-period-note">Record creation dates · local time</span>
    </div>
    <div className="hid-ehr-blue-grid">
      <EhrCard title="Activity in period">
        <EhrSampleBanner />
        <div className="hid-ehr-blue-activity">
          {ACTIVITY.map(id => (
            <div key={id} className="hid-ehr-blue-activity-figure">
              <span>{sampleModule(id)?.title} created</span>
              <strong>{sampleRecords(id).length}</strong>
              <small>No comparison yet</small>
            </div>
          ))}
        </div>
      </EhrCard>
      <EhrCard title="Needs attention">
        <ul className="hid-ehr-blue-list">
          <AttentionLines activePatient={activePatient} />
        </ul>
        {!permissions.includes('identity.consent.write') ? <p className="hid-ehr-blue-muted">Nothing needs your attention here.</p> : null}
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
    <section aria-labelledby="hid-ehr-blue-shortcuts">
      <h2 id="hid-ehr-blue-shortcuts" className="hid-ehr-blue-section-title">Pinned shortcuts</h2>
      <ul className="hid-ehr-blue-shortcuts">
        {shortcuts.map(page => <li key={page.path}><Link className="hid-ehr-button hid-ehr-button-secondary" to={pageHrefOf(page)}>{page.label}</Link></li>)}
      </ul>
      {facility && !holdsLivePage ? (
        <p className="hid-ehr-blue-muted">Your active facility has no clinical module permissions. Ask an administrator to review your assignment.</p>
      ) : null}
    </section>
    <EhrDrawer open={customizing} title="Customize shortcuts" onClose={() => setCustomizing(false)}>
      <EhrSampleBanner />
      <fieldset className="hid-ehr-blue-steps">
        <legend className="hid-ehr-blue-muted">Choose up to {MAX_SHORTCUTS} shortcuts for Home.</legend>
        {candidates.map(page => {
          const picked = (chosen ?? shortcuts.map(shortcut => shortcut.path)).includes(page.path)
          const current = chosen ?? shortcuts.map(shortcut => shortcut.path)
          return (
            <label key={page.path} className="hid-ehr-blue-check">
              <input type="checkbox" className="hid-ehr-blue-check-input" checked={picked}
                disabled={!picked && current.length >= MAX_SHORTCUTS}
                onChange={event => setChosen(event.target.checked ? [...current, page.path] : current.filter(path => path !== page.path))} />
              {page.label}
            </label>
          )
        })}
      </fieldset>
      <EhrButton onClick={() => setCustomizing(false)}>Done</EhrButton>
    </EhrDrawer>
  </>
}
