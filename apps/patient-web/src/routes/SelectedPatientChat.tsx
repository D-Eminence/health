import { useMemo } from 'react'
import { usesNovuBackend } from '../backendContract'
import { useSession } from '../session'
import { useDocumentTitle } from '../authSteps'
import { PatientChat } from './Chat'
import { StagingChatConversation, type StagingChatConversationApi } from './StagingChat'

/** Each screen uses its server's actual wire contract; no availability fallback. */
export function SelectedPatientChat() {
  useDocumentTitle('Ask about your records · Health ID')
  return usesNovuBackend() ? <NovuPatientChat /> : <PatientChat />
}

function NovuPatientChat() {
  const { state, api } = useSession()
  const conversation = useMemo<StagingChatConversationApi>(() => ({
    chat: (question, options) => api.novuChat(question, options?.signal),
    chatHistory: signal => api.novuChatHistory(signal),
    clearChatHistory: signal => api.clearNovuChatHistory(signal),
    chatSource: (kind, id, signal) => api.chatSource(kind, id, signal),
  }), [api])
  if (state.status !== 'authenticated' || state.principal.kind !== 'patient') return null
  return <StagingChatConversation key={state.principal.subjectId} api={conversation} />
}
