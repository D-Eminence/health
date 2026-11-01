import { useEffect, useRef, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { EhrBadge, EhrButton, EhrField, EhrInput, EhrSelect, EhrTextarea, type EhrBadgeTone } from '@hid/ui/ehr'
import {
  staffApi, type LabImport, type OcrExtraction, type OcrJob, type OcrPublication, type OcrTargetDomain, type OcrValidation,
  type OcrValidationInput, type PharmacyImport,
} from '../../../staff/api'
import { FieldInputError, problemText, refusal, type FieldProblem } from '../../../staff/fieldProblem'
import { useFocusById } from '../../../staff/focus'
import { DeptNotice } from '../parts/DeptNotice'
import { errorText } from '../parts/errors'
import { dateText } from '../parts/format'

/*
 * The steps of an OCR job as today's Document OCR page takes them (staff/routes/Operations.tsx Ocr): review an
 * extraction, confirm the source patient, publish validated evidence and read what a Lab or Pharmacy publication
 * imported. The same checks, API calls and arguments; the markup and words are the design's.
 */

/** OCR takes document and patient IDs only as version 4 UUIDs (ocr-api DTOs, @IsUUID('4')). */
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** A status as the design shows it: lower case words. */
export function statusWords(status: string) {
  return status.replaceAll('_', ' ').toLowerCase()
}

/** The design's single badge; a state that needs attention is critical, its word says which. */
export function statusTone(status: string): EhrBadgeTone {
  return status === 'failed' || status === 'rejected' ? 'critical' : 'brand'
}

/** What a form says once a request is refused: the refusal, and the design's line on what to do next. */
export function FormRefusal({ error }: { readonly error: string }) {
  if (!error) return null
  return <>
    <DeptNotice tone="critical" role="alert" className="hid-ehr-dept-migrate-form-error">{error}</DeptNotice>
    <p className="hid-ehr-dept-muted">Correct the issue or retry using the same button. No success is reported until saved.</p>
  </>
}

const candidateTypes = {
  EHR: 'clinical_note', LAB: 'lab_document', PHARMACY: 'historical_medication_evidence',
  DOCUMENT_ONLY: 'document_only', UNCLASSIFIED: 'unclassified',
} as const

const publicationOperations = {
  EHR: 'create_imported_clinical_note', LAB: 'create_imported_lab_evidence',
  PHARMACY: 'create_imported_medication_evidence', DOCUMENT_ONLY: 'retain_validated_document',
} as const

function jsonObject(value: FormDataEntryValue | null, label: string, field: string): Record<string, unknown> {
  let parsed: unknown
  try { parsed = JSON.parse(String(value ?? '')) } catch { throw new FieldInputError(field, `${label} must be valid JSON.`) }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new FieldInputError(field, `${label} must be a JSON object.`)
  return parsed as Record<string, unknown>
}

function jsonObjectArray(value: FormDataEntryValue | null, label: string, field: string): Record<string, unknown>[] {
  let parsed: unknown
  try { parsed = JSON.parse(String(value ?? '')) } catch { throw new FieldInputError(field, `${label} must be valid JSON.`) }
  if (!Array.isArray(parsed) || parsed.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new FieldInputError(field, `${label} must be a JSON array of objects.`)
  return parsed as Record<string, unknown>[]
}

/**
 * "Validate extraction" or "Reject extraction": one review of an extraction, with the decision the action named.
 * A rejection is sent as UNCLASSIFIED, as today.
 */
export function ReviewForm({ facilityId, job, extractions, disposition, onChanged }: {
  readonly facilityId: string; readonly job: OcrJob; readonly extractions: OcrExtraction[]; readonly disposition: 'validated' | 'rejected'
  readonly onChanged: (disposition: 'validated' | 'rejected') => Promise<void>
}) {
  const [extractionId, setExtractionId] = useState(extractions.at(-1)?.id ?? '')
  const [domain, setDomain] = useState<OcrTargetDomain>('DOCUMENT_ONLY')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [problem, setProblem] = useState<FieldProblem | null>(null)
  const focus = useFocusById()
  const selected = extractions.find(item => item.id === extractionId)
  // Read in the order the fields appear, so the first refused one is the one focused.
  function read(form: FormData): OcrValidationInput {
    if (!selected) throw new FieldInputError('ocr-review-extraction', 'Choose an extraction to review.')
    const validatedPayload = jsonObject(form.get('validatedPayload'), 'Reviewed payload', 'ocr-reviewed-payload')
    const acceptedFields = jsonObject(form.get('acceptedFields'), 'Accepted fields', 'ocr-accepted-fields')
    const rejectedFields = jsonObjectArray(form.get('rejectedFields'), 'Rejected fields', 'ocr-rejected-fields')
    const corrections = jsonObjectArray(form.get('corrections'), 'Corrections', 'ocr-corrections')
    const reason = String(form.get('reason') ?? '').trim()
    if (!reason) throw new FieldInputError('ocr-review-reason', 'Complete this field.')
    if (reason.length < 8) throw new FieldInputError('ocr-review-reason', 'Enter a review reason of at least 8 characters.')
    const targetDomain = disposition === 'rejected' ? 'UNCLASSIFIED' : domain
    return { extractionId: selected.id, validatedPayload, acceptedFields, rejectedFields, corrections,
      disposition, targetDomain, candidateType: candidateTypes[targetDomain], reason }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(''); setProblem(null)
    let input: OcrValidationInput
    try { input = read(new FormData(event.currentTarget)) }
    catch (caught) {
      if (!(caught instanceof FieldInputError)) throw caught
      setProblem(refusal({ field: caught.field, message: caught.message })); focus(caught.field); return
    }
    setBusy(true)
    try {
      await staffApi.validateOcrJob(facilityId, job, input)
      await onChanged(input.disposition)
    } catch (caught) { setError(errorText(caught, 'The review was not recorded. Refresh the job and try again.')); focus('ocr-review-submit', true) }
    finally { setBusy(false) }
  }
  if (!extractions.length) return <p className="hid-ehr-dept-muted">An extraction must be available before review.</p>
  const label = disposition === 'rejected' ? 'Reject extraction' : 'Validate extraction'
  return <form className="hid-ehr-dept-form hid-ehr-dept-action-form" noValidate aria-label={label} onSubmit={event => void submit(event)}>
    <p className="hid-ehr-dept-muted">Check the extracted text first. Only validated evidence can be published.</p>
    <EhrField label="Extraction" controlId="ocr-review-extraction" error={problemText(problem, 'ocr-review-extraction')}>
      <EhrSelect value={extractionId} onChange={event => setExtractionId(event.target.value)}>
        {extractions.map(item => <option key={item.id} value={item.id}>Version {item.version} · {item.provider}</option>)}
      </EhrSelect>
    </EhrField>
    {disposition === 'validated' && <EhrField label="Owning domain" controlId="ocr-review-domain">
      <EhrSelect value={domain} onChange={event => setDomain(event.target.value as OcrTargetDomain)}>
        <option value="DOCUMENT_ONLY">Retain validated document</option><option value="EHR">Clinical note</option>
        <option value="LAB">Historical lab evidence</option><option value="PHARMACY">Historical medication evidence</option>
      </EhrSelect>
    </EhrField>}
    {/* A JSON object field is described by its error, when refused, and by what the owning domains require. */}
    <EhrField label={<>Reviewed payload (JSON object)<span aria-hidden="true"> *</span></>} controlId="ocr-reviewed-payload"
      error={problemText(problem, 'ocr-reviewed-payload')}>
      <EhrTextarea key={`payload-${selected?.id}`} name="validatedPayload" rows={7} spellCheck={false} required aria-describedby="ocr-review-requirements"
        defaultValue={JSON.stringify(selected?.structuredPayload && typeof selected.structuredPayload === 'object' && !Array.isArray(selected.structuredPayload) ? selected.structuredPayload : {}, null, 2)} />
    </EhrField>
    <EhrField label={<>Accepted fields (JSON object)<span aria-hidden="true"> *</span></>} controlId="ocr-accepted-fields"
      error={problemText(problem, 'ocr-accepted-fields')}>
      <EhrTextarea name="acceptedFields" rows={6} spellCheck={false} defaultValue="{}" required aria-describedby="ocr-review-requirements" />
    </EhrField>
    <p id="ocr-review-requirements" className="hid-ehr-hint">A clinical note needs encounterId, noteType, title and content. Lab evidence needs observations. Medication evidence needs medicationText. A retained document can use an empty object.</p>
    <EhrField label={<>Rejected fields (JSON array)<span aria-hidden="true"> *</span></>} controlId="ocr-rejected-fields"
      error={problemText(problem, 'ocr-rejected-fields')}>
      <EhrTextarea name="rejectedFields" spellCheck={false} defaultValue="[]" required />
    </EhrField>
    <EhrField label={<>Corrections (JSON array)<span aria-hidden="true"> *</span></>} controlId="ocr-corrections" error={problemText(problem, 'ocr-corrections')}>
      <EhrTextarea name="corrections" spellCheck={false} defaultValue="[]" required />
    </EhrField>
    <EhrField label={<>Review reason<span aria-hidden="true"> *</span></>} controlId="ocr-review-reason" error={problemText(problem, 'ocr-review-reason')}>
      <EhrTextarea name="reason" minLength={8} maxLength={500} required />
    </EhrField>
    <FormRefusal error={error} />
    <div className="hid-ehr-dept-form-actions"><EhrButton id="ocr-review-submit" type="submit" busy={busy}>{busy ? 'Saving…' : label}</EhrButton></div>
  </form>
}

/**
 * "Confirm source patient". OCR takes one patient confirmation per job version. A retry of the same confirmation
 * reuses its key, so OCR answers with the one it recorded; if the job was confirmed already, it is reloaded rather
 * than left with a dead form.
 */
export function ConfirmForm({ facilityId, job, onChanged }: {
  readonly facilityId: string; readonly job: OcrJob; readonly onChanged: (notice?: string) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [problem, setProblem] = useState<FieldProblem | null>(null)
  const focus = useFocusById()
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    const patientId = String(form.get('patientId') ?? '').trim()
    const reason = String(form.get('reason') ?? '').trim()
    setError(''); setProblem(null)
    const refused = !patientId ? { field: 'ocr-confirm-patient', message: 'Complete this field.' }
      : !UUID_V4.test(patientId) ? { field: 'ocr-confirm-patient', message: 'Enter a valid canonical patient ID (a UUID).' }
      : !reason ? { field: 'ocr-confirm-reason', message: 'Complete this field.' }
      : reason.length < 8 ? { field: 'ocr-confirm-reason', message: 'Enter a patient confirmation reason of at least 8 characters.' } : null
    if (refused) { setProblem(refusal(refused)); focus(refused.field); return }
    const signature = JSON.stringify([patientId, reason])
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    setBusy(true)
    try { await staffApi.confirmOcrPatient(facilityId, job, patientId, reason, attempt.current.key); attempt.current = null; await onChanged() }
    catch (caught) {
      if (isHidApiError(caught) && caught.code === 'OCR_PATIENT_ALREADY_CONFIRMED') {
        await onChanged('The source patient of this job was already confirmed, so the job was reloaded.')
        return
      }
      setError(isHidApiError(caught) && caught.code === 'OCR_PATIENT_MISMATCH' ? 'The patient you chose doesn’t match the patient on the document. Check the patient and try again.'
        : errorText(caught, 'The patient confirmation was not recorded.'))
      focus('ocr-confirm-submit', true)
    }
    finally { setBusy(false) }
  }
  return <form className="hid-ehr-dept-form hid-ehr-dept-action-form" noValidate aria-label="Confirm source patient" onSubmit={event => void submit(event)}>
    <p className="hid-ehr-dept-muted">Check the patient against the source document before publishing. Health ID checks for an exact match and write access.</p>
    <EhrField label={<>Canonical patient ID<span aria-hidden="true"> *</span></>} controlId="ocr-confirm-patient" error={problemText(problem, 'ocr-confirm-patient')}>
      <EhrInput name="patientId" defaultValue={job.patientId ?? ''} required autoComplete="off" />
    </EhrField>
    <EhrField label={<>Confirmation reason<span aria-hidden="true"> *</span></>} controlId="ocr-confirm-reason" error={problemText(problem, 'ocr-confirm-reason')}>
      <EhrTextarea name="reason" minLength={8} maxLength={500} required />
    </EhrField>
    <FormRefusal error={error} />
    <div className="hid-ehr-dept-form-actions"><EhrButton id="ocr-confirm-submit" type="submit" busy={busy}>{busy ? 'Saving…' : 'Confirm source patient'}</EhrButton></div>
  </form>
}

/** Publication failures OCR attempts again; any other failure is final (hid-system ocr.service.ts RETRYABLE_PUBLICATION_FAILURES). */
const RETRYABLE_PUBLICATION_FAILURES: readonly string[] = ['OWNING_SERVICE_UNAVAILABLE', 'REQUEST_IN_PROGRESS']

function attemptsLeft(publication: OcrPublication) {
  return publication.attemptCount == null || publication.maxAttempts == null || publication.attemptCount < publication.maxAttempts
}

/**
 * A publication OCR takes further, but only for the request that started it, sent again with its key: one not
 * finished (pending, or processing, which OCR takes back once its claim expires) or one that failed for a reason OCR
 * attempts again, while attempts remain. No worker runs publications (hid-system ocr.service.ts executePublication).
 */
function resumable(publication: OcrPublication) {
  return (publication.status === 'pending' || publication.status === 'processing'
    || (publication.status === 'failed' && RETRYABLE_PUBLICATION_FAILURES.includes(publication.failureCode ?? ''))) && attemptsLeft(publication)
}

/** OCR's wait after a failed attempt before it takes the publication again (ocr.service.ts executePublication, next_attempt_at). */
const PUBLICATION_RETRY_WAIT_MS = 15_000
export const PUBLICATION_RETRY_WAIT = 'OCR allows another attempt about 15 seconds after a failure.'

/** A publication request this page sent: the Idempotency-Key it goes with, and when OCR takes a failed one again. */
export interface PublicationAttempt { readonly key: string; retryAt: number }

function publicationRefusal(caught: unknown) {
  // OCR answers it also after the last attempt (INTERFACE_CONTRACT.md, OCR publication).
  if (isHidApiError(caught) && caught.code === 'OCR_PUBLICATION_IN_PROGRESS') return 'OCR did not start another attempt: one is still running, it is too soon after the last one, or no attempts remain.'
  if (isHidApiError(caught) && caught.code === 'OCR_PUBLICATION_TERMINAL') return 'The owning service refused this publication, so it cannot be retried.'
  return errorText(caught, 'The validated evidence was not published.')
}

const publishedAs: Partial<Record<OcrTargetDomain, string>> = {
  EHR: 'Published as a clinical note in the patient\'s record.',
  LAB: 'Published as imported lab evidence in the patient\'s record.',
  PHARMACY: 'Published as imported medication evidence in the patient\'s record.',
  DOCUMENT_ONLY: 'Kept as a validated document in the patient\'s record.',
}

function observationText(item: LabImport['observations'][number]) {
  const result = [item.value && `${item.value}${item.unit ? ` ${item.unit}` : ''}`, item.valueText].filter(Boolean).join(' · ')
  const flag = item.abnormalFlag && item.abnormalFlag !== 'normal' && item.abnormalFlag !== 'unknown' ? `flagged ${item.abnormalFlag}` : ''
  // Lab stores every imported observation as 'reported' today, but a status it may add later is said, never hidden.
  const status = item.status && item.status !== 'reported' ? item.status.replaceAll('_', ' ') : ''
  return [result ? `${item.testName}: ${result}` : item.testName, item.referenceRange && `reference ${item.referenceRange}`, flag, status].filter(Boolean).join(' · ')
}

/**
 * Evidence a Lab or Pharmacy publication imported, read from its owning domain only when asked: each read is
 * audited. What was imported does not change, so a read that succeeded is kept; one that failed is made again on the
 * next opening.
 */
function ImportedEvidence({ facilityId, domain, importId }: { readonly facilityId: string; readonly domain: 'lab' | 'medication'; readonly importId: string }) {
  const [open, setOpen] = useState(false)
  const [evidence, setEvidence] = useState<{ lab?: LabImport; medication?: PharmacyImport; error?: string } | null>(null)
  const [reads, setReads] = useState(0)
  useEffect(() => {
    if (!reads) return
    let active = true
    const read = domain === 'lab' ? staffApi.labImport(facilityId, importId).then(lab => ({ lab }))
      : staffApi.pharmacyImport(facilityId, importId).then(medication => ({ medication }))
    void read.then(found => { if (active) setEvidence(found) })
      .catch(caught => { if (active) setEvidence({ error: errorText(caught, 'The imported evidence could not be read.') }) })
    return () => { active = false }
  }, [facilityId, domain, importId, reads])
  function toggle() {
    // Cleared here, with the opening, so a refusal is never shown over the read that follows it.
    if (!open && (reads === 0 || evidence?.error)) { setEvidence(null); setReads(value => value + 1) }
    setOpen(!open)
  }
  const lab = open ? evidence?.lab : undefined
  const medication = open ? evidence?.medication : undefined
  const status = !open ? '' : !evidence ? 'Loading imported evidence…'
    : lab ? `Imported lab evidence loaded: ${lab.observations.length} observation${lab.observations.length === 1 ? '' : 's'}.`
      : medication ? 'Imported medication evidence loaded.' : ''
  // A disclosure: its name stays the same, and aria-expanded says whether it is open.
  return <div className="hid-ehr-dept-migrate-evidence">
    <div><EhrButton variant="secondary" size="sm" aria-expanded={open} onClick={toggle}>{`Imported ${domain} evidence`}</EhrButton>
      {/* Mounted throughout, so what is put in it is announced; with the button, so it takes no space while empty. */}
      <div role="status">{status && <p className="hid-ehr-dept-muted">{status}</p>}</div></div>
    {open && evidence?.error && <DeptNotice tone="critical" role="alert">{evidence.error}</DeptNotice>}
    {lab && <>
      {lab.status && lab.status !== 'accepted' && <p>Import status: {lab.status.replaceAll('_', ' ')}</p>}
      {lab.externalLabName && <p>Reported by {lab.externalLabName}</p>}
      <ul className="hid-ehr-dept-migrate-list">{lab.observations.map(item => <li key={item.id}>{observationText(item)}</li>)}</ul>
    </>}
    {medication && <>
      <p className="hid-ehr-dept-strong">{medication.medicationText}</p>
      {(medication.strengthText || medication.doseText || medication.frequencyText) && <p>{[medication.strengthText, medication.doseText, medication.frequencyText].filter(Boolean).join(' · ')}</p>}
      {medication.historicalContext && <p className="hid-ehr-dept-muted">{medication.historicalContext}</p>}
    </>}
  </div>
}

/** What a publication made: named, and readable where its owning domain lets this role read it. Never its raw ID. */
function PublishedEvidence({ facilityId, publication, permissions }: { readonly facilityId: string; readonly publication: OcrPublication; readonly permissions: readonly string[] }) {
  const importId = publication.targetResourceId
  const domain = publication.targetResourceType === 'lab-imported-evidence' && permissions.includes('lab.import.read') ? 'lab'
    : publication.targetResourceType === 'pharmacy-imported-medication-evidence' && permissions.includes('pharmacy.import.read') ? 'medication' : null
  return <>
    <p>{publishedAs[publication.targetDomain] ?? 'Published.'}</p>
    {domain && importId && <ImportedEvidence facilityId={facilityId} domain={domain} importId={importId} />}
  </>
}

/**
 * A publication as OCR holds it, and what can take it further. `canPublish`: this viewer may publish this review now
 * (ocr.publication.write, with the job's current patient confirmation); `retryHere`: this page holds the key of the
 * request that made it, and offers Retry publication.
 */
function PublicationStatus({ facilityId, publication, permissions, canPublish, retryHere }: {
  readonly facilityId: string; readonly publication: OcrPublication; readonly permissions: readonly string[]; readonly canPublish: boolean; readonly retryHere: boolean
}) {
  const failed = publication.status === 'failed'
  const attempts = failed && publication.attemptCount != null && publication.maxAttempts != null ? ` · Attempt ${publication.attemptCount} of ${publication.maxAttempts}` : ''
  const unfinished = 'OCR has not finished this publication. Refresh the job status to see whether it has.'
  const failedText = !RETRYABLE_PUBLICATION_FAILURES.includes(publication.failureCode ?? '') ? 'It cannot be retried.'
    : !attemptsLeft(publication) ? 'The publication attempt limit has been reached. It cannot be retried.'
      : retryHere ? PUBLICATION_RETRY_WAIT
        : canPublish ? 'It can be retried only from the page where Publish was pressed, before that page is reloaded or left.' : ''
  // OCR claims a publication again only while attempts remain (ocr.service.ts executePublication), whichever page asks.
  const unfinishedText = !attemptsLeft(publication) ? `${unfinished} This is its last attempt: if it has stopped, it cannot be resumed.`
    : retryHere ? 'OCR has not finished this publication. If it has stopped, Retry publication resumes it; if it is still running, OCR says so.'
      : canPublish ? `${unfinished} If it has stopped, it can be resumed only from the page where Publish was pressed, before that page is reloaded or left.`
        : unfinished
  return <div className="hid-ehr-dept-migrate-publication">
    <p>Publication <EhrBadge tone={statusTone(publication.status)}>{statusWords(publication.status)}</EhrBadge>{publication.failureCode ? ` · ${publication.failureCode}` : ''}{attempts}</p>
    {failed && publication.failureSummary && <p>{publication.failureSummary}</p>}
    {failed && failedText && <p className="hid-ehr-dept-muted">{failedText}</p>}
    {(publication.status === 'pending' || publication.status === 'processing') && <p className="hid-ehr-dept-muted">{unfinishedText}</p>}
    {publication.status === 'published' && <PublishedEvidence facilityId={facilityId} publication={publication} permissions={permissions} />}
  </div>
}

/**
 * One review and its publication. OCR keeps one publication per review. The page sends each publication request with
 * one key, held in `publicationAttempts` (memory only, never browser storage), so a press after a lost answer or a
 * refusal sends the same request again, and OCR resumes the publication it recorded under that key. A refusal reads
 * the history again: the page then offers only what OCR would take, and says a publication was recorded when the
 * history shows one, though its answer was lost.
 */
export function ReviewPublication({ actorId, facilityId, validation, confirmationId, permissions, publicationAttempts, onChanged }: {
  readonly actorId: string | undefined; readonly facilityId: string; readonly validation: OcrValidation; readonly confirmationId: string | undefined
  readonly permissions: readonly string[]; readonly publicationAttempts: Map<string, PublicationAttempt>; readonly onChanged: () => Promise<void>
}) {
  const [publications, setPublications] = useState<OcrPublication[] | null>(null)
  const [historyError, setHistoryError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Counts changes to `publicationAttempts`, which `next` reads while rendering: each change renders again.
  const [, setHeldKeys] = useState(0)
  const focus = useFocusById()
  const publishId = `ocr-publish-${validation.id}`
  const retryId = `ocr-publish-retry-${validation.id}`
  const operation = validation.disposition === 'validated' && validation.targetDomain !== 'UNCLASSIFIED' ? publicationOperations[validation.targetDomain] : undefined
  // What a press sends, and so what its key is held for. OCR finds a publication by facility, requesting account and
  // key, so the key belongs to this validation and this requester: another account signed in here holds none for it.
  const request = actorId && permissions.includes('ocr.publication.write') && confirmationId && operation
    ? JSON.stringify([actorId, facilityId, validation.id, validation.version, confirmationId, operation]) : undefined
  useEffect(() => {
    let active = true
    void staffApi.ocrPublications(facilityId, validation.id).then(result => { if (active) setPublications(result.items) })
      .catch(caught => { if (active) setHistoryError(errorText(caught, 'The publication history could not be loaded.')) })
    return () => { active = false }
  }, [facilityId, validation.id])

  /**
   * The control that takes publication further: Publish before any request, Retry publication for this page's own
   * request. OCR does not say which request made a publication, so one is taken to be this page's while the page
   * holds a key for the request. Were this page's press never to have reached OCR, and another request made it, OCR
   * answers the retry 409 OCR_ALREADY_PUBLISHED, which drops the key.
   */
  function next(items: readonly OcrPublication[] | null) {
    if (!request || !items) return null
    if (items.length === 0) return publishId
    return publicationAttempts.has(request) && items.some(resumable) ? retryId : null
  }

  /** Holds a request's key, or drops it, and renders what that changes. */
  function hold(held: string, attempt: PublicationAttempt | null) {
    if (attempt) publicationAttempts.set(held, attempt)
    else publicationAttempts.delete(held)
    setHeldKeys(value => value + 1)
  }

  // Reads the history again, keeping what it showed until the answer arrives.
  async function reload(): Promise<OcrPublication[] | null> {
    try { const { items } = await staffApi.ocrPublications(facilityId, validation.id); setPublications(items); setHistoryError(''); return items }
    catch (caught) { setHistoryError(errorText(caught, 'The publication history could not be loaded.')); return null }
  }

  /** A publication the history read again shows, whatever answer was lost on the way: said, and the job read again. */
  async function recorded(items: readonly OcrPublication[] | null) {
    if (!request || !items?.some(item => item.status === 'published')) return false
    hold(request, null)
    await onChanged()
    return true
  }

  async function publish(retrying = false) {
    if (!request || !confirmationId || !operation || busy) return
    const held = publicationAttempts.get(request)
    // A failed publication is taken again only after OCR's wait: a press before then would be refused, so nothing is sent.
    const wait = retrying && held && publications?.some(item => item.status === 'failed') ? held.retryAt - Date.now() : 0
    if (wait > 0) {
      const seconds = Math.ceil(wait / 1000)
      setError(`${PUBLICATION_RETRY_WAIT} Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`)
      return
    }
    const attempt = held ?? { key: crypto.randomUUID(), retryAt: 0 }
    hold(request, attempt)
    setBusy(true); setError('')
    try {
      const publication = await staffApi.publishOcrValidation(facilityId, validation, confirmationId, operation, attempt.key)
      if (publication.status === 'published') { hold(request, null); await onChanged(); return }
      // Any other answer published nothing: show what OCR holds.
      const items = await reload()
      if (await recorded(items)) return
      focus(next(items ?? publications) ?? 'ocr-history-title', true)
    } catch (caught) {
      // That publication was requested with another key, so this request cannot resume it.
      const alreadyPublished = isHidApiError(caught) && caught.code === 'OCR_ALREADY_PUBLISHED'
      // The history shown is out of date then: it is not shown, nor Publish offered, until read again.
      if (alreadyPublished) { hold(request, null); setPublications(null) }
      // A failed attempt has OCR wait before the next: counted from this answer, which came after the failure.
      else attempt.retryAt = Date.now() + PUBLICATION_RETRY_WAIT_MS
      const items = await reload()
      if (await recorded(items)) return
      // Said once the history has been read again, so one alert says what happened.
      setError(alreadyPublished ? `This review already has a publication request${items ? ', shown below' : ''}.` : publicationRefusal(caught))
      // Any other history that could not be read again still shows as it was.
      focus(next(items ?? (alreadyPublished ? null : publications)) ?? 'ocr-history-title', true)
    }
    finally { setBusy(false) }
  }
  const action = next(publications)
  return <li className="hid-ehr-dept-migrate-review">
    <div className="hid-ehr-dept-row-main">
      <p className="hid-ehr-dept-row-title">{`Review ${validation.version} · ${validation.targetDomain}`}
        <EhrBadge tone={statusTone(validation.disposition)}>{statusWords(validation.disposition)}</EhrBadge></p>
      <p className="hid-ehr-dept-muted">{validation.reason} · {dateText(validation.reviewedAt)}</p>
      {error && <DeptNotice tone="critical" role="alert">{error}</DeptNotice>}
      {historyError && <DeptNotice tone="critical" role="alert">{historyError}</DeptNotice>}
      {publications === null && !historyError && <p className="hid-ehr-dept-muted" role="status">Loading publication history…</p>}
      {publications?.map(publication => <PublicationStatus key={publication.id} facilityId={facilityId} publication={publication}
        permissions={permissions} canPublish={request !== undefined} retryHere={action === retryId} />)}
    </div>
    {(action === publishId || action === retryId) && <div className="hid-ehr-dept-row-actions">
      {action === publishId && <EhrButton id={publishId} size="sm" busy={busy} onClick={() => void publish()}>{busy ? 'Working…' : `Publish to ${validation.targetDomain.replace('_', ' ')}`}</EhrButton>}
      {action === retryId && <EhrButton id={retryId} size="sm" busy={busy} onClick={() => void publish(true)}>{busy ? 'Working…' : 'Retry publication'}</EhrButton>}
    </div>}
  </li>
}
