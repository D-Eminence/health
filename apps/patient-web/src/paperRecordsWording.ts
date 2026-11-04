/**
 * The paper records rule, word for word as decided (coordinator, Q22, owner 3 Nov 2026 21:10 UTC): the patient's own
 * OK (an approved request, or their Access PIN) also lets the facility bring in their old paper records, for as long
 * as that access lasts. It never outlasts the access (at most 60 minutes for a PIN; as long as the patient approved for
 * a request). Kept in one place so a change of wording is one line. Never said for a patient under 18, as paper records
 * are refused for them, nor while their age is unknown.
 */

/** In the patient's access-request drawer, on a pending request. */
export function paperRecordsOnApproval(facilityName: string): string {
  return `Approving also lets ${facilityName} add your old paper records to your Health ID while their access lasts.`
}

/** On the patient's Access PIN. */
export const PIN_COVERS = 'A hospital you give it to can use it to open your records, and to add your old paper records to your Health ID while that access lasts.'

/** To staff, where the patient's own OK opened their record (an approved request, or the Access PIN). */
export const STAFF_ACCESS_COVERS_PAPER = 'This access also lets you bring in the patient’s paper records while it lasts.'

/** Whether a date of birth is 18 or more years ago; false when unknown or unreadable. */
export function isAdult(dateOfBirth: string | null | undefined, now = new Date()): boolean {
  if (!dateOfBirth) return false
  const born = new Date(dateOfBirth)
  if (Number.isNaN(born.getTime())) return false
  const eighteenth = new Date(Date.UTC(born.getUTCFullYear() + 18, born.getUTCMonth(), born.getUTCDate()))
  return now.getTime() >= eighteenth.getTime()
}
