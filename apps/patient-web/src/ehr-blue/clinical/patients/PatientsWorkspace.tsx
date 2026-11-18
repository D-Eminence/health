import { HEALTH_ID_PREFIX, normalizeHealthIdInput } from '@hid/contracts'
import { isHidApiError } from '@hid/http'
import { ArrowRight, IdCard, KeyRound, Lock, Search, Send, Siren, UserPlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Alert, Badge, Button, Card, IconChip, Input, SectionHeader, cx, type Icon } from '../../../kasuwa/ui'
import { FormPage } from '../../../kasuwa/parts'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ChartProvider, useAccessEnded } from '../parts/chart'
import { formatWhen } from '../parts/format'
import { opensInProduct, productOf } from '../../frame/product'
import { RecordNotFound } from '../parts/Notices'
import { patientFacts } from '../parts/PatientHeader'
import { Workspace, useClinical, useWorkspaceHref } from '../parts/Workspace'
import type { EhrBluePageStatus } from '../types'
import {
  ACCESS_CLOSED, HID_FORMAT, METHOD_ROUTES, NOT_GRANTED, OPEN_SHARED, actionUnavailable, administratorOf, dropOfferedHealthId,
  healthIdProblem, isRefusedLookup, lookupRefusal, offerHealthId, useOpenPatient, type AccessMethod,
} from '../consent/access'
import { PinAccess } from '../consent/PinAccess'
import { CLOSED_NOTICE, PatientPage, accessLabel } from './PatientPage'
import { SharedWithYouCard } from './SharingCards'

/** How long the Health ID field rests, after a whole Health ID arrived in it at once, before it is looked up by itself. */
export const AUTO_LOOKUP_MS = 600

/**
 * The fewest letters one change of the field adds for it to count as a whole Health ID arriving at once (a scanner
 * types fast but each letter is its own change; a paste or an autofill is one change). Six is the shortest Health ID.
 */
const ARRIVES_AT_ONCE = 6
/** The browser's names for a change that puts in text from elsewhere in one go: a paste, or an autofill or suggestion. */
const AT_ONCE_INPUT_TYPES: ReadonlySet<string> = new Set(['insertFromPaste', 'insertReplacementText'])

/**
 * Whether a change of the Health ID field brought a whole Health ID at once (pasted, scanned in one go, or filled in),
 * not a letter typed. Only such a change is looked up by itself: a Health ID is 6 to 32 letters and digits, so a pause
 * while typing a long one would otherwise look up a shorter, different patient (review of #263).
 */
