import { useState, type FormEvent } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { GoogleButton } from '../GoogleButton'
import { Turnstile } from '../Turnstile'
import { BrandLogo } from '../BrandLogo'
import { useSession } from '../session'
import type { PatientRecords } from '../api'
import { usePatientResource } from './usePatientResource'
import { AccountDeletionCard, EmergencyContactsCard } from './AccountSafety'
import { revealFocusedLink } from '../navStrip'

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

/** Every measurement in a vitals entry, so one holding only blood pressure is not shown as a bare date. */
function vitalsSummary(item: PatientRecords['vitals'][number]) {
  return [
    item.systolicMmhg != null && item.diastolicMmhg != null ? `BP ${item.systolicMmhg}/${item.diastolicMmhg} mmHg` : '',
    item.temperatureC != null ? `Temp ${item.temperatureC}°C` : '',
    item.pulseBpm != null ? `Pulse ${item.pulseBpm}` : '',
    item.respiratoryRate != null ? `Respiratory rate ${item.respiratoryRate}` : '',
    item.oxygenSaturationPercent != null ? `SpO₂ ${item.oxygenSaturationPercent}%` : '',
    item.weightKg != null ? `Weight ${item.weightKg} kg` : '',
    item.heightCm != null ? `Height ${item.heightCm} cm` : '',
  ].filter(Boolean).join(' · ')
}

function LoadState({ loading, error, retry }: { loading: boolean; error: string | null; retry: () => void }) {
  if (loading) return <div className="patient-card patient-loading" role="status">Loading your information…</div>
  if (error) return <div className="patient-card" role="alert"><p>{error}</p><button type="button" onClick={retry}>Try again</button></div>
  return null
}

export function PortalShell() {
  const { signOut } = useSession()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const logout = async () => {
    setSigningOut(true); setError(null)
    try { await signOut(); navigate('/sign-in', { replace: true }) }
    catch (reason) { setError(isHidApiError(reason) ? reason.message : 'Sign-out failed. Please try again.') }
    finally { setSigningOut(false) }
  }

  return <div className="patient-app">
    <header className="patient-app-header"><div className="patient-app-header-inner">
      <NavLink to="/" className="patient-app-logo" aria-label="Health ID home"><BrandLogo /></NavLink>
      <span className="patient-header-title">Patient portal</span>
      <button type="button" className="patient-signout" onClick={() => void logout()} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
    </div></header>
    <div className="patient-app-body"><nav className="patient-side-nav" aria-label="Patient pages" onFocus={revealFocusedLink}>
      {links.map(link => <NavLink key={link.to} to={link.to} end={'end' in link ? link.end : false} className={({ isActive }) => isActive ? 'patient-nav-link active' : 'patient-nav-link'}>{link.label}</NavLink>)}
    </nav><main className="patient-main" id="main">{error && <p role="alert" className="patient-inline-error">{error}</p>}<Outlet /></main></div>
  </div>
}

