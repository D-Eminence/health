import { moduleOf, useSampleCan } from '../../frame/sampleAccess'

/**
 * Audit item 16 (owner decision 2): what the viewer may do on a sample page follows the design's role mapping
 * (design/ehr-target src/catalog.ts permissions(role)), through the frame's useSampleCan: the signed-in person's design
 * roles, or the demo role whose Home is being viewed at a demo facility. A sample sends nothing and saves nothing, so
 * this only keeps each role's actions, Continue care, Create record and history rows the design's. Live pages keep
 * their live permission checks.
 */

/**
 * The design module a workspace is, by its frame address: the frame's own mapping (frame/sampleAccess.ts moduleOf,
 * which reads only the page's path), so clinical is consult and laboratory is lab, and a sample workspace's id is its
 * module's. Null for an address the design has no module for.
 */
export function designModuleOf(workspace: string): string | null {
  return moduleOf({ path: workspace } as Parameters<typeof moduleOf>[0])
}

/** Whether the viewer may do `verb` ('view' by default) in a workspace named by its frame address. */
export type SampleAccess = (workspace: string, verb?: string) => boolean

/** The design's check for a sample page. An address the design has no module for grants nothing, as in the design. */
export function useSampleAccess(): SampleAccess {
  const can = useSampleCan()
  return (workspace, verb = 'view') => {
    const module = designModuleOf(workspace)
    return module !== null && can(module, verb)
  }
}
