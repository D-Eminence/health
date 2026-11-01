import { assertSignedStorageUrl } from '@hid/http'
import { EhrButton, EhrCard, EhrField, EhrInput } from '@hid/ui/ehr'
import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { staffApi, type DocumentRecord } from '../../../staff/api'
import { getEnvironment } from '../../../staff/env'
import { staffSessionGeneration, untilStaffSessionReady } from '../../../staff/session'
import type { Chart } from '../parts/chart'
import { SubHeading } from '../parts/Detail'
import { ErrorBox, Loading } from '../parts/Notices'
import { StatusBadge } from '../parts/StatusBadge'
import { useClinical } from '../parts/Workspace'
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

/**
 * The encounter's documents (today's Documents tab), 50 to a page: each with its type, size and scan result, "Open
 * file" only once the virus scan is clean, today's "Extract with OCR" for a clean one when the role may read OCR jobs
 * (the ids go in router state, never in the address, as today), and "Upload a document". Opening and uploading
 * re-check access first, as today.
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
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [fileError, setFileError] = useState<string | undefined>(undefined)
  const [uploading, setUploading] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const sending = useRef(false)

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
      setNotice('Uploaded. It can be opened once the virus check is done.')
      if (failure !== null) setError(`${RELOAD_FAILED} ${failure}`.trim())
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : 'Document could not be uploaded.')
    } finally {
      sending.current = false
      setUploading(false)
    }
  }

  return (
    <EhrCard title="Documents">
      {list.error ? <ErrorBox>{list.error}</ErrorBox> : null}
      <ListPaging list={list} />
      {list.truncated ? <p className="hid-ehr-clinical-note">{DOCUMENTS_TRUNCATED}</p> : null}
      {list.items === null ? (list.loading ? <Loading label="Loading documents…" /> : null) : list.items.length === 0 ? (
        <p>No documents for this encounter.</p>
      ) : (
        <ul className="hid-ehr-clinical-history-list">
          {list.items.map(document => (
            <li key={document.id} className="hid-ehr-clinical-history-row">
              <span>
                <strong>{document.fileName}</strong>
                <span className="hid-ehr-clinical-cell-sub">
                  {`${fileType(document.mediaType)} · ${fileSize(document.sizeBytes)}${document.status === 'initiated' ? '' : ` · ${scanWords(document.scanStatus)}`}`}
                </span>
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
      {canWrite ? (
        <form className="hid-ehr-clinical-form" noValidate onSubmit={event => void upload(event)}>
          <SubHeading>Upload a document</SubHeading>
          <p className="hid-ehr-clinical-note">Files are checked for viruses before anyone can open them.</p>
          <EhrField label={<>Clinical document<span aria-hidden="true"> *</span></>} error={fileError}>
            <EhrInput ref={input} name="document" type="file" accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff" required onChange={() => setFileError(undefined)} />
          </EhrField>
          <div className="hid-ehr-clinical-form-footer">
            <EhrButton type="submit" variant="secondary" busy={uploading}>{uploading ? 'Uploading…' : 'Upload document'}</EhrButton>
          </div>
          <div role="status" className="hid-ehr-clinical-status">{notice}</div>
        </form>
      ) : null}
      {error ? <ErrorBox>{error}</ErrorBox> : null}
    </EhrCard>
  )
}

/** A file's type in words: "PDF", not "application/pdf". */
function fileType(mediaType: string): string {
  const named: Record<string, string> = { 'application/pdf': 'PDF', 'image/jpeg': 'JPEG image', 'image/png': 'PNG image', 'image/tiff': 'TIFF image' }
  return named[mediaType] ?? mediaType
}

/** The virus check in words. */
function scanWords(scanStatus: string): string {
  const named: Record<string, string> = { clean: 'Checked', pending: 'Being checked', infected: 'Blocked: virus found', failed: 'Check failed' }
  return named[scanStatus] ?? `Check: ${scanStatus.replaceAll('_', ' ')}`
}
