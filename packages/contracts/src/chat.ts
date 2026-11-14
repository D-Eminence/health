/**
 * The chat wire contracts.
 *
 * Patient record chat is read from hid-system `main` (#95, migration 0100,
 * ADR-068; docs/INTERFACE_CONTRACT.md, "Patient record chat"). Support chat is
 * not served by `main` yet (see the registry). No response content is logged.
 */

export interface SupportChatReply { sessionId: string; messages: string[] }

export type PatientChatSourceKind = 'encounter' | 'note' | 'diagnosis' | 'prescription' | 'lab_result' | 'vital' | 'document'
export type PatientChatStatus = 'answered' | 'no_evidence' | 'declined' | 'unverified'
export type PatientChatBlockKind = 'record' | 'explanation' | 'safety'

/** A record an answer cites, as the patient's own release routes return it. */
export interface PatientChatSource {
  number: number
  kind: PatientChatSourceKind
  id: string
  recordedOn: string | null
  effectiveOn: string | null
  title: string
}

/** A `record` block cites `sources` by number; an `explanation` or `safety` block cites none. */
export interface PatientChatBlock {
  kind: PatientChatBlockKind
  text: string
  references: number[]
}

/** Which categories the extract held, and whether every released record was sent. */
export interface PatientChatCoverage {
  complete: boolean
  released: string[]
  withheld: string[]
  truncated: boolean
  selectedCount: number
  recordCount: number
}

/** What is stored with an exchange and shown again from the history. */
export interface PatientChatStoredReply {
  status: PatientChatStatus
  answer: string
  blocks: PatientChatBlock[]
  sources: PatientChatSource[]
}

/** The answer to `POST /ehr/me/chat`. */
export interface PatientChatReply extends PatientChatStoredReply {
  coverage: PatientChatCoverage
  conversationId: string
  messageId: string
  createdAt: string
  idempotentReplay: boolean
}

export interface PatientChatExchange {
  messageId: string
  question: string
  reply: PatientChatStoredReply
  createdAt: string
}

/** Newest first, as the service returns it. */
export interface PatientChatHistory {
  conversationId: string | null
  exchanges: PatientChatExchange[]
  limit: number
}

export type PatientChatAvailability =
  | { available: false }
  | {
    available: true
    noticeVersion: string
    historyLimit: number
    maxQuestionLength: number
    /** The record categories chat may read now. */
    released: string[]
    /** Staff chat only (ADR-069): the categories it does not read for this member, Lab always among them. */
    withheld?: string[]
  }

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const supportSessionId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const KINDS: readonly string[] = ['encounter', 'note', 'diagnosis', 'prescription', 'lab_result', 'vital', 'document']
const STATUSES: readonly string[] = ['answered', 'no_evidence', 'declined', 'unverified']
const BLOCK_KINDS: readonly string[] = ['record', 'explanation', 'safety']

/** No NUL or other control character but tab and line breaks, and no lone surrogate (hid-system's rule). */
function hasUnsafeCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return true
    if (code === 0x7f) return true
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
}

/** A question as the service accepts it: trimmed, 1 to `max` characters, no control characters. */
export function chatQuestion(value: string, max = 500): string {
  const trimmed = value.trim()
  if (!text(trimmed, max) || hasUnsafeCharacter(trimmed)) {
    throw new Error(`Enter a question of 1 to ${max} characters.`)
  }
  return trimmed
}

export function parseSupportChat(value: unknown): SupportChatReply {
  if (!object(value) || typeof value.sessionId !== 'string' || !supportSessionId.test(value.sessionId)
    || !Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > 4
    || !value.messages.every(message => text(message, 1000))) {
    throw new Error('Support chat returned an invalid response.')
  }
  return { sessionId: value.sessionId, messages: value.messages as string[] }
}

const invalid = (what: string) => new Error(`Record chat returned an invalid ${what}.`)
const date = (value: unknown): value is string | null => value === null || text(value, 100)

function parseSource(value: unknown): PatientChatSource {
  if (!object(value) || !Number.isSafeInteger(value.number) || Number(value.number) < 1 || Number(value.number) > 60
    || typeof value.kind !== 'string' || !KINDS.includes(value.kind)
    || typeof value.id !== 'string' || !uuid.test(value.id)
    || !date(value.recordedOn) || !date(value.effectiveOn) || !text(value.title, 500)) throw invalid('source')
  return { number: Number(value.number), kind: value.kind as PatientChatSourceKind, id: value.id,
    recordedOn: value.recordedOn, effectiveOn: value.effectiveOn, title: value.title }
}

