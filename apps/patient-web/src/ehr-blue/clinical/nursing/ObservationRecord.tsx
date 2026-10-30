import { EhrButton, EhrCard } from '@hid/ui/ehr'
import { useRef, useState, type ReactNode } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { staffApi, type ClinicalRecord, type Encounter } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { ChartGate, useChart, type Chart } from '../parts/chart'
import { ActionList, DetailGrid, DetailMeta, HistoryCard, SavedRecord, VersionsCard, type HistoryItem, type VersionItem } from '../parts/Detail'
import { shortId, statusLabel } from '../parts/format'
import type { KeyValue } from '../parts/KeyValueList'
import { Banner, ErrorBox, Loading, NO_ACTIONS, RecordHeading, RecordNotFound } from '../parts/Notices'
import { patientLine } from '../parts/PatientHeader'
import { RecordForm, type FieldDef, type FieldErrors, type FormValues, type SubmitOutcome } from '../parts/RecordForm'
import { useWorkspaceHref } from '../parts/Workspace'
import {
  NO_RECORD_ACCESS, REASON_SHORT, RECORD_SAVED, RELOAD_FAILED, field, recordKey, refusedFieldErrors, rowVersion, text, useFocusAfterChange,
  useLatest, useVisitRecord,
} from '../triage/records'
import {
  AMEND_LABEL, CONTENT_EMPTY, DETAILS_LIMIT, LOADING_REVISIONS, NO_CONTENT, RELOAD_NOTE, REVISION_FAILED, REVISION_RECORDED, TITLE,
  composeObservation, isObservation, noteStatus, observationItems, parseObservation, useRevisions, type Revisions,
} from './observations'

/** One nursing observation's page, or the chart's own state. */
export function ObservationRecord() {
  const href = useWorkspaceHref()
  const chart = useChart()
  if (chart && chart.purpose === 'direct-care') return <ObservationLoader chart={chart} />
  return (
    <>
      <RecordHeading title={TITLE} backHref={href()} />
      <ChartGate>{open => <ObservationLoader chart={open} />}</ChartGate>
    </>
  )
}

function ObservationLoader({ chart }: { chart: Chart }) {
  const href = useWorkspaceHref()

  if (!chart.can('ehr.note.read')) {
    return (
      <>
        <RecordHeading title={TITLE} backHref={href()} />
        <ErrorBox>{NO_RECORD_ACCESS}</ErrorBox>
      </>
    )
  }
  return <ObservationReader chart={chart} />
}

/** Reads the record only for a role that may read it. */
function ObservationReader({ chart }: { chart: Chart }) {
  const href = useWorkspaceHref()
  const { recordId = '' } = useParams()
  const { loaded, reload } = useVisitRecord(chart, recordId, 'clinical-notes', isObservation)

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
  return <Observation key={loaded.record.id} chart={chart} encounter={loaded.encounter} note={loaded.record} siblings={loaded.siblings} reload={reload} />
}

const AMEND_FIELDS: readonly FieldDef[] = [
  { key: 'note', label: 'Corrected record', type: 'textarea', required: true, maxLength: DETAILS_LIMIT },
  { key: 'reason', label: 'Reason', type: 'textarea', required: true, maxLength: 500 },
]

/** Today's revision refusals, in place of the design's "Complete this field." for the same fields. */
function amendCheck(values: FormValues): FieldErrors {
  const errors: Record<string, string> = {}
  if (!text(values.note)) errors.note = CONTENT_EMPTY
  if (text(values.reason).length < 3) errors.reason = REASON_SHORT
  return errors
}

type Reload = () => Promise<{ readonly items: readonly ClinicalRecord[] } | { readonly failed: string }>

/**
 * The design's record page for one nursing observation: "Saved record" (the latest revision), "Available actions"
 * ("Amend observation": today's note revision, with a reason), "Connected hospital history" (the visit and its other
 * observations) and "Preserved versions & amendments" (what each revision replaced).
 */
