import { lazy, Suspense } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { PATIENT_ROUTE } from '@hid/auth'
import { RequireAccess } from './RequireAccess'
import { SessionProvider } from './session'
import { PatientSupport } from './PatientSupport'
import { patientChatEnabled } from './chatFeatures'
import { PatientChat } from './routes/Chat'
import { Overview } from './routes/Overview'
import { SignIn } from './routes/SignIn'
import { Enrollment } from './routes/Enrollment'
import { Recovery } from './routes/Recovery'
import { PrincipalRecovery } from './routes/PrincipalRecovery'
import { AccessPage, NotificationsPage, PortalShell, ProfilePage, RecordsPage, SettingsPage } from './routes/Portal'
import { resolveStaffProductHostname, isPlatformAdminHostname, PLATFORM_ADMIN_ROUTE } from './productHostname'

const StaffApp = lazy(async () => ({ default: (await import('./staff/App')).App }))
const AdminApp = lazy(async () => ({ default: (await import('./admin/App')).App }))

function PatientNotFound() {
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
      <Route path="/recover" element={<Recovery />} />
      <Route path="/" element={<RequireAccess requirement={PATIENT_ROUTE}><PortalShell /></RequireAccess>}>
        <Route index element={<Overview />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="records" element={<RecordsPage />} />
        {patientChatEnabled() && <Route path="chat" element={<PatientChat />} />}
        <Route path="access" element={<AccessPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<PatientNotFound />} />
      </Route>
    </Routes>
  )
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

  return <>{children}</>
}

/** One authenticated portal origin, with separate session and permission scopes. */
export function App() {
  return <ProductHostnameGate><Routes>
    <Route path="/provider/recover" element={<PrincipalRecovery audience="staff" />} />
    <Route path="/admin/recover" element={<PrincipalRecovery audience="admin" />} />
    <Route path="/provider/*" element={<Suspense fallback={<main role="status">Opening provider workspace…</main>}><StaffApp /></Suspense>} />
    <Route path="/admin/*" element={<Suspense fallback={<main role="status">Opening platform workspace…</main>}><AdminApp /></Suspense>} />
    <Route path="/*" element={<SessionProvider><PatientRoutes /><PatientSupport /></SessionProvider>} />
  </Routes></ProductHostnameGate>
}
