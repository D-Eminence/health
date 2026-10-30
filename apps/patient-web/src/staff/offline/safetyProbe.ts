import type { Json, SafetyProbe } from '@hid/offline'
import { staffApi, type ClinicalRecord } from '../api'
import type { ReportedHealthProfile } from '../../profileParity'
import { currentOfflineRuntime, receiptOf } from './holder'

/**
 * The CC4 safety hold's two looks at the patient (§2.9, A8.3, A12.4): what the prescriber saw when the prescription was
 * saved, and what Health ID has just before it is first sent. Each is a hash of the patient's reported allergies and
 * medications, and of the visit's prescriptions. When they differ, the prescription waits for the prescriber's review.
 * A look that cannot be taken holds it too: the core then treats "nothing to compare" as changed.
 */

interface PrescriptionInput { facilityId: string; patientId: string; encounter: { server: string } | { local: string }
  safetyContext?: { ownBefore?: string[] } }

/** Marks a look whose own earlier prescriptions did not all reach Health ID: never equal to a capture's hash. */
const OWN_NOT_APPLIED = 'own-prescription-not-applied'

async function sha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Only what matters to a prescriber: the reported allergies and medications, trimmed. */
function safetyFacts(profile: ReportedHealthProfile | null) {
  return { allergies: profile?.allergies?.trim() || null, medications: profile?.currentMedications?.trim() || null }
}

/** The visit's prescriptions as a stable list: each one and its version, so any change or addition shows. */
function prescriptionFacts(items: readonly ClinicalRecord[]) {
  return items.map(item => [item.id, typeof item.rowVersion === 'number' ? item.rowVersion : null] as const).sort(([a], [b]) => a.localeCompare(b))
}

async function hashes(profile: ReportedHealthProfile | null, prescriptions: readonly ClinicalRecord[]) {
  return { allergiesSha256: await sha256(safetyFacts(profile)), encounterRxSha256: await sha256(prescriptionFacts(prescriptions)) }
}

export const staffSafetyProbe: SafetyProbe = {
  /** At save: the chart as the form showed it, from Health ID or the copy on this device. */
  async capture(input: Json) {
    const { facilityId, patientId, encounter } = input as unknown as PrescriptionInput
    // ehrReads reads through the runtime, which is made with this probe: loaded when first used, not with the runtime.
    const { ehrReads } = await import('./ehrReads')
    try {
      const profile = await ehrReads.reportedHealthProfile(facilityId, patientId)
      // A visit saved on this device has no prescriptions on Health ID yet.
      const prescriptions = 'server' in encounter
        ? (await ehrReads.records(facilityId, patientId, encounter.server, 'prescriptions')).items : []
      const seenAt = (currentOfflineRuntime()?.trustedNow().at ?? new Date()).toISOString()
      return { ...await hashes(profile, prescriptions), seenAt }
    } catch { return null }
  },
  /**
   * Before the first send: Health ID's answer now, never a saved copy. A read that fails is retried later by the core.
   * This device's own prescriptions on the visit saved before this one (`safetyContext.ownBefore`) were in front of the
   * prescriber, so they are matched by receipt and left out. One that never reached Health ID (discarded or refused)
   * holds this one: it relied on it.
   */
  async current(input: Json, resolved: Record<string, string>) {
    const { facilityId, patientId, safetyContext } = input as unknown as PrescriptionInput
    const encounterId = resolved.encounterId
    if (!encounterId) throw new Error('The visit is not on Health ID yet.')
    const [profile, prescriptions] = await Promise.all([
      staffApi.reportedHealthProfile(facilityId, patientId),
      staffApi.records(facilityId, patientId, encounterId, 'prescriptions'),
    ])
    const own = new Set<string>()
    const runtime = currentOfflineRuntime()
    for (const commandId of safetyContext?.ownBefore ?? []) {
      const receipt = runtime ? await receiptOf(runtime, commandId) : null
      if (!receipt?.resourceId) return { allergiesSha256: (await hashes(profile, [])).allergiesSha256, encounterRxSha256: OWN_NOT_APPLIED }
      own.add(receipt.resourceId)
    }
    return hashes(profile, prescriptions.items.filter(item => !own.has(item.id)))
  },
}
