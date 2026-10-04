import { useEffect, useRef, useState } from 'react'
import { useSession } from './session'

interface CredentialResponse { credential?: string }
declare global {
  interface Window {
    google?: { accounts: { id: {
      initialize: (options: { client_id: string; nonce: string; callback: (result: CredentialResponse) => void; auto_select: false; ux_mode: 'popup' }) => void
      renderButton: (host: HTMLElement, options: { type: 'standard'; theme: 'outline'; size: 'large'; text: 'signin_with' | 'signup_with' | 'continue_with'; width: string }) => void
    } } }
  }
}

let scriptPromise: Promise<void> | null = null
function loadGoogle(): Promise<void> {
  if (window.google?.accounts.id) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google sign-in is unavailable.'))
    document.head.appendChild(script)
  }).catch(error => { scriptPromise = null; throw error })
  return scriptPromise!
}

export function GoogleButton({ text, disabled, onCredential }: {
  text: 'signin_with' | 'signup_with' | 'continue_with'
  disabled: boolean
  onCredential: (token: string) => Promise<void>
}) {
  const clientId = String(import.meta.env.VITE_HID_GOOGLE_CLIENT_ID ?? '').trim()
  const host = useRef<HTMLDivElement>(null)
  const { api } = useSession()
  const callback = useRef(onCredential)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { callback.current = onCredential }, [onCredential])
  useEffect(() => {
    if (!clientId || !host.current) return
    let active = true
    void (async () => {
      try {
        const nonce = (await api.googleNonce()).nonce
        if (!nonce || nonce.length < 32) throw new Error('Google sign-in could not start.')
        await loadGoogle()
        if (!active || !window.google || !host.current) return
        window.google.accounts.id.initialize({ client_id: clientId, nonce, auto_select: false, ux_mode: 'popup',
          callback: result => {
            if (!result.credential) { setError('Google did not return an identity.'); return }
            void callback.current(result.credential).catch(() => setError('Google sign-in could not be completed.')).finally(() => {
              if (active) setAttempt(value => value + 1)
            })
          } })
        host.current.replaceChildren()
        window.google.accounts.id.renderButton(host.current, { type: 'standard', theme: 'outline', size: 'large', text,
          width: String(Math.min(400, Math.max(220, host.current.clientWidth))) })
        setError(null)
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Google sign-in is unavailable.')
      }
    })()
    return () => { active = false; host.current?.replaceChildren() }
  }, [api, clientId, text, attempt])

  if (!clientId) return null
  return <div className="patient-google" aria-disabled={disabled}>
    <div ref={host} style={{ pointerEvents: disabled ? 'none' : undefined, opacity: disabled ? .5 : 1 }} />
    {error && <p role="alert" className="patient-inline-error">{error}</p>}
  </div>
}
