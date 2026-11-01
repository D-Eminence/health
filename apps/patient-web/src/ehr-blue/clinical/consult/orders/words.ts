import { isHidApiError } from '@hid/http'
import type { LabHandoff, OrderRouteSummary } from '../../../../staff/api'
import { refusalText } from '../../../../staff/fieldProblem'

/**
 * Today's order wording and rules that staff/routes/Clinical.tsx keeps private (not exported), word for word, so the
 * blue order pages say exactly what today's page says. Everything Clinical.tsx imports from elsewhere (orderRoutes.ts,
 * OrderRoutes.tsx, fieldProblem.ts, labRevisions.tsx) is imported, not copied. Once Clinical.tsx exports these, this
 * file imports them instead.
 */

export interface StatusOption { readonly value: string; readonly label: string }

/** Clinical.tsx `prescriptionTransitions`. */
export const PRESCRIPTION_TRANSITIONS: Readonly<Record<string, readonly StatusOption[]>> = {
  draft: [{ value: 'active', label: 'Activate' }, { value: 'cancelled', label: 'Cancel' },
    { value: 'entered_in_error', label: 'Mark entered in error' }],
  active: [{ value: 'on_hold', label: 'Put on hold' }, { value: 'completed', label: 'Complete' },
    { value: 'cancelled', label: 'Cancel' }, { value: 'entered_in_error', label: 'Mark entered in error' }],
  on_hold: [{ value: 'active', label: 'Resume' }, { value: 'cancelled', label: 'Cancel' },
    { value: 'entered_in_error', label: 'Mark entered in error' }],
}

/** Clinical.tsx `PHARMACY_NOT_TOLD`. */
export const PHARMACY_NOT_TOLD = 'Pharmacy is not told of this change, so if this prescription was sent to Pharmacy you must contact the pharmacy. A dispensing already recorded is not undone. Pharmacy may refuse to dispense the version it was sent once the prescription has been put on hold, completed, cancelled or marked entered in error, even after it is resumed: if treatment is to continue and the pharmacy cannot dispense it, create a new prescription and send it.'

/** Clinical.tsx `ROUTED_LAB_CHOICES`: the changes offered for a lab request sent to another facility. */
export const ROUTED_LAB_CHOICES: Readonly<Record<string, readonly StatusOption[]>> = {
  active: [{ value: 'on_hold', label: 'Put on hold' }, { value: 'completed', label: 'Complete' },
    { value: 'cancelled', label: 'Cancel' }, { value: 'entered_in_error', label: 'Mark entered in error' }],
  on_hold: [{ value: 'cancelled', label: 'Cancel' }, { value: 'entered_in_error', label: 'Mark entered in error' }],
}

/** Clinical.tsx `labRequestChoices`. */
export function labRequestChoices(status: string, canSend: boolean): readonly StatusOption[] {
  const activate = (label: string): readonly StatusOption[] => canSend ? [{ value: 'active', label }] : []
  if (status === 'draft') return [{ value: 'cancelled', label: 'Cancel' },
    { value: 'entered_in_error', label: 'Mark entered in error' }, ...activate('Activate and send to Lab')]
  if (status === 'on_hold') return activate('Resume and send to Lab')
  return []
}

/** Clinical.tsx `LAB_SENT_BY_OTHERS`. */
export const LAB_SENT_BY_OTHERS: Readonly<Record<string, string>> = {
  draft: 'Only someone who may send requests to Lab can activate this draft.',
  on_hold: 'Only someone who may send requests to Lab can resume this request.',
  active: 'If the Laboratory may not have this request, ask someone who may send requests to Lab to use Send to Lab on it, or contact the laboratory.',
}

/** Clinical.tsx `LAB_NOT_TOLD`. */
export const LAB_NOT_TOLD: Readonly<Record<string, string>> = {
  active: 'Lab may already be working on this request. Holding, cancelling, completing or marking it entered in error is not passed to Lab, which keeps working on the version it accepted, so none of these is offered here; contact the laboratory to stop or correct it.',
  on_hold: 'Putting this request on hold was not passed to Lab, which may still be working on the version it accepted. Cancelling it or marking it entered in error would not be passed to Lab either, so neither is offered here; contact the laboratory to stop or correct it.',
}

