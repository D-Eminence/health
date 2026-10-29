import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { LIMITS, type OfflineRuntime, type PatientIndexEntry } from '@hid/offline'
import { Badge, Button, Card, Field, Select } from '@hid/ui'
import type { Encounter } from '../api'
import { refusalText } from '../fieldProblem'
import { CAPTURE } from './copy'
import { DOCUMENT_TYPES, documentCommands } from './documentCommands'
import { ehrReads } from './ehrReads'

type UploadState = keyof typeof CAPTURE.states
interface Upload { id: string; fileName: string; patientId: string; encounterId: string; commandId?: string; documentId?: string; state: UploadState }

const ACCEPT = Object.keys(DOCUMENT_TYPES).join(',')

/**
 * Migrate offline (D7): capture a page by camera or file, re-encode it (§2.5), seal it on the device and upload it
 * into the chosen patient's EHR documents. Only patients kept on this device, whose access still allows writing,
 * can be chosen; OCR reading stays online.
 */
export function CapturePage({ runtime, facilityId }: { runtime: OfflineRuntime; facilityId: string }) {
  const [patients, setPatients] = useState<PatientIndexEntry[] | null>(null)
  const [patientId, setPatientId] = useState('')
  const [writable, setWritable] = useState<boolean | null>(null)
  const [visits, setVisits] = useState<Encounter[]>([])
  const [encounterId, setEncounterId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const key = useRef<string>('')
  const [uploads, setUploads] = useState<Upload[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [said, setSaid] = useState('')

  useEffect(() => {
    let active = true
    const now = runtime.trustedNow().at.getTime()
    void runtime.patients.list().then(found => {
      if (active) setPatients(found.filter(entry => entry.grantExpiresAt === null || new Date(entry.grantExpiresAt).getTime() > now))
    }, () => { if (active) setPatients([]) })
    return () => { active = false }
  }, [runtime])

  // The chosen patient's access, as Health ID last said it (on this device while offline): writing must be allowed.
  useEffect(() => {
    setWritable(null); setVisits([]); setEncounterId('')
    if (!patientId) return
    let active = true
    void ehrReads.consentStatus(facilityId, patientId).then(async status => {
      if (!active) return
      const allowed = status.readAllowed === true && status.writeAllowed === true
      setWritable(allowed)
      if (!allowed) return
      const page = await ehrReads.encounters(facilityId, patientId).catch(() => ({ items: [] as Encounter[] }))
      if (active) setVisits(page.items)
    }, () => { if (active) setWritable(false) })
    return () => { active = false }
  }, [facilityId, patientId])

  // The upload queue as the device holds it: saved, then uploading; then Health ID's scan of what arrived.
  const refresh = useCallback(async () => {
    const shown = uploads.filter(item => item.state !== 'ready')
    if (shown.length === 0) return
    const next = await Promise.all(uploads.map(async item => {
      if (item.state === 'ready') return item
      if (item.commandId) {
        const pending = await runtime.commands.pendingFor(item.patientId).catch(() => [])
        const view = pending.find(entry => entry.commandId === item.commandId)
        if (view) return { ...item, state: view.state === 'sending' ? 'uploading' as const : 'saved' as const }
        return { ...item, state: 'uploaded' as const }
      }
      if (!item.documentId) return item
      const documents = await ehrReads.documents(facilityId, item.patientId, item.encounterId).catch(() => null)
      const found = documents?.items.find(document => document.id === item.documentId)
      return !found ? item : { ...item, state: found.scanStatus === 'clean' ? 'ready' as const : 'scanning' as const }
    }))
    setUploads(next)
  }, [uploads, runtime, facilityId])
  useEffect(() => runtime.subscribe(() => { void refresh() }), [runtime, refresh])

  function choose(chosen: File | null) {
    setError(''); setSaid('')
    setFile(chosen)
    key.current = chosen ? crypto.randomUUID() : ''
    if (chosen && !DOCUMENT_TYPES[chosen.type]) setError(CAPTURE.wrongType)
    else if (chosen && chosen.size > LIMITS.mediaFileMaxBytes) setError(CAPTURE.tooBig)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(''); setSaid('')
    if (!patientId) { setError(CAPTURE.needPatient); return }
    if (writable !== true) { setError(CAPTURE.noWrite); return }
    if (!encounterId) { setError(CAPTURE.needVisit); return }
    if (!file) { setError(CAPTURE.needFile); return }
    if (!DOCUMENT_TYPES[file.type]) { setError(CAPTURE.wrongType); return }
    setBusy(true)
    try {
      const outcome = await documentCommands.uploadDocument(facilityId, patientId, encounterId, file, key.current)
      const upload: Upload = { id: key.current, fileName: file.name, patientId, encounterId,
        ...(outcome.kind === 'saved' ? { commandId: outcome.commandId, state: 'saved' as const }
          : { documentId: typeof outcome.value === 'string' ? outcome.value : outcome.receipt.resourceId, state: 'uploaded' as const }) }
      setUploads(items => [upload, ...items])
      setSaid(outcome.kind === 'saved' ? 'Saved on this device. It uploads when Health ID can be reached.' : 'Uploaded. Health ID is scanning it.')
      choose(null)
    } catch (caught) { setError(refusalText(caught, 'This document could not be saved.')) }
    finally { setBusy(false) }
  }

  const chosen = patients?.find(entry => entry.patientId === patientId)
  return <>
    <div className="staff-page-head"><p className="staff-eyebrow">HID Migrate</p><h1>{CAPTURE.title}</h1><p>{CAPTURE.lede}</p></div>
    <div className="staff-two-col">
      <Card className="staff-card"><form className="staff-form" noValidate onSubmit={event => void submit(event)}>
        {patients !== null && patients.length === 0 && <p className="staff-notice">{CAPTURE.noPatients}</p>}
        <Field label={CAPTURE.patient} htmlFor="capture-patient" hint={CAPTURE.patientHint}>
          <Select id="capture-patient" value={patientId} onChange={event => setPatientId(event.target.value)} aria-describedby="capture-patient-hint">
            <option value="">{CAPTURE.choosePatient}</option>
            {(patients ?? []).map(entry => <option key={entry.patientId} value={entry.patientId}>{entry.displayName} · {entry.hidCode}</option>)}
          </Select></Field>
        {chosen && writable === false && <p role="alert" className="staff-error">{CAPTURE.noWrite}</p>}
        {writable === true && <Field label={CAPTURE.visit} htmlFor="capture-visit">
          <Select id="capture-visit" value={encounterId} onChange={event => setEncounterId(event.target.value)}>
            <option value="">Choose a visit</option>
            {visits.map(visit => <option key={visit.id} value={visit.id}>{visit.encounterType.replace('_', ' ')} · {new Date(visit.startedAt).toLocaleDateString()}</option>)}
          </Select></Field>}
        <Field label={CAPTURE.file} htmlFor="capture-file" hint={CAPTURE.fileHint}>
          <input id="capture-file" type="file" accept={ACCEPT} aria-describedby="capture-file-hint"
            onChange={event => choose(event.target.files?.[0] ?? null)} /></Field>
        <label className="staff-choice">{CAPTURE.camera}
          <input type="file" accept="image/jpeg,image/png" capture="environment" onChange={event => choose(event.target.files?.[0] ?? null)} /></label>
        {error && <p role="alert" className="staff-error">{error}</p>}
        <Button type="submit" aria-disabled={busy || writable !== true || undefined}>{busy ? CAPTURE.working : CAPTURE.submit}</Button>
      </form></Card>
      <Card className="staff-card"><section aria-labelledby="capture-queue-title">
        <h2 id="capture-queue-title">{CAPTURE.queue}</h2>
        <div role="status">{said && <p className="staff-success">{said}</p>}</div>
        {uploads.length === 0 ? <p>{CAPTURE.queueEmpty}</p>
          : <ul className="staff-list">{uploads.map(item => <li key={item.id} className="staff-list-item staff-row">
            <span>{item.fileName}</span><Badge tone={item.state === 'ready' ? 'success' : 'information'}>{CAPTURE.states[item.state]}</Badge></li>)}</ul>}
      </section></Card>
    </div>
  </>
}
