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

/**
 * Runs a sign-in in the same turn as refreshes. A refresh another window has in
 * flight would otherwise answer after the sign-in and replace the new session's
 * cookies with the rotated old ones.
 */
export async function inRefreshTurn<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  return locks ? locks.request(LOCK, task) : task()
}

/**
 * Runs a sign-out in the same turn. hid-system's logout, once accepted, clears
 * the session cookies in its answer, which would undo a sign-in another window
 * made while it was in flight. It also ends whichever session the cookies carry
 * when it reaches the server, so a sign-out that had to wait first asks, through
 * `stillOurs`, whether the browser still holds the session it means to end: the
 * window before it may have signed another account in. That session is left
 * alone; the one meant has already left this browser. A window that does not
 * hear other windows sign in asks every time (`alwaysAsk`). A sign-out whose
 * question is refused is not sent; the refusal is the caller's to handle.
 */
export async function signOutInTurn(stillOurs: () => Promise<boolean>, signOut: () => Promise<unknown>,
  { alwaysAsk = false }: { readonly alwaysAsk?: boolean } = {}): Promise<void> {
  const send = async () => { if (await stillOurs()) await signOut() }
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks) { if (alwaysAsk) await send(); else await signOut(); return }
  await locks.request(LOCK, { ifAvailable: true }, async free => {
    if (free) { if (alwaysAsk) await send(); else await signOut(); return }
    await locks.request(LOCK, send)
  })
}
