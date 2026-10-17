import { useMemo, useState } from 'react'
import { isHidApiError } from '@hid/http'
import { StagingChatConversation, type StagingChatConversationApi } from '../../routes/StagingChat'
import { staffApi } from '../api'

/**
 * The hospital chat of hid-system's staging branches (`staging-novu-ci-20261005`), kept as it was: the staging
 * contract (`ready | preparing`, no notice, 500 characters). hid-system main serves staff record chat under the
 * contract StaffRecordChat follows (ADR-069), so this is no longer mounted.
 */
/** The caller keys this component by actor/membership/facility/patient/purpose. */
export function StagingStaffPatientChat({facilityId,facilityName,patientId,patientName,hid}:{
  facilityId:string;facilityName:string;patientId:string;patientName:string;hid:string
}) {
  const [open,setOpen]=useState(false)
  const [denied,setDenied]=useState(false)
  const api=useMemo<StagingChatConversationApi>(()=>{
    const protect=async<T,>(operation:Promise<T>):Promise<T>=>{
      try{return await operation}
      catch(error){
        if(isHidApiError(error)&&([401,403].includes(error.status)||error.code==='CHAT_ACCESS_CHANGED'))setDenied(true)
        throw error
      }
    }
    return {
      chat:(question,options)=>protect(staffApi.patientChat(facilityId,patientId,question,options?.signal)),
      chatHistory:signal=>protect(staffApi.patientChatHistory(facilityId,patientId,signal)),
      clearChatHistory:signal=>protect(staffApi.clearPatientChatHistory(facilityId,patientId,signal)),
      chatSource:(kind,id,signal)=>protect(staffApi.patientChatSource(facilityId,patientId,kind,id,signal)),
    }
  },[facilityId,patientId])
  return <section className="staff-patient-chat" aria-label={`Record assistant for ${patientName}`}>
    <button type="button" className="record-chat-reset" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      {open?'Close patient assistant':'Ask about this patient'}
    </button>
    {open&&(denied?<p role="alert">Patient access has ended or changed. Reopen the patient through governed access.</p>
      :<StagingChatConversation api={api} staff={{patientName,hid,facilityName}} />)}
  </section>
}
