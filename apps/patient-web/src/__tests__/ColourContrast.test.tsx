import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge, Input, SearchField, Select, Textarea } from '@hid/ui'
import { parse, valueAt } from './cssRules'

/**
 * Colour contrast, measured from the source (WCAG 1.4.3 and 1.4.11). jsdom
 * computes no colour, so these read the design tokens, the portal stylesheets
 * and the shared controls' utility classes, resolve each colour to the value in
 * packages/ui/src/tokens.css, and compute the WCAG 2 contrast ratio. All of the
 * text here is small (11 to 15px), so it needs 4.5:1; the border that is a
 * form control's only visible boundary needs 3:1 against the control's fill
 * and against the surface it sits on.
 */

// A path, not a URL: jsdom replaces the global URL class, which Node's file API refuses.
const here = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(resolve(here, path), 'utf8')
const tokensCss = read('../../../../packages/ui/src/tokens.css')
const portalCss = read('../index.css')
const staffCss = read('../staff/style.css')
const adminCss = read('../admin/style.css')
const DESKTOP = 1280
const TEXT = 4.5
const BOUNDARY = 3

type Rgb = [number, number, number]
type Palette = ReadonlyMap<string, string>

/** The `--color-*: #hex` declarations in one block of tokens.css. */
function declaredColours(selector: string): Map<string, string> {
  const block = parse(tokensCss).find(rule => rule.selectors[0] === selector)
  if (!block) throw new Error(`tokens.css has no ${selector} block`)
  return new Map([...block.body.matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\b/gi)].map(([, name, hex]) => [name!, hex!]))
}

const light: Palette = declaredColours('@theme')
// The opt-in dark palette overrides the light one; whatever it leaves out falls through.
const dark: Palette = new Map([...light, ...declaredColours("[data-theme='dark']")])

function rgb(hex: string): Rgb {
  const digits = hex.length === 4 ? [...hex.slice(1)].map(digit => digit + digit).join('') : hex.slice(1)
  return [0, 2, 4].map(index => Number.parseInt(digits.slice(index, index + 2), 16)) as Rgb
}

function luminance(colour: Rgb): number {
  const [red, green, blue] = colour.map(channel => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }) as Rgb
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (lighter + 0.05) / (darker + 0.05)
}

/** A colour at `alpha` over an opaque background, as `bg-positive/10` paints it. */
function over(colour: Rgb, alpha: number, background: Rgb): Rgb {
  return colour.map((channel, index) => channel * alpha + background[index]! * (1 - alpha)) as Rgb
}

function token(name: string, palette: Palette = light): Rgb {
  const hex = palette.get(name)
  if (!hex) throw new Error(`tokens.css declares no --color-${name}`)
  return rgb(hex)
}

/** The colour a stylesheet value names: `var(--color-x)`, with or without `!important`, or a hex literal. */
function cssColour(value: string | undefined, label: string): Rgb {
  const name = value && /var\(--color-([a-z0-9-]+)\)/.exec(value)?.[1]
  if (name) return token(name)
  const hex = value && /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/i.exec(value)?.[0]
  if (!hex) throw new Error(`${label}: no colour in ${String(value)}`)
  return rgb(hex)
}

/** The colour of a stylesheet declaration, resolved through the light tokens. */
function declared(css: string, selector: string, property: string): Rgb {
  return cssColour(valueAt(css, selector, property, DESKTOP), `${selector} { ${property} }`)
}

/** The colour utilities on an element with a prefix (`border`, `bg`, `text`, `placeholder:text`), as token and opacity. */
function utilities(element: Element, prefix: string): { name: string; alpha: number }[] {
  const pattern = new RegExp(`^${prefix}-([a-z][a-z0-9-]*?)(?:/(\\d+))?$`)
  return [...element.classList].flatMap(name => {
    const match = pattern.exec(name)
    return match && light.has(match[1]!) ? [{ name: match[1]!, alpha: match[2] ? Number(match[2]) / 100 : 1 }] : []
  })
}

/** The one resting colour a utility prefix gives an element; two would leave the winner to source order. */
function only(element: Element, prefix: string): Rgb {
  const found = utilities(element, prefix)
  expect(found.map(item => item.name), `${prefix}-* colour utilities on <${element.tagName.toLowerCase()}>`).toHaveLength(1)
  return token(found[0]!.name)
}

