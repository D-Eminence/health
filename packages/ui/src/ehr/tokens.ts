/**
 * The blue Health ID Hospital EHR design tokens.
 *
 * ehr.css declares each of these on `.hid-ehr` as `--ehr-<kebab-case name>`
 * (`brandDark` is `--ehr-brand-dark`, `primary50` is `--ehr-primary-50`), with
 * exactly the value given here; a test holds the two files together. Use the
 * custom properties in styles and these values where script needs a number or
 * a colour.
 */
export const ehrTokens = {
  // Core identity (brand.css).
  brand: '#086dd9',
  brandDark: '#075fbe',
  tint: '#eaf4ff',
  ink: '#0b1b2e',
  muted: '#5b6b80',
  /** Borders and icons only, never text. */
  faint: '#7b8a9c',
  surface: '#ffffff',
  surfaceSunk: '#eef2f7',
  surfaceTint: '#f4f7fb',
  line: '#e3e9f0',
  lineStrong: '#d7deea',
  positive: '#12805c',
  /** Fills and borders only, never text (4.27:1 on white). */
  caution: '#b06a12',
  critical: '#b3261e',

  // Body text (base.css).
  text: '#484f58',

  // Primary ramp and status colours (redesign.css).
  primary50: '#eaf4ff',
  primary100: '#d5e8fc',
  primary200: '#b7d8fb',
  primary300: '#8fc2f7',
  primary400: '#559fee',
  primary500: '#086dd9',
  primary600: '#075fbe',
  primary700: '#0855a7',
  primary800: '#084788',
  primary900: '#093769',
  success50: '#edf8f1',
  success600: '#146d3e',
  warning50: '#fff8e9',
  warning600: '#855b00',
  danger50: '#fdf0ef',
  danger300: '#d56c65',
  dangerText: '#a9322d',

  // Warning banner (feedback.css) and the current module tab (application.css).
  warningBannerSurface: '#fff7e6',
  warningBannerText: '#94600c',
  tabCurrentSurface: '#e7f1ff',
  tabCurrentText: '#005dbd',
  tabCurrentBorder: '#006fe6',
  tabRule: '#dce4ed',

  // Accessible substitutions, pending owner decisions 55, 56, 58 and 60.
  /** A control's boundary: 3:1 or more on surface, surface-tint, surface-sunk and tint. */
  controlBorder: '#8a8a8e',
  /** Sidebar group headings: 4.51:1 on surface-tint. */
  navGroupText: '#627389',

  // Shape and depth.
  radiusMd: '6px',
  radiusLg: '6px',
  radiusXl: '8px',
  radius2xl: '8px',
  radiusOverlay: '16px',
  shadowLg: '0 12px 35px #0000001f',

  // Type.
  fontBody: 'Geist, Inter, Arial, sans-serif',
  fontDisplay: "'Playfair Display', Georgia, serif",
  textMd: '14px',
  leadingMd: '21px',
  textSm: '12px',
  headingMd: '40px',
  headingSm: '30px',
  trackingTight: '-0.035em',

  // Motion (feedback.css).
  modalOpen: '250ms',
  modalClose: '150ms',
  ease: 'cubic-bezier(0.22, 1, 0.36, 1)',

  // Layering. The shell isolates its stacking context, so these stay local to it.
  zChrome: '100',
  zPopover: '110',
  zOverlay: '200',
  zSkipLink: '300',

  // Overlays and focus.
  scrim: '#0b1b2e66',
  drawerWidth: 'min(680px, 95vw)',
  focusRingColor: '#086dd9',
  focusRingWidth: '3px',
  focusRingOffset: '3px',

  // Layout.
  sidebarWidth: '247px',
  sidebarCollapsedWidth: '60px',
  topbarHeight: '76px',
  topbarHeightPhone: '64px',
} as const

export type EhrTokenName = keyof typeof ehrTokens

/** The custom property ehr.css declares for a token: `ehrCssVariable('brandDark')` is `--ehr-brand-dark`. */
export function ehrCssVariable(name: EhrTokenName): `--ehr-${string}` {
  return `--ehr-${name.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase()}`
}
