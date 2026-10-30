import type { EhrBluePage } from '../types'
import { BoxIcon, ClockIcon, FlagIcon, ReceiptIcon, ShieldIcon, TagIcon, TruckIcon, VehicleIcon } from '../parts/icons'
import { SampleWorkspace } from '../parts/sample/SampleWorkspace'
import type { SampleDefinition } from '../parts/sample/model'
import { ambulanceSample, qualitySample, servicesSample, shiftsSample, vehiclesSample } from './admin'
import { billingSample, insuranceSample, policiesSample } from './finance'
import { inventorySample, procurementSample } from './supply'

/**
 * A sample page at `base` and every address below it ('insurance/*'): the frame's Home dashboards and Notifications
 * drawer link to a record there (/provider/insurance/<id>), which opens the list at the base. Keyed by the page, so
 * moving between two sample pages (Stock and Procurement) starts the other one afresh instead of carrying one page's
 * records into the other.
 */
function sample(base: string, page: Omit<EhrBluePage, 'path' | 'status' | 'element'>, definition: SampleDefinition): EhrBluePage {
  return { ...page, path: `${base}/*`, status: 'sample', element: <SampleWorkspace key={definition.id} base={base} definition={definition} /> }
}

/**
 * The sample-only workspaces: the design's list, create form and record view for each, with fictional records kept
 * in the page's memory only. Nothing here reaches Health ID: no request, no browser storage, no record in the address.
 *
 * Paths are the frame's addresses for these workspaces (the design's module ids, except Patient billing at
 * patient-billing, as billing is today's live Facility subscription, and Supply at supply). As in the design's
 * navigation, Policies is a tab of Insurance & Claims (Claims | Policies) and Procurement a tab of Supply (Stock |
 * Procurement): the frame draws the tabs above the heading and gives a tab no sidebar entry of its own.
 */
export const samplePages: EhrBluePage[] = [
  sample('patient-billing', { group: 'Finance', label: 'Patient billing', icon: <ReceiptIcon /> }, billingSample),
  sample('insurance', { group: 'Finance', label: 'Insurance & Claims', tabLabel: 'Claims', icon: <ShieldIcon /> }, insuranceSample),
  sample('policies', { group: 'Finance', label: 'Policies', tabOf: 'insurance', icon: <ShieldIcon /> }, policiesSample),
  sample('services', { group: 'Settings', label: 'Service catalogue', icon: <TagIcon /> }, servicesSample),
  sample('supply', { group: 'Supply', label: 'Supply', tabLabel: 'Stock', icon: <BoxIcon /> }, inventorySample),
  sample('procurement', { group: 'Supply', label: 'Procurement', tabOf: 'supply', icon: <BoxIcon /> }, procurementSample),
  sample('quality', { group: 'Administration', label: 'Quality & Safety', icon: <FlagIcon /> }, qualitySample),
  sample('shifts', { group: 'People', label: 'Shifts & Roster', icon: <ClockIcon /> }, shiftsSample),
  sample('ambulance', { group: 'Network & Services', label: 'Dispatch', icon: <TruckIcon /> }, ambulanceSample),
  sample('vehicles', { group: 'Settings', label: 'Vehicle configuration', icon: <VehicleIcon /> }, vehiclesSample),
]
