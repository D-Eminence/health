import type { EhrBluePage } from '../types'
import { WaitingList, WaitingListUnavailable } from './WaitingList'
import { ENCOUNTER_READ, ENCOUNTER_WRITE, TITLE } from './waitingRules'

/** A clock over a short queue of people, drawn in the sidebar's stroke style. Hidden: the page's label names it. */
function WaitingIcon() {
  return (
    <svg className="hid-ehr-dept-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8" r="5" />
      <path d="M12 5.5V8l1.6 1.2" />
      <path d="M4 20v-1a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v1" />
    </svg>
  )
}

/**
 * The waiting list (hid-system 0135, EHR-C7) under Front desk (frame/BlueFrame.tsx CLINICAL_SIDEBAR). The backend lets
 * members holding both ehr.encounter.read and ehr.encounter.write use it: the front desk, nurses, clinicians and doctors,
 * not lab or pharmacy staff, who hold read only. The page's permission is the write one; `visible` asks for the read one
 * too, and a member without both is told who can use it (`refusal`), which reads nothing.
 */
export const waitingListPage: EhrBluePage = {
  path: 'waiting-list',
  group: 'Clinical',
  label: TITLE,
  permission: ENCOUNTER_WRITE,
  visible: session => (session.actor.facility?.permissions ?? []).includes(ENCOUNTER_READ),
  // Partial, not live: it needs Release A (0132 and 0135), and does not yet name who will see a patient.
  status: 'partial',
  icon: <WaitingIcon />,
  element: <WaitingList />,
  refusal: <WaitingListUnavailable />,
}
