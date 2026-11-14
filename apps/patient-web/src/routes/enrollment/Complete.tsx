import { HealthIdCode } from '../HealthIdCode'
import { Button } from '../../kasuwa/ui'

/**
 * Said wherever an activation signed the patient in (POST .../activate `signedIn: true`, hid-system, owner decision
 * 2026-10-28): on a shared device, the person who signed up stays signed in until they sign out.
 */
export const SIGNED_IN_ON_THIS_DEVICE = 'You are signed in on this device. If other people use it, sign out when you finish.'

/**
 * "Your Health ID is ready": the one screen every way of signing up ends on (the sign-up, the NIN route). The HID is
 * shown only here (hid-system#68, N2(a) and N2(b)): the activation response expires the enrollment cookie, and if that
 * response is lost GET /current shows the HID for 15 minutes after activation only. Nothing is stored; it is copied
 * only when the patient asks. One sentence, then one action: "Go to my Health ID" when the activation signed the
 * patient in (it opens the portal), otherwise Sign in.
 */
export function Complete({ focusTarget, hidCode, signedIn = false, onProceed }: {
  focusTarget: (element: HTMLElement | null) => void
  hidCode: string
  /** The activation signed the patient in on this device, and the session was taken up. */
  signedIn?: boolean
  onProceed?: () => void
}) {
  const inNow = signedIn && onProceed !== undefined
  return <div className="flex flex-col gap-4" role="status" aria-atomic="false">
    <h2 ref={focusTarget} tabIndex={-1} className="m-0 text-title-2 text-ink outline-none">Your Health ID is ready</h2>
    <HealthIdCode code={hidCode} copyButton />
    <p className="m-0 text-sm text-ink-2">{inNow ? 'Write it down: you sign in with it and your password.'
      : 'Write it down now: this page may not show it again.'}</p>
    {inNow ? <Button variant="primary" size="lg" block onClick={onProceed}>Go to my Health ID</Button>
      : <Button to="/sign-in" variant="primary" size="lg" block>Sign in</Button>}
    {inNow && <p className="m-0 text-[13px] text-ink-3">{SIGNED_IN_ON_THIS_DEVICE}</p>}
  </div>
}
