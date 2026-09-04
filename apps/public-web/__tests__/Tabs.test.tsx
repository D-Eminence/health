import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { OperationsSection } from '@/components/provider/Operations'
import { ModulesSection } from '@/components/provider/Modules'
import { RecordSection, TeamsSection } from '@/components/provider/RecordAndTeams'
import { OPERATIONS_FLOW } from '@/content/tabs'

function tab(name: string | RegExp) {
  return screen.getByRole('tab', { name })
}

describe('OperationsSection — patient flow filters', () => {
  it('opens showing every patient in the queue', () => {
    render(<OperationsSection />)

    expect(tab('All').getAttribute('aria-selected')).toBe('true')
    expect(screen.getAllByRole('row')).toHaveLength(OPERATIONS_FLOW.length + 1) // + header
  })

  it('narrows the queue to the selected stage', () => {
    render(<OperationsSection />)

    fireEvent.click(tab('Waiting'))

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(screen.getByText('Amina Yusuf')).toBeDefined()
    expect(screen.queryByText('Musa Bello')).toBeNull()
  })

  it('counts what it is showing', () => {
    render(<OperationsSection />)

    fireEvent.click(tab('Consultation'))
    expect(screen.getByText('1 patient')).toBeDefined()

    fireEvent.click(tab('Waiting'))
    expect(screen.getByText('2 patients')).toBeDefined()
  })

  it('returns to the full queue', () => {
    render(<OperationsSection />)

    fireEvent.click(tab('Pharmacy'))
    fireEvent.click(tab('All'))

    expect(within(screen.getByRole('table')).getAllByRole('row').slice(1)).toHaveLength(
      OPERATIONS_FLOW.length,
    )
  })

  it('moves between filters with the arrow keys', () => {
    render(<OperationsSection />)

    const list = screen.getByRole('tablist', { name: /filter patient flow/i })
    fireEvent.keyDown(list, { key: 'ArrowRight' })

    expect(tab('Waiting').getAttribute('aria-selected')).toBe('true')
    expect(tab('All').getAttribute('aria-selected')).toBe('false')
  })

  it('wraps from the first filter back to the last', () => {
    render(<OperationsSection />)

    const list = screen.getByRole('tablist', { name: /filter patient flow/i })
    fireEvent.keyDown(list, { key: 'ArrowLeft' })

    expect(tab('Completed').getAttribute('aria-selected')).toBe('true')
  })

  it('jumps to the ends with Home and End', () => {
    render(<OperationsSection />)
    const list = screen.getByRole('tablist', { name: /filter patient flow/i })

    fireEvent.keyDown(list, { key: 'End' })
    expect(tab('Completed').getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(list, { key: 'Home' })
    expect(tab('All').getAttribute('aria-selected')).toBe('true')
  })

  it('keeps exactly one filter in the tab order', () => {
    render(<OperationsSection />)

    const tabs = screen.getAllByRole('tab')
    const reachable = tabs.filter(element => element.getAttribute('tabindex') === '0')
    expect(reachable).toHaveLength(1)
  })

  it('pairs each panel with the tab that controls it', () => {
    render(<OperationsSection />)

    const panel = screen.getByRole('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe(tab('All').id)
    expect(tab('All').getAttribute('aria-controls')).toBe(panel.id)
  })
})

describe('ModulesSection', () => {
  it('opens on the identity module', () => {
    render(<ModulesSection />)

    expect(tab('Identity').getAttribute('aria-selected')).toBe('true')
    expect(
      screen.getByText('One patient identity that every connected facility can verify.'),
    ).toBeDefined()
  })

  it('swaps both the claim and the panel when another module is chosen', () => {
    render(<ModulesSection />)

    fireEvent.click(tab('Laboratory'))

    expect(
      screen.getByText('Results that attach themselves to the right patient automatically.'),
    ).toBeDefined()
    expect(screen.getByText('Full Blood Count')).toBeDefined()
    expect(screen.queryByText('HID-4471-08')).toBeNull()
  })
})

describe('RecordSection', () => {
  it('shows the whole history under Overview', () => {
    render(<RecordSection />)

    expect(tab('Overview').getAttribute('aria-selected')).toBe('true')
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(6)
  })

  it('filters the record to one type', () => {
    render(<RecordSection />)

    fireEvent.click(tab('Laboratory'))

    expect(screen.getByText('Full Blood Count')).toBeDefined()
    expect(screen.queryByText('Discharge summary')).toBeNull()
  })

  it('explains an empty view rather than showing a blank panel', () => {
    render(<RecordSection />)

    // No entry in the design's timeline is tagged Medication *and* absent, so
    // this exercises a tab that has exactly one entry, then one that has none.
    fireEvent.click(tab('Medication'))
    expect(screen.getByText('Medication dispensed')).toBeDefined()
  })
})

describe('TeamsSection', () => {
  it('opens on reception and lists that role’s workspace', () => {
    render(<TeamsSection />)

    expect(tab('Reception').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Register patient')).toBeDefined()
  })

  it('shows a different workspace for each role', () => {
    render(<TeamsSection />)

    fireEvent.click(tab('Pharmacy'))

    expect(screen.getByText('Prescription queue')).toBeDefined()
    expect(screen.queryByText('Register patient')).toBeNull()
  })

  it('names every role the design covers', () => {
    render(<TeamsSection />)

    const names = screen.getAllByRole('tab').map(element => element.textContent)
    expect(names).toEqual([
      'Reception',
      'Nurses',
      'Doctors',
      'Laboratory',
      'Pharmacy',
      'Administrators',
    ])
  })
})
