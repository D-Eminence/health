/**
 * Media staged for upload (§2.5 "Media", §2.8 `ehr.document.upload`).
 *
 * JPEG and PNG are re-encoded through createImageBitmap and OffscreenCanvas,
 * which strips EXIF and GPS (longest side ≤ 3000 px, JPEG quality 0.85). PDF
 * and TIFF are kept as they are. SHA-256 is computed after re-encoding. The
 * bytes are cut into 1 MiB chunks, each sealed with QK under the media AAD
 * (vault, blob, chunk number, chunk count, file hash), so chunks cannot be
 * swapped, reordered or truncated. Chunks are deleted when the upload applies.
 */

import { LIMITS } from './contracts'
import { mediaAad, openBytes, randomUuid, sealBytes, sha256Hex, type VaultKeys } from './crypto'
import { vaultRange, type MediaRecord, type OfflineStore } from './store'
import type { StagedMedia } from './types'
import { recountPending } from './vault'

export const MEDIA_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'] as const
type MediaType = typeof MEDIA_TYPES[number]

export class MediaRefused extends Error {
  readonly reason: 'type' | 'too-large' | 'vault-full' | 'storage-low'
  constructor(reason: MediaRefused['reason']) {
    super(reason === 'type' ? 'Only PDF, JPEG, PNG and TIFF files can be kept for upload.'
      : reason === 'too-large' ? 'This file is too large to keep on this device.'
        : reason === 'vault-full' ? 'This device is holding too many files waiting to upload.'
          : 'This device is low on storage.')
    this.name = 'MediaRefused'
    this.reason = reason
  }
}

export type Reencoder = (file: Blob, type: 'image/jpeg' | 'image/png') => Promise<Blob>

/** Browser re-encode: decode, scale to ≤ 3000 px on the longest side, encode again. Drops every metadata block. */
export const browserReencode: Reencoder = async (file, type) => {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return canvas.convertToBlob(type === 'image/jpeg' ? { type, quality: 0.85 } : { type })
}

function extension(type: MediaType): string {
  return type === 'application/pdf' ? 'pdf' : type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : 'tiff'
}

/** `scan-YYYYMMDD-HHmm-<n>.<ext>`: never a patient name. */
export function safeFileName(at: Date, index: number, type: MediaType): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `scan-${at.getUTCFullYear()}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}-${p(at.getUTCHours())}${p(at.getUTCMinutes())}-${index}.${extension(type)}`
}

export interface MediaHost {
  readonly store: OfflineStore
  vault(): { vaultId: string; keys: VaultKeys } | null
  now(): number
  /** Storage is low (storageHealth.ts). */
  storageLow(): boolean
  /** New files may be staged (false for a send-only vault). */
  acceptsNew?(): boolean
  readonly reencode?: Reencoder | null
}

export class MediaStore {
  constructor(private readonly host: MediaHost) {}

  async stage(file: Blob, o: { index: number }): Promise<StagedMedia> {
    const v = this.host.vault()
    if (!v || !(this.host.acceptsNew?.() ?? true)) throw new Error('Offline saving is not available')
    const type = file.type as MediaType
    if (!(MEDIA_TYPES as readonly string[]).includes(type)) throw new MediaRefused('type')
    if (this.host.storageLow()) throw new MediaRefused('storage-low')
    let blob = file
    if (type === 'image/jpeg' || type === 'image/png') {
      const reencode = this.host.reencode === undefined ? browserReencode : this.host.reencode
      if (!reencode) throw new MediaRefused('type')
      blob = await reencode(file, type)
    }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (bytes.length > LIMITS.mediaFileMaxBytes) throw new MediaRefused('too-large')
    const sha = await sha256Hex(bytes)
    const blobId = randomUuid()
    const chunkCount = Math.max(1, Math.ceil(bytes.length / LIMITS.chunkBytes))
    const records: MediaRecord[] = []
    for (let n = 0; n < chunkCount; n += 1) {
      const chunk = bytes.subarray(n * LIMITS.chunkBytes, (n + 1) * LIMITS.chunkBytes)
      records.push({
        v: 1, vaultId: v.vaultId, blobId, chunkNo: n, chunkCount, bytes: chunk.length, stagedAt: this.host.now(),
        value: await sealBytes(v.keys.qk, 'qk', mediaAad(v.vaultId, blobId, n, chunkCount, sha), chunk),
      })
    }
    await this.host.store.write(['vaults', 'outbox', 'audit', 'media'], async tx => {
      const vault = await tx.get('vaults', v.vaultId)
      if (!vault) throw new Error('Vault disappeared')
      if (vault.pending.mediaBytes + bytes.length > LIMITS.mediaVaultMaxBytes) throw new MediaRefused('vault-full')
      for (const r of records) await tx.put('media', r)
      await recountPending(tx, v.vaultId)
    })
    return { blobId, mediaType: type, sizeBytes: bytes.length, sha256Hex: sha, fileName: safeFileName(new Date(this.host.now()), o.index, type) }
  }

  /** Read a staged blob back; throws if any chunk is missing, moved or altered. */
  async read(blobId: string, mediaType: string, expectSha?: string): Promise<Blob> {
    const v = this.host.vault()
    if (!v) throw new Error('Offline saving is not available')
    const records = await this.host.store.read(['media'], tx => tx.all('media', vaultRange(v.vaultId, blobId)))
    const chunkCount = records[0]?.chunkCount ?? 0
    if (records.length === 0 || records.length !== chunkCount) throw new Error('Staged file is incomplete')
    const parts: Uint8Array[] = []
    for (const r of records.sort((a, b) => a.chunkNo - b.chunkNo)) {
      if (!expectSha) throw new Error('The file hash is needed to read a staged file')
      parts.push(await openBytes(v.keys.qk, mediaAad(v.vaultId, blobId, r.chunkNo, chunkCount, expectSha), r.value))
    }
    const total = parts.reduce((n, p) => n + p.length, 0)
    const out = new Uint8Array(total)
    let at = 0
    for (const p of parts) { out.set(p, at); at += p.length }
    if (expectSha && (await sha256Hex(out)) !== expectSha) throw new Error('Staged file does not match its hash')
    return new Blob([out], { type: mediaType })
  }

  async discard(blobId: string): Promise<void> {
    const v = this.host.vault()
    if (!v) return
    await this.host.store.write(['vaults', 'outbox', 'audit', 'media'], async tx => {
      await tx.delete('media', vaultRange(v.vaultId, blobId))
      await recountPending(tx, v.vaultId)
    })
  }

  /**
   * Delete chunks no command refers to (a save that never happened). Only after a day: a form may hold a staged
   * file across a lock or in another tab, and the lease is at most 24 hours anyway.
   */
  async sweepOrphans(referenced: ReadonlySet<string>): Promise<void> {
    const v = this.host.vault()
    if (!v) return
    const records = await this.host.store.read(['media'], tx => tx.all('media', vaultRange(v.vaultId)))
    const cutoff = this.host.now() - 86400_000
    const orphans = [...new Set(records.filter(r => r.stagedAt <= cutoff).map(r => r.blobId))].filter(id => !referenced.has(id))
    for (const id of orphans) await this.discard(id)
  }
}
