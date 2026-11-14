import { usesNovuBackend } from '../../../backendContract'
import { ImportedFromPaper, IMPORTS_PERMISSION } from '../../../staff/routes/ImportedFromPaper'
import { ImportedPatientHistory } from '../../../staff/routes/ImportedPatientHistory'
import { PatientReportedHealth } from '../../../staff/routes/PatientReportedHealth'
import { StaffImportedHistory } from '../../../staff/routes/StaffImportedHistory'
import { StaffPatientChat } from '../../../staff/routes/StaffPatientChat'
import { importedRecordsEnabled, staffPatientChatEnabled } from '../../../staff/stagingOnlyFeatures'
import type { Chart } from '../parts/chart'
import { useClinical } from '../parts/Workspace'

/**
 * Today's chart sections, below the consultation list and a visit (mounted once for both, ConsultWorkspace): staff
 * imported history, the patient assistant, "Reported by the patient", the imported medical history, and the Lab results
 * and medicines imported from paper (ImportedFromPaper, each behind its own read permission). Each is today's own
 * component, with today's reads, permission checks, build switches and keys (staff/routes/Clinical.tsx), so a
 * previous actor, facility, patient or permission set never survives; each key names its section, so React keeps the
 * sections apart while they stay mounted. clinical.css draws them in the design's card style. Direct care only, as today.
 */
export function TodaySections({ chart }: { chart: Chart }) {
  const { state, facility, permissions } = useClinical()
  if (!facility || chart.purpose !== 'direct-care') return null
  const actorId = state.status === 'ready' ? state.session.actor.id : ''
  const key = JSON.stringify([actorId, facility.id, chart.patientId, chart.purpose, permissions])
  const chatKey = JSON.stringify([actorId, facility.id, facility.membershipId, chart.patientId, chart.purpose, permissions])
  const novu = usesNovuBackend()

  return (
    <div className="hid-ehr-clinical-today">
      {/* Off unless the build turns them on: hid-system main does not serve their routes (stagingOnlyFeatures.ts). */}
      {!novu && permissions.includes('ehr.imported-history.read')
        ? <StaffImportedHistory key={`staff-imported-history:${key}`} facilityId={facility.id} patientId={chart.patientId} /> : null}
      {permissions.includes(novu ? 'ehr.note.read' : 'ehr.record-chat.use') && staffPatientChatEnabled() ? (
        <StaffPatientChat
          key={chatKey}
          facilityId={facility.id}
          facilityName={facility.name}
          patientId={chart.patientId}
          patientName={chart.patient.lookup.patient.fullName ?? chart.patient.hid}
          hid={chart.patient.hid}
        />
      ) : null}
      {permissions.includes('ehr.note.read') ? <PatientReportedHealth key={`reported-health:${key}`} facilityId={facility.id} patientId={chart.patientId} /> : null}
      {permissions.includes('ehr.note.read') && importedRecordsEnabled() ? (
        <ImportedPatientHistory
          key={`imported-records:${key}`}
          facilityId={facility.id}
          patientId={chart.patientId}
          purpose="direct-care"
          verify={chart.verify}
          canDownload={permissions.includes('ehr.document.read')}
        />
      ) : null}
      {/* Lab results and medicines read from the patient's paper records, each only for a role that may read its list. */}
      {permissions.includes(IMPORTS_PERMISSION.lab)
        ? <ImportedFromPaper key={`imported-lab:${key}`} kind="lab" facilityId={facility.id} patientId={chart.patientId} /> : null}
      {permissions.includes(IMPORTS_PERMISSION.pharmacy)
        ? <ImportedFromPaper key={`imported-pharmacy:${key}`} kind="pharmacy" facilityId={facility.id} patientId={chart.patientId} /> : null}
    </div>
  )
}
