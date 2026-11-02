import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse, valueAt } from '../../cssRules'

/**
 * The shared pager's look. A page button that cannot act is aria-disabled, not disabled (as today's pager,
 * staff/routes/Clinical.tsx:355-374), so ehr.css's hover rules, written for :disabled, still match it. jsdom computes no
 * style, so these read the stylesheets.
 */
const here = dirname(fileURLToPath(import.meta.url))
const clinical = readFileSync(resolve(here, '../../../ehr-blue/clinical/clinical.css'), 'utf8')
const ehr = readFileSync(resolve(here, '../../../../../../packages/ui/src/ehr/ehr.css'), 'utf8')

/** The specificity of a selector made of classes, attributes and pseudo-classes only (as these are); :not() counts its argument. */
const weight = (selector: string) => (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!not\()[\w-]+/g) ?? []).length

describe('the pager’s unavailable buttons', () => {
  it('keep their resting look on hover, over ehr.css’s secondary hover', () => {
    const resting = '.hid-ehr .hid-ehr-button.hid-ehr-button-secondary'
    const hover = `${resting}:hover:not(:disabled):not([aria-busy='true'])`
    // What a working secondary button does on hover.
    expect(valueAt(ehr, hover, 'background', 1280)).toBe('var(--ehr-surface-tint)')
    const unavailable = parse(clinical).flatMap(rule => rule.selectors)
      .find(selector => selector.includes('.hid-ehr-clinical-pager') && selector.includes("[aria-disabled='true']") && selector.includes(':hover'))
    expect(unavailable).toBeDefined()
    expect(unavailable).toContain(":not([aria-busy='true'])")
    expect(weight(unavailable!)).toBeGreaterThan(weight(hover))
    for (const property of ['background', 'border-color']) {
      expect({ property, value: valueAt(clinical, unavailable!, property, 1280) }).toEqual({ property, value: valueAt(ehr, resting, property, 1280) })
    }
  })
})
