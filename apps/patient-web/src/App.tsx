import { lazy, Suspense } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { PATIENT_ROUTE } from '@hid/auth'
import { RequireAccess } from './RequireAccess'
import { SessionProvider } from './session'
import { Overview } from './routes/Overview'
import { SignIn } from './routes/SignIn'
import { Enrollment } from './routes/Enrollment'
import { Recovery } from './routes/Recovery'
import { PrincipalRecovery } from './routes/PrincipalRecovery'
import { AccessPage, NotificationsPage, PortalShell, ProfilePage, RecordsPage, SettingsPage } from './routes/Portal'

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
        <Route path="access" element={<AccessPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<PatientNotFound />} />
      </Route>
    </Routes>
  )
}

/** One authenticated portal origin, with separate session and permission scopes. */
export function App() {
  return <Routes>
    <Route path="/provider/recover" element={<PrincipalRecovery audience="staff" />} />
    <Route path="/admin/recover" element={<PrincipalRecovery audience="admin" />} />
    <Route path="/provider/*" element={<Suspense fallback={<main role="status">Opening provider workspace…</main>}><StaffApp /></Suspense>} />
    <Route path="/admin/*" element={<Suspense fallback={<main role="status">Opening platform workspace…</main>}><AdminApp /></Suspense>} />
    <Route path="/*" element={<SessionProvider><PatientRoutes /></SessionProvider>} />
  </Routes>
}
