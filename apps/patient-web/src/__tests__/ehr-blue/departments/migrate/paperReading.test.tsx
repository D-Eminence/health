import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  PaperReadingView, claimsPaperReading, itemDetails, itemNotActive, orderItems, parsePaperReading, readingSummary, type PaperItem,
} from '../../../../ehr-blue/departments/migrate/paperReading'
import { paperReading, unreadPaper } from './paperReadingPayload'

/** The paper reading on Migrate's "What was read": checking the payload, the items' words and their order. Fictional data. */
function parsed(payload: unknown = paperReading()) {
  const reading = parsePaperReading(payload)
  if (!reading) throw new Error('Expected the paper reading to be read.')
  return reading
}

describe('parsePaperReading', () => {
  it('reads a whole paper reading', () => {
    const reading = parsed()
    expect(reading.status).toBe('read')
    expect(reading.items).toHaveLength(7)
    expect(reading.identity).toEqual({ nameAsWritten: 'Bisi Fictional', dateOfBirthAsWritten: '14/07/1980', folderNumberAsWritten: 'F-0042' })
  })

  it('is not a paper reading without its contract', () => {
    expect(parsePaperReading({ title: 'Full blood count' })).toBeNull()
    expect(parsePaperReading({ ...paperReading(), contract: 'hid-paper-reading-v1' })).toBeNull()
    expect(claimsPaperReading({ title: 'Full blood count' })).toBe(false)
  })

  it.each([
    ['nothing', null],
    ['a string', 'hid-paper-reading-v2'],
    ['a list', [paperReading()]],
    ['items that are not a list', paperReading({ items: { a: 1 } })],
    ['no reading', paperReading({ reading: undefined })],
    ['an unknown status', paperReading({ reading: { ...paperReading().reading, status: 'done' } })],
    ['an identity that is not a group', paperReading({ identity: 'Bisi' })],
    ['a name that is not text', paperReading({ identity: { ...paperReading().identity, nameAsWritten: 42 } })],
    ['an item of unknown kind', paperReading({ items: [{ ...paperReading().items[0], kind: 'procedure' }] })],
    ['an item with no words as written', paperReading({ items: [{ ...paperReading().items[0], asWritten: ' ' }] })],
    ['an item with no page', paperReading({ items: [{ ...paperReading().items[0], page: 0 }] })],
    ['an item with an unknown confidence', paperReading({ items: [{ ...paperReading().items[0], confidence: 0.4 }] })],
    ['an item whose fields are a list', paperReading({ items: [{ ...paperReading().items[0], fields: ['5 mg'] }] })],
    ['an item whose reason is not text', paperReading({ items: [{ ...paperReading().items[1], checkReason: ['x'] }] })],
    ['a prescription that is not a group', paperReading({ items: [{ ...paperReading().items[0], prescription: 'Dr Ade' }] })],
    ['an item that is not a group', paperReading({ items: [null] })],
    ['the same item twice', paperReading({ items: [paperReading().items[0], paperReading().items[0]] })],
  ])('is not shown when it holds %s', (_, payload) => {
    expect(parsePaperReading(payload)).toBeNull()
  })

  it('says a payload is meant as a paper reading even when it is not whole', () => {
    expect(claimsPaperReading(paperReading({ items: 'broken' }))).toBe(true)
  })
})

describe('item words', () => {
  const items = () => parsed().items
  const byId = (id: string) => items().find(item => item.id === id) as PaperItem

  it('gives each kind its own details in plain words', () => {
    expect(itemDetails(byId('it-00000000000000a1'))).toEqual(['5 mg', 'tablet', 'by mouth', 'once a day', 'for 30 days', 'Currently taking',
      'Prescribed by Dr Ade Fictional', 'Prescribed on 02/03/2025'])
    expect(itemDetails(byId('it-00000000000000b1'))).toEqual(['Confirmed'])
    expect(itemDetails(byId('it-00000000000000c1'))).toEqual(['Reaction: rash', 'Moderate'])
    expect(itemDetails(byId('it-00000000000000d1'))).toEqual(['11.2 g/dL', 'Normal range 12-16', 'Flag: low', 'Dated 01/03/2025'])
    expect(itemDetails(byId('it-00000000000000e1'))).toEqual(['Blood pressure', '150/95 mmHg'])
    expect(itemDetails(byId('it-00000000000000f1'))).toEqual([])
  })

  it('says when the paper records no known allergies', () => {
    const none = { ...byId('it-00000000000000c1'), fields: { substance: null, reaction: null, severity: null, noKnownAllergies: true } }
    expect(itemDetails(none)).toEqual(['No known allergies'])
  })

  it.each([
    ['it-00000000000000a1', 'stopped', 'Stopped'],
    ['it-00000000000000a1', 'past', 'Taken in the past'],
    ['it-00000000000000b1', 'ruled_out', 'Ruled out'],
    ['it-00000000000000b1', 'history', 'Past history'],
    ['it-00000000000000b1', 'family_history', 'Family history'],
  ])('names a status that says the item is not active (%s, %s) apart from its details', (id, status, words) => {
    const item = { ...byId(id), fields: { ...byId(id).fields, status } }
    expect(itemNotActive(item)).toBe(words)
    expect(itemDetails(item)).not.toContain(words)
  })

  it('leaves an active status in the details', () => {
    expect(itemNotActive(byId('it-00000000000000a1'))).toBeNull()
    expect(itemNotActive(byId('it-00000000000000b1'))).toBeNull()
    expect(itemNotActive(byId('it-00000000000000c1'))).toBeNull()
  })

  it('puts items that need a careful check first, then keeps reading order', () => {
    const medicines = items().filter(item => item.kind === 'medicine')
    expect(orderItems(medicines).map(item => item.id)).toEqual(['it-00000000000000a2', 'it-00000000000000a1'])
    expect(orderItems(items()).map(item => item.id).slice(0, 2)).toEqual(['it-00000000000000a2', 'it-00000000000000c1'])
  })

  it('counts the items read and those to check carefully', () => {
    expect(readingSummary(items())).toBe('7 items read · 2 need a careful check')
    expect(readingSummary(items().slice(0, 2))).toBe('2 items read · 1 needs a careful check')
    expect(readingSummary(items().slice(0, 1))).toBe('1 item read')
  })
})

