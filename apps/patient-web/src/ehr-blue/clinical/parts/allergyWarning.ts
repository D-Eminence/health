import { isHidApiError } from '@hid/http'
import { useState } from 'react'
import {
  ACK_REASON, ACK_REASON_LIMIT, ACK_REASON_MIN, ALLERGY_ACKNOWLEDGEMENT_REASON_INVALID, ALLERGY_ACKNOWLEDGEMENT_REASON_MISSING,
  ALLERGY_ACKNOWLEDGEMENT_REQUIRED, ALLERGY_NOT_A_SUBSTANCE, ALLERGY_WARNING_TOKEN_INVALID, ALLERGY_WARNING_TOKEN_STALE,
  refusalRejections, refusalWarningToken, warningMessages, type AllergyAcknowledgement, type AllergyCheck, type AllergyMatch, type AllergyMatchKind, type AllergySeverity,
} from '../../../staff/allergies'

/**
 * The allergy warning at prescribing (hid-system 0124, #218 at 7fbb04aa), as the blue EHR shows it and the prescriber
 * acknowledges it: on a new prescription, on Activate and Resume, and on sending a draft to another pharmacy.
 *
 * - A warning comes from the allergy check (with every line's severity, reaction and how it matched) or from the save's
 *   409 ALLERGY_ACKNOWLEDGEMENT_REQUIRED (the EHR's sentences and the token only). Its token names exactly that warning.
 *   The 409 also names, by code, which part of a sent acknowledgement was refused (an EHR at 76283f57 does not).
 * - The acknowledgement ({ reason, warningToken }) is sent only after a warning was shown and ticked: an EHR before 0124
 *   refuses the property.
 * - Any edit to the medicine drops the warning, the tick and the token; the medicine is then checked afresh.
 * Pure helpers and one state hook; nothing here reads or writes the network or the browser's storage.
 */

/** The medicine a warning was given for, as sent to the check and the save. */
export interface WarnedMedicine {
  readonly display: string
  /** Sent only when the form has a code; the same to the check as to the save. */
  readonly code?: string
}

/** One line of a shown warning: the EHR's sentence, whole, and the check's structured line when known. */
export interface AllergyWarningLine {
  /** A stable React key: the recorded allergy ids when known, else where the line stands. */
  readonly key: string
  readonly message: string
  /** The check's line (severity, reaction, matchKind, recordedHere, recordedOn, allergyIds); null from a 409 alone. */
  readonly match: AllergyMatch | null
}

/** A warning on screen: what the prescriber reads, ticks and gives a reason for. */
export interface ShownAllergyWarning {
  readonly medicine: WarnedMedicine
  /** The most serious first (severe, not known, moderate, mild, then the patient's own words); a grouped line is one line. */
  readonly lines: readonly AllergyWarningLine[]
  /** The token the acknowledgement carries: the newest received for this warning. Never shown. */
  readonly warningToken: string
  /** The EHR refused an acknowledgement because the warning changed since it was shown. */
  readonly changedSinceShown: boolean
}

/** What a 409 ALLERGY_ACKNOWLEDGEMENT_REQUIRED says. */
export interface AllergyRefusal {
  /** One sentence per match, in the EHR's order (at least one). */
  readonly messages: readonly string[]
  /** The current warning's token; null when the refusal carried none that is 64 lower-case hex. */
  readonly warningToken: string | null
  /**
   * The warning changed since it was shown: the EHR names its token stale (7fbb04aa). From an EHR that names no refused
   * part (76283f57), true when the refused request carried an acknowledgement.
   */
  readonly changedSinceShown: boolean
  /** The reason alone was refused, blank ('missing') or against the rule ('invalid'); its token was not (7fbb04aa). */
  readonly reasonRefused?: 'missing' | 'invalid'
  /** The token sent named no warning (7fbb04aa): the tick, given for it, goes; the reason stays. */
  readonly tokenRefused?: true
}

/** The prescriber's two answers, each with its own error. */
export interface AcknowledgementErrors {
  readonly tick?: string
  readonly reason?: string
}

