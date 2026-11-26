import type { StaffSession } from '../../../staff/api'
import { designRolesOf, sampleCan, samplesShownAt } from '../../frame/sampleAccess'
import type { EhrBluePage } from '../../frame/types'
import { ClinicalIcon } from '../parts/icons'
import { DentalRefusal, DentalWorkspace } from './DentalWorkspace'
import { DENTAL_READ, TITLE, dentalServed, subscribeDentalServed } from './dentalRules'

const holdsDental = (session: StaffSession) => (session.actor.facility?.permissions ?? []).includes(DENTAL_READ)

/**
 * Dental (hid-system DEN-1, 0194-0196), in place of the design's sample at the same address and sidebar place ("Wards &
 * units"). Partial, not live: its routes are proposed (built on hid-system claude/sprint-dental-backend), and
 * production keeps them switched off (DENTAL_ENABLED) until the clinical lead's checklist and the owner's go-live (Q160
 * A).
 *
 * It has no `permission` of its own because it is two pages at one address (DentalWorkspace): a dentist's live page
 * (ehr.dental.read, held by dentists only, Q-DEN-1 A) anywhere, and today's sample at the four demo facilities for the
 * design roles the sample was open to (its Doctor, Consultant and Medical Director), until the dental clinic ships.
 * Anyone else does not see it, and its address says who uses it (`refusal`), reading nothing. Only a dentist's sidebar
 * and search list it: the sample, as every sample, is reached by its address and the demo's own links only (the owner's
 * decision of 31 Oct 2026, BlueFrame.tsx). Once a dental read answers 404 (an ehr-api before DEN-1) or 503
 * DENTAL_NOT_AVAILABLE, a dentist's sidebar stops listing it for the page's life; its address still opens and says so.
 */
export const dentalPage: EhrBluePage = {
  path: 'dental/*',
  group: 'Clinical',
  label: TITLE,
  icon: <ClinicalIcon name="tooth" size={18} />,
  status: 'partial',
  visible: session => holdsDental(session) || (samplesShownAt(session) && sampleCan(designRolesOf(session, null), 'dental')),
  listed: session => holdsDental(session) && dentalServed() !== false,
  listedChanges: subscribeDentalServed,
  element: <DentalWorkspace />,
  refusal: <DentalRefusal />,
}
