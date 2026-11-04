import { useEffect, type ReactNode } from 'react'
import { matchPath, useLocation } from 'react-router-dom'
import { BrandLogo } from '../BrandLogo'
import { useDocumentTitle } from '../authSteps'
import { STAFF_JOIN_PATH, STAFF_PRODUCT_ROUTES, STAFF_SIGN_IN_PATH } from '../productHostname'
import { isSafeReturnPath, ssoStartHref } from './handOff'
import { leavePage } from './leave'
import { leavingAfterSignOut, signedOutInThisPage, type StaffSite } from './singleSignOn'

/**
 * A signed-out product page with single sign-on on (contract v2): the whole tab goes to this host's
 * `/api/v1/auth/sso/start`, coming back to `returnPath` when this site's rules allow it (handOff.ts isSafeReturnPath),
 * else to `home`. After a sign-out in this page it asks for a new sign-in, and while the tab is leaving for the
 * provider's end-session address it goes nowhere else. Until the browser leaves, and if it does not, the page says
 * what is happening and links to the same address. The title and the page name no person, record or page.
 */
export function SignInHandOff({ returnPath, home }: { readonly returnPath: string | null; readonly home: string }) {
  const leaving = leavingAfterSignOut()
  const target = returnPath !== null && isSafeReturnPath(returnPath, window.location.hostname) ? returnPath : home
  const href = ssoStartHref(target, signedOutInThisPage() ? { prompt: 'login' } : {})
  useDocumentTitle(leaving ? 'Signing out · Health ID' : 'Signing in · Health ID')
  useEffect(() => { if (!leaving) leavePage(href) }, [leaving, href])
  return <main className="patient-page">
    <BrandLogo className="patient-state-logo" />
    <div className="patient-access-state">
      <h1>{leaving ? 'Signing you out' : 'Signing you in'}</h1>
      <p role="status">{leaving ? 'Signing you out of every Health ID site…' : 'Opening Health ID sign-in…'}</p>
      {!leaving && <div className="patient-state-actions"><a className="patient-primary-button" href={href}>Continue to sign in</a></div>}
    </div>
  </main>
}

/**
 * The provider workspace's sign-in with single sign-on on, on the staff product site `site` (App.tsx wraps /provider/*
 * with it only then, sso/singleSignOn.ts staffHandOffSite).
 * The staff Gate sends a signed-out visit to `/provider/sign-in?returnTo=<page>` (staff/App.tsx): that hands off,
 * coming back to the page when this site's rules allow it, else to this product's own page. Everything else is today's
 * workspace, unchanged:
 * - `/provider/sign-in` with no `returnTo` is today's sign-in form. Identity sends a failed hand-off there with nothing
 *   in the address (its fallback page), so the form is the way in when single sign-on cannot help, and it never hands
 *   off again by itself;
 * - joining a facility from an invitation's link keeps today's sign-in in this page: the link waits in this page's
 *   memory only (staff/invitationCapture.ts), and leaving the page would lose it.
 */
export function StaffSignInHandOff({ site, children }: { readonly site: StaffSite; readonly children: ReactNode }) {
  const { pathname, search } = useLocation()
  if (!matchPath(STAFF_SIGN_IN_PATH, pathname)) return <>{children}</>
  const asked = new URLSearchParams(search).getAll('returnTo')
  if (asked.length === 0 || asked.includes(STAFF_JOIN_PATH)) return <>{children}</>
  return <SignInHandOff returnPath={asked.length === 1 ? asked[0]! : null} home={STAFF_PRODUCT_ROUTES[site.key]} />
}

/**
 * The patient portal's hand-off (app.), where RequireAccess finds no session: back to the page asked for when a sign-in
 * may return to it, else Home.
 */
export function PortalSignInHandOff() {
  const { pathname, search } = useLocation()
  return <SignInHandOff returnPath={`${pathname}${search}`} home="/" />
}
