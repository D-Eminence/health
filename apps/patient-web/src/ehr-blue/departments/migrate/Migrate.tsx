import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { EhrBadge, EhrButton, EhrDataTable, EhrDrawer, EhrInput, EhrTextarea } from '@hid/ui/ehr'
import { staffApi, type OcrExtraction, type OcrJob, type OcrValidation } from '../../../staff/api'
import { useStaff } from '../../../staff/App'
import { refusal, type FieldProblem } from '../../../staff/fieldProblem'
import { focusIsLost, useFocusById } from '../../../staff/focus'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { DeptActions, DeptContextLine, DeptFacts, DeptHistory, DeptLinkButton, DeptRecordLayout, DeptRecordName, type DeptFact } from '../parts/DeptRecord'
import { DeptSearch } from '../parts/DeptSearch'
import { errorText } from '../parts/errors'
import { dateText, matchesSearch, shortId } from '../parts/format'
import { DocumentCapture } from './DocumentCapture'
import { FormRefusal, MigrateField, controlProps } from './MigrateField'
import { ConfirmForm, ReviewForm, ReviewPublication, UUID_V4, statusTone, statusWords, type PublicationAttempt } from './ocrSteps'
import './migrate.css'

/*
 * Health ID Migrate: document capture and OCR, on today's API. The OCR flow is today's Document OCR page
 * (staff/routes/Operations.tsx Ocr) and Migrate gap (MigrateGap): the same calls, checks and refusal paths, in the
 * design's list, new and record views. OCR has no facility-wide job list, so the list holds the jobs found or created
 * on this page, in memory only, until the page is left.
 */

/**
 * Where focus goes once a step's answer has rendered, the first of `targets` shown, and what the status region then
 * says. `confirmNext` adds the next step when that step is the source patient confirmation now shown.
 */
interface StepFocus { readonly targets: readonly string[]; readonly notice?: string; readonly confirmNext?: boolean }

/** A job this page has read, and when. */
interface OpenedJob { readonly job: OcrJob; readonly readAt: string }

type View = 'list' | 'new' | 'detail'
type ActionId = 'retry' | 'validate' | 'reject' | 'confirm'

const ACTION_LABELS: Record<ActionId, string> = {
  retry: 'Retry job', validate: 'Validate extraction', reject: 'Reject extraction', confirm: 'Confirm source patient',
}

function jobName(job: OcrJob) {
  return `Document ${shortId(job.documentId)}`
}

function jobFacts(job: OcrJob): DeptFact[] {
  return [
    { label: 'Status', value: statusWords(job.status) },
    { label: 'Version', value: String(job.version ?? 'unknown') },
    { label: 'Provider', value: job.provider },
    { label: 'Document', value: shortId(job.documentId) },
    { label: 'Patient', value: job.patientId ? shortId(job.patientId) : 'Not given' },
    { label: 'Source patient', value: job.patientConfirmation ? `Confirmed ${dateText(job.patientConfirmation.confirmedAt)}` : 'Not confirmed' },
    ...(job.attemptCount != null && job.maxAttempts != null ? [{ label: 'Attempts', value: `${job.attemptCount} of ${job.maxAttempts}` }] : []),
  ]
}

/** The page's heading, focusable so a change of view can take focus to it. */
function ViewTitle({ children }: { readonly children: ReactNode }) {
  return <span id="migrate-view-title" tabIndex={-1} className="hid-ehr-dept-migrate-title">{children}</span>
}

