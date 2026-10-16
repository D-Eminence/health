import { Link } from 'react-router-dom'
import { AuthLayout } from '../AuthLayout'
import { useDocumentTitle } from '../authSteps'
import { useSession } from '../session'
import { FacilityList } from './enrollment/FacilityList'

/**
 * The public page of the facility route (hid-system #85, ADR-063): where a
 * person who cannot use the phone linked to their NIN can prove in person that
 * it is theirs, and what to bring. Nothing is sent but the public list read;
 * the registration itself starts on the patient's own phone at /enroll.
 */
export function ParticipatingFacilitiesPage() {
  const { api } = useSession()
  useDocumentTitle('Participating facilities · Health ID')
  return <AuthLayout brandTo="/" title="Register at a healthcare facility" titleId="facilities-title"
    lede="If you lost your SIM, changed your number, have no phone linked to your NIN, or can't get a code, a staff member at a participating facility can check your identity in person.">
    <ol className="patient-enroll-routes">
      <li>Start your registration on your own phone with your NIN, and choose to register at a facility.</li>
      <li>Go to a participating facility with what's listed below, and show the staff member the desk code on your phone.</li>
      <li>After the check, finish on your phone: add a contact and choose a password.</li>
    </ol>
    <FacilityList api={api} titleLevel="h2" />
    <Link className="patient-primary-button auth-primary" to="/enroll">Start registration</Link>
    <p className="patient-auth-footer">Already have a Health ID? <Link to="/sign-in">Sign in</Link></p>
  </AuthLayout>
}
