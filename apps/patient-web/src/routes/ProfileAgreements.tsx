import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download } from 'lucide-react'
import { useSession } from '../session'
import { Button } from '../kasuwa/ui'
import { AgreementSheet } from '../agreements/AgreementSheet'
import { HEALTH_DATA } from '../agreements/healthData'
import { PATIENT_TERMS } from '../agreements/patientTerms'
import { printAgreement } from '../agreements/printAgreement'
import { notServed, type PatientConsents, type RecordedConsent } from '../agreements/records'
import { agreementDate, type AgreementDocument } from '../agreements/types'
import { ProfileSection } from './ProfileSection'
import { usePatientResource } from './usePatientResource'

const DOCUMENTS: readonly AgreementDocument[] = [PATIENT_TERMS, HEALTH_DATA]

/**
 * The profile's Agreements: what the patient agreed to, with its version and date, Read (the full text in a sheet) and
 * Download copy. Read from GET identity/me/consents (PROPOSED); until a backend serves it, or when it cannot be read,
 * the current versions are listed with Read only: no dates, and nothing said about why. Taking consent back is done
 * where it happens: Access (stop sharing) and Delete account.
 */
export function ProfileAgreements({ deletionOffered }: { readonly deletionOffered: boolean }) {
  const { api } = useSession()
  const load = useCallback(async (signal?: AbortSignal): Promise<PatientConsents | null> => {
    try { return await api.myConsents(signal) } catch (reason) { if (notServed(reason)) return null; throw reason }
  }, [api])
  const consents = usePatientResource(load, 'identity/me/consents')
  const [reading, setReading] = useState<AgreementDocument | null>(null)
  const recorded = consents.error ? [] : consents.data?.items ?? []
  const agreed = (document: AgreementDocument): RecordedConsent | undefined =>
    recorded.find(item => item.documentId === document.id && item.accepted)

  return <ProfileSection id="agreements" title="Agreements">
    <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
      {DOCUMENTS.map(document => {
        const record = agreed(document)
        const signed = record ? { on: record.at } : undefined
        return <li key={document.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-[1_1_14rem]">
            <p className="m-0 text-sm font-medium text-ink">{document.title}</p>
            <p className="m-0 mt-0.5 text-[13px] text-ink-3">
              Version {record?.version ?? document.version}{record?.at ? ` · agreed ${agreementDate(record.at.slice(0, 10))}` : ''}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button aria-label={`Read ${document.title}`} onClick={() => setReading(document)}>Read</Button>
            {record && <Button variant="ghost" icon={Download} aria-label={`Download copy of ${document.title}`}
              onClick={() => printAgreement(document, signed)}>Download copy</Button>}
          </div>
        </li>
      })}
    </ul>
    <p className="m-0 text-sm text-ink-2">
      <Link to="/access" className="font-medium text-brand-ink underline underline-offset-2">Stop sharing</Link>
      {deletionOffered ? <> or <Link to="/profile#account-deletion" className="font-medium text-brand-ink underline underline-offset-2">close your account</Link></> : null}
    </p>
    {reading && <AgreementSheet document={reading} open onClose={() => setReading(null)}
      signed={agreed(reading) ? { on: agreed(reading)!.at } : undefined} />}
  </ProfileSection>
}
