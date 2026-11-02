import type { StaffSession } from '../../../staff/api'
import type { EhrBluePage } from '../types'
import { OutreachIcon } from '../parts/icons'
import { Outreach, OutreachRefusal } from './Outreach'

const holds = (session: StaffSession, permission: string) => session.actor.facility?.permissions.includes(permission) ?? false

export const outreachPage: EhrBluePage = {
  path: 'outreach',
  group: 'Network & Services',
  label: 'Outreach',
  // Partial, not live: it works on Health ID, but not yet with today's words and steps throughout.
  status: 'partial',
  icon: <OutreachIcon />,
  element: <Outreach />,
  // As today: the page opens with campaign or registration read, and reads only what each allows; the sidebar lists it
  // with registration read (staff/navigation.ts). With neither, its address says what it needs.
  visible: session => holds(session, 'outreach.registration.read') || holds(session, 'outreach.campaign.read'),
  listed: session => holds(session, 'outreach.registration.read'),
  refusal: <OutreachRefusal />,
}
