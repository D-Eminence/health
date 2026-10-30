import { EhrButton, EhrCard, EhrField, EhrInput } from '@hid/ui/ehr'
import type { Facility } from '../../staff/api'
import { selfServiceReview } from '../../staff/staffAccess'
import { NotCollectedField, required } from './parts'
import { facilityCheckDone, facilityCheckPending } from './setupText'

/**
 * Step 1, Facility (screens 14): the facility's name as Health ID has it (live, from the session, read-only) and the
 * design's other details, which Health ID does not collect: shown, disabled and marked so. Nothing here is sent or
 * kept. Where the design says how the hospital's review stands, today's Facility check says it.
 */
export function FacilityStep({ facility, onNext }: { readonly facility: Facility; readonly onNext: () => void }) {
  const review = selfServiceReview(facility)
  return (
    <EhrCard>
      <div className="hid-ehr-onboarding-stack">
        <form noValidate aria-label="Facility" className="hid-ehr-onboarding-grid" onSubmit={event => { event.preventDefault(); onNext() }}>
          <EhrField label={required('Hospital name')} hint="As Health ID has it.">
            <EhrInput readOnly value={facility.name} />
          </EhrField>
          <NotCollectedField label="Main phone" type="tel" />
          <NotCollectedField label="Main email" type="email" />
          <NotCollectedField label="Address" />
          <NotCollectedField label="City" />
          <NotCollectedField label="State" />
          <NotCollectedField label="Optional registration number" />
          <NotCollectedField label="Optional hospital logo" type="file" />
          <div className="hid-ehr-onboarding-full"><EhrButton type="submit">Save and continue</EhrButton></div>
        </form>
        {review === 'pending' ? <p className="hid-ehr-onboarding-text">{facilityCheckPending(facility.name)}</p> : null}
        {review === 'reviewed' ? <p className="hid-ehr-onboarding-text">{facilityCheckDone(facility.name)}</p> : null}
      </div>
    </EhrCard>
  )
}
