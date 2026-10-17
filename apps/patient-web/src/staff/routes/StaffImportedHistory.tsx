import { useCallback } from 'react'
import { ImportedHistoryView, type ImportedHistoryLoad } from '../../ImportedHistoryPage'
import { staffApi } from '../api'

/**
 * Imported legacy medical history for the patient opened through governed access, as hid-system main serves it
 * (ehr.imported-history.read, direct care only). The caller keys this component by actor, facility, patient and
 * purpose, so a previous scope never survives. The server decides, on every request, whether the patient shares
 * and whether consent holds at this facility.
 */
export function StaffImportedHistory({ facilityId, patientId }: { facilityId: string; patientId: string }) {
  const load = useCallback<ImportedHistoryLoad>((cursor, signal) => staffApi.importedHistory(facilityId, patientId, cursor, signal), [facilityId, patientId])
  return <ImportedHistoryView load={load} audience="staff" />
}
