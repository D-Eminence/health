import './nursing.css'
import { Route, Routes } from 'react-router-dom'
import { ChartProvider } from '../parts/chart'
import { Workspace } from '../parts/Workspace'
import type { EhrBluePageStatus } from '../types'
import { NewObservation } from './NewObservation'
import { NursingList } from './NursingList'
import { ObservationRecord } from './ObservationRecord'

/**
 * Live. A nursing observation is today's clinical note (note type "Nursing observation", the design's category as
 * its title, the details and units as its content) on one of the patient's encounters, amended as today's note
 * revision. The design's "Admission" has no backend (inpatient care is sample only), so the encounter ("Visit")
 * takes its place.
 */
export const nursingStatus: EhrBluePageStatus = 'live'

/**
 * Nursing observations: the open patient's observations (index), "New nursing observations" (`new`) and one
 * observation (`:recordId`, its encounter and its id). A chart opens only with the patient's permission; emergency
 * access is read-only and sees ChartGate's notice instead.
 */
export function NursingWorkspace() {
  return (
    <Workspace path="nursing">
      <ChartProvider>
        <Routes>
          <Route index element={<NursingList />} />
          <Route path="new" element={<NewObservation />} />
          <Route path=":recordId" element={<ObservationRecord />} />
        </Routes>
      </ChartProvider>
    </Workspace>
  )
}
