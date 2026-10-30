import { createContext, useContext } from 'react'
import { pageHrefOf } from './pageHref'
import { modulePath } from './sample/paths'
import type { EhrBluePage } from './types'

/** The page an address opens, and what the address holds below a '/*' page ('' at the page itself). */
export interface BluePageMatch {
  readonly page: EhrBluePage
  readonly rest: string
}

const BluePageContext = createContext<BluePageMatch | null>(null)
const BluePagesContext = createContext<readonly EhrBluePage[]>([])

export const BluePageProvider = BluePageContext.Provider
export const BluePagesProvider = BluePagesContext.Provider

/** The page being shown. Pages read the rest of their address here: react-router's useParams belongs to today's routes. */
export function useBluePage(): BluePageMatch {
  const match = useContext(BluePageContext)
  if (!match) throw new Error('useBluePage is used outside a blue EHR page')
  return match
}

/** Every page of the blue EHR, in sidebar order, whatever the working facility may open. */
export function useBluePages(): readonly EhrBluePage[] {
  return useContext(BluePagesContext)
}

/**
 * The address of a design workspace when it opens as a sample here; null when a live page has its address (or no page
 * does). A sample record links only where this says: a live page knows nothing of samples, and would not find one.
 */
export function useSampleHref(): (moduleId: string) => string | null {
  const pages = useBluePages()
  return moduleId => {
    const href = modulePath(moduleId)
    const opens = pages.some(candidate => candidate.status === 'sample' && (pageHrefOf(candidate) === href
      || (candidate.path.endsWith('/*') && href.startsWith(`${pageHrefOf(candidate)}/`))))
    return opens ? href : null
  }
}