// ---------------------------------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------------------------------

/** The panel's title for a warning with a severe line (see isSevereLine: severe, not known, or a serious reaction), else today's title. */
export const SEVERE_ALLERGY_WARNING = 'Severe allergy warning'
export const ALLERGY_WARNING = 'Allergy warning'
/** The form's error while a warning waits for the tick and the reason (the panel says which is missing). */
export const ALLERGY_GO_AHEAD_ERROR = 'This medicine may match one of the patient’s allergies. Read the allergy warning, then tick the box and give your reason to go ahead.'
/** A 409 whose warning could not be read (no token in it, and the check after it failed): nothing can be acknowledged. */
export const ALLERGY_WARNING_UNREAD = 'This medicine may match one of the patient’s allergies, but the warning could not be loaded. Try again.'
/** Said in the panel when the EHR refused a reason because the warning changed since it was shown (Ola, wording #7). */
export const ALLERGY_WARNING_CHANGED = 'The patient’s allergies changed since the warning. Read the new warning before you go ahead.'
export const ACK_REASON_LABEL = 'Why is it safe to go ahead?'
export const ACK_REASON_HINT = 'For example: “Has taken amoxicillin since 2024 with no reaction”, “Reaction was stomach upset, not an allergy”, '
  + '“No alternative; first dose under observation with adrenaline ready”.'
/** Too short, or left empty. */
export const ACK_REASON_SHORT = `Give your reason for going ahead in at least ${ACK_REASON_MIN} characters.`
export const ACK_REASON_LONG = `Keep your reason to ${ACK_REASON_LIMIT} characters or fewer.`
/** Ten characters with no word in them ("1234567890", "ok ok ok ok"): the EHR asks for a real word. */
export const ACK_REASON_NO_WORD = 'Write your reason in words: at least one word of three letters or more.'
/** A control character the text box let through (only possible when the reason was not normalised first). */
export const ACK_REASON_HIDDEN = 'Remove tabs and other hidden characters from your reason.'
/**
 * The EHR did not accept the reason: 409 ALLERGY_ACKNOWLEDGEMENT_REASON_INVALID (7fbb04aa), or a 400 on
 * allergyAcknowledgement from an older EHR, which does not say which part, so the page says this.
 */
export const ACK_NOT_ACCEPTED = `Your reason was not accepted. Write it in words, ${ACK_REASON_MIN} to ${ACK_REASON_LIMIT} characters, and try again.`
/**
 * On the prescribing form only, under the patient's allergies, warning or not (Ola, wording #10). Not on triage or a new
 * consultation, where nothing is checked.
 */
export const NO_WARNING_NOT_SAFE = 'The EHR checks the medicine name against these allergies. No warning does not mean a medicine is safe: always ask the patient.'
/**
 * 400 ALLERGY_NOT_A_SUBSTANCE, and the add form's own check before it sends (Ola, bypass #9). No clinician field for "no
 * known allergies" exists: the patient's own Allergies field in their Health ID portal is the one that says so, shown on
 * the chart under "Reported by the patient".
 */
export const NOT_A_SUBSTANCE = 'Record the medicine or substance the patient reacts to. “No known allergies” is not recorded as an allergy. '
  + 'If the patient has no known allergies, leave this list empty. The patient can say so in the Allergies field of their '
  + 'Health ID portal, shown here under “Reported by the patient”.'

/** "Ask the patient about this allergy before you go ahead." (Ola, wording #10), for one line or several. */
export function askThePatient(lines: number): string {
  return `Ask the patient about ${lines === 1 ? 'this allergy' : 'these allergies'} before you go ahead.`
}

/** The tick's label (Ola, wording #4). */
export function tickLabel(medicine: string, lines: number): string {
  return `I have checked ${lines === 1 ? 'this allergy' : 'these allergies'} with the patient and want to go ahead with ${medicine}.`
}

/** The tick's error (Ola, wording #4). */
export function tickError(lines: number): string {
  return `Tick the box to confirm you have checked ${lines === 1 ? 'this allergy' : 'these allergies'} with the patient.`
}

