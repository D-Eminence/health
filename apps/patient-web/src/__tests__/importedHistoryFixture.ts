import type { ImportedMedicalRecord } from '../importedRecords'

export const historyFixture: ImportedMedicalRecord[] = [{
  id: 'record-1', origin: 'patient-provided', currentVersionId: 'version-2', title: 'Preserved report',
  category: 'condition', infoType: 'patient-reported', createdAt: '2026-06-17T12:11:00Z', updatedAt: '2026-06-18T12:11:00Z',
  versions: [
    { id: 'version-2', versionNo: 2, origin: 'patient-provided', createdAt: '2026-06-18T12:11:00Z',
      record: 'Preserved multiline\nmedical information.', notes: '<script>unsafe()</script>', structuredData: { history: 'Original entry' }, transcriptionText: null },
    { id: 'version-1', versionNo: 1, origin: 'patient-provided', createdAt: '2026-06-17T12:11:00Z',
      record: 'Earlier entry.', notes: null, structuredData: null, transcriptionText: null },
  ],
  files: [
    { id: 'file-clean', recordVersionId: 'version-2', fileName: 'cleared.pdf', mediaType: 'application/pdf', sizeBytes: 42, createdAt: '2026-06-17T12:11:00Z', accessStatus: 'available' },
    { id: 'file-pending', recordVersionId: 'version-2', fileName: 'pending.pdf', mediaType: 'application/pdf', sizeBytes: 43, createdAt: '2026-06-17T12:11:00Z', accessStatus: 'pending-safety-verification' },
    { id: 'file-rejected', recordVersionId: 'version-2', fileName: 'rejected.pdf', mediaType: 'application/pdf', sizeBytes: 44, createdAt: '2026-06-17T12:11:00Z', accessStatus: 'rejected' },
  ],
}]

