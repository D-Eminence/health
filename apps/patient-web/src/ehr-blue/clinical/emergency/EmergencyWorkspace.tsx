import { Route, Routes } from 'react-router-dom'
import type { EhrBluePageStatus } from '../types'
import { ChartProvider } from '../parts/chart'
import { isDemoFacility } from '../../blueFacilities'
import { RecordNotFound } from '../parts/Notices'
import { FormPage } from '../../../kasuwa/parts'
import { Button } from '../../../kasuwa/ui'
import { Workspace, useClinical, useWorkspaceHref } from '../parts/Workspace'
import { SampleCreate, SampleDetail, SampleList } from '../sample/SampleWorkspace'
import { BreakGlassCard, CurrentEmergency } from './BreakGlass'
import { EmergencySummaryPage } from './EmergencySummary'

/**
 * Partial: emergency break-glass access and the read-only emergency summary run on today's Health ID API; the
 * emergency-department board (arrivals, assessment, disposition) has no API and is the sample engine's. The board
 * shows only at the four demo facilities: at a real facility this live page never leads into a sample.
 */
export const emergencyStatus: EhrBluePageStatus = 'partial'

/** Whether the working facility is one of the demo facilities, the only place the sample board shows. */
function useDemoFacility() {
  return isDemoFacility(useClinical().facility?.id)
}

/** emergency: emergency access as one form column, then (at a demo facility) the sample board. */
function EmergencyHome() {
  const href = useWorkspaceHref()
  const demo = useDemoFacility()
  return (
    <div className="flex flex-col gap-8">
      <FormPage title="Emergency access" description="See the emergency summary of a patient who can’t consent."
        actions={demo ? <Button to={href('new')}>New board entry</Button> : undefined}>
        <CurrentEmergency />
        <BreakGlassCard />
      </FormPage>
      {demo ? <SampleList id="emergency" /> : null}
    </div>
  )
}

/** The sample board's own pages, at a demo facility; elsewhere the design's "Record not found". */
function BoardPage({ create }: { create: boolean }) {
  const href = useWorkspaceHref()
  if (!useDemoFacility()) return <RecordNotFound backHref={href()} />
  return create ? <SampleCreate id="emergency" /> : <SampleDetail id="emergency" />
}

/**
 * The Emergency workspace: `emergency` (break-glass access and, at a demo facility, the sample board),
 * `emergency/summary` (the open emergency patient's read-only summary), and the sample board's `new` and `:recordId`.
 */
export function EmergencyWorkspace() {
  return (
    <Workspace path="emergency" title="Emergency">
      <Routes>
        <Route index element={<EmergencyHome />} />
        <Route path="summary" element={<ChartProvider><EmergencySummaryPage /></ChartProvider>} />
        <Route path="new" element={<BoardPage create />} />
        <Route path=":recordId" element={<BoardPage create={false} />} />
      </Routes>
    </Workspace>
  )
}
