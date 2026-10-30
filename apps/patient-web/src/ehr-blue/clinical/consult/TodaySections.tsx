import { usesNovuBackend } from '../../../backendContract'
import { ImportedPatientHistory } from '../../../staff/routes/ImportedPatientHistory'
import { PatientReportedHealth } from '../../../staff/routes/PatientReportedHealth'
import { StaffImportedHistory } from '../../../staff/routes/StaffImportedHistory'
import { StaffPatientChat } from '../../../staff/routes/StaffPatientChat'
import { importedRecordsEnabled, staffPatientChatEnabled } from '../../../staff/stagingOnlyFeatures'
import type { Chart } from '../parts/chart'
import { useClinical } from '../parts/Workspace'

/**
 * Today's chart sections, on the encounter page: staff imported history, the patient assistant, "Reported by the
 * patient" and the imported medical history. Each is today's own component, with today's reads, permission checks,
 * build switches and keys (staff/routes/Clinical.tsx), so a previous actor, facility, patient or permission set never
 * survives; clinical.css draws them in the design's card style. Direct care only, as today.
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
        ? <StaffImportedHistory key={key} facilityId={facility.id} patientId={chart.patientId} /> : null}
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
      {permissions.includes('ehr.note.read') ? <PatientReportedHealth key={key} facilityId={facility.id} patientId={chart.patientId} /> : null}
      {permissions.includes('ehr.note.read') && importedRecordsEnabled() ? (
        <ImportedPatientHistory
          key={key}
          facilityId={facility.id}
          patientId={chart.patientId}
          purpose="direct-care"
          verify={chart.verify}
          canDownload={permissions.includes('ehr.document.read')}
        />
      ) : null}
    </div>
  )
}
