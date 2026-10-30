import '@hid/ui/ehr.css'
import './frame/frame.css'
import { useStaff } from '../staff/App'
import { facilityChoiceNeeded } from '../staff/facilitySelection'
import { BlueFrame } from './frame/BlueFrame'
import { ChooseWorkspace } from './frame/ChooseWorkspace'
import { RoleViewProvider } from './frame/roleView'

/**
 * The blue Hospital EHR, for staff working at a demo facility (blueFacilities.ts). The staff app mounts it in place of
 * today's workspace, lazily, so no other facility ever downloads it. It keeps today's session, its locks and checks
 * (the Gate around it), sign-out and facility switch: only the look and the pages are new.
 */
export default function EhrBlueApp() {
  const { state } = useStaff()
  if (state.status !== 'ready') return null
  const question = state.facilityLost ? 'lost' : facilityChoiceNeeded(state.session)
  if (question) {
    return (
      <div className="hid-ehr hid-ehr-blue-standalone">
        <main id="main-content" tabIndex={-1} className="hid-ehr-blue-standalone-main">
          <ChooseWorkspace key={question} reason={question} />
        </main>
      </div>
    )
  }
  return <RoleViewProvider><BlueFrame /></RoleViewProvider>
}