function parseBlock(value: unknown, sourceNumbers: ReadonlySet<number>): PatientChatBlock {
  if (!object(value) || typeof value.kind !== 'string' || !BLOCK_KINDS.includes(value.kind) || !text(value.text, 2000)
    || !Array.isArray(value.references) || value.references.length > 60
    || !value.references.every(reference => Number.isSafeInteger(reference) && sourceNumbers.has(reference as number))) {
    throw invalid('answer')
  }
  return { kind: value.kind as PatientChatBlockKind, text: value.text, references: value.references as number[] }
}

function parseStored(value: unknown): PatientChatStoredReply {
  if (!object(value) || typeof value.status !== 'string' || !STATUSES.includes(value.status)
    || !text(value.answer, 4000) || !Array.isArray(value.sources) || value.sources.length > 60
    || !Array.isArray(value.blocks) || value.blocks.length > 8) throw invalid('answer')
  const sources = value.sources.map(parseSource)
  const numbers = new Set(sources.map(source => source.number))
  if (numbers.size !== sources.length) throw invalid('source')
  return { status: value.status as PatientChatStatus, answer: value.answer,
    blocks: value.blocks.map(block => parseBlock(block, numbers)), sources }
}

function parseCoverage(value: unknown): PatientChatCoverage {
  const names = (list: unknown) => Array.isArray(list) && list.length <= 20 && list.every(item => text(item, 100))
  if (!object(value) || typeof value.complete !== 'boolean' || typeof value.truncated !== 'boolean'
    || !names(value.released) || !names(value.withheld)
    || ![value.selectedCount, value.recordCount].every(count => Number.isSafeInteger(count) && Number(count) >= 0)) {
    throw invalid('coverage')
  }
  return { complete: value.complete, released: value.released as string[], withheld: value.withheld as string[],
    truncated: value.truncated, selectedCount: Number(value.selectedCount), recordCount: Number(value.recordCount) }
}

export function parsePatientChat(value: unknown): PatientChatReply {
  if (!object(value) || typeof value.conversationId !== 'string' || !uuid.test(value.conversationId)
    || typeof value.messageId !== 'string' || !uuid.test(value.messageId)
    || !text(value.createdAt, 100) || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.idempotentReplay !== 'boolean') throw invalid('response')
  return { ...parseStored(value), coverage: parseCoverage(value.coverage), conversationId: value.conversationId,
    messageId: value.messageId, createdAt: value.createdAt, idempotentReplay: value.idempotentReplay }
}

export function parsePatientChatAvailability(value: unknown): PatientChatAvailability {
  if (!object(value) || typeof value.available !== 'boolean') throw invalid('availability')
  if (!value.available) return { available: false }
  if (!text(value.noticeVersion, 40) || !Number.isSafeInteger(value.historyLimit) || Number(value.historyLimit) < 1
    || !Number.isSafeInteger(value.maxQuestionLength) || Number(value.maxQuestionLength) < 1
    || !Array.isArray(value.released) || !value.released.every(item => text(item, 100))
    || (value.withheld !== undefined && (!Array.isArray(value.withheld) || !value.withheld.every(item => text(item, 100))))) {
    throw invalid('availability')
  }
  return { available: true, noticeVersion: value.noticeVersion, historyLimit: Number(value.historyLimit),
    maxQuestionLength: Number(value.maxQuestionLength), released: value.released as string[],
    ...(value.withheld !== undefined ? { withheld: value.withheld as string[] } : {}) }
}

export function parsePatientChatHistory(value: unknown): PatientChatHistory {
  if (!object(value) || !(value.conversationId === null || (typeof value.conversationId === 'string' && uuid.test(value.conversationId)))
    || !Array.isArray(value.exchanges) || value.exchanges.length > 100
    || !Number.isSafeInteger(value.limit) || Number(value.limit) < 1) throw invalid('history')
  const ids = new Set<string>()
  const exchanges = value.exchanges.map((item: unknown): PatientChatExchange => {
    if (!object(item) || typeof item.messageId !== 'string' || !uuid.test(item.messageId) || ids.has(item.messageId)
      || !text(item.question, 1000) || !text(item.createdAt, 100) || !Number.isFinite(Date.parse(item.createdAt))) {
      throw invalid('history')
    }
    ids.add(item.messageId)
    return { messageId: item.messageId, question: item.question, reply: parseStored(item.reply), createdAt: item.createdAt }
  })
  return { conversationId: value.conversationId as string | null, exchanges, limit: Number(value.limit) }
}

export function parsePatientChatCleared(value: unknown): { cleared: true; deletedCount: number } {
  if (!object(value) || value.cleared !== true || !Number.isSafeInteger(value.deletedCount) || Number(value.deletedCount) < 0) {
    throw invalid('deletion answer')
  }
  return { cleared: true, deletedCount: Number(value.deletedCount) }
}
