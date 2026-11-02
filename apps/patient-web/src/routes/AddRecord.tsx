import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Camera, FileText, FlaskConical, HeartPulse, ImagePlus, Lock, NotebookPen, Pill, Stethoscope, Syringe, Trash2, Upload } from 'lucide-react'
import { isHidApiError } from '@hid/http'
import { Drawer } from '../kasuwa/interactive'
import { useToast } from '../kasuwa/toast'
import { Alert, Field, IconChip, Input, Textarea, cx, type Icon } from '../kasuwa/ui'
import { Step } from '../kasuwa/parts'
import { SAY } from '../copy'
import { ButtonR, InputR } from './profileParts'
import { useActionFocus } from './actionFocus'
import type { OwnRecordInput } from '../api'
import { EDGE_BODY_MAX_BYTES, jsonBodyBytes } from '../profileParity'
import { saysPatientEntriesNotServed } from '../patientEntriesServed'
import { withoutPhotoMetadata } from '../photoMetadata'
import { useSession } from '../session'

/**
 * "Add a record": a patient keeps their own history: a visit, a test result, a medicine, from any hospital, clinic or
 * pharmacy, with a photo of the paper or the file they were given. One drawer, top to bottom in the order a person
 * recalls it (what, where, when), the camera within thumb reach on a phone. Photos and files stay in this page's
 * memory until sent and are never kept in the browser; previews are object URLs, let go with their files. Saved as
 * "added by you", so a clinician can tell it apart.
 *
 * A photo is read as it is picked and kept only without its metadata (photoMetadata.ts: the GPS position where it was
 * taken, the camera's details, any thumbnail, text or further picture; never re-encoded, so the picture is unchanged):
 * what is previewed, hashed and sent are those stripped bytes, a new File of the same name and type. A photo that can't
 * be walked cleanly is refused there in plain words and never listed, so never sent. A PDF goes as it is.
 *
 * Save sends the entry alone (POST ehr/me/patient-entries, no file bytes, its body kept under the edge limit), then each
 * photo or file in turn under the saved entry, as staff uploads go: its exact bytes to a signed link, then a confirm
 * (api.uploadOwnRecordDocument). Nothing of a file leaves the device until the Save and that file's upload link have
 * both been answered. No backend serves it yet (BACKEND-NEEDS.md §1): until one does, the Save's 404 NOT_FOUND is said
 * plainly ("This isn't set up for your account") and what was entered stays in the drawer.
 *
 * If a file doesn't go up after the entry is saved, the drawer stays open, says so, and offers Try again: only those
 * files, under the same entry and with their same keys, and no second Save; the saved fields are kept from changing. A
 * file whose earlier try was confirmed though its answer was lost is told so by its replayed upload link (409
 * PATIENT_DOCUMENT_ALREADY_UPLOADED, api.uploadOwnRecordDocument): it counts as uploaded, with no PUT and no confirm.
 * Closing stops what is still on its way and says what was saved; leaving the page stops it too, and says the same once
 * the entry is saved. When a run ends short (the Save refused, or a file not uploaded), focus comes back to Save or Try
 * again if it was lost while the run went; during Try again, a file not yet sent again says Waiting.
 *
 * The backend allows 10 files a day (BACKEND-NEEDS.md §1). A file whose upload link is refused for that (429
 * PATIENT_UPLOAD_DAILY_LIMIT_REACHED) says so plainly ("You’ve added 10 files today. You can add more tomorrow.") and is
 * not offered Try again; closing keeps the record without it. Any other refusal is a file that didn't upload.
 */
