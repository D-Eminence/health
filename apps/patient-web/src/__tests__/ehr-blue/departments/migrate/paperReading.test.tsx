import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  DROPPED_WORDS, FLAG_REASON_UNKNOWN, FLAG_REASON_WORDS, NO_IDENTITY_WORDS, PaperReadingSummary, PaperReadingView, PaperReadingWarnings,
  claimsPaperReading, flagReasonWords, isUnreadable, itemDetails, itemHeadline, itemNotActive, orderItems, pageWarnings, parsePaperReading,
  readingStatusLine, readingSummary, unreadableWords, type PaperItem,
} from '../../../../ehr-blue/departments/migrate/paperReading'
import { FLAG_REASONS, flagged, handwrittenPage, paperReading, unreadablePage, unreadPaper } from './paperReadingPayload'

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
    ['no pages', paperReading({ pages: undefined })],
    ['pages that are not a list', paperReading({ pages: { 1: {} } })],
    ['a page with no number', paperReading({ pages: [{ ...paperReading().pages[0], page: 0 }] })],
    ['a page whose flag is not yes or no', paperReading({ pages: [{ ...paperReading().pages[0], flagged: 'yes' }] })],
    ['a page whose reasons are not a list', paperReading({ pages: [{ ...paperReading().pages[0], flagReasons: 'handwriting' }] })],
    ['a page whose reason is not text', paperReading({ pages: [{ ...paperReading().pages[0], flagged: true, flagReasons: [3] }] })],
    ['no count of left-out suggestions', paperReading({ reading: { ...paperReading().reading, droppedUngrounded: undefined } })],
    ['a negative count of left-out suggestions', paperReading({ reading: { ...paperReading().reading, droppedUngrounded: -1 } })],
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
    expect(readingSummary(items())).toBe('7 items read · 2 to check')
    expect(readingSummary(items().slice(0, 2))).toBe('2 items read · 1 to check')
    expect(readingSummary(items().slice(0, 1))).toBe('1 item read')
  })
})

