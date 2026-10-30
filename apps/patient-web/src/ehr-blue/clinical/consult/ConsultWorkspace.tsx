import { Route, Routes } from 'react-router-dom'
import { ChartProvider } from '../parts/chart'
import { Workspace } from '../parts/Workspace'
import type { EhrBluePageStatus } from '../types'
import { EncounterList } from './EncounterList'
import { EncounterPage } from './EncounterPage'
import { NewConsultation } from './NewConsultation'
import { EncounterOrderPages } from './orders'

/**
 * Partial. The encounters, their clinical notes (sign, amend, edit the draft), diagnoses, documents and the history
 * shown here run on today's Health ID API; the "Connected orders" part comes from ./orders, whose radiology and
 * referral orders have no backend yet.
 */
export const consultStatus: EhrBluePageStatus = 'partial'

/**
 * Consultation: the open patient's encounters (index), "New consultation" (`new`), one encounter (`:recordId`), and
 * the orders raised from it (`:recordId/orders/*`, from ./orders). A chart opens only with the patient's permission;
 * emergency access is read-only and sees ChartGate's notice instead.
 */
export function ConsultWorkspace() {
  return (
    <Workspace path="consult">
      <ChartProvider>
        <Routes>
          <Route index element={<EncounterList />} />
          <Route path="new" element={<NewConsultation />} />
          <Route path=":recordId" element={<EncounterPage />} />
          <Route path=":recordId/orders/*" element={<EncounterOrderPages />} />
        </Routes>
      </ChartProvider>
    </Workspace>
  )
}
