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
  lede: 'Know a hospital, clinic, laboratory or pharmacy that should be on Health ID? Introduce them to us. When they start a paid plan, you earn a referral reward.',
  reward: null as string | null,
  rewardPending: 'We confirm your reward, and how it is paid, when we first contact you about an introduction.',
  primary: 'Refer a facility',
  steps: [
    {
      title: 'Introduce a facility',
      body: 'Tell us about the facility and who we should speak to. Let them know you are introducing them.',
    },
    {
      title: 'We take it from there',
      body: 'Our team contacts the facility, shows them Health ID and helps them set up.',
    },
    {
      title: 'You earn',
      body: 'When the facility starts a paid plan, we confirm your reward and pay it to you.',
    },
  ],
  whoTitle: 'Who can refer',
  who: [
    'Healthcare consultants and advisers',
    'IT, software and equipment vendors who serve facilities',
    'Doctors, nurses, pharmacists and laboratory scientists who work across facilities',
    'Facilities already using Health ID',
  ],
  rulesTitle: 'How rewards work',
  rules: [
    'A reward is earned when a facility you introduce starts a paid plan. A free trial on its own does not earn one.',
    'The facility must be new to Health ID. Each facility can be referred once, and the first complete introduction counts.',
    'Only introduce a facility that knows you are doing so.',
    'Patients are never part of a referral, and are never charged for Health ID.',
  ],
  formTitle: 'Refer a facility',
  formLede: 'This takes about two minutes. We reply to you by email.',
} as const

/** The short band other pages use to point to the programme. */
export const REFERRAL_BAND = {
  eyebrow: 'Earn with Health ID',
  title: 'Know a facility that should be on Health ID?',
  body: 'Introduce them to us. When they start a paid plan, you earn a referral reward.',
  action: 'Learn about referrals',
} as const
