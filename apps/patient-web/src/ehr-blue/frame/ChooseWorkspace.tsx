import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { isHidApiError, PLAIN, plainErrorText } from '@hid/http'
import { ArrowLeft, LogOut } from 'lucide-react'
import { Alert, Button } from '../../kasuwa/ui'
import { useStaff } from '../../staff/App'
import { PRODUCTS, productHere } from './product'
import { roleLabels } from '../../staff/staffAccess'
import type { FacilityChoiceReason } from '../../staff/facilitySelection'
import { PRODUCT_SITE_NAMES, START_OUTREACH_GROUP_PATH, startOutreachGroupHref } from '../../productHostname'
import { loginOpensSite, startOutreachGroupRunsHere } from '../../productSites'

/** Why the question is asked: as Identity reports the selection, 'lost' mid-session, or 'switch' from the account menu. */
export type WorkspaceQuestion = FacilityChoiceReason | 'lost' | 'switch'

// Today's words for each reason (staff/App.tsx FacilityChoice), so the blue question says what today's says. A switch
// from the facility menu is not one of classic's questions (classic asked it in place, under "Working at"), so it says
// only classic's own sentence about what the choice decides (parity report 3.3-49).
const WHY: Record<WorkspaceQuestion, string> = {
  reselect: 'The facility you chose for this sign-in is no longer available to you.',
  unchosen: 'You work at more than one facility.',
  unconfirmed: 'The facility for this sign-in is not confirmed.',
  lost: 'The facility you were working at is no longer available to you. The page you had open was closed, along with any patient record, and anything not yet saved there was not sent.',
  switch: 'Patient access, records and requests use the facility you choose.',
}

/** Classic's sentence after the reason, word for word (staff/App.tsx FacilityChoice; parity report 3.3-47, 3.3-48). */
const BEFORE_YOU_CONTINUE = 'Choose where you are working before you continue. Patient access, records and requests use the facility you choose, and you can switch later from “Working at”.'

/** A choice Identity refused, in words the person can act on (today's facilityRefusal). */
export function facilityRefusal(caught: unknown, facility: string): string {
  if (isHidApiError(caught) && caught.code === 'FACILITY_ACCESS_DENIED') return `You are no longer active at ${facility}. Choose another facility.`
  // Never the server's own words: the shared helper says anything else plainly.
  return plainErrorText(caught, 'That facility couldn’t be opened. Try again, or choose another facility.', { audience: 'facility' })
}

/**
 * Choose your workspace. Live: each choice is today's facility switch (POST /auth/facility through useStaff), with
 * today's refusals. Asked before any page opens (`reason`), it is classic's question (staff/App.tsx FacilityChoice):
 * "Where are you working?", a radio choice with nothing preselected, and Continue, which says "Choose a facility to
 * continue." when none is chosen (parity report 3.3-47, 3.3-48). Opened from the facility menu to switch, the facility
 * worked at is checked, and choosing another asks in place, as classic's "Working at" did: "You are working at X.
 * Switch to Y?", with Switch facility and Cancel (3.3-49). Nothing switches until it is confirmed.
 *
 * It behaves as classic's FacilityChoice does (staff/App.tsx:853-924; parity report 3.3-47): a choice sent with Enter on
 * an option moves focus to Continue; "Choose a facility to continue." is an alert only when focus stays on the options
 * (Enter), since Continue moves focus into them and their description says it; and a refusal is a plain line with
 * role="alert" at the options, which it describes, never a boxed alert. The eyebrow and each facility's role line are
 * the design's "Choose workspace" (frame/tour/journeys.ts:52, :76: "Select one of your actual hospital memberships"), so
 * they stay (3.3-47, 3.3-48 and 3.3-49 recorded as the design).
 */
