import type { OfflineMode } from '@hid/offline'
import { PUBLIC_ENVIRONMENT } from '../../publicEnvironment'
import { resolveStaffProductHostname } from '../../productHostname'

/**
 * The offline block of the build's configuration (OFFLINE-CONTRACT §2.3), read
 * from the four VITE_HID_OFFLINE_* variables Stream C adds to publicEnvironment.ts.
 * Read through this accessor only, so a test can set it and a build without the
 * variables is offline 'off': exactly today's behaviour.
 */
export interface OfflineEnvironment {
  readonly mode: OfflineMode
  /** Facilities in the pilot (mode 'pilot'); ignored in mode 'on'. */
  readonly facilities: readonly string[]
  /** Config app keys built with offline (`ehr`, `ocr`); empty means the build did not say. */
  readonly hosts: readonly string[]
  readonly debug: boolean
}

const OFF: OfflineEnvironment = { mode: 'off', facilities: [], hosts: [], debug: false }

function list(value: string | undefined): string[] {
  return (value ?? '').split(',').map(item => item.trim()).filter(Boolean)
}

function fromBuild(): OfflineEnvironment {
  const read = PUBLIC_ENVIRONMENT as Readonly<Record<string, string | undefined>>
  const mode = read.VITE_HID_OFFLINE_MODE
  if (mode !== 'pilot' && mode !== 'on') return OFF
  return { mode, facilities: list(read.VITE_HID_OFFLINE_FACILITIES).map(id => id.toLowerCase()), hosts: list(read.VITE_HID_OFFLINE_HOSTS),
    debug: read.VITE_HID_OFFLINE_DEBUG === 'true' }
}

let override: OfflineEnvironment | null = null

/** Tests only: replaces what the build says. `null` goes back to the build. */
export function setOfflineEnvironmentForTests(value: Partial<OfflineEnvironment> | null): void {
  override = value === null ? null : { ...OFF, ...value }
}

export function offlineEnvironment(): OfflineEnvironment {
  return override ?? fromBuild()
}

/** The config's app key for each staff product host that can work offline (config `hosts`). */
const HOST_KEYS: Readonly<Record<string, string>> = { ehr: 'ehr', migrate: 'ocr' }

/** Whether this page's host is one the build lists. A build that names no hosts was built for this host alone. */
export function offlineHostAllowed(hostname: string = window.location.hostname): boolean {
  const { mode, hosts } = offlineEnvironment()
  if (mode === 'off') return false
  if (hosts.length === 0) return true
  const product = resolveStaffProductHostname(hostname)?.key
  return product !== undefined && hosts.includes(HOST_KEYS[product] ?? product)
}

/**
 * Whether offline may be offered at `facilityId` at all (before any person opts in): the mode is on, or the
 * facility is in the pilot list, and the host is one the build lists. Drives the visit-length default (D4).
 */
export function offlineFacility(facilityId: string | undefined): boolean {
  if (!facilityId || !offlineHostAllowed()) return false
  const { mode, facilities } = offlineEnvironment()
  return mode === 'on' || (mode === 'pilot' && facilities.includes(facilityId.toLowerCase()))
}
