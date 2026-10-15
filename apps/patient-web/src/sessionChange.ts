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

/**
 * Whether a patient route refused the request because the session the browser
 * sent is not a patient's. Since hid-system#74 (EHR) and #76 (Identity, ADR-059) every patient-only route
 * answers any other session so, with 403 PATIENT_SESSION_REQUIRED, before its
 * handler runs: the shared cookies may now hold a provider's or an administrator's
 * sign-in. The portal then asks the server whose session it is, as on hearing of a
 * change from another tab; it never signs out on the 403 alone.
 */
export function patientSessionRequired(error: unknown): error is HidApiError {
  return isHidApiError(error) && error.status === 403 && error.code === 'PATIENT_SESSION_REQUIRED'
}

/**
 * The channel this tab listens with, for either portal. A tab announces on the
 * channel it listens with, since a channel never hears its own messages: a tab is
 * not told of its own sign-in or sign-out.
 */
let tabs: BroadcastChannel | null = null
let tabListeners = 0

/** Calls `listener` each time another tab of the origin says the browser's session changed. */
export function onOtherTabSessionChange(listener: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined
  // A browser that refuses the channel leaves this tab to notice changes on its
  // own (a refused request, a return to the page); the portal still works.
  let channel: BroadcastChannel
  try { channel = tabs ??= new BroadcastChannel(SESSION_CHANGE_CHANNEL) } catch { return () => undefined }
  const receive = () => listener()
  try { channel.addEventListener('message', receive) } catch {
    if (tabListeners === 0 && tabs === channel) { tabs = null; try { channel.close() } catch { /* already unusable */ } }
    return () => undefined
  }
  tabListeners += 1
  return () => {
    channel.removeEventListener('message', receive)
    tabListeners -= 1
    if (tabListeners === 0 && tabs === channel) { channel.close(); tabs = null }
  }
}

/** Tells the other tabs on the channel this tab listens with; a tab that does not listen says nothing. */
export function announceToListeningTabs(): void {
  try { tabs?.postMessage('changed') } catch { /* best effort, as for listening */ }
}

/** Tells this origin's other tabs that the browser's session changed. */
export function announceSessionChange(): void {
  if (typeof BroadcastChannel === 'undefined') return
  if (tabs) { announceToListeningTabs(); return }
  // Best effort: a browser that refuses the channel (for example with storage
  // blocked) only loses the announcement, never the sign-in or sign-out.
  try {
    const channel = new BroadcastChannel(SESSION_CHANGE_CHANNEL)
    // Delivery is queued as the message is posted, so closing at once loses nothing.
    channel.postMessage('changed')
    channel.close()
  } catch { /* nothing to announce on */ }
}
