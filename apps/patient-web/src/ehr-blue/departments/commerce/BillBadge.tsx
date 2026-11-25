import { CircleCheck, CircleDashed, Clock, Hourglass, Wallet } from 'lucide-react'
import { Badge } from '../../../kasuwa/ui'
import type { WorkItemBill } from './api'
import { naira } from './money'

/**
 * A work item's bill in one word or two, for the pharmacy and lab queues: Paid · Unpaid ₦x · Part paid · Waiting for
 * check · Bill follows · Not billed. "Bill follows" for an emergency and for an unknown patient (BILL-3: served first,
 * billed later, always), whatever is still due. Said in words with an icon, never by colour alone.
 */
export function BillBadge({ bill, size = 'sm', className }: { readonly bill: WorkItemBill | undefined; readonly size?: 'sm' | 'md'; readonly className?: string }) {
  if (!bill) return <Badge size={size} tone="neutral" icon={CircleDashed} className={className}>Not billed</Badge>
  if (bill.status !== 'void' && bill.status !== 'paid' && bill.deferred) return <Badge size={size} tone="info" icon={Clock} className={className}>Bill follows</Badge>
  if (bill.status !== 'void' && bill.status !== 'paid' && (bill.pendingCheckKobo ?? 0) > 0 && bill.dueKobo === 0) {
    return <Badge size={size} tone="info" icon={Hourglass} className={className}>Waiting for check</Badge>
  }
  switch (bill.status) {
    case 'paid':
      return <Badge size={size} tone="success" icon={CircleCheck} className={className}>Paid</Badge>
    case 'part_paid':
      return <Badge size={size} tone="warn" icon={Hourglass} className={className}>
        Part paid<span className="sr-only">, {naira(bill.dueKobo)} left</span>
      </Badge>
    case 'deferred':
      return <Badge size={size} tone="info" icon={Clock} className={className}>Bill follows</Badge>
    case 'void':
      return <Badge size={size} tone="neutral" icon={CircleDashed} className={className}>Not billed</Badge>
    case 'unpaid':
    default:
      return <Badge size={size} tone="warn" icon={Wallet} className={className}>
        Unpaid <span className="tabular">{naira(bill.dueKobo)}</span>
      </Badge>
  }
}
