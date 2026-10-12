import { useEffect, useRef, type RefObject } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * A page change that takes away the control the user was on (Back or Forward, a
 * link inside the page, a step that opens another page, a facility switch) would
 * leave focus on the document, and a keyboard or screen reader user would start
 * again from the top. Focus moves to the new page's heading instead, or to the
 * main region while the page has none. A control still on screen, such as the
 * navigation link just followed, keeps focus, and the first page shown is left
 * as the browser opened it.
 */
export function useFocusOnPageChange(main: RefObject<HTMLElement | null>): void {
  const { pathname } = useLocation()
  const shown = useRef(pathname)
  useEffect(() => {
    if (shown.current === pathname) return
    shown.current = pathname
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body && active.isConnected) return
    focusPageHeading(main.current)
  }, [pathname, main])
}

/** Moves focus to the page's heading in `main`, or to `main` while the page has none. */
export function focusPageHeading(main: HTMLElement | null): void {
  const target = main?.querySelector<HTMLElement>('h1') ?? main
  if (!target) return
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
  target.focus()
}
