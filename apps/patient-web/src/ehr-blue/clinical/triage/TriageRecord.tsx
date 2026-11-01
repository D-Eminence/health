import { isHidApiError } from '@hid/http'
import { EhrButton, EhrCard } from '@hid/ui/ehr'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { staffApi, type ClinicalRecord, type Encounter } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { ChartGate, useChart, type Chart } from '../parts/chart'
import { ActionList, DetailGrid, DetailMeta, SavedRecord, VersionsCard, type VersionItem } from '../parts/Detail'
import { formatWhen, shortId, statusLabel } from '../parts/format'
import type { KeyValue } from '../parts/KeyValueList'
import { Banner, ErrorBox, Loading, NoActions, RecordHeading, RecordNotFound } from '../parts/Notices'
import type { SubmitOutcome } from '../parts/RecordForm'
import { useWorkspaceHref } from '../parts/Workspace'
import { ConnectedHistory } from './ConnectedHistory'
import {
  NO_COMPLAINT, NO_RECORD_ACCESS, RECORD_SAVED, RELOAD_FAILED, recordedAt, refusedFieldErrors, rowVersion, useFocusAfterChange, useLatest, useVisitRecord,
} from './records'
import {
  AMEND_LABEL, CHANGED_SINCE, CORRECTION_FAILED, CORRECTION_HINT, CORRECTION_SAVED, CORRECTION_UNREAD, LOADING_CORRECTION, RELOAD_FIRST,
  RETRACTED_SINCE, RETRACTED_TEXT, TITLE, VITAL_FIELDS, correctionNumber, currentValues, isRetracted, measurementItems, readCorrections,
  reloadSentence, vitalStatus, type Corrections,
} from './vitals'
import { VitalsForm, type VitalsInput } from './VitalsForm'

/** One vitals record's page, or the chart's own state. */
export function TriageRecord() {
  const href = useWorkspaceHref()
  const chart = useChart()
  if (chart && chart.purpose === 'direct-care') return <ChartGate>{open => <TriageLoader chart={open} />}</ChartGate>
  return (
    <>
      <RecordHeading title={TITLE} backHref={href()} />
      <ChartGate>{open => <TriageLoader chart={open} />}</ChartGate>
    </>
  )
}

function TriageLoader({ chart }: { chart: Chart }) {
  const href = useWorkspaceHref()

  if (!chart.can('ehr.vital.read')) {
    return (
      <>
        <RecordHeading title={TITLE} backHref={href()} />
        <ErrorBox>{NO_RECORD_ACCESS}</ErrorBox>
      </>
    )
  }
  return <TriageReader chart={chart} />
}

/** Reads the record only for a role that may read it. */
function TriageReader({ chart }: { chart: Chart }) {
  const href = useWorkspaceHref()
  const { recordId = '' } = useParams()
  const { loaded, reload } = useVisitRecord(chart, recordId, 'vitals')

  if (loaded.phase === 'loading') return <Loading label="Loading records…" />
  if (loaded.phase === 'missing') return <RecordNotFound backHref={href()} />
  if (loaded.phase === 'failed') {
    return (
      <>
        <RecordHeading title={TITLE} backHref={href()} />
        <ErrorBox>{loaded.message}</ErrorBox>
      </>
    )
  }
  return <VitalRecord key={loaded.record.id} chart={chart} encounter={loaded.encounter} vital={loaded.record} reload={reload} />
}

const MEASUREMENTS = new Set<string>(VITAL_FIELDS.map(field => field.name))

/** A vital's corrections, read again whenever EHR names a new current one. */
function useVitalCorrections(chart: Chart, encounterId: string, vital: ClinicalRecord): Corrections {
  const { facilityId, patientId } = chart
  const number = correctionNumber(vital)
  const [read, setRead] = useState<{ key: string; value: Corrections } | null>(null)
  const key = `${vital.id}-${number}-${String(vital.rowVersion)}`

  useEffect(() => {
    if (number === 0) return
    let current = true
    void readCorrections({ facilityId, patientId }, encounterId, vital.id, number).then(value => { if (current) setRead({ key, value }) })
    return () => { current = false }
  }, [encounterId, facilityId, key, number, patientId, vital.id])

  if (number === 0) return { state: 'none' }
  return read?.key === key ? read.value : { state: 'loading' }
}

type Reload = () => Promise<{ readonly items: readonly ClinicalRecord[] } | { readonly failed: string }>

/**
 * The design's record page for one vitals record: "Saved record" (the current values: the latest correction's, as
 * today), "Available actions" ("Amend observation": today's correction, with full replacement values; vitals have no
 * other live action, so there is no "More actions" menu), "Connected hospital history" (the visit, then the
 * encounter's records in the other workspaces: ConnectedHistory) and "Preserved versions & amendments" (what each
 * correction replaced).
 */
