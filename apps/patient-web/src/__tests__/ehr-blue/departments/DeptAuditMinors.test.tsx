import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DeptActions, DeptHistory } from '../../../ehr-blue/departments/parts/DeptRecord'
import { valueAt } from '../../cssRules'

/**
 * The design audit's department minors (audit/2026-10-30/lekan.md items 12-17), kept on top of the redesign (#69).
 * jsdom computes no style, so these read departments.css. Item 12's fact values take the design's text colour in the
 * blue cards and drawers only: the redesign's own record cards (Pharmacy, Outreach case) keep its ink.
 */
const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../../../ehr-blue/departments/departments.css'), 'utf8')
const at = (selector: string, property: string, width = 1280) => valueAt(css, selector, property, width)

describe('the department pages\' audit minors', () => {
  it('12. draws fact values, the patient line, history summaries, staff names and audit titles in the text colour', () => {
    expect(at('.hid-ehr :is(.hid-ehr-card, .hid-ehr-drawer) .hid-ehr-dept-fact dd', 'color')).toBe('var(--ehr-text)')
    expect(at('.hid-ehr .hid-ehr-dept-fact dd', 'color')).toBe('var(--ehr-ink)')
    expect(at('.hid-ehr .hid-ehr-dept-context-item:nth-of-type(2)', 'color')).toBe('var(--ehr-text)')
    expect(at('.hid-ehr .hid-ehr-dept-history summary', 'color')).toBe('var(--ehr-text)')
    expect(at('.hid-ehr .hid-ehr-dept-staff-name strong', 'color')).toBe('var(--ehr-text)')
    expect(at('.hid-ehr .hid-ehr-dept-staff-invitation strong', 'color')).toBe('var(--ehr-text)')
    expect(at('.hid-ehr .hid-ehr-dept-audit-action', 'color')).toBe('var(--ehr-text)')
  })

  it('13. keeps list rows tight, with Quick view and Open from the left', () => {
    expect(at('.hid-ehr .hid-ehr-table .hid-ehr-dept-reference', 'margin-top')).toBe('0')
    expect(at('.hid-ehr .hid-ehr-table .hid-ehr-dept-reference', 'font-size')).toBe('10px')
    expect(at('.hid-ehr .hid-ehr-table .hid-ehr-dept-link', 'font-size')).toBe('inherit')
    expect(at('.hid-ehr .hid-ehr-dept-table-actions', 'justify-content')).toBe('flex-start')
    expect(at('.hid-ehr .hid-ehr-dept-table-actions', 'gap')).toBe('0')
    expect(at('.hid-ehr .hid-ehr-dept-table-actions .hid-ehr-dept-link', 'margin-left')).toBeUndefined()
  })

  it('14. starts a create form 16px into its card, and no other form', () => {
    expect(at('.hid-ehr .hid-ehr-dept-section > .hid-ehr-dept-form:first-child', 'margin-top')).toBe('16px')
    // Not on every form: action forms, OCR and the staff forms use the class too.
    expect(at('.hid-ehr .hid-ehr-dept-form', 'margin-top')).toBeUndefined()
    expect(at('.hid-ehr .hid-ehr-dept-form', 'margin')).toBeUndefined()
  })

  it('15. leaves 24px below the two record columns', () => {
    expect(at('.hid-ehr .hid-ehr-dept-two-col', 'margin')).toBe('0 0 24px')
  })

  it('16. sets the first version entry 16px below its heading', () => {
    expect(at('.hid-ehr .hid-ehr-dept-history-card .hid-ehr-card-title', 'margin')).toBe('0 0 16px')
    render(<DeptHistory entries={[{ key: '1', summary: '26 Oct 2026, 11:41 · draft · Version 1' }]} />)
    expect(screen.getByRole('heading', { name: 'Preserved versions & amendments' }).parentElement?.className)
      .toBe('hid-ehr-card hid-ehr-dept-section hid-ehr-dept-history-card')
  })

  it('17. says "No further actions…" in the 14px body text', () => {
    expect(at('.hid-ehr .hid-ehr-dept-actions-empty', 'color')).toBe('var(--ehr-text)')
    expect(at('.hid-ehr .hid-ehr-dept-actions-empty', 'font-size')).toBe('14px')
    render(<DeptActions empty="No further actions for your permission and this record state." />)
    expect(screen.getByText('No further actions for your permission and this record state.').className).toBe('hid-ehr-dept-actions-empty')
  })
})
