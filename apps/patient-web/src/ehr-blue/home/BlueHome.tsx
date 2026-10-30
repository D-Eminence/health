import { Link } from 'react-router-dom'
import { EhrCard, EhrPageHeading } from '@hid/ui/ehr'
import { useStaff } from '../../staff/App'
import { usesNovuBackend } from '../../backendContract'
import { useBluePages } from '../frame/pageContext'
import { pageHrefOf } from '../frame/pageHref'
import { useRoleView } from '../frame/roleView'
import {
  AccessRequestsCard, CurrentPatientCard, IncomingOrdersCard, LabWorkCard, PharmacyWorkCard, useIncomingServices, WrongPatientOrdersCard,
} from './liveCards'
import { RoleDashboard } from './RoleDashboard'

/**
 * Home (design: screens/roles/*-dashboard.png). Live: the cards today's Overview and work pages read, for the
 * facility's permissions: access requests, incoming orders, orders accepted for the wrong person, the current patient,
 * and laboratory and pharmacy work. The design's reporting period and activity counts need data Health ID does not
 * serve yet: they show in each role's sample dashboard, chosen from the account menu ("View as"), never here.
 */
export function BlueHome() {
  const { state } = useStaff()
  const role = useRoleView()
  const pages = useBluePages()
  const session = state.status === 'ready' ? state.session : null
  const facility = session?.actor.facility
  const permissions = facility?.permissions ?? []
  const incoming = useIncomingServices(facility)
  if (role.viewing) return <RoleDashboard role={role.viewing} />
  if (!session) return null
  const name = session.actor.displayName ?? 'colleague'
  // Pinned shortcuts: the first six live pages this facility opens (UI-RULES 7: at most six).
  const shortcuts = pages.filter(page => page.path !== '' && page.status === 'live' && page.group !== 'Design review'
    && (!page.permission || permissions.includes(page.permission))).slice(0, 6)
  const lab = permissions.includes('lab.work-item.read')
  const pharmacy = permissions.includes('pharmacy.work-item.read')
  return <>
    <EhrPageHeading title={`Welcome, ${name}`} description={facility ? `Working at ${facility.name}. Everything here uses your membership and is checked by Health ID.` : undefined} />
    <div className="hid-ehr-blue-grid">
      <section className="hid-ehr-blue-column" aria-labelledby="hid-ehr-blue-attention">
        <h2 id="hid-ehr-blue-attention" className="hid-ehr-blue-section-title">Needs attention</h2>
        <AccessRequestsCard />
        {facility && usesNovuBackend() && incoming.services.length > 0
          ? <IncomingOrdersCard facility={facility} services={incoming.services} unsure={incoming.unsure} sure={incoming.sure} /> : null}
        {facility && usesNovuBackend() && permissions.includes('ehr.order-route.send')
          ? <WrongPatientOrdersCard key={facility.id} facilityId={facility.id} facilityName={facility.name} /> : null}
        <CurrentPatientCard />
        {!permissions.includes('identity.consent.write') && !lab && !pharmacy ? (
          <EhrCard title="Nothing waiting"><p className="hid-ehr-blue-muted">Work that needs you here shows in this column.</p></EhrCard>
        ) : null}
      </section>
      <section className="hid-ehr-blue-column" aria-labelledby="hid-ehr-blue-today">
        <h2 id="hid-ehr-blue-today" className="hid-ehr-blue-section-title">Today</h2>
        {facility && lab ? <LabWorkCard facilityId={facility.id} /> : null}
        {facility && pharmacy ? <PharmacyWorkCard facilityId={facility.id} /> : null}
        {!lab && !pharmacy ? <EhrCard title="Your work today"><p className="hid-ehr-blue-muted">Laboratory and pharmacy work shows here for roles that do it.</p></EhrCard> : null}
      </section>
    </div>
    {shortcuts.length > 0 ? (
      <section aria-labelledby="hid-ehr-blue-shortcuts">
        <h2 id="hid-ehr-blue-shortcuts" className="hid-ehr-blue-section-title">Pinned shortcuts</h2>
        <ul className="hid-ehr-blue-shortcuts">
          {shortcuts.map(page => <li key={page.path}><Link className="hid-ehr-button hid-ehr-button-secondary" to={pageHrefOf(page)}>{page.label}</Link></li>)}
        </ul>
      </section>
    ) : null}
  </>
}
