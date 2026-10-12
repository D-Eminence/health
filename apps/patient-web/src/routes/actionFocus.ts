import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

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

/**
 * Keyboard focus after an action on a portal page (PR-03, PR-05). The control
 * that ran it is disabled while the request runs and is often gone once the page
 * shows the outcome: the item was decided, the form closed. `focusAfter(find)`
 * moves focus to the element `find` returns once the render showing the outcome
 * has committed, and only when focus was lost there: focus the person moved
 * elsewhere in the meantime stays where it is.
 */
export function useActionFocus() {
  const target = useRef<(() => HTMLElement | null) | null>(null)
  const [request, setRequest] = useState(0)
  useEffect(() => {
    const find = target.current
    target.current = null
    const element = find?.()
    if (element?.isConnected && focusLost()) element.focus()
  }, [request])
  return useCallback((find: () => HTMLElement | null) => { target.current = find; setRequest(value => value + 1) }, [])
}

/**
 * Keyboard focus after 'Try again' (PR-04), which the loading state replaces.
 * Once the load ends focus goes to `target` (the heading of what loaded), or to
 * the new 'Try again' when the load failed again, and only when focus was lost.
 * Give `button` to the 'Try again' button and call `retried` as it is pressed.
 */
export function useRetryFocus(loading: boolean, error: string | null, target: RefObject<HTMLElement | null>) {
  const retrying = useRef(false)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (loading || !retrying.current) return
    retrying.current = false
    const element = error ? button.current : target.current
    if (element?.isConnected && focusLost()) element.focus()
  }, [loading, error, target])
  return { button, retried: useCallback(() => { retrying.current = true }, []) }
}
