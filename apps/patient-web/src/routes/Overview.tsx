import { useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowRight, BadgeCheck, ChevronRight, CircleDashed, History, IdCard, NotebookPen, PhoneCall, ShieldAlert, ShieldCheck, Stethoscope, FolderHeart, FileText, Pill } from 'lucide-react'
import { Alert, Button, Card, CardHeader, EmptyState, buttonClass, cx, IconChip, ListRow, PageHeader, PageSkeleton, StatCard, StatGroup, Timeline, greeting, timeAgo, type Icon } from '../kasuwa/ui'
import { LoadingRows } from '../kasuwa/parts'
import { COMPLETION_ITEMS, completionServed, type CompletionKey } from './profileCompletion'
import { Link } from 'react-router-dom'
import type { AccessHistory, AccessRequest, PatientNotification, PatientProfile, PatientRecords } from '../api'
import type { AccessLogEvent, AccessLogPage } from '../accessLog'
import type { ImportedHealthProfile } from '../importedRecords'
import type { HealthProfile } from '../profileParity'
import { useSession } from '../session'
import { WORDS } from '../copy'
import { usePatientResource } from './usePatientResource'
import { useDocumentTitle } from '../authSteps'
import { foundTarget, useRetryOnce } from './actionFocus'
import { ItemName } from '../ItemName'
import { HealthIdCard } from './HealthIdCard'
import { completionOf, servedOrNull, useProfileSources } from './profileSources'
import type { ProfileCompletion } from './profileCompletion'
import { contactsToCount } from './AccountSafety'
import { WHAT, accessLogActor } from './AccessLog'
import { notificationTitle } from './notificationTitles'
import { ninVerifiedOf } from './NinVerificationCard'
import { neverSaved } from './HealthInformation'
import { useOnNotificationChange } from '../notificationBadge'
import { useShareProbe } from './ShareRecords'
import { ButtonR, LoadProblem } from './profileParts'
import { visitClassLabel } from '../plainLabels'
import { getEnvironment } from '../env'

/**
 * The home dashboard as hid-1.0 had it (HomeDashboard.tsx; hid-1.0 parity B3, contract D): the profile card with the
 * Health ID, the NIN badge and the profile's completion; health summary tiles; what needs attention; recent activity;
 * recent provider contributions; and the Share Records and Add Health Information buttons. Each card reads for itself,
 * tolerates a backend that does not serve its read (404, shown as nothing) and an answer it cannot read (shown as
 * empty), and keeps what it showed while it reads again. hid-1.0's "Recent health events" is left out: no backend
 * serves hid-1.0's health events (none were imported). Note contents are never shown here.
 *
 * Made ready for launch (the launch audit's Home findings): a read that fails says so in plain words where its content
 * goes, with its own Try again (HCS-04, HCS-07, HCS-08); a read still running is said to be loading, never shown as
 * "nothing here" (HCS-09); what goes above the tiles (the requests waiting, what the profile lacks) is known before the
 * column is drawn, so nothing moves under the patient's finger as late reads arrive (HCS-09); each Try again reads once
 * and leaves focus where the outcome is (HCS-20); an empty section is the shared empty state (HCS-24).
 */

/** How many rows recent activity and provider contributions show. */
export const RECENT_ROWS = 5

const list = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : []
const stamp = (value: unknown): number => typeof value === 'string' ? Date.parse(value) : Number.NaN