function VitalRecord({ chart, encounter, vital, reload }: {
  chart: Chart
  encounter: Encounter
  vital: ClinicalRecord
  reload: Reload
}) {
  const href = useWorkspaceHref()
  const location = useLocation()
  const { facilityId, patientId } = chart
  const [success, setSuccess] = useState(() => (location.state as { saved?: unknown } | null)?.saved === true ? RECORD_SAVED : '')
  const [pageError, setPageError] = useState('')
  const [open, setOpen] = useState(false)
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  const actionsId = `vital-${vital.id}-actions`
  const focusActions = useFocusAfterChange(actionsId)
  const corrections = useVitalCorrections(chart, encounter.id, vital)
  const reloads = useLatest(reload)

  const retracted = isRetracted(vital)
  const number = correctionNumber(vital)
  const current = currentValues(vital, corrections)
  const latest = corrections.state === 'shown' ? corrections.latest : null
  // A correction that cannot be read offers no correction (today's rule): nothing is changed from values not seen.
  const canAmend = chart.canWrite && chart.can('ehr.vital.write') && current !== null && !retracted

  const amend = async ({ values, reason }: VitalsInput): Promise<SubmitOutcome> => {
    const expectedRowVersion = rowVersion(vital.rowVersion)
    if (expectedRowVersion === null) return { formError: RELOAD_FIRST }
    // A retry of the same correction reuses its key, so EHR cannot append it twice.
    const signature = JSON.stringify([values, reason])
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    setSuccess('')
    setPageError('')
    try {
      await chart.verify()
      await staffApi.correctVital(facilityId, patientId, encounter.id, vital.id, { expectedRowVersion, changeReason: reason, replacementValues: values }, attempt.current.key)
    } catch (caught) {
      // Changed since it was loaded (corrected, or marked entered in error): what was shown is read again and the
      // form, built for the old version, goes.
      if (isHidApiError(caught) && (caught.status === 412 || caught.code === 'VITAL_NOT_AMENDABLE')) {
        attempt.current = null
        const reloaded = await reloads.current()
        const nowRetracted = caught.code === 'VITAL_NOT_AMENDABLE'
          || ('items' in reloaded && reloaded.items.some(item => item.id === vital.id && item.status === 'entered_in_error'))
        setOpen(false)
        setPageError(`${nowRetracted ? RETRACTED_SINCE : CHANGED_SINCE}${reloadSentence(reloaded, 'vitals', true)}`)
        focusActions()
        return
      }
      return {
        formError: refusalText(caught, CORRECTION_FAILED),
        fieldErrors: refusedFieldErrors(caught, name => {
          const measurement = name.replace(/^replacementValues\./, '')
          return MEASUREMENTS.has(measurement) ? measurement : name === 'changeReason' ? 'reason' : undefined
        }),
      }
    }
    attempt.current = null
    setOpen(false)
    setSuccess(CORRECTION_SAVED)
    focusActions()
    const reloaded = await reloads.current()
    if ('failed' in reloaded) setPageError(`${RELOAD_FAILED} ${reloaded.failed}`.trim())
  }

  const saved: KeyValue[] = [
    { label: 'Visit', value: shortId(encounter.id) },
    { label: 'Complaint', value: encounter.chiefComplaint || NO_COMPLAINT },
    ...(current ? measurementItems(current) : corrections.state === 'failed' ? measurementItems(vital) : []),
    ...(latest ? [{ label: 'Reason', value: latest.reason }, { label: 'Corrected at', value: formatWhen(latest.createdAt) }] : []),
  ]

  return (
    <>
      <RecordHeading title={shortId(vital.id)} backHref={href()} />
      {pageError ? <ErrorBox>{pageError}</ErrorBox> : null}
      <div className="hid-ehr-clinical-status" role="status">{success}</div>
      <DetailMeta
        status={vitalStatus(vital)}
        note={number > 0 ? `Corrected (correction ${number})` : undefined}
        saved={latest?.createdAt ?? recordedAt(vital)}
      />
      {retracted ? <Banner tone="warning" title="Entered in error">{RETRACTED_TEXT}</Banner> : null}
      <DetailGrid>
        <SavedRecord items={saved}>
          {corrections.state === 'loading' ? <p role="status">{LOADING_CORRECTION}</p> : null}
          {corrections.state === 'failed' ? <ErrorBox>{`${CORRECTION_UNREAD} ${corrections.message}`}</ErrorBox> : null}
        </SavedRecord>
        <EhrCard title={<span id={actionsId} className="hid-ehr-clinical-triage-focus" tabIndex={-1}>Available actions</span>}>
          {canAmend ? (
            <ActionList>
              <EhrButton variant="secondary" aria-expanded={open} onClick={() => setOpen(value => !value)}>{AMEND_LABEL}</EhrButton>
            </ActionList>
          ) : <NoActions />}
          {canAmend && open && current ? (
            <VitalsForm
              key={`${vital.id}-${String(vital.rowVersion)}`}
              mode="correct"
              current={current}
              hint={CORRECTION_HINT}
              groupLabel="Corrected vital measurements"
              submitLabel={AMEND_LABEL}
              onSubmit={amend}
            />
          ) : null}
        </EhrCard>
      </DetailGrid>
      <ConnectedHistory chart={chart} encounter={encounter} owner="triage" />
      <VersionsCard versions={versionItems(vital, corrections)} />
    </>
  )
}

/**
 * "Preserved versions & amendments": for each correction, what it replaced (the values first recorded, or the
 * correction before it), under "{when} · {status} · {reason}".
 */
function versionItems(vital: ClinicalRecord, corrections: Corrections): VersionItem[] {
  if (corrections.state !== 'shown') return []
  const status = statusLabel(vitalStatus(vital))
  return corrections.items.map((correction, index) => {
    const before = index === 0 ? null : corrections.items[index - 1]!
    return {
      key: correction.id,
      summary: `${formatWhen(correction.createdAt)} · ${status} · ${correction.reason}`,
      items: [
        { label: 'Version', value: before ? `Corrected (correction ${before.correctionNo})` : 'Originally recorded' },
        ...measurementItems(before ? before.replacementValues : vital),
      ],
    }
  })
}
