import { getConfig } from '@testing-library/react'

/** An element as it was first shown, and where focus was at that moment. */
export interface Shown<T extends Element> { element: T; focused: Element | null }

/**
 * Where focus is at the moment an element is shown: public-web's copy of
 * patient-web's src/__tests__/focusWhenShown.ts, since one app may not import
 * from another. React commits a render and runs its layout effects in one
 * synchronous stack; a MutationObserver callback runs as a microtask right after
 * it, before an effect, a timer or an animation frame a task later. findBy and
 * waitFor resolve from such a callback too, so a focus moved any later was seen
 * only when the runner was quick enough (it was not on health#16's CI). Taken
 * here, focus moved any later fails every time.
 *
 * Call it before the action, then await it: it resolves with the element once it
 * is in the document, and document.activeElement read in that same callback. An
 * element already there is taken at once, so `find` should match only what the
 * action shows. `find` is a selector, or a function returning the element (a
 * query such as screen.queryByRole, or a search of the document). It gives up
 * after the wait findBy allows.
 */
export function focusWhenShown<T extends Element = Element>(find: string | (() => T | null | undefined)): Promise<Shown<T>> {
  const lookup = typeof find === 'string' ? () => document.querySelector<T>(find) : find
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => check())
    const timer = setTimeout(() => done(() => reject(new Error(`Nothing matching ${String(find)} was shown.`))),
      getConfig().asyncUtilTimeout)
    function done(settle: () => void) {
      observer.disconnect()
      clearTimeout(timer)
      settle()
    }
    function check() {
      try {
        const element = lookup()
        if (element?.isConnected) done(() => resolve({ element, focused: document.activeElement }))
      } catch (reason) {
        done(() => reject(reason))
      }
    }
    observer.observe(document, { childList: true, subtree: true, characterData: true, attributes: true })
    check()
  })
}
