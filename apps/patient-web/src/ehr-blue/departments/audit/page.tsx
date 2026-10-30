import type { EhrBluePage } from '../types'
import { HistoryIcon } from '../parts/icons'
import { AuditCompliance } from './AuditCompliance'

export const auditPage: EhrBluePage = {
  path: 'audit',
  group: 'Insight',
  label: 'Audit & Compliance',
  permission: 'audit.read',
  status: 'live',
  icon: <HistoryIcon />,
  element: <AuditCompliance />,
}
