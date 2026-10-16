/**
 * The Google client ID this build was given, or '' when Google sign-in is not
 * offered: a blank value counts as none, so no page shows a Google path, or its
 * security check, without a button to use them.
 *
 * A page that renders GoogleButton must also test
 * `import.meta.env.VITE_HID_GOOGLE_CLIENT_ID` inline, in the same condition.
 * The bundler folds that read, so a build without a client ID drops Google's
 * button and its script loader; it cannot fold a call to this function.
 * hid-system's staging step (infra/cloudflare/scripts/health-id-artifact.mjs)
 * refuses a build that carries them.
 */
export function googleClientId(): string {
  return String(import.meta.env.VITE_HID_GOOGLE_CLIENT_ID ?? '').trim()
}