const KINDS: ReadonlyArray<{ value: OwnRecordInput['kind']; label: string; icon: Icon; example: string }> = [
  { value: 'visit', label: 'Visit', icon: Stethoscope, example: 'Check-up at Lagos General' },
  { value: 'test', label: 'Test result', icon: FlaskConical, example: 'Malaria test' },
  { value: 'medicine', label: 'Medicine', icon: Pill, example: 'Amoxicillin 500 mg' },
  { value: 'diagnosis', label: 'Diagnosis', icon: HeartPulse, example: 'Hypertension' },
  { value: 'vaccination', label: 'Vaccine', icon: Syringe, example: 'Hepatitis B, dose 2' },
  { value: 'other', label: 'Other', icon: NotebookPen, example: 'What it was' },
]
// The entry's limits (api.ts PATIENT_ENTRY_*, which the upload enforces again): at most 5, each 1 byte to 10 MB, and these
// types only; and the backend's 10 files a day in all (api.ts PATIENT_UPLOAD_DAILY_LIMIT_*). Kept here as plain values:
// this page imports only types from api.ts.
const MAX_FILES = 5
const MAX_BYTES = 10 * 1024 * 1024
const MEDIA_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'application/pdf']
const DAILY_FILES = 10
const DAILY_LIMIT_CODE = 'PATIENT_UPLOAD_DAILY_LIMIT_REACHED'
// What each picker offers: the camera a photo, the upload a photo or a PDF. Anything else picked is refused in words.
const CAMERA_TYPES = 'image/jpeg,image/png'
const UPLOAD_TYPES = MEDIA_TYPES.join(',')
const NOT_ADDED = 'Couldn’t add your record'

/** A photo or file as picked: a photo already without its metadata (the bytes previewed and sent), a PDF as it is. */
interface Picked { id: string; file: File; preview: string | null }
/** Where a photo or file is once its entry is saved: `limited` didn't upload as today's 10 are added, and isn't retried. */
type Sending = 'sending' | 'sent' | 'failed' | 'limited'
/** The entry this drawer saved: its photos and files go up under it, and Try again uses it. */
interface Saved { id: string; title: string }

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
const size = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
const notUploadedWords = (count: number) => `${count} of your photos or files didn’t upload.`
const DAILY_LIMIT_WORDS = `You’ve added ${DAILY_FILES} files today. You can add more tomorrow.`
const SENDING_WORDS: Record<Sending, string> = { sending: 'Uploading…', sent: 'Uploaded', failed: 'Didn’t upload', limited: 'Over today’s limit' }
/** What didn't upload, said plainly: how many, and, when today's limit refused any, that more can be added tomorrow. */
const shortWords = (missing: number, overLimit: number) => overLimit > 0 ? `${notUploadedWords(missing)} ${DAILY_LIMIT_WORDS}` : notUploadedWords(missing)
/** The upload link refused as the patient has added today's 10 files (BACKEND-NEEDS.md §1): its status and code alone. */
const saysDailyLimitReached = (error: unknown): boolean => isHidApiError(error) && error.status === 429 && error.code === DAILY_LIMIT_CODE