// ---------------------------------------------------------------------------------------------------------------------
// The medicine
// ---------------------------------------------------------------------------------------------------------------------

/** The same medicine, as typed: any edit of the text or the code (beyond spaces round it) is another medicine. */
export function sameMedicine(a: WarnedMedicine, b: WarnedMedicine): boolean {
  return a.display.trim() === b.display.trim() && (a.code ?? '').trim() === (b.code ?? '').trim()
}

/** The allergy check's body for a medicine: the code only when there is one (never "" or null). */
export function allergyCheckInput(medicine: WarnedMedicine): { medicationDisplay: string; medicationCode?: string } {
  const code = medicine.code?.trim()
  return { medicationDisplay: medicine.display.trim(), ...(code ? { medicationCode: code } : {}) }
}

/** A save's body with the acknowledgement, only when there is one: never an empty, undefined or null member. */
export function withAllergyAcknowledgement<T extends object>(body: T, acknowledgement: AllergyAcknowledgement | null | undefined): T | (T & { allergyAcknowledgement: AllergyAcknowledgement }) {
  if (!acknowledgement) return body
  return { ...body, allergyAcknowledgement: { reason: acknowledgement.reason, warningToken: acknowledgement.warningToken } }
}

// ---------------------------------------------------------------------------------------------------------------------
// Lines and their order
// ---------------------------------------------------------------------------------------------------------------------

/** As the EHR orders its allergy list: severe, not known, moderate, mild; then what the patient wrote. */
const SEVERITY_RANK: Readonly<Record<AllergySeverity, number>> = { severe: 0, unknown: 1, moderate: 2, mild: 3 }
const KIND_RANK: Readonly<Record<AllergyMatchKind, number>> = { same_medicine: 0, same_class: 1, cross_reactivity: 2 }

/**
 * A reaction that is serious whatever severity was chosen (Ola, wording #0): anaphylaxis, angioedema, swelling of the
 * face, lips, tongue or throat, difficulty breathing, Stevens-Johnson syndrome, toxic epidermal necrolysis.
 */
export const SERIOUS_REACTION = /anaphyla|angio-?o?edema|swelling of (the )?(face|lips|tongue|throat)|difficult(y)? breathing|stevens|epidermal necrolysis/i

function rank(match: AllergyMatch): number {
  return match.source === 'patient_reported' || !match.severity ? 4 : SEVERITY_RANK[match.severity]
}

/** The check's lines as shown: the most serious first (the EHR does not order them), then same medicine, class, cross. */
export function warningLines(matches: readonly AllergyMatch[]): AllergyWarningLine[] {
  return matches
    .map((match, index) => ({ match, index }))
    .sort((a, b) => rank(a.match) - rank(b.match) || KIND_RANK[a.match.matchKind] - KIND_RANK[b.match.matchKind] || a.index - b.index)
    .map(({ match, index }) => ({
      key: match.allergyIds && match.allergyIds.length > 0 ? `recorded:${match.allergyIds.join(',')}` : `${match.source}:${index}`,
      message: match.message, match,
    }))
}

/** A 409's sentences as lines, in the EHR's order (it gives nothing to order them by). */
export function messageLines(messages: readonly string[]): AllergyWarningLine[] {
  return messages.map((message, index) => ({ key: `message:${index}`, message, match: null }))
}

/**
 * The EHR's head of a recorded line: "Penicillin allergy: SEVERE (Anaphylaxis)." (the severity's word, then the reaction).
 * Not known reads "severity not known" (#218 at 7fbb04aa), and "severity not recorded" on a backend at 76283f57.
 */
const RECORDED_HEAD = / allergy: (SEVERE|moderate|mild|severity not known|severity not recorded)(?: \((.*?)\))?\.(?: |$)/
/** The EHR's head of a patient-reported line: "Patient-reported allergy: “Penicillin (anaphylaxis)”." */
const PATIENT_HEAD = /^Patient-reported allergy: “(.*?)”\.(?: |$)/

