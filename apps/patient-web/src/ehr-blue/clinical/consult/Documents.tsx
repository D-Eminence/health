import { assertSignedStorageUrl } from '@hid/http'
import { EhrButton, EhrField, EhrInput } from '@hid/ui/ehr'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { staffApi, type DocumentRecord } from '../../../staff/api'
import { getEnvironment } from '../../../staff/env'
import { staffSessionGeneration, untilStaffSessionReady } from '../../../staff/session'
import type { Chart } from '../parts/chart'
import { SubHeading } from '../parts/Detail'
import { ErrorBox, Loading } from '../parts/Notices'
import { useClinical } from '../parts/Workspace'
import { RELOAD_FAILED, fileSize } from './encounters'
import type { RecordList } from './records'

const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff']
const MAX_BYTES = 52_428_800
/**
 * Today's OCR page, where today's link goes (staff/routes/Clinical.tsx Documents). It is today's provider route, not a
 * blue workspace, so it is named as today names it rather than below this page's base.
 */
const OCR_PATH = '/provider/ocr'
const OCR_LABEL = 'Extract with OCR'
/** Said when EHR holds more documents than today's read answers (it takes no cursor). */
export const DOCUMENTS_TRUNCATED = 'Not every document of this encounter is listed here.'
/** The More actions item that opens today's upload form. */
export const UPLOAD_LABEL = 'Upload document'
/** "Documents · referral-letter.pdf": a document's row in Connected hospital history, the control that opens it. */
export function documentLabel(document: DocumentRecord): string {
  return `Documents · ${document.fileName}`
}

/** Today's lines about a document: type, size and scan result, and what an unfinished upload means. */
export function documentDetail(document: DocumentRecord): string[] {
  const initiated = document.status === 'initiated'
  return [
    `${document.mediaType} · ${fileSize(document.sizeBytes)}${initiated ? '' : ` · scan: ${document.scanStatus}`}`,
    ...(initiated ? ['Upload not completed; only the person who started it can finish it. Upload the file again.'] : []),
  ]
}

/**
 * The documents' own states under Connected hospital history, as today's Documents tab says them: "Loading
 * documents…" while they are first read, and "No documents for this encounter." once read and empty (a refused read
 * is the history's alert). Nothing while there are documents, or without document read.
 */
export function DocumentsState({ list }: { list: RecordList<DocumentRecord> }) {
  if (list.items === null) return list.loading ? <Loading label="Loading documents…" /> : null
  return list.items.length === 0 && list.cursors.length < 2 ? <p>No documents for this encounter.</p> : null
}

/** A document opens only once its virus scan is clean (today's rule). */
export function canOpenDocument(document: DocumentRecord): boolean {
  return document.scanStatus === 'clean'
}

/**
 * Opening a document's file, as today's "Open file": the access re-check, today's signed download link (refused unless
 * it is a signed storage link), then a new tab with no opener, once the staff session is ready. `error` is today's
 * message for a file that could not be opened.
 */
export function useDocumentOpener(chart: Chart) {
  const { facilityId } = chart
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState('')
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
      setError(caught instanceof Error && caught.message ? caught.message : 'Document could not be opened.')
    } finally {
      setOpening(null)
    }
  }
  return { open, opening, error }
}

/**
 * Today's "Extract with OCR" for a clean document when the role may read OCR jobs: today's OCR route, with the ids in
 * router state, never in the address, as today (and who made the handoff, and where, since the history entry holding
 * it outlives both).
 */
export function OcrLink({ chart, document }: { chart: Chart; document: DocumentRecord }) {
  const { state } = useClinical()
  const actorId = state.status === 'ready' ? state.session.actor.id : undefined
  if (!chart.can('ocr.job.read') || !canOpenDocument(document)) return null
  return (
    <Link className="hid-ehr-clinical-link" to={OCR_PATH} state={{ ocrDocumentId: document.id, ocrPatientId: chart.patientId, actorId, facilityId: chart.facilityId }}>
      {OCR_LABEL}
    </Link>
  )
}

/**
 * Today's "Upload a document" (More actions, "Upload document"): the file checks, the access re-check, today's upload,
 * then the documents read again from the first page, with today's messages. The form stays for another file.
 * `footer` (its "Cancel") sits beside the upload button.
 */
export function UploadDocument({ chart, encounterId, list, footer }: { chart: Chart; encounterId: string; list: RecordList<DocumentRecord>; footer?: ReactNode }) {
  const { facilityId, patientId } = chart
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [fileError, setFileError] = useState<string | undefined>(undefined)
  const [uploading, setUploading] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const sending = useRef(false)

  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sending.current) return
    const form = event.currentTarget
    const file = input.current?.files?.[0]
    setError('')
    setNotice('')
    const refuse = (message: string) => { setFileError(message); input.current?.focus() }
    if (!file || file.size === 0) return refuse('Select a file first.')
    if (!ACCEPTED.includes(file.type) || file.size > MAX_BYTES) return refuse('Use PDF, JPEG, PNG, or TIFF, up to 50 MiB.')
    setFileError(undefined)
    sending.current = true
    setUploading(true)
    try {
      await chart.verify()
      await staffApi.uploadDocument(facilityId, patientId, encounterId, file)
      const failure = await list.reload(true)
      form.reset()
      setNotice('Document uploaded. It can be opened once its virus scan is clean.')
      if (failure !== null) setError(`${RELOAD_FAILED} ${failure}`.trim())
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : 'Document could not be uploaded.')
    } finally {
      sending.current = false
      setUploading(false)
    }
  }

  return (
    <form className="hid-ehr-clinical-form" noValidate onSubmit={event => void upload(event)}>
      <SubHeading>Upload a document</SubHeading>
      <p className="hid-ehr-clinical-note">Files are scanned before download becomes available.</p>
      <EhrField label={<>Clinical document<span aria-hidden="true"> *</span></>} error={fileError}>
        <EhrInput ref={input} name="document" type="file" accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff" required onChange={() => setFileError(undefined)} />
      </EhrField>
      <div className="hid-ehr-clinical-form-footer">
        <EhrButton type="submit" busy={uploading}>{uploading ? 'Uploading…' : UPLOAD_LABEL}</EhrButton>
        {footer}
      </div>
      <div role="status" className="hid-ehr-clinical-status">{notice}</div>
      {error ? <ErrorBox>{error}</ErrorBox> : null}
    </form>
  )
}
