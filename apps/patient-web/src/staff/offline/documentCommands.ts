import { LIMITS, type CommandOutcome, type Json, type OfflineRuntime } from '@hid/offline'
import { staffApi } from '../api'
import { appliedOnline, asHidApiError } from './ehrCommands'
import { refFromId } from './registry'
import { offlineActive, offlineRuntime } from './runtime'

/** The media types EHR accepts for a document (document.service.ts). */
export const DOCUMENT_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf', 'image/tiff': 'tif',
}

/** The longest side of a re-encoded photo, and its JPEG quality (§2.5 "Media"). */
const MAX_SIDE = 3000
const JPEG_QUALITY = 0.85

/**
 * A sealed file the runtime holds for an upload. The frozen contract has no media call yet (see the pull request's
 * "Contract questions"); a runtime that offers one is used, and without it an upload goes online as today.
 */
interface MediaStore { put(file: Blob, o: { mediaType: string; sha256Hex: string; fileName: string }): Promise<{ blobId: string }> }
function mediaStore(runtime: OfflineRuntime): MediaStore | null {
  const media = (runtime as unknown as { media?: Partial<MediaStore> }).media
  return media && typeof media.put === 'function' ? media as MediaStore : null
}

export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * A photo drawn again through a canvas, which carries no EXIF or location, its longest side at most 3000 px. PDF and
 * TIFF are kept as they are. A browser without OffscreenCanvas keeps a photo only if it cannot re-encode it: the
 * upload is refused rather than sent with its metadata.
 */
export async function reencodeForUpload(file: File): Promise<Blob> {
  if (file.type !== 'image/jpeg' && file.type !== 'image/png') return file
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    throw new Error('This browser cannot prepare photos safely. Use a recent Chrome, Edge, Firefox or Safari.')
  }
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This photo could not be prepared.')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.convertToBlob(file.type === 'image/png' ? { type: 'image/png' } : { type: 'image/jpeg', quality: JPEG_QUALITY })
}

let captured = 0

/** `scan-YYYYMMDD-HHmm-<n>.<ext>`: never a patient's name, never the name the file had (§2.8). */
export function safeFileName(mediaType: string, at: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  captured += 1
  return `scan-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}-${captured}.${DOCUMENT_TYPES[mediaType] ?? 'bin'}`
}

export const documentCommands = {
  /**
   * Uploads `file` into the patient's EHR documents. `idempotencyKey`, one per file chosen, makes pressing again after
   * no answer the same upload. With offline in use the file is re-encoded, sealed on the device and sent on the media
   * lane (intent, storage PUT, completion), so it survives a lost connection or a closed tab.
   */
  async uploadDocument(facilityId: string, patientId: string, encounterId: string, file: File, idempotencyKey?: string): Promise<CommandOutcome<string>> {
    const runtime = offlineRuntime()
    const store = offlineActive(runtime) ? mediaStore(runtime) : null
    if (!offlineActive(runtime) || !store) {
      return appliedOnline(await staffApi.uploadDocument(facilityId, patientId, encounterId, file, idempotencyKey), 'document')
    }
    if (!DOCUMENT_TYPES[file.type]) throw new Error('Choose a JPEG, PNG, PDF or TIFF file.')
    const prepared = await reencodeForUpload(file)
    if (prepared.size > LIMITS.mediaFileMaxBytes) throw new Error('This file is larger than 20 MB.')
    const mediaType = prepared.type || file.type
    const digest = await sha256Hex(prepared)
    const fileName = safeFileName(mediaType, runtime.trustedNow().at)
    const { blobId } = await store.put(prepared, { mediaType, sha256Hex: digest, fileName })
    const encounter = refFromId(encounterId)
    const input = { facilityId, patientId, encounter, media: { blobId, mediaType, sizeBytes: prepared.size, sha256Hex: digest, fileName },
      body: { patientId, ...('server' in encounter ? { encounterId: encounter.server } : {}), fileName, mediaType, sizeBytes: prepared.size,
        sha256Hex: digest, classification: 'phi', retentionClass: 'clinical-10y' } }
    try {
      return await runtime.commands.save<string>('ehr.document.upload', input as unknown as Json,
        { awaitMs: LIMITS.receiptWaitMs, ...('local' in encounter ? { dependsOn: [encounter.local] } : {}) })
    } catch (caught) { throw asHidApiError(caught) }
  },
}
