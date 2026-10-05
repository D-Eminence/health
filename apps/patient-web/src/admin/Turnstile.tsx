import { useEffect, useRef } from 'react'

export function Turnstile({ siteKey, resetKey, onChange }: { siteKey: string | null; resetKey: number; onChange: (token: string | null) => void }) {
  const target = useRef<HTMLDivElement>(null)
  const widget = useRef<string | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!siteKey) return
    let active = true
    const render = () => {
      if (!active || !target.current || !window.turnstile || widget.current) return
      widget.current = window.turnstile.render(target.current, {
        sitekey: siteKey, action: 'admin-login', callback: (token: string) => onChangeRef.current(token),
        'expired-callback': () => onChangeRef.current(null),
        'error-callback': () => onChangeRef.current(null),
      })
    }
    if (window.turnstile) render()
    else {
      const script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.onload = render
      document.head.appendChild(script)
    }
    return () => { active = false; if (widget.current && window.turnstile) window.turnstile.remove(widget.current); widget.current = null }
  }, [siteKey])

  useEffect(() => {
    if (resetKey > 0 && widget.current && window.turnstile) {
      window.turnstile.reset(widget.current)
      onChangeRef.current(null)
    }
  }, [resetKey])

  return siteKey ? <div ref={target} aria-label="Security verification" />
    : <p role="alert">Security verification is not configured for this environment.</p>
}
