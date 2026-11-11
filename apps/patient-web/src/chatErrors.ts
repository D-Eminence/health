import { isHidApiError } from '@hid/http'

/** What a failed question or deletion says, from hid-system's codes (ADR-068, "Patient record chat"). */
export interface ChatFailure {
  message: string
  /** The notice version changed: re-read it and accept it again before asking. */
  noticeChanged?: boolean
  /** The same key must not be sent again: the service reads it as another question. */
  newKey?: boolean
  /** Record chat is off or paused: look at availability again. */
  recheckAvailability?: boolean
}

export function askFailure(reason: unknown, historyLimit: number): ChatFailure {
  if (!isHidApiError(reason)) return { message: 'Record chat is unavailable. Please try again.' }
  switch (reason.code) {
    case 'CHAT_NOTICE_REQUIRED':
      return { message: 'The notice about how record chat works has changed. Read it again and accept it to continue.', noticeChanged: true, newKey: true }
    case 'RECORD_CHAT_DISABLED':
    case 'RECORD_CHAT_PAUSED':
    case 'PLATFORM_CONTROL_UNAVAILABLE':
      return { message: 'Record chat is not available right now.', recheckAvailability: true }
    case 'RECORD_CHAT_BUDGET_EXHAUSTED':
      return { message: 'Record chat has reached its limit for today. Please try again tomorrow.' }
    case 'RECORD_CHAT_BUSY':
      return { message: 'Another question is being answered. Please try again in a few seconds.' }
    case 'RECORD_CHAT_RATE_LIMITED':
      return { message: 'You have asked as many questions as record chat allows for now (10 an hour, 30 a day). Please try again later.' }
    case 'CHAT_HISTORY_FULL':
      return { message: `Your saved conversation is full (${historyLimit} exchanges). Start a new conversation to ask more.` }
    case 'CHAT_SOURCES_CHANGED':
      return { message: 'A record this answer used has changed. Please ask your question again.', newKey: true }
    case 'CHAT_CONVERSATION_CHANGED':
      return { message: 'This conversation was cleared while your question was being answered. Please ask again.', newKey: true }
    case 'IDEMPOTENCY_KEY_REUSED':
      return { message: 'Your question could not be sent again. Please ask it again.', newKey: true }
    case 'INVALID_QUESTION':
    case 'VALIDATION_FAILED':
      return { message: 'Your question could not be sent. Please shorten it and remove unusual characters.' }
    case 'PATIENT_RECORDS_UNAVAILABLE':
    case 'IDENTITY_SERVICE_UNAVAILABLE':
      return { message: 'Your records could not be read right now. Please try again shortly.' }
    case 'REQUEST_TIMEOUT':
      return { message: 'The reply took too long. Please try again.' }
    default:
  }
  if (reason.status === 401) return { message: 'Your session ended. Please sign in again.' }
  if (reason.status === 403) return { message: 'You do not have access to record chat.' }
  return { message: 'Record chat is unavailable. Please try again later.' }
}

export function clearFailure(reason: unknown): string {
  if (isHidApiError(reason) && reason.code === 'CHAT_HISTORY_ON_HOLD') {
    return 'A legal hold means your saved conversation cannot be deleted right now.'
  }
  if (isHidApiError(reason) && reason.status === 401) return 'Your session ended. Please sign in again.'
  return 'Your saved conversation could not be deleted. Please try again.'
}

/**
 * What a failed question about a patient says to a clinician, from hid-system's codes (ADR-069). Codes the patient's
 * chat shares are worded for a clinician here; the quotas are the staff ones (proposed: 20 an hour, 100 a day).
 */
