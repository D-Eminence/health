import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Camera, FileText, FlaskConical, HeartPulse, ImagePlus, Lock, NotebookPen, Pill, Stethoscope, Syringe, Trash2, Upload } from 'lucide-react'
import { isHidApiError } from '@hid/http'
import { Drawer } from '../kasuwa/interactive'
import { useToast } from '../kasuwa/toast'
import { Alert, Button, Field, IconChip, Input, Textarea, cx, type Icon } from '../kasuwa/ui'
import { Step } from '../kasuwa/parts'
import { SAY } from '../copy'
import { InputR } from './profileParts'
import type { OwnRecordInput } from '../api'
import { useSession } from '../session'

/**
 * "Add a record": a patient keeps their own history: a visit, a test result, a medicine, from any hospital, clinic or
 * pharmacy, with a photo of the paper or the file they were given. One drawer, top to bottom in the order a person
 * recalls it (what, where, when), the camera within thumb reach on a phone. Photos and files stay in this page's
 * memory until sent and are never kept in the browser. Saved as "added by you", so a clinician can tell it apart.
 *
 * No backend serves it yet (POST ehr/me/patient-entries is proposed, BACKEND-NEEDS.md): until one does, a 404 is said
 * plainly ("nothing was saved") and what was entered stays in the drawer.
 */
const KINDS: ReadonlyArray<{ value: OwnRecordInput['kind']; label: string; icon: Icon; example: string }> = [
  { value: 'visit', label: 'Visit', icon: Stethoscope, example: 'Check-up at Lagos General' },
  { value: 'test', label: 'Test result', icon: FlaskConical, example: 'Malaria test' },
  { value: 'medicine', label: 'Medicine', icon: Pill, example: 'Amoxicillin 500 mg' },
  { value: 'diagnosis', label: 'Diagnosis', icon: HeartPulse, example: 'Hypertension' },
  { value: 'vaccination', label: 'Vaccine', icon: Syringe, example: 'Hepatitis B, dose 2' },
  { value: 'other', label: 'Other', icon: NotebookPen, example: 'What it was' },
]
const MAX_FILES = 5
const MAX_BYTES = 10 * 1024 * 1024

interface Picked { id: string; file: File; preview: string | null }

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
const size = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
const base64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
  reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'))
  reader.readAsDataURL(file)
})

