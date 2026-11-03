import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { Alert, Button } from './kasuwa/ui'
import type { ImportedAttachmentDownload, ImportedMedicalRecord, ImportedRecordVersion } from './importedRecords'
import { dayWords, groupByDay as byDay, matchesQuery, textOf } from './routes/recordSearch'
import './imported-history.css'
import { PlainError, plainErrorText } from '@hid/http'

function date(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'No date' : parsed.toLocaleDateString('en-NG', { dateStyle: 'medium' })
}
function label(value: string) {
  const labels: Record<string, string> = {
    medication_name: 'Medicine', prescribing_provider: 'Prescribed by', start_date: 'Start date', end_date: 'End date',
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
const originLabel = (record: ImportedMedicalRecord) => record.origin === 'patient-provided' ? 'Added by patient' : 'From a doctor or hospital'

/**
 * Everything the card shows of a record, for the patient's search: its title, kind, date and the day heading it is
 * under, every version and file.
 */
export function importedRecordText(record: ImportedMedicalRecord): string[] {
  return [record.title, record.infoType || record.category ? label(record.infoType || record.category!) : null,
    originLabel(record), date(record.createdAt), dayWords(record.createdAt),
    ...record.versions.flatMap(version => textOf([version.record, version.notes, version.structuredData, version.transcriptionText])),
    ...record.files.map(file => file.fileName)].filter((text): text is string => Boolean(text))
}

/** The records the patient's search matches: all of them, the same list, when nothing is searched. */
export function matchingImported(records: readonly ImportedMedicalRecord[], query: string): readonly ImportedMedicalRecord[] {
  return query.trim() ? records.filter(record => matchesQuery(importedRecordText(record), query)) : records
}

function VersionContent({ version, level }: { version: ImportedRecordVersion; level: 4 | 5 }) {
  const Heading = level === 4 ? 'h4' : 'h5'
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
    return present(value) ? <div key={heading}><Heading>{heading}</Heading><InformationValue value={value} /></div> : null
  })}</div>
}

export function ImportedHistory({ records, limit, download, allowLocalHttp = false, paged = false, query = '', groupedByDay = false }: {
  records: ImportedMedicalRecord[]; limit: number
  /** Read a page at a time (hid-system main): the footer counts what is shown rather than naming a limit. */
  paged?: boolean
  download?: (fileId: string, signal: AbortSignal) => Promise<ImportedAttachmentDownload>
  allowLocalHttp?: boolean
  /** The patient's search (routes/recordSearch.ts): only the records it matches are shown. */
  query?: string
  /** Under day headings, newest day first, as the patient's records page lists them. */
  groupedByDay?: boolean
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
      try { url = new URL(result.url) } catch { throw new PlainError('This file link doesn’t work. Try again later.') }
      const local = allowLocalHttp && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      if ((url.protocol !== 'https:' && !local) || url.username || url.password) throw new PlainError('This file link doesn’t work. Try again later.')
      const link = document.createElement('a')
      link.href = url.toString(); link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer'
      link.click()
    } catch (caught) {
      if (!request.signal.aborted) setError(plainErrorText(caught, 'Couldn’t open the file. Try again.'))
    } finally {
      if (!request.signal.aborted) { controller.current = null; setBusy(null) }
    }
  }
  // Under day headings each record's title is a level lower, and so is everything inside it.
  const Title = groupedByDay ? 'h4' : 'h3'
  const Inner = groupedByDay ? 'h5' : 'h4'
  const innerLevel = groupedByDay ? 5 : 4
  const card = (record: ImportedMedicalRecord) => {
    const current = record.versions.find(version => version.id === record.currentVersionId)!
    return <article className="imported-history-card" key={record.id}>
      <header><Title>{record.title || 'Older health record'}</Title><span className="imported-history-origin">{originLabel(record)}</span></header>
      <p>{[record.infoType || record.category ? label(record.infoType || record.category!) : '', date(record.createdAt)].filter(Boolean).join(' · ')}</p>
      <VersionContent version={current} level={innerLevel} />
      {record.versions.length > 1 && <details><summary>Previous versions</summary>{record.versions.filter(version => version.id !== record.currentVersionId)
        .map(version => <div key={version.id}><Inner>Version {version.versionNo} · {date(version.createdAt)}</Inner><VersionContent version={version} level={innerLevel} /></div>)}</details>}
      {record.files.length > 0 && <div><Inner>Files</Inner><ul>{record.files.map(file => <li key={file.id}>
        <span>{file.fileName || 'File'}</span>{file.accessStatus === 'available'
          ? download ? <Button size="sm" icon={Download} loading={busy === file.id} disabled={busy !== null} onClick={() => void openFile(file.id)}>
            {busy === file.id ? 'Opening…' : <>Download{' '}<span className="sr-only">{file.fileName || 'file'}</span></>}</Button> : <span>You can’t open this file here.</span>
          : <span>{file.accessStatus === 'rejected' ? 'This file can’t be opened. It failed our safety check.' : 'This file is still being checked for safety.'}</span>}
      </li>)}</ul></div>}
    </article>
  }
  const shown = matchingImported(records, query)
  const searching = shown !== records
  return <section className="imported-history" aria-label="Older health records">
    <h2>Older health records</h2>
    <p>From the old Health ID system.</p>
    {error && <Alert intent="error" size="sm">{error}</Alert>}
    {records.length === 0 ? <p>No older records.</p>
      : shown.length === 0 ? <p>No older records match your search.</p>
      : groupedByDay ? byDay(shown, record => record.createdAt).map(group => <div className="imported-history-day" key={group.day ?? 'undated'}>
        <h3 className="m-0 rounded-md bg-subtle px-3 py-2 text-overline text-ink-3">{group.label}</h3><div className="imported-history-list">{group.items.map(card)}</div></div>)
      : <div className="imported-history-list">{shown.map(card)}</div>}
    {records.length > 0 && <p>{searching ? `${shown.length} of ${records.length} older ${records.length === 1 ? 'record' : 'records'} match your search.`
      : paged ? `Showing ${records.length} older ${records.length === 1 ? 'record' : 'records'}, newest first.` : `Showing up to ${limit} older records, newest first.`}</p>}
  </section>
}
