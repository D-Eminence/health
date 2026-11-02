import type { EhrBluePage } from '../types'
import { DeptUnavailable } from '../parts/DeptPage'
import { HistoryIcon } from '../parts/icons'
import { AuditCompliance } from './AuditCompliance'

export const auditPage: EhrBluePage = {
  path: 'audit',
  group: 'Insight',
  label: 'Audit & Compliance',
  permission: 'audit.read',
  // Partial, not live: it works on Health ID, but not yet with today's words and steps throughout.
  status: 'partial',
  icon: <HistoryIcon />,
  element: <AuditCompliance />,
  // Opened by its address without the permission: today's own words (staff/routes/Audit.tsx), and nothing is read.
  refusal: <DeptUnavailable title="Audit access unavailable" message="Your active facility membership needs audit.read permission to review its events." />,
}
