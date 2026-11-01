import { createContext, useContext, type ReactNode, type Ref } from 'react'
import { ChevronDown } from 'lucide-react'
import { Card, cx } from '../kasuwa/ui'

/** Which of a page's sections are open, and opening or closing one (useOpenSections in sectionFocus.ts). */
export interface OpenSections {
  isOpen: (id: string) => boolean
  toggle: (id: string) => void
}

/** Given by the profile page, whose sections start closed. Elsewhere there is none, and a section is the open card it was. */
export const OpenSectionsContext = createContext<OpenSections | null>(null)

/**
 * A section card on the profile page, closed until the patient opens it (the owner's decision of 2026-10-28): its
 * heading holds the button that opens and closes it and says which it is (aria-expanded), with a chevron and, where it
 * helps the patient decide to open it, a short `state` from what the page has already read (the button's description).
 * Closed, it is the same card showing only its heading. What it holds stays mounted while closed, only hidden, so a
 * half-filled form keeps what was typed. The heading keeps tabIndex -1, `headingRef` and `headingId`: a flow in the
 * card that ends with focus on its heading still does. Outside the profile (no OpenSectionsContext), it is the card it
 * was, open, under a plain heading.
 */
export function ProfileSection({ id, title, state, className, busy, headingRef, headingId, tone, children }: {
  /** The card's id, which a link to it names after # (sectionFocus.ts). */
  id: string
  title: string
  state?: string | null
  className?: string
  busy?: boolean
  headingRef?: Ref<HTMLHeadingElement>
  headingId?: string
  /** 'danger' for a section whose action can't be undone (Delete account). */
  tone?: 'danger'
  children: ReactNode
}) {
  const sections = useContext(OpenSectionsContext)
  const body = <div className="flex flex-col gap-4 border-t border-line p-5">{children}</div>
  if (!sections) {
    return <Card id={id} aria-busy={busy || undefined} className={className}>
      <h2 ref={headingRef} id={headingId} tabIndex={-1} className={cx('m-0 px-5 py-4 text-title-3 outline-none', tone === 'danger' ? 'text-danger-ink' : 'text-ink')}>{title}</h2>
      {body}
    </Card>
  }
  const open = sections.isOpen(id)
  return <Card id={id} aria-busy={busy || undefined} className={className}>
    <h2 ref={headingRef} id={headingId} tabIndex={-1} className="m-0 outline-none">
      <button type="button" aria-expanded={open} aria-controls={`${id}-content`}
        aria-describedby={state ? `${id}-state` : undefined} onClick={() => sections.toggle(id)}
        className="flex min-h-14 w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-5 py-3 text-left font-[inherit] hover:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]">
        <span className={cx('min-w-0 flex-1 text-title-3', tone === 'danger' ? 'text-danger-ink' : 'text-ink')}>{title}</span>
        {/* Read as the button's description, so the heading is named by its title alone. */}
        {state && <span id={`${id}-state`} className="shrink-0 text-[13px] font-normal text-ink-3" aria-hidden="true">{state}</span>}
        <ChevronDown aria-hidden="true" className={cx('size-5 shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
    </h2>
    <div id={`${id}-content`} hidden={!open}>{body}</div>
  </Card>
}
