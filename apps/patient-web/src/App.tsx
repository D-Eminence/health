import { lazy, Suspense, useEffect } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { PATIENT_ROUTE } from '@hid/auth'
import { RequireAccess } from './RequireAccess'
import { BrandLogo } from './BrandLogo'
import { useDocumentTitle } from './authSteps'
import { SessionProvider } from './session'
import { PatientSupport } from './PatientSupport'
import { patientChatEnabled } from './chatFeatures'
import { SelectedPatientChat as PatientChat } from './routes/SelectedPatientChat'
import { Overview } from './routes/Overview'
import { SignIn } from './routes/SignIn'
import { Enrollment } from './routes/Enrollment'
import { ParticipatingFacilitiesPage } from './routes/ParticipatingFacilities'
import { Recovery } from './routes/Recovery'
import { PrincipalRecovery } from './routes/PrincipalRecovery'
import { AccessPage, NotificationsPage, PortalShell, ProfilePage, RecordsPage, SettingsRedirect } from './routes/Portal'
import { resolveStaffProductHostname, isPlatformAdminHostname, PLATFORM_ADMIN_ROUTE, STAFF_RECOVERY_PATH } from './productHostname'
import { CLINICIAN_SIGNUP_PATH, CLINICIAN_STATUS_PATH, STAFF_INVITATION_PATH } from './productHostname'
import { rightSiteHref } from './productSites'
import { openSite } from './openSite'
import { AUTH_SIGN_IN_PATH, authDeploymentOf, centralSignInEnabled } from './authHandoff'
import { usesNovuBackend } from './backendContract'
import { LEGACY_PATIENT_PATHS } from './legacyPaths'
import { ShareRecords } from './routes/ShareRecords'
import { SharedCardPage, SharedCardPreview } from './routes/SharedCard'
import { BLUE_FOR_ALL } from './ehr-blue/clinicSwitch'

const StaffApp = lazy(async () => ({ default: (await import('./staff/App')).App }))
/** The auth. site's one sign-in for every staff site (authHandoff.ts), inside the staff session it checks first. */
const CentralSignInSite = lazy(async () => {
  const [{ StaffProvider }, { CentralSignIn }] = await Promise.all([import('./staff/App'), import('./staff/CentralSignIn')])
  return { default: () => <StaffProvider><CentralSignIn /></StaffProvider> }
})
// Facility sign-up: the blue registration once the clinic switch is on (clinicSwitch.ts, a one-line constant module, so
// no blue code reaches this bundle), today's page until then. Both load lazily, at the same address.
const ProviderEnrollment = lazy(async () => BLUE_FOR_ALL
  ? { default: (await import('./ehr-blue/signup/BlueProviderEnrollment')).BlueProviderEnrollment }
  : { default: (await import('./staff/routes/ProviderEnrollment')).ProviderEnrollment })
const ClinicianSignUp = lazy(async () => ({ default: (await import('./staff/routes/ClinicianSignUp')).ClinicianSignUp }))
const ClinicianApplicationStatus = lazy(async () => ({
  default: (await import('./staff/routes/ClinicianApplicationStatus')).ClinicianApplicationStatus }))
const AdminApp = lazy(async () => ({ default: (await import('./admin/App')).App }))
const StaffInvitation = lazy(async () => ({ default: (await import('./staff/routes/StaffInvitation')).StaffInvitation }))
// The blue EHR's recovery and invitation, once the clinic switch is on (BLUE_FOR_ALL, as for sign-up above): today's
// steps and words. Marked pure so that, while the switch is off and nothing uses them, the build drops both calls and
// the entry bundle names no blue chunk.
const BlueRecovery = /* @__PURE__ */ lazy(async () => ({ default: (await import('./ehr-blue/frame/auth/BlueRecovery')).BlueRecovery }))
const BlueStaffInvitation = /* @__PURE__ */ lazy(async () => ({ default: (await import('./ehr-blue/frame/auth/BlueStaffInvitation')).BlueStaffInvitation }))

function PatientNotFound() {
  useDocumentTitle('Page not found · Health ID')
  return <section className="patient-section"><p className="patient-eyebrow">Patient portal</p>
    <h1 className="patient-page-title">Page not found</h1>
    <p className="patient-page-copy">This patient page is unavailable.</p>
    <Link className="patient-primary-button" to="/">Go to overview</Link>
  </section>
}

