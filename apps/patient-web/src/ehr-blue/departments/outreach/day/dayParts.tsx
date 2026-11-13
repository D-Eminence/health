import { useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { CircleCheck, CloudOff, RefreshCw, TriangleAlert } from 'lucide-react'
import { Flag, PatientBanner, type FlagLevel } from '../../../../kasuwa/parts'
import { Button, cx } from '../../../../kasuwa/ui'
import type { VitalFlag } from '../screeningTemplates'
import { personOf, useCampaignDay, type DayVisit } from './dayContext'

/*
 * Small parts the field-day screens share: big tap targets, the sync line, the person's banner, the visit code as it is
 * read aloud, and the printed slip. Field-day buttons are 48 to 56px tall: gloves, sun, a crowd.
 */

/** A choice of one as big tap targets (role radiogroup): one Tab stop, the arrow keys move the choice. */
export function BigChoice<T extends string>({ label, value, onChange, options, columns = 2, size = 'lg', id, describedBy, invalid }: {
  readonly label: string
  readonly value: T | null
  readonly onChange: (value: T) => void
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: ReactNode; readonly hint?: ReactNode }>
  /** 'wide': one column on a phone, two from a wider container. */
  readonly columns?: 1 | 2 | 3 | 'wide'
  /** 'lg' 56px, 'md' 48px. */
  readonly size?: 'md' | 'lg'
  /** The first option's id, so a refused choice can take focus. */
  readonly id?: string
  readonly describedBy?: string
  readonly invalid?: boolean
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const chosen = options.findIndex(option => option.value === value)
  const stop = chosen >= 0 ? chosen : 0
  const move = (at: number, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = (at + step + options.length) % options.length
    onChange(options[next]!.value)
    buttons.current[next]?.focus()
  }
  return (
    <div role="radiogroup" aria-label={label} aria-describedby={describedBy} aria-invalid={invalid || undefined}
      className={cx('grid gap-2', columns === 2 && 'grid-cols-2', columns === 3 && 'grid-cols-2 @md:grid-cols-3', columns === 'wide' && '@md:grid-cols-2')}>
      {options.map((option, index) => {
        const on = value === option.value
        return (
          <button key={option.value} ref={element => { buttons.current[index] = element }} type="button" role="radio" aria-checked={on}
            id={index === 0 ? id : undefined} tabIndex={index === stop ? 0 : -1} onClick={() => onChange(option.value)} onKeyDown={event => move(index, event)}
            className={cx('flex w-full cursor-pointer flex-col items-start justify-center gap-0.5 rounded-xl border-0 px-4 text-left ring-1 ring-inset transition-colors',
              size === 'lg' ? 'min-h-14 py-2.5 text-[16px]' : 'min-h-12 py-2 text-[15px]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]',
              on ? 'bg-brand-soft font-semibold text-brand-ink ring-2 ring-brand' : 'bg-surface font-medium text-ink ring-line-strong hover:bg-subtle',
              invalid && !on && 'ring-danger')}>
            <span className="flex items-center gap-2">{on ? <CircleCheck className="size-4 shrink-0" aria-hidden /> : null}{option.label}</span>
            {option.hint ? <span className="text-[13px] font-normal text-ink-2">{option.hint}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

/** A yes/no question as two big toggles. */
export function YesNo({ question, value, onChange, id }: {
  readonly question: string
  readonly value: 'yes' | 'no' | null
  readonly onChange: (value: 'yes' | 'no') => void
  readonly id?: string
}) {
  return (
    <div className="flex flex-col gap-2 @md:flex-row @md:items-center @md:justify-between @md:gap-4">
      <p className="m-0 text-[15px] text-ink @md:flex-1" id={id ? `${id}-text` : undefined}>{question}</p>
      <div className="@md:w-56"><BigChoice label={question} value={value} onChange={onChange} size="md" id={id}
        options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} /></div>
    </div>
  )
}

/** Where the device's waiting work stands: "All sent", or how many wait, with Send now. */
export function SyncStatus({ className }: { readonly className?: string }) {
  const { waiting, refused, online, queue, accountId } = useCampaignDay()
  if (!accountId) return null
  const busy = queue.syncing
  return (
    <div role="status" className={cx('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-subtle px-4 py-3 text-[14px] text-ink', className)}>
      {waiting === 0 && refused === 0 ? (
        <span className="inline-flex items-center gap-2"><CircleCheck className="size-4 text-success-ink" aria-hidden />All sent</span>
      ) : (
        <>
          {waiting > 0 ? (
            <span className="inline-flex items-center gap-2 font-medium">
              {online ? <RefreshCw className={cx('size-4 text-warn-ink', busy && 'animate-spin')} aria-hidden /> : <CloudOff className="size-4 text-warn-ink" aria-hidden />}
              {waiting} waiting to send{online ? '' : ' · no connection'}
            </span>
          ) : null}
          {refused > 0 ? (
            <span className="inline-flex items-center gap-2 text-danger-ink"><TriangleAlert className="size-4" aria-hidden />{refused} not accepted: check {refused === 1 ? 'it' : 'them'} in Outreach</span>
          ) : null}
          {waiting > 0 ? (
            <Button size="sm" className="ml-auto" aria-disabled={busy || undefined} onClick={() => { if (!busy) void queue.sync() }}>{busy ? 'Sending…' : 'Send now'}</Button>
          ) : null}
        </>
      )}
      {!queue.durable ? <span className="basis-full text-[13px] text-ink-2">This browser keeps waiting work only while this page is open.</span> : null}
    </div>
  )
}

export function sexWords(sex: string | null | undefined): string {
  if (sex === 'female') return 'Female'
  if (sex === 'male') return 'Male'
  if (sex === 'other') return 'Other'
  return 'Sex not known'
}

export function ageWords(ageYears: number | null | undefined): string {
  return ageYears == null ? 'Age not known' : `${ageYears} years`
}

/** The person on every station screen: name, age, sex, visit code (PatientBanner). */
export function PersonBanner({ visit, sticky = false }: { readonly visit: DayVisit; readonly sticky?: boolean }) {
  const person = personOf(visit)
  const code = person.visitCode ? `Visit ${person.visitCode}` : 'Code arrives when sent'
  return <PatientBanner name={person.fullName} hid={`${code} · ${ageWords(person.ageYears)}`} sex={sexWords(person.sex)} sticky={sticky}
    status={visit.kind === 'queued' ? { label: 'Saved on this phone', tone: 'warn' } : null} />
}

/** A reading's flag in words with an icon (never colour alone). */
export function VitalFlagText({ flag }: { readonly flag: VitalFlag }) {
  if (flag.level === 'normal' && flag.label === 'Normal') {
    return <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-1.5 py-0.5 text-[11px] font-semibold text-success-ink"><CircleCheck className="size-3" aria-hidden />Normal</span>
  }
  const level: FlagLevel = flag.level === 'refer_urgent' ? 'critical' : flag.label.endsWith('ow') ? 'low' : flag.label.endsWith('igh') ? 'high' : 'abnormal'
  return <Flag level={level} text={flag.level === 'refer_urgent' ? `${flag.label}: needs to be seen today` : flag.label} />
}

/** The visit code as it is read aloud: huge, spaced, with the dash. */
export function VisitCodeText({ code, id }: { readonly code: string; readonly id?: string }) {
  return <p id={id} className="m-0 font-mono text-[56px] leading-none font-bold tracking-[.12em] text-ink tabular @md:text-[72px]" aria-label={`Visit code ${code.split('').join(' ')}`}>{code}</p>
}

const SLIP_CLASS = 'hid-outreach-slip'
/** Printed: only the slip. On screen: nothing. */
const PRINT_CSS = `.${SLIP_CLASS}{display:none}
@media print{body *{visibility:hidden!important}.${SLIP_CLASS},.${SLIP_CLASS} *{visibility:visible!important}
.${SLIP_CLASS}{display:block!important;position:fixed;left:0;top:0;width:80mm;padding:4mm;color:#000;background:#fff;font:12pt/1.35 system-ui,sans-serif}
.${SLIP_CLASS} h2{font-size:14pt;margin:0 0 2mm}.${SLIP_CLASS} .code{font:700 30pt/1.1 ui-monospace,monospace;letter-spacing:.12em;margin:2mm 0}
.${SLIP_CLASS} p{margin:0 0 1.5mm}@page{margin:6mm}}`

/** What the printed slip says: name, visit code, Health ID, how to sign in later, date and campaign. */
export function PrintSlip({ fullName, visitCode, healthId, campaignName, results }: {
  readonly fullName: string
  readonly visitCode: string | null
  readonly healthId: string | null
  readonly campaignName: string
  /** The result in words, at the end of the visit; never a sensitive result. */
  readonly results?: readonly string[]
}) {
  const today = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())
  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className={SLIP_CLASS} aria-hidden="true">
        <h2>{campaignName}</h2>
        <p>{fullName}</p>
        {visitCode ? <><p>Visit code</p><p className="code">{visitCode}</p></> : null}
        {healthId ? <p>Health ID: <strong>{healthId}</strong></p> : null}
        {results?.map(line => <p key={line}>{line}</p>)}
        <p>Show this slip at each station today.</p>
        <p>To see your results later, open Health ID and sign in with the phone number you gave today, or your Health ID.</p>
        <p>{today}</p>
      </div>
    </>
  )
}

/** Today plus `days`, as YYYY-MM-DD in the device's time. */
export function dayFromToday(days: number, now = new Date()): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Whole years from a date of birth (YYYY-MM-DD) to today; null when it can't be one. */
export function ageFromBirthDate(birthDate: string, now = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const born = new Date(year, month - 1, day)
  if (born.getMonth() !== month - 1 || born > now) return null
  let age = now.getFullYear() - year
  if (now < new Date(now.getFullYear(), month - 1, day)) age -= 1
  return age >= 0 && age <= 130 ? age : null
}

/** Big field classes: 48px tall, 16px text (no zoom on iOS). */
export const BIG_INPUT = '!h-12 !text-[16px]'

/** A field's label, hint and error (Kasuwa Field), with ids its control is described by (dayControl). */
export function DayField({ id, label, hint, error, optional, children, className }: {
  readonly id: string
  readonly label: ReactNode
  readonly hint?: ReactNode
  readonly error?: string
  readonly optional?: boolean
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[14px] font-medium text-ink">{label}{optional ? <span className="font-normal text-ink-3"> (optional)</span> : null}</label>
      {children}
      {error ? <p id={`${id}-error`} className="m-0 text-[13px] font-medium text-danger-ink">{error}</p>
        : hint ? <p id={`${id}-hint`} className="m-0 text-[13px] text-ink-2">{hint}</p> : null}
    </div>
  )
}

/** A DayField control's id and description: its error while refused, else its hint. */
export function dayControl(id: string, error: string | undefined, hint: boolean) {
  return { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined }
}

/**
 * A card that holds a form. Not Kasuwa's Card: its overflow clip would make it the sticky Save bar's scroll box, and the
 * bar would then cover the form's last field on a phone.
 */
export function Panel({ children, className, as: Tag = 'div', ...rest }: {
  readonly children: ReactNode
  readonly className?: string
  readonly as?: 'div' | 'section'
  readonly id?: string
  readonly 'aria-labelledby'?: string
}) {
  return <Tag {...rest} className={cx('rounded-xl bg-surface shadow-[var(--shadow-card)] ring-1 ring-line', className)}>{children}</Tag>
}
