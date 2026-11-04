import { useSyncExternalStore } from 'react'
import { act } from '@testing-library/react'
import { beforeEach } from 'vitest'
import type { DemoRole } from '../../../../ehr-blue/frame/roleView'
import type * as SampleAccess from '../../../../ehr-blue/frame/sampleAccess'

/**
 * Who the sample pages are viewed as. A sample page asks the frame's useSampleCan what the viewer's design role may do
 * (Create record, each action's verb); the frame answers from the staff session or the demo role being viewed. Here
 * the pages run without the frame, so each test file mocks the hook with this module, answering from the design's own
 * grants (sampleCan) for the roles set here:
 *
 *   vi.mock('../../../../ehr-blue/frame/sampleAccess', async importOriginal => (await import('./sampleViewer')).sampleAccessAsViewer(importOriginal))
 *
 * Each test starts as a Hospital Owner, whom the design lets create and act in every sample workspace. A change of role
 * while a page is open re-renders it, as a new session or a new demo role does in the frame.
 */

const OWNER: readonly DemoRole[] = ['Hospital Owner']

let roles = OWNER
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Views the sample pages as these design roles from now on, re-rendering any page open. */
export function viewAs(...next: DemoRole[]) {
  act(() => {
    roles = next
    for (const listener of listeners) listener()
  })
}

beforeEach(() => { roles = OWNER })

/** The frame's sampleAccess, with useSampleCan answering for the roles set by viewAs. */
export async function sampleAccessAsViewer(importOriginal: () => Promise<typeof SampleAccess>): Promise<typeof SampleAccess> {
  const actual = await importOriginal()
  return {
    ...actual,
    useSampleCan: () => {
      const current = useSyncExternalStore(subscribe, () => roles)
      return (moduleId, verb = 'view') => actual.sampleCan(current, moduleId, verb)
    },
  }
}
