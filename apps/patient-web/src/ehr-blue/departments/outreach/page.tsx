import type { StaffSession } from '../../../staff/api'
import type { EhrBluePage } from '../types'
import { OutreachIcon } from '../parts/icons'
import { Outreach, OutreachRefusal } from './Outreach'
import { StartOutreachGroup } from './StartOutreachGroup'

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
  // with registration read (staff/navigation.ts). With neither, its address says Outreach isn't available at the facility yet
  // (NO_OUTREACH, the owner's answer of 2 November), as Document OCR's does, asking nobody.
  visible: session => holds(session, 'outreach.registration.read') || holds(session, 'outreach.campaign.read'),
  listed: session => holds(session, 'outreach.registration.read'),
  refusal: <OutreachRefusal />,
}

/**
 * "Start an outreach group" (owner decision 5 of 11 November 2026): any staff login starts its own outreach group with
 * the same login. No permission (the account does not belong to the new group yet), and no sidebar entry: Switch facility
 * and Outreach link to it. Identity decides, and refuses while open sign-up is off.
 */
export const startOutreachGroupPage: EhrBluePage = {
  path: 'start-outreach-group',
  group: 'Network & Services',
  label: 'Start an outreach group',
  status: 'live',
  icon: <OutreachIcon />,
  element: <StartOutreachGroup />,
  listed: () => false,
}
