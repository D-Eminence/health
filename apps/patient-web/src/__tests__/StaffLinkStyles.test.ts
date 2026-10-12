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

describe('the guard itself', () => {
  it('reads a NavLink whose className is a function', () => {
    expect(linkClasses('<NavLink to="/" className={({ isActive }) => `staff-nav-link${isActive ? \' active\' : \'\'}`}>Home</NavLink>'))
      .toEqual(['staff-nav-link'])
  })

  it('finds the provider link classes that had no rule', () => {
    expect(defined('staff-nav-link')).toBe(true)
    expect(defined('staff-nav')).toBe(true)
    expect(defined('staff-no-such-class')).toBe(false)
  })
})
