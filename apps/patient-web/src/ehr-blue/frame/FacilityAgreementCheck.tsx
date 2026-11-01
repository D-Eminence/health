import { useCallback } from 'react'
import { facilityAgreementApi } from '../../staff/api'
import { FACILITY_AGREEMENT, facilityAgreeLabel } from '../../agreements/facilityAgreement'
import { facilityAgreementRecord, recordQuietly } from '../../agreements/records'
import { AgreementChanged, useAgreementChange } from '../../agreements/ReAgree'

/** The roles of a facility's administrator, who signs its agreement (staffAccess.ts names them). */
const ADMINISTRATOR = /^org_admin/

/**
 * The provider workspace's check for a changed facility agreement, as the blue frame starts (BlueFrame.tsx): for the
 * facility's administrator only, GET identity/facility-agreements/current (PROPOSED). Shown only when it answers
 * `needsAgreement: true`; a 404 or any fault shows nothing and stops nothing.
 */
export function FacilityAgreementCheck({ facility, signerName }: {
  readonly facility: { readonly id: string; readonly name: string; readonly roles: readonly string[] } | undefined
  readonly signerName: string
}) {
  const administrator = facility?.roles.some(role => ADMINISTRATOR.test(role)) === true
  const facilityId = administrator ? facility?.id : undefined
  const load = useCallback(() => facilityAgreementApi.current(facilityId!), [facilityId])
  const { change, done } = useAgreementChange(facilityId ? load : null)
  if (!change || !facility) return null
  return <AgreementChanged document={FACILITY_AGREEMENT} changes={change.changes}
    items={[{ id: FACILITY_AGREEMENT.id, label: facilityAgreeLabel(facility.name), required: true }]}
    onAgree={() => {
      done()
      recordQuietly(() => facilityAgreementApi.record(facilityAgreementRecord(signerName, facility.name), crypto.randomUUID(), facility.id))
    }} />
}
