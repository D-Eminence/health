import { EhrButton, EhrCard } from '@hid/ui/ehr'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { staffApi, type Encounter } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { ChartGate, useChart, type Chart } from '../parts/chart'
import { ActionList, DetailGrid, HistoryCard, SavedRecord, Step, SubHeading } from '../parts/Detail'
import { formatDate, formatWhen, shortId } from '../parts/format'
import type { KeyValue } from '../parts/KeyValueList'
import { Banner, ErrorBox, Loading, NoActions, RecordHeading } from '../parts/Notices'
import { PatientHeader, type PatientFacts } from '../parts/PatientHeader'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'
import { isDemoFacility } from '../../blueFacilities'
import { CLOSE_GRANT, CLOSE_REASON, actionUnavailable, administratorOf, offerHealthId } from '../consent/access'
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
  const closeUnavailable = actionUnavailable(CLOSE_GRANT, permissions, administratorOf(facility, permissions))
  const flags = [accessLabel(chart.patient), ...(chart.writeNotice === null ? [] : ['Read only'])]

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

  /** External record access opens only with identity.consent.write (the frame's rule): only then is the Health ID handed over. */
  function openConsent() {
    if (can('identity.consent.write')) offerHealthId(chart.patient.hid, chart.facilityId, setActivePatient)
    navigate(href.to('consent', 'new'))
  }

  return (
    <>
      <PatientHeader facts={chart.facts} flags={flags} />
      {emergency ? (
        <Banner tone="warning" title="Emergency access is read-only">
          {`${chart.facts.name} is open under emergency access. Emergency access shows the read-only emergency summary only; nothing can be added or changed.`}
        </Banner>
      ) : null}
      {chart.writeNotice ? <Banner title="Read only">{chart.writeNotice}</Banner> : null}
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      <DetailGrid>
        <SavedRecord items={patientDetails(chart.patient, chart.facts)} />
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
            <Step><EhrButton variant="secondary" onClick={() => navigate(href.to('emergency', 'summary'))}>Open the emergency summary</EhrButton></Step>
          ) : (
            <>
              {/* Appointments and patient visits are samples: offered only at the demo facilities. Today's Patients
                  page offers no registration, so a real facility gets neither step. */}
              {isDemoFacility(chart.facilityId) ? (
                <>
                  <Step><EhrButton variant="secondary" onClick={() => navigate(href.to('appointments'))}>Open appointments</EhrButton></Step>
                  <Step><EhrButton variant="secondary" onClick={() => navigate(href.to('journey', 'new'))}>Register walk-in visit</EhrButton></Step>
                </>
              ) : null}
              <Step><EhrButton variant="secondary" onClick={openConsent}>Open consent</EhrButton></Step>
              <Step><EhrButton variant="secondary" onClick={() => navigate(href.to('consult'))}>Open clinical record</EhrButton></Step>
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
