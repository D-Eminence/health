import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { CircleCheck, Clock3 } from 'lucide-react'
import type { ActivityDays, OperationsErrors, OperationsHealth, PlatformActivity } from './api'
import { label } from './ui'
import { Avatar, Badge, Card, StatCard, StatGroup, TONE_DOT, cx, timeAgo, type Tone } from '../kasuwa/ui'

/**
 * The overview's activity sections (owner's design, 2 Nov 2026), in the owner's order: People, Care activity,
 * Migrate and Ask, System health with Errors, Product analytics, Recent sign-ups, Recent uploads. Every figure comes
 * from the backend as it is; names, emails and Health IDs arrive already shortened and are shown as they arrive.
 */

const number = (value: number) => new Intl.NumberFormat('en-NG').format(value)
const percent = (value: number) => `${new Intl.NumberFormat('en-NG', { maximumFractionDigits: 1 }).format(value)}%`
/** Availability keeps two decimals and never rounds up: 99.996% is not 100%. */
const availability = (value: number) => `${new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2, roundingMode: 'trunc' }).format(value)}%`
/** A share of all accounts, or nothing when there are none to divide by. */
const shareOf = (part: number, whole: number) => whole > 0 ? `${percent(Math.round(part / whole * 1000) / 10)} of accounts` : undefined

export const PERIODS: ReadonlyArray<{ value: ActivityDays; label: string }> = [
  { value: 7, label: '7 days' }, { value: 30, label: '30 days' }, { value: 90, label: '90 days' },
]

/**
 * The 7, 30 or 90 days switch: a radio group, so it is one Tab stop and the arrow keys (and Home and End) move the
 * choice, as WAI-ARIA describes for radio groups.
 */
export function PeriodSwitch({ value, onChange }: { value: ActivityDays; onChange: (days: ActivityDays) => void }) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const choose = (index: number) => {
    const next = PERIODS[(index + PERIODS.length) % PERIODS.length]!
    onChange(next.value)
    buttons.current[PERIODS.indexOf(next)]?.focus()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: PERIODS.length - 1 }
    const to = moves[event.key]
    if (to === undefined) return
    event.preventDefault()
    choose(to)
  }
  return <div role="radiogroup" aria-label="Show activity for the last" className="inline-flex max-w-full items-center gap-0.5 rounded-lg bg-tray p-1">
    {PERIODS.map((period, index) => {
      const checked = period.value === value
      return <button key={period.value} ref={element => { buttons.current[index] = element }} type="button" role="radio" aria-checked={checked}
        tabIndex={checked ? 0 : -1} onClick={() => onChange(period.value)} onKeyDown={event => onKeyDown(event, index)}
        className={cx('inline-flex h-10 cursor-pointer items-center justify-center rounded-md border-0 px-3 text-[13px] font-medium whitespace-nowrap sm:h-8',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]',
          checked ? 'bg-surface text-ink shadow-[var(--shadow-xs)] ring-1 ring-line' : 'bg-transparent text-ink-3 hover:text-ink')}>{period.label}</button>
    })}
  </div>
}

/** A section with a visible heading and a one-line description, labelled by its heading. */
function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return <section aria-labelledby={id} className="flex flex-col gap-3">
    <div>
      <h2 id={id} className="m-0 text-title-3 text-ink">{title}</h2>
      <p className="m-0 mt-0.5 text-sm text-ink-3">{description}</p>
    </div>
    {children}
  </section>
}

/** A figure the backend cannot measure yet reads as such, never as zero. */
function measured(value: number | null, format: (value: number) => string = number) {
  return value === null ? 'Not yet' : format(value)
}
const NOT_MEASURED = 'Not measured yet'

/** "+21% on the previous 30 days", in green when more, red when fewer. */
function change(now: number, before: number, days: number): ReactNode {
  if (before === 0) return now > 0 ? `none in the ${days} days before` : null
  const pct = Math.round((now - before) / before * 100)
  if (pct === 0) return `same as the ${days} days before`
  return <><span className={pct > 0 ? 'font-medium text-success-ink' : 'font-medium text-danger-ink'}>{pct > 0 ? '+' : '−'}{Math.abs(pct)}%</span> on the {days} days before</>
}

