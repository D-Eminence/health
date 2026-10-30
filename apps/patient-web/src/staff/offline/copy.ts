import type { ConflictClass, Connectivity, OpName, PolicyReason } from '@hid/offline'

/**
 * Every word the offline screens show. Calm and plain: say what happened and what to do next, never blame, never
 * call pending work done. "Health ID" and "EHR" by name; no emoji.
 */

export const PENDING = {
  saved: 'Saved on this device, not sent yet',
  sending: 'Saved on this device, sending…',
  waiting: 'Sent, waiting for confirmation. Don’t enter it again.',
  stillTrying: 'Still trying to send. It stays on this device until it goes.',
  heldAccess: 'Held: access to this patient has ended',
  heldSession: 'Held until you sign in again',
  heldMembership: 'Held: you no longer work at this facility',
  review: 'Needs your review',
  discarded: 'Discarded on this device',
  notAtPharmacy: 'Not at the pharmacy yet',
  notAtLab: 'Not at the lab yet',
} as const

/** The words for a pending row's state, as the engine names it (§2.8 Command.state). */
export function pendingStateText(state: string, op?: OpName): string {
  switch (state) {
    case 'sending': return PENDING.waiting
    case 'held_access': return PENDING.heldAccess
    case 'held_session': return PENDING.heldSession
    case 'held_membership': return PENDING.heldMembership
    case 'review': return PENDING.review
    case 'discarded': return PENDING.discarded
    case 'still-trying': return PENDING.stillTrying
    default:
      if (op === 'ehr.prescription.to-pharmacy') return `${PENDING.saved}. ${PENDING.notAtPharmacy}.`
      if (op === 'ehr.lab-request.to-lab') return `${PENDING.saved}. ${PENDING.notAtLab}.`
      return PENDING.saved
  }
}

/** What each queued change is, in a few words. */
export const OP_LABELS: Readonly<Record<OpName, string>> = {
  'ehr.encounter.create': 'New visit',
  'ehr.note.create': 'Clinical note',
  'ehr.vital.create': 'Vital signs',
  'ehr.diagnosis.create': 'Diagnosis',
  'ehr.prescription.create': 'Prescription',
  'ehr.lab-request.create': 'Lab request',
  'ehr.note.revise': 'Note revision',
  'ehr.vital.correct': 'Vitals correction',
  'ehr.prescription.to-pharmacy': 'Send prescription to Pharmacy',
  'ehr.lab-request.to-lab': 'Send lab request to Lab',
  'ehr.encounter.update': 'Visit status change',
  'ehr.note.update': 'Note status change',
  'ehr.diagnosis.update': 'Diagnosis change',
  'identity.grant.close': 'Close access',
  'ehr.document.upload': 'Document upload',
}

export const SAVE = {
  savedHere: 'Saved on this device. It will be sent when Health ID can be reached.',
  sendingHere: 'Saved on this device, sending…',
  tooLong: 'Too long to save; split it into two entries.',
  activeLabNeedsVisit: 'An active lab request needs this visit to be on Health ID first. Save it as a draft for now, and activate it once the visit is sent.',
} as const

export const CONNECTIVITY: Readonly<Record<Connectivity, string>> = {
  online: 'Online',
  slow: 'Slow connection',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
}

export function syncingText(count: number): string {
  return `Sending ${count} ${count === 1 ? 'change' : 'changes'}`
}

export function attentionText(count: number): string {
  return `${count} ${count === 1 ? 'change needs' : 'changes need'} attention`
}

export function pendingCountText(count: number): string {
  return count === 0 ? 'Nothing waiting to send' : `${count} ${count === 1 ? 'change' : 'changes'} saved on this device, not sent yet`
}

export const POLICY_REASONS: Readonly<Record<PolicyReason, string>> = {
  'mode-off': 'Offline use is switched off for Health ID right now.',
  'host-off': 'Offline use is not available on this site.',
  'facility-off': 'Offline use is not switched on for this facility yet.',
  'not-opted-in': 'This device does not keep an offline copy.',
  'password-too-short': 'Change your password to 12+ characters to use offline.',
  'unsupported-browser': 'This browser cannot keep a safe offline copy. Use a recent Chrome, Edge, Firefox or Safari.',
  'device-full': 'This device already keeps unsent work for 5 accounts. Send it before keeping another offline copy here.',
}

