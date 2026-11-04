/**
 * The patient's own record chat on hid-system `staging-novu-ci-20261005` from "Patient chat safety PR 1" (#167,
 * f11c9ec9): the staging contract (stagingChat.ts) with each source's server-written origin label, and the source
 * viewer's read. The hospital chat keeps stagingChat.ts exactly as it was; this is for the patient only.
 *
 * - `POST /ehr/me/chat` answers `{ status: 'ready' | 'preparing', answer, sources, coverage? }`. The answer already ends
 *   with the server's "Talk to your doctor" lines, and `sources` lists only the sources the answer cites, each with
 *   `originLabel` ("You added this", "Recorded by a health worker", ...). A service before #167 sends no label; one
 *   that sends no status or sources is read as a ready answer with none, so the page shows it as before.
 * - `GET /ehr/me/chat/sources/:kind/:id` answers a source the current answer cites (404 CHAT_SOURCE_UNAVAILABLE for
 *   anything else) as `{ kind, id, kindLabel, title, recordedAt, effectiveAt, originLabel, provenance, items, notices }`.
 *   A service before #167 answers the raw record (`fields`, no `items` or `notices`), read here as a plain view.
 */
import {
  parseStagingChatHistory, parseStagingPatientChat,
  type StagingLegacyPatientChatSource, type StagingPatientChatReply, type StagingTypedPatientChatSource,
} from './stagingChat'

export interface NovuPatientChatTypedSource extends StagingTypedPatientChatSource {
  /** The server's words for where the facts came from, shown as given; absent from a service before #167. */
  originLabel?: string
}
export type NovuPatientChatSource = StagingLegacyPatientChatSource | NovuPatientChatTypedSource
export interface NovuPatientChatReply extends Omit<StagingPatientChatReply, 'sources'> {
  sources: NovuPatientChatSource[]
}
export interface NovuPatientChatHistory {
  exchanges: Array<{ id: string; question: string; reply: NovuPatientChatReply; createdAt: string }>
  retentionDays: number
  limit: number
}
/** What the source viewer shows: never a hash, content or raw fields. */
export interface NovuPatientChatSourceView {
  kind: StagingTypedPatientChatSource['kind']
  id: string
  kindLabel: string
  title: string
  recordedAt: string | null
  effectiveAt: string | null
  originLabel: string
  provenance: string
  items: Array<{ label: string; value: string }>
  /** Each shown prominently, for example "The lab is correcting this result." or "Not checked by a clinician." */
  notices: string[]
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max
// eslint-disable-next-line no-control-regex
const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const label = (value: unknown, max: number): value is string => text(value, max) && !control.test(value)
const date = (value: unknown): value is string | null => value === null || (text(value, 100) && Number.isFinite(Date.parse(value)))
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const KINDS: readonly string[] = ['note', 'encounter', 'diagnosis', 'prescription', 'investigation', 'vital', 'import',
  'import_version', 'health_profile', 'lab_result', 'attachment', 'document', 'profile']

/**
 * The staging rules for the answer (stagingChat.ts), plus each source's `originLabel` when it is plain text. A label
 * that is not is left out, as if not sent, so a newer service never stops the answer from showing.
 */
export function parseNovuPatientChat(value: unknown): NovuPatientChatReply {
  if (!object(value)) throw new Error('Record chat returned an invalid response.')
  const reply = parseStagingPatientChat({ ...value, status: value.status ?? 'ready', sources: value.sources ?? [] })
  const raw = value.sources as unknown[] | undefined
  const labels = new Map<number, string>()
  for (const source of raw ?? []) {
    if (object(source) && 'kind' in source && label(source.originLabel, 200)) labels.set(Number(source.number), source.originLabel)
  }
  return { ...reply, sources: reply.sources.map(source => {
    const words = 'kind' in source ? labels.get(source.number) : undefined
    return words ? { ...source, originLabel: words } : source
  }) }
}

/** Saved conversations, read by the staging rules (at most 10 exchanges, kept 30 days), each reply with its labels. */
export function parseNovuPatientChatHistory(value: unknown): NovuPatientChatHistory {
  const history = parseStagingChatHistory(value)
  const rows = (value as { exchanges: Array<{ reply: unknown }> }).exchanges
  return { ...history, exchanges: history.exchanges.map((exchange, index) => ({
    ...exchange, reply: parseNovuPatientChat(rows[index]!.reply),
  })) }
}

// The service's words (hid-system f11c9ec9, patient-chat-safety.ts and patient-evidence.types.ts), used only to read a
// source from a service before #167, which sends the record's raw fields instead of a view.
const KIND_LABELS: Readonly<Record<string, string>> = {
  note: 'Clinic note', encounter: 'Visit', diagnosis: 'Diagnosis', prescription: 'Prescription',
  investigation: 'Test request', lab_result: 'Lab result', vital: 'Vital signs', document: 'Clinical document',
  attachment: 'Imported document', import: 'Imported history', import_version: 'Earlier version of imported history',
  health_profile: 'Imported health profile', profile: 'Age and sex',
}
const ORIGIN_LABELS: Readonly<Record<string, string>> = {
  patient: 'You added this', health_worker: 'Recorded by a health worker',
  scanned_paper: 'From a scanned paper record', health_id_profile: 'Your Health ID profile',
}
const CORRECTING_LINE = 'The lab is correcting this result.'
const NOT_CHECKED_LINE = 'Not checked by a clinician.'
/** The longest value shown. The service sends a document's read text up to 200,000 characters; longer is cut, not refused. */
const NOVU_CHAT_SOURCE_VALUE_LIMIT = 200_000
const fieldLabel = (key: string) => key.replace(/[_-]+/g, ' ').replace(/([a-z\d])([A-Z])/g, '$1 $2').toLowerCase()
  .replace(/^./, first => first.toUpperCase())
const fit = (value: string) => value.length > NOVU_CHAT_SOURCE_VALUE_LIMIT
  ? `${value.slice(0, NOVU_CHAT_SOURCE_VALUE_LIMIT)}…` : value
/** A record's raw fields as label and value pairs, as the service's own view makes them. */
function fieldItems(fields: Record<string, unknown>, prefix = '', depth = 0): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = []
  for (const [key, value] of Object.entries(fields)) {
    if (key.startsWith('_') || key === 'correctionPending' || value === null || value === undefined || value === '') continue
    const name = prefix ? `${prefix}: ${fieldLabel(key)}` : fieldLabel(key)
    if (typeof value === 'boolean') out.push({ label: name, value: value ? 'Yes' : 'No' })
    else if (typeof value === 'string' || typeof value === 'number') out.push({ label: name, value: fit(String(value)) })
    else if (Array.isArray(value)) {
      const words = value.filter(entry => entry !== null && typeof entry !== 'object').map(String).join(', ')
      if (words) out.push({ label: name, value: fit(words) })
      else if (depth < 2) value.forEach((entry, index) => { if (object(entry)) out.push(...fieldItems(entry, `${name} ${index + 1}`, depth + 1)) })
    } else if (object(value) && depth < 2) out.push(...fieldItems(value, name, depth + 1))
  }
  return out.slice(0, 100)
}

