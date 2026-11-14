import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EhrButton, EhrCard, EhrStatCard } from '@hid/ui/ehr'

describe('EhrCard', () => {
  it('is a section with an optional titled header and actions', () => {
    render(<EhrCard title="Today's clinics" actions={<EhrButton variant="quiet" size="sm">View all</EhrButton>}><p>Fictional clinic list.</p></EhrCard>)
    const heading = screen.getByRole('heading', { level: 2, name: "Today's clinics" })
    const card = heading.closest('section')!
    expect(card.classList.contains('hid-ehr-card')).toBe(true)
    expect(within(card).getByRole('button', { name: 'View all' })).toBeDefined()
    expect(within(card).getByText('Fictional clinic list.')).toBeDefined()
  })

  it('takes a level-3 title under a section heading', () => {
    render(<EhrCard title="Pharmacy stock" titleLevel={3}>Content</EhrCard>)
    expect(screen.getByRole('heading', { level: 3, name: 'Pharmacy stock' })).toBeDefined()
  })
})

describe('EhrStatCard', () => {
  it('shows a label, a value and an optional detail, with nothing to press', () => {
    const { container } = render(<EhrStatCard label="Patients waiting" value={12} detail="3 since 9:00" />)
    const card = container.querySelector('.hid-ehr-stat-card')!
    expect(within(card as HTMLElement).getByText('Patients waiting')).toBeDefined()
    expect(within(card as HTMLElement).getByText('12').classList.contains('hid-ehr-stat-value')).toBe(true)
    expect(within(card as HTMLElement).getByText('3 since 9:00')).toBeDefined()
    expect(card.querySelectorAll('a, button')).toHaveLength(0)
  })

  it('is exactly one link, named by its label, when clickable', () => {
    const { container } = render(<EhrStatCard label="Beds free" value={7} detail="Of 40 on Ward B" href="/ehr/beds" icon={<svg />} />)
    const card = container.querySelector('.hid-ehr-stat-card') as HTMLElement
    const links = within(card).getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]!.getAttribute('href')).toBe('/ehr/beds')
    expect(within(card).getByRole('link', { name: 'Beds free' })).toBe(links[0])
    expect(within(card).queryAllByRole('button')).toHaveLength(0)
    expect(card.querySelector('.hid-ehr-stat-icon')!.getAttribute('aria-hidden')).toBe('true')
  })
})
