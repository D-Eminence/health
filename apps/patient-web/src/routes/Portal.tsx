import { ImportedHistory } from '../ImportedHistory'
import { PatientImportedHistory } from '../ImportedHistoryPage'
import { getEnvironment } from '../env'
import { useRef, useState, type FormEvent, type RefObject } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { PasswordInput } from '@hid/ui'
import { GoogleButton } from '../GoogleButton'
import { googleClientId } from '../googleClient'
import { Turnstile } from '../Turnstile'
import { BrandLogo } from '../BrandLogo'
import { ItemName } from '../ItemName'
import { useSession } from '../session'
import type { PatientNotification, PatientRecords, RecordSection } from '../api'
import { patientChatEnabled } from '../chatFeatures'
import { usePatientResource } from './usePatientResource'
import { useActionFocus, useRetryFocus } from './actionFocus'
import { AccountDeletionCard, EmergencyContactsCard } from './AccountSafety'
import { revealFocusedLink } from '../navStrip'
import { describedBy, isFieldProblem, useDocumentTitle, useStepFocus } from '../authSteps'
import { useFocusOnPageChange } from '../pageFocus'

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
 * What each inbox code means to the patient. Identity writes these two today
 * (hid-system 0037_patient_notification_inbox.sql); a code added later reads as
 * a general account update until it has its own words, never as the code itself.
 */
const NOTIFICATION_TITLES: Readonly<Record<string, string>> = {
  ACCESS_REQUEST_RECEIVED: 'A facility asked to access your health information',
  EMERGENCY_ACCESS_ACTIVATED: 'A provider used emergency access to your health information',
}
const NOTIFICATION_SUBJECTS: Readonly<Record<string, string>> = { 'access-request': 'Access request', 'consent-grant': 'Access grant' }

