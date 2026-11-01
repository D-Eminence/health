import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, ExternalLink, Paperclip } from 'lucide-react'
import { assertSignedStorageUrl } from '@hid/http'
import { Button, Card, CardHeader, Field, cx } from '../../../kasuwa/ui'
import {
  documentTypeLabel, documentTypeOf, documentTypeRefusalText, documentTypesHere, learnDocumentTypesFrom, useDocumentTypesServed,
  type DocumentType,
} from '../../../documentTypes'
import { staffApi, type DocumentRecord } from '../../../staff/api'
import { getEnvironment } from '../../../staff/env'
import { problemText, refusal, type FieldProblem } from '../../../staff/fieldProblem'
import { useFocusById } from '../../../staff/focus'
import { staffSessionGeneration, untilStaffSessionReady } from '../../../staff/session'
import { DeptNotice } from './DeptNotice'
import { errorText } from './errors'

/*
 * The documents kept on one Lab or Pharmacy work item (the owner's rule of 31 Oct, documentTypes.ts): a laboratory
 * attaches a lab result to its Lab work item and a pharmacy a prescription sheet to its Pharmacy work item, since lab
 * and pharmacy staff open no encounters. The file goes up exactly as chosen (staffApi.uploadWorkItemDocument PUTs the
 * File itself), and the backend scans it, and reads a lab result by OCR once the scan is clean; the page only says so.
 *
 * Dormant until the backend serves it: the card shows only once a Lab or Pharmacy work list (or the EHR's document list)
 * has answered `documentTypes: true`, on a host that may upload the kind's type, to a member who may read or attach the
 * kind's documents. Until then nothing of it renders, nothing is read and nothing is sent, so today's screens and
 * requests stay exactly as they are.
 *
 * Drawn in the redesign's parts (kasuwa/ui), as a supporting card of the record: a Card with an h2 header, beside the
 * Request card on a Lab request and the Prescription card on a Pharmacy record.
 */

export type WorkItemKind = 'lab' | 'pharmacy'

interface Words {
  readonly type: DocumentType
  readonly read: string
  readonly write: string
  readonly title: string
  readonly empty: string
  readonly file: string
  readonly submit: string
  readonly hint: string
  readonly attached: string
}

const WORDS: Readonly<Record<WorkItemKind, Words>> = {
  lab: {
    type: 'lab_result',
    read: 'lab.document.read',
    write: 'lab.document.write',
    title: 'Result documents',
    empty: 'No result documents yet.',
    file: 'Lab result file',
    submit: 'Attach result document',
    hint: 'PDF, JPEG, PNG or TIFF, up to 50 MiB. Images are kept exactly as uploaded, and Health ID reads a lab result by '
      + 'itself once its virus scan is clean.',
    attached: 'Result document attached. It can be opened once its virus scan is clean.',
  },
  pharmacy: {
    type: 'prescription_sheet',
    read: 'pharmacy.document.read',
    write: 'pharmacy.document.write',
    title: 'Prescription sheets',
    empty: 'No prescription sheets yet.',
    file: 'Prescription sheet file',
    submit: 'Attach prescription sheet',
    hint: 'PDF, JPEG, PNG or TIFF, up to 50 MiB.',
    attached: 'Prescription sheet attached. It can be opened once its virus scan is clean.',
  },
}

/** Today's client checks on a document (the classic Documents card's), word for word. */
const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff']
const MAX_BYTES = 52_428_800
const NO_FILE = 'Select a file first.'
const WRONG_FILE = 'Use PDF, JPEG, PNG, or TIFF, up to 50 MiB.'
const LOAD_FAILED = 'Documents could not be loaded.'
const ATTACH_FAILED = 'The document could not be attached.'
const OPEN_FAILED = 'The document could not be opened.'

/**
 * A Lab or Pharmacy work list that answered teaches the page whether the document types are served. Only an answer
 * is passed: a list not read yet says nothing.
 */
export function useLearnDocumentTypesServed(answer: unknown) {
  useEffect(() => { if (answer) learnDocumentTypesFrom(answer) }, [answer])
}

export interface WorkItemDocumentsProps {
  readonly kind: WorkItemKind
  readonly facilityId: string
  readonly workItemId: string
  /** The work item's own patient, as its list carries it: the documents are that patient's. Never shown here. */
  readonly patientId: string
  readonly permissions: readonly string[]
  /** Whether the work item may still be written to: on work whose order from another facility has closed, it may not. */
  readonly writable: boolean
}

/**
 * "Result documents" on a Lab record, "Prescription sheets" on a Pharmacy record: the work item's documents and a form
 * to attach one. Nothing at all until served, on a host that may not upload the type, or without the kind's document
 * permissions.
 */
