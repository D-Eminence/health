import { assertSignedStorageUrl, plainErrorText } from '@hid/http'
import { EhrButton, EhrCard, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  DEFAULT_DOCUMENT_TYPE, documentTypeLabel, documentTypeOf, documentTypeRefusalText, documentTypesHere, isDocumentType,
  useDocumentTypesServed, type DocumentType,
} from '../../../documentTypes'
import { staffApi, type DocumentRecord } from '../../../staff/api'
import { getEnvironment } from '../../../staff/env'
import { staffSessionGeneration, untilStaffSessionReady } from '../../../staff/session'
import type { Chart } from '../parts/chart'
import { SubHeading } from '../parts/Detail'
import { ErrorBox, Loading } from '../parts/Notices'
import { StatusBadge } from '../parts/StatusBadge'
import { useClinical } from '../parts/Workspace'
import { fileTypeLabel, scanStatusLabel } from '../../../plainLabels'
import { RELOAD_FAILED, fileSize } from './encounters'
import { ListPaging } from './Notes'
import type { RecordList } from './records'

const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff']
/** 50 MiB, today's limit (staff/routes/Clinical.tsx Documents). */
const MAX_BYTES = 52_428_800
/**
 * Today's OCR page, where today's link goes (staff/routes/Clinical.tsx Documents). It is today's provider route, not a
 * blue workspace, so it is named as today names it rather than below this page's base.
 */
const OCR_PATH = '/provider/ocr'
const OCR_LABEL = 'Extract with OCR'
/** Said when EHR holds more documents than today's read answers (it takes no cursor). */
const DOCUMENTS_TRUNCATED = 'Not every document of this encounter is listed here.'
/** Said in place of the upload, once the types are served, on a host that uploads none (as blue Migrate says it). */
const NO_UPLOAD_HERE = 'Documents can be uploaded only in the EHR, Lab, Pharmacy or Migrate.'

/**
 * A listed document's line: its file type, size and scan result, as today; once the types are served, its document
 * type first. A document without one is a clinical document; a type this page does not know is not named.
 */
function documentLine(document: DocumentRecord, served: boolean): string {
  const type = served ? documentTypeOf(document) : null
  return [type ? documentTypeLabel(type) : '', fileTypeLabel(document.mediaType), fileSize(document.sizeBytes),
    document.status === 'initiated' ? '' : scanStatusLabel(document.scanStatus)].filter(Boolean).join(' · ')
}

/**
 * The card's error. After an upload whose list could not be read again it has "Try again" beside it (`again`), and
 * counts how many times it has been said, so a failure said again in the same words is announced again.
 */
type CardError = { readonly text: string; readonly again: boolean; readonly said?: number }
const NO_ERROR: CardError = { text: '', again: false }

function reloadFailed(failure: string): CardError {
  return { text: `${RELOAD_FAILED} ${failure}`.trim(), again: true }
}

/**
 * The encounter's documents (today's Documents tab), 50 to a page: each with its type, size and scan result, "Open
 * file" only once the virus scan is clean, today's "Extract with OCR" for a clean one when the role may read OCR jobs
 * (the ids go in router state, never in the address, as today), and "Upload a document". Opening and uploading
 * re-check access first, as today.
 *
 * Document types (documentTypes.ts, the owner's rule of 31 Oct), as blue Migrate asks them: once the document list has
 * answered `documentTypes: true`, the upload asks for the document's type among those this host may upload (the
 * clinical document first), sends it with the file, and each listed document names its type. Until then no type is
 * asked, sent or shown, and the upload is exactly today's. "Extract with OCR" hands over the same ids whatever the type.
 */
