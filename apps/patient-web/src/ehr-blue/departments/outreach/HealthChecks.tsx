import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { isHidApiError } from '@hid/http'
import { EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import { HeartPulse, Plus, Trash2 } from 'lucide-react'
import { FormActions } from '../../../kasuwa/parts'
import { Alert, Button, Card, CardHeader } from '../../../kasuwa/ui'
import { staffApi, type OutreachScreening, type OutreachScreeningInput } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { useDeptAccess } from '../parts/access'
import { errorText } from '../parts/errors'
import { dateText } from '../parts/format'
import { controlProps, ErrorBox, OutreachField, type FieldErrors } from './outreachParts'
import {
  bmiOf, checkScreening, skippedFields, withUnfinishedLeftOut, implausibleBmi, outsideUsualRange, FIELD_LABELS, FIELD_ORDER, fieldNamedIn, MEDICINES_LIMIT, medicineRow, mergeMedicines, NOTHING_RECORDED, sameField, sameForm, screeningForm,
  type MedicineRow, type ScreeningField, type ScreeningForm,
} from './screening'
import { readTab, unsavedHealthChecks, writeTab } from './tabMemory'

/*
 * "Health checks" on a registration (outreach-api 0118, proposed): vital signs, blood sugar, a malaria rapid test,
 * hearing, the consultation, medicines given and a referral, saved as one screening. An Outreach without the route
 * answers 404 NOT_FOUND or API_ROUTE_NOT_FOUND, and the section is not shown. A save that cannot reach Health ID is not
 * sent later by itself: it is said plainly, and everything typed stays on the page to save again with signal. What is
 * typed and not saved yet is kept for this tab (sessionStorage, tabMemory.ts), so a reload brings it back on top of the
 * checks as last saved; it goes once saved, when the tab closes, or on sign-out. Never in localStorage.
 */

/** The 404 codes that mean Outreach does not serve the route yet (not that the registration is missing). */
const ROUTE_NOT_SERVED: ReadonlySet<string> = new Set(['NOT_FOUND', 'API_ROUTE_NOT_FOUND'])

/** The save never reached Health ID: no network, or no answer in time. Not kept on the device (see above). */
function noSignal(error: unknown): boolean {
  if (!isHidApiError(error)) return error instanceof TypeError
  return error.code === 'NETWORK_ERROR' || error.code === 'REQUEST_TIMEOUT' || (error.status === 0 && error.code !== 'REQUEST_CANCELLED')
}

export const SCREENING_SAVED = 'Health checks saved.'
/** What a save that left unfinished parts out says (owner, 14 Nov 2026: the volunteer can always continue). */
export function savedExceptText(parts: readonly string[]): string {
  return `Health checks saved, except ${parts.join(', ')}. Finish what is marked in red and save again, or leave it.`
}
const PART_WORDS: Readonly<Record<string, string>> = {
  bpSystolic: 'blood pressure', bpDiastolic: 'blood pressure', glucoseValue: 'blood sugar', glucoseUnit: 'blood sugar', glucoseTiming: 'blood sugar',
  pulseBpm: 'pulse', temperatureC: 'temperature', weightKg: 'weight', heightCm: 'height', mainComplaint: 'main complaint',
  seenByClinician: 'clinician', clinicianName: 'clinician', outcome: 'outcome or advice', medicinesGiven: 'medicines given',
  referred: 'referral', referredTo: 'referral',
}
export const SCREENING_RELOADED = 'Someone else saved checks for this person while you were typing. Press Show their checks: your typing stays.'
export const SCREENING_RELOAD_OFFLINE = 'No signal: their checks couldn’t be loaded. Your typing is still here. Press Show their checks again when you have signal.'
export const SCREENING_MERGED = 'Their checks are shown, with your changes put back in. Nothing is saved yet: check them, then press Save health checks.'
export const SCREENING_OFFLINE = 'No signal, so we can’t tell if the health checks were saved. Your typing is still here while this page stays open. Write the readings on paper before you move on. Press Save again when you have signal. Nothing is saved twice.'
export const SCREENING_NO_SIGNAL = 'Health checks can’t be opened without signal. Write the readings on paper and add them here when you have signal.'
export const SCREENING_REDACTED = 'This person’s details were deleted, so health checks can’t be saved for them.'
export const SCREENING_NOT_FOUND = 'This registration can’t be found. It may have been deleted. Go back to the list.'
export const SCREENING_INCOMPLETE = 'Some health checks are incomplete. Blood pressure needs both numbers, a blood sugar reading needs its unit and fasting or random, and a referral needs where to.'
export const SCREENING_INVALID = 'Health ID couldn’t accept these health checks. Check the values and try again.'
export const SCREENING_CLASH = 'This save clashed with an earlier one. Check the health checks, then press Save again.'
export const SCREENING_FAILED = 'The health checks could not be saved. Please retry.'
export const SCREENING_NOT_LOADED = 'Health checks could not be loaded.'
export const SCREENING_CLEAR_HOW = 'To remove these checks, write why in Outcome or advice (for example, entered on the wrong person), then save.'
export const GLUCOSE_HINT = 'Like 5.6 mmol/L or 101 mg/dL. Choose the unit shown on the meter. If it shows HI or LO, leave the reading empty, write HI or LO in Outcome or advice and tell a clinician.'
export const MALARIA_HINT = 'If the test was invalid (no control line), do it again with a new test. If you can’t, choose Not done.'
export const SEE_CLINICIAN = 'This reading is outside the usual range. Make sure a clinician sees this person before they leave.'
export const CHECK_WEIGHT_HEIGHT = 'Check weight and height: they give a BMI no one has.'
export const SCREENING_KEPT = 'Your health checks that weren’t saved are back. Check them, then save.'

/** What a reload needs to bring back: the fields changed and not saved, and a save whose answer was lost, with its key. */
interface Draft {
  readonly changes: Partial<ScreeningForm>
  /** The medicines as read when the medicines in `changes` were typed: what was added and removed is worked out from them. */
  readonly baseMedicines?: ReadonlyArray<{ readonly name: string; readonly dose: string }>
  readonly unsure: { readonly input: OutreachScreeningInput; readonly version: number | undefined } | null
  readonly attempt: { readonly signature: string; readonly key: string } | null
}

/** The fields of `form` that differ from `base`. */
function changesFrom(form: ScreeningForm, base: ScreeningForm): Partial<ScreeningForm> {
  const changes: Record<string, unknown> = {}
  for (const key of Object.keys(form) as (keyof ScreeningForm)[]) {
    if (!sameField(key, form[key], base[key])) changes[key] = form[key]
  }
  return changes as Partial<ScreeningForm>
}

type Read =
  | { readonly kind: 'loading' }
  | { readonly kind: 'hidden' }
  | { readonly kind: 'failed'; readonly text: string }
  | { readonly kind: 'ready'; readonly screening: OutreachScreening | null }

const GLUCOSE_UNITS = [{ value: 'mmol/L', label: 'mmol/L' }, { value: 'mg/dL', label: 'mg/dL' }] as const
const GLUCOSE_TIMINGS = [{ value: 'fasting', label: 'Fasting' }, { value: 'random', label: 'Random' }] as const
const MALARIA = [{ value: 'positive', label: 'Positive' }, { value: 'negative', label: 'Negative' }, { value: 'not_done', label: 'Not done' }] as const
const HEARING = [{ value: 'pass', label: 'Passed' }, { value: 'refer', label: 'Didn’t pass (needs a full hearing test)' }, { value: 'not_done', label: 'Not done' }] as const
const YES_NO = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] as const

