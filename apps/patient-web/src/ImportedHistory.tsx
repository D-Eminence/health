import { useEffect, useRef, useState } from 'react'
import type { ImportedAttachmentDownload, ImportedMedicalRecord, ImportedRecordVersion } from './importedRecords'
import './imported-history.css'

function date(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'Date unavailable' : parsed.toLocaleDateString('en-NG', { dateStyle: 'medium' })
}
function label(value: string) {
  const labels: Record<string, string> = {
    medication_name: 'Medication', prescribing_provider: 'Prescribed by', start_date: 'Start date', end_date: 'End date',
  }
  if (Object.hasOwn(labels, value)) return labels[value]!
  const text = value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim()
  return text ? text[0]!.toUpperCase() + text.slice(1) : 'Information'
}
function present(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.some(present)
  if (typeof value === 'object') return Object.values(value).some(present)
  return true
}
function InformationValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) return <ul>{value.filter(present).map((item, index) => <li key={index}><InformationValue value={item} /></li>)}</ul>
  if (value !== null && typeof value === 'object') return <dl className="imported-history-fields">
    {Object.entries(value).filter(([, item]) => present(item)).map(([key, item]) => <div key={key}>
      <dt>{label(key)}</dt><dd><InformationValue value={item} /></dd>
    </div>)}
  </dl>
  const text = typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value ?? '').trim()
  // Date-only source fields retain their calendar day in every browser timezone.
  const display = /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(Date.parse(text)) && new Date(text).toISOString().slice(0, 10) === text
    ? new Date(text).toLocaleDateString('en-NG', { dateStyle: 'medium', timeZone: 'UTC' }) : text
  return <span className="imported-history-value">{display}</span>
}
function VersionContent({ version }: { version: ImportedRecordVersion }) {
  const compare = (value: unknown) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  const notes = compare(version.notes)
  const record = compare(version.record)
  // Legacy records sometimes include the notes heading and repeat the same notes.
  const duplicateRecord = notes && (record === notes || record.replace(/^Notes\s+/i, '') === notes)
  const sections = [
    ['Record', duplicateRecord ? null : version.record], ['Notes', version.notes], ['Details', version.structuredData],
    ['Transcription', version.transcriptionText],
  ] as const
  return <div className="imported-history-content">{sections.map(([heading, value]) => {
    return present(value) ? <div key={heading}><h4>{heading}</h4><InformationValue value={value} /></div> : null
  })}</div>
}

export function ImportedHistory({ records, limit, download, allowLocalHttp = false }: {
  records: ImportedMedicalRecord[]; limit: number
  download?: (fileId: string, signal: AbortSignal) => Promise<ImportedAttachmentDownload>
  allowLocalHttp?: boolean
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => { controller.current?.abort() }, [])
  async function openFile(fileId: string) {
    if (!download || controller.current) return
    const request = new AbortController()
    controller.current = request; setBusy(fileId); setError('')
    try {
      const result = await download(fileId, request.signal)
      if (request.signal.aborted) return
      let url: URL
      try { url = new URL(result.url) } catch { throw new Error('The attachment link is invalid.') }
      const local = allowLocalHttp && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      if ((url.protocol !== 'https:' && !local) || url.username || url.password) throw new Error('The attachment link is invalid.')
      const link = document.createElement('a')
      link.href = url.toString(); link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer'
      link.click()
    } catch (caught) {
      if (!request.signal.aborted) setError(caught instanceof Error ? caught.message : 'The attachment could not be opened.')
    } finally {
      if (!request.signal.aborted) { controller.current = null; setBusy(null) }
    }
  }
  return <section className="imported-history" aria-label="Imported medical history">
    <h2>Imported medical history</h2>
    <p>Medical information preserved from the previous Health ID system.</p>
    {error && <p role="alert">{error}</p>}
    {records.length === 0 ? <p>No imported medical history is available.</p> : <div className="imported-history-list">
      {records.map(record => {
        const current = record.versions.find(version => version.id === record.currentVersionId)!
        return <article className="imported-history-card" key={record.id}>
          <header><h3>{record.title || 'Imported medical record'}</h3><span className="imported-history-origin">
            {record.origin === 'patient-provided' ? 'Patient reported' : 'Provider authored'}</span></header>
          <p>{[record.infoType || record.category ? label(record.infoType || record.category!) : '', date(record.createdAt)].filter(Boolean).join(' · ')}</p>
          <VersionContent version={current} />
          {record.versions.length > 1 && <details><summary>Previous versions</summary>{record.versions.filter(version => version.id !== record.currentVersionId)
            .map(version => <div key={version.id}><h4>Version {version.versionNo} · {date(version.createdAt)}</h4><VersionContent version={version} /></div>)}</details>}
          {record.files.length > 0 && <div><h4>Attachments</h4><ul>{record.files.map(file => <li key={file.id}>
            <span>{file.fileName || 'Attachment'}</span>{file.accessStatus === 'available'
              ? download ? <button type="button" disabled={busy !== null} onClick={() => void openFile(file.id)}>
                {busy === file.id ? 'Opening…' : `Download ${file.fileName || 'attachment'}`}</button> : <span>Document access permission required.</span>
              : <span>{file.accessStatus === 'rejected' ? 'Download unavailable: file failed safety verification.' : 'Download pending safety verification.'}</span>}
          </li>)}</ul></div>}
        </article>
      })}
    </div>}
    {records.length > 0 && <p>Showing up to {limit} imported records, newest first.</p>}
  </section>
}
