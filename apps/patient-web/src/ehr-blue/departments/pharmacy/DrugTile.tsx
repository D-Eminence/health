import type { ReactNode } from 'react'
import { cx } from '../../../kasuwa/ui'
import { FORM_WORD, type DrugForm } from './drugForm'

/* Simple grey line drawings, one per form, on a 32-unit grid. */
const SHAPES: Readonly<Record<DrugForm, ReactNode>> = {
  tablet: <><circle cx="12" cy="17" r="7" /><path d="M7 12l10 10" /><circle cx="23.5" cy="10.5" r="4.5" /></>,
  capsule: <><rect x="4" y="11" width="24" height="10" rx="5" transform="rotate(-35 16 16)" /><path d="M13.1 20.1l5.8-8.2" /></>,
  syrup: <><path d="M12 4h8v4l3 4v15a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 9 27V12l3-4z" /><path d="M9 17h14M9 23h14" /></>,
  injection: <><path d="M21 4l7 7M24.5 7.5l-3 3M23 13L12 24l-4 0 0-4L19 9z" /><path d="M8 24l-4 4M15 13l2 2M12 16l2 2" /></>,
  cream: <><path d="M7 25l3-15h12l3 15a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 7 25z" /><path d="M12 10V6.5A1.5 1.5 0 0 1 13.5 5h5A1.5 1.5 0 0 1 20 6.5V10" /><path d="M10.5 16h11" /></>,
  inhaler: <><path d="M11 4h7a2 2 0 0 1 2 2v12h4a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /><path d="M9 18h11" /></>,
  drops: <><path d="M13 4h6v6h-6z" /><path d="M11 10h10l-1 4h-8z" /><path d="M16 18c-2.2 3-3.5 5-3.5 6.5a3.5 3.5 0 0 0 7 0c0-1.5-1.3-3.5-3.5-6.5z" /></>,
  other: <><rect x="6" y="9" width="20" height="18" rx="2.5" /><path d="M10 9V6h12v3M16 13.5v9M11.5 18h9" /></>,
}

/**
 * The drug's cover in the queue and the picking view: a soft tile with the form drawn in grey and named under it (never
 * the picture alone). Decorative to a screen reader, which hears the form in the text beside it.
 */
export function DrugTile({ form, size = 'md', className }: { readonly form: DrugForm; readonly size?: 'md' | 'lg'; readonly className?: string }) {
  return (
    <span aria-hidden="true" className={cx('flex shrink-0 flex-col items-center justify-center gap-1 rounded-xl bg-subtle text-ink-3 ring-1 ring-inset ring-line',
      size === 'lg' ? 'size-24' : 'size-[72px]', className)}>
      <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
        className={size === 'lg' ? 'size-11' : 'size-8'}>{SHAPES[form]}</svg>
      <span className="text-[11px] font-medium leading-none text-ink-3">{FORM_WORD[form]}</span>
    </span>
  )
}
