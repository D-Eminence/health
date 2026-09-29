/**
 * Route guard for the patient application.
 *
 * This decides what to render. It is not a security control — the backend
 * authorises every request whatever this component concludes. Its job is to
 * stop a signed-out person landing on an empty dashboard, and to send someone
 * who arrived at the wrong entrance somewhere that makes sense.
 */

import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { evaluateAccess, type AccessRequirement } from '@hid/auth'
import { useSession } from './session'

export interface RequireAccessProps {
  readonly requirement: AccessRequirement
  readonly children: ReactNode
}

export function RequireAccess({ requirement, children }: RequireAccessProps) {
  const { state } = useSession()
  const decision = evaluateAccess(state, requirement)

  switch (decision.outcome) {
    case 'allow':
      return <>{children}</>

    case 'pending':
      // The session is still resolving. Redirecting here would bounce a
      // signed-in patient to the sign-in screen on every page load.
      return (
        <main className="patient-page">
          <div role="status" aria-live="polite" className="patient-access-state">
            Checking your session…
          </div>
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
          <div role="alert" className="patient-access-state">
            <p>This page is part of the patient application.</p>
            <p>You are signed in to the {decision.actual} experience. Sign out to continue as a patient.</p>
          </div>
        </main>
      )

    case 'not-permitted':
      return (
        <main className="patient-page">
          <div role="alert" className="patient-access-state">
            <p>You do not have access to this page.</p>
          </div>
        </main>
      )
  }
}
