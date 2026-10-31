import { assertSignedStorageUrl } from '@hid/http'
import { EhrButton, EhrCard, EhrField, EhrInput } from '@hid/ui/ehr'
import { useRef, useState, type FormEvent } from 'react'
import { staffApi, type DocumentRecord } from '../../../staff/api'
import { getEnvironment } from '../../../staff/env'
import { staffSessionGeneration, untilStaffSessionReady } from '../../../staff/session'
import type { Chart } from '../parts/chart'
import { SubHeading } from '../parts/Detail'
import { ErrorBox, Loading } from '../parts/Notices'
import { StatusBadge } from '../parts/StatusBadge'
import { fileSize } from './encounters'
import type { RecordList } from './records'

const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff']
const MAX_BYTES = 52_428_800

/**
 * The encounter's documents (today's Documents tab): each with its type, size and scan result, "Open file" only once
 * the virus scan is clean, and "Upload a document". Opening and uploading re-check access first, as today.
 */
export function DocumentsCard({ chart, encounterId, list, canWrite }: {
  chart: Chart
  encounterId: string
  list: RecordList<DocumentRecord>
  canWrite: boolean
}) {
  const { facilityId, patientId } = chart
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
    if (!ACCEPTED.includes(file.type) || file.size > MAX_BYTES) return refuse('Use a PDF, JPEG, PNG or TIFF file up to 50 MB.')
    setFileError(undefined)
    sending.current = true
    setUploading(true)
    try {
      await chart.verify()
      await staffApi.uploadDocument(facilityId, patientId, encounterId, file)
      await list.reload()
      form.reset()
      setNotice('Uploaded. It can be opened once the virus check is done.')
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
                  <span className="hid-ehr-clinical-cell-sub">Upload didn’t finish. Upload the file again.</span>
                ) : null}
              </span>
              <span className="hid-ehr-clinical-consult-document-actions">
                {document.status ? <StatusBadge status={document.status} /> : null}
                <EhrButton variant="secondary" size="sm" disabled={document.scanStatus !== 'clean'} busy={opening === document.id}
                  aria-label={`Open file ${document.fileName}`} onClick={() => open(document)}>
                  Open file
                </EhrButton>
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
