import { useCallback, type ReactNode } from 'react'
import { adminApi, type AdminActor, type CursorPage, type PlatformOverview } from './api'
import { canOpen, navigationItemFor } from './navigation'
import { has, useResource, type Resource } from './ui'
import { Blocks, Building2, ChevronRight, CircleCheck, ClipboardCheck, FileCheck2, Megaphone, RefreshCw, ScanFace, Stethoscope, TriangleAlert, Users } from 'lucide-react'
import { Alert, Badge, Button, Card, IconChip, ListRow, PageHeader, SectionHeader, StatCard, StatGroup, type Icon, type Tone } from '../kasuwa/ui'
import { LoadingRows } from '../kasuwa/parts'
import { unreviewedWrongPatientReports } from './WrongPatientReports'

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

/** Nothing to read: the administrator may not open that area. */
const nothing = () => Promise.resolve(null)

interface Waiting { key: string; title: string; to: string; icon: Icon; tone: Tone; count: number; badge: string; detail: string }

/** One kind of waiting work: a row while there is some (or its read failed), else nothing. */
function waiting<T>(resource: Resource<T | null>, row: Omit<Waiting, 'count' | 'badge' | 'detail'>, read: (value: T) => { count: number; badge: string; detail: string }):
  { row: Waiting | null; failed: string | null; loading: boolean } {
  if (resource.error) return { row: null, failed: `${row.title}: ${resource.error}`, loading: false }
  if (resource.data === null) return { row: null, failed: null, loading: resource.loading }
  const shown = read(resource.data)
  return { row: shown.count > 0 ? { ...row, ...shown } : null, failed: null, loading: false }
}

/**
 * The dashboard shows only what the backend reports. Each count comes from
 * the endpoint of the page it links to and is read only for administrators
 * who may open that page. Waiting work lists only what has something waiting.
 */
