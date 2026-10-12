import { useCallback, useEffect, useState } from 'react'
import { useStaff } from './App'

/**
 * A control whose request is running is marked unavailable (aria-disabled), not
 * disabled: a disabled button loses focus to the page (Chromium moves it to the
 * body), so a keyboard or screen reader user would start again from the top.
 * Its handler ignores a press meanwhile. Dimmed, as a disabled one is.
 */
export const BUSY = 'aria-disabled:opacity-45 aria-disabled:cursor-not-allowed'

/** Whether focus has nowhere the user chose: on the page itself, or on `target` already. */
export function focusIsLost(target: HTMLElement | null): boolean {
  const active = document.activeElement
  return !(active instanceof HTMLElement) || active === document.body || !active.isConnected || active === target
}

interface FocusRequest { readonly ids: readonly string[]; readonly ifLost: boolean; readonly wait: boolean }

/**
 * Focuses the first element present of `ids` once the render showing it has
 * committed. A step's control is unavailable while its request runs, and a step
 * may remove it (a form rebuilt for the record's new version, a list read
 * again), so a step gives focus to where the work continues (`ifLost`) only if
 * focus was lost: a user who went to another field while it ran keeps it there.
 * With `wait`, the request stands until a later render of the component that
 * made it shows the element (a list read again after the step). A request made
 * while the workspace is locked waits until it opens again: until then focus is
 * on the session check, which is not the user's choice, and nothing in the
 * hidden workspace can take it.
 */
export function useFocusById() {
  const { lock } = useStaff()
  const [request, setRequest] = useState<FocusRequest | null>(null)
  // After every render, so an element a later render shows is found then.
  useEffect(() => {
    if (!request || lock != null) return
    const target = request.ids.map(id => document.getElementById(id)).find(element => element !== null) ?? null
    if (!target && request.wait) return
    setRequest(null)
    if (!request.ifLost || focusIsLost(target)) target?.focus()
  })
  return useCallback((ids: string | readonly string[], ifLost = false, wait = false) =>
    setRequest({ ids: typeof ids === 'string' ? [ids] : ids, ifLost, wait }), [])
}
