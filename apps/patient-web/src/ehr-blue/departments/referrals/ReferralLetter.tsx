import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { EhrButton } from '@hid/ui/ehr'
import { referralsApi, type ReferralLetter } from '../../../staff/api'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage } from '../parts/DeptPage'
import { useFacilityRead } from '../parts/useFacilityRead'
import { PackageView } from './ReferralParts'
import {
  BASE, bornText, departmentText, destinationText, learnFrom, notServed, referrerText, refusalWords, sexText, urgencyText, whenText,
} from './referralRules'

/**
 * The printable referral letter (REF-1 route 5), A4: the referring facility's name and address, the reference, the
 * patient's name, sex and date of birth (never the Health ID, Q-REF-13 A), where to and why, the letter and what was
 * sent, and the referring clinician with their licence, every date in Lagos. A letter to a facility on Health ID is
 * headed "Patient copy". Each read is one print, recorded by Health ID, so the letter is read once when this page opens.
 */
export function ReferralLetterPage({ facilityId, referralId }: { readonly facilityId: string; readonly referralId: string }) {
  const navigate = useNavigate()
  const loader = useCallback((id: string) => referralsApi.letter(id, referralId).then(answer => { learnFrom(); return answer },
    (caught: unknown) => { learnFrom(caught); throw caught }), [referralId])
  const read = useFacilityRead<ReferralLetter>(facilityId, true, loader, 'The letter could not be loaded.')
  if (read.caught && notServed(read.caught)) return null
  const value = read.value
  return (
    <DeptPage title="Referral letter" className="hid-ehr-dept-referrals" onBack={() => navigate(`${BASE}/${referralId}`)} backLabel="Back to the referral"
      primaryAction={value ? <EhrButton onClick={() => window.print()}>Print</EhrButton> : undefined}>
      {read.error ? <DeptNotice role="alert" tone="critical">{refusalWords(read.caught, read.error)}</DeptNotice> : null}
      {value === null && read.loading ? <p className="hid-ehr-state-message" role="status">Loading the letter…</p> : null}
      {value ? <Letter value={value} /> : null}
    </DeptPage>
  )
}

function Letter({ value }: { readonly value: ReferralLetter }) {
  const { referral: card, package: pkg, letter } = value
  const patient = card.patient
  const printed = card.destinationKind === 'printed'
  const facts: Array<[string, string]> = [
    ['Reference', card.reference],
    ['Printed', whenText(letter.printedAt)],
    ['To', destinationText(card)],
    ['Patient', [patient?.fullName ?? '', sexText(patient?.sex), bornText(patient?.dateOfBirth, patient?.dateOfBirthEstimated)].filter(Boolean).join(', ')],
    ['Department wanted', departmentText(card.departmentCode)],
    ...(card.serviceWanted ? [['Service wanted', card.serviceWanted] as [string, string]] : []),
    ['Urgency', urgencyText(card.urgency)],
    ...(card.reason ? [['Reason', card.reason] as [string, string]] : []),
    ['Sent', whenText(card.sentAt)],
  ]
  return (
    <article className="hid-ehr-card hid-ehr-dept-section hid-ehr-dept-referrals-print" aria-label="Referral letter">
      <header>
        <h2>{card.referringFacility.name}</h2>
        {letter.referringFacilityAddress ? <p className="hid-ehr-dept-referrals-line">{letter.referringFacilityAddress}</p> : null}
        <p><strong>{printed ? 'Referral letter' : 'Referral letter: patient copy'}</strong></p>
      </header>
      <dl className="hid-ehr-dept-referrals-facts">
        {facts.map(([label, text]) => <div key={label} style={{ display: 'contents' }}><dt>{label}</dt><dd>{text}</dd></div>)}
      </dl>
      <PackageView pkg={pkg} />
      <p>Referred by {referrerText(card.referrer)}</p>
      <p className="hid-ehr-dept-referrals-line">
        {printed ? 'This letter is the patient’s to carry. Health ID did not send it anywhere.'
          : `This is the patient’s copy. ${destinationText(card)} received the referral through Health ID.`}
      </p>
    </article>
  )
}
