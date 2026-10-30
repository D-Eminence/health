/**
 * Every word, id and route the cards look for, in one place. Mirrored from the Health ID source, never imported
 * (this kit imports nothing from apps/ or packages/): when the UI changes, change it here.
 *
 * TODO(stream-b): the OFFLINE block, ROUTES.staff.capture, the request duration select and the keep-offline button
 * come from origin/offline/stream-b (apps/patient-web/src/staff/offline/copy.ts, its components and staff/App.tsx),
 * which is not on offline/base yet. Re-check each against the merged code before the first real run.
 */

export const ROUTES = {
  staff: {
    signIn: '/provider/sign-in',
    overview: '/provider',
    patients: '/provider/patients',
    clinical: '/provider/clinical',
    audit: '/provider/audit',
    requests: '/provider/requests',
    ocr: '/provider/ocr',
    migrate: '/provider/migrate',
    staff: '/provider/staff',
    /** TODO(stream-b): Migrate capture; shown only while offline is in use at the facility. */
    capture: '/provider/capture',
  },
  portal: { signIn: '/sign-in', home: '/', access: '/access', profile: '/profile' },
} as const

/** staff/navigation.ts: the sidebar ("Provider navigation") links. */
export const NAV = {
  overview: 'Overview',
  patients: 'Patient access',
  requests: 'Access requests',
  audit: 'Facility audit',
  clinical: 'Clinical record',
  ocr: 'Document OCR',
} as const

/** staff/routes/SignIn.tsx */
export const STAFF_SIGN_IN = {
  title: '#staff-sign-in-title',
  titleText: 'Welcome back.',
  email: '#staff-email',
  password: '#staff-password',
  submit: 'Sign in',
  busy: 'Signing in…',
  error: 'p.staff-error[role=alert]',
} as const

/** staff/App.tsx: the facility question, and the facility switch in the sidebar. */
export const FACILITY = {
  choiceTitle: '#staff-facility-choice-title',
  choiceTitleText: 'Where are you working?',
  choiceOption: 'input[name="staff-facility-choice"]',
  choiceSubmit: 'Continue',
  switch: '#staff-facility-select',
  switchLabel: 'Working at',
  /** "Checking your session…" or "We could not confirm your session" after the page was hidden. */
  sessionCheck: '#staff-session-check-title',
  signOut: 'Sign out',
} as const

/** staff/routes/Patients.tsx */
export const PATIENTS = {
  title: '#patients-title',
  titleText: 'Open a patient record.',
  hid: '#patient-hid',
  verify: 'Verify access',
  methods: { request: 'Request', pin: 'Patient PIN', emergency: 'Emergency' },
  requestScope: '#request-scope',
  requestReason: '#request-reason',
  /** TODO(stream-b): 'Access for' (60, 240, 480 or 720 minutes; default 480 at an offline facility). */
  requestDuration: '#request-duration',
  pin: '#patient-pin',
  emergencyReason: '#emergency-reason',
  submitRequest: 'Send access request',
  submitPin: 'Verify PIN and open',
  submitEmergency: 'Activate emergency access',
  openRecord: 'Open clinical record →',
  openEmergency: 'Open read-only emergency summary →',
  status: '#patients-status[role=status]',
  /** FORBIDDEN in every card: it closes the seeded share (identity.grant.close). The guard aborts it too. */
  closeGrantForbidden: 'Close my grant',
} as const

/** staff/routes/Clinical.tsx */
export const CLINICAL = {
  encounterType: '#encounter-type',
  chiefComplaint: '#chief-complaint',
  startEncounter: 'Start encounter',
  encounterRow: 'button.staff-select-row',
  documentationTitle: '#clinical-documentation-title',
  tabList: 'Clinical record section',
  tabs: { notes: 'Notes', vitals: 'Vitals', diagnoses: 'Diagnoses', prescriptions: 'Prescriptions', labRequests: 'Lab requests', documents: 'Documents' },
  note: { type: '#note-type', title: '#note-title', content: '#note-content', save: 'Save draft' },
  vitals: { systolic: '#vital-systolicMmhg', diastolic: '#vital-diastolicMmhg', pulse: '#vital-pulseBpm', temperature: '#vital-temperatureC', save: 'Save record' },
  prescription: {
    medication: '#medication', doseQuantity: '#dose-quantity', doseUnit: '#dose-unit', route: '#route-code',
    frequency: '#frequency', instructions: '#instructions', save: 'Save draft',
  },
  document: { input: '#clinical-document', upload: 'Upload document' },
  noteReview: 'Review note content',
  noteRevisionContent: '[id^="note-revision-content-"]',
  noteRevisionReason: '[id^="note-revision-reason-"]',
  noteRevisionSubmit: 'Record revision',
} as const

/** staff/routes/Audit.tsx. The page does not show offline details; T20 reads GET /api/v1/audit/events instead. */
export const AUDIT = { titleText: 'Facility audit.', search: '#audit-search', outcome: '#audit-outcome', actionColumn: 'Action' } as const