function when(value: string | null | undefined, withTime: boolean) {
  const parsed = value ? new Date(value) : null
  if (!parsed || Number.isNaN(parsed.getTime())) return ''
  return new Intl.DateTimeFormat('en-NG', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(parsed)
}

/** Grants that give a facility access now: active and not yet ended. */
export function activeAccesses(history: AccessHistory | null | undefined, now = Date.now()): number {
  return list<AccessHistory['items'][number]>(history?.items).filter(item =>
    item?.status === 'active' && !(stamp(item.expiresAt) <= now)).length
}

/** Requests still waiting for the patient's decision. */
export const pendingRequests = (requests: AccessRequest[] | null | undefined): number =>
  list<AccessRequest>(requests).filter(item => typeof item?.status === 'string' && item.status.toLowerCase() === 'pending').length

export interface ActivityRow { id: string; at: string; text: string; to: string }

/**
 * One access-log event in words. What the patient did is said as theirs, naming whom they gave access or whose access
 * they ended (HCS-10: "You: got access to your record" read as if they had been given it); what anyone else did is
 * said by who did it.
 */
function activityText(event: AccessLogEvent): string {
  const what = WHAT[event.action]
  if (event.actorKind !== 'patient') return `${accessLogActor(event)}: ${what.toLowerCase()}`
  const facility = event.facilityName ?? 'a facility'
  if (event.action === 'access_granted') return `You gave ${facility} access`
  if (event.action === 'access_ended') return `You ended ${facility}’s access`
  return `You ${what.charAt(0).toLowerCase()}${what.slice(1)}`
}

/** The newest few of the access log's events and the inbox's notices, newest first. */
export function recentActivity(log: AccessLogPage | null | undefined, notices: PatientNotification[] | null | undefined, rows = RECENT_ROWS): ActivityRow[] {
  const events = list<AccessLogEvent>(log?.events).map((event): ActivityRow => ({
    id: `log-${event.id}`, at: event.at, text: activityText(event), to: '/access' }))
  const inbox = list<PatientNotification>(notices).filter(item => typeof item?.id === 'string' && !Number.isNaN(stamp(item.createdAt)))
    .map((item): ActivityRow => ({ id: `notice-${item.id}`, at: item.createdAt, text: notificationTitle(item), to: '/notifications' }))
  return [...events, ...inbox].sort((a, b) => stamp(b.at) - stamp(a.at)).slice(0, rows)
}

export interface ContributionRow { id: string; at: string | null; kind: string; title: string }

/** The latest completed encounters and signed notes from the patient's providers, newest first; never a note's content. */
export function providerContributions(records: PatientRecords | null | undefined, rows = RECENT_ROWS): ContributionRow[] {
  const encounters = list<PatientRecords['encounters'][number]>(records?.encounters).filter(item => typeof item?.id === 'string')
    .map((item): ContributionRow => ({ id: `encounter-${item.id}`, at: item.endedAt ?? item.startedAt ?? null, kind: 'Encounter',
      title: visitClassLabel(typeof item.encounterType === 'string' ? item.encounterType : null) }))
  const notes = list<PatientRecords['notes'][number]>(records?.notes).filter(item => typeof item?.id === 'string' && item.signedAt)
    .map((item): ContributionRow => ({ id: `note-${item.id}`, at: item.signedAt, kind: 'Clinical note', title: item.title || item.noteType || 'Clinical note' }))
  const time = (row: ContributionRow) => { const value = stamp(row.at); return Number.isNaN(value) ? -Infinity : value }
  return [...encounters, ...notes].sort((a, b) => time(b) - time(a)).slice(0, rows)
}

export interface AttentionItem { id: string; text: string; to: string }

/** hid-1.0's "Attention required": what the patient may want to act on, each a link to where they do. */
export function attentionItems({ profile, requests, completion, contacts }: {
  profile: PatientProfile | null
  requests: AccessRequest[] | null
  completion: ProfileCompletion | null
  /** The contacts the completion counts, or null where the patient can't add one now. */
  contacts: readonly unknown[] | null
}): AttentionItem[] {
  const items: AttentionItem[] = []
  const pending = pendingRequests(requests)
  if (pending > 0) items.push({ id: 'requests', to: '/access',
    text: pending === 1 ? '1 access request is waiting for your decision' : `${pending} access requests are waiting for your decision` })
  if (profile && profile.ninVerified === false) items.push({ id: 'nin', to: '/profile#nin-verification', text: 'Your NIN is not verified yet' })
  if (completion && completion.percent < 100) items.push({ id: 'completion', to: '/profile#profile-completion',
    text: `Your profile is ${completion.percent}% complete` })
  if (contacts && contacts.length === 0) items.push({ id: 'emergency-contact', to: '/profile#emergency-contacts', text: 'You have no emergency contact' })
  return items
}

/** What the record holds, counted from the records answer: every record, the documents among them, and medicines still taken. */
export function recordCounts(records: PatientRecords) {
  const size = (value: unknown) => Array.isArray(value) ? value.length : 0
  const sections = ['encounters', 'notes', 'vitals', 'diagnoses', 'prescriptions', 'labRequests', 'documents'] as const
  const medicines = list<PatientRecords['prescriptions'][number]>(records.prescriptions)
  return {
    records: sections.reduce((sum, key) => sum + size(records[key]), 0) + size(records.importedRecords),
    documents: size(records.documents),
    medicines: medicines.filter(item => typeof item?.status !== 'string' || !/stopped|completed|cancel/i.test(item.status)).length,
  }
}

/** What the card prints: the patient's own value, or hid-1.0's until they save one; nothing rather than "Not added". */
const cardFact = (entered: string | null | undefined, fromHid1: string | undefined, saved: HealthProfile | null) =>
  entered || (saved && neverSaved(saved) && fromHid1) || null

/** Whether a read has answered, with data or with a failure, at least once since the page opened. */
const answered = (read: { data: unknown; loading: boolean; error: string | null }) => !read.loading || read.data !== null || read.error !== null

/**
 * A tile's number (HCS-08): the count; while it is read, a bar that says "Loading" to a screen reader (not "…", which
 * read as "horizontal ellipsis"); after a failed read, a dash with why under it.
 */
function tileValue(count: number | null, failed: boolean): { value: ReactNode; hint?: string } {
  if (count !== null) return { value: count }
  if (failed) return { value: <span aria-hidden="true">—</span>, hint: 'Couldn’t load' }
  return { value: <><span aria-hidden="true" className="inline-block h-6 w-10 animate-pulse rounded-md bg-hover align-middle sm:h-7" /><span className="sr-only">Loading</span></> }
}

/** The approved support address (config/production.json chat.supportContact), unless the build names its own. */
function supportHref(): string {
  try { return getEnvironment().supportContact ?? SUPPORT_CONTACT } catch { return SUPPORT_CONTACT }
}
const SUPPORT_CONTACT = 'mailto:support@healthidentitydirectory.com'

/* Where focus goes once a card's Try again has loaded what it asked for: the card's heading, or the Health ID card. */
const CARD = foundTarget(() => document.getElementById('overview-card')?.querySelector<HTMLElement>('section'))
const CONTRIBUTIONS_HEADING = foundTarget(() => document.getElementById('overview-contributions'))
const ACTIVITY_HEADING = foundTarget(() => document.getElementById('overview-activity'))


export function Overview() {
  const { api } = useSession()
  useDocumentTitle('Overview · Health ID')
  // The profile is the first read sent; the others follow.
  const { profile, details, health, contacts } = useProfileSources()
  const records = usePatientResource(api.records)
  const history = usePatientResource(api.accessHistory)
  const requests = usePatientResource(api.accessRequests)
  const notifications = usePatientResource(api.notifications)
  // Sharing (hid-system 0095): learned once per page life from its probe; a 404 (today's backend) keeps Access and consent.
  const share = useShareProbe()
  // The access log's newest page (hid-system 0093), under the access page's own name; a backend before it answers 404.
  const readLog = useMemo(() => servedOrNull((signal?: AbortSignal) => api.accessLog(null, signal)), [api])
  const log = usePatientResource<AccessLogPage | null>(readLog, 'access-log')
  // A notice came, or one was read: what needs attention and the recent activity are read again.
  useOnNotificationChange(() => { void requests.reload(); void notifications.reload(); void log.reload(); void history.reload() })

  const heading = useRef<HTMLHeadingElement>(null)
  const profileRetry = useRetryOnce(heading)
  const healthRetry = useRetryOnce(CARD)
  const requestsRetry = useRetryOnce(heading)
  const recordsRetry = useRetryOnce(CONTRIBUTIONS_HEADING)
  const noticesRetry = useRetryOnce(ACTIVITY_HEADING)
  const logRetry = useRetryOnce(ACTIVITY_HEADING)
  const shown = profile.data && !profile.error ? profile.data : null
  const completion = completionOf(shown, { details, health, contacts })
  const counted = contacts.error ? null : contactsToCount(contacts.data)
  const fromHid1: ImportedHealthProfile | null = records.error ? null : records.data?.importedHealthProfile ?? null
  const attention = attentionItems({ profile: shown, requests: requests.error ? null : requests.data, completion, contacts: counted })
  const activity = useMemo(() => recentActivity(log.error ? null : log.data, notifications.error ? null : notifications.data),
    [log.data, log.error, notifications.data, notifications.error])
  const contributions = useMemo(() => providerContributions(records.error ? null : records.data), [records.data, records.error])
  const savedHealth = health.error ? null : health.data

  const pending = (requests.error ? [] : list<AccessRequest>(requests.data)).filter(item => typeof item?.status === 'string' && item.status.toLowerCase() === 'pending')
  const firstName = shown?.firstName?.trim() || shown?.fullName?.split(' ')[0] || ''
  const shareTo = share.served === true ? '/access/share' : '/access'
  const others = attention.filter(item => item.id !== 'requests' && item.id !== 'completion')
  const steps = completion ? COMPLETION_ITEMS.filter(item => completion.done.some(d => d.key === item.key) || completion.missing.some(m => m.key === item.key)) : []
  const checklist = completion && completion.percent < 100 ? CHECKLIST.filter(c => steps.some(item => item.key === c.key)) : []
  const active = history.data && !history.error ? activeAccesses(history.data) : null
  const counts = records.data && !records.error ? recordCounts(records.data) : null
  const recordsFailed = records.error !== null && !records.loading
  // The column is drawn once what goes at its top is known: the requests waiting, and what the profile lacks (its
  // completion, once its sources have answered). Drawn before, the tiles moved down as each arrived (HCS-09). Once drawn,
  // it stays: a read again (a notice came, or Try again) never takes it away.
  const topKnown = shown ? answered(requests) && (!completionServed(shown) || completion !== null) : false
  const [drawn, setDrawn] = useState(false)
  if (topKnown && !drawn) setDrawn(true)
  // Activity is loading until both its reads have answered once: until then, its empty sentence would say no one has
  // opened the record (HCS-09).
  const activityLoading = (notifications.loading && notifications.data === null && !notifications.error) || (log.loading && log.data === null && !log.error)

  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Lagos' }).format(new Date())
  // The heading is there while the profile is read, as the page's own: a link that opened Home takes focus to it
  // (pageFocus.ts), and it keeps focus as the greeting gains the patient's name.
  if (profile.loading && !profile.data) return <div className="flex flex-col gap-6">
    <PageHeader titleRef={heading} eyebrow={today} title={greeting()} /><PageSkeleton stats={false} /></div>
  if (profile.error) return <div className="flex flex-col gap-6"><PageHeader title="Overview" titleRef={heading} />
    <Alert intent="error" title="We couldn't load your Health ID" action={<ButtonR ref={profileRetry.button} size="sm" variant="primary" onClick={() => profileRetry.retry(profile.reload)}>Try again</ButtonR>}>{profile.error}</Alert></div>
  // An answer with no Health ID in it (HCS-28): what to do next, not only what went wrong.
  if (!shown) return <div className="flex flex-col gap-6"><PageHeader title="Overview" titleRef={heading} />
    <EmptyState icon={IdCard} title="We couldn’t read your Health ID" description="Try again. If it still doesn’t load, email support and we’ll help."
      action={<><ButtonR ref={profileRetry.button} variant="primary" onClick={() => profileRetry.retry(profile.reload)}>Try again</ButtonR>
        <a href={supportHref()} className={buttonClass()}>Email support</a></>} /></div>

  // One place for each thing: requests as alerts (the decision), profile gaps in the checklist, anything else as a note.
  const notes = checklist.length > 0 ? others.filter(item => !checklist.some(c => ATTENTION_KEY[item.id] === c.key)) : others
  const left = checklist.filter(c => !completion?.done.some(d => d.key === c.key))

  return <div className="flex flex-col gap-6">
    <PageHeader titleRef={heading} eyebrow={today} title={`${greeting()}${firstName ? `, ${firstName}` : ''}`} />

    {/* The Health ID card is first on a phone (it is what a front desk asks for), and heads the side column on a computer. */}
    <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] @3xl:grid-rows-[auto_1fr]">
      <div id="overview-card" className="flex w-full max-w-[460px] min-w-0 flex-col gap-3 self-start justify-self-center @3xl:max-w-none @3xl:col-start-2 @3xl:row-start-1">
        <HealthIdCard className="w-full" profile={shown} onChanged={profile.reload}
          verified={typeof shown.ninVerified === 'boolean' ? ninVerifiedOf(shown) : null} shareTo={shareTo} sharePrimary={pending.length === 0}
          allergies={cardFact(savedHealth?.allergies, fromHid1?.content.allergies, savedHealth)}
          bloodGroup={cardFact(savedHealth?.bloodGroup, fromHid1?.content.blood_group, savedHealth)} genotype={cardFact(savedHealth?.genotype, fromHid1?.content.genotype, savedHealth)} />
        {/* A card shown to a front desk or an emergency team must not read as if no allergy is recorded (HCS-04). */}
        {health.error && <LoadProblem what="your blood group, genotype and allergies" error={health.error} buttonRef={healthRetry.button}
          onRetry={() => healthRetry.retry(health.reload)} name={<ItemName>loading your blood group, genotype and allergies</ItemName>} />}
      </div>

      <div className="flex min-w-0 flex-col gap-6 @3xl:col-start-1 @3xl:row-span-2 @3xl:row-start-1">
        {!drawn && !topKnown ? <ColumnLoading /> : <>
        {/* Requests that could not be checked are said, not shown as none waiting (HCS-07). */}
        {requests.error && <Alert intent="error" title="Couldn’t check for access requests"
          action={<ButtonR ref={requestsRetry.button} size="sm" onClick={() => requestsRetry.retry(requests.reload)}>Try again <ItemName>checking for access requests</ItemName></ButtonR>}>{requests.error}</Alert>}
        {/* Each decision waiting for the patient, in words they act on (inverted pyramid). */}
        {/* One primary on the page: the first request's Review; the card's Share steps back while any waits. */}
        {pending.map((item, index) => <Alert key={item.accessRequestId} intent="warning" icon={ShieldAlert}
          title={`${item.facilityName} wants to see your ${WORDS.records}`}
          action={<Button to="/access" size="sm" variant={index === 0 ? 'primary' : 'secondary'}>Review</Button>}>
          {item.reason ? `“${item.reason}”` : 'No reason given.'}{forHowLong(item.requestedDurationMinutes)} Nothing is shared until you approve.
        </Alert>)}
        {notes.map(item => <Alert key={item.id} intent="info" icon={ATTENTION_ICON[item.id]} title={item.text} action={<Button to={item.to} size="sm">{ATTENTION_ACTION[item.id] ?? 'Open'}</Button>}>{ATTENTION_HINT[item.id]}</Alert>)}

        {checklist.length > 0 && completion && <Card>
          <CardHeader title="Finish your Health ID" description={`${completion.percent}% done · ${completion.missing.length} to go`} icon={IdCard} iconTone="brand" />
          <div className="h-1 bg-tray" role="progressbar" aria-label="Health ID completion" aria-valuenow={completion.percent} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-brand-fill" style={{ width: `${completion.percent}%` }} /></div>
          <ul className={cx('m-0 grid list-none gap-1.5 bg-tray p-1.5', left.length > 1 && 'grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))]')}>
            {/* Only what is left: done steps are the progress bar's, not a list to read past. */}
            {left.map(c =>
              <li key={c.key}><Link to={c.to} className="flex h-full min-h-12 items-center gap-3 rounded-xl bg-surface px-4 py-3 no-underline ring-1 ring-line transition-shadow hover:shadow-[var(--shadow-card)]">
                <CircleDashed className="size-5 shrink-0 text-ink-3" aria-hidden />
                <span className="min-w-0 flex-1 text-[13px] font-medium break-words text-ink">{c.label}</span>
                <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
              </Link></li>)}
          </ul>
        </Card>}

        {/* Blood group, genotype and allergies are on the card; these say what the record holds. */}
        <StatGroup label="Your record at a glance">
          <StatCard icon={FolderHeart} tone="brand" label="Records" {...tileValue(counts?.records ?? null, recordsFailed)} to="/records" />
          <StatCard icon={FileText} tone="violet" label="Documents" {...tileValue(counts?.documents ?? null, recordsFailed)} to="/records?tab=documents" />
          <StatCard icon={ShieldCheck} tone="success" label={active === 1 ? 'Facility with access' : 'Facilities with access'}
            {...tileValue(active, history.error !== null && !history.loading)} to="/access" />
          <StatCard icon={Pill} tone="warn" label="Medicines" {...tileValue(counts?.medicines ?? null, recordsFailed)} to="/records?tab=prescriptions" />
        </StatGroup>

        <Card aria-labelledby="overview-contributions" aria-busy={records.loading || undefined}>
          <CardHeader as="h2" titleId="overview-contributions" title="Latest from your providers" icon={FolderHeart} iconTone="brand"
            actions={<Button to="/records" size="sm" variant="ghost" iconRight={ArrowRight}>All {WORDS.records}</Button>} />
          {records.loading && !records.data ? <LoadingRows label="Loading the latest from your providers" />
            : records.error ? <div className="p-5"><LoadProblem what="your records" error={records.error} buttonRef={recordsRetry.button}
                onRetry={() => recordsRetry.retry(records.reload)} name={<ItemName>loading recent provider contributions</ItemName>} /></div>
            : contributions.length === 0 ? <EmptyState compact icon={Stethoscope} title="No visits or notes yet"
                description="Show your Health ID card at your next visit. Visits and notes appear here once a provider signs them." />
            : <ul className="m-0 list-none divide-y divide-line p-0">{contributions.map(row => <li key={row.id}>
                <ListRow to="/records" leading={<IconChip size="sm" icon={row.kind === 'Clinical note' ? NotebookPen : Stethoscope} />}
                  title={plain(row.title)} subtitle={[KIND_WORDS[row.kind] ?? row.kind, when(row.at, false)].filter(Boolean).join(' · ')} trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li>)}</ul>}
        </Card>
        </>}
      </div>

      <Card className="min-w-0 self-start @3xl:col-start-2 @3xl:row-start-2" aria-labelledby="overview-activity" aria-busy={notifications.loading || log.loading || undefined}>
        <CardHeader as="h2" titleId="overview-activity" title="Activity" icon={History} actions={<Button to="/notifications" size="sm" variant="ghost" iconRight={ArrowRight}>All</Button>} />
        {activityLoading ? <LoadingRows label="Loading activity" /> : <>
          {/* What did load is shown; what did not is said, with its own Try again, and the card never says "nothing here" then (HCS-07). */}
          {(notifications.error || log.error) && <div className="flex flex-col gap-2 px-5 pt-5 last:pb-5">
            {notifications.error && <LoadProblem what="your notifications" error={notifications.error} buttonRef={noticesRetry.button}
              onRetry={() => noticesRetry.retry(notifications.reload)} name={<ItemName>loading recent activity</ItemName>} />}
            {log.error && <LoadProblem what="some of your activity" error={log.error} buttonRef={logRetry.button}
              onRetry={() => logRetry.retry(log.reload)} name={<ItemName>loading who viewed or changed your records</ItemName>} />}
          </div>}
          {activity.length > 0
            ? <Timeline items={activity.map(row => ({ id: row.id, text: row.text, when: timeAgo(row.at), to: row.to, tone: row.to === '/access' ? 'success' : undefined }))} empty={null} />
            : !notifications.error && !log.error && <EmptyState compact icon={History} title="No activity yet"
                description="When a hospital asks to see your records, opens them or is given access, you’ll see it here." />}
        </>}
      </Card>
    </div>
  </div>
}