export function DocumentsCard({ chart, encounterId, list, canWrite }: {
  chart: Chart
  encounterId: string
  list: RecordList<DocumentRecord>
  canWrite: boolean
}) {
  const { facilityId, patientId } = chart
  const { state } = useClinical()
  // Today's OCR handoff names who made it and where, since the history entry holding it outlives both.
  const actorId = state.status === 'ready' ? state.session.actor.id : undefined
  const canOcr = chart.can('ocr.job.read')
  const [error, showError] = useState<CardError>(NO_ERROR)
  const setError = (text: string) => showError(text ? { text, again: false } : NO_ERROR)
  const [notice, setNotice] = useState('')
  const [fileError, setFileError] = useState<string | undefined>(undefined)
  const [uploading, setUploading] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const sending = useRef(false)
  // Whether the backend serves the document types, as its own answers have said (this card's list among them), and the
  // types this host may upload, the default first. Once served, the type chosen is sent (the host's one type, were it
  // to offer only one); before that none, as today.
  const served = useDocumentTypesServed() === true
  const offered = documentTypesHere()
  const uploadsHere = !served || offered.length > 0
  const [documentType, setDocumentType] = useState<DocumentType>(DEFAULT_DOCUMENT_TYPE)
  const sentType: DocumentType | undefined = !served ? undefined : offered.includes(documentType) ? documentType : offered[0]
  const offersChoice = served && offered.length > 1

  const open = async (document: DocumentRecord) => {
    setError('')
    setOpening(document.id)
    try {
      const sentIn = staffSessionGeneration()
      await chart.verify()
      const result = await staffApi.documentDownload(facilityId, document.id)
      assertSignedStorageUrl(result.url, { allowLocalHttp: getEnvironment().name === 'local', code: 'INVALID_DOWNLOAD_URL', message: 'Document could not be opened.' })
      await untilStaffSessionReady(sentIn)
      window.open(result.url, '_blank', 'noopener,noreferrer')
    } catch (caught) {
      setError(plainErrorText(caught, 'Document could not be opened.', { audience: 'facility' }))
    } finally {
      setOpening(null)
    }
  }

  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sending.current) return
    const form = event.currentTarget
    const file = input.current?.files?.[0]
    setError('')
    setNotice('')
    const refuse = (message: string) => { setFileError(message); input.current?.focus() }
    if (!file || file.size === 0) return refuse('Select a file first.')
    if (!ACCEPTED.includes(file.type) || file.size > MAX_BYTES) return refuse('Use a PDF, JPEG, PNG or TIFF file of up to 50 MB.')
    setFileError(undefined)
    sending.current = true
    setUploading(true)
    try {
      await chart.verify()
      // Without a type, exactly today's upload: no fifth argument, so the request names none.
      if (sentType) await staffApi.uploadDocument(facilityId, patientId, encounterId, file, sentType)
      else await staffApi.uploadDocument(facilityId, patientId, encounterId, file)
      const failure = await list.reload(true)
      form.reset()
      setDocumentType(DEFAULT_DOCUMENT_TYPE)
      setNotice('Uploaded. It can be opened once the virus check is done.')
      if (failure !== null) showError(reloadFailed(failure))
    } catch (caught) {
      // A lab result from a host other than the EHR, Lab or Migrate is refused (403 DOCUMENT_TYPE_NOT_ALLOWED_HERE).
      setError(documentTypeRefusalText(caught) ?? plainErrorText(caught, 'Document could not be uploaded.', { audience: 'facility' }))
    } finally {
      sending.current = false
      setUploading(false)
    }
  }

  /**
   * "Try again": the list read again, fresh, as the upload read it (its first page), with no access re-check. The
   * sentence stays until it is read, then goes, focus moving from Try again to the file field; an upload or an open
   * meanwhile says its own outcome, which this never replaces.
   */
  const readAgain = async (event: { readonly currentTarget: HTMLButtonElement }) => {
    const button = event.currentTarget
    const shown = error
    const failure = await list.reload(true)
    showError(current => current !== shown ? current : failure !== null ? { ...reloadFailed(failure), said: (shown.said ?? 0) + 1 } : NO_ERROR)
    // Try again goes with the sentence: focus on it, or on nothing, moves to the file field, never from elsewhere.
    const active = document.activeElement
    if (failure === null && (active === button || active === null || active === document.body)) input.current?.focus()
  }

  return (
    <EhrCard title="Documents">
      {list.error ? <ErrorBox>{list.error}</ErrorBox> : null}
      <ListPaging list={list} />
      {list.truncated ? <p className="hid-ehr-clinical-note">{DOCUMENTS_TRUNCATED}</p> : null}
      {list.items === null ? (list.loading ? <Loading label="Loading documents…" /> : null) : list.items.length === 0 ? (
        <p>No documents for this consultation.</p>
      ) : (
        <ul className="hid-ehr-clinical-history-list">
          {list.items.map(document => (
            <li key={document.id} className="hid-ehr-clinical-history-row">
              <span>
                <strong>{document.fileName}</strong>
                <span className="hid-ehr-clinical-cell-sub">{documentLine(document, served)}</span>
                {document.status === 'initiated' ? (
                  <span className="hid-ehr-clinical-cell-sub">Upload not completed; only the person who started it can finish it. Upload the file again.</span>
                ) : null}
              </span>
              <span className="hid-ehr-clinical-consult-document-actions">
                {document.status ? <StatusBadge status={document.status} /> : null}
                <EhrButton variant="secondary" size="sm" disabled={document.scanStatus !== 'clean'} busy={opening === document.id}
                  aria-label={`Open file ${document.fileName}`} onClick={() => open(document)}>
                  Open file
                </EhrButton>
                {canOcr && document.scanStatus === 'clean' ? (
                  <Link className="hid-ehr-clinical-link" to={OCR_PATH} state={{ ocrDocumentId: document.id, ocrPatientId: patientId, actorId, facilityId }}>
                    {OCR_LABEL}
                  </Link>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canWrite && !uploadsHere ? <p className="hid-ehr-clinical-note" role="status">{NO_UPLOAD_HERE}</p> : null}
      {canWrite && uploadsHere ? (
        <form className="hid-ehr-clinical-form" noValidate onSubmit={event => void upload(event)}>
          <SubHeading>Upload a document</SubHeading>
          <p className="hid-ehr-clinical-note">Files are checked for viruses before anyone can open them.</p>
          {offersChoice ? (
            <EhrField label="Document type">
              <EhrSelect value={sentType} onChange={event => { if (isDocumentType(event.target.value)) setDocumentType(event.target.value) }}>
                {offered.map(type => <option key={type} value={type}>{documentTypeLabel(type)}</option>)}
              </EhrSelect>
            </EhrField>
          ) : null}
          <EhrField label={<>{offersChoice ? 'File' : documentTypeLabel(sentType ?? DEFAULT_DOCUMENT_TYPE)}<span aria-hidden="true"> *</span></>} error={fileError}>
            <EhrInput ref={input} name="document" type="file" accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff" required onChange={() => setFileError(undefined)} />
          </EhrField>
          <div className="hid-ehr-clinical-form-footer">
            <EhrButton type="submit" variant="secondary" busy={uploading}>{uploading ? 'Uploading…' : 'Upload document'}</EhrButton>
          </div>
          <div role="status" className="hid-ehr-clinical-status">{notice}</div>
        </form>
      ) : null}
      {error.text ? (
        <ErrorBox>
          <p key={error.said ?? 0}>{error.text}</p>
          {/* Busy, it stays focusable (aria-disabled, aria-busy), so focus stays on it, and a second press does nothing. */}
          {error.again ? <p><EhrButton variant="secondary" size="sm" onClick={readAgain}>Try again</EhrButton></p> : null}
        </ErrorBox>
      ) : null}
    </EhrCard>
  )
}
