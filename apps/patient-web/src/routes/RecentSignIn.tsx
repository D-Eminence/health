import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { Button } from '../kasuwa/ui'
import { useSession } from '../session'
import { signInReturningTo } from '../returnPath'

/**
 * A refusal for an old sign-in (403 PATIENT_RECENT_AUTH_REQUIRED): Identity asks for a sign-in in the last 10 minutes
 * before approving access, sharing or confirming an invitation. Most patients keep a long session, so most of them meet
 * it the first time; the page then offers the way through in one step.
 */
export const needsRecentSignIn = (cause: unknown) => isHidApiError(cause) && cause.code === 'PATIENT_RECENT_AUTH_REQUIRED'

/** "Sign in again": signs out, then opens sign-in, which comes back to `back` (a path on this site) once signed in. */
export function SignInAgainButton({ back, id }: { back: string; id?: string }) {
  const { signOut } = useSession()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const go = async () => {
    if (busy) return
    setBusy(true); setFailed(false)
    try {
      await signOut()
      navigate(signInReturningTo(back), { replace: true })
    } catch {
      setFailed(true); setBusy(false)
    }
  }
  return <div className="flex flex-col items-start gap-1">
    <Button id={id} size="sm" variant="primary" loading={busy} disabled={busy} onClick={() => void go()}>{busy ? 'Signing out…' : 'Sign in again'}</Button>
    {failed && <p role="alert" className="m-0 text-[13px] text-danger-ink">Couldn’t sign you out. Check your connection and try again.</p>}
  </div>
}
