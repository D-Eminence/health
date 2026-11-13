import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from '../../cssRules'

/**
 * The chart's own section styles (clinical.css, .hid-ehr-clinical-today h2 and p) are unlayered, so they would override
 * the Tailwind sizes, margins and colours of a card drawn in the redesign's parts. The "imported from paper" cards
 * (.imported-from-paper) are left out of them; today's sections keep them. jsdom computes no style, so this matches
 * the stylesheet's selectors against a chart's markup.
 */
const here = dirname(fileURLToPath(import.meta.url))
const clinical = readFileSync(resolve(here, '../../../ehr-blue/clinical/clinical.css'), 'utf8')

function chart() {
  document.body.innerHTML = `<div class="hid-ehr"><div class="hid-ehr-clinical-today">
    <section class="staff-card"><h2 id="today-h2">Reported by the patient</h2><p id="today-p">Patient-reported</p></section>
    <section class="imported-from-paper"><div><h2 id="paper-h2">Lab results imported from paper (unverified)</h2></div>
      <div><p id="paper-p">None imported from paper.</p></div></section>
  </div></div>`
  return (id: string) => document.getElementById(id)!
}

const selectorsFor = (element: Element) => parse(clinical).flatMap(rule => rule.selectors)
  .filter(selector => selector.includes('.hid-ehr-clinical-today') && /\b(h2|p)\b/.test(selector) && element.matches(selector))

describe('the chart’s section styles', () => {
  it('apply to today’s sections’ headings and text', () => {
    const at = chart()
    expect(selectorsFor(at('today-h2')).length).toBeGreaterThan(0)
    expect(selectorsFor(at('today-p')).length).toBeGreaterThan(0)
  })

  it('leave the imported-from-paper cards’ headings and text alone', () => {
    const at = chart()
    expect(selectorsFor(at('paper-h2'))).toEqual([])
    expect(selectorsFor(at('paper-p'))).toEqual([])
  })
})