const ratio = (a: Rgb, b: Rgb) => Math.round(contrast(a, b) * 100) / 100

// The fill of every control, and the light surfaces controls sit on: the patient
// page, the provider sidebar ('Working at') and the admin action forms.
const CONTROL_SURFACES = ['surface', 'surface-sunk', 'surface-tint']

describe('the boundary of a form control is at least 3:1 (WCAG 1.4.11)', () => {
  const shared: [string, (invalid?: boolean) => ReactElement][] = [
    ['Input', invalid => <Input aria-label="Control" invalid={invalid} />],
    ['Select', invalid => <Select aria-label="Control" invalid={invalid}><option>Any</option></Select>],
    ['Textarea', invalid => <Textarea aria-label="Control" invalid={invalid} />],
  ]

  it.each(shared)('@hid/ui %s at rest', (_, control) => {
    const { container } = render(control())
    const border = only(container.firstElementChild!, 'border')
    for (const surface of CONTROL_SURFACES) expect(ratio(border, token(surface)), surface).toBeGreaterThanOrEqual(BOUNDARY)
  })

  it.each(shared)('@hid/ui %s marked invalid shows its error border at rest, not only while focused', (_, control) => {
    const { container } = render(control(true))
    // A second resting border colour would win or lose by Tailwind's source order, not by state.
    expect(utilities(container.firstElementChild!, 'border').map(item => item.name)).toEqual(['critical'])
    for (const surface of CONTROL_SURFACES) expect(ratio(token('critical'), token(surface)), surface).toBeGreaterThanOrEqual(BOUNDARY)
  })

  it('@hid/ui SearchField shell', () => {
    render(<SearchField label="Search resources" />)
    const shell = screen.getByRole('searchbox', { name: 'Search resources' }).parentElement!
    const border = only(shell, 'border')
    for (const surface of CONTROL_SURFACES) expect(ratio(border, token(surface)), surface).toBeGreaterThanOrEqual(BOUNDARY)
  })

  const stylesheets: [string, string, string[]][] = [
    ['patient portal', portalCss, ['.patient-form input', '.patient-form select', '.patient-deny-form input']],
    ['admin portal', adminCss, [
      ".admin-action-form input:not([type='checkbox'])", '.admin-action-form select', '.admin-action-form textarea',
      '.admin-auth-card input', '.admin-search input', '.admin-dialog input',
      '.admin-filters input', '.admin-filters select', '.admin-picker input',
    ]],
  ]

  it.each(stylesheets.flatMap(([portal, css, selectors]) => selectors.map(selector => [portal, selector, css] as const)))('%s: %s', (_, selector, css) => {
    const borders = ['border', 'border-color'].flatMap(property => {
      const value = valueAt(css, selector, property, DESKTOP)
      return value ? [cssColour(value, `${selector} { ${property} }`)] : []
    })
    expect(borders.length, `${selector} declares a border`).toBeGreaterThan(0)
    for (const border of borders) {
      for (const surface of CONTROL_SURFACES) expect(ratio(border, token(surface)), surface).toBeGreaterThanOrEqual(BOUNDARY)
    }
  })
})

describe('placeholder text is at least 4.5:1 (WCAG 1.4.3)', () => {
  it.each([
    ['Input', () => <Input aria-label="Control" placeholder="Document UUID" />],
    ['Textarea', () => <Textarea aria-label="Control" placeholder="Reason" />],
  ] as [string, () => ReactElement][])('@hid/ui %s', (_, control) => {
    const { container } = render(control())
    const element = container.firstElementChild!
    expect(ratio(only(element, 'placeholder:text'), only(element, 'bg'))).toBeGreaterThanOrEqual(TEXT)
  })

  it('@hid/ui SearchField', () => {
    render(<SearchField label="Search resources" placeholder="Search Health ID resources..." />)
    const input = screen.getByRole('searchbox', { name: 'Search resources' })
    expect(ratio(only(input, 'placeholder:text'), only(input.parentElement!, 'bg'))).toBeGreaterThanOrEqual(TEXT)
  })

  // Without a rule, Tailwind's preflight paints a placeholder at 50% of the text colour: about 3.2:1.
  it.each([
    ['patient portal', '.patient-form input::placeholder', '.patient-form input', portalCss],
    ['patient portal', '.patient-deny-form input::placeholder', '.patient-deny-form input', portalCss],
    ['admin portal', '.admin-app ::placeholder', '.admin-filters input', adminCss],
    ['admin portal', '.admin-auth ::placeholder', '.admin-auth-card input', adminCss],
  ])('%s: %s', (_, placeholder, control, css) => {
    expect(valueAt(css, placeholder, 'color', DESKTOP), `${placeholder} has a colour of its own`).toBeDefined()
    expect(ratio(declared(css, placeholder, 'color'), declared(css, control, 'background'))).toBeGreaterThanOrEqual(TEXT)
  })

  it('the command palette', () => {
    const placeholder = declared(tokensCss, '.waya-command__input::placeholder', 'color')
    expect(ratio(placeholder, declared(tokensCss, '.waya-command', 'background'))).toBeGreaterThanOrEqual(TEXT)
    expect(ratio(placeholder, declared(tokensCss, '.waya-command__input-wrap:focus-within', 'background'))).toBeGreaterThanOrEqual(TEXT)
  })
})

