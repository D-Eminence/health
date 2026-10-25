import { STAFF_JOIN_PATH } from '../productHostname'

/**
 * An invitation link carried through a staff sign-in (P4b SPEC 8.3). The email sends existing staff to
 * `https://<their site>/provider/staff/join#<invitationId>.<token>`. The fragment never reaches a server; the workspace
 * takes it out of the address before anything else renders, so it is neither shown nor kept in history, nor carried in
 * a sign-in's return address, and holds it for 30 minutes.
 *
 * It is held in this page's memory, not in session storage as the spec suggests: the portal keeps nothing in browser
 * storage (eslint NO_BROWSER_STORAGE, docs/ARCHITECTURE.md), and the staff sign-in is an in-page step, so the link is
 * still here when it finishes. A reload during the sign-in forgets it; the join page then asks for the email's code.
 */
const LIFETIME_MS = 30 * 60_000

/** `<uuid v4>.<43 base64url characters>`, as Identity issues a link (P4b SPEC 4.4). */
const LINK = /^#?([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i

export interface InvitationLink { invitationId: string; token: string }

let held: (InvitationLink & { savedAt: number }) | null = null

/** The invitation an address fragment carries, or null. */
export function invitationLinkOf(hash: string): InvitationLink | null {
  const match = LINK.exec(hash)
  return match ? { invitationId: match[1]!.toLowerCase(), token: match[2]! } : null
}

/**
 * On the signed-in join page, takes the link's fragment out of the address and holds it. Called synchronously on the
 * workspace's first render, before the sign-in gate decides where to go. Returns whether it found one.
 */
export function captureStaffInvitationFragment(now = Date.now()): boolean {
  const { pathname, search, hash } = window.location
  if (pathname.replace(/\/+$/, '').toLowerCase() !== STAFF_JOIN_PATH || !hash) return false
  const link = invitationLinkOf(hash)
  // The secret leaves the address whether or not it is a link, and whatever its shape.
  try { window.history.replaceState(window.history.state, '', `${pathname}${search}`) } catch { /* nothing to strip */ }
  if (!link) return false
  held = { ...link, savedAt: now }
  return true
}

/** The held link while it is under 30 minutes old; an older one is forgotten. */
export function capturedStaffInvitation(now = Date.now()): InvitationLink | null {
  if (!held) return null
  if (now - held.savedAt < 0 || now - held.savedAt >= LIFETIME_MS) { held = null; return null }
  return { invitationId: held.invitationId, token: held.token }
}

export function forgetStaffInvitation(): void {
  held = null
}
