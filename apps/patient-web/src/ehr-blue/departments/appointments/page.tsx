import type { EhrBluePage } from '../types'
import { Appointments, AppointmentsUnavailable } from './Appointments'
import { APPOINTMENT_READ, TITLE, appointmentsServed, subscribeAppointmentsServed } from './appointmentRules'

/** A calendar with a tick, drawn in the sidebar's stroke style. Hidden: the page's label names it. */
function CalendarIcon() {
  return (
    <svg className="hid-ehr-dept-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
      <path d="m9 15 2 2 4-4" />
    </svg>
  )
}

/**
 * Appointments (hid-system APPT-1, 0160 and 0161), in place of Akos's sample (clinical/sample definitions.ts
 * "appointments"), under Front desk (frame/BlueFrame.tsx). The backend lets members holding ehr.appointment.read see them
 * (front desk, nurses, clinicians, doctors) and ehr.appointment.write book and change them (not nurses). A member without
 * the read code is told who can use it (`refusal`), which reads nothing.
 *
 * Partial, not live: its routes are proposed (built on claude/sprint-appointments-backend), and production keeps them
 * switched off until the clinical lead's checklist and the owner's go-live. Once a read answers 404 (an ehr-api before
 * 0160) or 503 APPOINTMENTS_NOT_AVAILABLE, the sidebar stops listing it for the page's life (listedChanges); its address
 * still opens and says so. The sample's records stay in the frame's sample store for the demo's Home and Patient visits.
 */
export const appointmentsPage: EhrBluePage = {
  path: 'appointments/*',
  group: 'Clinical',
  label: TITLE,
  permission: APPOINTMENT_READ,
  status: 'partial',
  // The day list's filters live on while a record below it is open.
  keepsState: true,
  icon: <CalendarIcon />,
  element: <Appointments />,
  refusal: <AppointmentsUnavailable />,
  listed: () => appointmentsServed() !== false,
  listedChanges: subscribeAppointmentsServed,
}
