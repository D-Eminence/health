import type { ReactElement } from 'react'
import type { EhrBluePage } from '../types'
import { BoxIcon, ClockIcon, FlagIcon, ReceiptIcon, ShieldIcon, TagIcon, TruckIcon, VehicleIcon } from '../parts/icons'
import { SampleWorkspace } from '../parts/sample/SampleWorkspace'
import type { SampleDefinition } from '../parts/sample/model'
import { ambulanceSample, qualitySample, servicesSample, shiftsSample, vehiclesSample } from './admin'
import { billingSample, insuranceSample, policiesSample } from './finance'
import { inventorySample, procurementSample } from './supply'

/**
 * Keyed by the page, so moving between two sample pages (Stock and Procurement) starts the other one afresh instead of
 * carrying one page's records into the other.
 */
function workspace(definition: SampleDefinition): ReactElement {
  return <SampleWorkspace key={definition.id} definition={definition} />
}

/**
 * The sample-only workspaces: the design's list, create form and record view for each, with fictional records kept
 * in the page's memory only. Nothing here reaches Health ID: no request, no browser storage, no record in the address.
 *
 * Paths are the frame's addresses for these workspaces (the design's module ids, except Patient billing at
 * patient-billing, as billing is today's live Facility subscription, and Stock at supply, the design's Supply entry). In the design's navigation, Policies is a tab of Insurance & Claims, and Stock
 * and Procurement are the tabs of Supply; they are listed here as their own entries because the shared page type has
 * no tab-only flag. Each page draws its module tabs itself.
 */
export const samplePages: EhrBluePage[] = [
  { path: 'patient-billing', group: 'Finance', label: 'Patient billing', icon: <ReceiptIcon />, status: 'sample', element: workspace(billingSample) },
  { path: 'insurance', group: 'Finance', label: 'Insurance & Claims', icon: <ShieldIcon />, status: 'sample', element: workspace(insuranceSample) },
  { path: 'policies', group: 'Finance', label: 'Policies', icon: <ShieldIcon />, status: 'sample', element: workspace(policiesSample) },
  { path: 'services', group: 'Settings', label: 'Service catalogue', icon: <TagIcon />, status: 'sample', element: workspace(servicesSample) },
  { path: 'supply', group: 'Supply', label: 'Stock', icon: <BoxIcon />, status: 'sample', element: workspace(inventorySample) },
  { path: 'procurement', group: 'Supply', label: 'Procurement', icon: <BoxIcon />, status: 'sample', element: workspace(procurementSample) },
  { path: 'quality', group: 'Administration', label: 'Quality & Safety', icon: <FlagIcon />, status: 'sample', element: workspace(qualitySample) },
  { path: 'shifts', group: 'People', label: 'Shifts & Roster', icon: <ClockIcon />, status: 'sample', element: workspace(shiftsSample) },
  { path: 'ambulance', group: 'Network & Services', label: 'Dispatch', icon: <TruckIcon />, status: 'sample', element: workspace(ambulanceSample) },
  { path: 'vehicles', group: 'Settings', label: 'Vehicle configuration', icon: <VehicleIcon />, status: 'sample', element: workspace(vehiclesSample) },
]
