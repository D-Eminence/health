import { createContext, useContext } from 'react'
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
