import { getEnvironment } from './env'

/** The shared portal bundle is also served on provider/admin domains. */
export function patientChatHost(hostname = window.location.hostname): boolean {
  const environment = getEnvironment().name
  return (environment === 'staging' && hostname === 'staging.healthidentitydirectory.com')
    || (environment === 'production' && hostname === 'app.healthidentitydirectory.com')
    || (environment === 'local' && ['localhost', '127.0.0.1'].includes(hostname))
}
export const patientChatEnabled = () => getEnvironment().patientChatEnabled && patientChatHost()
