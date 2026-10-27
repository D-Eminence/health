/**
 * Route guard for the patient application.
 *
 * This decides what to render. It is not a security control; the backend
 * authorises every request whatever this component concludes. Its job is to
 * stop a signed-out person landing on an empty dashboard, and to send someone
 * who arrived at the wrong entrance somewhere that makes sense.
 */

import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { evaluateAccess, type AccessRequirement } from '@hid/auth'
import { useSession } from './session'
import { BrandLogo } from './BrandLogo'
import { focusLost, focusPageHeading } from './pageFocus'

export interface RequireAccessProps {
  readonly requirement: AccessRequirement
  readonly children: ReactNode
}

export function RequireAccess({ requirement, children }: RequireAccessProps) {
  const { state, sessionError, retrySessionCheck } = useSession()
  const decision = evaluateAccess(state, requirement)
  // 'Try again' is replaced while the session is checked again: focus then goes to
  // the page that opens, or to the new 'Try again' when the check fails again (PR-04).
  // Only an outcome after the check was seen to start counts, so the render that
  // still shows the earlier failure is never taken for the new one. Focus moves in
  // the commit that shows the outcome.
  const retried = useRef(false)
  const checking = useRef(false)
  const retryButton = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    if (!retried.current) return
    if (decision.outcome === 'pending' && !sessionError) { checking.current = true; return }
    if (!checking.current) return
    retried.current = false
    checking.current = false
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
            <h1>We could not check your session</h1>
            <p>Try again in a moment.</p>
            <button ref={retryButton} type="button" onClick={() => { retried.current = true; checking.current = false; retrySessionCheck() }}>Try again</button>
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
