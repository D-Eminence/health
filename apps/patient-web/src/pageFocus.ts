import { useEffect, useRef, type RefObject } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * A page change that takes away the control the user was on (Back or Forward, a
 * link inside the page, a step that opens another page, a facility switch) would
 * leave focus on the document, and a keyboard or screen reader user would start
 * again from the top. Focus moves to the new page's heading instead, or to the
 * main region while the page has none. A control still on screen, such as the
 * navigation link just followed, keeps focus (a button disabled as the page
 * changed does not: see focusLost), and the first page shown is left
 * as the browser opened it. `locked` holds the change while the provider
 * workspace is locked. Used by the patient portal and the provider workspace.
 */
export function useFocusOnPageChange(main: RefObject<HTMLElement | null>, locked = false): void {
  const { pathname } = useLocation()
  const shown = useRef(pathname)
  useEffect(() => {
    // A page opened while the workspace is locked (hidden and inert, focus on the
    // check) is taken up when the workspace opens again.
    if (locked || shown.current === pathname) return
    shown.current = pathname
    if (!focusLost()) return
    focusPageHeading(main.current)
  }, [pathname, main, locked])
}

/** Moves focus to the page's heading in `main`, or to `main` while the page has none. */
export function focusPageHeading(main: HTMLElement | null): void {
  const target = main?.querySelector<HTMLElement>('h1') ?? main
  if (!target) return
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
  target.focus()
}

/**
 * Whether keyboard focus has nowhere useful to stay: on the page itself, on a
 * control no longer shown, or on a button disabled while its action ran
 * (Chromium moves focus to the page as a focused control is disabled; other
 * engines may keep it there).
 */
export function focusLost(): boolean {
  const active = document.activeElement
  return !(active instanceof HTMLElement) || active === document.body || !active.isConnected
    || (active instanceof HTMLButtonElement && active.disabled)
}
