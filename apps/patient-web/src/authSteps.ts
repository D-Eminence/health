import { useCallback, useEffect, useRef, useState } from 'react'
import { isHidApiError } from '@hid/http'

/**
 * Keyboard focus for the auth forms that show one step at a time: enrollment
 * and password recovery (PA-02, PA-03, PA-04, A11Y-BR-04). Each step replaces
 * the form before it, so the control that was used is gone (or disabled while
 * the request runs) and focus falls to the page. `focus()` asks for the
 * current step's target once the render showing it has committed: after a
 * step change, the new step's field (or its heading when it has none); after a
 * refused step, the field again. Focus the person has moved elsewhere in the
 * meantime is left where it is.
 */
export function useStepFocus() {
  const target = useRef<HTMLElement | null>(null)
  const [request, setRequest] = useState(0)
  useEffect(() => {
    const element = target.current
    if (!request || !element?.isConnected) return
    const active = document.activeElement
    const form = element.closest('form')
    const lost = !(active instanceof HTMLElement) || active === document.body || !active.isConnected
      || (form !== null && form.contains(active))
    if (lost) element.focus()
  }, [request])
  return {
    /** Ref for the element focus goes to on the step now shown. */
    target: useCallback((element: HTMLElement | null) => { if (element) target.current = element }, []),
    focus: useCallback(() => setRequest(value => value + 1), []),
  }
}

/**
 * Whether a refused step is about the value in its field: a malformed or
 * rejected value (400, 422), or a recovery code that is wrong or expired.
 * Rate limits, outages and other refusals are not, and leave the field valid.
 */
export function isFieldProblem(reason: unknown): boolean {
  return isHidApiError(reason)
    && (reason.status === 400 || reason.status === 422 || reason.code === 'OTP_INVALID_OR_EXPIRED')
}

/** The aria-describedby value for ids that may be absent. */
export function describedBy(...ids: Array<string | false | null | undefined>): string | undefined {
  const present = ids.filter(Boolean)
  return present.length ? present.join(' ') : undefined
}

/** Names the browser tab after the page, which index.html names for patients only (PA-12). */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const before = document.title
    document.title = title
    return () => { document.title = before }
  }, [title])
}
