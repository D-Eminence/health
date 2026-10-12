import { useEffect, useRef, useState } from 'react'
import { getEnvironment } from './env'

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

/**
 * Cloudflare's normal and flexible widgets are at least 300px wide; in a
 * narrower slot (a 320px phone) they push the page sideways, so the compact
 * widget is used there. A slot not laid out yet (width 0) keeps the usual size.
 */
export function turnstileSize<Wide extends 'flexible' | 'normal'>(slot: HTMLElement, wide: Wide): Wide | 'compact' {
  const width = slot.clientWidth
  return width > 0 && width < 300 ? 'compact' : wide
}

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Security check unavailable. Please try again.'))
    document.head.appendChild(script)
  }).catch(error => { scriptPromise = null; throw error })
  return scriptPromise!
}

export function Turnstile({ action, onTokenChange, resetKey }: {
  action: 'patient-enrollment' | 'patient-login' | 'patient-reset-start' | 'staff-reset' | 'admin-reset' | 'provider-enrollment'
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

  useEffect(() => {
    if (localWithoutWidget) {
      onTokenChange('local-turnstile-disabled')
      return () => onTokenChange(null)
    }
    if (!siteKey || !container.current) return
    let active = true
    void loadScript().then(() => {
      if (!active || !container.current || !window.turnstile) return
      setError(null)
      widget.current = window.turnstile.render(container.current, {
        sitekey: siteKey,
        action,
        theme: 'light',
        size: turnstileSize(container.current, 'flexible'),
        callback: (token: string) => onTokenChange(token),
        'expired-callback': () => onTokenChange(null),
        'error-callback': () => { onTokenChange(null); setError('Security check failed. Please try again.') },
      })
    }).catch(() => { if (active) setError('Security check unavailable. Please try again.') })
    return () => {
      active = false
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current)
      widget.current = null
      onTokenChange(null)
    }
  }, [action, siteKey, localWithoutWidget, resetKey, onTokenChange])

  if (localWithoutWidget) return null
  if (!siteKey) return <p role="alert" className="patient-inline-error">Security verification is not configured for this environment.</p>
  return <div className="patient-turnstile"><div ref={container} />{error && <p role="alert" className="patient-inline-error">{error}</p>}</div>
}
