import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { EhrBadge, EhrButton, EhrDataTable, EhrDrawer, EhrField, EhrInput, EhrTextarea } from '@hid/ui/ehr'
import { staffApi, type OcrExtraction, type OcrJob, type OcrValidation } from '../../../staff/api'
import { useStaff } from '../../../staff/App'
import { STAFF_PAPER_NEEDS_ACCESS } from '../../../paperRecordsWording'
import { actionUnavailable, METHOD_ROUTES } from '../../clinical/consent/access'
import { pageAllowed } from '../../frame/pageAccess'
import { useOpenPages } from '../../frame/pageContext'
import { pageHrefOf } from '../../frame/pageHref'
import { modulePath } from '../../frame/sample/paths'
import { problemText, refusal, type FieldProblem } from '../../../staff/fieldProblem'
import { focusIsLost, useFocusById } from '../../../staff/focus'
import { notAnOcrId } from '../../../staff/ocrIdWords'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { DeptContextLine, DeptFacts, DeptHistory, DeptLinkButton, DeptRecordName, type DeptFact } from '../parts/DeptRecord'
import { DeptSearch } from '../parts/DeptSearch'
import { errorText } from '../parts/errors'
import { dateText, matchesSearch, shortId } from '../parts/format'
import { DocumentCapture } from './DocumentCapture'
import { NewJobPick, type NewJobPicked } from './NewJobPick'
import { READING_DELETED, readingDeleted } from './readingDeleted'
import { learnReviewLearningServed, useReadingQualityServed } from '../../../readingLearningServed'
import { ReadingQualityView } from './ReadingQuality'
import { qualityReader } from './readingQualityApi'
import { saysReviewLearning } from '../../../readingLearningContract'
import {
  NOT_WHOLE_WORDS, PaperReadingSummary, PaperReadingView, PaperReadingWarnings, claimsPaperReading, confidenceWords, parsePaperReading,
  type PaperReading,
} from './paperReading'
import {
  ConfirmForm, FormRefusal, ReviewForm, ReviewPublication, UUID_V4, jobInProgress, jobStatusWords, statusTone, statusWords, type PublicationAttempt,
} from './ocrSteps'

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

/**
 * The refusal for a role without OCR job read, on this page and at its address (page.tsx). Screens name no permission
 * (the owner's rule), so today's words, which named the one lacking, give way to a plain sentence. No role holds the OCR
 * work (hid-system 0091), so nobody is told to ask anyone for it: it isn't available yet. It names the reading of scanned
 * documents, not document capture: a clinician refused here may still add documents to a visit.
 */
export const NO_DOCUMENT_OCR = 'Reading scanned documents isn’t available at your facility yet.'

/**
 * Whether OCR refused to make a job because the patient's own OK does not cover bringing in their paper records: its
 * 403 OCR_RECORDS_PROCESSING_CONSENT_REQUIRED, or, before that answer ships, the 404 it gives today for the same reason
 * (owner, 5 Nov 2026). A 404 from a module that is off (API_ROUTE_NOT_FOUND) keeps its own words.
 */
export function needsPatientAccess(caught: unknown): boolean {
  if (!isHidApiError(caught)) return false
  if (caught.status === 403) return caught.code === 'OCR_RECORDS_PROCESSING_CONSENT_REQUIRED'
  return caught.status === 404 && caught.code !== 'API_ROUTE_NOT_FOUND'
}

/**
 * The ways to the patient's own OK, under STAFF_PAPER_NEEDS_ACCESS: asking the patient (External record access's
 * request form) and their Access PIN, each only where this session may open that page and its role may take that step.
 * The Health ID is not known here (OCR has only the patient's record ID), so the form opens empty.
 */
function PatientAccessLinks({ permissions }: { readonly permissions: readonly string[] }) {
  const { state } = useStaff()
  const session = state.status === 'ready' ? state.session : null
  const pages = useOpenPages()
  const href = modulePath('consent')
  const page = pages.find(candidate => pageHrefOf(candidate) === href)
  if (!page || page.status === 'sample' || !pageAllowed(page, session)) return null
  const links = [
    ...(actionUnavailable(METHOD_ROUTES.request, permissions) === null ? [{ to: `${href}/new`, label: 'Ask the patient for access' }] : []),
    ...(actionUnavailable(METHOD_ROUTES.pin, permissions) === null ? [{ to: `${href}/pin`, label: 'Enter their Access PIN' }] : []),
  ]
  if (!links.length) return null
  return <div className="hid-ehr-state-action">
    {links.map((link, index) => <Link key={link.to} className={index ? 'hid-ehr-button hid-ehr-button-secondary' : 'hid-ehr-button'} to={link.to}>{link.label}</Link>)}
  </div>
}

/** A job this page has read, and when. */
interface OpenedJob { readonly job: OcrJob; readonly readAt: string }

type View = 'list' | 'new' | 'detail' | 'quality'
/** The steps opened with a button of their own; Check and save and Confirm the patient are on the page as they come due. */
type ActionId = 'retry' | 'reject'

/**
 * While OCR is still reading the shown document, the page reads its job again, one read at a time, for at most
 * POLL_FOR_MS: every POLL_EVERY_MS for the first POLL_FAST_FOR_MS, then every POLL_SLOW_EVERY_MS, as a hard handwritten
 * page can take many minutes. Each read is audited, so never faster, and never from the list.
 */
const POLL_EVERY_MS = 5_000
const POLL_FAST_FOR_MS = 60_000
const POLL_SLOW_EVERY_MS = 15_000
const POLL_FOR_MS = 20 * 60_000
/** What the record says once a job has been read for longer than POLL_FAST_FOR_MS, and after POLL_FOR_MS. */
export const READING_LONG = 'Reading the page. Hard handwriting can take a few minutes. This page updates by itself.'
export const STILL_READING = 'Still reading. Check again in a few minutes.'
/** The job states Read again is offered in: nothing of the reading is saved yet (no check, no publication). */
const READ_AGAIN_STATUSES: ReadonlySet<string> = new Set(['awaiting_validation', 'failed', 'rejected'])

