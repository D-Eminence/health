import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { focusLost } from '../pageFocus'

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
  // In the commit that shows the outcome, not an effect a task later: a check
  // made as soon as it is shown finds the focus moved.
  useLayoutEffect(() => {
    const find = target.current
    target.current = null
    const element = find?.()
    if (element?.isConnected && focusLost()) element.focus()
  }, [request])
  return useCallback((find: () => HTMLElement | null) => { target.current = find; setRequest(value => value + 1) }, [])
}

/**
 * Keyboard focus after 'Try again' (PR-04), which the loading state replaces.
 * `retry(reload)` runs the reload, and once the load it asked for has ended and
 * the render showing its outcome has committed, focus goes to `target` (the
 * heading of what loaded), or to the new 'Try again' when the load failed again,
 * and only when focus was lost. It waits on the reload itself, not on the loading
 * state: an effect still pending from the render that showed 'Try again' runs
 * after a quick press, and would take the press for the outcome. Give `button`
 * to the 'Try again' button.
 */
export function useRetryFocus(target: RefObject<HTMLElement | null>) {
  const button = useRef<HTMLButtonElement>(null)
  const focusAfter = useActionFocus()
  const retry = useCallback((reload: () => Promise<unknown>) => {
    void reload().then(() => focusAfter(() => button.current ?? target.current))
  }, [focusAfter, target])
  return { button, retry }
}

/**
 * A focus target found when focus moves, for an element another component draws (a card's heading, the Health ID
 * card): `find` runs then, and what it finds is made focusable from script only (tabindex -1), as a page's heading is
 * (pageFocus.ts). For useRetryFocus and useActionFocus, which read `current` only once the outcome is shown.
 */
export function foundTarget(find: () => HTMLElement | null | undefined): RefObject<HTMLElement | null> {
  return {
    get current() {
      const element = find() ?? null
      if (element && !element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1')
      return element
    },
  }
}

/**
 * 'Try again' that reads once per press (HCS-20): a second press while the read it asked for is still running does
 * nothing, however fast it comes (a double click lands before the loading state takes the button away). Focus then
 * goes where useRetryFocus sends it. Give `button` to the 'Try again' button.
 */
export function useRetryOnce(target: RefObject<HTMLElement | null>) {
  const { button, retry: retryWithFocus } = useRetryFocus(target)
  const running = useRef(false)
  const retry = useCallback((reload: () => Promise<unknown>) => {
    if (running.current) return
    running.current = true
    retryWithFocus(() => reload().finally(() => { running.current = false }))
  }, [retryWithFocus])
  return { button, retry }
}
