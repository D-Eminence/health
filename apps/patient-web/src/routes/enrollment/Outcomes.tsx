import { Link } from 'react-router-dom'
import { buttonClass } from '../../kasuwa/ui'

type Focus = (element: HTMLElement | null) => void

/**
 * 409 NIN_ALREADY_REGISTERED, which Identity says only after the NIN holder is
 * proved: by a correct code (POST .../holder/verify), or at activation when the
 * NIN was bound since (hid-system #84, ADR-062). Account recovery, never a
 * second identity, and Health ID support with the reference for someone who
 * never registered (Health-id alignment row 8). Nothing names the NIN, a Health
 * ID or a contact.
 */
export function AlreadyRegistered({ focusTarget, reference }: { focusTarget: Focus; reference: string | null }) {
  return <section className="flex flex-col gap-4 text-sm text-ink-2 [&_h2]:m-0 [&_h2]:text-title-2 [&_h2]:text-ink [&_h2]:outline-none [&_p]:m-0" aria-labelledby="enroll-registered-title">
    <h2 id="enroll-registered-title" ref={focusTarget} tabIndex={-1}>This NIN already has a Health ID</h2>
    <p>We can't create another Health ID for this NIN. Use account recovery to get back into it.</p>
    <Link className={buttonClass({ variant: 'primary', size: 'lg', block: true })} to="/recover">Recover your account</Link>
    <Link className={buttonClass({ size: 'lg', block: true })} to="/sign-in">Sign in</Link>
    <p>{reference
      ? <>If you have never registered for a Health ID, contact Health ID support and quote this reference: <span className="font-mono font-semibold text-ink">{reference}</span>.</>
      : 'If you have never registered for a Health ID, contact Health ID support.'}</p>
  </section>
}

/**
 * GET .../current answers 404 at the facility stage (hid-system #85, ADR-063):
 * staff were told the NIN has a Health ID, which deletes the registration, it
 * expired, or a sign-in or sign-out in this browser expired its cookie
 * (Health-id alignment row 10). The staff member's direction comes first
 * (P31). Start again keeps the page's start key, so the NIN entered before a
 * reload resumes a registration that is still open, its check included, with
 * no new paid lookup; one that is gone starts afresh.
 */
export function RegistrationEnded({ focusTarget, onStartAgain }: { focusTarget: Focus; onStartAgain: () => void }) {
  return <section className="flex flex-col gap-4 text-sm text-ink-2 [&_h2]:m-0 [&_h2]:text-title-2 [&_h2]:text-ink [&_h2]:outline-none [&_p]:m-0" aria-labelledby="enroll-ended-title">
    <h2 id="enroll-ended-title" ref={focusTarget} tabIndex={-1}>This registration has ended</h2>
    <p>If the staff member told you this NIN already has a Health ID, use account recovery to get back into it.</p>
    <Link className={buttonClass({ variant: 'primary', size: 'lg', block: true })} to="/recover">Recover your account</Link>
    <Link className={buttonClass({ size: 'lg', block: true })} to="/sign-in">Sign in</Link>
    <p>Otherwise it may have expired after 24 hours, or ended when someone signed in or out in this browser. Select Start again and enter your NIN without reloading this page: a registration that is still open continues where it stopped.</p>
    <button type="button" className={buttonClass({ variant: 'link', className: 'self-start' })} onClick={onStartAgain}>Start again</button>
  </section>
}

/**
 * The start's 409 IDEMPOTENCY_KEY_REUSED: the registration this page's key
 * started was activated, and its Health ID may never have been seen (a lost
 * activation answer, or another tab). Sign-in and account recovery; no new
 * start, which would spend a paid NIN lookup and a holder proof only to be
 * refused 409 NIN_ALREADY_REGISTERED. Only this page's key gets this answer,
 * so it says nothing about anyone else's NIN.
 */
export function RegistrationCompleted({ focusTarget }: { focusTarget: Focus }) {
  return <section className="flex flex-col gap-4 text-sm text-ink-2 [&_h2]:m-0 [&_h2]:text-title-2 [&_h2]:text-ink [&_h2]:outline-none [&_p]:m-0" aria-labelledby="enroll-completed-title">
    <h2 id="enroll-completed-title" ref={focusTarget} tabIndex={-1}>This registration was completed</h2>
    <p>A Health ID was created with this registration, so it can't be started again.</p>
    <p>Sign in with your email or Health ID and the password you chose. If you can't, or you don't have your Health ID, use account recovery.</p>
    <Link className={buttonClass({ variant: 'primary', size: 'lg', block: true })} to="/sign-in">Sign in</Link>
    <Link className={buttonClass({ size: 'lg', block: true })} to="/recover">Recover your account</Link>
  </section>
}
