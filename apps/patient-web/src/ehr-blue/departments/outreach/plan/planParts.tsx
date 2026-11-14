import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Check, Plus, ShieldAlert, Trash2, X } from 'lucide-react'
import { Badge, Button, Input, Select, Textarea, cx } from '../../../../kasuwa/ui'
import { Segmented } from '../../../../kasuwa/interactive'
import { useToast } from '../../../../kasuwa/toast'
import type { OutreachConsentLanguage } from '../../../../staff/api'
import {
  focusFromWords, focusIdOf, focusLabel, SCREENING_FOCUSES, STATIONS, type CampaignSite, type CustomFocus, type FocusId, type KitStock, type PlanFocus,
  type ReferralPartner, type ScreeningFocus, type StationKind,
} from '../campaignTypes'
import {
  addOwnQuestion, addOwnTest, addOwnVital, CONSENT_LANGUAGES, emptyPartner, emptySite, isOwnItem, isOwnQuestion, kitLeft, localId, needsSeparateConsent,
  OWN_TEST_RESULTS, packageChoices, removeOwnItem, removeOwnQuestion, setStationMode, toggleItem, withFocuses, type PlanDraft,
} from './planDraft'

/*
 * The plan's editors, shared by the wizard's steps and the Setup tab's drawers: each edits one part of a draft and hands
 * back the whole draft. Phone first: 44px+ targets, number keypads for numbers, Enter moves to the next field.
 */

export interface EditorProps {
  readonly draft: PlanDraft
  readonly onChange: (next: PlanDraft) => void
  /** The coordinator wrote their own consent text: it no longer follows the focuses. */
  readonly consentEdited: boolean
  /** Field errors by field id, shown under each field. */
  readonly errors?: Readonly<Record<string, string>>
}

/** A day (YYYY-MM-DD) in words: "1 Mar 2027". */
export function dayText(day: string): string {
  const date = new Date(`${day}T12:00:00Z`)
  return Number.isNaN(date.getTime()) ? day : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}

/** Who a test or question is for, in words, when it isn't everyone. */
export function appliesText(rule: { readonly sex?: 'female' | 'male'; readonly minAge?: number } | undefined): string | undefined {
  if (!rule || (!rule.sex && rule.minAge === undefined)) return undefined
  const who = rule.sex === 'female' ? 'Women' : rule.sex === 'male' ? 'Men' : 'People'
  return rule.minAge !== undefined ? `${who} ${rule.minAge} and over` : `${who} only`
}

/** Enter in a one-line field moves to the next field, as Tab does; in the last one it submits the form. */
export function enterMovesOn(event: KeyboardEvent<HTMLElement>) {
  const target = event.target as HTMLElement
  if (event.key !== 'Enter' || event.shiftKey || target.tagName !== 'INPUT') return
  const input = target as HTMLInputElement
  if (['checkbox', 'radio', 'submit', 'button'].includes(input.type)) return
  const form = input.form
  if (!form) return
  const fields = [...form.querySelectorAll<HTMLElement>('input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled])')]
    .filter(field => !(field instanceof HTMLInputElement && ['checkbox', 'radio'].includes(field.type)))
  const next = fields[fields.indexOf(input) + 1]
  if (next) { event.preventDefault(); next.focus() }
}

/** A labelled field: the control, then its error (said as an alert) or its hint. */
export function PlanField({ id, label, required, optional, hint, error, alert, seq, children, className }: {
  readonly id: string; readonly label: string; readonly required?: boolean; readonly optional?: boolean
  readonly hint?: ReactNode; readonly error?: string; readonly children: ReactNode; readonly className?: string
  /** Refused while focus was already in it: the error is said as an alert there (`seq` makes it new each time). */
  readonly alert?: boolean; readonly seq?: number
}) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink-2">
        {label}{required ? <span aria-hidden="true"> *</span> : null}{optional ? <span className="font-normal text-ink-3"> (optional)</span> : null}
      </label>
      {children}
      {error ? <p id={`${id}-error`} className="m-0 text-xs font-medium text-danger-ink">{alert ? <span key={seq} role="alert">{error}</span> : error}</p>
        : hint ? <p id={`${id}-hint`} className="m-0 text-xs text-ink-3">{hint}</p> : null}
    </div>
  )
}

/** The props a control in a PlanField takes. */
export function fieldProps(id: string, error: string | undefined, hint = false) {
  return { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined }
}

const CONTROL = 'h-12 text-base sm:h-11 sm:text-sm'

