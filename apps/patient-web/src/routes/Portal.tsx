import { ImportedHistory, matchingImported } from '../ImportedHistory'
import { usesNovuBackend } from '../backendContract'
import { PatientImportedHistory } from '../ImportedHistoryPage'
import { getEnvironment } from '../env'
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { Bell, Building2, Check, ClipboardList, FileText, FlaskConical, HeartPulse, House, LayoutDashboard, Lock, MessageSquareText, NotebookPen, PhoneCall, Pill, Search, Share2, ShieldCheck, Siren, Stethoscope, UserRound, X, ChevronRight, Plus, FilePlus2, FolderHeart } from 'lucide-react'
import { AppShell, type NavGroup } from '../kasuwa/AppShell'
import { Badge, Button, buttonClass, Card, CardHeader, EmptyState, FilterTabs, IconChip, Input, PageHeader, cx, timeAgo, type Icon } from '../kasuwa/ui'
import { HealthIdCard } from './HealthIdCard'
import { AddRecordDrawer } from './AddRecord'
import { Drawer } from '../kasuwa/interactive'
import { ToastProvider, useToast } from '../kasuwa/toast'
import { BrandLogo } from '../BrandLogo'
import { ItemName } from '../ItemName'
import { useSession } from '../session'
import { IMPORTED_NOTIFICATIONS_PAGE, type AccessHistory, type PatientProfile, type ImportedNotification, type PatientRecords, type RecordSection } from '../api'
import { IMPORTED_HEALTH_FIELDS, type ImportedHealthField, type ImportedHealthProfile, type ImportedMedicalRecord } from '../importedRecords'
import { patientChatEnabled } from '../chatFeatures'
import { usePatientResource } from './usePatientResource'
import { useActionFocus, useRetryFocus } from './actionFocus'
import { AccountDeletionCard, EmergencyContactsCard } from './AccountSafety'
import { DeviceNotificationsCard, InstallAppCard } from './DeviceSettings'
import { describedBy, isFieldProblem, useDocumentTitle, useStepFocus } from '../authSteps'
import { useFocusOnPageChange } from '../pageFocus'
import { SentOrdersCard } from './SentOrders'
import { NinVerificationCard, ninVerifiedOf } from './NinVerificationCard'
import { dayWords, groupByDay, matchesQuery } from './recordSearch'
import { NOTIFICATION_SUBJECTS, notificationTitle } from './notificationTitles'
import { AccessLogCard } from './AccessLog'
import { NotificationBell, UnreadNotificationsProvider, useOnNotificationChange, useUnreadNotifications } from '../notificationBadge'
import { ProfileChangeProvider, useOnProfileChange } from '../profileChange'
import { useFocusSectionFromHash, useOpenSections } from './sectionFocus'
import { OpenSectionsContext, ProfileSection } from './ProfileSection'
import { completionOf, useProfileSources } from './profileSources'
import { ProfileCompletionCard } from './ProfileCompletion'
import { ContactDetails } from './ProfileContact'
import { Avatar, usePatientPhoto } from './ProfilePhoto'
import { CoverageCard } from './ProfileCoverage'
import { HealthInformationCard } from './HealthInformation'
import { ShareInvitationsCard } from './ShareInvitations'
import { useShareServed } from '../shareServed'
import { shareDurationLabel, shareLevelLabel } from '../shareRecords'

function date(value: string | null | undefined) {
  if (!value) return 'Not available'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(parsed)
}

