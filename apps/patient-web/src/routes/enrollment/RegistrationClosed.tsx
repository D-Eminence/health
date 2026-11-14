import { Link } from 'react-router-dom'
import { Button } from '../../kasuwa/ui'

/**
 * A start refused, or availability closed, while registration is closed (hid-system#68). After launch that is a pause
 * (a switch, or the NIN service down), said in the website's own words (owner's rule, 1 Nov 2026), not as "not open
 * yet", which reads as a service still to come.
 */
export const REGISTRATION_CLOSED = 'New sign-ups are paused right now. Please try again later. If you already have a Health ID, sign in.'

/** No new Health ID can be started: no NIN field, no security check. */
export function RegistrationClosed({ focusTarget }: { focusTarget: (element: HTMLElement | null) => void }) {
  return <section className="flex flex-col gap-4" aria-labelledby="enroll-closed-title">
    <h2 id="enroll-closed-title" ref={focusTarget} tabIndex={-1} className="m-0 text-title-2 text-ink outline-none">New sign-ups are paused</h2>
    <p role="status" className="m-0 text-sm text-ink-2">{REGISTRATION_CLOSED}</p>
    <Button to="/sign-in" variant="primary" size="lg" block>Sign in</Button>
    <Link className="inline-flex min-h-11 items-center self-center text-[13px] font-medium text-brand-ink" to="/recover">Forgot password?</Link>
  </section>
}
