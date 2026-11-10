/**
 * The paper records rule, word for word as decided (coordinator, Q22, owner 3 Nov 2026 21:10 UTC; widened by the owner
 * on 5 Nov 2026, D-a and D-b): any access the patient gave (an approved request, their Access PIN, or a share of their
 * records) also lets that staff member at that facility bring in their old paper records, for as long as that access
 * lasts. It never outlasts the access (24 hours for a PIN, owner 10 Nov 2026; as long as the patient approved for a
 * request; as long as a share lasts). Kept in one place so a change of wording is one line. Never said for a patient under 18, as
 * paper records are refused for them, nor while their age is unknown.
 */

/** In the patient's access-request drawer, on a pending request. */
export function paperRecordsOnApproval(facilityName: string): string {
  return `Approving also lets ${facilityName} add your old paper records to your Health ID while their access lasts.`
}

/**
 * On the patient's Access PIN: what sharing it allows (all of their records, to see and add to, for 24 hours; owner,
 * 10 Nov 2026) and that they can end it (a PIN grant is the patient's to end on Access & sharing, hid-system 0095). Each use of the PIN
 * makes a new 24-hour grant and ending one leaves the PIN working, so the card also says to change the PIN.
 * PIN_ALLOWS is said to everyone; PIN_COVERS adds the paper records rule for an adult.
 */
export const PIN_ALLOWS = 'A hospital you give your PIN to can see and add to your records for 24 hours each time they use it. You can end their access at any time in Access & sharing, and change your PIN to stop them using it again.'
export const PIN_COVERS = 'A hospital you give your PIN to can see and add to your records for 24 hours each time they use it. While that access lasts, they can also add your old paper records to your Health ID. You can end their access at any time in Access & sharing, and change your PIN to stop them using it again.'

/**
 * On the patient's share screen, next to Share my records, on the invite form and next to Confirm and share on an
 * accepted invitation (owner, 5 Nov 2026: "The share screen will tell patients this"). Every share level covers paper
 * records (owner, 5 Nov 2026, D-b, view-only included): staff may start a reading and check what was read. Only a share
 * that lets them make changes (Clinical Collaboration, write_records) lets them put what was read into the record, so
 * the sentence says which applies (shareCoversPaperText).
 */
export const SHARE_COVERS_PAPER = 'Sharing also lets them add your old paper records to your Health ID while the share lasts.'

/** For a share that cannot make changes: they may read and check paper records, not add them. */
export const SHARE_READS_PAPER = 'Sharing also lets them use Health ID to read your old paper records while the share lasts. Only someone you let make changes can add them to your record.'

/** Whether a share at this level covers paper records at all: every known level (owner, 5 Nov 2026, D-b). */
export function shareCoversPaper(level: string): boolean {
  return level === 'clinical_collaboration' || level === 'clinical_review' || level === 'view_only'
}

/** The sentence for a share at this level, or null when the level is unknown. */
export function shareCoversPaperText(level: string): string | null {
  if (!shareCoversPaper(level)) return null
  return level === 'clinical_collaboration' ? SHARE_COVERS_PAPER : SHARE_READS_PAPER
}

/** To staff, where the patient's own OK opened their record (an approved request, the Access PIN, or a share). */
export const STAFF_ACCESS_COVERS_PAPER = 'This access also lets you bring in the patient’s paper records while it lasts.'

/**
 * To staff on Document OCR, when the patient's own OK does not cover bringing in their paper records (OCR's 403
 * OCR_RECORDS_PROCESSING_CONSENT_REQUIRED, or a 404 from creating the job, which means the same before that answer ships).
 */
export const STAFF_PAPER_NEEDS_ACCESS = 'To bring in this patient’s paper records, ask the patient to approve access, share their records with you, or enter their Access PIN.'

/** Whether a date of birth is 18 or more years ago; false when unknown or unreadable. */
export function isAdult(dateOfBirth: string | null | undefined, now = new Date()): boolean {
  if (!dateOfBirth) return false
  const born = new Date(dateOfBirth)
  if (Number.isNaN(born.getTime())) return false
  const eighteenth = new Date(Date.UTC(born.getUTCFullYear() + 18, born.getUTCMonth(), born.getUTCDate()))
  return now.getTime() >= eighteenth.getTime()
}
