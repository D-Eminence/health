import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { RecordsPage } from '../routes/Portal'
import { forgetPatientEntriesServed, patientEntriesServed } from '../patientEntriesServed'
import { json, press, problem, renderPortal, shownText, type Handler, type Sent } from './portalHarness'

vi.mock('../backendContract', () => ({ usesNovuBackend: () => true }))
vi.mock('../env', () => ({ getEnvironment: () => ({ name: 'production' }) }))

/**
 * "Added by you" on the Records page (BACKEND-NEEDS.md §1): the records the patient added with "Add a record", which come
 * in the page's own records answer (GET ehr/me/records) under `patientEntries`; nothing is read for them alone. That key
 * is also the served signal: an answer without it (today's backend) leaves the page exactly as it was, with exactly
 * today's requests. Fictional data only.
 */

const ENTRIES = '/ehr/me/patient-entries'
const RECORDS_PATH = '/ehr/me/records'
const MALARIA = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b'
const AMOXICILLIN = '8e7d6c5b-4a39-4281-9f0e-1d2c3b4a5f60'
const ADDED = '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d'
const NOTES = 'Rapid test positive. The doctor said to take the full course of artemether-lumefantrine twice a day for three days, '
  + 'drink plenty of water, and come back if the fever is still there after that.'

const RECORDS = { encounters: [{ id: 'enc-1', facilityId: 'facility-1', encounterType: 'ambulatory', status: 'completed',
  startedAt: '2026-10-08T10:00:00Z', endedAt: null }], notes: [], importedRecords: [], importedHealthProfile: null, limit: 50 }
const NO_RECORDS = { ...RECORDS, encounters: [] }

const malaria = { id: MALARIA, source: 'patient', kind: 'test', title: 'Malaria test', facilityName: 'Lagos General Hospital',
  occurredOn: '2026-10-20', notes: NOTES, createdAt: '2026-10-21T09:00:00.000Z', documents: [
    // A bigint size, as pg sends it: a string.
    { id: 'doc-1', fileName: 'result-slip.jpg', mediaType: 'image/jpeg', sizeBytes: '245760', status: 'uploaded', scanStatus: 'pending',
      createdAt: '2026-10-21T09:01:00.000Z' },
    { id: 'doc-2', fileName: 'lab-report.pdf', mediaType: 'application/pdf', sizeBytes: 1258291, status: 'rejected', scanStatus: 'rejected',
      createdAt: '2026-10-21T09:02:00.000Z' },
  ] }
const amoxicillin = { id: AMOXICILLIN, source: 'patient', kind: 'medicine', title: 'Amoxicillin 500 mg', facilityName: null,
  occurredOn: '2026-08-14', notes: 'Twice a day for a week.', createdAt: '2026-08-14T18:00:00.000Z', documents: [
    { id: 'doc-3', fileName: 'prescription.png', mediaType: 'image/png', sizeBytes: 20480, status: 'available', scanStatus: 'clean',
      createdAt: '2026-08-14T18:01:00.000Z' },
  ] }
/** The records answer, with the records the patient added under `patientEntries`. */
const served = (items: readonly unknown[], records: object = RECORDS) => ({ ...records, patientEntries: items })

/** The gateway: the page's records as `records` answers them, and anything else as `other` does (else 404 NOT_FOUND). */
function gateway(records: () => unknown, other?: (path: string, method: string, body: unknown) => Response | undefined): Handler {
  return (path, method, body) => {
    if (path === RECORDS_PATH && method === 'GET') {
      const answer = records()
      return answer instanceof Response ? answer : json(answer)
    }
    return other?.(path, method, body) ?? problem(404, 'NOT_FOUND', `Cannot ${method} ${path}`)
  }
}

