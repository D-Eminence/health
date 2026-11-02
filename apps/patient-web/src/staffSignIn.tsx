import { useEffect, type AnchorHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'
import { STAFF_SIGN_IN_PATH, staffSignInHref } from './productHostname'

/**
 * Staff pages on a site that serves none (productHostname.ts staffPagesOrigin): the production patient portal (app.)
 * serves patients only (owner, 2026-11-01), and the admin sites serve platform administrators only. The edge sends a
 * full load of any app./provider address to the same address on the EHR site, but the portal's app can reach those
 * addresses without asking the edge (a link inside the app, the installed app, a page kept in the browser), so the app
 * opens the EHR site's page itself, at once, with no step of its own.
 */

/**
 * Whether `pathname` is a staff page: /provider or any page under it, as the router matches them (in any case, with or
 * without closing slashes). /providers and the like are not.
 */
export function isStaffPath(pathname: string): boolean {
  return /^\/provider(?:\/|$)/i.test(pathname)
}

/**
 * The same staff page on the site at `origin` (one of staffPagesOrigin's fixed origins): this address's path, query and
 * fragment, as the edge's redirect keeps them (and a browser keeps the fragment across it), so a link from an old email
 * or a page kept in the browser still opens its page. An invitation link carries its invitation in the fragment. Only
 * the path, query and fragment are taken from the address: the origin stays the one given.
 */
export function sameStaffPageOn(origin: string, location: { pathname: string; search: string; hash: string }): string {
  const target = new URL(origin)
  target.pathname = location.pathname
  target.search = location.search
  target.hash = location.hash
  return target.href
}

/**
 * Opens `href`, a staff page on the EHR site, in place of this page, leaving no history entry for it. Until the browser
 * leaves, one line says so, with a plain link.
 */
export function OpenStaffPage({ href }: { href: string }) {
  useEffect(() => { window.location.replace(href) }, [href])
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <p className="m-0 text-sm text-ink-2"><span role="status">Opening Health ID EHR…</span>{' '}
        <a className="font-medium text-brand-ink underline" href={href}>Go to Health ID EHR</a></p>
    </main>
  )
}

/** Where a link to the staff sign-in (or to `path`, a page that asks for one) leads from this host. */
export function staffSignInAddress(hostname = window.location.hostname, path: string = STAFF_SIGN_IN_PATH): string {
  return staffSignInHref(hostname) ?? path
}

/**
 * A link to the staff sign-in, or to `to`, a page of the staff workspace that asks for one. On a site that serves no
 * staff pages (the production patient portal, an admin site) it is a plain link to the EHR site's sign-in, which the
 * browser follows itself; anywhere else, a link within this site.
 */
export function StaffSignInLink({ to = STAFF_SIGN_IN_PATH, ...rest }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to?: string }) {
  const elsewhere = staffSignInHref(window.location.hostname)
  return elsewhere ? <a {...rest} href={elsewhere} /> : <Link {...rest} to={to} />
}
