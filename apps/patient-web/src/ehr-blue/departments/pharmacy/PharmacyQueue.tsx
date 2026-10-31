import { Fragment, type ReactNode } from 'react'
import { ChevronRight, TriangleAlert } from 'lucide-react'
import { Badge, cx, timeAgo, type Tone } from '../../../kasuwa/ui'
import type { PharmacyWorkItem } from '../../../staff/api'
import { QueuePatient } from '../parts/WorkQueue'
import { DrugTile } from './DrugTile'
import { drugFormOf, FORM_WORD, nameAndStrength } from './drugForm'
import { DOSE_MISSING, doseText, statusWord, type PharmacyStatus } from './pharmacyText'

/*
 * The pharmacy queue as large cards, one per prescription, made for a counter tablet and a phone. Each card leads with
 * the drug (its form drawn, its name large, strength and form under it), then the dose and how often with units, then
 * who it is for, smaller. The whole card is one button that opens the picking view; its name is the medicine as
 * prescribed, and the rest of the card describes it.
 */

export interface PharmacyCardProps {
  readonly item: PharmacyWorkItem
  readonly buttonId: string
  readonly status: PharmacyStatus
  readonly tone: Tone
  /** The dose or how often is missing on work not yet dispensed: "Can't dispense: dose missing". */
  readonly missing: boolean
  readonly patientFallback: string
  /** When it was accepted, as the record says it: shown on hover; the card says how long it has waited. */
  readonly when: string
  /** Under the card, outside its button: what was said about it, where it came from. */
  readonly below?: ReactNode
  /** Beside the status: the bill (Paid, Unpaid ₦x) and stock (Out of stock), in words with an icon. */
  readonly badges?: ReactNode
  readonly onOpen: () => void
}

export function PharmacyCard({ item, buttonId, status, tone, missing, patientFallback, when, below, badges, onOpen }: PharmacyCardProps) {
  const form = drugFormOf(item)
  const { name, strength } = nameAndStrength(item.medication.display)
  const dose = doseText(item)
  const detailId = `${buttonId}-detail`
  return (
    <li className={cx('flex min-w-0 flex-col overflow-hidden rounded-2xl bg-surface shadow-[var(--shadow-card)] ring-1',
      missing ? 'ring-warn/60' : 'ring-line')}>
      <button type="button" id={buttonId} onClick={onOpen} aria-label={item.medication.display} aria-describedby={detailId}
        className="flex w-full flex-1 cursor-pointer items-start gap-4 border-0 bg-transparent p-4 text-left text-ink transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring-color)] sm:p-5">
        <DrugTile form={form} />
        <span id={detailId} className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge size="sm" tone={tone}>{statusWord(status)}</Badge>
            {missing ? <span className="inline-flex items-center gap-1 rounded-md bg-warn-soft px-2 py-0.5 text-[12px] font-semibold text-warn-ink">
              <TriangleAlert className="size-3.5" aria-hidden />{DOSE_MISSING}</span> : null}
            {badges}
          </span>
          <span className="text-[19px] font-semibold leading-tight text-ink [overflow-wrap:break-word] sm:text-[21px]"><Breakable text={name} /></span>
          <span className="text-[14px] text-ink-2">{[strength, FORM_WORD[form]].filter(Boolean).join(' · ')}</span>
          <span className="mt-1 text-[15px] font-medium text-ink tabular [overflow-wrap:anywhere]">
            {dose ?? <span className="text-warn-ink">Dose not recorded</span>}
            <span className="text-ink-3"> · </span>
            {item.frequency?.trim() || <span className="text-warn-ink">How often not recorded</span>}
          </span>
          {item.instructions ? <span className="text-[13px] text-ink-2 [overflow-wrap:anywhere]">{item.instructions}</span> : null}
          <span className="mt-2 flex flex-wrap items-end justify-between gap-x-3 gap-y-1 border-t border-line pt-2 text-[13px]">
            <span className="min-w-0"><span className="sr-only">For </span><QueuePatient patient={item.patient} fallback={patientFallback} /></span>
            <span className="text-ink-3 tabular" title={`Accepted ${when}`}>{item.dispensing ? `Accepted ${timeAgo(item.acceptedAt)}` : `Waiting ${timeAgo(item.acceptedAt).replace(/ ago$/, '')}`}</span>
          </span>
        </span>
        <ChevronRight className="mt-1 hidden size-5 shrink-0 text-ink-3 sm:block" aria-hidden />
      </button>
      {below ? <div className="flex flex-col gap-2 border-t border-line px-4 py-3 sm:px-5">{below}</div> : null}
    </li>
  )
}

/** The cards: one column on a phone, two on a counter tablet, three on a wide screen. */
export function PharmacyCards({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return <ul aria-label={label} className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 2xl:grid-cols-3">{children}</ul>
}

/** A drug name that may wrap after a slash ("Artemether/ Lumefantrine"), never in the middle of a word. */
export function Breakable({ text }: { readonly text: string }) {
  const parts = text.split('/')
  return <>{parts.map((part, index) => <Fragment key={index}>{index > 0 ? <>/<wbr /></> : null}{part}</Fragment>)}</>
}
