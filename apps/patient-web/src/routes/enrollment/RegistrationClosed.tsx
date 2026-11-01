import { Link } from 'react-router-dom'
import { Button } from '../../kasuwa/ui'

/** Identity's own wording for a start refused while registration is closed (hid-system#68). */
export const REGISTRATION_CLOSED = 'New Health ID registration is not open yet. If you already have a Health ID, sign in.'

/** No new Health ID can be started: no NIN field, no security check. */
export function RegistrationClosed({ focusTarget }: { focusTarget: (element: HTMLElement | null) => void }) {
  return <section className="flex flex-col gap-4" aria-labelledby="enroll-closed-title">
    <h2 id="enroll-closed-title" ref={focusTarget} tabIndex={-1} className="m-0 text-title-2 text-ink outline-none">Sign-ups aren’t open yet</h2>
    <p role="status" className="m-0 text-sm text-ink-2">{REGISTRATION_CLOSED}</p>
    <Button to="/sign-in" variant="primary" size="lg" block>Sign in</Button>
    <Link className="self-center text-[13px] font-medium text-brand-ink" to="/recover">Forgot password?</Link>
  </section>
}
