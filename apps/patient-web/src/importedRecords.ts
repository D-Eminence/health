export interface ImportedRecordFile {
  id: string; recordVersionId: string | null; fileName: string | null; mediaType: string | null
  sizeBytes: number | string | null; createdAt: string
  accessStatus: 'available' | 'rejected' | 'pending-safety-verification'
}
export interface ImportedRecordVersion {
  id: string; versionNo: number; origin: string; createdAt: string
  record: unknown; notes: unknown; structuredData: unknown; transcriptionText: unknown
}
export interface ImportedMedicalRecord {
  id: string; origin: 'patient-provided' | 'provider-authored'; currentVersionId: string
  title: string | null; category: string | null; infoType: string | null
  createdAt: string; updatedAt: string; versions: ImportedRecordVersion[]; files: ImportedRecordFile[]
}
export interface ImportedRecordsResponse { importedRecords: ImportedMedicalRecord[]; limit: number }
export interface ImportedAttachmentDownload { url: string; expiresInSeconds: number }

/** Only the public history response is consumed, never raw migration payloads. */
export function parseImportedRecords(value: unknown): ImportedMedicalRecord[] {
  if (!Array.isArray(value)) throw new Error('Imported medical history returned an invalid response.')
  const ids = new Set<string>()
  for (const record of value) {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string' || ids.has(record.id)
      || !['patient-provided', 'provider-authored'].includes(record.origin)
      || typeof record.currentVersionId !== 'string' || typeof record.createdAt !== 'string'
      || !Array.isArray(record.versions) || !Array.isArray(record.files)
      || !record.versions.some((version: ImportedRecordVersion) => version.id === record.currentVersionId)) {
      throw new Error('Imported medical history returned an invalid response.')
    }
    ids.add(record.id)
    for (const field of ['title', 'category', 'infoType']) {
      if (record[field] != null && typeof record[field] !== 'string') throw new Error('Imported medical history returned an invalid response.')
    }
    for (const version of record.versions) {
      if (!version || typeof version.id !== 'string' || !Number.isInteger(version.versionNo) || version.versionNo < 1
        || typeof version.createdAt !== 'string') throw new Error('Imported medical history returned an invalid response.')
    }
    for (const file of record.files) {
      if (!file || typeof file.id !== 'string' || (file.fileName != null && typeof file.fileName !== 'string')
        || !['available', 'rejected', 'pending-safety-verification'].includes(file.accessStatus)) {
        throw new Error('Imported medical history returned an invalid response.')
      }
    }
  }
  return value as ImportedMedicalRecord[]
}
