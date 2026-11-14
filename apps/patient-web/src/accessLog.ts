/**
 * GET /api/v1/identity/me/access-log (hid-system 0093, patient parity B2; an Identity before it answers 404): who
 * viewed or changed the patient's record, and who was given or lost access, newest first, from the audit events that
 * already record each read and write. Only the patient's own events; refused attempts and record contents are never
 * sent. `nextBefore` is an opaque cursor for the next, older page, null after the last.
 */
export const ACCESS_LOG_ACTIONS = ['viewed', 'changed', 'access_granted', 'access_ended', 'emergency_access'] as const
export type AccessLogAction = typeof ACCESS_LOG_ACTIONS[number]
export const ACCESS_LOG_ACTORS = ['clinician', 'facility', 'patient', 'support', 'system'] as const
export type AccessLogActor = typeof ACCESS_LOG_ACTORS[number]

export interface AccessLogEvent {
  readonly id: string
  readonly at: string
  readonly action: AccessLogAction
  readonly actorKind: AccessLogActor
  readonly actorName: string | null
  readonly facilityName: string | null
}

export interface AccessLogPage {
  readonly events: readonly AccessLogEvent[]
  readonly nextBefore: string | null
}

/** The most events one page asks for (Identity takes 1 to 100, 50 when none is given). */
export const ACCESS_LOG_PAGE_SIZE = 50

const NAME_LIMIT = 200
const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value)
/** A name as sent, trimmed, or null: never anything but a short plain string. */
const name = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' && value.length <= NAME_LIMIT ? value.trim() : null

/**
 * The page as the portal shows it. An event it cannot read (an action or actor it has no words for, a time that is
 * not one) is left out rather than shown wrongly; an answer that is not a page is refused.
 */
export function parseAccessLog(value: unknown): AccessLogPage {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { events?: unknown }).events)) {
    throw new Error('The access log could not be read.')
  }
  const page = value as { events: unknown[]; nextBefore?: unknown }
  const events: AccessLogEvent[] = []
  for (const entry of page.events) {
    if (typeof entry !== 'object' || entry === null) continue
    const item = entry as Record<string, unknown>
    if (typeof item.id !== 'string' || item.id === '' || typeof item.at !== 'string' || Number.isNaN(Date.parse(item.at))) continue
    if (!isOneOf(ACCESS_LOG_ACTIONS, item.action) || !isOneOf(ACCESS_LOG_ACTORS, item.actorKind)) continue
    events.push({ id: item.id, at: item.at, action: item.action, actorKind: item.actorKind,
      actorName: name(item.actorName), facilityName: name(item.facilityName) })
  }
  const next = page.nextBefore
  return { events, nextBefore: typeof next === 'string' && next !== '' && next.length <= 512 ? next : null }
}