function notificationTitle(item: PatientNotification) {
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

/**
 * The patient's profile. The signed-in "Verify NIN" card is not offered: hid-system
 * main f9dbaf0 answers POST /identity/me/verification/nin with
 * 503 QOREID_PATIENT_NIN_BINDING_DISABLED while QOREID_PATIENT_SELF_NIN_BINDING_ENABLED
 * is off, its default, and production refuses that flag, so the card could only be
 * refused. It stays hidden until the owner decides P27 (PHASE_4_STAGE_5_RELEASE_READINESS.md
 * section 3, Health-id alignment row 13); the API call is kept in api.ts.
 */
export function ProfilePage() {
  const { api } = useSession()
  useDocumentTitle('Your profile · Health ID')
  const profile = usePatientResource(api.profile)
  const heading = useRef<HTMLHeadingElement>(null)

  return <section className="patient-section"><p className="patient-eyebrow">Identity</p><h1 ref={heading} tabIndex={-1} className="patient-page-title">Your profile</h1>
    <p className="patient-page-copy">These details come from your verified Health ID account.</p>
    <LoadState loading={profile.loading} error={profile.error} retry={profile.reload} hasData={profile.data !== null} focusTarget={heading} />
    {profile.data && !profile.error && <div className="patient-card" aria-busy={profile.loading || undefined}><h2>Bio-data</h2><dl className="patient-details">
      <div><dt>Health ID</dt><dd className="patient-code">{profile.data.hid}</dd></div>
      <div><dt>Full name</dt><dd>{profile.data.fullName}</dd></div>
      <div><dt>Date of birth</dt><dd>{date(profile.data.dateOfBirth)}</dd></div>
      <div><dt>Gender</dt><dd>{profile.data.gender || 'Not provided'}</dd></div>
      <div><dt>State</dt><dd>{profile.data.state || 'Not provided'}</dd></div>
      <div><dt>Country</dt><dd>{profile.data.country || 'Not provided'}</dd></div>
      <div><dt>Identity assurance</dt><dd>{profile.data.assuranceState || 'Not available'}</dd></div>
    </dl></div>}
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

export function RecordsPage() {
  const { api } = useSession()
  useDocumentTitle('Health records · Health ID')
  const records = usePatientResource(api.records)
  const heading = useRef<HTMLHeadingElement>(null)
  const data = records.data
  return <section className="patient-section"><p className="patient-eyebrow">Care history</p><h1 ref={heading} tabIndex={-1} className="patient-page-title">Health records</h1>
    <p className="patient-page-copy">{recordsIntro(records.error ? null : data)}</p>
    <LoadState loading={records.loading} error={records.error} retry={records.reload} hasData={data !== null} focusTarget={heading} />
    <PatientImportedHistory api={api} />
    {data && !records.error && <>
      {data.importedRecords !== undefined && <ImportedHistory records={data.importedRecords}
        limit={data.limit} download={api.importedAttachment} allowLocalHttp={getEnvironment().name === 'local'} />}
      <div className="patient-card"><h2>Encounters</h2>{data.encounters.length === 0 ? <p className="patient-empty">{emptyText(data, 'encounters', 'No completed encounters are available.')}</p> : <ul className="patient-list">
        {data.encounters.map(item => <li key={item.id}><div><strong>{item.encounterType}</strong><span>{date(item.startedAt)} · {item.status}</span></div></li>)}
      </ul>}<Truncated data={data} section="encounters" /></div>
      <div className="patient-card"><h2>Clinical notes</h2>{data.notes.length === 0 ? <p className="patient-empty">{emptyText(data, 'notes', 'No signed clinical notes are available.')}</p> : <ul className="patient-list">
        {data.notes.map(item => <li key={item.id} className="patient-note"><div><strong>{item.title || item.noteType}</strong><span>{date(item.signedAt)} · {item.status}</span></div><p>{item.content}</p></li>)}
      </ul>}<Truncated data={data} section="notes" /></div>
      <div className="patient-card"><h2>Vitals</h2>{data.vitals.length === 0 ? <p className="patient-empty">{emptyText(data, 'vitals', 'No vitals are available.')}</p> : <ul className="patient-list">
        {data.vitals.map(item => <li key={item.id}><div><strong>{date(item.recordedAt)}</strong><span>{vitalsSummary(item)}</span></div></li>)}
      </ul>}<Truncated data={data} section="vitals" /></div>
      <div className="patient-card"><h2>Diagnoses</h2>{data.diagnoses.length === 0 ? <p className="patient-empty">{emptyText(data, 'diagnoses', 'No diagnoses are available.')}</p> : <ul className="patient-list">
        {data.diagnoses.map(item => <li key={item.id}><div><strong>{item.display}</strong><span>{item.codeSystem}: {item.code} · {item.clinicalStatus} · {item.verificationStatus}</span></div>{item.notes && <p>{item.notes}</p>}</li>)}
      </ul>}<Truncated data={data} section="diagnoses" /></div>
      <div className="patient-card"><h2>Prescriptions</h2>{data.prescriptions.length === 0 ? <p className="patient-empty">{emptyText(data, 'prescriptions', 'No prescriptions are available.')}</p> : <ul className="patient-list">
        {data.prescriptions.map(item => <li key={item.id}><div><strong>{item.medicationDisplay}</strong><span>{item.doseQuantity != null ? `${item.doseQuantity} ${item.doseUnit || ''}` : ''}{item.frequency ? ` · ${item.frequency}` : ''} · {item.status}</span></div><p>{item.instructions}</p></li>)}
      </ul>}<Truncated data={data} section="prescriptions" /></div>
      <div className="patient-card"><h2>Laboratory requests</h2>{data.labRequests.length === 0 ? <p className="patient-empty">{emptyText(data, 'labRequests', 'No laboratory requests are available.')}</p> : <ul className="patient-list">
        {data.labRequests.map(item => <li key={item.id}><div><strong>{item.testDisplay}</strong><span>{item.priority} · {item.status} · {date(item.createdAt)}</span></div>{item.clinicalInformation && <p>{item.clinicalInformation}</p>}</li>)}
      </ul>}<Truncated data={data} section="labRequests" /></div>
      <div className="patient-card"><h2>Clinical documents</h2>{data.documents.length === 0 ? <p className="patient-empty">{emptyText(data, 'documents', 'No clinical documents are available.')}</p> : <ul className="patient-list">
        {data.documents.map(item => <li key={item.id}><div><strong>{item.fileName}</strong><span>{item.mediaType} · {bytes(item.sizeBytes)} · {date(item.createdAt)}</span></div></li>)}
      </ul>}<Truncated data={data} section="documents" /></div>
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
    <div className="patient-card" aria-busy={(history.loading && history.data !== null) || undefined}><h2 ref={historyHeading} tabIndex={-1}>Access history</h2>
      <LoadState loading={history.loading} error={history.error} retry={history.reload} hasData={history.data !== null} focusTarget={historyHeading} />
      {history.data && !history.error && (history.data.items.length === 0 ? <p className="patient-empty">No access grants are recorded.</p> : <ul className="patient-list">
        {history.data.items.map(item => <li key={item.consentGrantId}><div><strong>{item.facilityName}</strong><span>{item.breakGlass ? 'Emergency access' : item.scope} · {item.purpose}</span><span>{date(item.startsAt)} to {date(item.expiresAt)} · {item.status}</span>
          {item.breakGlass && <p>A provider used emergency access. It is time-limited, audited, and reviewed; it cannot be revoked here.</p>}</div>
          {item.patientRevocable === true && <div className="patient-decision-actions">
            {revoking === item.consentGrantId
              ? <form className="patient-deny-form" onSubmit={event => { event.preventDefault(); void revoke(item.consentGrantId) }}><label>Reason for revocation<input id={`revoke-reason-${item.consentGrantId}`} autoFocus required minLength={3} maxLength={500} value={revokeReason} onChange={event => setRevokeReason(event.target.value)}
                  aria-describedby={`revoke-reason-hint-${item.consentGrantId}`} /></label>
                <p id={`revoke-reason-hint-${item.consentGrantId}`} className="patient-field-hint">At least 3 characters.</p><button type="submit" disabled={revokeBusy || history.loading || revokeReason.trim().length < 3}>Confirm revocation</button>
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
  const [googlePrincipal, setGooglePrincipal] = useState('')
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
    if (!googleToken || !googlePrincipal.trim() || !googlePassword) return
    setBusy(true); setError(null); setNotice(null); setPinFieldError(false); setErrorAlert(true)
    try { await api.googleLink(idToken, googlePrincipal.trim(), googlePassword, googleToken); setGooglePassword(''); setNotice('Google identity linked.') }
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
    <EmergencyContactsCard />
    {import.meta.env.VITE_HID_GOOGLE_CLIENT_ID && googleClientId() && <div className="patient-card"><h2>Link a Google account</h2><p className="patient-field-hint">Confirm your existing Health ID credentials before linking.</p>
      <div className="patient-form"><label>Email or Health ID<input autoComplete="username" value={googlePrincipal} onChange={event => setGooglePrincipal(event.target.value)} /></label>
        {/* No form is sent here (Google's button sends it), so each attempt remounts the field masked. */}
        <div className="patient-field"><label htmlFor="google-link-password">Current password</label><PasswordInput appearance="plain" key={googleReset} id="google-link-password" autoComplete="current-password" value={googlePassword} onChange={event => setGooglePassword(event.target.value)} /></div>
        <Turnstile action="patient-login" onTokenChange={setGoogleToken} resetKey={googleReset} />
        <GoogleButton text="continue_with" disabled={busy || !googleToken || !googlePrincipal.trim() || !googlePassword} onCredential={linkGoogle}
          disabledReason={googleToken && googlePrincipal.trim() && googlePassword ? undefined
            : 'Enter your email or Health ID and current password, and complete the security check, to link Google.'} /></div>
    </div>}
    <AccountDeletionCard />
  </section>
}
