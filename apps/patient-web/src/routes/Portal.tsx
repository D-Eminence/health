import { ImportedHistory, matchingImported } from '../ImportedHistory'
import { usesNovuBackend } from '../backendContract'
import { PatientImportedHistory } from '../ImportedHistoryPage'
import { getEnvironment } from '../env'
import { useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { HEALTH_ID_PREFIX, emailOrHealthId, healthIdOrOtherInput, isBlankHealthIdInput } from '@hid/contracts'
import { isHidApiError } from '@hid/http'
import { PasswordInput } from '@hid/ui'
import { GoogleButton } from '../GoogleButton'
import { googleClientId } from '../googleClient'
import { Turnstile } from '../Turnstile'
import { BrandLogo } from '../BrandLogo'
import { ItemName } from '../ItemName'
import { useSession } from '../session'
import type { PatientNotification, PatientRecords, RecordSection } from '../api'
import { IMPORTED_HEALTH_FIELDS, type ImportedHealthField, type ImportedHealthProfile, type ImportedMedicalRecord } from '../importedRecords'
import { patientChatEnabled } from '../chatFeatures'
import { usePatientResource } from './usePatientResource'
import { useActionFocus, useRetryFocus } from './actionFocus'
import { AccountDeletionCard, EmergencyContactsCard } from './AccountSafety'
import { revealFocusedLink } from '../navStrip'
import { describedBy, isFieldProblem, useDocumentTitle, useStepFocus } from '../authSteps'
import { useFocusOnPageChange } from '../pageFocus'
import { SentOrdersCard } from './SentOrders'
import { NinVerificationCard } from './NinVerificationCard'
import { HealthIdCode } from './HealthIdCode'
import { dayWords, groupByDay, matchesQuery } from './recordSearch'

const links = [
  { to: '/', label: 'Overview', end: true },
  { to: '/profile', label: 'Profile' },
  { to: '/records', label: 'Records' },
  { to: '/access', label: 'Access' },
  { to: '/notifications', label: 'Notifications' },
  { to: '/settings', label: 'Settings' },
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
 * What each inbox code means to the patient. Identity writes the first two
 * (hid-system 0037_patient_notification_inbox.sql), and on Novu hid-system #109
 * the third when support removes a contact who asked to stop receiving alerts
 * (its payload holds only the relationship and channel, and is never shown); a
 * code added later reads as a general account update until it has its own
 * words, never as the code itself.
 */
const NOTIFICATION_TITLES: Readonly<Record<string, string>> = {
  ACCESS_REQUEST_RECEIVED: 'A facility asked to access your health information',
  EMERGENCY_ACCESS_ACTIVATED: 'A provider used emergency access to your health information',
  EMERGENCY_CONTACT_OPTED_OUT: 'One of your emergency contacts asked Health ID to stop sending them alerts, so they were removed',
}
const NOTIFICATION_SUBJECTS: Readonly<Record<string, string>> = {
  'access-request': 'Access request', 'consent-grant': 'Access grant', 'emergency-contact': 'Emergency contact',
  // P4c (Novu): an order a clinician sent to a laboratory or pharmacy at another facility.
  'order-route': 'Order to another facility',
}

/**
 * The inbox codes of orders sent to another facility (Novu, P4c, SPEC-FINAL §5, §13.4). Their metadata holds only
 * the kind and the two facilities' names; the receiving facility is named in the title.
 */
const ORDER_ROUTE_TITLES: Readonly<Record<string, (thing: string, facility: string) => string>> = {
  ORDER_ROUTE_SENT: (thing, facility) => `Your ${thing} was sent to ${facility}: see it in Access and consent`,
  ORDER_ROUTE_WITHDRAWN: (thing, facility) => `Your ${thing} to ${facility} was withdrawn`,
  ORDER_ROUTE_ACCEPTED: (thing, facility) => `${facility} accepted your ${thing}`,
  ORDER_ROUTE_DECLINED: (thing, facility) => `${facility} could not take your ${thing}`,
  ORDER_ROUTE_ACCEPT_LOCKED: (thing, facility) => `${facility} could not confirm it was you, so it can’t take your ${thing}. Ask your clinician to send it again`,
  ORDER_ROUTE_CANCELLED: (thing, facility) => `Your ${thing} at ${facility} was cancelled`,
  // Item 3 (D8): the receiving facility reports it accepted the order for someone who was not the patient, and ended it.
  ORDER_ROUTE_WRONG_PATIENT: (thing, facility) => `${facility} accepted your ${thing} for someone who was not you, and has ended it`,
  // D17: it reported it after the order had ended another way, which it keeps (SPEC-FINAL §9.3).
  ORDER_ROUTE_WRONG_PATIENT_CORRECTED: (thing, facility) => `${facility} reports that it accepted your ${thing} for someone who was not you`,
  // D18 (D18-3): the receiving facility accepted it and couldn't complete it; the reason is not sent (D18-4).
  ORDER_ROUTE_NOT_COMPLETED: (thing, facility) => `${facility} couldn’t complete your ${thing}: see it in Access and consent`,
}

/** A name from a notice's metadata, or the words that stand for it: never anything but a short plain string. */
function metadataName(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim() && value.length <= 200 ? value.trim() : null
}

function notificationTitle(item: PatientNotification) {
  const orderRoute = ORDER_ROUTE_TITLES[item.notificationCode]
  if (orderRoute) {
    const kind = metadataName(item.metadata, 'kind')
    const thing = kind === 'lab_request' ? 'test request' : kind === 'prescription' ? 'prescription' : 'test request or prescription'
    return orderRoute(thing, metadataName(item.metadata, 'receivingFacilityName') ?? 'another facility')
  }
  return NOTIFICATION_TITLES[item.notificationCode] ?? 'An update about your Health ID account'
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

  return <div className="patient-app">
    <header className="patient-app-header"><div className="patient-app-header-inner">
      <NavLink to="/" className="patient-app-logo" aria-label="Health ID home"><BrandLogo /></NavLink>
      <span className="patient-header-title">Patient portal</span>
      <button ref={signOutButton} type="button" className="patient-signout" onClick={() => void logout()} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
    </div></header>
    <div className="patient-app-body"><nav className="patient-side-nav" aria-label="Patient pages" onFocus={revealFocusedLink}>
      {patientChatEnabled() && <NavLink to="/chat" className="patient-nav-link">Ask about your records</NavLink>}
      {links.map(link => <NavLink key={link.to} to={link.to} end={'end' in link ? link.end : false} className={({ isActive }) => isActive ? 'patient-nav-link active' : 'patient-nav-link'}>{link.label}</NavLink>)}
    </nav><main ref={main} className="patient-main" id="main">{error && <p role="alert" className="patient-inline-error">{error}</p>}<Outlet /></main></div>
  </div>
}

const HEALTH_LABELS: Readonly<Record<ImportedHealthField, string>> = {
  blood_group: 'Blood group', genotype: 'Genotype', allergies: 'Allergies', current_medications: 'Current medications',
  chronic_conditions: 'Chronic conditions', medical_notes: 'Medical notes',
}

/** hid-system main sends no hid-1.0 health details with the records, so the profile reads none there. */
const noRecords = async (): Promise<PatientRecords | null> => null

/** A migrated patient's hid-1.0 health details, as they were: read-only, and only the ones they filled in. */
function ImportedHealthCard({ profile }: { profile: ImportedHealthProfile }) {
  return <div className="patient-card"><h2>From your hid-1.0 account</h2>
    <p className="patient-field-hint">The health details you kept in hid-1.0, carried over with your account{profile.updatedAt
      ? `, as last updated on ${date(profile.updatedAt)}` : ''}. They can't be changed here.</p>
    <dl className="patient-details">{IMPORTED_HEALTH_FIELDS.filter(field => profile.content[field]).map(field =>
      <div key={field}><dt>{HEALTH_LABELS[field]}</dt><dd className="patient-multiline">{profile.content[field]}</dd></div>)}</dl>
  </div>
}

/**
 * The patient's profile, with "Verify your NIN" (NinVerificationCard.tsx): since the
 * owner's decision of 2026-10-27 a patient signs up without a NIN and may add it here,
 * optionally. Where Identity still refuses it (503 QOREID_PATIENT_NIN_BINDING_DISABLED
 * while QOREID_PATIENT_SELF_NIN_BINDING_ENABLED is off), the card says so plainly.
 */
export function ProfilePage() {
  const { api } = useSession()
  useDocumentTitle('Your profile · Health ID')
  const profile = usePatientResource(api.profile)
  // Novu sends a migrated patient's hid-1.0 health details with the records (importedHealthProfile), null for anyone else.
  const records = usePatientResource<PatientRecords | null>(usesNovuBackend() ? api.records : noRecords)
  const health = records.error ? null : records.data?.importedHealthProfile ?? null
  const heading = useRef<HTMLHeadingElement>(null)

  return <section className="patient-section"><p className="patient-eyebrow">Identity</p><h1 ref={heading} tabIndex={-1} className="patient-page-title">Your profile</h1>
    <p className="patient-page-copy">These details come from your verified Health ID account.</p>
    <LoadState loading={profile.loading} error={profile.error} retry={profile.reload} hasData={profile.data !== null} focusTarget={heading} />
    {profile.data && !profile.error && <div className="patient-card" aria-busy={profile.loading || undefined}><h2>Bio-data</h2><dl className="patient-details">
      <div><dt>Health ID</dt><dd><HealthIdCode code={profile.data.hid} /></dd></div>
      <div><dt>Full name</dt><dd>{profile.data.fullName}</dd></div>
      <div><dt>Date of birth</dt><dd>{date(profile.data.dateOfBirth)}</dd></div>
      <div><dt>Gender</dt><dd>{profile.data.gender || 'Not provided'}</dd></div>
      <div><dt>State</dt><dd>{profile.data.state || 'Not provided'}</dd></div>
      <div><dt>Country</dt><dd>{profile.data.country || 'Not provided'}</dd></div>
      <div><dt>Identity assurance</dt><dd>{profile.data.assuranceState || 'Not available'}</dd></div>
    </dl></div>}
    {profile.data && !profile.error && health && <ImportedHealthCard profile={health} />}
    {profile.data && !profile.error && <NinVerificationCard profile={profile.data} onVerified={profile.reload} />}
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

export function AccessPage() {
  const { api } = useSession()
  useDocumentTitle('Access and consent · Health ID')
  const requests = usePatientResource(api.accessRequests)
  const history = usePatientResource(api.accessHistory)
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
    {error && <p role="alert" className="patient-inline-error">{error}</p>}
    <div role="status">{notice && <p className="patient-inline-success">{notice}</p>}</div>
    <div className="patient-card" aria-busy={(requests.loading && requests.data !== null) || undefined}><h2 ref={requestsHeading} tabIndex={-1}>Access requests</h2>
      <LoadState loading={requests.loading} error={requests.error} retry={requests.reload} hasData={requests.data !== null} focusTarget={requestsHeading} />
      {requests.data && !requests.error && (requests.data.length === 0 ? <p className="patient-empty">There are no access requests.</p> : <ul className="patient-list">
        {requests.data.map(item => <li key={item.accessRequestId} className="patient-access-item"><div><strong>{item.facilityName}</strong><span>{item.scope} · {date(item.requestedAt)} · {item.status}</span><p>{item.reason}</p></div>
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
        {history.data.items.map(item => <li key={item.consentGrantId}><div><strong>{item.facilityName}</strong><span>{item.breakGlass ? 'Emergency access' : item.scope} · {item.purpose}</span><span>{date(item.startsAt)} to {date(item.expiresAt)} · {item.status}</span>
          {item.breakGlass && <p>A provider used emergency access. It is time-limited and audited; it cannot be revoked here.</p>}</div>
          {item.patientRevocable === true && <div className="patient-decision-actions">
            {revoking === item.consentGrantId
              ? <form className="patient-deny-form" onSubmit={event => { event.preventDefault(); void revoke(item.consentGrantId) }}><label>Reason for revocation<input id={`revoke-reason-${item.consentGrantId}`} autoFocus required minLength={3} maxLength={500} value={revokeReason} onChange={event => setRevokeReason(event.target.value)}
                  aria-describedby={`revoke-reason-hint-${item.consentGrantId}`} /></label>
                <p id={`revoke-reason-hint-${item.consentGrantId}`} className="patient-field-hint">At least 3 characters. If this facility has your Access PIN, it can use it to get access again. To stop that, change or remove your PIN in Settings.</p><button type="submit" disabled={revokeBusy || history.loading || revokeReason.trim().length < 3}>Confirm revocation</button>
                <button type="button" className="patient-secondary-button" disabled={revokeBusy} onClick={() => cancelRevocation(item.consentGrantId)}>Cancel</button></form>
              : <button id={`revoke-${item.consentGrantId}`} type="button" className="patient-secondary-button" disabled={history.loading} onClick={() => openRevocation(item.consentGrantId)}>Revoke access <ItemName>for {item.facilityName}, {item.scope}, from {dateTime(item.startsAt)}</ItemName></button>}
          </div>}
        </li>)}
      </ul>)}</div>
  </section>
}

export function NotificationsPage() {
  const { api } = useSession()
  useDocumentTitle('Notifications · Health ID')
  const notifications = usePatientResource(api.notifications)
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusAfter = useActionFocus()
  const markRead = async (id: string) => {
    setWorking(id); setError(null)
    try { await api.markNotificationRead(id); await notifications.reload(); focusAfter(() => heading.current) }
    catch (cause) {
      setError(isHidApiError(cause) ? cause.message : 'Notification could not be updated.')
      focusAfter(() => document.getElementById(`mark-read-${id}`))
    } finally { setWorking(null) }
  }
  return <section className="patient-section"><p className="patient-eyebrow">Updates</p><h1 ref={heading} tabIndex={-1} className="patient-page-title">Notifications</h1>
    <LoadState loading={notifications.loading} error={notifications.error} retry={notifications.reload} hasData={notifications.data !== null} focusTarget={heading} />
    {error && <p role="alert" className="patient-inline-error">{error}</p>}
    {notifications.data && !notifications.error && <div className="patient-card" aria-busy={notifications.loading || undefined}>{notifications.data.length === 0 ? <p className="patient-empty">You have no notifications.</p> : <ul className="patient-list">
      {notifications.data.map(item => <li key={item.id}><div><strong>{notificationTitle(item)}</strong><span>{[item.resourceType && NOTIFICATION_SUBJECTS[item.resourceType], date(item.createdAt), item.readAt ? 'Read' : 'Unread'].filter(Boolean).join(' · ')}</span></div>
        {!item.readAt && <button id={`mark-read-${item.id}`} type="button" disabled={working === item.id || notifications.loading} onClick={() => void markRead(item.id)}>Mark as read<ItemName>: {notificationTitle(item)}, {dateTime(item.createdAt)}</ItemName></button>}</li>)}
    </ul>}</div>}
  </section>
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

export function SettingsPage() {
  const { api } = useSession()
  useDocumentTitle('Settings · Health ID')
  const profile = usePatientResource(api.profile)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Starts at HID- (owner decision, 2026-10-27); an email typed after it drops it, and HID- alone is not filled in.
  // Empty until focused, so a browser can still fill a saved sign-in; HID- as soon as the person starts.
  const [googlePrincipal, setGooglePrincipal] = useState('')
  const principalTyped = !isBlankHealthIdInput(googlePrincipal)
  const [googlePassword, setGooglePassword] = useState('')
  const [googleToken, setGoogleToken] = useState<string | null>(null)
  const [googleReset, setGoogleReset] = useState(0)
  // A refused PIN is tied to its field (PR-07), as a refused NIN is on the profile.
  const [pinFieldError, setPinFieldError] = useState(false)
  const [errorAlert, setErrorAlert] = useState(true)
  const heading = useRef<HTMLHeadingElement>(null)
  const pinHeading = useRef<HTMLHeadingElement>(null)
  // Save PIN is disabled once the field is cleared, so focus goes back to the field.
  const pinFocus = useStepFocus()
  const revokePinButton = useRef<HTMLButtonElement>(null)
  const focusAfter = useActionFocus()

  const configurePin = async (event: FormEvent) => {
    event.preventDefault(); if (busy || !/^\d{4,8}$/.test(pin)) return
    const fromField = pinFocus.onTarget()
    setBusy(true); setError(null); setNotice(null); setPinFieldError(false); setErrorAlert(true)
    try { await api.setAccessPin(pin); setPin(''); setNotice('Access PIN configured.'); await profile.reload() }
    catch (cause) {
      const aboutField = isFieldProblem(cause)
      setError(pinProblem(cause, 'Access PIN could not be updated.'))
      setPinFieldError(aboutField); setErrorAlert(!aboutField || fromField)
    } finally { setBusy(false); pinFocus.focus() }
  }
  const revokePin = async () => {
    if (busy) return
    setBusy(true); setError(null); setNotice(null); setPinFieldError(false); setErrorAlert(true)
    try { await api.revokeAccessPin(); setNotice('Access PIN revoked.'); await profile.reload(); focusAfter(() => pinHeading.current) }
    catch (cause) {
      setError(pinProblem(cause, 'Access PIN could not be revoked.'))
      focusAfter(() => revokePinButton.current)
    } finally { setBusy(false) }
  }
  const linkGoogle = async (idToken: string) => {
    if (!googleToken || !principalTyped || !googlePassword) return
    setBusy(true); setError(null); setNotice(null); setPinFieldError(false); setErrorAlert(true)
    try { await api.googleLink(idToken, emailOrHealthId(googlePrincipal), googlePassword, googleToken); setGooglePassword(''); setNotice('Google identity linked.') }
    catch (cause) { setError(isHidApiError(cause) ? cause.message : 'Google identity could not be linked.') }
    finally { setGoogleToken(null); setGoogleReset(value => value + 1); setBusy(false) }
  }

  return <section className="patient-section"><p className="patient-eyebrow">Account</p><h1 ref={heading} tabIndex={-1} className="patient-page-title">Settings</h1>
    {error && <p id="settings-error" role={errorAlert ? 'alert' : undefined} className="patient-inline-error">{error}</p>}
    <div role="status">{notice && <p className="patient-inline-success">{notice}</p>}</div>
    <LoadState loading={profile.loading} error={profile.error} retry={profile.reload} hasData={profile.data !== null} focusTarget={heading} />
    {profile.data && !profile.error && <div className="patient-card" aria-busy={profile.loading || undefined}><h2 ref={pinHeading} tabIndex={-1}>Access PIN</h2>
      <p id="access-pin-hint" className="patient-field-hint">Your PIN is 4 to 8 digits. A provider must still have the right role and purpose to use this PIN. You must have signed in within the last 10 minutes to change it.</p>
      <p>Status: <strong>{profile.data.accessPinConfigured ? 'Configured' : 'Not configured'}</strong></p>
      <form onSubmit={event => void configurePin(event)} className="patient-form patient-inline-form"><label>{profile.data.accessPinConfigured ? 'Replace PIN' : 'Set PIN'}<input ref={pinFocus.target} required type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4,8}" minLength={4} maxLength={8} value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
        aria-invalid={pinFieldError || undefined} aria-describedby={describedBy('access-pin-hint', pinFieldError && 'settings-error')} /></label>
        <button type="submit" className="patient-primary-button" disabled={busy || !/^\d{4,8}$/.test(pin)}>Save PIN</button></form>
      {profile.data.accessPinConfigured && <button ref={revokePinButton} type="button" className="patient-secondary-button" disabled={busy || profile.loading} onClick={() => void revokePin()}>Revoke Access PIN</button>}
    </div>}
    {/* Both backends: main's patient-safety routes, and hid-system #109's on Novu (staging-novu-ci-20261005). The card
        reads availability first, and shows nothing where the routes are not served (Novu's 404), or while delivery
        is off for a patient without contacts. */}
    <EmergencyContactsCard />
    {import.meta.env.VITE_HID_GOOGLE_CLIENT_ID && googleClientId() && <div className="patient-card"><h2>Link a Google account</h2><p className="patient-field-hint">Confirm your existing Health ID credentials before linking.</p>
      <div className="patient-form"><label>Email or Health ID<input autoComplete="username" value={googlePrincipal} onFocus={() => { if (!googlePrincipal) setGooglePrincipal(HEALTH_ID_PREFIX) }} onChange={event => setGooglePrincipal(healthIdOrOtherInput(event.target.value))} /></label>
        {/* No form is sent here (Google's button sends it), so each attempt remounts the field masked. */}
        <div className="patient-field"><label htmlFor="google-link-password">Current password</label><PasswordInput appearance="plain" key={googleReset} id="google-link-password" autoComplete="current-password" value={googlePassword} onChange={event => setGooglePassword(event.target.value)} /></div>
        <Turnstile action="patient-login" onTokenChange={setGoogleToken} resetKey={googleReset} />
        <GoogleButton text="continue_with" disabled={busy || !googleToken || !principalTyped || !googlePassword} onCredential={linkGoogle}
          disabledReason={googleToken && principalTyped && googlePassword ? undefined
            : 'Enter your email or Health ID and current password, and complete the security check, to link Google.'} /></div>
    </div>}
    {!usesNovuBackend() && <AccountDeletionCard />}
  </section>
}