/** The patient portal (routes/SignIn.tsx, routes/Portal.tsx, routes/AccessLog.tsx, routes/HealthInformation.tsx). */
export const PORTAL = {
  signInPrincipal: 'Email, phone or Health ID',
  signInPassword: '#sign-in-password',
  signInSubmit: 'Sign in',
  approve: (accessRequestId: string) => `#approve-${accessRequestId}`,
  revoke: (consentGrantId: string) => `#revoke-${consentGrantId}`,
  revokeReason: (consentGrantId: string) => `#revoke-reason-${consentGrantId}`,
  confirmRevocation: 'Confirm revocation',
  shareRecords: 'Share my records',
  accessLogTitle: 'Who viewed or changed your record',
  accessLogViewed: 'Viewed your record',
  healthSection: 'Health information',
  allergies: '#health-allergies',
  saveHealth: 'Save health information',
} as const

/** TODO(stream-b): every entry, from apps/patient-web/src/staff/offline/copy.ts and its components. */
export const OFFLINE = {
  choice: {
    title: '#offline-choice-title',
    titleText: 'Keep an offline copy on this device (personal devices only)',
    keep: 'Keep an offline copy',
    decline: 'Not on this device',
  },
  signIn: {
    title: '#offline-sign-in-title',
    /** Curly apostrophe, as copy.ts has it. */
    titleText: 'Health ID can’t be reached',
    email: '#offline-email',
    password: '#offline-password',
    submit: 'Open offline copy',
    wrong: 'That email and password do not open an offline copy on this device.',
    clockSuspect: 'This device’s clock looks wrong, so the offline copy stays closed. Correct the clock, or sign in online.',
    wiped: 'The offline copy was cleared after too many wrong passwords. Waiting changes are kept. Sign in online to send them.',
    noVault: 'There is no offline copy for this account on this device. Sign in online when Health ID can be reached.',
    offlineMode: 'Working offline. Changes are saved on this device and sent when Health ID can be reached.',
  },
  lock: {
    title: '#offline-unlock-title',
    titleText: 'Health ID is locked',
    password: '#offline-unlock-password',
    submit: 'Unlock',
    pausedBanner: 'Offline use is paused on this tab.',
    pausedAction: 'Unlock',
  },
  cachedPrefix: 'Saved copy from',
  keep: { button: 'Keep available offline', done: 'This patient’s recent visits are kept on this device while access lasts.' },
  onDevice: { title: 'On this device', open: 'Open' },
  pending: {
    saved: 'Saved on this device, not sent yet',
    notAtPharmacy: 'Not at the pharmacy yet',
    heldAccess: 'Held: access to this patient has ended',
    row: '.offline-pending',
  },
  tooLong: 'Too long to save; split it into two entries.',
  savedHere: 'Saved on this device. It will be sent when Health ID can be reached.',
  attention: /needs? attention/,
  panel: {
    button: 'Offline and sync', id: '#offline-panel', title: '#offline-panel-title', titleText: 'Offline and sync',
    nothingPending: 'Nothing waiting to send', syncNow: 'Send now', review: 'Review',
  },
  indicator: { selector: 'span.offline-indicator[role=status]', online: 'Online', slow: 'Slow connection', reconnecting: 'Reconnecting…', offline: 'Offline' },
  update: { ready: 'A new version of Health ID is ready.', button: 'Update now', waitSending: 'Waiting for changes to finish sending.' },
  review: {
    /** A modal dialog named by this title; each entry is an li.offline-review-item. */
    title: 'Changes that need your review',
    item: 'li.offline-review-item',
    close: 'Close',
    yourChange: 'Your change',
    currentRecord: 'Current record',
    reason: 'Reason',
    reasonHint: 'At least 8 characters. Kept with the change.',
    confirm: 'Confirm',
    discard: 'Discard',
    sendAsIs: 'Send as is (I have checked)',
  },
  capture: {
    patient: '#capture-patient',
    visit: '#capture-visit',
    file: '#capture-file',
    submit: 'Save to upload',
    saved: 'Saved on this device. It uploads when Health ID can be reached.',
    states: { saved: 'Saved', uploading: 'Uploading', uploaded: 'Uploaded', scanning: 'Scanning', ready: 'Ready' },
  },
} as const

/** CLASS_TEXT in copy.ts: the review classes' titles (TODO(stream-b)). */
export const CLASS_TITLES = {
  CC1: 'Sent, waiting for confirmation',
  CC2: 'The record changed since you saw it',
  CC3: 'The visit or record has changed',
  CC4: 'Check before sending this prescription',
  CC5: 'Access to this patient ended',
  CC6: 'Sign in again',
  CC7: 'This change can’t be sent',
  CC8: 'You no longer work at this facility',
} as const

/** Device storage (OFFLINE-CONTRACT §2.4) and the shell's Cache Storage names (§2.12). */
export const STORAGE = {
  database: 'health-id-offline',
  version: 1,
  stores: ['meta', 'vaults', 'cache', 'outbox', 'audit', 'media', 'receipts'] as const,
  shellCachePrefix: 'health-id-shell-',
} as const

/** The offline endpoints and headers (§2.8, §2.10). */
export const OFFLINE_API = {
  ping: '/api/v1/ehr/offline/ping',
  receipts: '/api/v1/ehr/offline/receipts/lookup',
  audit: '/api/v1/ehr/offline/audit-events',
  escrow: '/api/v1/ehr/offline/escrow-key',
  headers: { command: 'x-hid-offline-command', capturedAt: 'x-hid-captured-at', clock: 'x-hid-clock' },
  keyPrefix: 'off1.',
} as const