export const PANEL = {
  title: 'Offline and sync',
  lastSync: 'Last sent',
  never: 'Not yet',
  pending: 'Waiting to send',
  auditProblem: 'Health ID did not accept some records of what was opened offline. Tell your facility administrator.',
  attention: 'Needs attention',
  accessUntil: 'Offline access until',
  syncNow: 'Send now',
  review: 'Review',
  close: 'Close',
  worksTitle: 'What works offline',
  works: [
    'Open patients kept on this device while their access lasts',
    'Start a visit, and add notes, vital signs, diagnoses, prescriptions and lab requests',
    'Revise notes, correct vital signs, and change visit, note and diagnosis status',
    'Capture documents in Migrate',
  ],
  onlineOnlyTitle: 'Needs a connection',
  onlineOnly: [
    'Asking a patient for access, PIN access and emergency access',
    'Emergency summaries, imported records and downloads',
    'Orders to another facility, Laboratory and Pharmacy work, billing and reading documents',
  ],
  storageLow: 'This device is running low on space. Send waiting changes soon.',
  storageNotKept: 'The browser may clear this offline copy if the device runs low on space. Pending changes are kept safe for as long as it allows.',
  escrowOff: 'Unsent work on this device is protected by your password only. If you change your password before it is sent, ask your facility administrator for help.',
  escrowOn: 'If you change your password, unsent work on this device can still be sent after your next online sign-in.',
  clockSuspect: 'This device’s clock looks wrong. Offline sign-in is paused until it is corrected and you sign in online.',
} as const

export const SIGN_IN = {
  title: 'Health ID can’t be reached',
  lede: 'You can open the offline copy kept on this device. Sign in with the email and password you last used here.',
  email: 'Work email',
  password: 'Password',
  submit: 'Open offline copy',
  working: 'Opening…',
  retry: 'Try Health ID again',
  wrong: 'That email and password do not open an offline copy on this device.',
  leaseExpired: 'The offline copy on this device has expired. Sign in online to continue.',
  clockSuspect: 'This device’s clock looks wrong, so the offline copy stays closed. Correct the clock, or sign in online.',
  noVault: 'There is no offline copy for this account on this device. Sign in online when Health ID can be reached.',
  wiped: 'The offline copy was cleared after too many wrong passwords. Waiting changes are kept. Sign in online to send them.',
  offlineMode: 'Working offline. Changes are saved on this device and sent when Health ID can be reached.',
} as const

export const UNLOCK = {
  title: 'Health ID is locked',
  idle: 'For your security, the workspace locked after 5 minutes without use. Your work is kept.',
  hidden: 'For your security, the workspace locked while it was in the background. Your work is kept.',
  unconfirmed: 'Health ID can’t be reached to confirm your session. Enter your password to keep working offline.',
  password: 'Password',
  submit: 'Unlock',
  working: 'Unlocking…',
  wrong: 'That password does not unlock this device. After 5 wrong tries the offline copy is cleared; waiting changes are kept.',
  signOut: 'Sign out',
  noVault: 'No offline copy is open on this tab. Sign in online to keep working.',
  pausedBanner: 'Offline use is paused on this tab.',
  paused: 'Enter your password to use the offline copy on this tab. Until then, changes go straight to Health ID.',
  notNow: 'Not now',
  pausedAction: 'Unlock',
} as const

export const CHOICE = {
  title: 'Keep an offline copy on this device (personal devices only)',
  body: 'Health ID can keep an encrypted copy of the patients you open here, so you can keep working if the connection drops. Changes made offline are sent when Health ID can be reached. Do not choose this on a shared or public computer.',
  keep: 'Keep an offline copy',
  decline: 'Not on this device',
  working: 'Setting up…',
  failed: 'The offline copy could not be set up. You can keep working online.',
} as const

export const CACHED = {
  savedCopy: (time: string) => `Saved copy from ${time} on this device`,
  refreshing: 'Health ID could not be reached in time, so this is the copy saved on this device. It updates if Health ID answers.',
} as const

export const ON_DEVICE = {
  title: 'On this device',
  lede: 'Patients kept on this device while their access lasts.',
  search: 'Search patients on this device',
  empty: 'No patients are kept on this device yet. Open a patient online and choose “Keep available offline”.',
  noMatch: 'No patient on this device matches.',
  accessUntil: (time: string) => `Access until ${time}`,
  accessEnded: 'Access ended',
  open: 'Open',
  pending: (count: number) => `${count} waiting to send`,
} as const

export const KEEP = {
  button: 'Keep available offline',
  working: 'Saving to this device…',
  done: 'This patient’s recent visits are kept on this device while access lasts.',
  failed: 'This patient could not be kept on this device. Try again when the connection is steady.',
} as const

export const ONLINE_ONLY = 'This needs a connection to Health ID. It will be available when you are back online.'

export const DURATION = {
  label: 'Access for',
  hint: 'The patient sees how long before approving.',
  options: [60, 240, 480, 720] as const,
  text: (minutes: number) => minutes % 60 === 0 ? `${minutes / 60} ${minutes === 60 ? 'hour' : 'hours'}` : `${minutes} minutes`,
} as const

