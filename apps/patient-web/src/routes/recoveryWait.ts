import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * What a refused recovery code may mean (hid-system #55, identity otp.service.ts
 * verify): wrong codes count against one budget per account, and by default the
 * fifth within 15 minutes refuses every code, a correct one too, for 15 minutes,
 * during which a new start sends no code. Every refusal is the same 403
 * OTP_INVALID_OR_EXPIRED, so the page cannot tell which happened.
 */
export const CODE_BUDGET_HINT = 'After 5 wrong codes within 15 minutes, every code is refused, even a correct one, and no new code is sent, for 15 minutes. If that may have happened, wait before starting again.'

/**
 * Whether a recovery may start again for a new code: a start within the previous
 * one's `resendAfterSeconds` answers the same challenge and sends nothing
 * (hid-system #55). A start that names no wait may start again at once.
 */
export function useResendWait() {
  const [ready, setReady] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const begin = useCallback((seconds: unknown) => {
    clearTimeout(timer.current)
    const wait = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0
    setReady(wait === 0)
    if (wait > 0) timer.current = setTimeout(() => setReady(true), wait)
  }, [])
  const reset = useCallback(() => { clearTimeout(timer.current); setReady(false) }, [])
  return { ready, begin, reset }
}
