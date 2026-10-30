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
  brand: '#1570ef',
  brandDark: '#175cd3',
  tint: '#eff6ff',
  ink: '#101828',
  muted: '#475467',
  /** Borders and icons only, never text. */
  faint: '#98a2b3',
  surface: '#ffffff',
  surfaceSunk: '#f2f4f7',
  surfaceTint: '#f5f7fa',
  line: '#eaecf0',
  lineStrong: '#d0d5dd',
  positive: '#067647',
  /** Fills and borders only, never text (4.27:1 on white). */
  caution: '#dc6803',
  critical: '#b42318',

  // Body text (base.css).
  text: '#344054',

  // Primary ramp and status colours (redesign.css).
  primary50: '#eff6ff',
  primary100: '#d5e8fc',
  primary200: '#b7d8fb',
  primary300: '#8fc2f7',
  primary400: '#559fee',
  primary500: '#1570ef',
  primary600: '#175cd3',
  primary700: '#0855a7',
  primary800: '#084788',
  primary900: '#093769',
  success50: '#ecfdf3',
  success600: '#067647',
  warning50: '#fffaeb',
  warning600: '#b54708',
  danger50: '#fef3f2',
  danger300: '#d56c65',
  dangerText: '#b42318',

  // Warning banner (feedback.css) and the current module tab (application.css).
  warningBannerSurface: '#fffaeb',
  warningBannerText: '#b54708',
  tabCurrentSurface: '#eff6ff',
  tabCurrentText: '#175cd3',
  tabCurrentBorder: '#1570ef',
  tabRule: '#eaecf0',

  // The design's exact values (owner decision): both are below WCAG contrast, by design.
  /** A control's border, as the design draws it: 1.70:1 on white (WCAG 1.4.11 asks 3:1). */
  controlBorder: '#d0d5dd',
  /** Sidebar group headings, as the design draws them: 4.39:1 on surface-tint (WCAG 1.4.3 asks 4.5:1). */
  navGroupText: '#667085',

  // Shape and depth.
  radiusMd: '10px',
  radiusLg: '12px',
  radiusXl: '16px',
  radius2xl: '16px',
  radiusOverlay: '20px',
  shadowLg: '0 12px 24px -6px #10182824, 0 4px 8px -4px #1018280f',

  // Type.
  fontBody: "'Figtree Variable', Figtree, ui-sans-serif, system-ui, sans-serif",
  fontDisplay: "'Figtree Variable', Figtree, ui-sans-serif, system-ui, sans-serif",
  textMd: '14px',
  leadingMd: '21px',
  textSm: '12px',
  headingMd: '30px',
  headingSm: '24px',
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
  scrim: '#10182873',
  drawerWidth: 'min(680px, 95vw)',
  focusRingColor: '#1570ef',
  focusRingWidth: '3px',
  focusRingOffset: '3px',

  // Layout.
  sidebarWidth: '264px',
  sidebarCollapsedWidth: '64px',
  topbarHeight: '76px',
  topbarHeightPhone: '64px',
} as const

export type EhrTokenName = keyof typeof ehrTokens

/** The custom property ehr.css declares for a token: `ehrCssVariable('brandDark')` is `--ehr-brand-dark`. */
export function ehrCssVariable(name: EhrTokenName): `--ehr-${string}` {
  return `--ehr-${name.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase()}`
}
