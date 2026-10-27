import { useCallback, useLayoutEffect, useState } from 'react'
import { focusLost } from '../pageFocus'
import { useStaff } from './App'

/**
 * A control whose request is running is marked unavailable (aria-disabled), not
 * disabled: a disabled button loses focus to the page (Chromium moves it to the
 * body), so a keyboard or screen reader user would start again from the top.
 * Its handler ignores a press meanwhile. Dimmed, as a disabled one is.
 */
export const BUSY = 'aria-disabled:opacity-45 aria-disabled:cursor-not-allowed'
/** BUSY for a secondary button, without its tone's hover and press look while unavailable. */
export const UNAVAILABLE = `${BUSY} aria-disabled:hover:border-line-strong aria-disabled:hover:bg-surface aria-disabled:hover:text-ink aria-disabled:active:bg-surface`
/** BUSY for a quiet button, without its tone's hover and press look while unavailable. */
export const QUIET_UNAVAILABLE = `${BUSY} aria-disabled:hover:bg-transparent aria-disabled:active:bg-transparent`

/**
 * Whether focus has nowhere the user chose: lost as the portals judge it
 * (focusLost: on the page itself, on a control no longer shown, or on a button
 * disabled while its action ran), or on `target` already.
 */
export function focusIsLost(target: HTMLElement | null): boolean {
  return focusLost() || document.activeElement === target
}

interface FocusRequest { readonly ids: readonly string[]; readonly ifLost: boolean }

/**
 * Focuses the first element present of `ids` once the render showing it has
 * committed. A step's control is unavailable while its request runs, and a step
 * may remove it (a form rebuilt for the record's new version, a list read
 * again), so a step gives focus to where the work continues (`ifLost`) only if
 * focus was lost: a user who went to another field while it ran keeps it there.
 * A request made while the workspace is locked waits until it opens again: until
 * then focus is on the session check, which is not the user's choice, and
 * nothing in the hidden workspace can take it.
 */
export function useFocusById() {
  const { lock } = useStaff()
  const [request, setRequest] = useState<FocusRequest | null>(null)
  // In the commit that shows the target, not an effect a task later: a check made as soon as it is shown finds the
  // focus moved. Clearing the request renders again at once, and that render, with no request, leaves focus alone.
  useLayoutEffect(() => {
    if (!request || lock != null) return
    // Clears only the request handled here: one made since (by a layout effect earlier in this commit) keeps its turn.
    setRequest(current => current === request ? null : current)
    const target = request.ids.map(id => document.getElementById(id)).find(element => element !== null) ?? null
    if (!request.ifLost || focusIsLost(target)) target?.focus()
  }, [request, lock])
  return useCallback((ids: string | readonly string[], ifLost = false) =>
    setRequest({ ids: typeof ids === 'string' ? [ids] : ids, ifLost }), [])
}
