import { HEALTH_ID_PREFIX, normalizeHealthIdInput } from '@hid/contracts'
import { isHidApiError, plainErrorText } from '@hid/http'
import { ArrowRight, Building2, IdCard, KeyRound, Lock, LogOut, Search, Send, Siren, UserPlus } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Alert, Badge, Button, Card, IconChip, Input, SectionHeader, cx, type Icon } from '../../../kasuwa/ui'
import { FormPage } from '../../../kasuwa/parts'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { staffApi } from '../../../staff/api'
import { ChartProvider, useAccessEnded } from '../parts/chart'
import { formatWhen } from '../parts/format'
import { opensInProduct, productOf } from '../../frame/product'
import { RecordNotFound } from '../parts/Notices'
import { patientFacts } from '../parts/PatientHeader'
import { segmentOf } from '../parts/segments'
import { Workspace, useClinical, useWorkspaceHref } from '../parts/Workspace'
import type { EhrBluePageStatus } from '../types'
import {
  ACCESS_CLOSED, CLOSE_FAILED, CLOSE_GRANT, CLOSE_REASON, HID_FORMAT, METHOD_ROUTES, OPEN_SHARED, OWN_FACILITY_HINT, OWN_FACILITY_NOT_FOUND,
  OWN_FACILITY_TITLE, actionUnavailable, administratorOf, dropOfferedHealthId, healthIdProblem, isRefusedLookup, lookupRefusal, offerHealthId,
  opensOwnFacility, ownFacilityRefusal, useOpenPatient, useOpenedPatientHref, type AccessMethod,
} from '../consent/access'
import { NameSearchCard } from './NameSearch'
import { canUseWaitingList } from '../../departments/waiting/waitingRules'
import { PinAccess } from '../consent/PinAccess'
import { PatientPage, accessLabel } from './PatientPage'
import { SharedWithYouCard } from './SharingCards'

/** How long the Health ID field rests, after a whole Health ID arrived in it at once, before it is looked up by itself. */
export const AUTO_LOOKUP_MS = 600

/**
 * The fewest letters that count as a whole Health ID arriving at once: added by one change (a paste or an autofill),
 * or arriving in one burst (a scanner). Six is the shortest Health ID.
 */
const ARRIVES_AT_ONCE = 6
/**
 * The longest gap, in milliseconds, between one letter and the next for both to be one burst. Most barcode scanners
 * (USB, Bluetooth, a phone's) type each letter as its own change a few milliseconds apart; a person types them 80 ms or
 * more apart, so any slower letter starts a new burst.
 */
const BURST_GAP_MS = 35
/** The browser's names for a change that puts in text from elsewhere in one go: a paste, or an autofill or suggestion. */
const AT_ONCE_INPUT_TYPES: ReadonlySet<string> = new Set(['insertFromPaste', 'insertReplacementText'])

/** The clock the Health ID field times its letters by. Tests set the time it gives. */
export const fieldClock = { now: (): number => performance.now() }

/** The letters that arrived one after another, each within BURST_GAP_MS of the one before, and when the last came. */
interface Burst { readonly letters: number; readonly at: number }

/**
 * The burst after a change of the Health ID field. A change that takes letters out (a deletion), or comes from a held
 * key repeating, or comes later than BURST_GAP_MS after the one before, ends the burst; the letters it adds start the
 * next one.
 */
function nextBurst(burst: Burst | null, native: Event, before: string, after: string, at: number, broken: boolean): Burst | null {
  const inputType = (native as Partial<InputEvent>).inputType
  const deletes = typeof inputType === 'string' ? inputType.startsWith('delete') : after.length < before.length
  if (deletes) return null
  // A scanner's letter can shorten what is kept ("HID-HID" becomes "HID-"): each change brings at least one letter.
  const added = Math.max(1, after.length - before.length)
  const continues = burst !== null && !broken && at - burst.at <= BURST_GAP_MS
  return { letters: (continues ? burst.letters : 0) + added, at }
}

/**
 * Whether a change of the Health ID field brought a whole Health ID at once (pasted, scanned, or filled in), not a
 * letter typed. Only such a change is looked up by itself: a Health ID is 6 to 32 letters and digits, so a pause while
 * typing a long one would otherwise look up a shorter, different patient (review of #263). A scanner types each letter
 * as its own change, so the last six letters (or more) arriving in one burst count as arriving at once.
 */
