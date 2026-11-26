import { isHidApiError, type HidApiError } from '@hid/http'
import { useId } from 'react'
import { usesNovuBackend } from '../../../backendContract'
import { staffApi, type ClinicalRecord } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { NO_CONSENT, OPEN_PATIENT_AGAIN, REASON_FIELD, REASON_SHORT, UPDATING, reasonCheck, text } from '../consult/encounters'
import type { Chart } from '../parts/chart'
import { RecordForm, type FormValues, type SubmitOutcome } from '../parts/RecordForm'
import { refusedFieldErrors, rowVersion } from './records'
import {
  EIE_FAILED, EIE_LABEL, EIE_NOT_FOUND, EIE_NO_ROLE, EIE_RELOAD_FIRST, EIE_UNAVAILABLE, EIE_WARNING, isRetracted,
} from './vitals'

/**
 * What marking a reading entered in error came to, for the page to read its vitals again and say so: `done` (marked
 * now), `already` (marked before this, which the route answers before the version check: it is treated as done), or
 * `changed` (412: the reading changed since it was read, so nothing was marked and the user is asked again).
 */
export type Withdrawal = 'done' | 'already' | 'changed'

/**
 * EHR-C8b is offered to a role that may write vitals, with write access to the patient, on a reading not already
 * entered in error, and only on Novu (an earlier backend has no such route: its vitals are only corrected).
 */
export function canWithdraw(chart: Chart, vital: ClinicalRecord): boolean {
  return usesNovuBackend() && chart.canWrite && chart.can('ehr.vital.write') && !isRetracted(vital)
}

/**
 * The form of "Mark as entered in error" for one vitals reading (EHR-C8b): the reason the route requires (3 to 500
 * characters), and what it does beside the button that sends it. It is sent in one press, with no dialog, as C8a's and
 * the note's entered in error are: the design confirms no entered in error (CONFIRMED_ACTIONS, sample/definitions.ts).
 * A press re-checks access, sends the reading's row version, and hands the outcome to the page (`onWithdrawn`), which
 * reads the vitals again. Every other refusal stays in the form, in plain words, with the reason kept.
 */
export function EnteredInErrorForm({ chart, encounterId, vital, onWithdrawn }: {
  chart: Chart
  encounterId: string
  vital: ClinicalRecord
  onWithdrawn: (outcome: Withdrawal) => Promise<void> | void
}) {
  const warningId = useId()

  const submit = async (values: FormValues): Promise<SubmitOutcome> => {
    const expectedRowVersion = rowVersion(vital.rowVersion)
    if (expectedRowVersion === null) return { formError: EIE_RELOAD_FIRST }
    try {
      await chart.verify()
      await staffApi.markVitalEnteredInError(chart.facilityId, chart.patientId, encounterId, vital.id, { expectedRowVersion, changeReason: text(values.reason) })
    } catch (caught) {
      if (!isHidApiError(caught)) return { formError: refusalText(caught, EIE_FAILED) }
      if (caught.code === 'VITAL_ALREADY_ENTERED_IN_ERROR') return onWithdrawn('already')
      if (caught.status === 412) return onWithdrawn('changed')
      return withdrawalRefused(caught)
    }
    return onWithdrawn('done')
  }

  return (
    <RecordForm
      fields={[REASON_FIELD]}
      validate={reasonCheck}
      submitLabel={EIE_LABEL}
      busyLabel={UPDATING}
      submitVariant="secondary"
      describedBy={warningId}
      onSubmit={submit}
    >
      <p id={warningId} className="hid-ehr-clinical-consult-warning">{EIE_WARNING}</p>
    </RecordForm>
  )
}

/** A refusal that leaves the reading as it was, in plain words: the reason's own at its field, the others in the form. */
function withdrawalRefused(caught: HidApiError): SubmitOutcome {
  switch (caught.code) {
    case 'CHANGE_REASON_REQUIRED': return { fieldErrors: { reason: REASON_SHORT } }
    case 'CONSENT_REQUIRED': return { formError: NO_CONSENT }
    case 'PERMISSION_DENIED': return { formError: EIE_NO_ROLE }
    case 'PURPOSE_OF_USE_REQUIRED': return { formError: OPEN_PATIENT_AGAIN }
    case 'VITAL_NOT_FOUND': return { formError: EIE_NOT_FOUND }
    case 'VITALS_STATUS_UNAVAILABLE': return { formError: EIE_UNAVAILABLE }
  }
  if (caught.code === 'VALIDATION_FAILED') {
    const fieldErrors = refusedFieldErrors(caught, name => name === 'changeReason' ? 'reason' : undefined)
    // A refusal that names the reason is shown at it; one about anything else (the form checked the reason already)
    // says only that nothing was marked, never pointing at the reason.
    return Object.keys(fieldErrors).length > 0 ? { formError: refusalText(caught, EIE_FAILED), fieldErrors } : { formError: EIE_FAILED }
  }
  return { formError: refusalText(caught, EIE_FAILED) }
}