describe('PaperReadingView', () => {
  it('shows who the paper is about, then each item on one line as written, grouped by kind, careful checks first', () => {
    render(<PaperReadingView reading={parsed()} />)
    expect(screen.getByText('Name on the paper').nextSibling?.textContent).toBe('Bisi Fictional')
    expect(screen.getByText('Date of birth on the paper').nextSibling?.textContent).toBe('14/07/1980')
    expect(screen.getByText('Folder number').nextSibling?.textContent).toBe('F-0042')
    expect(screen.queryByText(NO_IDENTITY_WORDS)).toBeNull()
    expect(screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent))
      .toEqual(['Who the paper is about', 'Medicines', 'Diagnoses', 'Allergies', 'Lab results', 'Vitals', 'Notes'])
    const medicines = within(screen.getByRole('region', { name: 'Medicines' })).getAllByRole('listitem')
    // The reading is what is written on the paper, not the reader's sentence about it.
    expect(medicines.map(row => row.querySelector('strong')?.textContent)).toEqual(['Metf?rmin 500 bd', 'Amlodipine 5mg od x 30/7'])
    // To check: a small "?" (heard as "Check"), and the reason only behind Why?, closed.
    const [metformin, amlodipine] = medicines
    expect(within(metformin!).getByText('?').getAttribute('data-tone')).toBe('caution')
    expect(within(metformin!).getByText('Check').className).toBe('hid-ehr-sr-only')
    const why = within(metformin!).getByText('Why?').closest('details')!
    expect(why.open).toBe(false)
    expect(within(why).getByText('The handwriting was hard to read.')).toBeTruthy()
    // A clear item is the reading alone: no badge, no Why?, no page, no details, no "As written".
    expect(within(amlodipine!).queryByText('?')).toBeNull()
    expect(within(amlodipine!).queryByText('Why?')).toBeNull()
    expect(amlodipine!.textContent).toBe('Amlodipine 5mg od x 30/7')
    expect(document.body.textContent).not.toMatch(/As written|Page 1|Check carefully|Clear|Possibly/)
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
      .toEqual(['HTN — Ruled out', 'HTN — Family history'])
    expect(within(diagnoses[0]!).queryByText('Ruled out')).toBeNull()
    const stopped = within(screen.getByRole('region', { name: 'Medicines' })).getByRole('listitem')
    expect(stopped.querySelector('strong')?.textContent).toBe('Amlodipine 5mg od x 30/7 — Stopped')
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

  it('says in one line when the paper names nobody, and shows only what was found otherwise', () => {
    const { unmount } = render(<PaperReadingView reading={parsed(paperReading({ identity: { nameAsWritten: null, dateOfBirthAsWritten: ' ',
      folderNumberAsWritten: null, sexAsWritten: null, lineIds: [], box: null } }))} />)
    expect(screen.getByText(NO_IDENTITY_WORDS)).toBeTruthy()
    expect(screen.queryByText('Name on the paper')).toBeNull()
    expect(screen.queryByText(/Not found/)).toBeNull()
    unmount()
    render(<PaperReadingView reading={parsed(paperReading({ identity: { nameAsWritten: 'Bisi Fictional', dateOfBirthAsWritten: null,
      folderNumberAsWritten: ' ', sexAsWritten: null, lineIds: [], box: null } }))} />)
    expect(screen.getByText('Name on the paper').nextSibling?.textContent).toBe('Bisi Fictional')
    expect(screen.queryByText('Date of birth on the paper')).toBeNull()
    expect(screen.queryByText('Folder number')).toBeNull()
    expect(screen.queryByText(NO_IDENTITY_WORDS)).toBeNull()
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

describe('pages that may not be fully read', () => {
  it('reads the pages and left-out count the worker writes', () => {
    const reading = parsed(handwrittenPage())
    expect(reading.pages).toEqual([{ page: 1, flagged: true, flagReasons: ['handwriting', 'many_dropped', 'possible_missed_item'] }])
    expect(reading.droppedUngrounded).toBe(1)
    expect(reading.items).toHaveLength(1)
    expect(parsed().pages.map(page => page.flagged)).toEqual([false, false])
  })

  it('treats a page with reasons as flagged, whatever its flag says', () => {
    const payload = paperReading()
    const reading = parsed({ ...payload, pages: [{ ...payload.pages[0], flagged: false, flagReasons: ['handwriting'] }, payload.pages[1]] })
    expect(reading.pages[0]!.flagged).toBe(true)
  })

  it('has plain words for every code the worker writes, and no others', () => {
    expect(Object.keys(FLAG_REASON_WORDS).sort()).toEqual([...FLAG_REASONS].sort())
    expect(FLAG_REASONS.map(code => flagReasonWords([code])[0])).toEqual([
      'parts of it are hard to read',
      'handwriting that is hard to read',
      'some things the reader suggested could not be found on the page',
      'the reader was not sure about this page',
      'some lines may have been missed',
      'the items on this page could not be picked out automatically',
    ])
  })

  it.each([['an unknown code', ['smudged']], ['no code', []], ['a code that names an object property', ['constructor']]])(
    'gives a general sentence for %s, never the code', (_, codes) => {
      expect(flagReasonWords(codes)).toEqual([FLAG_REASON_UNKNOWN])
    })

  it('says each reason once', () => {
    expect(flagReasonWords(['handwriting', 'smudged', 'handwriting', 'blurred'])).toEqual(['handwriting that is hard to read', FLAG_REASON_UNKNOWN])
  })

  it('warns for each flagged page, by page number', () => {
    expect(pageWarnings(parsed(flagged({ 2: ['possible_missed_item', 'low_confidence'] })))).toEqual([{ key: 'page-2',
      text: 'Page 2 may not be fully read. Check the whole page against the paper and enter anything missing by hand.',
      why: 'Why: some lines may have been missed; parts of it are hard to read.' }])
    expect(pageWarnings(parsed()))
      .toEqual([])
  })

  it('warns once when every page is flagged', () => {
    expect(pageWarnings(parsed(flagged({ 1: ['handwriting'], 2: ['ai_unsure', 'handwriting'] })))).toEqual([{ key: 'all',
      text: 'Pages 1 and 2 may not be fully read. Check each whole page against the paper and enter anything missing by hand.',
      why: 'Why: handwriting that is hard to read; the reader was not sure about this page.' }])
  })

  it('never says the count is complete when a page is flagged', () => {
    const one = parsed(handwrittenPage())
    expect(readingSummary(one.items, 1)).toBe('1 item read so far · 1 to check')
    expect(readingSummary(parsed().items.slice(0, 1), 1)).toBe('1 item read so far')
    expect(readingSummary(parsed().items, 2)).toBe('7 items read so far · 2 to check')
    render(<PaperReadingSummary reading={one} />)
    expect(screen.getByText('1 item read so far · 1 to check')).toBeTruthy()
  })

  it('shows the live case as one short line, with the pages, reasons, left-out note and confidence under a closed Details', () => {
    const { container } = render(<PaperReadingWarnings reading={parsed(handwrittenPage())} confidence={0.31} />)
    expect(container.querySelectorAll('.hid-ehr-dept-notice-caution')).toHaveLength(1)
    expect(container.querySelector('strong')?.textContent).toBe('Hard handwriting. Check the items marked ?')
    const details = screen.getByText('Details').closest('details')!
    expect(details.open).toBe(false)
    expect(within(details).getByText('Page 1 may not be fully read. Check the whole page against the paper and enter anything missing by hand.')).toBeTruthy()
    expect(within(details).getByText('Why: handwriting that is hard to read; some things the reader suggested could not be found on the page; some lines may have been missed.')).toBeTruthy()
    expect(within(details).getByText(DROPPED_WORDS)).toBeTruthy()
    expect(within(details).getByText('Read with 31% confidence. Check it against the document.')).toBeTruthy()
    // Nothing but the line and the word Details shows until Details is opened.
    expect(Array.from(container.querySelectorAll('strong, summary')).map(element => element.textContent).join(' '))
      .toBe('Hard handwriting. Check the items marked ? Details')
    // 'handwriting' is also a plain word, so only the coded names are looked for.
    for (const code of FLAG_REASONS.filter(code => code.includes('_'))) expect(container.textContent).not.toContain(code)
  })

  it.each([
    ['handwriting', { 1: ['handwriting'] }, 'Hard handwriting. Check the items marked ?'],
    ['parts hard to read', { 1: ['low_confidence'] }, 'Hard to read. Check the items marked ?'],
    ['lines that may be missed', { 1: ['possible_missed_item'] }, 'May not be fully read. Check the items marked ?'],
  ])('says in its line what is wrong (%s)', (_, flags, line) => {
    expect(readingStatusLine(parsed(flagged(flags)))).toBe(line)
  })

  it('points to the paper, not to marked items, when no item is marked', () => {
    const payload = flagged({ 1: ['handwriting'] })
    expect(readingStatusLine(parsed({ ...payload, items: [payload.items[0]] }))).toBe('Hard handwriting. Check it against the paper.')
  })

  it('notes left-out suggestions even when no page is flagged, and shows nothing when all is well', () => {
    const { container, unmount } = render(<PaperReadingWarnings reading={parsed(paperReading({ reading: { ...paperReading().reading, droppedUngrounded: 2 } }))} />)
    expect(container.querySelector('strong')?.textContent).toBe('May not be fully read. Check the items marked ?')
    expect(within(screen.getByText('Details').closest('details')!).getByText(DROPPED_WORDS)).toBeTruthy()
    unmount()
    const quiet = render(<PaperReadingWarnings reading={parsed()} confidence={0.92} />)
    expect(quiet.container.textContent).toBe('')
  })

  it('shows an unknown code as a general sentence', () => {
    const { container } = render(<PaperReadingWarnings reading={parsed(flagged({ 1: ['smudged'] }))} />)
    expect(screen.getByText(`Why: ${FLAG_REASON_UNKNOWN}.`)).toBeTruthy()
    expect(container.textContent).not.toContain('smudged')
  })
})

describe('lines that could not be read', () => {
  it('knows a line that is only the unreadable mark, in any case and with punctuation, and not one read in part', () => {
    expect(isUnreadable({ asWritten: '[unreadable]' })).toBe(true)
    expect(isUnreadable({ asWritten: ' [Unreadable] [UNREADABLE]. ' })).toBe(true)
    expect(isUnreadable({ asWritten: '- [unreadable] ?' })).toBe(true)
    expect(isUnreadable({ asWritten: 'Metro[unreadable] 500' })).toBe(false)
    expect(isUnreadable({ asWritten: 'Metf?rmin 500 bd' })).toBe(false)
  })

  it('shows a line read in part as written, with the part that couldn’t be read as …', () => {
    const item = { ...parsed().items[0]!, asWritten: 'Metro[unreadable] 500 bd' }
    expect(itemHeadline(item)).toBe('Metro… 500 bd')
  })

  it('says how many lines couldn’t be read', () => {
    expect(unreadableWords(1)).toBe('1 line couldn’t be read. Check the paper.')
    expect(unreadableWords(5)).toBe('5 lines couldn’t be read. Check the paper.')
  })

  it('shows one line per group for the lines that couldn’t be read, never a row each, and leaves them out of the count', () => {
    const reading = parsed(unreadablePage())
    render(<PaperReadingView reading={reading} />)
    const medicines = within(screen.getByRole('region', { name: 'Medicines' }))
    expect(medicines.getAllByRole('listitem').map(row => row.querySelector('strong')?.textContent)).toEqual(['Ceftriaxone ? IV'])
    expect(medicines.getByText('5 lines couldn’t be read. Check the paper.')).toBeTruthy()
    const notes = within(screen.getByRole('region', { name: 'Notes' }))
    expect(notes.queryAllByRole('listitem')).toHaveLength(0)
    expect(notes.getByText('4 lines couldn’t be read. Check the paper.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('[unreadable]')
    expect(screen.getByText(NO_IDENTITY_WORDS)).toBeTruthy()
    expect(readingSummary(reading.items, 1)).toBe('1 item read so far · 1 to check')
  })
})
