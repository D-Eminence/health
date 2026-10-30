import type { ReactNode, SVGProps } from 'react'

/**
 * The sidebar icons of the clinical workspaces, as inline SVG: line icons drawn on a 24-unit grid with the current
 * colour, ported from the design reference (design/ehr-target src/icons.tsx). Decorative: the sidebar item's label
 * names the page.
 */

const p: SVGProps<SVGPathElement> & SVGProps<SVGCircleElement> & SVGProps<SVGRectElement> = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

const SHAPES = {
  user: <> <circle {...p} cx="12" cy="8" r="4" /> <path {...p} d="M4 21a8 8 0 0 1 16 0" /> </>,
  calendar: <> <rect {...p} x="3" y="5" width="18" height="16" rx="2" /> <path {...p} d="M3 10h18M8 3v4M16 3v4" /> </>,
  route: <> <circle {...p} cx="6" cy="19" r="2.5" /> <circle {...p} cx="18" cy="5" r="2.5" /> <path {...p} d="M8.5 19H14a4 4 0 0 0 0-8H10a4 4 0 0 1 0-8h5.5" /> </>,
  activity: <path {...p} d="M3 12h4l3 8 4-16 3 8h4" />,
  stethoscope: <> <path {...p} d="M6 3v6a4 4 0 0 0 8 0V3" /> <path {...p} d="M6 3h2M12 3h2" /> <path {...p} d="M10 13v3a5 5 0 0 0 10 0v-2" /> <circle {...p} cx="20" cy="11" r="2" /> </>,
  scan: <> <path {...p} d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" /> <path {...p} d="M4 12h16" /> </>,
  bed: <> <path {...p} d="M3 7v12M3 13h18a2 2 0 0 1 2 2v4M23 19v-4" /> <path {...p} d="M3 13v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2" /> <circle {...p} cx="7.5" cy="11" r="0.5" /> </>,
  ward: <> <rect {...p} x="3" y="3" width="18" height="18" rx="2" /> <path {...p} d="M3 12h18M12 3v18M6 7h3m6 0h3M6 17h3m6 0h3" /> </>,
  notes: <> <rect {...p} x="4" y="3" width="16" height="18" rx="2" /> <path {...p} d="M8 8h8M8 12h8M8 16h5" /> </>,
  check: <path {...p} d="M5 12.5 10 17 19 7" />,
  alert: <> <path {...p} d="M12 3 1.5 21h21z" /> <path {...p} d="M12 10v5" /> <circle cx="12" cy="18" r="1" fill="currentColor" /> </>,
  heart: <path {...p} d="M12 20s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 5c-2.5 4.5-9.5 9-9.5 9z" />,
  scissors: <> <circle {...p} cx="6" cy="6" r="3" /> <circle {...p} cx="6" cy="18" r="3" /> <path {...p} d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" /> </>,
  monitor: <> <rect {...p} x="2" y="3" width="20" height="14" rx="2" /> <path {...p} d="M8 21h8m-4-4v4M4 10h4l2-4 3 8 2-4h5" /> </>,
  tooth: <path {...p} d="M7 3C2 3 3 9 5 12c1 2 0 9 3 9 2 0 1-7 4-7s2 7 4 7c3 0 2-7 3-9 2-3 3-9-2-9-2 0-3 1-5 1S9 3 7 3Z" />,
  share: <> <circle {...p} cx="18" cy="5" r="3" /> <circle {...p} cx="6" cy="12" r="3" /> <circle {...p} cx="18" cy="19" r="3" /> <path {...p} d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /> </>,
  droplet: <path {...p} d="M12 3s6 5.7 6 10a6 6 0 0 1-12 0c0-4.3 6-10 6-10z" />,
  video: <> <rect {...p} x="2" y="6" width="13" height="12" rx="2" /> <path {...p} d="m22 8-5 4 5 4z" /> </>,
  lock: <> <rect {...p} x="4" y="10" width="16" height="11" rx="2" /> <path {...p} d="M8 10V7a4 4 0 0 1 8 0v3" /> </>,
  wardSettings: <> <path {...p} d="M3 21V3h14v9M7 7h2m4 0h1M7 11h2M7 15h2" /> <circle {...p} cx="17" cy="17" r="4" /> <path {...p} d="M17 11v2m0 8v2m-6-6h2m8 0h2" /> </>,
} satisfies Record<string, ReactNode>

export type ClinicalIconName = keyof typeof SHAPES

export function ClinicalIcon({ name, size = 20 }: { name: ClinicalIconName; size?: number }) {
  return <svg className="hid-ehr-clinical-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {SHAPES[name]}
  </svg>
}
