import type { RegistrationCapabilities, RegistrationCase, RegistrationEnrollment } from '../../../staff/api'

/** The control ids today's page gives its fields (Registration.tsx 233-256), kept so focus and errors find them. */
export const FIELD = {
  nin: 'registration-nin', first: 'registration-first', last: 'registration-last', dob: 'registration-dob',
  gender: 'registration-gender', caseId: 'registration-case-id', candidate: 'registration-candidate',
  linkReason: 'registration-link-reason', approveReason: 'registration-approve-reason', email: 'registration-email',
  enrollReason: 'registration-enroll-reason',
} as const

/** The new form's heading ("Start with verified identity"), where focus goes when the form replaces Check again. */
export const START_HEADING = 'registration-start-title'

/**
 * A case found or made during this visit to the page, with the account enrolled for it here. Today has no case list
 * (the backend offers none), so these are the page's own: in memory only, gone with the page or another facility.
 * `seq` names its row without its case ID.
 */
export interface VisitCase {
  readonly seq: number
  readonly item: RegistrationCase
  readonly enrollment: RegistrationEnrollment | null
}

/** What NIN verification's availability is, as today's "Verification availability" card reads it (Registration.tsx 49-51). */
export interface Availability {
  readonly capabilities: RegistrationCapabilities | null
  readonly error: string
  readonly loading: boolean
  /** Whether a read has answered yet (a value or a refusal): before then the new form shows only its skeleton. */
  readonly answered: boolean
  readonly refresh: () => void
}

/** A case decision (Registration.tsx 163). */
export type ReviewAction = 'approve' | 'link'

/** Where a refusal belongs: the form or view whose request it answered. */
export type ErrorAt = 'find' | 'refresh' | 'resolve' | ReviewAction | 'enroll'
/** Which case read is running (Registration.tsx 55: one at a time), so only the control that asked says "Loading…". */
export type CaseLoading = 'find' | 'refresh' | null
export interface ShownError { readonly text: string; readonly at: ErrorAt }
