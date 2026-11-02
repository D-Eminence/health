import { useEffect, type AnchorHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'
import { PRODUCTION_STAFF_SIGN_IN, STAFF_SIGN_IN_PATH, staffSignInHref } from './productHostname'

/**
 * The production patient portal (app.) serves patients only (owner, 2026-11-01): staff sign in on the EHR site
 * (staffSignInHref). The edge sends a full load of app./provider and app./provider/sign-in there, but the portal's app
 * can reach those addresses without asking the edge (a link inside the app, the installed app, a page kept in the
 * browser), so the app sends them there too, in place of any staff sign-in step.
 */

/**
 * Whether `pathname` is the staff sign-in or the workspace's entrance (which asks for one), as the portal's router
 * matches them: in any case, with or without closing slashes.
 */
export function isStaffSignInEntrance(pathname: string): boolean {
  const path = pathname.toLowerCase().replace(/\/+$/, '')
  return path === '/provider' || path === STAFF_SIGN_IN_PATH
}

/**
 * Opens the EHR site's sign-in in place of this page, leaving no history entry for it. The address is one fixed value:
 * nothing from this page's address is carried over. Until the browser leaves, one line says so, with a plain link.
 */
export function OpenEhrSignIn() {
  useEffect(() => { window.location.replace(PRODUCTION_STAFF_SIGN_IN) }, [])
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <p className="m-0 text-sm text-ink-2"><span role="status">Opening the EHR sign-in…</span>{' '}
        <a className="font-medium text-brand-ink underline" href={PRODUCTION_STAFF_SIGN_IN}>Go to the EHR sign-in</a></p>
    </main>
  )
}

/** Where a link to the staff sign-in (or to `path`, a page that asks for one) leads from this host. */
export function staffSignInAddress(hostname = window.location.hostname, path: string = STAFF_SIGN_IN_PATH): string {
  return staffSignInHref(hostname) ?? path
}

/**
 * A link to the staff sign-in, or to `to`, a page of the staff workspace that asks for one. On the production portal
 * it is a plain link to the EHR site's sign-in, which the browser follows itself; anywhere else, a link within this
 * site.
 */
export function StaffSignInLink({ to = STAFF_SIGN_IN_PATH, ...rest }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to?: string }) {
  const elsewhere = staffSignInHref(window.location.hostname)
  return elsewhere ? <a {...rest} href={elsewhere} /> : <Link {...rest} to={to} />
}
