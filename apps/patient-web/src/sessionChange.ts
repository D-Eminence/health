import { isHidApiError, type HidApiError } from '@hid/http'

/**
 * The patient portal and the provider portal share this origin and the
 * browser's session cookies, so a sign-in or sign-out in one tab changes the
 * session every other tab uses. Each portal says so on this channel, naming no
 * one: a provider tab that hears it locks its workspace and asks the server.
 */
export const SESSION_CHANGE_CHANNEL = 'hid-session-change'

/**
 * Whether Identity refused a portal's cookie refresh or sign-out because the
 * shared cookies hold the other portal's sign-in. Each portal names itself in
 * X-HID-Client on those two calls, and Identity then refuses the other kind of
 * sign-in with 403 SESSION_CLIENT_MISMATCH (hid-system #39): nothing is rotated
 * or ended and the cookies are kept. The sign-in this portal held has left the
 * browser, so the portal ends its own session there and leaves the other alone.
 */
export function heldByOtherPortal(error: unknown): error is HidApiError {
  return isHidApiError(error) && error.status === 403 && error.code === 'SESSION_CLIENT_MISMATCH'
}

/** Tells this origin's other tabs that the browser's session changed. */
export function announceSessionChange(): void {
  if (typeof BroadcastChannel === 'undefined') return
  // Best effort: a browser that refuses the channel (for example with storage
  // blocked) only loses the announcement, never the sign-in or sign-out.
  try {
    const channel = new BroadcastChannel(SESSION_CHANGE_CHANNEL)
    // Delivery is queued as the message is posted, so closing at once loses nothing.
    channel.postMessage('changed')
    channel.close()
  } catch { /* nothing to announce on */ }
}
