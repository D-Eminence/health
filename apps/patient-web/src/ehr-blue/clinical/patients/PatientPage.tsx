import { isHidApiError } from '@hid/http'
import { EhrButton, EhrCard } from '@hid/ui/ehr'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { staffApi, type Encounter } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { ChartGate, useChart, type Chart } from '../parts/chart'
import { ActionList, DetailGrid, DetailMeta, HistoryCard, SavedRecord, Step, SubHeading } from '../parts/Detail'
import { formatDate, formatWhen, shortId } from '../parts/format'
import type { KeyValue } from '../parts/KeyValueList'
import { Banner, ErrorBox, Loading, NoActions, RecordHeading } from '../parts/Notices'
import type { PatientFacts } from '../parts/PatientHeader'
import { StatusBadge } from '../parts/StatusBadge'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'
import { isDemoFacility } from '../../blueFacilities'
import { CLOSE_GRANT, CLOSE_REASON, METHOD_ROUTES, actionUnavailable, administratorOf, offerHealthId } from '../consent/access'
import type { ActivePatient } from '../../../staff/App'

export const CLOSED_NOTICE = 'closed'

function sexText(value: string | undefined) {
  if (!value) return ''
  const words = value.replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function accessLabel(patient: ActivePatient): string {
  return patient.purpose === 'emergency' ? 'Emergency access' : 'Access allowed'
}

/** What the allowed lookup told us, as the design's key and value list prints it. Nothing else is known here. */
export function patientDetails(patient: ActivePatient, facts: PatientFacts): KeyValue[] {
  return [
    { label: 'Name', value: facts.name },
    { label: 'Date of birth', value: formatDate(facts.dateOfBirth) },
    { label: 'Sex', value: sexText(facts.sex) },
    { label: 'Health ID', value: facts.hid },
    { label: 'Access', value: patient.purpose === 'emergency' ? 'Emergency (read-only)' : 'Direct care' },
    { label: 'Access until', value: formatWhen(patient.lookup.authorization.expiresAt) },
  ]
}

type Reported =
  | { readonly scope: string; readonly status: 'hidden' }
  | { readonly scope: string; readonly status: 'failed' }
  | { readonly scope: string; readonly status: 'shown'; readonly allergies: string | null }

/**
 * The "Allergies" row of the patient's Saved record (audit 9): what the patient entered in their Health ID portal, as
 * today's "Reported by the patient" reads it (staff/routes/PatientReportedHealth.tsx) and under the same conditions:
 * direct care only, with ehr.note.read, read afresh for each actor, facility, patient, purpose and permission set (today's
 * key), so nothing of another patient's shows. No row while it loads, when EHR refuses it (403) or does not serve it
 * (404), or when the patient has stated nothing; another failure says so in today's words, with today's retry. It is
 * what the patient says, not a clinical finding, and is labelled so.
 */
function useReportedAllergies(chart: Chart): KeyValue | null {
  const { state, permissions } = useClinical()
  const { facilityId, patientId, purpose } = chart
  const reads = purpose === 'direct-care' && permissions.includes('ehr.note.read')
  const actorId = state.status === 'ready' ? state.session.actor.id : ''
  const [revision, setRevision] = useState(0)
  const scope = JSON.stringify([actorId, facilityId, patientId, purpose, permissions, revision])
  const [reported, setReported] = useState<Reported | null>(null)

  useEffect(() => {
    if (!reads) return
    const controller = new AbortController()
    // Run as a promise, as today's component does, so that a read that throws at once is this row's failure, never the page's.
    void Promise.resolve().then(() => staffApi.reportedHealthProfile(facilityId, patientId, controller.signal)).then(
      profile => {
        if (!controller.signal.aborted) setReported(profile ? { scope, status: 'shown', allergies: profile.allergies } : { scope, status: 'hidden' })
      },
      (caught: unknown) => {
        if (controller.signal.aborted) return
        // Refused or not served: nothing is shown. Only the service failing to answer says so, with a retry.
        setReported({ scope, status: isHidApiError(caught) && caught.status !== 403 && caught.status !== 404 ? 'failed' : 'hidden' })
      },
    )
    return () => controller.abort()
  }, [reads, scope, facilityId, patientId])

  // An answer for an earlier scope (or retry) is never shown: until this one answers, there is no row.
  const current = reads && reported?.scope === scope ? reported : null
  if (!current || current.status === 'hidden') return null
  if (current.status === 'failed') {
    return {
      label: 'Allergies',
      value: (
        <>
          <span>What the patient entered about their health could not be loaded.</span>{' '}
          <button type="button" className="hid-ehr-clinical-link hid-ehr-clinical-link-button" onClick={() => setRevision(value => value + 1)}>
            Retry patient-reported health information
          </button>
        </>
      ),
    }
  }
  return { label: 'Allergies', value: `${current.allergies ?? 'Not stated'} (patient-reported)` }
}

/** The open patient's page (`patients/open`: the URL names no patient). */
export function PatientPage() {
  const chart = useChart()
  const href = useWorkspaceHref()
  return (
    <>
      <RecordHeading title={chart ? chart.facts.name : 'Patients'} backHref={href()} />
      <ChartGate allowEmergency>{current => <PatientRecord chart={current} />}</ChartGate>
    </>
  )
}

function PatientRecord({ chart }: { chart: Chart }) {
  const { facility, permissions, can, setActivePatient } = useClinical()
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const emergency = chart.purpose === 'emergency'
  const grantId = chart.patient.lookup.authorization.consentGrantId ?? null
  const administrator = administratorOf(facility, permissions)
  const closeUnavailable = actionUnavailable(CLOSE_GRANT, permissions, administrator)
  // The access steps today's Patients page offers (its METHOD_ROUTES), each with today's reason when the role cannot take it.
  const pinUnavailable = actionUnavailable(METHOD_ROUTES.pin, permissions, administrator)
  const requestUnavailable = actionUnavailable(METHOD_ROUTES.request, permissions, administrator)
  const emergencyUnavailable = actionUnavailable(METHOD_ROUTES.emergency, permissions, administrator)
  const allergies = useReportedAllergies(chart)

  async function closeGrant() {
    if (!grantId || closeUnavailable) return
    setError('')
    try {
      await staffApi.closeGrant(chart.facilityId, grantId, CLOSE_REASON)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Grant could not be closed.')
      return
    }
    setActivePatient(null)
    navigate(href(), { state: { notice: CLOSED_NOTICE } })
  }

  /**
   * As the design's Next steps, a step shows only to a role that may take it: External record access opens only with
   * identity.consent.write (the frame's rule, the permission its request form needs). The two steps that move an
   * emergency patient to direct care are the exception: a role that cannot take one sees it disabled with today's reason,
   * as on Patients.
   */
  const mayOpenConsent = can('identity.consent.write')

  /** The Health ID is handed over in memory only, and only where the request form can open and read it. */
  function openConsent() {
    if (!mayOpenConsent) return
    offerHealthId(chart.patient.hid, chart.facilityId, setActivePatient)
    navigate(href.to('consent', 'new'))
  }

  /**
   * The access steps, as Patients takes them: under direct care at the demo facilities only, emergency break-glass access
   * (Emergency's own page, which needs identity.break-glass.write; today's portal offers it only from Patients' Obtain
   * access, never on an open record); under emergency access, the patient's PIN (Patients' own page) or a request
   * (External record access), which move the patient to direct care. Each hands the Health ID over in memory, never in
   * the URL, and only to a step the role may take.
   */
  function accessStep(target: 'pin' | 'request' | 'emergency') {
    const unavailable = target === 'pin' ? pinUnavailable : target === 'request' ? requestUnavailable : emergencyUnavailable
    if (unavailable) return
    offerHealthId(chart.patient.hid, chart.facilityId, setActivePatient)
    if (target === 'pin') navigate(href('pin'))
    else if (target === 'request') navigate(href.to('consent', 'new'))
    else navigate(href.to('emergency', 'break-glass'))
  }

  return (
    <>
      {/* The design's "[status] Saved …" line (audit 3): the access the patient is open under, and "Read only" when the
          grant allows no changes. Name, date of birth, sex and Health ID are in Saved record. */}
      <DetailMeta status={accessLabel(chart.patient)}>{chart.writeNotice !== null ? <StatusBadge status="Read only" /> : null}</DetailMeta>
      {emergency ? (
        <Banner tone="warning" title="Emergency access is read-only">
          {`${chart.facts.name} is open under emergency access. Emergency access shows the read-only emergency summary only; nothing can be added or changed.`}
        </Banner>
      ) : null}
      {chart.writeNotice ? <Banner title="Read only">{chart.writeNotice}</Banner> : null}
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      <DetailGrid>
        <SavedRecord items={allergies ? [...patientDetails(chart.patient, chart.facts), allergies] : patientDetails(chart.patient, chart.facts)} />
        <EhrCard title="Available actions">
          {grantId ? (
            <>
              {closeUnavailable ? <p id="close-grant-unavailable" className="hid-ehr-clinical-note">{closeUnavailable}</p> : null}
              <ActionList>
                <EhrButton
                  variant="secondary"
                  disabled={closeUnavailable !== null}
                  aria-describedby={closeUnavailable ? 'close-grant-unavailable' : undefined}
                  onClick={closeGrant}
                >
                  Close my grant
                </EhrButton>
              </ActionList>
            </>
          ) : <NoActions />}
          <SubHeading>Next steps</SubHeading>
          {emergency ? (
            <>
              <Step><EhrButton variant="secondary" onClick={() => navigate(href.to('emergency', 'summary'))}>Open the emergency summary</EhrButton></Step>
              {/* Emergency access is read-only: the PIN or the patient's approval moves the patient to direct care. */}
              <Step>
                <EhrButton
                  variant="secondary"
                  disabled={pinUnavailable !== null}
                  aria-describedby={pinUnavailable ? 'pin-step-unavailable' : undefined}
                  onClick={() => accessStep('pin')}
                >
                  Verify patient PIN
                </EhrButton>
              </Step>
              {pinUnavailable ? <p id="pin-step-unavailable" className="hid-ehr-clinical-note">{pinUnavailable}</p> : null}
              <Step>
                <EhrButton
                  variant="secondary"
                  disabled={requestUnavailable !== null}
                  aria-describedby={requestUnavailable ? 'request-step-unavailable' : undefined}
                  onClick={() => accessStep('request')}
                >
                  Request access
                </EhrButton>
              </Step>
              {requestUnavailable ? <p id="request-step-unavailable" className="hid-ehr-clinical-note">{requestUnavailable}</p> : null}
            </>
          ) : (
            <>
              {/* Appointments and patient visits are samples: offered only at the demo facilities. Today's Patients
                  page offers no registration, so a real facility gets neither step. Each opens the sample's new form, as
                  the design's hand-off does; no live patient is carried into a sample, so its "Patient *" starts unchosen. */}
              {isDemoFacility(chart.facilityId) ? (
                <>
                  <Step><EhrButton variant="secondary" onClick={() => navigate(href.to('appointments', 'new'))}>Open appointments</EhrButton></Step>
                  <Step><EhrButton variant="secondary" onClick={() => navigate(href.to('journey', 'new'))}>Register walk-in visit</EhrButton></Step>
                </>
              ) : null}
              {/* The design's three steps only (audit 4): each encounter opens from Connected hospital history below. */}
              {mayOpenConsent ? <Step><EhrButton variant="secondary" onClick={openConsent}>Open consent</EhrButton></Step> : null}
              {/* At the demo facilities only, like the sample steps: today's portal never offers break-glass on an open
                  record, so a real facility keeps it on Patients' Obtain access. Shown, as the card's steps are, only to
                  a role that may take it. */}
              {isDemoFacility(chart.facilityId) && emergencyUnavailable === null ? (
                <Step><EhrButton variant="secondary" onClick={() => accessStep('emergency')}>Emergency break-glass access</EhrButton></Step>
              ) : null}
            </>
          )}
        </EhrCard>
      </DetailGrid>
      {!emergency && chart.can('ehr.encounter.read') ? <EncounterHistory chart={chart} /> : null}
    </>
  )
}

type HistoryState = { readonly items: readonly Encounter[] } | { readonly error: string } | null

/**
 * "Connected hospital history": this facility's encounters for the patient (today's chart list), each opening in
 * Consultation. Read after today's re-check; a refusal there closes the patient and shows that access ended.
 */
function EncounterHistory({ chart }: { chart: Chart }) {
  const href = useWorkspaceHref()
  const [state, setState] = useState<HistoryState>(null)
  const { facilityId, patientId, verify } = chart
  // Read once per patient: the re-check itself may be a new function on each render.
  const recheck = useRef(verify)
  useLayoutEffect(() => { recheck.current = verify })

  useEffect(() => {
    let current = true
    setState(null)
    void (async () => {
      try {
        await recheck.current()
        const page = await staffApi.encounters(facilityId, patientId)
        if (current) setState({ items: page.items })
      } catch (caught) {
        if (current) setState({ error: refusalText(caught, 'Encounters could not be loaded.') })
      }
    })()
    return () => { current = false }
  }, [facilityId, patientId])

  if (state === null || 'error' in state) {
    return (
      <EhrCard title="Connected hospital history">
        <p>Only records available to your current permissions are listed.</p>
        {state === null ? <Loading label="Loading encounters…" /> : <ErrorBox>{state.error}</ErrorBox>}
      </EhrCard>
    )
  }
  return (
    <HistoryCard
      empty="No encounters are available for this patient and facility."
      items={state.items.map(item => ({
        key: item.id,
        label: `Consultation · ${shortId(item.id)}`,
        href: href.to('consult', item.id),
        status: item.status,
      }))}
    />
  )
}