export function AddRecordDrawer({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: () => void }) {
  const { api } = useSession()
  const toast = useToast()
  const [kind, setKind] = useState<OwnRecordInput['kind']>('visit')
  const [title, setTitle] = useState('')
  const [facility, setFacility] = useState('')
  const [when, setWhen] = useState(today)
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState<Picked[]>([])
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

  // Facilities on Health ID, offered as the patient types; any other place can be typed in full.
  useEffect(() => {
    if (!open || places.length) return
    let live = true
    api.participatingFacilities().then(list => { if (live) setPlaces(list.facilities.map(f => f.name)) }).catch(() => {})
    return () => { live = false }
  }, [open, api, places.length])
  // Previews are object URLs in memory; each is let go when its file is.
  const urls = useRef(new Set<string>())
  useEffect(() => () => { urls.current.forEach(URL.revokeObjectURL) }, [])

  const add = (list: FileList | null) => {
    if (!list) return
    setProblem(null)
    const next: Picked[] = []
    for (const file of Array.from(list)) {
      if (files.length + next.length >= MAX_FILES) { setProblem(`You can add up to ${MAX_FILES} photos or files.`); break }
      if (file.size > MAX_BYTES) { setProblem(`${file.name} is over 10 MB.`); continue }
      if (!/^image\/|^application\/pdf$/.test(file.type)) { setProblem(`${file.name} isn't a photo or PDF.`); continue }
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
      if (preview) urls.current.add(preview)
      next.push({ id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`, file, preview })
    }
    setFiles(current => [...current, ...next])
  }
  const remove = (id: string) => setFiles(current => current.filter(item => {
    if (item.id === id && item.preview) { URL.revokeObjectURL(item.preview); urls.current.delete(item.preview) }
    return item.id !== id
  }))
  const reset = () => {
    files.forEach(item => item.preview && URL.revokeObjectURL(item.preview))
    setKind('visit'); setTitle(''); setFacility(''); setWhen(today()); setNotes(''); setFiles([]); setProblem(null); setNotSaved(null); setTitleProblem(false)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    // Save is never silently off: what is missing is said under its field, and focus goes there.
    if (title.trim().length < 2) { setTitleProblem(true); titleField.current?.focus(); return }
    if (!when) return
    setBusy(true); setProblem(null); setNotSaved(null)
    try {
      const attachments = await Promise.all(files.map(async item => ({ fileName: item.file.name, mediaType: item.file.type, sizeBytes: item.file.size, contentBase64: await base64(item.file) })))
      await api.addOwnRecord({ kind, title: title.trim(), facilityName: facility.trim() || null, occurredOn: when, notes: notes.trim() || null, attachments })
      toast.success({ title: 'Record added', message: `${title.trim()} is in your records, marked “added by you”.` })
      reset(); onSaved?.(); onClose()
    } catch (cause) {
      setNotSaved(isHidApiError(cause) && cause.status === 404
        ? { title: 'Nothing was saved', message: 'Health ID can’t keep records you add yet. What you entered is still here.' }
        : { title: 'Couldn’t add your record', message: isHidApiError(cause) ? cause.message : SAY.tryAgain })
    } finally { setBusy(false) }
  }

  const listId = useMemo(() => `own-record-places-${Math.random().toString(36).slice(2)}`, [])
  return <Drawer open={open} onClose={onClose} title="Add a record" icon={<IconChip icon={FileText} tone="brand" />}
    description="A visit, result or medicine from anywhere, with a photo of the paper."
    footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant="primary" type="submit" form="own-record-form" loading={busy} disabled={busy}>Save record</Button></>}>
    <form id="own-record-form" noValidate onSubmit={event => void submit(event)} className="flex flex-col gap-4">
      <Step n={1} title="What is it?">
        <fieldset className="m-0 border-0 p-0">
          <legend className="sr-only">Kind of record</legend>
          <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-tray p-1.5">
            {KINDS.map(k => <label key={k.value} className={cx('flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl px-2 py-3 text-center text-[12px] font-medium ring-1 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand',
              kind === k.value ? 'bg-surface text-brand-ink ring-brand shadow-[var(--shadow-xs)]' : 'bg-surface/60 text-ink-2 ring-transparent hover:bg-surface')}>
              <input type="radio" name="own-record-kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} className="sr-only" />
              <k.icon className="size-5" aria-hidden />{k.label}</label>)}
          </div>
        </fieldset>
        <Field label="Name it" htmlFor="own-record-title" errorId="own-record-title-problem" error={titleProblem ? 'Give it a name of at least 2 letters.' : undefined}>
          <InputR id="own-record-title" ref={titleField} required minLength={2} maxLength={160} value={title} placeholder={`e.g. ${example}`}
            onChange={e => { setTitle(e.target.value); if (e.target.value.trim().length >= 2) setTitleProblem(false) }}
            aria-invalid={titleProblem || undefined} aria-describedby={titleProblem ? 'own-record-title-problem' : undefined} />
        </Field>
      </Step>
      <Step n={2} title="Where and when">
        <Field label="Where were you treated?" hint="Hospital, clinic, lab or pharmacy" htmlFor="own-record-place" optional>
          <Input id="own-record-place" list={listId} maxLength={160} value={facility} onChange={e => setFacility(e.target.value)} placeholder="Start typing a name" />
          <datalist id={listId}>{places.map(name => <option key={name} value={name} />)}</datalist>
        </Field>
        <Field label="When" htmlFor="own-record-when">
          <Input id="own-record-when" type="date" required max={today()} value={when} onChange={e => setWhen(e.target.value)} />
        </Field>
      </Step>
      <Step n={3} title="Photos and notes" hint="Optional">
        <div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => camera.current?.click()} disabled={files.length >= MAX_FILES}
              className="flex h-20 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong bg-subtle text-[13px] font-medium text-ink hover:border-brand hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50">
              <Camera className="size-5 text-brand" aria-hidden />Take a photo</button>
            <button type="button" onClick={() => upload.current?.click()} disabled={files.length >= MAX_FILES}
              className="flex h-20 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong bg-subtle text-[13px] font-medium text-ink hover:border-brand hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50">
              <Upload className="size-5 text-brand" aria-hidden />Upload a file</button>
          </div>
          <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={e => { add(e.target.files); e.target.value = '' }} />
          <input ref={upload} type="file" accept="image/*,application/pdf" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={e => { add(e.target.files); e.target.value = '' }} />
          <p className="m-0 mt-1.5 text-[12px] text-ink-3">Up to {MAX_FILES}, 10 MB each. A photo of a result slip or prescription works well.</p>
          {problem && <p role="alert" className="m-0 mt-2 text-[13px] font-medium text-danger-ink">{problem}</p>}
          {files.length > 0 && <ul className="m-0 mt-3 grid list-none grid-cols-1 gap-2 p-0">
            {files.map(item => <li key={item.id} className="flex items-center gap-3 rounded-xl bg-surface p-2 ring-1 ring-line">
              {item.preview ? <img src={item.preview} alt="" className="size-12 shrink-0 rounded-lg object-cover" />
                : <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-lg bg-danger-soft text-danger-ink"><FileText className="size-5" aria-hidden /></span>}
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-ink">{item.file.name}</span><span className="block text-[12px] text-ink-3">{size(item.file.size)}</span></span>
              <button type="button" onClick={() => remove(item.id)} aria-label={`Remove ${item.file.name}`} className="inline-flex size-11 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-ink-3 hover:bg-danger-soft hover:text-danger-ink sm:size-9"><Trash2 className="size-4" aria-hidden /></button>
            </li>)}
          </ul>}
          {files.length === 0 && <div aria-hidden="true" className="mt-3 flex items-center gap-2 text-[12px] text-ink-3"><ImagePlus className="size-4" />No photos yet</div>}
        </div>
        <Field label="Anything else to note?" htmlFor="own-record-notes" optional>
          <Textarea id="own-record-notes" rows={3} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Dose, results, what the doctor said" />
        </Field>
      </Step>
      <p className="m-0 flex gap-2 text-[12px] text-ink-3"><Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />Marked “added by you”, so a clinician knows it came from you. Shared only when you share your records.</p>
      {notSaved && <Alert intent="warning" size="sm" title={notSaved.title}>{notSaved.message}</Alert>}
    </form>
  </Drawer>
}
