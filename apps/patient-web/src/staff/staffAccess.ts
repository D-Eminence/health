import type { Facility } from './api'

/**
 * Facility roles and licences as the provider portal names them (P4b, Novu only). Identity reports role codes; the
 * portal shows these words instead. A code not listed here is shown as it is.
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
}

export function roleLabel(code: string): string {
  return ROLE_LABELS[code] ?? code
}

/** Each role's words once, in the order given ("Facility administrator, Doctor"). */
export function roleLabels(codes: readonly string[]): string {
  return [...new Set(codes.map(roleLabel))].join(', ')
}

/** The role in a sentence: "a doctor", "a laboratory scientist". */
export function roleInSentence(code: string): string {
  const word = roleLabel(code).toLowerCase()
  return `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`
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
