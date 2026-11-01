import { AUDIT_ACTION_LABELS, LEGACY_ACTION_LABELS, LEGACY_ACTIVITY } from './actionLabels'

/**
 * One facility audit event as the audit pages show it (docs/AUDIT_ACTION_LABELS.md; owner rule of 1 Nov 2026): what was
 * done, who did it, and whether it was Allowed, Refused or Failed, in plain words. The blue Audit & Compliance page and the
 * classic facility audit page both use it, so they say the same thing. The action code, the resource type and the actor
 * type as stored are never part of what is shown: a code can still be searched for (matchesAuditSearch), off the line.
 */

/** The fields of an event this needs: what the facility audit read keeps (staff/api.ts facilityAuditPageFrom). */
export interface AuditEventFacts {
  readonly action: string
  readonly outcome: 'success' | 'denied' | 'failure'
  readonly actorType: string
  readonly resourceType: string | null
}

export interface AuditRow {
  /** What was done, in words. */
  readonly what: string
  /** Who did it, in words. */
  readonly who: string
  /** The outcome the row stands for (for the outcome filter), or null when the event's outcome is not one Health ID writes. */
  readonly outcome: AuditEventFacts['outcome'] | null
  /** The outcome in words, as the owner asked. */
  readonly outcomeText: 'Allowed' | 'Refused' | 'Failed' | 'Outcome not recorded'
}

const OUTCOME_TEXT = { success: 'Allowed', denied: 'Refused', failure: 'Failed' } as const

/** The spec's actor words ("ACTOR COLUMN"). An actor type it has none for is never shown as stored. */
const WHO: Readonly<Record<string, string>> = {
  staff: 'Staff member',
  patient: 'Patient',
  system: 'Health ID (automatic)',
  workload: 'Health ID background service',
  platform: 'Health ID support',
  legacy: 'Previous Health ID system',
}
const SOMEONE = 'Someone'

/**
 * Labels that already say their outcome, so a refused or failed row keeps them as written (the spec's "No prefix" list,
 * with its *.email.failed, *.email.retry-scheduled and *.notification.failed codes, and four more labels that say it
 * themselves, which the owner added on 1 Nov 2026), and the outcome each one says. A row stored as a success takes the
 * label's outcome: ocr.publication.fail is written as a success, and "Scanned document could not be added" beside
 * Allowed would contradict itself (and the Failed filter would miss it).
 */
const STATES_ITS_OUTCOME: ReadonlyMap<string, 'denied' | 'failure'> = new Map([
  ['auth.authorization.denied', 'denied'], ['security.authorization', 'denied'], ['security.authorization.denied', 'denied'],
  ['identity.nin.verify', 'denied'], ['identity.nin.protect', 'failure'], ['identity.patient-access-pin.verify-denied', 'denied'],
  ['identity.patient-access-pin.authorization-denied', 'denied'], ['identity.patient.contact-change.verify', 'denied'],
  ['identity.patient.contact-change.delivery', 'failure'], ['ehr.document.scan.rejected', 'failure'],
  ['ehr.document.scan.failed', 'failure'], ['ocr.worker.fail', 'failure'], ['ocr.worker.lease_recovered', 'failure'],
  ['ocr.publication.fail', 'failure'],
  ['ehr.order-route.not-completed', 'failure'], ['identity.emergency-contact.notification.intent-failed', 'failure'],
  ['identity.emergency-contact.verification-failed', 'failure'], ['identity.patient-account-deletion.confirmation-rejected', 'denied'],
])
const STATES_ITS_OUTCOME_ENDING = /\.(email\.failed|email\.retry-scheduled|notification\.failed)$/

function statedOutcome(code: string): 'denied' | 'failure' | undefined {
  return STATES_ITS_OUTCOME.get(code) ?? (STATES_ITS_OUTCOME_ENDING.test(code) ? 'failure' : undefined)
}

/** "Released facility's orders closed" leads with a base verb but says what happened to the orders, not what was done. */
const NOT_A_DOING_WORD = new Set(['admin.self-service-facility.release-order-routes'])

/**
 * The spec's base verbs: a refused or failed row says what was tried ("Tried to view a patient's visits"), since
 * "Viewed a patient's visits" beside "Refused" would say it happened. Two-word verbs first, so "Looked up" wins.
 */
