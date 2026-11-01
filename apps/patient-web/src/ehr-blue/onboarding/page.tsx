import { EhrIcon } from '@hid/ui/ehr'
import type { EhrBluePage } from '../frame/types'
import { SETUP_PERMISSION, opensFacilitySetup } from './access'
import { FacilitySetup } from './FacilitySetup'
import { SetupRefusal } from './SetupRefusal'
import { PAGE_LABEL } from './setupText'

/**
 * Facility setup, the design's onboarding wizard (screens 14-22): partly live (the facility's name, Health ID support's
 * check, Staff & access), partly a sample. Shown, and listed in the sidebar and search, only by opensFacilitySetup:
 * the clinic switch on, a facility that signed itself up, its staff's manager. Elsewhere its address says so, reading
 * nothing. The frame's own Facility settings sample (path 'setup') is another page, the demo facilities' alone. At a
 * real facility the wizard leaves out its sample steps (FacilitySetup).
 */
export const onboardingPage: EhrBluePage = {
  path: 'onboarding/*',
  group: 'Settings',
  label: PAGE_LABEL,
  icon: <EhrIcon name="checklist" />,
  permission: SETUP_PERMISSION,
  status: 'partial',
  element: <FacilitySetup />,
  visible: opensFacilitySetup,
  refusal: <SetupRefusal />,
}
