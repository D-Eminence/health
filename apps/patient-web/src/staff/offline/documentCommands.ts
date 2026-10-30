import { LIMITS, MediaRefused, type CommandOutcome, type Json } from '@hid/offline'
import { staffApi } from '../api'
import { appliedOnline, asHidApiError } from './ehrCommands'
import { refFromId } from './registry'
import { offlineActive, offlineRuntime } from './runtime'

/** The media types EHR accepts for a document (document.service.ts). */
export const DOCUMENT_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf', 'image/tiff': 'tif',
}

// The number in each staged file's safe name (`scan-YYYYMMDD-HHmm-<n>.<ext>`), counted in this tab.
let staged = 0

export const documentCommands = {
  /**
   * Uploads `file` into the patient's EHR documents. `idempotencyKey`, one per file chosen, makes pressing again after
   * no answer the same upload. With offline in use the runtime stages the file (§2.5: photos re-encoded without EXIF,
   * the hash taken after, a safe file name, sealed on the device) and the upload is sent on the media lane (intent,
   * storage PUT, completion), so it survives a lost connection or a closed tab.
   */
  async uploadDocument(facilityId: string, patientId: string, encounterId: string, file: File, idempotencyKey?: string): Promise<CommandOutcome<string>> {
    const runtime = offlineRuntime()
    if (!offlineActive(runtime)) {
      return appliedOnline(await staffApi.uploadDocument(facilityId, patientId, encounterId, file, idempotencyKey), 'document')
    }
    let media
    try {
      staged += 1
      media = await runtime.stageMedia(file, { index: staged })
    } catch (caught) {
      // A file the device cannot keep (size, space) still uploads online, as today (A12.10); only offline, or a type
      // EHR would refuse too, is it refused, in the device's own words. Nothing was kept either way.
      if (caught instanceof MediaRefused && caught.reason !== 'type' && runtime.connectivity() !== 'offline') {
        return appliedOnline(await staffApi.uploadDocument(facilityId, patientId, encounterId, file, idempotencyKey), 'document')
      }
      if (caught instanceof MediaRefused) throw new Error(caught.message)
      throw caught
    }
    const encounter = refFromId(encounterId)
    const input = { facilityId, patientId, encounter, media: { ...media },
      body: { patientId, ...('server' in encounter ? { encounterId: encounter.server } : {}), fileName: media.fileName, mediaType: media.mediaType,
        sizeBytes: media.sizeBytes, sha256Hex: media.sha256Hex, classification: 'phi', retentionClass: 'clinical-10y' } }
    try {
      return await runtime.commands.save<string>('ehr.document.upload', input as unknown as Json,
        { awaitMs: LIMITS.receiptWaitMs, ...('local' in encounter ? { dependsOn: [encounter.local] } : {}) })
    } catch (caught) { throw asHidApiError(caught) }
  },
}
