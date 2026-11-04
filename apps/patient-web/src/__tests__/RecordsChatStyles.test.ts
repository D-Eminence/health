import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from './cssRules'

/**
 * The older records cards and the chat screen in both themes (RN-03, RN-13, RN-21). jsdom applies no stylesheet, so
 * these read the stylesheets: a literal light colour stays light in dark mode, where the text turns light too.
 */
const here = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(resolve(here, path), 'utf8')
const importedCss = read('../imported-history.css')
const chatCss = read('../routes/chat.css')

/** The declarations of every rule whose selector list holds `selector`. */
const bodyOf = (css: string, selector: string) => parse(css).filter(rule => rule.selectors.includes(selector)).map(rule => rule.body).join(';')
const HEX = /#[0-9a-f]{3,8}\b/i

describe('older records cards (imported-history.css)', () => {
  it('RN-03: use theme colours only, so they read in dark mode', () => {
    expect(importedCss).not.toMatch(HEX)
    expect(bodyOf(importedCss, '.imported-history-card')).toMatch(/background:\s*var\(--color-surface\)/)
    expect(bodyOf(importedCss, '.imported-history-card')).toMatch(/color:\s*var\(--color-ink\)/)
  })

  it('RN-13: leave the Download button to its own styles, icon and label on one line', () => {
    expect(parse(importedCss).some(rule => rule.selectors.some(selector => /\bbutton\b/.test(selector) && selector.startsWith('.imported-history-card')))).toBe(false)
  })

  it('RN-21: make Previous versions at least 44px tall', () => {
    expect(bodyOf(importedCss, '.imported-history-card summary')).toMatch(/min-height:\s*44px/)
  })
})

describe('the chat screen (chat.css)', () => {
  it('RN-21: make "Which records can I ask about?" at least 44px tall', () => {
    expect(bodyOf(chatCss, '.record-chat-coverage summary')).toMatch(/min-height:\s*44px/)
  })

  it('RN-21: colour a hovered suggestion and the light tints with theme colours', () => {
    expect(bodyOf(chatCss, '.record-chat-suggestions button:hover')).not.toMatch(HEX)
    expect(chatCss).not.toMatch(/#(f0f7ff|dbeafb|eef7ff|f5faff|a9cff9|f8fbff)\b/i)
  })
})