export function ProfilePage() {
  const { api } = useSession()
  const profile = usePatientResource(api.profile)
  const [nin, setNin] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verificationError, setVerificationError] = useState<string | null>(null)
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null)
  const assurance = profile.data?.assuranceState
  const eligibleAssurance = assurance === 'NIN_VERIFIED' || assurance === 'LEGACY_MIGRATED'
  const completeIdentity = Boolean(profile.data?.firstName.trim() && profile.data?.lastName.trim() && profile.data?.dateOfBirth)

  const verifyNin = async (event: FormEvent) => {
    event.preventDefault()
    if (verifying || !eligibleAssurance || !completeIdentity || !/^\d{11}$/.test(nin)) return
    setVerifying(true); setVerificationError(null); setVerificationNotice(null)
    try {
      const result = await api.verifyNin(nin)
      if (result.state === 'verified') {
        setNin('')
        setVerificationNotice('NIN verification succeeded. Identity evidence was recorded.')
        profile.reload()
      } else if (result.state === 'not_verified') {
        setVerificationError('This NIN could not be verified against your Health ID profile. Check the number and try again.')
      } else if (result.state === 'incomplete') {
        setVerificationError('The identity provider could not complete this verification. Try again later.')
      } else {
        setVerificationError('NIN verification is temporarily unavailable. Try again later.')
      }
    } catch (cause) {
      setVerificationError(isHidApiError(cause) ? cause.message : 'NIN verification could not be completed. Try again.')
    } finally { setVerifying(false) }
  }

  return <section className="patient-section"><p className="patient-eyebrow">Identity</p><h1 className="patient-page-title">Your profile</h1>
    <p className="patient-page-copy">These details come from your verified Health ID account.</p>
    <LoadState loading={profile.loading} error={profile.error} retry={profile.reload} />
    {profile.data && !profile.loading && !profile.error && <div className="patient-card"><h2>Bio-data</h2><dl className="patient-details">
      <div><dt>Health ID</dt><dd className="patient-code">{profile.data.hid}</dd></div>
      <div><dt>Full name</dt><dd>{profile.data.fullName}</dd></div>
      <div><dt>Date of birth</dt><dd>{date(profile.data.dateOfBirth)}</dd></div>
      <div><dt>Gender</dt><dd>{profile.data.gender || 'Not provided'}</dd></div>
      <div><dt>State</dt><dd>{profile.data.state || 'Not provided'}</dd></div>
      <div><dt>Country</dt><dd>{profile.data.country || 'Not provided'}</dd></div>
      <div><dt>Identity assurance</dt><dd>{profile.data.assuranceState || 'Not available'}</dd></div>
    </dl></div>}
    {profile.data && !profile.loading && !profile.error && <div className="patient-card"><h2>NIN verification</h2>
      <p className="patient-field-hint">Repeat verification for a NIN already linked to your account. An eligible migrated account may link a matching NIN. The service checks your account and compares your verified profile details before recording the result.</p>
      {!eligibleAssurance ? <p className="patient-field-hint">This account is not eligible for self-service NIN verification. Identity review is required.</p>
        : !completeIdentity ? <p className="patient-field-hint">A complete name and birth date are required before NIN verification can be requested.</p>
          : <form className="patient-form patient-inline-form" onSubmit={event => void verifyNin(event)}>
            <label>National Identification Number<input type="text" inputMode="numeric" autoComplete="off" spellCheck={false}
              pattern="[0-9]{11}" minLength={11} maxLength={11} required value={nin}
              onChange={event => { setNin(event.target.value.replace(/\D/g, '').slice(0, 11)); setVerificationError(null); setVerificationNotice(null) }} /></label>
            <button type="submit" className="patient-primary-button" disabled={verifying || !/^\d{11}$/.test(nin)}>
              {verifying ? 'Verifying…' : 'Verify NIN'}</button>
          </form>}
      {verificationError && <p role="alert" className="patient-inline-error">{verificationError}</p>}
      {verificationNotice && <p role="status" className="patient-inline-success">{verificationNotice}</p>}
    </div>}
  </section>
}

