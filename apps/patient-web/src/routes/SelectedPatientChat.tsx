import { useMemo } from 'react'
import { usesNovuBackend } from '../backendContract'
import { useSession } from '../session'
import { PatientChat } from './Chat'
import { PatientRecordChat, type PatientRecordChatApi } from './PatientRecordChat'

/** Each screen uses its server's actual wire contract; no availability fallback. */
export function SelectedPatientChat() {
  return usesNovuBackend() ? <NovuPatientChat /> : <PatientChat />
}

/** hid-system staging-novu-ci-20261005 (#167): the patient's own screen; the hospital chat keeps StagingChat.tsx. */
function NovuPatientChat() {
  const { state, api } = useSession()
  const conversation = useMemo<PatientRecordChatApi>(() => ({
    chat: (question, signal) => api.novuChat(question, signal),
    chatHistory: signal => api.novuChatHistory(signal),
    clearChatHistory: signal => api.clearNovuChatHistory(signal),
    chatSource: (kind, id, signal) => api.novuChatSource(kind, id, signal),
  }), [api])
  if (state.status !== 'authenticated' || state.principal.kind !== 'patient') return null
  return <PatientRecordChat key={state.principal.subjectId} api={conversation} />
}
