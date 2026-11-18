import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { usesNovuBackend } from '../../../backendContract'
import { Drawer } from '../../../kasuwa/interactive'
import { Button } from '../../../kasuwa/ui'
import { StaffPatientChat } from '../../../staff/routes/StaffPatientChat'
import { staffPatientChatEnabled } from '../../../staff/stagingOnlyFeatures'
import type { Chart } from './chart'
import { useClinical } from './Workspace'

/**
 * "Ask about this patient" (the record assistant), reachable from the patient banner on every chart page and from the
 * patient page (QA P1-9), not only at the foot of Consultation. Today's checks: direct care only, the same permission
 * and build switch, and the conversation keyed by actor, membership, facility, patient, purpose and permissions, so
 * nothing of another patient or session survives. It opens beside the page, so the doctor keeps their place.
 */
export function PatientAssistant({ chart, size = 'sm' }: { chart: Chart; size?: 'sm' | 'md' }) {
  const { state, facility, permissions } = useClinical()
  const [open, setOpen] = useState(false)
  if (!facility || chart.purpose !== 'direct-care') return null
  if (!permissions.includes(usesNovuBackend() ? 'ehr.note.read' : 'ehr.record-chat.use') || !staffPatientChatEnabled()) return null
  const actorId = state.status === 'ready' ? state.session.actor.id : ''
  const key = JSON.stringify([actorId, facility.id, facility.membershipId, chart.patientId, chart.purpose, permissions])
  const name = chart.patient.lookup.patient.fullName ?? chart.patient.hid
  return (
    <>
      <Button size={size} icon={Sparkles} onClick={() => setOpen(true)}>Ask about this patient</Button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Record assistant">
        {open ? <StaffPatientChat key={key} inline facilityId={facility.id} facilityName={facility.name} patientId={chart.patientId}
          patientName={name} hid={chart.patient.hid} /> : null}
      </Drawer>
    </>
  )
}
