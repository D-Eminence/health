import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse, valueAt } from './cssRules'

/**
 * PEHR-06 (WCAG 1.4.1 Use of Color). Tailwind's preflight gives every link the
 * surrounding text's colour and no underline, and the provider portal's link
 * classes had no rule: 'Open clinical record →', 'Change patient →' and the
 * workspace cards read as plain text, and 'Forgot your password?' was the same
 * grey as its sentence. A link needs a cue other than colour: an underline.
 */

// A path, not a URL: jsdom replaces the global URL class, which Node's file API refuses.
const here = dirname(fileURLToPath(import.meta.url))
const staffDirectory = resolve(here, '../staff')
const staffCss = readFileSync(join(staffDirectory, 'style.css'), 'utf8')
const portalCss = readFileSync(resolve(here, '../index.css'), 'utf8')
const DESKTOP = 1280

const underlined = (selector: string) => valueAt(staffCss, selector, 'text-decoration', DESKTOP) ?? ''

/** The portal class names on each link element (<a>, <Link>, <NavLink>) in a TSX source. */
function linkClasses(source: string): string[] {
  return [...source.matchAll(/<(?:a|Link|NavLink)\s/g)].flatMap(match => {
    // The opening tag ends at the first '>' outside braces, so `=>` in a className function is skipped.
    let depth = 0
    let end = match.index
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1
      else if (source[end] === '}') depth -= 1
      else if (source[end] === '>' && depth === 0) break
    }
    return [...source.slice(match.index, end).matchAll(/\b(?:staff|patient)-[a-z0-9-]+/g)].map(([name]) => name)
  })
}

const staffSources = (readdirSync(staffDirectory, { recursive: true }) as string[])
  .filter(path => path.endsWith('.tsx') && !path.includes('test'))
  .map(path => [path, readFileSync(join(staffDirectory, path), 'utf8')] as const)

const defined = (name: string) => [staffCss, portalCss].some(css =>
  parse(css).some(rule => rule.selectors.some(selector => new RegExp(`\\.${name}(?![\\w-])`).test(selector))))

/** The portal class names in every className of a TSX source, whatever the element. */
function classNames(source: string): string[] {
  return [...source.matchAll(/className=/g)].flatMap(match => {
    // A quoted value ends at its quote; an expression at its closing brace.
    let end = match.index + 'className='.length
    const open = source[end]
    if (open === '"') end = source.indexOf('"', end + 1)
    else for (let depth = 0; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1
      else if (source[end] === '}' && --depth === 0) break
    }
    return [...source.slice(match.index, end).matchAll(/\b(?:staff|patient)-[a-z0-9-]+/g)].map(([name]) => name)
  })
}

// Classes that still have no rule, left for a layout pass. Each is on an element
// another class already lays out (a card, a two-column grid, a list item's text)
// or wraps text that carries its own class.
const LAYOUT_GAPS = ['staff-current', 'staff-gap-card', 'staff-feedback', 'staff-encounter-grid', 'staff-note-content']

describe('PEHR-06: provider links are distinguishable from text without colour', () => {
  it('underlines the standalone text links in the brand colour', () => {
    expect(valueAt(staffCss, '.staff-text-link', 'color', DESKTOP)).toBe('var(--color-brand)')
    expect(underlined('.staff-text-link')).toContain('underline')
  })

  it('underlines a link inside a sentence, such as "Forgot your password?" on provider sign-in', () => {
    expect(valueAt(staffCss, '.staff-muted a', 'color', DESKTOP)).toBe('var(--color-brand)')
    expect(underlined('.staff-muted a')).toContain('underline')
  })

  it('lays out each workspace card as a card, with an underlined call to action', () => {
    expect(valueAt(staffCss, '.staff-module', 'display', DESKTOP)).toBe('grid')
    expect(valueAt(staffCss, '.staff-module', 'border', DESKTOP)).toBeDefined()
    expect(valueAt(staffCss, '.staff-module small', 'color', DESKTOP)).toBe('var(--color-brand)')
    expect(underlined('.staff-module small')).toContain('underline')
  })

  it.each(staffSources)('styles every class a link uses in staff/%s', (_, source) => {
    expect(linkClasses(source).filter(name => !defined(name))).toEqual([])
  })
})

describe('PEHR-06: provider section headings, toolbars and details read as such', () => {
  // Preflight gives a heading the body text's size and weight: 'Workspaces' on the
  // overview and 'Review and publication history' in OCR looked like a sentence.
  it.each(['font-size', 'font-weight', 'color'])('gives a section heading the card heading %s', property => {
    expect(valueAt(staffCss, '.staff-section > h2', property, DESKTOP)).toBe(valueAt(staffCss, '.staff-card h2', property, DESKTOP))
  })

  it('spaces a section from the content above it, and a toolbar from the content below it', () => {
    expect(valueAt(staffCss, '.staff-section', 'margin-top', DESKTOP)).toMatch(/^[1-9]\d*px$/)
    expect(valueAt(staffCss, '.staff-toolbar', 'margin-bottom', DESKTOP)).toMatch(/^[1-9]\d*px$/)
  })

  // Detail renders <span>label</span><strong>value</strong> with nothing between: 'Corrected at12/10/2026'.
  it('separates a clinical detail\'s label from its value', () => {
    expect(valueAt(staffCss, '.staff-detail', 'display', DESKTOP)).toMatch(/^(flex|grid)$/)
    expect(valueAt(staffCss, '.staff-detail', 'gap', DESKTOP)).toBeDefined()
  })

  it.each(staffSources)('styles every class in staff/%s, apart from the known layout gaps', (_, source) => {
    expect(classNames(source).filter(name => !defined(name) && !LAYOUT_GAPS.includes(name))).toEqual([])
  })

  it('lists as layout gaps only classes that still have no rule', () => {
    expect(LAYOUT_GAPS.filter(defined)).toEqual([])
  })
})

describe('the guard itself', () => {
  it('reads a NavLink whose className is a function', () => {
    expect(linkClasses('<NavLink to="/" className={({ isActive }) => `staff-nav-link${isActive ? \' active\' : \'\'}`}>Home</NavLink>'))
      .toEqual(['staff-nav-link'])
  })

  it('reads the classes of a quoted and of a conditional className', () => {
    expect(classNames('<p className="staff-card staff-current">x</p><p className={error ? \'staff-error\' : \'staff-success\'}>y</p>'))
      .toEqual(['staff-card', 'staff-current', 'staff-error', 'staff-success'])
  })

  it('finds the provider link classes that had no rule', () => {
    expect(defined('staff-nav-link')).toBe(true)
    expect(defined('staff-nav')).toBe(true)
    expect(defined('staff-no-such-class')).toBe(false)
  })
})
