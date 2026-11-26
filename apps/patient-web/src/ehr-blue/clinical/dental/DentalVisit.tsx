import { EhrBadge, EhrButton, EhrCard, EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import { isHidApiError } from '@hid/http'
import { useCallback, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  dentalApi, staffApi, type DentalChart, type DentalChartRead, type DentalDentition, type DentalFinding, type DentalLists,
  type DentalProcedure, type DentalVisitRecord,
} from '../../../staff/api'
import { DocumentsCard } from '../consult/Documents'
import { useDocumentList } from '../consult/records'
import { ChartGate, type Chart } from '../parts/chart'
import { ActionList, SubHeading } from '../parts/Detail'
import { statusWords } from '../parts/format'
import { Banner, ErrorBox, Loading, RecordHeading } from '../parts/Notices'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'
import {
  CHART_NOTE_MAX, DENTAL_WRITE, DENTITIONS, DENTITION_WORDS, DRAFT_LIST, FINDINGS_MAX, FOLLOW_UP_NOTE_MAX, NOT_ON_LIST,
  STAGE_HINTS, UUID, VISIT_CLOSED, anaestheticText, dayText, findingsOutside, followUpProblem, followUpWindow, lagosDateTime,
  learnFrom, memberText, procedureStatusText, procedureStatusTone, reloadsAfter, siteText, stageText, stageTone, textOrNull,
  textProblem, visitOpen,
} from './dentalRules'
import { DentalSummaryPaper, useDentalPrint } from './DentalPrint'
import { useDentalRead, useIdempotencyKeys, useStaffNames, type IdempotencyKeys } from './hooks'
import { AddProcedureForm, DoneForm, ReasonForm } from './ProcedureForms'
import { dentalFailure, startDentalRecord } from './startVisit'
import { FindingsList, ToothChart, ToothPanel, type ConditionText } from './ToothChart'

/*
 * One visit's dental record (DEN-1 routes 1-4 and 6-14) for the patient open in the chart: the visit and its stage, the
 * tooth chart (a new numbered version on each save, based on the newest), the treatment plan and the procedures done at
 * this visit, the follow-up, X-ray images (the visit's documents, until Radiology ships) and the printed summary. The
 * address carries the visit's UUID only. Every write sends the version it read (412 or 409 when someone else changed it
 * first, and the record is read again) and an Idempotency-Key kept per request body, and checks the patient's access first.
 */

const TITLE = 'Dental visit'
const NOT_FOUND = 'This visit was not found for the open patient at this facility.'

export function DentalVisitPage() {
  const href = useWorkspaceHref()
  const { encounterId = '' } = useParams()
  return (
    <ChartGate>
      {chart => UUID.test(encounterId)
        ? <VisitLoader key={`${chart.patientId}:${encounterId}`} chart={chart} encounterId={encounterId} />
        : <><RecordHeading title={TITLE} backHref={href()} /><ErrorBox>{NOT_FOUND}</ErrorBox></>}
    </ChartGate>
  )
}

type Written = { readonly text: string; readonly tone: 'success' | 'error' }

function VisitLoader({ chart, encounterId }: { readonly chart: Chart; readonly encounterId: string }) {
  const href = useWorkspaceHref()
  const { facilityId, patientId } = chart
  const keyFor = useIdempotencyKeys()
  const readLists = useCallback(() => dentalApi.lists(facilityId), [facilityId])
  const readRecord = useCallback(async () => {
    await chart.verify()
    return dentalApi.visit(facilityId, patientId, encounterId)
  }, [chart, facilityId, patientId, encounterId])
  const lists = useDentalRead(`lists:${facilityId}`, readLists)
  const record = useDentalRead(`visit:${facilityId}:${patientId}:${encounterId}`, readRecord)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')

  const mayWrite = chart.canWrite && chart.can(DENTAL_WRITE)

  if (record.state.phase === 'loading' || lists.state.phase === 'loading') return <Loading label="Loading the dental visit…" />
  if (record.state.phase === 'failed') {
    const caught = record.state.caught
    const notStarted = isHidApiError(caught) && caught.code === 'DENTAL_VISIT_NOT_FOUND'
    const start = async () => {
      setStarting(true)
      setStartError('')
      const result = await startDentalRecord(chart, encounterId, keyFor)
      setStarting(false)
      if ('refused' in result) setStartError(result.refused)
      else await record.reload()
    }
    return (
      <>
        <RecordHeading title={TITLE} backHref={href()} />
        {notStarted ? (
          <EhrCard title="No dental record on this visit yet">
            <p>Start the dental record to chart the teeth and record procedures on this outpatient visit.</p>
            {startError ? <ErrorBox>{startError}</ErrorBox> : null}
            {mayWrite ? <ActionList><EhrButton busy={starting} onClick={start}>Start dental record</EhrButton></ActionList> : null}
          </EhrCard>
        ) : (
          <ErrorBox>
            <p>{dentalFailure(caught, 'This dental visit could not be loaded.')}</p>
            <p><EhrButton variant="secondary" size="sm" onClick={() => record.reload()}>Try again</EhrButton></p>
          </ErrorBox>
        )}
      </>
    )
  }
  if (lists.state.phase === 'failed') {
    return (
      <>
        <RecordHeading title={TITLE} backHref={href()} />
        <ErrorBox>
          <p>{dentalFailure(lists.state.caught, 'The dental lists could not be loaded.')}</p>
          <p><EhrButton variant="secondary" size="sm" onClick={() => lists.reload()}>Try again</EhrButton></p>
        </ErrorBox>
      </>
    )
  }
  return (
    <VisitRecord chart={chart} encounterId={encounterId} lists={lists.state.value} record={record.state.value}
      reload={record.reload} keyFor={keyFor} mayWrite={mayWrite} />
  )
}

function VisitRecord({ chart, encounterId, lists, record, reload, keyFor, mayWrite }: {
  readonly chart: Chart
  readonly encounterId: string
  readonly lists: DentalLists
  readonly record: DentalVisitRecord
  readonly reload: () => Promise<void>
  readonly keyFor: IdempotencyKeys
  readonly mayWrite: boolean
}) {
  const href = useWorkspaceHref()
  const { facility } = useClinical()
  const own = facility?.membershipId
  const { facilityId, patientId } = chart
  const { visit } = record
  const open = visitOpen(visit.encounterStatus)
  const [written, setWritten] = useState<Written | null>(null)
  const [printing, setPrinting] = useState(false)
  const printer = useDentalPrint()
  const drafts = [lists.toothConditions, lists.procedures, lists.anaesthetics, lists.techniques].some(list => list.status === 'draft')
  const ids = [visit.startedByMembershipId, record.chart?.recordedByMembershipId,
    ...record.plannedProcedures.map(item => item.plannedByMembershipId), ...record.doneThisVisit.map(item => item.performedByMembershipId)]
  const names = useStaffNames(facilityId, ids)
  const who = (membershipId: string | null | undefined) => memberText(membershipId, own, names)
  const conditionText: ConditionText = code => lists.toothConditions.items.find(item => item.code === code)?.label ?? 'A condition no longer on the list'

  /** After a write: says it, then reads the record again. A refusal that means the screen is out of date reads it too. */
  const done = useCallback(async (text: string) => {
    setWritten({ text, tone: 'success' })
    await reload()
  }, [reload])
  const refused = useCallback((caught: unknown, fallback: string): string => {
    learnFrom(caught)
    const text = dentalFailure(caught, fallback)
    if (reloadsAfter(caught)) void reload()
    return text
  }, [reload])

  async function printSummary() {
    if (printing) return
    setPrinting(true)
    setWritten(null)
    const job = printer.start()
    try {
      await chart.verify()
      const summary = await dentalApi.summary(facilityId, patientId, encounterId)
      const performers = [...new Set(summary.doneThisVisit.map(item => item.performedByMembershipId).filter((id): id is string => Boolean(id)))]
      const named = new Map<string, string | null>()
      if (performers.length > 0) {
        try {
          const answer = await staffApi.facilityStaffNames(facilityId, performers.slice(0, 100))
          for (const member of answer.staff) named.set(member.membershipId.toLowerCase(), member.name)
        } catch { /* left unnamed */ }
      }
      printer.print(<DentalSummaryPaper summary={summary} conditionText={conditionText}
        names={id => (id ? named.get(id.toLowerCase()) : null) ?? 'a dentist here'} />, job)
    } catch (caught) {
      job.cancel()
      setWritten({ text: refused(caught, 'The summary could not be printed. Try again.'), tone: 'error' })
    } finally {
      setPrinting(false)
    }
  }

  return (
    <>
      <RecordHeading title={TITLE} backHref={href()} />
      <div className="hid-ehr-clinical-status" role="status">{written?.tone === 'success' ? written.text : ''}</div>
      {written?.tone === 'error' ? <ErrorBox>{written.text}</ErrorBox> : null}
      <EhrCard title="This visit" actions={<EhrBadge tone={stageTone(visit.stage)}>{stageText(visit.stage)}</EhrBadge>}>
        <dl className="hid-ehr-dental-facts">
          <div><dt>Visit started</dt><dd>{lagosDateTime(visit.encounterStartedAt)}</dd></div>
          <div><dt>Visit</dt><dd>{statusWords(visit.encounterStatus)}</dd></div>
          <div><dt>Dental record started</dt><dd>{lagosDateTime(visit.startedAt)} by {who(visit.startedByMembershipId)}</dd></div>
          <div><dt>Stage</dt><dd>{STAGE_HINTS[visit.stage] ?? ''}</dd></div>
        </dl>
        <ActionList>
          <Link className="hid-ehr-clinical-link" to={href.to('consult', encounterId)}>Notes, diagnoses and prescriptions in Consultation</Link>
          <EhrButton variant="secondary" busy={printing} onClick={printSummary}>Print dental visit summary</EhrButton>
        </ActionList>
      </EhrCard>
      {drafts ? (
        <Banner tone="warning" title={DRAFT_LIST}>
          The tooth conditions, procedures and anaesthetics are drafts until the clinical lead signs them.
        </Banner>
      ) : null}
      {!open ? (
        <Banner title="This visit is finished">
          {`${VISIT_CLOSED} You can still set the follow-up and correct a mistake.`}
        </Banner>
      ) : null}
      <ChartCard chart={chart} encounterId={encounterId} lists={lists} newest={record.chart} conditionText={conditionText}
        editable={mayWrite && open} correctable={mayWrite} keyFor={keyFor} who={who} onDone={done} onRefused={refused} />
      <ProceduresCard chart={chart} encounterId={encounterId} lists={lists} record={record} own={own}
        writable={mayWrite && open} correctable={mayWrite} keyFor={keyFor} who={who} onDone={done} onRefused={refused} />
      <FollowUpCard key={visit.rowVersion} chart={chart} encounterId={encounterId} record={record} writable={mayWrite} keyFor={keyFor}
        onDone={done} onRefused={refused} />
      <XRays chart={chart} encounterId={encounterId} photos={lists.photosAvailable} writable={chart.canWrite && chart.can('ehr.document.write') && open}
        readable={chart.can('ehr.document.read')} />
      {printer.area}
    </>
  )
}

interface WriteProps {
  readonly chart: Chart
  readonly encounterId: string
  readonly keyFor: IdempotencyKeys
  readonly onDone: (text: string) => Promise<void>
  readonly onRefused: (caught: unknown, fallback: string) => string
}

// ---- The tooth chart ------------------------------------------------------------------------

type Draft = { readonly dentition: DentalDentition; readonly findings: readonly DentalFinding[]; readonly note: string }

function ChartCard({ chart, encounterId, lists, newest, conditionText, editable, correctable, keyFor, who, onDone, onRefused }: WriteProps & {
  readonly lists: DentalLists
  readonly newest: DentalChart | null
  readonly conditionText: ConditionText
  readonly editable: boolean
  readonly correctable: boolean
  readonly who: (membershipId: string | null | undefined) => string
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showVersions, setShowVersions] = useState(false)

  function begin() {
    setDraft({ dentition: newest?.dentition ?? 'permanent', findings: newest?.findings ?? [], note: newest?.note ?? '' })
    setSelected(null)
    setError('')
  }

  async function save() {
    if (!draft || saving) return
    const outside = findingsOutside(draft.findings, draft.dentition)
    if (outside.length > 0) {
      setError(`Teeth ${[...new Set(outside.map(finding => finding.tooth))].join(', ')} are not in this chart. Remove their findings, or choose another chart.`)
      return
    }
    if (draft.findings.length > FINDINGS_MAX) return setError(`A chart can hold up to ${FINDINGS_MAX} findings.`)
    const noteProblem = textProblem(draft.note, CHART_NOTE_MAX)
    if (noteProblem) return setError(`Chart note: ${noteProblem}`)
    const input = { basedOnVersionId: newest?.versionId ?? null, dentition: draft.dentition, findings: [...draft.findings], note: textOrNull(draft.note) }
    setSaving(true)
    setError('')
    try {
      await chart.verify()
      const answer = await dentalApi.saveChart(chart.facilityId, chart.patientId, encounterId, input, keyFor('chart', { encounterId, ...input }))
      learnFrom()
      setDraft(null)
      await onDone(`Chart saved as version ${answer.chart.versionNo}.`)
    } catch (caught) {
      const text = onRefused(caught, 'The chart was not saved. Try again.')
      // Someone else's chart came first: start again from it, never over it.
      if (isHidApiError(caught) && caught.code === 'DENTAL_CHART_CHANGED') setDraft(null)
      setError(text)
    } finally {
      setSaving(false)
    }
  }

  const listDraft = newest?.listStatus === 'draft' || lists.toothConditions.status === 'draft'
  return (
    <EhrCard title="Tooth chart" actions={listDraft ? <EhrBadge tone="caution">Draft list</EhrBadge> : undefined}>
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      {draft ? (
        <div className="hid-ehr-dental-editor">
          <EhrField label="Chart">
            <EhrSelect value={draft.dentition} onChange={event => setDraft({ ...draft, dentition: event.target.value as DentalDentition })}>
              {DENTITIONS.map(value => <option key={value} value={value}>{DENTITION_WORDS[value]}</option>)}
            </EhrSelect>
          </EhrField>
          <p className="hid-ehr-clinical-note">Select a tooth to add or remove its findings. A tooth with no finding is present and sound.</p>
          <ToothChart dentition={draft.dentition} findings={draft.findings} conditionText={conditionText} selected={selected}
            onSelect={tooth => setSelected(current => current === tooth ? null : tooth)} caption="Tooth chart being updated" />
          {selected !== null ? (
            <ToothPanel key={selected} tooth={selected} findings={draft.findings} conditions={lists.toothConditions.items}
              conditionText={conditionText}
              onAdd={finding => setDraft({ ...draft, findings: [...draft.findings, finding] })}
              onRemove={finding => setDraft({ ...draft, findings: draft.findings.filter(item => item !== finding) })} />
          ) : null}
          <SubHeading>All findings</SubHeading>
          <FindingsList findings={draft.findings} conditionText={conditionText}
            onRemove={finding => setDraft({ ...draft, findings: draft.findings.filter(item => item !== finding) })} />
          <EhrField label="Chart note (optional)" hint="For example: generalised plaque, gingivitis lower front teeth.">
            <EhrTextarea value={draft.note} rows={3} maxLength={CHART_NOTE_MAX + 50} onChange={event => setDraft({ ...draft, note: event.target.value })} />
          </EhrField>
          <div className="hid-ehr-clinical-form-footer">
            <EhrButton busy={saving} onClick={save}>Save chart</EhrButton>
            <EhrButton variant="quiet" disabled={saving} onClick={() => { setDraft(null); setError('') }}>Cancel</EhrButton>
          </div>
        </div>
      ) : newest ? (
        <>
          <p className="hid-ehr-clinical-note">
            Version {newest.versionNo} · {DENTITION_WORDS[newest.dentition]} · recorded {lagosDateTime(newest.recordedAt)} by {who(newest.recordedByMembershipId)}
            {newest.encounterId !== encounterId ? ' at an earlier visit' : ''}
          </p>
          <ToothChart dentition={newest.dentition} findings={newest.findings} conditionText={conditionText} caption={`Tooth chart, version ${newest.versionNo}`} />
          <FindingsList findings={newest.findings} conditionText={conditionText} />
          {newest.note ? <p className="hid-ehr-dental-note">{newest.note}</p> : null}
        </>
      ) : <p>No tooth chart recorded at this facility yet.</p>}
      {!draft ? (
        <ActionList>
          {editable ? <EhrButton onClick={begin}>{newest ? 'Update chart' : 'Record chart'}</EhrButton> : null}
          <EhrButton variant="secondary" aria-expanded={showVersions} onClick={() => setShowVersions(value => !value)}>
            {showVersions ? 'Hide earlier versions' : 'Earlier versions'}
          </EhrButton>
        </ActionList>
      ) : null}
      {showVersions && !draft ? (
        <ChartVersions chart={chart} encounterId={encounterId} conditionText={conditionText} newestId={newest?.versionId ?? null}
          correctable={correctable} keyFor={keyFor} who={who} onDone={onDone} onRefused={onRefused} />
      ) : null}
    </EhrCard>
  )
}

/** Route 6's versions, newest first: each opens read only; the newest can be marked entered in error (route 8). */
function ChartVersions({ chart, encounterId, conditionText, newestId, correctable, keyFor, who, onDone, onRefused }: WriteProps & {
  readonly conditionText: ConditionText
  readonly newestId: string | null
  readonly correctable: boolean
  readonly who: (membershipId: string | null | undefined) => string
}) {
  const { facilityId, patientId } = chart
  const read = useCallback(() => dentalApi.chart(facilityId, patientId), [facilityId, patientId])
  const versions = useDentalRead<DentalChartRead>(`versions:${facilityId}:${patientId}:${newestId ?? ''}`, read)
  const [viewing, setViewing] = useState<{ id: string; chart: DentalChart | null; error: string } | null>(null)
  const [marking, setMarking] = useState(false)

  async function view(versionId: string) {
    setViewing({ id: versionId, chart: null, error: '' })
    try {
      const answer = await dentalApi.chart(facilityId, patientId, versionId)
      setViewing({ id: versionId, chart: answer.chart, error: '' })
    } catch (caught) {
      setViewing({ id: versionId, chart: null, error: onRefused(caught, 'This version could not be loaded.') })
    }
  }

  async function mark(reason: string): Promise<string> {
    if (!newestId) return ''
    try {
      await chart.verify()
      await dentalApi.chartEnteredInError(facilityId, patientId, newestId, reason, keyFor('chart-error', { newestId, reason }))
      learnFrom()
      setMarking(false)
      await onDone('Chart version marked entered in error. The one before it is the newest again.')
      return ''
    } catch (caught) {
      return onRefused(caught, 'The chart was not marked. Try again.')
    }
  }

  if (versions.state.phase === 'loading') return <Loading label="Loading chart versions…" />
  if (versions.state.phase === 'failed') return <ErrorBox>{dentalFailure(versions.state.caught, 'Chart versions could not be loaded.')}</ErrorBox>
  const items = versions.state.value.versions
  return (
    <section className="hid-ehr-dental-versions" aria-label="Chart versions">
      <SubHeading>Chart versions</SubHeading>
      {items.length === 0 ? <p className="hid-ehr-clinical-note">No versions yet.</p> : (
        <ul className="hid-ehr-clinical-history-list">
          {items.map(item => (
            <li key={item.versionId} className="hid-ehr-clinical-history-row">
              <span>
                <strong>Version {item.versionNo}</strong>
                <span className="hid-ehr-clinical-cell-sub">
                  {[lagosDateTime(item.recordedAt), who(item.recordedByMembershipId), item.encounterId === encounterId ? 'this visit' : '']
                    .filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="hid-ehr-clinical-row-actions">
                {item.enteredInError ? <EhrBadge tone="critical">Entered in error</EhrBadge> : null}
                <EhrButton variant="quiet" size="sm" onClick={() => view(item.versionId)}>View version {item.versionNo}</EhrButton>
                {correctable && item.versionId === newestId && !item.enteredInError ? (
                  <EhrButton variant="quiet" size="sm" aria-expanded={marking} onClick={() => setMarking(value => !value)}>Mark entered in error</EhrButton>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {marking ? (
        <ReasonForm label="Why is this chart version wrong?" submit="Mark entered in error" danger onSubmit={mark} onClose={() => setMarking(false)}
          hint="At least 8 characters. The version stays readable, marked as entered in error, and the one before it is the newest again." />
      ) : null}
      {viewing ? (
        <div className="hid-ehr-dental-version-view">
          {viewing.error ? <ErrorBox>{viewing.error}</ErrorBox> : viewing.chart ? (
            <>
              <SubHeading>Version {viewing.chart.versionNo}, {DENTITION_WORDS[viewing.chart.dentition]}</SubHeading>
              {viewing.chart.enteredInError ? (
                <p className="hid-ehr-clinical-note">
                  Entered in error {lagosDateTime(viewing.chart.enteredInError.at)} by {who(viewing.chart.enteredInError.byMembershipId)}: {viewing.chart.enteredInError.reason}
                </p>
              ) : null}
              <ToothChart dentition={viewing.chart.dentition} findings={viewing.chart.findings} conditionText={conditionText}
                caption={`Tooth chart, version ${viewing.chart.versionNo}`} />
              <FindingsList findings={viewing.chart.findings} conditionText={conditionText} />
              {viewing.chart.note ? <p className="hid-ehr-dental-note">{viewing.chart.note}</p> : null}
            </>
          ) : <Loading label="Loading the version…" />}
          <EhrButton variant="quiet" size="sm" onClick={() => setViewing(null)}>Close version</EhrButton>
        </div>
      ) : null}
    </section>
  )
}

// ---- Procedures ---------------------------------------------------------------------------------

type Open = { readonly kind: 'add' } | { readonly kind: 'done' | 'cancel' | 'error'; readonly procedureId: string } | null

function ProceduresCard({ chart, encounterId, lists, record, own, writable, correctable, keyFor, who, onDone, onRefused }: WriteProps & {
  readonly lists: DentalLists
  readonly record: DentalVisitRecord
  readonly own: string | undefined
  readonly writable: boolean
  readonly correctable: boolean
  readonly who: (membershipId: string | null | undefined) => string
}) {
  const { facilityId, patientId } = chart
  const [open, setOpen] = useState<Open>(null)
  const [history, setHistory] = useState(false)
  const dentition = record.chart?.dentition ?? 'permanent'
  const signedByMe = (procedure: DentalProcedure) => Boolean(own && procedure.performedByMembershipId?.toLowerCase() === own.toLowerCase())

  async function write(send: () => Promise<unknown>, said: string, fallback: string): Promise<string> {
    try {
      await chart.verify()
      await send()
      learnFrom()
      setOpen(null)
      await onDone(said)
      return ''
    } catch (caught) {
      return onRefused(caught, fallback)
    }
  }

  return (
    <EhrCard title="Treatment" actions={writable && open?.kind !== 'add'
      ? <EhrButton variant="secondary" size="sm" onClick={() => setOpen({ kind: 'add' })}>Add a procedure</EhrButton> : undefined}>
      {open?.kind === 'add' ? (
        <AddProcedureForm lists={lists} dentition={dentition} visitStartedAt={record.visit.encounterStartedAt} onClose={() => setOpen(null)}
          onSubmit={input => write(() => dentalApi.recordProcedure(facilityId, patientId, encounterId, input,
            keyFor('procedure', { encounterId, ...input })),
          input.status === 'done' ? 'Procedure recorded as done and signed.' : 'Procedure added to the treatment plan.',
          'The procedure was not saved. Try again.')} />
      ) : null}
      <SubHeading>Treatment plan</SubHeading>
      {record.plannedProcedures.length === 0 ? <p className="hid-ehr-clinical-note">Nothing planned.</p> : (
        <ul className="hid-ehr-clinical-history-list">
          {record.plannedProcedures.map(procedure => (
            <li key={procedure.procedureId} className="hid-ehr-dental-procedure">
              <ProcedureLine procedure={procedure} who={who} />
              <ActionList>
                {writable ? <EhrButton variant="secondary" size="sm" aria-expanded={open?.kind === 'done' && open.procedureId === procedure.procedureId}
                  onClick={() => setOpen({ kind: 'done', procedureId: procedure.procedureId })}>Record as done</EhrButton> : null}
                {correctable ? <EhrButton variant="quiet" size="sm" aria-expanded={open?.kind === 'cancel' && open.procedureId === procedure.procedureId}
                  onClick={() => setOpen({ kind: 'cancel', procedureId: procedure.procedureId })}>Cancel procedure</EhrButton> : null}
              </ActionList>
              {open?.kind === 'done' && open.procedureId === procedure.procedureId ? (
                <DoneForm procedure={procedure} lists={lists} visitStartedAt={record.visit.encounterStartedAt} onClose={() => setOpen(null)}
                  onSubmit={input => {
                    const body = { expectedRowVersion: procedure.rowVersion, ...input }
                    return write(() => dentalApi.procedureDone(facilityId, patientId, encounterId, procedure.procedureId, body,
                      keyFor('done', { procedureId: procedure.procedureId, encounterId, ...body })),
                    'Procedure recorded as done and signed.', 'The procedure was not recorded. Try again.')
                  }} />
              ) : null}
              {open?.kind === 'cancel' && open.procedureId === procedure.procedureId ? (
                <ReasonForm label="Why is it cancelled?" submit="Cancel procedure" onClose={() => setOpen(null)}
                  onSubmit={reason => write(() => dentalApi.cancelProcedure(facilityId, patientId, procedure, reason,
                    keyFor('cancel', { procedureId: procedure.procedureId, rowVersion: procedure.rowVersion, reason })),
                  'Procedure cancelled.', 'The procedure was not cancelled. Try again.')} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <SubHeading>Done at this visit</SubHeading>
      {record.doneThisVisit.length === 0 ? <p className="hid-ehr-clinical-note">No procedure done at this visit yet.</p> : (
        <ul className="hid-ehr-clinical-history-list">
          {record.doneThisVisit.map(procedure => (
            <li key={procedure.procedureId} className="hid-ehr-dental-procedure">
              <ProcedureLine procedure={procedure} who={who} />
              {correctable && signedByMe(procedure) && procedure.status === 'done' ? (
                <ActionList>
                  <EhrButton variant="quiet" size="sm" aria-expanded={open?.kind === 'error' && open.procedureId === procedure.procedureId}
                    onClick={() => setOpen({ kind: 'error', procedureId: procedure.procedureId })}>Mark entered in error</EhrButton>
                </ActionList>
              ) : null}
              {open?.kind === 'error' && open.procedureId === procedure.procedureId ? (
                <ReasonForm label="Why is this record wrong?" submit="Mark entered in error" danger onClose={() => setOpen(null)}
                  hint="At least 8 characters. The record stays readable, marked as entered in error."
                  onSubmit={reason => write(() => dentalApi.procedureEnteredInError(facilityId, patientId, procedure, reason,
                    keyFor('procedure-error', { procedureId: procedure.procedureId, rowVersion: procedure.rowVersion, reason })),
                  'Procedure marked entered in error.', 'The procedure was not marked. Try again.')} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ActionList>
        <EhrButton variant="quiet" aria-expanded={history} onClick={() => setHistory(value => !value)}>
          {history ? 'Hide all dental procedures' : 'All dental procedures at this facility'}
        </EhrButton>
      </ActionList>
      {history ? <ProcedureHistory chart={chart} who={who} /> : null}
    </EhrCard>
  )
}

function ProcedureLine({ procedure, who }: { readonly procedure: DentalProcedure; readonly who: (membershipId: string | null | undefined) => string }) {
  const when = procedure.status === 'done' || procedure.status === 'entered_in_error'
    ? [procedure.doneAt ? `Done ${lagosDateTime(procedure.doneAt)}` : '', procedure.signedAt ? `signed by ${who(procedure.performedByMembershipId)}` : '']
    : procedure.plannedAt ? [`Planned ${lagosDateTime(procedure.plannedAt)} by ${who(procedure.plannedByMembershipId)}`] : []
  const mark = procedure.enteredInError ?? procedure.cancelled
  return (
    <div className="hid-ehr-dental-procedure-line">
      <span>
        <strong>{procedure.procedureName}</strong>{' '}
        {procedure.byName ? <EhrBadge tone="neutral">{NOT_ON_LIST}</EhrBadge> : null}{' '}
        <EhrBadge tone={procedureStatusTone(procedure.status)}>{procedureStatusText(procedure.status)}</EhrBadge>
      </span>
      <span className="hid-ehr-clinical-cell-sub">{siteText(procedure)}</span>
      {procedure.anaesthetic ? <span className="hid-ehr-clinical-cell-sub">Local anaesthetic: {anaestheticText(procedure.anaesthetic)}</span> : null}
      {when.filter(Boolean).length > 0 ? <span className="hid-ehr-clinical-cell-sub">{when.filter(Boolean).join(', ')}</span> : null}
      {procedure.notes ? <span className="hid-ehr-clinical-cell-sub">{procedure.notes}</span> : null}
      {mark ? <span className="hid-ehr-clinical-cell-sub">{procedure.status === 'cancelled' ? 'Cancelled' : 'Marked entered in error'} {lagosDateTime(mark.at)} by {who(mark.byMembershipId)}: {mark.reason}</span> : null}
    </div>
  )
}

/** Route 13: every dental procedure of the patient at this facility, newest first, cancelled and entered in error included. */
function ProcedureHistory({ chart, who }: { readonly chart: Chart; readonly who: (membershipId: string | null | undefined) => string }) {
  const { facilityId, patientId } = chart
  const read = useCallback(() => dentalApi.procedures(facilityId, patientId, 'all'), [facilityId, patientId])
  const list = useDentalRead(`procedures:${facilityId}:${patientId}`, read)
  if (list.state.phase === 'loading') return <Loading label="Loading dental procedures…" />
  if (list.state.phase === 'failed') return <ErrorBox>{dentalFailure(list.state.caught, 'Dental procedures could not be loaded.')}</ErrorBox>
  const { items, hasMore, limit } = list.state.value
  return (
    <section aria-label="All dental procedures at this facility">
      {items.length === 0 ? <p className="hid-ehr-clinical-note">No dental procedures recorded at this facility.</p> : (
        <ul className="hid-ehr-clinical-history-list">
          {items.map(procedure => <li key={procedure.procedureId} className="hid-ehr-dental-procedure"><ProcedureLine procedure={procedure} who={who} /></li>)}
        </ul>
      )}
      {hasMore ? <p className="hid-ehr-clinical-note">Only the newest {limit} are shown.</p> : null}
    </section>
  )
}

// ---- Follow-up -----------------------------------------------------------------------------------

function FollowUpCard({ chart, encounterId, record, writable, keyFor, onDone, onRefused }: WriteProps & {
  readonly record: DentalVisitRecord
  readonly writable: boolean
}) {
  const { visit } = record
  const [day, setDay] = useState(visit.followUpOn ?? '')
  const [note, setNote] = useState(visit.followUpNote ?? '')
  const [problems, setProblems] = useState<{ day?: string; note?: string }>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const range = followUpWindow()

  async function send(followUpOn: string | null, followUpNote: string | null, said: string) {
    const body = { expectedRowVersion: visit.rowVersion, followUpOn, followUpNote }
    setBusy(true)
    setError('')
    try {
      await chart.verify()
      await dentalApi.followUp(chart.facilityId, chart.patientId, encounterId, body, keyFor('follow-up', { encounterId, ...body }))
      learnFrom()
      await onDone(said)
    } catch (caught) {
      setError(onRefused(caught, 'The follow-up was not saved. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const found = { day: followUpProblem(day) || undefined, note: textProblem(note, FOLLOW_UP_NOTE_MAX) || undefined }
    setProblems(found)
    if (found.day || found.note) return
    if (!day && !note.trim()) {
      setProblems({ day: 'Choose a date or write a recall note.' })
      return
    }
    await send(day || null, textOrNull(note), 'Follow-up saved.')
  }

  const set = visit.followUpOn !== null || visit.followUpNote !== null
  return (
    <EhrCard title="Follow-up">
      {set ? (
        <p>
          {visit.followUpOn ? <>Come back on <strong>{dayText(visit.followUpOn)}</strong>. </> : null}
          {visit.followUpNote ?? ''}
        </p>
      ) : <p className="hid-ehr-clinical-note">No follow-up set. The date and note are printed on the visit summary; no reminder is sent.</p>}
      {writable ? (
        <form className="hid-ehr-clinical-form" noValidate onSubmit={event => void save(event)} aria-label="Follow-up">
          <div className="hid-ehr-clinical-form-row">
            <EhrField label="Follow-up date" hint={day && !problems.day ? `Come back on ${dayText(day)}.` : 'From tomorrow to two years ahead.'}
              error={problems.day}>
              <EhrInput type="date" min={range.min} max={range.max} value={day} onChange={event => { setDay(event.target.value); setProblems({}) }} />
            </EhrField>
          </div>
          <EhrField label="Recall note (optional)" hint={`Up to ${FOLLOW_UP_NOTE_MAX} characters.`} error={problems.note}>
            <EhrTextarea value={note} rows={2} maxLength={FOLLOW_UP_NOTE_MAX + 50} onChange={event => { setNote(event.target.value); setProblems({}) }} />
          </EhrField>
          {error ? <ErrorBox>{error}</ErrorBox> : null}
          <div className="hid-ehr-clinical-form-footer">
            <EhrButton type="submit" variant="secondary" busy={busy}>Save follow-up</EhrButton>
            {set ? <EhrButton variant="quiet" disabled={busy} onClick={() => send(null, null, 'Follow-up cleared.')}>Clear follow-up</EhrButton> : null}
          </div>
        </form>
      ) : null}
    </EhrCard>
  )
}

// ---- X-ray images ------------------------------------------------------------------------------

/**
 * Periapical, bitewing and panoramic (OPG) X-rays, attached to the visit as its documents (the live documents routes:
 * upload, virus scan, download) until Radiology ships. Intraoral and facial photos only once the DPO agrees
 * (DENTAL_PHOTOS_ENABLED, route 1's photosAvailable).
 */
function XRays({ chart, encounterId, photos, writable, readable }: {
  readonly chart: Chart
  readonly encounterId: string
  readonly photos: boolean
  readonly writable: boolean
  readonly readable: boolean
}) {
  const documents = useDocumentList(chart, encounterId, readable)
  if (!readable) return null
  return (
    <DocumentsCard chart={chart} encounterId={encounterId} list={documents} canWrite={writable} words={{
      title: photos ? 'X-ray images and photos' : 'X-ray images',
      intro: photos
        ? 'Periapical, bitewing and panoramic (OPG) X-rays, and intraoral or facial photos, are kept with this visit’s documents.'
        : 'Periapical, bitewing and panoramic (OPG) X-rays are kept with this visit’s documents. Photos of the mouth or face are not taken here yet.',
      uploadHeading: photos ? 'Attach X-ray image or photo' : 'Attach X-ray image',
      uploadButton: photos ? 'Attach image' : 'Attach X-ray image',
    }} />
  )
}
