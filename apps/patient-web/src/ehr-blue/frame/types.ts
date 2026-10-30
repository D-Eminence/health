import type { ReactElement, ReactNode } from 'react'
import type { StaffSession } from '../../staff/api'

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
  /**
   * What the page's address shows when `visible` or the permission turns the page down: the page's own words, as
   * today's page gives them ("Health ID support manages who works at …"). Left out, the frame's: "… is not open to
   * you here" for a missing permission, and "… is part of the Health ID demo only" where `visible` turns the page down,
   * so a page that uses `visible` for any other reason gives its own. It stands in for the page, so it makes no request
   * of its own.
   */
  readonly refusal?: ReactElement
  /**
   * Whether the page shows for this session at all, beyond its permission (how the facility signed up, a setting…).
   * Left out, it shows wherever its permission allows. A page it hides is left out of the sidebar, search and Home's
   * shortcuts, and says it is not open here if its address is opened.
   */
  readonly visible?: (session: StaffSession) => boolean
  /**
   * Whether the page has a sidebar entry and a search result for this session; left out, it has both wherever it is
   * allowed. Unlike `visible`, the address still opens: Choose workspace is the account menu's facility switch at every
   * facility, and a design review entry only at the demo facilities.
   */
  readonly listed?: (session: StaffSession) => boolean
  /**
   * The path of the page whose tabs this page joins, as the design draws Insurance & Claims (Claims | Policies) and
   * Supply (Stock | Procurement): it has no sidebar entry of its own, the frame draws the tabs above the heading, and the
   * sidebar marks the page it joins as current.
   */
  readonly tabOf?: string
  /** The page's own name among its tabs, when other pages join it ('Claims' for Insurance & Claims). Else its label. */
  readonly tabLabel?: string
}
