import { Route, Routes } from 'react-router-dom'
import type { EhrBluePageStatus } from '../types'
import { ChartProvider } from '../parts/chart'
import { ListHeading } from '../parts/Notices'
import { Workspace, useWorkspaceHref } from '../parts/Workspace'
import { SampleCreate, SampleDetail, SampleList } from '../sample/SampleWorkspace'
import { BreakGlassCard, CurrentEmergency } from './BreakGlass'
import { EmergencySummaryPage } from './EmergencySummary'

/**
 * Partial: emergency break-glass access and the read-only emergency summary run on today's Health ID API; the
 * emergency-department board (arrivals, assessment, disposition) has no backend and is the sample engine's.
 */
export const emergencyStatus: EhrBluePageStatus = 'partial'

/** emergency: the design's list heading, the live break-glass card, then the sample board. */
function EmergencyHome() {
  const href = useWorkspaceHref()
  return (
    <>
      <ListHeading title="Emergency" createHref={href('new')} />
      <CurrentEmergency />
      <BreakGlassCard />
      <SampleList id="emergency" />
    </>
  )
}

/**
 * The Emergency workspace: `emergency` (break-glass access and the sample board), `emergency/summary` (the open
 * emergency patient's read-only summary), and the sample board's `new` and `:recordId`.
 */
export function EmergencyWorkspace() {
  return (
    <Workspace path="emergency" title="Emergency">
      <Routes>
        <Route index element={<EmergencyHome />} />
        <Route path="summary" element={<ChartProvider><EmergencySummaryPage /></ChartProvider>} />
        <Route path="new" element={<SampleCreate id="emergency" />} />
        <Route path=":recordId" element={<SampleDetail id="emergency" />} />
      </Routes>
    </Workspace>
  )
}
