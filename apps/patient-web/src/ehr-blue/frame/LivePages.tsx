import { Link, Outlet } from 'react-router-dom'
import { EhrDataTable, EhrEmptyState, EhrPageHeading, EhrSampleBanner, EhrBadge } from '@hid/ui/ehr'
import { useStaff } from '../../staff/App'
import { visibleNavigation } from '../../staff/navigation'

/**
 * Today's provider page for this address, inside the blue frame: its requests, checks, states and refusal messages are
 * exactly today's. A blue version of the page replaces it by exporting the same path.
 */
export function LivePage() {
  return <div className="hid-ehr-blue-live"><Outlet /></div>
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
 * A page this session's role may not open sends it Home instead (BlueFrame).
 */
export function DeniedPage({ label, facility }: { readonly label: string; readonly facility: string }) {
  return <>
    <EhrPageHeading title={label} />
    <EhrEmptyState title={`${label} is part of the Health ID demo only`} message={`It is not available at ${facility}.`}
      action={<Link className="hid-ehr-button hid-ehr-button-secondary" to="/provider">Go to Home</Link>} />
  </>
}