export function WorkItemDocuments({ kind, facilityId, workItemId, patientId, permissions, writable }: WorkItemDocumentsProps) {
  const served = useDocumentTypesServed() === true
  const words = WORDS[kind]
  const canRead = permissions.includes(words.read)
  const canWrite = permissions.includes(words.write)
  // A work item with no patient on Health ID (a walk-in without a Health ID) has nothing to keep a document on.
  if (!served || !patientId || !documentTypesHere().includes(words.type) || !(canRead || canWrite)) return null
  // One card for each open work item: its documents are read when it shows, and again after an attach.
  return <WorkItemDocumentsCard key={`${facilityId}:${kind}:${workItemId}:${patientId}`} kind={kind} facilityId={facilityId}
    workItemId={workItemId} patientId={patientId} canRead={canRead} canWrite={canWrite && writable} />
}

/** A file size as EHR sends it, a number or text, in KiB. */
function fileSize(value: number | string | null | undefined): string {
  const count = value == null || value === '' ? NaN : Number(value)
  return Number.isFinite(count) && count >= 0 ? `${Math.ceil(count / 1024).toLocaleString()} KiB` : 'Size unavailable'
}

function words(value: string): string {
  return value.replaceAll('_', ' ').toLowerCase()
}

/** A listed document's media type, size and virus scan, as the classic Documents card says them. */
function documentLine(document: DocumentRecord): string {
  const scan = document.status === 'initiated' ? '' : ` · scan: ${words(document.scanStatus)}`
  return `${document.mediaType} · ${fileSize(document.sizeBytes)}${scan}`
}

/**
 * Only documents of this work item's patient, kept on this work item, are shown: one the answer says belongs to another
 * patient or another work item is left out.
 */
function keptOn(document: DocumentRecord, kind: WorkItemKind, workItemId: string, patientId: string): boolean {
  const on = kind === 'lab' ? document.labWorkItemId : document.pharmacyWorkItemId
  return document.patientId === patientId && (on === undefined || on === workItemId)
}

interface Listed { readonly items: readonly DocumentRecord[] | null; readonly loading: boolean; readonly error: string }

