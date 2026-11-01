import '@hid/ui/ehr.css'
import './signup.css'
import { useSearchParams } from 'react-router-dom'
import { useDocumentTitle } from '../../authSteps'
import { usesNovuBackend } from '../../backendContract'
import { PROVIDER_ENROLLMENT_PATH, providerEnrollmentHref } from '../../productHostname'
import { ProviderEnrollment } from '../../staff/routes/ProviderEnrollment'
import { ClosedPanel, CodeStep, FacilityReady, HelpPanel, MaybeActive, PasswordStep, Submitted, UnavailablePanel } from './AfterSubmit'
import { isProduct } from './enrollmentRules'
import { Registration } from './Registration'
import { SignupShell } from './SignupShell'
import { useEnrollment } from './useEnrollment'

/**
 * /provider/enroll once the clinic switch is on (App.tsx, BLUE_FOR_ALL): today's facility sign-up in the design's
 * registration (screens/1-register-and-launch 02-09). It is the same public, accountless page at the same address,
 * under the same conditions: nothing here opens a sign-up anywhere today's would not.
 *
 * - On hid-system main (main-v1) it is today's page itself. The blue flow is Novu only (novu-v1, which production and
 *   staging build with): main adds an authenticator step after the password and counts codes itself, which the design
 *   does not draw.
 * - On a staff product host or the admin site it says, as today's does, that sign-up is done on the main Health ID site,
 *   with today's link (hid-system accepts the sign-up's security check only there), and asks nothing.
 */
export function BlueProviderEnrollment() {
  if (!usesNovuBackend()) return <ProviderEnrollment />
  const elsewhere = providerEnrollmentHref(window.location.hostname)
  return elsewhere === PROVIDER_ENROLLMENT_PATH ? <BlueEnrollmentSteps /> : <EnrollOnMainSite href={elsewhere} />
}

/** Today's EnrollOnMainSite (staff/routes/ProviderEnrollment.tsx:438-449), in the design's look. */
function EnrollOnMainSite({ href }: { readonly href: string }) {
  useDocumentTitle('Provider enrollment · Health ID Provider')
  const [params] = useSearchParams()
  const product = params.get('product')
  const target = isProduct(product) ? `${href}?product=${product}` : href
  return (
    <SignupShell centered onMainSite={false}>
      <h1 className="hid-ehr-page-title hid-ehr-signup-title">Register your facility</h1>
      <p className="hid-ehr-signup-lede">Facility sign-up is done on the main Health ID site.</p>
      <a className="hid-ehr-button hid-ehr-signup-wide" href={target}>Continue to facility sign-up</a>
    </SignupShell>
  )
}

function BlueEnrollmentSteps() {
  useDocumentTitle('Provider enrollment · Health ID Provider')
  const e = useEnrollment()
  const registration = !e.closed && e.availability !== 'unavailable' && (e.availability === 'checking' || e.stage === 'details')
  return (
    <SignupShell centered={!registration}>
      {e.closed ? <ClosedPanel />
        : e.availability === 'unavailable' ? <UnavailablePanel e={e} />
          : registration ? <Registration e={e} />
            : e.stage === 'otp' ? (e.submitted ? <Submitted e={e} /> : <CodeStep e={e} />)
              : e.stage === 'password' ? <PasswordStep e={e} />
                : e.stage === 'done' ? <FacilityReady e={e} />
                  : e.stage === 'sign-in' ? <MaybeActive e={e} />
                    : <HelpPanel e={e} />}
    </SignupShell>
  )
}
