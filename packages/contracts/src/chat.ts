/** The deployed support and patient chat wire contracts. No response content is logged. */
export interface SupportChatReply { sessionId: string; messages: string[] }
export interface LegacyPatientChatSource {
  number: number; noteId: string; revisionNo: number; title: string; signedAt: string
}
export interface TypedPatientChatSource {
  number:number;kind:'note'|'encounter'|'diagnosis'|'prescription'|'investigation'|'vital'|'import'|'import_version'|'health_profile'|'lab_result'|'attachment'|'document'|'profile';
  id:string;version:string;title:string;recordedAt:string|null;effectiveAt:string|null;provenance:string;quality:string
}
export type PatientChatSource = LegacyPatientChatSource | TypedPatientChatSource
export interface PatientChatReply {
  status: 'ready' | 'preparing'; answer: string; sources: PatientChatSource[]
  coverage?:{complete:boolean;unavailable:string[];pendingDocuments:number;recordCount:number;selectedCount:number}
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const recordUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
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
    || !text(value.answer, 4000) || !Array.isArray(value.sources) || value.sources.length > 60) {
    throw new Error('Record chat returned an invalid response.')
  }
  const numbers = new Set<number>()
  const sources = value.sources.map((source: unknown) => {
    if (!object(source) || !Number.isSafeInteger(source.number) || Number(source.number) < 1
      || Number(source.number) > 60 || numbers.has(Number(source.number)) || !text(source.title,500)) {
      throw new Error('Record chat returned invalid sources.')
    }
    numbers.add(Number(source.number))
    if ('kind' in source) {
      const kinds=['note','encounter','diagnosis','prescription','investigation','vital','import','import_version','health_profile','lab_result','attachment','document','profile']
      const date=(v:unknown)=>v===null || (text(v,100)&&Number.isFinite(Date.parse(v)))
      if(!kinds.includes(String(source.kind)) || !text(source.id,36) || !recordUuid.test(source.id)
        || !text(source.version,1024)|| !text(source.provenance,500)||!text(source.quality,200)
        || !date(source.recordedAt)||!date(source.effectiveAt))throw new Error('Record chat returned invalid sources.')
      return {number:Number(source.number),kind:source.kind as TypedPatientChatSource['kind'],id:source.id,version:source.version,
        title:source.title,recordedAt:source.recordedAt, effectiveAt:source.effectiveAt,provenance:source.provenance,quality:source.quality} as TypedPatientChatSource
    }
    if(!text(source.noteId,100)||!Number.isSafeInteger(source.revisionNo)||Number(source.revisionNo)<1
      ||!text(source.signedAt,100)||!Number.isFinite(Date.parse(source.signedAt)))throw new Error('Record chat returned invalid sources.')
    return { number: Number(source.number), noteId: source.noteId, revisionNo: Number(source.revisionNo),
      title: source.title, signedAt: source.signedAt }
  })
  if (value.status === 'preparing' && sources.length) throw new Error('Record chat returned invalid sources.')
  let coverage:PatientChatReply['coverage']
  if(value.coverage!==undefined) {
    const c=value.coverage
    if(!object(c)||typeof c.complete!=='boolean'||!Array.isArray(c.unavailable)||c.unavailable.length>10
      ||!c.unavailable.every(v=>text(v,500))||![c.pendingDocuments,c.recordCount,c.selectedCount].every(n=>Number.isSafeInteger(n)&&Number(n)>=0))throw new Error('Record chat returned invalid coverage.')
    coverage={complete:c.complete,unavailable:c.unavailable as string[],pendingDocuments:Number(c.pendingDocuments),recordCount:Number(c.recordCount),selectedCount:Number(c.selectedCount)}
  }
  return { status: value.status as PatientChatReply['status'], answer: value.answer, sources,...(coverage?{coverage}:{}) }
}