const BASE_VERBS: ReadonlyArray<readonly [string, string]> = [
  ['Looked up', 'look up'], ['Set up', 'set up'],
  ['Viewed', 'view'], ['Opened', 'open'], ['Added', 'add'], ['Wrote', 'write'], ['Started', 'start'], ['Updated', 'update'],
  ['Changed', 'change'], ['Recorded', 'record'], ['Corrected', 'correct'], ['Sent', 'send'], ['Withdrew', 'withdraw'],
  ['Accepted', 'accept'], ['Declined', 'decline'], ['Downloaded', 'download'], ['Uploaded', 'upload'], ['Searched', 'search'],
  ['Checked', 'check'], ['Requested', 'request'], ['Registered', 'register'], ['Removed', 'remove'], ['Invited', 'invite'],
  ['Resent', 'resend'], ['Cancelled', 'cancel'], ['Released', 'release'], ['Verified', 'verify'], ['Entered', 'enter'],
  ['Approved', 'approve'], ['Rejected', 'reject'], ['Reported', 'report'], ['Marked', 'mark'], ['Matched', 'match'],
  ['Linked', 'link'], ['Dispensed', 'dispense'], ['Reversed', 'reverse'], ['Retried', 'retry'], ['Reused', 'reuse'],
  ['Confirmed', 'confirm'], ['Asked', 'ask'], ['Got', 'get'], ['Cleared', 'clear'], ['Signed', 'sign'], ['Switched', 'switch'],
  ['Repeated', 'repeat'], ['Created', 'create'], ['Completed', 'complete'],
]

/** "Viewed a patient's visits" as tried: "Tried to view a patient's visits"; null when the label leads with no such verb. */
function tried(label: string): string | null {
  const lead = BASE_VERBS.find(([past]) => label.startsWith(`${past} `))
  if (!lead) return null
  let rest = label.slice(lead[0].length)
  // "Signed or updated a clinical note": the second verb too.
  const or = BASE_VERBS.find(([past]) => rest.toLowerCase().startsWith(` or ${past.toLowerCase()} `))
  if (or) rest = ` or ${or[1]}${rest.slice(` or ${or[0]}`.length)}`
  return `Tried to ${lead[1]}${rest}`
}

/**
 * A refused or failed attempt in words (the spec's outcome rule): what was tried, or, for a label that does not lead with
 * a doing word, the label with "(refused)" or "(didn't go through)" after it, so the line never says it happened.
 */
function attempt(phrase: string, outcome: 'denied' | 'failure', doing = true): string {
  return (doing ? tried(phrase) : null) ?? `${phrase} ${outcome === 'denied' ? '(refused)' : '(didn\'t go through)'}`
}

/** A label's main words, and those that replace them for one outcome or one kind of record (' // if refused: …'). */
function labelParts(label: string) {
  const [main = '', ...variants] = label.split(' // if ')
  const parts = { main, refused: undefined as string | undefined, failed: undefined as string | undefined, resources: new Map<string, string>() }
  for (const variant of variants) {
    const resource = /^resource (\S+): (.+)$/.exec(variant)
    if (resource) parts.resources.set(resource[1] ?? '', resource[2] ?? '')
    else if (variant.startsWith('refused: ')) parts.refused = variant.slice('refused: '.length)
    else if (variant.startsWith('failed: ')) parts.failed = variant.slice('failed: '.length)
  }
  return parts
}

const own = (labels: Readonly<Record<string, string>>, code: string) => Object.hasOwn(labels, code) ? labels[code] : undefined

const capitalised = (text: string) => `${text.charAt(0).toLocaleUpperCase()}${text.slice(1)}`

/** What a listed code's row says, for its outcome and kind of record. */
function listedWhat(code: string, label: string, event: AuditEventFacts) {
  const parts = labelParts(label)
  let main = (event.resourceType !== null ? parts.resources.get(event.resourceType) : undefined) ?? parts.main
  // "Refused: their role here…": both pages show Refused beside the row, so the label does not say it again.
  if (main.startsWith('Refused: ')) main = capitalised(main.slice('Refused: '.length))
  if (event.outcome === 'denied' && parts.refused) return parts.refused
  if (event.outcome === 'failure' && parts.failed) return parts.failed
  if (event.outcome === 'success' || statedOutcome(code)) return main
  return attempt(main, event.outcome, !NOT_A_DOING_WORD.has(code))
}

