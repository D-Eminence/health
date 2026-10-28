import { useMemo, useRef, type ReactNode } from 'react'
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
import { HealthIdCode } from './HealthIdCode'
import { Avatar, usePatientPhoto } from './ProfilePhoto'
import { ProfileCompletionCard } from './ProfileCompletion'
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
  if (contacts && contacts.length === 0) items.push({ id: 'emergency-contact', to: '/settings#emergency-contacts', text: 'You have no emergency contact' })
  return items
}

/** A tile's value: what the patient entered, or what they kept in hid-1.0 until they first save their own. */
function healthValue(entered: string | null, fromHid1: string | undefined, saved: HealthProfile): string {
  if (entered) return entered
  if (neverSaved(saved) && fromHid1) return fromHid1
  return 'Not added'
}

const short = (text: string, limit = 80) => text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text

/** A card that reads for itself: what it showed stays while it reads again; a failed read says so, with its own Try again. */
function DashboardCard({ title, id, loading, error, hasData, retry, children, retryName }: {
  title: string; id: string; loading: boolean; error: string | null; hasData: boolean; retry: () => Promise<unknown>
  children: ReactNode; retryName: string
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  const retryFocus = useRetryFocus(heading)
  return <div className="patient-card" aria-labelledby={id} aria-busy={(loading && hasData) || undefined}>
    <h2 ref={heading} id={id} tabIndex={-1}>{title}</h2>
    {loading && !hasData && !error && <p className="patient-loading" role="status">Loading…</p>}
    {error ? <div role="alert"><p>{error}</p><button ref={retryFocus.button} type="button" onClick={() => retryFocus.retry(retry)}>Try again <ItemName>loading {retryName}</ItemName></button></div> : children}
  </div>
}

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
  const photo = usePatientPhoto(shown?.hasPhoto === true)
  const completion = completionOf(shown, { details, health, contacts })
  const counted = contacts.error ? null : contactsToCount(contacts.data)
  const fromHid1: ImportedHealthProfile | null = records.error ? null : records.data?.importedHealthProfile ?? null
  const attention = attentionItems({ profile: shown, requests: requests.error ? null : requests.data, completion, contacts: counted })
  const activity = useMemo(() => recentActivity(log.error ? null : log.data, notifications.error ? null : notifications.data),
    [log.data, log.error, notifications.data, notifications.error])
  const contributions = useMemo(() => providerContributions(records.error ? null : records.data), [records.data, records.error])
  const savedHealth = health.error ? null : health.data

  return <section className="patient-section">
    <p className="patient-eyebrow">Your account</p>
    <h1 ref={heading} tabIndex={-1} className="patient-page-title">Your health, connected.</h1>
    <p className="patient-page-copy">Your Health ID helps keep your records linked while you manage who can access them.</p>
    {/* The profile last shown stays while it is read again (usePatientResource), with no loading state. */}
    {profile.loading && !profile.data ? <div role="status" className="patient-card patient-loading">Loading your profile…</div>
      : profile.error ? <div role="alert" className="patient-card"><p>{profile.error}</p><button ref={retryFocus.button} type="button" onClick={() => retryFocus.retry(profile.reload)}>Try again</button></div>
      : shown ? <div className="patient-card patient-identity-card patient-overview-profile" aria-busy={profile.loading || undefined}>
          <div className="patient-overview-person">
            <Avatar profile={shown} url={photo.url} size="medium" />
            <div>
              <h2 className="patient-overview-name">{shown.fullName}</h2>
              {typeof shown.ninVerified === 'boolean' && <span className={ninVerifiedOf(shown) ? 'patient-status-tag patient-status-tag-ok' : 'patient-status-tag'}>
                {ninVerifiedOf(shown) ? 'NIN verified' : 'NIN not verified'}</span>}
            </div>
          </div>
          <span className="patient-eyebrow">Health ID</span><HealthIdCode code={shown.hid} />
          {completion && <ProfileCompletionCard completion={completion} compact />}
          <div className="patient-overview-actions">
            {/* Share Records opens the share flow once the backend serves sharing; until then, Access and consent. */}
            <Link className="patient-primary-button" to={share.served === true ? '/access/share' : '/access'}>Share Records</Link>
            {savedHealth && <Link className="patient-secondary-button" to="/profile#health-information">Add Health Information</Link>}
          </div>
          <Link to="/profile">View profile →</Link></div>
      : <div className="patient-card">No profile was returned.</div>}

    {shown && <div className="patient-overview-tiles" role="list" aria-label="Health summary">
      {savedHealth && <>
        <Tile label="Blood group" value={healthValue(savedHealth.bloodGroup, fromHid1?.content.blood_group, savedHealth)} />
        <Tile label="Genotype" value={healthValue(savedHealth.genotype, fromHid1?.content.genotype, savedHealth)} />
        <Tile label="Allergies" value={short(healthValue(savedHealth.allergies, fromHid1?.content.allergies, savedHealth))} />
      </>}
      <Tile label="Active accesses" value={history.data && !history.error ? String(activeAccesses(history.data)) : history.error ? 'Unavailable' : 'Loading…'} />
    </div>}

    {shown && attention.length > 0 && <div className="patient-card patient-attention" aria-labelledby="overview-attention">
      <h2 id="overview-attention">Attention required</h2>
      <ul className="patient-attention-list">{attention.map(item => <li key={item.id}><Link to={item.to}>{item.text}<span aria-hidden="true"> →</span></Link></li>)}</ul>
    </div>}

    {shown && <DashboardCard title="Recent activity" id="overview-activity" loading={notifications.loading || log.loading}
      error={notifications.error} hasData={notifications.data !== null} retry={notifications.reload} retryName="recent activity">
      {activity.length === 0 ? <p className="patient-empty">No recent activity yet.</p>
        : <ul className="patient-list">{activity.map(row => <li key={row.id}><div><Link to={row.to}>{row.text}</Link>
          <span><time dateTime={row.at}>{when(row.at, true)}</time></span></div></li>)}</ul>}
    </DashboardCard>}

    {shown && <DashboardCard title="Recent provider contributions" id="overview-contributions" loading={records.loading} error={records.error}
      hasData={records.data !== null} retry={records.reload} retryName="recent provider contributions">
      {contributions.length === 0 ? <p className="patient-empty">Records your providers add will appear here.</p>
        : <ul className="patient-list">{contributions.map(row => <li key={row.id}><div><strong>{row.title}</strong>
          <span>{[row.kind, when(row.at, false)].filter(Boolean).join(' · ')}</span></div></li>)}</ul>}
      <Link to="/records">See all your records →</Link>
    </DashboardCard>}

    <div className="patient-overview-grid">
      <Link className="patient-card patient-action-card" to="/records"><strong>Health records</strong><span>View completed encounters and signed clinical notes.</span><b>Open records →</b></Link>
      <Link className="patient-card patient-action-card" to="/access"><strong>Access and consent</strong><span>Review access requests and see who has been granted access.</span><b>Manage access →</b></Link>
      <Link className="patient-card patient-action-card" to="/notifications"><strong>Notifications</strong><span>See updates related to your account and access requests.</span><b>View notifications →</b></Link>
    </div>
  </section>
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="patient-card patient-tile" role="listitem"><span className="patient-tile-label">{label}</span><strong className="patient-tile-value">{value}</strong></div>
}
