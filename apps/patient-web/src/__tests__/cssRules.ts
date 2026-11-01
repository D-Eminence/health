/**
 * A small reader for the portal stylesheets, shared by the tests that guard
 * them (jsdom applies no stylesheet). It reads the value that wins at a width:
 * the last declaration, in source order, among the rules that apply there.
 */
export interface Rule { selectors: string[]; body: string; context: string[] }

/** Splits a selector list on its top-level commas, keeping `:is(a, b)` whole. */
function splitSelectors(list: string): string[] {
  const selectors: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < list.length; index += 1) {
    if (list[index] === '(') depth += 1
    else if (list[index] === ')') depth -= 1
    else if (list[index] === ',' && depth === 0) { selectors.push(list.slice(start, index).trim()); start = index + 1 }
  }
  selectors.push(list.slice(start).trim())
  return selectors
}

export function parse(css: string, context: string[] = []): Rule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: Rule[] = []
  let index = 0
  for (;;) {
    const open = source.indexOf('{', index)
    if (open < 0) break
    const before = source.slice(index, open)
    const prelude = before.slice(before.lastIndexOf(';') + 1).trim()
    let depth = 1
    let end = open + 1
    while (end < source.length && depth > 0) { if (source[end] === '{') depth += 1; else if (source[end] === '}') depth -= 1; end += 1 }
    const body = source.slice(open + 1, end - 1)
    if (/^@(media|layer|supports|container)\b/.test(prelude)) rules.push(...parse(body, [...context, prelude]))
    else rules.push({ selectors: splitSelectors(prelude), body, context })
    index = end
  }
  return rules
}

/**
 * Whether every media condition (max-width and min-width in px) holds at a viewport width. A container query's
 * max-width is read against the viewport too: a container is never wider than the screen, so a rule for a narrow
 * container holds on a narrow screen (its min-width conditions are not assumed, and such a rule is not applied).
 */
export function appliesAt(context: string[], width: number): boolean {
  if (context.some(prelude => prelude.startsWith('@container') && /\(min-width:/.test(prelude))) return false
  return context.filter(prelude => prelude.startsWith('@media') || prelude.startsWith('@container')).every(prelude =>
    [...prelude.matchAll(/\((max|min)-width:\s*(\d+)px\)/g)].every(([, bound, px]) => bound === 'max' ? width <= Number(px) : width >= Number(px)))
}

/** `selector` may list several of equal specificity that match one element, such as its classes: the last rule wins. */
export function valueAt(css: string, selector: string | readonly string[], property: string, width: number): string | undefined {
  const selectors = [selector].flat()
  return parse(css)
    .filter(rule => rule.selectors.some(candidate => selectors.includes(candidate)) && appliesAt(rule.context, width))
    .flatMap(rule => [...rule.body.matchAll(new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+)`, 'g'))].map(match => match[1]!.trim()))
    .at(-1)
}
