import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EhrBadge, type EhrBadgeTone } from '@hid/ui/ehr'

describe('EhrBadge', () => {
  it('defaults to the target badge: one tone, with its words as its content', () => {
    render(<EhrBadge>Verified</EhrBadge>)
    const badge = screen.getByText('Verified')
    expect(badge.tagName).toBe('SPAN')
    expect(badge.className).toBe('hid-ehr-badge')
  })

  it.each<[EhrBadgeTone, string]>([
    ['positive', 'Discharged'],
    ['caution', 'Awaiting review'],
    ['critical', 'Overdue'],
    ['neutral', 'Draft'],
  ])('%s tone keeps its text label and the design\'s one badge colour', (tone, label) => {
    render(<EhrBadge tone={tone}>{label}</EhrBadge>)
    const badge = screen.getByText(label)
    expect(badge.className).toBe('hid-ehr-badge')
    expect(badge.getAttribute('data-tone')).toBe(tone)
    expect(badge.textContent).toBe(label)
  })
})
