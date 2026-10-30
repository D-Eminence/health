import { useCallback } from 'react'
import { adminApi, type AdminActor, type CursorPage, type PlatformOverview } from './api'
import { UNAVAILABLE_CAPABILITIES, canOpen, navigationItemFor, visibleNavigation } from './navigation'
import { has, useResource, type Resource } from './ui'
import { Blocks, Building2, ChevronRight, ClipboardCheck, FileCheck2, Megaphone, RefreshCw, ScanFace, Stethoscope, Users } from 'lucide-react'
import { Alert, Button, Card, IconChip, ListRow, PageHeader, SectionHeader, StatCard, StatGroup, type Icon, type Tone } from '../kasuwa/ui'
import { WrongPatientReportsTile } from './WrongPatientReports'

const number = (value: number) => new Intl.NumberFormat('en-NG').format(value)

/** `GET /admin/overview` totals, labelled as the backend defines them. */
export const TOTALS: ReadonlyArray<{ key: keyof PlatformOverview; title: string; link?: string }> = [
  { key: 'registeredPatients', title: 'Registered patients' },
  { key: 'facilities', title: 'Facilities', link: '/admin/facilities' },
  { key: 'verifiedFacilities', title: 'Verified facilities', link: '/admin/facilities?status=verified' },
  { key: 'suspendedFacilities', title: 'Suspended facilities', link: '/admin/facilities?status=suspended' },
  { key: 'activeStaffMemberships', title: 'Active staff memberships' },
  { key: 'pendingIdentityReviews', title: 'Pending identity reviews', link: '/admin/reviews' },
]

/**
 * Waiting work is read one page at a time: "N+" when the list has more than
 * that page. Demo requests ask for 100 rows; approvals use the backend's
 * default page of 50, because an Identity build before Stage 4A refuses `limit` there.
 */
const ATTENTION_PAGE = 100
function counted(page: CursorPage<unknown>) {
  return page.nextCursor ? `${number(page.items.length)}+` : number(page.items.length)
}

/** A waiting-work row (paytrail's ListRow): the count, what it is, and the way to it. */
function AttentionRow<T>({ title, to, icon, tone = 'brand', resource, children }: {
  title: string; to: string; icon: Icon; tone?: Tone; resource: Resource<T>; children: (value: T) => { count: string; detail: string; urgent?: boolean }
}) {
  const shown = resource.data !== null && !resource.error ? children(resource.data) : null
  return <li><ListRow to={to} leading={<IconChip size="sm" icon={icon} tone={tone} />}
    title={<span className="flex items-baseline gap-2"><span>{title}</span>{shown && <span className={shown.urgent ? 'font-semibold text-danger-ink tabular' : 'font-semibold text-ink tabular'}>{shown.count}</span>}</span>}
    subtitle={resource.loading && resource.data === null ? 'Loading…' : resource.error ? <span role="alert" className="text-danger-ink">{resource.error}</span> : shown?.detail ?? 'No information was returned.'}
    trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li>
}

function PendingApprovals() {
  const load = useCallback((signal?: AbortSignal) => adminApi.approvals('pending', {}, signal), [])
  const resource = useResource(load, 'Approvals could not be loaded.')
  return <AttentionRow title="Pending approvals" to="/admin/approvals" icon={ClipboardCheck} tone="violet" resource={resource}>{value =>
    ({ count: counted(value), detail: 'Waiting for a second Super Admin', urgent: value.items.length > 0 })}</AttentionRow>
}

function OpenApplications() {
  const load = useCallback((signal?: AbortSignal) => adminApi.applications(undefined, signal), [])
  const resource = useResource(load, 'Applications could not be loaded.')
  return <AttentionRow title="Organization applications" to="/admin/applications" icon={FileCheck2} resource={resource}>{value => {
    const ready = value.items.filter(item => item.status === 'ready_for_review').length
    const verifying = value.items.filter(item => item.status === 'pending_verification').length
    return { count: number(ready), detail: `Ready for review · ${number(verifying)} awaiting CAC verification` }
  }}</AttentionRow>
}

function NewDemoRequests() {
  const load = useCallback((signal?: AbortSignal) => adminApi.demos({ status: 'new' }, { limit: ATTENTION_PAGE }, signal), [])
  const resource = useResource(load, 'Demo requests could not be loaded.')
  return <AttentionRow title="New demo requests" to="/admin/demos?status=new" icon={Megaphone} tone="info" resource={resource}>{value =>
    ({ count: counted(value), detail: 'Not yet contacted' })}</AttentionRow>
}

