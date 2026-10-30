import { describe, expect, it } from 'vitest'
import { ehrCssVariable, ehrTokens, type EhrTokenName } from '@hid/ui/ehr'
import { ehrDeclarations } from './ehrCss'

/** tokens.ts and the custom properties ehr.css declares on .hid-ehr hold exactly the same values. */
describe('EHR tokens', () => {
  const names = Object.keys(ehrTokens) as EhrTokenName[]

  it('maps each token to its --ehr- custom property', () => {
    expect(ehrCssVariable('brandDark')).toBe('--ehr-brand-dark')
    expect(ehrCssVariable('primary50')).toBe('--ehr-primary-50')
    expect(ehrCssVariable('radius2xl')).toBe('--ehr-radius-2xl')
    expect(ehrCssVariable('zOverlay')).toBe('--ehr-z-overlay')
  })

  it.each(names)('%s matches ehr.css exactly', name => {
    expect(ehrDeclarations.get(ehrCssVariable(name))).toBe(ehrTokens[name])
  })

  it('leaves no custom property in ehr.css without a token, or the other way round', () => {
    expect([...ehrDeclarations.keys()].sort()).toEqual(names.map(ehrCssVariable).sort())
  })

  it('holds the brand values from the reference', () => {
    expect(ehrTokens).toMatchObject({
      brand: '#086dd9',
      brandDark: '#075fbe',
      tint: '#eaf4ff',
      ink: '#0b1b2e',
      text: '#484f58',
      muted: '#5b6b80',
      line: '#e3e9f0',
      positive: '#12805c',
      critical: '#b3261e',
      controlBorder: '#c6c6cc',
      navGroupText: '#63758b',
      zChrome: '100',
      zPopover: '110',
      zOverlay: '200',
    })
  })
})
