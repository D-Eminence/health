import type { EhrBluePage } from '../types'
import { EmergencyDepartment, EmergencyDepartmentUnavailable } from './EmergencyDepartment'
import { ED_READ, ENCOUNTER_READ, ENCOUNTER_WRITE, TITLE, edBoardServed, subscribeEdBoardServed } from './edRules'

/** A cross in a rounded square with a pulse line, drawn in the sidebar's stroke style. Hidden: the page's label names it. */
function EmergencyIcon() {
  return (
    <svg className="hid-ehr-dept-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M12 7.5v6M9 10.5h6" />
      <path d="M6.5 17h3l1.2-1.8 1.6 2.6 1.2-1.8h4" />
    </svg>
  )
}

/**
 * The emergency department board (hid-system ED-1, 0168 and 0169), under Care beside Emergency access (which is
 * unchanged). The backend lets members holding ehr.ed.read and 0135's encounter pair see it: the front desk, nurses,
 * clinicians and doctors (the front desk and nurses view and add; clinicians and doctors also decide). A member without
 * them is told who can use it (`refusal`), which reads nothing.
 *
 * Partial, not live: its routes are proposed (built on claude/sprint-emergency-backend), and production keeps them switched
 * off until the clinical lead's checklist (the five-level triage scale first) and the owner's go-live. Once a read answers
 * 404 (an ehr-api before 0168) or 503 ED_BOARD_NOT_AVAILABLE, the sidebar stops listing it for the page's life; its
 * address still opens and says so. The sample board stays on Emergency access at the demo facilities until then.
 */
export const emergencyDepartmentPage: EhrBluePage = {
  path: 'emergency-department/*',
  group: 'Clinical',
  label: TITLE,
  permission: ED_READ,
  visible: session => {
    const permissions = session.actor.facility?.permissions ?? []
    return permissions.includes(ENCOUNTER_READ) && permissions.includes(ENCOUNTER_WRITE)
  },
  status: 'partial',
  // The board's "Show patients who left today" lives on while a record below it is open.
  keepsState: true,
  icon: <EmergencyIcon />,
  element: <EmergencyDepartment />,
  refusal: <EmergencyDepartmentUnavailable />,
  listed: () => edBoardServed() !== false,
  listedChanges: subscribeEdBoardServed,
}
