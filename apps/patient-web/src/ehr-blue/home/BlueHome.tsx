import { useEffect, useState, useSyncExternalStore } from 'react'
import { EhrButton, EhrDrawer, EhrSampleBanner, EhrSkeleton } from '@hid/ui/ehr'
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
import { IncomingOrdersCard, loadLab, loadPharmacy, useIncomingServices, useWork, WrongPatientOrdersCard } from './liveCards'
import { useAccessRequests } from '../frame/attention'
import { basePath } from '../frame/pageHref'
import type { LabWorkItem, PharmacyWorkItem } from '../../staff/api'
import { Activity, ChevronRight, ClipboardList, FlaskConical, Pill, Pin, Search, ShieldAlert, ShieldCheck, Stethoscope, Users } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader, EmptyState, IconChip, ListRow, PageHeader, SectionHeader, Select, StatCard, StatGroup, greeting } from '../../kasuwa/ui'
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
  // Read once here (each read is audited) and shared by the stat tray and Today's work; before any early return.
  const access = useAccessRequests()
  const demo = isDemoFacility(facility?.id)
  const labRead = useWork<LabWorkItem>(facility?.id ?? '', demo && permissions.includes('lab.work-item.read'), loadLab)
  const rxRead = useWork<PharmacyWorkItem>(facility?.id ?? '', demo && permissions.includes('pharmacy.work-item.read'), loadPharmacy)
  if (role.viewing) return <RoleDashboard role={role.viewing} />
  if (!session) return null
  const name = session.actor.displayName ?? 'colleague'
  const candidates = pages.filter(page => page.path !== '' && !page.group.startsWith('Design') && pageAllowed(page, session))
  const shortcuts = chosen
    ? candidates.filter(page => chosen.includes(page.path))
    : candidates.filter(page => page.status === 'live').slice(0, MAX_SHORTCUTS)
  const lab = permissions.includes('lab.work-item.read')
  const pharmacy = permissions.includes('pharmacy.work-item.read')

  const pending = access.state === 'ready' ? access.pending : 0
  const labItems = labRead.state === 'ready' ? labRead.items : []
  const rxItems = rxRead.state === 'ready' ? rxRead.items.filter(item => !item.dispensing || item.dispensing.reversed) : []
  const urgentLab = labItems.filter(item => (item as { priority?: string }).priority === 'urgent' || (item as { priority?: string }).priority === 'stat').length
  const canFind = candidates.some(page => basePath(page.path) === 'patients')
  const work = [
    ...labItems.slice(0, 5).map(item => ({ key: `lab-${item.id}`, title: item.testName ?? 'Lab test', meta: `Laboratory · ${item.status.replace(/[-_]+/g, ' ')}`,
      to: '/provider/laboratory', icon: FlaskConical, urgent: (item as { priority?: string }).priority === 'urgent' })),
    ...rxItems.slice(0, 5).map(item => ({ key: `rx-${item.id}`, title: item.medication?.display ?? 'Medicine', meta: 'Pharmacy · to dispense',
      to: '/provider/pharmacy', icon: Pill, urgent: false })),
  ]
  const attention = [
    ...(pending > 0 ? [{ key: 'requests', to: '/provider/requests', icon: ShieldAlert, tone: 'warn' as const,
      title: `${pending} access request${pending === 1 ? '' : 's'} waiting`, subtitle: 'Patients asked to share their records with you' }] : []),
    ...(activePatient ? [{ key: 'patient', to: '/provider/clinical', icon: Stethoscope, tone: 'brand' as const,
      title: activePatient.lookup.patient.fullName ?? activePatient.hid,
      subtitle: activePatient.purpose === 'emergency' ? 'Consultation · emergency access, read only' : 'Consultation open' }] : []),
    ...(urgentLab > 0 ? [{ key: 'urgent-lab', to: '/provider/laboratory', icon: FlaskConical, tone: 'danger' as const,
      title: `${urgentLab} urgent lab test${urgentLab === 1 ? '' : 's'}`, subtitle: 'Accepted and waiting to be run' }] : []),
  ]
  const firstName = name.replace(/^(dr|mr|mrs|ms|nurse)\.?\s+/i, match => match).split(' ').slice(0, 2).join(' ')

  return <div className="flex flex-col gap-8">
    <PageHeader title={`${greeting()}, ${firstName}`} description={`Here's what needs you at ${facility?.name ?? 'your facility'} today.`}
      actions={<>
        <Button icon={Pin} onClick={() => setCustomizing(true)}>Customize shortcuts</Button>
        {canFind && <Button to="/provider/patients" variant="primary" icon={Search}>Find a patient</Button>}
      </>} />

    {/* The three-second rule: what waits for a decision is the first thing on the page, with its action. */}
    {pending > 0 && <Alert intent="warning" icon={ShieldAlert} title={`${pending} patient access request${pending === 1 ? ' is' : 's are'} waiting`}
      action={<Button to="/provider/requests" size="sm" variant="primary">Review</Button>}>
      Patients are waiting to share their records with you.</Alert>}
    {activePatient && <Alert intent="info" icon={Stethoscope} title={`${activePatient.lookup.patient.fullName ?? activePatient.hid}'s chart is open`}
      action={<Button to="/provider/clinical" size="sm">Continue</Button>}>
      {activePatient.purpose === 'emergency' ? 'Emergency access: read only, and logged.' : 'Direct care access. Close the chart from the patient page when you finish.'}</Alert>}

    <StatGroup label="Today at a glance">
      {permissions.includes('identity.consent.write') && <StatCard icon={ShieldAlert} tone="warn" label="Access requests" to="/provider/requests"
        value={access.state === 'ready' ? pending : access.state === 'loading' ? '…' : '—'} hint={pending ? 'Waiting for your review' : 'Nothing waiting'} />}
      {lab && <StatCard icon={FlaskConical} tone="info" label="Lab work" to="/provider/laboratory"
        value={demo ? labRead.state === 'ready' ? labItems.length : labRead.state === 'loading' ? '…' : '—' : 'Open'}
        hint={demo ? urgentLab ? <span className="text-danger-ink">{urgentLab} urgent</span> : 'Accepted tests' : 'Tests accepted here'} />}
      {pharmacy && <StatCard icon={Pill} tone="violet" label="To dispense" to="/provider/pharmacy"
        value={demo ? rxRead.state === 'ready' ? rxItems.length : rxRead.state === 'loading' ? '…' : '—' : 'Open'} hint="Prescriptions accepted" />}
      <StatCard icon={Users} tone="brand" label="Patients created" value={sampleRecords('patients').length} hint="Sample · last 7 days" />
    </StatGroup>

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-6">
        <section className="flex flex-col gap-3" aria-labelledby="ehr-home-attention">
          <SectionHeader id="ehr-home-attention" title="Needs attention" count={attention.length} />
          {access.state === 'failed' && <Alert intent="error" title="Access requests could not be loaded">{access.message}</Alert>}
          {attention.length === 0
            ? <EmptyState compact icon={ShieldCheck} title="All clear" description="No requests waiting, no chart open, nothing urgent in the lab." />
            : <Card><ul className="m-0 list-none divide-y divide-line p-0">{attention.map(a => <li key={a.key}>
                <ListRow to={a.to} leading={<IconChip size="sm" icon={a.icon} tone={a.tone} />} title={a.title} subtitle={a.subtitle}
                  trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li>)}</ul></Card>}
        </section>

        <Card>
          <CardHeader as="h2" title="Today's work" description={demo ? 'Laboratory and pharmacy, accepted here' : 'Your work areas'} icon={ClipboardList} iconTone="brand" />
          {demo && (labRead.state === 'loading' || rxRead.state === 'loading') ? <div className="p-5"><EhrSkeleton label="Loading today's work" bars={2} /></div> : null}
          {labRead.state === 'failed' && <div className="p-5"><Alert intent="error" title="Laboratory work could not be loaded">{labRead.message}</Alert></div>}
          {rxRead.state === 'failed' && <div className="p-5"><Alert intent="error" title="Pharmacy work could not be loaded">{rxRead.message}</Alert></div>}
          {demo ? work.length > 0
            ? <ul className="m-0 list-none divide-y divide-line p-0">{work.map(w => <li key={w.key}>
                <ListRow to={w.to} leading={<IconChip size="sm" icon={w.icon} tone={w.urgent ? 'danger' : 'neutral'} />} title={w.title} subtitle={w.meta}
                  trailing={w.urgent ? <Badge tone="danger" size="sm" solid>Urgent</Badge> : <ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li>)}</ul>
            : labRead.state !== 'loading' && rxRead.state !== 'loading' && <p className="m-0 px-5 py-6 text-[13px] text-ink-3">{lab || pharmacy ? 'Tests and prescriptions appear here once they are accepted.' : 'Laboratory and pharmacy work shows here for roles that do it.'}</p>
            : <ul className="m-0 list-none divide-y divide-line p-0">
                {lab && <li><ListRow to="/provider/laboratory" leading={<IconChip size="sm" icon={FlaskConical} />} title="Laboratory" subtitle="Accepted tests" trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li>}
                {pharmacy && <li><ListRow to="/provider/pharmacy" leading={<IconChip size="sm" icon={Pill} />} title="Pharmacy" subtitle="Prescriptions to dispense" trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li>}
                {!lab && !pharmacy && <li><p className="m-0 px-5 py-6 text-[13px] text-ink-3">Nothing scheduled for you</p></li>}
              </ul>}
        </Card>

        {/* Today's card and its once-only "Done" rule, at a self-signed-up facility (Novu). */}
        {facility ? <FacilityCheckCard facility={facility} /> : null}
        {facility && usesNovuBackend() && incoming.services.length > 0
          ? <IncomingOrdersCard facility={facility} services={incoming.services} unsure={incoming.unsure} sure={incoming.sure} /> : null}
        {facility && usesNovuBackend() && permissions.includes('ehr.order-route.send')
          ? <WrongPatientOrdersCard key={facility.id} facilityId={facility.id} facilityName={facility.name} /> : null}
      </div>

      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3" aria-labelledby="hid-ehr-blue-shortcuts">
          <SectionHeader id="hid-ehr-blue-shortcuts" title="Pinned shortcuts" action={<button type="button" onClick={() => setCustomizing(true)} className="cursor-pointer border-0 bg-transparent text-[13px] font-medium text-brand-ink hover:underline">Edit</button>} />
          <Card><ul className="m-0 list-none divide-y divide-line p-0">
            {shortcuts.map(page => <li key={page.path}><ListRow to={pageHrefOf(page)} leading={<span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-subtle text-ink-2 [&_svg]:size-[18px]">{page.icon}</span>}
              title={page.label} subtitle={page.status === 'sample' ? 'Sample' : page.group} trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li>)}
          </ul></Card>
          {/* Today's Overview rule: none of the six clinical modules' permissions held (an administrator's audit and billing are not). */}
          {facility && !holdsClinicalModule(permissions) ? (
            <Alert intent="info" size="sm">Your active facility has no clinical module permissions. Ask an administrator to review your assignment.</Alert>
          ) : null}
        </section>

        <Card aria-label="Activity in period">
          <CardHeader as="h2" title="Activity" description="Records created" icon={Activity}
            actions={<Select controlSize="sm" aria-label="Reporting period" value={period} onChange={event => setPeriod(event.target.value)}>
              <option value="7">Last 7 days</option><option value="30">Last 30 days</option></Select>} />
          <div className="grid grid-cols-2 gap-px bg-line">
            {ACTIVITY.map(id => <div key={id} className="bg-surface px-5 py-4">
              <p className="m-0 text-[22px] font-semibold text-ink tabular">{sampleRecords(id).length}</p>
              <p className="m-0 text-xs text-ink-3">{sampleModule(id)?.title}</p>
            </div>)}
          </div>
          <div className="border-t border-line px-5 py-3"><Badge tone="warn" size="sm">Sample: not connected to Health ID yet</Badge></div>
        </Card>
      </div>
    </div>
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
  </div>
}
