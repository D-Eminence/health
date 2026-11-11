import { useEffect, useRef, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { EhrBadge, EhrButton, EhrField, EhrInput, EhrSelect, EhrTextarea, type EhrBadgeTone } from '@hid/ui/ehr'
import {
  isAllowedPatientLookup, staffApi, type Encounter, type PatientSummary, type LabAbnormalFlag, type LabImport, type OcrExtraction, type OcrJob, type OcrPublication, type OcrTargetDomain,
  type OcrValidation, type PharmacyImport,
} from '../../../staff/api'
import { problemText, refusal, type FieldProblem } from '../../../staff/fieldProblem'
import { useFocusById } from '../../../staff/focus'
import { useStaff } from '../../../staff/App'
import { visitClassLabel } from '../../../plainLabels'
import { DeptNotice } from '../parts/DeptNotice'
import { SERVICE_AUTH_UNAVAILABLE, errorText } from '../parts/errors'
import { birthDateText, dateText } from '../parts/format'
import { FLAG_WORDS } from '../laboratory/labText'
import { ItemCheck, ItemLineText, UnreadableLines, isUnreadable, itemLine, parsePaperReading, type PaperItem } from './paperReading'
import {
  SAVE_AS_WORDS, buildRejection, buildValidation, initialDecisions, itemCardId, itemResultId, keptText, itemTestId, itemTextId, labResult, labTest,
  keptMedicines, MAX_MEDICINES, offeredDomains, readingLine, TOO_MANY_MEDICINES, reviewItems, visitsForNote,
  type ItemChoice, type ItemDecision, type SaveAs,
} from './reviewPayload'

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

/**
 * What is happening to a document's reading, in plain words, by OCR's job status (hid-system ocr-api OcrJobStatus):
 * queued, processing and extracted are still being read; the others have finished, for now.
 */
const JOB_STATUS_WORDS: Readonly<Record<string, string>> = {
  queued: 'Waiting to be read',
  processing: 'Reading the document',
  extracted: 'Reading the document',
  awaiting_validation: 'Ready to check',
  validated: 'Checked',
  rejected: 'Not accepted',
  failed: 'Couldn’t read this document',
  cancelled: 'Stopped',
}

/** A document's reading status as a clinician reads it; one OCR adds later is shown as its own words. */
export function jobStatusWords(status: string) {
  return Object.hasOwn(JOB_STATUS_WORDS, status) ? JOB_STATUS_WORDS[status]! : statusWords(status)
}

/** OCR is still reading the document: the job has not reached a state that waits for a person or has ended. */
export function jobInProgress(status: string) {
  return status === 'queued' || status === 'processing' || status === 'extracted'
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

const publicationOperations = {
  EHR: 'create_imported_clinical_note', LAB: 'create_imported_lab_evidence',
  PHARMACY: 'create_imported_medication_evidence', DOCUMENT_ONLY: 'retain_validated_document',
} as const

/** OCR's refusals of a review's items for the domain it was saved as (ocr-publication-policy.ts), said as what to do. */
const REVIEW_ITEMS_REFUSED: ReadonlySet<string> = new Set([
  'OCR_INVALID_CLINICAL_NOTE', 'OCR_INVALID_LAB_EVIDENCE', 'OCR_INVALID_MEDICATION_EVIDENCE', 'OCR_CLASSIFICATION_MISMATCH', 'OCR_UNCLASSIFIED_CANDIDATE',
])
const SAVED_AS_PHRASE: Readonly<Record<SaveAs, string>> = {
  DOCUMENT_ONLY: 'the document only', EHR: 'a clinical note', LAB: 'past lab results', PHARMACY: 'past medicines',
}
/** Said when the account may read the document but not save a check of it (a view-only share, say). */
export const REVIEW_NOT_ALLOWED = 'You can read this document, but your access doesn’t let you save a check of it. Ask your facility administrator if you need to.'

/** Why a check was not saved, in plain words: never OCR's code or its own text. */
export function reviewRefusal(caught: unknown, saveAs: SaveAs | null): string {
  if (isHidApiError(caught) && caught.status === 403 && !SERVICE_AUTH_UNAVAILABLE.has(caught.code)) return REVIEW_NOT_ALLOWED
  if (isHidApiError(caught) && REVIEW_ITEMS_REFUSED.has(caught.code)) {
    return saveAs && saveAs !== 'DOCUMENT_ONLY'
      ? `This couldn’t be saved as ${SAVED_AS_PHRASE[saveAs]}. Check the items you kept, or choose Keep the document only.`
      : 'This couldn’t be saved. Check the items you kept and try again.'
  }
  return errorText(caught, 'The check was not saved. Refresh the page and try again.')
}

/** What each Save as choice adds to the patient's record, said under it. */
const SAVE_AS_HINTS: Readonly<Record<SaveAs, string>> = {
  DOCUMENT_ONLY: 'The document is kept in the patient’s record with the items you kept. Nothing is added to their medicines, results or notes.',
  EHR: 'The items you keep are written into one clinical note on the visit you choose.',
  LAB: 'Only the lab results you keep are added to the patient’s past lab results. Everything else stays with the document.',
  PHARMACY: 'Only the medicines you keep are added to the patient’s past medicines. Everything else stays with the document.',
}

const CHOICE_WORDS: Readonly<Record<ItemChoice, string>> = { keep: 'Keep', change: 'Change', remove: 'Remove' }

/** Words compared without case or extra spaces, so "Keep saves" is shown only when it says something new. */
function sameWords(words: string): string {
  return words.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * One item read from the paper, on one line as it is written, with Keep, Change and Remove; a Check mark and Why? when
 * to check. When what Keep saves is not the line as written, it is shown under it, so nothing is saved unseen.
 */
function ReviewItemCard({ item, index, decision, problem, onChange }: {
  readonly item: PaperItem; readonly index: number; readonly decision: ItemDecision; readonly problem: FieldProblem | null
  readonly onChange: (decision: ItemDecision) => void
}) {
  const cardId = itemCardId(index)
  const nameId = `${cardId}-name`
  const line = itemLine(item)
  const cardError = problemText(problem, cardId)
  const state = decision.choice === 'keep' ? 'Kept' : decision.choice === 'remove' ? 'Removed: it won’t be saved'
    : decision.choice === 'change' ? 'Changed: your words are saved' : 'Not chosen yet'
  // Kept and not chosen are what the pressed button already shows, so only a screen reader hears them.
  const stateSeen = decision.choice === 'remove' || decision.choice === 'change'
  const saved = keptText(item)
  const showSaved = decision.choice !== 'change' && decision.choice !== 'remove' && sameWords(saved) !== sameWords(line)
  return <li className="hid-ehr-dept-migrate-check-item" data-item-id={item.id}>
    <div id={cardId} role="group" tabIndex={-1} aria-labelledby={nameId} aria-describedby={cardError ? `${cardId}-error` : undefined}
      aria-invalid={cardError ? true : undefined}>
      <div className="hid-ehr-dept-migrate-check-head">
        <strong id={nameId}><ItemLineText item={item} /></strong>
        <ItemCheck item={item} />
        <div className="hid-ehr-dept-migrate-check-choices">
          {(['keep', 'change', 'remove'] as const).map(choice => <EhrButton key={choice} size="sm" variant={decision.choice === choice ? 'primary' : 'secondary'}
            aria-pressed={decision.choice === choice} onClick={() => onChange({ ...decision, choice })}>{CHOICE_WORDS[choice]}</EhrButton>)}
        </div>
        <span className={stateSeen ? 'hid-ehr-dept-muted' : 'hid-ehr-sr-only'}>{state}</span>
      </div>
      {showSaved && <span className="hid-ehr-dept-muted">{`Keep saves: ${saved}`}</span>}
      {cardError && <p id={`${cardId}-error`} className="hid-ehr-error">{cardError}</p>}
      {decision.choice === 'change' && (item.kind === 'lab_result'
        // A lab result is changed as its test and its result, so a corrected value is filed under the right test.
        ? <>
          <EhrField label="Test" controlId={itemTestId(index)} error={problemText(problem, itemTestId(index))}>
            <EhrInput value={decision.test ?? labTest(item)} maxLength={240} autoComplete="off" onChange={event => onChange({ ...decision, test: event.target.value })} />
          </EhrField>
          <EhrField label="Result" controlId={itemResultId(index)} error={problemText(problem, itemResultId(index))}>
            <EhrInput value={decision.result ?? labResult(item)} maxLength={2_000} autoComplete="off" onChange={event => onChange({ ...decision, result: event.target.value })} />
          </EhrField>
        </>
        : <EhrField label="What the paper says" controlId={itemTextId(index)} error={problemText(problem, itemTextId(index))}>
          <EhrInput value={decision.text} maxLength={2_000} autoComplete="off" onChange={event => onChange({ ...decision, text: event.target.value })} />
        </EhrField>)}
    </div>
  </li>
}

interface Visits {
  readonly items?: readonly Encounter[]; readonly nextCursor?: string | null; readonly error?: string
  /** Reading the next page: under way, or why it failed. */
  readonly more?: { readonly busy: boolean; readonly error?: string }
}

/**
 * The visits of the job's patient, read when a clinical note is chosen: a note is attached to one. EHR gives them a page
 * at a time, newest first; "Show older visits" reads the next page and adds it.
 */
function useVisits(facilityId: string, patientId: string | null | undefined, wanted: boolean) {
  const [visits, setVisits] = useState<Visits | null>(null)
  const [reads, setReads] = useState(0)
  useEffect(() => {
    if (!wanted || !patientId) return
    let active = true
    setVisits(null)
    void staffApi.encounters(facilityId, patientId).then(page => { if (active) setVisits({ items: page.items, nextCursor: page.nextCursor }) })
      .catch(caught => { if (active) setVisits({ error: errorText(caught, 'The patient’s visits couldn’t be loaded.') }) })
    return () => { active = false }
  }, [facilityId, patientId, wanted, reads])
  async function more() {
    const cursor = visits?.nextCursor
    if (!patientId || !cursor || visits?.more?.busy) return
    setVisits(current => current && { ...current, more: { busy: true } })
    try {
      const page = await staffApi.encounters(facilityId, patientId, { cursor })
      setVisits(current => current && { items: [...(current.items ?? []), ...page.items], nextCursor: page.nextCursor })
    } catch (caught) {
      setVisits(current => current && { ...current, more: { busy: false, error: errorText(caught, 'Older visits couldn’t be loaded.') } })
    }
  }
  return { visits, retry: () => setReads(value => value + 1), more }
}

function visitWords(visit: Encounter) {
  return [visitClassLabel(visit.encounterType), dateText(visit.startedAt), visit.chiefComplaint?.trim()].filter(Boolean).join(' · ')
}

function newestOf(extractions: readonly OcrExtraction[]) {
  return extractions.reduce<OcrExtraction | undefined>((newest, item) => !newest || item.version > newest.version ? item : newest, undefined)
}

/**
 * "Check and save" or "Reject reading": one review of a reading. A check shows each item read from the paper with Keep,
 * Change and Remove, then where to save it and why; what OCR is sent is built from those choices (reviewPayload.ts),
 * never typed. A rejection is a reason only, sent as unclassified, as today.
 */
export function ReviewForm({ facilityId, job, extractions, disposition, permissions, onChanged }: {
  readonly facilityId: string; readonly job: OcrJob; readonly extractions: OcrExtraction[]; readonly disposition: 'validated' | 'rejected'
  readonly permissions: readonly string[]; readonly onChanged: (disposition: 'validated' | 'rejected') => Promise<void>
}) {
  const ordered = [...extractions].sort((a, b) => a.version - b.version)
  const [extractionId, setExtractionId] = useState(newestOf(extractions)?.id ?? '')
  const selected = extractions.find(item => item.id === extractionId) ?? newestOf(extractions)
  const reading = selected ? parsePaperReading(selected.structuredPayload) : null
  const items = reviewItems(reading)
  const canAttachNote = !!job.patientId && permissions.includes('ehr.encounter.read')
  const offered = offeredDomains(reading, canAttachNote)
  const [decisions, setDecisions] = useState<Record<string, ItemDecision>>(() => initialDecisions(items))
  const [chosen, setSaveAs] = useState<SaveAs>('DOCUMENT_ONLY')
  const saveAs = offered.includes(chosen) ? chosen : 'DOCUMENT_ONLY'
  const [encounterId, setEncounterId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [problem, setProblem] = useState<FieldProblem | null>(null)
  const focus = useFocusById()
  const validating = disposition === 'validated'
  const { visits, retry, more } = useVisits(facilityId, job.patientId, validating && saveAs === 'EHR')
  const noteVisits = visitsForNote(visits?.items ?? [], facilityId)

  function chooseExtraction(id: string) {
    const next = extractions.find(item => item.id === id)
    setExtractionId(id)
    setDecisions(initialDecisions(reviewItems(next ? parsePaperReading(next.structuredPayload) : null)))
    setProblem(null)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(''); setProblem(null)
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '')
    if (!selected) { setProblem(refusal({ field: 'ocr-review-reason', message: 'There is no reading to check yet.' })); return }
    const built = validating
      ? buildValidation({ extractionId: selected.id, reading, decisions, saveAs, encounterId: saveAs === 'EHR' ? encounterId : '', reason })
      : buildRejection(selected.id, reason)
    if ('problem' in built) {
      // With no visit to choose from, the choice to change is Save as.
      const shown = built.problem.field === 'ocr-review-visit' && noteVisits.length === 0
        ? { field: 'ocr-review-domain', message: 'A clinical note needs a visit, and this patient has none that can be chosen. Choose another way to save it.' } : built.problem
      setProblem(refusal(shown)); focus(shown.field); return
    }
    setBusy(true)
    try {
      await staffApi.validateOcrJob(facilityId, job, built.input)
      await onChanged(built.input.disposition)
    } catch (caught) { setError(reviewRefusal(caught, validating ? saveAs : null)); focus('ocr-review-submit', true) }
    finally { setBusy(false) }
  }

  if (!extractions.length) return <p className="hid-ehr-dept-muted">There is no reading to check yet.</p>
  const label = validating ? 'Check and save' : 'Reject reading'
  const reasonField = <EhrField label={<>{validating ? 'Why you’re saving it' : 'Why you’re rejecting it'}<span aria-hidden="true"> *</span></>}
    controlId="ocr-review-reason" hint="At least 8 characters." error={problemText(problem, 'ocr-review-reason')}>
    <EhrTextarea name="reason" minLength={8} maxLength={500} required />
  </EhrField>
  const actions = <>
    <FormRefusal error={error} />
    <div className="hid-ehr-dept-form-actions"><EhrButton id="ocr-review-submit" type="submit" busy={busy}>{busy ? 'Saving…' : validating ? 'Save' : 'Reject reading'}</EhrButton></div>
  </>
  if (!validating) return <form className="hid-ehr-dept-form hid-ehr-dept-action-form" noValidate aria-label={label} onSubmit={event => void submit(event)}>
    <p className="hid-ehr-dept-muted">Nothing read from this document is kept. The document itself stays where it is.</p>
    {reasonField}
    {actions}
  </form>
  // Lines that couldn't be read at all are never saved (buildValidation removes them): one line says how many, no card each.
  const unreadable = items.filter(isUnreadable).length
  const undecided = items.filter(item => !isUnreadable(item) && !decisions[item.id]?.choice).length
  return <form className="hid-ehr-dept-form hid-ehr-dept-action-form" noValidate aria-label={label} onSubmit={event => void submit(event)}>
    {ordered.length > 1 && <EhrField label="Reading" controlId="ocr-review-extraction">
      <EhrSelect value={selected?.id ?? ''} onChange={event => chooseExtraction(event.target.value)}>
        {ordered.map((item, at) => <option key={item.id} value={item.id}>{`Reading ${at + 1} of ${ordered.length}${at === ordered.length - 1 ? ' (newest)' : ''}`}</option>)}
      </EhrSelect>
    </EhrField>}
    {items.length > unreadable
      ? <>
        <p className="hid-ehr-dept-muted">Look at each item against the paper. Keep it, change it, or remove it.</p>
        {undecided > 0 && <p className="hid-ehr-dept-muted" role="note">{`${undecided} ${undecided === 1 ? 'item needs' : 'items need'} your choice before you can save.`}</p>}
        <ul className="hid-ehr-dept-migrate-check">
          {/* Each card keeps its place among all the items read, the place buildValidation names it by. */}
          {items.map((item, index) => isUnreadable(item) ? null : <ReviewItemCard key={`${selected?.id}-${item.id}`} item={item} index={index}
            decision={decisions[item.id] ?? { choice: null, text: readingLine(item) }} problem={problem}
            onChange={decision => { setDecisions(current => ({ ...current, [item.id]: decision })); setProblem(null) }} />)}
        </ul>
      </>
      : <p className="hid-ehr-dept-muted">No items were picked out to check one by one. You can keep the document only, or reject this reading.</p>}
    <UnreadableLines items={items} />
    {offered.length > 1
      ? <EhrField label="Save as" controlId="ocr-review-domain" hint={SAVE_AS_HINTS[saveAs]} error={problemText(problem, 'ocr-review-domain')}>
        <EhrSelect value={saveAs} onChange={event => { setSaveAs(event.target.value as SaveAs); setProblem(null) }}>
          {offered.map(domain => <option key={domain} value={domain}>{SAVE_AS_WORDS[domain]}</option>)}
        </EhrSelect>
      </EhrField>
      : <div className="hid-ehr-field" id="ocr-review-domain" tabIndex={-1}>
        <p><strong>Save as:</strong> {SAVE_AS_WORDS.DOCUMENT_ONLY}</p>
        <p className="hid-ehr-hint">{SAVE_AS_HINTS.DOCUMENT_ONLY}</p>
        {problemText(problem, 'ocr-review-domain') && <p className="hid-ehr-error">{problemText(problem, 'ocr-review-domain')}</p>}
      </div>}
    {saveAs === 'PHARMACY' && keptMedicines(items, decisions) > MAX_MEDICINES && <p className="hid-ehr-dept-muted" role="note">{TOO_MANY_MEDICINES}</p>}
    {saveAs === 'EHR' && (visits === null
      ? <p className="hid-ehr-dept-muted" role="status">Loading the patient’s visits…</p>
      : visits.error
        ? <DeptNotice tone="critical" role="alert">{visits.error} <EhrButton size="sm" variant="secondary" onClick={retry}>Try again</EhrButton></DeptNotice>
        : noteVisits.length === 0 && !visits.nextCursor
          ? <p className="hid-ehr-dept-muted" role="note">This patient has no visits yet, so a clinical note can’t be attached. Choose another way to save it.</p>
          : <>
            {noteVisits.length > 0 && <EhrField label={<>Visit to attach the note to<span aria-hidden="true"> *</span></>} controlId="ocr-review-visit"
              error={problemText(problem, 'ocr-review-visit')}>
              <EhrSelect value={encounterId} onChange={event => { setEncounterId(event.target.value); setProblem(null) }}>
                <option value="">Choose a visit</option>
                {noteVisits.map(visit => <option key={visit.id} value={visit.id}>{visitWords(visit)}</option>)}
              </EhrSelect>
            </EhrField>}
            {visits.nextCursor && <div>
              <EhrButton size="sm" variant="secondary" busy={visits.more?.busy} onClick={() => void more()}>Show older visits</EhrButton>
            </div>}
            {visits.more?.error && <DeptNotice tone="critical" role="alert">{visits.more.error}</DeptNotice>}
          </>)}
    {reasonField}
    {actions}
  </form>
}

/** A patient this step offers to pick: who they are, in words, and their record's ID, which is sent but never shown. */
interface PatientChoice {
  readonly patientId: string
  readonly name: string
  readonly born: string
  readonly hidEnding: string
  /** Where the page got them: the patient this reading is for, or one found by Health ID. */
  readonly from: 'reading' | 'search'
}

function patientChoice(summary: PatientSummary, hid: string, from: PatientChoice['from']): PatientChoice {
  const joined = [summary.firstName, summary.lastName].filter(Boolean).join(' ')
  const health = (summary.hid || hid).trim()
  return {
    patientId: summary.patientId, from,
    name: summary.fullName?.trim() || joined || 'Name not recorded',
    born: birthDateText(summary.dateOfBirth),
    hidEnding: health.replace(/^HID-?/i, '').slice(-4).toUpperCase(),
  }
}

/** "Born 12 Mar 1980 · Health ID ending AAA2": enough to tell the person from the paper, and never their record ID. */
function choiceFacts(choice: PatientChoice) {
  return [choice.born ? `Born ${choice.born}` : 'Date of birth not recorded', choice.hidEnding ? `Health ID ending ${choice.hidEnding}` : '']
    .filter(Boolean).join(' · ')
}

/**
 * How the patient was checked, as the confirmation's reason. OCR takes any reason of 8 to 500 characters
 * (ConfirmPatientDto), so each choice is sent in these words; Other sends what is written.
 */
export const CONFIRM_REASONS = ['Name and date of birth match', 'Folder number matches', 'Confirmed with the patient'] as const
const OTHER_REASON = 'Other'

/**
 * A Health ID as Identity takes it, from what was typed after the box's HID- ("zdem aaa2", "HID-ZDEMAAA2"). A pasted
 * "HID-" is dropped only when a separator follows it, so a Health ID whose own letters begin with HID is kept whole.
 */
function healthIdFrom(text: string) {
  const upper = text.trim().toUpperCase()
  const rest = /^HID[\s_-]/.test(upper) ? upper.slice(4) : upper
  return `HID-${rest.replace(/[\s_-]+/g, '')}`
}

/**
 * "Confirm the patient". OCR takes one patient confirmation per job version. Nobody types a patient's record ID (owner's
 * no-typing rule for Migrate): the patient this reading is for, when the page knows who they are (the patient opened for
 * this visit, from Patient documents or the clinical record's hand-off), is offered as a person, name, date of birth and
 * the end of their Health ID, to pick with "This is the patient". Otherwise they are found by Health ID, as the
 * department pages find a patient, and picked the same way. The picked patient's ID is sent exactly as before; OCR
 * checks it is the job's patient (OCR_PATIENT_MISMATCH). A retry of the same confirmation reuses its key, so OCR answers
 * with the one it recorded; if the job was confirmed already, it is reloaded rather than left with a dead form.
 */
export function ConfirmForm({ facilityId, job, permissions, onChanged }: {
  readonly facilityId: string; readonly job: OcrJob; readonly permissions: readonly string[]
  readonly onChanged: (notice?: string) => Promise<void>
}) {
  const { activePatient } = useStaff()
  // The patient opened here, offered only when they are the one this reading is for: any other would be refused.
  // A job that names no patient offers nobody here: the patient is then found by Health ID.
  const visitPatient = activePatient && !!job.patientId && activePatient.lookup.patient.patientId === job.patientId
    ? patientChoice(activePatient.lookup.patient, activePatient.hid, 'reading') : null
  const canFind = permissions.includes('identity.patient.read')
  const [found, setFound] = useState<PatientChoice | null>(null)
  const choices = [visitPatient, found && found.patientId !== visitPatient?.patientId ? found : null].filter((choice): choice is PatientChoice => !!choice)
  const [picked, setPicked] = useState('')
  const pickedChoice = choices.find(choice => choice.patientId === picked) ?? null
  const [reasonChoice, setReasonChoice] = useState('')
  const [otherReason, setOtherReason] = useState('')
  const [hid, setHid] = useState('')
  const [finding, setFinding] = useState(false)
  const [findError, setFindError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [problem, setProblem] = useState<FieldProblem | null>(null)
  const focus = useFocusById()
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  // Each search, and each edit of the Health ID box, takes a new number; an answer for an older one is dropped.
  const findRequest = useRef(0)

  /** Forgets the last search's patient, and its pick, so Confirm can never send a patient the last search did not find. */
  function forgetFound() {
    findRequest.current += 1
    setFound(null)
    if (picked && picked !== visitPatient?.patientId) setPicked('')
  }

  async function find() {
    if (finding) return
    const value = healthIdFrom(hid)
    forgetFound()
    const request = findRequest.current
    setFindError(''); setProblem(null)
    if (!/^HID-[A-Z0-9]{4,}$/.test(value)) {
      setProblem(refusal({ field: 'ocr-confirm-hid', message: 'Type the letters and numbers after HID- on their Health ID card.' }))
      focus('ocr-confirm-hid'); return
    }
    setFinding(true)
    try {
      const lookup = await staffApi.lookupPatient(facilityId, value)
      if (request !== findRequest.current) return
      if (!isAllowedPatientLookup(lookup)) { setFindError(NOT_OPENED_HERE); focus('ocr-confirm-hid'); return }
      const choice = patientChoice(lookup.patient, value, 'search')
      // Shown to pick, never picked for them: the person still says it is the patient on the paper.
      setFound(choice)
      focus(`ocr-confirm-pick-${choice.from}`)
    } catch (caught) {
      if (request !== findRequest.current) return
      setFindError(isHidApiError(caught) && caught.status === 404 ? 'No patient has this Health ID. Check the card and try again.'
        : isHidApiError(caught) && caught.status === 403 ? NOT_OPENED_HERE
          : errorText(caught, 'The patient could not be found.'))
      focus('ocr-confirm-hid')
    } finally { setFinding(false) }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const reason = reasonChoice === OTHER_REASON ? otherReason.trim() : reasonChoice
    setError(''); setProblem(null)
    const refused = !pickedChoice
      ? choices.length > 0 ? { field: `ocr-confirm-pick-${choices[0]!.from}`, message: 'Choose the patient on the paper.' }
        : canFind ? { field: 'ocr-confirm-hid', message: 'Find the patient by their Health ID first.' }
          : { field: 'ocr-confirm-patient', message: NO_PATIENT_HERE }
      : !reasonChoice ? { field: 'ocr-confirm-reason', message: 'Choose how you checked.' }
        : !reason ? { field: 'ocr-confirm-other', message: 'Complete this field.' }
          : reason.length < 8 ? { field: 'ocr-confirm-other', message: 'Write at least 8 characters.' } : null
    if (refused) { setProblem(refusal(refused)); focus(refused.field); return }
    const patientId = pickedChoice!.patientId
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

  const patientError = problemText(problem, 'ocr-confirm-patient') ?? (choices.length > 0 ? problemText(problem, `ocr-confirm-pick-${choices[0]!.from}`) : undefined)
  const reasonError = problemText(problem, 'ocr-confirm-reason')
  return <form className="hid-ehr-dept-form hid-ehr-dept-action-form" noValidate aria-label="Confirm source patient" onSubmit={event => void submit(event)}>
    <p className="hid-ehr-dept-muted">Check the name and date of birth on the paper against the patient below before publishing. Health ID checks that it is the same patient.</p>
    <fieldset className="hid-ehr-dept-migrate-group" aria-describedby={patientError ? 'ocr-confirm-patient-error' : undefined}>
      <legend className="hid-ehr-label">Who is on the paper?<span aria-hidden="true"> *</span></legend>
      {choices.length > 0
        ? <ul className="hid-ehr-dept-migrate-people">{choices.map(choice => <li key={choice.patientId}
          className={choice.patientId === picked ? 'hid-ehr-dept-migrate-person hid-ehr-dept-migrate-person-picked' : 'hid-ehr-dept-migrate-person'}>
          <div className="hid-ehr-dept-migrate-person-text" id={`ocr-confirm-person-${choice.from}`}>
            <strong className="hid-ehr-dept-strong">{choice.name}</strong>
            <span>{choiceFacts(choice)}</span>
            <span className="hid-ehr-dept-muted">{choice.from === 'reading' ? 'The patient this reading is for' : 'Found by Health ID'}</span>
          </div>
          <label className="hid-ehr-dept-migrate-choice">
            <input type="radio" name="ocr-confirm-patient" id={`ocr-confirm-pick-${choice.from}`} value={choice.from} checked={choice.patientId === picked}
              aria-describedby={[patientError ? 'ocr-confirm-patient-error' : '', `ocr-confirm-person-${choice.from}`].filter(Boolean).join(' ')}
              aria-invalid={patientError ? true : undefined}
              onChange={() => { setPicked(choice.patientId); setProblem(null); setError('') }} />
            <span>This is the patient</span>
          </label>
        </li>)}</ul>
        : <p className="hid-ehr-dept-muted" id="ocr-confirm-patient" tabIndex={-1}>{canFind ? 'The patient this reading is for isn’t open on this page. Find them by their Health ID.' : NO_PATIENT_HERE}</p>}
      {patientError && <p id="ocr-confirm-patient-error" className="hid-ehr-error">{patientError}</p>}
    </fieldset>
    {canFind && !visitPatient && <div className="hid-ehr-dept-migrate-find-patient">
      <EhrField label="Health ID" controlId="ocr-confirm-hid" hint="The letters and numbers after HID- on their Health ID card."
        error={problemText(problem, 'ocr-confirm-hid') ?? (findError || undefined)}>
        <div className="hid-ehr-dept-migrate-hid">
          <span aria-hidden="true">HID-</span>
          <EhrInput value={hid} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={40}
            onChange={event => { setHid(event.target.value); forgetFound(); setFindError(''); setProblem(null) }}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void find() } }} />
        </div>
      </EhrField>
      <div><EhrButton id="ocr-confirm-find" variant="secondary" busy={finding} onClick={() => void find()}>{finding ? 'Finding…' : 'Find patient'}</EhrButton></div>
    </div>}
    <fieldset className="hid-ehr-dept-migrate-group" aria-describedby={reasonError ? 'ocr-confirm-reason-error' : undefined}>
      <legend className="hid-ehr-label">How did you check?<span aria-hidden="true"> *</span></legend>
      {[...CONFIRM_REASONS, OTHER_REASON].map((option, index) => <label key={option} className="hid-ehr-dept-migrate-choice">
        <input type="radio" name="ocr-confirm-reason" id={index === 0 ? 'ocr-confirm-reason' : undefined} value={option} checked={reasonChoice === option}
          aria-describedby={reasonError ? 'ocr-confirm-reason-error' : undefined} aria-invalid={reasonError ? true : undefined}
          onChange={() => { setReasonChoice(option); setProblem(null) }} />
        <span>{option}</span>
      </label>)}
      {reasonError && <p id="ocr-confirm-reason-error" className="hid-ehr-error">{reasonError}</p>}
    </fieldset>
    {reasonChoice === OTHER_REASON && <EhrField label={<>What you checked<span aria-hidden="true"> *</span></>} controlId="ocr-confirm-other" error={problemText(problem, 'ocr-confirm-other')}>
      <EhrTextarea value={otherReason} minLength={8} maxLength={500} required onChange={event => { setOtherReason(event.target.value); setProblem(null) }} />
    </EhrField>}
    <FormRefusal error={error} />
    <div className="hid-ehr-dept-form-actions"><EhrButton id="ocr-confirm-submit" type="submit" busy={busy}>{busy ? 'Saving…' : 'Confirm source patient'}</EhrButton></div>
  </form>
}

const NOT_OPENED_HERE = 'This patient’s record can’t be opened here. Open them through approved access first.'
const NO_PATIENT_HERE = 'Open the patient this reading is for through approved access, then come back to confirm them.'

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

/**
 * What a failed publication says, in place of OCR's stored failure code and summary: those are the services' own words
 * ("Owning clinical service is temporarily unavailable (EHR_SERVICE_UNAVAILABLE)"), never shown (owner's rule, 1 Nov
 * 2026). Whether it can be tried again follows, from the code, in the page's own words. A final failure is one the
 * owning service refused, so nothing was added. One OCR attempts again claims nothing about the record: OCR stores a
 * timeout or server error as OWNING_SERVICE_UNAVAILABLE, which can come after the owning service saved the write, and
 * REQUEST_IN_PROGRESS while it is still working on it (docs/OPEN-QUESTIONS.md, failed publications). Told nothing was
 * added there, someone could enter the evidence again by hand.
 */
const PUBLICATION_FAILED = 'Nothing was added to the patient’s record.'
const PUBLICATION_UNFINISHED = 'Publishing to the patient’s record didn’t finish: it may have been added even so. Check the patient’s record before adding anything by hand.'

function publicationRefusal(caught: unknown) {
  // OCR answers it also after the last attempt (INTERFACE_CONTRACT.md, OCR publication).
  if (isHidApiError(caught) && caught.code === 'OCR_PUBLICATION_IN_PROGRESS') return 'OCR did not start another attempt: one is still running, it is too soon after the last one, or no attempts remain.'
  // The part of the record it was going to refused it for good: said as what it means for the person, not as a service.
  if (isHidApiError(caught) && caught.code === 'OCR_PUBLICATION_TERMINAL') return 'This couldn’t be added to the patient’s record, and it can’t be tried again.'
  // Publishing into the record needs direct-care access to the patient, which this member doesn't hold.
  if (isHidApiError(caught) && caught.status === 403 && caught.code === 'OCR_PUBLISH_NEEDS_DIRECT_CARE') return 'Ask a clinician with access to this patient to publish it.'
  return errorText(caught, 'The validated evidence was not published.')
}

const publishedAs: Partial<Record<OcrTargetDomain, string>> = {
  EHR: 'Published as a clinical note in the patient\'s record.',
  LAB: 'Published as imported lab evidence in the patient\'s record.',
  PHARMACY: 'Published as imported medication evidence in the patient\'s record.',
  DOCUMENT_ONLY: 'Kept as a validated document in the patient\'s record.',
}

/**
 * A flag Lab stored with an imported observation, in the Laboratory's plain words ("possibly critical", never Lab's
 * critical_candidate); nothing for normal or not set. A flag Lab may add later is said as flagged, never as its code.
 */
function flagText(abnormalFlag: string | null | undefined) {
  if (!abnormalFlag || abnormalFlag === 'normal' || abnormalFlag === 'unknown') return ''
  return Object.hasOwn(FLAG_WORDS, abnormalFlag) ? `flagged ${FLAG_WORDS[abnormalFlag as LabAbnormalFlag].toLowerCase()}` : 'flagged'
}

/**
 * The owning domain a review names, in the words the review form offers it: for the review's title and its Publish
 * button, never OCR's code (DOCUMENT_ONLY, UNCLASSIFIED). A domain OCR may add later is said as not classified.
 */
const DOMAIN_WORDS: Readonly<Record<OcrTargetDomain, string>> = {
  EHR: 'Clinical note', LAB: 'Past lab results', PHARMACY: 'Past medicines', DOCUMENT_ONLY: 'Document only',
  UNCLASSIFIED: 'Not classified',
}
const domainText = (domain: string) => Object.hasOwn(DOMAIN_WORDS, domain) ? DOMAIN_WORDS[domain as OcrTargetDomain] : DOMAIN_WORDS.UNCLASSIFIED

function observationText(item: LabImport['observations'][number]) {
  const result = [item.value && `${item.value}${item.unit ? ` ${item.unit}` : ''}`, item.valueText].filter(Boolean).join(' · ')
  const flag = flagText(item.abnormalFlag)
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
  const retryable = RETRYABLE_PUBLICATION_FAILURES.includes(publication.failureCode ?? '')
  const attempts = failed && publication.attemptCount != null && publication.maxAttempts != null ? ` · Attempt ${publication.attemptCount} of ${publication.maxAttempts}` : ''
  const unfinished = 'OCR has not finished this publication. Refresh the job status to see whether it has.'
  const failedText = !retryable ? 'It cannot be retried.'
    : !attemptsLeft(publication) ? 'The publication attempt limit has been reached. It cannot be retried.'
      : retryHere ? PUBLICATION_RETRY_WAIT
        : canPublish ? 'It can be retried only from the page where Publish was pressed, before that page is reloaded or left.' : ''
  // OCR claims a publication again only while attempts remain (ocr.service.ts executePublication), whichever page asks.
  const unfinishedText = !attemptsLeft(publication) ? `${unfinished} This is its last attempt: if it has stopped, it cannot be resumed.`
    : retryHere ? 'OCR has not finished this publication. If it has stopped, Retry publication resumes it; if it is still running, OCR says so.'
      : canPublish ? `${unfinished} If it has stopped, it can be resumed only from the page where Publish was pressed, before that page is reloaded or left.`
        : unfinished
  return <div className="hid-ehr-dept-migrate-publication">
    <p>Publication <EhrBadge tone={statusTone(publication.status)}>{statusWords(publication.status)}</EhrBadge>{attempts}</p>
    {failed && <p>{retryable ? PUBLICATION_UNFINISHED : PUBLICATION_FAILED}</p>}
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
      <p className="hid-ehr-dept-row-title">{`Review ${validation.version} · ${domainText(validation.targetDomain)}`}
        <EhrBadge tone={statusTone(validation.disposition)}>{statusWords(validation.disposition)}</EhrBadge></p>
      <p className="hid-ehr-dept-muted">{validation.reason} · {dateText(validation.reviewedAt)}</p>
      {error && <DeptNotice tone="critical" role="alert">{error}</DeptNotice>}
      {historyError && <DeptNotice tone="critical" role="alert">{historyError}</DeptNotice>}
      {publications === null && !historyError && <p className="hid-ehr-dept-muted" role="status">Loading publication history…</p>}
      {publications?.map(publication => <PublicationStatus key={publication.id} facilityId={facilityId} publication={publication}
        permissions={permissions} canPublish={request !== undefined} retryHere={action === retryId} />)}
    </div>
    {(action === publishId || action === retryId) && <div className="hid-ehr-dept-row-actions">
      {action === publishId && <EhrButton id={publishId} size="sm" busy={busy} onClick={() => void publish()}>{busy ? 'Working…' : `Publish as ${domainText(validation.targetDomain).toLowerCase()}`}</EhrButton>}
      {action === retryId && <EhrButton id={retryId} size="sm" busy={busy} onClick={() => void publish(true)}>{busy ? 'Working…' : 'Retry publication'}</EhrButton>}
    </div>}
  </li>
}
