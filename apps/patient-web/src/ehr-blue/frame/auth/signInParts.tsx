import { useEffect, useRef, useState } from 'react'
import { isHidApiError } from '@hid/http'
import { getEnvironment } from '../../../staff/env'
import type { StaffSession } from '../../../staff/api'
import { loadTurnstileScript, turnstileSize } from '../../../Turnstile'
import { resolveStaffProductHostname, STAFF_JOIN_PATH, staffLoginAction } from '../../../productHostname'
import { staffLandingPath } from '../../../staff/navigation'
import { staffReturnPath } from '../../../staff/session'
import { STAFF_MFA_FACTOR_UNPROVEN, STAFF_MFA_UNAVAILABLE } from '../../../staff/routes/StaffMfaSteps'
import { usesNovuBackend } from '../../../backendContract'
import { capturedStaffInvitation } from '../../../staff/invitationCapture'

/*
 * Today's sign-in rules, as staff/routes/SignIn.tsx keeps them inside the page. They are copied here, word for word,
 * because that file belongs to the offline work and is not edited from this lane. When the blue page replaces today's,
 * these move into one shared module both import (README.md), and the copies go.
 */

/** What the page says for a refused password step: the portal's words for the MFA refusals, otherwise Identity's own. */
export function passwordRefusal(caught: unknown): string {
  if (isHidApiError(caught) && caught.code === 'STAFF_MFA_FACTOR_UNPROVEN') return STAFF_MFA_FACTOR_UNPROVEN
  if (isHidApiError(caught) && caught.code === 'MFA_UNAVAILABLE') return STAFF_MFA_UNAVAILABLE
  return caught instanceof Error ? caught.message : 'Sign in failed.'
}

/** Where a sign-in lands: an invitation carried through it, the page to return to, the product host's page, else Overview. */
export function getStaffLandingPath(search: string, session: StaffSession): string {
  if (usesNovuBackend() && capturedStaffInvitation()) return STAFF_JOIN_PATH
  const product = resolveStaffProductHostname(window.location.hostname)?.route
  const returnTo = staffReturnPath(new URLSearchParams(search).get('returnTo'))
  if (returnTo && returnTo !== product) return returnTo
  return product ? staffLandingPath(product, session) : '/provider'
}

const CHALLENGE_UNAVAILABLE = 'Human verification could not load. Refresh the page and try again.'

/** The sign-in's human check (Turnstile), with the staff login action for this host. Nothing renders without a site key. */
export function TurnstileChallenge({ onToken, resetKey }: { readonly onToken: (token: string) => void; readonly resetKey: number }) {
  const siteKey = getEnvironment().turnstileSiteKey
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const tokenTo = useRef(onToken)
  useEffect(() => { tokenTo.current = onToken }, [onToken])

  useEffect(() => {
    if (!siteKey || !host.current) return
    let active = true
    let widgetId: string | null = null
    void loadTurnstileScript().then(() => {
      if (!active || !host.current || !window.turnstile) return
      setError('')
      widgetId = window.turnstile.render(host.current, {
        sitekey: siteKey,
        action: staffLoginAction(window.location.hostname),
        size: turnstileSize(host.current, 'normal'),
        callback: (token: string) => tokenTo.current(token),
        'expired-callback': () => tokenTo.current(''),
        'error-callback': () => { tokenTo.current(''); setError(CHALLENGE_UNAVAILABLE) },
      })
    }).catch(() => { if (active) setError(CHALLENGE_UNAVAILABLE) })
    return () => { active = false; if (widgetId && window.turnstile) window.turnstile.remove(widgetId) }
  }, [siteKey, resetKey])

  if (!siteKey) return null
  return <div><div ref={host} />{error ? <p role="alert" className="hid-ehr-error">{error}</p> : null}</div>
}
