import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useLocation } from 'react-router-dom'
import { focusLost } from '../pageFocus'
import type { OpenSections } from './ProfileSection'

/** The section an address names after its #, or '' for none: a pasted or cut-off link can hold a % that does not decode. */
function sectionNamed(hash: string): string {
  try { return hash.length > 1 ? decodeURIComponent(hash.slice(1)) : '' } catch { return '' }
}

/**
 * A link to a section of a page (/profile#health-information, the overview's "Add Health Information" and the
 * completion's list of what is missing) takes keyboard focus to that section's heading once the section is shown,
 * which may be only after its read: in the commit that shows it, never from a timer (NO_DEFERRED_FOCUS). Moving focus
 * there also scrolls the section into view, which the router does not do for a #. Once for each visit to the address.
 * A section shown closed until opened (the profile's: ProfileSection.tsx, opened by useOpenSections as the visit
 * begins) is headed by the button that opens it, and focus goes to that button, which says the section is open. A part
 * of one with an id (PROFILE_SECTION_PARTS in Portal.tsx) takes focus to its own h3, or itself where it has none (the
 * profile's #contact-details).
 *
 * Arriving from another page, focus moves only while it has nowhere useful to stay, or is still on the page's own
 * heading where the page change put it. A link on the same page to one of its own sections (only the part after #
 * changed, as the profile's completion list does), or Back and Forward between them, is the patient asking to go
 * there: focus moves although it is still on the link just followed.
 */
export function useFocusSectionFromHash(pageHeading: RefObject<HTMLElement | null>): void {
  const { pathname, hash, key } = useLocation()
  const taken = useRef<string | null>(null)
  // The address this page last showed, and the latest visit that changed only its #.
  const shown = useRef({ pathname, key })
  const withinPage = useRef<string | null>(null)
  // After every commit: the section may appear in any of them.
  useLayoutEffect(() => {
    if (shown.current.key !== key) {
      if (shown.current.pathname === pathname) withinPage.current = key
      shown.current = { pathname, key }
    }
    const id = sectionNamed(hash)
    if (!id || taken.current === key) return
    const section = document.getElementById(id)
    if (!section) return
    taken.current = key
    if (withinPage.current !== key && !focusLost() && document.activeElement !== pageHeading.current) return
    // A part of a section (#access-pin, #emergency-contacts) is headed by its own h3.
    const heading = section.querySelector<HTMLElement>('h2') ?? section.querySelector<HTMLElement>(':scope > h3')
    const toggle = heading?.querySelector<HTMLElement>(':scope > button[aria-expanded]')
    if (toggle) { toggle.focus(); return }
    const target = heading ?? section
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
    target.focus()
  })
}

/**
 * The sections of a page shown closed until the patient opens one (the profile's: ProfileSection.tsx), for
 * OpenSectionsContext. Each visit to an address naming one after its # (a link above, Back or Forward) opens it in the
 * render that begins the visit, so the commit that shows the section shows it open, and useFocusSectionFromHash moves
 * focus to its heading in that same commit. A part of a section with an id of its own (`parts`: the profile's contact
 * details and Access PIN, in Bio-data, and emergency contacts, in Health information) opens the section that holds it,
 * and focus goes to the part. Kept in this page's memory only:
 * every section is closed again when the page is next opened.
 */
export function useOpenSections(parts: Readonly<Record<string, string>> = {}): OpenSections {
  const { hash, key } = useLocation()
  const asked = sectionNamed(hash)
  const named = (Object.hasOwn(parts, asked) ? parts[asked] : undefined) ?? asked
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(named ? [named] : []))
  const [visit, setVisit] = useState(key)
  if (visit !== key) {
    setVisit(key)
    if (named && !open.has(named)) setOpen(new Set([...open, named]))
  }
  const toggle = useCallback((id: string) => setOpen(current => {
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
  }), [])
  return useMemo(() => ({ isOpen: (id: string) => open.has(id), toggle }), [open, toggle])
}
