import { useCallback } from 'react'
import { useSession } from '../session'
import { HEALTH_DATA } from './healthData'
import { PATIENT_CONSENT_ITEMS } from './patientConsent'
import { PATIENT_TERMS } from './patientTerms'
import { recordQuietly } from './records'
import { AgreementChanged, useAgreementChange } from './ReAgree'

/** The two required boxes: agreeing again never changes the patient's choice about email updates. */
const REQUIRED = PATIENT_CONSENT_ITEMS.filter(item => item.required)

/**
 * The patient portal's check for a changed agreement, as the signed-in shell starts (Portal.tsx PortalShell): GET
 * identity/me/consents (PROPOSED). Shown only when it answers `needsAgreement: true`; a 404 or any fault shows nothing.
 */
export function PatientAgreementCheck() {
  const { api } = useSession()
  const load = useCallback(() => api.myConsents(), [api])
  const { change, done } = useAgreementChange(load)
  if (!change) return null
  return <AgreementChanged document={PATIENT_TERMS} changes={change.changes} items={REQUIRED} onAgree={() => {
    done()
    recordQuietly(() => api.recordConsents({ items: [
      { documentId: 'patient-terms', version: PATIENT_TERMS.version, accepted: true },
      { documentId: 'health-data', version: HEALTH_DATA.version, accepted: true },
    ], language: 'en', method: 'self' }, crypto.randomUUID()))
  }} />
}
