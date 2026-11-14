import '@hid/ui/ehr.css'
import './signup.css'
import { useLocation } from 'react-router-dom'
import { useDocumentTitle } from '../../authSteps'
import { usesNovuBackend } from '../../backendContract'
import { PROVIDER_ENROLLMENT_PATH, providerEnrollmentHref } from '../../productHostname'
import { StaffPageElsewhere } from '../../staffSignIn'
import { ProviderEnrollment } from '../../staff/routes/ProviderEnrollment'
import { ClosedPanel, CodeStep, FacilityReady, HelpPanel, MaybeActive, PasswordStep, Submitted, UnavailablePanel } from './AfterSubmit'
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
 * - Each product site has its own (hid-system accepts the sign-up's security check there), for that site's own kind of
 *   facility only (facilitySignUpScope). On a site that serves no staff pages (the production patient portal, an
 *   admin site) it opens the product site's the address names at once, as today's does.
 */
export function BlueProviderEnrollment() {
  if (!usesNovuBackend()) return <ProviderEnrollment />
  return providerEnrollmentHref(window.location.hostname) === PROVIDER_ENROLLMENT_PATH ? <BlueEnrollmentSteps /> : <EnrollElsewhere />
}

/**
 * Today's EnrollElsewhere (staff/routes/ProviderEnrollment.tsx): the same sign-up on the product site the address
 * names (a laboratory's on lab., a pharmacy's on pharmacy.), else the EHR site's, as the app's gate and the edge open it.
 */
function EnrollElsewhere() {
  return <StaffPageElsewhere location={useLocation()} />
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