/**
 * A line the title calls severe (Ola, wording #0): a recorded allergy whose severity is severe or not known (a reaction
 * nobody graded may have been severe), or whose reaction is serious (SERIOUS_REACTION); a patient-reported term that
 * names a serious reaction ("Penicillin (anaphylaxis)"). A 409 line alone has only the EHR's sentence: its head says the
 * same things ("… allergy: SEVERE (Anaphylaxis).", "… allergy: severity not known.", "Patient-reported allergy: “…”."),
 * so a line gets the same title from the check or from the 409.
 */
export function isSevereLine(line: AllergyWarningLine): boolean {
  if (line.match) {
    if (line.match.source === 'patient_reported') return SERIOUS_REACTION.test(line.match.substance)
    return line.match.severity === 'severe' || line.match.severity === 'unknown' || SERIOUS_REACTION.test(line.match.reaction ?? '')
  }
  if (line.message.startsWith('Patient-reported allergy:')) return SERIOUS_REACTION.test(PATIENT_HEAD.exec(line.message)?.[1] ?? '')
  const head = RECORDED_HEAD.exec(line.message)
  if (!head) return false
  return head[1] === 'SEVERE' || head[1] === 'severity not known' || head[1] === 'severity not recorded' || SERIOUS_REACTION.test(head[2] ?? '')
}

/** "Severe allergy warning for Amoxicillin 500 mg capsules" or "Allergy warning for …". */
export function allergyWarningTitle(warning: ShownAllergyWarning): string {
  return `${warning.lines.some(isSevereLine) ? SEVERE_ALLERGY_WARNING : ALLERGY_WARNING} for ${warning.medicine.display.trim()}`
}

// ---------------------------------------------------------------------------------------------------------------------
// Where a warning comes from
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The warning a check answers, or null when it needs no acknowledgement (no match). Gated on acknowledgementRequired,
 * never on the token (every answer has one).
 */
export function warningFromCheck(check: AllergyCheck, medicine: WarnedMedicine, changedSinceShown = false): ShownAllergyWarning | null {
  if (!check.acknowledgementRequired || check.matches.length === 0) return null
  return { medicine, lines: warningLines(check.matches), warningToken: check.warningToken, changedSinceShown }
}

/**
 * A refused save, Activate, Resume or send read as the allergy 409; null for any other refusal. The detail is never
 * read or shown.
 *
 * At 7fbb04aa the 409 names each refused part by its code (allergyAcknowledgement.rejected): TOKEN_STALE is "changed
 * since it was shown"; REASON_MISSING or REASON_INVALID, the reason alone; TOKEN_INVALID, the token alone; MISSING, the
 * first warning. A reason and a token can be refused together: each is said. An EHR at 76283f57 names none, and refused
 * a sent acknowledgement with this 409 only when its token was not the current warning's (a reason it refused was a
 * 400): there `sentAcknowledgement`, whether the refused request carried allergyAcknowledgement, says "changed".
 */
export function readAllergyRefusal(caught: unknown, sentAcknowledgement: boolean): AllergyRefusal | null {
  if (!isHidApiError(caught) || caught.status !== 409 || caught.code !== ALLERGY_ACKNOWLEDGEMENT_REQUIRED) return null
  const said = { messages: warningMessages(caught.details), warningToken: refusalWarningToken(caught.details) }
  const rejected = refusalRejections(caught.details)
  if (!rejected) return { ...said, changedSinceShown: sentAcknowledgement }
  const reasonRefused = rejected.includes(ALLERGY_ACKNOWLEDGEMENT_REASON_MISSING) ? 'missing'
    : rejected.includes(ALLERGY_ACKNOWLEDGEMENT_REASON_INVALID) ? 'invalid' : null
  return {
    ...said, changedSinceShown: rejected.includes(ALLERGY_WARNING_TOKEN_STALE),
    ...(reasonRefused ? { reasonRefused } : {}),
    ...(rejected.includes(ALLERGY_WARNING_TOKEN_INVALID) ? { tokenRefused: true as const } : {}),
  }
}

