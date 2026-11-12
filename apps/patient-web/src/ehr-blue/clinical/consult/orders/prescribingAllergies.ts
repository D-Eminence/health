import { staffApi, type ClinicalRecord } from '../../../../staff/api'
import type { AllergyCheck } from '../../../../staff/allergies'
import {
  ACK_NOT_ACCEPTED, ACK_REASON_SHORT, ALLERGY_GO_AHEAD_ERROR, ALLERGY_WARNING_UNREAD, allergyCheckInput, sameMedicine, warningFromRefusal,
  type AllergyAcknowledgementState, type AllergyRefusal, type WarnedMedicine,
} from '../../parts/allergyWarning'
import type { Chart } from '../../parts/chart'
import { text } from './orders'

/**
 * The allergy warning where a prescription may go ahead over one (hid-system 0124, #218 at 7fbb04aa): a new
 * prescription, Activate, Resume, and sending a prescription (a draft or an active one) to another facility's pharmacy.
 * The pieces each form shares: the check, the stored medicine, and what a 409 ALLERGY_ACKNOWLEDGEMENT_REQUIRED shows.
 * The form holds the warning (useAllergyAcknowledgement) and sends an acknowledgement only after one was shown and
 * ticked: an EHR before 0124 refuses the property.
 */

/** The form's error when the EHR refused a reason because the warning changed since it was read (the panel says so too). */
export const ALLERGY_CHANGED_ERROR = 'The allergy warning changed since you read it. Read the new warning, then tick the box again and give your reason to go ahead.'
/**
 * The form's error when the EHR did not accept the reason (409 REASON_MISSING or REASON_INVALID; a 400 on
 * allergyAcknowledgement from an older EHR): the reason's own error says why.
 */
export const ACK_REFUSED_ERROR = 'Your reason for going ahead was not accepted. Change it, then try again.'
/** The form's error when the EHR could not match the tick to a warning (409 TOKEN_INVALID): the warning stays, unticked. */
export const ALLERGY_TICK_AGAIN_ERROR = 'Your tick could not be matched to the allergy warning. Read the warning, then tick the box again to go ahead.'
/** TOKEN_INVALID with REASON_MISSING or REASON_INVALID: the tick goes, and the reason's own error says why it was refused. */
export const ALLERGY_TICK_AND_REASON_ERROR = 'Your tick could not be matched to the allergy warning, and your reason for going ahead was not accepted. '
  + 'Read the warning, tick the box again and change your reason.'
/** A check or a refusal that answered for a medicine the prescriber has since changed: nothing is shown or saved. */
export const MEDICINE_CHANGED_ERROR = 'The medicine was changed while it was being checked for allergies, so nothing was saved. Save again to check the new medicine.'

/**
 * The allergy check for a medicine: the EHR's answer, or null when it fails, cannot be read, or is not offered (404
 * from a backend before 0124). Never throws: the save itself is checked by the EHR, which answers 409 with the warning.
 */
export function checkAllergies(chart: Chart, medicine: WarnedMedicine): Promise<AllergyCheck | null> {
  return Promise.resolve()
    .then(() => staffApi.allergyCheck(chart.facilityId, chart.patientId, allergyCheckInput(medicine)))
    .catch(() => null)
}

/** The medicine a saved prescription holds, as the EHR checks it on Activate, Resume and send (its display and code). */
export function storedMedicine(record: ClinicalRecord): WarnedMedicine {
  const code = text(record.medicationCode).trim()
  return { display: text(record.medicationDisplay), ...(code ? { code } : {}) }
}

/**
 * After the EHR's 409 ALLERGY_ACKNOWLEDGEMENT_REQUIRED, on a new prescription, Activate, Resume and send alike. Answers
 * the form's error.
 *
 * - The reason alone refused (7fbb04aa: REASON_MISSING or REASON_INVALID, the token accepted): the warning did not
 *   change, so the warning shown stays, with its token, the tick and the reason as written; the reason is marked with
 *   its own error and takes focus. Nothing is checked again.
 * - Otherwise the check is run again for the same medicine for each line's severity, reaction and how it matched (the
 *   409 has the sentences only), and the warning is shown with the newest token (the check's, else the 409's own), the
 *   box unticked:
 *   - changed since it was shown (TOKEN_STALE, whatever else was refused; or, from an EHR at 76283f57, any refused
 *     request that carried an acknowledgement): said so, and the reason, written for the older warning, emptied too;
 *   - the token refused (TOKEN_INVALID): the reason stays; to tick again; a reason refused with it is marked too;
 *   - the first warning (MISSING, or none sent): to tick and give a reason.
 *
 * `current` says whether the medicine is still the one that was sent (the prescriber may edit it on a new
 * prescription meanwhile): if not, nothing is shown.
 */
export async function warnAfterRefusal({ ack, refusal, medicine, chart, current = () => true }: {
  ack: AllergyAcknowledgementState
  refusal: AllergyRefusal
  medicine: WarnedMedicine
  chart: Chart
  current?: () => boolean
}): Promise<string> {
  const reasonError = refusal.reasonRefused === 'missing' ? ACK_REASON_SHORT : ACK_NOT_ACCEPTED
  const shown = ack.warning
  if (refusal.reasonRefused && !refusal.changedSinceShown && !refusal.tokenRefused) {
    if (!current()) return MEDICINE_CHANGED_ERROR
    // The token sent was the current warning's: the 409 names the same one (any other is read afresh below).
    if (shown && sameMedicine(shown.medicine, medicine) && (refusal.warningToken === null || refusal.warningToken === shown.warningToken)) {
      ack.refuseReason(reasonError)
      return ACK_REFUSED_ERROR
    }
  }
  const check = await checkAllergies(chart, medicine)
  if (!current()) return MEDICINE_CHANGED_ERROR
  const warning = warningFromRefusal(refusal, medicine, check)
  if (!warning) {
    // No token to acknowledge with: a warning still shown names an older one, which the EHR would refuse.
    ack.clear()
    return ALLERGY_WARNING_UNREAD
  }
  ack.show(warning)
  ack.setTicked(false)
  if (warning.changedSinceShown) return ALLERGY_CHANGED_ERROR
  if (refusal.reasonRefused) ack.refuseReason(reasonError)
  if (refusal.tokenRefused) return refusal.reasonRefused ? ALLERGY_TICK_AND_REASON_ERROR : ALLERGY_TICK_AGAIN_ERROR
  return refusal.reasonRefused ? ACK_REFUSED_ERROR : ALLERGY_GO_AHEAD_ERROR
}
