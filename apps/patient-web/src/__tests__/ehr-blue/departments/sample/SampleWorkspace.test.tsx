import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { useSiblingPages } from '../../../../ehr-blue/departments/parts/sample/navigation'
import { renderDept } from '../harness'
import {
  actionButtons, guardBrowser, heading, noticeUnderHeading, renderSample, SAMPLE_TEXT, savedFacts, statusBadge, where,
} from './sampleHarness'

/*
 * The sample workspaces' engine (parts/sample), through real definitions: the design's list, create form, record
 * view, actions, Quick view and links to the pages beside them, all in the page's memory. All data is fictional.
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

function row(name: string) {
  return screen.getByRole('button', { name }).closest('tr')!
}

function openRecord(name: string) {
  fireEvent.click(screen.getByRole('button', { name }))
  expect(heading().textContent).toBe(name)
}

function choose(name: string, value: string) {
  fireEvent.change(screen.getByRole('combobox', { name }), { target: { value } })
}

function type(name: string | RegExp, value: string, role: 'textbox' | 'spinbutton' = 'textbox') {
  fireEvent.change(screen.getByRole(role, { name }), { target: { value } })
}

describe('the list', () => {
  it('shows the title with "Create record", the sample notice under it, the search and the rows, as the design does', () => {
    renderSample('patient-billing')
    expect(heading().textContent).toBe('Patient billing')
    noticeUnderHeading()
    const heads = heading().closest('.hid-ehr-page-heading')!
    // A sample hands out no file: the design's "Export filtered records" is left out.
    expect(within(heads as HTMLElement).getAllByRole('button').map(button => button.textContent)).toEqual(['Create record'])
    const search = screen.getByRole('searchbox', { name: 'Search Patient billing' })
    expect(search.getAttribute('placeholder')).toBe('Search saved records…')
    expect(screen.getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Record', 'Patient / context', 'Status', 'Updated', 'Actions'])
    const first = row('DEMO-1')
    expect(within(first).getByText('58b3ab2d')).toBeDefined()
    expect(within(first).getByText('Patient One')).toBeDefined()
    expect(within(first).getByText('partial').classList.contains('hid-ehr-badge')).toBe(true)
    expect(within(first).getByText(new Date('2026-10-26T11:41:16.298Z').toLocaleString())).toBeDefined()
    expect(within(first).getByRole('button', { name: 'Quick view' })).toBeDefined()
    expect(within(first).getByRole('button', { name: 'Open' })).toBeDefined()
    expect(screen.getAllByRole('row')).toHaveLength(4)
    // The design's sync wording describes browser storage: never shown.
    expect(screen.queryByText(/Synced|Saved on this device/)).toBeNull()
  })

  it('names each row by its record or itself when it has no patient', () => {
    renderSample('services')
    expect(within(row('Malaria test')).getAllByText('Malaria test')).toHaveLength(2)
    expect(within(row('Malaria test')).getByText('6e455561')).toBeDefined()
  })

  it('filters the rows on the page as the search is typed, says when nothing matches, and clears', () => {
    renderSample('patient-billing')
    const search = screen.getByRole('searchbox', { name: 'Search Patient billing' })
    fireEvent.change(search, { target: { value: 'patient two' } })
    expect(screen.getAllByRole('row')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'DEMO-2' })).toBeDefined()

    fireEvent.change(search, { target: { value: 'Fictional consultation' } })
    expect(screen.getByRole('button', { name: 'DEMO-1' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'DEMO-2' })).toBeNull()

    fireEvent.change(search, { target: { value: 'HID-DEMO-003' } })
    expect(screen.getByRole('button', { name: 'DEMO-3' })).toBeDefined()

    fireEvent.change(search, { target: { value: 'nothing like this' } })
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('No matching records')).toBeDefined()
    expect(screen.getByText('Change your search.')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect((search as HTMLInputElement).value).toBe('')
    // The button goes as it is pressed: focus goes to the field it cleared.
    expect(document.activeElement).toBe(search)
    expect(screen.getAllByRole('row')).toHaveLength(4)
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
  })

  it('opens Quick view in a drawer with the sample notice first, in its exact words', () => {
    renderSample('policies')
    fireEvent.click(within(row('POL-DEMO')).getByRole('button', { name: 'Quick view' }))
    const drawer = screen.getByRole('dialog', { name: 'Record quick view' })
    const notice = within(drawer).getByRole('note')
    expect(notice.textContent).toBe(SAMPLE_TEXT)
    expect(drawer.querySelector('.hid-ehr-drawer-body')?.firstElementChild).toBe(notice)
    expect(notice.compareDocumentPosition(within(drawer).getByRole('heading', { level: 3, name: 'POL-DEMO' })) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()
  })

  it('opens Quick view in a drawer with the record\'s values, moves focus in, and gives it back on Escape', () => {
    renderSample('patient-billing')
    const opener = within(row('DEMO-1')).getByRole('button', { name: 'Quick view' })
    fireEvent.click(opener)
    const drawer = screen.getByRole('dialog', { name: 'Record quick view' })
    expect(within(drawer).getByRole('heading', { level: 3 }).textContent).toBe('DEMO-1')
    expect(within(drawer).getByText(`Last updated ${new Date('2026-10-26T11:41:16.298Z').toLocaleString()}`)).toBeDefined()
    const terms = within(drawer).getAllByRole('term').map(term => term.textContent)
    expect(terms).toEqual(['Service', 'Quantity', 'Source', 'Number', 'Unit Cents', 'Total Cents', 'Amount', 'Method', 'Reference'])
    const close = within(drawer).getByRole('button', { name: 'Close' })
    expect(document.activeElement).toBe(close)

    // Tab stays inside: from the last control back to Close.
    const openFull = within(drawer).getByRole('button', { name: 'Open full record' })
    openFull.focus()
    fireEvent.keyDown(openFull, { key: 'Tab' })
    expect(document.activeElement).toBe(close)

    fireEvent.keyDown(close, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('closes Quick view from Close, and opens the full record from it', () => {
    renderSample('supply')
    const opener = within(row('Fictional Med A')).getByRole('button', { name: 'Quick view' })
    fireEvent.click(opener)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)

    fireEvent.click(opener)
    fireEvent.click(screen.getByRole('button', { name: 'Open full record' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(heading().textContent).toBe('Fictional Med A')
    expect(document.activeElement).toBe(heading())
  })

  it('hands out no file: no export, no receipt download, and Print stays', () => {
    const made = vi.spyOn(URL, 'createObjectURL')
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click')
    renderSample('patient-billing')
    expect(screen.queryByRole('button', { name: /Export|Download/ })).toBeNull()
    openRecord('DEMO-1')
    expect(screen.queryByRole('button', { name: /Export|Download|receipt/i })).toBeNull()
    expect(screen.getByRole('button', { name: 'Print' })).toBeDefined()
    expect(document.querySelector('a[download]')).toBeNull()
    expect(made).not.toHaveBeenCalled()
    expect(clicked).not.toHaveBeenCalled()
  })
})

describe('the create form', () => {
  it('asks for the registered patient first, then shows the record\'s fields, as the design does', () => {
    renderSample('patient-billing')
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    expect(heading().textContent).toBe('New patient billing')
    expect(document.activeElement).toBe(heading())
    noticeUnderHeading()
    expect(screen.getByRole('button', { name: 'Back to list' })).toBeDefined()
    const patient = screen.getByRole('combobox', { name: 'Patient' }) as HTMLSelectElement
    expect(patient.labels?.[0]?.textContent).toBe('Patient *')
    expect(patient.labels?.[0]?.querySelector('[aria-hidden="true"]')?.textContent).toBe(' *')
    expect([...patient.options].map(option => option.textContent)).toEqual([
      'Select registered patient', 'Patient One · HID-DEMO-001', 'Patient Two · HID-DEMO-002', 'Patient Three · HID-DEMO-003',
      'Patient Four · HID-DEMO-004', 'Patient Five · HID-DEMO-005',
    ])
    expect(screen.queryByRole('button', { name: 'Save record' })).toBeNull()

    choose('Patient', 'sample-patient-2')
    const service = screen.getByRole('combobox', { name: 'Service charge' }) as HTMLSelectElement
    expect(service.options[0]!.textContent).toBe('Select…')
    expect(service.options[1]!.textContent).toBe('Fictional consultation · active · 213c40')
    expect((screen.getByRole('spinbutton', { name: 'Service quantity' }) as HTMLInputElement).value).toBe('1')
    expect(screen.getByRole('textbox', { name: 'Unique charge reference (order / service ID)' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Save record' }).getAttribute('type')).toBe('submit')
  })

  it('marks each empty required field "Complete this field." and focuses the first, then opens the new record', () => {
    renderSample('patient-billing')
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    choose('Patient', 'sample-patient-2')
    type('Service quantity', '', 'spinbutton')
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }))

    expect(screen.getAllByText('Complete this field.')).toHaveLength(3)
    const service = screen.getByRole('combobox', { name: 'Service charge' })
    expect(service.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(service)
    expect(heading().textContent).toBe('New patient billing')

    choose('Service charge', 'Specialist consultation')
    expect(service.hasAttribute('aria-invalid')).toBe(false)
    expect(screen.getAllByText('Complete this field.')).toHaveLength(2)
    type('Service quantity', '2', 'spinbutton')
    type('Unique charge reference (order / service ID)', 'SERVICE-009')
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }))

    expect(heading().textContent).toBe('DEMO-4')
    expect(document.activeElement).toBe(heading())
    expect(screen.getByText('Patient Two · HID-DEMO-002')).toBeDefined()
    expect(statusBadge()).toBe('draft')
    expect(savedFacts()).toEqual({
      Service: 'Specialist consultation', Quantity: '2', Source: 'SERVICE-009', Number: 'DEMO-4', 'Unit Cents': '1500000',
      'Total Cents': '3000000', Total: '3000000', Paid: '0', Due: '3000000',
    })
    expect(screen.getByRole('status').textContent).toBe('Record created: DEMO-4.')

    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    const created = screen.getByRole('button', { name: 'DEMO-4' })
    expect(document.activeElement).toBe(created)
    expect(within(created.closest('tr')!).getByText('Patient Two')).toBeDefined()
    expect(screen.getAllByRole('row')).toHaveLength(5)
  })

  it('shows the fields at once where records have no patient, and Back to list returns to Create record', () => {
    renderSample('supply')
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    expect(heading().textContent).toBe('New stock')
    expect(screen.queryByRole('combobox', { name: 'Patient' })).toBeNull()
    const labels = [...document.querySelectorAll('form label')].map(label => label.textContent)
    expect(labels).toEqual(['Item name *', 'Category *', 'Base unit *', 'Units per pack *', 'Reorder threshold *'])
    expect((screen.getByRole('spinbutton', { name: 'Units per pack' }) as HTMLInputElement).value).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(heading().textContent).toBe('Stock')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Create record' }))
  })
})

describe('the record view', () => {
  it('shows the status, patient and save time, "Saved record", the actions the status allows and the connected records', () => {
    renderSample('patient-billing')
    openRecord('DEMO-3')
    expect(document.activeElement).toBe(heading())
    const notice = noticeUnderHeading()
    const context = document.querySelector('.hid-ehr-dept-context')!
    expect(notice.nextElementSibling).toBe(context)
    expect(context.textContent).toBe(`draftPatient Three · HID-DEMO-003Saved ${new Date('2026-10-26T11:41:16.000Z').toLocaleString()}`)
    expect(savedFacts()).toMatchObject({ Service: 'General consultation', Quantity: '1', Source: 'SERVICE-003', Number: 'DEMO-3' })
    expect(screen.getByText('Totals above are integer minor currency units (cents / kobo). All payments are fictional.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Print' })).toBeDefined()
    expect(actionButtons().map(button => button.textContent)).toEqual(['Issue invoice', 'Void invoice'])
    expect(actionButtons().every(button => button.getAttribute('aria-expanded') === 'false')).toBe(true)

    const history = screen.getByRole('heading', { name: 'Connected hospital history' }).closest('section')!
    expect(within(history).getByText('Only records available to your current permissions are listed.')).toBeDefined()
    const links = within(history).getAllByRole('link')
    expect(links.map(link => link.textContent)).toEqual(['Insurance & Claims · e5f20b68', 'Policies · POL-DEMO-3'])
    expect(links[0]!.getAttribute('href')).toBe('/ehr/insurance')
    expect(screen.queryByRole('heading', { name: 'Preserved versions & amendments' })).toBeNull()
  })

  it('says when no action is left, and shows no patient history where records have no patient', () => {
    renderSample('vehicles')
    openRecord('DEMO-VEHICLE')
    expect(actionButtons()).toHaveLength(0)
    expect(screen.getByText('No further actions for your permission and this record state.')).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Connected hospital history' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'DEMO-VEHICLE' }))
  })

  it('opens an action\'s form under the actions; submitting it changes the status and preserves the version', () => {
    renderSample('patient-billing')
    openRecord('DEMO-3')
    const issue = screen.getByRole('button', { name: 'Issue invoice' })
    fireEvent.click(issue)
    expect(issue.getAttribute('aria-expanded')).toBe('true')
    const form = document.getElementById(issue.getAttribute('aria-controls')!)!
    expect(form.tagName).toBe('FORM')
    expect(within(form).getByRole('button', { name: 'Issue invoice' }).getAttribute('type')).toBe('submit')
    // Pressed again, it closes.
    fireEvent.click(issue)
    expect(issue.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('.hid-ehr-dept-action-form')).toBeNull()
    fireEvent.click(issue)
    fireEvent.click(within(document.querySelector('.hid-ehr-dept-action-form') as HTMLElement).getByRole('button', { name: 'Issue invoice' }))

    expect(statusBadge()).toBe('issued')
    expect(actionButtons().map(button => button.textContent)).toEqual(['Record simulated payment', 'Void invoice'])
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Saved record' }))
    expect(screen.getByRole('status').textContent).toBe('Issue invoice: done. Status: issued.')
    const versions = screen.getByRole('heading', { name: 'Preserved versions & amendments' }).closest('section')!
    const entry = within(versions).getByText(/ · draft · Issue invoice$/)
    expect(entry.tagName).toBe('SUMMARY')
    expect(entry.textContent).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z · draft · Issue invoice$/)
    const details = entry.closest('details')!
    expect(within(details).getByText('Author: Sample user')).toBeDefined()
    expect(within(details).getByText('SERVICE-003')).toBeDefined()

    // Back in the list, the row shows the new status.
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(within(row('DEMO-3')).getByText('issued')).toBeDefined()
  })

  it('validates an action\'s fields, keeps a refusal on the form, and records the values given', () => {
    renderSample('patient-billing')
    openRecord('DEMO-2')
    fireEvent.click(screen.getByRole('button', { name: 'Record simulated payment' }))
    const form = document.querySelector('.hid-ehr-dept-action-form') as HTMLElement
    fireEvent.click(within(form).getByRole('button', { name: 'Record simulated payment' }))
    expect(within(form).getAllByText('Complete this field.')).toHaveLength(3)
    expect(document.activeElement).toBe(within(form).getByRole('spinbutton', { name: 'Amount (currency units)' }))

    type('Amount (currency units)', '6000', 'spinbutton')
    choose('Method', 'Cash')
    type('Unique transaction reference', 'TX-9')
    fireEvent.click(within(form).getByRole('button', { name: 'Record simulated payment' }))
    expect(within(form).getByRole('alert').textContent).toBe('Payment exceeds outstanding balance.')
    expect(within(form).getByText('Correct the issue or retry using the same button. No success is reported until saved.')).toBeDefined()
    expect(statusBadge()).toBe('issued')

    type('Amount (currency units)', '5000', 'spinbutton')
    fireEvent.click(within(form).getByRole('button', { name: 'Record simulated payment' }))
    expect(document.querySelector('.hid-ehr-dept-action-form')).toBeNull()
    expect(statusBadge()).toBe('paid')
    expect(savedFacts()).toMatchObject({ Amount: '5000', Method: 'Cash', Reference: 'TX-9', Total: '500000', Paid: '500000', Due: '0' })
    expect(actionButtons().map(button => button.textContent)).toEqual(['Refund payment'])
    expect(screen.getByText(/ · issued · Record simulated payment$/)).toBeDefined()
  })

  it('asks before a consequential action; Cancel and Escape change nothing', () => {
    renderSample('patient-billing')
    openRecord('DEMO-3')
    fireEvent.click(screen.getByRole('button', { name: 'Void invoice' }))
    const form = document.querySelector('.hid-ehr-dept-action-form') as HTMLElement
    type('Reason', 'Raised in error (fictional)')
    const submit = within(form).getByRole('button', { name: 'Void invoice' })
    fireEvent.click(submit)

    const dialog = screen.getByRole('alertdialog', { name: 'Void invoice?' })
    expect(within(dialog).getByText('Review the entered details before continuing. This action changes the saved record and is recorded in its history.')).toBeDefined()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.activeElement).toBe(submit)
    expect(statusBadge()).toBe('draft')

    fireEvent.click(submit)
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(statusBadge()).toBe('draft')

    fireEvent.click(submit)
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Void invoice' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(statusBadge()).toBe('void')
    expect(screen.getByText('No further actions for your permission and this record state.')).toBeDefined()
    // The record is named by its number, not the reason given.
    expect(heading().textContent).toBe('DEMO-3')
    expect(savedFacts().Reason).toBe('Raised in error (fictional)')
    expect(screen.getByText(/ · draft · Raised in error \(fictional\)$/)).toBeDefined()
  })

  it('asks for REFUND to be typed before a refund', () => {
    renderSample('patient-billing')
    openRecord('DEMO-1')
    fireEvent.click(screen.getByRole('button', { name: 'Refund payment' }))
    type('Refund amount', '1000', 'spinbutton')
    type('Reason', 'Overpaid (fictional)')
    fireEvent.click(within(document.querySelector('.hid-ehr-dept-action-form') as HTMLElement).getByRole('button', { name: 'Refund payment' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Refund payment?' })
    const confirm = within(dialog).getByRole('button', { name: 'Refund payment' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Type REFUND to confirm' }), { target: { value: 'REFUND' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(savedFacts()).toMatchObject({ Paid: '300000', Due: '700000' })
    expect(statusBadge()).toBe('partial')
  })

  it('keeps stock batches and refuses an adjustment below zero', () => {
    renderSample('supply')
    openRecord('Fictional Med A')
    expect(screen.getByRole('heading', { name: 'Stock batches', level: 3 })).toBeDefined()
    expect(screen.getByText('DEMO-LOT · 94 units · expires 2030-01-01')).toBeDefined()
    expect(screen.getByText(/ · active · Wastage \(fictional\)$/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Consume / adjust stock' }))
    const form = document.querySelector('.hid-ehr-dept-action-form') as HTMLElement
    choose('Batch', 'DEMO-LOT')
    type('Signed unit change', '-100', 'spinbutton')
    type('Reason', 'Count (fictional)')
    fireEvent.click(within(form).getByRole('button', { name: 'Consume / adjust stock' }))
    expect(within(form).getByRole('alert').textContent).toBe('Adjustment must use whole units and cannot create negative stock.')
    type('Signed unit change', '-4', 'spinbutton')
    fireEvent.click(within(form).getByRole('button', { name: 'Consume / adjust stock' }))
    expect(screen.getByText('DEMO-LOT · 90 units · expires 2030-01-01')).toBeDefined()
    expect(statusBadge()).toBe('active')
    expect(screen.getByText(/ · active · Count \(fictional\)$/)).toBeDefined()
  })

  it('never puts a record in the address', () => {
    renderSample('patient-billing')
    openRecord('DEMO-1')
    expect(where()).toBe('/ehr/patient-billing')
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    expect(where()).toBe('/ehr/patient-billing')
  })
})

describe('the design\'s refusals', () => {
  function refusal() {
    return within(document.querySelector('form') as HTMLElement).getByRole('alert').textContent
  }
  /** Presses the open form's submit button, named `label`. */
  function save(label = 'Save record') {
    const submits = [...document.querySelectorAll<HTMLButtonElement>('form button[type="submit"]')]
    expect(submits.map(button => button.textContent)).toEqual([label])
    fireEvent.click(submits[0]!)
  }

  it('refuses an invoice for no quantity or for a service event already charged, keeping the form', () => {
    renderSample('patient-billing')
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    choose('Patient', 'sample-patient-2')
    choose('Service charge', 'General consultation')
    type('Service quantity', '0', 'spinbutton')
    type('Unique charge reference (order / service ID)', 'SERVICE-002')
    save()
    expect(refusal()).toBe('Quantity must be greater than zero.')
    expect(screen.getByText('Correct the issue or retry using the same button. No success is reported until saved.')).toBeDefined()
    expect(heading().textContent).toBe('New patient billing')

    type('Service quantity', '1', 'spinbutton')
    save()
    expect(refusal()).toBe('This service event has already been charged.')
    type('Unique charge reference (order / service ID)', 'SERVICE-010')
    save()
    expect(heading().textContent).toBe('DEMO-4')
  })

  it('refuses a shift that ends before it starts, or overlaps the same person\'s shift', () => {
    renderSample('shifts')
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    choose('Staff member', 'Demo Nurse A')
    fireEvent.change(screen.getByLabelText(/^Shift start/), { target: { value: '2026-11-02T12:00' } })
    fireEvent.change(screen.getByLabelText(/^Shift end/), { target: { value: '2026-11-02T10:00' } })
    choose('Department', 'Emergency')
    save()
    expect(refusal()).toBe('Shift end must follow its start.')
    fireEvent.change(screen.getByLabelText(/^Shift end/), { target: { value: '2026-11-02T18:00' } })
    save()
    expect(refusal()).toBe('Staff roster conflict.')
    choose('Staff member', 'Demo Porter D')
    save()
    expect(screen.getByRole('heading', { name: 'Saved record' })).toBeDefined()
  })

  it('refuses a stock item with no pack size, and an edit to a negative price, keeping the record', () => {
    const stock = renderSample('supply')
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    type('Item name', 'Fictional Bandage')
    choose('Category', 'Consumable')
    type('Base unit', 'roll')
    type('Units per pack', '0', 'spinbutton')
    type('Reorder threshold', '5', 'spinbutton')
    save()
    expect(refusal()).toBe('Pack size must be positive and reorder threshold cannot be negative.')
    stock.unmount()

    renderSample('services')
    openRecord('Malaria test')
    fireEvent.click(screen.getByRole('button', { name: 'Edit record' }))
    type('Price', '-1', 'spinbutton')
    save('Save changes')
    expect(refusal()).toBe('Service price cannot be negative.')
    expect(screen.getByRole('button', { name: 'Cancel editing' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing' }))
    expect(savedFacts()).toEqual({ Name: 'Malaria test', Price: '1500' })
    expect(screen.queryByRole('heading', { name: 'Preserved versions & amendments' })).toBeNull()
  })

  it('refuses an approval over the invoice total and a settlement over the approval', () => {
    renderSample('insurance')
    openRecord('2a6f15aa')
    fireEvent.click(screen.getByRole('button', { name: 'Record payer decision' }))
    type('Approved amount', '6000', 'spinbutton')
    type('Local fixture decision', 'Approved (fictional)')
    save('Record payer decision')
    expect(refusal()).toBe('Approval exceeds invoice total.')
    type('Approved amount', '5000', 'spinbutton')
    save('Record payer decision')
    expect(statusBadge()).toBe('approved')

    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    openRecord('9d41c7b3')
    fireEvent.click(screen.getByRole('button', { name: 'Record simulated settlement' }))
    type('Received amount', '4500', 'spinbutton')
    type('Unique settlement reference', 'SET-1')
    save('Record simulated settlement')
    expect(refusal()).toBe('Settlement exceeds approval or outstanding invoice balance.')
    type('Received amount', '4000', 'spinbutton')
    save('Record simulated settlement')
    expect(statusBadge()).toBe('settled')
  })

  it('refuses to dispatch a vehicle that is not available or already out', () => {
    renderSample('ambulance')
    openRecord('57e5e7d4')
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch vehicle' }))
    save('Dispatch vehicle')
    expect(statusBadge()).toBe('dispatched')

    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    choose('Vehicle', 'AMB-02')
    type('Pickup location', 'Example G')
    type('Destination', 'Example H')
    type('Assigned crew', 'Demo crew 2')
    save()
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch vehicle' }))
    save('Dispatch vehicle')
    expect(refusal()).toBe('Vehicle is unavailable.')
    expect(statusBadge()).toBe('requested')
  })
})

describe('Edit record', () => {
  function editToggle() {
    return within(screen.getByRole('heading', { name: 'Saved record' }).closest('section')!).getByRole('button', { name: /^(Edit record|Cancel editing)$/ })
  }

  it('opens the fields in "Saved record", saves the edit in memory and keeps the version before', () => {
    renderSample('patient-billing')
    openRecord('DEMO-3')
    const toggle = editToggle()
    expect(toggle.textContent).toBe('Edit record')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    // The design's edit pattern: in the record's own card, not among the actions.
    expect(actionButtons().map(button => button.textContent)).toEqual(['Issue invoice', 'Void invoice'])

    fireEvent.click(toggle)
    expect(toggle.textContent).toBe('Cancel editing')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const form = document.getElementById(toggle.getAttribute('aria-controls')!)!
    expect(form.tagName).toBe('FORM')
    expect(screen.getByRole('heading', { name: 'Saved record' }).closest('section')!.contains(form)).toBe(true)
    const service = within(form).getByRole('combobox', { name: 'Service charge' }) as HTMLSelectElement
    expect(service.value).toBe('General consultation')
    expect(document.activeElement).toBe(service)
    expect((within(form).getByRole('spinbutton', { name: 'Service quantity' }) as HTMLInputElement).value).toBe('1')
    expect((within(form).getByRole('textbox', { name: 'Unique charge reference (order / service ID)' }) as HTMLInputElement).value).toBe('SERVICE-003')

    // The same inline validation as the create form.
    fireEvent.change(within(form).getByRole('textbox', { name: 'Unique charge reference (order / service ID)' }), { target: { value: '' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect(within(form).getByText('Complete this field.')).toBeDefined()
    expect(document.activeElement).toBe(within(form).getByRole('textbox', { name: 'Unique charge reference (order / service ID)' }))

    type('Unique charge reference (order / service ID)', 'SERVICE-030')
    type('Service quantity', '3', 'spinbutton')
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))

    expect(form.isConnected).toBe(false)
    expect(editToggle().textContent).toBe('Edit record')
    expect(savedFacts()).toMatchObject({ Quantity: '3', Source: 'SERVICE-030', Number: 'DEMO-3', 'Total Cents': '1500000', Total: '1500000', Due: '1500000' })
    expect(statusBadge()).toBe('draft')
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Saved record' }))
    expect(screen.getByRole('status').textContent).toBe('Record changes saved.')
    const entry = screen.getByText(/ · draft · Edit record$/)
    const details = entry.closest('details')!
    // The version keeps the record as it was before the edit.
    expect(within(details).getByText('SERVICE-003')).toBeDefined()
    expect(within(details).queryByText('SERVICE-030')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    fireEvent.click(screen.getByRole('button', { name: 'DEMO-3' }))
    expect(savedFacts()).toMatchObject({ Quantity: '3', Source: 'SERVICE-030' })
    expect(where()).toBe('/ehr/patient-billing')
  })

  it('keeps the record as it was on Cancel editing and gives focus back to the button', () => {
    renderSample('services')
    openRecord('Malaria test')
    fireEvent.click(editToggle())
    type('Service name', 'Changed (fictional)')
    fireEvent.click(editToggle())
    expect(editToggle().textContent).toBe('Edit record')
    expect(editToggle().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(editToggle())
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(savedFacts()).toEqual({ Name: 'Malaria test', Price: '1500' })
    expect(heading().textContent).toBe('Malaria test')
    expect(screen.queryByRole('heading', { name: 'Preserved versions & amendments' })).toBeNull()

    // Opened again, it starts from the saved values.
    fireEvent.click(editToggle())
    expect((screen.getByRole('textbox', { name: 'Service name' }) as HTMLInputElement).value).toBe('Malaria test')
  })

  it('renames a record named by its fields, and is offered only while the record keeps the status it was created in', () => {
    renderSample('quality')
    openRecord('Near-miss labelling (fictional)')
    fireEvent.click(editToggle())
    type('Incident title', 'Near-miss labelling, ward 2 (fictional)')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(heading().textContent).toBe('Near-miss labelling, ward 2 (fictional)')
    expect(screen.getByText(/ · reported · Edit record$/)).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Assign reviewer' }))
    type('Reviewer membership ID', 'Admin')
    fireEvent.click(within(document.querySelector('.hid-ehr-dept-action-form') as HTMLElement).getByRole('button', { name: 'Assign reviewer' }))
    expect(statusBadge()).toBe('assigned')
    expect(screen.queryByRole('button', { name: 'Edit record' })).toBeNull()
  })
})

describe('an address below the page', () => {
  it('opens the list even when the rest names one of its own records: the id is never looked up', async () => {
    renderSample('insurance/2a6f15aa-7c8d-4e9f-9a0b-9e8f1a2b3c29')
    expect(heading().textContent).toBe('Insurance & Claims')
    expect(screen.queryByRole('heading', { name: 'Saved record' })).toBeNull()
    noticeUnderHeading()
    await waitFor(() => expect(where()).toBe('/ehr/insurance'))
    expect(heading().textContent).toBe('Insurance & Claims')
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4)
  })
})

describe('the pages beside it', () => {
  it('lists a claim\'s connected records and chooses among the patient\'s own invoices and policies', () => {
    renderSample('insurance')
    openRecord('2a6f15aa')
    const history = screen.getByRole('heading', { name: 'Connected hospital history' }).closest('section')!
    const links = within(history).getAllByRole('link')
    expect(links.map(link => link.textContent)).toEqual(['Patient billing · DEMO-2', 'Policies · POL-DEMO'])
    expect(links.map(link => link.getAttribute('href'))).toEqual(['/ehr/patient-billing', '/ehr/policies'])

    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    expect(heading().textContent).toBe('New insurance & claims')
    choose('Patient', 'sample-patient-2')
    const invoice = screen.getByRole('combobox', { name: 'Invoice' }) as HTMLSelectElement
    expect([...invoice.options].map(option => option.textContent)).toEqual(['Select…', 'DEMO-2 · issued · c0eaed'])
    const policy = screen.getByRole('combobox', { name: 'Patient policy' }) as HTMLSelectElement
    expect([...policy.options].map(option => option.textContent)).toEqual(['Select…', 'POL-DEMO · active · b85705'])
  })

  it('follows a connected record to its workspace', () => {
    renderSample('policies')
    openRecord('POL-DEMO')
    fireEvent.click(screen.getByRole('link', { name: 'Patient billing · DEMO-2' }))
    expect(where()).toBe('/ehr/patient-billing')
    expect(heading().textContent).toBe('Patient billing')
  })

  it('links the pages beside it from its own base, also at an address below it', () => {
    function Links() {
      const { href, follow } = useSiblingPages('policies')
      return <a href={href('patient-billing')} onClick={event => follow('patient-billing', event)}>Patient billing</a>
    }
    renderDept(
      <Routes>
        <Route path="/ehr/policies/*" element={<Links />} />
        <Route path="/ehr/patient-billing" element={<h1>Patient billing</h1>} />
      </Routes>,
      { route: '/ehr/policies/5a200001/edit' },
    )
    const link = screen.getByRole('link', { name: 'Patient billing' })
    expect(link.getAttribute('href')).toBe('/ehr/patient-billing')
    fireEvent.click(link)
    expect(heading().textContent).toBe('Patient billing')
  })
})

describe('keyboard', () => {
  it('reaches every control as a native button or field', () => {
    renderSample('patient-billing')
    for (const name of ['Create record', 'DEMO-1']) {
      const button = screen.getByRole('button', { name })
      expect(button.tagName).toBe('BUTTON')
      expect(button.getAttribute('type')).toBe('button')
    }
    const first = row('DEMO-1')
    for (const button of within(first).getAllByRole('button').filter(button => button.textContent !== 'DEMO-1')) {
      expect(button.tagName).toBe('BUTTON')
      expect(button.getAttribute('aria-describedby')).toBe(screen.getByRole('button', { name: 'DEMO-1' }).id)
    }
    expect(screen.getByRole('region', { name: 'Patient billing records' }).getAttribute('tabindex')).toBe('0')
    openRecord('DEMO-2')
    for (const button of actionButtons()) {
      expect(button.tagName).toBe('BUTTON')
      expect(button.getAttribute('type')).toBe('button')
    }
  })

  it('opens a preserved version as a native disclosure', () => {
    renderSample('procurement')
    openRecord('Stock request')
    const summary = screen.getByText(/ · requested · Approve request$/)
    const details = summary.closest('details')!
    expect(details.open).toBe(false)
    fireEvent.click(summary)
    expect(details.open).toBe(true)
  })
})
