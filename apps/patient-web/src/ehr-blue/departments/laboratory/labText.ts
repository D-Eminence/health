import { isHidApiError } from '@hid/http'
import type { LabAbnormalFlag, LabResultRevision } from '../../../staff/api'
import type { FlagLevel } from '../../../kasuwa/parts'

/*
 * The lab's rules that are not screens: reading a reference range and the flag a value earns against it, the plain words
 * for each flag, whether a refusal leaves read access to results in doubt (then they are hidden), and taking a Health
 * ID or phone number as typed and sending it clean. The range, flag and access rules are the Laboratory page's, unchanged.
 */

/**
 * A reference range as a lab writes it ("12-16", "12 – 16", "<5", "≤ 5", ">10"), as its bounds; null when it can't be
 * read as numbers (then no flag is set from it).
 */
export function parseRange(range: string): { low?: number; high?: number } | null {
  const text = range.trim().replace(/,/g, '.')
  const between = /^(-?\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(-?\d+(?:\.\d+)?)/i.exec(text)
  if (between) return { low: Number(between[1]), high: Number(between[2]) }
  const below = /^(?:<|≤|<=)\s*(-?\d+(?:\.\d+)?)/.exec(text)
  if (below) return { high: Number(below[1]) }
  const above = /^(?:>|≥|>=)\s*(-?\d+(?:\.\d+)?)/.exec(text)
  if (above) return { low: Number(above[1]) }
  return null
}

/** The flag a number earns against its reference range, or null when either is missing or unreadable. */
export function flagFromRange(value: string, range: string): LabAbnormalFlag | null {
  const number = value.trim() === '' ? NaN : Number(value)
  const bounds = parseRange(range)
  if (!Number.isFinite(number) || !bounds) return null
  if (bounds.low !== undefined && number < bounds.low) return 'low'
  if (bounds.high !== undefined && number > bounds.high) return 'high'
  return 'normal'
}

export const ABNORMAL_FLAGS: readonly LabAbnormalFlag[] = ['unknown', 'normal', 'high', 'low', 'abnormal', 'critical_candidate']

/** Each flag in plain words. */
export const FLAG_WORDS: Readonly<Record<LabAbnormalFlag, string>> = {
  unknown: 'Not set', normal: 'Normal', high: 'High', low: 'Low', abnormal: 'Abnormal', critical_candidate: 'Possibly critical',
}

/** A Lab flag as the shared Flag part draws it; null for normal and not set (nothing to call out). */
export function flagLevel(flag: LabAbnormalFlag): FlagLevel | null {
  switch (flag) {
    case 'high': return 'high'
    case 'low': return 'low'
    case 'abnormal': return 'abnormal'
    case 'critical_candidate': return 'critical'
    default: return null
  }
}

/** A revision's value as typed: a number, or the text. */
export function revisionText(revision: LabResultRevision): string {
  return revision.resultType === 'numeric' ? String(revision.numericValue ?? '') : revision.textValue ?? ''
}

export type LabResultsHiddenReason = 'denied' | 'unverified' | 'signedOut'

/**
 * Whether an error leaves read access to these results in doubt. A refusal, or a record that is no longer visible, means
 * access ended. No answer at all (outage, network failure, timeout, server error) means it could not be confirmed, and an
 * ended session (401, after the client's own refresh failed) means the person must sign in again. A request answered on
 * its merits (400, 409, 412, 422, 429) means none of these.
 */
export function labResultsReadDoubt(error: unknown): LabResultsHiddenReason | null {
  if (!isHidApiError(error)) return 'unverified'
  if (error.status === 403 || error.status === 404) return 'denied'
  if (error.status === 401) return 'signedOut'
  if (error.status === 0 || error.status === 408 || error.status >= 500) return 'unverified'
  return null
}

export const LAB_RESULTS_HIDDEN: Record<LabResultsHiddenReason, string> = {
  denied: 'You can’t see lab results for this patient right now. They stay hidden until your access is back.',
  unverified: 'Lab results are hidden because access to them could not be checked right now. Refresh to check again.',
  signedOut: 'Lab results are hidden because your session has ended. Sign in again to view them.',
}

/** "hid-ada 2345", "HIDADA2345" → "HID-ADA2345" (Postel: take it messy, send it clean). */
export function normalizeHealthId(text: string): string {
  const compact = text.toUpperCase().replace(/[\s_-]+/g, '')
  return compact.startsWith('HID') ? `HID-${compact.slice(3)}` : compact
}

/** A Nigerian phone number with or without +234, as digits with its country code: "0803 123 4567" → "+2348031234567". */
export function normalizePhone(text: string): string {
  const digits = text.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) return digits
  if (digits.startsWith('234')) return `+${digits}`
  if (digits.startsWith('0')) return `+234${digits.slice(1)}`
  return digits
}

/** A date and time for a label or slip: "31 Oct 2026, 14:05". */
export function stampText(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : new Date()
  if (Number.isNaN(date.getTime())) return iso ?? ''
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

/*
 * The classic Laboratory page's words for each step on a request (staff/routes/Operations.tsx AccessionForm,
 * SpecimenAction, ExecutionCard, ExecutionPanel, ResultEntry and ResultGovernance), word for word: the blue steps send the
 * same requests and say the same thing when they are done or refused (parity rows 10, 12, 12a, 3.3-67, 3.3-68). Only the
 * word classic used for a result not yet verified is said as "not yet verified" (house rule: never that word on screen).
 */

/** Registering the sample (classic: create a specimen accession). The reason starts empty, as on classic. */
export const ACCESSION_WORDS = {
  type: 'Specimen type',
  reason: 'Reason',
  missing: 'Enter a specimen type and clinical reason.',
  button: 'Create accession',
  failed: 'Accession could not be created.',
} as const

/** What classic says once an accession is created. */
export function accessionCreatedText(accessionNumber: string): string {
  return `Accession ${accessionNumber} created.`
}

/** A specimen's custody steps (classic SpecimenAction): collect or receive it, or reject it, before or after collection. */
export const SPECIMEN_WORDS = {
  collect: 'Mark collected',
  receive: 'Mark received',
  reject: 'Reject specimen',
  notes: 'Notes or condition',
  rejectReason: 'Rejection reason',
  rejectMissing: 'Enter a rejection reason.',
  collected: 'Specimen marked collected.',
  received: 'Specimen marked received.',
  rejected: 'Specimen rejected.',
  failed: 'Specimen could not be updated. Refresh and try again.',
} as const

/** Starting and finishing a test (classic: an analytical execution). */
export const EXECUTION_WORDS = {
  started: 'Analytical execution started.',
  startFailed: 'Execution could not be started. Refresh the specimen first.',
  completed: 'Analytical execution was completed.',
  completeFailed: 'Execution could not be completed. Refresh before retrying.',
} as const

/** Entering or correcting a result. */
export const RESULT_WORDS = {
  entered: 'A result was recorded, not yet verified.',
  corrected: 'A new result revision was recorded, not yet verified.',
  failed: 'Result could not be recorded. Refresh before retrying.',
  /** The save step's button and its confirm (classic's "Record unverified result" and "Record new revision", parity 3.3-68). */
  record: 'Record result, not yet verified',
  correct: 'Record new revision',
} as const

/** Verifying or releasing a result (classic ResultGovernance). */
export const DECISION_WORDS = {
  failed: 'Decision could not be recorded. Refresh before retrying.',
  verified: 'This exact result version was verified.',
  released: 'This exact verified result version was released.',
} as const