/** Why the page stopped reading a job again by itself: it took too long, or a read did not answer. */
interface PollStop { readonly jobId: string; readonly reason: 'slow' | 'failed' }

/** What a step that finds or makes a document's job says, by its outcome. */
interface OpenWords { readonly created: string; readonly existing: string; readonly uncheckable: string; readonly refused: string }

/** All the page says while a document is checked and sent for reading: nothing else is shown until the answer. */
export const READING_THE_PAGE = 'Reading the page…'

/** Who the job is for, in words: never any part of the patient's record id (owner rule, IDs on screen). */
function patientWords(job: OcrJob) {
  return job.patientId ? 'Patient (name not shown)' : 'Patient not given'
}

/** A job's name: the file name of its document when this page knows it, as uploaded; otherwise the end of its document's ID. */
function jobName(job: OcrJob, fileNames: ReadonlyMap<string, string>) {
  return fileNames.get(job.documentId) ?? `Document ${shortId(job.documentId)}`
}

/** A field name OCR read ("dateOfBirth", "test_name") as words: "Date of birth", "Test name". */
function fieldLabel(key: string) {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replaceAll('-', ' ').trim().toLowerCase()
  return words ? words[0]!.toUpperCase() + words.slice(1) : key
}

/** A value OCR read, as text: lists are joined, and a group of fields is named field by field. */
function fieldText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map(fieldText).filter(Boolean).join('; ')
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => [fieldLabel(key), fieldText(item)] as const).filter(([, text]) => text).map(([label, text]) => `${label}: ${text}`).join(', ')
  return String(value)
}

/** The fields OCR read from a document, when it gave them as named fields; nothing otherwise. */
function extractedFields(payload: unknown): DeptFact[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const facts: DeptFact[] = []
  const labels = new Set<string>()
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const label = fieldLabel(key)
    const text = fieldText(value)
    if (!text || labels.has(label)) continue
    labels.add(label); facts.push({ label, value: text })
  }
  return facts
}

/** The newest of a job's extractions: the one a review starts from. */
function newestExtraction(items: readonly OcrExtraction[]) {
  return items.reduce<OcrExtraction | undefined>((newest, item) => !newest || item.version > newest.version ? item : newest, undefined)
}

/** Whether OCR read any text at all: text that is only spaces or line breaks is none. */
/** Read again's answer when the reading it was asked for no longer exists for this member. */
const READING_GONE = 'This reading is no longer available to you. Press Read again to start a new one.'

/** A 4xx refusal that carries no job id: nothing was made for the request's key. */
function refusedWithoutJob(caught: unknown): boolean {
  if (!isHidApiError(caught) || caught.status < 400 || caught.status >= 500) return false
  const details = caught.details as { job?: { id?: unknown }; jobId?: unknown } | null
  return !(typeof details?.job?.id === 'string' || typeof details?.jobId === 'string')
}

function hasText(text: string | null | undefined): text is string {
  return !!text && text.trim().length > 0
}

/**
 * True when a paper reading's items were picked out: the items are shown and checked, never the scanned text beside them.
 * A reading with no items shows its scanned text, so staff still have the words to check.
 */
function showsItems(reading: PaperReading | null): boolean {
  return reading?.status === 'read' && reading.items.length > 0
}

/** The text OCR read, as it is. It scrolls, so it takes focus: a keyboard can then scroll it. */
function scannedText(text: string) {
  return <pre tabIndex={0} role="region" aria-label="Text read from the document" className="hid-ehr-dept-pre hid-ehr-dept-migrate-text">{text}</pre>
}

