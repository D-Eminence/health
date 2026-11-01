import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { assertSignedStorageUrl } from '@hid/http'
import { Button, Card, Field, Input } from '@hid/ui'
import {
  documentTypeLabel, documentTypeOf, documentTypeRefusalText, documentTypesHere, learnDocumentTypesFrom, useDocumentTypesServed,
  type DocumentType,
} from '../../documentTypes'
import { staffApi, type DocumentRecord } from '../api'
import { getEnvironment } from '../env'
import { refusalText } from '../fieldProblem'
import { BUSY, UNAVAILABLE, useFocusById } from '../focus'
import { useFieldProblems } from '../useFieldProblems'
import { staffSessionGeneration, untilStaffSessionReady } from '../session'

/*
 * The documents kept on one Lab or Pharmacy work item, on the classic Laboratory and Pharmacy pages ("Use the classic
 * EHR"), with the same rules as the blue card (ehr-blue/departments/parts/WorkItemDocuments.tsx) in the classic page's
 * parts: a laboratory attaches a lab result to its Lab work item and a pharmacy a prescription sheet to its Pharmacy work
 * item (the owner's rule of 31 Oct, documentTypes.ts), since lab and pharmacy staff open no encounters. The file goes up
 * exactly as chosen (staffApi.uploadWorkItemDocument PUTs the File itself); the backend scans it, and reads a lab result
 * by itself once the scan is clean. The page only says so.
 *
 * Dormant until the backend serves it: nothing of it shows until a Lab or Pharmacy work list (or the EHR's document list)
 * has answered `documentTypes: true`, on a host that may upload the kind's type, to a member who may read or attach the
 * kind's documents. Until then nothing of it renders, nothing is read and nothing is sent: the pages and their requests
 * stay exactly today's.
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

/** The blue card's words, so both EHRs say the same thing. */
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
const ATTACH_FAILED = 'Document could not be attached.'
const OPEN_FAILED = 'Document could not be opened.'
const CLOSED = 'This order from another facility has ended: nothing more can be attached to it.'

/**
 * A Lab or Pharmacy work list that answered teaches the page whether the document types are served (documentTypes.ts).
 * Only an answer is passed: a list not read yet says nothing. It sends nothing.
 */
export function useLearnDocumentTypesServed(answer: unknown) {
  useEffect(() => { if (answer) learnDocumentTypesFrom(answer) }, [answer])
}

/**
 * Whether a work item's documents are offered here: once served, on a host that may upload the kind's type, to a member
 * who may read or attach the kind's documents. False until then, so the page shows and sends exactly what it does today.
 */
export function useWorkItemDocumentsOffered(kind: WorkItemKind, permissions: readonly string[]): boolean {
  const served = useDocumentTypesServed() === true
  const words = WORDS[kind]
  return served && documentTypesHere().includes(words.type)
    && (permissions.includes(words.read) || permissions.includes(words.write))
}

/** The id of a work item's documents heading, which takes focus when the card is opened from elsewhere on the page. */
export function workItemDocumentsTitleId(kind: WorkItemKind, workItemId: string): string {
  return `${kind}-${workItemId}-documents-title`
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
  /** What the work is (a test's name), where the card is shown apart from its row. Never the patient. */
  readonly about?: string
}

/**
 * "Result documents" for a Lab work item, "Prescription sheets" for a Pharmacy one: the work item's documents and a form
 * to attach one. Nothing at all until served, on a host that may not upload the type, or without the kind's document
 * permissions.
 */
export function WorkItemDocuments({ kind, facilityId, workItemId, patientId, permissions, writable, about }: WorkItemDocumentsProps) {
  const offered = useWorkItemDocumentsOffered(kind, permissions)
  // A work item with no patient on Health ID (a walk-in without a Health ID) has nothing to keep a document on.
  if (!offered || !patientId) return null
  const words = WORDS[kind]
  // One card for each work item: its documents are read when it shows, and again after an attach.
  return <WorkItemDocumentsCard key={`${facilityId}:${kind}:${workItemId}:${patientId}`} kind={kind} facilityId={facilityId}
    workItemId={workItemId} patientId={patientId} about={about} canRead={permissions.includes(words.read)}
    canWrite={permissions.includes(words.write)} writable={writable} />
}

/** A file size as EHR sends it, a number or text, in KiB (the classic Documents card's). */
function fileSize(value: number | string | null | undefined): string {
  const count = value == null || value === '' ? NaN : Number(value)
  return Number.isFinite(count) && count >= 0 ? `${Math.ceil(count / 1024).toLocaleString()} KiB` : 'Size unavailable'
}

function words(value: string): string {
  return value.replaceAll('_', ' ').toLowerCase()
}

