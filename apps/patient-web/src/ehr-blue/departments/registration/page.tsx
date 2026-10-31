import type { EhrBluePage } from '../types'
import { PatientRegistration, RegistrationUnavailable } from './Registration'
import { RegistrationIcon } from './registrationParts'

/**
 * Patient registration, in place of the frame's live stand-in (frame/pages.ts: the same path, group, label and
 * permission). Without the permission the frame shows today's own refusal at the address (Registration.tsx 215),
 * which reads nothing.
 */
export const registrationPage: EhrBluePage = {
  path: 'registration',
  group: 'Clinical',
  label: 'Patient registration',
  permission: 'identity.registration.write',
  status: 'live',
  icon: <RegistrationIcon />,
  element: <PatientRegistration />,
  refusal: <RegistrationUnavailable />,
}
