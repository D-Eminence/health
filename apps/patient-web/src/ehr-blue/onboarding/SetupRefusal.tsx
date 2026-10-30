import { EhrPageHeading } from '@hid/ui/ehr'
import '@hid/ui/ehr.css'
import { useStaff } from '../../staff/App'
import { selfServiceReview } from '../../staff/staffAccess'
import { BLUE_FOR_ALL } from '../clinicSwitch'
import { SETUP_PERMISSION } from './access'
import { NOT_SELF_SIGNED_UP, PAGE_LABEL, onlyTheAdministrator } from './setupText'
import './onboarding.css'

/**
 * What Facility setup's address says where the page is not open (opensFacilitySetup), as a department page says it
 * (DeptUnavailable): its heading and one plain sentence, from the session alone. It reads nothing.
 */
export function SetupRefusal() {
  const { state } = useStaff()
  const facility = state.status === 'ready' ? state.session.actor.facility : undefined
  // A member of a facility that did sign itself up, without its staff to manage: it is the administrator's page.
  const notTheAdministrator = BLUE_FOR_ALL && facility !== undefined && selfServiceReview(facility) !== null
    && !facility.permissions.includes(SETUP_PERMISSION)
  return (
    <div className="hid-ehr-onboarding-refusal">
      <EhrPageHeading title={PAGE_LABEL} />
      <div className="hid-ehr-empty-state">
        <p className="hid-ehr-state-message">{notTheAdministrator ? onlyTheAdministrator(facility.name) : NOT_SELF_SIGNED_UP}</p>
      </div>
    </div>
  )
}