/** Several of a set, as chips (checkboxes): 44px tall, each says it is chosen with a tick, not colour alone. */
export function ChoiceChips<T extends string>({ legend, hint, options, values, onChange, name, error, alert, seq, id, disabledValues, extra }: {
  readonly legend: string; readonly hint?: string; readonly name: string; readonly id?: string; readonly error?: string
  /** More chips after the options, in the same row (a focus of the organisation's own, "Other"). */
  readonly extra?: ReactNode
  readonly alert?: boolean; readonly seq?: number
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: string; readonly hint?: string }>
  readonly values: readonly T[]; readonly onChange: (next: T[]) => void; readonly disabledValues?: readonly T[]
}) {
  const auto = useId()
  const base = id ?? `chips-${auto}`
  return (
    <fieldset id={base} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${base}-error` : hint ? `${base}-hint` : undefined}>
      <legend className="mb-1.5 p-0 text-[13px] font-medium text-ink-2">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(option => {
          const on = values.includes(option.value)
          const disabled = disabledValues?.includes(option.value) ?? false
          return (
            <label key={option.value} title={option.hint}
              className={cx('relative inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-4 text-sm font-medium ring-1 ring-inset select-none',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring-color)]',
                on ? 'bg-brand-soft text-brand-ink ring-brand-line' : 'bg-surface text-ink-2 ring-line-strong hover:text-ink',
                disabled && 'cursor-not-allowed opacity-70')}>
              <input type="checkbox" name={name} value={option.value} checked={on} disabled={disabled} className="sr-only"
                id={`${base}-${option.value}`}
                onChange={event => onChange(event.target.checked ? [...values, option.value] : values.filter(value => value !== option.value))} />
              {on ? <Check className="size-4 shrink-0" aria-hidden /> : null}
              {option.label}
            </label>
          )
        })}
        {extra}
      </div>
      {error ? <p id={`${base}-error`} className="m-0 text-xs font-medium text-danger-ink">{alert ? <span key={seq} role="alert">{error}</span> : error}</p>
        : hint ? <p id={`${base}-hint`} className="m-0 text-xs text-ink-3">{hint}</p> : null}
    </fieldset>
  )
}

/** One item that can be switched off: a checkbox row, 48px, with its detail under the name. */
function CheckRow({ id, checked, onChange, title, detail, badge }: {
  readonly id: string; readonly checked: boolean; readonly onChange: (on: boolean) => void
  readonly title: string; readonly detail?: ReactNode; readonly badge?: ReactNode
}) {
  return (
    <li className="flex min-h-12 items-start gap-3 py-2.5">
      <input id={id} type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)}
        className="mt-0.5 size-5 shrink-0 cursor-pointer accent-[var(--color-brand-fill,currentColor)]" />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className={cx('flex flex-wrap items-center gap-2 text-sm font-medium', checked ? 'text-ink' : 'text-ink-3 line-through decoration-ink-3/60')}>{title}{badge}</span>
        {detail ? <span className="mt-0.5 block text-[13px] text-ink-3">{detail}</span> : null}
      </label>
    </li>
  )
}

// ------------------------------------------------------------------------------------------------------ focuses --

export function FocusEditor({ draft, onChange, consentEdited, errors }: EditorProps) {
  const listed = draft.focuses.filter((focus): focus is ScreeningFocus => typeof focus === 'string')
  const own = draft.focuses.filter((focus): focus is CustomFocus => typeof focus !== 'string')
  const [typing, setTyping] = useState(false)
  const [typed, setTyped] = useState('')
  const [typedError, setTypedError] = useState('')
  const toast = useToast()
  // The field gets focus as it opens, in the commit that shows it.
  const opened = useRef(false)
  useLayoutEffect(() => {
    if (typing && !opened.current) document.getElementById('plan-focus-other')?.focus()
    opened.current = typing
  }, [typing])
  const set = (focuses: readonly PlanFocus[]) => onChange(withFocuses(draft, focuses, { consentEdited }))
  const field = 'plan-focus-other'
  const add = () => {
    const focus = focusFromWords(typed)
    if (!focus) {
      setTypedError('Type what it is for, like malaria.')
      document.getElementById(field)?.focus()
      return
    }
    const id = focusIdOf(focus)
    if (!draft.focuses.some(item => focusIdOf(item) === id)) set([...draft.focuses, focus])
    // A name on the list is that focus (its own checks), not a new one.
    if (typeof focus === 'string') toast.info(`${focusLabel(focus)} is on the list, so its own checks are used.`)
    setTyped('')
    setTypedError('')
    document.getElementById(field)?.focus()
  }
  const remove = (focus: CustomFocus) => {
    set(draft.focuses.filter(item => focusIdOf(item) !== focus.id))
    document.getElementById(`${field}-open`)?.focus()
  }
  const chip = 'relative inline-flex min-h-11 items-center gap-1.5 rounded-full text-sm font-medium ring-1 ring-inset'
  return (
    <div className="flex flex-col gap-3">
      <ChoiceChips name="focuses" id="plan-focuses" legend="What it screens for"
        hint="Choose one or more. Each brings its own checks, which you can change next. Not on the list? Choose Other."
        error={errors?.focuses} options={SCREENING_FOCUSES} values={listed}
        onChange={focuses => set([...focuses, ...own])}
        extra={<>
          {own.map(focus => (
            <span key={focus.id} className={cx(chip, 'bg-brand-soft pl-4 text-brand-ink ring-brand-line')}>
              <Check className="size-4 shrink-0" aria-hidden />{focus.label}
              <button type="button" aria-label={`Remove ${focus.label}`} onClick={() => remove(focus)}
                className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-brand-ink hover:bg-brand-line/30 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]">
                <X className="size-4" aria-hidden />
              </button>
            </span>
          ))}
          <button type="button" id={`${field}-open`} aria-expanded={typing} aria-controls={typing ? `${field}-row` : undefined}
            onClick={() => { setTyping(open => !open); setTypedError('') }}
            className={cx(chip, 'cursor-pointer border-0 px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]',
              typing ? 'bg-tray text-ink ring-line-strong' : 'bg-surface text-ink-2 ring-line-strong hover:text-ink')}>
            <Plus className="size-4 shrink-0" aria-hidden />Other
          </button>
        </>} />
      {typing ? (
        <div id={`${field}-row`} className="flex flex-col gap-2 @md:flex-row @md:items-start">
          <PlanField id={field} label="Type the condition (e.g. malaria)" error={typedError} hint="Add as many as you run. Each one is counted on its own."
            className="flex-1">
            <Input className={CONTROL} value={typed} maxLength={60} autoComplete="off" onChange={event => setTyped(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add() } }} {...fieldProps(field, typedError, true)} />
          </PlanField>
          <Button icon={Plus} className="h-12 @md:mt-6 sm:h-11" onClick={add}>Add</Button>
        </div>
      ) : null}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------------ package --

type OwnKind = 'test' | 'vital' | 'question'

export function PackageEditor({ draft, onChange, consentEdited }: EditorProps) {
  const options = { consentEdited }
  const choices = packageChoices(draft)
  const on = (kind: 'vitals' | 'tests' | 'questions', id: string) => draft.package[kind].some(item => item.id === id)
  // One "Add …" form open at a time, under the lists.
  const [adding, setAdding] = useState<OwnKind | null>(null)
  if (draft.focuses.length === 0) return <p className="m-0 text-sm text-ink-2">Choose what the campaign is for first.</p>
  const ownFocus = draft.focuses.some(focus => typeof focus !== 'string')
  const empty = !choices.vitals.length && !choices.tests.length && !choices.questions.length
  const removeButton = (kind: 'vitals' | 'tests' | 'questions', item: { readonly id: string }, name: string) => (
    <Button variant="ghost" icon={Trash2} aria-label={`Remove “${name}”`} onClick={() => onChange(removeOwnItem(draft, kind, item.id, options))} />
  )
  return (
    <div className="flex flex-col gap-5">
      {empty ? <p className="m-0 text-sm text-ink-2">{ownFocus ? 'Nothing to check yet: add a test, a measurement or a question.' : 'Nothing to check yet.'}</p> : null}
      {choices.vitals.length ? (
        <section aria-labelledby="plan-vitals-heading">
          <h4 id="plan-vitals-heading" className="m-0 text-[13px] font-semibold text-ink-2">Vital signs and measurements</h4>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {choices.vitals.map(vital => isOwnItem(vital) ? (
              <OwnRow key={vital.id} title={`${vital.name}${vital.unit ? ` (${vital.unit})` : ''}`} detail="A number, typed at the station."
                action={removeButton('vitals', vital, vital.name)} />
            ) : (
              <CheckRow key={vital.id} id={`plan-vital-${vital.id}`} checked={on('vitals', vital.id)} title={`${vital.name} (${vital.unit})`}
                detail={vital.derived ? vital.note : vital.normalText ? `Usual: ${vital.normalText}` : undefined}
                onChange={value => onChange(toggleItem(draft, 'vitals', vital.id, value, options))} />
            ))}
          </ul>
        </section>
      ) : null}
      {choices.tests.length ? (
        <section aria-labelledby="plan-tests-heading">
          <h4 id="plan-tests-heading" className="m-0 text-[13px] font-semibold text-ink-2">Tests</h4>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {choices.tests.map(test => {
              const badge = test.sensitive ? <Badge size="sm" tone="warn" icon={ShieldAlert}>{isOwnItem(test) ? 'Private' : 'Sensitive'}</Badge> : null
              const detail = <>
                {appliesText(test.appliesTo) ? <span className="block">{appliesText(test.appliesTo)}</span> : null}
                {test.kind === 'number' ? `A number in ${test.unit ?? ''}` : `Results: ${test.results.map(result => result.label).join(', ')}`}
                {test.separateConsent ? <span className="block">Adds its own consent and counselling.</span> : null}
              </>
              return isOwnItem(test)
                ? <OwnRow key={test.id} title={test.name} badge={badge} detail={detail} action={removeButton('tests', test, test.name)} />
                : <CheckRow key={test.id} id={`plan-test-${test.id}`} checked={on('tests', test.id)} title={test.name} badge={badge} detail={detail}
                  onChange={value => onChange(toggleItem(draft, 'tests', test.id, value, options))} />
            })}
          </ul>
        </section>
      ) : null}
      {choices.questions.length ? (
        <section aria-labelledby="plan-questions-heading">
          <h4 id="plan-questions-heading" className="m-0 text-[13px] font-semibold text-ink-2">Questions</h4>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {choices.questions.map(item => isOwnQuestion(item) ? (
              <li key={item.id} className="flex min-h-12 items-center gap-3 py-2">
                <span className="min-w-0 flex-1 text-sm font-medium text-ink">{item.text}</span>
                <Button variant="ghost" icon={Trash2} aria-label={`Remove “${item.text}”`} onClick={() => onChange(removeOwnQuestion(draft, item.id, options))} />
              </li>
            ) : (
              <CheckRow key={item.id} id={`plan-question-${item.id}`} checked={on('questions', item.id)} title={item.text} detail={appliesText(item.appliesTo)}
                onChange={value => onChange(toggleItem(draft, 'questions', item.id, value, options))} />
            ))}
          </ul>
        </section>
      ) : null}
      <div className="flex flex-col gap-3">
        <div role="group" aria-label="Add your own" className="flex flex-wrap gap-2">
          {([['test', 'Add a test'], ['vital', 'Add a measurement'], ['question', 'Add a question']] as const).map(([kind, label]) => (
            <Button key={kind} id={`plan-add-${kind}-open`} icon={Plus} aria-expanded={adding === kind} aria-controls={adding === kind ? `plan-add-${kind}` : undefined}
              variant={adding === kind ? 'secondary' : 'ghost'} onClick={() => setAdding(open => (open === kind ? null : kind))}>{label}</Button>
          ))}
        </div>
        {adding ? <AddOwn key={adding} kind={adding} onAdd={next => onChange(next(draft, options))} /> : null}
      </div>
    </div>
  )
}

/** A vital, test or question the coordinator added: its name and a button that takes it away. */
function OwnRow({ title, detail, badge, action }: { readonly title: string; readonly detail?: ReactNode; readonly badge?: ReactNode; readonly action: ReactNode }) {
  return (
    <li className="flex min-h-12 items-start gap-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">{title}{badge}<Badge size="sm" tone="neutral">Yours</Badge></span>
        {detail ? <span className="mt-0.5 block text-[13px] text-ink-3">{detail}</span> : null}
      </span>
      {action}
    </li>
  )
}

/**
 * The small form of one "Add …": a test (name, its results, private or not), a measurement (name, unit) or a yes/no
 * question. Field errors under their fields, focus to the first one; added, the form empties for the next one.
 */
function AddOwn({ kind, onAdd }: {
  readonly kind: OwnKind
  readonly onAdd: (change: (draft: PlanDraft, options: { consentEdited: boolean }) => PlanDraft) => void
}) {
  const base = `plan-add-${kind}`
  const [name, setName] = useState('')
  const [extra, setExtra] = useState(kind === 'test' ? OWN_TEST_RESULTS : '')
  const [privateResult, setPrivateResult] = useState(false)
  const [problems, setProblems] = useState<{ name?: string; extra?: string }>({})
  const nameLabel = kind === 'test' ? 'Test name' : kind === 'vital' ? 'Measurement' : 'Question'
  const first = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => { first.current?.focus() }, [])
  const add = () => {
    const found: { name?: string; extra?: string } = {}
    const words = name.trim()
    if (kind === 'question' ? words.length < 5 : words.length < 2) {
      found.name = kind === 'test' ? 'Name the test, like “Sickle cell test”.' : kind === 'vital' ? 'Name it, like “Waist size”.' : 'Write the question, like “Do you have a cough?”'
    }
    if (kind === 'test' && extra.split(',').map(word => word.trim()).filter(Boolean).length < 2) found.extra = 'Give at least two results, with a comma between.'
    if (kind === 'vital' && !extra.trim()) found.extra = 'Give the unit, like cm.'
    setProblems(found)
    if (found.name || found.extra) { document.getElementById(found.name ? `${base}-name` : `${base}-extra`)?.focus(); return }
    onAdd((draft, options) => kind === 'test' ? addOwnTest(draft, { name: words, results: extra, sensitive: privateResult }, options)
      : kind === 'vital' ? addOwnVital(draft, { name: words, unit: extra }, options) : addOwnQuestion(draft, words, options))
    setName('')
    setExtra(kind === 'test' ? OWN_TEST_RESULTS : '')
    setPrivateResult(false)
    first.current?.focus()
  }
  const enter = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') { event.preventDefault(); add() } }
  return (
    <div id={base} className="flex flex-col gap-3 rounded-xl bg-subtle p-3 ring-1 ring-line">
      <div className="grid gap-3 @md:grid-cols-2">
        <PlanField id={`${base}-name`} label={nameLabel} error={problems.name} className={kind === 'question' ? '@md:col-span-2' : undefined}
          hint={kind === 'question' ? 'A yes or no question.' : undefined}>
          <Input ref={first} className={CONTROL} value={name} maxLength={kind === 'question' ? 200 : 80} autoComplete="off" onKeyDown={enter}
            onChange={event => setName(event.target.value)} {...fieldProps(`${base}-name`, problems.name, kind === 'question')} />
        </PlanField>
        {kind !== 'question' ? (
          <PlanField id={`${base}-extra`} label={kind === 'test' ? 'Results' : 'Unit'} error={problems.extra}
            hint={kind === 'test' ? 'Comma between. “Invalid” means test again.' : 'For example: cm, mg/dL'}>
            <Input className={CONTROL} value={extra} maxLength={kind === 'test' ? 120 : 20} autoComplete="off" onKeyDown={enter}
              onChange={event => setExtra(event.target.value)} {...fieldProps(`${base}-extra`, problems.extra, true)} />
          </PlanField>
        ) : null}
      </div>
      {kind === 'test' ? (
        <label htmlFor={`${base}-private`} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
          <input id={`${base}-private`} type="checkbox" checked={privateResult} onChange={event => setPrivateResult(event.target.checked)}
            className="size-5 shrink-0 cursor-pointer accent-[var(--color-brand-fill,currentColor)]" />
          <span>Private result <span className="text-ink-3">(only counsellors and clinicians see it)</span></span>
        </label>
      ) : null}
      <Button icon={Plus} variant="primary" className="self-start" onClick={add}>
        {kind === 'test' ? 'Add test' : kind === 'vital' ? 'Add measurement' : 'Add question'}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------- sites --

export function SitesEditor({ draft, onChange, errors }: EditorProps) {
  const sites = draft.sites.length ? draft.sites : [emptySite()]
  const set = (index: number, change: Partial<CampaignSite>) => onChange({ ...draft, sites: sites.map((site, at) => (at === index ? { ...site, ...change } : site)) })
  return (
    <div className="flex flex-col gap-4">
      {sites.map((site, index) => {
        const base = `plan-site-${index}`
        return (
          <fieldset key={site.id} className="m-0 flex min-w-0 flex-col gap-3 rounded-lg border-0 p-0 ring-0">
            <legend className="mb-2 flex w-full items-center justify-between gap-2 p-0 text-sm font-semibold text-ink">
              {sites.length > 1 ? `Site ${index + 1}` : 'Site'}
              {sites.length > 1 ? <Button variant="ghost" size="sm" icon={Trash2} onClick={() => onChange({ ...draft, sites: sites.filter((_, at) => at !== index) })}>Remove</Button> : null}
            </legend>
            <div className="grid gap-3 @md:grid-cols-2">
              <PlanField id={`${base}-name`} label="Place name" required error={errors?.[`${base}-name`]} hint="For example: Ajegunle Town Hall">
                <Input className={CONTROL} value={site.name} maxLength={120} autoComplete="off" onChange={event => set(index, { name: event.target.value })}
                  {...fieldProps(`${base}-name`, errors?.[`${base}-name`], true)} />
              </PlanField>
              <PlanField id={`${base}-community`} label="Community" optional>
                <Input className={CONTROL} id={`${base}-community`} value={site.community} maxLength={120} autoComplete="off" onChange={event => set(index, { community: event.target.value })} />
              </PlanField>
              <PlanField id={`${base}-lga`} label="Local government area" optional>
                <Input className={CONTROL} id={`${base}-lga`} value={site.lga} maxLength={120} autoComplete="off" onChange={event => set(index, { lga: event.target.value })} />
              </PlanField>
              <PlanField id={`${base}-address`} label="Address" optional>
                <Input className={CONTROL} id={`${base}-address`} value={site.address} maxLength={200} autoComplete="off" onChange={event => set(index, { address: event.target.value })} />
              </PlanField>
            </div>
            {index < sites.length - 1 ? <hr className="m-0 border-0 border-t border-line" /> : null}
          </fieldset>
        )
      })}
      <Button icon={Plus} className="self-start" onClick={() => onChange({ ...draft, sites: [...sites, emptySite()] })}>Add another site</Button>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------------- stations --

export function StationsEditor({ draft, onChange, consentEdited }: EditorProps) {
  const options = { consentEdited }
  const required = needsSeparateConsent(draft.package) ? ['register', 'counselling'] as StationKind[] : ['register'] as StationKind[]
  return (
    <div className="flex flex-col gap-4">
      <Segmented ariaLabel="How the stations work" value={draft.stationMode} className="self-start"
        onChange={mode => onChange(setStationMode(draft, mode, options))}
        options={[{ value: 'one_person', label: 'One person does everything' }, { value: 'split', label: 'Split into stations' }]} />
      {draft.stationMode === 'one_person'
        ? <p className="m-0 text-sm text-ink-2">Each team member registers a person, then takes their vital signs and tests, on one phone.</p>
        : <ChoiceChips name="stations" id="plan-stations" legend="Stations" values={draft.stations} disabledValues={required}
            hint={required.includes('counselling') ? 'Registration gives each person a visit code. The HIV test needs counselling.' : 'Registration gives each person a visit code the other stations use.'}
            options={STATIONS} onChange={stations => onChange({ ...draft, stations: STATIONS.map(item => item.value).filter(value => stations.includes(value) || required.includes(value)) })} />}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------------- partners --

export function PartnersEditor({ draft, onChange, errors }: EditorProps) {
  const set = (index: number, change: Partial<ReferralPartner>) => onChange({ ...draft, partners: draft.partners.map((partner, at) => (at === index ? { ...partner, ...change } : partner)) })
  const focuses = draft.focuses.map(focus => ({ value: focusIdOf(focus), label: focusLabel(focus) }))
  return (
    <div className="flex flex-col gap-4">
      {draft.partners.length === 0 ? <p className="m-0 text-sm text-ink-2">Clinics and hospitals that take the people you refer. You can add them later.</p> : null}
      {draft.partners.map((partner, index) => {
        const base = `plan-partner-${index}`
        return (
          <fieldset key={partner.id} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
            <legend className="mb-2 flex w-full items-center justify-between gap-2 p-0 text-sm font-semibold text-ink">
              {`Partner ${index + 1}`}
              <Button variant="ghost" size="sm" icon={Trash2} onClick={() => onChange({ ...draft, partners: draft.partners.filter((_, at) => at !== index) })}>Remove</Button>
            </legend>
            <div className="grid gap-3 @md:grid-cols-2">
              <PlanField id={`${base}-name`} label="Name" required error={errors?.[`${base}-name`]}>
                <Input className={CONTROL} value={partner.name} maxLength={120} autoComplete="off" onChange={event => set(index, { name: event.target.value })}
                  {...fieldProps(`${base}-name`, errors?.[`${base}-name`])} />
              </PlanField>
              <PlanField id={`${base}-phone`} label="Phone" optional>
                <Input className={CONTROL} id={`${base}-phone`} type="tel" inputMode="tel" value={partner.phone} maxLength={20} autoComplete="off" onChange={event => set(index, { phone: event.target.value })} />
              </PlanField>
              <PlanField id={`${base}-address`} label="Address" optional className="@md:col-span-2">
                <Input className={CONTROL} id={`${base}-address`} value={partner.address} maxLength={200} autoComplete="off" onChange={event => set(index, { address: event.target.value })} />
              </PlanField>
            </div>
            {focuses.length > 1 ? (
              <ChoiceChips name={`${base}-treats`} id={`${base}-treats`} legend="What they treat" options={focuses} values={partner.treats}
                onChange={treats => set(index, { treats: treats as FocusId[] })} />
            ) : null}
            {index < draft.partners.length - 1 ? <hr className="m-0 border-0 border-t border-line" /> : null}
          </fieldset>
        )
      })}
      <Button icon={Plus} className="self-start" onClick={() => onChange({ ...draft, partners: [...draft.partners, emptyPartner(draft.focuses)] })}>
        {draft.partners.length ? 'Add another partner' : 'Add a referral partner'}
      </Button>
    </div>
  )
}

// -------------------------------------------------------------------------------------------------------- consent --

export function ConsentEditor({ draft, onChange, onEdited }: EditorProps & { readonly onEdited: () => void }) {
  const hiv = needsSeparateConsent(draft.package)
  return (
    <div className="flex flex-col gap-4">
      <PlanField id="plan-consent-text" label="What each person agrees to" hint="Read to each person before they are registered. Written from what the campaign checks; change it if you need to.">
        <Textarea rows={6} maxLength={2000} value={draft.consent.text} className="text-base sm:text-sm"
          onChange={event => { onEdited(); onChange({ ...draft, consent: { ...draft.consent, text: event.target.value } }) }}
          {...fieldProps('plan-consent-text', undefined, true)} />
      </PlanField>
      {hiv ? (
        <PlanField id="plan-consent-hiv" label="HIV test consent" hint="Asked separately, just before the HIV test.">
          <Textarea rows={5} maxLength={2000} value={draft.consent.hivText ?? ''} className="text-base sm:text-sm"
            onChange={event => onChange({ ...draft, consent: { ...draft.consent, hivText: event.target.value } })}
            {...fieldProps('plan-consent-hiv', undefined, true)} />
        </PlanField>
      ) : null}
      <ChoiceChips<OutreachConsentLanguage> name="languages" id="plan-consent-languages" legend="Read it in" options={CONSENT_LANGUAGES} disabledValues={['en']}
        values={draft.consent.languages ?? ['en']} hint="English is always offered."
        onChange={languages => onChange({ ...draft, consent: { ...draft.consent, languages: ['en', ...languages.filter(value => value !== 'en')] } })} />
    </div>
  )
}

// ----------------------------------------------------------------------------------------------------------- kits --

/** A new kit lot for a site: test, lot number, expiry and count. */
export function KitForm({ draft, onAdd, idPrefix = 'plan-kit' }: { readonly draft: PlanDraft; readonly onAdd: (kit: KitStock) => void; readonly idPrefix?: string }) {
  const tests = draft.package.tests.filter(test => test.usesKit)
  const sites = draft.sites.filter(site => site.name.trim())
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '')
  const [testId, setTestId] = useState(tests[0]?.id ?? '')
  const [lot, setLot] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [count, setCount] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  if (!tests.length) return <p className="m-0 text-sm text-ink-2">None of this campaign’s tests use kits.</p>
  if (!sites.length) return <p className="m-0 text-sm text-ink-2">Add a site first.</p>
  const id = (name: string) => `${idPrefix}-${name}`
  const add = () => {
    const found: Record<string, string> = {}
    const number = Number(count)
    if (!lot.trim()) found.lot = 'Enter the lot number on the box.'
    if (!expiresOn) found.expires = 'Enter the expiry date on the box.'
    if (!Number.isInteger(number) || number < 1 || number > 100000) found.count = 'Enter how many tests, like 200.'
    setErrors(found)
    if (Object.keys(found).length) { document.getElementById(id(found.lot ? 'lot' : found.expires ? 'expires' : 'count'))?.focus(); return }
    onAdd({ id: localId('kit'), siteId: siteId || sites[0]!.id, testId: testId || tests[0]!.id, lot: lot.trim(), expiresOn, count: number })
    setLot(''); setExpiresOn(''); setCount('')
    document.getElementById(id('lot'))?.focus()
  }
  return (
    <div className="grid gap-3 @md:grid-cols-2" onKeyDown={event => {
      if (event.key !== 'Enter') return
      // Enter in the last field adds the kits; elsewhere it moves on. Either way the form around it does nothing more.
      if ((event.target as HTMLElement).id === id('count')) { event.preventDefault(); add() }
      else enterMovesOn(event)
      event.stopPropagation()
    }}>
      {sites.length > 1 ? (
        <PlanField id={id('site')} label="Site">
          <Select id={id('site')} className="[&_select]:h-12 sm:[&_select]:h-11" value={siteId} onChange={event => setSiteId(event.target.value)}>
            {sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
          </Select>
        </PlanField>
      ) : null}
      {tests.length > 1 ? (
        <PlanField id={id('test')} label="Test">
          <Select id={id('test')} className="[&_select]:h-12 sm:[&_select]:h-11" value={testId} onChange={event => setTestId(event.target.value)}>
            {tests.map(test => <option key={test.id} value={test.id}>{test.name}</option>)}
          </Select>
        </PlanField>
      ) : null}
      <PlanField id={id('lot')} label={tests.length === 1 ? `${tests[0]!.name}: lot number` : 'Lot number'} error={errors.lot}>
        <Input className={CONTROL} value={lot} maxLength={40} autoComplete="off" autoCapitalize="characters" onChange={event => setLot(event.target.value)} {...fieldProps(id('lot'), errors.lot)} />
      </PlanField>
      <PlanField id={id('expires')} label="Expiry date" error={errors.expires}>
        <Input className={CONTROL} type="date" value={expiresOn} onChange={event => setExpiresOn(event.target.value)} {...fieldProps(id('expires'), errors.expires)} />
      </PlanField>
      <PlanField id={id('count')} label="Number of tests" error={errors.count}>
        <Input className={CONTROL} inputMode="numeric" pattern="[0-9]*" value={count} maxLength={6} autoComplete="off"
          onChange={event => setCount(event.target.value.replace(/\D/g, ''))} {...fieldProps(id('count'), errors.count)} />
      </PlanField>
      <div className="flex items-end"><Button icon={Plus} block onClick={add}>Add kits</Button></div>
    </div>
  )
}

/** The kit lots, by site: test, lot, expiry, and (once used) how many are left. */
export function KitList({ draft, onRemove }: { readonly draft: PlanDraft; readonly onRemove?: (kit: KitStock) => void }) {
  if (!draft.kits.length) return <p className="m-0 text-sm text-ink-2">No kits yet.</p>
  const testName = (testId: string) => draft.package.tests.find(test => test.id === testId)?.name ?? 'Test'
  return (
    <div className="flex flex-col gap-4">
      {draft.sites.filter(site => draft.kits.some(kit => kit.siteId === site.id)).map(site => (
        <section key={site.id} aria-label={`Kits at ${site.name}`}>
          {draft.sites.length > 1 ? <h4 className="m-0 mb-1 text-[13px] font-semibold text-ink-2">{site.name}</h4> : null}
          <ul className="m-0 list-none divide-y divide-line p-0">
            {draft.kits.filter(kit => kit.siteId === site.id).map(kit => {
              const left = kitLeft(kit)
              const expired = kit.expiresOn < new Date().toISOString().slice(0, 10)
              return (
                <li key={kit.id} className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">{testName(kit.testId)} · lot {kit.lot}</span>
                    <span className="block text-[13px] text-ink-3">Expires {dayText(kit.expiresOn)}{kit.used !== undefined ? ` · ${kit.used} used of ${kit.count}` : ` · ${kit.count} tests`}</span>
                  </span>
                  {expired ? <Badge size="sm" tone="danger">Expired</Badge>
                    : kit.used !== undefined ? <Badge size="sm" tone={left < Math.max(10, kit.count * 0.1) ? 'warn' : 'neutral'}>{left} left</Badge> : null}
                  {onRemove && !kit.used ? <Button variant="ghost" size="sm" icon={Trash2} aria-label={`Remove lot ${kit.lot}`} onClick={() => onRemove(kit)} /> : null}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function KitsEditor({ draft, onChange }: EditorProps) {
  return (
    <div className="flex flex-col gap-5">
      <KitList draft={draft} onRemove={kit => onChange({ ...draft, kits: draft.kits.filter(item => item.id !== kit.id) })} />
      <KitForm draft={draft} onAdd={kit => onChange({ ...draft, kits: [...draft.kits, kit] })} />
    </div>
  )
}