function jobFacts(job: OcrJob): DeptFact[] {
  return [
    { label: 'Status', value: jobStatusWords(job.status) },
    { label: 'Version', value: String(job.version ?? 'unknown') },
    { label: 'Provider', value: job.provider },
    { label: 'Document', value: shortId(job.documentId) },
    // Said in words, never any part of the patient's record id (owner rule, IDs on screen).
    { label: 'Patient', value: job.patientId ? 'Name not shown' : 'Not given' },
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
  const { lock, state: staffState } = useStaff()
  // Migrate learning's "Reading quality": for a platform administrator, or for this facility's own manager (the facility
  // its read sends as X-Facility-ID), as Session B decides it, and offered until its read answers 404 (readingQualityApi.ts).
  const reader = qualityReader(staffState.status === 'ready' ? staffState.session.actor : undefined, facilityId)
  const readsQuality = reader !== null
  const qualityServed = useReadingQualityServed()
  const qualityOffered = readsQuality && qualityServed !== false
  // OCR's parts need OCR job read (so does the page); Patient documents needs document read, as the clinical record's
  // Documents tab does, and checks it itself.
  const canRead = permissions.includes('ocr.job.read')
  const canWrite = canRead && permissions.includes('ocr.job.write')
  // A clinical document's "Extract with OCR" link hands over its IDs in router state, never in the URL. The history
  // entry holding them outlives the session and the facility that made it (Back, Forward and a reload bring it back),
  // so they count only for that account and facility, and only once.
  const location = useLocation()
  const navigate = useNavigate()
  const [handoff] = useState(() => {
    const given = location.state as { ocrDocumentId?: unknown; ocrPatientId?: unknown; actorId?: unknown; facilityId?: unknown } | null
    return given && actorId !== undefined && given.actorId === actorId && given.facilityId === facilityId ? given : null
  })
  const handedDocument = typeof handoff?.ocrDocumentId === 'string' ? handoff.ocrDocumentId : ''
  const handedPatient = typeof handoff?.ocrPatientId === 'string' ? handoff.ocrPatientId : ''
  const cleared = useRef(false)
  // The address entry this page last saw, and whether the next new one is the hand-off's own clearing.
  const seenKey = useRef(location.key)
  const clearing = useRef(false)
  useEffect(() => {
    if (cleared.current) return
    cleared.current = true
    if (location.state != null) { clearing.current = true; navigate(location.pathname + location.search, { replace: true, state: null }) }
  }, [location.state, location.pathname, location.search, navigate])
  // The Find card's field, and the document whose job is shown (or was last asked for).
  const [findDocument, setFindDocument] = useState(handedDocument)
  const [currentDocument, setCurrentDocument] = useState('')
  // The New view's document to pick at once, when it is listed: never typed, never shown.
  const [newDocument, setNewDocument] = useState('')
  // The file names of documents picked or sent for reading on this page, by document, for the record's heading: in
  // memory only, until the page is left.
  const [fileNames, setFileNames] = useState<ReadonlyMap<string, string>>(new Map())
  const nameDocument = useCallback((documentId: string, fileName: string | undefined) => {
    if (fileName) setFileNames(current => current.get(documentId) === fileName ? current : new Map(current).set(documentId, fileName))
  }, [])
  // The reviews whose publication is published, by review: Progress then says Published.
  const [published, setPublished] = useState<ReadonlySet<string>>(new Set())
  const notePublished = useCallback((validationId: string, done: boolean) => setPublished(current => {
    if (current.has(validationId) === done) return current
    const next = new Set(current)
    if (done) next.add(validationId); else next.delete(validationId)
    return next
  }), [])
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
  // While a document is checked and sent for reading (Extract with OCR, or the clinical record's hand-off), the page says
  // only READING_THE_PAGE. A hand-off that will be sent says so from the first render, so the list never flashes first.
  const [reading, setReading] = useState(() => canWrite && UUID_V4.test(handedDocument) && UUID_V4.test(handedPatient))
  const focus = useFocusById()
  const [lookupRevision, setLookupRevision] = useState(0)
  // Reading the shown job again by itself while OCR reads the document: since when, for which job, and why it stopped.
  const pollSince = useRef<{ jobId: string; at: number } | null>(null)
  const [pollStop, setPollStop] = useState<PollStop | null>(null)
  const [pollTick, setPollTick] = useState(0)
  // The job read by itself for longer than POLL_FAST_FOR_MS, so the record says a hard page takes a while.
  const [pollLong, setPollLong] = useState<string | null>(null)
  // Bumped when the user opens a record, starts a new one or goes back to the list, so a document still being checked
  // or sent for reading in the background does not then replace what they went to.
  const openRequest = useRef(0)
  // Each publication request's Idempotency-Key and OCR's wait, by request. Here, not in the review, so a read of the
  // job again (which remounts the reviews) keeps them; in memory only, so they last until this page is reloaded or left.
  const publicationAttempts = useRef(new Map<string, PublicationAttempt>())
  // Read again's Idempotency-Key, by the job it was pressed on: a press after an answer that was lost sends the same key,
  // so OCR answers with the job it made then rather than making another; once answered, the next press takes a new key.
  const readAgainAttempt = useRef<{ jobId: string; key: string } | null>(null)
  // The jobs read on this page, for this account at this facility, newest first.
  const scope = JSON.stringify([actorId ?? '', facilityId ?? ''])
  const [opened, setOpened] = useState<{ scope: string; rows: OpenedJob[] }>({ scope: '', rows: [] })
  const rows = opened.scope === scope ? opened.rows : []
  const remember = useCallback((found: OcrJob) => setOpened(current => ({ scope,
    rows: [{ job: found, readAt: new Date().toISOString() }, ...(current.scope === scope ? current.rows.filter(row => row.job.id !== found.id) : [])] })), [scope])

  const visibleJob = jobFacilityId === facilityId ? job : null
  const canRetryJob = visibleJob?.status === 'failed' &&
    (visibleJob.attemptCount === undefined || visibleJob.maxAttempts === undefined || visibleJob.attemptCount < visibleJob.maxAttempts)
  // The menu's Document OCR link opens this page's own address again: a job or New document job open goes back to the
  // documents. The hand-off's clearing of its state is not such a press.
  useEffect(() => {
    if (seenKey.current === location.key) return
    seenKey.current = location.key
    if (clearing.current) { clearing.current = false; return }
    if (view !== 'list' && !reading) backToDocuments()
  }, [location.key])
  const resetFor = useRef(facilityId)
  useEffect(() => {
    setJob(null); setExtractions(null); setValidations(null); setSearched(false); setError(''); setCreateError(''); setRetryError('')
    setProblem(null); setNotice(''); setStepFocus(null); setView('list'); setAction(null); setQuick(null); setPollStop(null)
    setPollLong(null); pollSince.current = null
    // On a change of facility (not on mount, nor StrictMode's second run of it), a document still being sent for the
    // facility left no longer opens, nor holds the page on READING_THE_PAGE.
    if (resetFor.current === facilityId) return
    resetFor.current = facilityId
    openRequest.current += 1; setReading(false)
  }, [facilityId])
  // The clinical record's hand-off, with OCR job write: sent for reading at once, exactly once. Declared after the reset
  // above, which also runs on mount, so the reset cannot wipe it. The router state it came in is spent above (replaced
  // with none), so Back, Forward and a reload bring nothing back to send; this ref stops a second run in the same mount.
  // Without OCR job write, Find document job holds the document, to look it up, as before.
  const handedOver = useRef(false)
  useEffect(() => {
    if (handedOver.current) return
    handedOver.current = true
    if (canWrite && handedDocument) extract(handedDocument, handedPatient)
  }, [])
  useEffect(() => {
    if (!facilityId || !visibleJob?.id || !canRead) return
    let active = true
    void Promise.all([staffApi.ocrExtractions(facilityId, visibleJob.id), staffApi.ocrValidations(facilityId, visibleJob.id)])
      .then(([extractionResult, validationResult]) => {
        // Migrate learning stays dormant until an extraction says the backend takes it (each carries reviewLearning: true).
        if (extractionResult.items.some(saysReviewLearning)) learnReviewLearningServed(true)
        if (active) { setExtractions(extractionResult.items); setValidations(validationResult.items) }
      })
      .catch(caught => { if (active) setError(errorText(caught, 'The OCR review evidence could not be loaded.')) })
    return () => { active = false }
  }, [facilityId, visibleJob?.id, canRead, lookupRevision])
  // While the record shows a job OCR is still reading, its job is read again every POLL_EVERY_MS: one read at a time,
  // only once the last has answered and no other lookup is running, never from the list, nor while the workspace is
  // locked, every POLL_SLOW_EVERY_MS once it has gone on for POLL_FAST_FOR_MS. It stops when the job has finished, the
  // view changes or the page is left, and after POLL_FOR_MS, when the record says it is still reading and Check now (or
  // Refresh status) reads it again and starts again.
  const polled = view === 'detail' && canRead && !lock && !busy && visibleJob && jobInProgress(visibleJob.status) &&
    pollStop?.jobId !== visibleJob.id ? visibleJob : null
  const pollId = polled?.id
  const pollDocument = polled?.documentId
  const pollStatus = polled?.status
  const pollVersion = polled?.version
  useEffect(() => {
    if (!facilityId || !pollId || !pollDocument) return
    if (pollSince.current?.jobId !== pollId) pollSince.current = { jobId: pollId, at: Date.now() }
    const since = pollSince.current.at
    let active = true
    // Once the page stops reading the job by itself, a notice saying it updates by itself (shown or still to be shown)
    // no longer holds: the record's progress line says what to do instead.
    const stop = (reason: PollStop['reason']) => {
      setPollStop({ jobId: pollId, reason }); setNotice(''); setStepFocus(current => current && { ...current, notice: undefined })
    }
    const timer = setTimeout(() => {
      const elapsed = Date.now() - since
      if (elapsed >= POLL_FOR_MS) { stop('slow'); return }
      if (elapsed >= POLL_FAST_FOR_MS) setPollLong(pollId)
      void staffApi.findOcrJob(facilityId, pollDocument).then(result => {
        if (!active) return
        const found = result.job
        if (!found || found.id !== pollId) { stop('failed'); return }
        if (found.status === pollStatus && found.version === pollVersion) { setPollTick(value => value + 1); return }
        setJob(found); remember(found); setLookupRevision(value => value + 1)
        // The status region says once that the reading has finished, and how.
        if (!jobInProgress(found.status)) setNotice(found.status === 'awaiting_validation' ? 'The document has been read and is ready to check.' : `${jobStatusWords(found.status)}.`)
      }, () => { if (active) stop('failed') })
    }, Date.now() - since < POLL_FAST_FOR_MS ? POLL_EVERY_MS : POLL_SLOW_EVERY_MS)
    return () => { active = false; clearTimeout(timer) }
  }, [facilityId, pollId, pollDocument, pollStatus, pollVersion, pollTick, remember])
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
    setExtractions(null); setValidations(null); setLookupRevision(value => value + 1); remember(found); restartPolling(); setPollLong(null)
  }

  /** A job read again is read again by itself for a full POLL_FOR_MS once more. What it says of a long read stays after
   * Check now or Refresh status; a job opened, found, made or retried afresh clears it (setPollLong(null)), so the first
   * minute says what it always has. */
  function restartPolling() {
    pollSince.current = null; setPollStop(null)
  }

  // The answer once the document's job has been read again; null when it could not be.
  async function lookup(documentId: string): Promise<{ job: OcrJob | null } | null> {
    if (!facilityId || !documentId.trim()) return null
    // A lookup supersedes a step still waiting to move focus; one that follows a step sets it afterwards.
    setStepFocus(null)
    setBusy(true); setError(''); setRetryError(''); setNotice(''); setSearched(false); setExtractions(null); setValidations(null); restartPolling()
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
    openRequest.current += 1
    setQuick(null); setAction(null); setProblem(null); setPollLong(null)
    setJob(found); setJobFacilityId(facilityId ?? ''); setCurrentDocument(found.documentId); setView('detail')
    focus('migrate-view-title')
    void lookup(found.documentId).then(result => { if (!result?.job) focus('ocr-find-submit', true) })
  }

  function backToList() {
    const shown = visibleJob
    openRequest.current += 1
    setView('list'); setAction(null); setProblem(null); setCreateError('')
    focus(shown ? [`ocr-row-${shown.id}`, 'ocr-find-title'] : 'ocr-find-title')
  }

  /** Back to the list, with focus on Patient documents (or Find document job when it isn't offered). */
  function backToDocuments() {
    openRequest.current += 1
    setView('list'); setAction(null); setProblem(null); setCreateError('')
    focus(['migrate-documents-title', 'ocr-find-title'])
  }

  /** Migrate learning: the facility's reading quality, opened from the list. */
  function openQuality() {
    openRequest.current += 1
    setView('quality'); setQuick(null); setAction(null); setProblem(null); setNotice('')
    focus('migrate-view-title')
  }

  function backFromQuality() {
    setView('list')
    focus(['ocr-quality-open', 'ocr-find-title'])
  }

  function startNew(documentId = '') {
    openRequest.current += 1
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
      : !UUID_V4.test(documentId) ? { field: 'ocr-document', message: notAnOcrId('document', documentId) } : null
    if (refused) { setProblem(refusal(refused)); focus(refused.field); return }
    setPollLong(null)
    const result = await lookup(documentId)
    if (result?.job) { setView('detail'); setAction(null); focus('migrate-view-title') }
    else focus('ocr-find-submit', true)
  }

  /** A step recorded, then the job read again: focus and say where the work goes on. */
  async function afterStep(targets: readonly string[], notice: string | undefined, confirmNext = false) {
    const reloaded = await lookup(currentDocument)
    setStepFocus(reloaded ? { targets: [...targets, 'ocr-find-submit'], notice, confirmNext } : { targets: ['ocr-find-submit'], notice })
  }

  /** The New view's pick: the picked document's job opened, or made once a lookup says it has none. */
  async function create({ documentId, patientId: patient, fileName }: NewJobPicked) {
    if (!facilityId || busy) return
    nameDocument(documentId, fileName)
    setCreateError(''); setNotice('')
    await openOrCreate(documentId, patient, {
      created: 'Extraction job created.', existing: 'This document already has an OCR job, so no new job was created.',
      uncheckable: 'The document could not be checked for an OCR job, so no job was created.', refused: 'The OCR job was not created.',
    }, message => { setCreateError(message); focus('ocr-create-submit', true) })
  }

  // A job is created only once a lookup has answered that the document has none: a failed or missing lookup must not
  // make a duplicate. A document that has one opens it instead. Either way its record opens and says which (true); a
  // refusal is handed to `refuse`, and the view stays where it was (false). If the user has opened a record, started a
  // new one or gone back to the list meanwhile, they stay there: a job made is only added to the list (false).
  async function openOrCreate(documentId: string, patient: string, words: OpenWords, refuse: (message: string) => void): Promise<boolean> {
    if (!facilityId) return false
    const request = ++openRequest.current
    const current = () => openRequest.current === request
    setBusy(true); setStepFocus(null)
    try {
      let existing: OcrJob | null
      try { existing = (await staffApi.findOcrJob(facilityId, documentId)).job }
      catch (caught) { if (current()) refuse(errorText(caught, words.uncheckable)); return false }
      if (existing) {
        if (!current()) { remember(existing); return false }
        show(existing, documentId); setView('detail'); setAction(null)
        setStepFocus({ targets: ['ocr-job-title'], notice: words.existing })
        return true
      }
      let created: OcrJob
      try { created = await staffApi.createOcrJob(facilityId, documentId, patient) }
      catch (caught) {
        // Refused for want of the patient's OK: said plainly, with the ways to ask for it.
        if (current()) refuse(needsPatientAccess(caught) ? STAFF_PAPER_NEEDS_ACCESS : errorText(caught, words.refused))
        return false
      }
      if (!current()) { remember(created); return false }
      show(created, documentId); setView('detail'); setAction(null)
      setStepFocus({ targets: ['ocr-job-title'], notice: words.created })
      return true
    }
    catch (caught) { if (current()) refuse(errorText(caught, words.refused)); return false }
    finally { setBusy(false) }
  }

  /**
   * Read again: the document is sent for reading once more, so a reading made by an older reader is read by the newest.
   * OCR makes a new job only when the newest reader has not read it yet; otherwise it answers with the job it has, and
   * the page says this is already the newest reading. A new job is shown and read again by itself, as after Create.
   */
  async function readAgain(shown: OcrJob) {
    if (!facilityId || busy || !shown.patientId) return
    const request = ++openRequest.current
    const current = () => openRequest.current === request
    if (readAgainAttempt.current?.jobId !== shown.id) readAgainAttempt.current = { jobId: shown.id, key: crypto.randomUUID() }
    const { key } = readAgainAttempt.current
    setBusy(true); setStepFocus(null); setError(''); setNotice('')
    try {
      const created = await staffApi.createOcrJob(facilityId, shown.documentId, shown.patientId, key)
      readAgainAttempt.current = null
      if (!current()) { remember(created); return }
      if (created.id === shown.id) { setNotice('This is already the newest reading.'); return }
      show(created, shown.documentId); setAction(null)
      // A job OCR answers with that is already read (one it made for an earlier press, or one it reuses) is not polled.
      setStepFocus({ targets: ['ocr-job-title'], notice: jobInProgress(created.status)
        ? 'Reading the document again. This page updates by itself when it’s ready.'
        : created.status === 'awaiting_validation' ? 'The document has been read and is ready to check.' : `${jobStatusWords(created.status)}.` })
    }
    catch (caught) {
      // A refusal that names no job means no reading was made for this key: the next press sends a fresh key, never the
      // same one again (the server would answer it as the old job, now not found).
      const gone = isHidApiError(caught) && caught.status === 404 && caught.code === 'OCR_JOB_NOT_FOUND'
      if (gone || refusedWithoutJob(caught)) readAgainAttempt.current = null
      if (!current()) return
      // OCR answers a replayed key whose job is no longer open to this member with 404 OCR_JOB_NOT_FOUND
      // (ocr.service.ts createJob); a new key for a patient whose OK is missing is answered as needsPatientAccess says.
      setError(gone ? READING_GONE : needsPatientAccess(caught) ? STAFF_PAPER_NEEDS_ACCESS
        : errorText(caught, 'The document wasn’t sent for reading again.'))
      focus('ocr-read-again', true)
    }
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
      setJob(retried); remember(retried); setLookupRevision(value => value + 1); restartPolling(); setPollLong(null)
      setStepFocus({ targets: ['ocr-job-title'], notice: 'Retry requested.' })
    }
    catch (caught) { setRetryError(errorText(caught, 'The OCR job was not retried.')); focus('ocr-retry-submit', true) }
    finally { setBusy(false) }
  }

  /**
   * A clean document from Patient documents. With OCR job write it is sent for reading at once, as Create record would
   * (its job is looked up first, and opened if it has one), and its record opens without a form to fill in. Without,
   * Find document job holds it, to look it up.
   */
  function extract(documentId: string, documentPatientId: string, fileName?: string) {
    if (busy) return
    nameDocument(documentId, fileName)
    setFindDocument(documentId); setSearched(false); setJob(null); setNotice(''); setProblem(null); setStepFocus(null)
    setError(''); setCreateError('')
    if (!canWrite) { setReading(false); focus('ocr-document'); return }
    // IDs EHR gave that OCR would refuse go to the form, which says what is wrong with them.
    if (!UUID_V4.test(documentId) || !UUID_V4.test(documentPatientId)) { setReading(false); startNew(documentId); return }
    // Straight to the reading: the page says only READING_THE_PAGE until the record opens or the list says why not.
    setNewDocument(documentId); setReading(true)
    void openOrCreate(documentId, documentPatientId, {
      created: 'Reading the document. This page updates by itself when it’s ready.',
      existing: 'This document was sent for reading before, so that reading is shown.',
      uncheckable: 'The document couldn’t be checked, so it wasn’t sent for reading. Try again.',
      refused: 'The document wasn’t sent for reading.',
    }, message => { setReading(false); setNotice(''); setError(message); focus('ocr-find-submit', true) })
      // The documents list is hidden once the record opens, so focus goes to the page's heading, as on opening a record.
      .then(opened => { setReading(false); if (opened) focus('migrate-view-title') })
  }

  // The page opens as today's Migrate and Document OCR pages do: at a facility, with OCR job read.
  if (!facilityId || !canRead) return <DeptPage title="Document OCR">
    <DeptNotice tone="critical" role="alert">{NO_DOCUMENT_OCR}</DeptNotice>
  </DeptPage>

  const detail = view === 'detail' && canRead && visibleJob ? visibleJob : null
  const creating = view === 'new' && canWrite
  const quality = view === 'quality' && readsQuality
  const title = detail ? jobName(detail, fileNames) : creating ? 'New document job' : quality ? 'Reading quality' : 'Document OCR'
  // Mounted throughout, in the same place in every view, so a message put in it is announced.
  const status = <div key="status" id="ocr-status" role="status" className="hid-ehr-dept-migrate-status">{notice && <DeptNotice tone="positive">{notice}</DeptNotice>}</div>
  return <>
    {/* While a document is checked and sent for reading, this line is all the page shows. Mounted throughout (empty
        otherwise), so the line is announced when it appears. */}
    <div key="reading" id="ocr-reading" role="status" className="hid-ehr-dept hid-ehr-dept-migrate-starting">
      {reading && <p>{READING_THE_PAGE}</p>}
    </div>
    {!reading && <DeptPage key="page" title={<ViewTitle>{title}</ViewTitle>} onBack={detail || creating ? backToList : quality ? backFromQuality : undefined}
      primaryAction={!detail && !creating && !quality && canWrite ? <EhrButton onClick={() => startNew()}>Create record</EhrButton> : undefined}
      secondaryActions={!detail && !creating && !quality && qualityOffered
        ? <EhrButton id="ocr-quality-open" variant="secondary" onClick={openQuality}>Reading quality</EhrButton> : undefined}>
      {status}
      {detail ? <Fragment key="detail">{jobRecord(detail)}</Fragment> : creating ? <Fragment key="new">{newJob()}</Fragment>
        : quality ? <Fragment key="quality"><ReadingQualityView facilityId={facilityId} finishedWeeksOnly={reader === 'facility_manager'} /></Fragment> : <Fragment key="list">{jobList()}</Fragment>}
      <EhrDrawer open={quick !== null} title="Record quick view" onClose={() => setQuick(null)}>
        {quick && <div className="hid-ehr-dept-migrate-quick">
          <h3>{jobName(quick.job, fileNames)}</h3>
          <p className="hid-ehr-dept-muted">{`Last read ${dateText(quick.readAt)}`}</p>
          <DeptFacts facts={jobFacts(quick.job)} />
          <div className="hid-ehr-dept-form-actions"><EhrButton onClick={() => openRecord(quick.job)}>Open full record</EhrButton></div>
        </div>}
      </EhrDrawer>
    </DeptPage>}
    {/* Mounted in every view and hidden outside the list (and while a document is sent for reading), so going back to
        the list does not read the patient, the consent, the encounters and the documents again (each read is audited),
        and keeps the encounter and page chosen. */}
    <div key="capture" hidden={Boolean(detail || creating || quality || reading)}>
      <div className="hid-ehr-dept">
        <DocumentCapture facilityId={facilityId} permissions={permissions} onExtract={extract} paused={Boolean(detail || creating || quality || reading)} />
      </div>
    </div>
  </>

  // Render functions, not components: a component declared here would be a new type on each render, and remount.
  function jobList() {
    const shown = rows.filter(row => matchesSearch(search, [row.job.documentId, fileNames.get(row.job.documentId), shortId(row.job.documentId), row.job.id,
      statusWords(row.job.status), jobStatusWords(row.job.status), row.job.provider, row.job.patientId]))
    const nothingFound = searched && !visibleJob && currentDocument !== ''
    if (!canRead) return <DeptSection title="Document OCR">
      <DeptNotice tone="critical">{NO_DOCUMENT_OCR}</DeptNotice>
    </DeptSection>
    return <>
      <DeptSearch label="Search Document OCR" value={search} onChange={setSearch}
        hint="OCR has no facility-wide job list: jobs you find or create here are listed until you leave this page."
        filters={search ? <div className="hid-ehr-dept-migrate-clear"><EhrButton variant="secondary" onClick={() => setSearch('')}>Clear search</EhrButton></div> : undefined}>
        <EhrDataTable caption="OCR jobs opened on this page" captionHidden rows={shown} rowKey={row => row.job.id}
          emptyTitle="No matching records"
          emptyMessage={rows.length ? 'Change your search.' : 'Find a job by its document ID, or create one when you have the appropriate permission.'}
          columns={[
            { id: 'record', header: 'Record', cell: row => <DeptRecordName id={`ocr-row-${row.job.id}`} name={jobName(row.job, fileNames)}
              onOpen={() => openRecord(row.job)} /> },
            { id: 'patient', header: 'Patient / context', cell: row => <div className="hid-ehr-dept-record-name">
              <span>{patientWords(row.job)}</span>
              <span className="hid-ehr-dept-reference">{`${row.job.provider} · version ${row.job.version ?? 'unknown'}`}</span></div> },
            { id: 'status', header: 'Status', cell: row => <EhrBadge tone={statusTone(row.job.status)}>{jobStatusWords(row.job.status)}</EhrBadge> },
            { id: 'read', header: 'Last read', cell: row => dateText(row.readAt) },
            { id: 'actions', header: <span className="hid-ehr-sr-only">Actions</span>, cell: row => <div className="hid-ehr-dept-table-actions">
              <EhrButton variant="secondary" aria-describedby={`ocr-row-${row.job.id}`} onClick={() => setQuick(row)}>Quick view</EhrButton>
              <DeptLinkButton describedBy={`ocr-row-${row.job.id}`} onClick={() => openRecord(row.job)}>Open <span aria-hidden="true">→</span></DeptLinkButton>
            </div> },
          ]} />
      </DeptSearch>
      <DeptSection title="Find document job" headingId="ocr-find-title">
        <p className="hid-ehr-dept-muted">Use the document ID from an authorized clinical record. The document must be available and virus scan clean before extraction can begin.</p>
        <form className="hid-ehr-dept-form hid-ehr-dept-migrate-find" noValidate aria-labelledby="ocr-find-title" onSubmit={event => void find(event)}>
          <EhrField label={<>Document ID<span aria-hidden="true"> *</span></>} controlId="ocr-document" error={problemText(problem, 'ocr-document')}>
            <EhrInput value={findDocument} required autoComplete="off"
              onChange={event => { setFindDocument(event.target.value); setSearched(false); setJob(null); setNotice(''); setProblem(null); setStepFocus(null) }} />
          </EhrField>
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
        {error === STAFF_PAPER_NEEDS_ACCESS && <PatientAccessLinks permissions={permissions} />}
      </DeptSection>
    </>
  }

  function newJob() {
    return <DeptSection>
      <NewJobPick facilityId={facilityId!} permissions={permissions} preselect={newDocument} busy={busy} onPick={picked => void create(picked)}>
        <FormRefusal error={createError} />
        {createError === STAFF_PAPER_NEEDS_ACCESS && <PatientAccessLinks permissions={permissions} />}
      </NewJobPick>
    </DeptSection>
  }

  /** What OCR read from the document, its newest extraction, shown as it is: Check and save follows it on the page. */
  function readOut(extraction: OcrExtraction, shown: OcrJob) {
    // A reading blanked after 7 days (hid-system 0110, 0112) says so, never an empty review.
    if (readingDeleted(extraction)) return <DeptSection title="What was read" headingId="ocr-read-title"><p role="note" className="hid-ehr-dept-muted">{READING_DELETED}</p></DeptSection>
    // A paper reading shows its items; a payload that says it is one but is not whole shows only the text and says the
    // items must be entered by hand, never its parts as loose fields; any other payload shows its named fields.
    const reading = parsePaperReading(extraction.structuredPayload)
    const notWhole = !reading && claimsPaperReading(extraction.structuredPayload)
    const fields = reading || notWhole ? [] : extractedFields(extraction.structuredPayload)
    // Read again, only before a check is saved: for a reading waiting to be checked, one that failed, or one rejected,
    // and never once the patient is confirmed. A checked or saved reading read again could be saved into the record twice.
    const canReadAgain = canWrite && READ_AGAIN_STATUSES.has(shown.status) && !shown.patientConfirmation
      && !!shown.patientId && UUID_V4.test(shown.patientId) && UUID_V4.test(shown.documentId)
    const actions = reading || canReadAgain ? <div className="hid-ehr-dept-migrate-read-actions">
      {reading && <PaperReadingSummary reading={reading} />}
      {canReadAgain && <EhrButton id="ocr-read-again" size="sm" variant="secondary" busy={busy} onClick={() => void readAgain(shown)}>Read again</EhrButton>}
    </div> : undefined
    return <DeptSection title="What was read" headingId="ocr-read-title" actions={actions}>
      {/* A paper reading says how sure it is under its Details, and only when it may not be complete. */}
      {reading && <PaperReadingWarnings reading={reading} confidence={extraction.confidence} />}
      {!reading && extraction.confidence != null && <p className="hid-ehr-dept-muted">{confidenceWords(extraction.confidence)}</p>}
      {reading && <PaperReadingView reading={reading} />}
      {notWhole && <p role="note" className="hid-ehr-dept-muted">{NOT_WHOLE_WORDS}</p>}
      {fields.length > 0 && <DeptFacts facts={fields} />}
      {/* A paper reading's items are what staff check, so its scanned text is not shown; without items the text shows as it is. */}
      {!showsItems(reading) && (hasText(extraction.rawText)
        ? scannedText(extraction.rawText)
        : <p className="hid-ehr-dept-muted">No text was read from this document.</p>)}
    </DeptSection>
  }

  /**
   * A job's record, as one page in the order the work goes: its progress (and Retry job when the reading failed); what
   * was read; Check and save, on the page once the reading is ready to check; Confirm the patient, on the page once it
   * is checked; then the review and publication history. The record's facts, Refresh status, Reject reading and the
   * extractions wait under Details, closed.
   */
  function jobRecord(shown: OcrJob) {
    const canRetry = canRetryJob && permissions.includes('ocr.job.write')
    const canReview = shown.status === 'awaiting_validation' && permissions.includes('ocr.validation.write') && extractions !== null
    const canConfirm = shown.status === 'validated' && !shown.patientConfirmation && permissions.includes('ocr.patient.confirm')
    const retrying = action === 'retry' && canRetry
    // Reject reading is a review of its own, and shares the check's fields: while it is open, the check waits.
    const rejecting = action === 'reject' && canReview
    const toggle = (id: ActionId) => { setProblem(null); setAction(action === id ? null : id) }
    const stopped = pollStop?.jobId === shown.id ? pollStop.reason : null
    const progress = !jobInProgress(shown.status) ? ''
      : stopped === 'slow' ? STILL_READING
      : stopped === 'failed' ? 'The document’s progress couldn’t be checked just now. Choose Check now to try again.'
      : pollLong === shown.id ? READING_LONG
      : 'The document is being read. This page updates by itself every few seconds.'
    const read = extractions ? newestExtraction(extractions) : undefined
    // Past Checked, Progress says the steps done since: the patient confirmed, then published.
    const progressWords = (job: OcrJob) => (validations ?? []).some(item => published.has(item.id)) ? 'Published'
      : job.status === 'validated' && job.patientConfirmation ? 'Patient confirmed' : jobStatusWords(job.status)
    return <>
      {/* The status is said once, in Progress, so the record doesn't open with the same badge twice. */}
      <DeptContextLine items={[patientWords(shown)]} />
      {permissions.includes('ehr.document.read') && <div className="hid-ehr-dept-migrate-back">
        <DeptLinkButton id="ocr-back-documents" onClick={backToDocuments}><span aria-hidden="true">← </span>Back to documents</DeptLinkButton>
      </div>}
      {error && <DeptNotice tone="critical" role="alert">{error}</DeptNotice>}
      {error === STAFF_PAPER_NEEDS_ACCESS && <PatientAccessLinks permissions={permissions} />}
      <DeptSection title="Progress" headingId="ocr-job-title">
        <p className="hid-ehr-dept-migrate-state"><EhrBadge tone={statusTone(shown.status)}>{progressWords(shown)}</EhrBadge></p>
        {progress && <p id="ocr-progress" className="hid-ehr-dept-muted hid-ehr-dept-migrate-after">{progress}</p>}
        {/* One read of the job, then reading it by itself again; focus then goes to the record, as Check now is gone. */}
        {progress && stopped && <div className="hid-ehr-dept-form-actions">
          <EhrButton id="ocr-check-now" variant="secondary" busy={busy} aria-describedby="ocr-progress"
            onClick={() => { if (!busy) void lookup(currentDocument).then(result => focus(result?.job ? ['ocr-job-title', 'ocr-find-submit'] : 'ocr-find-submit', true)) }}>
            Check now</EhrButton>
        </div>}
        {shown.status === 'failed' && !canRetryJob && <p className="hid-ehr-dept-muted hid-ehr-dept-migrate-after">The extraction attempt limit has been reached. This job cannot be retried.</p>}
        {canRetry && <div className="hid-ehr-dept-form-actions">
          <EhrButton id="ocr-action-retry" variant="secondary" aria-expanded={retrying} onClick={() => toggle('retry')}>Retry job</EhrButton>
        </div>}
        {retrying && <form key={`retry-${shown.id}-${shown.version}`} className="hid-ehr-dept-form hid-ehr-dept-action-form" noValidate aria-label="Retry job" onSubmit={event => void retry(event)}>
          <EhrField label={<>Retry reason<span aria-hidden="true"> *</span></>} controlId="ocr-retry-reason" error={problemText(problem, 'ocr-retry-reason')}>
            <EhrTextarea name="reason" minLength={8} maxLength={500} required />
          </EhrField>
          <FormRefusal error={retryError} />
          <div className="hid-ehr-dept-form-actions"><EhrButton id="ocr-retry-submit" type="submit" busy={busy} disabled={!shown.version}>{busy ? 'Saving…' : 'Retry job'}</EhrButton></div>
        </form>}
      </DeptSection>
      {read && readOut(read, shown)}
      {canReview && <DeptSection title="Check and save" headingId="ocr-check-title">
        {rejecting
          ? <p className="hid-ehr-dept-muted">You’re rejecting this reading. Open Details and close Reject reading to check and save it instead.</p>
          : <ReviewForm key={`validate-${shown.id}-${shown.version}-${read?.id ?? 'none'}`} facilityId={facilityId!} job={shown} extractions={extractions ?? []}
            permissions={permissions} disposition="validated" onChanged={() =>
              // The next step, confirming the source patient, is then on the page where the work continues.
              afterStep(['ocr-confirm-title', 'ocr-job-title'], 'Review recorded.', true)} />}
      </DeptSection>}
      {canConfirm && <DeptSection title="Confirm the patient" headingId="ocr-confirm-title">
        <ConfirmForm key={`confirm-${shown.id}-${shown.version}`} facilityId={facilityId!} job={shown} permissions={permissions} onChanged={async message => {
          // An answer that the job was confirmed already is said only once the job has been read again.
          if (message) {
            const reloaded = await lookup(currentDocument)
            setStepFocus({ targets: reloaded ? ['ocr-history-title', 'ocr-job-title', 'ocr-find-submit'] : ['ocr-find-submit'], notice: reloaded ? message : undefined })
            return
          }
          await afterStep(['ocr-history-title', 'ocr-job-title'], 'Source patient confirmed.')
        }} />
      </DeptSection>}
      {validations && validations.length > 0 && <DeptSection title="Review and publication history" headingId="ocr-history-title">
        <ul className="hid-ehr-dept-rows">{validations.map(validation => <ReviewPublication key={validation.id} actorId={actorId} facilityId={facilityId!} patientId={shown.patientId}
          validation={validation} confirmationId={shown.patientConfirmation?.id} permissions={permissions}
          publicationAttempts={publicationAttempts.current} onPublished={notePublished} onChanged={() => afterStep(['ocr-history-title', 'ocr-job-title'], 'Publication recorded.')} />)}</ul>
      </DeptSection>}
      {/* Closed until opened, and closed again for another job: what the record holds beyond the work. */}
      <details key={`details-${shown.id}`} id="ocr-details" className="hid-ehr-card hid-ehr-dept-section hid-ehr-dept-migrate-more">
        <summary>Details</summary>
        <DeptFacts facts={jobFacts(shown)} />
        <div className="hid-ehr-dept-form-actions">
          <EhrButton id="ocr-refresh-submit" variant="secondary" busy={busy}
            onClick={() => void lookup(currentDocument).then(result => focus(result ? ['ocr-refresh-submit', 'ocr-find-submit'] : 'ocr-find-submit', true))}>
            Refresh status</EhrButton>
          {canReview && <EhrButton id="ocr-action-reject" variant="secondary" aria-expanded={rejecting} onClick={() => toggle('reject')}>Reject reading</EhrButton>}
        </div>
        {rejecting && <div className="hid-ehr-dept-migrate-action">
          <ReviewForm key={`reject-${shown.id}-${shown.version}`} facilityId={facilityId!} job={shown} extractions={extractions ?? []}
            permissions={permissions} disposition="rejected" onChanged={() => afterStep(['ocr-job-title'], 'Rejection recorded.')} />
        </div>}
        <DeptHistory title="Extractions" empty={extractions === null ? 'Loading extractions…' : 'No extraction is available yet.'}
          entries={(extractions ?? []).map(extraction => ({
            key: extraction.id,
            summary: [`Extraction ${extraction.version}`, extraction.provider, extraction.confidence != null ? `confidence ${Math.round(extraction.confidence * 100)}%` : ''].filter(Boolean).join(' · '),
            // An extraction with no text, or a paper reading whose items were picked out, shows its summary line alone.
            // A reading deleted after 7 days says so and never shows text, even if the server still sent some.
            detail: readingDeleted(extraction)
              ? <p className="hid-ehr-dept-muted">{READING_DELETED}</p>
              : hasText(extraction.rawText) && !showsItems(parsePaperReading(extraction.structuredPayload))
              // It scrolls, so it takes focus: a keyboard can then scroll it.
              ? <pre tabIndex={0} role="region" aria-label={`Extracted text, version ${extraction.version}`} className="hid-ehr-dept-pre hid-ehr-dept-migrate-text">{extraction.rawText}</pre>
              : undefined,
          }))} />
      </details>
    </>
  }
}