function arrivedAtOnce(native: Event, pasted: boolean, before: string, after: string): boolean {
  const inputType = (native as Partial<InputEvent>).inputType
  return pasted || (typeof inputType === 'string' && AT_ONCE_INPUT_TYPES.has(inputType)) || after.length - before.length >= ARRIVES_AT_ONCE
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

/**
 * A Health ID handed over in location state (Registration, or the top-bar search) starts a fresh form, even when Find
 * a patient is already open, so the handed one is what the field shows.
 */
function HandedPatientList() {
  const location = useLocation()
  const handed = (location.state as { hid?: unknown } | null)?.hid
  return <PatientList key={typeof handed === 'string' ? location.key : 'list'} />
}

function noticeOf(state: unknown): string {
  return state && typeof state === 'object' && 'notice' in state && state.notice === CLOSED_NOTICE ? ACCESS_CLOSED : ''
}

function PatientList() {
  const { facility, permissions, can, activePatient, setActivePatient } = useClinical()
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const location = useLocation()
  const ended = useAccessEnded()
  const openPatient = useOpenPatient()
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
  // Dormant for now: today's identity-api answers 404 NOT_FOUND both for a Health ID no patient has and for a patient
  // this facility can't see, so a live lookup never says PATIENT_NOT_FOUND. It waits on the backend's answer to Q100
  // ("No such patient", BACKEND-NEEDS.md); until then a 404 is shown as a refused lookup.
  const [unknown, setUnknown] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(() => noticeOf(location.state))
  // Whether the Health ID in the field arrived whole at once (pasted or scanned): only then is it looked up by itself.
  // A Health ID typed, or handed over from Registration, waits for Find or Enter.
  const [atOnce, setAtOnce] = useState(false)
  // A paste into the field, until the change it makes: the change's own input type is not given by every browser.
  const pasting = useRef(false)
  const searchBox = useRef<HTMLFormElement>(null)
  const canLook = !!facility && can('identity.patient.read')
  const administrator = administratorOf(facility, permissions)
  const openSharedUnavailable = actionUnavailable(OPEN_SHARED, permissions, administrator)
  // "Obtain access" gives today's reason with each way the role cannot take, as today's "Obtain access" card does.
  const requestUnavailable = actionUnavailable(METHOD_ROUTES.request, permissions, administrator)
  const pinUnavailable = actionUnavailable(METHOD_ROUTES.pin, permissions, administrator)
  const emergencyUnavailable = actionUnavailable(METHOD_ROUTES.emergency, permissions, administrator)

  function clearFeedback() { setNotice(''); setError(''); setRefused(null); setUnknown(null) }

  /** Today's openPatient from a typed or shared Health ID: an allowed lookup opens the patient's page. */
  async function open(candidate: string) {
    setBusy(true)
    try {
      if (await openPatient(candidate, 'direct-care')) navigate(href('open'))
    } catch (caught) {
      // No grant yet says how to get one; a lab or pharmacy role's 404 says the record isn't open to it here.
      const message = lookupRefusal(caught, facility?.roles ?? [])
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

  function openShared(sharedHid: string) {
    if (busy) return
    clearFeedback()
    void open(sharedHid)
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

  const open_ = activePatient ? patientFacts(activePatient) : null
  const expires = activePatient?.lookup.authorization.expiresAt
  const hidError = problem ? (problem.alert ? <span key={attempt} role="alert">{problem.message}</span> : problem.message) : null

  return (
    <FormPage title="Find a patient" description="Paste or scan their Health ID and it’s checked at once. If you type it, select Find."
      actions={registers ? <Button to="/provider/registration" icon={UserPlus}>Register a patient</Button> : undefined}>
      {ended && !activePatient ? <Alert intent="error" title="Access to this patient ended">Open the patient again to keep working.</Alert> : null}

      <Card>
        <form ref={searchBox} noValidate className="flex flex-col gap-2 p-5" onSubmit={event => { event.preventDefault(); search() }}>
          <label htmlFor="patient-hid" className="text-[13px] font-medium text-ink-2">Health ID</label>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1"><Input id="patient-hid" icon={IdCard} value={hid} placeholder="HID-ADA2345" autoComplete="off" spellCheck={false}
              required aria-required="true" aria-invalid={problem ? true : undefined} aria-describedby={problem ? 'patient-hid-hint patient-hid-problem' : 'patient-hid-hint'}
              onKeyDown={() => { pasting.current = false }} onPaste={() => { pasting.current = true }}
              onChange={event => {
                const next = normalizeHealthIdInput(event.target.value)
                setAtOnce(arrivedAtOnce(event.nativeEvent, pasting.current, hid, next))
                pasting.current = false
                setHid(next); setProblem(null); setRefused(null); setUnknown(null)
              }} className="h-11 font-medium tracking-[.06em] uppercase" /></div>
            {/* Busy (aria-busy), it stays focusable (aria-disabled, not disabled), as today's Verify access: focus is not lost
                while the lookup runs, and a second press looks nothing up (search() returns while one is on its way). */}
            <Button type="submit" variant="primary" icon={Search} disabled={!canLook} aria-busy={busy || undefined} aria-disabled={busy || undefined} className="h-11">Find</Button>
          </div>
          <p id="patient-hid-hint" className="m-0 text-[12px] text-ink-3">It’s on the patient’s Health ID card. {HID_FORMAT}</p>
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
              <p className="m-0 mt-0.5 text-[13px] text-ink-3">{refused.message === NOT_GRANTED ? 'Choose how to get it.' : refused.message}</p></div>
          </div>
        </div> : null}

        {/* The ways in, offered only once Find was refused, so a patient this facility may open opens at once with nothing
            to pick (owner, 17 Nov 2026). The Access PIN leads, for the patient who is with you; asking them is next;
            emergency access last. Each is for the Health ID in the field. */}
        {refused ? <div role="group" aria-labelledby="patients-other-access" className="border-t border-line p-5 pt-0">
          <h2 id="patients-other-access" className="sr-only">Obtain access</h2>
          {/* A way the role cannot take is not offered as a dead end: it is turned off, with today's reason. */}
          {pinUnavailable ? <p id="other-pin-unavailable" className="m-0 mb-2 text-[13px] text-ink-3">{pinUnavailable}</p> : null}
          {requestUnavailable ? <p id="request-access-unavailable" className="m-0 mb-2 text-[13px] text-ink-3">{requestUnavailable}</p> : null}
          {offersEmergency && emergencyUnavailable ? <p id="other-emergency-unavailable" className="m-0 mb-2 text-[13px] text-ink-3">{emergencyUnavailable}</p> : null}
          <ul className={`m-0 grid list-none gap-1.5 rounded-2xl bg-tray p-1.5 ${offersEmergency ? '@xl:grid-cols-3' : '@xl:grid-cols-2'}`}>
            <AccessWay icon={KeyRound} title="Use their Access PIN" hint="If they’re with you and have set one." primary busy={busy}
              unavailableId={pinUnavailable ? 'other-pin-unavailable' : undefined} onClick={() => otherWay('pin')} />
            <AccessWay icon={Send} title="Ask the patient" hint="They approve on their phone. You’re told the moment they do." busy={busy}
              unavailableId={requestUnavailable ? 'request-access-unavailable' : undefined} onClick={() => otherWay('request')} />
            {offersEmergency ? <AccessWay icon={Siren} title="Emergency access" hint="Only if they can’t consent. Time-limited and recorded." danger busy={busy}
              unavailableId={emergencyUnavailable ? 'other-emergency-unavailable' : undefined} onClick={() => otherWay('emergency')} /> : null}
          </ul>
        </div> : null}
        {error ? <div className="border-t border-line p-5"><Alert intent="error" title="Couldn’t check access">{error}</Alert></div> : null}
        {/* Mounted throughout, so what an access step says is announced. */}
        <div role="status" className="empty:hidden">{notice ? <p className="m-0 border-t border-line px-5 py-3 text-[13px] text-ink-2">{notice}</p> : null}</div>
      </Card>

      {/* Shown only while a patient is open: a section shows only when it has something in it. */}
      {activePatient && open_ ? <section aria-labelledby="patients-open" className="flex flex-col gap-3">
        <SectionHeader id="patients-open" title="Open now" />
        <Card>
          <div className="flex flex-wrap items-center gap-4 p-5">
            <span aria-hidden="true" className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[15px] font-semibold text-brand-ink">{open_.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate text-title-3 text-ink">{open_.name}</p>
              <p className="m-0 mt-0.5 text-[13px] text-ink-3"><span className="font-medium tracking-[.06em] text-ink-2">{open_.hid}</span>{expires ? ` · until ${formatWhen(expires)}` : ''}</p>
            </div>
            <Badge tone={activePatient.purpose === 'emergency' ? 'danger' : 'success'} size="sm">{accessLabel(activePatient)}</Badge>
            <Button to={href('open')} iconRight={ArrowRight}>Open</Button>
          </div>
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