export function RecordsPage() {
  const { api } = useSession()
  const records = usePatientResource(api.records)
  return <section className="patient-section"><p className="patient-eyebrow">Care history</p><h1 className="patient-page-title">Health records</h1>
    <p className="patient-page-copy">Your completed encounters, clinical notes, vitals, diagnoses, prescriptions, laboratory requests and uploaded clinical documents.</p>
    <LoadState loading={records.loading} error={records.error} retry={records.reload} />
    {records.data && !records.loading && !records.error && <>
      <div className="patient-card"><h2>Encounters</h2>{records.data.encounters.length === 0 ? <p className="patient-empty">No completed encounters are available.</p> : <ul className="patient-list">
        {records.data.encounters.map(item => <li key={item.id}><div><strong>{item.encounterType}</strong><span>{date(item.startedAt)} · {item.status}</span></div></li>)}
      </ul>}</div>
      <div className="patient-card"><h2>Clinical notes</h2>{records.data.notes.length === 0 ? <p className="patient-empty">No signed clinical notes are available.</p> : <ul className="patient-list">
        {records.data.notes.map(item => <li key={item.id} className="patient-note"><div><strong>{item.title || item.noteType}</strong><span>{date(item.signedAt)} · {item.status}</span></div><p>{item.content}</p></li>)}
      </ul>}</div>
      <div className="patient-card"><h2>Vitals</h2>{records.data.vitals.length === 0 ? <p className="patient-empty">No vitals are available.</p> : <ul className="patient-list">
        {records.data.vitals.map(item => <li key={item.id}><div><strong>{date(item.recordedAt)}</strong><span>{vitalsSummary(item)}</span></div></li>)}
      </ul>}</div>
      <div className="patient-card"><h2>Diagnoses</h2>{records.data.diagnoses.length === 0 ? <p className="patient-empty">No diagnoses are available.</p> : <ul className="patient-list">
        {records.data.diagnoses.map(item => <li key={item.id}><div><strong>{item.display}</strong><span>{item.codeSystem}: {item.code} · {item.clinicalStatus} · {item.verificationStatus}</span></div>{item.notes && <p>{item.notes}</p>}</li>)}
      </ul>}</div>
      <div className="patient-card"><h2>Prescriptions</h2>{records.data.prescriptions.length === 0 ? <p className="patient-empty">No prescriptions are available.</p> : <ul className="patient-list">
        {records.data.prescriptions.map(item => <li key={item.id}><div><strong>{item.medicationDisplay}</strong><span>{item.doseQuantity != null ? `${item.doseQuantity} ${item.doseUnit || ''}` : ''}{item.frequency ? ` · ${item.frequency}` : ''} · {item.status}</span></div><p>{item.instructions}</p></li>)}
      </ul>}</div>
      <div className="patient-card"><h2>Laboratory requests</h2>{records.data.labRequests.length === 0 ? <p className="patient-empty">No laboratory requests are available.</p> : <ul className="patient-list">
        {records.data.labRequests.map(item => <li key={item.id}><div><strong>{item.testDisplay}</strong><span>{item.priority} · {item.status} · {date(item.createdAt)}</span></div>{item.clinicalInformation && <p>{item.clinicalInformation}</p>}</li>)}
      </ul>}</div>
      <div className="patient-card"><h2>Clinical documents</h2>{records.data.documents.length === 0 ? <p className="patient-empty">No clinical documents are available.</p> : <ul className="patient-list">
        {records.data.documents.map(item => <li key={item.id}><div><strong>{item.fileName}</strong><span>{item.mediaType} · {item.sizeBytes != null ? `${item.sizeBytes.toLocaleString()} bytes` : 'Size unavailable'} · {date(item.createdAt)}</span></div></li>)}
      </ul>}</div>
      <p className="patient-field-hint">The record aggregate is scoped to your authenticated patient identity and audited by the backend.</p>
    </>}
  </section>
}

