import type { Encounter } from '../../../../staff/api'
import type { Chart } from '../../parts/chart'

/**
 * Orders raised from an encounter: prescriptions and lab requests, sending them to a pharmacy or laboratory, and
 * what the receiving facility reported. Placeholder until built.
 */
export function EncounterOrderPages() {
  return <p>Orders</p>
}

/** The "Connected orders" part of an encounter's "Available actions" card. Placeholder until built. */
export function EncounterOrders(_props: { chart: Chart; encounter: Encounter }) {
  return null
}
