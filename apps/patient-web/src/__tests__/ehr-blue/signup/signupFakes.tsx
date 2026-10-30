import { useEffect } from 'react'

/** Fakes the blue registration's tests mock modules with: kept apart from signupHarness, which imports the page. */

export const ENVIRONMENT = { name: 'local', turnstileSiteKey: null, apiBaseUrl: 'https://gateway.example.test',
  appOrigin: 'http://localhost:3200', supportContact: 'mailto:support@example.test' }

/** The fake security check: it answers by itself (as the local widget does) unless `security.auto` is off. */
export const security = { auto: true }

export function FakeTurnstile({ action, onTokenChange, resetKey }: {
  action: string
  onTokenChange: (token: string | null) => void
  resetKey: number
}) {
  useEffect(() => {
    if (!security.auto) return
    onTokenChange(`token-${resetKey}`)
    return () => onTokenChange(null)
  }, [resetKey])
  return <button type="button" data-turnstile-action={action} onClick={() => onTokenChange(`token-${resetKey}`)}>
    Complete the security check
  </button>
}
