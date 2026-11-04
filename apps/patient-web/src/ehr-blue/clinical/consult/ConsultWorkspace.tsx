import { Outlet, Route, Routes } from 'react-router-dom'
import { ChartProvider, useChart } from '../parts/chart'
import { Workspace } from '../parts/Workspace'
import type { EhrBluePageStatus } from '../types'
import { EncounterList, useLinkedOrder } from './EncounterList'
import { EncounterPage } from './EncounterPage'
import { NewConsultation } from './NewConsultation'
import { EncounterOrderPages } from './orders'
import { TodaySections } from './TodaySections'

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
    <Workspace path="consult" title="Consultation">
      <ChartProvider>
        <Routes>
          <Route element={<WithChartSections />}>
            <Route index element={<EncounterList />} />
            <Route path=":recordId" element={<EncounterPage />} />
          </Route>
          <Route path="new" element={<NewConsultation />} />
          <Route path=":recordId/orders/*" element={<EncounterOrderPages />} />
        </Routes>
      </ChartProvider>
    </Workspace>
  )
}

/**
 * The list and a visit share today's chart sections, mounted once below either page, so moving between them reads none
 * of them again, as today's Clinical page keeps them mounted while an encounter is chosen. Nothing while the list hands
 * Home's order link on to the order's page (it reads nothing on the way); TodaySections itself shows nothing but in
 * direct care.
 */
function WithChartSections() {
  const chart = useChart()
  const linked = useLinkedOrder(chart)
  return (
    <>
      <Outlet />
      {chart && !linked ? <TodaySections chart={chart} /> : null}
    </>
  )
}
