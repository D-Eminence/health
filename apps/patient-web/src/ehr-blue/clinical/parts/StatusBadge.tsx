import { Badge, statusTone } from '../../../kasuwa/ui'
import { statusWords } from './format'

/** A record status in words with its tone (the shared status map), never colour alone: "Signed", "In Progress". */
export function StatusBadge({ status }: { status: string }) {
  return <Badge size="sm" tone={statusTone(status)}>{statusWords(status)}</Badge>
}
