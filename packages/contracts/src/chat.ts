/** The deployed support and patient chat wire contracts. No response content is logged. */
export interface SupportChatReply { sessionId: string; messages: string[] }
export interface PatientChatSource {
  number: number; noteId: string; revisionNo: number; title: string; signedAt: string
}
export interface PatientChatReply {
  status: 'ready' | 'preparing'; answer: string; sources: PatientChatSource[]
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
export function chatQuestion(value: string): string {
  const trimmed = value.trim()
  if (!text(trimmed, 500)) throw new Error('Enter a question of 1 to 500 characters.')
  return trimmed
}
export function parseSupportChat(value: unknown): SupportChatReply {
  if (!object(value) || typeof value.sessionId !== 'string' || !uuid.test(value.sessionId)
    || !Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > 4
    || !value.messages.every(message => text(message, 1000))) {
    throw new Error('Support chat returned an invalid response.')
  }
  return { sessionId: value.sessionId, messages: value.messages as string[] }
}
export function parsePatientChat(value: unknown): PatientChatReply {
  if (!object(value) || (value.status !== 'ready' && value.status !== 'preparing')
    || !text(value.answer, 4000) || !Array.isArray(value.sources) || value.sources.length > 5) {
    throw new Error('Record chat returned an invalid response.')
  }
  const numbers = new Set<number>()
  const sources = value.sources.map((source: unknown) => {
    if (!object(source) || !Number.isSafeInteger(source.number) || Number(source.number) < 1
      || Number(source.number) > 5 || numbers.has(Number(source.number))
      || !text(source.noteId, 100) || !Number.isSafeInteger(source.revisionNo) || Number(source.revisionNo) < 1
      || !text(source.title, 500) || !text(source.signedAt, 100) || !Number.isFinite(Date.parse(source.signedAt))) {
      throw new Error('Record chat returned invalid sources.')
    }
    numbers.add(Number(source.number))
    return { number: Number(source.number), noteId: source.noteId, revisionNo: Number(source.revisionNo),
      title: source.title, signedAt: source.signedAt }
  })
  if (value.status === 'preparing' && sources.length) throw new Error('Record chat returned invalid sources.')
  return { status: value.status as PatientChatReply['status'], answer: value.answer, sources }
}
