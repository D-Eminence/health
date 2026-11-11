import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { isHidApiError } from '@hid/http'
import { EhrButton, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import { documentTypeLabel, documentTypeOf, useDocumentTypesServed } from '../../../documentTypes'
import { SOURCE_DELETED_WORDS, sourceDeleted } from '../../../documentSource'
import { fileTypeLabel, scanStatusLabel, visitClassLabel, visitStatusLabel } from '../../../plainLabels'
import { isAllowedPatientLookup, staffApi, type DocumentRecord, type Encounter } from '../../../staff/api'
import { useStaff } from '../../../staff/App'
import { problemText, refusal, type FieldProblem } from '../../../staff/fieldProblem'
import { useFocusById } from '../../../staff/focus'
import { errorText } from '../parts/errors'
import { dateText } from '../parts/format'
import { readDocuments } from './DocumentCapture'
import { NOT_OPENED_HERE, UUID_V4, choiceFacts, healthIdFrom, patientChoice, type PatientChoice } from './ocrSteps'

/*
 * New document job, picked, never typed (the owner's no-typing rule for Migrate, as Confirm the patient): the patient,
 * as a person (the patient open on this page, or one found by their Health ID), then one of their documents, from the
 * same list Patient documents reads, by its file name, type, date and virus check. Only a document whose virus check
 * is clean can be chosen. What is sent is the picked document's and patient's IDs, exactly as before; no ID is shown.
 */

/** What the form hands on: the document picked, its patient, and its file name, for the record's heading. */
export interface NewJobPicked { readonly documentId: string; readonly patientId: string; readonly fileName: string }

/** Why a listed document can't be read yet, in plain words; empty when it can be. */
function notChoosable(item: DocumentRecord): string {
  if (sourceDeleted(item)) return SOURCE_DELETED_WORDS
  if (item.status === 'initiated') return 'Upload not completed'
  if (item.scanStatus === 'clean') return ''
  const status = scanStatusLabel(item.scanStatus)
  return status === 'Being checked for viruses' ? 'Being checked for viruses. It can be read once it’s checked.'
    : status ? `${status}. It can’t be read.` : 'Its virus check hasn’t finished. It can’t be read yet.'
}

/** "Lab result · PDF document · Added 12 Oct 2026, 09:30 · Checked": what tells one document from another. */
function documentFacts(item: DocumentRecord, served: boolean): string {
  const type = served ? documentTypeOf(item) : null
  const scan = !sourceDeleted(item) && item.status !== 'initiated' ? scanStatusLabel(item.scanStatus) : ''
  return [type ? documentTypeLabel(type) : '', fileTypeLabel(item.mediaType), `Added ${dateText(item.createdAt)}`, scan].filter(Boolean).join(' · ')
}

interface Visits { readonly items?: readonly Encounter[]; readonly error?: string }
interface Documents { readonly items?: readonly DocumentRecord[]; readonly error?: string }

export function NewJobPick({ facilityId, permissions, preselect, busy, onPick, children }: {
  readonly facilityId: string
  readonly permissions: readonly string[]
  /** A document to pick at once when it is listed (Create record from Find document job). */
  readonly preselect: string
  readonly busy: boolean
  readonly onPick: (picked: NewJobPicked) => void
  /** What the page says when the job is refused, above the button. */
  readonly children?: ReactNode
}) {
  const { activePatient } = useStaff()
  const served = useDocumentTypesServed() === true
  // Emergency access is read-only: no document of that patient can be sent for reading.
  const openPatient = activePatient && activePatient.purpose !== 'emergency'
    ? patientChoice(activePatient.lookup.patient, activePatient.hid, 'reading') : null
  const canFind = permissions.includes('identity.patient.read')
  const canReadDocuments = permissions.includes('ehr.document.read')
  const [found, setFound] = useState<PatientChoice | null>(null)
  const choices = [openPatient, found && found.patientId !== openPatient?.patientId ? found : null].filter((choice): choice is PatientChoice => !!choice)
  // The patient open here is whose documents are shown first; another is picked by finding them.
  const [picked, setPicked] = useState(openPatient?.patientId ?? '')
  const patient = choices.find(choice => choice.patientId === picked) ?? null
  const [hid, setHid] = useState('')
  const [finding, setFinding] = useState(false)
  const [findError, setFindError] = useState('')
  const [visits, setVisits] = useState<Visits | null>(null)
  const [visitId, setVisitId] = useState('')
  const [documents, setDocuments] = useState<Documents | null>(null)
  const [documentId, setDocumentId] = useState('')
  const [problem, setProblem] = useState<FieldProblem | null>(null)
  const focus = useFocusById()
  const findRequest = useRef(0)

  const patientId = patient?.patientId ?? ''
  useEffect(() => {
    setVisits(null); setVisitId(''); setDocuments(null); setDocumentId('')
    if (!patientId || !canReadDocuments) return
    let active = true
    void staffApi.encounters(facilityId, patientId)
      .then(page => { if (active) setVisits({ items: page.items.filter(item => item.patientId === patientId && item.facilityId === facilityId) }) })
      .catch(caught => { if (active) setVisits({ error: errorText(caught, 'The patient’s visits couldn’t be loaded.') }) })
    return () => { active = false }
  }, [facilityId, patientId, canReadDocuments])
  const visit = visits?.items?.find(item => item.id === visitId) ?? visits?.items?.[0]
  const shownVisit = visit?.id ?? ''
  useEffect(() => {
    setDocuments(null)
    if (!patientId || !shownVisit) return
    let active = true
    void readDocuments(facilityId, patientId, shownVisit)
      .then(items => {
        if (!active) return
        const listed = items.filter(item => item.patientId === patientId)
        setDocuments({ items: listed })
        const ready = listed.find(item => item.id === preselect && !notChoosable(item))
        setDocumentId(ready ? ready.id : '')
      })
      .catch(caught => { if (active) setDocuments({ error: errorText(caught, 'The patient’s documents couldn’t be loaded.') }) })
    return () => { active = false }
  }, [facilityId, patientId, shownVisit, preselect])

  function forgetFound() {
    findRequest.current += 1
    setFound(null)
    if (picked && picked !== openPatient?.patientId) setPicked('')
  }

  async function find() {
    if (finding) return
    const value = healthIdFrom(hid)
    forgetFound()
    const request = findRequest.current
    setFindError(''); setProblem(null)
    if (!/^HID-[A-Z0-9]{4,}$/.test(value)) {
      setProblem(refusal({ field: 'ocr-new-hid', message: 'Type the letters and numbers after HID- on their Health ID card.' }))
      focus('ocr-new-hid'); return
    }
    setFinding(true)
    try {
      const lookup = await staffApi.lookupPatient(facilityId, value)
      if (request !== findRequest.current) return
      if (!isAllowedPatientLookup(lookup)) { setFindError(NOT_OPENED_HERE); focus('ocr-new-hid'); return }
      const choice = patientChoice(lookup.patient, value, 'search')
      setFound(choice)
      focus(`ocr-new-pick-${choice.from}`)
    } catch (caught) {
      if (request !== findRequest.current) return
      setFindError(isHidApiError(caught) && caught.status === 404 ? 'No patient has this Health ID. Check the card and try again.'
        : isHidApiError(caught) && caught.status === 403 ? NOT_OPENED_HERE
          : errorText(caught, 'The patient could not be found.'))
      focus('ocr-new-hid')
    } finally { setFinding(false) }
  }

  const listed = documents?.items ?? []
  const chosen = listed.find(item => item.id === documentId && !notChoosable(item)) ?? null
  const firstChoosable = listed.find(item => !notChoosable(item))

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setProblem(null)
    const refused = !patient
      ? choices.length > 0 ? { field: `ocr-new-pick-${choices[0]!.from}`, message: 'Choose the patient whose document you’re reading.' }
        : canFind ? { field: 'ocr-new-hid', message: 'Find the patient by their Health ID first.' }
          : { field: 'ocr-new-patient', message: NO_PATIENT_HERE }
      : !chosen ? { field: firstChoosable ? `ocr-new-document-${firstChoosable.id}` : 'ocr-new-documents', message: 'Choose the document to read.' }
        // EHR gave an ID OCR would refuse: said plainly, never the ID.
        : !UUID_V4.test(chosen.id) || !UUID_V4.test(patient.patientId) ? { field: 'ocr-new-documents', message: 'This document can’t be sent for reading. Upload it again, then choose the new copy.' }
          : null
    if (refused) { setProblem(refusal(refused)); focus(refused.field); return }
    onPick({ documentId: chosen!.id, patientId: patient!.patientId, fileName: chosen!.fileName })
  }

  const patientError = problemText(problem, 'ocr-new-patient') ?? (choices.length > 0 ? problemText(problem, `ocr-new-pick-${choices[0]!.from}`) : undefined)
  const documentError = problemText(problem, 'ocr-new-documents') ?? (firstChoosable ? problemText(problem, `ocr-new-document-${firstChoosable.id}`) : undefined)
  return <form className="hid-ehr-dept-form" noValidate aria-label="New document job" onSubmit={submit}>
    <p className="hid-ehr-dept-muted">Choose the patient, then the document to read. Only a document that has passed its virus check can be read. If it was read before, that reading opens instead.</p>
    <fieldset className="hid-ehr-dept-migrate-group" aria-describedby={patientError ? 'ocr-new-patient-error' : undefined}>
      <legend className="hid-ehr-label">Whose document is it?<span aria-hidden="true"> *</span></legend>
      {choices.length > 0
        ? <ul className="hid-ehr-dept-migrate-people">{choices.map(choice => <li key={choice.patientId}
          className={choice.patientId === picked ? 'hid-ehr-dept-migrate-person hid-ehr-dept-migrate-person-picked' : 'hid-ehr-dept-migrate-person'}>
          <div className="hid-ehr-dept-migrate-person-text" id={`ocr-new-person-${choice.from}`}>
            <strong className="hid-ehr-dept-strong">{choice.name}</strong>
            <span>{choiceFacts(choice)}</span>
            <span className="hid-ehr-dept-muted">{choice.from === 'reading' ? 'The patient open on this page' : 'Found by Health ID'}</span>
          </div>
          <label className="hid-ehr-dept-migrate-choice">
            <input type="radio" name="ocr-new-patient" id={`ocr-new-pick-${choice.from}`} value={choice.from} checked={choice.patientId === picked}
              aria-describedby={[patientError ? 'ocr-new-patient-error' : '', `ocr-new-person-${choice.from}`].filter(Boolean).join(' ')}
              aria-invalid={patientError ? true : undefined}
              onChange={() => { setPicked(choice.patientId); setProblem(null) }} />
            <span>Read this patient’s document</span>
          </label>
        </li>)}</ul>
        : <p className="hid-ehr-dept-muted" id="ocr-new-patient" tabIndex={-1}>{canFind ? 'No patient is open on this page. Find them by their Health ID.' : NO_PATIENT_HERE}</p>}
      {patientError && <p id="ocr-new-patient-error" className="hid-ehr-error">{patientError}</p>}
    </fieldset>
    {canFind && <div className="hid-ehr-dept-migrate-find-patient">
      <EhrField label={openPatient ? 'Another patient’s Health ID' : 'Health ID'} controlId="ocr-new-hid" hint="The letters and numbers after HID- on their Health ID card."
        error={problemText(problem, 'ocr-new-hid') ?? (findError || undefined)}>
        <div className="hid-ehr-dept-migrate-hid">
          <span aria-hidden="true">HID-</span>
          <EhrInput value={hid} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={40}
            onChange={event => { setHid(event.target.value); forgetFound(); setFindError(''); setProblem(null) }}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void find() } }} />
        </div>
      </EhrField>
      <div><EhrButton id="ocr-new-find" variant="secondary" busy={finding} onClick={() => void find()}>{finding ? 'Finding…' : 'Find patient'}</EhrButton></div>
    </div>}
    {patient && <fieldset className="hid-ehr-dept-migrate-group" aria-describedby={documentError ? 'ocr-new-documents-error' : undefined}>
      <legend className="hid-ehr-label">Which document?<span aria-hidden="true"> *</span></legend>
      {!canReadDocuments
        ? <p className="hid-ehr-dept-muted" id="ocr-new-documents" tabIndex={-1}>Your access doesn’t let you see this patient’s documents, so none can be chosen here.</p>
        : visits === null ? <p className="hid-ehr-dept-muted" role="status">Loading the patient’s visits…</p>
          : visits.error ? <p className="hid-ehr-error" role="alert">{visits.error}</p>
            : !visit ? <p className="hid-ehr-dept-muted" id="ocr-new-documents" tabIndex={-1}>This patient has no visits here, so no document can be chosen. Upload the document on a visit first.</p>
              : <>
                {(visits.items?.length ?? 0) > 1 && <EhrField label="Visit" controlId="ocr-new-visit">
                  <EhrSelect value={visit.id} onChange={event => { setVisitId(event.target.value); setProblem(null) }}>
                    {visits.items!.map(item => <option key={item.id} value={item.id}>{`${visitClassLabel(item.encounterType)} · started ${dateText(item.startedAt)} · ${visitStatusLabel(item.status)}`}</option>)}
                  </EhrSelect>
                </EhrField>}
                {documents === null ? <p className="hid-ehr-dept-muted" role="status">Loading the documents…</p>
                  : documents.error ? <p className="hid-ehr-error" role="alert">{documents.error}</p>
                    : listed.length === 0 ? <p className="hid-ehr-dept-muted" id="ocr-new-documents" tabIndex={-1}>No documents on this visit yet. Upload one in Patient documents first.</p>
                      : <ul className="hid-ehr-dept-migrate-people" id="ocr-new-documents" tabIndex={-1}>{listed.map(item => {
                        const why = notChoosable(item)
                        const id = `ocr-new-document-${item.id}`
                        return <li key={item.id} className={item.id === documentId && !why ? 'hid-ehr-dept-migrate-person hid-ehr-dept-migrate-person-picked' : 'hid-ehr-dept-migrate-person'}>
                          <label className="hid-ehr-dept-migrate-choice">
                            <input type="radio" name="ocr-new-document" id={id} value={item.id} checked={!why && item.id === documentId} disabled={!!why}
                              aria-describedby={[documentError ? 'ocr-new-documents-error' : '', `${id}-facts`].filter(Boolean).join(' ')}
                              aria-invalid={documentError ? true : undefined}
                              onChange={() => { setDocumentId(item.id); setProblem(null) }} />
                            <span className="hid-ehr-dept-strong">{item.fileName}</span>
                          </label>
                          <span id={`${id}-facts`} className="hid-ehr-dept-migrate-person-text">
                            <span>{documentFacts(item, served)}</span>
                            {why && <span className="hid-ehr-dept-muted">{why}</span>}
                          </span>
                        </li>
                      })}</ul>}
              </>}
      {documentError && <p id="ocr-new-documents-error" className="hid-ehr-error">{documentError}</p>}
    </fieldset>}
    {children}
    <div className="hid-ehr-dept-form-actions"><EhrButton id="ocr-create-submit" type="submit" busy={busy}>{busy ? 'Sending…' : 'Read this document'}</EhrButton></div>
  </form>
}

const NO_PATIENT_HERE = 'Open the patient through approved access first, then come back to choose their document.'
