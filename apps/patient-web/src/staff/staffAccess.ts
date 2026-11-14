import type { Facility } from './api'

/**
 * Facility roles and licences as Health ID names them. Identity reports role codes; the classic portal and the blue EHR
 * show these words instead, and never a code: a code not listed here reads "Staff" (owner's rule, 1 Nov 2026; parity
 * report 3.1 #16).
 */
const ROLE_LABELS: Readonly<Record<string, string>> = {
  org_admin: 'Facility administrator',
  // Novu's restricted administrator role until Health ID support has checked a self-signed-up facility (P4b).
  org_admin_awaiting_review: 'Facility administrator',
  doctor: 'Doctor',
  clinician: 'Clinician',
  nurse: 'Nurse',
  lab: 'Laboratory scientist',
  pharmacist: 'Pharmacist',
  receptionist: 'Receptionist',
  // Owner decision 20 (1 Nov 2026): Identity reports these roles too. Without names here the blue EHR could only call
  // them "Staff", and would not offer them when an administrator invites someone or changes their access.
  records_officer: 'Records officer',
  billing: 'Billing officer',
  outreach_officer: 'Outreach officer',
}

/*
 * A role's words from the list. A code the list does not name reads "Staff" instead of appearing as it is. Own keys
 * only: a code such as "constructor" is not a role.
 */
function listedRole(code: string): string | undefined {
  return Object.hasOwn(ROLE_LABELS, code) ? ROLE_LABELS[code] : undefined
}

/** A role's words: "Doctor"; "Staff" for a code the list does not name, never its internal key. */
export function roleName(code: string): string {
  return listedRole(code) ?? 'Staff'
}

/** The classic portal's name for roleName: the same words, "Staff" for a role with no words yet. */
export const roleLabel = roleName

/** Each role's words once, in the order given ("Facility administrator, Doctor"). */
export function roleLabels(codes: readonly string[]): string {
  return [...new Set(codes.map(roleLabel))].join(', ')
}

function withArticle(word: string): string {
  return `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`
}

/**
 * The role in a sentence: "a doctor", "a laboratory scientist". A role with no words yet is "a staff member", as the
 * owner chose (2 Nov 2026), never its internal key. The classic portal and the blue EHR say it the same way: this is
 * the one place those words are made (roleNameInSentence is the same function).
 */
export function roleInSentence(code: string): string {
  const word = listedRole(code)
  return word ? withArticle(word.toLowerCase()) : 'a staff member'
}

/** A role in a blue EHR sentence (PR #97's name): roleInSentence itself, "a staff member" for a code the list does not name. */
export const roleNameInSentence = roleInSentence

/**
 * A member's roles in the blue EHR, each once ("Facility administrator, Doctor"). A code the list does not name is left
 * out beside one it does, as "Doctor, Staff" would read oddly; with none named, "Staff".
 */
export function roleNames(codes: readonly string[]): string {
  return [...new Set(codes.flatMap(code => listedRole(code) ?? []))].join(', ') || 'Staff'
}

/** Whether the list names this role. The blue EHR offers only these when an administrator assigns a role. */
export function hasRoleName(code: string): boolean {
  return listedRole(code) !== undefined
}

/**
 * Every role a member holds, for the blue screens where an administrator sees and changes access (Staff & access, HR &
 * Credentials). A role the list does not name still carries its own permissions, so it is counted, never left out and
 * never shown by its code: "Nurse and another role", "Nurse and 2 other roles"; "Staff" alone, "2 staff roles".
 */
export function heldRoleNames(codes: readonly string[]): string {
  const named = [...new Set(codes.flatMap(code => listedRole(code) ?? []))]
  const unnamed = new Set(codes.filter(code => !hasRoleName(code))).size
  if (named.length === 0) return unnamed > 1 ? `${unnamed} staff roles` : 'Staff'
  if (unnamed === 0) return named.join(', ')
  return `${named.join(', ')} and ${unnamed === 1 ? 'another role' : `${unnamed} other roles`}`
}

/** The regulators whose licences a facility vouches for (P4b SPEC 4.2). */
export type LicenceBody = 'MDCN' | 'NMCN' | 'MLSCN' | 'PCN'

export const LICENCE_BODIES: Readonly<Record<LicenceBody, { regulator: string; holder: string }>> = {
  MDCN: { regulator: 'Medical and Dental Council of Nigeria', holder: 'doctor' },
  NMCN: { regulator: 'Nursing and Midwifery Council of Nigeria', holder: 'nurse' },
  MLSCN: { regulator: 'Medical Laboratory Science Council of Nigeria', holder: 'laboratory scientist' },
  PCN: { regulator: 'Pharmacists Council of Nigeria', holder: 'pharmacist' },
}

export function isLicenceBody(value: unknown): value is LicenceBody {
  return typeof value === 'string' && Object.hasOwn(LICENCE_BODIES, value)
}

/** The licence a role needs: none for a receptionist (P4b SPEC 4.2). */
export function licenceBodyForRole(role: string): LicenceBody | null {
  return role === 'doctor' ? 'MDCN' : role === 'nurse' ? 'NMCN' : role === 'lab' ? 'MLSCN' : role === 'pharmacist' ? 'PCN' : null
}

/**
 * A licence number as Identity stores it: capitals, single spaces, trimmed. It must then be 3 to 100 characters of
 * letters, digits, spaces, slashes, dots and hyphens, starting and ending with a letter or digit (P4b SPEC 4.2).
 */
export function normalizeLicenceNumber(value: string): string {
  return value.toUpperCase().replace(/\s+/g, ' ').trim()
}

export function licenceNumberAcceptable(value: string): boolean {
  const normalized = normalizeLicenceNumber(value)
  return /^[A-Z0-9][A-Z0-9/. -]{1,98}[A-Z0-9]$/.test(normalized) && !normalized.includes('  ')
}

export const LICENCE_NUMBER_HINT = 'Letters, digits, spaces, slashes, dots and hyphens, as on the licence.'

/** The kinds of facility that sign themselves up, as Identity names them. */
export type OrganizationType = 'clinic' | 'hospital' | 'laboratory' | 'pharmacy' | 'other'

/**
 * Where a facility that signed itself up stands with Health ID support (P4b): 'pending' until support has checked it,
 * then 'reviewed'. A governed or legacy facility, or a session from an Identity before P4b, carries no selfService and
 * reads null. A review value the portal does not know is read as pending: the copy then says less is open, never more
 * (the backend decides either way).
 */
export function selfServiceReview(facility: Pick<Facility, 'selfService'> | undefined | null): 'pending' | 'reviewed' | null {
  const review = facility?.selfService?.review
  if (review === undefined || review === null) return null
  return review === 'reviewed' ? 'reviewed' : 'pending'
}

/** The facility's type, when it signed itself up; 'other' for a type the portal does not know. */
export function selfServiceType(facility: Pick<Facility, 'selfService'> | undefined | null): OrganizationType | null {
  const type = facility?.selfService?.organizationType
  if (!type) return null
  return (['clinic', 'hospital', 'laboratory', 'pharmacy', 'other'] as const).find(known => known === type) ?? 'other'
}

/**
 * The Staff page tells the workspace's banner when the facility's staff record changed (the administrator saved their
 * own licence), so the banner's hint follows without a reload.
 */
const staffChangeListeners = new Set<() => void>()

export function onFacilityStaffChanged(listener: () => void): () => void {
  staffChangeListeners.add(listener)
  return () => { staffChangeListeners.delete(listener) }
}

export function announceFacilityStaffChanged(): void {
  for (const listener of [...staffChangeListeners]) listener()
}
