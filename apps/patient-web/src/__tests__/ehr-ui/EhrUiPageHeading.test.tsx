import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EhrButton, EhrPageHeading } from '@hid/ui/ehr'

describe('EhrPageHeading', () => {
  it('is the one h1, with a description, secondary actions and then the primary one', () => {
    render(
      <EhrPageHeading
        title="Patients"
        description="Find a patient or register a new one."
        secondaryActions={<EhrButton variant="secondary">Export</EhrButton>}
        primaryAction={<EhrButton>Register patient</EhrButton>}
      />,
    )
    const headings = screen.getAllByRole('heading')
    expect(headings).toHaveLength(1)
    expect(headings[0]!.tagName).toBe('H1')
    expect(headings[0]!.textContent).toBe('Patients')
    expect(headings[0]!.classList.contains('hid-ehr-page-title')).toBe(true)
    expect(screen.getByText('Find a patient or register a new one.').classList.contains('hid-ehr-page-description')).toBe(true)
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Export', 'Register patient'])
  })

  it('needs only a title', () => {
    const { container } = render(<EhrPageHeading title="Dashboard" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeDefined()
    expect(container.querySelector('.hid-ehr-page-actions')).toBeNull()
    expect(container.querySelector('.hid-ehr-page-description')).toBeNull()
    expect(container.querySelector('.hid-ehr-page-eyebrow')).toBeNull()
  })

  it('puts an eyebrow line above the title, outside the heading\'s name', () => {
    render(<EhrPageHeading eyebrow="Platform administration" title="Facility review" />)
    const heading = screen.getByRole('heading', { level: 1, name: 'Facility review' })
    const eyebrow = screen.getByText('Platform administration')
    expect(eyebrow.tagName).toBe('P')
    expect(eyebrow.classList.contains('hid-ehr-page-eyebrow')).toBe(true)
    expect(eyebrow.nextElementSibling).toBe(heading)
  })
})
