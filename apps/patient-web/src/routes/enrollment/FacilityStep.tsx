import type { PatientApi } from '../../api'
import { buttonClass } from '../../kasuwa/ui'
import { FacilityList } from './FacilityList'

/** Desk codes one registration may get (hid-system ADR-063). */
export const DESK_CODES_PER_REGISTRATION = 5

/** "K7M2Q 9X4PA": the 10 characters in two groups, as staff may type them (spaces are ignored). */
export const groupedDeskCode = (code: string) => code.length === 10 ? `${code.slice(0, 5)} ${code.slice(5)}` : code
/** Read one character at a time. */
const spelled = (code: string) => code.split('').join(' ')

function until(iso: string | null) {
  if (!iso) return null
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

interface FacilityStepProps {
  focusTarget: (element: HTMLElement | null) => void
  api: PatientApi
  busy: boolean
  /** The desk code this device shows at the facility (GET .../current gives it again after a reload). */
  deskCode: string | null
  deskCodeExpiresAt: string | null
  /** "I have been checked" found the enrollment still waiting at the facility. */
  notRecordedYet: boolean
  /** Whether a code can be texted instead. */
  online: boolean
  onGetCode: () => void
  onChecked: () => void
  onOnline: () => void
  onDifferentNin: () => void
}

/**
 * The facility route on the patient's own device (hid-system #85, ADR-063). An
 * in-person check of one original photo ID must come first: nothing is said
 * to be verified until GET .../current answers `verify_contact` (owner decision
 * 2026-10-14, steps 4 and 5). The desk code is asked for only when the patient
 * asks, is shown again after a reload, and is replaced only on request. It is
 * held in page state only, never stored or put in the address.
 */
export function FacilityStep(props: FacilityStepProps) {
  const { focusTarget, api, busy, deskCode, deskCodeExpiresAt, notRecordedYet, online, onGetCode, onChecked, onOnline, onDifferentNin } = props
  const expires = until(deskCodeExpiresAt)
  return <section className="flex flex-col gap-4 text-sm text-ink-2 [&_h2]:m-0 [&_h2]:text-title-2 [&_h2]:text-ink [&_h2]:outline-none [&_p]:m-0" aria-labelledby="enroll-facility-stage-title">
    <h2 id="enroll-facility-stage-title" ref={deskCode ? undefined : focusTarget} tabIndex={-1}>Register at a healthcare facility</h2>
    <p>A staff member at a participating facility must check your identity in person before your registration can be finished. Nothing has been verified yet.</p>
    <ol className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-2">
      <li>Get your desk code here, on your own phone.</li>
      <li>Go to a participating facility with what's listed below, and show the staff member the desk code.</li>
      <li>After the check, select I have been checked to continue here: add a contact and choose a password.</li>
    </ol>
    {deskCode ? <section className="flex flex-col gap-2 rounded-xl p-4 ring-1 ring-line [&_:is(h2,h3)]:m-0 [&_:is(h2,h3)]:text-sm [&_:is(h2,h3)]:font-semibold [&_:is(h2,h3)]:text-ink [&_a]:font-medium [&_a]:text-brand-ink [&_p]:m-0" aria-labelledby="enroll-desk-code-title">
      <h3 id="enroll-desk-code-title" ref={focusTarget} tabIndex={-1}>Your desk code</h3>
      <p className="m-0 text-[28px] font-semibold tracking-[.12em] text-ink tabular"><span aria-hidden="true">{groupedDeskCode(deskCode)}</span><span className="sr-only">{spelled(deskCode)}</span></p>
      <p>Show this code to the staff member.{expires && ` It works until ${expires}.`} Keep this page open: if you reload it on this phone, the same code is shown again.</p>
      <button type="button" className={buttonClass({ variant: 'primary', size: 'lg', block: true })} disabled={busy} onClick={onChecked}>{busy ? 'Checking…' : 'I have been checked'}</button>
      <p role="status">{notRecordedYet ? 'The facility has not recorded your check yet. Show the staff member your desk code, then select I have been checked again.' : ''}</p>
      <button type="button" className={buttonClass({ variant: 'link', className: 'self-start' })} disabled={busy} onClick={onGetCode} aria-describedby="enroll-new-desk-code">Get a new desk code</button>
      <p id="enroll-new-desk-code" className="m-0 text-[13px] text-ink-3">Only if the staff member asks for a new code. It replaces this one. A registration can get {DESK_CODES_PER_REGISTRATION} desk codes.</p>
    </section> : <div className="flex flex-col gap-2 rounded-xl p-4 ring-1 ring-line [&_:is(h2,h3)]:m-0 [&_:is(h2,h3)]:text-sm [&_:is(h2,h3)]:font-semibold [&_:is(h2,h3)]:text-ink [&_a]:font-medium [&_a]:text-brand-ink [&_p]:m-0">
      <button type="button" className={buttonClass({ variant: 'primary', size: 'lg', block: true })} disabled={busy} onClick={onGetCode} aria-describedby="enroll-desk-code-hint">{busy ? 'Getting your code…' : 'Get my desk code'}</button>
      <p id="enroll-desk-code-hint">You'll show this code to the staff member at the facility. It works for as long as this registration, up to 24 hours.</p>
    </div>}
    <FacilityList api={api} />
    {online && <button type="button" className={buttonClass({ variant: 'link', className: 'self-start' })} disabled={busy} onClick={onOnline}>Get a code by text message instead</button>}
    <button type="button" className={buttonClass({ variant: 'link', className: 'self-start' })} disabled={busy} onClick={onDifferentNin}>Use a different NIN</button>
  </section>
}
