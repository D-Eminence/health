/**
 * Password-free joining for outreach helpers (passwordless plan, phase 1): the invitation page offers "Join" buttons
 * that accept with the link alone and sign this phone in (identity-api accept-link, proposed). Off unless the build sets
 * VITE_HID_OUTREACH_INVITE_LINK_SIGN_IN to exactly "1" or "true"; unset, the invitation page is today's, word for word.
 * Read by name, so Vite inlines only this variable (buildConfig.test.ts). Even when on, a backend without the route, or
 * with its own switch (OUTREACH_INVITE_LINK_SIGN_IN_ENABLED) off, answers 404 and the page falls back to today's
 * password form.
 */
export function outreachInviteLinkSignInEnabled(): boolean {
  const value = import.meta.env.VITE_HID_OUTREACH_INVITE_LINK_SIGN_IN
  return value === '1' || value === 'true'
}
