import '@hid/ui/ehr.css'
import '../../frame/frame.css'
import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { plainErrorText, PLAIN } from '@hid/http'
import { LogOut } from 'lucide-react'
import { Alert, Button } from '../../../kasuwa/ui'
import { useStaff } from '../../../staff/App'
import { START_OUTREACH_GROUP_PATH } from '../../../staff/accountOnly'
import { StartOutreachGroup } from './StartOutreachGroup'

/**
 * What a staff login that is not yet part of any facility or outreach group sees on outreach. (owner's answer to Q88,
 * 17 Nov 2026): "Start an outreach group" and nothing else, as identity-api allows that session nothing else. Any
 * other address opens it. Once the group is started, its facility is chosen and the workspace opens as for anyone else
 * (staff/App.tsx Gate). Mounted lazily by the Gate, with the blue EHR's look.
 */
export default function AccountOnlyOutreach() {
  const { state, signOut } = useStaff()
  const { pathname } = useLocation()
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  if (state.status !== 'ready') return null
  if (pathname.replace(/\/+$/, '').toLowerCase() !== START_OUTREACH_GROUP_PATH) return <Navigate replace to={START_OUTREACH_GROUP_PATH} />
  const { actor } = state.session

  function leave() {
    if (signingOut) return
    setSignOutError('')
    setSigningOut(true)
    signOut()
      .catch((caught: unknown) => setSignOutError(plainErrorText(caught, PLAIN.signOutFailed)))
      .finally(() => setSigningOut(false))
  }

  return (
    <div className="hid-ehr hid-ehr-blue-standalone">
      <main id="main-content" tabIndex={-1} className="hid-ehr-blue-standalone-main">
        <div className="flex flex-col gap-6">
          <StartOutreachGroup />
          <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-ink-2">Signed in as {actor.displayName ?? actor.email ?? 'staff member'}</span>
            <Button variant="ghost" icon={LogOut} onClick={leave} loading={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</Button>
          </div>
          {signOutError ? <Alert intent="error" title="Couldn’t sign out">{signOutError}</Alert> : null}
        </div>
      </main>
    </div>
  )
}
