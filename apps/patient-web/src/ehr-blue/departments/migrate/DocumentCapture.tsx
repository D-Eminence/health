import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { assertSignedStorageUrl, isHidApiError } from '@hid/http'
import { EhrBadge, EhrButton, EhrDataTable, EhrEmptyState, EhrField, EhrInput, EhrSelect, EhrSkeleton } from '@hid/ui/ehr'
import { isAllowedPatientLookup, staffApi, type DocumentRecord, type Encounter, type Page } from '../../../staff/api'
import { useStaff } from '../../../staff/App'
import { getEnvironment } from '../../../staff/env'
import { problemText, refusal, refusalText, type FieldProblem } from '../../../staff/fieldProblem'
import { useFocusById } from '../../../staff/focus'
import { staffSessionGeneration, untilStaffSessionReady } from '../../../staff/session'
import { DeptSection } from '../parts/DeptPage'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptLinkButton } from '../parts/DeptRecord'
import { dateText } from '../parts/format'
import { FormRefusal, statusWords } from './ocrSteps'

/*
 * Document capture: a file uploaded into a patient's documents, on the encounter it belongs to, as today's clinical
 * record takes it (staff/routes/Clinical.tsx Documents): the same patient opened through governed access, the same
 * write-access check, the same upload, file rules and download. A clean document can then go to OCR on this page.
 */

// EHR lists encounters newest first, 50 to a page, and hands back an opaque cursor for the next; it gives no total.
type Cursors = ReadonlyArray<string | undefined>
const FIRST_PAGE: Cursors = [undefined]

/** Reads a page; a cursor EHR no longer accepts (400 INVALID_CURSOR) starts the list again (Clinical.tsx readPage). */
async function readPage<P extends Page<unknown>>(read: (cursor: string | undefined, fresh: boolean) => Promise<P>, cursors: Cursors, fresh: boolean) {
  try { return { page: await read(cursors.at(-1), fresh), cursors, restarted: false } }
  catch (caught) {
    if (cursors.length < 2 || !isHidApiError(caught) || caught.code !== 'INVALID_CURSOR') throw caught
    return { page: await read(undefined, true), cursors: FIRST_PAGE, restarted: true }
  }
}

/** A file size as EHR sends it, a number or text, in KiB (Clinical.tsx fileSize). */
function fileSize(value: number | string | null | undefined): string {
  const count = value == null || value === '' ? NaN : Number(value)
  return Number.isFinite(count) && count >= 0 ? `${Math.ceil(count / 1024).toLocaleString()} KiB` : 'Size unavailable'
}

const ACCESS_ENDED = 'Access to this patient has ended. Open the patient again through approved access.'

/** "Patient documents": shown to a membership that reads documents, as the clinical record's Documents tab is. */
export function DocumentCapture({ facilityId, permissions, onExtract }: {
  readonly facilityId: string
  readonly permissions: readonly string[]
  /** A clean document handed to OCR: its ID and its patient's, kept in this page's memory only. */
  readonly onExtract: (documentId: string, patientId: string) => void
}) {
  const { state, activePatient } = useStaff()
  // Whether this page closed the patient because access had ended: said until another patient is opened.
  const [ended, setEnded] = useState(false)
  useEffect(() => { if (activePatient) setEnded(false) }, [activePatient])
  const accessEnded = useCallback(() => setEnded(true), [])
  if (!permissions.includes('ehr.document.read')) return null
  const actorId = state.status === 'ready' ? state.session.actor.id : ''
  return <DeptSection title="Patient documents" headingId="migrate-documents-title" className="hid-ehr-dept-migrate-capture">
    {!activePatient ? <>
      {ended && <DeptNotice tone="critical" role="alert">{ACCESS_ENDED}</DeptNotice>}
      <EhrEmptyState title="No patient open" message="Open a patient through an approved request or patient PIN to capture their documents here." />
    </>
      : activePatient.purpose === 'emergency'
        ? <DeptNotice tone="caution">Emergency access is read-only, so documents cannot be captured for this patient.</DeptNotice>
        : <PatientDocuments key={JSON.stringify([actorId, facilityId, activePatient.lookup.patient.patientId, activePatient.purpose, permissions])}
          facilityId={facilityId} permissions={permissions} onExtract={onExtract} onAccessEnded={accessEnded} />}
  </DeptSection>
}

