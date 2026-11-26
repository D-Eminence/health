import type { EhrBluePage } from '../types'
import { FlagIcon } from '../parts/icons'
import { QualityRefusal, QualitySafety } from './QualitySafety'
import { QUALITY_REPORT, TITLE, qualityServed, subscribeQualityServed } from './qualityRules'

/**
 * Quality & Safety (hid-system QUAL-1, 0197 and 0198) under Administration, in place of Akos's sample. The backend lets
 * every staff member holding quality.incident.report file and follow reports (0198 gives it to every staff role a
 * hospital can invite); managers are the administrator roles and the named quality leads, whom route 1 names. A member
 * without the code (everyone before 0198 applies) gets the page's refusal: the sample at the demo facilities, as today,
 * and plain words anywhere else, reading nothing.
 *
 * Partial, not live: its routes are proposed (built on claude/sprint-quality-backend), and production keeps them switched
 * off until the clinical lead signs the lists and the owner's go-live. Once a read answers 404 (an ehr-api before 0197)
 * or 503 QUALITY_NOT_AVAILABLE, the sidebar stops listing it for the page's life (listedChanges); its address still opens
 * and shows the sample at the demo facilities, or says it is not switched on yet.
 */
export const qualityPage: EhrBluePage = {
  path: 'quality/*',
  group: 'Administration',
  label: TITLE,
  permission: QUALITY_REPORT,
  status: 'partial',
  // The list's filters live on while an incident below it is open.
  keepsState: true,
  icon: <FlagIcon />,
  element: <QualitySafety />,
  refusal: <QualityRefusal />,
  listed: () => qualityServed() !== false,
  listedChanges: subscribeQualityServed,
}
