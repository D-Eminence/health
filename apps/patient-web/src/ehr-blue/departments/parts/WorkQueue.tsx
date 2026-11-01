import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Badge, Card, cx, statusTone, type Tone } from '../../../kasuwa/ui'
import { priorityLabel } from '../../../staff/orderRoutes'
import { birthDateText } from './format'

/*
 * A department's work queue (Laboratory, Pharmacy) in the shared parts: one card of rows, the most urgent first. Each
 * row is one button that opens the record (no separate Quick view), so the whole row is the target. On a computer the
 * row lines up under the column names; on a phone it stacks, so nothing scrolls sideways.
 */

export interface QueueRow {
  readonly id: string
  /** The row button's id: focus returns here from the record. */
  readonly buttonId: string
  readonly title: string
  /** Under the title: a dose, an accession number. */
  readonly detail?: ReactNode
  readonly patient: ReactNode
  readonly priority?: string | null
  readonly status: string
  readonly statusTone?: Tone
  /** Beside the status, in words: "Can't dispense: dose missing". */
  readonly flag?: ReactNode
  readonly when: string
  /** Under the row, outside the button: what was said about it, where it came from. */
  readonly below?: ReactNode
  readonly onOpen: () => void
}

const RANK: Readonly<Record<string, number>> = { stat: 0, asap: 1, urgent: 2 }

/**
 * A priority's place in a queue: stat 0, as soon as possible 1, urgent 2, and 3 for routine, none or anything else, so
 * work with no priority keeps the order it had.
 */
export function urgencyRank(priority: string | null | undefined): number {
  return RANK[(priority ?? '').toLowerCase()] ?? 3
}

/** Whether a priority puts work ahead of routine work, and marks it: stat, as soon as possible, or urgent. */
export function isUrgent(priority: string | null | undefined): boolean {
  return urgencyRank(priority) < 3
}

/** Stat, then as soon as possible, then urgent, then the rest, each group in the order it came. */
export function urgentFirst<T>(items: readonly T[], priorityOf: (item: T) => string | null | undefined): T[] {
  return items.map((item, index) => ({ item, index, rank: urgencyRank(priorityOf(item)) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index).map(entry => entry.item)
}

/** A priority in words, with a tone that matches its urgency (never colour alone). */
export function PriorityBadge({ priority }: { readonly priority: string | null | undefined }) {
  const label = priorityLabel(priority ?? null)
  if (!label) return <span className="text-[13px] text-ink-3">Not set</span>
  const key = (priority ?? '').toLowerCase()
  const tone: Tone = key === 'stat' ? 'danger' : key === 'asap' || key === 'urgent' ? 'warn' : 'neutral'
  return <Badge size="sm" tone={tone}>{label === 'As soon as possible' ? 'ASAP' : label}</Badge>
}

/** A status word in Title Case: "not dispensable" is "Not Dispensable". */
export function statusTitle(status: string) {
  return status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase())
}

/**
 * Who the work is for: the name and date of birth when the service sends them (to match a sample or a medicine to a
 * person), else the masked reference it sends.
 */
export function QueuePatient({ patient, fallback }: {
  readonly patient?: { readonly fullName: string; readonly dateOfBirth: string | null } | null
  readonly fallback: string
}) {
  if (!patient) return <span className="text-ink-2">{fallback}</span>
  const born = birthDateText(patient.dateOfBirth)
  return <span className="flex min-w-0 flex-col">
    <span className="truncate font-medium text-ink">{patient.fullName}</span>
    {born ? <span className="text-[13px] text-ink-3">Born {born}</span> : null}
  </span>
}

const GRID = '@3xl:grid @3xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_7rem_minmax(0,1.2fr)_9.5rem_1rem] @3xl:items-center @3xl:gap-4'

export function WorkQueue({ label, titleHeader, rows, priority = true }: {
  /** The list's accessible name: "Lab work". */
  readonly label: string
  /** The first column: "Test", "Medicine". */
  readonly titleHeader: string
  readonly rows: readonly QueueRow[]
  /** Whether the service sends a priority for this work. */
  readonly priority?: boolean
}) {
  return (
    <Card>
      <div aria-hidden="true" className={cx('hidden border-b border-line bg-subtle px-5 py-2.5 text-[12px] font-medium text-ink-3', GRID)}>
        <span>{titleHeader}</span><span>Patient</span><span>{priority ? 'Priority' : ''}</span><span>Status</span><span>Accepted</span><span />
      </div>
      <ul aria-label={label} className="m-0 list-none divide-y divide-line p-0">
        {rows.map(row => (
          <li key={row.id}>
            <button type="button" id={row.buttonId} onClick={row.onOpen}
              className={cx('flex w-full cursor-pointer flex-col gap-1.5 border-0 bg-transparent px-5 py-3.5 text-left text-sm text-ink transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]', GRID)}>
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold text-ink break-words">{row.title}</span>
                {row.detail ? <span className="text-[13px] text-ink-3">{row.detail}</span> : null}
              </span>
              <QueueCell label="Patient">{row.patient}</QueueCell>
              <QueueCell label="Priority">{priority ? <PriorityBadge priority={row.priority} /> : null}</QueueCell>
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge size="sm" tone={row.statusTone ?? statusTone(row.status)}>{statusTitle(row.status)}</Badge>
                {row.flag}
              </span>
              <span className="text-[13px] text-ink-2 tabular">{row.when}</span>
              <ChevronRight className="hidden size-4 text-ink-3 @3xl:block" aria-hidden />
            </button>
            {row.below ? <div className="flex flex-col gap-2 px-5 pb-3.5">{row.below}</div> : null}
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** A cell that names itself on a phone, where there is no header row above it. */
function QueueCell({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  if (children === null || children === undefined) return <span className="hidden @3xl:block" />
  return <span className="flex min-w-0 items-baseline gap-2"><span className="text-[12px] text-ink-3 @3xl:hidden">{label}</span>{children}</span>
}
