import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  CHECK_IDENTITY_WORDS, DROPPED_WORDS, FLAG_REASON_UNKNOWN, FLAG_REASON_WORDS, NO_IDENTITY_WORDS, PaperReadingSummary, PaperReadingView,
  PaperReadingWarnings, checkReasonWords, claimsPaperReading, flagReasonWords, isUnreadable, itemHeadline, itemLine, itemNotActive,
  itemStatusWords, needsCheck, orderItems, pageWarnings, parsePaperReading, readerGuess, readingStatusLine, readingSummary, unreadableWords,
  type PaperItem,
} from '../../../../ehr-blue/departments/migrate/paperReading'
import {
  ItemCheck, ReadingText, cleanReading, itemHeadlineText, readingNotes, readingParts, withoutBullet,
} from '../../../../ehr-blue/departments/migrate/paperReading'
import { FLAG_REASONS, flagged, handwrittenPage, hardHandwrittenPage, paperReading, unreadablePage, unreadPaper } from './paperReadingPayload'

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

  it.each([
    ['it-00000000000000a1', 'stopped', 'Stopped'],
    ['it-00000000000000a1', 'past', 'Taken in the past'],
    ['it-00000000000000b1', 'ruled_out', 'Ruled out'],
    ['it-00000000000000b1', 'history', 'Past history'],
    ['it-00000000000000b1', 'family_history', 'Family history'],
  ])('names a status that says the item is not active (%s, %s) beside its line', (id, status, words) => {
    const item = { ...byId(id), fields: { ...byId(id).fields, status } }
    expect(itemNotActive(item)).toBe(words)
    expect(itemLine(item)).toBe(`${itemHeadline(item)} — ${words}`)
  })

  it('says a suspected diagnosis is suspected, so it is never read as confirmed', () => {
    const suspected = { ...byId('it-00000000000000b1'), asWritten: 'Malaria', fields: { name: 'Malaria', status: 'suspected' } }
    expect(itemNotActive(suspected)).toBeNull()
    expect(itemStatusWords(suspected)).toBe('Suspected')
    expect(itemLine(suspected)).toBe('Malaria — Suspected')
    expect(itemLine(byId('it-00000000000000b1'))).toBe('HTN')
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
    expect(screen.getByText(CHECK_IDENTITY_WORDS)).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent))
      .toEqual(['Who the paper is about', 'Medicines', 'Diagnoses', 'Allergies', 'Lab results', 'Vitals', 'Notes'])
    const medicines = within(screen.getByRole('region', { name: 'Medicines' })).getAllByRole('listitem')
    // The reading is what is written on the paper, not the reader's sentence about it.
    expect(medicines.map(row => row.querySelector('strong')?.textContent)).toEqual(['Metf?rmin 500 bd', 'Amlodipine 5mg od x 30/7'])
    // To check: a small "Check" mark (a word, never a "?" that could be taken for one on the paper), and the reason
    // only behind Why?, closed.
    const [metformin, amlodipine] = medicines
    expect(within(metformin!).getByText('Check').getAttribute('data-tone')).toBe('caution')
    const why = within(metformin!).getByText('Why?').closest('details')!
    expect(why.open).toBe(false)
    expect(within(why).getByText('The handwriting was hard to read.')).toBeTruthy()
    // A clear item is the reading alone: no badge, no Why?, no page, no details, no "As written".
    expect(within(amlodipine!).queryByText('Check')).toBeNull()
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
    expect(screen.getByText(CHECK_IDENTITY_WORDS)).toBeTruthy()
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

  it('counts a flagged page’s items without "so far": the line above the reading says it may not be complete', () => {
    const one = parsed(handwrittenPage())
    expect(readingSummary(one.items)).toBe('1 item read · 1 to check')
    render(<PaperReadingSummary reading={one} />)
    expect(screen.getByText('1 item read · 1 to check')).toBeTruthy()
    expect(document.body.textContent).not.toContain('so far')
  })

  it('shows the live case as one short line, with the pages, reasons, left-out note and confidence under a closed Details', () => {
    const { container } = render(<PaperReadingWarnings reading={parsed(handwrittenPage())} confidence={0.31} />)
    expect(container.querySelectorAll('.hid-ehr-dept-notice-caution')).toHaveLength(1)
    expect(container.querySelector('strong')?.textContent).toBe('Hard handwriting. Check the marked items.')
    const details = screen.getByText('Details').closest('details')!
    expect(details.open).toBe(false)
    expect(within(details).getByText('Page 1 may not be fully read. Check the whole page against the paper and enter anything missing by hand.')).toBeTruthy()
    expect(within(details).getByText('Why: handwriting that is hard to read; some things the reader suggested could not be found on the page; some lines may have been missed.')).toBeTruthy()
    expect(within(details).getByText(DROPPED_WORDS)).toBeTruthy()
    expect(within(details).getByText('Read with 31% confidence. Check it against the document.')).toBeTruthy()
    // Nothing but the line and the word Details shows until Details is opened.
    expect(Array.from(container.querySelectorAll('strong, summary')).map(element => element.textContent).join(' '))
      .toBe('Hard handwriting. Check the marked items. Details')
    // 'handwriting' is also a plain word, so only the coded names are looked for.
    for (const code of FLAG_REASONS.filter(code => code.includes('_'))) expect(container.textContent).not.toContain(code)
  })

  it.each([
    ['handwriting', { 1: ['handwriting'] }, 'Hard handwriting. Check the marked items.'],
    ['parts hard to read', { 1: ['low_confidence'] }, 'Hard to read. Check the marked items.'],
    ['lines that may be missed', { 1: ['possible_missed_item'] }, 'May not be fully read. Check the marked items.'],
  ])('says in its line what is wrong (%s)', (_, flags, line) => {
    expect(readingStatusLine(parsed(flagged(flags)))).toBe(line)
  })

  it('points to the paper, not to marked items, when no item is marked', () => {
    const payload = flagged({ 1: ['handwriting'] })
    expect(readingStatusLine(parsed({ ...payload, items: [payload.items[0]] }))).toBe('Hard handwriting. Check it against the paper.')
  })

  it('notes left-out suggestions even when no page is flagged, and shows nothing when all is well', () => {
    const { container, unmount } = render(<PaperReadingWarnings reading={parsed(paperReading({ reading: { ...paperReading().reading, droppedUngrounded: 2 } }))} />)
    expect(container.querySelector('strong')?.textContent).toBe('May not be fully read. Check the marked items.')
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

  it('keeps a mark written only in symbols as a reading', () => {
    for (const asWritten of ['+++', '✓', '√', '[unreadable] +']) expect(isUnreadable({ asWritten })).toBe(false)
  })

  it('marks a line read in part to check, with a reason, even when the reader called it clear', () => {
    const item = { ...parsed().items[0]!, asWritten: 'Metro[unreadable] 500' }
    expect(item.confidence).toBe('clear')
    expect(needsCheck(item)).toBe(true)
    expect(checkReasonWords(item)).toBe('Part of this line couldn’t be read.')
    expect(readingSummary([item])).toBe('1 item read · 1 to check')
    render(<PaperReadingView reading={parsed(paperReading({ items: [{ ...paperReading().items[0], asWritten: 'Metro[unreadable] 500' }],
      reading: { ...paperReading().reading, itemCount: 1 } }))} />)
    const row = within(screen.getByRole('region', { name: 'Medicines' })).getByRole('listitem')
    expect(within(row).getByText('Check')).toBeTruthy()
    expect(within(row.querySelector('details')!).getByText('Part of this line couldn’t be read.')).toBeTruthy()
  })

  it('names what the reader guessed for a line it couldn’t read, behind a closed disclosure, and never as an item', () => {
    const base = paperReading()
    const guessed = { ...base.items[0], id: 'it-0000000000000c99', asWritten: '[unreadable]', plain: 'Paracetamol',
      fields: { name: 'Paracetamol', strength: '500 mg', form: null, route: null, frequency: null, duration: null, status: 'unknown' } }
    const reading = parsed(paperReading({ items: [base.items[1], guessed], reading: { ...base.reading, itemCount: 2 } }))
    expect(readerGuess(reading.items[1]!)).toBe('Paracetamol 500 mg')
    expect(readerGuess(parsed(unreadablePage()).items[1]!)).toBeNull()
    render(<PaperReadingView reading={reading} />)
    const medicines = screen.getByRole('region', { name: 'Medicines' })
    expect(within(medicines).getAllByRole('listitem')).toHaveLength(1)
    expect(within(medicines).getByText('1 line couldn’t be read. Check the paper.')).toBeTruthy()
    const guess = within(medicines).getByText('What the reader guessed').closest('details')!
    expect(guess.open).toBe(false)
    expect(within(guess).getByText('Not saved: Paracetamol 500 mg.')).toBeTruthy()
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
    expect(readingSummary(reading.items)).toBe('1 item read · 1 to check')
    // The reader filled in nothing for these lines, so there is no guess to name.
    expect(screen.queryByText('What the reader guessed')).toBeNull()
  })
})

