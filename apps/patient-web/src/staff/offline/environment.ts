import { parseOfflineEnv, type OfflineConfig, type OfflineEnv } from '@hid/offline'
import { PUBLIC_ENVIRONMENT } from '../../publicEnvironment'
import { resolveStaffProductHostname } from '../../productHostname'

/**
 * The offline block of the build's configuration (OFFLINE-CONTRACT §2.3, A7), read from the four VITE_HID_OFFLINE_*
 * variables Stream C adds to publicEnvironment.ts, and parsed by the core's own `parseOfflineEnv`. Read through this
 * accessor only, so a test can set it, and a build without the variables is offline 'off': exactly today's behaviour.
 */
function fromBuild(): OfflineEnv {
  const read = PUBLIC_ENVIRONMENT as Readonly<Record<string, string | undefined>>
  return { mode: read.VITE_HID_OFFLINE_MODE ?? null, facilities: read.VITE_HID_OFFLINE_FACILITIES ?? null,
    hosts: read.VITE_HID_OFFLINE_HOSTS ?? null, debug: read.VITE_HID_OFFLINE_DEBUG ?? null }
}

interface TestEnvironment {
  mode?: string
  facilities?: readonly string[] | string
  hosts?: readonly string[] | string
  /** The config app key this page is served as; tests run on localhost, which is no product host. */
  appHost?: string | null
}

let override: { env: OfflineEnv; appHost: string | null } | null = null

/** Tests only: replaces what the build says (pilot on `ehr` and `ocr`, served as `ehr`, unless given). `null` goes back to the build. */
export function setOfflineEnvironmentForTests(value: TestEnvironment | null): void {
  const joined = (item: readonly string[] | string | undefined, fallback: string) => item === undefined ? fallback : typeof item === 'string' ? item : item.join(',')
  override = value === null ? null : {
    env: { mode: value.mode ?? 'pilot', facilities: joined(value.facilities, ''), hosts: joined(value.hosts, 'ehr,ocr'), debug: 'false' },
    appHost: value.appHost === undefined ? 'ehr' : value.appHost,
  }
}

/** The raw variables, as the core's factory takes them. */
export function offlineEnv(): OfflineEnv {
  return override?.env ?? fromBuild()
}

export function offlineConfig(): OfflineConfig {
  return parseOfflineEnv(offlineEnv())
}

/** The config's app key for each staff product host that can work offline (config `hosts`, A7). */
const HOST_KEYS: Readonly<Record<string, string>> = { ehr: 'ehr', migrate: 'ocr' }

/** This page's app key (`ehr`, `ocr`), or null on a host that is not one of them. */
export function offlineAppHost(hostname: string = window.location.hostname): string | null {
  if (override) return override.appHost
  const product = resolveStaffProductHostname(hostname)?.key
  return product ? HOST_KEYS[product] ?? product : null
}

/** Whether this page's host is one the build lists for offline. */
export function offlineHostAllowed(): boolean {
  const config = offlineConfig()
  const appHost = offlineAppHost()
  return config.mode !== 'off' && appHost !== null && config.hosts.has(appHost)
}

/**
 * Whether offline may be offered at `facilityId` at all (before any person opts in): the mode is on, or the
 * facility is in the pilot list, on a host the build lists. Drives the visit-length default (D4).
 */
export function offlineFacility(facilityId: string | undefined): boolean {
  if (!facilityId || !offlineHostAllowed()) return false
  const config = offlineConfig()
  return config.mode === 'on' || (config.mode === 'pilot' && config.facilities.has(facilityId.toLowerCase()))
}
