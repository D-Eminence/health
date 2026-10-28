import { useLayoutEffect, useRef, type RefObject } from 'react'
import { useLocation } from 'react-router-dom'
import { focusLost } from '../pageFocus'

/**
 * A link to a section of a page (/profile#health-information, the overview's "Add Health Information" and the
 * completion's list of what is missing) takes keyboard focus to that section's heading once the section is shown,
 * which may be only after its read: in the commit that shows it, never from a timer (NO_DEFERRED_FOCUS). Moving focus
 * there also scrolls the section into view, which the router does not do for a #. Once for each visit to the address.
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
    let id = ''
    // A pasted or cut-off link can hold a % that does not decode: it names no section.
    try { id = hash.length > 1 ? decodeURIComponent(hash.slice(1)) : '' } catch { return }
    if (!id || taken.current === key) return
    const section = document.getElementById(id)
    if (!section) return
    taken.current = key
    if (withinPage.current !== key && !focusLost() && document.activeElement !== pageHeading.current) return
    const target = section.querySelector<HTMLElement>('h2') ?? section
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
    target.focus()
  })
}
