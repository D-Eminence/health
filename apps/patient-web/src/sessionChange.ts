/**
 * The patient portal and the provider portal share this origin and the
 * browser's session cookies, so a sign-in or sign-out in one tab changes the
 * session every other tab uses. Each portal says so on this channel, naming no
 * one: a provider tab that hears it locks its workspace and asks the server.
 */
export const SESSION_CHANGE_CHANNEL = 'hid-session-change'

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