/** Today's form hints and notes, word for word (Clinical.tsx RecordForm :509, :568-569, :581, and SendToLab). */
export const PRESCRIPTION_ROUTING_HINT = 'This saves a draft. To send it to a pharmacy at another facility, use Send to a pharmacy on it in the list.'
export const PRESCRIPTION_HINT = 'This creates an EHR draft. Pharmacy acceptance and dispensing are separate steps.'
export const DOSE_PAIR = 'Enter both dose quantity and dose unit, or leave both blank.'
export const DOSE_NUMBER_TEXT = 'Enter the dose as a number, like 0.5 or 250 (up to 4 decimal places).'
export const LAB_ACTIVE_NOTE = 'Active creation saves the request, then asks Lab to accept it. If Lab does not, the request stays saved and active, even when an error is shown: check the list before creating it again, then use Send to Lab on it there, or contact the laboratory if the EHR cannot send it.'
export const LAB_SEND_HINT = 'Sends this active request to Lab if Lab does not have it yet. Lab keeps one work item per request, so sending again changes nothing Lab already holds.'
/** Today's refusal and result of a create (Clinical.tsx:1455, :1502). */
export const NO_CHANGES = 'This access does not permit changes to the patient record.'
export const SAVED = 'Clinical record saved.'

/** The draft warning under "Request handling" (Clinical.tsx RecordForm). */
export function labDraftWarning(sendingElsewhere: boolean, canSendToLab: boolean, routable: boolean): string {
  if (sendingElsewhere) return 'The request is saved as a draft, then sent to the laboratory you choose: sending it activates it. If it can’t be sent, it stays a draft.'
  return `A draft is not sent to the Laboratory until it is activated.${canSendToLab ? '' : routable
    ? ' Only someone who may send requests to this facility’s Lab can activate it here; you can send it to another laboratory.'
    : ' Only someone who may send requests to Lab can activate it or create an active request.'}`
}

const LAB_REFUSALS: ReadonlySet<number> = new Set([400, 403, 409])

/** Clinical.tsx `labCode`. */
export function labCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : undefined
}

/** Clinical.tsx `handoffNames`: the saved request and Lab's code a 409 LAB_HANDOFF_REFUSED names (never shown). */
export function handoffNames(message: string) {
  const named = /Lab request ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) is saved and active in the EHR, but Lab refused it \(([A-Z][A-Z0-9_]{0,63})\)/i.exec(message)
  return { requestId: named?.[1], code: named?.[2] }
}

/** Clinical.tsx `sendItFrom`. */
export function sendItFrom(canSend: boolean) {
  return canSend ? 'use Send to Lab on the request' : 'someone who may send requests to Lab must use Send to Lab on the request'
}

export interface LabOutcome { readonly text: string; readonly accepted: boolean; readonly sendable?: boolean; readonly listChanged?: boolean }

/** Clinical.tsx `labHandoffOutcome`. */
export function labHandoffOutcome(handoff: LabHandoff | null, done: string, canSend: boolean): LabOutcome {
  switch (handoff?.state) {
    case 'accepted':
      return { accepted: true, text: `Lab request ${done} and accepted by Lab.` }
    case 'already_accepted':
      return { accepted: false, sendable: false, text: `Lab request ${done} in the EHR, but Lab holds an earlier version of it, so this change is not in Lab. Contact the laboratory.` }
    case 'failed': {
      if (handoff.code === 'LAB_ORDER_NOT_CURRENT') return { accepted: false, sendable: true, listChanged: true,
        text: `Lab request ${done} in the EHR, but it changed again before Lab accepted it, and Lab may hold that later version: check the request, and if it is still needed, ${sendItFrom(canSend)}.` }
      const code = labCode(handoff.code)
      const named = code ? ` (${code})` : ''
      return { accepted: false, sendable: true, text: LAB_REFUSALS.has(handoff.status)
        ? `Lab request ${done} in the EHR: its status is saved, but Lab refused it${named}. Once that is resolved, ${sendItFrom(canSend)}.`
        : `Lab request ${done} in the EHR: its status is saved, but Lab did not confirm it${named}, so the Laboratory may not have it: to send it again, ${sendItFrom(canSend)}.` }
    }
    case 'not_sent':
      if (handoff.code === 'ORDER_ROUTED') return { accepted: true, text: `Lab request ${done}. It was sent to another facility, so it was not sent to this facility’s Lab.` }
      return { accepted: false, sendable: false, text: `Lab request ${done} in the EHR, not sent to Lab: your role cannot send requests to Lab. Someone who may send requests to Lab must use Send to Lab on it.` }
    default:
      return { accepted: false, sendable: false, text: done === 'resumed'
        ? 'Lab request resumed in the EHR, but Lab was not told of the resumption: it may hold the version it accepted before the hold, or may never have received this request. Contact the laboratory to confirm the test is ordered.'
        : `Lab request ${done} in the EHR; Lab was not asked to accept it, so the Laboratory does not have it. Contact the laboratory to order the test.` }
  }
}

/** What a records read after a change came to (Clinical.tsx `Reload`). */
export type Reload = readonly unknown[] | 'failed' | null

/** Clinical.tsx `reloadSentence`. */
export function reloadSentence(reload: Reload, what: string, listChanged: boolean) {
  if (reload === 'failed') return ` The list could not be reloaded; refresh it to see the ${what}.`
  return Array.isArray(reload) && listChanged ? ' The list was reloaded.' : ''
}

