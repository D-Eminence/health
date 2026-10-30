import { useMemo, useRef } from 'react'
import { ArrowRight, BadgeCheck, ChevronRight, CircleDashed, History, IdCard, NotebookPen, PhoneCall, ShieldAlert, ShieldCheck, Stethoscope, FolderHeart } from 'lucide-react'
import { Allergies, BloodDrop, Dna } from '@healthicons/react'
import { Alert, Button, Card, CardHeader, EmptyState, IconChip, ListRow, PageHeader, PageSkeleton, StatCard, StatGroup, Timeline, greeting, timeAgo, type Icon } from '../kasuwa/ui'
import { COMPLETION_ITEMS, type CompletionKey } from './profileCompletion'
import { Link } from 'react-router-dom'
import type { AccessHistory, AccessRequest, PatientNotification, PatientProfile, PatientRecords } from '../api'
import type { AccessLogEvent, AccessLogPage } from '../accessLog'
import type { ImportedHealthProfile } from '../importedRecords'
import type { HealthProfile } from '../profileParity'
import { useSession } from '../session'
import { usePatientResource } from './usePatientResource'
import { useDocumentTitle } from '../authSteps'
import { useRetryFocus } from './actionFocus'
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

/**
 * The home dashboard as hid-1.0 had it (HomeDashboard.tsx; hid-1.0 parity B3, contract D): the profile card with the
 * Health ID, the NIN badge and the profile's completion; health summary tiles; what needs attention; recent activity;
 * recent provider contributions; and the Share Records and Add Health Information buttons. Each card reads for itself,
 * tolerates a backend that does not serve its read (404, shown as nothing) and an answer it cannot read (shown as
 * empty), and keeps what it showed while it reads again. hid-1.0's "Recent health events" is left out: no backend
 * serves hid-1.0's health events (none were imported). Note contents are never shown here.
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

/** The newest few of the access log's events and the inbox's notices, newest first. */
export function recentActivity(log: AccessLogPage | null | undefined, notices: PatientNotification[] | null | undefined, rows = RECENT_ROWS): ActivityRow[] {
  const events = list<AccessLogEvent>(log?.events).map((event): ActivityRow => ({
    id: `log-${event.id}`, at: event.at, text: `${accessLogActor(event)}: ${WHAT[event.action].toLowerCase()}`, to: '/access' }))
  const inbox = list<PatientNotification>(notices).filter(item => typeof item?.id === 'string' && !Number.isNaN(stamp(item.createdAt)))
    .map((item): ActivityRow => ({ id: `notice-${item.id}`, at: item.createdAt, text: notificationTitle(item), to: '/notifications' }))
  return [...events, ...inbox].sort((a, b) => stamp(b.at) - stamp(a.at)).slice(0, rows)
}

export interface ContributionRow { id: string; at: string | null; kind: string; title: string }