/** The checklist's places: the profile items worth a tile, in the order a patient would do them. */
const CHECKLIST: ReadonlyArray<{ key: CompletionKey; label: string; to: string }> = [
  { key: 'nin', label: 'Verify your NIN', to: '/profile#nin-verification' },
  { key: 'bloodGroup', label: 'Add your blood group', to: '/profile#health-information' },
  { key: 'emergencyContact', label: 'Add an emergency contact', to: '/profile#emergency-contacts' },
  { key: 'photo', label: 'Add a photo to your card', to: '/?photo=add' },
  { key: 'genotype', label: 'Add your genotype', to: '/profile#health-information' },
  { key: 'hmo', label: 'Add your HMO', to: '/profile#coverage' },
  { key: 'hospital', label: 'Name the hospital you use', to: '/profile#coverage' },
  { key: 'phone', label: 'Add a phone number', to: '/profile#contact-details' },
]

const ATTENTION_KEY: Readonly<Record<string, CompletionKey>> = { nin: 'nin', 'emergency-contact': 'emergencyContact' }
const ATTENTION_ICON: Readonly<Record<string, Icon>> = { requests: ShieldAlert, nin: BadgeCheck, completion: IdCard, 'emergency-contact': PhoneCall }
/** The plain word for each kind of contribution. */
const KIND_WORDS: Readonly<Record<string, string>> = { Encounter: 'Visit', 'Clinical note': 'Doctor’s note' }
/** Each note's button names what it does. */
const ATTENTION_ACTION: Readonly<Record<string, string>> = { requests: 'Review', nin: 'Verify NIN', completion: 'Finish profile', 'emergency-contact': 'Add contact' }
const ATTENTION_HINT: Readonly<Record<string, string>> = {
  requests: 'Approve or deny. Nothing is shared until you decide.',
  nin: 'Links your records to your National Identity Number.',
  completion: 'A complete profile helps clinicians in an emergency.',
  'emergency-contact': 'Who we tell if your records are opened in an emergency.',
}

