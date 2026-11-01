import { Suspense, useEffect } from 'react'
import { BrandLogo } from '../BrandLogo'
import { Button } from '../kasuwa/ui'
import { afterCentralSignInHref } from '../authHandoff'
import { openSite } from '../openSite'
import { useDocumentTitle } from '../authSteps'
import { BlueSignIn, useStaff } from './App'

/**
 * The auth. site's sign-in (DRAFT, authHandoff.ts): one sign-in for every staff site. Its server sends the browser here
 * only when the auth. site holds no session for an authorization request, which it names by an opaque id. Once the person
 * signs in, the browser goes to its server's continuation of that request, which sends it on to the client's registered
 * callback: no address is ever taken from the query. Opened directly while signed in, it goes to the Hospital EHR.
 */
export function CentralSignIn() {
  const { state, refresh } = useStaff()
  const hostname = window.location.hostname
  const next = afterCentralSignInHref(window.location.search, hostname)
  useDocumentTitle('Sign in · Health ID')
  if (!next) return null
  if (state.status === 'ready') return <Leaving href={next} />
  if (state.status === 'loading') return <Centered><h1>Checking your sign-in…</h1></Centered>
  if (state.status === 'error') return <Centered><h1>Sign-in unavailable</h1><p>{state.error}</p><Button onClick={() => void refresh()}>Try again</Button></Centered>
  // Signed out, or a session that ended (signed out on another staff site): the sign-in. Once it completes, the session
  // is ready, and the line above takes the person on.
  return <Suspense fallback={<Centered><h1>Opening sign-in…</h1></Centered>}><BlueSignIn leavesAfterSignIn /></Suspense>
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="staff-centered"><BrandLogo className="staff-state-logo" /><div role="status">{children}</div></main>
}

/** Signed in: on to the authorization request's continuation (or the Hospital EHR), in place of this page. */
function Leaving({ href }: { href: string }) {
  useEffect(() => { openSite(href) }, [href])
  return <Centered><h1>Signed in</h1><p>Opening your workspace…</p><p><a className="staff-text-link" href={href}>Continue</a></p></Centered>
}
