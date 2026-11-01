import { useEffect, useRef, useState } from 'react'
import { useSession } from './session'
import { focusLost } from './pageFocus'
import { googleClientId } from './googleClient'

interface CredentialResponse { credential?: string }
declare global {
  interface Window {
    google?: { accounts: { id: {
      initialize: (options: { client_id: string; nonce: string; callback: (result: CredentialResponse) => void; auto_select: false; ux_mode: 'popup' }) => void
      renderButton: (host: HTMLElement, options: { type: 'standard'; theme: 'outline'; size: 'large'; text: 'signin_with' | 'signup_with' | 'continue_with'; width: string }) => void
    } } }
  }
}

/** The name of the button's region, which focus may land on: what the button does there. */
const REGION_NAMES = { signin_with: 'Google sign-in', signup_with: 'Google sign-up', continue_with: 'Continue with Google' } as const

let scriptPromise: Promise<void> | null = null
function loadGoogle(): Promise<void> {
  if (window.google?.accounts.id) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google sign-in isn’t working right now.'))
    document.head.appendChild(script)
  }).catch(error => { scriptPromise = null; throw error })
  return scriptPromise!
}

/**
 * Google's own button, rendered by Google Identity Services. While `disabled` it
 * is inert, out of the tab order and the accessibility tree with the frame
 * inside it, and `disabledReason` says why (PA-11).
 */
export function GoogleButton({ text, disabled, disabledReason, onCredential }: {
  text: 'signin_with' | 'signup_with' | 'continue_with'
  disabled: boolean
  /** Why the button cannot be used yet, shown while it is disabled. */
  disabledReason?: string
  onCredential: (token: string) => Promise<void>
}) {
  const clientId = googleClientId()
  const region = useRef<HTMLDivElement>(null)
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
        if (!nonce || nonce.length < 32) throw new Error('Google sign-in didn’t start. Please try again.')
        await loadGoogle()
        if (!active || !window.google || !host.current) return
        window.google.accounts.id.initialize({ client_id: clientId, nonce, auto_select: false, ux_mode: 'popup',
          callback: result => {
            if (!result.credential) { setError('Google didn’t send your details. Please try again.'); return }
            void callback.current(result.credential).catch(() => setError('We couldn’t sign you in with Google.')).finally(() => {
              if (active) setAttempt(value => value + 1)
            })
          } })
        host.current.replaceChildren()
        window.google.accounts.id.renderButton(host.current, { type: 'standard', theme: 'outline', size: 'large', text,
          width: String(Math.min(400, Math.max(220, host.current.clientWidth))) })
        setError(null)
        // After a credential the button is rendered again and the one used is gone:
        // focus left on the page returns to the button's region.
        // eslint-disable-next-line no-restricted-syntax -- not an effect's delay: this runs once the nonce and Google's script have loaded, straight after renderButton has drawn the new button, and the region was there all along.
        if (attempt > 0 && focusLost()) region.current?.focus()
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Google sign-in isn’t working right now.')
      }
    })()
    return () => { active = false; host.current?.replaceChildren() }
  }, [api, clientId, text, attempt])

  if (!clientId) return null
  return <div ref={region} tabIndex={-1} role="group" aria-label={REGION_NAMES[text]} className="patient-google">
    <div ref={host} inert={disabled} style={{ opacity: disabled ? .5 : 1 }} />
    {disabled && disabledReason && <p className="patient-field-hint">{disabledReason}</p>}
    {error && <p role="alert" className="patient-inline-error">{error}</p>}
  </div>
}
