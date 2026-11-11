/**
 * Where sign-in goes once it has worked, from its `next` parameter (a page that asked the patient to sign in again,
 * such as Access & sharing after a refusal for an old sign-in). Only a path on this site is taken: one that starts with
 * a single "/" and holds no backslash or control character, so no address can send the patient to another site.
 * Anything else, or nothing, is the home page.
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/'
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return '/'
  try {
    const base = 'https://app.invalid'
    const url = new URL(value, base)
    if (url.origin !== base) return '/'
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}

/** The sign-in page's address that comes back to `path` once signed in. */
export const signInReturningTo = (path: string) => `/sign-in?next=${encodeURIComponent(path)}`
