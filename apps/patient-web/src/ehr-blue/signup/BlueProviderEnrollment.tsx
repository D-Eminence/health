import '@hid/ui/ehr.css'
import './signup.css'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDocumentTitle } from '../../authSteps'
import { usesNovuBackend } from '../../backendContract'
import { PROVIDER_ENROLLMENT_PATH, providerEnrollmentHref } from '../../productHostname'
import { ProviderEnrollment } from '../../staff/routes/ProviderEnrollment'
import { ClosedPanel, CodeStep, FacilityReady, HelpPanel, MaybeActive, PasswordStep, UnavailablePanel } from './AfterSubmit'
import { isProduct } from './enrollmentRules'
import { NO_SIGNING, Registration, type FacilitySigning } from './Registration'
import { SignupShell } from './SignupShell'
import { useEnrollment, type Enrollment } from './useEnrollment'
import { signerOf } from './Registration'
import { facilityAgreementApi } from '../../staff/api'
import { facilityAgreementRecord, recordQuietly } from '../../agreements/records'

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
  useDocumentTitle('Facility sign-up · Health ID Provider')
  const [params] = useSearchParams()
  const product = params.get('product')
  const target = isProduct(product) ? `${href}?product=${product}` : href
  return (
    <SignupShell centered onMainSite={false}>
      <h1 className="hid-ehr-signup-title">Register a facility</h1>
      <p className="hid-ehr-signup-lede">Facilities sign up on the main Health ID site.</p>
      <div className="hid-ehr-signup-actions"><a className="hid-ehr-button" href={target}>Go to facility sign-up</a></div>
    </SignupShell>
  )
}

function BlueEnrollmentSteps() {
  useDocumentTitle('Facility sign-up · Health ID Provider')
  const e = useEnrollment()
  // The facility agreement: React state only while the page is open; recorded once the account exists (below).
  const [signing, setSigning] = useState<FacilitySigning>(NO_SIGNING)
  useRecordSigning(e, signing)
  const registration = !e.closed && e.availability !== 'unavailable' && (e.availability === 'checking' || e.stage === 'details')
  return (
    <SignupShell centered={!registration}>
      {e.closed ? <ClosedPanel />
        : e.availability === 'unavailable' ? <UnavailablePanel e={e} />
          : registration ? <Registration e={e} signing={signing} onSigning={setSigning} />
            : e.stage === 'otp' ? <CodeStep e={e} />
              : e.stage === 'password' ? <PasswordStep e={e} />
                : e.stage === 'done' ? <FacilityReady e={e} />
                  : e.stage === 'sign-in' ? <MaybeActive e={e} />
                    : <HelpPanel e={e} />}
    </SignupShell>
  )
}

/**
 * Records the facility agreement once, when activation has made the administrator's account and signed them in (stage
 * 'done': Novu answers with the session). Before that there is no account to record it against, so nothing is kept in
 * the browser; a sign-up that ends without a session (an authenticator step, or "may already be ready") records nothing
 * here, and the backend records it at account creation instead (BACKEND-NEEDS.md). A refusal or 404 changes nothing.
 */
function useRecordSigning(e: Enrollment, signing: { agreed: boolean; signerName: string | null }) {
  const recorded = useRef(false)
  const done = e.stage === 'done'
  const signer = signerOf(signing, e)
  const facilityName = e.registering?.organizationName ?? e.cacNumber
  useEffect(() => {
    if (!done || recorded.current || !signing.agreed) return
    recorded.current = true
    recordQuietly(() => facilityAgreementApi.record(facilityAgreementRecord(signer, facilityName), crypto.randomUUID()))
  }, [done, signing.agreed, signer, facilityName])
}
