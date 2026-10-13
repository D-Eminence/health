/**
 * The Google client ID this build was given, or '' when Google sign-in is not
 * offered: a blank value counts as none, so no page shows a Google path, or its
 * security check, without a button to use them.
 */
export function googleClientId(): string {
  return String(import.meta.env.VITE_HID_GOOGLE_CLIENT_ID ?? '').trim()
}
