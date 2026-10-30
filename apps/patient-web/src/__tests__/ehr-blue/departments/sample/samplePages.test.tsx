import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { samplePages } from '../../../../ehr-blue/departments/sample/pages'
import { guardBrowser, heading, renderSample, SAMPLE_TEXT, where } from './sampleHarness'

/*
 * The ten sample-only workspaces as the frame lists them: each one's place in the sidebar, its title, the sample
 * notice and its fictional rows. None reads the staff session or calls the staff API, none touches browser storage,
 * and none makes a request.
 */

const touched = vi.hoisted(() => [] as string[])
vi.mock('../../../../staff/api', () => ({
  staffApi: new Proxy({}, { get: (_target, key) => { touched.push(String(key)); return vi.fn() } }),
}))
vi.mock('../../../../staff/App', () => ({
  useStaff: () => { touched.push('useStaff'); throw new Error('A sample page must not read the staff session.') },
}))

guardBrowser()
afterEach(() => {
  expect(touched).toEqual([])
})

/** Each page: its path, the design's navigation group and label, its title, and the names of its fictional rows. */
const EXPECTED = [
  { path: 'patient-billing', group: 'Finance', label: 'Patient billing', title: 'Patient billing', rows: ['DEMO-1', 'DEMO-2', 'DEMO-3'], newTitle: 'New patient billing' },
  { path: 'insurance', group: 'Finance', label: 'Insurance & Claims', title: 'Insurance & Claims', rows: ['2a6f15aa', '9d41c7b3', 'e5f20b68'], newTitle: 'New insurance & claims' },
  { path: 'policies', group: 'Finance', label: 'Policies', title: 'Policies', rows: ['POL-DEMO', 'POL-DEMO-2', 'POL-DEMO-3'], newTitle: 'New policies' },
  {
    path: 'services', group: 'Settings', label: 'Service catalogue', title: 'Service catalogue', newTitle: 'New service catalogue',
    rows: ['Fictional consultation', 'General consultation', 'Specialist consultation', 'Full blood count', 'Malaria test', 'Chest X-ray', 'Antenatal visit'],
  },
  { path: 'supply', group: 'Supply', label: 'Stock', title: 'Stock', rows: ['Fictional Med A', 'Fictional Gloves', 'Fictional Syringe 5 ml'], newTitle: 'New stock' },
  { path: 'procurement', group: 'Supply', label: 'Procurement', title: 'Procurement', rows: ['Stock request', 'Quarterly restock', 'Glove top-up'], newTitle: 'New procurement' },
  {
    path: 'quality', group: 'Administration', label: 'Quality & Safety', title: 'Quality & Safety', newTitle: 'New quality & safety',
    rows: ['Delayed sample transport (fictional)', 'Near-miss labelling (fictional)', 'Wet floor near ward entrance (fictional)'],
  },
  { path: 'shifts', group: 'People', label: 'Shifts & Roster', title: 'Shifts & Roster', rows: ['c4a2d06b', 'fc22475a', '8e31b5c2'], newTitle: 'New shifts & roster' },
  { path: 'ambulance', group: 'Network & Services', label: 'Dispatch', title: 'Dispatch', rows: ['0465c81e', '57e5e7d4', 'a91f3c08'], newTitle: 'New dispatch' },
  { path: 'vehicles', group: 'Settings', label: 'Vehicle configuration', title: 'Vehicle configuration', rows: ['DEMO-VEHICLE', 'AMB-02', 'AMB-03'], newTitle: 'New vehicle configuration' },
]

describe('the sample pages', () => {
  it('lists the ten workspaces as sample pages with no permission, in the design\'s groups', () => {
    expect(samplePages.map(page => ({ path: page.path, group: page.group, label: page.label })))
      .toEqual(EXPECTED.map(({ path, group, label }) => ({ path, group, label })))
    for (const page of samplePages) {
      expect(page.status).toBe('sample')
      expect(page.permission).toBeUndefined()
      expect(page.icon).toBeDefined()
    }
  })

  for (const expected of EXPECTED) {
    describe(expected.label, () => {
      it('shows its title, the sample notice first and its fictional rows', () => {
        renderSample(expected.path)
        expect(heading().textContent).toBe(expected.title)
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
        const notice = screen.getByRole('note')
        expect(notice.textContent).toBe(SAMPLE_TEXT)
        expect(notice.compareDocumentPosition(heading()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        const table = screen.getByRole('table')
        for (const name of expected.rows) expect(within(table).getByRole('button', { name })).toBeDefined()
        expect(within(table).getAllByRole('row')).toHaveLength(expected.rows.length + 1)
        expect(screen.queryByText(/Synced|Saved on this device|waiting to sync/)).toBeNull()
      })

      it('opens its create form and a record with the sample notice on each', () => {
        renderSample(expected.path)
        fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
        expect(heading().textContent).toBe(expected.newTitle)
        expect(screen.getByRole('note').textContent).toBe(SAMPLE_TEXT)
        fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
        fireEvent.click(screen.getByRole('button', { name: expected.rows[0] }))
        expect(heading().textContent).toBe(expected.rows[0])
        expect(screen.getByRole('note').textContent).toBe(SAMPLE_TEXT)
        expect(screen.getByRole('heading', { name: 'Saved record' })).toBeDefined()
        expect(screen.getByRole('heading', { name: 'Available actions' })).toBeDefined()
        expect(where()).toBe(`/ehr/${expected.path}`)
      })
    })
  }

  it('creates a record on every page from complete fields, as the design\'s forms do', () => {
    for (const expected of EXPECTED) {
      const { unmount } = renderSample(expected.path)
      fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
      const patient = screen.queryByRole('combobox', { name: 'Patient' })
      if (patient) fireEvent.change(patient, { target: { value: 'sample-patient-2' } })
      const form = document.querySelector('form')!
      // Each later time is later: a shift ends after it starts.
      let hour = 8
      for (const control of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')) {
        if (control.value) continue
        const value = control instanceof HTMLSelectElement ? control.options[1]?.value ?? ''
          : control.type === 'number' ? '3'
            : control.type === 'date' ? '2030-01-01'
              : control.type === 'datetime-local' ? `2026-11-05T${String(hour++).padStart(2, '0')}:00`
                : 'Sample text (fictional)'
        fireEvent.change(control, { target: { value } })
      }
      fireEvent.click(screen.getByRole('button', { name: 'Save record' }))
      expect(screen.queryByText('Complete this field.')).toBeNull()
      expect(screen.getByRole('heading', { name: 'Saved record' })).toBeDefined()
      expect(screen.getByRole('status').textContent).toMatch(/^Record created: /)
      fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
      expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(expected.rows.length + 2)
      unmount()
    }
  })

  it('starts afresh on reload: nothing created is kept', () => {
    const first = renderSample('quality')
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Incident title' }), { target: { value: 'Kept nowhere (fictional)' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: 'Fictional' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }))
    expect(heading().textContent).toBe('Kept nowhere (fictional)')
    first.unmount()

    renderSample('quality')
    expect(screen.queryByRole('button', { name: 'Kept nowhere (fictional)' })).toBeNull()
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4)
  })
})