export interface LabSendRefusal { readonly text: string; readonly reload?: boolean; readonly retry?: boolean; readonly sendable?: boolean }

/** Clinical.tsx `labSendRefusal`: what a refused Send to Lab means. */
export function labSendRefusal(caught: unknown): LabSendRefusal {
  if (!isHidApiError(caught)) return { retry: true, text: refusalText(caught, 'The lab request could not be sent to Lab. Send it again.') }
  if (caught.status === 412 || caught.code === 'LAB_ORDER_NOT_CURRENT') return { reload: true, sendable: true,
    text: 'This lab request changed since it was loaded, so it was not sent to Lab: check the request, and send it again if it is still needed.' }
  if (caught.code === 'LAB_REQUEST_NOT_ELIGIBLE') return { reload: true,
    text: 'This lab request is no longer active, so it was not sent to Lab.' }
  if (caught.code === 'LAB_ORDER_ALREADY_ACCEPTED') return {
    text: 'Lab already holds an earlier version of this request, so this version was not sent and its changes are not in Lab. Contact the laboratory.' }
  if (caught.code === 'LAB_ACCESS_DENIED') return { text: 'Lab does not allow you to accept this order for this patient.' }
  if (caught.code === 'LAB_REQUEST_ROUTED') return { reload: true, sendable: false,
    text: 'This lab request was sent to a laboratory at another facility, so this facility’s Lab can’t take it.' }
  if (caught.status === 502 || caught.code === 'LAB_HANDOFF_UNCONFIRMED') return { retry: true,
    text: 'Lab did not confirm that it accepted this request, so the Laboratory may not have it: send again.' }
  if (caught.status === 0 || caught.status === 408 || caught.status >= 500) return { retry: true,
    text: `${refusalText(caught, 'The service did not answer.')} The request may not have reached Lab: send it again.` }
  if (caught.status === 404) return { reload: true, sendable: false,
    text: 'The EHR did not find this lab request to send, or cannot send a saved request to Lab. Contact the laboratory if the test is still needed.' }
  if (caught.status === 401) return { text: refusalText(caught, 'Sign in again to send this request to Lab.') }
  const code = labCode(caught.code)
  return { text: `This lab request was not sent to Lab: it was refused${code ? ` (${code})` : ''}. Contact the laboratory if the test is still needed.` }
}

/** Clinical.tsx `handoffPrescription`: the refusals that mean the prescription changed under the handoff. */
export const PHARMACY_ALREADY_HOLDS = 'Pharmacy already holds work for this prescription, sent earlier, perhaps at an earlier version or with another reason, so it was not sent again. If the prescription changed since, contact the pharmacy: it may refuse to dispense the version it holds, and if it cannot dispense it, create a new prescription and send that.'

export function prescriptionChanged(caught: unknown): string | null {
  if (!isHidApiError(caught)) return null
  if (caught.code === 'PHARMACY_PRESCRIPTION_NOT_ELIGIBLE') return 'This prescription no longer matches what was sent (it was changed, put on hold or cancelled meanwhile), so Pharmacy did not accept it.'
  if (caught.status === 412) return 'This prescription changed since it was loaded, so it was not sent to Pharmacy: check it, and send it again if it is still needed.'
  if (caught.code === 'PRESCRIPTION_NOT_ELIGIBLE') return 'This prescription is no longer active, so it was not sent to Pharmacy.'
  if (caught.code === 'PRESCRIPTION_ROUTED') return 'This prescription was sent to a pharmacy at another facility, so this facility’s Pharmacy can’t take it.'
  return null
}

/** Clinical.tsx `releasedResultsRefusal`. */
export function releasedResultsRefusal(caught: unknown): string {
  if (!isHidApiError(caught)) return refusalText(caught, 'Released results could not be loaded.')
  if (caught.status === 404) return caught.code === 'LAB_WORK_ITEM_NOT_FOUND'
    ? 'Lab has no work item for this request that you can see: Lab has not accepted it, accepted it at another facility, or your access to this patient does not cover it.'
    : 'Released results are not available from this Lab service.'
  if (caught.status === 403) return `Access denied: you may not read this request's Lab results here${labCode(caught.code) ? ` (${caught.code})` : ''}.`
  return refusalText(caught, 'Released results could not be loaded.')
}

/** Clinical.tsx `readOrderRoute`: a route summary, null for none, or undefined when the EHR sent no field. */
export function readOrderRoute(value: unknown): OrderRouteSummary | null | undefined {
  if (value === null) return null
  if (typeof value !== 'object' || value === undefined) return undefined
  const route = value as Partial<OrderRouteSummary>
  if (typeof route.id !== 'string' || typeof route.effectiveState !== 'string' || typeof route.receivingFacility !== 'object'
    || route.receivingFacility === null) return undefined
  return route as OrderRouteSummary
}

/** Clinical.tsx `rowVersion`. */
export function rowVersion(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null
}