/** The latest completed encounters and signed notes from the patient's providers, newest first; never a note's content. */
export function providerContributions(records: PatientRecords | null | undefined, rows = RECENT_ROWS): ContributionRow[] {
  const encounters = list<PatientRecords['encounters'][number]>(records?.encounters).filter(item => typeof item?.id === 'string')
    .map((item): ContributionRow => ({ id: `encounter-${item.id}`, at: item.endedAt ?? item.startedAt ?? null, kind: 'Encounter',
      title: typeof item.encounterType === 'string' ? item.encounterType.replace(/_/g, ' ') : 'Encounter' }))
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

/** A tile's value: what the patient entered, or what they kept in hid-1.0 until they first save their own. */
function healthValue(entered: string | null, fromHid1: string | undefined, saved: HealthProfile): string {
  if (entered) return entered
  if (neverSaved(saved) && fromHid1) return fromHid1
  return 'Not added'
}

/** What the card prints: the patient's own value, or hid-1.0's until they save one; nothing rather than "Not added". */
const cardFact = (entered: string | null | undefined, fromHid1: string | undefined, saved: HealthProfile | null) =>
  entered || (saved && neverSaved(saved) && fromHid1) || null

const short = (text: string, limit = 80) => text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text

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
  const retryFocus = useRetryFocus(heading)
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

  if (profile.loading && !profile.data) return <PageSkeleton />
  if (profile.error) return <div className="flex flex-col gap-6"><PageHeader title="Overview" titleRef={heading} />
    <Alert intent="error" title="We couldn't load your Health ID" action={<Button size="sm" variant="primary" onClick={() => retryFocus.retry(profile.reload)}>Try again</Button>}>{profile.error}</Alert></div>
  if (!shown) return <div className="flex flex-col gap-6"><PageHeader title="Overview" titleRef={heading} />
    <EmptyState icon={IdCard} title="No profile was returned" description="Your Health ID could not be read. Sign out and in again, or contact support." /></div>

  // One place for each thing: requests as alerts (the decision), profile gaps in the checklist, anything else as a note.
  const notes = checklist.length > 0 ? others.filter(item => !checklist.some(c => ATTENTION_KEY[item.id] === c.key)) : others
  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Lagos' }).format(new Date())

  return <div className="flex flex-col gap-6">
    <PageHeader titleRef={heading} eyebrow={today} title={`${greeting()}${firstName ? `, ${firstName}` : ''}`} />

    {/* The Health ID card is first on a phone (it is what a front desk asks for), and heads the side column on a computer. */}
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr]">
      <HealthIdCard className="self-start lg:col-start-2 lg:row-start-1" profile={shown} onChanged={profile.reload}
        verified={typeof shown.ninVerified === 'boolean' ? ninVerifiedOf(shown) : null} shareTo={shareTo}
        bloodGroup={cardFact(savedHealth?.bloodGroup, fromHid1?.content.blood_group, savedHealth)} genotype={cardFact(savedHealth?.genotype, fromHid1?.content.genotype, savedHealth)} />

      <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
        {/* Each decision waiting for the patient, in words they act on (inverted pyramid). */}
        {pending.map(item => <Alert key={item.accessRequestId} intent="warning" icon={ShieldAlert}
          title={`${item.facilityName} wants to see your records`}
          action={<Button to="/access" size="sm" variant="primary">Review</Button>}>
          {item.reason ? `“${item.reason}”` : 'No reason given.'}{forHowLong(item.requestedDurationMinutes)} Nothing is shared until you approve.
        </Alert>)}
        {notes.map(item => <Alert key={item.id} intent="info" icon={ATTENTION_ICON[item.id]} title={item.text} action={<Button to={item.to} size="sm">Fix</Button>}>{ATTENTION_HINT[item.id]}</Alert>)}

        {checklist.length > 0 && completion && <Card>
          <CardHeader title="Finish your Health ID" description={`${completion.percent}% done · ${completion.missing.length} to go`} icon={IdCard} iconTone="brand" />
          <div className="h-1 bg-tray" role="progressbar" aria-label="Health ID completion" aria-valuenow={completion.percent} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-brand" style={{ width: `${completion.percent}%` }} /></div>
          <ul className="m-0 grid list-none gap-1.5 bg-tray p-1.5 sm:grid-cols-2">
            {/* Only what is left: done steps are the progress bar's, not a list to read past. */}
            {checklist.filter(c => !completion.done.some(d => d.key === c.key)).map(c =>
              <li key={c.key}><Link to={c.to} className="flex h-full min-h-12 items-center gap-3 rounded-xl bg-surface px-4 py-3 no-underline ring-1 ring-line transition-shadow hover:shadow-[var(--shadow-card)]">
                <CircleDashed className="size-5 shrink-0 text-ink-3" aria-hidden />
                <span className="flex-1 text-[13px] font-medium text-ink">{c.label}</span>
                <ChevronRight className="size-4 text-ink-3" aria-hidden />
              </Link></li>)}
          </ul>
        </Card>}

        <StatGroup label="Health summary">
          {savedHealth && <>
            <StatCard icon={BloodDrop as Icon} tone="danger" label="Blood group" value={healthValue(savedHealth.bloodGroup, fromHid1?.content.blood_group, savedHealth)} to="/profile#health-information" />
            <StatCard icon={Dna as Icon} tone="violet" label="Genotype" value={healthValue(savedHealth.genotype, fromHid1?.content.genotype, savedHealth)} to="/profile#health-information" />
            <StatCard icon={Allergies as Icon} tone="warn" label="Allergies" value={short(healthValue(savedHealth.allergies, fromHid1?.content.allergies, savedHealth), 24)} to="/profile#health-information" />
          </>}
          <StatCard icon={ShieldCheck} tone="success" label={active === 1 ? 'Facility with access' : 'Facilities with access'} value={active ?? (history.error ? '—' : '…')} to="/access" />
        </StatGroup>

        <Card aria-labelledby="overview-contributions" aria-busy={(records.loading && records.data !== null) || undefined}>
          <CardHeader as="h2" titleId="overview-contributions" title="Latest from your providers" icon={FolderHeart} iconTone="brand"
            actions={<Button to="/records" size="sm" variant="ghost" iconRight={ArrowRight}>All records</Button>} />
          {records.loading && !records.data ? <PageSkeletonRows />
            : records.error ? <div className="p-5"><Alert intent="error" title="Couldn't load your records" action={<Button size="sm" onClick={() => void records.reload()}>Try again <ItemName>loading recent provider contributions</ItemName></Button>}>{records.error}</Alert></div>
            : contributions.length === 0 ? <p className="m-0 px-5 py-6 text-[13px] text-ink-3">Visits and notes appear here once a provider signs them.</p>
            : <ul className="m-0 list-none divide-y divide-line p-0">{contributions.map(row => <li key={row.id}>
                <ListRow to="/records" leading={<IconChip size="sm" icon={row.kind === 'Clinical note' ? NotebookPen : Stethoscope} />}
                  title={plain(row.title)} subtitle={[row.kind, when(row.at, false)].filter(Boolean).join(' · ')} trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li>)}</ul>}
        </Card>
      </div>

      <Card className="self-start lg:col-start-2 lg:row-start-2" aria-labelledby="overview-activity" aria-busy={(notifications.loading && notifications.data !== null) || undefined}>
        <CardHeader as="h2" titleId="overview-activity" title="Activity" icon={History} actions={<Button to="/notifications" size="sm" variant="ghost" iconRight={ArrowRight}>All</Button>} />
        {notifications.error ? <div className="p-5"><Alert intent="error" title="Couldn't load activity" action={<Button size="sm" onClick={() => void notifications.reload()}>Try again <ItemName>loading recent activity</ItemName></Button>}>{notifications.error}</Alert></div>
          : <Timeline items={activity.map(row => ({ id: row.id, text: row.text, when: timeAgo(row.at), to: row.to, tone: row.to === '/access' ? 'success' : undefined }))}
              empty="When a facility asks for, opens or is given access, you'll see it here." />}
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
const ATTENTION_HINT: Readonly<Record<string, string>> = {
  requests: 'Approve or deny. Nothing is shared until you decide.',
  nin: 'Links your record to your National Identity Number',
  completion: 'A complete profile helps clinicians in an emergency',
  'emergency-contact': 'Who we tell if your records are opened in an emergency',
}

function forHowLong(minutes: number | null | undefined) {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return ''
  const unit = (n: number, w: string) => ` For ${n} ${w}${n === 1 ? '' : 's'}.`
  if (minutes % 1440 === 0) return unit(minutes / 1440, 'day')
  if (minutes % 60 === 0 && minutes > 60) return unit(minutes / 60, 'hour')
  return unit(minutes, 'minute')
}

const plain = (text: string) => { const t = text.replace(/[_-]+/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1) }

function PageSkeletonRows() {
  return <div className="divide-y divide-line">{[0, 1, 2].map(i => <div key={i} className="flex items-center gap-4 px-5 py-4"><div className="size-8 animate-pulse rounded-full bg-hover" /><div className="flex-1 space-y-2"><div className="h-3.5 w-1/3 animate-pulse rounded-md bg-hover" /><div className="h-3 w-1/4 animate-pulse rounded-md bg-hover" /></div></div>)}</div>
}