export function AccessPage() {
  const { api } = useSession()
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

  const decide = async (id: string, decision: 'approve' | 'deny') => {
    if (working) return
    setWorking(id); setError(null); setNotice(null)
    try {
      if (decision === 'approve') await api.approveAccess(id)
      else await api.denyAccess(id, reason.trim())
      setDenying(null); setReason('')
      setNotice(`Request ${decision === 'approve' ? 'approved' : 'denied'}.`)
      requests.reload(); history.reload()
    } catch (cause) { setError(isHidApiError(cause) ? cause.message : 'The request could not be updated.') }
    finally { setWorking(null) }
  }

  const revoke = async (grantId: string) => {
    if (revokeBusy || revokeReason.trim().length < 3) return
    setRevokeBusy(true); setError(null); setNotice(null)
    try {
      await api.revokeAccess(grantId, revokeReason.trim())
      setRevoking(null); setRevokeReason('')
      setNotice('Access grant revoked.')
      history.reload()
    } catch (cause) {
      setError(isHidApiError(cause) ? cause.message : 'The access grant could not be revoked.')
    } finally { setRevokeBusy(false) }
  }

  return <section className="patient-section"><p className="patient-eyebrow">Consent</p><h1 className="patient-page-title">Access and consent</h1>
    <p className="patient-page-copy">Review requests before deciding whether a facility can access information within the requested scope.</p>
    {error && <p role="alert" className="patient-inline-error">{error}</p>}{notice && <p role="status" className="patient-inline-success">{notice}</p>}
    <div className="patient-card"><h2>Access requests</h2><LoadState loading={requests.loading} error={requests.error} retry={requests.reload} />
      {requests.data && !requests.loading && !requests.error && (requests.data.length === 0 ? <p className="patient-empty">There are no access requests.</p> : <ul className="patient-list">
        {requests.data.map(item => <li key={item.accessRequestId} className="patient-access-item"><div><strong>{item.facilityName}</strong><span>{item.scope} · {date(item.requestedAt)} · {item.status}</span><p>{item.reason}</p></div>
          {item.status.toLowerCase() === 'pending' && <div className="patient-decision-actions"><button type="button" className="patient-primary-button" disabled={!!working} onClick={() => void decide(item.accessRequestId, 'approve')}>Approve</button>
            <button type="button" className="patient-secondary-button" disabled={!!working} onClick={() => setDenying(item.accessRequestId)}>Deny</button></div>}
          {denying === item.accessRequestId && <form className="patient-deny-form" onSubmit={event => { event.preventDefault(); void decide(item.accessRequestId, 'deny') }}><label>Reason for denial<input required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label><button type="submit" disabled={!!working || reason.trim().length < 3}>Confirm denial</button></form>}
        </li>)}
      </ul>)}</div>
    <div className="patient-card"><h2>Access history</h2><LoadState loading={history.loading} error={history.error} retry={history.reload} />
      {history.data && !history.loading && !history.error && (history.data.items.length === 0 ? <p className="patient-empty">No access grants are recorded.</p> : <ul className="patient-list">
        {history.data.items.map(item => <li key={item.consentGrantId}><div><strong>{item.facilityName}</strong><span>{item.breakGlass ? 'Emergency access' : item.scope} · {item.purpose}</span><span>{date(item.startsAt)} to {date(item.expiresAt)} · {item.status}</span>
          {item.breakGlass && <p>A provider used emergency access. It is time-limited, audited, and reviewed; it cannot be revoked here.</p>}</div>
          {item.patientRevocable === true && <div className="patient-decision-actions">
            {revoking === item.consentGrantId
              ? <form className="patient-deny-form" onSubmit={event => { event.preventDefault(); void revoke(item.consentGrantId) }}><label>Reason for revocation<input required minLength={3} maxLength={500} value={revokeReason} onChange={event => setRevokeReason(event.target.value)} /></label><button type="submit" disabled={revokeBusy || revokeReason.trim().length < 3}>Confirm revocation</button></form>
              : <button type="button" className="patient-secondary-button" onClick={() => setRevoking(item.consentGrantId)}>Revoke access</button>}
          </div>}
        </li>)}
      </ul>)}</div>
  </section>
}

export function NotificationsPage() {
  const { api } = useSession()
  const notifications = usePatientResource(api.notifications)
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const markRead = async (id: string) => {
    setWorking(id); setError(null)
    try { await api.markNotificationRead(id); notifications.reload() }
    catch (cause) { setError(isHidApiError(cause) ? cause.message : 'Notification could not be updated.') }
    finally { setWorking(null) }
  }
  return <section className="patient-section"><p className="patient-eyebrow">Updates</p><h1 className="patient-page-title">Notifications</h1>
    <LoadState loading={notifications.loading} error={notifications.error} retry={notifications.reload} />
    {error && <p role="alert" className="patient-inline-error">{error}</p>}
    {notifications.data && !notifications.loading && !notifications.error && <div className="patient-card">{notifications.data.length === 0 ? <p className="patient-empty">You have no notifications.</p> : <ul className="patient-list">
      {notifications.data.map(item => <li key={item.id}><div><strong>{item.notificationCode.replace(/[_-]/g, ' ')}</strong><span>{date(item.createdAt)} · {item.readAt ? 'Read' : 'Unread'}</span></div>
        {!item.readAt && <button type="button" disabled={working === item.id} onClick={() => void markRead(item.id)}>Mark as read</button>}</li>)}
    </ul>}</div>}
  </section>
}

