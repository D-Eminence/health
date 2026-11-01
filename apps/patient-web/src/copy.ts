/**
 * One vocabulary for every Health ID screen (UI principles: "one vocabulary everywhere"; match the real world, not system
 * terms). Use these words in headings, buttons and messages; never the internal names on the right of each comment.
 * A word not here: pick the plainest one, then add it here so the next screen uses it too.
 */
export const WORDS = {
  /** not "health information", "medical records", "the record aggregate" */
  records: 'records',
  /** the page and the nav item, everywhere; not "Access and consent", "consent", "External record access" */
  accessPage: 'Access & sharing',
  /** a facility or clinician being let in; not "grant", "authorization", "consent grant" */
  access: 'access',
  /** stopping someone's access; not "revoke", "revocation", "close my grant" */
  endAccess: 'End access',
  /** a facility asking a patient; not "access request", "request record access", "consent request" */
  askPatient: 'Ask the patient',
  /** a clinician's visit record; not "encounter" */
  consultation: 'consultation',
  /** the patient's own facts; not "Bio-data", "demographics" */
  aboutYou: 'About you',
  /** HMO and hospital; not "Coverage" */
  insurance: 'Insurance & hospital',
  /** life-saving access without consent; not "break-glass" in patient-facing text */
  emergencyAccess: 'Emergency access',
  /** the Health ID card's number */
  healthId: 'Health ID',
} as const

/** Messages that recur: said the same way on every screen. */
export const SAY = {
  everyViewRecorded: 'Every view is recorded.',
  signInAgain: 'For your safety, sign out, sign in again, then come back within 10 minutes.',
  tryAgain: 'Something went wrong. Please try again.',
  readOnly: 'You can view this, but not change it.',
} as const

/** Plain words for the refusals the patient pages share: never Identity's own text (owner's rule, 1 Nov 2026). */
export const PATIENT_REFUSALS: Readonly<Record<string, string>> = {
  PATIENT_RECENT_AUTH_REQUIRED: SAY.signInAgain,
  PATIENT_RECENT_RECOVERY_HOLD: 'For your safety, this isn’t available for 24 hours after you recover your account.',
  ACCESS_REQUEST_NOT_PENDING: 'This request was already decided. The list is up to date.',
}