/** A listed document's type, media type, size and virus scan, as the classic Documents card says them once served. */
function documentLine(document: DocumentRecord): string {
  const type = documentTypeOf(document)
  const scan = document.status === 'initiated' ? '' : ` · scan: ${words(document.scanStatus)}`
  return `${type ? `${documentTypeLabel(type)} · ` : ''}${document.mediaType} · ${fileSize(document.sizeBytes)}${scan}`
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

function WorkItemDocumentsCard({ kind, facilityId, workItemId, patientId, about, canRead, canWrite, writable }: {
  readonly kind: WorkItemKind; readonly facilityId: string; readonly workItemId: string; readonly patientId: string
  readonly about?: string; readonly canRead: boolean; readonly canWrite: boolean; readonly writable: boolean
}) {
  const said = WORDS[kind]
  const base = `${kind}-${workItemId}-document`
  const titleId = workItemDocumentsTitleId(kind, workItemId)
  const fileId = `${base}-file`
  const submitId = `${base}-submit`
  const focus = useFocusById()
  const problems = useFieldProblems()

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
      setListed(previous => ({ ...previous, loading: false, error: refusalText(caught, LOAD_FAILED) }))
    }
  }, [facilityId, patientId, kind, workItemId])
  useEffect(() => {
    if (canRead) void read()
    return () => { sequence.current += 1 }
  }, [canRead, read])

  const [opening, setOpening] = useState<string | null>(null)
  const [openError, setOpenError] = useState('')
  async function open(document: DocumentRecord) {
    // The button stays focusable while its link is asked for; a second press does nothing.
    if (opening) return
    setOpenError('')
    setOpening(document.id)
    // The document opens in a tab of its own only while the session it was asked in is ready.
    const sentIn = staffSessionGeneration()
    try {
      const result = await staffApi.documentDownload(facilityId, document.id)
      // Only a signed storage link opens: never javascript:, data: or plain http to another host, whatever a faulty
      // backend or proxy sends.
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

  // Whether the card is still shown: an attach that ends after its work item was left reads its documents no more.
  const shown = useRef(true)
  useEffect(() => {
    shown.current = true
    return () => { shown.current = false }
  }, [])

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
    setAttachError(''); setNotice(''); problems.clear()
    if (!file || file.size === 0) return problems.refuse(fileId, NO_FILE)
    if (!ACCEPTED.includes(file.type) || file.size > MAX_BYTES) return problems.refuse(fileId, WRONG_FILE)
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
      setAttachError(typeRefused ?? refusalText(caught, ATTACH_FAILED))
      focus(submitId, true)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const items = listed.items ?? []
  const attachable = canWrite && writable
  return <Card className="staff-card">
    <h2 id={titleId} tabIndex={-1}>{said.title}</h2>
    {about && <p>For {about}</p>}
    {canRead && <>
      {listed.loading && listed.items === null && <p role="status">Loading documents…</p>}
      {listed.error && <p role="alert" className="staff-error">{listed.error}</p>}
      {listed.items !== null && items.length === 0 && <p>{said.empty}</p>}
      {items.length > 0 && <div className="staff-list">{items.map(document => {
        const name = `${base}-${document.id}-name`
        return <div className="staff-list-item" key={document.id}>
          <strong id={name}>{document.fileName}</strong>
          <p>{documentLine(document)}</p>
          {document.status === 'initiated' && <p className="staff-muted">Upload not completed; only the person who started it can
            finish it. Attach the file again.</p>}
          {document.scanStatus === 'clean' && document.status !== 'initiated' && <Button tone="secondary" size="sm"
            aria-describedby={name} aria-disabled={opening === document.id || undefined} className={UNAVAILABLE}
            onClick={() => void open(document)}>Open file</Button>}
        </div>
      })}</div>}
      {openError && <p role="alert" className="staff-error">{openError}</p>}
    </>}
    {canWrite && !writable && <p className="staff-muted">{CLOSED}</p>}
    {attachable && <form className="staff-form" aria-label={said.submit} noValidate onSubmit={event => void attach(event)}>
      <Field label={said.file} htmlFor={fileId} hint={said.hint} error={problems.error(fileId)} required>
        <Input id={fileId} name="document" type="file" accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff" required
          onChange={() => problems.clear()} {...problems.control(fileId)} />
      </Field>
      {attachError && <p role="alert" className="staff-error">{attachError}</p>}
      <Button id={submitId} type="submit" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Attaching…' : said.submit}</Button>
    </form>}
    {/* Mounted throughout, so what an attach says is announced. */}
    {attachable && <div role="status">{notice && <p className="staff-success">{notice}</p>}</div>}
  </Card>
}
