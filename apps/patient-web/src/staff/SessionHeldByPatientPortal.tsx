import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '@hid/ui'
import { BrandLogo } from '../BrandLogo'
import { resolveStaffProductHostname } from '../productHostname'
import { useStaff } from './App'

/**
 * Replaces the workspace when Identity refuses its refresh because the
 * browser's sign-in belongs to the patient portal (403 SESSION_CLIENT_MISMATCH,
 * hid-system #39). That is not an expired staff session: it says so and
 * offers sign-in, without a Sign out that would end the patient's sign-in.
 * There is deliberately no link into the patient portal: on a shared device
 * it belongs to someone else.
 */
export function SessionHeldByPatientPortal({ children }: { children: ReactNode }) {
  const { heldByPatientPortal } = useStaff()
  if (!heldByPatientPortal) return <>{children}</>
  const productRoute = resolveStaffProductHostname(window.location.hostname)?.route
  const signInPath = productRoute ? `/provider/sign-in?returnTo=${encodeURIComponent(productRoute)}` : '/provider/sign-in'
  return <div className="staff-centered" role="alert">
    <BrandLogo className="staff-state-logo" />
    <EmptyState
      title="Signed in to the patient portal"
      description="This browser is signed in to a Health ID patient account, so the provider workspace cannot use it. Signing in to the provider workspace here signs this browser out of the patient portal."
      action={<Link className="staff-text-link" to={signInPath}>Sign in to the provider workspace</Link>}
    />
  </div>
}
