import '@hid/ui/ehr.css'
import './signup.css'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDocumentTitle } from '../../authSteps'
import { usesNovuBackend } from '../../backendContract'
import { PROVIDER_ENROLLMENT_PATH, providerEnrollmentHref } from '../../productHostname'
import { OpenStaffPage } from '../../staffSignIn'
import { ProviderEnrollment } from '../../staff/routes/ProviderEnrollment'
import { ClosedPanel, CodeStep, FacilityReady, HelpPanel, MaybeActive, PasswordStep, Submitted, UnavailablePanel } from './AfterSubmit'
import { isProduct } from './enrollmentRules'
import { NO_AGREEMENTS, Registration, type Agreements } from './Registration'
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
 * - Each product site has its own (hid-system accepts the sign-up's security check there), starting with the site's own
 *   product chosen (facilitySignUpPreset). On a site that serves no staff pages (the production patient portal, an
 *   admin site) it opens the EHR site's at once, as today's does, keeping only a product it knows.
 */
export function BlueProviderEnrollment() {
  if (!usesNovuBackend()) return <ProviderEnrollment />
  const elsewhere = providerEnrollmentHref(window.location.hostname)
  return elsewhere === PROVIDER_ENROLLMENT_PATH ? <BlueEnrollmentSteps /> : <EnrollElsewhere href={elsewhere} />
}

/** Today's EnrollElsewhere (staff/routes/ProviderEnrollment.tsx): the EHR site's sign-up, with a product it knows. */
function EnrollElsewhere({ href }: { readonly href: string }) {
  const [params] = useSearchParams()
  const product = params.get('product')
  return <OpenStaffPage href={isProduct(product) ? `${href}?product=${product}` : href} />
}

function BlueEnrollmentSteps() {
  useDocumentTitle('Provider enrollment · Health ID Provider')
  const e = useEnrollment()
  // The four agreements: React state only, kept while the page is open (Health ID does not record them yet).
  const [agreed, setAgreed] = useState<Agreements>(NO_AGREEMENTS)
  const registration = !e.closed && e.availability !== 'unavailable' && (e.availability === 'checking' || e.stage === 'details')
  return (
    <SignupShell centered={!registration}>
      {e.closed ? <ClosedPanel />
        : e.availability === 'unavailable' ? <UnavailablePanel e={e} />
          : registration ? <Registration e={e} agreed={agreed} onAgree={(key, value) => setAgreed(now => ({ ...now, [key]: value }))} />
            : e.stage === 'otp' ? (e.submitted ? <Submitted e={e} /> : <CodeStep e={e} />)
              : e.stage === 'password' ? <PasswordStep e={e} />
                : e.stage === 'done' ? <FacilityReady e={e} />
                  : e.stage === 'sign-in' ? <MaybeActive e={e} />
                    : <HelpPanel e={e} />}
    </SignupShell>
  )
}
