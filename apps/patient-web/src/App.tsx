import { Navigate, Route, Routes } from 'react-router-dom'
import { PATIENT_ROUTE } from '@hid/auth'
import { RequireAccess } from './RequireAccess'
import { Overview } from './routes/Overview'
import { SignIn } from './routes/SignIn'

/**
 * Routing for the patient application.
 *
 * The route table reflects one application boundary: everything here belongs to
 * a patient managing their own information. Staff workflows, administration and
 * outreach live in their own applications rather than behind a role check in
 * this one.
 */
export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignIn />} />
      <Route
        path="/"
        element={
          <RequireAccess requirement={PATIENT_ROUTE}>
            <Overview />
          </RequireAccess>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
