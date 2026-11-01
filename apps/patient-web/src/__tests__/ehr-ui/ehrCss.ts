import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, type Rule } from '../cssRules'

/**
 * Reads packages/ui/src/ehr for the EHR design foundation's tests: the
 * stylesheet, its tokens resolved through var(), and WCAG 2 contrast. jsdom
 * computes no style, so these read the source.
 */

// A path, not a URL: jsdom replaces the global URL class, which Node's file API refuses.
const here = dirname(fileURLToPath(import.meta.url))
export const ehrDirectory = resolve(here, '../../../../../packages/ui/src/ehr')
export const ehrCss = readFileSync(join(ehrDirectory, 'ehr.css'), 'utf8')
export const ehrCssWithoutComments = ehrCss.replace(/\/\*[\s\S]*?\*\//g, '')
/**
 * The stylesheet's rules, with the style rules inside each @container block read as rules of their own (the shared
 * reader keeps an @container block whole), so every check reaches them. Their `context` holds the @container prelude.
 */
export const ehrRules: Rule[] = parse(ehrCss).flatMap(rule => {
  const prelude = rule.selectors.join(', ')
  return /^@container\b/.test(prelude) ? parse(rule.body, [...rule.context, prelude]) : [rule]
})

/** Whether every @container width condition (max-width and min-width in px) holds at a content-area width. */
function containerAppliesAt(context: readonly string[], width: number): boolean {
  return context.filter(prelude => prelude.startsWith('@container')).every(prelude =>
    [...prelude.matchAll(/\((max|min)-width:\s*(\d+)px\)/g)].every(([, bound, px]) => bound === 'max' ? width <= Number(px) : width >= Number(px)))
}

/**
 * The value that wins for `selector` at a content-area width, among the rules outside @media and the @container
 * rules that apply at that width (the page's own content follows the room the page gives it, not the window).
 */
export function valueInContainer(selector: string, property: string, width: number): string | undefined {
  const value = ehrRules
    .filter(rule => rule.selectors.includes(selector))
    .filter(rule => !rule.context.some(prelude => prelude.startsWith('@media')) && containerAppliesAt(rule.context, width))
    .flatMap(rule => declarations(rule.body, property))
    .at(-1)
  return value === undefined ? undefined : resolveVars(value)
}

/** Every file under packages/ui/src/ehr, subfolders included, relative to it. */
export function ehrFiles(directory = ehrDirectory, prefix = ''): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? ehrFiles(path, `${prefix}${name}/`) : [`${prefix}${name}`]
  })
}

export function readEhrFile(relativePath: string): string {
  return readFileSync(join(ehrDirectory, relativePath), 'utf8')
}

/** The custom properties declared on the `.hid-ehr` root, in source order. */
export const ehrDeclarations: ReadonlyMap<string, string> = (() => {
  const roots = ehrRules.filter(rule => rule.context.length === 0 && rule.selectors.length === 1 && rule.selectors[0] === '.hid-ehr')
  if (roots.length !== 1) throw new Error(`ehr.css has ${roots.length} .hid-ehr root rules`)
  return new Map([...roots[0]!.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name!, value!.trim()]))
})()

/** A value with each var(--ehr-*) replaced by what the root declares for it. */
export function resolveVars(value: string): string {
  let resolved = value
  for (let depth = 0; depth < 5 && resolved.includes('var('); depth += 1) {
    resolved = resolved.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
      const declared = ehrDeclarations.get(name)
      if (declared === undefined) throw new Error(`ehr.css declares no ${name}`)
      return declared
    })
  }
  return resolved
}

/** The token's value, resolved. */
export function token(name: string): string {
  return resolveVars(`var(--ehr-${name})`)
}

/** Each declaration of `property` in a rule body (`color` does not match `background-color`). */
export function declarations(body: string, property: string): string[] {
  return [...body.matchAll(new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+)`, 'g'))].map(match => match[1]!.trim())
}

type Rgb = [number, number, number]

export function rgb(hex: string): Rgb {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) throw new Error(`not an opaque hex colour: ${hex}`)
  const digits = match[1]!.length === 3 ? [...match[1]!].map(digit => digit + digit).join('') : match[1]!
  return [0, 2, 4].map(index => Number.parseInt(digits.slice(index, index + 2), 16)) as Rgb
}

function luminance(colour: Rgb): number {
  const [red, green, blue] = colour.map(channel => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }) as Rgb
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/** The WCAG 2 contrast ratio of two opaque hex colours. */
export function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(rgb(foreground)), luminance(rgb(background))].sort((x, y) => y - x) as [number, number]
  return (lighter + 0.05) / (darker + 0.05)
}
