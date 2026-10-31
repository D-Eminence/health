import { Route, Routes } from 'react-router-dom'
import { ListHeading } from '../parts/Notices'
import { Workspace, useWorkspaceHref } from '../parts/Workspace'
import type { EhrBluePageStatus } from '../types'
import { useSampleAccess } from './access'
import { InsideSampleWorkspace } from './context'
import { SampleCreate } from './SampleCreate'
import { SampleDetail } from './SampleDetail'
import { SampleList } from './SampleList'
import { sampleDefinition } from './store'

export { SampleCreate } from './SampleCreate'
export { SampleDetail } from './SampleDetail'
export { SampleList } from './SampleList'
export { resetSampleStore } from './store'

/**
 * Sample only: no part of these workspaces is on the Health ID API. Records are fictional, live in this page's
 * memory, call nothing and are gone on reload.
 */
export const sampleStatus: EhrBluePageStatus = 'sample'

/**
 * A whole sample workspace: the list (`index`), `new` and `:recordId`, under the sample notice. The tab reads
 * "{title} · Health ID EHR" on each of them (the workspace's label, never a record or patient).
 */
export function SampleWorkspace({ id }: { id: string }) {
  return (
    <Workspace path={id} title={sampleDefinition(id)?.title} sample>
      <InsideSampleWorkspace.Provider value>
        <Routes>
          <Route index element={<SampleHome id={id} />} />
          <Route path="new" element={<SampleCreate id={id} />} />
          <Route path=":recordId" element={<SampleDetail id={id} />} />
        </Routes>
      </InsideSampleWorkspace.Provider>
    </Workspace>
  )
}

/**
 * The list page: the sidebar label as heading with "Create record" for a role the design lets create here (audit item
 * 16; src/workflows.tsx:156), then the list card.
 */
function SampleHome({ id }: { id: string }) {
  const href = useWorkspaceHref()
  const can = useSampleAccess()
  return (
    <>
      <ListHeading title={sampleDefinition(id)?.title ?? id} createHref={can(id, 'create') ? href('new') : undefined} />
      <SampleList id={id} />
    </>
  )
}