export function staffAskFailure(reason: unknown, historyLimit: number): ChatFailure & { accessEnded?: boolean } {
  if (isHidApiError(reason)) {
    switch (reason.code) {
      case 'CHAT_NOTICE_REQUIRED':
        return { message: 'The notice about how record chat works has changed. Read it again and accept it to continue.', noticeChanged: true, newKey: true }
      case 'RECORD_CHAT_DISABLED':
      case 'RECORD_CHAT_PAUSED':
      case 'PLATFORM_CONTROL_UNAVAILABLE':
        return { message: 'Record chat is not available right now.', recheckAvailability: true }
      case 'RECORD_CHAT_BUDGET_EXHAUSTED':
        return { message: 'Record chat has reached its limit for today. Please try again tomorrow.' }
      case 'RECORD_CHAT_BUSY':
        return { message: 'Another question of yours is being answered. Please try again in a few seconds.' }
      case 'RECORD_CHAT_RATE_LIMITED':
        return { message: 'You have asked as many questions as record chat allows for now (20 an hour, 100 a day). Please try again later.' }
      case 'CHAT_HISTORY_FULL':
        return { message: `Your saved conversation about this patient is full (${historyLimit} exchanges). Start a new conversation to ask more.` }
      case 'CHAT_SOURCES_CHANGED':
        return { message: 'A record this answer used has changed. Please ask your question again.', newKey: true }
      case 'CHAT_CONVERSATION_CHANGED':
        return { message: 'This conversation was cleared while your question was being answered. Please ask again.', newKey: true }
      case 'IDEMPOTENCY_KEY_REUSED':
        return { message: 'Your question could not be sent again. Please ask it again.', newKey: true }
      case 'INVALID_QUESTION':
      case 'VALIDATION_FAILED':
        return { message: 'Your question could not be sent. Please shorten it and remove unusual characters.' }
      case 'CONSENT_REQUIRED':
        return { message: 'Your access to this patient has ended or changed. Open the patient again to continue.', accessEnded: true }
      case 'BREAK_GLASS_EXCLUDED':
        return { message: 'Record chat is not available under emergency access. Use the emergency summary.', accessEnded: true }
      case 'PURPOSE_OF_USE_REQUIRED':
        return { message: 'Record chat is for direct care only.' }
      case 'IDENTITY_SERVICE_UNAVAILABLE':
      case 'PATIENT_RECORDS_UNAVAILABLE':
        return { message: 'The patient’s records could not be read right now. Please try again shortly.' }
      case 'REQUEST_TIMEOUT':
        return { message: 'The reply took too long. Please try again.' }
      default:
    }
    if (reason.status === 401) return { message: 'Your session ended. Please sign in again.', accessEnded: true }
    if (reason.status === 403) return { message: 'You do not have access to record chat for this patient.', accessEnded: true }
  }
  return { message: 'Record chat is unavailable. Please try again later.' }
}

export function staffClearFailure(reason: unknown): string {
  if (isHidApiError(reason) && reason.code === 'CHAT_HISTORY_ON_HOLD') {
    return 'A legal hold means your saved conversation cannot be deleted right now.'
  }
  if (isHidApiError(reason) && reason.status === 401) return 'Your session ended. Please sign in again.'
  return 'Your saved conversation could not be deleted. Please try again.'
}

/**
 * What a failed question says to the patient on a Novu build (hid-system #167), in plain words, never the code.
 * `askAgain` offers to send the same question again: the record, the conversation or access changed while it was
 * being answered. The page keeps the typed question in the box on every failure.
 */
export function novuAskFailure(reason: unknown): { message: string; askAgain?: boolean } {
  if (!isHidApiError(reason)) return { message: 'Something went wrong while answering. Your question is still in the box below, so you can try again.' }
  switch (reason.code) {
    case 'INVALID_QUESTION':
    case 'VALIDATION_FAILED':
      return { message: 'That question could not be sent. Please write it in 1 to 500 characters and try again.' }
    case 'PATIENT_CHAT_RATE_LIMITED':
      return { message: 'You have asked several questions in a short time. Please wait a few minutes, then ask again.' }
    case 'CHAT_SOURCES_CHANGED':
      return { message: 'Your records changed while we were answering. Please ask your question again.', askAgain: true }
    case 'CHAT_CONVERSATION_CHANGED':
      return { message: 'This conversation was cleared while we were answering. Please ask your question again.', askAgain: true }
    case 'CHAT_ACCESS_CHANGED':
      return { message: 'Access to your records changed while we were answering. Please ask your question again.', askAgain: true }
    case 'PATIENT_CHAT_DISABLED':
      return { message: 'Asking about your records is turned off at the moment. Please try again later.' }
    case 'PATIENT_CHAT_UNAVAILABLE':
      return { message: 'Asking about your records is not working right now. Please try again in a few minutes.' }
    case 'REQUEST_TIMEOUT':
      return { message: 'The answer took too long. Please try again.' }
    default:
  }
  if (reason.status === 401) return { message: 'Your session ended. Please sign in again.' }
  if (reason.status === 403) return { message: 'You cannot ask about these records from this account.' }
  if (reason.status === 409) return { message: 'Your records changed while we were answering. Please ask your question again.', askAgain: true }
  if (reason.status === 429) return { message: 'You have asked several questions in a short time. Please wait a few minutes, then ask again.' }
  return { message: 'Asking about your records is not working right now. Please try again in a few minutes.' }
}

/** What a source that could not be opened says. `retry` offers to try opening it again. */
export function novuSourceFailure(reason: unknown): { message: string; retry?: boolean } {
  if (isHidApiError(reason)) {
    if (reason.code === 'CHAT_SOURCE_UNAVAILABLE' || reason.status === 404) {
      return { message: 'This source is no longer available. Ask your question again to see its sources.' }
    }
    if (reason.status === 401) return { message: 'Your session ended. Please sign in again.' }
  }
  return { message: 'This source could not be opened right now. Please try again.', retry: true }
}
