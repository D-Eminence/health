/**
 * Route guard for the patient application.
 *
 * This decides what to render. It is not a security control; the backend
 * authorises every request whatever this component concludes. Its job is to
 * stop a signed-out person landing on an empty dashboard, and to send someone
 * who arrived at the wrong entrance somewhere that makes sense.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { evaluateAccess, type AccessRequirement } from '@hid/auth'
import { useSession } from './session'
import { BrandLogo } from './BrandLogo'
import { focusPageHeading } from './pageFocus'
import { focusLost } from './routes/actionFocus'

export interface RequireAccessProps {
  readonly requirement: AccessRequirement
  readonly children: ReactNode
}

export function RequireAccess({ requirement, children }: RequireAccessProps) {
  const { state, sessionError, retrySessionCheck } = useSession()
  const decision = evaluateAccess(state, requirement)
  // 'Try again' is replaced while the session is checked again: focus then goes to
  // the page that opens, or to the new 'Try again' when the check fails again (PR-04).
  const retried = useRef(false)
  const retryButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!retried.current || (decision.outcome === 'pending' && !sessionError)) return
    retried.current = false
    if (!focusLost()) return
    if (decision.outcome === 'allow') focusPageHeading(document.getElementById('main'))
    else if (sessionError) retryButton.current?.focus()
  }, [decision.outcome, sessionError])

  switch (decision.outcome) {
    case 'allow':
      return <>{children}</>

    case 'pending':
      // The session is still resolving. Redirecting here would bounce a
      // signed-in patient to the sign-in screen on every page load.
      return (
        <main className="patient-page">
          <BrandLogo className="patient-state-logo" />
          {sessionError ? <div role="alert" className="patient-access-state">
            <h1>{sessionError}</h1>
            <button ref={retryButton} type="button" onClick={() => { retried.current = true; retrySessionCheck() }}>Try again</button>
          </div> : <div role="status" aria-live="polite" className="patient-access-state">
            <h1>Checking your session…</h1>
          </div>}
        </main>
      )

    case 'sign-in-required':
      return <Navigate to="/sign-in" replace />

    case 'mfa-required':
      return <Navigate to="/verify" replace />

    case 'wrong-portal':
      // A member of staff reached a patient URL. Say so plainly rather than
      // showing an empty screen or a permission error they cannot act on.
      return (
        <main className="patient-page">
          <BrandLogo className="patient-state-logo" />
          <div role="alert" className="patient-access-state">
            <p>This page is part of the patient application.</p>
            <p>You are signed in to the {decision.actual} experience. Sign out to continue as a patient.</p>
          </div>
        </main>
      )

    case 'not-permitted':
      return (
        <main className="patient-page">
          <BrandLogo className="patient-state-logo" />
          <div role="alert" className="patient-access-state">
            <p>You do not have access to this page.</p>
          </div>
        </main>
      )
  }
}