export const REVIEW = {
  title: 'Changes that need your review',
  empty: 'Nothing needs your review.',
  blocked: (count: number) => `This visit and ${count} ${count === 1 ? 'entry' : 'entries'} could not be sent.`,
  reason: 'Reason',
  reasonHint: 'At least 8 characters. Kept with the change.',
  reasonShort: 'Enter a reason of at least 8 characters.',
  chooseAction: 'Choose what to do with this change.',
  yourChange: 'Your change',
  currentRecord: 'Current record',
  currentLoading: 'Reading the current record…',
  currentUnavailable: 'The current record could not be read. Try again when online.',
  newSafety: 'New allergy and medication information',
  noSafetyReported: 'No allergies or medications reported.',
  safetyUnavailable: 'The current allergies, medications and prescriptions could not be read. Try again when online. Until they are read, this prescription cannot be sent as it is.',
  visitPrescriptions: 'This visit’s prescriptions on Health ID',
  noVisitPrescriptions: 'No prescriptions on Health ID for this visit.',
  submit: 'Confirm',
  working: 'Saving…',
  close: 'Close',
} as const

export const CLASS_TEXT: Readonly<Record<ConflictClass, { title: string; body: string }>> = {
  CC1: { title: 'Sent, waiting for confirmation', body: 'Health ID has not confirmed this change yet. Don’t enter it again.' },
  CC2: { title: 'The record changed since you saw it', body: 'Someone changed this record before your change arrived. Compare the two.' },
  CC3: { title: 'The visit or record has changed', body: 'The visit was closed, or the record was entered in error or no longer exists.' },
  CC4: { title: 'Check before sending this prescription', body: 'Check the patient’s current allergies, medications and this visit’s prescriptions below before sending.' },
  CC5: { title: 'Access to this patient ended', body: 'The change is kept. Ask the patient for access again and it is sent with no need to enter it again.' },
  CC6: { title: 'Sign in again', body: 'Your session ended. Sign in online to send waiting changes.' },
  CC7: { title: 'This change can’t be sent', body: 'Health ID could not accept it as it is. Nothing was saved in the EHR.' },
  CC8: { title: 'You no longer work at this facility', body: 'These changes cannot be sent. They stay locked on this device for 30 days.' },
}

export function accessEndedAt(time: string): string {
  return `Access to this patient ended at ${time}.`
}

export function membershipEnded(facility: string, count: number): string {
  return `You no longer work at ${facility}. ${count === 1 ? 'This change cannot' : `These ${count} changes cannot`} be sent.`
}

export const ACTIONS: Readonly<Record<'apply-on-top' | 'new-visit' | 'send-as-is' | 'edit-as-new' | 'ask-access' | 'discard', string>> = {
  'apply-on-top': 'Apply my change on top',
  'new-visit': 'Attach to a new visit',
  'send-as-is': 'Send as is (I have checked)',
  'edit-as-new': 'Edit as a new entry',
  'ask-access': 'Ask for access again',
  'discard': 'Discard',
}

export const CAPTURE = {
  title: 'Capture documents',
  lede: 'Photograph or choose a page. It is encrypted on this device and uploaded into the patient’s EHR documents. Reading it with OCR needs a connection.',
  patient: 'Patient',
  patientHint: 'Only patients on this device with write access.',
  choosePatient: 'Choose a patient',
  noPatients: 'No patient on this device has write access. Open a patient online with read-and-write access first.',
  noWrite: 'This patient’s access does not allow adding documents.',
  visit: 'Visit',
  file: 'Page or document',
  fileHint: 'A photo, PDF or TIFF, up to 20 MB.',
  camera: 'Take a photo',
  submit: 'Save to upload',
  working: 'Saving…',
  wrongType: 'Choose a JPEG, PNG, PDF or TIFF file.',
  tooBig: 'This file is larger than 20 MB.',
  needPatient: 'Choose a patient first.',
  needVisit: 'Choose a visit first.',
  needFile: 'Choose a page or document first.',
  queue: 'Upload queue',
  queueEmpty: 'Nothing waiting to upload.',
  states: { saved: 'Saved', uploading: 'Uploading', uploaded: 'Uploaded', scanning: 'Scanning', ready: 'Ready' },
} as const

export const UPDATE = {
  ready: 'A new version of Health ID is ready.',
  button: 'Update now',
  waitForms: 'Save or close open forms first.',
  waitSending: 'Waiting for changes to finish sending.',
  otherTab: 'Updated in another tab: reload when ready.',
  reload: 'Reload',
} as const
