import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { PhoneCall, ShieldCheck } from 'lucide-react'
import { EmptyState, Timeline } from '../../kasuwa/ui'

/**
 * Nothing to show yet, said the one designed way everywhere (owner, 2026-10-31): a grey line drawing, one plain
 * sentence, and the next step when there is one. A bare grey line of text (the Overview's Activity, an empty list) is
 * not that. The drawing is decorative: the words carry the meaning.
 */
const drawing = (container: HTMLElement) => container.querySelector('svg[aria-hidden="true"]')

describe('the shared empty state', () => {
  it('can be one plain sentence with its drawing and next step, without a separate title', () => {
    const { container } = render(<EmptyState compact icon={PhoneCall}
      description="Add up to 5 people we can tell if your records are opened in an emergency."
      action={<button type="button">Add emergency contact</button>} />)
    expect(screen.getByText('Add up to 5 people we can tell if your records are opened in an emergency.')).toBeTruthy()
    expect(drawing(container)).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Add emergency contact' })).toBeTruthy()
  })

  it('still takes a title and a sentence, as the pages already use it', () => {
    const { container } = render(<EmptyState icon={ShieldCheck} title="No one has viewed your records" description="When a hospital opens your records, it shows here." />)
    expect(screen.getByText('No one has viewed your records')).toBeTruthy()
    expect(screen.getByText('When a hospital opens your records, it shows here.')).toBeTruthy()
    expect(drawing(container)).not.toBeNull()
  })
})

describe('an empty timeline (the Overview\'s Activity)', () => {
  it('shows the designed empty state, with its drawing, not a bare grey line', () => {
    const { container } = render(<MemoryRouter><Timeline items={[]} empty="When a facility asks for, opens or is given access, you'll see it here." /></MemoryRouter>)
    expect(screen.getByText('When a facility asks for, opens or is given access, you\'ll see it here.')).toBeTruthy()
    expect(drawing(container)).not.toBeNull()
  })

  it('offers the next step when the page gives one', () => {
    render(<MemoryRouter><Timeline items={[]} empty="Nothing has happened yet." emptyAction={<a href="/access">Share your records</a>} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Share your records' })).toBeTruthy()
  })

  it('lists what happened once there is something, with no empty state', () => {
    const { container } = render(<MemoryRouter><Timeline items={[{ id: '1', text: 'Ikeja Medical Centre opened your records', when: '3 min ago' }]} empty="Nothing yet." /></MemoryRouter>)
    expect(screen.getByRole('listitem').textContent).toContain('Ikeja Medical Centre opened your records')
    expect(screen.queryByText('Nothing yet.')).toBeNull()
    expect(drawing(container)).toBeNull()
  })
})