const requests = (sent: Sent[]) => sent.map(request => `${request.method} ${request.path}`)
const ownCard = () => screen.findByRole('region', { name: 'Added by you' })
/** The list's own heading text, which takes focus after a removal. */
const ownTitle = (card: HTMLElement) => within(card).getByText('Added by you')
/** The page's tab for a record type, which counts what it holds. */
const tab = (name: string) => within(screen.getByRole('navigation', { name: 'Record type' })).getByRole('button', { name: new RegExp(`^${name}\\d*$`) })
const search = (text: string) => fireEvent.change(screen.getByRole('searchbox', { name: 'Search your records' }), { target: { value: text } })
/** Lets answers still on their way arrive. */
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })

beforeEach(() => { forgetPatientEntriesServed() })
afterEach(() => { vi.unstubAllGlobals() })

describe('the records the patient added, where the backend does not serve them', () => {
  it('sends only the records’ read, and shows exactly the page it showed before', async () => {
    const { sent } = renderPortal(<RecordsPage />, gateway(() => RECORDS))
    await screen.findByText('Ambulatory')
    expect(patientEntriesServed()).toBe(false)
    await settle()

    expect(requests(sent)).toEqual([`GET ${RECORDS_PATH}`])
    expect(screen.queryByRole('region', { name: 'Added by you' })).toBeNull()
    expect(screen.queryByText(/Added by you|records you added|Removed from your records/)).toBeNull()
    expect(screen.queryAllByRole('alert')).toEqual([])
    expect(screen.getByText('Your visits, doctor’s notes and older records.')).toBeTruthy()
    // A search, and a tab, read nothing more.
    search('ambulatory')
    expect(screen.getByText('1 record matches your search.')).toBeTruthy()
    fireEvent.click(tab('Visits'))
    fireEvent.click(tab('All'))
    await settle()
    expect(sent).toHaveLength(1)
  })

  it('keeps today’s empty page for a patient with no records', async () => {
    const { sent } = renderPortal(<RecordsPage />, gateway(() => NO_RECORDS))
    expect(await screen.findByText('No records yet')).toBeTruthy()
    expect(patientEntriesServed()).toBe(false)
    await settle()
    expect(requests(sent)).toEqual([`GET ${RECORDS_PATH}`])
  })

  it('learns nothing while the records themselves could not be read', async () => {
    const { sent } = renderPortal(<RecordsPage />, gateway(() => json({ code: 'EHR_UNAVAILABLE', detail: 'Records are unavailable.', retryable: false }, 503)))
    expect(shownText(await screen.findByRole('alert'))).toContain('Couldn’t load your records')
    await settle()
    expect(requests(sent)).toEqual([`GET ${RECORDS_PATH}`])
    expect(patientEntriesServed()).toBeNull()
    // Not known to be served, so nothing of the list is mounted, not even its empty live region: the page is today's.
    expect(screen.queryAllByRole('status')).toEqual([])
    expect(screen.queryByRole('region', { name: 'Added by you' })).toBeNull()
  })

  it('shows the page as before when the key is not a list, and learns nothing from it', async () => {
    const { sent } = renderPortal(<RecordsPage />, gateway(() => ({ ...RECORDS, patientEntries: { items: [malaria] } })))
    await screen.findByText('Ambulatory')
    await settle()
    expect(screen.queryByText(/Added by you|Malaria test/)).toBeNull()
    expect(screen.queryAllByRole('alert')).toEqual([])
    expect(patientEntriesServed()).toBeNull()
    expect(requests(sent)).toEqual([`GET ${RECORDS_PATH}`])
  })
})

