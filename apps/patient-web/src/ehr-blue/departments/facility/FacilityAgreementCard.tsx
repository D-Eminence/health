import { useEffect, useState } from 'react'
import { EhrButton } from '@hid/ui/ehr'
import { facilityAgreementApi } from '../../../staff/api'
import { AgreementSheet } from '../../../agreements/AgreementSheet'
import { FACILITY_AGREEMENT } from '../../../agreements/facilityAgreement'
import { printAgreement } from '../../../agreements/printAgreement'
import type { FacilityAgreementCurrent } from '../../../agreements/records'
import { agreementDate } from '../../../agreements/types'
import { DeptSection } from '../parts/DeptPage'
import { DeptFacts } from '../parts/DeptRecord'

/** 44px, the owner's target size (the kit's buttons are 40px). */
const TARGET = { minHeight: 44 } as const

/**
 * The Facility profile's Agreement card: who signed the facility agreement, when, and which version, with Read (the
 * full text in a sheet) and Download copy. Read from GET identity/facility-agreements/current (PROPOSED); until a
 * backend serves it, or when it cannot be read, the card offers Read alone, and says nothing about why.
 */
export function FacilityAgreementCard({ facilityId }: { readonly facilityId: string }) {
  const [current, setCurrent] = useState<FacilityAgreementCurrent | null>(null)
  const [reading, setReading] = useState(false)
  useEffect(() => {
    let live = true
    setCurrent(null)
    Promise.resolve(facilityId).then(id => facilityAgreementApi.current(id)).then(answer => { if (live) setCurrent(answer) }, () => undefined)
    return () => { live = false }
  }, [facilityId])
  const signed = current?.signedAt ? current : null
  const copyOf = signed ? { by: signed.signerName, on: signed.signedAt } : undefined

  return (
    <DeptSection title="Agreement">
      <p className="hid-ehr-dept-muted">{FACILITY_AGREEMENT.title}</p>
      {signed ? <DeptFacts facts={[
        { label: 'Signed by', value: signed.signerName ?? 'Not recorded' },
        { label: 'Date', value: agreementDate(signed.signedAt!.slice(0, 10)) },
        { label: 'Version', value: signed.version ?? FACILITY_AGREEMENT.version },
      ]} /> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <EhrButton variant="secondary" style={TARGET} onClick={() => setReading(true)}>Read</EhrButton>
        {signed ? <EhrButton variant="secondary" style={TARGET} onClick={() => printAgreement(FACILITY_AGREEMENT, copyOf)}>Download copy</EhrButton> : null}
      </div>
      <AgreementSheet document={FACILITY_AGREEMENT} open={reading} onClose={() => setReading(false)} signed={copyOf} />
    </DeptSection>
  )
}
