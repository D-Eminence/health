import { ImportedHistory, matchingImported } from '../ImportedHistory'
import { usesNovuBackend } from '../backendContract'
import { PatientImportedHistory } from '../ImportedHistoryPage'
import { getEnvironment } from '../env'
import { useCallback, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
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
import { revealFocusedLink } from '../navStrip'
import { describedBy, isFieldProblem, useDocumentTitle, useStepFocus } from '../authSteps'
import { useFocusOnPageChange } from '../pageFocus'
import { SentOrdersCard } from './SentOrders'
import { NinVerificationCard } from './NinVerificationCard'
import { HealthIdCode } from './HealthIdCode'
import { dayWords, groupByDay, matchesQuery } from './recordSearch'
import { NOTIFICATION_SUBJECTS, notificationTitle } from './notificationTitles'
import { AccessLogCard } from './AccessLog'
import { NotificationBell, UnreadNotificationsProvider, useOnNotificationChange, useUnreadNotifications } from '../notificationBadge'
import { ProfileChangeProvider, useOnProfileChange } from '../profileChange'
import { useFocusSectionFromHash, useOpenSections } from './sectionFocus'
import { OpenSectionsContext, ProfileSection } from './ProfileSection'
import { completionOf, useProfileSources } from './profileSources'
import { completionServed } from './profileCompletion'
import { ProfileCompletionCard } from './ProfileCompletion'
import { ContactDetails } from './ProfileContact'
import { Avatar, ProfilePhotoControl, usePatientPhoto } from './ProfilePhoto'
import { CoverageCard } from './ProfileCoverage'
import { HealthInformationCard } from './HealthInformation'
import { ShareInvitationsCard } from './ShareInvitations'
import { useShareServed } from '../shareServed'
import { shareDurationLabel, shareLevelLabel } from '../shareRecords'

const links = [
  { to: '/', label: 'Overview', end: true },
  { to: '/profile', label: 'Profile' },
  { to: '/records', label: 'Records' },
  { to: '/access', label: 'Access' },
  { to: '/notifications', label: 'Notifications' },
] as const

function date(value: string | null | undefined) {
  if (!value) return 'Not available'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(parsed)
}

function dateTime(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
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
  const { signOut } = useSession()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const main = useRef<HTMLElement>(null)
  const signOutButton = useRef<HTMLButtonElement>(null)
  const focusAfter = useActionFocus()
  useFocusOnPageChange(main)
  const logout = async () => {
    setSigningOut(true); setError(null)
    try { await signOut(); navigate('/sign-in', { replace: true }) }
    catch (reason) {
      setError(isHidApiError(reason) ? reason.message : 'Sign-out failed. Please try again.')
      focusAfter(() => signOutButton.current)
    } finally { setSigningOut(false) }
  }

  // The bell's count is read here, for every page under the shell (notificationBadge.tsx).
  return <UnreadNotificationsProvider><ProfileChangeProvider><div className="patient-app">
    <header className="patient-app-header"><div className="patient-app-header-inner">
      <NavLink to="/" className="patient-app-logo" aria-label="Health ID home"><BrandLogo /></NavLink>
      <span className="patient-header-title">Patient portal</span>
      <NotificationBell />
      <HeaderAvatar />
      <button ref={signOutButton} type="button" className="patient-signout" onClick={() => void logout()} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
    </div></header>
    <div className="patient-app-body"><nav className="patient-side-nav" aria-label="Patient pages" onFocus={revealFocusedLink}>
      {patientChatEnabled() && <NavLink to="/chat" className="patient-nav-link">Ask about your records</NavLink>}
      {links.map(link => <NavLink key={link.to} to={link.to} end={'end' in link ? link.end : false} className={({ isActive }) => isActive ? 'patient-nav-link active' : 'patient-nav-link'}>{link.label}</NavLink>)}
    </nav><main ref={main} className="patient-main" id="main">{error && <p role="alert" className="patient-inline-error">{error}</p>}<Outlet /></main></div>
  </div></ProfileChangeProvider></UnreadNotificationsProvider>
}

/**
 * The patient's photo, or their initials, in the header, linking to their profile (hid-1.0's profile pill; parity B3).
 * The photo is read only when Identity says there is one, and again when the profile page changes it.
 */
function HeaderAvatar() {
  const { api } = useSession()
  const profile = usePatientResource(api.profile)
  const shown = profile.data && !profile.error && typeof profile.data === 'object' ? profile.data : null
  const photo = usePatientPhoto(shown?.hasPhoto === true)
  useOnProfileChange(() => { void profile.reload().then(() => photo.reload()) })
  return <NavLink to="/profile" className="patient-avatar-link" aria-label="Your profile">
    <Avatar profile={shown} url={photo.url} size="small" /></NavLink>
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

  return <section className="patient-section"><p className="patient-eyebrow">Identity</p><h1 ref={heading} tabIndex={-1} className="patient-page-title">Your profile</h1>
    <p className="patient-page-copy">These details come from your verified Health ID account.</p>
    <LoadState loading={profile.loading} error={profile.error} retry={profile.reload} hasData={profile.data !== null} focusTarget={heading} />
    {shown && completion && <ProfileCompletionCard completion={completion} />}
    <OpenSectionsContext.Provider value={sections}>
      {/* Not the whole section busy while the profile reloads: the photo's, contact's and PIN's notices are in it. */}
      {shown && <ProfileSection id="bio-data" title="Bio-data">
        {completionServed(shown) && <ProfilePhotoControl profile={shown} onChanged={profile.reload} />}
        <dl className="patient-details" aria-busy={profile.loading || undefined}>
          <div><dt>Health ID</dt><dd><HealthIdCode code={shown.hid} /></dd></div>
          <div><dt>Full name</dt><dd>{shown.fullName}</dd></div>
          <div><dt>Date of birth</dt><dd>{date(shown.dateOfBirth)}</dd></div>
          <div><dt>Gender</dt><dd>{shown.gender || 'Not provided'}</dd></div>
          <div><dt>State</dt><dd>{shown.state || 'Not provided'}</dd></div>
          <div><dt>Country</dt><dd>{shown.country || 'Not provided'}</dd></div>
          <div><dt>Identity assurance</dt><dd>{shown.assuranceState || 'Not available'}</dd></div>
        </dl>
        <ContactDetails profile={shown} onChanged={profile.reload} />
        <AccessPinSettings profile={shown} loading={profile.loading} onChanged={profile.reload} />
      </ProfileSection>}
      {shown && <CoverageCard resource={details} />}
      {/* The emergency contacts, in Health information (alone in it where the health information is not served). Both
          backends: main's patient-safety routes, and hid-system #109's on Novu. They read availability first, and
          show nothing where the routes are not served (Novu's 404), or while delivery is off for a patient without
          contacts. */}
      {shown && <HealthInformationCard resource={health} fromHid1={imported} contacts={alone => <EmergencyContactsCard alone={alone} />} />}
      {shown && imported && <ImportedHealthCard profile={imported} />}
      {shown && <NinVerificationCard profile={shown} onVerified={profile.reload} />}
      {/* Both backends: hid-system main's 0064, and on Novu hid-system 0096. A backend that does not serve it answers 404,
          and the card shows nothing. */}
      {shown && <AccountDeletionCard />}
    </OpenSectionsContext.Provider>
  </section>
}

/** What each record section holds, as the page names it. */
const SECTION_NAMES: Readonly<Record<RecordSection, string>> = {
  encounters: 'completed encounters', notes: 'signed clinical notes', vitals: 'vitals', diagnoses: 'diagnoses',
  prescriptions: 'prescriptions', labRequests: 'laboratory requests', documents: 'uploaded clinical documents',
}
const ALL_SECTIONS = 'Your completed encounters, clinical notes, vitals, diagnoses, prescriptions, laboratory requests and uploaded clinical documents.'
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

/** A section's card: its rows under their day, newest first, or why there are none. */
function SectionCard<S extends RecordSection>({ data, section, title, none, query, row }: {
  data: PatientRecords; section: S; title: string; none: string; query: string; row: (item: Row<S>) => ReactNode
}) {
  const all = data[section] as Array<Row<S>>
  const shown = sectionMatches(data, section, query)
  return <div className="patient-card"><h2>{title}</h2>
    {all.length === 0 ? <p className="patient-empty">{emptyText(data, section, none)}</p>
      : shown.length === 0 ? <p className="patient-empty">No {SECTION_NAMES[section]} match your search.</p>
      : groupByDay(shown, DATED[section]).map(group => <div key={group.day ?? 'undated'} className="patient-day-group">
        <h3 className="patient-day-heading">{group.label}</h3><ul className="patient-list">{group.items.map(row)}</ul></div>)}
    <Truncated data={data} section={section} /></div>
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
  // hid-system main's imported records, read a page at a time beside the records (PatientImportedHistory).
  const [pagedImported, setPagedImported] = useState<readonly ImportedMedicalRecord[]>([])
  const data = records.data
  const searching = query.trim() !== ''
  const matched = data && searching ? sectionsShown().reduce((count, section) => count + sectionMatches(data, section, query).length,
    matchingImported([...data.importedRecords ?? [], ...pagedImported], query).length) : 0
  return <section className="patient-section"><p className="patient-eyebrow">Care history</p><h1 ref={heading} tabIndex={-1} className="patient-page-title">Health records</h1>
    <p className="patient-page-copy">{recordsIntro(records.error ? null : data)}</p>
    <LoadState loading={records.loading} error={records.error} retry={records.reload} hasData={data !== null} focusTarget={heading} />
    {/* hid-1.0's "Search by date, title, or keyword": over the records on this page; nothing is sent. */}
    {data && !records.error && <div role="search" className="patient-record-search">
      <label>Search your records<input type="search" autoComplete="off" maxLength={200} value={query} onChange={event => setQuery(event.target.value)}
        aria-describedby="record-search-hint" /></label>
      <p id="record-search-hint" className="patient-field-hint">Find a record by its date, type, title or the words in it.</p>
      {/* Mounted with the field, so each new count is announced. */}
      <p role="status" className="patient-field-hint">{searching
        ? `${matched === 0 ? 'No records match' : matched === 1 ? '1 record matches' : `${matched} records match`} your search.` : ''}</p>
    </div>}
    {!usesNovuBackend() && <PatientImportedHistory api={api} query={query} onRecords={setPagedImported} />}
    {data && !records.error && <>
      {data.importedRecords !== undefined && <ImportedHistory records={data.importedRecords} query={query} groupedByDay
        limit={data.limit} download={api.importedAttachment} allowLocalHttp={getEnvironment().name === 'local'} />}
      <SectionCard data={data} section="encounters" title="Encounters" none="No completed encounters are available." query={query}
        row={item => <li key={item.id}><div><strong>{item.encounterType}</strong><span>{date(item.startedAt)} · {item.status}</span></div></li>} />
      <SectionCard data={data} section="notes" title="Clinical notes" none="No signed clinical notes are available." query={query}
        row={item => <li key={item.id} className="patient-note"><div><strong>{item.title || item.noteType}</strong><span>{date(item.signedAt)} · {item.status}</span></div><p>{item.content}</p></li>} />
      {/* Novu serves encounters, notes and imported history; these additional
          aggregate sections belong to main-v1 and are absent from its response. */}
      {!usesNovuBackend() && <>
      <SectionCard data={data} section="vitals" title="Vitals" none="No vitals are available." query={query}
        row={item => <li key={item.id}><div><strong>{date(item.recordedAt)}</strong><span>{vitalsSummary(item)}</span></div></li>} />
      <SectionCard data={data} section="diagnoses" title="Diagnoses" none="No diagnoses are available." query={query}
        row={item => <li key={item.id}><div><strong>{item.display}</strong><span>{item.codeSystem}: {item.code} · {item.clinicalStatus} · {item.verificationStatus}</span></div>{item.notes && <p>{item.notes}</p>}</li>} />
      <SectionCard data={data} section="prescriptions" title="Prescriptions" none="No prescriptions are available." query={query}
        row={item => <li key={item.id}><div><strong>{item.medicationDisplay}</strong><span>{item.doseQuantity != null ? `${item.doseQuantity} ${item.doseUnit || ''}` : ''}{item.frequency ? ` · ${item.frequency}` : ''} · {item.status}</span></div><p>{item.instructions}</p></li>} />
      <SectionCard data={data} section="labRequests" title="Laboratory requests" none="No laboratory requests are available." query={query}
        row={item => <li key={item.id}><div><strong>{item.testDisplay}</strong><span>{item.priority} · {item.status} · {date(item.createdAt)}</span></div>{item.clinicalInformation && <p>{item.clinicalInformation}</p>}</li>} />
      <SectionCard data={data} section="documents" title="Clinical documents" none="No clinical documents are available." query={query}
        row={item => <li key={item.id}><div><strong>{item.fileName}</strong><span>{item.mediaType} · {bytes(item.sizeBytes)} · {date(item.createdAt)}</span></div></li>} />
      </>}
      <p className="patient-field-hint">The record aggregate is scoped to your authenticated patient identity and audited by the backend.</p>
    </>}
  </section>
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

/**
 * How long the facility asked for access, so the patient sees it before approving (D4): " · for 8 hours". Nothing
 * when the request does not say.
 */
function accessLength(minutes: number | undefined): string {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return ''
  if (minutes % 60 !== 0) return ` · for ${minutes} minutes`
  const hours = minutes / 60
  return ` · for ${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

export function AccessPage() {
  const { api } = useSession()
  useDocumentTitle('Access and consent · Health ID')
  const requests = usePatientResource(api.accessRequests)
  const history = usePatientResource(api.accessHistory)
  // Sharing (hid-system 0095): offered once the invitations card's read says it is served; hidden before (404).
  const shareServed = useShareServed()
  const [working, setWorking] = useState<string | null>(null)
  const [denying, setDenying] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  // Which grant's revocation form is open, separately from an in-flight request.
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokeBusy, setRevokeBusy] = useState(false)
  const [revokeReason, setRevokeReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const requestsHeading = useRef<HTMLHeadingElement>(null)
  const historyHeading = useRef<HTMLHeadingElement>(null)
  const focusAfter = useActionFocus()
  const byId = (id: string) => () => document.getElementById(id)
  // A notice came, or one was read elsewhere (the bell's count changed): the page reads its lists again by itself.
  useOnNotificationChange(() => { void requests.reload(); void history.reload() })

  const decide = async (id: string, decision: 'approve' | 'deny') => {
    if (working) return
    setWorking(id); setError(null); setNotice(null)
    try {
      if (decision === 'approve') await api.approveAccess(id)
      else await api.denyAccess(id, reason.trim())
      setDenying(null); setReason('')
      setNotice(`Request ${decision === 'approve' ? 'approved' : 'denied'}.`)
      // Decided once the lists show it: until then no decision can be sent again.
      await Promise.all([requests.reload(), history.reload()])
      focusAfter(() => requestsHeading.current)
    } catch (cause) {
      setError(isHidApiError(cause) ? cause.message : 'The request could not be updated.')
      focusAfter(byId(decision === 'approve' ? `approve-${id}` : `deny-reason-${id}`))
    } finally { setWorking(null) }
  }

  const revoke = async (grantId: string) => {
    if (revokeBusy || revokeReason.trim().length < 3) return
    setRevokeBusy(true); setError(null); setNotice(null)
    try {
      await api.revokeAccess(grantId, revokeReason.trim())
      setRevoking(null); setRevokeReason('')
      setNotice('Access grant revoked.')
      await history.reload()
      focusAfter(() => historyHeading.current)
    } catch (cause) {
      setError(isHidApiError(cause) ? cause.message : 'The access grant could not be revoked.')
      focusAfter(byId(`revoke-reason-${grantId}`))
    } finally { setRevokeBusy(false) }
  }

  // A reason typed for one item is never carried to another.
  const openDenial = (id: string) => { if (denying !== id) setReason(''); setDenying(id) }
  const cancelDenial = (id: string) => { setDenying(null); setReason(''); focusAfter(byId(`deny-${id}`)) }
  const openRevocation = (id: string) => { if (revoking !== id) setRevokeReason(''); setRevoking(id) }
  const cancelRevocation = (id: string) => { setRevoking(null); setRevokeReason(''); focusAfter(byId(`revoke-${id}`)) }

  return <section className="patient-section"><p className="patient-eyebrow">Consent</p><h1 className="patient-page-title">Access and consent</h1>
    <p className="patient-page-copy">Review requests before deciding whether a facility can access information within the requested scope.</p>
    {shareServed === true && <p><Link className="patient-primary-button" to="/access/share">Share my records</Link></p>}
    {error && <p role="alert" className="patient-inline-error">{error}</p>}
    <div role="status">{notice && <p className="patient-inline-success">{notice}</p>}</div>
    <div className="patient-card" aria-busy={(requests.loading && requests.data !== null) || undefined}><h2 ref={requestsHeading} tabIndex={-1}>Access requests</h2>
      <LoadState loading={requests.loading} error={requests.error} retry={requests.reload} hasData={requests.data !== null} focusTarget={requestsHeading} />
      {requests.data && !requests.error && (requests.data.length === 0 ? <p className="patient-empty">There are no access requests.</p> : <ul className="patient-list">
        {requests.data.map(item => <li key={item.accessRequestId} className="patient-access-item"><div><strong>{item.facilityName}</strong><span>{item.scope} · {date(item.requestedAt)} · {item.status}{accessLength(item.requestedDurationMinutes)}</span><p>{item.reason}</p></div>
          {item.status.toLowerCase() === 'pending' && <div className="patient-decision-actions"><button id={`approve-${item.accessRequestId}`} type="button" className="patient-primary-button" disabled={!!working || requests.loading} onClick={() => void decide(item.accessRequestId, 'approve')}>Approve <ItemName>the request from {item.facilityName}, {item.scope}, {dateTime(item.requestedAt)}</ItemName></button>
            <button id={`deny-${item.accessRequestId}`} type="button" className="patient-secondary-button" disabled={!!working || requests.loading} onClick={() => openDenial(item.accessRequestId)}>Deny <ItemName>the request from {item.facilityName}, {item.scope}, {dateTime(item.requestedAt)}</ItemName></button></div>}
          {denying === item.accessRequestId && <form className="patient-deny-form" onSubmit={event => { event.preventDefault(); void decide(item.accessRequestId, 'deny') }}><label>Reason for denial<input id={`deny-reason-${item.accessRequestId}`} autoFocus required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)}
              aria-describedby={`deny-reason-hint-${item.accessRequestId}`} /></label>
            <p id={`deny-reason-hint-${item.accessRequestId}`} className="patient-field-hint">At least 3 characters.</p><button type="submit" disabled={!!working || requests.loading || reason.trim().length < 3}>Confirm denial</button>
            <button type="button" className="patient-secondary-button" disabled={!!working} onClick={() => cancelDenial(item.accessRequestId)}>Cancel</button></form>}
        </li>)}
      </ul>)}</div>
    {/* Novu (P4c): orders a clinician sent to another facility, with Stop until it is accepted. Main has no such list. */}
    {usesNovuBackend() && <SentOrdersCard />}
    <div className="patient-card" aria-busy={(history.loading && history.data !== null) || undefined}><h2 ref={historyHeading} tabIndex={-1}>Access history</h2>
      <LoadState loading={history.loading} error={history.error} retry={history.reload} hasData={history.data !== null} focusTarget={historyHeading} />
      {history.data && !history.error && (history.data.items.length === 0 ? <p className="patient-empty">No access grants are recorded.</p> : <ul className="patient-list">
        {history.data.items.map(item => <li key={item.consentGrantId}><div><strong>{grantee(item)}</strong><span>{item.breakGlass ? 'Emergency access' : item.scope} · {item.purpose}</span>
          {sharedAs(item) && <span>{sharedAs(item)}</span>}
          <span>{date(item.startsAt)} to {date(item.expiresAt)} · {item.status}</span>
          {item.breakGlass && <p>A provider used emergency access. It is time-limited and audited; it cannot be revoked here.</p>}</div>
          {item.patientRevocable === true && <div className="patient-decision-actions">
            {revoking === item.consentGrantId
              ? <form className="patient-deny-form" onSubmit={event => { event.preventDefault(); void revoke(item.consentGrantId) }}><label>Reason for revocation<input id={`revoke-reason-${item.consentGrantId}`} autoFocus required minLength={3} maxLength={500} value={revokeReason} onChange={event => setRevokeReason(event.target.value)}
                  aria-describedby={`revoke-reason-hint-${item.consentGrantId}`} /></label>
                <p id={`revoke-reason-hint-${item.consentGrantId}`} className="patient-field-hint">At least 3 characters. If this facility has your Access PIN, it can use it to get access again. To stop that, change or remove your PIN in your profile’s Bio-data.</p><button type="submit" disabled={revokeBusy || history.loading || revokeReason.trim().length < 3}>Confirm revocation</button>
                <button type="button" className="patient-secondary-button" disabled={revokeBusy} onClick={() => cancelRevocation(item.consentGrantId)}>Cancel</button></form>
              : <button id={`revoke-${item.consentGrantId}`} type="button" className="patient-secondary-button" disabled={history.loading} onClick={() => openRevocation(item.consentGrantId)}>Revoke access <ItemName>for {grantee(item)}, {item.scope}, from {dateTime(item.startsAt)}</ItemName></button>}
          </div>}
        </li>)}
      </ul>)}</div>
    {/* hid-system 0095: invitations to share sent by email. A backend before it answers 404, and the section is not shown. */}
    <ShareInvitationsCard onShared={history.reload} />
    {/* hid-system 0093: who viewed or changed the record. An Identity before it answers 404, and the section is not shown. */}
    <AccessLogCard />
  </section>
}

export function NotificationsPage() {
  const { api } = useSession()
  useDocumentTitle('Notifications · Health ID')
  const notifications = usePatientResource(api.notifications)
  const { settle } = useUnreadNotifications()
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusAfter = useActionFocus()
  // A notice came, or one was read in another window (the bell's count changed): the list is read again by itself.
  useOnNotificationChange(() => { void notifications.reload() })
  const markRead = async (id: string) => {
    setWorking(id); setError(null)
    try { await api.markNotificationRead(id); await notifications.reload(); void settle(); focusAfter(() => heading.current) }
    catch (cause) {
      setError(isHidApiError(cause) ? cause.message : 'Notification could not be updated.')
      focusAfter(() => document.getElementById(`mark-read-${id}`))
    } finally { setWorking(null) }
  }
  return <section className="patient-section"><p className="patient-eyebrow">Updates</p><h1 ref={heading} tabIndex={-1} className="patient-page-title">Notifications</h1>
    {/* Phone and computer notifications (B6): hid-system 0097 on Novu, once the owner has configured the push keys. Until
        Identity answers 200, the section shows nothing (a 404 before 0097, and while push is not configured). */}
    <DeviceNotificationsCard />
    <InstallAppCard afterward={heading} />
    <LoadState loading={notifications.loading} error={notifications.error} retry={notifications.reload} hasData={notifications.data !== null} focusTarget={heading} />
    {error && <p role="alert" className="patient-inline-error">{error}</p>}
    {notifications.data && !notifications.error && <div className="patient-card" aria-busy={notifications.loading || undefined}>{notifications.data.length === 0 ? <p className="patient-empty">You have no notifications.</p> : <ul className="patient-list">
      {notifications.data.map(item => <li key={item.id}><div><strong>{notificationTitle(item)}</strong><span>{[item.resourceType && NOTIFICATION_SUBJECTS[item.resourceType], date(item.createdAt), item.readAt ? 'Read' : 'Unread'].filter(Boolean).join(' · ')}</span></div>
        {!item.readAt && <button id={`mark-read-${item.id}`} type="button" disabled={working === item.id || notifications.loading} onClick={() => void markRead(item.id)}>Mark as read<ItemName>: {notificationTitle(item)}, {dateTime(item.createdAt)}</ItemName></button>}</li>)}
    </ul>}</div>}
    <ImportedNotificationsCard />
  </section>
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
