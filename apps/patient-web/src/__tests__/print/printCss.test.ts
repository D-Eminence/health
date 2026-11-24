import { describe, expect, it } from 'vitest'
import { printCssText, printMedia } from '../../print/printCss'

/*
 * The page's stylesheets as they apply in print, for the frame a paper is laid out in before it is made into a PDF:
 * print rules always apply there, screen rules never.
 */

describe('media as it applies in print', () => {
  it('applies print and all, and leaves out the screen', () => {
    expect(printMedia('print')).toBe('all')
    expect(printMedia('all')).toBe('all')
    expect(printMedia('only print')).toBe('all')
    expect(printMedia('screen')).toBeNull()
    expect(printMedia('only screen and (min-width: 40rem)')).toBeNull()
    expect(printMedia('not print')).toBeNull()
    expect(printMedia('not screen')).toBe('all')
    expect(printMedia('screen, print')).toBe('all')
  })

  it('keeps conditions the frame can test itself', () => {
    expect(printMedia('print and (min-width: 40rem)')).toBe('(min-width: 40rem)')
    expect(printMedia('(min-width: 40rem)')).toBe('(min-width: 40rem)')
    expect(printMedia('(prefers-reduced-motion: reduce), screen')).toBe('(prefers-reduced-motion: reduce)')
  })
})

describe('the stylesheets as they print', () => {
  it('unwraps print rules, drops screen rules and keeps the rest', () => {
    const style = document.createElement('style')
    style.textContent = `
      .paper { color: red; }
      @media print { .paper { color: black; } .button { display: none; } }
      @media screen { .paper { display: none; } }
      @media (min-width: 40rem) { .wide { display: block; } }
    `
    document.head.appendChild(style)
    const css = printCssText([style.sheet!])
    style.remove()
    expect(css).toMatch(/\.paper\s*\{\s*color: red;\s*\}/)
    expect(css).toMatch(/\.paper\s*\{\s*color: black;\s*\}/)
    expect(css).toMatch(/\.button\s*\{\s*display: none;\s*\}/)
    expect(css).not.toMatch(/@media print/)
    expect(css).not.toMatch(/\.paper\s*\{\s*display: none/)
    expect(css).toMatch(/@media \(min-width: 40rem\)\s*\{\s*\.wide/)
  })

  it('skips a stylesheet it may not read', () => {
    const unreadable = { disabled: false, media: { mediaText: '' }, get cssRules(): CSSRuleList { throw new DOMException('cross-origin', 'SecurityError') } }
    expect(printCssText([unreadable as unknown as CSSStyleSheet])).toBe('')
  })
})
