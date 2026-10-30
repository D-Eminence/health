import { EhrBadge } from '@hid/ui/ehr'
import { statusLabel } from './format'

/** A record status in the design's single blue tint ("signed", "checked-in", "in progress"). */
export function StatusBadge({ status }: { status: string }) {
  return <EhrBadge className="hid-ehr-clinical-badge">{statusLabel(status)}</EhrBadge>
}