export function SettingsPage() {
  const { api } = useSession()
  const profile = usePatientResource(api.profile)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [googlePrincipal, setGooglePrincipal] = useState('')
  const [googlePassword, setGooglePassword] = useState('')
  const [googleToken, setGoogleToken] = useState<string | null>(null)
  const [googleReset, setGoogleReset] = useState(0)

  const configurePin = async (event: FormEvent) => {
    event.preventDefault(); if (busy || !/^\d{4,8}$/.test(pin)) return
    setBusy(true); setError(null); setNotice(null)
    try { await api.setAccessPin(pin); setPin(''); setNotice('Access PIN configured.'); profile.reload() }
    catch (cause) { setError(isHidApiError(cause) ? cause.message : 'Access PIN could not be updated.') }
    finally { setBusy(false) }
  }
  const revokePin = async () => {
    if (busy) return
    setBusy(true); setError(null); setNotice(null)
    try { await api.revokeAccessPin(); setNotice('Access PIN revoked.'); profile.reload() }
    catch (cause) { setError(isHidApiError(cause) ? cause.message : 'Access PIN could not be revoked.') }
    finally { setBusy(false) }
  }
  const linkGoogle = async (idToken: string) => {
    if (!googleToken || !googlePrincipal.trim() || !googlePassword) return
    setBusy(true); setError(null); setNotice(null)
    try { await api.googleLink(idToken, googlePrincipal.trim(), googlePassword, googleToken); setGooglePassword(''); setNotice('Google identity linked.') }
    catch (cause) { setError(isHidApiError(cause) ? cause.message : 'Google identity could not be linked.') }
    finally { setGoogleToken(null); setGoogleReset(value => value + 1); setBusy(false) }
  }

  return <section className="patient-section"><p className="patient-eyebrow">Account</p><h1 className="patient-page-title">Settings</h1>
    {error && <p role="alert" className="patient-inline-error">{error}</p>}{notice && <p role="status" className="patient-inline-success">{notice}</p>}
    <LoadState loading={profile.loading} error={profile.error} retry={profile.reload} />
    {profile.data && !profile.loading && !profile.error && <div className="patient-card"><h2>Access PIN</h2>
      <p className="patient-field-hint">A provider must still have the right role and purpose to use this PIN. You must have signed in recently to change it.</p>
      <p>Status: <strong>{profile.data.accessPinConfigured ? 'Configured' : 'Not configured'}</strong></p>
      <form onSubmit={event => void configurePin(event)} className="patient-form patient-inline-form"><label>{profile.data.accessPinConfigured ? 'Replace PIN' : 'Set PIN'}<input required type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4,8}" minLength={4} maxLength={8} value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))} /></label>
        <button type="submit" className="patient-primary-button" disabled={busy || !/^\d{4,8}$/.test(pin)}>Save PIN</button></form>
      {profile.data.accessPinConfigured && <button type="button" className="patient-secondary-button" disabled={busy} onClick={() => void revokePin()}>Revoke Access PIN</button>}
    </div>}
    <EmergencyContactsCard />
    {import.meta.env.VITE_HID_GOOGLE_CLIENT_ID && <div className="patient-card"><h2>Link a Google account</h2><p className="patient-field-hint">Confirm your existing Health ID credentials before linking.</p>
      <div className="patient-form"><label>Email or Health ID<input autoComplete="username" value={googlePrincipal} onChange={event => setGooglePrincipal(event.target.value)} /></label>
        <label>Current password<input type="password" autoComplete="current-password" value={googlePassword} onChange={event => setGooglePassword(event.target.value)} /></label>
        <Turnstile action="patient-login" onTokenChange={setGoogleToken} resetKey={googleReset} />
        <GoogleButton text="continue_with" disabled={busy || !googleToken || !googlePrincipal.trim() || !googlePassword} onCredential={linkGoogle} /></div>
    </div>}
    <AccountDeletionCard />
  </section>
}
