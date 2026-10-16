import type { FormEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { describedBy } from '../../authSteps'
import { FACILITY_LIST_PATH, type OwnershipRoutes } from './availability'
import type { StepProps } from './stepProps'

interface NinStepProps extends StepProps {
  nin: string
  onNin: (nin: string) => void
  onSubmit: (event: FormEvent) => void
  /** The security check, which the page owns. */
  turnstile: ReactNode
  /** Why the step cannot be sent yet, besides a NIN of 11 digits and the security check. */
  blocked: boolean
  /** The routes that prove the NIN holder, or null from an Identity before the holder step. */
  routes: OwnershipRoutes | null
}

/**
 * The NIN, which Identity checks with QoreID before anything else. Since the
 * holder step (hid-system #84 and #85) both ways to prove the NIN is the
 * patient's are told here, before anything is sent, with a clear one for someone
 * who cannot use the phone linked to it (owner decision 2026-10-14, step 2). An
 * Identity before it has neither, so neither is described.
 */
export function NinStep({ focusTarget, busy, invalid, errorId, nin, onNin, onSubmit, turnstile, blocked, routes }: NinStepProps) {
  return <form onSubmit={onSubmit} className="patient-form">
    <label>National Identification Number<input ref={focusTarget} required inputMode="numeric" autoComplete="off" value={nin} onChange={event => onNin(event.target.value.replace(/\D/g, '').slice(0, 11))} pattern="[0-9]{11}" maxLength={11} placeholder="11 digits"
      aria-invalid={invalid} aria-describedby={describedBy('enroll-nin-hint', errorId)} /></label>
    <p id="enroll-nin-hint" className="patient-field-hint">Your NIN is 11 digits. It is verified by the existing Health ID identity service. It is not stored in this browser.</p>
    {routes && <section className="patient-enroll-option" aria-labelledby="enroll-routes-title">
      <h2 id="enroll-routes-title">How you'll prove this NIN is yours</h2>
      <p>After we check your NIN, you prove that it is yours. No Health ID is created until you do.</p>
      <ul className="patient-enroll-routes">
        <li>{routes.online ? 'Online: we text a 6-digit code to the phone number linked to your NIN.'
          : 'A code by text message isn\'t available right now.'}</li>
        <li>{routes.facility
          ? 'At a participating healthcare facility: if you lost your SIM, changed your number, have no phone linked to your NIN, or can\'t get the code, a staff member checks one original photo ID in person. You start here with your NIN either way.'
          : 'Registering at a healthcare facility isn\'t available yet.'}</li>
      </ul>
      {routes.facility && <Link to={FACILITY_LIST_PATH}>See participating facilities and what to bring</Link>}
    </section>}
    {turnstile}
    <button type="submit" className="patient-primary-button" disabled={busy || blocked || nin.length !== 11}>{busy ? 'Checking your NIN…' : 'Continue'}</button>
  </form>
}