/**
 * A source from a service before #167: the raw record (`fields`, no `items` or `notices`), turned into a plain view.
 * The notices the newer service always adds are added the same way: a lab result being corrected, and anything the
 * patient added or a document, which no clinician has checked.
 */
function legacySourceView(value: Record<string, unknown>, asked: { kind: string; id: string }): NovuPatientChatSourceView {
  const fields = object(value.fields) ? value.fields : {}
  const notices: string[] = []
  if (value.kind === 'lab_result' && (fields.correctionPending === true
    || (typeof value.version === 'string' && value.version.includes(':pending:')))) notices.push(CORRECTING_LINE)
  if (value.origin === 'patient' || value.kind === 'document' || value.kind === 'attachment') notices.push(NOT_CHECKED_LINE)
  const origin = label(value.originLabel, 200) ? value.originLabel
    : typeof value.origin === 'string' && Object.hasOwn(ORIGIN_LABELS, value.origin) ? ORIGIN_LABELS[value.origin]! : 'Not recorded'
  return parseNovuPatientChatSource({
    kind: value.kind, id: value.id, kindLabel: typeof value.kind === 'string' ? KIND_LABELS[value.kind] : undefined,
    title: value.title, recordedAt: value.recordedAt ?? null, effectiveAt: value.effectiveAt ?? null, originLabel: origin,
    provenance: value.provenance, items: fieldItems(fields), notices,
  }, asked)
}

/**
 * The source viewer's read, checked against the source that was asked for. A service before #167 sends the raw record
 * instead, read as a plain view (legacySourceView). A value longer than the limit is cut, never refused, so a long
 * scanned document still opens.
 */
export function parseNovuPatientChatSource(value: unknown, asked: { kind: string; id: string }): NovuPatientChatSourceView {
  const invalid = () => new Error('Record chat returned an invalid source.')
  if (object(value) && !('items' in value) && !('notices' in value) && 'fields' in value
    && (value.fields === null || object(value.fields))) return legacySourceView(value, asked)
  if (!object(value) || typeof value.kind !== 'string' || !KINDS.includes(value.kind) || value.kind !== asked.kind
    || typeof value.id !== 'string' || !uuid.test(value.id) || value.id.toLowerCase() !== asked.id.toLowerCase()
    || !label(value.kindLabel, 100) || !text(value.title, 500) || !date(value.recordedAt) || !date(value.effectiveAt)
    || !label(value.originLabel, 200) || !text(value.provenance, 500)
    || !Array.isArray(value.items) || value.items.length > 100 || !Array.isArray(value.notices) || value.notices.length > 10) {
    throw invalid()
  }
  const items = value.items.map((item: unknown) => {
    if (!object(item) || !label(item.label, 300) || typeof item.value !== 'string') throw invalid()
    return { label: item.label, value: fit(item.value) }
  })
  if (!value.notices.every(notice => label(notice, 500))) throw invalid()
  return { kind: value.kind as NovuPatientChatSourceView['kind'], id: value.id, kindLabel: value.kindLabel, title: value.title,
    recordedAt: value.recordedAt, effectiveAt: value.effectiveAt, originLabel: value.originLabel, provenance: value.provenance,
    items, notices: value.notices as string[] }
}