function IntegrationHealth() {
  const resource = useResource(adminApi.integrations, 'Integrations could not be loaded.')
  return <AttentionRow title="Integrations" to="/admin/integrations" icon={Blocks} tone="success" resource={resource}>{value => {
    const failed = value.items.filter(item => item.health === 'failed').length
    const enabled = value.items.filter(item => item.enabled).length
    return { count: number(failed), detail: `With a failed last test · ${number(enabled)} of ${number(value.items.length)} enabled`, urgent: failed > 0 }
  }}</AttentionRow>
}

/**
 * The dashboard shows only what the backend reports. Each count comes from
 * the endpoint of the page it links to and is shown only to administrators
 * who may open that page.
 */
export function OverviewPage({ actor }: { actor: AdminActor }) {
  const totals = useResource(adminApi.overview, 'The platform overview could not be loaded.')
  const areas = visibleNavigation(actor).flatMap(section => section.items).filter(item => item.path !== '/admin/overview')
  // A total links to its area only for an administrator who may open it there.
  const opens = (link: string) => { const item = navigationItemFor(link.split('?')[0] ?? link); return item !== undefined && canOpen(item, actor) }
  const approvals = navigationItemFor('/admin/approvals')
  const wrongPatient = navigationItemFor('/admin/wrong-patient-reports')
  const attention = [
    approvals !== undefined && canOpen(approvals, actor) && <PendingApprovals key="approvals" />,
    // Item 3 (D11): reports to review, where the backend serves them (an Identity without the list shows no tile).
    wrongPatient !== undefined && canOpen(wrongPatient, actor) && <WrongPatientReportsTile key="wrong-patient" />,
    has(actor, 'platform.identity-review.read') && <OpenApplications key="applications" />,
    has(actor, 'platform.demo.read') && <NewDemoRequests key="demos" />,
    has(actor, 'platform.integration.read') && <IntegrationHealth key="integrations" />,
  ].filter(Boolean)

  const t = totals.data
  return <div className="flex flex-col gap-8">
    <PageHeader title="Health ID overview" description="Every patient and facility on the platform, and the work waiting for administrators."
      actions={<Button icon={RefreshCw} onClick={totals.reload} disabled={totals.loading}>Refresh</Button>} />
    {totals.error && <Alert intent="error" title="The platform overview could not be loaded" action={<Button size="sm" onClick={totals.reload}>Try again</Button>}>{totals.error}</Alert>}
    <section aria-labelledby="admin-totals-title" className="flex flex-col gap-3">
      <h2 id="admin-totals-title" className="sr-only">Platform totals</h2>
      <StatGroup>
        <StatCard icon={Users} tone="brand" label="Registered patients" value={t ? number(t.registeredPatients) : '…'} hint="Health IDs issued" />
        <StatCard icon={Building2} tone="info" label="Facilities" value={t ? number(t.facilities) : '…'} to={opens('/admin/facilities') ? '/admin/facilities' : undefined}
          hint={t ? <>{number(t.verifiedFacilities)} verified · {t.suspendedFacilities ? <span className="text-danger-ink">{number(t.suspendedFacilities)} suspended</span> : 'none suspended'}</> : undefined} />
        <StatCard icon={Stethoscope} tone="success" label="Active staff memberships" value={t ? number(t.activeStaffMemberships) : '…'} hint="Clinicians and staff at facilities" />
        <StatCard icon={ScanFace} tone="warn" label="Pending identity reviews" value={t ? number(t.pendingIdentityReviews) : '…'} to={opens('/admin/reviews') ? '/admin/reviews' : undefined}
          hint={t?.pendingIdentityReviews ? 'NIN matches to check' : 'Nothing to review'} />
      </StatGroup>
    </section>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-6">
        {attention.length > 0 && <section aria-labelledby="admin-attention-title" className="flex flex-col gap-3">
          <SectionHeader id="admin-attention-title" title="Waiting for attention" count={attention.length} />
          <Card><ul className="m-0 list-none divide-y divide-line p-0">{attention}</ul></Card>
        </section>}
        <Alert intent="info" title="Not available yet" live={false}>
          These capabilities have no backend support yet, so this console does not show them:{' '}
          {UNAVAILABLE_CAPABILITIES.map(item => item.title).join(', ')}.
        </Alert>
      </div>
      <section aria-labelledby="admin-areas-title" className="flex flex-col gap-3">
        <SectionHeader id="admin-areas-title" title="Your areas" count={areas.length} />
        <Card><ul className="m-0 list-none divide-y divide-line p-0">{areas.slice(0, 9).map(item => <li key={item.path}>
          <ListRow to={item.path} title={item.title} subtitle={item.description} trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li>)}</ul></Card>
      </section>
    </div>
  </div>
}
