import { createContext, useContext, type ReactNode, type Ref } from 'react'

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
export function ProfileSection({ id, title, state, className, busy, headingRef, headingId, children }: {
  /** The card's id, which a link to it names after # (sectionFocus.ts). */
  id: string
  title: string
  state?: string | null
  className?: string
  busy?: boolean
  headingRef?: Ref<HTMLHeadingElement>
  headingId?: string
  children: ReactNode
}) {
  const sections = useContext(OpenSectionsContext)
  const card = className ? `patient-card ${className}` : 'patient-card'
  if (!sections) {
    return <div className={card} id={id} aria-busy={busy || undefined}>
      <h2 ref={headingRef} id={headingId} tabIndex={-1}>{title}</h2>
      {children}
    </div>
  }
  const open = sections.isOpen(id)
  return <div className={card} id={id} aria-busy={busy || undefined}>
    <h2 ref={headingRef} id={headingId} tabIndex={-1} className="patient-section-heading">
      <button type="button" className="patient-section-toggle" aria-expanded={open} aria-controls={`${id}-content`}
        aria-describedby={state ? `${id}-state` : undefined} onClick={() => sections.toggle(id)}>
        <span className="patient-section-title">{title}</span>
        {/* Read as the button's description, so the heading is named by its title alone. */}
        {state && <span id={`${id}-state`} className="patient-section-state" aria-hidden="true">{state}</span>}
        <svg className="patient-section-chevron" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
          <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </h2>
    <div id={`${id}-content`} className="patient-section-body" hidden={!open}>{children}</div>
  </div>
}
