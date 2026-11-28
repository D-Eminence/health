import type { RegistrationCapabilities, RegistrationCase, RegistrationEnrollment } from '../../../staff/api'

/** The control ids today's page gives its fields (Registration.tsx 233-256), kept so focus and errors find them. */
export const FIELD = {
  nin: 'registration-nin', first: 'registration-first', last: 'registration-last', dob: 'registration-dob',
  gender: 'registration-gender', caseId: 'registration-case-id', candidate: 'registration-candidate',
  linkReason: 'registration-link-reason', approveReason: 'registration-approve-reason', email: 'registration-email',
  enrollReason: 'registration-enroll-reason',
  // Register without a NIN (hid-system 0130): its own fields, beside the desk's (DESK_PREFIX).
  withoutFirst: 'registration-without-first', withoutLast: 'registration-without-last', withoutDob: 'registration-without-dob',
  withoutGender: 'registration-without-gender', reason: 'registration-without-reason',
  // Verify NIN later (hid-system 0138, ID-6): the NIN added to a registered patient's record.
  verifyNin: 'registration-verify-nin',
} as const

/** The prefix of the desk fields' control ids (registration-phone, …: collected/DeskFields.tsx deskControlId). */
export const DESK_PREFIX = 'registration'

/** The new form's heading ("Start with verified identity"), where focus goes when the form replaces Check again. */
export const START_HEADING = 'registration-start-title'

/**
 * A case opened, found or made during this visit to the page, with the account enrolled for it here: in memory only,
 * gone with the page or another facility. `seq` names its row without its case ID. A case is shown by the person's
 * name and when it was started or reopened, never by its ID: GET :caseId sends no name, so the name is the one typed
 * when it was started here, or the list's (SX-10) when it was opened from the list.
 */
export interface VisitCase {
  readonly seq: number
  readonly item: RegistrationCase
  readonly enrollment: RegistrationEnrollment | null
  /** The patient's name as typed to start the case here, or as the list gives it; null for a case reopened by its reference. */
  readonly name: string | null
  /** Whether the case was started on this visit (or reopened by its reference, or opened from the list). */
  readonly started: boolean
  /** When it was started or reopened here (an ISO time). */
  readonly at: string
  /** What the list (SX-10) said of the case when it was opened from there: when it was started, and whether by this member. */
  readonly listed?: ListedFacts
}

export interface ListedFacts {
  readonly createdAt: string
  readonly createdByMe: boolean
}

/** When the case was started (here, or as the list says), or else when it was reopened here by its reference. */
export function visitWhen(visit: VisitCase): { readonly started: boolean; readonly at: string } {
  if (visit.started) return { started: true, at: visit.at }
  if (visit.listed) return { started: true, at: visit.listed.createdAt }
  return { started: false, at: visit.at }
}

/** Whether this member started the case: on this visit, or as the list says (by createdByMe, never by a name). */
export function startedByMe(visit: VisitCase): boolean {
  return visit.started || visit.listed?.createdByMe === true
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
export type ErrorAt = 'find' | 'list' | 'refresh' | 'resolve' | 'without' | ReviewAction | 'enroll' | 'verifyNin'
/**
 * Which case read is running (Registration.tsx 55: one at a time), so only the control that asked says "Loading…": a
 * row of the list (SX-10) names its row by its case, so it stays with that case if the list is read again meanwhile.
 */
export type CaseLoading = 'find' | 'refresh' | { readonly caseId: string } | null
export interface ShownError { readonly text: string; readonly at: ErrorAt }
