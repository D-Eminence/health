import { HidApiError } from '@hid/http'
import { describe, expect, it } from 'vitest'
import { readAllergyRefusal } from '../../../ehr-blue/clinical/parts/allergyWarning'
import { refusalRejections, warningMessages } from '../../../staff/allergies'

/**
 * What hid-system#218 at 7fbb04aa adds to the allergy check at prescribing, read by the blue EHR: the refused parts of
 * the 409 (allergyAcknowledgement.rejected, read by code). An EHR at 76283f57 sends none: it is read as before, never
 * as "none". Every id, token, name and date is fictional.
 */

const TOKEN = 'd'.repeat(64)
const LINE = 'Penicillin allergy: SEVERE (Anaphylaxis). This medicine is one of the penicillins, the same group. Recorded by a clinician at this facility on 3 Mar 2026.'

function rejected(code: string, message = 'A sentence that is never shown.') {
  return { field: 'allergyAcknowledgement.rejected', code, messages: [message] }
}

/** The 409 as the http client gives it: warnings, the token, then the refused parts (none from an EHR at 76283f57). */
function refusal(...parts: object[]) {
  return new HidApiError(409, 'Conflict', {
    code: 'ALLERGY_ACKNOWLEDGEMENT_REQUIRED', detail: 'Never read.',
    details: [{ field: 'allergyAcknowledgement', messages: [LINE] }, { field: 'allergyAcknowledgement.warningToken', messages: [TOKEN] }, ...parts],
  })
}

describe('the refused parts of a 409 ALLERGY_ACKNOWLEDGEMENT_REQUIRED (7fbb04aa)', () => {
  it('reads the codes in the EHR’s order, by code alone, and leaves out other fields and codes it does not know', () => {
    const details = refusal(rejected('ALLERGY_ACKNOWLEDGEMENT_REASON_INVALID'), rejected('ALLERGY_WARNING_TOKEN_STALE'),
      rejected('ALLERGY_SOMETHING_NEW'), { field: 'allergyAcknowledgement', code: 'ALLERGY_WARNING_TOKEN_INVALID', messages: [] }).details
    expect(refusalRejections(details)).toEqual(['ALLERGY_ACKNOWLEDGEMENT_REASON_INVALID', 'ALLERGY_WARNING_TOKEN_STALE'])
    // The refused parts are never warning lines.
    expect(warningMessages(details)).toEqual([LINE])
  })

  it('is null when no refused part is named (an EHR at 76283f57), or only parts it does not know', () => {
    expect(refusalRejections(refusal().details)).toBeNull()
    expect(refusalRejections(refusal(rejected('ALLERGY_SOMETHING_NEW')).details)).toBeNull()
    expect(refusalRejections([{ field: 'allergyAcknowledgement.rejected', messages: ['no code'] }])).toBeNull()
    expect(refusalRejections(null)).toBeNull()
  })

  it.each([
    ['ALLERGY_ACKNOWLEDGEMENT_MISSING', false, { changedSinceShown: false }],
    ['ALLERGY_WARNING_TOKEN_STALE', true, { changedSinceShown: true }],
    ['ALLERGY_ACKNOWLEDGEMENT_REASON_MISSING', true, { changedSinceShown: false, reasonRefused: 'missing' }],
    ['ALLERGY_ACKNOWLEDGEMENT_REASON_INVALID', true, { changedSinceShown: false, reasonRefused: 'invalid' }],
    ['ALLERGY_WARNING_TOKEN_INVALID', true, { changedSinceShown: false, tokenRefused: true }],
  ])('%s: read for what it says, whatever was sent', (code, sent, said) => {
    expect(readAllergyRefusal(refusal(rejected(code)), sent)).toEqual({ messages: [LINE], warningToken: TOKEN, ...said })
  })

  it('reads a reason and a token refused together, each one', () => {
    expect(readAllergyRefusal(refusal(rejected('ALLERGY_ACKNOWLEDGEMENT_REASON_INVALID'), rejected('ALLERGY_WARNING_TOKEN_STALE')), true))
      .toEqual({ messages: [LINE], warningToken: TOKEN, changedSinceShown: true, reasonRefused: 'invalid' })
    expect(readAllergyRefusal(refusal(rejected('ALLERGY_ACKNOWLEDGEMENT_REASON_MISSING'), rejected('ALLERGY_WARNING_TOKEN_INVALID')), true))
      .toEqual({ messages: [LINE], warningToken: TOKEN, changedSinceShown: false, reasonRefused: 'missing', tokenRefused: true })
  })

  it('from an EHR at 76283f57 (no refused part named): "changed" exactly when the refused request carried an acknowledgement', () => {
    expect(readAllergyRefusal(refusal(), true)).toEqual({ messages: [LINE], warningToken: TOKEN, changedSinceShown: true })
    expect(readAllergyRefusal(refusal(), false)).toEqual({ messages: [LINE], warningToken: TOKEN, changedSinceShown: false })
    expect(readAllergyRefusal(refusal(rejected('ALLERGY_SOMETHING_NEW')), true)!.changedSinceShown).toBe(true)
  })
})
