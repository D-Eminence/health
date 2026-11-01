import { servedHere, siteOf } from './productSites'
import { STAFF_PRODUCT_ROUTES, type StaffProductKey } from './productHostname'
import { staffReturnPath } from './staff/session'

/**
 * One sign-in for every staff site (DRAFT, off unless the build turns it on): OpenID Connect with each product as its
 * own client behind its own server (backend-for-frontend), hid-system CODEX.md §38. The page's part is small:
 *
 * - A staff site that finds no session leaves for its OWN server's start address (same origin, through its /api/v1
 *   proxy), naming only a page of this site to come back to. That server holds state, nonce and the PKCE verifier,
 *   sends the browser to the auth. site (trying prompt=none first, so a person already signed in sees no sign-in), takes
 *   the code back at its fixed callback, and sets this site's own host-only session. No token reaches this page.
 * - The auth. site's sign-in page knows its authorization request only by an opaque id, never by an address: once the
 *   person signs in there, its server continues that request and sends the browser to the client's registered callback.
 *
 * No absolute address is ever read from a query here. The patient portal (app.) and the platform admin site (admin.) are
 * not part of it: patients are their own users, and platform administrators sign in with their own second factor.
 */
const AUTH_HOSTNAMES = {
  production: 'auth.healthidentitydirectory.com',
  staging: 'auth.staging.healthidentitydirectory.com',
} as const

type Deployment = keyof typeof AUTH_HOSTNAMES

/** Each staff site's server: where the sign-in starts, and the page to come back to. */
export const SIGN_IN_START_PATH = '/api/v1/auth/oidc/start'
export const RETURN_TO = 'return_to'
/** The auth. site: its sign-in page, the opaque request it signs in for, and where its server continues that request. */
export const AUTH_SIGN_IN_PATH = '/signin'
export const AUTHORIZATION_REQUEST = 'request'
export const CONTINUE_AUTHORIZATION_PATH = '/api/v1/auth/oidc/authorize/continue'

/** Whether this build sends staff sign-in through the auth. site. Off until the servers serve the flow. */
export function centralSignInEnabled(): boolean {
  return import.meta.env.VITE_HID_CENTRAL_SIGN_IN === 'true'
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.+$/, '')
}

/** The deployment whose auth. site this host is, or null. */
export function authDeploymentOf(hostname: string): Deployment | null {
  const normalized = normalizeHostname(hostname)
  return (Object.keys(AUTH_HOSTNAMES) as Deployment[]).find(deployment => AUTH_HOSTNAMES[deployment] === normalized) ?? null
}

/** The staff product a host is, of the five taking part: never app., admin., auth., or any host not a Health ID site. */
function staffProductOf(hostname: string): StaffProductKey | null {
  const site = siteOf(hostname)
  return site && site.key !== 'web' ? site.key : null
}

/** Whether `value` holds a character no return path may hold, however a parser would read it. */
function unsafe(value: string): boolean {
  return [...value].some(character => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f || character === '\\'
    || /\s/.test(character))
}

/**
 * A page of this staff site to come back to after sign-in: a path on this host only (one leading slash, nothing that
 * names another host or scheme), with no query, fragment or escape, on the staff app's exact return list, and a page this
 * site serves. Null for anything else. The site's server applies the same rule to what it is given (the contract) and
 * keeps the page against `state`; this is the page's half.
 */
export function safeReturnPath(value: string, hostname: string): string | null {
  const product = staffProductOf(hostname)
  if (!product || unsafe(value) || !value.startsWith('/') || value.startsWith('//')) return null
  if (value.includes('?') || value.includes('#') || value.includes('%')) return null
  const page = value.replace(/\/+$/, '').toLowerCase() || '/'
  if (page.split('/').some(segment => segment === '.' || segment === '..')) return null
  if (staffReturnPath(page) === null && page !== STAFF_PRODUCT_ROUTES[product]) return null
  return servedHere(page, hostname) ? page : null
}

/**
 * Where a staff site sends a person it finds signed out: its own server's sign-in start, on this origin, naming the page
 * asked for when it may come back to it, else the site's own page. Null where central sign-in does not apply (a host that
 * is not one of the five staff sites), which keeps its own sign-in.
 */
export function signInStartHref(pathname: string, hostname: string): string | null {
  const product = staffProductOf(hostname)
  if (!product) return null
  const page = safeReturnPath(pathname, hostname) ?? STAFF_PRODUCT_ROUTES[product]
  return `${SIGN_IN_START_PATH}?${new URLSearchParams({ [RETURN_TO]: page })}`
}

/** An authorization request's id as the auth. site's server gives it: opaque, URL-safe, and only one. */
const REQUEST_ID = /^[A-Za-z0-9_-]{22,128}$/

/** On the auth. site: the authorization request this sign-in is for, from its query, or null (opened directly). */
export function authorizationRequest(search: string): string | null {
  const values = new URLSearchParams(search).getAll(AUTHORIZATION_REQUEST)
  return values.length === 1 && REQUEST_ID.test(values[0]!) ? values[0]! : null
}

/**
 * On the auth. site, once signed in: its own server's continuation of the request (same origin), which issues the code
 * to the client's registered callback. With no request, the deployment's Hospital EHR, whose own sign-in start then finds
 * the auth. session and needs no sign-in. Null on a host that is not an auth. site.
 */
export function afterCentralSignInHref(search: string, authHostname: string): string | null {
  const deployment = authDeploymentOf(authHostname)
  if (!deployment) return null
  const request = authorizationRequest(search)
  if (request) return `${CONTINUE_AUTHORIZATION_PATH}?${new URLSearchParams({ [AUTHORIZATION_REQUEST]: request })}`
  return deployment === 'production' ? 'https://ehr.healthidentitydirectory.com/provider' : 'https://ehr.staging.healthidentitydirectory.com/provider'
}
