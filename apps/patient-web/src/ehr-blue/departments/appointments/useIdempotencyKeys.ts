import { useCallback, useRef } from 'react'
import { newKey } from './appointmentRules'

/**
 * One Idempotency-Key per request body: the same body sent again (a retry after a lost answer) carries the same key, so
 * the server answers its first answer ("replayed") and books nothing twice; any other body gets a key of its own, as the
 * server refuses a key reused for another body (IDEMPOTENCY_KEY_REUSED). Kept in memory for the page's life only.
 */
export function useIdempotencyKeys(): (action: string, body: unknown) => string {
  const keys = useRef(new Map<string, string>())
  return useCallback((action: string, body: unknown) => {
    const signature = `${action}\n${JSON.stringify(body)}`
    let key = keys.current.get(signature)
    if (!key) {
      key = newKey()
      keys.current.set(signature, key)
    }
    return key
  }, [])
}
