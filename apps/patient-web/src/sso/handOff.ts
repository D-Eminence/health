import { patientChatEnabled } from '../chatFeatures'
import { clinicalReturnPath } from '../ehr-blue/clinical/returnPaths'
import { siteOf, siteServing } from '../productSites'
import { staffReturnPath } from '../staff/session'

/**
 * Single sign-on on the sign-in site `auth.` (contract v2, "health"): the rules of a product's hand-off. A signed-out
 * product page sends the whole tab to its own host's `/api/v1/auth/sso/start` (Identity's relying party, ADR-070), with
 * the page to come back to; Identity goes to `auth.` and back, and sends the browser to that page signed in.
 *
 * Pure: nothing here reads the page's address, stores, navigates or logs. The page to come back to is a path on this
 * same host, never another host, an API route, the open patient, emergency access or a Health ID; Identity checks its
 * shape again (sso-return-path.ts) and replaces anything it refuses with `/`.
 */

/** Where a product page hands off: Identity on this same host (each product host proxies /api/v1/* to it). */
export const SSO_START_PATH = '/api/v1/auth/sso/start'

/** The product's sign-out while single sign-on is on: today's sign-out, answering the provider's end-session address. */
export const SSO_LOGOUT_PATH = '/api/v1/auth/sso/logout'

/** The longest page path carried, as Identity takes it (SSO_RETURN_PATH_MAX_LENGTH). */
export const RETURN_PATH_MAX_LENGTH = 512

/** `none`: a quiet check, no page at `auth.`; `login`: the person signs in again there, whatever session it holds. */
export type SsoPrompt = 'none' | 'login'

/** A percent-encoded `/`, `\` or `.`: a separator or a dot segment the browser or a server could decode later. */
const ENCODED_SEPARATOR = /%(?:2f|5c|2e)/i

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true
  }
  return false
}

/**
 * The one rule every return path meets, on every site, before any site's own list: a page path of this host as the
 * address bar shows it. Each check stands alone (its tests fail without it):
 * - at most RETURN_PATH_MAX_LENGTH characters;
 * - a leading `/` (so never empty): no scheme (`https:`, `javascript:`), nothing relative;
 * - no `//` anywhere: no other host (`//host`), no empty segment;
 * - no `\`, which browsers read as `/`;
 * - no control character (C0, DEL or C1), which browsers strip or a server could split on;
 * - no percent-encoded `/`, `\` or `.`;
 * - no fragment;
 * - no dot segment (`.` or `..`), which the browser would resolve to another page.
 */
export function hasSafeReturnShape(path: unknown): path is string {
  if (typeof path !== 'string' || path.length > RETURN_PATH_MAX_LENGTH) return false
  if (!path.startsWith('/')) return false
  if (path.includes('//')) return false
  if (path.includes('\\')) return false
  if (hasControlCharacter(path)) return false
  if (ENCODED_SEPARATOR.test(path)) return false
  if (path.includes('#')) return false
  const pathname = path.split('?', 1)[0] ?? ''
  if (pathname.split('/').some(segment => segment === '.' || segment === '..')) return false
  return true
}

/**
 * The patient portal's pages a sign-in on app. may come back to, matched exactly (App.tsx, the pages behind
 * RequireAccess): no query, no record or person in the address. Its record chat only where it is served
 * (chatFeatures.ts); Settings is only a way to the profile, and every other page is public.
 */
export const PORTAL_RETURN_PATHS: readonly string[] = ['/', '/profile', '/records', '/access', '/access/share', '/notifications', '/card/preview']

function isPortalReturnPath(path: string): boolean {
  if (PORTAL_RETURN_PATHS.includes(path)) return true
  if (path !== '/chat') return false
  // A configuration this page cannot read serves no chat, so nobody comes back to it.
  try { return patientChatEnabled() } catch { return false }
}

/**
 * Whether `path` is a page a sign-in on `hostname` may come back to. Only a Health ID product site has any (productSites.ts
 * siteOf); local, preview and admin hosts never hand off. Then:
 * - the shared shape (hasSafeReturnShape);
 * - this host serves the page (#68's siteServing): a page of another product opens on its own site, never here;
 * - this site's own exact list. On app. the portal's pages (PORTAL_RETURN_PATHS). On a staff site the provider workspace
 *   pages of staff/session.ts (staffReturnPath, read there and never copied) and the clinical record pages
 *   (ehr-blue/clinical/returnPaths.ts clinicalReturnPath), whose only query is an access request's status filter.
 */
export function isSafeReturnPath(path: string, hostname: string): boolean {
  if (!hasSafeReturnShape(path)) return false
  const site = siteOf(hostname)
  if (!site) return false
  const pathname = path.split('?', 1)[0] ?? ''
  if (siteServing(pathname, hostname) !== null) return false
  if (site.key === 'web') return isPortalReturnPath(path)
  return staffReturnPath(path) !== null || clinicalReturnPath(path) !== null
}

/**
 * The same-origin address that starts single sign-on, coming back to `returnPath`. The caller has checked the path
 * against its site's list (isSafeReturnPath); here it must still have the shared shape, or `/` is asked for instead,
 * never a repaired path. Both values are encoded, so a path can never add a parameter of its own.
 */
export function ssoStartHref(returnPath: string, { prompt }: { readonly prompt?: SsoPrompt } = {}): string {
  const returnTo = hasSafeReturnShape(returnPath) ? returnPath : '/'
  const asked = prompt === 'none' || prompt === 'login' ? `&prompt=${prompt}` : ''
  return `${SSO_START_PATH}?return_to=${encodeURIComponent(returnTo)}${asked}`
}

/**
 * The provider's end-session address from the product's sign-out answer (`{ endSessionUrl }`, contract v2 item 4), or
 * null when there is none to go to. Identity takes it from the provider's discovery, on the issuer's own origin; this
 * still never leaves for anything but an https address without credentials or a fragment.
 */
export function endSessionHref(answer: unknown): string | null {
  if (typeof answer !== 'object' || answer === null) return null
  const value = (answer as { readonly endSessionUrl?: unknown }).endSessionUrl
  if (typeof value !== 'string') return null
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '') return null
  return url.href
}