/** One group of the form, headed for a screen reader and a quick glance. */
function Group({ id, title, children }: { readonly id: string; readonly title: string; readonly children: ReactNode }) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 border-t border-line p-0 pt-4 first:border-t-0 first:pt-0" aria-labelledby={id}>
      <legend className="sr-only">{title}</legend>
      <h3 id={id} aria-hidden="true" className="m-0 text-title-3 text-ink">{title}</h3>
      {children}
    </fieldset>
  )
}

// Whether a Health checks section on screen has typing not saved yet: kept in tabMemory.ts, so the sign-out question
// (staff/App.tsx) reads it too, and still exported from here for the case view's Back.
export { unsavedHealthChecks }

/** Asks before leaving health checks that aren't saved; true when it is fine to leave. */
export function leaveHealthChecks(): boolean {
  return !unsavedHealthChecks.current || window.confirm('You have health checks that aren’t saved. Leave anyway?')
}

export function HealthChecks({ facilityId, caseId, canWrite, ageYears, onSaved }: {
  readonly facilityId: string
  readonly caseId: string
  /** Whether this membership may write registrations (outreach.registration.write); otherwise the checks are read only. */
  readonly canWrite: boolean
  /** The person's age, when known: the weight-and-height check is for adults (a newborn's BMI can be under 10). */
  readonly ageYears?: number
  /** Told once checks are saved, so the registration is read again (its "Health checks recorded", and the slip's line). */
  readonly onSaved?: () => void
}) {
  const [read, setRead] = useState<Read>({ kind: 'loading' })
  const [form, setForm] = useState<ScreeningForm>(() => screeningForm(null))
  const [problems, setProblems] = useState<FieldErrors<ScreeningField>>({ errors: {}, seq: 0 })
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [redacted, setRedacted] = useState(false)
  // Someone else saved this person's checks since they were read: said with "Show their checks", the typing kept until
  // then. If reading their checks fails, the typing and this state stay, with why.
  const [conflict, setConflict] = useState(false)
  const [reloadError, setReloadError] = useState('')
  // The save last sent, and its key: the same screening sent again (after a lost answer or no signal) reuses the key; any
  // other save gets a new one. Cleared once saved.
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  // A save that left unfinished parts out: what was typed in them, put back after the save, with their red notes.
  const leftOut = useRef<{ readonly form: ScreeningForm; readonly left: readonly string[]; readonly errors: Partial<Record<ScreeningField, string>> } | null>(null)
  // A save whose answer never arrived: it may have been stored. Checked against Outreach before the next save.
  const unsure = useRef<{ input: OutreachScreeningInput; version: number | undefined } | null>(null)
  // The form as last read or saved: the volunteer's own changes are the fields that differ from it.
  const base = useRef<ScreeningForm>(screeningForm(null))
  const focus = useFocusById()
  // Kept for this tab, by account, facility and registration: what was typed and not saved survives a reload.
  const { actorId } = useDeptAccess()
  const draftKey = actorId && canWrite ? `health-checks:${actorId}:${facilityId}:${caseId}` : null
  const id = (field: string) => `outreach-screening-${caseId}-${field}`
  const headingId = id('heading')
  const errorId = id('error')

  /** Reads the screening; null when it could not be read (said on the section). */
  const load = useCallback(async (signal?: AbortSignal, keepForm = false): Promise<OutreachScreening | null | undefined> => {
    try {
      const answer = await staffApi.outreachScreening(facilityId, caseId, signal)
      const screening = answer?.screening ?? null
      setRead({ kind: 'ready', screening })
      base.current = screeningForm(screening)
      if (!keepForm) {
        // Typed before a reload and not saved: back on top of the checks as saved, as Reload keeps them after a clash.
        const draft = draftKey ? readTab<Draft>(draftKey) : null
        const changes = draft?.changes && typeof draft.changes === 'object' ? draft.changes : {}
        const kept = Object.keys(changes).filter(key => key in base.current
          && !sameField(key as keyof ScreeningForm, changes[key as keyof ScreeningForm] as never, base.current[key as keyof ScreeningForm] as never))
        if (draft) {
          unsure.current = draft.unsure ?? null
          attempt.current = draft.attempt ?? null
        }
        let restored = { ...base.current, ...Object.fromEntries(kept.map(key => [key, changes[key as keyof ScreeningForm]])) } as ScreeningForm
        if (kept.includes('medicines')) {
          // New keys for the rows brought back (the row counter starts again on a reload), and merged with the medicines
          // read now, as after a clash: someone else's medicines saved meanwhile stay.
          const rows = (list: unknown) => (Array.isArray(list) ? list : [])
            .map(row => medicineRow(String((row as MedicineRow).name ?? ''), String((row as MedicineRow).dose ?? '')))
          const typed = rows(changes.medicines)
          restored = { ...restored, medicines: Array.isArray(draft?.baseMedicines)
            ? mergeMedicines(base.current.medicines, typed, rows(draft.baseMedicines)) : typed }
        }
        setForm(kept.length ? restored : base.current)
        if (kept.length) setNotice(SCREENING_KEPT)
      }
      return screening
    } catch (caught) {
      if (signal?.aborted) return undefined
      if (isHidApiError(caught) && caught.status === 404 && ROUTE_NOT_SERVED.has(caught.code)) setRead({ kind: 'hidden' })
      else if (isHidApiError(caught) && caught.code === 'OUTREACH_REGISTRATION_NOT_FOUND') setRead({ kind: 'failed', text: SCREENING_NOT_FOUND })
      else if (isHidApiError(caught) && caught.code === 'OUTREACH_REGISTRATION_REDACTED') { setRedacted(true); setRead({ kind: 'failed', text: SCREENING_REDACTED }) }
      else if (noSignal(caught)) setRead({ kind: 'failed', text: SCREENING_NO_SIGNAL })
      else setRead({ kind: 'failed', text: errorText(caught, SCREENING_NOT_LOADED) })
      return undefined
    }
  }, [facilityId, caseId, draftKey])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  // Checks typed but not saved are kept for this tab as they change (and a save whose answer was lost, so it is checked
  // after a reload too), and dropped once nothing is left to save.
  const unsaved = read.kind === 'ready' && !sameForm(form, base.current)
  useEffect(() => {
    if (!draftKey || read.kind !== 'ready' || busy) return
    const changes = changesFrom(form, base.current)
    writeTab(draftKey, Object.keys(changes).length || unsure.current
      ? { changes, unsure: unsure.current, attempt: attempt.current,
        ...('medicines' in changes ? { baseMedicines: base.current.medicines.map(({ name, dose }) => ({ name, dose })) } : {}) } satisfies Draft : null)
  }, [draftKey, read, form, busy])
  // Back asks before leaving checks not saved, and so does closing or reloading the page: what this tab keeps is lost
  // when the tab is closed, and the browser can't tell a reload from a close.
  useEffect(() => {
    unsavedHealthChecks.current = unsaved
    if (!unsaved) return undefined
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => { window.removeEventListener('beforeunload', warn); unsavedHealthChecks.current = false }
  }, [unsaved])

  if (read.kind === 'hidden') return null

  /**
   * After someone else saved: reads their checks and keeps what this volunteer changed on top, marked, to save again.
   * Nothing typed is lost.
   */
  async function reloadKeeping() {
    const mine = form
    const before = base.current
    setReloadError('')
    setBusy(true)
    let theirs: OutreachScreening | null
    try {
      theirs = (await staffApi.outreachScreening(facilityId, caseId))?.screening ?? null
    } catch (caught) {
      // Nothing is replaced: the typing, and the way to try again, stay on the page.
      setReloadError(noSignal(caught) ? SCREENING_RELOAD_OFFLINE : errorText(caught, SCREENING_NOT_LOADED))
      focus(errorId)
      return
    } finally {
      setBusy(false)
    }
    setConflict(false)
    setRead({ kind: 'ready', screening: theirs })
    base.current = screeningForm(theirs)
    const merged = { ...base.current } as Record<keyof ScreeningForm, unknown>
    let kept = 0
    for (const key of Object.keys(mine) as (keyof ScreeningForm)[]) {
      if (sameField(key, mine[key], before[key])) continue
      // Medicines are merged, not replaced: their medicines stay, with this volunteer's added and removed ones applied.
      merged[key] = key === 'medicines' ? mergeMedicines(base.current.medicines, mine.medicines, before.medicines) : mine[key]
      kept += 1
    }
    setForm(merged as unknown as ScreeningForm)
    setNotice(kept ? SCREENING_MERGED : '')
  }

  function update<K extends keyof ScreeningForm>(field: K, value: ScreeningForm[K]) {
    setForm(current => ({ ...current, [field]: value }))
    setNotice('')
    // A red note goes as soon as its field (or a field saved with it, like a blood sugar's unit) is changed.
    const group = new Set<string>(field === 'medicines' ? [] : skippedFields(field))
    setProblems(previous => {
      const stale = Object.keys(previous.errors).filter(key => key === field || group.has(key) || (field === 'medicines' && key.startsWith('medicine-')))
      if (!stale.length) return previous
      const errors = { ...previous.errors }
      for (const key of stale) delete errors[key as ScreeningField]
      return { errors, seq: previous.seq }
    })
  }


  function refuse(errors: Partial<Record<ScreeningField, string>>) {
    const order: string[] = [...FIELD_ORDER.slice(0, FIELD_ORDER.indexOf('outcome') + 1),
      ...form.medicines.flatMap(row => [`medicine-${row.key}-name`, `medicine-${row.key}-dose`]), 'referred', 'referredTo']
    const first = order.find(field => errors[field as ScreeningField]) as ScreeningField | undefined
    if (!first) return
    const here = document.activeElement?.id === id(first)
    setProblems(previous => ({ errors, alert: here ? first : undefined, seq: previous.seq + 1 }))
    if (!here) focus(id(first))
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || read.kind !== 'ready') return
    setFormError('')
    setConflict(false)
    setReloadError('')
    setNotice('')
    const { input: whole, errors, empty: nothing } = checkScreening(form)
    let input = whole
    let empty = nothing
    leftOut.current = null
    if (Object.keys(errors).length) {
      // Unfinished or wrong parts never stop the rest being saved: they are left out (what was saved before stays) and
      // stay on the page, marked, to finish and save again.
      const saved = read.screening ? checkScreening(base.current).input : null
      const partial = withUnfinishedLeftOut(whole, errors, saved)
      const recorded = Object.values(partial.input).some(value => value !== null && value !== false)
      if (!recorded || (saved && JSON.stringify(partial.input) === JSON.stringify(saved))) { refuse(errors); return }
      input = partial.input
      empty = false
      leftOut.current = { form, left: partial.left, errors }
    }
    setProblems(previous => (Object.keys(previous.errors).length ? { errors: {}, seq: previous.seq } : previous))
    // Saved checks can't be cleared here (Outreach keeps a screening once recorded): say how to mark them instead.
    if (empty) { setFormError(read.screening ? SCREENING_CLEAR_HOW : NOTHING_RECORDED); focus(errorId); return }
    void send(input, read.screening?.version)
  }

  async function send(input: OutreachScreeningInput, version: number | undefined) {
    if (unsure.current) {
      // The last save's answer was lost. Read what Outreach holds: if that save landed, carry on from its version
      // (or stop, when nothing changed since); if not, send this one on the version it was read at.
      const previous = unsure.current
      setBusy(true)
      let current: OutreachScreening | null | undefined
      try {
        current = (await staffApi.outreachScreening(facilityId, caseId))?.screening ?? null
      } catch (caught) {
        setBusy(false)
        setFormError(noSignal(caught) ? SCREENING_OFFLINE : errorText(caught, SCREENING_FAILED))
        focus(errorId)
        return
      }
      setBusy(false)
      unsure.current = null
      const held = current ? checkScreening(screeningForm(current)).input : null
      if (current && (current.version ?? 0) !== (previous.version ?? 0) && JSON.stringify(held) === JSON.stringify(previous.input)) {
        setRead({ kind: 'ready', screening: current })
        base.current = screeningForm(current)
        if (JSON.stringify(held) === JSON.stringify(input)) { setForm(base.current); setNotice(SCREENING_SAVED); onSaved?.(); return }
        version = current.version
      }
    }
    const signature = JSON.stringify([input, version ?? null])
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    setBusy(true)
    try {
      const answer = await staffApi.saveOutreachScreening(facilityId, caseId, input, { idempotencyKey: attempt.current.key, version })
      attempt.current = null
      unsure.current = null
      setRead({ kind: 'ready', screening: answer.screening })
      base.current = screeningForm(answer.screening)
      const unfinished = leftOut.current
      leftOut.current = null
      if (unfinished) {
        const back: Record<string, unknown> = { ...base.current }
        for (const part of unfinished.left) {
          const key = part === 'medicinesGiven' ? 'medicines' : part
          back[key] = (unfinished.form as unknown as Record<string, unknown>)[key]
        }
        setForm(back as unknown as ScreeningForm)
        setProblems(previous => ({ errors: unfinished.errors, seq: previous.seq + 1 }))
        setNotice(savedExceptText([...new Set(unfinished.left.map(part => PART_WORDS[part] ?? part))]))
      } else {
        setForm(base.current)
        setNotice(SCREENING_SAVED)
      }
      onSaved?.()
    } catch (caught) {
      // Not saved: the unfinished parts keep their red notes beside the reason.
      const unfinished = leftOut.current
      leftOut.current = null
      if (unfinished) setProblems(previous => ({ errors: unfinished.errors, seq: previous.seq + 1 }))
      const code = isHidApiError(caught) ? caught.code : ''
      if (code === 'OUTREACH_SCREENING_EXISTS' || code === 'VERSION_CONFLICT' || code === 'IF_MATCH_REQUIRED') {
        // Saved by someone else since this was read (409 first save, 412 a newer version, 428 a version that is not one):
        // nothing is sent over theirs. What was typed stays on the page until the volunteer reloads.
        attempt.current = null
        setConflict(true)
      } else if (code === 'OUTREACH_SCREENING_OUT_OF_RANGE') {
        const field = fieldNamedIn(isHidApiError(caught) ? caught.detail : null)
        if (field) refuse({ [field]: `${FIELD_LABELS[field]} is outside what Health ID accepts. Check it and try again.` })
        else setFormError('A value is outside what Health ID accepts. Check the numbers and try again.')
      } else if (code === 'OUTREACH_SCREENING_INCOMPLETE') setFormError(SCREENING_INCOMPLETE)
      else if (code === 'VALIDATION_FAILED') setFormError(SCREENING_INVALID)
      else if (code === 'IDEMPOTENCY_CONFLICT') { attempt.current = null; setFormError(SCREENING_CLASH) }
      else if (code === 'OUTREACH_REGISTRATION_REDACTED') setRedacted(true)
      else if (code === 'OUTREACH_REGISTRATION_NOT_FOUND') setFormError(SCREENING_NOT_FOUND)
      else if (noSignal(caught)) { unsure.current = { input, version }; setFormError(SCREENING_OFFLINE) }
      else {
        // A timeout, too many requests or a server fault may come after Outreach stored the save: checked before the next.
        if (isHidApiError(caught) && (caught.status === 408 || caught.status === 429 || caught.status >= 500)) unsure.current = { input, version }
        setFormError(errorText(caught, SCREENING_FAILED))
      }
      if (code !== 'OUTREACH_SCREENING_OUT_OF_RANGE' || !fieldNamedIn(isHidApiError(caught) ? caught.detail : null)) focus(errorId)
    } finally {
      setBusy(false)
    }
  }

  const field = (key: ScreeningField) => ({ error: problems.errors[key], alert: problems.alert === key, seq: problems.seq })
  const control = (key: ScreeningField, hint = false) => controlProps(id(key), problems.errors[key], hint)
  const readOnly = !canWrite || busy
  const numberInput = (key: 'bpSystolic' | 'bpDiastolic' | 'pulseBpm' | 'temperatureC' | 'weightKg' | 'heightCm' | 'glucoseValue', decimals: boolean, hint = false) => (
    <EhrInput name={key} value={form[key]} readOnly={readOnly} inputMode={decimals ? 'decimal' : 'numeric'} autoComplete="off" maxLength={7}
      onChange={event => update(key, event.target.value)} {...control(key, hint)}
      onBlur={key === 'heightCm' ? event => {
        // Whole centimetres only (Outreach takes an integer): a decimal typed is rounded as the field is left, but only
        // when the rounded height is one Outreach takes. A height in metres ("1.65") stays as typed, to be refused with
        // how to write it in centimetres, instead of becoming "2".
        const typed = event.target.value.trim().replace(',', '.')
        const rounded = Math.round(Number(typed))
        if (/^\d{1,4}\.\d+$/.test(typed) && rounded >= 30 && rounded <= 250) update('heightCm', String(rounded))
      } : undefined} />
  )
  const choice = <K extends 'glucoseUnit' | 'glucoseTiming' | 'malariaRdt' | 'hearingLeft' | 'hearingRight' | 'seenByClinician' | 'referred'>(
    key: K, options: ReadonlyArray<{ readonly value: string; readonly label: string }>) => (
    <EhrSelect name={key} value={form[key]} disabled={!canWrite || busy} onChange={event => update(key, event.target.value as ScreeningForm[K])} {...control(key)}>
      <option value="">Not recorded</option>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </EhrSelect>
  )
  const bmi = bmiOf(form)
  const bmiImplausible = (ageYears === undefined || ageYears >= 18) && implausibleBmi(form)
  const saved = read.kind === 'ready' ? read.screening : null

  let body: ReactNode
  if (read.kind === 'loading') body = <p role="status" className="m-0 text-body text-ink-3">Loading health checks…</p>
  else if (redacted) body = <Alert intent="info" title="Details deleted">{SCREENING_REDACTED}</Alert>
  else if (read.kind === 'failed') {
    body = <div className="flex flex-col items-start gap-3"><ErrorBox message={read.text} />
      <Button onClick={() => { setRead({ kind: 'loading' }); void load() }}>Try again</Button></div>
  } else {
    body = (
      <form className="flex flex-col gap-4" noValidate aria-labelledby={headingId} onSubmit={save}>
        {!canWrite && !saved ? <p className="m-0 text-body text-ink-2">No health checks recorded.</p> : null}
        <Group id={id('vitals')} title="Vital signs">
          <div className="grid grid-cols-2 gap-3">
            <OutreachField id={id('bpSystolic')} label="Blood pressure, top number" hint="mmHg, like 120." {...field('bpSystolic')}>{numberInput('bpSystolic', false, true)}</OutreachField>
            <OutreachField id={id('bpDiastolic')} label="Blood pressure, bottom number" hint="mmHg, like 80." {...field('bpDiastolic')}>{numberInput('bpDiastolic', false, true)}</OutreachField>
            <OutreachField id={id('pulseBpm')} label="Pulse" hint="Beats a minute." {...field('pulseBpm')}>{numberInput('pulseBpm', false, true)}</OutreachField>
            <OutreachField id={id('temperatureC')} label="Temperature" hint="°C, like 36.8." {...field('temperatureC')}>{numberInput('temperatureC', true, true)}</OutreachField>
            <OutreachField id={id('weightKg')} label="Weight" hint="kg, like 64.5." {...field('weightKg')}>{numberInput('weightKg', true, true)}</OutreachField>
            <OutreachField id={id('heightCm')} label="Height" hint="Whole centimetres, like 165." {...field('heightCm')}>{numberInput('heightCm', false, true)}</OutreachField>
          </div>
          {bmi && !bmiImplausible ? <p id={id('bmi')} className="m-0 text-body text-ink-2" aria-live="polite">BMI about <strong>{bmi}</strong> (worked out from weight and height; not saved).</p> : null}
          {bmiImplausible ? <p id={id('bmi')} className="m-0 text-body text-ink-1" aria-live="polite">{CHECK_WEIGHT_HEIGHT}</p> : null}
        </Group>
        <Group id={id('glucose')} title="Blood sugar">
          <div className="grid gap-3 @md:grid-cols-3">
            <OutreachField id={id('glucoseValue')} label="Reading" hint={GLUCOSE_HINT} {...field('glucoseValue')}>{numberInput('glucoseValue', true, true)}</OutreachField>
            <OutreachField id={id('glucoseUnit')} label="Unit" {...field('glucoseUnit')}>{choice('glucoseUnit', GLUCOSE_UNITS)}</OutreachField>
            <OutreachField id={id('glucoseTiming')} label="Fasting or random" {...field('glucoseTiming')}>{choice('glucoseTiming', GLUCOSE_TIMINGS)}</OutreachField>
          </div>
        </Group>
        {/* A prompt, not a diagnosis, and never saved: shown while a reading typed is outside the usual range. */}
        <div aria-live="polite">{canWrite && outsideUsualRange(form) ? <Alert intent="warning" live={false} title={SEE_CLINICIAN}>{null}</Alert> : null}</div>
        <Group id={id('malaria')} title="Malaria test">
          <OutreachField id={id('malariaRdt')} label="Malaria rapid test (RDT)" hint={MALARIA_HINT} {...field('malariaRdt')}>{choice('malariaRdt', MALARIA)}</OutreachField>
        </Group>
        <Group id={id('hearing')} title="Hearing">
          <div className="grid grid-cols-2 gap-3">
            <OutreachField id={id('hearingLeft')} label="Left ear" {...field('hearingLeft')}>{choice('hearingLeft', HEARING)}</OutreachField>
            <OutreachField id={id('hearingRight')} label="Right ear" {...field('hearingRight')}>{choice('hearingRight', HEARING)}</OutreachField>
          </div>
        </Group>
        <Group id={id('consultation')} title="Consultation">
          <OutreachField id={id('mainComplaint')} label="Main complaint" hint="In their words. Up to 200 characters." {...field('mainComplaint')}>
            <EhrInput name="mainComplaint" value={form.mainComplaint} readOnly={readOnly} maxLength={200} autoComplete="off"
              onChange={event => update('mainComplaint', event.target.value)} {...control('mainComplaint', true)} />
          </OutreachField>
          <OutreachField id={id('seenByClinician')} label="Seen by a clinician" {...field('seenByClinician')}>{choice('seenByClinician', YES_NO)}</OutreachField>
          {form.seenByClinician === 'yes' ? (
            <OutreachField id={id('clinicianName')} label="Clinician’s name" {...field('clinicianName')}>
              <EhrInput name="clinicianName" value={form.clinicianName} readOnly={readOnly} maxLength={100} autoComplete="off"
                onChange={event => update('clinicianName', event.target.value)} {...control('clinicianName')} />
            </OutreachField>
          ) : null}
          <OutreachField id={id('outcome')} label="Outcome or advice" hint="Up to 500 characters." {...field('outcome')}>
            <EhrTextarea name="outcome" value={form.outcome} readOnly={readOnly} rows={3} maxLength={500}
              onChange={event => update('outcome', event.target.value)} {...control('outcome', true)} />
          </OutreachField>
        </Group>
        <Group id={id('medicines')} title="Medicines given">
          {form.medicines.length === 0 ? <p className="m-0 text-body text-ink-3">None recorded.</p> : null}
          <ol className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Medicines given">
            {form.medicines.map((row, index) => (
              <li key={row.key} className="grid gap-3 rounded-lg bg-subtle p-3 @md:grid-cols-[1fr_1fr_auto] @md:items-end">
                <OutreachField id={id(`medicine-${row.key}-name`)} label={`Medicine ${index + 1}`} hint="Its name as given." {...field(`medicine-${row.key}-name`)}>
                  <EhrInput value={row.name} readOnly={readOnly} maxLength={100} autoComplete="off"
                    onChange={event => update('medicines', form.medicines.map(other => other.key === row.key ? { ...other, name: event.target.value } : other))}
                    {...control(`medicine-${row.key}-name`, true)} />
                </OutreachField>
                <OutreachField id={id(`medicine-${row.key}-dose`)} label={`Dose of medicine ${index + 1} (optional)`} hint="Like 500 mg twice a day for 3 days." {...field(`medicine-${row.key}-dose`)}>
                  <EhrInput value={row.dose} readOnly={readOnly} maxLength={200} autoComplete="off"
                    onChange={event => update('medicines', form.medicines.map(other => other.key === row.key ? { ...other, dose: event.target.value } : other))}
                    {...control(`medicine-${row.key}-dose`, true)} />
                </OutreachField>
                {canWrite ? <Button variant="ghost" icon={Trash2} aria-label={`Remove medicine ${index + 1}`} className="self-start @md:self-end"
                  onClick={() => { if (!busy) update('medicines', form.medicines.filter(other => other.key !== row.key)) }}>Remove</Button> : null}
              </li>
            ))}
          </ol>
          {canWrite && form.medicines.length < MEDICINES_LIMIT ? (
            <Button icon={Plus} className="self-start" onClick={() => {
              if (busy) return
              const row = medicineRow()
              update('medicines', [...form.medicines, row])
              focus(id(`medicine-${row.key}-name`))
            }}>Add a medicine</Button>
          ) : null}
          {canWrite && form.medicines.length >= MEDICINES_LIMIT ? <p className="m-0 text-caption text-ink-3">Up to {MEDICINES_LIMIT} medicines.</p> : null}
        </Group>
        <Group id={id('referral')} title="Referral">
          <OutreachField id={id('referred')} label="Referred" {...field('referred')}>{choice('referred', YES_NO)}</OutreachField>
          {form.referred === 'yes' ? (
            <OutreachField id={id('referredTo')} label="Referred to" hint="The hospital, clinic or service." {...field('referredTo')}>
              <EhrInput name="referredTo" value={form.referredTo} readOnly={readOnly} maxLength={200} autoComplete="off"
                onChange={event => update('referredTo', event.target.value)} {...control('referredTo', true)} />
            </OutreachField>
          ) : null}
        </Group>
        <div id={errorId} tabIndex={-1} className="flex flex-col items-start gap-3 outline-none">
          <ErrorBox message={conflict ? reloadError || SCREENING_RELOADED : formError} />
          {conflict ? <Button aria-busy={busy || undefined} onClick={() => { if (!busy) void reloadKeeping() }}>Show their checks</Button> : null}
        </div>
        {canWrite ? (
          <FormActions sticky={false}>
            <Button type="submit" variant="primary" size="lg" className="hid-ehr-dept-outreach-unavailable" aria-busy={busy || undefined}
              aria-disabled={busy || undefined}>{busy ? 'Saving…' : 'Save health checks'}</Button>
          </FormActions>
        ) : null}
      </form>
    )
  }

  return (
    <Card aria-labelledby={headingId}>
      <CardHeader as="h2" titleId={headingId} icon={HeartPulse} iconTone="brand" title="Health checks"
        description={saved ? `Last saved ${dateText(saved.updatedAt || saved.recordedAt)}.` : 'Record any checks done today. Leave out what wasn’t done.'} />
      <div className="flex flex-col gap-4 p-5">
        {/* Mounted throughout, so a save is announced. */}
        <div role="status">{notice ? <Alert intent={notice === SCREENING_SAVED || notice === SCREENING_MERGED ? 'success' : 'warning'} live={false} title={notice}>{null}</Alert> : null}</div>
        {body}
      </div>
    </Card>
  )
}
