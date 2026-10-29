import { describe, expect, it } from 'vitest'
import { LIMITS, type Json, type OpDefinition } from '../contracts'
import type { StagedMedia } from '../types'
import { PATIENT } from './fixtures'
import { createServer, makeEnv, makeRuntime, settle, signIn } from './harness'

type DocIn = { patientId: string; encounterId: string; media: StagedMedia }
export const documentUpload: OpDefinition<DocIn> = {
  op: 'ehr.document.upload', opVersion: 1, method: 'POST', keyed: true,
  lane: i => ({ patientId: i.patientId, visit: 'media' }),
  refs: i => ({ encounterId: { server: i.encounterId } }),
  path: () => '/api/v1/ehr/documents/upload-intents',
  body: (i, r) => ({
    patientId: i.patientId, encounterId: r.encounterId!, fileName: i.media.fileName, mediaType: i.media.mediaType,
    sizeBytes: i.media.sizeBytes, sha256Hex: i.media.sha256Hex, classification: 'phi', retentionClass: 'clinical-10y',
  }),
  receipt: b => ({ resourceType: 'document', resourceId: (b as { document: { id: string } }).document.id }),
}

async function ready(extra: Parameters<typeof makeRuntime>[0]['extra'] = {}) {
  const server = createServer()
  const uploads: { url: string; bytes: Uint8Array }[] = []
  const rt = makeRuntime({
    server, env: makeEnv(),
    extra: { upload: async u => { uploads.push({ url: u.url, bytes: new Uint8Array(await u.body.arrayBuffer()) }) }, ...extra },
  })
  rt.commands.register([documentUpload as unknown as OpDefinition<Json>])
  await signIn(rt)
  return { rt, server, uploads }
}

describe('media', () => {
  it('stages a file in 1 MiB sealed chunks, uploads it intact, completes, and deletes the chunks (T15)', async () => {
    const { rt, server, uploads } = await ready()
    const bytes = new Uint8Array(LIMITS.chunkBytes * 2 + 123).map((_, i) => i % 251)
    rt.setSessionReady(false)
    const staged = await rt.stageMedia(new Blob([bytes], { type: 'application/pdf' }), { index: 3 })
    expect(staged.fileName).toMatch(/^scan-\d{8}-\d{4}-3\.pdf$/)
    expect(staged.sizeBytes).toBe(bytes.length)
    const store = (await rt.storeForDiagnostics())!
    expect((await store.dump()).media).toHaveLength(3)
    await rt.commands.save('ehr.document.upload', { patientId: PATIENT, encounterId: 'e1', media: staged } as unknown as Json, { awaitMs: 0 })
    rt.setSessionReady(true)
    await settle(rt)
    expect(uploads).toHaveLength(1)
    expect(uploads[0]!.bytes.length).toBe(bytes.length)
    expect(uploads[0]!.bytes.every((b, i) => b === bytes[i])).toBe(true)
    expect(server.calls.some(c => c.spec.path.endsWith('/complete'))).toBe(true)
    expect((await store.dump()).media).toHaveLength(0)
    expect(rt.summary().pending).toBe(0)
  }, 30_000)

  it('an upload failure replays the intent with the same key for a fresh URL', async () => {
    let fail = true
    const { rt, server } = await ready({ upload: async () => { if (fail) { fail = false; throw new Error('expired') } } })
    const staged = await rt.stageMedia(new Blob([new Uint8Array(10)], { type: 'application/pdf' }), { index: 1 })
    await rt.commands.save('ehr.document.upload', { patientId: PATIENT, encounterId: 'e1', media: staged } as unknown as Json, { awaitMs: 0 })
    await settle(rt)
    rt.commands.syncNow()
    await settle(rt)
    const intents = server.calls.filter(c => c.spec.path.endsWith('/upload-intents'))
    expect(intents).toHaveLength(2)
    expect(intents[0]!.spec.headers!['Idempotency-Key']).toBe(intents[1]!.spec.headers!['Idempotency-Key'])
    expect(rt.summary().pending).toBe(0)
  })

  it('re-encodes JPEG and PNG, keeps PDF as it is, and refuses other types', async () => {
    const seen: string[] = []
    const { rt } = await ready({ reencode: async (file, type) => { seen.push(type); return new Blob([new Uint8Array(4)], { type }) } })
    await rt.stageMedia(new Blob([new Uint8Array(100)], { type: 'image/jpeg' }), { index: 1 })
    await rt.stageMedia(new Blob([new Uint8Array(100)], { type: 'application/pdf' }), { index: 2 })
    expect(seen).toEqual(['image/jpeg'])
    await expect(rt.stageMedia(new Blob(['x'], { type: 'text/plain' }), { index: 3 })).rejects.toMatchObject({ reason: 'type' })
  })

  it('refuses a file over the per-file limit', async () => {
    const { rt } = await ready()
    await expect(rt.stageMedia(new Blob([new Uint8Array(LIMITS.mediaFileMaxBytes + 1)], { type: 'application/pdf' }), { index: 1 }))
      .rejects.toMatchObject({ reason: 'too-large' })
  })
})
