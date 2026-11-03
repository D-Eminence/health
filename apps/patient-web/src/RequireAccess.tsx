/**
 * Route guard for the patient application.
 *
 * This decides what to render. It is not a security control; the backend
 * authorises every request whatever this component concludes. Its job is to
 * stop a signed-out person landing on an empty dashboard, and to send someone
 * who arrived at the wrong entrance somewhere that makes sense.
 */

import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { evaluateAccess, type AccessRequirement } from '@hid/auth'
import { useSession } from './session'
import { BrandLogo } from './BrandLogo'
import { focusLost, focusPageHeading } from './pageFocus'
import { useDocumentTitle } from './authSteps'

export interface RequireAccessProps {
  readonly requirement: AccessRequirement
  readonly children: ReactNode
}

/** Names the tab while a session state is shown, and gives the name back as it goes. */
function TabTitle({ title }: { title: string }) {
  useDocumentTitle(title)
  return null
}

/** Where sign-in may take the patient back to: the page they asked for (RequireAccess's redirect keeps it). */
export interface SignInFrom { readonly pathname: string; readonly search: string; readonly hash: string }

export function RequireAccess({ requirement, children }: RequireAccessProps) {
  const { state, sessionError, retrySessionCheck } = useSession()
  const { pathname, search, hash } = useLocation()
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
      // signed-in patient to the sign-in screen on every page load. A check that
      // failed says so plainly, with one full-size way on: Try again. The check
      // also fails for an outage, not only a lost connection, so it blames none.
      return (
        <main className="patient-page">
          <BrandLogo className="patient-state-logo" />
          {sessionError ? <div role="alert" className="patient-access-state">
            <TabTitle title="Couldn’t check your session · Health ID" />
            <h1>We could not check your session</h1>
            <p>Nothing in your account has changed. Try again in a moment.</p>
            <div className="patient-state-actions">
              <button ref={retryButton} type="button" className="patient-primary-button"
                onClick={() => { retried.current = true; checking.current = false; retrySessionCheck() }}>Try again</button>
            </div>
          </div> : <div role="status" aria-live="polite" className="patient-access-state">
            <TabTitle title="Checking your session · Health ID" />
            <h1>Checking your session…</h1>
          </div>}
        </main>
      )

    case 'sign-in-required': {
      // The page the patient asked for goes with them (router state, never the
      // address), so sign-in can bring them back to it.
      const from: SignInFrom = { pathname, search, hash }
      return <Navigate to="/sign-in" replace state={{ from }} />
    }

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