/* The spec's fallback for a code it does not list ("CODES NOT IN THE TABLE", rule 3): never the code itself. */
const FALLBACK_VERBS: Readonly<Record<string, string>> = {
  list: 'Viewed the list of', read: 'Viewed', view: 'Viewed', search: 'Searched for', find: 'Searched for', lookup: 'Searched for',
  create: 'Added', created: 'Added', add: 'Added', added: 'Added', submit: 'Added', record: 'Added', received: 'Added',
  update: 'Changed', updated: 'Changed', change: 'Changed', changed: 'Changed', set: 'Changed', edit: 'Changed',
  delete: 'Removed', remove: 'Removed', removed: 'Removed', revoke: 'Removed', deactivate: 'Removed', end: 'Removed',
  accept: 'Accepted', accepted: 'Accepted', approve: 'Accepted', approved: 'Accepted',
  decline: 'Declined', declined: 'Declined', reject: 'Declined', rejected: 'Declined', deny: 'Declined',
  withdraw: 'Withdrew', withdrawn: 'Withdrew', cancel: 'Cancelled', cancelled: 'Cancelled',
  send: 'Sent', sent: 'Sent', delivery: 'Sent', delivered: 'Sent', download: 'Downloaded', upload: 'Uploaded',
  complete: 'Completed', completed: 'Completed', verify: 'Checked', check: 'Checked', start: 'Started',
  close: 'Closed', closed: 'Closed', open: 'Opened', save: 'Saved', clear: 'Cleared', issue: 'Issued', import: 'Imported',
  export: 'Exported', fail: 'Could not complete', failed: 'Could not complete',
}
const FALLBACK_THINGS: Readonly<Record<string, string>> = {
  encounter: 'visit', note: 'clinical note', vital: 'vital signs', 'lab-request': 'lab request',
  'order-route': 'order between facilities', 'work-item': 'work item', accession: 'lab sample', result: 'lab result',
  'registration-case': 'patient registration', 'consent-grant': 'access to a patient\'s record', 'access-request': 'access request',
  'break-glass': 'emergency access', 'patient-access-pin': 'patient PIN', 'staff-invitation': 'staff invitation',
  'facility-staff': 'staff member', 'emergency-contact': 'emergency contact', 'share-invitation': 'sharing invitation',
  campaign: 'outreach campaign', job: 'scanned-document reading', extraction: 'scanned-document reading',
  validation: 'scanned-document reading', publication: 'scanned-document reading',
}
const FALLBACK_AREAS: Readonly<Record<string, string>> = {
  ehr: 'Patient record', lab: 'Lab', pharmacy: 'Pharmacy', ocr: 'Scanned documents', outreach: 'Outreach',
  identity: 'Patient access and registration', auth: 'Sign-in', security: 'Access check', audit: 'Audit log',
  admin: 'Health ID support', commercial: 'Health ID website',
}

/** A word of a code that can be shown as a thing: plain lowercase words. Anything else (an ID, a path) is never shown. */
const PLAIN_WORD = /^[a-z]+([-_][a-z]+)*$/

/**
 * The spec starts an unlisted code's row with 'Automatic: ' for a system or workload actor and 'Health ID support: ' for a
 * platform actor. The owner asked for each to be said once in a row (1 Nov 2026). Who did it is shown beside the row, and
 * 'Health ID (automatic)' and 'Health ID support' already say it, so the lead-in is added only where who did it does not:
 * 'Health ID background service' does not say automatic, so its rows still start 'Automatic: '.
 */
const ACTOR_LEAD_IN: Readonly<Record<string, string>> = { system: 'Automatic', workload: 'Automatic', platform: 'Health ID support' }

function actorLeadIn(actorType: string): string {
  const lead = own(ACTOR_LEAD_IN, actorType)
  if (lead === undefined) return ''
  const saidAlready = (own(WHO, actorType) ?? '').toLocaleLowerCase().includes(lead.toLocaleLowerCase())
  return saidAlready ? '' : `${lead}: `
}

/**
 * An unlisted code in words, and the outcome it stands for: a name saying it was refused ('…denied', '…-denied') is
 * refused, and one saying it could not complete ('…fail') failed, whatever the outcome column says.
 */