function PatientDocuments({ facilityId, permissions, onExtract, onAccessEnded }: {
  readonly facilityId: string; readonly permissions: readonly string[]; readonly onExtract: (documentId: string, patientId: string) => void
  readonly onAccessEnded: () => void
}) {
  const { activePatient, setActivePatient } = useStaff()
  const patientId = activePatient?.lookup.patient.patientId
  const verify = useCallback(async () => {
    if (!activePatient) throw new Error('Open a patient through approved access first.')
    let result: Awaited<ReturnType<typeof staffApi.lookupPatient>>
    try {
      result = await staffApi.lookupPatient(facilityId, activePatient.hid, activePatient.purpose)
    } catch (caught) {
      // The backend refuses a lookup once access has ended (403) or the patient is unavailable (404); the record closes.
      if (isHidApiError(caught) && (caught.status === 403 || caught.status === 404)) {
        onAccessEnded(); setActivePatient(null)
        throw new Error(ACCESS_ENDED)
      }
      throw caught
    }
    if (!isAllowedPatientLookup(result) || result.patient.patientId !== patientId) {
      onAccessEnded(); setActivePatient(null)
      throw new Error(ACCESS_ENDED)
    }
  }, [facilityId, activePatient, patientId, setActivePatient, onAccessEnded])

  // What the current grant permits, from the server: changes stay hidden until it reports write access, and whenever the check fails.
  const [writeAccess, setWriteAccess] = useState<{ allowed: boolean; failed: boolean } | null>(null)
  useEffect(() => {
    if (!patientId) return
    let active = true
    void staffApi.consentStatus(facilityId, patientId)
      .then(status => { if (active) setWriteAccess({ allowed: status.writeAllowed === true, failed: false }) })
      .catch(() => { if (active) setWriteAccess({ allowed: false, failed: true }) })
    return () => { active = false }
  }, [facilityId, patientId])

  const [encounters, setEncounters] = useState<{ cursors: Cursors; items: Encounter[]; next: string | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pageNotice, setPageNotice] = useState('')
  const [chosen, setChosen] = useState('')
  const sequence = useRef(0)
  const load = useCallback(async (cursors: Cursors, paging: boolean) => {
    if (!patientId) return
    const request = ++sequence.current
    setLoading(true); setError(''); setPageNotice('')
    try {
      await verify()
      const { page, cursors: shown, restarted } = await readPage(
        (cursor, fresh) => staffApi.encounters(facilityId, patientId, { cursor, fresh }), cursors, false)
      if (request !== sequence.current) return
      setEncounters({ cursors: shown, items: page.items, next: page.nextCursor ?? null })
      if (restarted) setPageNotice('This list changed since it was opened, so it shows the newest encounters again.')
    } catch (caught) {
      if (request !== sequence.current) return
      setError(paging ? `The page could not be loaded. ${refusalText(caught, '')}`.trim() : refusalText(caught, 'Encounters could not be loaded.'))
    } finally { if (request === sequence.current) setLoading(false) }
  }, [facilityId, patientId, verify])
  useEffect(() => {
    void load(FIRST_PAGE, false)
    return () => { sequence.current += 1 }
  }, [load])

  if (!activePatient || !patientId) return null
  const patientName = activePatient.lookup.patient.fullName ?? activePatient.hid
  // Only encounters of the patient open, at the working facility, as the clinical record lists them.
  const items = (encounters?.items ?? []).filter(item => item.patientId === patientId && item.facilityId === facilityId)
  const selected = items.find(item => item.id === chosen) ?? items[0]
  const canWrite = writeAccess?.allowed === true && permissions.includes('ehr.document.write')
  const cursors = encounters?.cursors ?? FIRST_PAGE
  const previousOff = loading || cursors.length < 2
  const nextOff = loading || !encounters?.next
  return <>
    <div className="hid-ehr-dept-context"><span className="hid-ehr-dept-context-item">{`${patientName} · ${activePatient.hid}`}</span></div>
    {writeAccess && !writeAccess.allowed && <DeptNotice tone="caution" role="status">{writeAccess.failed
      ? 'Write access could not be confirmed, so uploads are unavailable. Refresh the page to try again.'
      : 'Read-only access. This authorization does not include changes. Ask the patient to approve a read-and-write request to add documents.'}</DeptNotice>}
    {error && <DeptNotice tone="critical" role="alert">{error}</DeptNotice>}
    {pageNotice && <DeptNotice role="status">{pageNotice}</DeptNotice>}
    {loading && !encounters && <EhrSkeleton label="Loading encounters…" />}
    {encounters && items.length === 0 && <EhrEmptyState title="No encounters yet"
      message="Documents are kept on an encounter. Start one in the patient's record, then upload here." />}
    {items.length > 0 && <div className="hid-ehr-dept-migrate-encounter">
      <EhrField label="Encounter" controlId="migrate-encounter">
        <EhrSelect value={selected?.id ?? ''} onChange={event => setChosen(event.target.value)}>
          {items.map(item => <option key={item.id} value={item.id}>{`${statusWords(item.encounterType)} · started ${dateText(item.startedAt)} · ${statusWords(item.status)}`}</option>)}
        </EhrSelect>
      </EhrField>
      {(cursors.length > 1 || encounters?.next) && <nav className="hid-ehr-dept-toolbar" aria-label="Encounter pages">
        <EhrButton variant="secondary" size="sm" aria-disabled={previousOff || undefined}
          onClick={() => { if (!previousOff) void load(cursors.slice(0, -1), true) }}>Previous page</EhrButton>
        <span className="hid-ehr-dept-toolbar-note" role="status">{`Page ${cursors.length}`}</span>
        <EhrButton variant="secondary" size="sm" aria-disabled={nextOff || undefined}
          onClick={() => { if (!nextOff && encounters?.next) void load([...cursors, encounters.next], true) }}>Next page</EhrButton>
      </nav>}
    </div>}
    {selected && <EncounterDocuments key={selected.id} facilityId={facilityId} patientId={patientId} encounterId={selected.id}
      canWrite={canWrite} canOcr={permissions.includes('ocr.job.read')} verify={verify} onExtract={onExtract} />}
  </>
}