describe('status text is at least 4.5:1 (WCAG 1.4.3)', () => {
  // Badges are placed on white cards, list items and the page; their fill is a tint over that.
  it.each(['neutral', 'information', 'success', 'warning', 'danger'] as const)('the %s badge', tone => {
    render(<Badge tone={tone}>Status</Badge>)
    const badge = screen.getByText('Status')
    const [fill] = utilities(badge, 'bg')
    const background = over(token(fill!.name), fill!.alpha, token('surface'))
    expect(ratio(only(badge, 'text'), background)).toBeGreaterThanOrEqual(TEXT)
  })

  it.each(['.staff-success', '.staff-error'])('provider %s messages on a card', selector => {
    expect(ratio(declared(staffCss, selector, 'color'), token('surface'))).toBeGreaterThanOrEqual(TEXT)
  })
})

describe('provider link text is at least 4.5:1 (WCAG 1.4.3)', () => {
  // Cards and the page are white; an EmptyState's action sits on surface-sunk.
  it.each([
    ['.staff-text-link', 'surface'],
    ['.staff-text-link', 'surface-sunk'],
    ['.staff-muted a', 'surface'],
    ['.staff-module', 'surface'],
    ['.staff-module strong', 'surface'],
    ['.staff-module small', 'surface'],
  ])('%s on --color-%s', (text, surface) => {
    expect(ratio(declared(staffCss, text, 'color'), token(surface))).toBeGreaterThanOrEqual(TEXT)
  })

  it.each(['.staff-module', '.staff-module strong', '.staff-module small'])('%s on a hovered workspace card', text => {
    expect(ratio(declared(staffCss, text, 'color'), declared(staffCss, '.staff-module:hover', 'background'))).toBeGreaterThanOrEqual(TEXT)
  })
})

describe('faint small text is at least 4.5:1 (WCAG 1.4.3)', () => {
  it.each([
    ['.staff-facility label', '.staff-sidebar'],
    ['.staff-nav-meta', '.staff-sidebar'],
    ['.staff-sidebar-footer p', '.staff-sidebar'],
    ['.staff-nav-meta', '.staff-nav-link.active'],
    ['.staff-nav-meta', '.staff-nav-link:hover'],
  ])('provider %s on %s', (text, surface) => {
    expect(ratio(declared(staffCss, text, 'color'), declared(staffCss, surface, 'background'))).toBeGreaterThanOrEqual(TEXT)
  })

  it('provider table headings on a card', () => {
    expect(ratio(declared(staffCss, '.staff-table th', 'color'), token('surface'))).toBeGreaterThanOrEqual(TEXT)
  })

  // The public site uses text-faint on these surfaces (labels, footnotes, metadata).
  it.each(['surface', 'surface-sunk', 'surface-tint', 'surface-hover', 'brand-tint'])('--color-faint on --color-%s', surface => {
    expect(ratio(token('faint'), token(surface))).toBeGreaterThanOrEqual(TEXT)
  })
})

describe('the opt-in dark palette keeps the new pairs', () => {
  it('control boundaries', () => {
    for (const surface of CONTROL_SURFACES) expect(ratio(token('line-control', dark), token(surface, dark)), surface).toBeGreaterThanOrEqual(BOUNDARY)
  })

  it.each(['positive', 'caution'])('%s status text on its tint', status => {
    const background = over(token(status, dark), 0.1, token('surface', dark))
    expect(ratio(token(`${status}-ink`, dark), background)).toBeGreaterThanOrEqual(TEXT)
  })
})