function PatientRoutes() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/enroll" element={<Enrollment />} />
      <Route path="/enroll/facilities" element={<ParticipatingFacilitiesPage />} />
      <Route path="/recover" element={<Recovery />} />
      {/* Sharing by card: the patient's preview of the provider's page, and the provider's page itself (the email's link). */}
      <Route path="/card/preview" element={<RequireAccess requirement={PATIENT_ROUTE}><SharedCardPreview /></RequireAccess>} />
      <Route path="/card/:token" element={<SharedCardPage />} />
      {/* hid-1.0's old addresses open the page that replaces each; nothing of the old address is kept. */}
      {Object.entries(LEGACY_PATIENT_PATHS).map(([from, to]) => <Route key={from} path={from} element={<Navigate to={to} replace />} />)}
      <Route path="/" element={<RequireAccess requirement={PATIENT_ROUTE}><PortalShell /></RequireAccess>}>
        <Route index element={<Overview />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="records" element={<RecordsPage />} />
        {patientChatEnabled() && <Route path="chat" element={<PatientChat />} />}
        <Route path="access" element={<AccessPage />} />
        {/* Share my records (hid-system 0095): opens Access and consent where the backend does not serve sharing (404). */}
        <Route path="access/share" element={<ShareRecords />} />
        <Route path="notifications" element={<NotificationsPage />} />
        {/* Settings is gone: its parts are on the profile, and an old link opens it at the same #. */}
        <Route path="settings" element={<SettingsRedirect />} />
        <Route path="*" element={<PatientNotFound />} />
      </Route>
    </Routes>
  )
}

/**
 * A page another Health ID site serves (productSites.ts): it opens there, in place of this address. Until the browser
 * leaves, and if it does not, the page says where it went and links there.
 */
function OnAnotherSite({ href }: { href: string }) {
  const hostname = new URL(href).hostname
  useDocumentTitle('Opening another Health ID site · Health ID')
  useEffect(() => { openSite(href) }, [href])
  return <main className="patient-page">
    <BrandLogo className="patient-state-logo" />
    <div className="patient-access-state">
      <h1>Opening another Health ID site</h1>
      <p role="status">This page is on {hostname}. Opening it there…</p>
      <div className="patient-state-actions"><a className="patient-primary-button" href={href}>Continue to {hostname}</a></div>
    </div>
  </main>
}

function ProductHostnameGate({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const hostname = window.location.hostname
  const product = resolveStaffProductHostname(hostname)

  if (isPlatformAdminHostname(hostname) && location.pathname === '/') {
    return <Navigate to={PLATFORM_ADMIN_ROUTE} replace />
  }

  if (product && location.pathname === '/') {
    return <Navigate to={product.route} replace />
  }

  // Each product on its own site (owner, 2026-10-31): an address another site serves, typed or followed from a link,
  // opens there.
  const elsewhere = rightSiteHref(location, hostname)
  if (elsewhere) return <OnAnotherSite href={elsewhere} />

  return <>{children}</>
}

/**
 * One authenticated portal origin, with separate session and permission scopes.
 * A workspace still loading is a main landmark holding its status: a role on
 * the main element itself would replace the landmark.
 */
export function App() {
  // The auth. site serves its sign-in and nothing else (DRAFT: only once the build turns central sign-in on).
  if (centralSignInEnabled() && authDeploymentOf(window.location.hostname)) return <Routes>
    <Route path={AUTH_SIGN_IN_PATH} element={<Suspense fallback={<main><p role="status">Opening sign-in…</p></main>}><CentralSignInSite /></Suspense>} />
    <Route path="*" element={<Navigate to={AUTH_SIGN_IN_PATH} replace />} />
  </Routes>
  return <ProductHostnameGate><Routes>
    <Route path={STAFF_RECOVERY_PATH} element={BLUE_FOR_ALL
      ? <Suspense fallback={<main><p role="status">Opening account recovery…</p></main>}><BlueRecovery /></Suspense>
      : <PrincipalRecovery audience="staff" />} />
    <Route path="/provider/enroll" element={<Suspense fallback={<main><p role="status">Opening provider enrollment…</p></main>}><ProviderEnrollment /></Suspense>} />
    {/* A facility's staff invitation (Novu, P4b): public, outside the provider workspace and its session. */}
    {usesNovuBackend() && <Route path={STAFF_INVITATION_PATH} element={<Suspense fallback={<main><p role="status">Opening your invitation…</p></main>}>
      {BLUE_FOR_ALL ? <BlueStaffInvitation /> : <StaffInvitation />}</Suspense>} />}
    {/* Clinician self sign-up (hid-system ADR-066): public, outside the provider workspace and its session. */}
    <Route path={CLINICIAN_SIGNUP_PATH} element={<Suspense fallback={<main><p role="status">Opening clinician sign-up…</p></main>}><ClinicianSignUp /></Suspense>} />
    <Route path={CLINICIAN_STATUS_PATH} element={<Suspense fallback={<main><p role="status">Opening your clinician application…</p></main>}><ClinicianApplicationStatus /></Suspense>} />
    <Route path="/admin/recover" element={<PrincipalRecovery audience="admin" />} />
    <Route path="/provider/*" element={<Suspense fallback={<main><p role="status">Opening provider workspace…</p></main>}><StaffApp /></Suspense>} />
    <Route path="/admin/*" element={<Suspense fallback={<main><p role="status">Opening platform workspace…</p></main>}><AdminApp /></Suspense>} />
    <Route path="/*" element={<SessionProvider><PatientRoutes /><PatientSupport /></SessionProvider>} />
  </Routes></ProductHostnameGate>
}
