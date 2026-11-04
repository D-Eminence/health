import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { codeText, MoreDetails } from '../../../ehr-blue/clinical/parts/MoreDetails'
import { routeLabel } from '../../../plainLabels'

/**
 * Owner decision 33.4: a screen leads with the plain name, and clinical codes (ICD-10 J45, LOINC 2345-7, route PO) wait
 * under a closed "More details" line, so doctors still have them.
 */
describe('More details', () => {
  it('is closed until opened, says what it is about to a screen reader, and holds the codes', () => {
    render(<MoreDetails about="Asthma"><span>Code: {codeText('ICD-10', 'J45')}</span></MoreDetails>)
    const summary = screen.getByText('More details')
    expect(summary.tagName).toBe('SUMMARY')
    expect(summary.textContent).toBe('More details: Asthma')
    const details = summary.closest('details')!
    expect(details.open).toBe(false)
    fireEvent.click(summary)
    expect(details.textContent).toContain('Code: ICD-10 J45')
  })

  it('writes a code with its coding system, and nothing for no code', () => {
    expect(codeText('LOINC', '2345-7')).toBe('LOINC 2345-7')
    expect(codeText(null, 'J45')).toBe('J45')
    expect(codeText('ICD-10', ' ')).toBe('')
    expect(codeText('ICD-10', null)).toBe('')
  })
})

describe('route words', () => {
  it('says how a medicine is taken in plain words, and nothing for a route it has no words for', () => {
    expect(routeLabel('PO')).toBe('by mouth')
    expect(routeLabel(' oral ')).toBe('by mouth')
    expect(routeLabel('IV')).toBe('into a vein')
    expect(routeLabel('IM')).toBe('into a muscle')
    expect(routeLabel('NG tube')).toBeNull()
    expect(routeLabel(null)).toBeNull()
    expect(routeLabel('constructor')).toBeNull()
  })
})
