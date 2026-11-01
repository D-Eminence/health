import { Link } from 'react-router-dom'
import { Button } from '../../kasuwa/ui'

/** Identity's own wording for a start refused while registration is closed (hid-system#68). */
export const REGISTRATION_CLOSED = 'New Health ID registration is not open yet. If you already have a Health ID, sign in.'

/** What a person who already has a Health ID does while sign-ups are closed. */
export const CLOSED_NEXT = 'If you already have a Health ID, sign in.'

/** No new Health ID can be started: no NIN field, no security check. Said once: the heading, then what to do. */
export function RegistrationClosed({ focusTarget }: { focusTarget: (element: HTMLElement | null) => void }) {
  return <section className="flex flex-col gap-4" aria-labelledby="enroll-closed-title">
    <h2 id="enroll-closed-title" ref={focusTarget} tabIndex={-1} className="m-0 text-title-2 text-ink outline-none">Sign-ups are closed for now</h2>
    <p role="status" className="m-0 text-sm text-ink-2">{CLOSED_NEXT}</p>
    <Button to="/sign-in" variant="primary" size="lg" block>Sign in</Button>
    <Link className="inline-flex min-h-11 items-center self-center text-[13px] font-medium text-brand-ink" to="/recover">Forgot password?</Link>
  </section>
}