export function AddRecordDrawer({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: () => void }) {
  const { api } = useSession()
  const toast = useToast()
  const [kind, setKind] = useState<OwnRecordInput['kind']>('visit')
  const [title, setTitle] = useState('')
  const [facility, setFacility] = useState('')
  const [when, setWhen] = useState(today)
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState<Picked[]>([])
  // While picked photos are read and their metadata taken out: picking again and Save wait for it.
  const [preparing, setPreparing] = useState(false)
  const preparingNow = useRef(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // Why the record wasn't saved, said in the drawer (it stays open, with what was entered).
  const [notSaved, setNotSaved] = useState<{ title: string; message: string } | null>(null)
  const [titleProblem, setTitleProblem] = useState(false)
  const titleField = useRef<HTMLInputElement>(null)
  const [places, setPlaces] = useState<string[]>([])
  const camera = useRef<HTMLInputElement>(null)
  const upload = useRef<HTMLInputElement>(null)
  const example = KINDS.find(k => k.value === kind)?.example ?? 'What it was'
  // Once the Save is answered: the entry, and how far each photo or file has gone under it.
  const [saved, setSaved] = useState<Saved | null>(null)
  const [sending, setSending] = useState<Readonly<Record<string, Sending>>>({})
  const [retrying, setRetrying] = useState(false)
  // In memory only: the Save's key, kept while what it sends is the same (so a retried Save is answered with the same
  // entry), each file's key, kept for Try again, and the one AbortController of what is on its way.
  const entryKey = useRef<{ body: string; key: string } | null>(null)
  const fileKeys = useRef(new Map<string, string>())
  const run = useRef<AbortController | null>(null)
  // Save, which becomes Try again: disabled while a run is on its way, so focus comes back to it when one ends short. With
  // nothing left to try again (only files over today's limit), focus comes back to Close.
  const primary = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const focusAfter = useActionFocus()
  const locked = saved !== null
  const notUploaded = saved ? files.filter(item => sending[item.id] !== 'sent').length : 0
  const overLimit = saved ? files.filter(item => sending[item.id] === 'limited').length : 0
  // What Try again sends: what didn't upload, apart from what today's limit refused.
  const retryable = files.filter(item => sending[item.id] !== 'sent' && sending[item.id] !== 'limited')
  const offersTryAgain = !locked || busy || retryable.length > 0

  // Facilities on Health ID, offered as the patient types; any other place can be typed in full.
  useEffect(() => {
    if (!open || places.length) return
    let live = true
    api.participatingFacilities().then(list => { if (live) setPlaces(list.facilities.map(f => f.name)) }).catch(() => {})
    return () => { live = false }
  }, [open, api, places.length])
  // Previews are object URLs in memory; each is let go when its file is.
  const urls = useRef(new Set<string>())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; urls.current.forEach(URL.revokeObjectURL) }
  }, [])

  /**
   * Takes what was picked, in turn: refused in words when it is not a JPEG, PNG or PDF of 1 byte to 10 MB, or past the
   * entry's 5; a photo is read and kept only without its metadata, and refused when that can't be done with certainty.
   * Nothing is listed, or previewed, until all of it is ready.
   */
  const add = async (list: FileList | null) => {
    if (!list || busy || locked || preparingNow.current) return
    // Taken now: the picker is emptied as soon as this returns.
    const chosen = Array.from(list)
    preparingNow.current = true
    setPreparing(true)
    setProblem(null)
    let said: string | null = null
    const next: Array<{ id: string; file: File }> = []
    try {
      for (const file of chosen) {
        if (files.length + next.length >= MAX_FILES) { said = `You can add up to ${MAX_FILES} photos or files.`; break }
        if (!MEDIA_TYPES.includes(file.type)) { said = `${file.name} can’t be added. Choose a photo (JPEG or PNG) or a PDF.`; continue }
        if (file.size > MAX_BYTES) { said = `${file.name} is over 10 MB.`; continue }
        if (file.size === 0) { said = `${file.name} is empty.`; continue }
        try {
          next.push({ id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`, file: await withoutPhotoMetadata(file) })
        } catch {
          said = `${file.name} couldn’t be prepared safely. Try another photo.`
        }
      }
    } finally {
      preparingNow.current = false
    }
    // A page left meanwhile keeps nothing, and makes no preview.
    if (!mounted.current) return
    const ready = next.map(({ id, file }): Picked => {
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
      if (preview) urls.current.add(preview)
      return { id, file, preview }
    })
    setFiles(current => [...current, ...ready])
    setProblem(said)
    setPreparing(false)
  }
  const remove = (id: string) => setFiles(current => current.filter(item => {
    if (item.id === id && item.preview) { URL.revokeObjectURL(item.preview); urls.current.delete(item.preview) }
    return item.id !== id
  }))
  const reset = () => {
    files.forEach(item => { if (item.preview) { URL.revokeObjectURL(item.preview); urls.current.delete(item.preview) } })
    setKind('visit'); setTitle(''); setFacility(''); setWhen(today()); setNotes(''); setFiles([]); setProblem(null); setNotSaved(null); setTitleProblem(false)
    setSaved(null); setSending({}); setRetrying(false)
    entryKey.current = null; fileKeys.current = new Map()
  }
  const added = (shownTitle: string) => {
    toast.success({ title: 'Record added', message: `${shownTitle} is in your records, marked “added by you”.` })
    reset(); onSaved?.(); onClose()
  }

  /**
   * Sends `items` in turn under the saved entry; each failure is kept, and nothing more is sent once `controller` is
   * aborted. A file refused for today's limit is kept as such; the backend decides for each file, so the rest still go.
   * `heldBack` counts the files today's limit refused before, which Try again doesn't send: the record is complete only
   * when there are none.
   */
  const send = async (entry: Saved, items: readonly Picked[], controller: AbortController, heldBack = 0) => {
    let short = 0
    for (const item of items) {
      if (controller.signal.aborted) return
      setSending(current => ({ ...current, [item.id]: 'sending' }))
      let key = fileKeys.current.get(item.id)
      if (!key) { key = crypto.randomUUID(); fileKeys.current.set(item.id, key) }
      try {
        await api.uploadOwnRecordDocument(entry.id, item.file, key, controller.signal)
        setSending(current => ({ ...current, [item.id]: 'sent' }))
      } catch (cause) {
        if (controller.signal.aborted) return
        short += 1
        const state: Sending = saysDailyLimitReached(cause) ? 'limited' : 'failed'
        setSending(current => ({ ...current, [item.id]: state }))
      }
    }
    if (controller.signal.aborted || run.current !== controller) return
    run.current = null
    if (short === 0 && heldBack === 0) { setBusy(false); added(entry.title); return }
    setBusy(false); setRetrying(false)
    focusAfter(() => primary.current ?? closeButton.current)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    // One run at a time, also before the render that shows it busy; and none while picked photos are being prepared.
    if (busy || run.current || preparingNow.current) return
    // After the entry is saved, the same button is Try again: only what didn't upload, under the same entry, and never
    // what today's limit refused.
    if (saved) {
      const again = retryable
      if (again.length === 0) return
      const controller = new AbortController()
      run.current = controller
      // Each goes up again in its turn: until then it says Waiting, not that it didn't upload.
      setSending(current => {
        const next = { ...current }
        for (const item of again) delete next[item.id]
        return next
      })
      setBusy(true); setRetrying(true)
      await send(saved, again, controller, overLimit)
      return
    }
    // Save is never silently off: what is missing is said under its field, and focus goes there.
    if (title.trim().length < 2) { setTitleProblem(true); titleField.current?.focus(); return }
    if (!when) return
    const entry: OwnRecordInput = { kind, title: title.trim(), facilityName: facility.trim() || null, occurredOn: when, notes: notes.trim() || null }
    setProblem(null)
    // Production's edge refuses a body over 8000 bytes: one that would be is not sent at all (api.addOwnRecord checks again).
    if (jsonBodyBytes(entry) > EDGE_BODY_MAX_BYTES) {
      setNotSaved({ title: NOT_ADDED, message: 'It’s too long to send. Shorten the notes, then save again. What you entered is still here.' })
      return
    }
    const body = JSON.stringify(entry)
    const held = entryKey.current?.body === body ? entryKey.current : { body, key: crypto.randomUUID() }
    entryKey.current = held
    const controller = new AbortController()
    run.current = controller
    // What goes up is what is picked now: picking and removing wait while it saves.
    const items = files
    setBusy(true); setNotSaved(null)
    let id: string
    try {
      id = (await api.addOwnRecord(entry, held.key, controller.signal)).id
    } catch (cause) {
      if (controller.signal.aborted || run.current !== controller) return
      run.current = null
      setBusy(false)
      // Only the Save's own 404 NOT_FOUND (no backend serves it) reads as "not set up".
      setNotSaved(saysPatientEntriesNotServed(cause)
        ? { title: NOT_ADDED, message: 'This isn’t set up for your account. Contact support. What you entered is still here.' }
        : { title: NOT_ADDED, message: isHidApiError(cause) ? cause.message : SAY.tryAgain })
      // Save was disabled while it went: focus comes back to it, in the drawer, if it was lost meanwhile.
      focusAfter(() => primary.current)
      return
    }
    if (controller.signal.aborted || run.current !== controller) return
    entryKey.current = null
    // The fields show what was saved, and are kept from changing: the photos and files go up under it.
    setKind(entry.kind); setTitle(entry.title); setFacility(entry.facilityName ?? ''); setWhen(entry.occurredOn); setNotes(entry.notes ?? '')
    const entrySaved = { id, title: entry.title }
    setSaved(entrySaved)
    await send(entrySaved, items, controller)
  }

  /**
   * Closing (or the page closing the drawer) stops whatever is on its way. Once the entry is saved, it is said that it
   * was, and how many photos or files didn't upload, and the drawer starts afresh; a Save still waiting for its answer
   * is stopped, and what was entered stays for when the drawer opens again.
   */
  const stop = () => {
    const controller = run.current
    run.current = null
    controller?.abort()
    if (saved) {
      const missing = files.filter(item => sending[item.id] !== 'sent').length
      if (missing === 0) toast.success({ title: 'Record added', message: `${saved.title} is in your records, marked “added by you”.` })
      else toast.warning({ title: 'Your record was saved', message: shortWords(missing, overLimit) })
      setBusy(false); reset(); onSaved?.()
      return
    }
    if (controller) {
      setBusy(false)
      toast.info({ title: 'Saving stopped', message: 'What you entered is still in Add a record. Save it again to finish.' })
    }
  }
  const close = () => { stop(); onClose() }
  /**
   * Leaving the page (Back on a phone, signing out) stops what is on its way too. Once the entry is saved, it is said that
   * it was and what didn't upload, as closing says it, so nothing is lost without a word; a Save not yet answered is
   * stopped quietly, as what was entered goes with the page.
   */
  const leave = () => {
    const controller = run.current
    run.current = null
    controller?.abort()
    const missing = saved ? files.filter(item => sending[item.id] !== 'sent').length : 0
    if (missing > 0) toast.warning({ title: 'Your record was saved', message: shortWords(missing, overLimit) })
  }
  const stopRef = useRef(stop)
  const leaveRef = useRef(leave)
  useEffect(() => { stopRef.current = stop; leaveRef.current = leave })
  useEffect(() => { if (!open) stopRef.current() }, [open])
  useEffect(() => () => { leaveRef.current() }, [])

  // Said beside each photo or file once its entry is saved: uploaded, uploading, waiting its turn, or didn't upload.
  const progress = (id: string): string | null => {
    const state = sending[id]
    if (state) return SENDING_WORDS[state]
    return busy && locked ? 'Waiting' : null
  }
  const listId = useMemo(() => `own-record-places-${Math.random().toString(36).slice(2)}`, [])
  const lockedLook = 'read-only:bg-subtle read-only:text-ink-2'
  return <Drawer open={open} onClose={close} title="Add a record" icon={<IconChip icon={FileText} tone="brand" />}
    description="A visit, result or medicine from anywhere, with a photo of the paper."
    footer={<><ButtonR ref={closeButton} onClick={close} disabled={busy}>{locked ? 'Close' : 'Cancel'}</ButtonR>
      {offersTryAgain && <ButtonR ref={primary} variant="primary" type="submit" form="own-record-form" loading={busy} disabled={busy || preparing}>{(locked && !busy) || retrying ? 'Try again' : 'Save record'}</ButtonR>}</>}>
    <form id="own-record-form" noValidate onSubmit={event => void submit(event)} className="flex flex-col gap-4">
      <Step n={1} title="What is it?">
        <fieldset className="m-0 border-0 p-0">
          <legend className="sr-only">Kind of record</legend>
          <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-tray p-1.5">
            {KINDS.map(k => <label key={k.value} className={cx('flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl px-2 py-3 text-center text-[12px] font-medium ring-1 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand',
              kind === k.value ? 'bg-surface text-brand-ink ring-brand shadow-[var(--shadow-xs)]' : 'bg-surface/60 text-ink-2 ring-transparent hover:bg-surface',
              locked && 'cursor-not-allowed', locked && kind !== k.value && 'opacity-60')}>
              <input type="radio" name="own-record-kind" value={k.value} checked={kind === k.value} disabled={locked} onChange={() => setKind(k.value)} className="sr-only" />
              <k.icon className="size-5" aria-hidden />{k.label}</label>)}
          </div>
        </fieldset>
        <Field label="Name it" htmlFor="own-record-title" errorId="own-record-title-problem" error={titleProblem ? 'Give it a name of at least 2 letters.' : undefined}>
          <InputR id="own-record-title" ref={titleField} required minLength={2} maxLength={160} value={title} placeholder={`e.g. ${example}`} readOnly={locked} className={lockedLook}
            onChange={e => { setTitle(e.target.value); if (e.target.value.trim().length >= 2) setTitleProblem(false) }}
            aria-invalid={titleProblem || undefined} aria-describedby={titleProblem ? 'own-record-title-problem' : undefined} />
        </Field>
      </Step>
      <Step n={2} title="Where and when">
        <Field label="Where were you treated?" hint="Hospital, clinic, lab or pharmacy" htmlFor="own-record-place" optional>
          <Input id="own-record-place" list={listId} maxLength={160} value={facility} readOnly={locked} className={lockedLook} onChange={e => setFacility(e.target.value)} placeholder="Start typing a name" />
          <datalist id={listId}>{places.map(name => <option key={name} value={name} />)}</datalist>
        </Field>
        <Field label="When" htmlFor="own-record-when">
          <Input id="own-record-when" type="date" required max={today()} value={when} readOnly={locked} className={lockedLook} onChange={e => setWhen(e.target.value)} />
        </Field>
      </Step>
      <Step n={3} title="Photos and notes" hint="Optional">
        <div id="own-record-photos" aria-busy={preparing || undefined}>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => camera.current?.click()} disabled={files.length >= MAX_FILES || busy || locked || preparing}
              className="flex h-20 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-line-strong bg-surface text-[13px] font-medium text-ink hover:border-brand hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50">
              <Camera className="size-5 text-brand" aria-hidden />Take a photo</button>
            <button type="button" onClick={() => upload.current?.click()} disabled={files.length >= MAX_FILES || busy || locked || preparing}
              className="flex h-20 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-line-strong bg-surface text-[13px] font-medium text-ink hover:border-brand hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50">
              <Upload className="size-5 text-brand" aria-hidden />Upload a file</button>
          </div>
          <input ref={camera} type="file" accept={CAMERA_TYPES} capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={e => { void add(e.target.files); e.target.value = '' }} />
          <input ref={upload} type="file" accept={UPLOAD_TYPES} multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={e => { void add(e.target.files); e.target.value = '' }} />
          <p className="m-0 mt-1.5 text-[12px] text-ink-3">Up to {MAX_FILES} photos (JPEG or PNG) or PDFs, 10 MB each, and {DAILY_FILES} a day. A photo of a result slip or prescription works well. Where a photo was taken and the camera’s details are removed before it’s sent.</p>
          {problem && <p role="alert" className="m-0 mt-2 text-[13px] font-medium text-danger-ink">{problem}</p>}
          {files.length > 0 && <ul className="m-0 mt-3 grid list-none grid-cols-1 gap-2 p-0">
            {files.map(item => <li key={item.id} className="flex items-center gap-3 rounded-xl bg-surface p-2 ring-1 ring-line">
              {item.preview ? <img src={item.preview} alt="" className="size-12 shrink-0 rounded-lg object-cover" />
                : <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-lg bg-danger-soft text-danger-ink"><FileText className="size-5" aria-hidden /></span>}
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-ink">{item.file.name}</span>
                <span className={cx('block text-[12px]', sending[item.id] === 'failed' || sending[item.id] === 'limited' ? 'font-medium text-danger-ink' : 'text-ink-3')}>
                  {[size(item.file.size), progress(item.id)].filter(Boolean).join(' · ')}</span></span>
              {!busy && !locked && !preparing && <button type="button" onClick={() => remove(item.id)} aria-label={`Remove ${item.file.name}`} className="inline-flex size-11 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-ink-3 hover:bg-danger-soft hover:text-danger-ink sm:size-9"><Trash2 className="size-4" aria-hidden /></button>}
            </li>)}
          </ul>}
          {files.length === 0 && <div aria-hidden="true" className="mt-3 flex items-center gap-2 text-[12px] text-ink-3"><ImagePlus className="size-4" />No photos yet</div>}
        </div>
        <Field label="Anything else to note?" htmlFor="own-record-notes" optional>
          <Textarea id="own-record-notes" rows={3} maxLength={2000} value={notes} readOnly={locked} className={lockedLook} onChange={e => setNotes(e.target.value)} placeholder="Dose, results, what the doctor said" />
        </Field>
      </Step>
      <p className="m-0 flex gap-2 text-[12px] text-ink-3"><Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />Marked “added by you”, so a clinician knows it came from you. Shared only when you share your records.</p>
      {notSaved && <Alert intent="warning" size="sm" title={notSaved.title}>{notSaved.message}</Alert>}
      {locked && !busy && notUploaded > 0 && <Alert intent="warning" size="sm" title="Not everything uploaded">
        Your record was saved. {shortWords(notUploaded, overLimit)} {retryable.length > 0 ? 'Try again, or close' : 'Close'} to keep your record without them.</Alert>}
    </form>
  </Drawer>
}
