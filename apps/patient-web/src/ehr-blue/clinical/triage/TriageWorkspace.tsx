import { Route, Routes } from 'react-router-dom'
import { ChartProvider } from '../parts/chart'
import { Workspace } from '../parts/Workspace'
import type { EhrBluePageStatus } from '../types'
import { NewTriage } from './NewTriage'
import { TriageList } from './TriageList'
import { TriageRecord } from './TriageRecord'
import { TITLE } from './vitals'

/**
 * Partial. The vitals (record, list, amend as today's appended correction, earlier values kept) run on today's Health
 * ID API, per encounter; the design's priority and observations have no field in today's vitals, so the create page
 * shows them as a marked sample that is never sent.
 */
export const triageStatus: EhrBluePageStatus = 'partial'

/**
 * Triage & Vitals: the open patient's vitals (index), "New triage & vitals" (`new`) and one vitals record
 * (`:recordId`, its encounter and its id). A chart opens only with the patient's permission; emergency access is
 * read-only and sees ChartGate's notice instead.
 */
export function TriageWorkspace() {
  return (
    <Workspace path="triage" title={TITLE}>
      <ChartProvider>
        <Routes>
          <Route index element={<TriageList />} />
          <Route path="new" element={<NewTriage />} />
          <Route path=":recordId" element={<TriageRecord />} />
        </Routes>
      </ChartProvider>
    </Workspace>
  )
}
