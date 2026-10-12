import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../session'
import { usePatientResource } from './usePatientResource'
import { useDocumentTitle } from '../authSteps'
import { useRetryFocus } from './actionFocus'

export function Overview() {
  const { api } = useSession()
  useDocumentTitle('Overview · Health ID')
  const profile = usePatientResource(api.profile)
  const heading = useRef<HTMLHeadingElement>(null)
  const retryFocus = useRetryFocus(heading)

  return <section className="patient-section">
    <p className="patient-eyebrow">Your account</p>
    <h1 ref={heading} tabIndex={-1} className="patient-page-title">Your health, connected.</h1>
    <p className="patient-page-copy">Your Health ID helps keep your records linked while you manage who can access them.</p>
    {profile.loading ? <div role="status" className="patient-card patient-loading">Loading your profile…</div>
      : profile.error ? <div role="alert" className="patient-card"><p>{profile.error}</p><button ref={retryFocus.button} type="button" onClick={() => retryFocus.retry(profile.reload)}>Try again</button></div>
      : profile.data ? <div className="patient-identity-card"><span className="patient-eyebrow">Health ID</span><strong>{profile.data.hid}</strong>
          <p>{profile.data.fullName}</p><Link to="/profile">View profile →</Link></div>
      : <div className="patient-card">No profile was returned.</div>}
    <div className="patient-overview-grid">
      <Link className="patient-card patient-action-card" to="/records"><strong>Health records</strong><span>View completed encounters and signed clinical notes.</span><b>Open records →</b></Link>
      <Link className="patient-card patient-action-card" to="/access"><strong>Access and consent</strong><span>Review access requests and see who has been granted access.</span><b>Manage access →</b></Link>
      <Link className="patient-card patient-action-card" to="/notifications"><strong>Notifications</strong><span>See updates related to your account and access requests.</span><b>View notifications →</b></Link>
    </div>
  </section>
}
