import type { FormEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { describedBy } from '../../authSteps'
import { FACILITY_LIST_PATH, type OwnershipRoutes } from './availability'
import type { StepProps } from './stepProps'
import { Button, Field } from '../../kasuwa/ui'
import { InputR } from '../profileParts'

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
  return <form onSubmit={onSubmit} className="flex flex-col gap-4">
    <Field label="National Identification Number (NIN)" htmlFor="enroll-nin" hintId="enroll-nin-hint" hint="11 digits. It isn’t stored in this browser.">
      <InputR id="enroll-nin" ref={focusTarget} required inputMode="numeric" autoComplete="off" value={nin} onChange={event => onNin(event.target.value.replace(/\D/g, '').slice(0, 11))} pattern="[0-9]{11}" maxLength={11} placeholder="11 digits"
        aria-invalid={invalid} aria-describedby={describedBy('enroll-nin-hint', errorId)} />
    </Field>
    {routes && (routes.online || routes.facility) && <section className="flex flex-col gap-2 rounded-xl p-4 text-[13px] text-ink-2 ring-1 ring-line [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:font-medium [&_a]:text-brand-ink [&_p]:m-0" aria-labelledby="enroll-routes-title">
      <h2 id="enroll-routes-title" className="m-0 text-sm font-semibold text-ink">How you’ll prove this NIN is yours</h2>
      {/* Only the ways open now are listed: one that isn't is left out, not announced. */}
      <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5">
        {routes.online && <li>Online: we text a 6-digit code to the phone number linked to your NIN.</li>}
        {routes.facility && <li>At a participating facility, if you lost your SIM, changed your number, have no phone linked to your NIN, or can't get the code: a staff member checks one original photo ID in person.</li>}
      </ul>
      {routes.facility && <Link to={FACILITY_LIST_PATH} className="-my-2 self-start">See participating facilities and what to bring</Link>}
    </section>}
    {turnstile}
    <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={busy || blocked || nin.length !== 11}>{busy ? 'Checking your NIN…' : 'Continue'}</Button>
  </form>
}