function dateTime(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

/** A system code shown in plain words: "outpatient_visit" reads as "Outpatient visit". */
function plainCode(value: string | null | undefined) {
  if (!value) return 'Not recorded'
  const words = value.replace(/[_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** " for 60 minutes", " for 2 hours", " for 7 days": how long a facility asks for, in words; nothing when unknown. */
function forHowLong(minutes: number | null | undefined) {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return ''
  const unit = (count: number, word: string) => ` for ${count} ${word}${count === 1 ? '' : 's'}`
  if (minutes % 1440 === 0) return unit(minutes / 1440, 'day')
  if (minutes % 60 === 0 && minutes > 60) return unit(minutes / 60, 'hour')
  return unit(minutes, 'minute')
}

/** A size EHR sends as a number or, for a bigint column, as text. */
function bytes(value: number | string | null) {
  const count = value == null || value === '' ? NaN : Number(value)
  return Number.isFinite(count) && count >= 0 ? `${count.toLocaleString('en-NG')} bytes` : 'Size unavailable'
}

/** Every measurement in a vitals entry, so one holding only blood pressure is not shown as a bare date. */
function vitalsSummary(item: PatientRecords['vitals'][number]) {
  return [
    item.systolicMmhg != null && item.diastolicMmhg != null ? `BP ${item.systolicMmhg}/${item.diastolicMmhg} mmHg` : '',
    item.temperatureC != null ? `Temp ${item.temperatureC}°C` : '',
    item.pulseBpm != null ? `Pulse ${item.pulseBpm} bpm` : '',
    item.respiratoryRate != null ? `Respiratory rate ${item.respiratoryRate} breaths/min` : '',
    item.oxygenSaturationPercent != null ? `SpO₂ ${item.oxygenSaturationPercent}%` : '',
    item.weightKg != null ? `Weight ${item.weightKg} kg` : '',
    item.heightCm != null ? `Height ${item.heightCm} cm` : '',
  ].filter(Boolean).join(' · ')
}

/**
 * The first load and a failed one. Content already on screen stays there while it
 * reloads (PR-03), and after 'Try again' focus goes to `focusTarget` (PR-04). A
 * card is aria-busy only while it reloads what it shows: assistive technology may
 * hold back changes in a busy region, the first load's status among them.
 */
function LoadState({ loading, error, retry, hasData, focusTarget }: {
  loading: boolean; error: string | null; retry: () => Promise<unknown>; hasData: boolean; focusTarget: RefObject<HTMLElement | null>
}) {
  const retryFocus = useRetryFocus(focusTarget)
  if (loading && !hasData) return <div className="patient-card patient-loading" role="status">Loading your information…</div>
  if (error) return <div className="patient-card" role="alert"><p>{error}</p>
    <button ref={retryFocus.button} type="button" onClick={() => retryFocus.retry(retry)}>Try again</button></div>
  return null
}

export function PortalShell() {
  const { api, signOut } = useSession()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const main = useRef<HTMLDivElement>(null)
  useFocusOnPageChange(main)
  const logout = async () => {
    setSigningOut(true); setError(null)
    try { await signOut(); navigate('/sign-in', { replace: true }) }
    catch (reason) {
      setError(isHidApiError(reason) ? reason.message : 'Sign-out failed. Please try again.')
    } finally { setSigningOut(false) }
  }

  // The bell's count is read here, for every page under the shell (notificationBadge.tsx).
  return <ToastProvider><UnreadNotificationsProvider><ProfileChangeProvider>
    <PatientChrome api={api} signingOut={signingOut} onSignOut={() => void logout()}>
      <div ref={main} tabIndex={-1} className="outline-none">
        <Outlet />
      </div>
      <SignOutToast error={error} />
    </PatientChrome>
  </ProfileChangeProvider></UnreadNotificationsProvider></ToastProvider>
}

/** A failed sign-out, said at the top as every other result is (the shell's own provider is above it). */
function SignOutToast({ error }: { error: string | null }) {
  const toast = useToast()
  useEffect(() => { if (error) toast.error({ title: 'Couldn’t sign out', message: error }) }, [error, toast])
  return null
}

/** paytrail's app shell, for a patient: their Health ID card at the top, their places by group, a ➕ for what they add. */
function PatientChrome({ api, signingOut, onSignOut, children }: { api: ReturnType<typeof useSession>['api']; signingOut: boolean; onSignOut: () => void; children: ReactNode }) {
  const profile = usePatientResource(api.profile)
  const shown = profile.data && !profile.error && typeof profile.data === 'object' ? profile.data : null
  const photo = usePatientPhoto(shown?.hasPhoto === true)
  useOnProfileChange(() => { void profile.reload().then(() => photo.reload()) })
  const share = useShareServed()
  const shareTo = share === true ? '/access/share' : '/access'
  const name = shown?.fullName ?? 'Your Health ID'
  const avatar = shown ? <Avatar profile={shown} url={photo.url} size="small" /> : undefined
  const nav: NavGroup[] = [
    { items: [{ to: '/', label: 'Overview', icon: LayoutDashboard, end: true }] },
    { title: 'Your health', items: [
      ...(patientChatEnabled() ? [{ to: '/chat', label: 'Ask about your records', icon: MessageSquareText }] : []),
      { to: '/records', label: 'Records', icon: FolderHeart },
      { to: '/access', label: 'Access & sharing', icon: ShieldCheck },
    ] },
    { title: 'Account', items: [{ to: '/profile', label: 'Profile', icon: UserRound }] },
  ]
  return <AppShell
    brand={<NavLink to="/" aria-label="Health ID home" className="inline-flex items-center gap-2.5 no-underline"><BrandLogo className="h-7 w-auto" /><Badge tone="brand" size="sm">Patient</Badge></NavLink>}
    switcher={{ name, subtitle: shown?.hid ? `Health ID · ${shown.hid}` : 'Patient portal', avatar,
      menu: close => <ul className="m-0 list-none p-0">
        <li><Link to="/profile" onClick={close} className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink no-underline hover:bg-hover"><UserRound className="size-4 text-ink-3" aria-hidden />Your profile</Link></li>
        <li><Link to="/profile#health-information" onClick={close} className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink no-underline hover:bg-hover"><HeartPulse className="size-4 text-ink-3" aria-hidden />Health information</Link></li>
      </ul> }}
    nav={nav}
    person={{ name, detail: shown?.email ?? shown?.phone ?? 'Patient', avatar, profileTo: '/profile' }}
    onSignOut={onSignOut}
    signingOut={signingOut}
    headerStart={<NavLink to="/" aria-label="Health ID home" className="inline-flex items-center no-underline lg:hidden"><BrandLogo className="h-7 w-auto" /></NavLink>}
    headerActions={<NotificationBell />}
    tabs={[{ to: '/', label: 'Home', icon: House, end: true }, { to: '/records', label: 'Records', icon: FolderHeart }, { to: '/access', label: 'Access', icon: ShieldCheck }]}
    create={{ label: 'Add or share', items: [
      { to: '/records?add=record', label: 'Add a record', hint: 'A visit, result or medicine, with a photo', icon: FilePlus2, main: true },
      { to: shareTo, label: 'Share my records', hint: 'Let a hospital or doctor see them', icon: Share2 },
      { to: '/profile#health-information', label: 'Update health information', hint: 'Blood group, genotype, allergies', icon: HeartPulse },
      { to: '/profile#emergency-contacts', label: 'Add an emergency contact', hint: 'Who we tell in an emergency', icon: PhoneCall },
    ] }}>
    {children}
  </AppShell>
}

const HEALTH_LABELS: Readonly<Record<ImportedHealthField, string>> = {
  blood_group: 'Blood group', genotype: 'Genotype', allergies: 'Allergies', current_medications: 'Current medications',
  chronic_conditions: 'Chronic conditions', medical_notes: 'Medical notes',
}

/** hid-system main sends no hid-1.0 health details with the records, so the profile reads none there. */
const noRecords = async (): Promise<PatientRecords | null> => null

/** A migrated patient's hid-1.0 health details, as they were: read-only, and only the ones they filled in. */
function ImportedHealthCard({ profile }: { profile: ImportedHealthProfile }) {
  return <ProfileSection id="hid1-health-details" title="From your hid-1.0 account">
    <p className="patient-field-hint">Carried over from hid-1.0{profile.updatedAt
      ? `, last updated on ${date(profile.updatedAt)}` : ''}. They can't be changed here.</p>
    <dl className="patient-details">{IMPORTED_HEALTH_FIELDS.filter(field => profile.content[field]).map(field =>
      <div key={field}><dt>{HEALTH_LABELS[field]}</dt><dd className="patient-multiline">{profile.content[field]}</dd></div>)}</dl>
  </ProfileSection>
}

/** The profile's parts with an id of their own, and the section each is in: a link to one opens that section. */
const PROFILE_SECTION_PARTS: Readonly<Record<string, string>> = {
  'contact-details': 'bio-data', 'access-pin': 'bio-data', 'emergency-contacts': 'health-information',
}

/**
 * The patient's profile, with "Verify your NIN" (NinVerificationCard.tsx): since the
 * owner's decision of 2026-10-27 a patient signs up without a NIN and may add it here,
 * optionally. Where Identity still refuses it (503 QOREID_PATIENT_NIN_BINDING_DISABLED
 * while QOREID_PATIENT_SELF_NIN_BINDING_ENABLED is off), the card says so plainly.
 *
 * hid-1.0 parity B3 (hid-system 0094): the profile's completion, contact details, photo, coverage and health
 * information, each shown only where the backend serves it (a 404, or GET identity/me without the new keys, hides it).
 *
 * As hid-1.0 had it (the owner's decisions of 2026-10-28): the completion first, always shown; then Bio-data, whose
 * picture is the photo control and whose rows end with the email and phone and the Access PIN; then Coverage, Health
 * information with the emergency contacts in it, and Delete account last. There is no Settings page. Every section
 * but the completion starts closed and opens as the patient clicks its heading (ProfileSection.tsx); a link to one
 * (/profile#coverage) opens it (useOpenSections), and one to a part of one (PROFILE_SECTION_PARTS) opens its section.
 */
export function ProfilePage() {
  const { api } = useSession()
  useDocumentTitle('Your profile · Health ID')
  const { profile, details, health, contacts } = useProfileSources()
  // Novu sends a migrated patient's hid-1.0 health details with the records (importedHealthProfile), null for anyone else.
  const records = usePatientResource<PatientRecords | null>(usesNovuBackend() ? api.records : noRecords)
  const imported = records.error ? null : records.data?.importedHealthProfile ?? null
  const heading = useRef<HTMLHeadingElement>(null)
  const sections = useOpenSections(PROFILE_SECTION_PARTS)
  useFocusSectionFromHash(heading)
  const completion = completionOf(profile.error ? null : profile.data, { details, health, contacts })
  const shown = profile.data && !profile.error ? profile.data : null

  const share = useShareServed()

  return <div className="flex flex-col gap-6">
    <PageHeader titleRef={heading} title="Profile" description="What a hospital sees when you share your records." />
    <LoadState loading={profile.loading} error={profile.error} retry={profile.reload} hasData={profile.data !== null} focusTarget={heading} />
    {shown && <div className="grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      {/* The card first, as on Home: on a phone it is the top of the page; on a computer it stays in view beside the sections. */}
      <div className="flex flex-col gap-6 lg:sticky lg:top-24">
        <HealthIdCard profile={shown} onChanged={profile.reload} verified={typeof shown.ninVerified === 'boolean' ? ninVerifiedOf(shown) : null}
          bloodGroup={health.error ? null : health.data?.bloodGroup} genotype={health.error ? null : health.data?.genotype}
          shareTo={share === true ? '/access/share' : '/access'} links={['share']} />
        {completion && <ProfileCompletionCard completion={completion} />}
      </div>
      <div className="patient-section">
        <OpenSectionsContext.Provider value={sections}>
          {/* Not the whole section busy while the profile reloads: the photo's, contact's and PIN's notices are in it. */}
          <ProfileSection id="bio-data" title="Bio-data" state={shown.dateOfBirth ? `Born ${date(shown.dateOfBirth)}` : null}>
            {/* The photo is changed on the card above (tap it), not here as well. */}
            <dl className="patient-details" aria-busy={profile.loading || undefined}>
              <div><dt>Full name</dt><dd>{shown.fullName}</dd></div>
              <div><dt>Date of birth</dt><dd>{date(shown.dateOfBirth)}</dd></div>
              <div><dt>Gender</dt><dd>{shown.gender || 'Not provided'}</dd></div>
              <div><dt>State</dt><dd>{shown.state || 'Not provided'}</dd></div>
              <div><dt>Country</dt><dd>{shown.country || 'Not provided'}</dd></div>
              <div><dt>Identity assurance</dt><dd>{plainCode(shown.assuranceState) === 'Not recorded' ? 'Not available' : plainCode(shown.assuranceState)}</dd></div>
            </dl>
            <ContactDetails profile={shown} onChanged={profile.reload} />
            <AccessPinSettings profile={shown} loading={profile.loading} onChanged={profile.reload} />
          </ProfileSection>
          <CoverageCard resource={details} />
          {/* The emergency contacts, in Health information (alone in it where the health information is not served). Both
              backends: main's patient-safety routes, and hid-system #109's on Novu. They read availability first, and
              show nothing where the routes are not served (Novu's 404), or while delivery is off for a patient without
              contacts. */}
          <HealthInformationCard resource={health} fromHid1={imported} contacts={alone => <EmergencyContactsCard alone={alone} />} />
          {imported && <ImportedHealthCard profile={imported} />}
          {/* Once verified, the card's badge says so; the section is only for doing it. */}
          {!ninVerifiedOf(shown) && <NinVerificationCard profile={shown} onVerified={profile.reload} />}
          {/* Both backends: hid-system main's 0064, and on Novu hid-system 0096. A backend that does not serve it answers 404,
              and the card shows nothing. */}
          <AccountDeletionCard />
        </OpenSectionsContext.Provider>
      </div>
    </div>}
  </div>
}

/** What each record section holds, as the page names it. */
const SECTION_NAMES: Readonly<Record<RecordSection, string>> = {
  encounters: 'completed encounters', notes: 'signed clinical notes', vitals: 'vitals', diagnoses: 'diagnoses',
  prescriptions: 'prescriptions', labRequests: 'laboratory requests', documents: 'uploaded clinical documents',
}
const ALL_SECTIONS = 'Everything your providers have signed, newest first.'
const WITHHELD = 'Not yet shared with patients in Health ID.'

/** The opening line until the record is read: what it holds is not known yet. */
const RECORD_UNREAD = 'Your health record, as it is shared with patients in Health ID.'

/**
 * The page's opening line. An EHR with hid-system #52 names what it released to
 * the patient, and only that is promised; one before it sends every section.
 * Nothing is named while the record is read, or when it could not be.
 */
function recordsIntro(data: PatientRecords | null) {
  if (!data) return RECORD_UNREAD
  if (usesNovuBackend()) return 'Your completed encounters, signed clinical notes and imported medical history.'
  if (!data.released) return ALL_SECTIONS
  const names = data.released.filter(section => section in SECTION_NAMES).map(section => SECTION_NAMES[section])
  if (names.length === 0) return 'No part of your record is shared with patients in Health ID yet.'
  const listed = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  return `Your ${listed}.${data.withheld?.length ? ' Other parts of your record are not yet shared with patients in Health ID.' : ''}`
}

/** An empty section's line: a withheld one was not released to the patient, which is not "none". */
function emptyText(data: PatientRecords, section: RecordSection, none: string) {
  return data.withheld?.includes(section) ? WITHHELD : none
}

/** Said only when EHR reports that the section holds more than it sent. */
function Truncated({ data, section }: { data: PatientRecords; section: RecordSection }) {
  if (data.truncated?.[section] !== true) return null
  const limit = data.limits?.[section]
  return <p className="patient-field-hint">{limit
    ? `Showing your ${limit} most recent ${SECTION_NAMES[section]}; older ones are not shown.`
    : `Showing only your most recent ${SECTION_NAMES[section]}; older ones are not shown.`}</p>
}

type Row<S extends RecordSection> = PatientRecords[S][number]

/**
 * What the search reads in each section (recordSearch.ts): what its rows show, their kind and their date, and the
 * day heading they are under. The records answer names a facility by id only and no clinician, so those are found
 * where a note's text names them.
 */
const SEARCHED: { readonly [S in RecordSection]: (item: Row<S>) => Array<string | null> } = {
  encounters: item => ['Encounter', item.encounterType, item.status, date(item.startedAt)],
  notes: item => ['Clinical note', item.title, item.noteType, item.status, item.content, date(item.signedAt)],
  vitals: item => ['Vitals', date(item.recordedAt), vitalsSummary(item)],
  diagnoses: item => ['Diagnosis', item.display, item.code, item.clinicalStatus, item.verificationStatus, item.notes],
  prescriptions: item => ['Prescription', item.medicationDisplay, item.frequency, item.instructions, item.status],
  labRequests: item => ['Laboratory request', item.testDisplay, item.priority, item.status, item.clinicalInformation, date(item.createdAt)],
  documents: item => ['Clinical document', item.fileName, item.mediaType, date(item.createdAt)],
}
/** The date each section's rows are listed under. */
const DATED: { readonly [S in RecordSection]: (item: Row<S>) => string | null } = {
  encounters: item => item.startedAt, notes: item => item.signedAt, vitals: item => item.recordedAt, diagnoses: item => item.onsetAt,
  prescriptions: item => item.startsOn, labRequests: item => item.createdAt, documents: item => item.createdAt,
}

const sectionMatches = <S extends RecordSection>(data: PatientRecords, section: S, query: string): Array<Row<S>> =>
  (data[section] as Array<Row<S>>).filter(item => matchesQuery([...SEARCHED[section](item), dayWords(DATED[section](item))], query))

/** How each section is named on its tab and card, and its icon. */
const SECTION_UI: { readonly [S in RecordSection]: { tab: string; title: string; icon: Icon } } = {
  encounters: { tab: 'Visits', title: 'Visits', icon: Stethoscope },
  notes: { tab: 'Notes', title: 'Clinical notes', icon: NotebookPen },
  vitals: { tab: 'Vitals', title: 'Vitals', icon: HeartPulse },
  diagnoses: { tab: 'Diagnoses', title: 'Diagnoses', icon: ClipboardList },
  prescriptions: { tab: 'Medicines', title: 'Medicines', icon: Pill },
  labRequests: { tab: 'Lab tests', title: 'Lab tests', icon: FlaskConical },
  documents: { tab: 'Documents', title: 'Documents', icon: FileText },
}

/** One record as it is shown in its drawer. */
interface OpenRecord { section: RecordSection; title: string; meta?: string; detail?: string | null; when: string | null; multiline?: boolean }

/** One record in a list: what it is, then its state, its words cut to two lines; the whole row opens it in a drawer. */
function RecordRow({ record, onOpen }: { record: OpenRecord; onOpen: (record: OpenRecord) => void }) {
  return <li><button type="button" onClick={() => onOpen(record)}
    className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-5 py-3.5 text-left font-[inherit] hover:bg-subtle">
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-medium [overflow-wrap:anywhere] text-ink">{record.title}</span>
      {record.meta && <span className="mt-0.5 block text-[13px] [overflow-wrap:anywhere] text-ink-3">{record.meta}</span>}
      {record.detail && <span className="mt-1.5 line-clamp-2 block text-[13px] leading-relaxed [overflow-wrap:anywhere] text-ink-2">{record.detail}</span>}
    </span>
    <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
  </button></li>
}

/** A section's card: its rows under their day, newest first, or why there are none. */
function SectionCard<S extends RecordSection>({ data, section, none, query, row }: {
  data: PatientRecords; section: S; none: string; query: string; row: (item: Row<S>) => ReactNode
}) {
  const all = data[section] as Array<Row<S>>
  const shown = sectionMatches(data, section, query)
  const ui = SECTION_UI[section]
  return <Card id={`records-${section}`}>
    <CardHeader as="h2" title={ui.title} icon={ui.icon} iconTone="brand"
      description={query.trim() && all.length > 0 ? `${shown.length} of ${all.length} match` : undefined} />
    {all.length === 0 ? <p className="m-0 px-5 pb-5 text-[13px] text-ink-3">{emptyText(data, section, none)}</p>
      : shown.length === 0 ? <p className="m-0 px-5 pb-5 text-[13px] text-ink-3">None match your search.</p>
      : groupByDay(shown, DATED[section]).map(group => <div key={group.day ?? 'undated'} className="border-t border-line">
        <h3 className="m-0 bg-subtle px-5 py-2 text-overline text-ink-3">{group.label}</h3>
        <ul className="m-0 list-none divide-y divide-line p-0">{group.items.map(row)}</ul></div>)}
    <div className="px-5 empty:hidden [&>p]:pb-4"><Truncated data={data} section={section} /></div>
  </Card>
}

/** The sections each backend sends: Novu serves encounters and notes, and imported history with them. */
const sectionsShown = (): RecordSection[] => usesNovuBackend() ? ['encounters', 'notes']
  : ['encounters', 'notes', 'vitals', 'diagnoses', 'prescriptions', 'labRequests', 'documents']

export function RecordsPage() {
  const { api } = useSession()
  useDocumentTitle('Health records · Health ID')
  const records = usePatientResource(api.records)
  const heading = useRef<HTMLHeadingElement>(null)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<RecordSection | 'all'>('all')
  // "Add a record" opens here, from this page's button or the ➕ (/records?add=record), and the address is cleared after.
  const [params, setParams] = useSearchParams()
  const adding = params.get('add') === 'record'
  const setAdding = (on: boolean) => setParams(current => { const next = new URLSearchParams(current); if (on) next.set('add', 'record'); else next.delete('add'); return next }, { replace: true })
  // hid-system main's imported records, read a page at a time beside the records (PatientImportedHistory).
  const [pagedImported, setPagedImported] = useState<readonly ImportedMedicalRecord[]>([])
  const data = records.data
  const searching = query.trim() !== ''
  const matched = data && searching ? sectionsShown().reduce((count, section) => count + sectionMatches(data, section, query).length,
    matchingImported([...data.importedRecords ?? [], ...pagedImported], query).length) : 0
  const ready = data && !records.error ? data : null
  // On All, a section with nothing in it (or nothing that matches) is left out: its tab still says 0.
  const visible = ready ? sectionsShown().filter(section => tab === section
    || (tab === 'all' && (searching ? sectionMatches(ready, section, query).length > 0 : (ready[section] as unknown[]).length > 0))) : []
  const [opened, setOpened] = useState<OpenRecord | null>(null)
  const row = (record: OpenRecord, key: string) => <RecordRow key={key} record={record} onOpen={setOpened} />
  const rows: { readonly [S in RecordSection]: (item: Row<S>) => ReactNode } = {
    encounters: item => row({ section: 'encounters', title: plainCode(item.encounterType), meta: plainCode(item.status), when: item.startedAt }, item.id),
    notes: item => row({ section: 'notes', title: item.title || plainCode(item.noteType), meta: plainCode(item.status), detail: item.content, when: item.signedAt, multiline: true }, item.id),
    vitals: item => row({ section: 'vitals', title: vitalsSummary(item) || 'Vitals', when: item.recordedAt }, item.id),
    diagnoses: item => row({ section: 'diagnoses', title: item.display, meta: `${item.codeSystem}: ${item.code} · ${item.clinicalStatus} · ${item.verificationStatus}`, detail: item.notes, when: item.onsetAt }, item.id),
    prescriptions: item => row({ section: 'prescriptions', title: item.medicationDisplay,
      meta: [item.doseQuantity != null ? `${item.doseQuantity} ${item.doseUnit || ''}`.trim() : '', item.frequency, item.status].filter(Boolean).join(' · '), detail: item.instructions, when: item.startsOn }, item.id),
    labRequests: item => row({ section: 'labRequests', title: item.testDisplay, meta: `${plainCode(item.priority)} · ${item.status}`, detail: item.clinicalInformation, when: item.createdAt }, item.id),
    documents: item => row({ section: 'documents', title: item.fileName, meta: `${item.mediaType} · ${bytes(item.sizeBytes)}`, when: item.createdAt }, item.id),
  }
  const NONE: { readonly [S in RecordSection]: string } = {
    encounters: 'No completed visits yet.', notes: 'No signed clinical notes yet.', vitals: 'No vitals recorded yet.', diagnoses: 'No diagnoses recorded.',
    prescriptions: 'No medicines prescribed.', labRequests: 'No lab tests requested.', documents: 'No documents uploaded.',
  }
  const count = (section: RecordSection) => ready ? (searching ? sectionMatches(ready, section, query) : ready[section] as unknown[]).length : 0

  return <div className="flex flex-col gap-6">
    <PageHeader titleRef={heading} title="Records" description={recordsIntro(records.error ? null : data)}
      actions={<Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add a record</Button>} />
    <LoadState loading={records.loading} error={records.error} retry={records.reload} hasData={data !== null} focusTarget={heading} />
    {/* hid-1.0's "Search by date, title, or keyword": over the records on this page; nothing is sent. */}
    {ready && <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div role="search" className="w-full lg:max-w-sm">
        <Input type="search" icon={Search} autoComplete="off" maxLength={200} value={query} onChange={event => setQuery(event.target.value)}
          placeholder="Search by date, type or words" aria-label="Search your records" aria-describedby="record-search-status" />
        {/* Mounted with the field, so each new count is announced. */}
        <p id="record-search-status" role="status" className="m-0 mt-1.5 text-[12px] text-ink-3 empty:hidden">{searching
          ? `${matched === 0 ? 'No records match' : matched === 1 ? '1 record matches' : `${matched} records match`} your search.` : ''}</p>
      </div>
      {sectionsShown().length > 1 && <FilterTabs label="Record type" value={tab} onChange={setTab}
        options={[{ value: 'all' as const, label: 'All' }, ...sectionsShown().map(section => ({ value: section, label: SECTION_UI[section].tab, count: count(section) }))]} />}
    </div>}
    {!usesNovuBackend() && tab === 'all' && <PatientImportedHistory api={api} query={query} onRecords={setPagedImported} />}
    {ready && <>
      {tab === 'all' && ready.importedRecords !== undefined && <ImportedHistory records={ready.importedRecords} query={query} groupedByDay
        limit={ready.limit} download={api.importedAttachment} allowLocalHttp={getEnvironment().name === 'local'} />}
      {/* Novu serves encounters, notes and imported history; the other sections belong to main-v1 and are absent from its response. */}
      {visible.map(section => <SectionCard key={section} data={ready} section={section} none={NONE[section]} query={query}
        row={rows[section] as (item: Row<typeof section>) => ReactNode} />)}
      {visible.length === 0 && !(ready.importedRecords?.length) && <EmptyState icon={searching ? Search : FolderHeart}
        title={searching ? 'Nothing matches' : 'No records yet'}
        description={searching ? 'Try a date like “March 2024”, a type like “vitals”, or a word from a note.' : 'Records from your providers appear here. You can add your own too, from any hospital, with a photo of the paper.'}
        action={searching ? undefined : <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add a record</Button>} />}
      <p className="m-0 flex items-center gap-1.5 text-[12px] text-ink-3"><Lock className="size-3.5" aria-hidden />Only you can see this page. Every view is recorded.</p>
    </>}
    <AddRecordDrawer open={adding} onClose={() => setAdding(false)} onSaved={() => void records.reload()} />
    {/* One record, in full, without losing the place in the list. */}
    <Drawer open={opened !== null} onClose={() => setOpened(null)} title={opened?.title ?? ''}
      icon={opened ? <IconChip icon={SECTION_UI[opened.section].icon} tone="brand" /> : undefined}
      description={opened ? [SECTION_UI[opened.section].title.replace(/s$/, ''), opened.when ? date(opened.when) : null].filter(Boolean).join(' · ') : undefined}
      footer={<Button onClick={() => setOpened(null)}>Close</Button>}>
      {opened && <div className="flex flex-col gap-4">
        {opened.meta && <p className="m-0 text-[13px] text-ink-2">{opened.meta}</p>}
        {opened.detail ? <p className={cx('m-0 rounded-xl bg-subtle px-4 py-3 text-sm leading-relaxed [overflow-wrap:anywhere] text-ink ring-1 ring-line', opened.multiline && 'whitespace-pre-wrap')}>{opened.detail}</p>
          : <p className="m-0 text-[13px] text-ink-3">Nothing more was written for this record.</p>}
        <p className="m-0 flex items-center gap-1.5 text-[12px] text-ink-3"><Lock className="size-3.5" aria-hidden />Opening it here is recorded, like every view of your record.</p>
      </div>}
    </Drawer>
  </div>
}

type HistoryItem = AccessHistory['items'][number]

/** Who holds a grant: the clinician at their facility for the patient's own share (hid-system 0095), else the facility. */
function grantee(item: HistoryItem) {
  return typeof item.clinicianName === 'string' && item.clinicianName.trim() ? `${item.clinicianName.trim()} at ${item.facilityName}` : item.facilityName
}

/** "Shared by you · View Only · 7 days" for the patient's own share; nothing for any other grant, or from an older backend. */
function sharedAs(item: HistoryItem) {
  const level = shareLevelLabel(item.shareLevel), duration = item.shareDuration === 'until_revoked' ? 'Until you end it'
    : shareDurationLabel(item.shareDuration)
  return level || duration ? ['Shared by you', level, duration].filter(Boolean).join(' · ') : null
}

export function AccessPage() {
  const { api } = useSession()
  useDocumentTitle('Access and consent · Health ID')
  const toast = useToast()
  const requests = usePatientResource(api.accessRequests)
  const history = usePatientResource(api.accessHistory)
  // Sharing (hid-system 0095): offered once the invitations card's read says it is served; hidden before (404).
  const shareServed = useShareServed()
  const [working, setWorking] = useState<string | null>(null)
  // The request open in the drawer, and whether its denial reason is showing.
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [denying, setDenying] = useState(false)
  const [reason, setReason] = useState('')
  // The grant whose revocation is open in the drawer, separately from an in-flight request.
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokeBusy, setRevokeBusy] = useState(false)
  const [revokeReason, setRevokeReason] = useState('')
  // Which part shows: what waits for a decision first (Hick's law: one list at a time).
  const [tab, setTab] = useState<'requests' | 'granted' | 'activity'>('requests')
  const requestsHeading = useRef<HTMLHeadingElement>(null)
  const historyHeading = useRef<HTMLHeadingElement>(null)
  const focusAfter = useActionFocus()
  const byId = (id: string) => () => document.getElementById(id)
  // A notice came, or one was read elsewhere (the bell's count changed): the page reads its lists again by itself.
  useOnNotificationChange(() => { void requests.reload(); void history.reload() })

  const decide = async (id: string, decision: 'approve' | 'deny') => {
    if (working) return
    const facility = requests.data?.find(item => item.accessRequestId === id)?.facilityName ?? 'The facility'
    setWorking(id)
    try {
      if (decision === 'approve') await api.approveAccess(id)
      else await api.denyAccess(id, reason.trim())
      // Decided once the lists show it: until then no decision can be sent again.
      await Promise.all([requests.reload(), history.reload()])
      closeReview()
      if (decision === 'approve') toast.success({ title: 'Approved', message: `${facility} can see your records now.` })
      else toast.success({ title: 'Denied', message: `Nothing was shared with ${facility}.` })
      focusAfter(() => requestsHeading.current)
    } catch (cause) {
      toast.error({ title: 'That didn’t go through', message: isHidApiError(cause) ? cause.message : 'The request could not be updated.' })
      focusAfter(byId(decision === 'approve' ? `approve-${id}` : `deny-reason-${id}`))
    } finally { setWorking(null) }
  }

  const revoke = async (grantId: string) => {
    if (revokeBusy || revokeReason.trim().length < 3) return
    const who = history.data?.items.find(item => item.consentGrantId === grantId)
    setRevokeBusy(true)
    try {
      await api.revokeAccess(grantId, revokeReason.trim())
      await history.reload()
      setRevoking(null); setRevokeReason('')
      toast.success({ title: 'Access ended', message: `${who ? grantee(who) : 'They'} can no longer see your records.` })
      focusAfter(() => historyHeading.current)
    } catch (cause) {
      toast.error({ title: 'Couldn’t end access', message: isHidApiError(cause) ? cause.message : 'The access grant could not be revoked.' })
      focusAfter(byId(`revoke-reason-${grantId}`))
    } finally { setRevokeBusy(false) }
  }

  // A reason typed for one item is never carried to another.
  const openReview = (id: string) => { if (reviewing !== id) { setReason(''); setDenying(false) } setReviewing(id) }
  function closeReview() { setReviewing(null); setDenying(false); setReason('') }
  const openRevocation = (id: string) => { if (revoking !== id) setRevokeReason(''); setRevoking(id) }

  const pendingCount = (requests.data && !requests.error ? requests.data : []).filter(item => item.status.toLowerCase() === 'pending').length
  const activeCount = (history.data && !history.error ? history.data.items : []).filter(item => item.status === 'active').length
  const requestList = requests.data && !requests.error
    ? [...requests.data].sort((x, y) => Number(y.status.toLowerCase() === 'pending') - Number(x.status.toLowerCase() === 'pending')) : null
  const open = requestList?.find(item => item.accessRequestId === reviewing) ?? null
  const ending = history.data?.items.find(item => item.consentGrantId === revoking) ?? null

  return <div className="flex flex-col gap-6">
    <PageHeader title="Access & sharing" description="No facility sees your records until you say yes. You can take access back at any time."
      actions={shareServed === true ? <Button to="/access/share" variant="primary" icon={Share2}>Share records</Button> : undefined} />
    <FilterTabs label="Access" value={tab} onChange={setTab} options={[
      { value: 'requests', label: 'Requests', count: pendingCount || undefined, tone: 'danger' },
      { value: 'granted', label: 'Who has access', count: activeCount || undefined },
      { value: 'activity', label: 'Activity' },
    ]} />

    {tab === 'requests' && <Card aria-busy={(requests.loading && requests.data !== null) || undefined}>
      <AccessHeading headingRef={requestsHeading} icon={ShieldCheck}
        title={pendingCount ? `${pendingCount === 1 ? '1 request needs' : `${pendingCount} requests need`} your decision` : 'Nothing waiting for you'}
        hint="Approve to share for the time asked. Deny and nothing is shared." />
      <div className="px-5 empty:hidden"><LoadState loading={requests.loading} error={requests.error} retry={requests.reload} hasData={requests.data !== null} focusTarget={requestsHeading} /></div>
      {requestList && (requestList.length === 0
        ? <p className="m-0 border-t border-line px-5 py-6 text-[13px] text-ink-3">When a facility asks to see your records, you decide here.</p>
        : <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
        {requestList.map(item => { const pending = item.status.toLowerCase() === 'pending'
          return <li key={item.accessRequestId}>
            <button type="button" id={`review-${item.accessRequestId}`} onClick={() => openReview(item.accessRequestId)}
              className={cx('flex w-full cursor-pointer items-center gap-3 border-0 px-5 py-4 text-left font-[inherit] hover:bg-subtle', pending ? 'bg-warn-soft/40' : 'bg-transparent')}>
              <IconChip icon={Building2} tone={pending ? 'warn' : 'neutral'} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold [overflow-wrap:anywhere] text-ink">{item.facilityName}</span>
                <span className="block text-[13px] text-ink-3">{pending ? `Wants to see your records${forHowLong(item.requestedDurationMinutes)}` : plainCode(item.status)} · {timeAgo(item.requestedAt)}</span>
              </span>
              {pending ? <span className={buttonClass({ variant: 'primary', size: 'sm' })}>Review</span>
                : <Badge tone={STATUS_TONE[item.status.toLowerCase()] ?? 'neutral'} size="sm">{plainCode(item.status)}</Badge>}
              <ItemName>the request from {item.facilityName}, {dateTime(item.requestedAt)}</ItemName>
            </button>
          </li> })}
      </ul>)}
    </Card>}

    {tab === 'granted' && <>
      {/* Novu (P4c): orders a clinician sent to another facility, with Stop until it is accepted. Main has no such list. */}
      {usesNovuBackend() && <SentOrdersCard />}
      <Card aria-busy={(history.loading && history.data !== null) || undefined}>
        <AccessHeading headingRef={historyHeading} icon={Building2}
          title={activeCount ? `${activeCount === 1 ? '1 facility has' : `${activeCount} facilities have`} access now` : 'No one has access now'}
          hint="Past access stays listed so you can see who had it, and when." />
        <div className="px-5 empty:hidden"><LoadState loading={history.loading} error={history.error} retry={history.reload} hasData={history.data !== null} focusTarget={historyHeading} /></div>
        {history.data && !history.error && (history.data.items.length === 0
          ? <p className="m-0 border-t border-line px-5 py-6 text-[13px] text-ink-3">Facilities you approve or share with appear here, with when their access ends.</p>
          : <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
          {history.data.items.map(item => <li key={item.consentGrantId} className="flex items-start gap-3 px-5 py-4">
            <IconChip icon={item.breakGlass ? Siren : Building2} tone={item.breakGlass ? 'danger' : item.status === 'active' ? 'success' : 'neutral'} />
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-semibold [overflow-wrap:anywhere] text-ink">{grantee(item)}</p>
              <p className="m-0 mt-0.5 text-[13px] text-ink-3">{item.breakGlass ? 'Emergency access' : plainCode(item.scope)} · until {date(item.expiresAt)}</p>
              {item.breakGlass && <p className="m-0 mt-2 text-[13px] text-ink-2">A provider used emergency access. It ends by itself and every view is recorded; it can’t be taken back here.</p>}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <Badge tone={STATUS_TONE[item.status] ?? 'neutral'} size="sm">{plainCode(item.status)}</Badge>
              {item.patientRevocable === true && <Button id={`revoke-${item.consentGrantId}`} size="sm" variant="ghost" className="!text-danger-ink" disabled={history.loading} onClick={() => openRevocation(item.consentGrantId)}>End access <ItemName>for {grantee(item)}, {item.scope}, from {dateTime(item.startsAt)}</ItemName></Button>}
            </div>
          </li>)}
        </ul>)}
      </Card>
      {/* hid-system 0095: invitations to share sent by email. A backend before it answers 404, and the section is not shown. */}
      <ShareInvitationsCard onShared={history.reload} />
    </>}

    {/* hid-system 0093: who viewed or changed the record. An Identity before it answers 404, and the section is not shown. */}
    {tab === 'activity' && <AccessLogCard />}

    {/* Reviewing a request: everything it asks for, then the decision, without leaving the list. */}
    <Drawer open={open !== null} onClose={closeReview} title={open?.facilityName ?? ''} icon={<IconChip icon={Building2} tone="warn" />}
      description={open ? `Asked ${timeAgo(open.requestedAt)} · ${dateTime(open.requestedAt)}` : undefined}
      footer={open && open.status.toLowerCase() === 'pending' ? (denying
        ? <><Button disabled={!!working} onClick={() => { setDenying(false); setReason(''); focusAfter(byId(`deny-${open.accessRequestId}`)) }}>Back</Button>
            <Button variant="destructive" type="submit" form="deny-form" loading={working === open.accessRequestId} disabled={!!working || reason.trim().length < 3}>Confirm denial</Button></>
        : <><Button id={`deny-${open.accessRequestId}`} icon={X} disabled={!!working || requests.loading} onClick={() => setDenying(true)}>Deny <ItemName>the request from {open.facilityName}, {open.scope}, {dateTime(open.requestedAt)}</ItemName></Button>
            <Button id={`approve-${open.accessRequestId}`} variant="primary" icon={Check} loading={working === open.accessRequestId} disabled={!!working || requests.loading} onClick={() => void decide(open.accessRequestId, 'approve')}>Approve <ItemName>the request from {open.facilityName}, {open.scope}, {dateTime(open.requestedAt)}</ItemName></Button></>)
        : <Button onClick={closeReview}>Close</Button>}>
      {open && <div className="flex flex-col gap-5">
        {open.reason && <blockquote className="m-0 rounded-xl bg-subtle px-4 py-3 text-sm [overflow-wrap:anywhere] text-ink ring-1 ring-line">“{open.reason}”</blockquote>}
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
          <div><dt className="text-ink-3">They want to</dt><dd className="m-0 mt-0.5 font-medium text-ink">{open.scope === 'read' ? 'See your records' : plainCode(open.scope)}</dd></div>
          <div><dt className="text-ink-3">For</dt><dd className="m-0 mt-0.5 font-medium text-ink">{forHowLong(open.requestedDurationMinutes).replace(/^ for /, '') || 'Not stated'}</dd></div>
          <div><dt className="text-ink-3">Status</dt><dd className="m-0 mt-0.5"><Badge tone={STATUS_TONE[open.status.toLowerCase()] ?? 'neutral'} size="sm">{plainCode(open.status)}</Badge></dd></div>
        </dl>
        {open.status.toLowerCase() === 'pending' && !denying && <p className="m-0 flex gap-2 text-[13px] text-ink-3"><Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />Nothing is shared until you approve. Every view is recorded, and you can end access at any time.</p>}
        {denying && <form id="deny-form" className="patient-form !mt-0" onSubmit={event => { event.preventDefault(); void decide(open.accessRequestId, 'deny') }}>
          <label>Why are you saying no?<textarea id={`deny-reason-${open.accessRequestId}`} autoFocus required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)}
            aria-describedby={`deny-reason-hint-${open.accessRequestId}`} /></label>
          <p id={`deny-reason-hint-${open.accessRequestId}`} className="patient-field-hint">The facility sees this. At least 3 characters.</p>
        </form>}
      </div>}
    </Drawer>

    {/* Ending a grant: who, until when, and why, with what an Access PIN still allows. */}
    <Drawer open={ending !== null} onClose={() => { const id = revoking; setRevoking(null); setRevokeReason(''); if (id) focusAfter(byId(`revoke-${id}`)) }}
      title="End access" icon={<IconChip icon={ShieldCheck} tone="danger" />} description={ending ? grantee(ending) : undefined}
      footer={ending && <><Button disabled={revokeBusy} onClick={() => { const id = revoking; setRevoking(null); setRevokeReason(''); if (id) focusAfter(byId(`revoke-${id}`)) }}>Cancel</Button>
        <Button variant="destructive" type="submit" form="revoke-form" loading={revokeBusy} disabled={revokeBusy || history.loading || revokeReason.trim().length < 3}>Confirm revocation</Button></>}>
      {ending && <div className="flex flex-col gap-5">
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
          <div><dt className="text-ink-3">Access</dt><dd className="m-0 mt-0.5 font-medium text-ink">{plainCode(ending.scope)}</dd></div>
          <div><dt className="text-ink-3">Purpose</dt><dd className="m-0 mt-0.5 font-medium text-ink">{ending.purpose}</dd></div>
          <div><dt className="text-ink-3">From</dt><dd className="m-0 mt-0.5 font-medium text-ink">{date(ending.startsAt)}</dd></div>
          <div><dt className="text-ink-3">Until</dt><dd className="m-0 mt-0.5 font-medium text-ink">{date(ending.expiresAt)}</dd></div>
          {sharedAs(ending) && <div className="col-span-2"><dt className="text-ink-3">How</dt><dd className="m-0 mt-0.5 font-medium text-ink">{sharedAs(ending)}</dd></div>}
        </dl>
        <form id="revoke-form" className="patient-form !mt-0" onSubmit={event => { event.preventDefault(); void revoke(ending.consentGrantId) }}>
          <label>Why are you ending access?<textarea id={`revoke-reason-${ending.consentGrantId}`} autoFocus required minLength={3} maxLength={500} value={revokeReason} onChange={event => setRevokeReason(event.target.value)}
            aria-describedby={`revoke-reason-hint-${ending.consentGrantId}`} /></label>
          <p id={`revoke-reason-hint-${ending.consentGrantId}`} className="patient-field-hint">At least 3 characters. If this facility has your Access PIN, it can use it to get access again. To stop that, change or remove your PIN in your profile’s Bio-data.</p>
        </form>
      </div>}
    </Drawer>
  </div>
}

const STATUS_TONE: Readonly<Record<string, 'success' | 'warn' | 'danger' | 'neutral'>> = {
  active: 'success', approved: 'success', pending: 'warn', denied: 'danger', revoked: 'danger', expired: 'neutral',
}

/** A card's own heading on Access: the icon, the title (where focus returns after a decision) and a short state. */
function AccessHeading({ headingRef, icon: I, title, hint }: { headingRef: RefObject<HTMLHeadingElement | null>; icon: Icon; title: string; hint: string }) {
  return <div className="flex items-center gap-3 px-5 py-4">
    <IconChip icon={I} tone="brand" />
    <div className="min-w-0"><h2 ref={headingRef} tabIndex={-1} className="m-0 text-title-3 text-ink">{title}</h2><p className="m-0 text-[13px] text-ink-3">{hint}</p></div>
  </div>
}

export function NotificationsPage() {
  const { api } = useSession()
  useDocumentTitle('Notifications · Health ID')
  const notifications = usePatientResource(api.notifications)
  const { settle } = useUnreadNotifications()
  const [working, setWorking] = useState<string | null>(null)
  const toast = useToast()
  const heading = useRef<HTMLHeadingElement>(null)
  const focusAfter = useActionFocus()
  // A notice came, or one was read in another window (the bell's count changed): the list is read again by itself.
  useOnNotificationChange(() => { void notifications.reload() })
  const markRead = async (id: string) => {
    setWorking(id)
    try { await api.markNotificationRead(id); await notifications.reload(); void settle(); toast.success('Marked as read'); focusAfter(() => heading.current) }
    catch (cause) {
      toast.error({ title: 'Couldn’t mark it as read', message: isHidApiError(cause) ? cause.message : 'Notification could not be updated.' })
      focusAfter(() => document.getElementById(`mark-read-${id}`))
    } finally { setWorking(null) }
  }
  const items = notifications.data && !notifications.error ? notifications.data : null
  const unreadCount = items ? items.filter(item => !item.readAt).length : 0
  return <div className="flex flex-col gap-6">
    <PageHeader titleRef={heading} title="Notifications" description={items ? (unreadCount ? `${unreadCount} unread` : 'You’re all caught up.') : undefined} />
    <LoadState loading={notifications.loading} error={notifications.error} retry={notifications.reload} hasData={notifications.data !== null} focusTarget={heading} />
    {items && (items.length === 0
      ? <EmptyState icon={Bell} title="No notifications" description="You'll hear here when a facility asks for, opens or is given access to your records." />
      : <Card aria-busy={notifications.loading || undefined}><ul className="m-0 list-none divide-y divide-line p-0">
        {items.map(item => <li key={item.id} className={cx('flex items-start gap-3 px-5 py-4', !item.readAt && 'bg-brand-soft/40')}>
          <span className="relative mt-0.5"><IconChip size="sm" icon={item.resourceType?.includes('request') ? ShieldCheck : item.resourceType?.includes('record') ? FolderHeart : Bell} tone={item.readAt ? 'neutral' : 'brand'} />
            {!item.readAt && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-brand ring-2 ring-surface" aria-hidden />}</span>
          <div className="min-w-0 flex-1">
            <p className={cx('m-0 text-sm [overflow-wrap:anywhere] text-ink', !item.readAt && 'font-semibold')}>{notificationTitle(item)}</p>
            <p className="m-0 mt-0.5 text-[13px] text-ink-3">{[item.resourceType && NOTIFICATION_SUBJECTS[item.resourceType], timeAgo(item.createdAt)].filter(Boolean).join(' · ')}<span className="sr-only">{item.readAt ? ', read' : ', unread'}</span></p>
          </div>
          {!item.readAt && <Button id={`mark-read-${item.id}`} size="sm" variant="ghost" disabled={working === item.id || notifications.loading} onClick={() => void markRead(item.id)}>Mark as read<ItemName>: {notificationTitle(item)}, {dateTime(item.createdAt)}</ItemName></Button>}
        </li>)}
      </ul></Card>)}
    <ImportedNotificationsCard />
    {/* Phone and computer notifications (B6): hid-system 0097 on Novu, once the owner has configured the push keys. Until
        Identity answers 200, the section shows nothing (a 404 before 0097, and while push is not configured). */}
    <DeviceNotificationsCard />
    <InstallAppCard afterward={heading} />
  </div>
}

/**
 * The patient's notifications from their hid-1.0 account (hid-system 0062, on staging-novu-ci-20261005), which the
 * bell counts while unread. Read once as the page opens, since each read is audited, and never again on a timer; a
 * read marked here changes the row in place. Title and message are hid-1.0's own text, shown as plain text. Not
 * shown when there are none, or where Identity does not serve them (404).
 */
function ImportedNotificationsCard() {
  const { api } = useSession()
  const { settle } = useUnreadNotifications()
  const load = useCallback((signal?: AbortSignal) => api.importedNotifications(0, signal).catch((caught: unknown) => {
    if (isHidApiError(caught) && caught.status === 404) return []
    throw caught
  }), [api])
  // Kept for the account under its own name: `load` is made again each time the card is.
  const first = usePatientResource<ImportedNotification[]>(load, 'imported-notifications')
  // Older pages "Show older" added; read marks made here, by id.
  const [older, setOlder] = useState<ImportedNotification[]>([])
  const [olderEnd, setOlderEnd] = useState(false)
  const [readHere, setReadHere] = useState<Readonly<Record<string, string>>>({})
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusAfter = useActionFocus()
  const retryFocus = useRetryFocus(heading)

  const seen = new Set<string>()
  const items = [...first.data ?? [], ...older].filter(item => !seen.has(item.id) && (seen.add(item.id), true))
    .map(item => readHere[item.id] && !item.readAt ? { ...item, readAt: readHere[item.id] ?? null } : item)
  if (first.error === null && items.length === 0) return null
  // A full page may have more after it.
  const more = !olderEnd && (older.length > 0 ? older.length % IMPORTED_NOTIFICATIONS_PAGE === 0
    : (first.data?.length ?? 0) === IMPORTED_NOTIFICATIONS_PAGE)

  const markRead = async (id: string) => {
    setWorking(id); setError(null)
    try {
      const answer = await api.markImportedNotificationRead(id)
      setReadHere(current => ({ ...current, [id]: answer?.readAt ?? new Date().toISOString() }))
      void settle()
      focusAfter(() => heading.current)
    } catch (cause) {
      setError(isHidApiError(cause) ? cause.message : 'Notification could not be updated.')
      focusAfter(() => document.getElementById(`mark-imported-read-${id}`))
    } finally { setWorking(null) }
  }
  const showOlder = async () => {
    setWorking('older'); setError(null)
    try {
      const page = await api.importedNotifications(items.length)
      setOlder(current => [...current, ...page])
      if (page.length < IMPORTED_NOTIFICATIONS_PAGE) setOlderEnd(true)
    } catch (cause) {
      setError(isHidApiError(cause) ? cause.message : 'Older notifications could not be loaded.')
    } finally { setWorking(null); focusAfter(() => document.getElementById('imported-notifications-older') ?? heading.current) }
  }

  return <div className="patient-card"><h2 ref={heading} tabIndex={-1}>From your hid-1.0 account</h2>
    <p className="patient-field-hint">Notifications you had in hid-1.0, carried over with your account.</p>
    {first.error && <div role="alert"><p>{first.error}</p>
      <button ref={retryFocus.button} type="button" onClick={() => retryFocus.retry(first.reload)}>Try again</button></div>}
    {error && <p role="alert" className="patient-inline-error">{error}</p>}
    {items.length > 0 && <ul className="patient-list">{items.map(item => <li key={item.id}><div>
      <strong>{item.title || 'A notification from hid-1.0'}</strong>
      {item.message && <p className="patient-multiline">{item.message}</p>}
      <span>{[dateTime(item.createdAt), item.readAt ? 'Read' : 'Unread'].join(' · ')}</span></div>
      {!item.readAt && <button id={`mark-imported-read-${item.id}`} type="button" disabled={working !== null} onClick={() => void markRead(item.id)}>
        Mark as read<ItemName>: {item.title || 'a notification from hid-1.0'}, {dateTime(item.createdAt)}</ItemName></button>}</li>)}</ul>}
    {more && <button id="imported-notifications-older" type="button" className="patient-secondary-button" disabled={working !== null}
      onClick={() => void showOlder()}>{working === 'older' ? 'Loading…' : 'Show older'}</button>}
  </div>
}

/**
 * Why a PIN change was refused. Setting and revoking it need a sign-in within the
 * last 10 minutes (hid-system recent-authentication.ts); the patient is signed in,
 * so 'sign in again' alone does not say how, as on account deletion.
 */
function pinProblem(cause: unknown, fallback: string) {
  if (!isHidApiError(cause)) return fallback
  return cause.code === 'PATIENT_RECENT_AUTH_REQUIRED'
    ? 'For your security, sign out, sign in again, and return here within 10 minutes to change your Access PIN.' : cause.message
}

/**
 * The Access PIN, at the end of Bio-data (moved there from Settings, which is gone: the owner's decision of
 * 2026-10-28): its status, Set or Replace PIN, and Revoke. A refused PIN is tied to its field (PR-07), as a refused
 * NIN is.
 */
function AccessPinSettings({ profile, loading, onChanged }: {
  profile: PatientProfile; loading: boolean; onChanged: () => Promise<unknown>
}) {
  const { api } = useSession()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pinFieldError, setPinFieldError] = useState(false)
  const [errorAlert, setErrorAlert] = useState(true)
  const pinHeading = useRef<HTMLHeadingElement>(null)
  // Save PIN is disabled once the field is cleared, so focus goes back to the field.
  const pinFocus = useStepFocus()
  const revokePinButton = useRef<HTMLButtonElement>(null)
  const focusAfter = useActionFocus()

  const configurePin = async (event: FormEvent) => {
    event.preventDefault(); if (busy || !/^\d{4,8}$/.test(pin)) return
    const fromField = pinFocus.onTarget()
    setBusy(true); setError(null); setNotice(null); setPinFieldError(false); setErrorAlert(true)
    try { await api.setAccessPin(pin); setPin(''); setNotice('Access PIN configured.'); await onChanged() }
    catch (cause) {
      const aboutField = isFieldProblem(cause)
      setError(pinProblem(cause, 'Access PIN could not be updated.'))
      setPinFieldError(aboutField); setErrorAlert(!aboutField || fromField)
    } finally { setBusy(false); pinFocus.focus() }
  }
  const revokePin = async () => {
    if (busy) return
    setBusy(true); setError(null); setNotice(null); setPinFieldError(false); setErrorAlert(true)
    try { await api.revokeAccessPin(); setNotice('Access PIN revoked.'); await onChanged(); focusAfter(() => pinHeading.current) }
    catch (cause) {
      setError(pinProblem(cause, 'Access PIN could not be revoked.'))
      focusAfter(() => revokePinButton.current)
    } finally { setBusy(false) }
  }

  return <div id="access-pin" className="patient-access-pin">
    <h3 ref={pinHeading} tabIndex={-1}>Access PIN</h3>
    {error && <p id="access-pin-error" role={errorAlert ? 'alert' : undefined} className="patient-inline-error">{error}</p>}
    <div role="status">{notice && <p className="patient-inline-success">{notice}</p>}</div>
    <p id="access-pin-hint" className="patient-field-hint">4 to 8 digits. You must have signed in within the last 10 minutes to change it.</p>
    <p aria-busy={loading || undefined}>Status: <strong>{profile.accessPinConfigured ? 'Configured' : 'Not configured'}</strong></p>
    <form onSubmit={event => void configurePin(event)} className="patient-form patient-inline-form"><label>{profile.accessPinConfigured ? 'Replace PIN' : 'Set PIN'}<input ref={pinFocus.target} required type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4,8}" minLength={4} maxLength={8} value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
      aria-invalid={pinFieldError || undefined} aria-describedby={describedBy('access-pin-hint', pinFieldError && 'access-pin-error')} /></label>
      <button type="submit" className="patient-primary-button" disabled={busy || !/^\d{4,8}$/.test(pin)}>Save PIN</button></form>
    {profile.accessPinConfigured && <button ref={revokePinButton} type="button" className="patient-secondary-button" disabled={busy || loading} onClick={() => void revokePin()}>Revoke Access PIN</button>}
  </div>
}

/**
 * Settings is gone (the owner's decision of 2026-10-28): its Access PIN, emergency contacts and account deletion are on
 * the profile, and Google sign-in links by the verified email, so there is nothing to link here. An old link opens the
 * profile at the same # (/settings#emergency-contacts opens Health information there).
 */
export function SettingsRedirect() {
  const { hash } = useLocation()
  return <Navigate to={{ pathname: '/profile', hash }} replace />
}