export function Migrate() {
  const { facilityId, permissions, actorId } = useDeptAccess()
  const { lock } = useStaff()
  // OCR's parts need OCR job read; Patient documents needs document read, as the clinical record's Documents tab does.
  const canRead = permissions.includes('ocr.job.read')
  const canWrite = canRead && permissions.includes('ocr.job.write')
  const canDocuments = permissions.includes('ehr.document.read')
  // A clinical document's "Extract with OCR" link hands over its IDs in router state, never in the URL. The history
  // entry holding them outlives the session and the facility that made it (Back, Forward and a reload bring it back),
  // so they count only for that account and facility, and only once.
  const location = useLocation()
  const navigate = useNavigate()
  const [handoff] = useState(() => {
    const given = location.state as { ocrDocumentId?: unknown; ocrPatientId?: unknown; actorId?: unknown; facilityId?: unknown } | null
    return given && actorId !== undefined && given.actorId === actorId && given.facilityId === facilityId ? given : null
  })
  const cleared = useRef(false)
  useEffect(() => {
    if (cleared.current) return
    cleared.current = true
    if (location.state != null) navigate(location.pathname + location.search, { replace: true, state: null })
  }, [location.state, location.pathname, location.search, navigate])
  // The Find card's field, and the document whose job is shown (or was last asked for).
  const [findDocument, setFindDocument] = useState(() => typeof handoff?.ocrDocumentId === 'string' ? handoff.ocrDocumentId : '')
  const [currentDocument, setCurrentDocument] = useState('')
  // The New view's fields.
  const [newDocument, setNewDocument] = useState('')
  const [patientId, setPatientId] = useState(() => typeof handoff?.ocrPatientId === 'string' ? handoff.ocrPatientId : '')
  const [view, setView] = useState<View>('list')
  const [action, setAction] = useState<ActionId | null>(null)
  const [quick, setQuick] = useState<OpenedJob | null>(null)
  const [search, setSearch] = useState('')
  const [job, setJob] = useState<OcrJob | null>(null)
  const [jobFacilityId, setJobFacilityId] = useState('')
  const [extractions, setExtractions] = useState<OcrExtraction[] | null>(null)
  const [validations, setValidations] = useState<OcrValidation[] | null>(null)
  const [searched, setSearched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [createError, setCreateError] = useState('')
  const [retryError, setRetryError] = useState('')
  const [problem, setProblem] = useState<FieldProblem | null>(null)
  const [notice, setNotice] = useState('')
  const [stepFocus, setStepFocus] = useState<StepFocus | null>(null)
  const focus = useFocusById()
  const [lookupRevision, setLookupRevision] = useState(0)
  // Each publication request's Idempotency-Key and OCR's wait, by request. Here, not in the review, so a read of the
  // job again (which remounts the reviews) keeps them; in memory only, so they last until this page is reloaded or left.
  const publicationAttempts = useRef(new Map<string, PublicationAttempt>())
  // The jobs read on this page, for this account at this facility, newest first.
  const scope = JSON.stringify([actorId ?? '', facilityId ?? ''])
  const [opened, setOpened] = useState<{ scope: string; rows: OpenedJob[] }>({ scope: '', rows: [] })
  const rows = opened.scope === scope ? opened.rows : []
  const remember = useCallback((found: OcrJob) => setOpened(current => ({ scope,
    rows: [{ job: found, readAt: new Date().toISOString() }, ...(current.scope === scope ? current.rows.filter(row => row.job.id !== found.id) : [])] })), [scope])

  const visibleJob = jobFacilityId === facilityId ? job : null
  const canRetryJob = visibleJob?.status === 'failed' &&
    (visibleJob.attemptCount === undefined || visibleJob.maxAttempts === undefined || visibleJob.attemptCount < visibleJob.maxAttempts)
  useEffect(() => {
    setJob(null); setExtractions(null); setValidations(null); setSearched(false); setError(''); setCreateError(''); setRetryError('')
    setProblem(null); setNotice(''); setStepFocus(null); setView('list'); setAction(null); setQuick(null)
  }, [facilityId])
  useEffect(() => {
    if (!facilityId || !visibleJob?.id || !canRead) return
    let active = true
    void Promise.all([staffApi.ocrExtractions(facilityId, visibleJob.id), staffApi.ocrValidations(facilityId, visibleJob.id)])
      .then(([extractionResult, validationResult]) => { if (active) { setExtractions(extractionResult.items); setValidations(validationResult.items) } })
      .catch(caught => { if (active) setError(errorText(caught, 'The OCR review evidence could not be loaded.')) })
    return () => { active = false }
  }, [facilityId, visibleJob?.id, canRead, lookupRevision])
  // After a step, focus moves to where the work continues in the commit that shows it: the job's review evidence is
  // read after the job, and the next step shows only then. While the workspace is locked (hidden and inert) nothing in
  // it can take focus or be heard, so the step waits for it to open. A user who has gone somewhere since the step
  // keeps focus there; the status region still says what was recorded.
  useLayoutEffect(() => {
    if (!stepFocus || lock) return
    if (visibleJob && canRead && (extractions === null || validations === null) && !error) return
    const target = stepFocus.targets.map(id => document.getElementById(id)).find(element => element !== null)
    setStepFocus(null)
    if (stepFocus.notice) setNotice(stepFocus.confirmNext && target?.id === 'ocr-confirm-title' ? `${stepFocus.notice} Confirm the source patient next.` : stepFocus.notice)
    if (target && focusIsLost(target)) target.focus()
  }, [stepFocus, lock, visibleJob, canRead, extractions, validations, error])

  /** Shows a job just read or made, and reads its review evidence. */
  function show(found: OcrJob, documentId: string) {
    setJob(found); setJobFacilityId(facilityId ?? ''); setCurrentDocument(documentId); setSearched(true)
    setExtractions(null); setValidations(null); setLookupRevision(value => value + 1); remember(found)
  }

  // The answer once the document's job has been read again; null when it could not be.
  async function lookup(documentId: string): Promise<{ job: OcrJob | null } | null> {
    if (!facilityId || !documentId.trim()) return null
    // A lookup supersedes a step still waiting to move focus; one that follows a step sets it afterwards.
    setStepFocus(null)
    setBusy(true); setError(''); setRetryError(''); setNotice(''); setSearched(false); setExtractions(null); setValidations(null)
    try {
      const result = await staffApi.findOcrJob(facilityId, documentId.trim())
      setJob(result.job); setJobFacilityId(facilityId); setCurrentDocument(documentId.trim()); setSearched(true); setLookupRevision(value => value + 1)
      if (result.job) remember(result.job)
      return result
    }
    catch (caught) { setJob(null); setError(errorText(caught, 'The OCR job could not be found.')); return null }
    finally { setBusy(false) }
  }

  /** Opens a job's record, read again; focus goes to its heading. */
  function openRecord(found: OcrJob) {
    setQuick(null); setAction(null); setProblem(null)
    setJob(found); setJobFacilityId(facilityId ?? ''); setCurrentDocument(found.documentId); setView('detail')
    focus('migrate-view-title')
    void lookup(found.documentId).then(result => { if (!result?.job) focus('ocr-find-submit', true) })
  }

  function backToList() {
    const shown = visibleJob
    setView('list'); setAction(null); setProblem(null); setCreateError('')
    focus(shown ? [`ocr-row-${shown.id}`, 'ocr-find-title'] : 'ocr-find-title')
  }

  function startNew(documentId = '') {
    setView('new'); setProblem(null); setCreateError(''); setNotice('')
    if (documentId) setNewDocument(documentId)
    focus('migrate-view-title')
  }

  // A found job opens its record; with none, focus stays on Find job, which is busy while the lookup runs.
  async function find(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    // The last answer no longer applies, nor does a field refused before.
    setProblem(null); setError(''); setNotice('')
    const documentId = findDocument.trim()
    const refused = !documentId ? { field: 'ocr-document', message: 'Complete this field.' }
      : !UUID_V4.test(documentId) ? { field: 'ocr-document', message: 'Enter a valid document ID (a UUID).' } : null
    if (refused) { setProblem(refusal(refused)); focus(refused.field); return }
    const result = await lookup(documentId)
    if (result?.job) { setView('detail'); setAction(null); focus('migrate-view-title') }
    else focus('ocr-find-submit', true)
  }

  /** A step recorded, then the job read again: focus and say where the work goes on. */
  async function afterStep(targets: readonly string[], notice: string | undefined, confirmNext = false) {
    const reloaded = await lookup(currentDocument)
    setStepFocus(reloaded ? { targets: [...targets, 'ocr-find-submit'], notice, confirmNext } : { targets: ['ocr-find-submit'], notice })
  }

  // A job is created only once a lookup has answered that the document has none: a failed or missing lookup must not
  // make a duplicate. A document that has one opens it instead.
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!facilityId || busy) return
    setCreateError(''); setNotice('')
    const documentId = newDocument.trim()
    const patient = patientId.trim()
    const refused = !documentId ? { field: 'ocr-new-document', message: 'Complete this field.' }
      : !UUID_V4.test(documentId) ? { field: 'ocr-new-document', message: 'Enter a valid document ID (a UUID).' }
      : !patient ? { field: 'ocr-patient', message: 'Complete this field.' }
      : !UUID_V4.test(patient) ? { field: 'ocr-patient', message: 'Enter a valid patient ID (a UUID).' } : null
    setProblem(refused && refusal(refused))
    if (refused) { focus(refused.field); return }
    setBusy(true); setStepFocus(null)
    try {
      let existing: OcrJob | null
      try { existing = (await staffApi.findOcrJob(facilityId, documentId)).job }
      catch (caught) { setCreateError(errorText(caught, 'The document could not be checked for an OCR job, so no job was created.')); focus('ocr-create-submit', true); return }
      if (existing) {
        show(existing, documentId); setView('detail'); setAction(null)
        setStepFocus({ targets: ['ocr-job-title'], notice: 'This document already has an OCR job, so no new job was created.' })
        return
      }
      const created = await staffApi.createOcrJob(facilityId, documentId, patient)
      show(created, documentId); setView('detail'); setAction(null)
      setStepFocus({ targets: ['ocr-job-title'], notice: 'Extraction job created.' })
    }
    catch (caught) { setCreateError(errorText(caught, 'The OCR job was not created.')); focus('ocr-create-submit', true) }
    finally { setBusy(false) }
  }

  async function retry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!facilityId || !visibleJob || busy) return
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim()
    setProblem(null); setRetryError('')
    if (reason.length < 8) {
      setProblem(refusal({ field: 'ocr-retry-reason', message: reason ? 'Enter a reason of at least 8 characters.' : 'Complete this field.' }))
      focus('ocr-retry-reason'); return
    }
    setBusy(true); setError(''); setNotice('')
    try {
      const retried = await staffApi.retryOcrJob(facilityId, visibleJob, reason)
      setJob(retried); remember(retried); setLookupRevision(value => value + 1)
      setStepFocus({ targets: ['ocr-job-title'], notice: 'Retry requested.' })
    }
    catch (caught) { setRetryError(errorText(caught, 'The OCR job was not retried.')); focus('ocr-retry-submit', true) }
    finally { setBusy(false) }
  }

  /** A clean document from Patient documents: its job is found, or made, from here. */
  function extract(documentId: string, documentPatientId: string) {
    setFindDocument(documentId); setPatientId(documentPatientId); setSearched(false); setJob(null); setNotice(''); setProblem(null); setStepFocus(null)
    if (canWrite) startNew(documentId)
    else focus('ocr-document')
  }

  if (!facilityId || (!canRead && !canDocuments)) return <DeptPage title="Migrate">
    <DeptNotice tone="critical" role="alert">Permission denied. This membership or branch cannot open this module: it needs OCR job read or document read permission.</DeptNotice>
  </DeptPage>

  const detail = view === 'detail' && canRead && visibleJob ? visibleJob : null
  const creating = view === 'new' && canWrite
  const title = detail ? jobName(detail) : creating ? 'New document job' : 'Migrate'
  // Mounted throughout, in the same place in every view, so a message put in it is announced.
  const status = <div key="status" id="ocr-status" role="status" className="hid-ehr-dept-migrate-status">{notice && <DeptNotice tone="positive">{notice}</DeptNotice>}</div>
  return <DeptPage title={<ViewTitle>{title}</ViewTitle>} onBack={detail || creating ? backToList : undefined}
    primaryAction={!detail && !creating && canWrite ? <EhrButton onClick={() => startNew()}>Create record</EhrButton> : undefined}>
    {status}
    {detail ? <Fragment key="detail">{jobRecord(detail)}</Fragment> : creating ? <Fragment key="new">{newJob()}</Fragment> : <Fragment key="list">{jobList()}</Fragment>}
    {/* Mounted in every view and hidden outside the list, so going back to the list does not read the patient, the
        consent, the encounters and the documents again (each read is audited), and keeps the encounter and page chosen. */}
    <div key="capture" hidden={Boolean(detail || creating)}>
      <DocumentCapture facilityId={facilityId} permissions={permissions} onExtract={extract} />
    </div>
    <EhrDrawer open={quick !== null} title="Record quick view" onClose={() => setQuick(null)}>
      {quick && <div className="hid-ehr-dept-migrate-quick">
        <h3>{jobName(quick.job)}</h3>
        <p className="hid-ehr-dept-muted">{`Last read ${dateText(quick.readAt)}`}</p>
        <DeptFacts facts={jobFacts(quick.job)} />
        <div className="hid-ehr-dept-form-actions"><EhrButton onClick={() => openRecord(quick.job)}>Open full record</EhrButton></div>
      </div>}
    </EhrDrawer>
  </DeptPage>

  // Render functions, not components: a component declared here would be a new type on each render, and remount.
  function jobList() {
    const shown = rows.filter(row => matchesSearch(search, [row.job.documentId, shortId(row.job.documentId), row.job.id,
      statusWords(row.job.status), row.job.provider, row.job.patientId]))
    const nothingFound = searched && !visibleJob && currentDocument !== ''
    if (!canRead) return <DeptSection title="Document OCR">
      <DeptNotice tone="critical">Permission denied. Finding, creating and reviewing OCR jobs needs OCR job read permission.</DeptNotice>
    </DeptSection>
    return <>
      <DeptNotice title="Project migration is not available yet">
        <p>This Health ID deployment runs document OCR jobs for authorized clinical documents. Project setup, bulk import, record matching and a migration index need backend support before they can be offered.</p>
      </DeptNotice>
      <DeptSearch label="Search Migrate" value={search} onChange={setSearch}
        hint="OCR has no facility-wide job list: jobs you find or create here are listed until you leave this page."
        filters={search ? <div className="hid-ehr-dept-migrate-clear"><EhrButton variant="secondary" onClick={() => setSearch('')}>Clear search</EhrButton></div> : undefined}>
        <EhrDataTable caption="OCR jobs opened on this page" captionHidden rows={shown} rowKey={row => row.job.id}
          emptyTitle="No matching records"
          emptyMessage={rows.length ? 'Change your search.' : 'Find a job by its document ID, or create one when you have the appropriate permission.'}
          columns={[
            { id: 'record', header: 'Record', cell: row => <DeptRecordName id={`ocr-row-${row.job.id}`} name={jobName(row.job)}
              reference={`Job ${shortId(row.job.id)}`} onOpen={() => openRecord(row.job)} /> },
            { id: 'patient', header: 'Patient / context', cell: row => <div className="hid-ehr-dept-record-name">
              <span>{row.job.patientId ? `Patient ${shortId(row.job.patientId)}` : 'Patient not given'}</span>
              <span className="hid-ehr-dept-reference">{`${row.job.provider} · version ${row.job.version ?? 'unknown'}`}</span></div> },
            { id: 'status', header: 'Status', cell: row => <EhrBadge tone={statusTone(row.job.status)}>{statusWords(row.job.status)}</EhrBadge> },
            { id: 'read', header: 'Last read', cell: row => dateText(row.readAt) },
            { id: 'actions', header: <span className="hid-ehr-sr-only">Actions</span>, cell: row => <div className="hid-ehr-dept-table-actions">
              <EhrButton variant="secondary" size="sm" aria-describedby={`ocr-row-${row.job.id}`} onClick={() => setQuick(row)}>Quick view</EhrButton>
              <DeptLinkButton describedBy={`ocr-row-${row.job.id}`} onClick={() => openRecord(row.job)}>Open <span aria-hidden="true">→</span></DeptLinkButton>
            </div> },
          ]} />
      </DeptSearch>
      <DeptSection title="Find document job" headingId="ocr-find-title">
        <p className="hid-ehr-dept-muted">Use the document ID from an authorized clinical record. The document must be available and virus scan clean before extraction can begin.</p>
        <form className="hid-ehr-dept-form hid-ehr-dept-migrate-find" noValidate aria-labelledby="ocr-find-title" onSubmit={event => void find(event)}>
          <MigrateField id="ocr-document" label="Document ID" required problem={problem}>
            <EhrInput value={findDocument} placeholder="Document UUID" required autoComplete="off" {...controlProps(problem, 'ocr-document')}
              onChange={event => { setFindDocument(event.target.value); setSearched(false); setJob(null); setNotice(''); setProblem(null); setStepFocus(null) }} />
          </MigrateField>
          <div className="hid-ehr-dept-form-actions"><EhrButton id="ocr-find-submit" type="submit" busy={busy}>{busy ? 'Checking…' : 'Find job'}</EhrButton></div>
        </form>
        <div className={nothingFound ? 'hid-ehr-empty-state hid-ehr-dept-migrate-none' : undefined}>
          {/* Mounted with the form, so the answer that a document has no job is announced; Create record stays outside it. */}
          <div id="ocr-find-result" role="status">{nothingFound && <>
            <p className="hid-ehr-state-title">No OCR job for this document</p>
            <p className="hid-ehr-state-message">{canWrite ? `Document ${shortId(currentDocument)} has no extraction job yet. Create one for a verified patient document.`
              : `Document ${shortId(currentDocument)} has no extraction job yet.`}</p>
          </>}</div>
          {nothingFound && canWrite && <div className="hid-ehr-state-action"><EhrButton variant="secondary" id="ocr-create-start" onClick={() => startNew(currentDocument)}>Create record</EhrButton></div>}
        </div>
        {error && <DeptNotice tone="critical" role="alert">{error}</DeptNotice>}
      </DeptSection>
    </>
  }

  function newJob() {
    return <DeptSection>
      <form className="hid-ehr-dept-form" noValidate aria-label="New document job" onSubmit={event => void create(event)}>
        <p className="hid-ehr-dept-muted">Create an extraction job for a verified patient document. The document must be virus scan clean. If it already has a job, that job opens instead.</p>
        <div className="hid-ehr-dept-form-grid">
          <MigrateField id="ocr-new-document" label="Document ID" required problem={problem}>
            <EhrInput value={newDocument} placeholder="Document UUID" required autoComplete="off" {...controlProps(problem, 'ocr-new-document')}
              onChange={event => { setNewDocument(event.target.value); setProblem(null) }} />
          </MigrateField>
          <MigrateField id="ocr-patient" label="Patient ID" required problem={problem}>
            <EhrInput value={patientId} placeholder="Patient UUID" required autoComplete="off" {...controlProps(problem, 'ocr-patient')}
              onChange={event => { setPatientId(event.target.value); setProblem(null) }} />
          </MigrateField>
        </div>
        <FormRefusal error={createError} />
        <div className="hid-ehr-dept-form-actions"><EhrButton id="ocr-create-submit" type="submit" busy={busy}>{busy ? 'Saving…' : 'Save record'}</EhrButton></div>
      </form>
    </DeptSection>
  }

  function jobRecord(shown: OcrJob) {
    const available: ActionId[] = [
      ...(canRetryJob && permissions.includes('ocr.job.write') ? ['retry' as const] : []),
      ...(shown.status === 'awaiting_validation' && permissions.includes('ocr.validation.write') && extractions ? ['validate' as const, 'reject' as const] : []),
      ...(shown.status === 'validated' && !shown.patientConfirmation && permissions.includes('ocr.patient.confirm') ? ['confirm' as const] : []),
    ]
    const selected = action && available.includes(action) ? action : null
    const formFor = (id: ActionId) => id === 'retry'
      ? <form key={`retry-${shown.id}-${shown.version}`} className="hid-ehr-dept-form hid-ehr-dept-action-form" noValidate aria-label="Retry job" onSubmit={event => void retry(event)}>
        <MigrateField id="ocr-retry-reason" label="Retry reason" required problem={problem}>
          <EhrTextarea name="reason" minLength={8} maxLength={500} required {...controlProps(problem, 'ocr-retry-reason')} />
        </MigrateField>
        <FormRefusal error={retryError} />
        <div className="hid-ehr-dept-form-actions"><EhrButton id="ocr-retry-submit" type="submit" busy={busy} disabled={!shown.version}>{busy ? 'Saving…' : 'Retry job'}</EhrButton></div>
      </form>
      : id === 'confirm'
        ? <ConfirmForm key={`confirm-${shown.id}-${shown.version}`} facilityId={facilityId!} job={shown} onChanged={async message => {
          // An answer that the job was confirmed already is said only once the job has been read again.
          if (message) {
            const reloaded = await lookup(currentDocument)
            setStepFocus({ targets: reloaded ? ['ocr-history-title', 'ocr-job-title', 'ocr-find-submit'] : ['ocr-find-submit'], notice: reloaded ? message : undefined })
            return
          }
          await afterStep(['ocr-history-title', 'ocr-job-title'], 'Source patient confirmed.')
        }} />
        : <ReviewForm key={`${id}-${shown.id}-${shown.version}`} facilityId={facilityId!} job={shown} extractions={extractions ?? []}
          disposition={id === 'validate' ? 'validated' : 'rejected'} onChanged={disposition => {
            if (disposition !== 'validated') return afterStep(['ocr-job-title'], 'Rejection recorded.')
            // The next step, confirming the source patient, opens where the work continues.
            setAction('confirm')
            return afterStep(['ocr-confirm-title', 'ocr-job-title'], 'Review recorded.', true)
          }} />
    return <>
      <DeptContextLine status={statusWords(shown.status)} tone={statusTone(shown.status)}
        items={[shown.patientId ? `Patient ${shortId(shown.patientId)}` : 'Patient not given', `Version ${shown.version ?? 'unknown'} · ${shown.provider}`]} />
      {error && <DeptNotice tone="critical" role="alert">{error}</DeptNotice>}
      <DeptRecordLayout
        main={<DeptSection title="Saved record" headingId="ocr-job-title">
          <DeptFacts facts={jobFacts(shown)} />
          {shown.status === 'failed' && !canRetryJob && <p className="hid-ehr-dept-muted hid-ehr-dept-migrate-after">The extraction attempt limit has been reached. This job cannot be retried.</p>}
        </DeptSection>}
        aside={<DeptActions empty="No further actions for your permission and this record state.">
          {[
            <EhrButton key="refresh" id="ocr-refresh-submit" variant="secondary" busy={busy}
              onClick={() => void lookup(currentDocument).then(result => focus(result ? ['ocr-refresh-submit', 'ocr-find-submit'] : 'ocr-find-submit', true))}>
              Refresh status</EhrButton>,
            ...available.map(id => <EhrButton key={id} id={id === 'confirm' ? 'ocr-confirm-title' : `ocr-action-${id}`} variant="secondary"
              aria-expanded={selected === id} onClick={() => { setProblem(null); setAction(selected === id ? null : id) }}>{ACTION_LABELS[id]}</EhrButton>),
            selected ? <div key={`form-${selected}`} className="hid-ehr-dept-migrate-action">{formFor(selected)}</div> : null,
          ]}
        </DeptActions>} />
      <DeptHistory title="Extractions" empty={extractions === null ? 'Loading extractions…' : 'No extraction is available yet.'}
        entries={(extractions ?? []).map(extraction => ({
          key: extraction.id,
          summary: [`Extraction ${extraction.version}`, extraction.provider, extraction.confidence != null ? `confidence ${Math.round(extraction.confidence * 100)}%` : ''].filter(Boolean).join(' · '),
          detail: extraction.rawText
            // It scrolls, so it takes focus: a keyboard can then scroll it.
            ? <pre tabIndex={0} role="region" aria-label={`Extracted text, version ${extraction.version}`} className="hid-ehr-dept-pre hid-ehr-dept-migrate-text">{extraction.rawText}</pre>
            : <p className="hid-ehr-dept-muted">No text was extracted.</p>,
        }))} />
      {validations && validations.length > 0 && <DeptSection title="Review and publication history" headingId="ocr-history-title">
        <ul className="hid-ehr-dept-rows">{validations.map(validation => <ReviewPublication key={validation.id} actorId={actorId} facilityId={facilityId!}
          validation={validation} confirmationId={shown.patientConfirmation?.id} permissions={permissions}
          publicationAttempts={publicationAttempts.current} onChanged={() => afterStep(['ocr-history-title', 'ocr-job-title'], 'Publication recorded.')} />)}</ul>
      </DeptSection>}
    </>
  }
}