describe('the records the patient added, where the backend serves them', () => {
  it('lists each, newest first, with its kind, place, date, notes and files, and their virus check in words', async () => {
    const { sent } = renderPortal(<RecordsPage />, gateway(() => served([malaria, amoxicillin])))
    const card = await ownCard()
    expect(patientEntriesServed()).toBe(true)

    expect(within(card).getAllByRole('heading', { level: 3 }).map(item => item.textContent)).toEqual(['Malaria test', 'Amoxicillin 500 mg'])
    expect(within(card).getByText('Test result · Lagos General Hospital · 20 Oct 2026')).toBeTruthy()
    expect(within(card).getByText('Medicine · 14 Aug 2026')).toBeTruthy()

    // Long notes are cut short, with Show all; short ones are shown whole.
    expect(within(card).queryByText(NOTES)).toBeNull()
    expect(within(card).getByText(/^Rapid test positive\..*…$/)).toBeTruthy()
    expect(within(card).getByText('Twice a day for a week.')).toBeTruthy()
    expect(within(card).getAllByRole('button', { name: /^Show all/ })).toHaveLength(1)
    const more = within(card).getByRole('button', { name: 'Show all notes for Malaria test' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    await press(more)
    expect(within(card).getByText(NOTES)).toBeTruthy()
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(more.textContent).toBe('Show less notes for Malaria test')
    expect(document.activeElement).toBe(more)

    // Each file by name, type and size; while its check runs, and when it failed, that is said.
    const files = (title: string) => within(within(card).getByRole('list', { name: `Photos and files for ${title}` })).getAllByRole('listitem')
      .map(item => [...item.children].map(part => part.textContent).filter(Boolean))
    expect(files('Malaria test')).toEqual([
      ['result-slip.jpg', 'Photo · 240 KB', 'Checking for viruses'],
      ['lab-report.pdf', 'PDF · 1.2 MB', 'Couldn’t be checked'],
    ])
    expect(files('Amoxicillin 500 mg')).toEqual([['prescription.png', 'Photo · 20 KB']])
    // No download yet.
    expect(within(card).queryAllByRole('link')).toEqual([])
    expect(within(card).queryByRole('button', { name: /Download|Open/ })).toBeNull()

    expect(within(card).getAllByRole('button', { name: /^Remove/ }).map(button => button.textContent))
      .toEqual(['Remove Malaria test, 20 Oct 2026', 'Remove Amoxicillin 500 mg, 14 Aug 2026'])
    // From the records' one read: nothing is read for them alone.
    expect(requests(sent)).toEqual([`GET ${RECORDS_PATH}`])
  })

  it('leaves out an entry it cannot read, and never calls a check it does not know clean', async () => {
    renderPortal(<RecordsPage />, gateway(() => served([
      { ...amoxicillin, documents: [{ ...amoxicillin.documents[0], status: 'quarantined', scanStatus: 'infected' }] },
      { ...malaria, id: 'clinician-1', source: 'clinician', title: 'Not one the patient added' },
      { ...malaria, id: 'no-title', title: '' },
    ])))
    const card = await ownCard()
    expect(within(card).getAllByRole('heading', { level: 3 }).map(item => item.textContent)).toEqual(['Amoxicillin 500 mg'])
    expect(within(within(card).getByRole('list', { name: 'Photos and files for Amoxicillin 500 mg' })).getByRole('listitem').textContent)
      .toContain('Checking for viruses')
  })

  it('removes one only once asked, then reads the records again and says it was removed from the records', async () => {
    let items: unknown[] = [malaria, amoxicillin]
    const { sent } = renderPortal(<RecordsPage />, gateway(() => served(items), (path, method) => {
      if (path !== `${ENTRIES}/${MALARIA}/withdraw` || method !== 'POST') return undefined
      items = [amoxicillin]
      return json({ entry: { id: MALARIA, status: 'withdrawn', withdrawnAt: '2026-11-01T10:00:00.000Z' } })
    }))
    const card = await ownCard()
    await press(within(card).getByRole('button', { name: 'Remove Malaria test, 20 Oct 2026' }))

    const question = within(card).getByRole('group', {
      name: 'Remove this record? It’s taken off your records, your chat and what your care team can see. Nothing is deleted.' })
    expect(document.activeElement).toBe(within(question).getByRole('button', { name: 'Keep record' }))
    expect(requests(sent)).toEqual([`GET ${RECORDS_PATH}`])

    await press(within(question).getByRole('button', { name: 'Yes, remove' }))
    const notice = await screen.findByText('Removed from your records')
    expect(notice.closest('[role="status"]')).not.toBeNull()
    expect(sent.slice(1)).toEqual([
      { path: `${ENTRIES}/${MALARIA}/withdraw`, method: 'POST', body: null },
      { path: RECORDS_PATH, method: 'GET', body: null },
    ])
    expect(within(card).queryByText('Malaria test')).toBeNull()
    expect(within(card).getByText('Amoxicillin 500 mg')).toBeTruthy()
    expect(within(card).queryByRole('group')).toBeNull()
    // The rest of the page is read again with them, and still shown.
    expect(screen.getByText('Ambulatory')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(ownTitle(card)))
    expect(document.body.textContent).not.toMatch(/delete/i)
  })

  it('sends nothing when the patient keeps it, and gives focus back to Remove', async () => {
    const { sent } = renderPortal(<RecordsPage />, gateway(() => served([malaria, amoxicillin])))
    const card = await ownCard()
    const remove = within(card).getByRole('button', { name: 'Remove Amoxicillin 500 mg, 14 Aug 2026' })
    await press(remove)
    await press(within(card).getByRole('button', { name: 'Keep record' }))
    expect(within(card).queryByRole('group')).toBeNull()
    expect(document.activeElement).toBe(within(card).getByRole('button', { name: 'Remove Amoxicillin 500 mg, 14 Aug 2026' }))
    await settle()
    expect(requests(sent)).toEqual([`GET ${RECORDS_PATH}`])
  })

  it('keeps the record and says so when the removal fails, without reading the records again', async () => {
    const { sent } = renderPortal(<RecordsPage />, gateway(() => served([malaria]), (path, method) =>
      method === 'POST' ? problem(503, 'PATIENT_ENTRIES_UNAVAILABLE', 'ehr.patient_entries is unavailable') : undefined))
    const card = await ownCard()
    await press(within(card).getByRole('button', { name: 'Remove Malaria test, 20 Oct 2026' }))
    await press(within(card).getByRole('button', { name: 'Yes, remove' }))
    const alert = await within(card).findByRole('alert')
    expect(shownText(alert)).toBe('This record wasn’t removed. Please try again.')
    expect(document.body.textContent).not.toContain('patient_entries')
    expect(within(card).getByText('Malaria test')).toBeTruthy()
    expect(screen.queryByText('Removed from your records')).toBeNull()
    expect(requests(sent)).toEqual([`GET ${RECORDS_PATH}`, `POST ${ENTRIES}/${MALARIA}/withdraw`])
    expect(document.activeElement).toBe(within(card).getByRole('button', { name: 'Yes, remove' }))
  })

  it('says it was removed once the last one is gone, and gives focus to the page heading', async () => {
    let items: unknown[] = [amoxicillin]
    renderPortal(<RecordsPage />, gateway(() => served(items), (path, method) => {
      if (method !== 'POST') return undefined
      items = []
      return json({ entry: { id: AMOXICILLIN, status: 'withdrawn', withdrawnAt: '2026-11-01T10:00:00.000Z' } })
    }))
    const card = await ownCard()
    await press(within(card).getByRole('button', { name: /^Remove/ }))
    await press(within(card).getByRole('button', { name: 'Yes, remove' }))
    expect((await screen.findByText('Removed from your records')).closest('[role="status"]')).not.toBeNull()
    expect(screen.queryByRole('region', { name: 'Added by you' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Records' })))
  })

  it('says it was removed when the records then can’t be read again, beside the page’s own problem', async () => {
    let reads = 0
    renderPortal(<RecordsPage />, gateway(() => {
      reads += 1
      return reads === 1 ? served([malaria, amoxicillin])
        : json({ code: 'EHR_UNAVAILABLE', detail: 'Records are unavailable.', retryable: false }, 503)
    }, (path, method) => method === 'POST'
      ? json({ entry: { id: MALARIA, status: 'withdrawn', withdrawnAt: '2026-11-01T10:00:00.000Z' } }) : undefined))
    const card = await ownCard()
    await press(within(card).getByRole('button', { name: 'Remove Malaria test, 20 Oct 2026' }))
    await press(within(card).getByRole('button', { name: 'Yes, remove' }))
    expect((await screen.findByText('Removed from your records')).closest('[role="status"]')).not.toBeNull()
    // The page's existing problem, with its Try again; no word of its own for these.
    expect(shownText(screen.getByRole('alert'))).toContain('Couldn’t load your records')
    expect(screen.queryByRole('region', { name: 'Added by you' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Records' })))
    expect(reads).toBe(2)
  })

  it('finds them with the page’s search and counts them, and keeps them while another tab is open', async () => {
    const { sent } = renderPortal(<RecordsPage />, gateway(() => served([malaria, amoxicillin])))
    const card = await ownCard()
    search('malaria lagos')
    expect(screen.getByText('1 record matches your search.')).toBeTruthy()
    expect(within(card).getByText('1 of 2 match')).toBeTruthy()
    expect(within(card).getAllByRole('heading', { level: 3 }).map(item => item.textContent)).toEqual(['Malaria test'])
    // By a file's name, and by the day's words.
    search('prescription.png')
    expect(within(card).getAllByRole('heading', { level: 3 }).map(item => item.textContent)).toEqual(['Amoxicillin 500 mg'])
    search('August 2026')
    expect(within(card).getAllByRole('heading', { level: 3 }).map(item => item.textContent)).toEqual(['Amoxicillin 500 mg'])
    search('typhoid')
    expect(screen.queryByRole('region', { name: 'Added by you' })).toBeNull()
    expect(screen.getByText('Nothing matches')).toBeTruthy()
    search('')

    fireEvent.click(tab('Visits'))
    expect(screen.queryByRole('region', { name: 'Added by you' })).toBeNull()
    fireEvent.click(tab('All'))
    expect(await ownCard()).toBeTruthy()
    await settle()
    expect(requests(sent)).toEqual([`GET ${RECORDS_PATH}`])
  })

  it('shows them, not “No records yet”, to a patient with no records from a provider', async () => {
    renderPortal(<RecordsPage />, gateway(() => served([amoxicillin], NO_RECORDS)))
    const card = await ownCard()
    expect(within(card).getByText('Amoxicillin 500 mg')).toBeTruthy()
    expect(screen.queryByText('No records yet')).toBeNull()
  })
})

describe('after "Add a record" saves one', () => {
  /** Opens the drawer, names the record and saves it, with no photo. */
  async function addRecord(title: string) {
    await press(screen.getByRole('button', { name: 'Add a record' }))
    fireEvent.change(await screen.findByLabelText('Name it'), { target: { value: title } })
    await press(screen.getByRole('button', { name: 'Save record' }))
  }
  /** Saves the entry the drawer sends as the newest of `items`. */
  const saving = (items: unknown[]) => (path: string, method: string, body: unknown) => {
    if (path !== ENTRIES || method !== 'POST') return undefined
    const entry = body as { kind: string; title: string; facilityName: string | null; occurredOn: string; notes: string | null }
    items.unshift({ ...entry, id: ADDED, source: 'patient', createdAt: '2026-11-01T10:00:00.000Z', documents: [] })
    return json({ entry: { id: ADDED } }, 201)
  }

  it('reads the records again and shows it', async () => {
    const items: unknown[] = []
    const { sent } = renderPortal(<RecordsPage />, gateway(() => served(items), saving(items)))
    await screen.findByText('Ambulatory')
    expect(patientEntriesServed()).toBe(true)
    // Served, with nothing added yet: nothing more is shown.
    expect(screen.queryByRole('region', { name: 'Added by you' })).toBeNull()

    await addRecord('Typhoid test')
    const card = await ownCard()
    expect(within(card).getByRole('heading', { level: 3, name: 'Typhoid test' })).toBeTruthy()
    expect(within(card).getByText(/^Visit · /)).toBeTruthy()
    const order = requests(sent).filter(request => request.includes(ENTRIES) || request.includes(RECORDS_PATH))
    expect(order).toEqual([`GET ${RECORDS_PATH}`, `POST ${ENTRIES}`, `GET ${RECORDS_PATH}`])
  })

  it('shows it where the records said not served before the Save was answered as saved', async () => {
    const items: unknown[] = []
    let isServed = false
    const { sent } = renderPortal(<RecordsPage />, gateway(() => isServed ? served(items) : RECORDS, (path, method, body) => {
      const answer = saving(items)(path, method, body)
      if (answer) isServed = true
      return answer
    }))
    await screen.findByText('Ambulatory')
    expect(patientEntriesServed()).toBe(false)
    await addRecord('Typhoid test')
    const card = await ownCard()
    expect(within(card).getByText('Typhoid test')).toBeTruthy()
    expect(patientEntriesServed()).toBe(true)
    expect(requests(sent).filter(request => request.includes(ENTRIES) || request.includes(RECORDS_PATH)))
      .toEqual([`GET ${RECORDS_PATH}`, `POST ${ENTRIES}`, `GET ${RECORDS_PATH}`])
  })

  it('says nothing of the list while that Save’s photos go up, then shows it with them', async () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:https://portal.test/preview')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const items: unknown[] = []
    let isServed = false
    let release: (response: Response) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(async () => new Promise<Response>(resolve => { release = resolve })))
    const intents = `${ENTRIES}/${ADDED}/documents/upload-intents`
    const { sent } = renderPortal(<RecordsPage />, gateway(() => isServed ? served(items) : RECORDS, (path, method, body) => {
      if (path === intents && method === 'POST') return json({ document: { id: 'doc-new', status: 'initiated', scanStatus: 'pending' },
        upload: { method: 'PUT', url: 'https://storage.example.test/bucket/clinical/objects/doc-new?X-Amz-Signature=fictional',
          requiredHeaders: { 'content-type': 'image/jpeg' }, expiresInSeconds: 300 } }, 201)
      if (path === `${ENTRIES}/${ADDED}/documents/doc-new/complete` && method === 'POST') {
        (items[0] as { documents: unknown[] }).documents.push({ id: 'doc-new', fileName: 'typhoid-slip.jpg', mediaType: 'image/jpeg',
          sizeBytes: 12, status: 'uploaded', scanStatus: 'pending', createdAt: '2026-11-01T10:00:05.000Z' })
        return json({ document: { id: 'doc-new', status: 'uploaded', scanStatus: 'pending' } })
      }
      const answer = saving(items)(path, method, body)
      if (answer) isServed = true
      return answer
    }))
    await screen.findByText('Ambulatory')
    expect(patientEntriesServed()).toBe(false)
    await press(screen.getByRole('button', { name: 'Add a record' }))
    fireEvent.change(await screen.findByLabelText('Name it'), { target: { value: 'Typhoid test' } })
    const camera = screen.getByRole('dialog').querySelector<HTMLInputElement>('input[type=file][capture]')!
    await act(async () => { fireEvent.change(camera, { target: { files: [new File(['fictional'], 'typhoid-slip.jpg', { type: 'image/jpeg' })] } }) })
    await press(screen.getByRole('button', { name: 'Save record' }))

    // Saved, so served; its photo is on its way. The page behind is unchanged until its records are read again.
    await waitFor(() => expect(patientEntriesServed()).toBe(true))
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByText(/Uploading…/)).toBeTruthy())
    expect(screen.queryByRole('region', { name: 'Added by you' })).toBeNull()
    expect(screen.queryAllByRole('alert')).toEqual([])
    expect(requests(sent).filter(request => request.includes(RECORDS_PATH))).toEqual([`GET ${RECORDS_PATH}`])

    await act(async () => { release(new Response(null, { status: 200 })) })
    const card = await ownCard()
    expect(within(card).getByText('Typhoid test')).toBeTruthy()
    expect(within(card).getByText('typhoid-slip.jpg')).toBeTruthy()
    expect(screen.queryAllByRole('alert')).toEqual([])
    // The records read again once, after the photo is up; never a read of the entries alone.
    expect(requests(sent).filter(request => request.includes(RECORDS_PATH))).toEqual([`GET ${RECORDS_PATH}`, `GET ${RECORDS_PATH}`])
    expect(requests(sent)).not.toContain(`GET ${ENTRIES}`)
  })
})
