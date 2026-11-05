import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { isHidApiError, PLAIN, plainErrorText } from '@hid/http'
import { useSession } from '../session'
import { Button } from '../kasuwa/ui'

/** Whether Identity refused a step until the patient has signed in within the last 10 minutes. */
export const needsRecentSignIn = (cause: unknown): boolean => isHidApiError(cause) && cause.code === 'PATIENT_RECENT_AUTH_REQUIRED'

/**
 * "Sign in again" (PPS-09), beside the refusal of a step that needs a sign-in within the last 10 minutes (the Access PIN,
 * a contact change, Delete account): it signs out and opens sign-in, with the part of the page to come back to in the
 * router state `{ from }` (this page and `#at`), which the patient sign-in reads to bring the patient back to the step
 * (signInReturn.ts). It opens sign-in itself even when the route guard has already sent the signed-out patient there,
 * without saying where from.
 * A sign-out that fails is said here, and the patient stays.
 */
export function SignInAgain({ at }: { at: string }) {
  const { signOut } = useSession()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const go = async () => {
    if (busy) return
    setBusy(true); setProblem(null)
    try {
      await signOut()
      navigate('/sign-in', { replace: true, state: { from: `${pathname}#${at}` } })
    } catch (cause) {
      setProblem(plainErrorText(cause, PLAIN.signOutFailed))
      setBusy(false)
    }
  }
  return <div className="flex flex-col items-start gap-1.5">
    <Button size="sm" loading={busy} onClick={() => void go()}>{busy ? 'Signing out…' : 'Sign in again'}</Button>
    {problem && <p role="alert" className="m-0 text-[13px] text-danger-ink">{problem}</p>}
  </div>
}
