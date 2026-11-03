import { useEffect, useState, useSyncExternalStore } from 'react'
import { useStaff } from '../../staff/App'
import { holdsClinicalModule } from '../../staff/routes/Dashboard'
import { FacilityCheckCard } from '../../staff/routes/ReviewBanner'
import { usesNovuBackend } from '../../backendContract'
import { isDemoFacility } from '../blueFacilities'
import { useReloadAccessRequests } from '../frame/attention'
import { useBluePages } from '../frame/pageContext'
import { pageHrefOf } from '../frame/pageHref'
import { pageAllowed } from '../frame/pageAccess'
import { inProduct, opensInProduct, productHere } from '../frame/product'
import { useRoleView } from '../frame/roleView'
import { sampleModule, sampleRecords, sampleVersion, subscribeSamples } from '../frame/sample/store'
import { IncomingOrdersCard, loadLab, loadPharmacy, useIncomingServices, useWork, WrongPatientOrdersCard } from './liveCards'
import { useAccessRequests } from '../frame/attention'
import { basePath } from '../frame/pageHref'
import type { LabWorkItem, PharmacyWorkItem, ReceivingService } from '../../staff/api'
import { STAGE_LABEL, stageOf } from '../departments/laboratory/stage'
import { Activity, ChevronRight, ClipboardList, FlaskConical, Pill, RotateCcw, Search, ShieldAlert, ShieldCheck, Stethoscope, Users } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader, EmptyState, IconChip, ListRow, PageHeader, SectionHeader, Select, StatCard, StatGroup, greeting } from '../../kasuwa/ui'
import { Drawer } from '../../kasuwa/interactive'
import { LoadingRows } from '../../kasuwa/parts'
import { RoleDashboard } from './RoleDashboard'
import { HomeBillingCard, HomePeopleCard } from './adminCards'

const ACTIVITY = ['patients', 'appointments', 'journey', 'triage'] as const
const MAX_SHORTCUTS = 6

