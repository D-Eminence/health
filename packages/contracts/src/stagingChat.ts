/**
 * The patient and hospital record chat contract of hid-system's staging branches (`staging`,
 * `staging-novu-ci-20261005`), which Health-id #61 was built against: `{ status: 'ready' | 'preparing', answer,
 * sources }`, a question of at most 500 characters, and no notice or idempotency key. hid-system `main` serves a
 * different contract for patients (chat.ts) and no hospital chat, so this is used only by the hospital chat
 * (off unless the build turns it on). It is kept exactly as it was.
 */
export interface StagingLegacyPatientChatSource {
  number: number; noteId: string; revisionNo: number; title: string; signedAt: string
}
export interface StagingTypedPatientChatSource {
  number:number;kind:'note'|'encounter'|'diagnosis'|'prescription'|'investigation'|'vital'|'import'|'import_version'|'health_profile'|'lab_result'|'attachment'|'document'|'profile';
  id:string;version:string;title:string;recordedAt:string|null;effectiveAt:string|null;provenance:string;quality:string
}
export type StagingPatientChatSource = StagingLegacyPatientChatSource | StagingTypedPatientChatSource
export interface StagingPatientChatReply {
  status: 'ready' | 'preparing'; answer: string; sources: StagingPatientChatSource[]
  coverage?:{complete:boolean;unavailable:string[];pendingDocuments:number;recordCount:number;selectedCount:number}
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max
const recordUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
export function stagingChatQuestion(value: string): string {
  const trimmed = value.trim()
  if (!text(trimmed, 500)) throw new Error('Enter a question of 1 to 500 characters.')
  return trimmed
}
export function parseStagingPatientChat(value: unknown): StagingPatientChatReply {
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
      return {number:Number(source.number),kind:source.kind as StagingTypedPatientChatSource['kind'],id:source.id,version:source.version,
        title:source.title,recordedAt:source.recordedAt, effectiveAt:source.effectiveAt,provenance:source.provenance,quality:source.quality} as StagingTypedPatientChatSource
    }
    if(!text(source.noteId,100)||!Number.isSafeInteger(source.revisionNo)||Number(source.revisionNo)<1
      ||!text(source.signedAt,100)||!Number.isFinite(Date.parse(source.signedAt)))throw new Error('Record chat returned invalid sources.')
    return { number: Number(source.number), noteId: source.noteId, revisionNo: Number(source.revisionNo),
      title: source.title, signedAt: source.signedAt }
  })
  if (value.status === 'preparing' && sources.length) throw new Error('Record chat returned invalid sources.')
  let coverage:StagingPatientChatReply['coverage']
  if(value.coverage!==undefined) {
    const c=value.coverage
    if(!object(c)||typeof c.complete!=='boolean'||!Array.isArray(c.unavailable)||c.unavailable.length>10
      ||!c.unavailable.every(v=>text(v,500))||![c.pendingDocuments,c.recordCount,c.selectedCount].every(n=>Number.isSafeInteger(n)&&Number(n)>=0))throw new Error('Record chat returned invalid coverage.')
    coverage={complete:c.complete,unavailable:c.unavailable as string[],pendingDocuments:Number(c.pendingDocuments),recordCount:Number(c.recordCount),selectedCount:Number(c.selectedCount)}
  }
  return { status: value.status as StagingPatientChatReply['status'], answer: value.answer, sources,...(coverage?{coverage}:{}) }
}

/** Saved conversations of the staging branches: at most 10 exchanges, kept 30 days. */
export interface StagingPatientChatHistory {
  exchanges: Array<{ id: string; question: string; reply: StagingPatientChatReply; createdAt: string }>
  retentionDays: number
  limit: number
}
export function parseStagingChatHistory(value: unknown): StagingPatientChatHistory {
  if (typeof value !== 'object' || value === null) throw new Error('Saved chat returned an invalid response.')
  const history = value as Record<string, unknown>
  if (!Array.isArray(history.exchanges) || history.exchanges.length > 10 || history.retentionDays !== 30 || history.limit !== 10) {
    throw new Error('Saved chat returned an invalid response.')
  }
  const ids = new Set<string>()
  const exchanges = history.exchanges.map((item: unknown) => {
    if (typeof item !== 'object' || item === null) throw new Error('Saved chat returned an invalid response.')
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(row.id) || ids.has(row.id)
      || typeof row.question !== 'string' || !row.question.trim() || row.question.length > 500
      || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) throw new Error('Saved chat returned an invalid response.')
    ids.add(row.id)
    return { id: row.id, question: row.question, createdAt: row.createdAt, reply: parseStagingPatientChat(row.reply) }
  })
  return { exchanges, retentionDays: 30, limit: 10 }
}
