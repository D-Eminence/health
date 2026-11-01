import { buttonClass } from '../../kasuwa/ui'
/** Why no code can be texted, when Identity said nothing more: the route is off, or the record has no usable phone. */
export const ONLINE_OFF = 'A code by text message isn\'t available right now.'
export const ONLINE_NOT_FOR_RECORD = 'We can\'t send a code to the phone on your NIN record.'

interface RouteChoiceProps {
  focusTarget: (element: HTMLElement | null) => void
  busy: boolean
  /** Whether a code can be texted now; when not, `onlineNote` says why. */
  online: boolean
  onlineNote: string
  facility: boolean
  onSend: () => void
  onFacility: () => void
  onDifferentNin: () => void
}

/**
 * `verify_holder` (hid-system #84, ADR-062): the NIN was checked and nothing is
 * verified as the patient's yet. The patient chooses how to prove it is theirs:
 * a code texted to the phone on the NIN record, or an in-person check at a
 * participating facility for someone who cannot use that phone (owner decision
 * 2026-10-14, steps 2 to 4). Nothing is sent until they choose.
 */
export function RouteChoice({ focusTarget, busy, online, onlineNote, facility, onSend, onFacility, onDifferentNin }: RouteChoiceProps) {
  return <section className="flex flex-col gap-4 text-sm text-ink-2 [&_h2]:m-0 [&_h2]:text-title-2 [&_h2]:text-ink [&_h2]:outline-none [&_p]:m-0" aria-labelledby="enroll-choose-title">
    <h2 id="enroll-choose-title" ref={focusTarget} tabIndex={-1}>Prove this NIN is yours</h2>
    <p>Choose one way. No Health ID is made until you do.</p>
    <section className="flex flex-col gap-2 rounded-xl p-4 ring-1 ring-line [&_:is(h2,h3)]:m-0 [&_:is(h2,h3)]:text-sm [&_:is(h2,h3)]:font-semibold [&_:is(h2,h3)]:text-ink [&_a]:font-medium [&_a]:text-brand-ink [&_p]:m-0" aria-labelledby="enroll-online-title">
      <h3 id="enroll-online-title">Get a code by text message</h3>
      {online ? <>
        <p>We'll text a 6-digit code to the phone linked to your NIN.</p>
        <button type="button" className={buttonClass({ variant: 'primary', size: 'lg', block: true })} disabled={busy} onClick={onSend}>{busy ? 'Sending…' : 'Text me a code'}</button>
      </> : <p>{onlineNote}</p>}
    </section>
    <section className="flex flex-col gap-2 rounded-xl p-4 ring-1 ring-line [&_:is(h2,h3)]:m-0 [&_:is(h2,h3)]:text-sm [&_:is(h2,h3)]:font-semibold [&_:is(h2,h3)]:text-ink [&_a]:font-medium [&_a]:text-brand-ink [&_p]:m-0" aria-labelledby="enroll-facility-title">
      <h3 id="enroll-facility-title">Register at a healthcare facility</h3>
      {facility ? <>
        <p>Lost your SIM, changed your number, or can't get the code? A staff member at a participating facility checks one original photo ID in person.</p>
        <button type="button" className={buttonClass({ variant: online ? 'secondary' : 'primary', size: 'lg', block: true })} disabled={busy} onClick={onFacility}>Register at a facility</button>
      </> : <p>Registering at a healthcare facility isn't available right now. If you can't use the phone linked to your NIN, try again later or contact Health ID support.</p>}
    </section>
    <button type="button" className={buttonClass({ variant: 'link', className: 'self-start' })} disabled={busy} onClick={onDifferentNin}>Use a different NIN</button>
  </section>
}