describe('the reader\'s marks: shown without "?" and saved clean', () => {
  it.each([
    ['an unsure word', 'Admit?', 'Admit'],
    ['unsure words on a line', 'Amlodipine? 5mg? od?', 'Amlodipine 5mg od'],
    ['an unsure date', '21/8? Review', '21/8 Review'],
    ['punctuation after an unsure word', 'Admit?, review', 'Admit, review'],
    ['another possible reading', 'Omeprazole? (or Quinine?) 40mg', 'Omeprazole 40mg'],
    ['another possible reading of the route', 'IV? (or po?) Omeprazole?', 'IV Omeprazole'],
    ['a part with no readable letters', 'Admitted [?] ward', 'Admitted ward'],
    ['an unreadable dose', 'Ampiclox [dose?] 8hrly', 'Ampiclox 8hrly'],
    ['an unreadable frequency', 'Paracetamol 1g [freq?]', 'Paracetamol 1g'],
    ['an unreadable route and medicine', '[route?] [drug?] 500mg', '500mg'],
    ['an alternative that is only a part that couldn\'t be read', 'Ampiclox 500mg? (or [dose?]) 8hrly?', 'Ampiclox 500mg 8hrly'],
    ['words crossed out', 'Gentamicin? 80mg? (crossed out: Ceftriaxone? 1g? (or Ceftriaxone?)) 12hrly?', 'Gentamicin 80mg 12hrly'],
    ['a cut-off word and the medicine it most likely is', 'IV? Am… (Ampiclox?) 500mg?', 'IV Ampiclox 500mg'],
    ['a cut-off word written with three dots', 'Am... (Ampiclox) 500mg', 'Ampiclox 500mg'],
    ['a question mark written on the paper', 'Paracetamol 1g (? on paper)', 'Paracetamol 1g (? on paper)'],
    ['a cut-off word whose bracket is not the medicine (a dose is kept)', 'Ceftriaxone 1g... (if febrile)', 'Ceftriaxone 1g... (if febrile)'],
    ['a cut-off value then words in brackets', 'BP 120/… (sitting)', 'BP 120/… (sitting)'],
    ['a cut-off word then a dose in brackets', 'Metro… (500mg)', 'Metro… (500mg)'],
    ['a cut-off word then a frequency in brackets', 'Cipro… (bd)', 'Cipro… (bd)'],
    ['a cut-off word then a duration in brackets', 'Metro… (x5 days)', 'Metro… (x5 days)'],
    ['a cut-off word then an unsure medicine it is not', 'Am… (Quinine?) 300mg', 'Am… (Quinine) 300mg'],
    ['a cut-off word then the medicine, in any case', 'cipro… (Ciprofloxacin?) bd', 'Ciprofloxacin bd'],
    ['an unsure word in brackets, with nothing cut off', 'Tab (Ampiclox?) 500mg', 'Tab (Ampiclox) 500mg'],
    ['a dash at the start of a field is a minus, kept', '- ve', '- ve'],
    ['a dash at the start of a field is kept', '- Dc Gentamicin?', '- Dc Gentamicin'],
    ['a dash inside the line', '21/8? [?] - Transfer to the ward', '21/8 - Transfer to the ward'],
    ['a "?" alone, kept as it was', 'Ceftriaxone ? IV', 'Ceftriaxone ? IV'],
    ['a "?" inside a word, kept as it was', 'Metf?rmin 500 bd', 'Metf?rmin 500 bd'],
    ['a query written before a word, kept as it was', '?Malaria', '?Malaria'],
    ['words in brackets that are not a mark', 'Amlodipine 5mg (PRN)', 'Amlodipine 5mg (PRN)'],
    ['a bracket never closed', 'Amlodipine (5mg', 'Amlodipine (5mg'],
    ['plain words', 'Amlodipine 5mg od x 30/7', 'Amlodipine 5mg od x 30/7'],
    ['nothing', '', ''],
  ])('cleanReading: %s', (_, written, saved) => {
    expect(cleanReading(written)).toBe(saved)
    expect(cleanReading(written)).not.toMatch(/\w\?(\s|$)/)
  })

  it('drops a bullet from a whole line, never a minus', () => {
    expect(withoutBullet('- Dc Gentamicin?')).toBe('Dc Gentamicin?')
    expect(withoutBullet('— Transfer to the ward')).toBe('Transfer to the ward')
    expect(withoutBullet('• Admit')).toBe('Admit')
    expect(withoutBullet('- ve')).toBe('- ve')
    expect(withoutBullet('- VE')).toBe('- VE')
    expect(withoutBullet('- 2.5')).toBe('- 2.5')
    expect(withoutBullet('-ve')).toBe('-ve')
    expect(withoutBullet('21/8 - Transfer')).toBe('21/8 - Transfer')
  })

  it('marks only an unsure word in brackets, never the brackets', () => {
    expect(readingParts('Tab (Ampiclox?) 500mg')).toEqual([
      { kind: 'text', text: 'Tab (' }, { kind: 'unsure', text: 'Ampiclox' }, { kind: 'text', text: ') 500mg' },
    ])
  })

  it('treats a cut-off word as a medicine match only when the bracket names one starting the same way', () => {
    for (const line of ['Ceftriaxone 1g... (if febrile)', 'BP 120/… (sitting)', 'Metro… (500mg)', 'Cipro… (bd)', 'Metro… (x5 days)']) {
      expect(readingParts(line).some(part => part.kind === 'cut_off')).toBe(false)
      expect(readingNotes(line)).toEqual([])
    }
  })

  it('splits a line into its marks once, for the line and for what is saved', () => {
    expect(readingParts('IV? Am… (Ampiclox?) 500mg? (or [dose?]) 8hrly?')).toEqual([
      { kind: 'unsure', text: 'IV' }, { kind: 'text', text: ' ' }, { kind: 'cut_off', text: 'Am…' }, { kind: 'unsure', text: 'Ampiclox' },
      { kind: 'text', text: ' ' }, { kind: 'unsure', text: '500mg' }, { kind: 'text', text: ' ' }, { kind: 'unsure', text: '8hrly' },
    ])
    expect(readingParts('Paracetamol [freq?] (? on paper) (crossed out: Ceftriaxone?)').filter(part => part.kind !== 'text')).toEqual([
      { kind: 'gap', field: 'frequency' }, { kind: 'paper_mark' }, { kind: 'crossed', text: 'Ceftriaxone' },
    ])
    expect(readingParts('[dose?] [route?] [drug?] [?] [Freq ?]').filter(part => part.kind === 'gap').map(part => 'field' in part && part.field))
      .toEqual(['dose', 'route', 'medicine', 'word', 'frequency'])
  })

  it('keeps other possible readings and a cut-off word for Why?, never one that says nothing new', () => {
    expect(readingNotes('IV? (or po?) Omeprazole? (or Quinine?) 40mg? daily? (or 8hrly?)'))
      .toEqual(['Other possible reading: po', 'Other possible reading: Quinine', 'Other possible reading: 8hrly'])
    expect(readingNotes('IV? Am… (Ampiclox?) 500mg? (or [dose?]) 8hrly?')).toEqual(['Written as: Am…'])
    // The same as the word it is another reading of, or inside words crossed out: nothing to say.
    expect(readingNotes('Ceftriaxone? (or ceftriaxone?) 1g')).toEqual([])
    expect(readingNotes('Gentamicin? (crossed out: Ceftriaxone? 1g? (or Ceftriaxone?))')).toEqual([])
    expect(readingNotes('Amlodipine 5mg od')).toEqual([])
  })

  it('shows an unsure word without its "?", dotted and said as not sure', () => {
    const { container } = render(<p><ReadingText text="Admit? Bisi" /></p>)
    const unsure = container.querySelector('.hid-ehr-dept-migrate-unsure')!
    expect(unsure.getAttribute('title')).toBe('not sure')
    expect(unsure.textContent).toBe('Admit (not sure)')
    expect(within(unsure as HTMLElement).getByText(' (not sure)', { normalizer: text => text }).className).toBe('hid-ehr-sr-only')
    expect(container.textContent).toBe('Admit (not sure) Bisi')
    expect(container.textContent).not.toContain('?')
  })

  it('shows parts that couldn\'t be read as grey words, a "?" written on the paper as one, and crossed-out words struck through', () => {
    const { container } = render(<p><ReadingText text="IV? Gentamicin? 80mg? (crossed out: Ceftriaxone? 1g? (or Ceftriaxone?)) [freq?] (? on paper)" /></p>)
    const gaps = Array.from(container.querySelectorAll('.hid-ehr-dept-migrate-gap'))
    expect(gaps.map(gap => gap.textContent)).toEqual(['frequency couldn’t be read', '? on paper'])
    expect(gaps[0]!.getAttribute('title')).toBe('couldn’t be read')
    const crossed = container.querySelector('s.hid-ehr-dept-migrate-crossed')!
    expect(crossed.textContent).toBe('crossed out: Ceftriaxone 1g')
    expect(container.textContent).toBe('IV (not sure) Gentamicin (not sure) 80mg (not sure) crossed out: Ceftriaxone 1g frequency couldn’t be read ? on paper')
    // The only "?" left is the one written on the paper.
    expect(container.textContent!.match(/\?/g)).toHaveLength(1)
  })

  it('shows the medicine a cut-off word most likely is, as unsure, and keeps the cut-off word and other readings under Why?', () => {
    const reading = parsed(hardHandwrittenPage())
    const ampiclox = reading.items[0]!
    const { container } = render(<p><ReadingText text={ampiclox.asWritten} /><ItemCheck item={ampiclox} /></p>)
    const why = within(container).getByText('Why?').closest('details')!
    expect(why.open).toBe(false)
    expect(within(why).getByText('Written as: Am…')).toBeTruthy()
    const line = container.textContent!.replace(why.textContent!, '')
    expect(line).toBe('IV (not sure) Ampiclox (not sure) 500mg (not sure) 8hrly (not sure)Check')
    expect(Array.from(container.querySelectorAll('.hid-ehr-dept-migrate-unsure')).map(word => word.firstChild?.textContent))
      .toEqual(['IV', 'Ampiclox', '500mg', '8hrly'])
  })

  it('shows every line of a hard handwritten page without the reader\'s "?" and with the same words it saves', () => {
    const reading = parsed(hardHandwrittenPage())
    expect(reading.items.map(itemLine)).toEqual([
      'IV Ampiclox 500mg 8hrly',
      'IV Gentamicin 80mg 12hrly',
      'IV Omeprazole 40mg daily',
      'Dc Gentamicin — Stopped',
      'Paracetamol 1g (? on paper)',
      'Admit',
      '21/8 - Transfer to the ward',
    ])
    expect(reading.items.map(itemHeadlineText)).toEqual(reading.items.map(item => cleanReading(withoutBullet(item.asWritten))))
    const { container } = render(<PaperReadingView reading={reading} />)
    const medicines = within(screen.getByRole('region', { name: 'Medicines' })).getAllByRole('listitem')
    expect(medicines.map(row => row.querySelector('strong')?.textContent)).toEqual([
      'IV (not sure) Ampiclox (not sure) 500mg (not sure) 8hrly (not sure)',
      'IV (not sure) Gentamicin (not sure) 80mg (not sure) crossed out: Ceftriaxone 1g 12hrly (not sure)',
      'IV (not sure) Omeprazole (not sure) 40mg (not sure) daily (not sure)',
      'Dc Gentamicin (not sure) — Stopped',
      'Paracetamol 1g frequency couldn’t be read ? on paper',
    ])
    for (const row of medicines) expect(within(row).getByText('Check')).toBeTruthy()
    const omeprazole = within(medicines[2]!).getByText('Why?').closest('details')!
    expect(Array.from(omeprazole.querySelectorAll('span')).map(note => note.textContent)).toEqual([
      'The handwriting was hard to read.', 'Other possible reading: po', 'Other possible reading: Quinine', 'Other possible reading: 8hrly',
    ])
    const notes = within(screen.getByRole('region', { name: 'Notes' })).getAllByRole('listitem')
    expect(notes.map(row => row.querySelector('strong')?.textContent)).toEqual([
      'Admit (not sure)', '21/8 (not sure) word couldn’t be read - Transfer to the ward',
    ])
    // Outside the closed Why? and the words said only to a screen reader, no "?" but the one on the paper.
    const seen = Array.from(container.querySelectorAll('strong')).map(line => {
      const copy = line.cloneNode(true) as HTMLElement
      copy.querySelectorAll('.hid-ehr-sr-only').forEach(hidden => hidden.remove())
      return copy.textContent
    })
    expect(seen.join(' ').match(/\?/g)).toHaveLength(1)
  })

  it('counts a line of only parts that couldn\'t be read as a line that couldn\'t be read', () => {
    expect(isUnreadable({ asWritten: '[dose?] [freq?]' })).toBe(true)
    expect(isUnreadable({ asWritten: '[?]' })).toBe(true)
    expect(isUnreadable({ asWritten: 'Ampiclox [dose?]' })).toBe(false)
    expect(isUnreadable({ asWritten: '(? on paper)' })).toBe(false)
  })

  it('counts a line of only another reading or words crossed out, with no summary, as a line that couldn\'t be read', () => {
    expect(isUnreadable({ asWritten: '(or Quinine?)', plain: '' })).toBe(true)
    expect(isUnreadable({ asWritten: '[dose?] (or Quinine?)', plain: ' ' })).toBe(true)
    expect(isUnreadable({ asWritten: '(crossed out: Ceftriaxone?)', plain: '' })).toBe(true)
    // With a summary, the summary is the line shown and saved.
    expect(isUnreadable({ asWritten: '(or Quinine?)', plain: 'Quinine' })).toBe(false)
    const item = { ...parsed().items[0]!, asWritten: '(or Quinine?)', plain: 'Quinine 300 mg' }
    expect(itemHeadlineText(item)).toBe('Quinine 300 mg')
  })

  it('checks a line the reader called clear when it carries the reader\'s doubt, with Why? and a Check mark', () => {
    const item = { ...parsed().items[0]!, asWritten: 'Amlodipine (or Amiloride) 5mg od' }
    expect(item.confidence).toBe('clear')
    expect(needsCheck(item)).toBe(true)
    expect(checkReasonWords(item)).toBe('Some words couldn’t be read for sure.')
    const { container } = render(<ItemCheck item={item} />)
    expect(within(container).getByText('Check')).toBeTruthy()
    expect(within(container).getByText('Other possible reading: Amiloride')).toBeTruthy()
    for (const asWritten of ['Amoxicillin [dose?] 8hrly', 'Give (or withhold?) Digoxin', 'Allergy: Penicillin? (or nil?)', 'Na? 130 (or 150?)', 'Am… (Amoxil?) 500mg']) {
      expect(needsCheck({ ...item, asWritten })).toBe(true)
    }
    for (const asWritten of ['Amlodipine 5mg od', 'Paracetamol 1g (? on paper)', 'Quinine (crossed out: Chloroquine)', '?Malaria', 'Metf?rmin 500 bd']) {
      expect(needsCheck({ ...item, asWritten })).toBe(false)
    }
  })
})

describe('ReadingText edges', () => {
  it('says no spaces at either end, nor twice where a mark was taken out', () => {
    const { container } = render(<p><ReadingText text="  (or Quinine?) Omeprazole (or Esomeprazole?)  40mg (or 20mg?)  " /></p>)
    expect(container.textContent).toBe('Omeprazole 40mg')
  })
})
