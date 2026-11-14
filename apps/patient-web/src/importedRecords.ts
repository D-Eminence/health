/**
 * Imported legacy medical history as hid-system `main` serves it (#94, migration
 * 0099, ADR-067; docs/INTERFACE_CONTRACT.md, "Imported legacy medical history").
 * It is never part of `GET /ehr/me/records`: the patient reads
 * `GET /ehr/me/imported-history`, staff read
 * `GET /ehr/patients/:patientId/imported-history`, and each answer is a page.
 * Legacy text is data, rendered as text and never as markup.
 */

export interface ImportedRecordFile {
  id: string; recordVersionId: string | null; fileName: string | null; mediaType: string | null
  sizeBytes: number | string | null; createdAt: string
  /** Every file is "pending-safety-verification" for now: no attachment or download exists yet. */
  accessStatus: 'available' | 'rejected' | 'pending-safety-verification'
}
export interface ImportedRecordVersion {
  id: string; versionNo: number; origin: string; createdAt: string
  record: unknown; notes: unknown; structuredData: unknown; transcriptionText: unknown
}
export interface ImportedMedicalRecord {
  id: string; origin: 'patient-provided' | 'provider-authored'; currentVersionId: string
  title: string | null; category: string | null; infoType: string | null
  createdAt: string; updatedAt: string
  /** Newest first; at most `limits.versionsPerRecord`. */
  versions: ImportedRecordVersion[]; versionsTruncated?: boolean
  /** Oldest first; at most `limits.filesPerRecord`. */
  files: ImportedRecordFile[]; filesTruncated?: boolean
}
export interface ImportedHistoryLimits { records: number; versionsPerRecord: number; filesPerRecord: number }
export interface ImportedHistoryPage {
  /** Staff reads only: whether the patient shares, as the database decides for this request. Absent on the patient's own read. */
  shared?: boolean
  records: ImportedMedicalRecord[]
  limits: ImportedHistoryLimits
  /** True when more records exist; `nextCursor` then fetches the next page. */
  moreRecords: boolean
  nextCursor: string | null
}

/** The patient's choice to share imported history with the staff who treat them (Identity). */
export interface ImportedHistorySharing { shared: boolean; updatedAt: string | null }
export interface ImportedHistorySharingChange extends ImportedHistorySharing { changed: boolean }

const bad = () => new Error('Imported medical history returned an invalid response.')
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const optionalText = (value: unknown) => value == null || typeof value === 'string'

function parseVersion(value: unknown): ImportedRecordVersion {
  if (!object(value) || typeof value.id !== 'string' || !Number.isInteger(value.versionNo) || Number(value.versionNo) < 1
    || typeof value.createdAt !== 'string' || typeof value.origin !== 'string') throw bad()
  return value as unknown as ImportedRecordVersion
}

function parseFile(value: unknown): ImportedRecordFile {
  if (!object(value) || typeof value.id !== 'string' || !optionalText(value.fileName) || !optionalText(value.mediaType)
    || typeof value.createdAt !== 'string'
    || !['available', 'rejected', 'pending-safety-verification'].includes(String(value.accessStatus))) throw bad()
  return value as unknown as ImportedRecordFile
}

function parseRecord(value: unknown): ImportedMedicalRecord {
  if (!object(value) || typeof value.id !== 'string' || !['patient-provided', 'provider-authored'].includes(String(value.origin))
    || typeof value.currentVersionId !== 'string' || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string'
    || !optionalText(value.title) || !optionalText(value.category) || !optionalText(value.infoType)
    || !Array.isArray(value.versions) || !Array.isArray(value.files)
    || typeof value.versionsTruncated !== 'boolean' || typeof value.filesTruncated !== 'boolean') throw bad()
  return { ...(value as unknown as ImportedMedicalRecord), versions: value.versions.map(parseVersion), files: value.files.map(parseFile) }
}

/** Only the public history answer is consumed, never a raw migration payload. */
export function parseImportedHistory(value: unknown, staff: boolean): ImportedHistoryPage {
  if (!object(value) || !Array.isArray(value.records) || !object(value.limits) || !object(value.truncated)
    || typeof value.truncated.records !== 'boolean' || !(value.nextCursor === null || typeof value.nextCursor === 'string')
    || (staff && typeof value.shared !== 'boolean')) throw bad()
  const { records, versionsPerRecord, filesPerRecord } = value.limits
  if (![records, versionsPerRecord, filesPerRecord].every(limit => Number.isSafeInteger(limit) && Number(limit) > 0)) throw bad()
  const ids = new Set<string>()
  const parsed = value.records.map(parseRecord)
  for (const record of parsed) {
    if (ids.has(record.id)) throw bad()
    ids.add(record.id)
  }
  return {
    ...(staff ? { shared: value.shared as boolean } : {}), records: parsed,
    limits: { records: Number(records), versionsPerRecord: Number(versionsPerRecord), filesPerRecord: Number(filesPerRecord) },
    moreRecords: value.truncated.records, nextCursor: value.nextCursor,
  }
}

export function parseImportedHistorySharing(value: unknown): ImportedHistorySharing {
  if (!object(value) || typeof value.shared !== 'boolean' || !(value.updatedAt === null || typeof value.updatedAt === 'string')) {
    throw new Error('Imported history sharing returned an invalid response.')
  }
  return { shared: value.shared, updatedAt: value.updatedAt }
}

export function parseImportedHistorySharingChange(value: unknown): ImportedHistorySharingChange {
  if (!object(value) || typeof value.changed !== 'boolean') throw new Error('Imported history sharing returned an invalid response.')
  return { ...parseImportedHistorySharing(value), changed: value.changed }
}

/**
 * The health details a patient kept on hid-1.0's profile, carried over for a migrated patient (Novu:
 * ehr.imported_patient_health_profiles, read by imported-records.query.ts readImportedHealthProfile). Read-only:
 * nothing writes them now. hid-1.0 held each as free text (its patients table).
 */
export const IMPORTED_HEALTH_FIELDS = ['blood_group', 'genotype', 'allergies', 'current_medications', 'chronic_conditions', 'medical_notes'] as const
export type ImportedHealthField = typeof IMPORTED_HEALTH_FIELDS[number]
export interface ImportedHealthProfile {
  /** Only the fields with something in them. */
  content: Partial<Record<ImportedHealthField, string>>
  updatedAt: string | null
}

/**
 * A field kept only when it holds text. hid-1.0 gave every patient a blood group of 'Unknown' until they chose one
 * (20260407130000_secure_backend_foundation.sql), which says nothing about them and is not shown.
 */
function healthText(field: ImportedHealthField, value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || (field === 'blood_group' && /^unknown$/i.test(text))) return null
  return text
}

/**
 * The records answer's importedHealthProfile: null when it is absent, malformed or holds nothing to show. It is an
 * extra, so a shape it cannot read hides it rather than the records it came with.
 */
export function parseImportedHealthProfile(value: unknown): ImportedHealthProfile | null {
  if (!object(value) || !object(value.content)) return null
  const content: Partial<Record<ImportedHealthField, string>> = {}
  for (const field of IMPORTED_HEALTH_FIELDS) {
    const text = healthText(field, value.content[field])
    if (text !== null) content[field] = text
  }
  if (Object.keys(content).length === 0) return null
  return { content, updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null }
}

export interface ImportedRecordsResponse { importedRecords: ImportedMedicalRecord[]; limit: number }
export interface ImportedAttachmentDownload { url: string; expiresInSeconds: number }

/** The staging branches' imported-records answer (`/imported-records`), which hid-system main does not serve. */
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
