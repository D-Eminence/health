import { useNavigate } from 'react-router-dom'
import { toast } from '@hid/ui'
import { EhrButton, EhrCard, EhrSampleBanner } from '@hid/ui/ehr'
import type { Facility } from '../../staff/api'
import { selfServiceReview } from '../../staff/staffAccess'
import { Detail } from './parts'
import { NOT_COLLECTED, NO_LAUNCH_STEP, facilityCheckPending } from './setupText'
import { paymentMethods, type SampleSetup } from './setupState'

/**
 * What stands before launch on Health ID itself: Health ID support's check of a facility that signed itself up, live from
 * the session, in today's words (FacilityCheckCard). Nothing once the check is done.
 */
function FacilityCheckBlocker({ facility, id }: { readonly facility: Facility; readonly id?: string }) {
  if (selfServiceReview(facility) !== 'pending') return null
  return <div id={id} className="hid-ehr-onboarding-blocker"><p>{facilityCheckPending(facility.name)}</p></div>
}

const LAUNCH_WAITING = 'hid-ehr-onboarding-launch-waiting'

/**
 * Step 8, Review (screen 21): the facility's name and Health ID support's check (live), then what the sample steps
 * hold for this visit. The design's other launch blockers judge sample settings, and launch nothing here: they are
 * left out. `setup` is null where the sample steps are not shown (a real facility): then nothing of theirs is listed,
 * not even their starting values, and there is no sample to mark.
 */
export function ReviewStep({ facility, setup, onNext }: {
  readonly facility: Facility
  readonly setup: SampleSetup | null
  readonly onNext: () => void
}) {
  return (
    <EhrCard title="Review your configuration">
      <div className="hid-ehr-onboarding-stack">
        <FacilityCheckBlocker facility={facility} />
        {setup ? <EhrSampleBanner /> : null}
        <dl className="hid-ehr-onboarding-details">
          <Detail term="Name">{facility.name}</Detail>
          {setup ? <Detail term="Type">{setup.type || 'Not chosen'}</Detail> : null}
          <Detail term="Phone">{NOT_COLLECTED}</Detail>
          <Detail term="Email">{NOT_COLLECTED}</Detail>
          <Detail term="Address">{NOT_COLLECTED}</Detail>
          <Detail term="City">{NOT_COLLECTED}</Detail>
          <Detail term="State">{NOT_COLLECTED}</Detail>
          {setup ? <>
            <Detail term="Departments">{setup.departments.join(', ')}</Detail>
            <Detail term="Currency">{setup.billing.currency}</Detail>
            <Detail term="Payment Methods">{paymentMethods(setup.billing.methods).join(', ')}</Detail>
            <Detail term="Payment Timing">{setup.billing.paymentTiming}</Detail>
            <Detail term="Insurance">{setup.billing.insurance ? 'Yes' : 'No'}</Detail>
          </> : null}
        </dl>
        {setup ? (
          <div>
            <h3 className="hid-ehr-onboarding-subheading">Branches</h3>
            {setup.branches.map(branch => (
              <p key={branch.id} className="hid-ehr-onboarding-text">
                {[branch.name, branch.address, branch.departments.join(', ')].filter(Boolean).join(' · ')}</p>
            ))}
          </div>
        ) : null}
        <p className="hid-ehr-onboarding-text">Optional after launch: staff invitations, service pricing, wards and beds, inventory and
          professional credential records.</p>
        <div><EhrButton onClick={onNext}>Review launch requirements</EhrButton></div>
      </div>
    </EhrCard>
  )
}

/**
 * Step 9, Launch (screen 22), a sample: Health ID has no launch step, and a facility's EHR opens as soon as it signs up.
 * "Launch facility" waits for Health ID support's check, saying today's waiting sentence until it is done; then it sends
 * nothing: it opens Home, saying so in a status that outlives the page (the portal's toasts, whose words are generic).
 */
export function LaunchStep({ facility }: { readonly facility: Facility }) {
  const navigate = useNavigate()
  const waiting = selfServiceReview(facility) === 'pending'
  return (
    <EhrCard title="Ready to launch?">
      <div className="hid-ehr-onboarding-stack">
        <FacilityCheckBlocker facility={facility} id={LAUNCH_WAITING} />
        <p className="hid-ehr-onboarding-text">A new facility starts with no patients, stock or transactions.</p>
        <div>
          <EhrButton disabled={waiting} aria-describedby={waiting ? LAUNCH_WAITING : undefined}
            onClick={() => { toast.info(NO_LAUNCH_STEP); navigate('/provider') }}>Launch facility</EhrButton>
        </div>
      </div>
    </EhrCard>
  )
}
