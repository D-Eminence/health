import { EhrBadge, EhrButton, EhrCard } from '@hid/ui/ehr'
import { isHidApiError } from '@hid/http'
import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { dentalApi, type Encounter } from '../../../staff/api'
import type { Chart } from '../parts/chart'
import { ActionList } from '../parts/Detail'
import { ErrorBox } from '../parts/Notices'
import { useWorkspaceHref } from '../parts/Workspace'
import { DENTAL_READ, DENTAL_WRITE, STAGE_HINTS, lagosDateTime, stageText, stageTone, useDentalServed, visitOpen } from './dentalRules'
import { useDentalRead, useIdempotencyKeys } from './hooks'
import { dentalFailure, startDentalRecord } from './startVisit'

/**
 * The dental record card on an outpatient visit's Consultation page (DEN-1 "Website screens"), for dentists only
 * (Q-DEN-1 A): the visit's stage and newest chart, with the way to the Dental page's record, or "Start dental record"
 * on an open visit that has none. Nothing at all for anyone else, on any other kind of visit, or once the dental clinic
 * is known to be switched off (DENTAL_ENABLED): the consultation is never held up by it.
 */
export function DentalVisitCard({ chart, encounter }: { readonly chart: Chart; readonly encounter: Pick<Encounter, 'id' | 'encounterType' | 'status'> }) {
  const served = useDentalServed()
  if (!chart.can(DENTAL_READ) || encounter.encounterType !== 'ambulatory' || served === false) return null
  return <DentalVisitSummary chart={chart} encounter={encounter} />
}

function DentalVisitSummary({ chart, encounter }: { readonly chart: Chart; readonly encounter: Pick<Encounter, 'id' | 'status'> }) {
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const keyFor = useIdempotencyKeys()
  const { facilityId, patientId } = chart
  const read = useCallback(() => dentalApi.visit(facilityId, patientId, encounter.id), [facilityId, patientId, encounter.id])
  const record = useDentalRead(`visit:${facilityId}:${patientId}:${encounter.id}`, read)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dentalHref = href.to('dental', encounter.id)

  if (record.state.phase === 'loading') return null
  if (record.state.phase === 'failed') {
    const caught = record.state.caught
    if (!isHidApiError(caught) || caught.code !== 'DENTAL_VISIT_NOT_FOUND') {
      // Switched off, or not this member's to read: said nowhere here (the Dental page says why).
      if (isHidApiError(caught) && (caught.status === 503 || caught.status === 404 || caught.status === 403)) return null
      return <EhrCard title="Dental record"><ErrorBox>{dentalFailure(caught, 'The dental record could not be loaded.')}</ErrorBox></EhrCard>
    }
    const mayStart = chart.canWrite && chart.can(DENTAL_WRITE) && visitOpen(encounter.status)
    if (!mayStart) return null
    const start = async () => {
      setBusy(true)
      setError('')
      const result = await startDentalRecord(chart, encounter.id, keyFor)
      setBusy(false)
      if ('refused' in result) setError(result.refused)
      else navigate(dentalHref)
    }
    return (
      <EhrCard title="Dental record">
        <p>No dental record on this visit yet.</p>
        {error ? <ErrorBox>{error}</ErrorBox> : null}
        <ActionList><EhrButton variant="secondary" busy={busy} onClick={start}>Start dental record</EhrButton></ActionList>
      </EhrCard>
    )
  }
  const { visit, chart: newest, chartVersionsThisVisit, doneThisVisit, plannedProcedures } = record.state.value
  return (
    <EhrCard title="Dental record" actions={<EhrBadge tone={stageTone(visit.stage)}>{stageText(visit.stage)}</EhrBadge>}>
      <p className="hid-ehr-clinical-note">{STAGE_HINTS[visit.stage] ?? ''}</p>
      <ul className="hid-ehr-dental-card-facts">
        <li>{newest ? `Tooth chart version ${newest.versionNo}, recorded ${lagosDateTime(newest.recordedAt)}` : 'No tooth chart recorded yet'}</li>
        <li>{chartVersionsThisVisit.length === 1 ? '1 chart saved at this visit' : `${chartVersionsThisVisit.length} charts saved at this visit`}</li>
        <li>{doneThisVisit.length === 1 ? '1 procedure done' : `${doneThisVisit.length} procedures done`} · {plannedProcedures.length} planned</li>
      </ul>
      <ActionList><Link className="hid-ehr-clinical-link" to={dentalHref}>Open dental record</Link></ActionList>
    </EhrCard>
  )
}
