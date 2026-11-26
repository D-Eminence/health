import type { EhrBluePage } from '../types'
import { Referrals } from './Referrals'
import { ReferralsRefusal } from './ReferralParts'
import {
  REFERRAL_ARRIVE, REFERRAL_READ, REFERRAL_RECEIVE, REFERRAL_SEND, TITLE, referralsServed, subscribeReferralsServed,
} from './referralRules'

/** Two buildings joined by an arrow, drawn in the sidebar's stroke style. Hidden: the page's label names it. */
function ReferralIcon() {
  return (
    <svg className="hid-ehr-dept-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M3.5 20V9.5l4-2.5 4 2.5V20" />
      <path d="M12.5 20v-7l4-2.5 4 2.5v7" />
      <path d="M2.5 20h19" />
      <path d="M9 4.5h7.5M14 2l2.5 2.5L14 7" />
    </svg>
  )
}

/**
 * Referrals between facilities (hid-system REF-1, 0191-0193), in place of Akos's sample Referral Network under Network
 * & Services. The backend gives doctors and clinicians the read, send and receive codes and the front desk the arrive
 * code (0193); any one of them opens the page, and each tab asks for its own. A member with none is told who can use
 * referrals (`refusal`), which reads nothing; at a demo facility it shows today's sample instead.
 *
 * Partial, not live: its routes are proposed (built on claude/sprint-referrals-backend), and production keeps them
 * switched off (REFERRALS_ENABLED and the control cross_facility_referrals_enabled) until the clinical lead's checklist,
 * the DPO's review and the owner's go-live. Once a read answers 404 (an ehr-api before 0191) or 503
 * REFERRALS_NOT_AVAILABLE, the sidebar stops listing it for the page's life; its address still opens, with today's
 * sample at the demo facilities and "not available yet" elsewhere.
 */
export const referralsPage: EhrBluePage = {
  path: 'referrals/*',
  group: 'Network & Services',
  label: TITLE,
  permission: REFERRAL_ARRIVE,
  orPermissions: [REFERRAL_READ, REFERRAL_SEND, REFERRAL_RECEIVE],
  status: 'partial',
  // The tabs' waiting count lives on while a referral below them is open.
  keepsState: true,
  icon: <ReferralIcon />,
  element: <Referrals />,
  refusal: <ReferralsRefusal />,
  listed: () => referralsServed() !== false,
  listedChanges: subscribeReferralsServed,
}