const FALLBACK_LINE = 'This medicine may match one of the patient’s allergies.'

/**
 * The warning to show after a 409. `check` is the allergy check run right after it for the same medicine (the stored
 * medicationDisplay and medicationCode on Activate, Resume and send), or null when it failed or was not run: its lines
 * carry severity, reaction and how each matched, and its token is the newest. Without it, the 409's own sentences and
 * token. Null when there is no token to acknowledge with: say the warning could not be read, and send nothing.
 */
export function warningFromRefusal(refusal: AllergyRefusal, medicine: WarnedMedicine, check: AllergyCheck | null): ShownAllergyWarning | null {
  const checked = check ? warningFromCheck(check, medicine, refusal.changedSinceShown) : null
  if (checked) return checked
  if (!refusal.warningToken) return null
  return {
    medicine, lines: messageLines(refusal.messages.length > 0 ? refusal.messages : [FALLBACK_LINE]),
    warningToken: refusal.warningToken, changedSinceShown: refusal.changedSinceShown,
  }
}

/**
 * 400 VALIDATION_FAILED on allergyAcknowledgement: the EHR did not accept the reason or the token (it does not say
 * which). An EHR at 76283f57 checked both rules so; at 7fbb04aa their rules answer the 409 with a code, and a 400 is left
 * for a body this page never sends (a reason that is not text or over 2000 characters, an extra member).
 */
export function acknowledgementRefused(caught: unknown): boolean {
  return isHidApiError(caught) && caught.status === 400 && caught.code === 'VALIDATION_FAILED' && Array.isArray(caught.details)
    && caught.details.some(entry => typeof entry === 'object' && entry !== null && (entry as { field?: unknown }).field === 'allergyAcknowledgement')
}

/** 400 ALLERGY_NOT_A_SUBSTANCE: "NKDA", "No known allergies" and the like recorded as an allergy. Show NOT_A_SUBSTANCE. */
export function isNotASubstanceRefusal(caught: unknown): boolean {
  return isHidApiError(caught) && caught.status === 400 && caught.code === ALLERGY_NOT_A_SUBSTANCE
}

// ---------------------------------------------------------------------------------------------------------------------
// The reason
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The reason as it is sent: Windows and old Mac line ends made new lines, tabs made spaces, other hidden control
 * characters dropped (the EHR allows none but new lines), then trimmed as the EHR trims it.
 */
export function normaliseAcknowledgementReason(raw: string): string {
  // eslint-disable-next-line no-control-regex -- the characters dropped are the control characters themselves
  return raw.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim()
}

/** The length the EHR's Length(10, 500) counts (validator's isLength): a character with its presentation selector, or a surrogate pair, is one. */
function validatorLength(text: string): number {
  return text.length - (text.match(/[^️︎][️︎]/g)?.length ?? 0) - (text.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)?.length ?? 0)
}

/**
 * What is wrong with a reason (already trimmed), by the EHR's own rule: 10-500 characters, three letters in a row, no
 * control character but a new line. Null when the EHR accepts it. The 500 is also counted as the database counts it
 * (code points), so a reason passes only if both would.
 */
export function acknowledgementReasonProblem(reason: string): string | null {
  if (validatorLength(reason) < ACK_REASON_MIN) return ACK_REASON_SHORT
  if (validatorLength(reason) > ACK_REASON_LIMIT || [...reason].length > ACK_REASON_LIMIT) return ACK_REASON_LONG
  if (ACK_REASON.test(reason)) return null
  // eslint-disable-next-line no-control-regex -- as in ACK_REASON
  return /[\u0000-\u0009\u000b-\u001f\u007f]/.test(reason) ? ACK_REASON_HIDDEN : ACK_REASON_NO_WORD
}

/**
 * The prescriber's answers checked before anything is sent: the tick and the reason, each with its own error (the EHR
 * says nothing useful when it refuses one, so the page must). `reason` is the text as sent.
 */
