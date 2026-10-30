import type { ReactElement, ReactNode } from 'react'

/**
 * One page of the blue Hospital EHR's department and admin work, as the frame's
 * sidebar and router take it (the frame finds `pages` in ./pages.ts).
 *
 * - `path`: the page's route segment, relative and without a leading slash.
 * - `group`, `label`: the sidebar group and the page's name in it.
 * - `permission`: what the working facility must hold for the page to be listed; none for a sample page.
 * - `status`: `live`, fully on today's API; `partial`, some parts on today's API and the rest sample; `sample`, no
 *   backend yet (it works in memory only and says so).
 */
export type EhrBluePage = {
  path: string
  group: string
  label: string
  icon?: ReactNode
  permission?: string
  status: 'live' | 'partial' | 'sample'
  element: ReactElement
}
