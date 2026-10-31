import { EhrButton, EhrCard } from '@hid/ui/ehr'
import { Route, Routes, useNavigate } from 'react-router-dom'
import type { EhrBluePageStatus } from '../types'
import { ChartProvider } from '../parts/chart'
import { isDemoFacility } from '../../blueFacilities'
import { ListHeading, RecordNotFound } from '../parts/Notices'
import { RecordTable } from '../parts/RecordTable'
import { Workspace, useClinical, useWorkspaceHref } from '../parts/Workspace'
import { SampleCreate, SampleDetail, SampleList } from '../sample/SampleWorkspace'
import { NOTICE_BEFORE } from './access'
import { BreakGlassPage, CurrentEmergency } from './BreakGlass'
import { EmergencySummaryPage } from './EmergencySummary'

/**
 * Partial: emergency break-glass access and the read-only emergency summary run on today's Health ID API; the
 * emergency-department board (arrivals, assessment, disposition) has no backend and is the sample engine's. The board
 * shows only at the four demo facilities: at a real facility this live page never leads into a sample.
 */
export const emergencyStatus: EhrBluePageStatus = 'partial'

/** Whether the working facility is one of the demo facilities, the only place the sample board shows. */
function useDemoFacility() {
  return isDemoFacility(useClinical().facility?.id)
}

/**
 * emergency: the design's list page, the heading and one list card (audit 7). At a demo facility the card is the sample
 * board; at a real facility it is an empty list whose one action opens the break-glass page. Its empty state says what
 * the design's empty list says ("No matching records"), never that there is no emergency access, since an open
 * emergency patient's way back to their summary shows above it (as today's Patients page shows it), and today's words
 * for when emergency access is used.
 */
function EmergencyHome() {
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const demo = useDemoFacility()
  return (
    <>
      <ListHeading title="Emergency" createHref={demo ? href('new') : undefined} />
      <CurrentEmergency />
      {demo ? <SampleList id="emergency" /> : (
        <EhrCard className="hid-ehr-clinical-emergency-list">
          <RecordTable
            caption="Emergency"
            rows={[]}
            hrefFor={() => href()}
            emptyMessage={NOTICE_BEFORE}
            emptyAction={<EhrButton onClick={() => navigate(href('break-glass'))}>Emergency break-glass access</EhrButton>}
          />
        </EhrCard>
      )}
    </>
  )
}

/** The sample board's own pages, at a demo facility; elsewhere the design's "Record not found". */
function BoardPage({ create }: { create: boolean }) {
  const href = useWorkspaceHref()
  if (!useDemoFacility()) return <RecordNotFound backHref={href()} />
  return create ? <SampleCreate id="emergency" /> : <SampleDetail id="emergency" />
}

/**
 * The Emergency workspace: `emergency` (the list: at a demo facility, the sample board), `emergency/break-glass` (the
 * live break-glass form as its own page, at every facility), `emergency/summary` (the open emergency patient's
 * read-only summary), and the sample board's `new` and `:recordId`.
 */
export function EmergencyWorkspace() {
  return (
    <Workspace path="emergency" title="Emergency">
      <Routes>
        <Route index element={<EmergencyHome />} />
        <Route path="break-glass" element={<BreakGlassPage />} />
        <Route path="summary" element={<ChartProvider><EmergencySummaryPage /></ChartProvider>} />
        <Route path="new" element={<BoardPage create />} />
        <Route path=":recordId" element={<BoardPage create={false} />} />
      </Routes>
    </Workspace>
  )
}
