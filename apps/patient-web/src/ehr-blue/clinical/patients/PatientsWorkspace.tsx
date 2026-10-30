import { normalizeHealthIdInput } from '@hid/contracts'
import { EhrButton, EhrCard, EhrPageHeading } from '@hid/ui/ehr'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ACCESS_ENDED, ChartProvider, NO_AUTHORIZED_PATIENT, OPEN_PATIENT_HOW, useAccessEnded } from '../parts/chart'
import { formatWhen } from '../parts/format'
import { Banner, ErrorBox, RecordNotFound } from '../parts/Notices'
import { patientFacts } from '../parts/PatientHeader'
import { RecordTable, SearchField, type RecordRow } from '../parts/RecordTable'
import { Workspace, useClinical, useWorkspaceHref } from '../parts/Workspace'
import type { EhrBluePageStatus } from '../types'
import {
  ACCESS_CLOSED, HID_FORMAT, OPEN_SHARED, actionUnavailable, administratorOf, healthIdInput, healthIdProblem, isRefusedLookup,
  offerHealthId, useOpenPatient,
} from '../consent/access'
import { CLOSED_NOTICE, PatientPage, accessLabel, patientDetails } from './PatientPage'
import { ShareInvitationsForMe, SharedWithYou } from './SharingCards'
import './patients.css'

/** Every part is on today's Health ID API: the Health ID lookup, the grant, encounters and patient sharing. */
export const patientsStatus: EhrBluePageStatus = 'live'

/**
 * Patients: search by Health ID (today's governed access), the patient open now, and that patient's page at
 * `patients/open`. There is no list of every patient: Health ID shows a patient only once this facility may see them.
 */
export function PatientsWorkspace() {
  return (
    <Workspace path="patients">
      <ChartProvider>
        <Routes>
          <Route index element={<PatientList />} />
          <Route path="open" element={<PatientPage />} />
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

function noticeOf(state: unknown): string {
  return state && typeof state === 'object' && 'notice' in state && state.notice === CLOSED_NOTICE ? ACCESS_CLOSED : ''
}

function PatientList() {
  const { facility, permissions, can, activePatient } = useClinical()
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const location = useLocation()
  const ended = useAccessEnded()
  const openPatient = useOpenPatient()
  const [hid, setHid] = useState('')
  const [problem, setProblem] = useState<{ message: string; alert: boolean } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<{ hid: string; message: string } | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(() => noticeOf(location.state))
  const searchBox = useRef<HTMLDivElement>(null)
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

  function obtain(target: 'new' | 'pin') {
    if (!refused || !facility) return
    offerHealthId(refused.hid, facility.id)
    navigate(href.to('consent', target))
  }

  const rows = useMemo<RecordRow[]>(() => {
    if (!activePatient) return []
    const facts = patientFacts(activePatient)
    const expires = activePatient.lookup.authorization.expiresAt
    return [{
      id: 'open',
      name: facts.name,
      reference: activePatient.purpose === 'emergency' ? 'Emergency' : 'Direct care',
      context: facts.name,
      contextSub: facts.hid,
      status: accessLabel(activePatient),
      statusNote: expires ? `until ${formatWhen(expires)}` : undefined,
      details: patientDetails(activePatient, facts),
    }]
  }, [activePatient])

  let hidError: ReactNode = undefined
  if (problem) hidError = problem.alert ? <span key={attempt} role="alert">{problem.message}</span> : problem.message

  return (
    <>
      <EhrPageHeading title="Patients" />
      {ended && !activePatient ? (
        <Banner tone="critical" title="Access to this patient ended">{ACCESS_ENDED}</Banner>
      ) : null}
      <EhrCard>
        <div ref={searchBox}>
          <SearchField
            label="Search Patients"
            type="text"
            value={hid}
            placeholder="Enter a Health ID…"
            hint={HID_FORMAT}
            error={hidError}
            onChange={value => { setHid(healthIdInput(value)); setProblem(null) }}
            onSubmit={search}
          >
            <EhrButton type="submit" className="hid-ehr-clinical-patients-verify" busy={busy} disabled={!canLook}>Verify access</EhrButton>
          </SearchField>
        </div>
        {refused ? (
          <Banner
            tone="warning"
            title="No access to this patient yet"
            actions={(
              <>
                <EhrButton variant="secondary" onClick={() => obtain('new')}>Request access</EhrButton>
                <EhrButton variant="secondary" onClick={() => obtain('pin')}>Verify patient PIN</EhrButton>
                <EhrButton variant="secondary" onClick={() => navigate(href.to('emergency'))}>Emergency break-glass access</EhrButton>
              </>
            )}
          >
            {refused.message}
          </Banner>
        ) : null}
        {error ? <ErrorBox>{error}</ErrorBox> : null}
        {/* Mounted throughout, so what an access step says is announced. */}
        <div role="status">{notice ? <p className="hid-ehr-clinical-status">{notice}</p> : null}</div>
        <RecordTable
          caption="Patients"
          rows={rows}
          hrefFor={() => href('open')}
          emptyTitle={NO_AUTHORIZED_PATIENT}
          emptyMessage={OPEN_PATIENT_HOW}
        />
      </EhrCard>
      <div className="hid-ehr-clinical-patients-sharing">
        <SharedWithYou facilityId={facility?.id} permissions={permissions} openUnavailable={openSharedUnavailable} busy={busy} onOpen={openShared} />
        <ShareInvitationsForMe facilityId={facility?.id} permissions={permissions} />
      </div>
    </>
  )
}
