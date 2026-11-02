import type { ReactElement, ReactNode } from 'react'

/**
 * One page of the blue Health ID Hospital EHR, as the frame discovers it in `./<area>/pages.ts`
 * (`import.meta.glob('./*\/pages.ts')`). Declared here so this area depends on nothing outside it.
 *
 * - `path`: the page's route below the blue EHR's base, with no leading slash ('patients'). The frame mounts each page
 *   at `${path}/*`: the page routes its own list, `new` and `:recordId` with relative routes.
 * - `group` and `label`: the sidebar group and item, as the design's screenshots name them.
 * - `permission`: shown only to an actor with this permission at the facility (the one today's page checks).
 * - `status`: `live`, fully on today's Health ID API; `partial`, some parts on today's API and the rest sample;
 *   `sample`, no backend yet (in memory only, fictional, nothing saved).
 * - `refusal`: what the page's address shows when the permission turns the page down, in today's words; it stands in
 *   for the page, so it reads nothing. Left out, the frame sends the person Home with its own notice.
 */
export type EhrBluePageStatus = 'live' | 'partial' | 'sample'

export type EhrBluePage = {
  path: string
  group: string
  label: string
  icon?: ReactNode
  permission?: string
  status: 'live' | 'partial' | 'sample'
  element: ReactElement
  refusal?: ReactElement
}
