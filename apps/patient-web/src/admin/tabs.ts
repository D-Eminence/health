/**
 * Every admin tab in the browser uses the same platform session cookies
 * (hid_access_admin*), which no patient or staff sign-in touches, so platform
 * administration announces on a channel of its own. Each tab says when it signs
 * in or out, naming no one; a tab that hears it asks the server whose session
 * the browser now holds. This tab announces on the channel it listens with,
 * since a channel never hears its own messages.
 */
export const ADMIN_SESSION_CHANGE_CHANNEL = 'hid-admin-session-change'

let tabs: BroadcastChannel | null = null
let tabListeners = 0

export function onOtherAdminTabSessionChange(listener: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined
  // A browser that refuses the channel leaves this tab to notice on its own (a
  // refused request, a return to the page); the console still works.
  let channel: BroadcastChannel
  try { channel = tabs ??= new BroadcastChannel(ADMIN_SESSION_CHANGE_CHANNEL) } catch { return () => undefined }
  const receive = () => listener()
  channel.addEventListener('message', receive)
  tabListeners += 1
  return () => {
    channel.removeEventListener('message', receive)
    tabListeners -= 1
    if (tabListeners === 0 && tabs === channel) { channel.close(); tabs = null }
  }
}

export function announceAdminSessionChange(): void {
  try { tabs?.postMessage('changed') } catch { /* best effort, as for listening */ }
}
