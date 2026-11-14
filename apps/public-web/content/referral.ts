/**
 * "Earn with Health ID": the facility referral programme.
 *
 * A referral is an introduction to a facility that is new to Health ID. It is
 * sent to the Health ID team as a tagged enquiry (see lib/referral.ts); the team
 * contacts the facility. Rewards are confirmed and paid by the team: the site
 * does not track or pay them.
 *
 * `reward` is the one line that states what a referrer earns. While it is null
 * the page promises no amount, and says the team confirms it instead. Set it,
 * for example to '10% of the facility's first year on a paid plan', once the
 * terms are agreed.
 */
export const REFERRAL_PAGE = {
  eyebrow: 'Earn with Health ID',
  title: 'Introduce a facility. Earn when it joins.',
  lede: 'Know a hospital, clinic, laboratory or pharmacy that should be on Health ID? Introduce them. When they start a paid plan, you earn a reward.',
  reward: null as string | null,
  rewardPending: 'We confirm your reward, and how it is paid, when we first contact you.',
  steps: [
    { title: 'Introduce a facility', body: 'Tell us who they are, and let them know.' },
    { title: 'We take it from there', body: 'We contact the facility and help them set up.' },
    { title: 'You earn', body: 'When they start a paid plan, we pay your reward.' },
  ],
  rulesTitle: 'Good to know',
  rules: [
    'Anyone who works with facilities can refer: consultants, vendors, clinicians, and facilities already on Health ID.',
    'You earn when the facility starts a paid plan. A free trial on its own does not count.',
    'The facility must be new to Health ID. The first complete introduction counts.',
    'Only introduce a facility that knows you are doing so. Patients are never part of a referral.',
  ],
  formTitle: 'Refer a facility',
  formLede: 'Two short steps. We reply by email.',
} as const

/** The short band other pages use to point to the programme. */
export const REFERRAL_BAND = {
  eyebrow: 'Earn with Health ID',
  title: 'Know a facility that should be on Health ID?',
  body: 'Introduce them. When they start a paid plan, you earn a reward.',
  action: 'Refer a facility',
} as const
