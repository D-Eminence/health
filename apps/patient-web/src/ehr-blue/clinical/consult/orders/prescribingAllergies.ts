import { staffApi, type ClinicalRecord } from '../../../../staff/api'
import type { AllergyCheck } from '../../../../staff/allergies'
import {
  ALLERGY_GO_AHEAD_ERROR, ALLERGY_WARNING_UNREAD, allergyCheckInput, warningFromRefusal,
  type AllergyAcknowledgementState, type AllergyRefusal, type WarnedMedicine,
} from '../../parts/allergyWarning'
import type { Chart } from '../../parts/chart'
import { text } from './orders'

/**
 * The allergy warning where a prescription may go ahead over one (hid-system 0124, #218 at 76283f57): a new
 * prescription, Activate, Resume, and sending a draft to another pharmacy. The pieces each form shares: the check, the
 * stored medicine, and what a 409 ALLERGY_ACKNOWLEDGEMENT_REQUIRED shows. The form holds the warning
 * (useAllergyAcknowledgement) and sends an acknowledgement only after one was shown and ticked: an EHR before 0124
 * refuses the property.
 */

/** The form's error when the EHR refused a reason because the warning changed since it was read (the panel says so too). */
export const ALLERGY_CHANGED_ERROR = 'The allergy warning changed since you read it. Read the new warning, then tick the box again and give your reason to go ahead.'
/** The form's error when the EHR did not accept the acknowledgement (400 on allergyAcknowledgement; the reason says why). */
export const ACK_REFUSED_ERROR = 'Your reason for going ahead was not accepted. Change it, then try again.'
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
 * After the EHR's 409 ALLERGY_ACKNOWLEDGEMENT_REQUIRED: the check is run again for the same medicine for each line's
 * severity, reaction and how it matched (the 409 has the sentences only), the warning is shown with the newest token,
 * and the box is unticked (the reason is kept). Answers the form's error: "changed" when the refused request carried an
 * acknowledgement, so the prescriber knows to read the warning again.
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
  return warning.changedSinceShown ? ALLERGY_CHANGED_ERROR : ALLERGY_GO_AHEAD_ERROR
}
