/**
 * Sign-in's "Finish creating your Health ID" (SignIn.tsx) opens the sign-up with the email typed there, carried in
 * router state, never the URL. The sign-up takes it into memory and drops it from the history entry
 * (routes/Enrollment.tsx), so it is not kept in the browser's history either.
 */
export interface SignupHandoff { readonly signupEmail: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The state to send with the link: only an email, since a Health ID typed there says nothing to the sign-up. */
export function signupHandoff(typed: string): SignupHandoff | undefined {
  const email = typed.trim()
  return email.length <= 254 && EMAIL.test(email) ? { signupEmail: email } : undefined
}

/** The email router state carries, or '' when it carries none. */
export function signupEmailOf(state: unknown): string {
  const value = typeof state === 'object' && state !== null ? (state as { signupEmail?: unknown }).signupEmail : undefined
  return typeof value === 'string' ? signupHandoff(value)?.signupEmail ?? '' : ''
}
