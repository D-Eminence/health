import { ChevronRight, ReceiptText, Users } from 'lucide-react'
import type { Facility } from '../../staff/api'
import { useSampleHref } from '../frame/pageContext'
import { Alert, Badge, Button, Card, CardHeader } from '../../kasuwa/ui'
import { LoadingRows } from '../../kasuwa/parts'
import { billingTotals, naira, useStaffCount, useStaffHref } from './dashboardCards'

/**
 * An administrator's own Home cards (design audit item 7), drawn as the redesign draws Home: People, for whoever
 * manages the facility's staff, and Patient billing, a sample, for a facility administrator at a demo facility. Their
 * figures and reads are dashboardCards.tsx's, as each demo role's dashboard shows them.
 */

function Figure({ label, value, detail }: { readonly label: string; readonly value: string; readonly detail: string }) {
  return <div className="bg-surface px-5 py-4">
    <p className="m-0 text-[22px] font-semibold text-ink tabular">{value}</p>
    <p className="m-0 text-xs text-ink-2">{label}</p>
    <p className="m-0 text-xs text-ink-3">{detail}</p>
  </div>
}

/** People: the facility's active staff, read live at a demo facility where Staff is listed, and the way to manage them. */
export function HomePeopleCard({ facility }: { readonly facility: Facility }) {
  const staff = useStaffCount(facility)
  const href = useStaffHref()
  return <Card aria-label="People">
    <CardHeader as="h2" title="People" description="Active staff in this branch" icon={Users}
      actions={staff.kind === 'sample' ? <Badge tone="neutral" size="sm">Sample</Badge> : undefined} />
    {staff.kind === 'loading' ? <LoadingRows rows={1} label="Loading staff" /> : null}
    {staff.kind === 'failed' ? <div className="px-5 pb-4"><Alert intent="error" size="sm">{staff.message}</Alert></div> : null}
    {staff.kind === 'sample' || staff.kind === 'ready'
      ? <p className="m-0 px-5 pb-2 text-[22px] font-semibold text-ink tabular">{staff.count}</p> : null}
    {href ? <div className="px-5 pb-4"><Button to={href} variant="link" size="sm" iconRight={ChevronRight}>Manage staff & access</Button></div> : null}
  </Card>
}

/** Patient billing, a sample: the sample invoices' totals, in place of Activity on a facility administrator's Home. */
export function HomeBillingCard() {
  const href = useSampleHref()('billing')
  const totals = billingTotals()
  return <Card aria-label="Patient billing">
    <CardHeader as="h2" title="Patient billing" description="Sample invoices" icon={ReceiptText}
      actions={<Badge tone="neutral" size="sm">Sample</Badge>} />
    <div className="grid grid-cols-1 gap-px bg-line">
      <Figure label="Invoiced in period" value={naira(totals.total)} detail="No comparison yet" />
      <Figure label="Collected in period" value={naira(totals.paid)} detail="No comparison yet · Before refunds" />
      <Figure label="Outstanding balance" value={naira(totals.due)} detail="All open invoices" />
    </div>
    {href ? <div className="px-5 py-4"><Button to={href} variant="link" size="sm" iconRight={ChevronRight}>View patient billing</Button></div> : null}
  </Card>
}