/**
 * Home: the welcome heading with one primary action (Find a patient), Needs attention (each waiting thing once),
 * Today's work and the person's own shortcuts (edited from Shortcuts only; none pinned by default).
 * - Live: Needs attention (access requests, the current patient; incoming orders and orders accepted for the wrong
 *   person as their own cards, in today's words) and Today (laboratory and pharmacy work), each under today's
 *   permission and read as today's Overview and work pages read them.
 * - Sample (demo facilities only): the reporting period and its activity counts (Health ID serves no such counts yet);
 *   on a facility administrator's Home, Patient billing in their place.
 * - People, for whoever manages the facility's staff: the staff read live at a demo facility where Staff is listed, a
 *   sample figure at the other demo facilities, and the way to Staff & access.
 * - The shortcuts a person picks are kept in memory only.
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
  // Home offers this workspace's pages only, as the frame's menu and search do (product.ts). In a single product (a lab
  // or an outreach team on its own) Home opens when the product's own page is not open to this session, and it offers
  // none of the hospital's pages there: patient registration stays in the EHR. A hospital's EHR has them all.
  const product = productHere(session)
  const lab = permissions.includes('lab.work-item.read') && inProduct(product, 'laboratory')
  const pharmacy = permissions.includes('pharmacy.work-item.read') && inProduct(product, 'pharmacy')
  const labRead = useWork<LabWorkItem>(facility?.id ?? '', demo && lab, loadLab)
  const rxRead = useWork<PharmacyWorkItem>(facility?.id ?? '', demo && pharmacy, loadPharmacy)
  // A sample dashboard is the demo's alone, even when chosen there before a switch to a clinic.
  if (role.viewing && demo) return <RoleDashboard key={role.viewing} role={role.viewing} />
  if (!session) return null
  const name = session.actor.displayName ?? 'colleague'
  const candidates = pages.filter(page => page.path !== '' && !page.group.startsWith('Design') && pageAllowed(page, session)
    && inProduct(product, page.path) && (page.listed?.(session) ?? true))
  const shortcuts = candidates.filter(page => (chosen ?? []).includes(page.path))

  const pending = access.state === 'ready' ? access.pending : 0
  const labItems = labRead.state === 'ready' ? labRead.items : []
  const rxItems = rxRead.state === 'ready' ? rxRead.items.filter(item => !item.dispensing || item.dispensing.reversed) : []
  const urgentLab = labItems.filter(item => (item as { priority?: string }).priority === 'urgent' || (item as { priority?: string }).priority === 'stat').length
  const canFind = candidates.some(page => basePath(page.path) === 'patients')
  // A link from Home leads only to a page this site opens: the frame sends any other back here (product.ts). So on a
  // single product, which has no Consultation, the open patient leads to their page under Patients, where this role may
  // open it, and Incoming orders offers only this product's own work. In a hospital's EHR every page opens.
  const opens = (path: string) => opensInProduct(product, path)
  const patientTo = opens('clinical') ? '/provider/clinical' : canFind ? '/provider/patients/open' : null
  const receivedHere = (service: ReceivingService) => opens(service === 'lab' ? 'laboratory' : 'pharmacy')
  const incomingHere = { services: incoming.services.filter(receivedHere), unsure: incoming.unsure.filter(receivedHere),
    sure: incoming.sure.filter(receivedHere) }
  const work = [
    ...labItems.slice(0, 5).map(item => ({ key: `lab-${item.id}`, title: item.testName ?? 'Lab test', meta: `Laboratory · ${STAGE_LABEL[stageOf(item)]}`,
      to: '/provider/laboratory', icon: FlaskConical, urgent: (item as { priority?: string }).priority === 'urgent' })),
    ...rxItems.slice(0, 5).map(item => ({ key: `rx-${item.id}`, title: item.medication?.display ?? 'Medicine', meta: 'Pharmacy · to dispense',
      to: '/provider/pharmacy', icon: Pill, urgent: false })),
  ]
  const attention = [
    ...(pending > 0 ? [{ key: 'requests', to: '/provider/requests', icon: ShieldAlert, tone: 'warn' as const,
      title: `${pending} access request${pending === 1 ? '' : 's'} waiting`, subtitle: 'Waiting for the patient to answer' }] : []),
    ...(activePatient && patientTo ? [{ key: 'patient', to: patientTo, icon: Stethoscope, tone: 'brand' as const,
      title: activePatient.lookup.patient.fullName ?? activePatient.hid,
      subtitle: activePatient.purpose === 'emergency' ? 'Open now · emergency access, view only' : 'Open now · continue where you left off' }] : []),
    ...(urgentLab > 0 ? [{ key: 'urgent-lab', to: '/provider/laboratory', icon: FlaskConical, tone: 'danger' as const,
      title: `${urgentLab} urgent lab test${urgentLab === 1 ? '' : 's'}`, subtitle: 'Accepted and waiting to be run' }] : []),
  ]
  // "All clear" only for what was read: the access requests (when this role reads them) and, at a demo facility, the
  // laboratory work. While a read is still on its way Home says it is loading; after one fails it does not say all clear.
  const readsRequests = permissions.includes('identity.consent.write')
  const requestsRead = readsRequests ? access.state : 'ready'
  const labState = demo && lab ? labRead.state : 'ready'
  const checking = requestsRead === 'loading' || requestsRead === 'none' || labState === 'loading'
  const allClear = !checking && requestsRead === 'ready' && labState === 'ready'
  const clearWords = [readsRequests ? 'No requests waiting' : null, 'no patient open', demo && lab ? 'nothing urgent' : null]
    .filter(Boolean).join(', ')
  const clearDescription = `${clearWords.charAt(0).toUpperCase()}${clearWords.slice(1)}.`
  const firstName = name.replace(/^(dr|mr|mrs|ms|nurse)\.?\s+/i, match => match).split(' ').slice(0, 2).join(' ')

  const stats = [
    demo && lab ? <StatCard key="lab" icon={FlaskConical} tone="info" label="Lab tests" to="/provider/laboratory"
      value={labRead.state === 'ready' ? labItems.length : labRead.state === 'loading' ? '…' : '—'}
      hint={urgentLab ? <span className="text-danger-ink">{urgentLab} urgent</span> : 'Accepted here'} /> : null,
    demo && pharmacy ? <StatCard key="rx" icon={Pill} tone="violet" label="To dispense" to="/provider/pharmacy"
      value={rxRead.state === 'ready' ? rxItems.length : rxRead.state === 'loading' ? '…' : '—'} hint="Prescriptions accepted here" /> : null,
    // A sample figure: only at a demo facility, where it is labelled as one.
    demo ? <StatCard key="created" icon={Users} tone="brand" label="Patients registered" value={sampleRecords('patients').length} hint="Sample · last 7 days" /> : null,
  ].filter(Boolean)

  return <div className="flex flex-col gap-8">
    <PageHeader title={`${greeting()}, ${firstName}`} description={`What needs you at ${facility?.name ?? 'your facility'} today.`}
      actions={canFind ? <Button to="/provider/patients" variant="primary" icon={Search}>Find a patient</Button> : undefined} />

    {stats.length > 0 ? <StatGroup label="Today at a glance" cols={stats.length >= 3 ? 3 : 2}>{stats}</StatGroup> : null}

    <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(17rem,22.5rem)]">
      <div className="flex min-w-0 flex-col gap-6">
        {/* The three-second rule: what waits for a decision is the first section, each thing in it once. */}
        <section className="flex flex-col gap-3" aria-labelledby="ehr-home-attention">
          <SectionHeader id="ehr-home-attention" title="Needs attention" count={attention.length} />
          {access.state === 'failed' && <Alert intent="error" title="Couldn’t load access requests"
            action={<Button size="sm" icon={RotateCcw} onClick={reloadRequests}>Try again</Button>}>{access.message}</Alert>}
          {attention.length === 0
            ? checking ? <Card><LoadingRows rows={1} label="Loading what needs attention" /></Card>
              : allClear ? <EmptyState compact icon={ShieldCheck} title="All clear" description={clearDescription} />
                // A failed access-request read already says so above, with Try again.
                : requestsRead === 'failed' ? null : <p className="m-0 px-1 text-[13px] text-ink-3">We couldn’t check everything that needs attention just now.</p>
            : <Card><ul className="m-0 list-none divide-y divide-line p-0">{attention.map(a => <li key={a.key}>
                <ListRow to={a.to} leading={<IconChip size="sm" icon={a.icon} tone={a.tone} />} title={a.title} subtitle={a.subtitle}
                  trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li>)}</ul></Card>}
        </section>

        {lab || pharmacy ? <Card>
          <CardHeader as="h2" title="Today's work" description={demo ? 'Laboratory and pharmacy, accepted here' : undefined} icon={ClipboardList} iconTone="brand" />
          {labRead.state === 'failed' && <div className="p-5"><Alert intent="error" title="Couldn’t load laboratory work">{labRead.message}</Alert></div>}
          {rxRead.state === 'failed' && <div className="p-5"><Alert intent="error" title="Couldn’t load pharmacy work">{rxRead.message}</Alert></div>}
          {demo
            ? (labRead.state === 'loading' || rxRead.state === 'loading') && work.length === 0 ? <LoadingRows rows={2} label="Loading today's work" />
              : work.length > 0
                ? <ul className="m-0 list-none divide-y divide-line p-0">{work.map(w => <li key={w.key}>
                    <ListRow to={w.to} leading={<IconChip size="sm" icon={w.icon} tone={w.urgent ? 'danger' : 'neutral'} />} title={w.title} subtitle={w.meta}
                      trailing={w.urgent ? <Badge tone="danger" size="sm" solid>Urgent</Badge> : <ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li>)}</ul>
                : <p className="m-0 px-5 py-6 text-[13px] text-ink-3">Tests and prescriptions show here once they are accepted.</p>
            : <ul className="m-0 list-none divide-y divide-line p-0">
                {lab && <li><ListRow to="/provider/laboratory" leading={<IconChip size="sm" icon={FlaskConical} />} title="Laboratory" subtitle="Accepted tests" trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li>}
                {pharmacy && <li><ListRow to="/provider/pharmacy" leading={<IconChip size="sm" icon={Pill} />} title="Pharmacy" subtitle="Prescriptions to dispense" trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li>}
              </ul>}
        </Card> : null}

        {/* Today's card and its once-only "Done" rule, at a self-signed-up facility (Novu). */}
        {facility ? <FacilityCheckCard facility={facility} /> : null}
        {facility && usesNovuBackend() && incomingHere.services.length > 0
          ? <IncomingOrdersCard facility={facility} services={incomingHere.services} unsure={incomingHere.unsure} sure={incomingHere.sure} /> : null}
        {facility && usesNovuBackend() && permissions.includes('ehr.order-route.send')
          ? <WrongPatientOrdersCard key={facility.id} facilityId={facility.id} facilityName={facility.name} consultation={opens('clinical')} /> : null}
      </div>

      <div className="flex flex-col gap-6">
        {/* Shortcuts are edited here only; none are pinned by default, since the sidebar already lists every page. */}
        <section className="flex flex-col gap-3" aria-labelledby="hid-ehr-blue-shortcuts">
          <SectionHeader id="hid-ehr-blue-shortcuts" title="Shortcuts" action={<Button variant="link" size="sm" onClick={() => setCustomizing(true)}>Edit</Button>} />
          {shortcuts.length > 0
            ? <Card><ul className="m-0 list-none divide-y divide-line p-0">
                {shortcuts.map(page => <li key={page.path}><ListRow to={pageHrefOf(page)} leading={<span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-subtle text-ink-2 [&_svg]:size-[18px]">{page.icon}</span>}
                  title={page.label} subtitle={page.status === 'sample' ? 'Sample' : page.group} trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li>)}
              </ul></Card>
            : <p className="m-0 px-1 text-[13px] text-ink-3">Pin the pages you use most. Choose Edit to add them.</p>}
          {/* Today's Overview rule: none of the six clinical modules' permissions held (an administrator's audit and billing are not). */}
          {facility && !holdsClinicalModule(permissions) ? (
            <Alert intent="info" size="sm">You have no clinical work at this facility yet. Ask an administrator to check your role.</Alert>
          ) : null}
        </section>

        {facility && permissions.includes('workforce.manage') ? <HomePeopleCard facility={facility} /> : null}

        {/* A facility administrator's Home shows Patient billing where a clinician's shows Activity. */}
        {demo && facility?.roles.includes('org_admin') ? <HomeBillingCard /> : demo ? <Card aria-label="Activity in period">
          <CardHeader as="h2" title="Activity" description="Sample records created" icon={Activity}
            actions={<Select controlSize="sm" aria-label="Reporting period" value={period} onChange={event => setPeriod(event.target.value)}>
              <option value="7">Last 7 days</option><option value="30">Last 30 days</option></Select>} />
          <div className="grid grid-cols-2 gap-px bg-line">
            {ACTIVITY.map(id => <div key={id} className="bg-surface px-5 py-4">
              <p className="m-0 text-[22px] font-semibold text-ink tabular">{sampleRecords(id).length}</p>
              <p className="m-0 text-xs text-ink-3">{sampleModule(id)?.title}</p>
            </div>)}
          </div>
        </Card> : null}
      </div>
    </div>
    <Drawer open={customizing} title="Edit shortcuts" description={`Choose up to ${MAX_SHORTCUTS}. They stay until you sign out or reload.`} onClose={() => setCustomizing(false)}
      footer={<Button variant="primary" onClick={() => setCustomizing(false)}>Done</Button>}>
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="sr-only">Shortcuts for Home</legend>
        {candidates.map(page => {
          const picked = shortcuts.some(shortcut => shortcut.path === page.path)
          const current = shortcuts.map(shortcut => shortcut.path)
          return (
            <label key={page.path} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm text-ink hover:bg-subtle">
              <input type="checkbox" className="size-4 accent-brand-fill" checked={picked}
                disabled={!picked && current.length >= MAX_SHORTCUTS}
                onChange={event => setChosen(event.target.checked ? [...current, page.path] : current.filter(path => path !== page.path))} />
              <span>{page.label}{page.status === 'sample' ? <span className="text-ink-3"> · Sample</span> : null}</span>
            </label>
          )
        })}
      </fieldset>
    </Drawer>
  </div>
}
