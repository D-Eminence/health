/**
 * The paper records rule, word for word as decided (coordinator, Q22, owner 3 Nov 2026 21:10 UTC; widened by the owner
 * on 5 Nov 2026, D-a and D-b): any access the patient gave (an approved request, their Access PIN, or a share of their
 * records) also lets that staff member at that facility bring in their old paper records, for as long as that access
 * lasts. It never outlasts the access (at most 60 minutes for a PIN; as long as the patient approved for a request; as
 * long as a share lasts). Kept in one place so a change of wording is one line. Never said for a patient under 18, as
 * paper records are refused for them, nor while their age is unknown.
 */

/** In the patient's access-request drawer, on a pending request. */
export function paperRecordsOnApproval(facilityName: string): string {
  return `Approving also lets ${facilityName} add your old paper records to your Health ID while their access lasts.`
}

/** On the patient's Access PIN. */
export const PIN_COVERS = 'A hospital you give it to can use it to open your records, and to add your old paper records to your Health ID while that access lasts.'

/**
 * On the patient's share screen, next to Share my records, on the invite form and next to Confirm and share on an
 * accepted invitation (owner, 5 Nov 2026: "The share screen will tell patients this"). Said only for a share that lets
 * them add to the record (shareCoversPaper): View Only says "cannot make changes", and staff are told their access
 * covers paper records only where it lets them write.
 */
export const SHARE_COVERS_PAPER = 'Sharing also lets them add your old paper records to your Health ID while the share lasts.'

/**
 * Whether a share at this level lets the clinician bring in paper records: only Clinical Collaboration, the one level
 * that gives write access (scope write_records). The staff pages say their access covers paper records only then.
 */
export function shareCoversPaper(level: string): boolean {
  return level === 'clinical_collaboration'
}

/** To staff, where the patient's own OK opened their record (an approved request, the Access PIN, or a share). */
export const STAFF_ACCESS_COVERS_PAPER = 'This access also lets you bring in the patient’s paper records while it lasts.'

/**
 * To staff on Document OCR, when the patient's own OK does not cover bringing in their paper records (OCR's 403
 * OCR_RECORDS_PROCESSING_CONSENT_REQUIRED, or a 404 from creating the job, which means the same before that answer ships).
 */
export const STAFF_PAPER_NEEDS_ACCESS = 'To bring in this patient’s paper records, ask the patient to approve access or enter their Access PIN.'

/** Whether a date of birth is 18 or more years ago; false when unknown or unreadable. */
export function isAdult(dateOfBirth: string | null | undefined, now = new Date()): boolean {
  if (!dateOfBirth) return false
  const born = new Date(dateOfBirth)
  if (Number.isNaN(born.getTime())) return false
  const eighteenth = new Date(Date.UTC(born.getUTCFullYear() + 18, born.getUTCMonth(), born.getUTCDate()))
  return now.getTime() >= eighteenth.getTime()
}