export function OverviewPage({ actor }: { actor: AdminActor }) {
  const totals = useResource(adminApi.overview, 'The platform overview could not be loaded.')
  // A total links to its area only for an administrator who may open it there.
  const opens = (link: string) => { const item = navigationItemFor(link.split('?')[0] ?? link); return item !== undefined && canOpen(item, actor) }
  const mayApprovals = opens('/admin/approvals')
  const mayWrongPatient = opens('/admin/wrong-patient-reports')
  const mayApplications = has(actor, 'platform.identity-review.read')
  const mayDemos = has(actor, 'platform.demo.read')
  const mayIntegrations = has(actor, 'platform.integration.read')

  const approvals = useResource(useCallback((signal?: AbortSignal) => mayApprovals ? adminApi.approvals('pending', {}, signal) : nothing(), [mayApprovals]),
    'Couldn’t load approvals.')
  // Item 3 (D11): reports to review, where the backend serves them (an Identity without the list reads as none).
  const wrongPatient = useResource(useCallback((signal?: AbortSignal) => mayWrongPatient ? unreviewedWrongPatientReports(signal) : nothing(), [mayWrongPatient]),
    'Couldn’t load wrong-patient reports.')
  const applications = useResource(useCallback((signal?: AbortSignal) => mayApplications ? adminApi.applications(undefined, signal) : nothing(), [mayApplications]),
    'Couldn’t load applications.')
  const demos = useResource(useCallback((signal?: AbortSignal) => mayDemos ? adminApi.demos({ status: 'new' }, { limit: ATTENTION_PAGE }, signal) : nothing(), [mayDemos]),
    'Couldn’t load demo requests.')
  const integrations = useResource(useCallback((signal?: AbortSignal) => mayIntegrations ? adminApi.integrations(signal) : nothing(), [mayIntegrations]),
    'Couldn’t load integrations.')

  const reads = [
    waiting(approvals, { key: 'approvals', title: 'Approvals', to: '/admin/approvals', icon: ClipboardCheck, tone: 'warn' }, value =>
      ({ count: value.items.length, badge: `${counted(value)} waiting`, detail: 'A second Super Admin must decide' })),
    waiting(wrongPatient, { key: 'wrong-patient', title: 'Wrong-patient reports', to: '/admin/wrong-patient-reports', icon: TriangleAlert, tone: 'danger' }, value =>
      ({ count: value.items.length, badge: `${number(value.items.length)} to review`, detail: 'Orders accepted for the wrong person' })),
    waiting(applications, { key: 'applications', title: 'Organization applications', to: '/admin/applications', icon: FileCheck2, tone: 'warn' }, value => {
      const ready = value.items.filter(item => item.status === 'ready_for_review').length
      const verifying = value.items.filter(item => item.status === 'pending_verification').length
      return { count: ready, badge: `${number(ready)} ready`, detail: verifying ? `${number(verifying)} more waiting for the CAC check` : 'Ready for your review' }
    }),
    waiting(demos, { key: 'demos', title: 'Demo requests', to: '/admin/demos?status=new', icon: Megaphone, tone: 'info' }, value =>
      ({ count: value.items.length, badge: `${counted(value)} new`, detail: 'Not contacted yet' })),
    waiting(integrations, { key: 'integrations', title: 'Integrations', to: '/admin/integrations', icon: Blocks, tone: 'danger' }, value => {
      const failed = value.items.filter(item => item.health === 'failed').length
      return { count: failed, badge: `${number(failed)} failing`, detail: 'Their last test failed' }
    }),
  ]
  const rows = reads.flatMap(read => read.row ? [read.row] : [])
  const failures = reads.flatMap(read => read.failed ? [read.failed] : [])
  const stillLoading = reads.some(read => read.loading)
  const anyArea = mayApprovals || mayWrongPatient || mayApplications || mayDemos || mayIntegrations
  const reloadAll = () => { totals.reload(); approvals.reload(); wrongPatient.reload(); applications.reload(); demos.reload(); integrations.reload() }

  let attention: ReactNode
  if (rows.length > 0) attention = <ul className="m-0 list-none divide-y divide-line p-0">{rows.map(row => <li key={row.key}>
    <ListRow to={row.to} leading={<IconChip size="sm" icon={row.icon} tone={row.tone} />} title={row.title} subtitle={row.detail}
      trailing={<span className="flex items-center gap-2"><Badge size="sm" solid tone={row.tone}>{row.badge}</Badge><ChevronRight className="size-4 text-ink-3" aria-hidden /></span>} />
  </li>)}</ul>
  else if (stillLoading) attention = <LoadingRows rows={2} label="Loading waiting work" />
  else if (failures.length === 0) attention = <p className="m-0 flex items-center gap-2 px-5 py-4 text-sm text-ink-2" role="status">
    <CircleCheck className="size-4 text-success" aria-hidden />All clear. Nothing is waiting.</p>

  const t = totals.data
  return <div className="flex flex-col gap-8">
    <PageHeader title="Overview" description="Platform totals and the work waiting for you."
      actions={<Button icon={RefreshCw} onClick={reloadAll} disabled={totals.loading}>Refresh</Button>} />
    {totals.error && <Alert intent="error" title="Couldn’t load the totals" action={<Button size="sm" onClick={totals.reload}>Try again</Button>}>{totals.error}</Alert>}
    <section aria-labelledby="admin-totals-title" className="flex flex-col gap-3">
      <h2 id="admin-totals-title" className="sr-only">Platform totals</h2>
      <StatGroup>
        <StatCard icon={Users} tone="brand" label="Registered patients" value={t ? number(t.registeredPatients) : '…'} hint="Health IDs issued" />
        <StatCard icon={Building2} tone="info" label="Facilities" value={t ? number(t.facilities) : '…'} to={opens('/admin/facilities') ? '/admin/facilities' : undefined}
          hint={t ? <>{number(t.verifiedFacilities)} verified · {t.suspendedFacilities ? <span className="font-medium text-danger-ink">{number(t.suspendedFacilities)} suspended</span> : 'none suspended'}</> : undefined} />
        <StatCard icon={Stethoscope} tone="success" label="Active staff memberships" value={t ? number(t.activeStaffMemberships) : '…'} hint="Clinicians and staff at facilities" />
        <StatCard icon={ScanFace} tone="warn" label="Identity reviews" value={t ? number(t.pendingIdentityReviews) : '…'} to={opens('/admin/reviews') ? '/admin/reviews' : undefined}
          hint={t?.pendingIdentityReviews ? 'Waiting for a check' : 'Nothing to review'} />
      </StatGroup>
    </section>
    {anyArea && <section aria-labelledby="admin-attention-title" className="flex flex-col gap-3">
      <SectionHeader id="admin-attention-title" title="Waiting for attention" count={rows.length || null} />
      {failures.map(message => <Alert key={message} intent="error" size="sm" action={<Button size="sm" onClick={reloadAll}>Try again</Button>}>{message}</Alert>)}
      {attention && <Card>{attention}</Card>}
    </section>}
  </div>
}
