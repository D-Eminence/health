/**
 * The staff and patient portals share one origin and its session cookies.
 * hid-system rotates the refresh token on every refresh and, when the same
 * token is presented twice, ends the whole sign-in as token reuse. Two windows
 * of the portal refreshing together (both back from a break, say) would do just
 * that. So refreshes take turns across windows, through the browser's Web Locks.
 * A refresh that had to wait first asks whether the session is accepted again:
 * the window before it has usually just refreshed it, and a second rotation is
 * not needed. Without Web Locks the refresh is sent as before.
 */
const LOCK = 'hid-session-refresh'

export async function refreshInTurn<T>(current: () => Promise<T | null>, refresh: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks) return refresh()
  return locks.request(LOCK, { ifAvailable: true }, async free => {
    if (free) return refresh()
    return locks.request(LOCK, async () => (await current()) ?? refresh())
  })
}
