import type { StaffSession } from '../../../staff/api'
import type { EhrBluePage } from '../types'
import { ClockIcon } from '../parts/icons'
import { DeptUnavailable } from '../parts/DeptPage'
import { DutyRoster } from './DutyRoster'
import { LEAVE_REQUEST, READ_REFUSED, ROSTER_READ, TITLE, dutyRosterServed, subscribeDutyRosterServed } from './rosterRules'

/**
 * The Duty roster (hid-system ROS-1, 0200-0202) under People, beside Akos's "Shifts & Roster" sample. Staff holding
 * workforce.roster.read (every clinical and front desk role, and administrators) or workforce.leave.request open it; the
 * backend decides each request. A member without either is told who can use it (`refusal`), which reads nothing.
 *
 * Partial, not live: its routes are proposed (claude/sprint-hr-backend), and production keeps DUTY_ROSTER_ENABLED off at
 * real facilities until the owner's go-live (Q160 A). Before 0201 nobody holds its codes, so it is not listed at all.
 * Once a read answers 404 or 503 DUTY_ROSTER_NOT_AVAILABLE at a facility, the sidebar stops listing it there for the
 * page's life (listedChanges); its address still opens and says so.
 */
export const dutyRosterPage: EhrBluePage = {
  path: 'duty-roster/*',
  group: 'People',
  label: TITLE,
  permission: ROSTER_READ,
  orPermissions: [LEAVE_REQUEST],
  status: 'partial',
  // The week chosen lives on while a roster below it is open.
  keepsState: true,
  icon: <ClockIcon />,
  element: <DutyRoster />,
  refusal: <DeptUnavailable title={TITLE} message={READ_REFUSED} />,
  listed: (session: StaffSession) => dutyRosterServed(session.actor.facility?.id) !== false,
  listedChanges: subscribeDutyRosterServed,
}
