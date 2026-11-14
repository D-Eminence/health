import { useEffect, useRef, useState } from 'react'
import { loadTurnstileScript } from '../Turnstile'

const UNAVAILABLE = 'Security verification could not load. Refresh the page and try again.'

export function Turnstile({ siteKey, resetKey, onChange }: { siteKey: string | null; resetKey: number; onChange: (token: string | null) => void }) {
  const target = useRef<HTMLDivElement>(null)
  const widget = useRef<string | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!siteKey) return
    let active = true
    // The portal's one loader (../Turnstile.tsx): this page adds no script of its own.
    void loadTurnstileScript().then(() => {
      if (!active || !target.current || !window.turnstile || widget.current) return
      setError(false)
      widget.current = window.turnstile.render(target.current, {
        sitekey: siteKey, action: 'admin-login', callback: (token: string) => onChangeRef.current(token),
        'expired-callback': () => onChangeRef.current(null),
        'error-callback': () => onChangeRef.current(null),
      })
    }).catch(() => { if (active) setError(true) })
    return () => { active = false; if (widget.current && window.turnstile) window.turnstile.remove(widget.current); widget.current = null }
  }, [siteKey])

  useEffect(() => {
    if (resetKey > 0 && widget.current && window.turnstile) {
      window.turnstile.reset(widget.current)
      onChangeRef.current(null)
    }
  }, [resetKey])

  return siteKey ? <><div ref={target} aria-label="Security verification" />{error && <p role="alert">{UNAVAILABLE}</p>}</>
    : <p role="alert">Security verification is not configured for this environment.</p>
}
