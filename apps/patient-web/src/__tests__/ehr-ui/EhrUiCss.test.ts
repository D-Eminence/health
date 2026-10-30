import { describe, expect, it } from 'vitest'
import { valueAt } from '../cssRules'
import { declarations, ehrCss, ehrCssWithoutComments, ehrRules, resolveVars, token } from './ehrCss'

/**
 * ehr.css is scoped: every rule sits under .hid-ehr and names only hid-ehr-*
 * classes, keyframes are hid-ehr-*, and custom properties are declared on
 * .hid-ehr only, so loading it can restyle nothing in the live product.
 */

const AT_RULE = /^@(font-face|keyframes)\b/
const styleRules = ehrRules.filter(rule => !AT_RULE.test(rule.selectors[0]!))
const selectors = styleRules.flatMap(rule => rule.selectors)
const PHONE = 390
const DESKTOP = 1280

/** Splits a selector into its compound selectors, keeping `:not(a b)` and `[a='b c']` whole. */
function compounds(selector: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const character of selector) {
    if (character === '(' || character === '[') depth += 1
    if (character === ')' || character === ']') depth -= 1
    if (depth === 0 && /[\s>+~]/.test(character)) {
      if (current) parts.push(current)
      current = ''
    } else current += character
  }
  if (current) parts.push(current)
  return parts
}

const resolved = (selector: string, property: string, width: number) => {
  const value = valueAt(ehrCss, selector, property, width)
  return value === undefined ? undefined : resolveVars(value)
}

describe('ehr.css scope', () => {
  it('has style rules to check', () => {
    expect(selectors.length).toBeGreaterThan(50)
  })

  it('puts every selector under .hid-ehr, except @font-face and @keyframes', () => {
    expect(selectors.filter(selector => !/^\.hid-ehr(?![\w-])/.test(selector))).toEqual([])
    const atRules = ehrRules.filter(rule => rule.selectors[0]!.startsWith('@')).map(rule => rule.selectors[0]!.split(/\s/)[0])
    expect(new Set(atRules)).toEqual(new Set(['@font-face', '@keyframes']))
  })

  it('names no element on its own: every compound selector carries a hid-ehr class', () => {
    expect(selectors.flatMap(compounds).filter(part => !/\.hid-ehr(?:-[\w-]+)?(?![\w-])/.test(part))).toEqual([])
  })

  it('uses only hid-ehr classes, and no .waya- selector at all', () => {
    const classes = selectors.flatMap(selector => [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(match => match[1]!))
    expect(classes.filter(name => name !== 'hid-ehr' && !name.startsWith('hid-ehr-'))).toEqual([])
    expect(ehrCss).not.toMatch(/\.waya-/)
  })

  it('contains none of :root, html, body, *, @theme, @layer, !important or data: URLs', () => {
    expect(ehrCssWithoutComments).not.toMatch(/:root\b/)
    expect(ehrCssWithoutComments).not.toMatch(/@theme\b/)
    expect(ehrCssWithoutComments).not.toMatch(/@layer\b/)
    expect(ehrCssWithoutComments).not.toMatch(/!\s*important/)
    expect(ehrCssWithoutComments).not.toMatch(/data:/)
    for (const part of selectors.flatMap(compounds)) {
      expect(part).not.toMatch(/^(html|body)\b/)
      expect(part).not.toContain('*')
    }
  })

  it('declares custom properties only on .hid-ehr, all --ehr-*, and defines no --color-*', () => {
    const declaredOn = styleRules.filter(rule => /(?:^|;|\s)--[\w-]+\s*:/.test(rule.body)).map(rule => rule.selectors.join(', '))
    expect(declaredOn).toEqual(['.hid-ehr'])
    const names = [...ehrCssWithoutComments.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]!)
    expect(names.filter(name => !name.startsWith('--ehr-'))).toEqual([])
    expect(ehrCssWithoutComments).not.toMatch(/--color-/)
  })

  it('names every @keyframes hid-ehr-*, and animates only with those', () => {
    const keyframes = [...ehrCssWithoutComments.matchAll(/@keyframes\s+([\w-]+)/g)].map(match => match[1]!)
    expect(keyframes.length).toBeGreaterThan(0)
    expect(keyframes.filter(name => !name.startsWith('hid-ehr-'))).toEqual([])
    const used = styleRules.flatMap(rule => [...declarations(rule.body, 'animation'), ...declarations(rule.body, 'animation-name')])
      .map(value => value.split(/\s+/)[0]!).filter(name => name !== 'none')
    expect(used.length).toBeGreaterThan(0)
    for (const name of used) expect(keyframes).toContain(name)
  })

  it('self-hosts its fonts with font-display: swap', () => {
    const faces = ehrRules.filter(rule => rule.selectors[0] === '@font-face')
    expect(faces).toHaveLength(2)
    for (const face of faces) {
      expect(declarations(face.body, 'font-display')).toEqual(['swap'])
      expect(declarations(face.body, 'src')[0]).toMatch(/^url\('\.\/fonts\/[\w-]+\.(woff2?)'\) format\('\1'\)$/)
    }
  })
})

