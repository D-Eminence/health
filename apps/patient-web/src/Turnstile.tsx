import { useEffect, useRef, useState } from 'react'
import { getEnvironment } from './env'
import { PlainError } from '@hid/http'

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string
      remove: (id: string) => void
      reset: (id: string) => void
    }
  }
}

let scriptPromise: Promise<void> | null = null
const UNAVAILABLE = 'Security check unavailable. Please try again.'

/**
 * Cloudflare's normal and flexible widgets are at least 300px wide; in a
 * narrower slot (a 320px phone) they push the page sideways, so the compact
 * widget is used there. A slot not laid out yet (width 0) keeps the usual size.
 */
export function turnstileSize<Wide extends 'flexible' | 'normal'>(slot: HTMLElement, wide: Wide): Wide | 'compact' {
  const width = slot.clientWidth
  return width > 0 && width < 300 ? 'compact' : wide
}

/**
 * Loads Cloudflare's api.js, in explicit rendering mode, once for the whole
 * portal: the patient, provider and administration pages all wait on this one
 * promise. A second <script> (StrictMode's second effect, a remount, or a move to
 * another portal's sign-in before the first loads) would be fetched again and
 * make Turnstile warn that it was loaded twice. A failed load removes its tag and
 * the next widget tries again; a script that loads without Turnstile is a failure.
 */
export function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  const script = document.createElement('script')
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
  script.async = true
  scriptPromise = new Promise<void>((resolve, reject) => {
    script.onload = () => window.turnstile ? resolve() : reject(new PlainError(UNAVAILABLE))
    script.onerror = () => reject(new PlainError(UNAVAILABLE))
  }).catch(error => { script.remove(); scriptPromise = null; throw error })
  document.head.appendChild(script)
  return scriptPromise
}

export function Turnstile({ action, onTokenChange, resetKey }: {
  action: 'patient-enrollment' | 'patient-login' | 'patient-reset-start' | 'staff-reset' | 'admin-reset' | 'provider-enrollment'
    | 'clinician-application' | 'clinician-application-status' | 'staff-invitation'
  onTokenChange: (token: string | null) => void
  resetKey: number
}) {
  const environment = getEnvironment()
  const siteKey = environment.turnstileSiteKey
  const localWithoutWidget = !siteKey && environment.name === 'local'
    && ['localhost', '127.0.0.1'].includes(window.location.hostname)
  const container = useRef<HTMLDivElement>(null)
  const widget = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The page's callback is read when the widget answers, so a new function on each
  // render does not remove the widget and render another, dropping its token.
  const onToken = useRef(onTokenChange)
  useEffect(() => { onToken.current = onTokenChange }, [onTokenChange])

  useEffect(() => {
    if (localWithoutWidget) {
      onToken.current('local-turnstile-disabled')
      return () => onToken.current(null)
    }
    if (!siteKey || !container.current) return
    let active = true
    void loadTurnstileScript().then(() => {
      if (!active || !container.current || !window.turnstile) return
      setError(null)
      widget.current = window.turnstile.render(container.current, {
        sitekey: siteKey,
        action,
        theme: 'light',
        size: turnstileSize(container.current, 'flexible'),
        callback: (token: string) => onToken.current(token),
        'expired-callback': () => onToken.current(null),
        'error-callback': () => { onToken.current(null); setError('Security check failed. Please try again.') },
      })
    }).catch(() => { if (active) setError(UNAVAILABLE) })
    return () => {
      active = false
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current)
      widget.current = null
      onToken.current(null)
    }
  }, [action, siteKey, localWithoutWidget, resetKey])

  if (localWithoutWidget) return null
  if (!siteKey) return <p role="alert" className="patient-inline-error">Security verification is not configured for this environment.</p>
  return <div className="patient-turnstile"><div ref={container} />{error && <p role="alert" className="patient-inline-error">{error}</p>}</div>
}
