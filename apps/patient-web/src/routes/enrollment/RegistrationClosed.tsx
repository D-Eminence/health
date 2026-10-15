import { Link } from 'react-router-dom'

/** Identity's own wording for a start refused while registration is closed (hid-system#68). */
export const REGISTRATION_CLOSED = 'New Health ID registration is not open yet. If you already have a Health ID, sign in.'

/** No new Health ID can be started: no NIN field, no security check. */
export function RegistrationClosed({ focusTarget }: { focusTarget: (element: HTMLElement | null) => void }) {
  return <section className="patient-success" aria-labelledby="enroll-closed-title">
    <h2 id="enroll-closed-title" ref={focusTarget} tabIndex={-1}>Registration is not open yet</h2>
    <p role="status">{REGISTRATION_CLOSED}</p>
    <Link className="patient-primary-button" to="/sign-in">Sign in</Link>
    <Link className="patient-text-button" to="/recover">Forgot password?</Link>
  </section>
}