function WorkItemDocumentsCard({ kind, facilityId, workItemId, patientId, canRead, canWrite }: {
  readonly kind: WorkItemKind; readonly facilityId: string; readonly workItemId: string; readonly patientId: string
  readonly canRead: boolean; readonly canWrite: boolean
}) {
  const said = WORDS[kind]
  const base = `${kind}-${workItemId}-documents`
  const fileId = `${base}-file`
  const submitId = `${base}-submit`
  const focus = useFocusById()
  const [listed, setListed] = useState<Listed>({ items: null, loading: canRead, error: '' })
  const sequence = useRef(0)
  const read = useCallback(async () => {
    const request = ++sequence.current
    setListed(previous => ({ ...previous, loading: true, error: '' }))
    try {
      const page = await staffApi.workItemDocuments(facilityId, patientId, { kind, id: workItemId })
      if (request !== sequence.current) return
      setListed({ items: page.items.filter(document => keptOn(document, kind, workItemId, patientId)), loading: false, error: '' })
    } catch (caught) {
      if (request !== sequence.current) return
      setListed(previous => ({ ...previous, loading: false, error: errorText(caught, LOAD_FAILED) }))
    }
  }, [facilityId, patientId, kind, workItemId])
  useEffect(() => {
    if (canRead) void read()
    return () => { sequence.current += 1 }
  }, [canRead, read])

  const [opening, setOpening] = useState<string | null>(null)
  const [openError, setOpenError] = useState('')
  async function open(document: DocumentRecord) {
    if (opening) return
    setOpenError('')
    setOpening(document.id)
    // The document opens in a tab of its own only while the session it was asked in is ready.
    const sentIn = staffSessionGeneration()
    try {
      const result = await staffApi.documentDownload(facilityId, document.id)
      // Only a signed storage link opens: never javascript:, data: or plain http to another host.
      assertSignedStorageUrl(result.url, { allowLocalHttp: getEnvironment().name === 'local', code: 'INVALID_DOWNLOAD_URL',
        message: OPEN_FAILED })
      await untilStaffSessionReady(sentIn)
      window.open(result.url, '_blank', 'noopener,noreferrer')
    } catch (caught) {
      setOpenError(caught instanceof Error && caught.message ? caught.message : OPEN_FAILED)
    } finally {
      setOpening(null)
    }
  }

  // Whether the card is still shown: an attach that ends after its record was left reads its documents no more.
  const shown = useRef(true)
  useEffect(() => {
    shown.current = true
    return () => { shown.current = false }
  }, [])

  const [problem, setProblem] = useState<FieldProblem | null>(null)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const [attachError, setAttachError] = useState('')
  const [notice, setNotice] = useState('')
  async function attach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // The button stays focusable while the upload runs; a second press does nothing.
    if (sending.current) return
    const form = event.currentTarget
    const control = form.elements.namedItem('document')
    const file = control instanceof HTMLInputElement ? control.files?.[0] : undefined
    setAttachError(''); setNotice('')
    const refused = !file || file.size === 0 ? NO_FILE : !ACCEPTED.includes(file.type) || file.size > MAX_BYTES ? WRONG_FILE : ''
    if (refused || !file) {
      setProblem(refusal({ field: fileId, message: refused || NO_FILE }))
      focus(fileId)
      return
    }
    setProblem(null)
    sending.current = true
    setBusy(true)
    try {
      // The File itself goes up, never re-encoded: it is kept exactly as chosen.
      await staffApi.uploadWorkItemDocument(facilityId, patientId, { kind, id: workItemId }, file, said.type)
      form.reset()
      setNotice(said.attached)
      if (canRead && shown.current) await read()
    } catch (caught) {
      // The backend's refusal of a lab result on this host (403 DOCUMENT_TYPE_NOT_ALLOWED_HERE) in the core's words; those
      // words are about lab results, so any other type's refusal keeps the backend's own.
      const typeRefused = said.type === 'lab_result' ? documentTypeRefusalText(caught) : null
      setAttachError(typeRefused ?? errorText(caught, ATTACH_FAILED))
      focus(submitId, true)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const items = listed.items ?? []
  const error = problemText(problem, fileId)
  const titleId = `${base}-title`
  return <Card>
    <CardHeader as="h2" title={said.title} titleId={titleId} />
    <div className="flex flex-col gap-4 p-5">
      {canRead && <>
        {listed.error && <DeptNotice tone="critical" role="alert">{listed.error}</DeptNotice>}
        {listed.loading && listed.items === null && <p role="status" className="m-0 text-[14px] text-ink-3">Loading documents…</p>}
        {listed.items !== null && items.length === 0 && <p className="m-0 text-[15px] text-ink-2">{said.empty}</p>}
        {items.length > 0 && <ul className="m-0 flex list-none flex-col divide-y divide-line p-0" aria-labelledby={titleId}>
          {items.map(document => {
            const type = documentTypeOf(document)
            const name = `${base}-${document.id}-name`
            return <li key={document.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
              <div className="flex min-w-0 flex-[1_1_14rem] flex-col items-start gap-0.5">
                {type && <span className="text-[12px] font-semibold tracking-[.06em] text-ink-3 uppercase">{documentTypeLabel(type)}</span>}
                <span id={name} className="text-[15px] font-medium text-ink [overflow-wrap:anywhere]">{document.fileName}</span>
                <span className="text-[13px] text-ink-3 tabular">{documentLine(document)}</span>
                {document.status === 'initiated' && <span className="text-[13px] text-ink-3">Upload not completed. Only the person who
                  started it can finish it: attach the file again.</span>}
              </div>
              {/* Busy while its link is asked for, but never disabled: a disabled button would lose the focus it has. */}
              {document.scanStatus === 'clean' && document.status !== 'initiated' && <Button size="sm" icon={ExternalLink}
                aria-describedby={name} aria-busy={opening === document.id || undefined} aria-disabled={opening === document.id || undefined}
                onClick={() => void open(document)}>Open file</Button>}
            </li>
          })}
        </ul>}
        {openError && <DeptNotice tone="critical" role="alert">{openError}</DeptNotice>}
      </>}
      {canWrite && <form className={cx('flex flex-col gap-4', canRead && 'border-t border-line pt-4')} aria-label={said.submit} noValidate
        onSubmit={event => void attach(event)}>
        <Field label={<>{said.file}<span aria-hidden="true"> *</span></>} htmlFor={fileId} error={error} errorId={`${fileId}-error`}
          hint={said.hint} hintId={`${fileId}-hint`}>
          <input id={fileId} name="document" type="file" accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff" required
            aria-invalid={error ? true : undefined} aria-describedby={error ? `${fileId}-error` : `${fileId}-hint`}
            onChange={() => setProblem(null)}
            className="block w-full min-w-0 text-[14px] text-ink-2 file:mr-3 file:h-10 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface file:px-4 file:text-sm file:font-medium file:text-ink file:ring-1 file:ring-line-strong file:ring-inset hover:file:bg-subtle" />
        </Field>
        {attachError && <DeptNotice tone="critical" role="alert">{attachError}</DeptNotice>}
        {/* Busy while the file goes up, but never disabled: a disabled button would lose the focus it has. */}
        <Button id={submitId} type="submit" icon={busy ? undefined : Paperclip} aria-busy={busy || undefined} aria-disabled={busy || undefined}
          className="self-start">{busy ? 'Attaching…' : said.submit}</Button>
        {/* Mounted throughout, so what an attach says is announced. */}
        <div role="status">{notice && <p className="m-0 inline-flex items-center gap-2 text-[15px] font-medium text-success-ink">
          <Check className="size-4 shrink-0" aria-hidden />{notice}</p>}</div>
      </form>}
    </div>
  </Card>
}
