/*
 * The page's stylesheets as they apply in print, as CSS text for a frame on screen: what is inside "@media print" applies
 * always, what is for the screen alone is left out, and everything else stays as it is. paperPdf.ts lays a paper out
 * with this in a frame of its own, so the PDF holds what the browser itself would print (each paper's print rules,
 * Tailwind's print: classes), from the same stylesheets, with nothing written twice.
 */

/** A media query list as it applies in print: 'all' (always), null (never), or the queries left to the frame to test. */
export function printMedia(mediaText: string): string | null {
  const kept: string[] = []
  for (const raw of mediaText.split(',')) {
    const query = raw.trim().replace(/\s+/g, ' ')
    if (!query) continue
    const lower = query.toLowerCase()
    const negated = lower.startsWith('not ')
    const rest = negated ? query.slice(4) : lower.startsWith('only ') ? query.slice(5) : query
    const type = /^(all|print|screen|speech|tty|tv|projection|handheld|braille|embossed|aural)\b/i.exec(rest)?.[1]?.toLowerCase()
    const conditions = type ? rest.slice(type.length).replace(/^\s*and\s*/i, '') : rest
    if (negated) {
      // "not print …" never holds in print; "not screen …" always does; "not all …" never.
      if (type === 'screen' || (type && type !== 'all' && type !== 'print')) kept.push('all')
      continue
    }
    if (type && type !== 'all' && type !== 'print') continue
    kept.push(conditions.trim() ? conditions.trim() : 'all')
  }
  if (kept.length === 0) return null
  return kept.includes('all') ? 'all' : kept.join(', ')
}

type Rule = CSSRule & {
  readonly cssRules?: CSSRuleList
  readonly media?: MediaList
  readonly conditionText?: string
  readonly containerName?: string
  readonly name?: string
  readonly selectorText?: string
  readonly style?: CSSStyleDeclaration
  readonly styleSheet?: CSSStyleSheet | null
}

const STYLE_RULE = 1
const IMPORT_RULE = 3
const MEDIA_RULE = 4
const SUPPORTS_RULE = 12

function rulesOf(list: CSSRuleList | undefined | null): Rule[] {
  return list ? Array.from(list) as Rule[] : []
}

/** One rule as CSS text, with print's media applied inside it. */
function ruleText(rule: Rule): string {
  if (rule.type === MEDIA_RULE && rule.media) {
    const media = printMedia(rule.media.mediaText)
    if (media === null) return ''
    const inner = listText(rule.cssRules)
    return media === 'all' ? inner : `@media ${media}{${inner}}`
  }
  if (rule.type === IMPORT_RULE) {
    let sheet: CSSStyleSheet | null | undefined
    try { sheet = rule.styleSheet } catch { sheet = null }
    const media = rule.media ? printMedia(rule.media.mediaText || 'all') : 'all'
    if (!sheet || media === null) return ''
    const inner = sheetText(sheet)
    return media === 'all' ? inner : `@media ${media}{${inner}}`
  }
  if (rule.type === SUPPORTS_RULE && rule.conditionText !== undefined) return `@supports ${rule.conditionText}{${listText(rule.cssRules)}}`
  if (rule.type === STYLE_RULE && rule.selectorText !== undefined && rule.style) {
    // A rule with rules nested in it (CSS nesting, as Tailwind writes print:): its own declarations, then each nested one.
    const nested = rulesOf(rule.cssRules)
    return nested.length ? `${rule.selectorText}{${rule.style.cssText}${nested.map(ruleText).join('')}}` : rule.cssText
  }
  if (rule.cssRules && rule.containerName !== undefined && rule.conditionText !== undefined) {
    return `@container ${rule.conditionText}{${listText(rule.cssRules)}}`
  }
  // @layer name { … }: a layer statement (@layer a, b;) has no rules and is kept as it is.
  if (rule.cssRules && typeof rule.name === 'string' && rule.constructor?.name === 'CSSLayerBlockRule') {
    return `@layer ${rule.name}{${listText(rule.cssRules)}}`
  }
  return rule.cssText
}

function listText(list: CSSRuleList | undefined | null): string {
  return rulesOf(list).map(ruleText).join('\n')
}

/** A stylesheet as it applies in print; one this page may not read (from another site) gives nothing. */
export function sheetText(sheet: CSSStyleSheet): string {
  const media = printMedia(sheet.media?.mediaText || 'all')
  if (media === null) return ''
  let rules: CSSRuleList
  try { rules = sheet.cssRules } catch { return '' }
  const inner = listText(rules)
  return media === 'all' ? inner : `@media ${media}{${inner}}`
}

/** Every stylesheet on the page, in order, as it applies in print. */
export function printCssText(sheets: Iterable<CSSStyleSheet>): string {
  const parts: string[] = []
  for (const sheet of sheets) {
    if (sheet.disabled) continue
    parts.push(sheetText(sheet))
  }
  return parts.join('\n')
}
