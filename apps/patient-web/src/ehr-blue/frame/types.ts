import type { ReactElement, ReactNode } from 'react'

/**
 * How much of a page runs on Health ID today:
 * - `live`: fully on today's API;
 * - `partial`: some parts on today's API, the rest a sample;
 * - `sample`: no backend yet. Fictional data, kept in memory only, reset by a reload, under EhrSampleBanner.
 */
export type EhrBluePageStatus = 'live' | 'partial' | 'sample'

/**
 * One page of the blue EHR. Each folder's `pages.ts` exports `pages: EhrBluePage[]`; routes.tsx finds them all
 * (`import.meta.glob('./*\/pages.ts')`). A page whose permission the working facility lacks is hidden, and refused if
 * opened, but only when it is live or partial: sample pages always show.
 */
export interface EhrBluePage {
  /**
   * Under /provider, without a leading slash: '' is Home, 'laboratory' is /provider/laboratory. Ending in '/*', the page
   * also takes every address below it (read the rest with useBluePage().rest). A page from another folder with the same
   * path replaces the frame's stand-in for it, in the same place in the sidebar.
   */
  readonly path: string
  /** The sidebar group, as the design names it: 'Clinical', 'Diagnostics'… '' for Home, which has no heading. */
  readonly group: string
  readonly label: string
  readonly icon?: ReactNode
  /** The facility permission the page needs (Identity's code, such as 'lab.work-item.read'). */
  readonly permission?: string
  readonly status: EhrBluePageStatus
  readonly element: ReactElement
}
