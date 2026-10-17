import { describe, expect, it } from 'vitest'
import {
  chatQuestion, parsePatientChat, parsePatientChatAvailability, parsePatientChatCleared, parsePatientChatHistory,
} from '../chat'

/** hid-system main 41542fc, #95 (ADR-068): docs/INTERFACE_CONTRACT.md, "Patient record chat". */
const id = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`
const source = { number: 1, kind: 'prescription', id: id(1), recordedOn: '2026-10-01', effectiveOn: null, title: 'Amoxicillin' }
const block = { kind: 'record', text: 'You were prescribed amoxicillin.', references: [1] }
const coverage = { complete: true, released: ['encounters', 'notes'], withheld: [], truncated: false, selectedCount: 1, recordCount: 1 }
const reply = { status: 'answered', answer: 'You were prescribed amoxicillin.', blocks: [block], sources: [source], coverage,
  conversationId: id(2), messageId: id(3), processor: 'anthropic', createdAt: '2026-10-17T10:00:00.000Z', idempotentReplay: false }

describe('patient record chat answers', () => {
  it('accepts an answer and keeps only what the screen uses', () => {
    const value = parsePatientChat(reply)
    expect(value.status).toBe('answered')
    expect(value.blocks).toEqual([block])
    expect(value.sources).toEqual([source])
    expect(value.coverage.complete).toBe(true)
    expect(JSON.stringify(value)).not.toContain('processor')
  })
  it.each(['answered', 'no_evidence', 'declined', 'unverified'])('accepts status %s', status => {
    expect(parsePatientChat({ ...reply, status, sources: [], blocks: [{ kind: 'explanation', text: 'Fixed text.', references: [] }] }).status).toBe(status)
  })
  it.each([
    ['an unknown status', { ...reply, status: 'ready' }],
    ['an unknown source kind', { ...reply, sources: [{ ...source, kind: 'investigation' }] }],
    ['a source id that is not a UUID', { ...reply, sources: [{ ...source, id: 'other' }] }],
    ['a reference to a source that was not sent', { ...reply, blocks: [{ ...block, references: [2] }] }],
    ['two sources with one number', { ...reply, sources: [source, source] }],
    ['a block kind it does not know', { ...reply, blocks: [{ ...block, kind: 'markdown' }] }],
    ['no coverage', { ...reply, coverage: undefined }],
    ['a message id that is not a UUID', { ...reply, messageId: 'x' }],
  ])('rejects %s', (_name, value) => {
    expect(() => parsePatientChat(value)).toThrow(/Record chat returned an invalid/)
  })
})

describe('patient record chat availability, history and deletion', () => {
  it('reads availability off and on', () => {
    expect(parsePatientChatAvailability({ available: false })).toEqual({ available: false })
    expect(parsePatientChatAvailability({ available: true, processor: 'anthropic', inferenceGeo: 'us', noticeVersion: 'ADR-068@2026-10-16',
      historyLimit: 50, maxQuestionLength: 1000, released: ['encounters'] })).toEqual({ available: true, noticeVersion: 'ADR-068@2026-10-16',
      historyLimit: 50, maxQuestionLength: 1000, released: ['encounters'] })
    expect(() => parsePatientChatAvailability({ available: true, noticeVersion: '', historyLimit: 50, maxQuestionLength: 1000, released: [] })).toThrow()
  })
  it('reads the history newest first, with no conversation before the first question', () => {
    expect(parsePatientChatHistory({ conversationId: null, exchanges: [], limit: 50 })).toEqual({ conversationId: null, exchanges: [], limit: 50 })
    const history = parsePatientChatHistory({ conversationId: id(2), limit: 50, exchanges: [
      { messageId: id(3), question: 'What medicines?', createdAt: '2026-10-17T10:00:00.000Z', reply: { status: 'answered', answer: 'Amoxicillin.', blocks: [block], sources: [source] } }] })
    expect(history.exchanges[0]?.reply.sources[0]?.title).toBe('Amoxicillin')
  })
  it('rejects a history with a repeated message id', () => {
    const exchange = { messageId: id(3), question: 'Q', createdAt: '2026-10-17T10:00:00.000Z', reply: { status: 'answered', answer: 'A', blocks: [block], sources: [source] } }
    expect(() => parsePatientChatHistory({ conversationId: id(2), limit: 50, exchanges: [exchange, exchange] })).toThrow()
  })
  it('reads the deletion answer', () => {
    expect(parsePatientChatCleared({ cleared: true, deletedCount: 3 })).toEqual({ cleared: true, deletedCount: 3 })
    expect(() => parsePatientChatCleared({ cleared: false, deletedCount: 0 })).toThrow()
  })
})

describe('a question as hid-system accepts it', () => {
  it('trims, and allows up to the length availability says', () => {
    expect(chatQuestion('  hello ', 1000)).toBe('hello')
    expect(chatQuestion('x'.repeat(1000), 1000)).toHaveLength(1000)
    expect(() => chatQuestion('x'.repeat(1001), 1000)).toThrow()
    expect(() => chatQuestion('   ', 1000)).toThrow()
  })
  it('allows tab and line breaks, and refuses other control characters and lone surrogates', () => {
    expect(chatQuestion('a\tb\nc', 1000)).toBe('a\tb\nc')
    expect(() => chatQuestion('a\u0000b', 1000)).toThrow()
    expect(() => chatQuestion('a\u0007b', 1000)).toThrow()
    expect(() => chatQuestion('a\ud800b', 1000)).toThrow()
    expect(chatQuestion('a\ud83d\ude00b', 1000)).toBe('a\ud83d\ude00b')
  })
})
