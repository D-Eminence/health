'use client'

import { useEffect, useRef } from 'react'

interface TurnstileApi {
  render(element: HTMLElement, options: {
    sitekey: string
    action: string
    callback: (token: string) => void
    'expired-callback': () => void
    'error-callback': () => void
  }): string
  reset(widgetId: string): void
  remove(widgetId: string): void
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

let turnstileScript: Promise<void> | null = null

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (turnstileScript) return turnstileScript
  const pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.onload = () => window.turnstile ? resolve() : reject(new Error('Verification could not be loaded.'))
    script.onerror = () => reject(new Error('Verification could not be loaded.'))
    document.head.appendChild(script)
  }).catch(error => {
    turnstileScript = null
    throw error
  })
  turnstileScript = pending
  return pending
}

export function TurnstileWidget({ siteKey, action, resetKey, onToken, onError }: {
  siteKey: string | null
  action: string
  resetKey: number
  onToken: (token: string | null) => void
  onError: (message: string) => void
}) {
  const mountRef = useRef<HTMLDivElement>(null)
  const widgetRef = useRef<string | null>(null)
  const callbackRef = useRef({ onToken, onError })
  callbackRef.current = { onToken, onError }

  useEffect(() => {
    if (!siteKey) return
    let active = true
    loadTurnstile()
      .then(() => {
        if (!active || !mountRef.current || !window.turnstile) return
        widgetRef.current = window.turnstile.render(mountRef.current, {
          sitekey: siteKey,
          action,
          callback: token => callbackRef.current.onToken(token),
          'expired-callback': () => callbackRef.current.onToken(null),
          'error-callback': () => {
            callbackRef.current.onToken(null)
            callbackRef.current.onError('Verification failed. Please try again.')
          },
        })
      })
      .catch(() => { if (active) callbackRef.current.onError('Verification could not be loaded.') })
    return () => {
      active = false
      if (widgetRef.current && window.turnstile) window.turnstile.remove(widgetRef.current)
      widgetRef.current = null
      // The removed widget can no longer refresh or expire its token, so the form must not keep it.
      callbackRef.current.onToken(null)
    }
  }, [siteKey, action])

  useEffect(() => {
    if (resetKey > 0 && widgetRef.current && window.turnstile) {
      window.turnstile.reset(widgetRef.current)
      callbackRef.current.onToken(null)
    }
  }, [resetKey])

  return (
    <div className="min-h-16" aria-label="Security verification">
      {siteKey ? <div ref={mountRef} /> : (
        <p role="alert" className="text-sm text-critical">Verification is unavailable. Please try again later.</p>
      )}
    </div>
  )
}