export function PeopleSection({ activity }: { activity: PlatformActivity }) {
  const p = activity.people
  const days = activity.days
  const trend = change(p.newInPeriod, p.prevNewInPeriod, days)
  return <Section id="admin-people-title" title="People" description={`Accounts across the pilot, last ${days} days.`}>
    <StatGroup cols={2} label="People">
      <StatCard label="Total accounts" value={number(p.accounts)} hint={<>{number(p.newInPeriod)} new{trend ? <> · {trend}</> : null}</>} />
      <StatCard label="Identity verified" value={measured(p.verifiedPct, percent)} hint={p.verifiedPct === null ? NOT_MEASURED : 'Identity checked'} />
      <StatCard label="Profiles complete" value={measured(p.profilesCompletePct, percent)} hint={p.profilesCompletePct === null ? NOT_MEASURED : 'Every detail filled in'} />
      <StatCard label={`Active in the last ${days} days`} value={number(p.activeInPeriod)} hint={shareOf(p.activeInPeriod, p.accounts)} />
      <StatCard label="Shared with a facility" value={number(p.sharedWithFacility)} hint={shareOf(p.sharedWithFacility, p.accounts)} />
      <StatCard label="Access PINs set" value={number(p.accessPins)} hint={shareOf(p.accessPins, p.accounts)} />
    </StatGroup>
    {activity.daily.length > 0 && <div className="grid gap-3 md:grid-cols-2">
      <DailyBars id="admin-daily-signups" title="New sign-ups each day" points={activity.daily.map(day => ({ date: day.date, value: day.signups }))} />
      <DailyBars id="admin-daily-active" title="Active accounts each day" points={activity.daily.map(day => ({ date: day.date, value: day.activeAccounts }))} />
    </div>}
  </Section>
}

const shortDate = (iso: string) => {
  const parsed = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? iso : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(parsed)
}

/** A plain bar per day. The bars are a picture; the same numbers are in a table for screen readers. */
function DailyBars({ id, title, points }: { id: string; title: string; points: ReadonlyArray<{ date: string; value: number }> }) {
  const peak = Math.max(0, ...points.map(point => point.value))
  const total = points.reduce((sum, point) => sum + point.value, 0)
  const ticks = points.length > 1 ? [points[0]!, points[Math.floor((points.length - 1) / 2)]!, points[points.length - 1]!] : points
  return <Card aria-labelledby={id} className="p-5">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 id={id} className="m-0 text-sm font-semibold text-ink">{title}</h3>
      <span className="text-xs text-ink-3 tabular">Highest {number(peak)} · total {number(total)}</span>
    </div>
    <div aria-hidden="true" className="mt-4 flex h-28 items-end gap-px">
      {points.map(point => <span key={point.date} title={`${shortDate(point.date)}: ${number(point.value)}`}
        className="min-w-0 flex-1 rounded-t-sm bg-brand-fill"
        style={{ height: peak > 0 ? `${Math.max(2, point.value / peak * 100)}%` : '2px', opacity: point.value === peak && peak > 0 ? 1 : 0.55 }} />)}
    </div>
    <div aria-hidden="true" className="mt-2 flex justify-between text-[11px] text-ink-3">{ticks.map(point => <span key={point.date}>{shortDate(point.date)}</span>)}</div>
    <table className="sr-only">
      <caption>{title}</caption>
      <thead><tr><th scope="col">Day</th><th scope="col">Count</th></tr></thead>
      <tbody>{points.map(point => <tr key={point.date}><td>{shortDate(point.date)}</td><td>{number(point.value)}</td></tr>)}</tbody>
    </table>
  </Card>
}

export function CareSection({ activity }: { activity: PlatformActivity }) {
  const c = activity.care
  return <Section id="admin-care-title" title="Care activity" description={`Work recorded at pilot facilities, last ${activity.days} days.`}>
    <StatGroup cols={2} label="Care activity">
      <StatCard label="Health records" value={number(c.healthRecords)} hint="Notes, vitals, diagnoses" />
      <StatCard label="Visits recorded" value={number(c.visits)} hint="Patients seen" />
      <StatCard label="Lab requests" value={number(c.labRequests)} hint="Tests asked for" />
      <StatCard label="Prescriptions" value={number(c.prescriptions)} hint="Medicines prescribed" />
      <StatCard label="Emergency access" value={number(c.emergencyAccess)} hint="Records opened in an emergency" />
      <StatCard label="Outreach sign-ups" value={number(c.outreachSignups)} hint="Registered in the field" />
    </StatGroup>
  </Section>
}

