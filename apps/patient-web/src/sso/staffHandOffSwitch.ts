/**
 * Whether the provider workspace hands off to single sign-on on the staff sites (sso/singleSignOn.ts staffHandOffSite),
 * once VITE_HID_SSO is on. Off until the staff sign-out ends the provider's session and a session that ends in the
 * workspace asks for a new sign-in (staff/api.ts and staff/App.tsx, their owner's change). Until then a staff sign-out
 * leaves the provider's session live, and the hand-off that follows would sign the same person straight back in,
 * without a word, on a shared workstation. The owner sets this to true in that same change. Its own one-line module, as
 * ehr-blue/clinicSwitch.ts is, so that tests can stand in for it.
 */
export const STAFF_HAND_OFF: boolean = false
