import { AUDIT_WORK, refusedWorkText } from '../../../staff/refusedWork'
import type { EhrBluePage } from '../types'
import { useDeptAccess } from '../parts/access'
import { DeptUnavailable } from '../parts/DeptPage'
import { HistoryIcon } from '../parts/icons'
import { AuditCompliance } from './AuditCompliance'

/**
 * Opened by its address without the permission: the page's own refusal, in the classic page's words
 * (staff/routes/Audit.tsx), and nothing is read. They name no permission, only what the role here does not include
 * (owner rule: no codes on screen), chosen by who reads them (refusedWorkText): a self-signed-up facility's
 * administrator is never told to ask themselves.
 */
function AuditUnavailable() {
  const { facility, permissions } = useDeptAccess()
  return <DeptUnavailable title="Audit access unavailable" message={refusedWorkText(facility, permissions, AUDIT_WORK)} />
}

export const auditPage: EhrBluePage = {
  path: 'audit',
  group: 'Insight',
  label: 'Audit trail',
  permission: 'audit.read',
  // Live: it works on Health ID, in the classic page's words and steps throughout (parity report 3.3-74).
  status: 'live',
  icon: <HistoryIcon />,
  element: <AuditCompliance />,
  refusal: <AuditUnavailable />,
}