describe('ehr.css behaviour', () => {
  it('gives every interactive class a visible :focus-visible ring', () => {
    const interactive = [
      'skip-link', 'button', 'nav-link', 'nav-group-toggle', 'sidebar-toggle', 'control', 'module-tab', 'table-scroll', 'stat-card-link',
    ]
    for (const name of interactive) {
      const ring = styleRules.find(rule =>
        rule.selectors.some(selector => selector.startsWith(`.hid-ehr .hid-ehr-${name}:focus-visible`))
        && declarations(rule.body, 'outline').some(value => value !== 'none'))
      expect(ring, name).toBeDefined()
      expect(resolveVars(declarations(ring!.body, 'outline')[0]!)).toBe(`3px solid ${token('brand')}`)
      expect(resolveVars(declarations(ring!.body, 'outline-offset')[0]!)).toBe('3px')
    }
  })

  it('turns animation and transition off under prefers-reduced-motion, for every selector that moves', () => {
    const reduced = styleRules.filter(rule => rule.context.some(context => /prefers-reduced-motion:\s*reduce/.test(context)))
    expect(reduced.length).toBeGreaterThan(0)
    for (const rule of reduced) {
      expect(declarations(rule.body, 'animation')).toEqual(['none'])
      expect(declarations(rule.body, 'transition')).toEqual(['none'])
    }
    const stilled = new Set(reduced.flatMap(rule => rule.selectors))
    const moving = styleRules
      .filter(rule => !reduced.includes(rule))
      .filter(rule => ['animation', 'animation-name', 'transition'].some(property => declarations(rule.body, property).some(value => value !== 'none')))
      .flatMap(rule => rule.selectors)
    expect(moving.length).toBeGreaterThan(0)
    expect(moving.filter(selector => !stilled.has(selector))).toEqual([])
    // Declared last, so it wins over the rules it stills without !important.
    const lastMoving = Math.max(...styleRules.map((rule, index) => (rule.selectors.some(selector => moving.includes(selector)) && !reduced.includes(rule) ? index : -1)))
    expect(Math.min(...reduced.map(rule => styleRules.indexOf(rule)))).toBeGreaterThan(lastMoving)
  })

  it('isolates the shell root, so the EHR z-index scale stays inside it', () => {
    expect(valueAt(ehrCss, '.hid-ehr.hid-ehr-shell', 'isolation', DESKTOP)).toBe('isolate')
  })

  it('covers the whole viewport with the scrim, at the overlay layer', () => {
    expect(valueAt(ehrCss, '.hid-ehr .hid-ehr-scrim', 'inset', PHONE)).toBe('0')
    expect(valueAt(ehrCss, '.hid-ehr .hid-ehr-scrim', 'position', PHONE)).toBe('fixed')
    expect(resolved('.hid-ehr .hid-ehr-scrim', 'z-index', DESKTOP)).toBe(token('z-overlay'))
    expect(resolved('.hid-ehr .hid-ehr-scrim', 'background', DESKTOP)).toBe('#0b1b2e66')
  })

  it('keeps the sidebar and top bar below the popover and overlay layers', () => {
    const overlay = Number(token('z-overlay'))
    const popover = Number(token('z-popover'))
    expect([overlay, popover]).toEqual([200, 110])
    for (const selector of ['.hid-ehr .hid-ehr-sidebar', '.hid-ehr .hid-ehr-topbar']) {
      const zIndex = Number(resolved(selector, 'z-index', DESKTOP))
      expect(zIndex).toBe(100)
      expect(zIndex).toBeLessThan(popover)
      expect(zIndex).toBeLessThan(overlay)
    }
  })

  it('sizes the chrome: sidebar 247px (60px collapsed), top bar 76px, 64px on phones', () => {
    expect(resolved('.hid-ehr .hid-ehr-sidebar', 'width', DESKTOP)).toBe('247px')
    expect(resolved('.hid-ehr .hid-ehr-sidebar.hid-ehr-sidebar-collapsed', 'width', DESKTOP)).toBe('60px')
    expect(resolved('.hid-ehr .hid-ehr-topbar', 'height', DESKTOP)).toBe('76px')
    expect(resolved('.hid-ehr .hid-ehr-topbar', 'height', PHONE)).toBe('64px')
    expect(resolved('.hid-ehr .hid-ehr-topbar', 'height', 768)).toBe('64px')
    expect(resolved('.hid-ehr .hid-ehr-topbar', 'height', 769)).toBe('76px')
  })

  it('hides the rail and shows the menu button on phones only', () => {
    expect(valueAt(ehrCss, '.hid-ehr .hid-ehr-sidebar', 'display', DESKTOP)).toBe('flex')
    expect(valueAt(ehrCss, '.hid-ehr .hid-ehr-sidebar', 'display', PHONE)).toBe('none')
    expect(valueAt(ehrCss, '.hid-ehr .hid-ehr-button.hid-ehr-topbar-menu', 'display', DESKTOP)).toBe('none')
    expect(valueAt(ehrCss, '.hid-ehr .hid-ehr-button.hid-ehr-topbar-menu', 'display', PHONE)).toBe('inline-flex')
  })

  it('makes the drawer a right-hand panel, and a bottom sheet at 700px and below', () => {
    expect(resolved('.hid-ehr .hid-ehr-drawer', 'width', DESKTOP)).toBe('min(680px, 95vw)')
    expect(valueAt(ehrCss, '.hid-ehr .hid-ehr-drawer', 'height', DESKTOP)).toBe('100%')
    expect(valueAt(ehrCss, '.hid-ehr .hid-ehr-scrim', 'justify-content', DESKTOP)).toBe('flex-end')

    expect(valueAt(ehrCss, '.hid-ehr .hid-ehr-drawer', 'width', PHONE)).toBe('100%')
    expect(valueAt(ehrCss, '.hid-ehr .hid-ehr-drawer', 'height', PHONE)).toBe('88%')
    expect(valueAt(ehrCss, '.hid-ehr .hid-ehr-drawer', 'border-radius', PHONE)).toBe('20px 20px 0 0')
    expect(valueAt(ehrCss, '.hid-ehr .hid-ehr-scrim.hid-ehr-scrim-drawer', 'align-items', PHONE)).toBe('flex-end')
    expect(valueAt(ehrCss, '.hid-ehr .hid-ehr-drawer', 'animation-name', PHONE)).toBe('hid-ehr-sheet-enter')
    expect(valueAt(ehrCss, '.hid-ehr .hid-ehr-scrim.hid-ehr-scrim-drawer', 'align-items', 701)).toBeUndefined()
  })

  it('sets the page title in Playfair Display 400 at 40px, 34px and 24px', () => {
    const title = '.hid-ehr .hid-ehr-page-title'
    expect(resolved(title, 'font-family', DESKTOP)).toBe("'Playfair Display', Georgia, serif")
    expect(valueAt(ehrCss, title, 'font-weight', DESKTOP)).toBe('400')
    expect(resolved(title, 'font-size', DESKTOP)).toBe('40px')
    expect(resolved(title, 'font-size', 1000)).toBe('34px')
    expect(resolved(title, 'font-size', 768)).toBe('24px')
    expect(resolved(title, 'font-size', PHONE)).toBe('24px')
  })

  it('gives controls the design\'s border and a not-allowed cursor when disabled', () => {
    expect(resolved('.hid-ehr .hid-ehr-control', 'border', DESKTOP)).toBe('1px solid #c6c6cc')
    expect(valueAt(ehrCss, '.hid-ehr .hid-ehr-control:disabled', 'cursor', DESKTOP)).toBe('not-allowed')
    expect(valueAt(ehrCss, '.hid-ehr .hid-ehr-button:disabled', 'cursor', DESKTOP)).toBe('not-allowed')
  })

  it('sizes buttons 40px and 30px high with a 6px radius', () => {
    expect(valueAt(ehrCss, '.hid-ehr .hid-ehr-button', 'min-height', DESKTOP)).toBe('40px')
    expect(valueAt(ehrCss, '.hid-ehr .hid-ehr-button.hid-ehr-button-sm', 'min-height', DESKTOP)).toBe('30px')
    expect(resolved('.hid-ehr .hid-ehr-button', 'border-radius', DESKTOP)).toBe('6px')
  })

  it('styles the table header and cells from the reference', () => {
    const header = '.hid-ehr .hid-ehr-table-header'
    expect(resolved(header, 'background', DESKTOP)).toBe(token('surface-tint'))
    expect(valueAt(ehrCss, header, 'font-size', DESKTOP)).toBe('10px')
    expect(valueAt(ehrCss, header, 'font-weight', DESKTOP)).toBe('500')
    expect(resolved(header, 'color', DESKTOP)).toBe(token('muted'))
    expect(valueAt(ehrCss, '.hid-ehr .hid-ehr-table-cell', 'padding', DESKTOP)).toBe('13px 14px')
    expect(valueAt(ehrCss, '.hid-ehr .hid-ehr-table', 'font-size', DESKTOP)).toBe('12px')
  })

  it('provides a visually hidden class', () => {
    expect(valueAt(ehrCss, '.hid-ehr .hid-ehr-sr-only', 'position', DESKTOP)).toBe('absolute')
    expect(valueAt(ehrCss, '.hid-ehr .hid-ehr-sr-only', 'width', DESKTOP)).toBe('1px')
  })
})
