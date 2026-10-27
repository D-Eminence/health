import { Link } from 'react-router-dom'
import { HealthIdCode } from '../HealthIdCode'

/**
 * The HID is shown only here (hid-system#68, N2(a) and N2(b)): the activation
 * response expires the enrollment cookie, and if that response is lost
 * GET /current shows the HID for 15 minutes after activation only. Until it is
 * also sent to the verified contact, a patient who verified only a phone signs
 * in and resets their password with it.
 */
const SAVE_HID = 'Save your Health ID now: write it down or keep it somewhere safe. This page may not show it again once you leave or reload it, and never more than 15 minutes after activation.'

/** The activated Health ID. Nothing is stored; it is copied only when the patient asks. */
export function Complete({ focusTarget, hidCode }: { focusTarget: (element: HTMLElement | null) => void; hidCode: string }) {
  return <div className="patient-success" role="status">
    <h2 ref={focusTarget} tabIndex={-1}>Your Health ID is ready.</h2>
    <HealthIdCode code={hidCode} />
    <p>{SAVE_HID}</p>
    <p>Sign in with your verified email or Health ID and new password. With a verified phone number, your Health ID is how you sign in and reset your password.</p>
    <Link className="patient-primary-button" to="/sign-in">Sign in</Link>
  </div>
}