export function MigrateAskSection({ activity }: { activity: PlatformActivity }) {
  const m = activity.migrateAsk
  return <Section id="admin-migrate-title" title="Migrate and Ask about this patient"
    description={`Records moved from paper and Health ID 1.0, and answers given to clinicians, last ${activity.days} days.`}>
    <StatGroup cols={2} label="Migrate and Ask about this patient">
      <StatCard label="Pages read" value={number(m.pagesRead)} hint="From scanned paper records" />
      <StatCard label="Records moved" value={number(m.recordsMoved)} hint="Checked by staff before saving" />
      <StatCard label="Questions answered" value={measured(m.questionsAnswered)} hint={m.questionsAnswered === null ? NOT_MEASURED : 'Ask about this patient'} />
      <StatCard label="Answers with sources" value={measured(m.answersWithSourcesPct, percent)}
        hint={m.answersWithSourcesPct === null ? NOT_MEASURED : 'Linked to the record they came from'} />
    </StatGroup>
  </Section>
}

/** A part of the overview that has nothing to read yet: calm, never an error. */
export function NotSetUp({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <Card aria-labelledby={id} className="flex items-start gap-3 p-5">
    <Clock3 className="mt-0.5 size-5 shrink-0 text-ink-3" aria-hidden />
    <div className="min-w-0">
      <h3 id={id} className="m-0 text-sm font-semibold text-ink">{title}: Not set up yet</h3>
      <p className="m-0 mt-1 text-sm text-ink-2">{children}</p>
    </div>
  </Card>
}

/** A part whose read failed: plain words, and what to do. */
function CouldNotCheck({ id, title, what }: { id: string; title: string; what: string }) {
  return <Card aria-labelledby={id} className="p-5">
    <h3 id={id} className="m-0 text-sm font-semibold text-ink">{title}</h3>
    <p className="m-0 mt-1 text-sm text-ink-2" role="status">Couldn’t check {what} just now. Select Refresh in a minute.</p>
  </Card>
}

/** Service names in the words people use for them; an unknown service keeps a readable form of its name. */
const SERVICE_NAMES: Record<string, string> = {
  'identity-api': 'Sign-in and Health ID lookups', 'ehr-api': 'EHR, Laboratory and Pharmacy', 'gateway': 'Website connection',
  'notification-api': 'Messages (email and SMS)', 'notifications-api': 'Messages (email and SMS)', 'document-api': 'Document storage',
  'documents-api': 'Document storage', 'ocr-api': 'Document scanning and Migrate', 'migrate-api': 'Document scanning and Migrate',
}
export const serviceName = (name: string) => SERVICE_NAMES[name] ?? label(name.replace(/-api$/, ''))

export type Optional<T> = { state: 'ready'; value: T } | { state: 'not-set-up' } | { state: 'failed' } | { state: 'loading' }

function HealthCard({ health }: { health: Optional<OperationsHealth> }) {
  const id = 'admin-services-title'
  if (health.state === 'not-set-up') return <NotSetUp id={id} title="Service checks">Availability and response times will show here once service monitoring is switched on.</NotSetUp>
  if (health.state === 'failed') return <CouldNotCheck id={id} title="Service checks" what="the services" />
  if (health.state === 'loading') return <Card aria-labelledby={id} aria-busy="true" className="p-5"><h3 id={id} className="m-0 text-sm font-semibold text-ink">Service checks</h3><p className="m-0 mt-1 text-sm text-ink-3">Loading…</p></Card>
  const h = health.value
  const rows: Array<{ key: string; name: string; value: string; tone: Tone }> = h.services.map(service => ({
    key: service.name, name: serviceName(service.name),
    value: service.availabilityPct === null ? NOT_MEASURED : `${availability(service.availabilityPct)} available`,
    tone: service.availabilityPct === null ? 'neutral' : service.availabilityPct >= 99.5 ? 'success' : service.availabilityPct >= 98 ? 'warn' : 'danger',
  }))
  if (h.messagesDelivered !== null) rows.push({ key: 'messages', name: 'Messages (email and SMS)', value: `${percent(h.messagesDelivered)} delivered`, tone: h.messagesDelivered >= 99 ? 'success' : 'warn' })
  if (h.documentsScanned !== null) rows.push({ key: 'scanned', name: 'Documents scanned', value: number(h.documentsScanned), tone: 'success' })
  const timed = h.services.filter(service => service.p50Ms !== null)
  if (timed.length) {
    const median = Math.max(...timed.map(service => service.p50Ms!))
    const slow = timed.filter(service => service.p95Ms !== null).map(service => service.p95Ms!)
    rows.push({ key: 'response', name: 'Response time', tone: 'success',
      value: `${number(median)} ms usually${slow.length ? ` · ${number(Math.max(...slow))} ms at the slowest` : ''}` })
  }
  return <Card aria-labelledby={id} className="p-5">
    <h3 id={id} className="m-0 text-sm font-semibold text-ink">Service checks</h3>
    {rows.length === 0 ? <p className="m-0 mt-2 text-sm text-ink-3">No services reported yet.</p>
      : <ul className="m-0 mt-2 list-none divide-y divide-line p-0">{rows.map(row => <li key={row.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
        <span className="flex items-center gap-2 text-ink"><Dot tone={row.tone} />{row.name}</span>
        <span className="text-ink-2 tabular">{row.value}</span>
      </li>)}</ul>}
  </Card>
}

const Dot = ({ tone }: { tone: Tone }) => <span aria-hidden="true" className={cx('size-2 shrink-0 rounded-full', TONE_DOT[tone])} />

function ErrorsCard({ errors }: { errors: Optional<OperationsErrors> }) {
  const id = 'admin-errors-title'
  if (errors.state === 'not-set-up') return <NotSetUp id={id} title="Errors">Problems people meet in the apps will show here once error reporting is connected.</NotSetUp>
  if (errors.state === 'failed') return <CouldNotCheck id={id} title="Errors" what="for errors" />
  if (errors.state === 'loading') return <Card aria-labelledby={id} aria-busy="true" className="p-5"><h3 id={id} className="m-0 text-sm font-semibold text-ink">Errors</h3><p className="m-0 mt-1 text-sm text-ink-3">Loading…</p></Card>
  const e = errors.value
  return <Card aria-labelledby={id} className="p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 id={id} className="m-0 text-sm font-semibold text-ink">Errors</h3>
      {e.unresolvedIssues === 0 ? <Badge size="sm" solid tone="success">No open problems</Badge> : <Badge size="sm" solid tone="warn">{number(e.unresolvedIssues)} open</Badge>}
    </div>
    <dl className="m-0 mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,7.5rem),1fr))] gap-2">
      <Mini term="Open problems" value={number(e.unresolvedIssues)} />
      <Mini term="Visits with no errors" value={measured(e.errorFreeSessionsPct, percent)} />
      <Mini term="People with no crashes" value={measured(e.crashFreeUsersPct, percent)} />
    </dl>
    {e.top.length > 0 && <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="pb-2 text-left text-xs font-medium text-ink-3">Most frequent problems</caption>
        <thead><tr className="text-xs text-ink-3"><th scope="col" className="py-1.5 pr-3 font-medium">Problem</th><th scope="col" className="py-1.5 pr-3 font-medium">Where</th>
          <th scope="col" className="py-1.5 pr-3 text-right font-medium">Times</th><th scope="col" className="py-1.5 font-medium">Last seen</th></tr></thead>
        <tbody className="divide-y divide-line">{e.top.map(issue => <tr key={`${issue.service}-${issue.title}`}>
          <td className="py-2 pr-3 break-words text-ink">{issue.title}</td><td className="py-2 pr-3 text-ink-2">{serviceName(issue.service)}</td>
          <td className="py-2 pr-3 text-right text-ink-2 tabular">{number(issue.count)}</td><td className="py-2 whitespace-nowrap text-ink-2">{timeAgo(issue.lastSeen) || 'Not known'}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </Card>
}

function Mini({ term, value }: { term: string; value: string }) {
  return <div className="flex flex-col-reverse rounded-lg p-3 ring-1 ring-line">
    <dt className="mt-1 text-xs text-ink-2">{term}</dt>
    <dd className="m-0 text-xl font-semibold text-ink tabular">{value}</dd>
  </div>
}

export function SystemHealthSection({ health, errors }: { health: Optional<OperationsHealth>; errors: Optional<OperationsErrors> }) {
  return <Section id="admin-health-title" title="System health" description="Live service checks and errors.">
    <div className="grid gap-3 lg:grid-cols-2"><HealthCard health={health} /><ErrorsCard errors={errors} /></div>
  </Section>
}

export function ProductAnalyticsSection() {
  return <Section id="admin-analytics-title" title="Product analytics" description="How people use the pilot products.">
    <NotSetUp id="admin-analytics-card" title="Product analytics">Page views, sessions and the sign-up journey will show here once usage tracking is switched on.</NotSetUp>
  </Section>
}

const SIGNUP_STATUS: Record<string, { text: string; tone: Tone }> = {
  verified: { text: 'Verified', tone: 'success' }, pending: { text: 'Not verified yet', tone: 'warn' }, suspended: { text: 'Suspended', tone: 'danger' },
}
const SCAN: Record<string, { text: string; tone: Tone }> = {
  clean: { text: 'Scanned clean', tone: 'success' }, pending: { text: 'Being checked', tone: 'info' }, refused: { text: 'Blocked as unsafe', tone: 'danger' },
}
const known = (table: Record<string, { text: string; tone: Tone }>, value: string) => table[value] ?? { text: label(value), tone: 'neutral' as Tone }

const TH = 'px-4 py-2.5 text-xs font-medium whitespace-nowrap text-ink-3'
const TD = 'px-4 py-3 text-sm text-ink-2'

function Table({ caption, head, children, empty }: { caption: string; head: string[]; children: ReactNode[]; empty: string }) {
  if (children.length === 0) return <Card className="p-5"><p className="m-0 text-sm text-ink-3">{empty}</p></Card>
  return <Card className="overflow-x-auto">
    <table className="w-full min-w-[40rem] border-collapse text-left">
      <caption className="sr-only">{caption}</caption>
      <thead className="bg-tray"><tr>{head.map(name => <th key={name} scope="col" className={TH}>{name}</th>)}</tr></thead>
      <tbody className="divide-y divide-line">{children}</tbody>
    </table>
  </Card>
}

export function RecentSignupsSection({ activity }: { activity: PlatformActivity }) {
  return <Section id="admin-signups-title" title="Recent sign-ups" description="Names, emails and Health IDs are shortened here to protect people’s privacy.">
    <Table caption="Recent sign-ups, newest first" head={['Name', 'Email', 'Health ID', 'Joined', 'Profile', 'Status']} empty="No one has signed up yet.">
      {activity.recentSignups.map((person, index) => {
        const status = known(SIGNUP_STATUS, person.status)
        return <tr key={`${person.healthId}-${index}`}>
          <th scope="row" className="px-4 py-3 text-left text-sm font-medium whitespace-nowrap text-ink"><span className="flex items-center gap-2.5"><Avatar size="sm" name={person.name} />{person.name}</span></th>
          <td className={TD}>{person.email}</td>
          <td className={cx(TD, 'whitespace-nowrap')}>{person.healthId}</td>
          <td className={cx(TD, 'whitespace-nowrap')}>{timeAgo(person.createdAt)}</td>
          <td className={cx(TD, 'tabular')}>{percent(person.profilePct)}</td>
          <td className={TD}><Badge size="sm" solid tone={status.tone}>{status.text}</Badge></td>
        </tr>
      })}
    </Table>
  </Section>
}

/** "lab-result.pdf" reads as "Lab result" and "PDF". */
export function documentName(file: string): { name: string; kind: string | null } {
  const dot = file.lastIndexOf('.')
  const base = dot > 0 ? file.slice(0, dot) : file
  const extension = dot > 0 ? file.slice(dot + 1).toLowerCase() : ''
  const kinds: Record<string, string> = { pdf: 'PDF', jpg: 'Image', jpeg: 'Image', png: 'Image', heic: 'Image', webp: 'Image', tif: 'Image', tiff: 'Image' }
  const words = base.replace(/[_-]+/g, ' ').trim()
  return { name: words ? words.charAt(0).toUpperCase() + words.slice(1) : file, kind: kinds[extension] ?? (extension ? extension.toUpperCase() : null) }
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${number(bytes)} bytes`
  if (bytes < 1024 * 1024) return `${number(Math.round(bytes / 1024))} KB`
  return `${new Intl.NumberFormat('en-NG', { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`
}

export function RecentUploadsSection({ activity }: { activity: PlatformActivity }) {
  return <Section id="admin-uploads-title" title="Recent uploads" description="Documents added to records. Every file is scanned before anyone can open it.">
    <Table caption="Recent uploads, newest first" head={['Document', 'Patient', 'Facility', 'Size', 'Added', 'Check']} empty="No documents have been added yet.">
      {activity.recentUploads.map((upload, index) => {
        const doc = documentName(upload.document)
        const scan = known(SCAN, upload.scan)
        return <tr key={`${upload.createdAt}-${index}`}>
          <th scope="row" className="px-4 py-3 text-left text-sm font-medium text-ink">{doc.name}{doc.kind && <span className="font-normal text-ink-3"> · {doc.kind}</span>}</th>
          <td className={cx(TD, 'whitespace-nowrap')}>{upload.patient}</td>
          <td className={TD}>{upload.facility}</td>
          <td className={cx(TD, 'whitespace-nowrap tabular')}>{fileSize(upload.sizeBytes)}</td>
          <td className={cx(TD, 'whitespace-nowrap')}>{timeAgo(upload.createdAt)}</td>
          <td className={TD}><Badge size="sm" solid tone={scan.tone} icon={upload.scan === 'clean' ? CircleCheck : undefined}>{scan.text}</Badge></td>
        </tr>
      })}
    </Table>
  </Section>
}
