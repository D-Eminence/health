import { SupportChat } from '@hid/ui'
import { getEnvironment } from './env'
import { patientChatHost } from './chatFeatures'
import { useSession } from './session'

export function PatientSupport() {
  const { api } = useSession()
  const environment = getEnvironment()
  if (!environment.supportChatEnabled || !environment.supportContact || !patientChatHost()) return null
  return <SupportChat contact={environment.supportContact} send={api.supportChat} />
}
