import type { StaffSession } from '../../../staff/api'
import type { EhrBluePage } from '../types'
import { OutreachIcon } from '../parts/icons'
import { Outreach, OutreachRefusal } from './Outreach'

const holds = (session: StaffSession, permission: string) => session.actor.facility?.permissions.includes(permission) ?? false

export const outreachPage: EhrBluePage = {
  path: 'outreach',
  group: 'Network & Services',
  label: 'Outreach',
  status: 'live',
  icon: <OutreachIcon />,
  element: <Outreach />,
  // As today: the page opens with campaign or registration read, and reads only what each allows; the sidebar lists it
  // with registration read (staff/navigation.ts). With neither, its address says Outreach isn't available at the facility yet
  // (NO_OUTREACH, the owner's answer of 2 November), as Document OCR's does, asking nobody.
  visible: session => holds(session, 'outreach.registration.read') || holds(session, 'outreach.campaign.read'),
  listed: session => holds(session, 'outreach.registration.read'),
  refusal: <OutreachRefusal />,
}
