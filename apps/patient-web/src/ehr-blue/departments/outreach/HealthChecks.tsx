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
  bmiOf, checkScreening, FIELD_LABELS, FIELD_ORDER, fieldNamedIn, MEDICINES_LIMIT, medicineRow, NOTHING_RECORDED, screeningForm,
  type ScreeningField, type ScreeningForm,
} from './screening'
import { readTab, tabKeeps, writeTab } from './tabMemory'

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
export const SCREENING_RELOADED = 'Someone else just saved this person’s checks. Reload to see them.'
export const SCREENING_OFFLINE = 'No signal: the health checks were not saved. Everything you typed is still here. Save again when you have signal.'
export const SCREENING_REDACTED = 'This person’s details were deleted, so health checks can’t be saved for them.'
export const SCREENING_NOT_FOUND = 'This registration can’t be found. It may have been deleted. Go back to the list.'
export const SCREENING_INCOMPLETE = 'Some health checks are incomplete. Blood pressure needs both numbers, a blood sugar reading needs its unit and fasting or random, and a referral needs where to.'
export const SCREENING_INVALID = 'Health ID couldn’t accept these health checks. Check the values and try again.'
export const SCREENING_CLASH = 'This save clashed with an earlier one. Check the health checks, then press Save again.'
export const SCREENING_FAILED = 'The health checks could not be saved. Please retry.'
export const SCREENING_NOT_LOADED = 'Health checks could not be loaded.'
export const SCREENING_KEPT = 'Your health checks that weren’t saved are back. Check them, then save.'

/** What a reload needs to bring back: the fields changed and not saved, and a save whose answer was lost, with its key. */
interface Draft {
  readonly changes: Partial<ScreeningForm>
  readonly unsure: { readonly input: OutreachScreeningInput; readonly version: number | undefined } | null
  readonly attempt: { readonly signature: string; readonly key: string } | null
}

