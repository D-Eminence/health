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
    // A submit button still holding focus while disabled (Chromium moves it to the
    // page; other engines may not) is the step just sent, not a place the person chose.
    const lost = !(active instanceof HTMLElement) || active === document.body || !active.isConnected
      || active === element
      || (form !== null && form.contains(active) && active instanceof HTMLButtonElement && active.type === 'submit')
    if (lost) element.focus()
  }, [request])
  return {
    /** Ref for the element focus goes to on the step now shown. */
    target: useCallback((element: HTMLElement | null) => { if (element) target.current = element }, []),
    focus: useCallback(() => setRequest(value => value + 1), []),
    /** Whether focus is on the step's field now: the step is being sent with Enter there. */
    onTarget: useCallback(() => target.current !== null && document.activeElement === target.current, []),
  }
}

/** Refusals sent as 400 that are not about the value typed: the security check, the request's own key. */
const NOT_ABOUT_THE_VALUE = new Set(['TURNSTILE_REQUIRED', 'IDEMPOTENCY_KEY_INVALID'])

/**
 * Whether a refused step is about the value in its field: a malformed or
 * rejected value (400, 422), or one of the step's own codes, such as a wrong or
 * expired recovery code on the code step (`OTP_INVALID_OR_EXPIRED`, which on the
 * password step means the verification ran out, not that the password is wrong).
 * Rate limits, outages, the security check and other refusals leave the field valid.
 */
export function isFieldProblem(reason: unknown, stepCodes: readonly string[] = []): boolean {
  if (!isHidApiError(reason)) return false
  if (stepCodes.includes(reason.code)) return true
  return (reason.status === 400 || reason.status === 422) && !NOT_ABOUT_THE_VALUE.has(reason.code)
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
