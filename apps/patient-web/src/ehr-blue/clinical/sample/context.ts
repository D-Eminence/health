import { createContext, useContext } from 'react'

/**
 * True inside SampleWorkspace, whose Workspace already shows the sample notice. The list, create and record pages
 * show the notice themselves when another workspace (Emergency) renders them, so it is never shown twice.
 */
export const InsideSampleWorkspace = createContext(false)

export function useStandaloneSample() {
  return !useContext(InsideSampleWorkspace)
}