function arrivedAtOnce(native: Event, pasted: boolean, before: string, after: string, burst: Burst | null): boolean {
  const inputType = (native as Partial<InputEvent>).inputType
  return pasted || (typeof inputType === 'string' && AT_ONCE_INPUT_TYPES.has(inputType)) || after.length - before.length >= ARRIVES_AT_ONCE
    || (burst !== null && burst.letters >= ARRIVES_AT_ONCE)
}

/** Every part is on today's Health ID API: the Health ID lookup, the grant, encounters and patient sharing. */
export const patientsStatus: EhrBluePageStatus = 'live'

/**
 * Patients: search by Health ID (today's access rules), the patient open now, that patient's page at
 * `patients/open`, and the patient PIN at `patients/pin` (as on today's Patients page, it needs no
 * identity.consent.write, which the frame asks for External record access). Under the search, "Obtain access" always
 * offers the patient's Access PIN and (on sites that open it) emergency access, as today's "Obtain access" card does, so a patient Find opens at
 * once (the demo patients' seeded share) can still be opened by PIN or for an emergency. Ask the patient leads the group,
 * as today's Request method leads its card. A refused lookup adds only which patient and why: every way in stays in the
 * one group, for the Health ID in the field. There is no list of every patient: Health ID shows a patient only once
 * this facility may see them. "Register a patient" is today's Patient registration page (/provider/registration),
 * offered only with identity.registration.write; nothing of a patient goes with it.
 */
