import type { EhrBluePage } from '../types'
import { DeptUnavailable } from '../parts/DeptPage'
import { HistoryIcon } from '../parts/icons'
import { AuditCompliance } from './AuditCompliance'

export const auditPage: EhrBluePage = {
  path: 'audit',
  group: 'Insight',
  label: 'Audit trail',
  permission: 'audit.read',
  // Partial, not live: it works on Health ID, but not yet with today's words and steps throughout.
  status: 'partial',
  icon: <HistoryIcon />,
  element: <AuditCompliance />,
  // Opened by its address without the permission: the classic page's words (staff/routes/Audit.tsx), and nothing is read.
  // They name no permission, only what the role here does not include (owner rule: no codes on screen).
  refusal: <DeptUnavailable title="Audit access unavailable" message="Your role at this facility doesn’t include reviewing audit events. Ask your facility administrator." />,
}
