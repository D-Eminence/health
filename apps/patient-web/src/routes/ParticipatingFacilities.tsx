import { Link } from 'react-router-dom'
import { buttonClass } from '../kasuwa/ui'
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
  useDocumentTitle('Facilities that work with Health ID · Health ID')
  return <AuthLayout brandTo="/" title="Sign up at a health facility" titleId="facilities-title"
    lede="Can't get a code on the phone linked to your NIN? A staff member at one of these facilities can check your ID in person.">
    <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-ink-2">
      <li>Start on your phone with your NIN, and choose to sign up at a facility.</li>
      <li>Bring what's listed below, and show the staff member the desk code on your phone.</li>
      <li>Finish on your phone: add a phone or email and choose a password.</li>
    </ol>
    <FacilityList api={api} titleLevel="h2" />
    <Link className={buttonClass({ variant: 'primary', size: 'lg', block: true })} to="/enroll">Start signing up</Link>
    <p className="m-0 text-center text-sm text-ink-2 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:font-medium [&_a]:text-brand-ink">Already have a Health ID? <Link to="/sign-in">Sign in</Link></p>
  </AuthLayout>
}