export function PatientsWorkspace() {
  return (
    <Workspace path="patients" title="Patients">
      <ChartProvider>
        <Routes>
          <Route index element={<HandedPatientList />} />
          <Route path="open" element={<PatientPage />} />
          <Route path="pin" element={<PinAccess backLabel="Back to find a patient" />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </ChartProvider>
    </Workspace>
  )
}

function NotFound() {
  const href = useWorkspaceHref()
  return <RecordNotFound backHref={href()} />
}

/** What a page hands Find a patient in location state: a Health ID to look up, or what just happened (`notice`). */
type Handed = { hid?: unknown; notice?: unknown } | null

/**
 * A Health ID handed over in location state (Registration, or the top-bar search) starts a fresh form, even when Find
 * a patient is already open, so the handed one is what the field shows. So does what the patient's page hands over as
 * it closes the grant ("Access was closed.", parity 23b).
 */
function HandedPatientList() {
  const location = useLocation()
  const handed = location.state as Handed
  return <PatientList key={typeof handed?.hid === 'string' || typeof handed?.notice === 'string' ? location.key : 'list'} />
}

function PatientList() {
  const { facility, permissions, can, activePatient, setActivePatient } = useClinical()
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const location = useLocation()
  const ended = useAccessEnded()
  const openPatient = useOpenPatient()
  const landing = useOpenedPatientHref()
  const title = useRef<HTMLHeadingElement>(null)
  // Registration stays in the EHR only (the owner's decision): on a single product's site (lab., pharmacy., outreach.,
  // migrate.) Find a patient offers no "Register a patient", whatever the role holds. The product is decided as the
  // frame decides it (frame/product.ts), so this page and the menu always agree.
  const product = productOf(window.location.hostname, permissions)
  const registers = can('identity.registration.write') && product === 'ehr'
  // Emergency access is the hospital EHR's page: a single product's site (lab., pharmacy.) does not open it, and the
  // frame would send the person back to Home, so it is not offered there. The PIN (a Patients page) opens everywhere.
  const offersEmergency = opensInProduct(product, 'emergency')
  // Registration hands over the new Health ID (location state), so the next step is one press of Find; otherwise
  // today's field starts at HID- and is normalized as it changes.
  const [hid, setHid] = useState(() => { const handed = (location.state as { hid?: unknown } | null)?.hid; return typeof handed === 'string' ? handed : HEALTH_ID_PREFIX })
  const [problem, setProblem] = useState<{ message: string; alert: boolean } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<{ hid: string; message: string } | null>(null)
  // Health ID answered that no patient has this Health ID: the next step is registering them, not asking for access.
  // identity-api says so with 404 PATIENT_NOT_FOUND since Q100 B (owner, 18 Nov 2026); a patient that exists but is not
  // available here still answers 404 NOT_FOUND (or 403), shown as a refused lookup with the ways in.
  const [unknown, setUnknown] = useState<string | null>(null)
  const [error, setError] = useState('')
  // What the patient's page said as it closed the grant (parity 23b): today's sentence, said here, as today's Close my
  // grant stays on Patients and says it (Patients.tsx:243-244).
  const [notice, setNotice] = useState(() => { const handed = (location.state as Handed)?.notice; return handed === ACCESS_CLOSED ? handed : '' })
  // Whether the Health ID in the field arrived whole at once (pasted, or scanned in one burst): only then is it looked up
  // by itself.
  // A Health ID typed, or handed over from Registration, waits for Find or Enter.
  const [atOnce, setAtOnce] = useState(false)
  // A paste into the field, until the change it makes: the change's own input type is not given by every browser.
  const pasting = useRef(false)
  // The letters arriving fast, one after another, as a scanner types them; and whether a held key (repeating) broke it.
  const burst = useRef<Burst | null>(null)
  const repeating = useRef(false)
  const searchBox = useRef<HTMLFormElement>(null)
  const canLook = !!facility && can('identity.patient.read')
  const administrator = administratorOf(facility, permissions)
  const openSharedUnavailable = actionUnavailable(OPEN_SHARED, permissions, administrator)
  // "Obtain access" gives today's reason with each way the role cannot take, as today's "Obtain access" card does.
  const requestUnavailable = actionUnavailable(METHOD_ROUTES.request, permissions, administrator)
  const pinUnavailable = actionUnavailable(METHOD_ROUTES.pin, permissions, administrator)
  const emergencyUnavailable = actionUnavailable(METHOD_ROUTES.emergency, permissions, administrator)
  // Today's Close my grant on the open record's card (Patients.tsx:239-248, 252), with its reason when the role cannot.
  const closeUnavailable = actionUnavailable(CLOSE_GRANT, permissions, administrator)
  const grantId = activePatient?.lookup.authorization.consentGrantId ?? null
  // Arriving with a closed grant's notice counts as a close here: focus goes to the page heading (parity 23b).
  const [closed, setClosed] = useState(() => (notice ? 1 : 0))
  const [closeError, setCloseError] = useState('')
  // Closing takes the card, and its button, away: focus goes to the page heading unless the user moved it (today's
  // focus('patients-title', true)).
  useLayoutEffect(() => {
    if (!closed) return
    const focused = document.activeElement
    if (!focused || focused === document.body || !focused.isConnected) title.current?.focus()
  }, [closed])
  // "Open as this facility’s patient" (0131) is offered only to the roles that may take it: doctors, nurses and clinicians.
  const ownFacility = opensOwnFacility(permissions)
  // Search by name (0132) needs what registration needs; a role without it keeps the Health ID search only.
  const searchesByName = canLook && can('identity.registration.write')

  function clearFeedback() { setNotice(''); setError(''); setCloseError(''); setRefused(null); setUnknown(null) }

  /**
   * Today's openPatient from a typed or shared Health ID: an allowed lookup opens the patient's page, with the chart
   * summary, for every role (owner decision Q139 B; see useOpenedPatientHref). A shared record's Open that fails says
   * only why, as today's openShared does (Patients.tsx:231-236, 271): the field and the ways in stay as they were
   * (parity 13c).
   */
  async function open(candidate: string, shared = false) {
    setBusy(true)
    try {
      if (await openPatient(candidate, 'direct-care')) navigate(landing('direct-care'))
    } catch (caught) {
      // No grant yet says how to get one; a lab or pharmacy role's 404 says the record isn't open to it here.
      const message = lookupRefusal(caught, facility?.roles ?? [])
      if (shared) {
        setError(message)
        return
      }
      // The refused Health ID goes in the field (a refused share's too), so "Obtain access" hands over the patient the
      // panel names.
      if (isHidApiError(caught) && caught.status === 404 && caught.code === 'PATIENT_NOT_FOUND') {
        setHid(candidate)
        setUnknown(candidate)
      } else if (isRefusedLookup(caught)) {
        setHid(candidate)
        setRefused({ hid: candidate, message })
      } else setError(message)
    } finally {
      setBusy(false)
    }
  }

  // The Health ID last looked up, so the same one is never looked up twice in a row (each lookup is recorded).
  const lookedUp = useRef<string | null>(null)

  /**
   * A whole Health ID pasted or scanned in at once is looked up with no press of Find (owner, 18 Nov 2026): the patient
   * opens, or the page says what to do next. A typed one is never looked up by itself, however long the typist pauses:
   * part of a longer Health ID can be a whole, different one (review of #263), so typing ends with Find or Enter.
   */
  useEffect(() => {
    if (!canLook || busy || !atOnce) return
    const normalized = normalizeHealthIdInput(hid)
    if (healthIdProblem(normalized) !== null || lookedUp.current === normalized) return
    const timer = window.setTimeout(() => {
      lookedUp.current = normalized
      clearFeedback()
      setProblem(null)
      void open(normalized)
    }, AUTO_LOOKUP_MS)
    return () => window.clearTimeout(timer)
    // open and clearFeedback are this render's; only a change of the Health ID (or who may look) starts a new wait.
  }, [hid, atOnce, canLook, busy])

  function search() {
    if (busy || !canLook) return
    clearFeedback()
    const normalized = normalizeHealthIdInput(hid)
    const refusal = healthIdProblem(normalized)
    if (refusal) {
      // Refused from Enter in the field, focus stays and the message is an alert; otherwise focus moves to the field.
      const input = searchBox.current?.querySelector('input')
      const alert = !!input && document.activeElement === input
      setProblem({ message: refusal, alert })
      setAttempt(value => value + 1)
      if (!alert) input?.focus()
      return
    }
    setProblem(null)
    lookedUp.current = normalized
    void open(normalized)
  }

  /**
   * "Open as this facility’s patient" for the refused Health ID (0131): Identity opens it for 24 hours when the patient is
   * this facility's own, then today's lookup opens the patient's page. A refusal keeps every other way in on offer.
   */
  async function openOwnFacility() {
    if (busy || !facility || !refused || !ownFacility) return
    const candidate = refused.hid
    setBusy(true)
    try {
      await staffApi.openOwnFacilityPatient(facility.id, { hid: candidate })
      if (await openPatient(candidate, 'direct-care', 'own-facility')) navigate(href('open'))
    } catch (caught) {
      const refusal = ownFacilityRefusal(caught)
      // Here a 404 is a patient this facility can't open (not active, or not allowed here), never an unknown Health ID:
      // the refused panel stays, with no registration on offer.
      if (isHidApiError(caught) && caught.status === 404 && caught.code === 'PATIENT_NOT_FOUND') {
        setRefused({ hid: candidate, message: OWN_FACILITY_NOT_FOUND })
      } else if (refusal) setRefused({ hid: candidate, message: refusal })
      else if (isRefusedLookup(caught)) setRefused({ hid: candidate, message: lookupRefusal(caught, facility.roles ?? []) })
      else {
        setRefused(null)
        setError(plainErrorText(caught, 'Patient access could not be verified.', { audience: 'facility' }))
      }
    } finally {
      setBusy(false)
    }
  }

  /** A card of Search by name opens with today's lookup, as a Health ID typed in the field does. */
  function openFound(foundHid: string) {
    if (busy) return
    clearFeedback()
    setProblem(null)
    lookedUp.current = foundHid
    // What the lookup says (a refusal and the ways in, or no such patient) shows in the Health ID card: it is brought
    // into view. An allowed lookup has left the page by then.
    void open(foundHid).then(() => searchBox.current?.scrollIntoView?.({ block: 'nearest' }))
  }

  function openShared(sharedHid: string) {
    if (busy) return
    clearFeedback()
    void open(sharedHid, true)
  }

  /** Today's closeGrant (Patients.tsx:239-248): the open record's grant ends here, and the page stays. */
  async function closeGrant() {
    if (!facility || !grantId || busy || closeUnavailable) return
    clearFeedback()
    setBusy(true)
    try {
      await staffApi.closeGrant(facility.id, grantId, CLOSE_REASON)
      setActivePatient(null)
      setNotice(ACCESS_CLOSED)
      setClosed(value => value + 1)
    } catch (caught) {
      setCloseError(plainErrorText(caught, CLOSE_FAILED, { audience: 'facility' }))
    } finally {
      setBusy(false)
    }
  }

  /**
   * "Obtain access", with or without a lookup, as today's card offers its three methods: Ask the patient is External
   * record access's request form (the frame opens it only with identity.consent.write, which sending a request needs),
   * the PIN is a Patients page, emergency access is Emergency's own page. A way the role cannot take does nothing, so a
   * Health ID is handed over only where its form can open. A complete Health ID in the search (after a refused lookup,
   * the refused one) is handed over in memory, never in the URL (the emergency form reads it only for a role the frame
   * opens Emergency to, identity.break-glass.write); otherwise the step opens with its field empty, and a Health ID
   * offered earlier is not read there. While a lookup runs, a press does nothing, as today's Obtain access ignores one
   * while busy: the lookup's answer, not this step, decides where the user goes.
   */
  function otherWay(target: AccessMethod) {
    const unavailable = target === 'request' ? requestUnavailable : target === 'pin' ? pinUnavailable : emergencyUnavailable
    if (busy || !facility || unavailable) return
    const normalized = normalizeHealthIdInput(hid)
    const reads = target !== 'emergency' || can('identity.break-glass.write')
    if (reads && healthIdProblem(normalized) === null) offerHealthId(normalized, facility.id, setActivePatient)
    else dropOfferedHealthId()
    navigate(target === 'request' ? href.to('consent', 'new') : target === 'pin' ? href('pin') : href.to('emergency'))
  }

  /**
   * The open record's link, as today's card has it (Patients.tsx:252): to the chart, or under emergency access to the
   * read-only emergency summary, and only on a site that opens the chart (today's clinicalHere). A role that may not
   * open the emergency summary is sent to the chart, which says so with today's link (ChartGate). Q139 B covers where
   * Find, the PIN and a share land, not this card (parity 3.3-1).
   */
  const chartHere = opensInProduct(product, segmentOf('consult'))
  const recordHref = !activePatient || !chartHere ? null
    : activePatient.purpose === 'emergency' && opensInProduct(product, segmentOf('emergency')) && can('identity.break-glass.write')
      ? href.to('emergency', 'summary') : href.to('consult')
  // A role that may not look a patient up is told so at Find, in today's words for the same lookup (OPEN_SHARED,
  // Patients.tsx:55, 77), and is offered the ways in at once, each with today's note (Patients.tsx:255-262): Find can
  // never be refused for it, so they would otherwise never show (parity 3.3-50, its Patients part).
  const lookupUnavailable = facility && !can('identity.patient.read') ? openSharedUnavailable : null
  const showWays = refused !== null || lookupUnavailable !== null
  // "Open as this facility’s patient" acts on the refused Health ID only (openOwnFacility).
  const ownsRefused = ownFacility && refused !== null
  const open_ = activePatient ? patientFacts(activePatient) : null
  const expires = activePatient?.lookup.authorization.expiresAt
  const hidError = problem ? (problem.alert ? <span key={attempt} role="alert">{problem.message}</span> : problem.message) : null

  return (
    <FormPage title="Find a patient" titleRef={title} description="Paste or scan their Health ID and it’s checked at once. If you type it, select Find."
      actions={registers ? <Button to="/provider/registration" icon={UserPlus}>Register a patient</Button> : undefined}>
      {ended && !activePatient ? <Alert intent="error" title="Access to this patient ended">Open the patient again to keep working.</Alert> : null}

      <Card>
        <form ref={searchBox} noValidate className="flex flex-col gap-2 p-5" onSubmit={event => { event.preventDefault(); search() }}>
          <label htmlFor="patient-hid" className="text-[13px] font-medium text-ink-2">Health ID</label>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1"><Input id="patient-hid" icon={IdCard} value={hid} placeholder="HID-ADA2345" autoComplete="off" spellCheck={false}
              required aria-required="true" aria-invalid={problem ? true : undefined} aria-describedby={problem ? 'patient-hid-hint patient-hid-problem' : 'patient-hid-hint'}
              onKeyDown={event => { pasting.current = false; repeating.current = event.repeat }} onPaste={() => { pasting.current = true }}
              onChange={event => {
                const next = normalizeHealthIdInput(event.target.value)
                burst.current = nextBurst(burst.current, event.nativeEvent, hid, next, fieldClock.now(), repeating.current)
                setAtOnce(arrivedAtOnce(event.nativeEvent, pasting.current, hid, next, burst.current))
                pasting.current = false
                repeating.current = false
                setHid(next); setProblem(null); setRefused(null); setUnknown(null)
              }} className="h-11 font-medium tracking-[.06em] uppercase" /></div>
            {/* Busy (aria-busy), it stays focusable (aria-disabled, not disabled), as today's Verify access: focus is not lost
                while the lookup runs, and a second press looks nothing up (search() returns while one is on its way). */}
            <Button type="submit" variant="primary" icon={Search} disabled={!canLook} aria-busy={busy || undefined} aria-disabled={busy || undefined} className="h-11"
              aria-describedby={lookupUnavailable ? 'patient-lookup-unavailable' : undefined}>Find</Button>
          </div>
          <p id="patient-hid-hint" className="m-0 text-[12px] text-ink-3">It’s on the patient’s Health ID card. {HID_FORMAT}</p>
          {lookupUnavailable ? <p id="patient-lookup-unavailable" className="m-0 text-[13px] text-ink-3">{lookupUnavailable}</p> : null}
          {hidError ? <p id="patient-hid-problem" className="m-0 text-[13px] font-medium text-danger-ink">{hidError}</p> : null}
        </form>

        {/* No patient has this Health ID: say so, and offer registering them where this role may (owner, 17 Nov 2026). */}
        {unknown ? <div className="border-t border-line p-5">
          <div className="flex flex-wrap items-start gap-3">
            <IconChip icon={UserPlus} tone="brand" />
            <div role="alert" className="min-w-0 flex-[1_1_16rem]"><p className="m-0 text-title-3 text-ink">No patient has the Health ID {unknown}</p>
              <p className="m-0 mt-0.5 text-[13px] text-ink-3">{registers ? 'Check it with the patient. If they’re new, register them and they get a Health ID.' : 'Check it with the patient and try again.'}</p></div>
            {registers ? <Button variant="primary" icon={UserPlus} to="/provider/registration">Register a new patient</Button> : null}
          </div>
        </div> : null}

        {/* No access yet: which patient, and why. */}
        {refused ? <div className="border-t border-line p-5">
          <div className="flex items-start gap-3">
            <IconChip icon={Lock} tone="warn" />
            <div role="alert" className="min-w-0"><p className="m-0 text-title-3 text-ink">You don’t have access to {refused.hid} yet</p>
              {/* Today's sentence for a lookup Health ID did not allow (Patients.tsx:145), or why else it was refused. */}
              <p className="m-0 mt-0.5 text-[13px] text-ink-3">{refused.message}</p></div>
          </div>
        </div> : null}

        {/* The ways in, offered only once Find was refused, so a patient this facility may open opens at once with nothing
            to pick (owner, 17 Nov 2026), or at once to a role Find refuses always. The Access PIN leads, for the patient who
            is with you; asking them is next; emergency access last. Each is for the Health ID in the field. */}
        {showWays ? <div role="group" aria-labelledby="patients-other-access" className={cx('border-t border-line p-5', refused ? 'pt-0' : '')}>
          <h2 id="patients-other-access" className="sr-only">Obtain access</h2>
          {/* A way the role cannot take is not offered as a dead end: it is turned off, with today's reason. */}
          {pinUnavailable ? <p id="other-pin-unavailable" className="m-0 mb-2 text-[13px] text-ink-3">{pinUnavailable}</p> : null}
          {requestUnavailable ? <p id="request-access-unavailable" className="m-0 mb-2 text-[13px] text-ink-3">{requestUnavailable}</p> : null}
          {offersEmergency && emergencyUnavailable ? <p id="other-emergency-unavailable" className="m-0 mb-2 text-[13px] text-ink-3">{emergencyUnavailable}</p> : null}
          <ul className={`m-0 grid list-none gap-1.5 rounded-2xl bg-tray p-1.5 ${offersEmergency && !ownsRefused ? '@xl:grid-cols-3' : '@xl:grid-cols-2'}`}>
            {ownsRefused ? <AccessWay icon={Building2} title={OWN_FACILITY_TITLE} hint={OWN_FACILITY_HINT} primary busy={busy}
              onClick={() => void openOwnFacility()} /> : null}
            <AccessWay icon={KeyRound} title="Use their Access PIN" hint="If they’re with you and have set one." primary={!ownsRefused} busy={busy}
              unavailableId={pinUnavailable ? 'other-pin-unavailable' : undefined} onClick={() => otherWay('pin')} />
            <AccessWay icon={Send} title="Ask the patient" hint="They approve on their phone. You’re told the moment they do." busy={busy}
              unavailableId={requestUnavailable ? 'request-access-unavailable' : undefined} onClick={() => otherWay('request')} />
            {offersEmergency ? <AccessWay icon={Siren} title="Emergency access" hint="Only if they can’t consent. Time-limited and recorded." danger busy={busy}
              unavailableId={emergencyUnavailable ? 'other-emergency-unavailable' : undefined} onClick={() => otherWay('emergency')} /> : null}
          </ul>
        </div> : null}
        {/* Today's error is the sentence alone (Patients.tsx:271): no title of its own (parity 13c). */}
        {error ? <div className="border-t border-line p-5"><Alert intent="error">{error}</Alert></div> : null}
        {/* Mounted throughout, so what an access step says is announced. */}
        <div role="status" className="empty:hidden">{notice ? <p className="m-0 border-t border-line px-5 py-3 text-[13px] text-ink-2">{notice}</p> : null}</div>
      </Card>

      {searchesByName ? <NameSearchCard facilityId={facility?.id} registers={registers} busy={busy} onOpen={openFound}
        checksIn={canUseWaitingList(permissions)} /> : null}

      {/* Shown only while a patient is open: a section shows only when it has something in it. Today's heading, Open
          link and Close my grant (Patients.tsx:252). */}
      {activePatient && open_ ? <section aria-labelledby="patients-open" className="flex flex-col gap-3">
        <SectionHeader id="patients-open" title={activePatient.purpose === 'emergency' ? 'Current emergency summary' : 'Current authorized record'} />
        <Card>
          <div className="flex flex-wrap items-center gap-4 p-5">
            <span aria-hidden="true" className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[15px] font-semibold text-brand-ink">{open_.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate text-title-3 text-ink">{open_.name}</p>
              <p className="m-0 mt-0.5 text-[13px] text-ink-3"><span className="font-medium tracking-[.06em] text-ink-2">{open_.hid}</span>{expires ? ` · until ${formatWhen(expires)}` : ''}</p>
            </div>
            <Badge tone={activePatient.purpose === 'emergency' ? 'danger' : 'success'} size="sm">{accessLabel(activePatient)}</Badge>
            {recordHref ? <Button to={recordHref} iconRight={ArrowRight}>{activePatient.purpose === 'emergency' ? 'Open read-only emergency summary' : 'Open clinical record'}</Button> : null}
          </div>
          {grantId ? <div className="flex flex-col items-start gap-1.5 border-t border-line px-5 py-3">
            {closeUnavailable ? <p id="close-grant-unavailable" className="m-0 text-[12px] text-ink-3">{closeUnavailable}</p> : null}
            {/* Busy, it stays focusable (aria-disabled, not disabled), as today's: a second press sends nothing. */}
            <Button size="sm" icon={LogOut} disabled={closeUnavailable !== null} aria-describedby={closeUnavailable ? 'close-grant-unavailable' : undefined}
              aria-disabled={busy || undefined} onClick={() => void closeGrant()}>Close my grant</Button>
            {/* Today's failure has no title of its own (Patients.tsx:246, 271). */}
            {closeError ? <Alert intent="error" size="sm">{closeError}</Alert> : null}
          </div> : null}
        </Card>
      </section> : null}

      <div className="flex flex-col gap-6 empty:hidden">
        <SharedWithYouCard facilityId={facility?.id} permissions={permissions} openUnavailable={openSharedUnavailable} busy={busy} onOpen={openShared} />
      </div>
    </FormPage>
  )
}

/**
 * One way to get access, as a tile: what it is and when to use it. `unavailableId` names the reason the role cannot take
 * it; the tile is then turned off and points to that reason. `busy` (a lookup running) says it is unavailable for now
 * (aria-disabled, today's busy pattern), while it stays focusable; its onClick then does nothing.
 */
function AccessWay({ icon, title, hint, onClick, primary, danger, unavailableId, busy }: {
  icon: Icon; title: string; hint: string; onClick: () => void; primary?: boolean; danger?: boolean; unavailableId?: string; busy?: boolean
}) {
  return <li><button type="button" onClick={onClick} disabled={unavailableId !== undefined} aria-disabled={busy || undefined} aria-describedby={unavailableId}
    className={cx('flex h-full w-full cursor-pointer flex-col items-start gap-2 rounded-xl border-0 p-4 text-left font-[inherit] ring-1 transition-shadow hover:shadow-[var(--shadow-card)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:shadow-none',
      primary ? 'bg-brand-soft ring-brand-line' : 'bg-surface ring-line')}>
    <IconChip icon={icon} tone={danger ? 'danger' : primary ? 'brand' : 'neutral'} size="sm" />
    <span className="text-sm font-semibold text-ink">{title}</span>
    <span className="text-[12px] leading-snug text-ink-3">{hint}</span>
  </button></li>
}
