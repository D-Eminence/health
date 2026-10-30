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

/** An address inside the EHR that is no page of it. */
export function UnknownPage() {
  return <>
    <EhrPageHeading title="Page not found" />
    <EhrEmptyState title="This page is not part of Health ID EHR" message="Check the address, or go back to Home."
      action={<Link className="hid-ehr-button hid-ehr-button-secondary" to="/provider">Go to Home</Link>} />
  </>
}

/** A live or partial page the working facility's permissions do not open. Nothing of it is read. */
/**
 * A page this session may not open, by its address. Its permission missing, an administrator can grant it; a page
 * visible() turns down here (one of the demo's) no role can open, and the words say so.
 */
export function DeniedPage({ label, facility, reason = 'permission' }: {
  readonly label: string
  readonly facility: string
  readonly reason?: 'permission' | 'not-here'
}) {
  return <>
    <EhrPageHeading title={label} />
    {reason === 'permission' ? (
      <EhrEmptyState title={`${label} is not open to you here`}
        message={`Your role at ${facility} does not include ${label}. Ask your facility administrator to review your access.`}
        action={<Link className="hid-ehr-button hid-ehr-button-secondary" to="/provider">Go to Home</Link>} />
    ) : (
      <EhrEmptyState title={`${label} is part of the Health ID demo only`} message={`It is not available at ${facility}.`}
        action={<Link className="hid-ehr-button hid-ehr-button-secondary" to="/provider">Go to Home</Link>} />
    )}
  </>
}
