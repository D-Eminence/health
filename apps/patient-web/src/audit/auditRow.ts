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
 * with its *.email.failed, *.email.retry-scheduled and *.notification.failed codes).
 */
const STATES_ITS_OUTCOME = new Set([
  'auth.authorization.denied', 'security.authorization', 'security.authorization.denied', 'identity.nin.verify',
  'identity.nin.protect', 'identity.patient-access-pin.verify-denied', 'identity.patient-access-pin.authorization-denied',
  'identity.patient.contact-change.verify', 'identity.patient.contact-change.delivery', 'ehr.document.scan.rejected',
  'ehr.document.scan.failed', 'ocr.worker.fail', 'ocr.worker.lease_recovered', 'ocr.publication.fail',
])
const STATES_ITS_OUTCOME_ENDING = /\.(email\.failed|email\.retry-scheduled|notification\.failed)$/

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

/** What a listed code's row says, for its outcome and kind of record. */
function listedWhat(code: string, label: string, event: AuditEventFacts) {
  const parts = labelParts(label)
  const main = (event.resourceType !== null ? parts.resources.get(event.resourceType) : undefined) ?? parts.main
  if (event.outcome === 'denied' && parts.refused) return parts.refused
  if (event.outcome === 'failure' && parts.failed) return parts.failed
  if (event.outcome === 'success' || STATES_ITS_OUTCOME.has(code) || STATES_ITS_OUTCOME_ENDING.test(code)) return main
  return tried(main) ?? main
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

/** An unlisted code in words, and whether its name says it was refused ('…denied', '…-denied'). */
function fallbackWhat(code: string, actorType: string) {
  const parts = code.split('.')
  let repeated = false
  let refused = false
  const last = parts[parts.length - 1] ?? ''
  if (last === 'replay' || last === 'idempotent-replay') { repeated = true; parts.pop() }
  const end = parts[parts.length - 1] ?? ''
  if (end === 'denied') { refused = true; parts.pop() } else if (end.endsWith('-denied')) { refused = true; parts[parts.length - 1] = end.slice(0, -'-denied'.length) }
  const area = own(FALLBACK_AREAS, parts[0] ?? '') ?? 'Other'
  const verb = parts.length > 1 ? own(FALLBACK_VERBS, parts[parts.length - 1] ?? '') : undefined
  // The thing is the part before the verb; with none between the area and the verb, there is no thing to name.
  const word = parts.length > 2 ? parts[parts.length - 2] ?? '' : ''
  // Hyphens become spaces (the spec); so do underscores, so no stored name reads as code.
  const thing = own(FALLBACK_THINGS, word) ?? word.replace(/[-_]/g, ' ').trim()
  let what = verb && thing ? `${area}: ${verb} ${thing}` : `${area} activity`
  if (actorType === 'system' || actorType === 'workload') what = `Automatic: ${what}`
  else if (actorType === 'platform') what = `Health ID support: ${what}`
  return { what: repeated ? `${what} (repeated, nothing changed)` : what, refused }
}

/**
 * The event in words, or null for the request log (an action starting 'api.'), which a facility's audit view never shows
 * (health#70; staff/api.ts already leaves it out of the page).
 */
export function auditRow(event: AuditEventFacts): AuditRow | null {
  const code = event.action
  if (code.startsWith('api.')) return null
  let outcome: AuditRow['outcome'] = Object.hasOwn(OUTCOME_TEXT, event.outcome) ? event.outcome : null
  const facts = { ...event, outcome: outcome ?? 'success' }
  let what: string
  const listed = own(AUDIT_ACTION_LABELS, code)
  const replayed = code.endsWith('.replay') ? own(AUDIT_ACTION_LABELS, code.slice(0, -'.replay'.length)) : undefined
  if (listed !== undefined) what = listedWhat(code, listed, facts)
  else if (replayed !== undefined) what = `${listedWhat(code.slice(0, -'.replay'.length), replayed, facts)} (repeated)`
  else if (event.actorType === 'legacy' || !code.includes('.')) what = own(LEGACY_ACTION_LABELS, code) ?? LEGACY_ACTIVITY
  else {
    const fallback = fallbackWhat(code, event.actorType)
    what = fallback.what
    if (fallback.refused) outcome = 'denied'
  }
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
