/**
 * Effective offline policy (§2.3, amendment A5).
 *
 * The app passes its `VITE_HID_OFFLINE_*` values in; nothing here reads the
 * build environment. Enabled only when every condition holds:
 *   mode != 'off' && appHost in hosts && (mode == 'on' || facility in facilities)
 *   && opted in (or an existing vault for this account and facility opened)
 *   && the password typed at sign-in has length >= 12
 */

import { LIMITS, type OfflineMode, type OfflinePolicy, type PolicyReason } from './contracts'
import type { OfflineEnv } from './types'

export interface OfflineConfig {
  readonly mode: OfflineMode
  readonly facilities: ReadonlySet<string>
  readonly hosts: ReadonlySet<string>
  readonly debug: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function list(value: string | null | undefined): string[] {
  return (value ?? '').split(',').map(v => v.trim()).filter(Boolean)
}

export function parseOfflineEnv(env: OfflineEnv): OfflineConfig {
  const raw = (env.mode ?? '').trim().toLowerCase()
  const mode: OfflineMode = raw === 'pilot' || raw === 'on' ? raw : 'off'
  return {
    mode,
    facilities: new Set(list(env.facilities).filter(id => UUID.test(id)).map(id => id.toLowerCase())),
    hosts: new Set(list(env.hosts).map(h => h.toLowerCase())),
    debug: (env.debug ?? '').trim() === 'true',
  }
}

export interface PolicyContext {
  readonly appHost: string
  /** Unknown before sign-in. */
  readonly facilityId?: string | null
  /** null: not asked yet. */
  readonly optedIn?: boolean | null
  /** null: no password typed in this tab (online reload); an opened vault proves it. */
  readonly passwordOk?: boolean | null
  readonly supported?: boolean
}

/** Whether a facility may use offline at all under this config. */
export function facilityAllowed(config: OfflineConfig, appHost: string, facilityId: string): PolicyReason | null {
  if (config.mode === 'off') return 'mode-off'
  if (!config.hosts.has(appHost.toLowerCase())) return 'host-off'
  if (config.mode === 'pilot' && !config.facilities.has(facilityId.toLowerCase())) return 'facility-off'
  return null
}

export function evaluatePolicy(config: OfflineConfig, ctx: PolicyContext): OfflinePolicy {
  const deny = (reason: PolicyReason): OfflinePolicy => ({ mode: config.mode, enabled: false, reason })
  if (config.mode === 'off') return deny('mode-off')
  if (!config.hosts.has(ctx.appHost.toLowerCase())) return deny('host-off')
  if (ctx.supported === false) return deny('unsupported-browser')
  if (ctx.facilityId != null) {
    const reason = facilityAllowed(config, ctx.appHost, ctx.facilityId)
    if (reason) return deny(reason)
  }
  if (ctx.passwordOk === false) return deny('password-too-short')
  if (ctx.optedIn !== true) return deny('not-opted-in')
  if (ctx.facilityId == null) return deny('facility-off')
  return { mode: config.mode, enabled: true }
}

export function passwordLongEnough(password: string): boolean {
  return password.length >= LIMITS.minPasswordLength
}

/** The sync panel line for a reason. Plain, calm English. */
export function policyReasonText(reason: PolicyReason): string {
  switch (reason) {
    case 'mode-off': return 'Offline use is switched off for Health ID.'
    case 'host-off': return 'Offline use is not available in this app.'
    case 'facility-off': return 'Offline use is not switched on for this facility.'
    case 'not-opted-in': return 'This device does not keep an offline copy.'
    case 'password-too-short': return 'Change your password to 12+ characters to use offline'
    case 'unsupported-browser': return 'This browser cannot keep an offline copy safely.'
  }
}
