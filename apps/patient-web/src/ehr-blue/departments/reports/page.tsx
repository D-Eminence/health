import { EhrIcon } from '@hid/ui/ehr'
import { isDemoFacility } from '../../blueFacilities'
import type { EhrBluePage } from '../types'
import { ReportsPage, ReportsUnavailable } from './Reports'
import { TITLE, canReadReports, reportsServedAt, subscribeReportsServed } from './reportRules'

const permissionsOf = (session: Parameters<NonNullable<EhrBluePage['visible']>>[0]) => session.actor.facility?.permissions ?? []

/**
 * Reports & Analytics (hid-system REP-1, 0203 and 0204), in place of the frame's demo-only sample at the same address,
 * under Insight beside the Audit trail. The backend's codes decide who reads it (0204): the facility's administrators
 * (admin and org_admin) hold reports.read and reports.export.
 *
 * Partial, not live: its routes are proposed (built on hid-system claude/sprint-reports-backend), and a real facility keeps
 * them switched off (REPORTS_ENABLED) until the clinical lead and Ola sign the figure definitions and the owner gives
 * go-live. So:
 * - it shows where the session holds reports.read, and at the demo facilities, where everyone the design's roles let in
 *   keeps today's sample (as frame/pages.ts's stand-in did); a real facility's other members are told who can see reports;
 * - it is listed only where the session holds reports.read and the facility's reads have not answered 404 or 503
 *   REPORTS_NOT_AVAILABLE; the address still opens and says "Reports are not available yet." (the sample at a demo
 *   facility).
 */
export const reportsPage: EhrBluePage = {
  path: 'reports',
  group: 'Insight',
  label: TITLE,
  status: 'partial',
  icon: <EhrIcon name="chart" />,
  element: <ReportsPage />,
  refusal: <ReportsUnavailable />,
  visible: session => canReadReports(permissionsOf(session)) || isDemoFacility(session.actor.facility?.id),
  listed: session => canReadReports(permissionsOf(session)) && reportsServedAt(session.actor.facility?.id) !== false,
  listedChanges: subscribeReportsServed,
}