function fallbackWhat(code: string, actorType: string, stored: AuditRow['outcome']) {
  const parts = code.split('.')
  let repeated = false
  let refused = false
  const last = parts[parts.length - 1] ?? ''
  if (last === 'replay' || last === 'idempotent-replay') { repeated = true; parts.pop() }
  const end = parts[parts.length - 1] ?? ''
  if (end === 'denied') { refused = true; parts.pop() } else if (end.endsWith('-denied')) { refused = true; parts[parts.length - 1] = end.slice(0, -'-denied'.length) }
  const area = own(FALLBACK_AREAS, parts[0] ?? '') ?? 'Other'
  const verb = parts.length > 1 ? own(FALLBACK_VERBS, parts[parts.length - 1] ?? '') : undefined
  // The spec builds the label from the last two parts: the thing is the part before the verb (for a two-part code, its
  // first part). Hyphens become spaces (the spec); so do underscores, so no stored name reads as code.
  const word = parts.length > 1 ? parts[parts.length - 2] ?? '' : ''
  const thing = own(FALLBACK_THINGS, word) ?? (PLAIN_WORD.test(word) ? word.replace(/[-_]/g, ' ') : '')
  const saysFailed = verb === FALLBACK_VERBS.fail
  const outcome = refused ? 'denied' : saysFailed && (stored === null || stored === 'success') ? 'failure' : stored
  const phrase = verb && thing ? `${verb} ${thing}` : null
  const failedOrRefused = outcome === 'denied' || outcome === 'failure' ? outcome : null
  const done = phrase !== null && failedOrRefused && !saysFailed ? attempt(phrase, failedOrRefused) : phrase
  // A support code's area is 'Health ID support': done by Health ID support, who did it says that already, so the
  // area is not said again in front of what was done ('Activity' when there is nothing more to name).
  const areaIsWho = area === own(WHO, actorType)
  const activity = areaIsWho ? 'Activity' : `${area} activity`
  const said = done === null
    ? (failedOrRefused ? attempt(activity, failedOrRefused, false) : activity)
    : areaIsWho ? done : `${area}: ${done}`
  const what = `${actorLeadIn(actorType)}${said}`
  return { what: repeated ? `${what} (repeated, nothing changed)` : what, outcome }
}

/**
 * The event in words, or null for the request log (an action starting 'api.'), which a facility's audit view never shows
 * (health#70; staff/api.ts already leaves it out of the page).
 */
export function auditRow(event: AuditEventFacts): AuditRow | null {
  const code = event.action
  if (code.startsWith('api.')) return null
  let outcome: AuditRow['outcome'] = Object.hasOwn(OUTCOME_TEXT, event.outcome) ? event.outcome : null
  let what: string
  // A listed code, or a listed code sent again ('.replay'; an exact '.replay' code in the table keeps its own label).
  const replay = code.endsWith('.replay') && own(AUDIT_ACTION_LABELS, code) === undefined
  const listedCode = replay ? code.slice(0, -'.replay'.length) : code
  const listed = own(AUDIT_ACTION_LABELS, listedCode)
  if (listed !== undefined) {
    const stated = statedOutcome(listedCode)
    // A label that opens 'Refused: ' (the security refusals) loses those words because the row shows Refused beside it,
    // so the row is Refused whatever was stored. The spec says the guard writes these only when a permission check
    // refuses, and "Their role here does not allow this action" beside Failed would contradict itself.
    if (listed.startsWith('Refused: ')) outcome = 'denied'
    else if (stated && (outcome === null || outcome === 'success')) outcome = stated
    what = listedWhat(listedCode, listed, { ...event, outcome: outcome ?? 'success' })
    if (replay) what = `${what} (repeated)`
  } else if (event.actorType === 'legacy' || !code.includes('.')) what = own(LEGACY_ACTION_LABELS, code) ?? LEGACY_ACTIVITY
  else ({ what, outcome } = fallbackWhat(code, event.actorType, outcome))
  return {
    what,
    who: own(WHO, event.actorType) ?? SOMEONE,
    outcome,
    outcomeText: outcome ? OUTCOME_TEXT[outcome] : 'Outcome not recorded',
  }
}

/**
 * Whether the event matches a search: every word of it is in what the row shows (what, who, the outcome in words) or in
 * the action code, which is searchable but never shown. Nothing else stored is searched.
 */
export function matchesAuditSearch(event: AuditEventFacts, query: string): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const row = auditRow(event)
  const haystack = [row?.what, row?.who, row?.outcomeText, event.action].filter(Boolean).join(' ').toLocaleLowerCase()
  return words.every(word => haystack.includes(word))
}