/** The fields of `form` that differ from `base`. */
function changesFrom(form: ScreeningForm, base: ScreeningForm): Partial<ScreeningForm> {
  const changes: Record<string, unknown> = {}
  for (const key of Object.keys(form) as (keyof ScreeningForm)[]) {
    if (JSON.stringify(form[key]) !== JSON.stringify(base[key])) changes[key] = form[key]
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
const HEARING = [{ value: 'pass', label: 'Pass' }, { value: 'refer', label: 'Refer' }, { value: 'not_done', label: 'Not done' }] as const
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

/** Whether a Health checks section on screen has typing not saved yet (read by the case view's Back). */
export const unsavedHealthChecks = { current: false }

/** Asks before leaving health checks that aren't saved; true when it is fine to leave. */
export function leaveHealthChecks(): boolean {
  return !unsavedHealthChecks.current || window.confirm('You have health checks that aren’t saved. Leave anyway?')
}

export function HealthChecks({ facilityId, caseId, canWrite }: {
  readonly facilityId: string
  readonly caseId: string
  /** Whether this membership may write registrations (outreach.registration.write); otherwise the checks are read only. */
  readonly canWrite: boolean
}) {
  const [read, setRead] = useState<Read>({ kind: 'loading' })
  const [form, setForm] = useState<ScreeningForm>(() => screeningForm(null))
  const [problems, setProblems] = useState<FieldErrors<ScreeningField>>({ errors: {}, seq: 0 })
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [redacted, setRedacted] = useState(false)
  // Someone else saved this person's checks since they were read: said with Reload, the typing kept until then.
  const [conflict, setConflict] = useState(false)
  // The save last sent, and its key: the same screening sent again (after a lost answer or no signal) reuses the key; any
  // other save gets a new one. Cleared once saved.
  const attempt = useRef<{ signature: string; key: string } | null>(null)
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
          && JSON.stringify(changes[key as keyof ScreeningForm]) !== JSON.stringify(base.current[key as keyof ScreeningForm]))
        if (draft) {
          unsure.current = draft.unsure ?? null
          attempt.current = draft.attempt ?? null
        }
        setForm(kept.length ? { ...base.current, ...Object.fromEntries(kept.map(key => [key, changes[key as keyof ScreeningForm]])) } : base.current)
        if (kept.length) setNotice(SCREENING_KEPT)
      }
      return screening
    } catch (caught) {
      if (signal?.aborted) return undefined
      if (isHidApiError(caught) && caught.status === 404 && ROUTE_NOT_SERVED.has(caught.code)) setRead({ kind: 'hidden' })
      else if (isHidApiError(caught) && caught.code === 'OUTREACH_REGISTRATION_NOT_FOUND') setRead({ kind: 'failed', text: SCREENING_NOT_FOUND })
      else if (isHidApiError(caught) && caught.code === 'OUTREACH_REGISTRATION_REDACTED') { setRedacted(true); setRead({ kind: 'failed', text: SCREENING_REDACTED }) }
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
  const unsaved = read.kind === 'ready' && JSON.stringify(form) !== JSON.stringify(base.current)
  useEffect(() => {
    if (!draftKey || read.kind !== 'ready' || busy) return
    const changes = changesFrom(form, base.current)
    writeTab(draftKey, Object.keys(changes).length || unsure.current
      ? { changes, unsure: unsure.current, attempt: attempt.current } satisfies Draft : null)
  }, [draftKey, read, form, busy])
  // Back asks before leaving checks not saved. A reload or a closed page asks too, but only where this tab can't keep them.
  const keptForReload = draftKey !== null && tabKeeps()
  useEffect(() => {
    unsavedHealthChecks.current = unsaved
    if (!unsaved) return undefined
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    if (!keptForReload) window.addEventListener('beforeunload', warn)
    return () => { window.removeEventListener('beforeunload', warn); unsavedHealthChecks.current = false }
  }, [unsaved, keptForReload])

  if (read.kind === 'hidden') return null

  /**
   * After someone else saved: reads their checks and keeps what this volunteer changed on top, marked, to save again.
   * Nothing typed is lost.
   */
  async function reloadKeeping() {
    const mine = form
    const before = base.current
    setConflict(false)
    const theirs = await load(undefined, true)
    if (theirs === undefined) return
    const merged = { ...screeningForm(theirs) } as Record<keyof ScreeningForm, unknown>
    let kept = 0
    for (const key of Object.keys(mine) as (keyof ScreeningForm)[]) {
      if (JSON.stringify(mine[key]) !== JSON.stringify(before[key])) { merged[key] = mine[key]; kept += 1 }
    }
    setForm(merged as unknown as ScreeningForm)
    setNotice(kept ? 'Their checks are shown. Your changes are kept on top and not saved yet: check them, then save again.' : '')
  }

  function update<K extends keyof ScreeningForm>(field: K, value: ScreeningForm[K]) {
    setForm(current => ({ ...current, [field]: value }))
    setNotice('')
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
    setNotice('')
    const { input, errors, empty } = checkScreening(form)
    if (Object.keys(errors).length) { refuse(errors); return }
    setProblems(previous => (Object.keys(previous.errors).length ? { errors: {}, seq: previous.seq } : previous))
    if (empty) { setFormError(NOTHING_RECORDED); focus(errorId); return }
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
        if (JSON.stringify(held) === JSON.stringify(input)) { setForm(screeningForm(current)); setNotice(SCREENING_SAVED); return }
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
      setForm(screeningForm(answer.screening))
      base.current = screeningForm(answer.screening)
      setNotice(SCREENING_SAVED)
    } catch (caught) {
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
      else setFormError(errorText(caught, SCREENING_FAILED))
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
        // Whole centimetres only (Outreach takes an integer): a decimal typed is rounded as the field is left.
        const typed = event.target.value.trim().replace(',', '.')
        if (/^\d{1,4}\.\d+$/.test(typed)) update('heightCm', String(Math.round(Number(typed))))
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
          {bmi ? <p id={id('bmi')} className="m-0 text-body text-ink-2" aria-live="polite">BMI about <strong>{bmi}</strong> (worked out from weight and height; not saved).</p> : null}
        </Group>
        <Group id={id('glucose')} title="Blood sugar">
          <div className="grid gap-3 @md:grid-cols-3">
            <OutreachField id={id('glucoseValue')} label="Reading" hint="Like 5.6 mmol/L or 101 mg/dL." {...field('glucoseValue')}>{numberInput('glucoseValue', true, true)}</OutreachField>
            <OutreachField id={id('glucoseUnit')} label="Unit" {...field('glucoseUnit')}>{choice('glucoseUnit', GLUCOSE_UNITS)}</OutreachField>
            <OutreachField id={id('glucoseTiming')} label="Fasting or random" {...field('glucoseTiming')}>{choice('glucoseTiming', GLUCOSE_TIMINGS)}</OutreachField>
          </div>
        </Group>
        <Group id={id('malaria')} title="Malaria test">
          <OutreachField id={id('malariaRdt')} label="Malaria rapid test (RDT)" {...field('malariaRdt')}>{choice('malariaRdt', MALARIA)}</OutreachField>
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
          <ErrorBox message={conflict ? SCREENING_RELOADED : formError} />
          {conflict ? <Button onClick={() => { if (!busy) void reloadKeeping() }}>Reload</Button> : null}
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
        <div role="status">{notice ? <Alert intent="success" live={false} title={notice}>{null}</Alert> : null}</div>
        {body}
      </div>
    </Card>
  )
}
