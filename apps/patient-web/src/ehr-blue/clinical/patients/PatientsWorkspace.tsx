import { normalizeHealthIdInput } from '@hid/contracts'
import { ArrowRight, IdCard, KeyRound, Lock, Search, Send, Siren, UserPlus } from 'lucide-react'
import { useRef, useState } from 'react'
import { Alert, Badge, Button, Card, IconChip, Input, SectionHeader, cx, type Icon } from '../../../kasuwa/ui'
import { FormPage } from '../../../kasuwa/parts'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ChartProvider, useAccessEnded } from '../parts/chart'
import { formatWhen } from '../parts/format'
import { RecordNotFound } from '../parts/Notices'
import { patientFacts } from '../parts/PatientHeader'
import { Workspace, useClinical, useWorkspaceHref } from '../parts/Workspace'
import type { EhrBluePageStatus } from '../types'
import {
  ACCESS_CLOSED, HID_FORMAT, NOT_GRANTED, OPEN_SHARED, actionUnavailable, administratorOf, healthIdInput, healthIdProblem, isRefusedLookup,
  offerHealthId, useOpenPatient,
} from '../consent/access'
import { PinAccess } from '../consent/PinAccess'
import { CLOSED_NOTICE, PatientPage, accessLabel } from './PatientPage'
import { ShareInvitationsForMe, SharedWithYou } from './SharingCards'

/** Every part is on today's Health ID API: the Health ID lookup, the grant, encounters and patient sharing. */
export const patientsStatus: EhrBluePageStatus = 'live'

/**
 * Patients: search by Health ID (today's access rules), the patient open now, that patient's page at
 * `patients/open`, and the patient PIN at `patients/pin` (as on today's Patients page, it needs no
 * identity.consent.write, which the frame asks for External record access). There is no list of every patient:
 * Health ID shows a patient only once this facility may see them.
 */
