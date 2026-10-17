import { describe, expect, it } from 'vitest'
import { chatQuestion, parseSupportChat } from '../chat'
import { parseStagingPatientChat as parsePatientChat } from '../stagingChat'
import { assertEndpointAllowed } from '../boundaries'

const sessionId = '11111111-1111-4111-8111-111111111111'
const source = { number: 1, noteId: 'note-a', revisionNo: 2, title: 'Released note', signedAt: '2026-10-07T10:00:00Z' }
/** Support chat and the staging branches' patient chat contract (stagingChat.ts); hid-system main's is in patient-record-chat.test.ts. */
describe('deployed chat contracts', () => {
  it('accepts bounded replies, including preparing and empty history', () => {
    expect(parseSupportChat({ sessionId, messages: ['FAQ'] }).messages).toEqual(['FAQ'])
    expect(parsePatientChat({ status: 'ready', answer: 'No released notes.', sources: [] }).sources).toEqual([])
    expect(parsePatientChat({ status: 'preparing', answer: 'Preparing notes.', sources: [] }).status).toBe('preparing')
    expect(parsePatientChat({ status: 'ready', answer: 'Answer [1]', sources: [source] }).sources[0]).toEqual(source)
  })
  it('rejects malformed replies without echoing their contents', () => {
    for (const value of [{ sessionId: 'not-a-uuid', messages: ['FAQ'] }, { sessionId, messages: ['x'.repeat(1001)] },
      { sessionId, messages: [] }, { sessionId, messages: [1] }]) expect(() => parseSupportChat(value)).toThrow()
    for (const sources of [[{ ...source, signedAt: 'invalid' }], [source, source], [{ ...source, revisionNo: 0 }]]) {
      expect(() => parsePatientChat({ status: 'ready', answer: 'Answer', sources })).toThrow()
    }
    expect(() => parsePatientChat({ status: 'preparing', answer: 'Preparing', sources: [source] })).toThrow()
    expect(() => chatQuestion(' '.repeat(5))).toThrow()
    expect(() => chatQuestion('x'.repeat(501))).toThrow()
    expect(chatQuestion(' hello ')).toBe('hello')
  })
  it('allows only patient chat and public/patient support', () => {
    assertEndpointAllowed('patient-web', 'ehr.patientChat')
    for (const app of ['public-web', 'staff-web', 'ehr-web', 'admin-web'] as const) {
      expect(() => assertEndpointAllowed(app, 'ehr.patientChat')).toThrow()
    }
    for (const app of ['public-web', 'patient-web'] as const) assertEndpointAllowed(app, 'support.chat')
    for (const app of ['staff-web', 'admin-web'] as const) expect(() => assertEndpointAllowed(app, 'support.chat')).toThrow()
  })
})
