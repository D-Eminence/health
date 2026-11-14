import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFIRM_BODY } from '../../../ehr-blue/clinical/parts/Detail'
import type * as Definitions from '../../../ehr-blue/clinical/sample/definitions'
import type { SampleDefinition } from '../../../ehr-blue/clinical/sample/definitions'
import { createSampleRecord, sampleState } from '../../../ehr-blue/clinical/sample/store'
import { SampleWorkspace, resetSampleStore } from '../../../ehr-blue/clinical/sample/SampleWorkspace'
import { labelled, renderPage } from './harness'

/**
 * The engine's decision dialog for the design's typed words: sign, delete and refund ask for SIGN, DELETE and
 * REFUND; void and revoke ask plainly. None of today's 14 sample workspaces has such an action, so this file adds
 * one fictional definition next to the real ones. It is no module of the design's, which grants it nothing (audit item
 * 16), so this file lets every action through: it tests the typed words only.
 */

const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn(() => true) }))

vi.mock('../../../staff/api', () => ({ staffApi: {}, isAllowedPatientLookup: () => false }))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})
vi.mock('../../../ehr-blue/clinical/sample/access', () => ({ useSampleAccess: () => () => true }))
vi.mock('../../../ehr-blue/clinical/sample/definitions', async importOriginal => {
  const real = await importOriginal<typeof Definitions>()
  const note = { key: 'note', label: 'Signing note', required: true }
  const typed: SampleDefinition = {
    id: 'typed-check',
    title: 'Typed check',
    patient: false,
    initial: 'draft',
    fields: [{ key: 'name', label: 'Name', required: true }],
    actions: [
      { id: 'sign', label: 'Sign record', from: ['draft'], to: 'signed', fields: [note] },
      { id: 'delete', label: 'Delete record', from: ['signed'], to: 'deleted' },
      { id: 'refund', label: 'Refund payment', from: ['deleted'], to: 'refunded' },
      { id: 'void', label: 'Void record', from: ['refunded'], to: 'void' },
    ],
  }
  return { ...real, SAMPLE_DEFINITIONS: { ...real.SAMPLE_DEFINITIONS, 'typed-check': typed } }
})

let recordId = ''

beforeEach(() => {
  resetSampleStore()
  const created = createSampleRecord('typed-check', undefined, { name: 'Fictional typed record' })
  if (!('id' in created)) throw new Error(created.error)
  recordId = created.id
})

function actionsCard() {
  return screen.getByRole('heading', { name: 'Available actions' }).closest('section') as HTMLElement
}

function submitFor(label: string) {
  return within(actionsCard()).getAllByRole('button', { name: label }).find(button => button.getAttribute('type') === 'submit')!.closest('form')!
}

function status() {
  return sampleState().records.find(record => record.id === recordId)!.status
}

async function confirmTyped(label: string, word: string) {
  fireEvent.click(within(actionsCard()).getByRole('button', { name: label }))
  fireEvent.submit(submitFor(label))
  const dialog = await screen.findByRole('alertdialog', { name: `${label}?` })
  expect(dialog.textContent).toContain(CONFIRM_BODY)
  const confirm = within(dialog).getByRole('button', { name: label }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  const input = within(dialog).getByLabelText(`Type ${word} to confirm`)
  fireEvent.change(input, { target: { value: word.toLowerCase() } })
  expect(confirm.disabled).toBe(true)
  fireEvent.change(input, { target: { value: word } })
  expect(confirm.disabled).toBe(false)
  fireEvent.click(confirm)
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
}

describe('typed confirmation words', () => {
  it('asks for SIGN; Cancel keeps the note and the status; the typed word signs', async () => {
    renderPage(<SampleWorkspace id="typed-check" />, 'typed-check', `/${recordId}`)
    fireEvent.click(within(actionsCard()).getByRole('button', { name: 'Sign record' }))
    fireEvent.change(within(actionsCard()).getByLabelText(labelled('Signing note')), { target: { value: 'Fictional note' } })
    fireEvent.submit(submitFor('Sign record'))
    const dialog = await screen.findByRole('alertdialog', { name: 'Sign record?' })
    expect(within(dialog).getByLabelText('Type SIGN to confirm')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect((within(actionsCard()).getByLabelText(labelled('Signing note')) as HTMLTextAreaElement).value).toBe('Fictional note')
    expect(status()).toBe('draft')

    await act(async () => {})
    fireEvent.submit(submitFor('Sign record'))
    const again = await screen.findByRole('alertdialog', { name: 'Sign record?' })
    fireEvent.change(within(again).getByLabelText('Type SIGN to confirm'), { target: { value: 'SIGN' } })
    fireEvent.click(within(again).getByRole('button', { name: 'Sign record' }))
    await waitFor(() => expect(status()).toBe('signed'))
    expect(screen.getByText(/· draft · Sign record$/)).toBeTruthy()
  })

  it('asks for DELETE and REFUND, and plainly for void', async () => {
    renderPage(<SampleWorkspace id="typed-check" />, 'typed-check', `/${recordId}`)
    fireEvent.click(within(actionsCard()).getByRole('button', { name: 'Sign record' }))
    fireEvent.change(within(actionsCard()).getByLabelText(labelled('Signing note')), { target: { value: 'Fictional note' } })
    fireEvent.submit(submitFor('Sign record'))
    const sign = await screen.findByRole('alertdialog', { name: 'Sign record?' })
    fireEvent.change(within(sign).getByLabelText('Type SIGN to confirm'), { target: { value: 'SIGN' } })
    fireEvent.click(within(sign).getByRole('button', { name: 'Sign record' }))
    await waitFor(() => expect(status()).toBe('signed'))

    await confirmTyped('Delete record', 'DELETE')
    await waitFor(() => expect(status()).toBe('deleted'))
    await confirmTyped('Refund payment', 'REFUND')
    await waitFor(() => expect(status()).toBe('refunded'))

    fireEvent.click(within(actionsCard()).getByRole('button', { name: 'Void record' }))
    fireEvent.submit(submitFor('Void record'))
    const plain = await screen.findByRole('alertdialog', { name: 'Void record?' })
    expect(within(plain).queryByLabelText(/to confirm$/)).toBeNull()
    fireEvent.click(within(plain).getByRole('button', { name: 'Void record' }))
    await waitFor(() => expect(status()).toBe('void'))
  })
})
