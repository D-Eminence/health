import { Link } from 'react-router-dom'

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
  return <section className="patient-success" aria-labelledby="enroll-registered-title">
    <h2 id="enroll-registered-title" ref={focusTarget} tabIndex={-1}>This NIN already has a Health ID</h2>
    <p>We can't create another Health ID for this NIN. Use account recovery to get back into it.</p>
    <Link className="patient-primary-button" to="/recover">Recover your account</Link>
    <Link className="patient-secondary-button" to="/sign-in">Sign in</Link>
    <p>{reference
      ? <>If you have never registered for a Health ID, contact Health ID support and quote this reference: <span className="patient-code">{reference}</span>.</>
      : 'If you have never registered for a Health ID, contact Health ID support.'}</p>
  </section>
}

/**
 * GET .../current answers 404 after an in-person check (hid-system #85,
 * ADR-063): staff were told the NIN has a Health ID, which deletes the
 * registration, or it expired. The page follows the staff member's direction
 * and does not ask for the same NIN, which would start a new paid lookup
 * (P31).
 */
export function RegistrationEnded({ focusTarget, onStartAgain }: { focusTarget: Focus; onStartAgain: () => void }) {
  return <section className="patient-success" aria-labelledby="enroll-ended-title">
    <h2 id="enroll-ended-title" ref={focusTarget} tabIndex={-1}>This registration has ended</h2>
    <p>If the staff member told you this NIN already has a Health ID, use account recovery to get back into it.</p>
    <Link className="patient-primary-button" to="/recover">Recover your account</Link>
    <Link className="patient-secondary-button" to="/sign-in">Sign in</Link>
    <p>Otherwise the registration may have expired: it lasts 24 hours. You can start again.</p>
    <button type="button" className="patient-text-button" onClick={onStartAgain}>Start again</button>
  </section>
}