export function ChooseWorkspace({ reason, onChosen }: { readonly reason: WorkspaceQuestion; readonly onChosen?: () => void }) {
  const { state, selectFacility, signOut, activePatient, lock } = useStaff()
  const navigate = useNavigate()
  const heading = useRef<HTMLHeadingElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState('')
  // Continue with nothing picked: counted, so each refusal is said afresh (classic's `missing`). Reported at the options,
  // which take focus, and their description announces it; sent with Enter on an option, focus does not move into them,
  // so it is an alert instead (`missingAlert`), as classic's: as both it would be spoken twice.
  const [missing, setMissing] = useState(0)
  const [missingAlert, setMissingAlert] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const productName = PRODUCTS[productHere(state.status === 'ready' ? state.session : null)].name
  // The question is the page: it takes focus when it appears, unless the person is already somewhere on it. One that
  // appears while the workspace is locked takes it once the workspace opens, once. Asked because the facility was found
  // gone, it takes focus wherever it was: the page and patient closed under the person (classic FacilityChoice).
  const focused = useRef(false)
  useLayoutEffect(() => {
    if (focused.current || lock !== null) return
    focused.current = true
    const active = document.activeElement
    if (reason === 'lost' || reason === 'switch' || !(active instanceof HTMLElement) || active === document.body || !active.isConnected) heading.current?.focus()
  }, [lock, reason])
  // Today's ProviderTitle (staff/App.tsx) names this address "Page not found": today's portal has no such page. Switch
  // facility is the blue EHR's own page, so it names the tab as the frame names its pages, again after the lock screen.
  // The question asked before any page opens keeps today's "Where are you working?".
  useEffect(() => {
    if (reason === 'switch' && lock === null) document.title = `Choose workspace · Health ID ${productName}`
  }, [reason, lock, productName])
  if (state.status !== 'ready') return null
  const { actor } = state.session
  const switching = reason === 'switch'
  const current = switching ? actor.facility : undefined
  const checked = picked || current?.id || ''
  const proposed = switching && picked && picked !== current?.id ? actor.facilities.find(facility => facility.id === picked) : undefined

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    // A switch is asked in place first: Enter on an option leads to the question's Switch facility, and sends nothing.
    if (switching) {
      form.querySelector<HTMLButtonElement>('#hid-ehr-blue-chooser-question ~ div button')?.focus()
      return
    }
    if (!picked) {
      const options = form.querySelector('fieldset')
      setMissingAlert(options?.contains(document.activeElement) ?? false)
      setMissing(count => count + 1)
      options?.querySelector<HTMLInputElement>('input[name="hid-ehr-blue-facility-choice"]')?.focus()
      return
    }
    // The options are disabled while the choice is saved, so the one checked is the one sent. A choice sent with Enter
    // on an option moves focus to Continue, which stays enabled, rather than leave it on a disabled option.
    if (document.activeElement instanceof HTMLInputElement && form.contains(document.activeElement)) {
      form.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus()
    }
    void choose(picked, actor.facilities.find(facility => facility.id === picked)?.name ?? 'this facility')
  }

  async function choose(id: string, name: string) {
    if (busy) return
    setError('')
    setBusy(id)
    try {
      if (await selectFacility(id)) {
        onChosen?.()
        if (reason === 'switch') navigate('/provider')
      }
    } catch (caught) { setError(facilityRefusal(caught, name)) }
    finally { setBusy(null) }
  }

  async function leave() {
    setSignOutError('')
    try { await signOut() }
    catch (caught) { setSignOutError(plainErrorText(caught, PLAIN.signOutFailed)) }
  }

  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-6 py-4" aria-labelledby="hid-ehr-blue-chooser-title">
      <div>
        <p className="m-0 text-overline text-ink-3">Health ID · {productName === 'EHR' ? 'Hospital EHR' : productName}</p>
        <h1 id="hid-ehr-blue-chooser-title" ref={heading} tabIndex={-1} className="m-0 mt-1 text-title-1 text-ink outline-none" aria-describedby="hid-ehr-blue-chooser-why">
          {switching ? 'Switch facility' : 'Where are you working?'}
        </h1>
        <p id="hid-ehr-blue-chooser-why" className="m-0 mt-1.5 text-sm text-ink-2">
          {WHY[reason]}{switching ? '' : ` ${BEFORE_YOU_CONTINUE}`}
        </p>
      </div>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <fieldset disabled={busy !== null} className="m-0 flex flex-col gap-1.5 rounded-2xl border-0 bg-tray p-1.5"
          aria-describedby={['hid-ehr-blue-chooser-why', missing > 0 && 'hid-ehr-blue-chooser-missing', error && 'hid-ehr-blue-chooser-error'].filter(Boolean).join(' ')}>
          <legend className="sr-only">Facility</legend>
          {actor.facilities.map(facility => (
            <label key={facility.id} className="flex cursor-pointer items-center gap-3 rounded-xl bg-surface p-4 ring-1 ring-line">
              <input type="radio" name="hid-ehr-blue-facility-choice" value={facility.id} checked={checked === facility.id} className="size-4 accent-brand-fill"
                onChange={() => { setPicked(facility.id); setMissing(0); setError('') }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-title-3 text-ink">{facility.name}</span>
                <span className="mt-0.5 block text-[13px] text-ink-3">{roleLabels(facility.roles) || 'Staff'}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {missing > 0 ? <p key={missing} id="hid-ehr-blue-chooser-missing" role={missingAlert ? 'alert' : undefined} className="m-0 text-sm text-danger-ink">Choose a facility to continue.</p> : null}
        {/* Classic's plain refusal at the options (staff/App.tsx FacilityChoice), not a boxed alert. */}
        {error ? <p id="hid-ehr-blue-chooser-error" role="alert" className="m-0 text-sm text-danger-ink">{error}</p> : null}
        {proposed ? <div role="group" aria-labelledby="hid-ehr-blue-chooser-question" className="flex flex-col gap-2 rounded-xl bg-subtle p-3">
          <p id="hid-ehr-blue-chooser-question" className="m-0 text-sm text-ink">{current ? `You are working at ${current.name}. Switch to ${proposed.name}?` : `Work at ${proposed.name}?`}{activePatient ? ' The open patient record will close.' : ''}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" loading={busy !== null} onClick={() => void choose(proposed.id, proposed.name)}>{busy ? 'Switching…' : 'Switch facility'}</Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => { setPicked(''); setError('') }}>Cancel</Button>
          </div>
        </div> : null}
        {switching ? null : <div><Button type="submit" variant="primary" aria-disabled={busy !== null || undefined}>{busy ? 'Saving…' : 'Continue'}</Button></div>}
      </form>
      {/* Owner decision 5 of 11 November 2026: the same login can also run its own outreach group. The group opens on
          Health ID Outreach only: another product site keeps only the facilities that fit it (Q88). Linked to Health ID Outreach only for a login that can open it (actor.products, Q97); a doctor's, clinician's,
          nurse's or receptionist's login, which Health ID Outreach refuses, starts it here on Health ID EHR instead
          (startOutreachGroupRunsHere), and on the other product sites is offered nothing. Without actor.products (an
          Identity before Q97), as before. */}
      {reason === 'switch' && (startOutreachGroupRunsHere(window.location.hostname, actor.products) || loginOpensSite('outreach', actor.products)) ? <p className="m-0 text-sm text-ink-2">Run outreach events with your own volunteer group?{' '}
        {startOutreachGroupRunsHere(window.location.hostname, actor.products)
          ? <Link className="font-medium text-brand-ink underline" to={START_OUTREACH_GROUP_PATH}>Start an outreach group</Link>
          : <a className="font-medium text-brand-ink underline" href={startOutreachGroupHref(window.location.hostname)}>
            Start one on {PRODUCT_SITE_NAMES.outreach}</a>}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {reason === 'switch' ? <Button icon={ArrowLeft} onClick={() => navigate('/provider')}>Back to Home</Button> : <span />}
        <Button variant="ghost" icon={LogOut} onClick={() => void leave()}>Sign out</Button>
      </div>
      {signOutError ? <Alert intent="error" title="Couldn’t sign out">{signOutError}</Alert> : null}
    </section>
  )
}

/** The account menu's Switch facility, as a page of the frame. */
export function ChooseWorkspacePage() {
  return <ChooseWorkspace reason="switch" />
}
