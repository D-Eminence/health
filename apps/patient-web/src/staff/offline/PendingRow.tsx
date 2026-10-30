import type { PendingView } from '@hid/offline'
import { Badge } from '@hid/ui'
import { OP_LABELS, pendingStateText } from './copy'
import { dayTime } from './time'

/** What a pending change shows of itself: what it is, a line of its content, and its plain state. */
function summary(view: PendingView): string {
  const body = (view.input as { body?: Record<string, unknown> } | null)?.body ?? {}
  const parts = ['title', 'chiefComplaint', 'display', 'medicationDisplay', 'testDisplay', 'content', 'status', 'reason', 'fileName']
    .map(name => body[name]).filter((value): value is string => typeof value === 'string' && value.trim() !== '')
  return parts[0] ?? ''
}

/**
 * A change saved on this device that Health ID has not confirmed. It is never shown as done: the badge and its words
 * say it is waiting, and it is never written into the chart as the server's record (§2.7 "Pending overlay").
 */
export function PendingRow({ view }: { view: PendingView }) {
  const attention = view.state === 'review' || view.state.startsWith('held_')
  const line = summary(view)
  return <div className="staff-list-item staff-stack offline-pending" data-testid="pending-row" data-command-id={view.commandId}>
    <div className="staff-row"><strong>{OP_LABELS[view.op] ?? view.label}</strong>
      <Badge tone={attention ? 'warning' : 'information'}>{attention ? 'Needs attention' : 'Not sent yet'}</Badge></div>
    {line && <p>{line}</p>}
    <p className="staff-muted">{pendingStateText(view.state, view.op)} · Saved {dayTime(view.capturedAt)}</p>
  </div>
}
