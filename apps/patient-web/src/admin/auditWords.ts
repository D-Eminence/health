import { AUDIT_ACTION_LABELS } from '../audit/actionLabels'
import { auditAreaName, auditRow, auditWho } from '../audit/auditRow'
import type { AuditEvent } from './api'

/**
 * A platform audit event as the support console shows it: who did what and the result, in the words the facility audit
 * pages use (audit/auditRow.ts). The action code, the route, the actor's ID, the item's ID and the request reference
 * are never shown; the filters still send them to the backend.
 */
export interface AdminAuditRow {
  readonly what: string
  readonly who: string
  /** The outcome the row stands for, for its colour; 'unknown' when Health ID does not write it. */
  readonly outcome: 'success' | 'denied' | 'failure' | 'unknown'
  readonly outcomeText: string
}

const OUTCOME_TEXT = { success: 'Allowed', denied: 'Refused', failure: 'Failed' } as const
type Outcome = keyof typeof OUTCOME_TEXT
const isOutcome = (value: string): value is Outcome => Object.hasOwn(OUTCOME_TEXT, value)

/** The request log ('api.' and the route or name of the request): a request reached Health ID, nothing more is said. */
const REQUEST = 'A request to Health ID'

export function adminAuditRow(event: Pick<AuditEvent, 'action' | 'outcome' | 'actorType' | 'resourceType'>): AdminAuditRow {
  const stored = isOutcome(event.outcome) ? event.outcome : null
  const row = auditRow({ action: event.action, outcome: (stored ?? 'unknown') as Outcome, actorType: event.actorType ?? '',
    resourceType: event.resourceType })
  if (!row) {
    // The request log, which the facility pages never show: the who still comes from the actor type.
    return { what: REQUEST, who: auditWho(event.actorType ?? ''), outcome: stored ?? 'unknown', outcomeText: stored ? OUTCOME_TEXT[stored] : 'Result not recorded' }
  }
  return { what: row.what, who: row.who, outcome: row.outcome ?? 'unknown',
    outcomeText: row.outcome ? OUTCOME_TEXT[row.outcome] : 'Result not recorded' }
}

/** Why it was done, in words (the backend's purposes of use); one not known is never shown as stored. */
const PURPOSES: Readonly<Record<string, string>> = {
  'direct-care': 'caring for a patient',
  'healthcare-operations': 'running a facility or Health ID',
  'patient-self': 'the patient\'s own use',
  'account-self': 'their own account',
  emergency: 'an emergency',
}

export function purposeText(purpose: string | null): string | null {
  if (!purpose) return null
  return Object.hasOwn(PURPOSES, purpose) ? PURPOSES[purpose] ?? null : 'another purpose'
}

export const OUTCOME_CHOICES: ReadonlyArray<{ value: Outcome; text: string }> =
  (Object.keys(OUTCOME_TEXT) as Outcome[]).map(value => ({ value, text: OUTCOME_TEXT[value] }))

export interface ActionChoice { readonly code: string; readonly text: string }
export interface ActionGroup { readonly area: string; readonly choices: readonly ActionChoice[] }

/**
 * Words that tell apart two listed actions whose rows read the same, added only to their filter options (never to the
 * rows), so each code keeps its own option: the backend filters the action by exact match. Each is said from where
 * Health ID writes the code (hid-system services' security guards).
 */
const TELL_APART: Readonly<Record<string, string>> = {
  // Identity's guard: a signed-in person at a facility, refused an account, facility or staff request.
  'security.authorization': 'accounts, facilities and staff',
  // The health record and document reading guards, and Identity's guard for a request with no one signed in.
  'security.authorization.denied': 'health records, scanned documents, or not signed in',
}
const ORDINALS = ['second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth']

/**
 * Every listed action as a choice in words, grouped by area and sorted, for the What happened filter; the code is only
 * the option's value. Every listed code keeps its own option. When codes read the same, each option says what tells
 * them apart in brackets (TELL_APART), or, for a pair no one has worded yet, "(second kind)", "(third kind)" and so on,
 * so no two options read alike and none shows a code.
 */
export const ACTION_GROUPS: readonly ActionGroup[] = (() => {
  const codes = Object.keys(AUDIT_ACTION_LABELS)
  const words = new Map(codes.map(code =>
    [code, adminAuditRow({ action: code, outcome: 'success', actorType: 'staff', resourceType: null }).what]))
  const sharing = new Map<string, string[]>()
  for (const code of codes) sharing.set(words.get(code) ?? '', [...(sharing.get(words.get(code) ?? '') ?? []), code])
  const used = new Set<string>()
  const groups = new Map<string, ActionChoice[]>()
  for (const code of codes) {
    const plain = words.get(code) ?? ''
    const same = sharing.get(plain) ?? [code]
    let text = plain
    if (same.length > 1) {
      const apart = Object.hasOwn(TELL_APART, code) ? TELL_APART[code] : undefined
      text = apart ? `${plain} (${apart})` : same.indexOf(code) === 0 ? plain : `${plain} (${ORDINALS[same.indexOf(code) - 1] ?? 'another'} kind)`
    }
    for (let n = 2; used.has(text); n += 1) text = `${plain} (kind ${n})`
    used.add(text)
    const area = auditAreaName(code)
    groups.set(area, [...(groups.get(area) ?? []), { code, text }])
  }
  return [...groups].map(([area, choices]) => ({ area, choices: [...choices].sort((a, b) => a.text.localeCompare(b.text)) }))
    .sort((a, b) => a.area.localeCompare(b.area))
})()

const OPTION_CODES: ReadonlySet<string> = new Set(ACTION_GROUPS.flatMap(group => group.choices.map(choice => choice.code)))

/** Whether the What happened filter has an option for this code; a link's code without one is said as "The action from your link". */
export const hasActionOption = (code: string) => OPTION_CODES.has(code)
