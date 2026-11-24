import { Link } from 'react-router-dom'
import { EhrDataTable, EhrEmptyState, EhrPageHeading, EhrSampleBanner, EhrBadge } from '@hid/ui/ehr'
import { useStaff } from '../../staff/App'
import type { Facility } from '../../staff/api'
import { visibleNavigation } from '../../staff/navigation'
import { refusedWorkText, type RefusedWork } from '../../staff/refusedWork'
import { useTodayPage } from './pageContext'

/**
 * Today's provider page for this address, inside the blue frame: its requests, checks, states and refusal messages are
 * exactly today's. A blue version of the page replaces it by exporting the same path.
 */
export function LivePage() {
  const today = useTodayPage()
  return <div className="hid-ehr-blue-live">{today}</div>
}

/**
 * Staff & access: today's Staff page where it is served (a facility that signed itself up, on Novu), and otherwise the
 * design's page as a sample: governed facilities' staff are managed by Health ID support.
 */
export function StaffAccessPage() {
  const { state } = useStaff()
  const facility = state.status === 'ready' ? state.session.actor.facility : undefined
  if (visibleNavigation(facility).some(item => item.to === '/provider/staff')) return <LivePage />
  const rows = [
    { name: 'Alex Example (fictional)', role: 'Doctor', status: 'Active' },
    { name: 'Taylor Fiction (fictional)', role: 'Nurse', status: 'Active' },
    { name: 'Jordan Sample (fictional)', role: 'Receptionist', status: 'Invited' },
  ]
  return <>
    <EhrPageHeading title="Staff & access" description="Who works here, their roles and their invitations." />
    <EhrSampleBanner />
    <EhrDataTable caption="Staff (sample)" rows={rows} rowKey={row => row.name} columns={[
      { id: 'name', header: 'Name', cell: row => row.name },
      { id: 'role', header: 'Role', cell: row => row.role },
      { id: 'status', header: 'Status', cell: row => <EhrBadge tone={row.status === 'Active' ? 'positive' : 'neutral'}>{row.status}</EhrBadge> },
    ]} />
  </>
}

/**
 * A page visible() turns down here (one of the demo's): no role can open it at this facility, and the words say so.
 * A page this session's role may not open refuses in its place instead (PageUnavailable, or the page's own refusal).
 */
export function DeniedPage({ label, facility }: { readonly label: string; readonly facility: string }) {
  return <>
    <EhrPageHeading title={label} />
    <EhrEmptyState title={`${label} is part of the Health ID demo only`} message={`It is not available at ${facility}.`}
      action={<Link className="hid-ehr-button hid-ehr-button-secondary" to="/provider">Go to Home</Link>} />
  </>
}

/**
 * A page this session's role may not open, and that has no refusal of its own, in its place: "<page> unavailable", as
 * the classic pages headed theirs ("Laboratory unavailable", "Audit access unavailable"), and the plain sentence the
 * classic refusals share (staff/refusedWork.ts): what the role doesn't include and whom to ask. It names no permission
 * (house rule) and sends nobody Home with a general notice (parity report 3.3-50).
 */
export function PageUnavailable({ label, facility }: { readonly label: string; readonly facility: Facility | undefined }) {
  const work: RefusedWork = { name: label, work: 'this page', doneBy: null, gets: new Set() }
  return <>
    <EhrPageHeading title={`${label} unavailable`} />
    <div className="hid-ehr-empty-state hid-ehr-dept-unavailable">
      <p className="hid-ehr-state-message">{refusedWorkText(facility, facility?.permissions ?? [], work)}</p>
    </div>
  </>
}
