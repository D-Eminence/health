import { useCallback, useMemo, useState } from 'react'
import { StaffRecordChat, type StaffRecordChatApi } from './StaffRecordChat'
import { staffApi } from '../api'
import { usesNovuBackend } from '../../backendContract'
import { StagingStaffPatientChat } from './StagingStaffPatientChat'

/**
 * "Ask about this patient" on a patient's chart (hid-system ADR-069, 0101). The caller keys this component by
 * actor/membership/facility/patient/purpose, and mounts it only for a member who holds `ehr.record-chat.use`.
 * It is for direct care: when Identity ends or changes the member's access to the patient (consent withdrawn, a
 * session that ended, break-glass), the assistant closes and says so.
 */
type PatientChatProps = { facilityId: string; facilityName: string; patientId: string; patientName: string; hid: string }
export function StaffPatientChat(props: PatientChatProps) {
  return usesNovuBackend() ? <StagingStaffPatientChat {...props} /> : <MainStaffPatientChat {...props} />
}
function MainStaffPatientChat({facilityId,facilityName,patientId,patientName,hid}:{
  facilityId:string;facilityName:string;patientId:string;patientName:string;hid:string
}) {
  const [open,setOpen]=useState(false)
  const [denied,setDenied]=useState(false)
  const onAccessEnded=useCallback(()=>setDenied(true),[])
  const api=useMemo<StaffRecordChatApi>(()=>({
    availability:signal=>staffApi.recordChatAvailability(facilityId,patientId,signal),
    ask:(question,ask,options)=>staffApi.recordChat(facilityId,patientId,question,ask,options?.signal),
    history:signal=>staffApi.recordChatHistory(facilityId,patientId,signal),
    clear:signal=>staffApi.clearRecordChatHistory(facilityId,patientId,signal),
  }),[facilityId,patientId])
  return <section className="staff-patient-chat" aria-label={`Record assistant for ${patientName}`}>
    <button type="button" className="record-chat-reset" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      {open?'Close patient assistant':'Ask about this patient'}
    </button>
    {open&&(denied?<p role="alert">Patient access has ended or changed. Reopen the patient through governed access.</p>
      :<StaffRecordChat api={api} patientName={patientName} hid={hid} facilityName={facilityName} onAccessEnded={onAccessEnded} />)}
  </section>
}
