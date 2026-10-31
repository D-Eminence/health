import type { EhrBluePage } from '../types'
import { InPersonCheck, InPersonUnavailable } from './InPersonCheck'
import { ASSISTED_REGISTRATION_PERMISSION, TITLE } from './inPersonRules'

/**
 * In-person check (an ID card), drawn inline in the sidebar's stroke style as parts/icons.tsx draws the others: the
 * card, its photo and two lines of text. Hidden from assistive technology: the page's label names it.
 */
function IdCardIcon() {
  return (
    <svg className="hid-ehr-dept-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M6 16a3 3 0 0 1 6 0M14.5 10h3.5M14.5 13.5h3.5" />
    </svg>
  )
}

/**
 * The frame's live stand-in for In-person check (frame/pages.ts: 'in-person-check', Clinical, today's permission),
 * replaced in place. Today's page refuses a member without the permission in its own words, which the frame shows at
 * the address (`refusal`): it reads nothing.
 */
export const inPersonCheckPage: EhrBluePage = {
  path: 'in-person-check',
  group: 'Clinical',
  label: TITLE,
  permission: ASSISTED_REGISTRATION_PERMISSION,
  status: 'live',
  icon: <IdCardIcon />,
  element: <InPersonCheck />,
  refusal: <InPersonUnavailable />,
}
