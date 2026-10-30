import { Link } from 'react-router-dom'
import { EhrBadge, EhrCard, EhrDataTable, EhrPageHeading, EhrStatCard, type EhrBadgeTone } from '@hid/ui/ehr'
import { useBluePages } from './pageContext'
import { pageHrefOf } from './pageHref'
import type { EhrBluePageStatus } from './types'

/** How each status reads, with its badge tone: never colour alone. */
export const STATUS_WORDS: Record<EhrBluePageStatus, { readonly label: string; readonly tone: EhrBadgeTone; readonly meaning: string }> = {
  live: { label: 'Live', tone: 'positive', meaning: 'Fully on Health ID today.' },
  partial: { label: 'Partial', tone: 'caution', meaning: 'Some parts on Health ID, the rest a sample.' },
  sample: { label: 'Sample', tone: 'neutral', meaning: 'Not connected yet: fictional data in memory only.' },
}

/** The frame's panels and route pages, which no pages.ts lists, with what each is today. */
export const FRAME_PARTS: readonly { readonly name: string; readonly status: EhrBluePageStatus; readonly note: string }[] = [
  { name: 'Sidebar, collapsed rail and phone menu', status: 'live', note: 'Every workspace in the design, grouped as in the design.' },
  { name: 'Account menu', status: 'partial', note: 'Switch facility and Sign out use Health ID; My profile, Preferences and Help are samples.' },
  { name: 'Role dashboards (16 demo roles)', status: 'sample', note: 'Chosen from the account menu: View Home as.' },
  { name: 'Workspace search', status: 'partial', note: 'Finds work areas; patient and staff search is not connected.' },
  { name: 'Notifications drawer', status: 'partial', note: 'Pending access requests are live; recent activity is a sample.' },
  { name: 'Demo chip', status: 'live', note: 'Says what is live and what is a sample.' },
  { name: 'Connection popover', status: 'sample', note: 'Health ID has no offline sync for staff yet.' },
  { name: 'Sync drawer', status: 'sample', note: 'Health ID has no offline sync for staff yet.' },
  { name: 'Record quick view', status: 'sample', note: 'On every sample workspace list.' },
  { name: 'My profile drawer', status: 'sample', note: 'From the account menu.' },
  { name: 'Unknown address', status: 'live', note: 'An address that is no page says so.' },
  { name: 'Page not open to your role', status: 'live', note: 'A live page without its permission is refused, and nothing of it is read.' },
]

/**
 * What's left: every page the blue EHR has, from every pages.ts, with its status, and the frame's own parts. The owner's
 * checklist: as pages go live, their entries change here on their own.
 */
export function WhatsLeft() {
  const pages = useBluePages()
  const counts = (['live', 'partial', 'sample'] as const).map(status => ({ status, count: pages.filter(page => page.status === status).length }))
  return <>
    <EhrPageHeading title="What’s left" description="Every workspace, flow and admin page of the design, and how much of it runs on Health ID today." />
    <div className="hid-ehr-blue-stats">
      {counts.map(({ status, count }) => (
        <EhrStatCard key={status} label={STATUS_WORDS[status].label} value={count} detail={STATUS_WORDS[status].meaning} />
      ))}
    </div>
    <EhrCard title="Pages">
      <EhrDataTable caption="Pages and their status" captionHidden rows={pages} rowKey={page => page.path} columns={[
        { id: 'page', header: 'Page', cell: page => <Link className="hid-ehr-blue-link" to={pageHrefOf(page)}>{page.label}</Link> },
        { id: 'group', header: 'Group', cell: page => page.group || 'Home' },
        { id: 'status', header: 'Status', cell: page => <EhrBadge tone={STATUS_WORDS[page.status].tone}>{STATUS_WORDS[page.status].label}</EhrBadge> },
        { id: 'needs', header: 'Needs permission', cell: page => page.status === 'sample' ? 'None (sample)' : page.permission ?? 'None' },
      ]} />
    </EhrCard>
    <EhrCard title="Panels and route pages">
      <EhrDataTable caption="Panels and route pages, and their status" captionHidden rows={FRAME_PARTS} rowKey={part => part.name} columns={[
        { id: 'name', header: 'Part', cell: part => part.name },
        { id: 'status', header: 'Status', cell: part => <EhrBadge tone={STATUS_WORDS[part.status].tone}>{STATUS_WORDS[part.status].label}</EhrBadge> },
        { id: 'note', header: 'Notes', cell: part => part.note },
      ]} />
    </EhrCard>
  </>
}
