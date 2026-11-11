import { LEGACY_PATIENT_PATHS } from './legacyPaths'

/**
 * Where sign-in opens once the patient is in (SO-04, HCS-06): the patient page they asked for, which the route guard
 * passes as router state `{ from }` when it sends a signed-out patient to sign-in, so a push notification's tap on
 * /notifications, or a session that ended on /records, comes back there. Home otherwise.
 *
 * Never an open redirect: only a path on this site, starting with one "/" (not "//" or "/\", which a browser reads as
 * another host), with no control characters, and only a patient page. The ways in (sign-in, sign-up, recovery), the
 * staff and administration workspaces served at this origin, the public card page (whose address may carry a shared
 * link's token) and hid-1.0's old addresses for the ways in are never returned to. An address that is no patient page
 * opens the portal's own "Page not found" once signed in.
 *
 * `from` may be a path ("/records?x#y") or a router location ({ pathname, search, hash }).
 */
const NEVER_RETURNED_TO = ['/sign-in', '/enroll', '/recover', '/verify', '/provider', '/admin']
const WAYS_IN = new Set(['/sign-in', '/enroll', '/recover'])
const ORIGIN = 'https://patient.invalid'

const hasControl = (text: string) => [...text].some(character => {
  const code = character.charCodeAt(0)
  return code < 0x20 || code === 0x7f
})

export function patientReturnPath(state: unknown): string {
  const from = typeof state === 'object' && state !== null ? (state as { from?: unknown }).from : undefined
  const asked = typeof from === 'string' ? from : locationPath(from)
  if (asked === null || !asked.startsWith('/') || asked.startsWith('//') || asked.includes('\\') || hasControl(asked)) return '/'
  let url: URL
  try { url = new URL(asked, ORIGIN) } catch { return '/' }
  if (url.origin !== ORIGIN) return '/'
  const path = url.pathname
  // As the router matches it: decoded, and without regard to case.
  let page: string
  try { page = decodeURIComponent(path).toLowerCase() } catch { return '/' }
  if (NEVER_RETURNED_TO.some(way => page === way || page.startsWith(`${way}/`))) return '/'
  if ((page === '/card' || page.startsWith('/card/')) && page !== '/card/preview') return '/'
  const legacy = Object.hasOwn(LEGACY_PATIENT_PATHS, page) ? LEGACY_PATIENT_PATHS[page] : undefined
  if (legacy !== undefined && WAYS_IN.has(legacy)) return '/'
  return `${path}${url.search}${url.hash}`
}

function locationPath(from: unknown): string | null {
  if (typeof from !== 'object' || from === null) return null
  const { pathname, search, hash } = from as { pathname?: unknown; search?: unknown; hash?: unknown }
  if (typeof pathname !== 'string') return null
  return `${pathname}${typeof search === 'string' ? search : ''}${typeof hash === 'string' ? hash : ''}`
}