/**
 * One encounter's documents, and the upload into them. Since hid-system #59 only the account that created an upload
 * intent completes it, and the list shows every intent: one left `initiated` is never scanned.
 */
function EncounterDocuments({ facilityId, patientId, encounterId, canWrite, canOcr, verify, onExtract }: {
  readonly facilityId: string; readonly patientId: string; readonly encounterId: string; readonly canWrite: boolean; readonly canOcr: boolean
  readonly verify: () => Promise<void>; readonly onExtract: (documentId: string, patientId: string) => void
}) {
  const [items, setItems] = useState<DocumentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [problem, setProblem] = useState<FieldProblem | null>(null)
  const focus = useFocusById()
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setItems((await staffApi.documents(facilityId, patientId, encounterId)).items) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Documents could not be loaded.') }
    finally { setLoading(false) }
  }, [facilityId, patientId, encounterId])
  useEffect(() => { void load() }, [load])
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // The button stays focusable while the upload runs; a second press does nothing.
    if (busy) return
    setUploadError(''); setNotice(''); setProblem(null)
    const formElement = event.currentTarget
    // The file chosen in the field: what the form would send as `document`.
    const control = formElement.elements.namedItem('document')
    const file = control instanceof HTMLInputElement ? control.files?.[0] : undefined
    const refused = !file || !file.size ? 'Choose a file first.'
      : !['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'].includes(file.type) || file.size > 52_428_800 ? 'Choose a PDF, JPEG, PNG or TIFF file of 50 MiB or less.' : ''
    if (refused || !file) {
      setProblem(refusal({ field: 'migrate-document-file', message: refused || 'Choose a file first.' })); focus('migrate-document-file'); return
    }
    setBusy(true)
    try {
      await verify(); await staffApi.uploadDocument(facilityId, patientId, encounterId, file); await load(); formElement.reset()
      setNotice('Document uploaded. It can be opened once its virus scan is clean.')
    }
    catch (caught) { setUploadError(caught instanceof Error ? caught.message : 'The document was not uploaded.'); focus('migrate-document-submit', true) }
    finally { setBusy(false) }
  }
  async function download(id: string) {
    setError('')
    // The document opens in a tab of its own only while its session is ready.
    const sentIn = staffSessionGeneration()
    try {
      await verify()
      const result = await staffApi.documentDownload(facilityId, id)
      // Only a signed storage link opens: never javascript:, data: or plain http to another host.
      assertSignedStorageUrl(result.url, { allowLocalHttp: getEnvironment().name === 'local',
        code: 'INVALID_DOWNLOAD_URL', message: 'The document could not be opened.' })
      await untilStaffSessionReady(sentIn)
      window.open(result.url, '_blank', 'noopener,noreferrer')
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'The document could not be opened.') }
  }
  return <>
    {error && <DeptNotice tone="critical" role="alert">{error}</DeptNotice>}
    <EhrDataTable caption="Documents on this encounter" captionHidden loading={loading} rows={items} rowKey={item => item.id}
      emptyTitle="No documents yet" emptyMessage="Upload a document for this encounter when you have the appropriate permission."
      columns={[
        { id: 'record', header: 'Record', cell: item => <div className="hid-ehr-dept-record-name">
          <span className="hid-ehr-dept-strong" id={`migrate-document-${item.id}`}>{item.fileName}</span>
          <span className="hid-ehr-dept-reference">{`${item.mediaType} · ${fileSize(item.sizeBytes)}`}</span></div> },
        { id: 'status', header: 'Status', cell: item => <>
          <EhrBadge tone={item.status === 'initiated' ? 'caution' : 'brand'}>{item.status === 'initiated' ? 'not completed' : `scan ${statusWords(item.scanStatus)}`}</EhrBadge>
          {item.status === 'initiated' && <span className="hid-ehr-dept-reference">Upload not completed. Only the person who started it can finish it: upload the file again.</span>}</> },
        { id: 'updated', header: 'Updated', cell: item => dateText(item.createdAt) },
        { id: 'actions', header: <span className="hid-ehr-sr-only">Actions</span>, cell: item => <div className="hid-ehr-dept-table-actions">
          <EhrButton variant="secondary" size="sm" disabled={item.scanStatus !== 'clean'} aria-describedby={`migrate-document-${item.id}`}
            onClick={() => download(item.id)}>Open file</EhrButton>
          {canOcr && item.scanStatus === 'clean' && <DeptLinkButton describedBy={`migrate-document-${item.id}`}
            onClick={() => onExtract(item.id, patientId)}>Extract with OCR</DeptLinkButton>}
        </div> },
      ]} />
    {canWrite && <form className="hid-ehr-dept-form hid-ehr-dept-migrate-upload" noValidate aria-labelledby="migrate-upload-title" onSubmit={event => void upload(event)}>
      <h3 id="migrate-upload-title">Upload a document</h3>
      <EhrField label={<>Clinical document (PDF, JPEG, PNG or TIFF, max 50 MiB)<span aria-hidden="true"> *</span></>} controlId="migrate-document-file"
        hint="Files are scanned for viruses before they can be opened or sent to OCR." error={problemText(problem, 'migrate-document-file')}>
        <EhrInput name="document" type="file" accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff" required />
      </EhrField>
      <FormRefusal error={uploadError} />
      <div className="hid-ehr-dept-form-actions"><EhrButton id="migrate-document-submit" type="submit" busy={busy}>{busy ? 'Uploading…' : 'Upload document'}</EhrButton></div>
      {/* Mounted throughout, so what an upload says is announced. */}
      <div role="status">{notice && <DeptNotice tone="positive">{notice}</DeptNotice>}</div>
    </form>}
  </>
}
