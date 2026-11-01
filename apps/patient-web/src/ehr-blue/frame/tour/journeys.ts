/**
 * The design's journeys (design/ehr-target screens/README.md), step by step, for the interactive Design tour. Each
 * step is the design's screen: its title, its route there, and what it asks for. The tour asks for no password and
 * sends nothing: the real sign-in, recovery and invitation pages stay today's.
 */

export interface TourField {
  readonly label: string
  readonly type?: 'text' | 'email' | 'tel' | 'date' | 'code' | 'select' | 'checkbox' | 'file'
  readonly options?: readonly string[]
}

export interface TourStep {
  readonly title: string
  /** The design's route for the screen. */
  readonly route: string
  readonly kind: 'form' | 'notice' | 'choice' | 'dialog'
  readonly text?: string
  readonly fields?: readonly TourField[]
  /** The step's main button, as the design labels it. */
  readonly action?: string
  /** A server rule live keeps under this screen, said beside it. */
  readonly rule?: string
}

export interface Journey {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly steps: readonly TourStep[]
}

const NO_PASSWORD = 'The tour asks for no password. The real page asks for it, and Health ID checks it.'
const CODE: TourField = { label: 'Six-digit code', type: 'code' }

export const JOURNEYS: readonly Journey[] = [
  {
    id: 'register-and-launch',
    title: 'Register a hospital, get approved, set up and launch',
    summary: 'From the first account to a launched hospital.',
    steps: [
      { title: 'Sign in', route: '/signin', kind: 'form', fields: [{ label: 'Email or phone', type: 'email' }], action: 'Continue', text: NO_PASSWORD },
      { title: 'Register: step 1 Your account', route: '/register', kind: 'form', fields: [{ label: 'Full name' }, { label: 'Work email', type: 'email' }, { label: 'Phone', type: 'tel' }], action: 'Continue' },
      { title: 'Register: step 2 Facility details', route: '/register', kind: 'form', fields: [{ label: 'Facility name' }, { label: 'Facility type', type: 'select', options: ['Hospital', 'Clinic', 'Laboratory', 'Pharmacy'] }, { label: 'State' }, { label: 'CAC registration number' }], action: 'Continue', rule: 'Live keeps the QoreID check of the CAC registration number at sign-up.' },
      { title: 'Register: step 3 Verification documents', route: '/register', kind: 'form', fields: [{ label: 'CAC certificate', type: 'file' }, { label: 'Operating licence', type: 'file' }], action: 'Continue' },
      { title: 'Register: step 4 Products & migration', route: '/register', kind: 'form', fields: [{ label: 'Hospital EHR', type: 'checkbox' }, { label: 'Laboratory', type: 'checkbox' }, { label: 'Pharmacy', type: 'checkbox' }, { label: 'Migrate existing records', type: 'checkbox' }], action: 'Continue' },
      { title: 'Register: step 5 Review & agreements', route: '/register', kind: 'form', fields: [{ label: 'I have read the agreements', type: 'checkbox' }], action: 'Submit registration', rule: 'The live page has no agreement box yet, because Health ID can’t record one. It links the Terms of Service and Privacy Policy beside Submit instead.' },
      { title: 'Register: agreements dialog', route: '/register', kind: 'dialog', text: 'Submit your registration and accept the Health ID agreements for this facility?', action: 'Accept and submit', rule: 'The live page asks you to confirm your details and submit. It asks you to accept nothing, because Health ID can’t record an acceptance yet.' },
      { title: 'Registration submitted', route: '/verify?submitted=1', kind: 'notice', text: 'Your registration is with Health ID. We sent a code to your email to confirm it is yours.' },
      { title: 'Verify email code', route: '/verify?submitted=1', kind: 'form', fields: [CODE], action: 'Verify' },
      { title: 'Simulation controls: inbox shows code', route: '/simulation', kind: 'notice', text: 'In the prototype the code shows in a simulated inbox. In Health ID it arrives by email.' },
      { title: 'Choose workspace (institutions)', route: '/institutions', kind: 'choice', text: 'Select one of your actual hospital memberships and authorised branches.', action: 'Main' },
      { title: 'Facility awaiting verification', route: '/facility', kind: 'notice', text: 'Pending verification: clinical modules stay locked until Health ID has checked your facility.' },
      { title: 'Approved: the 21-day trial starts', route: '/simulation', kind: 'notice', text: 'Health ID approved the facility. The 21-day trial starts now.' },
      { title: 'Onboarding: step 1 Facility', route: '/onboarding', kind: 'form', fields: [{ label: 'Display name' }, { label: 'Address' }], action: 'Continue' },
      { title: 'Onboarding: step 2 Type', route: '/onboarding', kind: 'form', fields: [{ label: 'Facility type', type: 'select', options: ['General hospital', 'Specialist hospital', 'Clinic'] }], action: 'Continue' },
      { title: 'Onboarding: step 3 Departments', route: '/onboarding', kind: 'form', fields: [{ label: 'Outpatients', type: 'checkbox' }, { label: 'Emergency', type: 'checkbox' }, { label: 'Maternity', type: 'checkbox' }, { label: 'Laboratory', type: 'checkbox' }], action: 'Continue' },
      { title: 'Onboarding: step 4 Branches', route: '/onboarding', kind: 'form', fields: [{ label: 'Branch name' }], action: 'Continue' },
      { title: 'Onboarding: step 5 Staff', route: '/onboarding', kind: 'form', fields: [{ label: 'Staff email', type: 'email' }, { label: 'Role', type: 'select', options: ['Doctor', 'Nurse', 'Receptionist'] }], action: 'Continue' },
      { title: 'Onboarding: step 6 Roles', route: '/onboarding', kind: 'notice', text: 'Each role opens the workspaces it needs. You can change roles later in Staff & access.', action: 'Continue' },
      { title: 'Onboarding: step 7 Billing', route: '/onboarding', kind: 'notice', text: 'Your trial is free for 21 days. Choose a plan before it ends.', action: 'Continue' },
      { title: 'Onboarding: step 8 Review', route: '/onboarding', kind: 'notice', text: 'Check the facility, departments, branches and staff before you launch.', action: 'Continue' },
      { title: 'Onboarding: step 9 Launch', route: '/onboarding', kind: 'dialog', text: 'Launch the hospital? Invited staff can sign in once it is launched.', action: 'Launch hospital' },
      { title: 'Dashboard after launch', route: '/dashboard', kind: 'notice', text: 'An empty hospital: every list explains what to do first.' },
    ],
  },
  {
    id: 'sign-in',
    title: 'Sign in with a sign-in code',
    summary: 'Sign in, the second step, and choosing where you work.',
    steps: [
      { title: 'Sign in', route: '/signin', kind: 'form', fields: [{ label: 'Email or phone', type: 'email' }], action: 'Continue', text: NO_PASSWORD },
      { title: 'Sign in: wrong password', route: '/signin', kind: 'notice', text: 'The email or password is not right. Check them and try again.' },
      { title: 'Verify sign-in', route: '/verify', kind: 'form', fields: [CODE], action: 'Verify', rule: 'Live keeps its second step: the authenticator code or a recovery code.' },
      { title: 'Simulation controls', route: '/simulation', kind: 'notice', text: 'In the prototype a simulated inbox shows the code. In Health ID it comes from the authenticator app.' },
      { title: 'Choose workspace / branch', route: '/institutions', kind: 'choice', text: 'Select one of your actual hospital memberships and authorised branches.', action: 'Main' },
      { title: 'Doctor dashboard', route: '/dashboard', kind: 'notice', text: 'Home opens with the work that needs you. Choose "View Home as" in the account menu to see each role.' },
      { title: 'Recover account access', route: '/recover', kind: 'form', fields: [{ label: 'Email or phone', type: 'email' }], action: 'Send recovery code' },
      { title: 'Accept an invitation', route: '/accept-invitation', kind: 'form', fields: [{ label: 'Invitation link or ID' }], action: 'Open invitation' },
      { title: 'Patient-side consent', route: '/patient-simulation', kind: 'notice', text: 'The patient approves or declines a request in their Health ID app.' },
      { title: 'Signed out: back to sign in', route: '/signin', kind: 'notice', text: 'A protected page opened while signed out goes to sign in.' },
      { title: 'Unknown page (signed out)', route: '/signin', kind: 'notice', text: 'An address that is no page goes to sign in while signed out.' },
    ],
  },
  {
    id: 'forgot-password',
    title: 'Forgot password',
    summary: 'A neutral notice, a code, then a new password.',
    steps: [
      { title: 'Forgot password: enter email or phone', route: '/recover', kind: 'form', fields: [{ label: 'Email or phone', type: 'email' }], action: 'Send recovery code' },
      { title: 'Check your recovery channel', route: '/verify?recoveryRequested=1', kind: 'notice', text: 'If an account matches, we sent a code to it. The notice never says whether an account exists.' },
      { title: 'Enter the recovery code', route: '/verify?recoveryRequested=1', kind: 'form', fields: [CODE], action: 'Verify' },
      { title: 'Set a new password', route: '/reset-password', kind: 'notice', text: `Choose a new password. ${NO_PASSWORD}`, action: 'Save password' },
      { title: 'Back at sign in', route: '/signin', kind: 'notice', text: 'Your password changed and every session was signed out. Sign in with the new password.' },
    ],
  },
  {
    id: 'staff-invitation',
    title: 'Invite a staff member',
    summary: 'From the invitation link to a first sign-in.',
    steps: [
      { title: 'Invitation (signed out)', route: '/invitation/:id', kind: 'choice', text: 'Fictional Cedar Hospital invited you to join as a Nurse.', action: 'Create account' },
      { title: 'Create your staff account', route: '/register?invite=:id', kind: 'form', fields: [{ label: 'Full name' }, { label: 'Email', type: 'email' }], action: 'Create account', text: NO_PASSWORD },
      { title: 'Verify the staff email code', route: '/verify', kind: 'form', fields: [CODE], action: 'Verify' },
      { title: 'Invitation (signed in): accept', route: '/invitation/:id', kind: 'dialog', text: 'Accept the Nurse membership at Fictional Cedar Hospital?', action: 'Accept membership' },
      { title: 'Choose workspace: new membership', route: '/institutions', kind: 'choice', text: 'Your new Nurse membership is ready.', action: 'Main' },
      { title: 'First sign-in: change your password', route: '/profile', kind: 'notice', text: `Change the password you were given before you continue. ${NO_PASSWORD}` },
    ],
  },
  {
    id: 'subscription',
    title: 'Subscription: trial, grace, expiry, renewal',
    summary: 'What owners and administrators see as a subscription runs out and renews.',
    steps: [
      { title: 'Free trial running (21 days)', route: '/subscription', kind: 'notice', text: 'Your free trial has 21 days left.' },
      { title: 'Day 12: reminders begin', route: '/subscription', kind: 'notice', text: 'Your free trial has 9 days left. Choose a plan to keep working without a break.' },
      { title: 'Renewal reminder banner', route: '/staff', kind: 'notice', text: 'Your subscription renews soon. Renew now to keep every workspace open.' },
      { title: 'Expiring soon', route: '/subscription', kind: 'notice', text: 'Your subscription ends in 3 days.' },
      { title: 'Grace period (21 days)', route: '/subscription', kind: 'notice', text: 'Your subscription ended. For 21 days all work is still allowed while you renew.' },
      { title: 'Expired: read only', route: '/subscription', kind: 'notice', text: 'Records stay readable. New records cannot be created until you renew.' },
      { title: 'Create form while expired', route: '/services/new', kind: 'notice', text: 'Creating records is paused until the subscription is renewed.' },
      { title: 'Renewal: confirm the plan', route: '/subscription', kind: 'dialog', text: 'Renew the demonstration plan? No payment is taken in this tour.', action: 'Renew plan' },
      { title: 'Renewed and active', route: '/subscription', kind: 'notice', text: 'Your subscription is active.' },
    ],
  },
]