function forHowLong(minutes: number | null | undefined) {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return ''
  const unit = (n: number, w: string) => ` For ${n} ${w}${n === 1 ? '' : 's'}.`
  if (minutes % 1440 === 0) return unit(minutes / 1440, 'day')
  if (minutes % 60 === 0 && minutes > 60) return unit(minutes / 60, 'hour')
  return unit(minutes, 'minute')
}

const plain = (text: string) => { const t = text.replace(/[_-]+/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1) }

/** The column while what goes at its top is read: the tiles and a card, drawn as they will be, said to be loading. */
function ColumnLoading() {
  const bar = 'animate-pulse rounded-md bg-hover'
  return <div role="status" aria-label="Loading your overview" className="flex flex-col gap-6">
    <span className="sr-only">Loading your overview…</span>
    <div className="hid-stat-grid-4 grid gap-1.5 rounded-2xl bg-tray p-1.5" aria-hidden="true">
      {[0, 1, 2, 3].map(i => <div key={i} className="rounded-xl bg-surface p-4 ring-1 ring-line sm:p-5">
        <div className={`${bar} size-10 rounded-full`} /><div className={`${bar} mt-3 h-7 w-12 sm:mt-5`} /><div className={`${bar} mt-2 h-3.5 w-20`} /></div>)}
    </div>
    <div className="rounded-xl bg-surface ring-1 ring-line" aria-hidden="true">
      {[0, 1, 2].map(i => <div key={i} className="flex items-center gap-4 border-b border-line px-5 py-4 last:border-0">
        <div className={`${bar} size-9 rounded-full`} /><div className="flex-1 space-y-2"><div className={`${bar} h-3.5 w-1/3`} /><div className={`${bar} h-3 w-1/4`} /></div></div>)}
    </div>
  </div>
}