function Observation({ chart, encounter, note, siblings, reload }: {
  chart: Chart
  encounter: Encounter
  note: ClinicalRecord
  siblings: readonly ClinicalRecord[]
  reload: Reload
}) {
  const href = useWorkspaceHref()
  const location = useLocation()
  const { facilityId, patientId } = chart
  const [success, setSuccess] = useState(() => (location.state as { saved?: unknown } | null)?.saved === true ? RECORD_SAVED : '')
  const [pageError, setPageError] = useState('')
  const [open, setOpen] = useState(false)
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  const actionsId = `observation-${note.id}-actions`
  const focusActions = useFocusAfterChange(actionsId)
  const revisions = useRevisions(chart, encounter.id, note)
  const reloads = useLatest(reload)
  const latest = revisions.state === 'shown' ? revisions.items.at(-1) ?? null : null
  // Nothing is amended unseen: the content must have been read (today's rule).
  const canAmend = chart.canWrite && chart.can('ehr.note.write') && note.status !== 'entered_in_error' && revisions.state === 'shown'

  const amend = async (values: FormValues): Promise<SubmitOutcome> => {
    const expectedRowVersion = rowVersion(note.rowVersion)
    if (expectedRowVersion === null) return { formError: RELOAD_NOTE }
    const content = composeObservation(text(values.note), parseObservation(latest?.content ?? '').units)
    const changeReason = text(values.reason)
    // A retry of the same revision reuses its key, so EHR cannot record it twice.
    const signature = JSON.stringify([expectedRowVersion, content, changeReason])
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    setSuccess('')
    setPageError('')
    try {
      await chart.verify()
      await staffApi.addNoteRevision(facilityId, patientId, encounter.id, note.id, { expectedRowVersion, changeReason, content }, attempt.current.key)
    } catch (caught) {
      return {
        formError: refusalText(caught, REVISION_FAILED),
        fieldErrors: refusedFieldErrors(caught, name => name === 'content' ? 'note' : name === 'changeReason' ? 'reason' : undefined),
      }
    }
    attempt.current = null
    setOpen(false)
    setSuccess(REVISION_RECORDED)
    focusActions()
    const reloaded = await reloads.current()
    if ('failed' in reloaded) setPageError(`${RELOAD_FAILED} ${reloaded.failed}`.trim())
  }

  const saved: KeyValue[] = [
    { label: 'Visit', value: shortId(encounter.id) },
    { label: 'Category', value: field(note, 'title') },
    ...contentItems(revisions, latest?.content ?? null),
  ]

  return (
    <>
      <RecordHeading title={shortId(note.id)} backHref={href()} />
      {chart.writeNotice ? <Banner tone="warning" title="Changes are unavailable">{chart.writeNotice}</Banner> : null}
      {pageError ? <ErrorBox>{pageError}</ErrorBox> : null}
      <div className="hid-ehr-clinical-status" role="status">{success}</div>
      <DetailMeta status={noteStatus(note)} patient={patientLine(chart.facts)} saved={field(note, 'updatedAt') || note.createdAt} />
      <DetailGrid>
        <SavedRecord items={saved}>
          {revisions.state === 'failed' ? <ErrorBox>{revisions.message}</ErrorBox> : null}
        </SavedRecord>
        <EhrCard title={<span id={actionsId} className="hid-ehr-clinical-nursing-focus" tabIndex={-1}>Available actions</span>}>
          {canAmend ? (
            <ActionList>
              <EhrButton variant="secondary" aria-expanded={open} onClick={() => setOpen(value => !value)}>{AMEND_LABEL}</EhrButton>
            </ActionList>
          ) : <p>{NO_ACTIONS}</p>}
          {canAmend && open ? (
            <RecordForm key={`${note.id}-${String(note.rowVersion)}`} fields={AMEND_FIELDS} submitLabel={AMEND_LABEL} validate={amendCheck} onSubmit={amend} />
          ) : null}
        </EhrCard>
      </DetailGrid>
      <HistoryCard items={historyItems(chart, href, encounter, siblings)} />
      <VersionsCard versions={versionItems(note, revisions)} />
    </>
  )
}

/** The note's details and units, or why they are not shown (today's texts). */
function contentItems(revisions: Revisions, content: string | null): KeyValue[] {
  const note = (value: ReactNode): KeyValue[] => [{ label: 'Note', value }]
  if (revisions.state === 'loading') return note(<span role="status">{LOADING_REVISIONS}</span>)
  if (revisions.state === 'failed') return []
  if (!content) return note(NO_CONTENT)
  return observationItems(content)
}

/** "Connected hospital history": the visit (in Consultation) and its other nursing observations. */
function historyItems(chart: Chart, href: ReturnType<typeof useWorkspaceHref>, encounter: Encounter, siblings: readonly ClinicalRecord[]): HistoryItem[] {
  return [
    {
      key: `encounter-${encounter.id}`,
      label: `Consultation · ${shortId(encounter.id)}`,
      href: chart.can('ehr.encounter.read') ? href.to('consult', encounter.id) : undefined,
      status: encounter.status,
    },
    ...siblings.map(record => ({
      key: `observation-${record.id}`,
      label: `${TITLE} · ${shortId(record.id)}`,
      href: href(recordKey(encounter.id, record.id)),
      status: noteStatus(record),
    })),
  ]
}

/**
 * "Preserved versions & amendments": for each revision after the first, what it replaced, under
 * "{when} · {status} · {reason}".
 */
function versionItems(note: ClinicalRecord, revisions: Revisions): VersionItem[] {
  if (revisions.state !== 'shown') return []
  const status = statusLabel(noteStatus(note))
  return revisions.items.slice(1).map((revision, index) => {
    const before = revisions.items[index]!
    return {
      key: revision.id,
      summary: `${revision.createdAt} · ${status} · ${revision.changeReason}`,
      items: [{ label: 'Version', value: `Revision ${before.revisionNo}` }, ...observationItems(before.content)],
    }
  })
}
