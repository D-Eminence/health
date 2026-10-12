import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GlobalSearch, GlobalSearchProvider } from '@/components/layout/GlobalSearch'
import { DemoDialog } from '@/components/shared/DemoDialog'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/env', () => ({
  getEnvironment: () => ({ name: 'local', appOrigin: 'http://localhost:3100',
    apiBaseUrl: 'http://localhost:3100', turnstileSiteKey: null }),
}))

/**
 * Colour contrast of the controls and small text the public site styles itself,
 * measured from the source (WCAG 1.4.3 and 1.4.11). The shared @hid/ui controls
 * are measured in apps/patient-web/src/__tests__/ColourContrast.test.tsx. jsdom
 * computes no colour, so this resolves each utility class or stylesheet value to
 * its value in packages/ui/src/tokens.css and computes the WCAG 2 contrast ratio.
 * A form control's border is its only visible boundary on a white form, so it
 * needs 3:1; small text needs 4.5:1.
 */

// A path, not a URL: jsdom replaces the global URL class, which Node's file API refuses.
const here = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(resolve(here, path), 'utf8')
const tokensCss = read('../../../packages/ui/src/tokens.css')
const aboutCss = read('../app/about/about.css')
const BOUNDARY = 3
const TEXT = 4.5

type Rgb = [number, number, number]

/** The `--color-*: #hex` declarations in the light @theme block of tokens.css. */
const palette = new Map([...(/@theme\s*\{([^}]*)\}/.exec(tokensCss)?.[1] ?? '')
  .matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[0-9a-f]{6})\b/gi)].map(([, name, hex]) => [name!, hex!]))

function rgb(hex: string): Rgb {
  return [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16)) as Rgb
}

function luminance(colour: Rgb): number {
  const [red, green, blue] = colour.map(channel => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }) as Rgb
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function ratio(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100
}

function token(name: string): Rgb {
  const hex = palette.get(name)
  if (!hex) throw new Error(`tokens.css declares no --color-${name}`)
  return rgb(hex)
}

/** The colour a stylesheet value names: `var(--color-x)` or a hex literal. */
function cssColour(value: string): Rgb {
  const name = /var\(--color-([a-z0-9-]+)\)/.exec(value)?.[1]
  if (name) return token(name)
  const hex = /#[0-9a-f]{6}\b/i.exec(value)?.[0]
  if (!hex) throw new Error(`no colour in ${value}`)
  return rgb(hex)
}

/** The one resting colour a utility prefix (`border`, `bg`, `text`) gives an element; two would leave the winner to source order. */
function only(element: Element, prefix: string): Rgb {
  const found = [...element.classList].flatMap(name => {
    const match = new RegExp(`^${prefix}-([a-z][a-z0-9-]*)$`).exec(name)
    return match && palette.has(match[1]!) ? [match[1]!] : []
  })
  expect(found, `${prefix}-* colour utilities on <${element.tagName.toLowerCase()}>`).toHaveLength(1)
  return token(found[0]!)
}

/**
 * The last value a stylesheet gives a selector for `border` or `border-color`, in
 * source order: the one that wins when the rules match equally.
 */
function lastBorder(css: string, selector: string): string | undefined {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors!.split(',').map(item => item.trim()).includes(selector))
    .flatMap(([, , body]) => [...body!.matchAll(/(?:^|;)\s*border(?:-color)?\s*:\s*([^;]+)/g)].map(match => match[1]!.trim()))
    .at(-1)
}

const controls = (container: Element) => [...container.querySelectorAll('input, select, textarea')]
/** A control's visible label: the text that opens the <label> wrapping it. */
const labelOf = (control: Element) => control.closest('label')?.firstChild?.textContent?.trim() ?? control.tagName

describe('the boundary of a public form control is at least 3:1 (WCAG 1.4.11)', () => {
  it('the demo request dialog: its select, text fields and notes', () => {
    const { container } = render(<DemoDialog />)
    expect(controls(container).length).toBeGreaterThanOrEqual(7)
    for (const control of controls(container)) {
      expect(ratio(only(control, 'border'), only(control, 'bg')), labelOf(control)).toBeGreaterThanOrEqual(BOUNDARY)
    }
  })

  it('the demo request dialog: a refused text field shows its error border alone', () => {
    const { container } = render(<DemoDialog />)
    fireEvent.submit(container.querySelector('form')!)
    const refused = controls(container).filter(control => control.getAttribute('aria-invalid') === 'true' && control.tagName === 'INPUT')
    expect(refused.length).toBeGreaterThan(0)
    for (const control of refused) expect(ratio(only(control, 'border'), token('surface')), labelOf(control)).toBeGreaterThanOrEqual(BOUNDARY)
  })

  // The select shows only at 1100px and narrower, where every rule for it applies.
  it('/about: the "On this page" select on a narrow screen', () => {
    const border = lastBorder(aboutCss, '.about-mobile-navigation select')
    expect(border, '.about-mobile-navigation select declares a border').toBeDefined()
    expect(ratio(cssColour(border!), token('surface'))).toBeGreaterThanOrEqual(BOUNDARY)
  })
})

describe('small text on the public site is at least 4.5:1 (WCAG 1.4.3)', () => {
  // aria-hidden hides it from assistive technology, not from sight.
  it('the search shortcut hint in the site navigation', () => {
    const { container } = render(<GlobalSearchProvider><GlobalSearch /></GlobalSearchProvider>)
    const hint = container.querySelector('kbd')!
    expect(hint.textContent).toBe('⌘ K')
    expect(ratio(only(hint, 'text'), only(hint, 'bg'))).toBeGreaterThanOrEqual(TEXT)
  })
})