export function PatientsWorkspace() {
  return (
    <Workspace path="patients" title="Patients">
      <ChartProvider>
        <Routes>
          <Route index element={<HandedPatientList />} />
          <Route path="open" element={<PatientPage />} />
          <Route path="pin" element={<PinAccess />} />
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
  // Registration hands over the new Health ID (location state), so the next step is one press of Find.
  const [hid, setHid] = useState(() => { const handed = (location.state as { hid?: unknown } | null)?.hid; return typeof handed === 'string' ? handed : '' })
  const [problem, setProblem] = useState<{ message: string; alert: boolean } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<{ hid: string; message: string } | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(() => noticeOf(location.state))
  const searchBox = useRef<HTMLFormElement>(null)
  const canLook = !!facility && can('identity.patient.read')
  const openSharedUnavailable = actionUnavailable(OPEN_SHARED, permissions, administratorOf(facility, permissions))

  function clearFeedback() { setNotice(''); setError(''); setRefused(null) }

  /** Today's openPatient from a typed or shared Health ID: an allowed lookup opens the patient's page. */
  async function open(candidate: string) {
    setBusy(true)
    try {
      if (await openPatient(candidate, 'direct-care')) navigate(href('open'))
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Patient access could not be verified.'
      if (isRefusedLookup(caught)) setRefused({ hid: candidate, message })
      else setError(message)
    } finally {
      setBusy(false)
    }
  }

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
    void open(normalized)
  }

  function openShared(sharedHid: string) {
    if (busy) return
    clearFeedback()
    void open(sharedHid)
  }

  /**
   * The PIN is a Patients page; a request is External record access, which the frame opens only with
   * identity.consent.write. The Health ID is handed over only where the form can open and read it.
   */
  function obtain(target: 'new' | 'pin' | 'emergency') {
    if (!refused || !facility) return
    if (target === 'emergency') {
      // The emergency form reads it too (the frame opens it only with identity.break-glass.write), so the Health ID
      // just searched is not typed again.
      if (can('identity.break-glass.write')) offerHealthId(refused.hid, facility.id, setActivePatient)
      navigate(href.to('emergency'))
      return
    }
    if (target === 'pin') {
      offerHealthId(refused.hid, facility.id, setActivePatient)
      navigate(href('pin'))
      return
    }
    if (can('identity.consent.write')) offerHealthId(refused.hid, facility.id, setActivePatient)
    navigate(href.to('consent', 'new'))
  }

  const open_ = activePatient ? patientFacts(activePatient) : null
  const expires = activePatient?.lookup.authorization.expiresAt
  const hidError = problem ? (problem.alert ? <span key={attempt} role="alert">{problem.message}</span> : problem.message) : null

  return (
    <FormPage title="Find a patient" description="Search by Health ID to open their record, or to get access if you don’t have it yet."
      actions={<Button to="/provider/registration" icon={UserPlus}>Register a patient</Button>}>
      {ended && !activePatient ? <Alert intent="error" title="Access to this patient ended">Open the patient again to keep working.</Alert> : null}

      <Card>
        <form ref={searchBox} noValidate className="flex flex-col gap-2 p-5" onSubmit={event => { event.preventDefault(); search() }}>
          <label htmlFor="patient-hid" className="text-[13px] font-medium text-ink-2">Health ID</label>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1"><Input id="patient-hid" icon={IdCard} value={hid} placeholder="HID-ADA2345" autoComplete="off" spellCheck={false}
              aria-invalid={problem ? true : undefined} aria-describedby={problem ? 'patient-hid-hint patient-hid-problem' : 'patient-hid-hint'}
              onChange={event => { setHid(healthIdInput(event.target.value)); setProblem(null) }} className="h-11 font-medium tracking-[.06em] uppercase" /></div>
            <Button type="submit" variant="primary" icon={Search} loading={busy} disabled={!canLook} className="h-11">Find</Button>
          </div>
          <p id="patient-hid-hint" className="m-0 text-[12px] text-ink-3">It’s on the patient’s Health ID card. {HID_FORMAT}</p>
          {hidError ? <p id="patient-hid-problem" className="m-0 text-[13px] font-medium text-danger-ink">{hidError}</p> : null}
        </form>

        {/* No access yet: the three ways in, as one choice, the usual one first (Hick's law: three, ordered). */}
        {refused ? <div className="border-t border-line p-5">
          <div className="mb-3 flex items-start gap-3">
            <IconChip icon={Lock} tone="warn" />
            <div className="min-w-0"><p className="m-0 text-title-3 text-ink">You don’t have access to {refused.hid} yet</p>
              <p className="m-0 mt-0.5 text-[13px] text-ink-3">{refused.message === NOT_GRANTED ? 'Choose how to get it.' : refused.message}</p></div>
          </div>
          <ul className="m-0 grid list-none gap-1.5 rounded-2xl bg-tray p-1.5 sm:grid-cols-3">
            <AccessWay icon={Send} title="Ask the patient" hint="They approve on their phone. You’re told the moment they do." primary onClick={() => obtain('new')} />
            <AccessWay icon={KeyRound} title="Use their Access PIN" hint="If they’re with you and have set one." onClick={() => obtain('pin')} />
            <AccessWay icon={Siren} title="Emergency access" hint="Only if they can’t consent. Time-limited and reviewed." danger onClick={() => obtain('emergency')} />
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
        <SharedWithYou facilityId={facility?.id} permissions={permissions} openUnavailable={openSharedUnavailable} busy={busy} onOpen={openShared} />
        <ShareInvitationsForMe facilityId={facility?.id} permissions={permissions} />
      </div>
    </FormPage>
  )
}

/** One way to get access, as a tile: what it is and when to use it. */
function AccessWay({ icon, title, hint, onClick, primary, danger }: { icon: Icon; title: string; hint: string; onClick: () => void; primary?: boolean; danger?: boolean }) {
  return <li><button type="button" onClick={onClick}
    className={cx('flex h-full w-full cursor-pointer flex-col items-start gap-2 rounded-xl border-0 p-4 text-left font-[inherit] ring-1 transition-shadow hover:shadow-[var(--shadow-card)]',
      primary ? 'bg-brand-soft ring-brand-line' : 'bg-surface ring-line')}>
    <IconChip icon={icon} tone={danger ? 'danger' : primary ? 'brand' : 'neutral'} size="sm" />
    <span className="text-sm font-semibold text-ink">{title}</span>
    <span className="text-[12px] leading-snug text-ink-3">{hint}</span>
  </button></li>
}
