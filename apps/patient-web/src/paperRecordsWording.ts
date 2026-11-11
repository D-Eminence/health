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

/**
 * A records-processing request: one the patient's request list marks with the purpose healthcare-operations
 * (hid-system 0104 D5: identity.list_my_access_requests() gives purpose_of_use, which identity-api sends as `purpose`)
 * and that asks to change records (write_records). Approving it gives the dedicated records-processing grant (hid-system
 * #229, 0113 D1: healthcare-operations, write_records, at most 24 hours, never a PIN or a share), under which staff add
 * paper readings as draft notes that a clinician signs later. A backend that sends no purpose never matches.
 */
export function isRecordsProcessingRequest(request: { purpose?: string | null; scope: string }): boolean {
  return request.purpose === 'healthcare-operations' && request.scope === 'write_records'
}

/** "24 hours", "8 hours", "1 hour", "30 minutes", "1 hour and 30 minutes": a request's length in plain words; null when unknown. */
export function durationInWords(minutes: number | null | undefined): string | null {
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes <= 0) return null
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return count(rest, 'minute')
  if (rest === 0) return count(hours, 'hour')
  return `${count(hours, 'hour')} and ${count(rest, 'minute')}`
}

/**
 * On a pending records-processing request (isRecordsProcessingRequest), in place of paperRecordsOnApproval: the wording
 * given with hid-system #229 for the approval screen of a records-processing request, word for word.
 */
export function paperRecordsOnRecordsProcessingApproval(facilityName: string, duration: string): string {
  return `If you approve, staff at ${facilityName} can add your paper records to your Health ID record for the next ${duration}. Each one is saved as a draft, and you will only see it after a clinician checks and signs it.`
}

/**
 * Whether the records-processing grant (hid-system #229, 0113) is deployed in production. Off until it is: production
 * since 0104 already sends a request's purpose, so a healthcare-operations write_records request can reach a patient
 * today, but approving it cannot yet keep paper records as drafts that a clinician signs, and the records-processing
 * sentence would not be true. Turn it on in the website release that follows #229's deploy. Tests may switch it.
 */
export const RECORDS_PROCESSING_GRANT = { live: false }

/**
 * The paper records line for a pending request in the patient's access-request drawer: the records-processing sentence
 * for a records-processing request whose length is known, once that grant is live (RECORDS_PROCESSING_GRANT), and
 * today's line for every other request.
 */
export function paperRecordsLineForRequest(request: { purpose?: string | null; scope: string; facilityName: string; requestedDurationMinutes: number | null }): string {
  const duration = durationInWords(request.requestedDurationMinutes)
  return RECORDS_PROCESSING_GRANT.live && isRecordsProcessingRequest(request) && duration
    ? paperRecordsOnRecordsProcessingApproval(request.facilityName, duration)
    : paperRecordsOnApproval(request.facilityName)
}

/** On the patient's Access PIN. */
export const PIN_COVERS = 'A hospital you give it to can use it to open your records, and to add your old paper records to your Health ID while that access lasts.'

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