export function checkAcknowledgement({ ticked, reason: raw, lines }: { ticked: boolean; reason: string; lines: number }): { reason: string; errors: AcknowledgementErrors } {
  const reason = normaliseAcknowledgementReason(raw)
  const reasonError = acknowledgementReasonProblem(reason)
  return { reason, errors: { ...(ticked ? {} : { tick: tickError(lines) }), ...(reasonError ? { reason: reasonError } : {}) } }
}

// ---------------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------------

/** Which of the prescriber's answers takes focus next (the first one refused), and how many times it was asked. */
export interface AcknowledgementFocus {
  readonly target: 'tick' | 'reason'
  readonly seq: number
}

/**
 * The warning a form shows and what the prescriber answered. The tick belongs to the token it was given for: a new
 * warning (another token) is unticked however it arrives. The reason is dropped with the warning when the medicine
 * changes, and when the EHR says the warning changed since it was shown (a "changed" 409): it was written for another
 * warning (Ola, bypass #3). An answer refused, at the form or by the EHR, takes focus (`focus`), so its own error is read.
 */
export function useAllergyAcknowledgement() {
  const [warning, setWarning] = useState<ShownAllergyWarning | null>(null)
  const [tickedFor, setTickedFor] = useState<string | null>(null)
  const [reason, setReasonText] = useState('')
  const [errors, setErrors] = useState<AcknowledgementErrors>({})
  const [focus, setFocus] = useState<AcknowledgementFocus | null>(null)
  const ticked = warning !== null && tickedFor === warning.warningToken
  const focusOn = (target: AcknowledgementFocus['target']) => setFocus(current => ({ target, seq: (current?.seq ?? 0) + 1 }))

  const clear = () => {
    setWarning(null)
    setTickedFor(null)
    setReasonText('')
    setErrors({})
    setFocus(null)
  }

  return {
    warning,
    ticked,
    reason,
    errors,
    /** The answer to move focus to, for the panel (AllergyWarningPanel's `focus`). */
    focus,
    /** Show a warning (from the check or a 409); a new token leaves the box unticked, and a changed warning empties the reason. */
    show(next: ShownAllergyWarning) {
      setWarning(next)
      setErrors({})
      if (next.changedSinceShown) setReasonText('')
    },
    /** Drop the warning, the tick, the reason and the token (the medicine changed, or the save went through). */
    clear,
    /** Call on every edit of the medicine: a warning for another medicine goes at once, before anything is saved. */
    medicineChanged(medicine: WarnedMedicine) {
      if (warning && !sameMedicine(warning.medicine, medicine)) clear()
    },
    setTicked(value: boolean) {
      setTickedFor(value && warning ? warning.warningToken : null)
      setErrors(({ tick: _tick, ...rest }) => rest)
    },
    setReason(value: string) {
      setReasonText(value)
      setErrors(({ reason: _reason, ...rest }) => rest)
    },
    /**
     * Marks the reason as refused by the EHR (409 REASON_MISSING or REASON_INVALID; a 400 on allergyAcknowledgement from
     * an older EHR), and moves focus to it. The warning, the tick and the reason as written stay.
     */
    refuseReason(message: string = ACK_NOT_ACCEPTED) {
      setErrors(current => ({ ...current, reason: message }))
      focusOn('reason')
    },
    /**
     * The acknowledgement to send for the warning shown, or null (nothing to send: the errors now say why, and focus
     * moves to the first answer refused, the tick before the reason). Call it only when a warning is shown; with none,
     * there is nothing to acknowledge and it answers null.
     */
    acknowledgement(): AllergyAcknowledgement | null {
      if (!warning) return null
      const checked = checkAcknowledgement({ ticked, reason, lines: warning.lines.length })
      setErrors(checked.errors)
      if (checked.errors.tick || checked.errors.reason) {
        focusOn(checked.errors.tick ? 'tick' : 'reason')
        return null
      }
      return { reason: checked.reason, warningToken: warning.warningToken }
    },
  }
}

export type AllergyAcknowledgementState = ReturnType<typeof useAllergyAcknowledgement>
