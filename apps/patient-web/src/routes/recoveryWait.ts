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
 * Whether a recovery may start again for a new code: a start for the same
 * identifier within the previous one's `resendAfterSeconds` answers the same
 * challenge and sends nothing (hid-system #55; migration 0081 keys the wait by
 * identifier). A start for the same account's other identifier (its email after
 * its Health ID, or the reverse) within that wait sends nothing either: identity
 * otp.service.ts start finds the account's challenge still cooling, and answers
 * with a new random challengeId, under which the code already sent is not
 * accepted. Before #55 the wait was the account's, and such a start answered the
 * same challenge. Another account's identifier is not held back. A start that
 * names no wait may start again at once.
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

/** An identifier as identity matches it for a start (otp.service.ts): trimmed, without regard to case. */
function identifierKey(identifier: string) {
  return identifier.trim().toLowerCase()
}

/**
 * Whether to say CODE_BUDGET_HINT: from a refused code until a code is accepted,
 * which shows the budget was not spent, or until a start for another identifier
 * succeeds. A start for the same identifier keeps it: while the account's budget
 * is spent, that start sends no code (otp.service.ts start), and the note is what
 * says why none arrives.
 */
export function useCodeBudgetNote() {
  const [refusedFor, setRefusedFor] = useState<string | null>(null)
  const refused = useCallback((identifier: string) => setRefusedFor(identifierKey(identifier)), [])
  const started = useCallback((identifier: string) =>
    setRefusedFor(previous => previous === identifierKey(identifier) ? previous : null), [])
  const accepted = useCallback(() => setRefusedFor(null), [])
  return { shown: refusedFor !== null, refused, started, accepted }
}