describe('PaperReadingView', () => {
  it('shows who the paper is about, then the items grouped by kind, careful checks first', () => {
    render(<PaperReadingView reading={parsed()} />)
    expect(screen.getByText('Name on the paper').nextSibling?.textContent).toBe('Bisi Fictional')
    expect(screen.getByText('Date of birth on the paper').nextSibling?.textContent).toBe('14/07/1980')
    expect(screen.getByText('Folder number').nextSibling?.textContent).toBe('F-0042')
    expect(screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent))
      .toEqual(['Who the paper is about', 'Medicines', 'Diagnoses', 'Allergies', 'Lab results', 'Vitals', 'Notes'])
    const medicines = within(screen.getByRole('region', { name: 'Medicines' })).getAllByRole('listitem')
    expect(medicines.map(row => row.querySelector('strong')?.textContent)).toEqual(['Metformin', 'Amlodipine'])
    expect(within(medicines[0]!).getByText('Check carefully').getAttribute('data-tone')).toBe('caution')
    expect(within(medicines[0]!).getByText('The handwriting was hard to read.')).toBeTruthy()
    expect(within(medicines[0]!).getByText('As written: Metf?rmin 500 bd')).toBeTruthy()
    expect(within(medicines[1]!).getByText('Clear').getAttribute('data-tone')).toBe('positive')
    expect(within(medicines[1]!).getByText('Page 1')).toBeTruthy()
    expect(within(medicines[1]!).getByText(/^5 mg · tablet · by mouth · once a day · for 30 days · Currently taking/)).toBeTruthy()
  })

  it('puts a ruled-out diagnosis, a relative’s diagnosis and a stopped medicine beside the bold reading', () => {
    const base = paperReading()
    const byId = (id: string) => base.items.find((item: { id: string }) => item.id === id) as { fields: Record<string, unknown> }
    const withStatus = (from: string, id: string, status: string) => ({ ...byId(from), id, fields: { ...byId(from).fields, status } })
    render(<PaperReadingView reading={parsed(paperReading({ items: [
      withStatus('it-00000000000000b1', 'it-00000000000000b8', 'ruled_out'), withStatus('it-00000000000000b1', 'it-00000000000000b9', 'family_history'),
      withStatus('it-00000000000000a1', 'it-00000000000000a9', 'stopped'),
    ], reading: { ...base.reading, itemCount: 3 } }))} />)
    const diagnoses = within(screen.getByRole('region', { name: 'Diagnoses' })).getAllByRole('listitem')
    expect(diagnoses.map(row => row.querySelector('strong')?.textContent))
      .toEqual(['High blood pressure — Ruled out', 'High blood pressure — Family history'])
    expect(within(diagnoses[0]!).queryByText('Ruled out')).toBeNull()
    const stopped = within(screen.getByRole('region', { name: 'Medicines' })).getByRole('listitem')
    expect(stopped.querySelector('strong')?.textContent).toBe('Amlodipine — Stopped')
    expect(stopped.textContent?.match(/Stopped/g)).toHaveLength(1)
  })

  it('leaves out a group with nothing in it, and says when nothing was picked out of a read paper', () => {
    const { unmount } = render(<PaperReadingView reading={parsed(paperReading({ items: [paperReading().items[2]],
      reading: { ...paperReading().reading, itemCount: 1 } }))} />)
    expect(screen.queryByRole('region', { name: 'Medicines' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Diagnoses' })).toBeTruthy()
    unmount()
    render(<PaperReadingView reading={parsed(paperReading({ items: [], reading: { ...paperReading().reading, itemCount: 0 } }))} />)
    expect(screen.getByText('No medicines, diagnoses, allergies, results or notes were picked out. Check the document.')).toBeTruthy()
  })

  it('says what is missing from the paper', () => {
    render(<PaperReadingView reading={parsed(paperReading({ identity: { nameAsWritten: null, dateOfBirthAsWritten: ' ',
      folderNumberAsWritten: null, sexAsWritten: null, lineIds: [], box: null } }))} />)
    expect(screen.getAllByText('Not found on the paper')).toHaveLength(3)
  })

  it.each([
    ['ai_off', 'Only the text was read; items weren’t picked out.'],
    ['ai_failed', 'The items couldn’t be picked out automatically. Enter them by hand.'],
    ['ai_declined', 'The items couldn’t be picked out automatically. Enter them by hand.'],
    ['no_text', 'No text was found on this document.'],
  ])('says plainly why no items were picked out (%s)', (status, words) => {
    render(<PaperReadingView reading={parsed(unreadPaper(status))} />)
    expect(screen.getByRole('note').textContent).toBe(words)
    expect(screen.queryByRole('region', { name: 'Medicines' })).toBeNull()
    expect(document.body.textContent).not.toContain(status)
  })
})
