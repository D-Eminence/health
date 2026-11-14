import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EhrBadge, EhrButton, EhrDataTable, type EhrDataTableColumn } from '@hid/ui/ehr'

interface Admission { readonly id: string; readonly ward: string; readonly beds: number; readonly status: string }

// Fictional rows: no patient names or identifiers.
const ROWS: readonly Admission[] = [
  { id: 'a', ward: 'Ward A', beds: 12, status: 'Open' },
  { id: 'b', ward: 'Ward B', beds: 4, status: 'Closed' },
]

const COLUMNS: readonly EhrDataTableColumn<Admission>[] = [
  { id: 'ward', header: 'Ward', cell: row => row.ward },
  { id: 'beds', header: 'Beds', cell: row => row.beds, align: 'end' },
  { id: 'status', header: 'Status', cell: row => <EhrBadge tone={row.status === 'Open' ? 'positive' : 'neutral'}>{row.status}</EhrBadge> },
]

describe('EhrDataTable', () => {
  it('is a real table with a caption and column headers, in a named, focusable scrolling region', () => {
    render(<EhrDataTable caption="Ward capacity" columns={COLUMNS} rows={ROWS} rowKey={row => row.id} />)
    const region = screen.getByRole('region', { name: 'Ward capacity' })
    expect(region.getAttribute('tabindex')).toBe('0')
    expect(region.classList.contains('hid-ehr-table-scroll')).toBe(true)

    const table = within(region).getByRole('table', { name: 'Ward capacity' })
    expect(table.tagName).toBe('TABLE')
    expect(table.querySelector('caption')!.textContent).toBe('Ward capacity')
    const headers = within(table).getAllByRole('columnheader')
    expect(headers.map(header => header.textContent)).toEqual(['Ward', 'Beds', 'Status'])
    for (const header of headers) expect(header.getAttribute('scope')).toBe('col')
    expect(headers[1]!.classList.contains('hid-ehr-align-end')).toBe(true)

    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(3)
    expect(within(rows[1]!).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['Ward A', '12', 'Open'])
  })

  it('can keep its caption for assistive technology only', () => {
    render(<EhrDataTable caption="Ward capacity" captionHidden columns={COLUMNS} rows={ROWS} rowKey={row => row.id} />)
    expect(screen.getByRole('table', { name: 'Ward capacity' }).querySelector('caption')!.className).toBe('hid-ehr-sr-only')
  })

  it('shows the skeleton while loading', () => {
    render(<EhrDataTable caption="Ward capacity" columns={COLUMNS} rows={[]} rowKey={row => row.id} loading />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Loading Ward capacity')
  })

  it('shows the empty state, with what to do next, when there are no rows', () => {
    render(
      <EhrDataTable
        caption="Ward capacity"
        columns={COLUMNS}
        rows={[]}
        rowKey={row => row.id}
        emptyTitle="No wards yet"
        emptyMessage="Add a ward to start tracking beds."
        emptyAction={<EhrButton>Add ward</EhrButton>}
      />,
    )
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('No wards yet').closest('.hid-ehr-empty-state')).not.toBeNull()
    expect(screen.getByText('Add a ward to start tracking beds.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Add ward' })).toBeDefined()
  })
})
