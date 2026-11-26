import { isHidApiError } from '@hid/http'
import { dentalApi, type Encounter } from '../../../staff/api'
import { failureText, type Chart } from '../parts/chart'
import { encounterTypeLabel } from '../consult/encounters'
import { learnFrom, refusalWords } from './dentalRules'
import type { IdempotencyKeys } from './hooks'

/*
 * Starting a dental visit (DEN-1 "The visit"): the patient's outpatient visit today (EHR-C1 with `reuseOpenVisit`, so a
 * double tap or two staff at once make one visit), then the dental record on it (route 2, started or already started).
 * Only after the chart opened under the usual access (Access PIN or approval); each step checks it again first.
 */

/** EHR-C1's refusal of a visit "reusing the open visit today" whose start time is not today in Lagos. */
export const VISIT_NOT_TODAY = 'REUSE_OPEN_VISIT_STARTED_AT_NOT_TODAY'

export type Started = { readonly encounterId: string } | { readonly refused: string }

/**
 * A failed dental step in plain words: the dental clinic's own words for a refusal from the API, and the chart's own
 * sentence when the access check before it failed ("Your access to this patient has ended…").
 */
export function dentalFailure(caught: unknown, fallback: string, invalid?: string): string {
  return isHidApiError(caught) ? refusalWords(caught, fallback, invalid) : failureText(caught, fallback)
}

/** Today's open visit is of another kind (an emergency or inpatient visit): it is named, and not used. */
export function otherVisitWords(encounter: Pick<Encounter, 'encounterType'>): string {
  const kind = encounterTypeLabel(encounter.encounterType).toLowerCase()
  return `This patient already has an open ${kind || 'other'} visit today. Dental records go on an outpatient visit: finish `
    + 'that visit in Consultation first, then start the dental visit.'
}

/**
 * The outpatient visit today, then its dental record. One attempt keeps its start time while the page is open
 * (`startedAtFor`), so a retry after a lost answer sends the same body, which with the same Idempotency-Key ehr-api
 * answers with the first visit again; across Lagos midnight the attempt starts again once with a new time.
 */
export async function startTodaysDentalVisit(chart: Chart, complaint: string, keyFor: IdempotencyKeys,
  startedAtFor: Map<string, string>, now: () => Date = () => new Date()): Promise<Started> {
  const { facilityId, patientId } = chart
  const send = async () => {
    let startedAt = startedAtFor.get(patientId)
    if (!startedAt) {
      startedAt = now().toISOString().replace(/\.\d{3}Z$/, '.000Z')
      startedAtFor.set(patientId, startedAt)
    }
    const body = { patientId, startedAt, chiefComplaint: complaint }
    try {
      return await dentalApi.outpatientVisit(facilityId, patientId, { startedAt, chiefComplaint: complaint }, keyFor('visit', body))
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === VISIT_NOT_TODAY) {
        startedAtFor.delete(patientId)
        keyFor.forget('visit', body)
      }
      throw caught
    }
  }
  try {
    await chart.verify()
    let encounter: Encounter
    try {
      encounter = await send()
    } catch (caught) {
      if (!isHidApiError(caught) || caught.code !== VISIT_NOT_TODAY) throw caught
      encounter = await send()
    }
    if (encounter.encounterType !== 'ambulatory') return { refused: otherVisitWords(encounter) }
    const started = await startDentalRecord(chart, encounter.id, keyFor)
    if ('refused' in started) return started
    startedAtFor.delete(patientId)
    return started
  } catch (caught) {
    // EHR-C1's refusals say nothing about whether the dental routes are served: route 2's own are learnt from below.
    return { refused: dentalFailure(caught, 'The dental visit could not be started. Try again.') }
  }
}

/** Route 2 on a visit already open: the dental record started, or already started. */
export async function startDentalRecord(chart: Chart, encounterId: string, keyFor: IdempotencyKeys): Promise<Started> {
  try {
    await chart.verify()
    await dentalApi.startVisit(chart.facilityId, chart.patientId, encounterId, keyFor('start', { patientId: chart.patientId, encounterId }))
    learnFrom()
    return { encounterId }
  } catch (caught) {
    learnFrom(caught)
    return { refused: dentalFailure(caught, 'The dental record could not be started. Try again.') }
  }
}
