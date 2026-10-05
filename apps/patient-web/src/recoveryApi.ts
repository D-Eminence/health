import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient } from '@hid/http'
import { getEnvironment } from './env'

export type RecoveryAudience = 'staff' | 'admin'

export interface RecoveryChallenge {
  accepted: true
  challengeId: string
  deliveryChannels: ['email', 'sms']
  expiresInSeconds: number
  resendAfterSeconds: number
}

/** Identity's public OTP contract resets the account associated with an email. */
export function createPrincipalRecoveryApi(audience: RecoveryAudience) {
  const app = audience === 'staff' ? 'staff-web' : 'admin-web'
  const client = createRegisteredBrowserClient(createApiClient({
    baseUrl: getEnvironment().apiBaseUrl,
    clientId: app,
    sessionMode: 'cookie',
  }), app)
  const purpose = 'PASSWORD_RESET' as const

  return {
    start(identifier: string, turnstileToken: string) {
      return client.post<RecoveryChallenge>('/api/v1/auth/otp/start', {
        identifier, purpose, turnstileToken, turnstileAction: `${audience}-reset`,
      }, { auth: 'none' })
    },
    verify(challengeId: string, code: string) {
      return client.post<{ verified: true; challengeId: string; verificationToken: string }>(
        '/api/v1/auth/otp/verify', { challengeId, purpose, code }, { auth: 'none' })
    },
    complete(challengeId: string, verificationToken: string, newPassword: string) {
      return client.post<{ completed: true }>('/api/v1/auth/otp/complete', {
        challengeId, purpose, verificationToken, newPassword,
      }, { auth: 'none' })
    },
  }
}
