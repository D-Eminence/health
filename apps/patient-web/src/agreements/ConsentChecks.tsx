import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from '../kasuwa/ui'
import { AgreementSheet } from './AgreementSheet'
import type { AgreementDocument } from './types'

/** Said under a required box left unticked when the form is sent. */
export const CONSENT_MISSING = 'Tick to agree before you continue.'

export interface ConsentItem {
  readonly id: string
  readonly label: ReactNode
  /** A required box must be ticked to go on; an optional one never stops anything. */
  readonly required: boolean
  /** The agreement the box is about, opened in a sheet by the link under it. */
  readonly document?: AgreementDocument
  /** The link's words, such as "Read the Terms of use". */
  readonly readLabel?: string
}

/** The required boxes not ticked, in the order shown. */
export function missingConsents(items: readonly ConsentItem[], checked: Readonly<Record<string, boolean>>): string[] {
  return items.filter(item => item.required && !checked[item.id]).map(item => item.id)
}

/**
 * Agreeing, as clickwrap is done well: the short version as a short list, then the tick boxes, every one unticked to
 * start. Each whole row is the box's label (44px tall at least), so a tap anywhere on it ticks it. A link under a box
 * opens its agreement in a sheet over the form (AgreementSheet), never a new tab. The form's button stays enabled: the
 * page checks `missingConsents` when it is sent, shows `errors` under each box missing (its description, through
 * aria-describedby) and asks for focus with `focusRequest`, which moves it to the first of them as the render that shows
 * the error commits. Nothing makes anyone scroll to the end first.
 */
export function ConsentChecks({ idPrefix, summary, items, checked, onChange, errors, focusRequest, legend = 'Agreements', className }: {
  readonly idPrefix: string
  /** The agreement whose short version is listed above the boxes. */
  readonly summary?: AgreementDocument
  readonly items: readonly ConsentItem[]
  readonly checked: Readonly<Record<string, boolean>>
  readonly onChange: (id: string, value: boolean) => void
  /** The boxes whose error is shown. */
  readonly errors: readonly string[]
  /** Increased by the page to move focus to the first box in `errors`. */
  readonly focusRequest: number
  readonly legend?: string
  readonly className?: string
}) {
  const boxes = useRef(new Map<string, HTMLInputElement>())
  const [reading, setReading] = useState<AgreementDocument | null>(null)
  // Only a new request moves focus; the errors shown in the same commit decide where.
  const handled = useRef(0)
  useLayoutEffect(() => {
    if (!focusRequest || handled.current === focusRequest) return
    handled.current = focusRequest
    const first = items.find(item => errors.includes(item.id))
    if (first) boxes.current.get(first.id)?.focus()
  }, [focusRequest, errors, items])
  const errorId = (id: string) => `${idPrefix}-${id}-error`
  const summaryId = `${idPrefix}-summary`

  return <div className={cx('flex min-w-0 flex-col gap-3', className)}>
    {summary && <div id={summaryId} className="rounded-lg px-4 py-3.5 text-sm text-ink ring-1 ring-inset ring-line">
      <p className="m-0 font-semibold">{summary.lead}</p>
      <ul className="m-0 mt-2 flex list-disc flex-col gap-1.5 pl-5 text-ink-2 marker:text-ink-3">
        {summary.short.map(line => <li key={line}>{line}</li>)}
      </ul>
    </div>}
    <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
      <legend className="sr-only">{legend}</legend>
      {items.map(item => {
        const missing = errors.includes(item.id)
        return <div key={item.id} className="flex min-w-0 flex-col">
          <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5 text-[15px] leading-snug text-ink">
            <input ref={element => { if (element) boxes.current.set(item.id, element); else boxes.current.delete(item.id) }}
              type="checkbox" className="mt-px size-5 shrink-0 cursor-pointer accent-[var(--color-brand-fill)]"
              checked={checked[item.id] === true} required={item.required || undefined}
              onChange={event => onChange(item.id, event.target.checked)}
              aria-invalid={missing || undefined} aria-describedby={missing ? errorId(item.id) : undefined} />
            <span className="min-w-0">{item.label}</span>
          </label>
          {missing && <p id={errorId(item.id)} className="m-0 -mt-1 pl-8 text-xs font-medium text-danger-ink">{CONSENT_MISSING}</p>}
          {item.document && <button type="button" onClick={() => setReading(item.document!)}
            className="ml-8 inline-flex min-h-11 cursor-pointer items-center self-start border-0 bg-transparent p-0 text-left font-[inherit] text-sm font-medium text-brand-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]">
            {item.readLabel ?? 'Read the full agreement'}</button>}
        </div>
      })}
    </fieldset>
    {reading && <AgreementSheet document={reading} open onClose={() => setReading(null)} />}
  </div>
}
