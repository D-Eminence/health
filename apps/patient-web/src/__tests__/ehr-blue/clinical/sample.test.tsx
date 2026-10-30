import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFIRM_BODY } from '../../../ehr-blue/clinical/parts/Detail'
import { SAMPLE_NOTICE } from '../../../ehr-blue/clinical/parts/SampleBanner'
import { Workspace } from '../../../ehr-blue/clinical/parts/Workspace'
import { SAMPLE_DEFINITIONS, SAMPLE_WORKSPACE_IDS } from '../../../ehr-blue/clinical/sample/definitions'
import { FILE_TOO_LARGE } from '../../../ehr-blue/clinical/sample/SampleDetail'
import { IDS } from '../../../ehr-blue/clinical/sample/seed'
import { createSampleRecord, sampleState } from '../../../ehr-blue/clinical/sample/store'
import { SampleCreate, SampleDetail, SampleList, SampleWorkspace, resetSampleStore, sampleStatus } from '../../../ehr-blue/clinical/sample/SampleWorkspace'
import { BASE, labelled, renderPage } from './harness'

/**
 * The sample engine: 14 sample-only workspaces (and the emergency board) drawn from one definition each, with
 * fictional records in memory only. Nothing here may reach today's API: the staff/api mock records whether anything
 * even imports it, and its staffApi throws when touched.
 */

const touched = vi.hoisted(() => ({ api: false }))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn(() => true) }))

vi.mock('../../../staff/api', () => {
  touched.api = true
  return {
    staffApi: new Proxy({}, { get: (_target, name) => { if (name === 'then') return undefined; throw new Error(`staffApi.${String(name)} was called by a sample page`) } }),
    isAllowedPatientLookup: () => false,
  }
})
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})

const network = vi.fn()

beforeEach(() => {
  resetSampleStore()
  vi.stubGlobal('fetch', network)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function open(id: string, rest = '') {
  return renderPage(<SampleWorkspace id={id} />, id, rest)
}

function field(label: string, scope: HTMLElement = document.body) {
  return within(scope).getByLabelText(labelled(label)) as HTMLInputElement
}

function heading() {
  return screen.getByRole('heading', { level: 1 }).textContent
}

function actionsCard() {
  return screen.getByRole('heading', { name: 'Available actions' }).closest('section') as HTMLElement
}

function Where() {
  return <p data-testid="elsewhere">{useLocation().pathname}</p>
}

/** Several sample workspaces under one router, as the frame mounts them. */
function openMany(entry: string, ids: readonly string[]) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        {ids.map(id => <Route key={id} path={`${BASE}/${id}/*`} element={<SampleWorkspace id={id} />} />)}
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('sample engine', () => {
  it('is sample, and nothing reaches today’s API or the network', () => {
    expect(sampleStatus).toBe('sample')
    open('appointments')
    fireEvent.click(screen.getByRole('button', { name: 'Quick view Review of results' }))
    expect(touched.api).toBe(false)
    expect(network).not.toHaveBeenCalled()
  })

  it('shows the sample notice exactly once on every sample workspace, above the sidebar label', () => {
    for (const id of SAMPLE_WORKSPACE_IDS) {
      const view = open(id)
      expect(screen.getAllByText(SAMPLE_NOTICE)).toHaveLength(1)
      expect(document.querySelector('.hid-ehr-clinical-sample-banner[data-ehr-sample]')?.textContent).toBe(SAMPLE_NOTICE)
      expect(heading()).toBe(SAMPLE_DEFINITIONS[id]!.title)
      expect(screen.getByRole('button', { name: 'Create record' })).toBeTruthy()
      view.unmount()
    }
  })

  it('lists the design’s fictional rows in five columns', () => {
    open('appointments')
    const table = screen.getByRole('table', { name: 'Appointments' })
    const headers = within(table).getAllByRole('columnheader').map(cell => cell.textContent)
    expect(headers.slice(0, 4)).toEqual(['Record', 'Patient / context', 'Status', 'Updated'])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map(row => within(row).getByRole('link', { name: /^(?!Open)/ }).textContent)).toEqual([
      'Review of results', 'Medication review', 'Patient requested another day', 'Antenatal review',
    ])
    expect(rows[0]!.textContent).toContain('0b048a1b')
    expect(rows[0]!.textContent).toContain('Taylor Fiction')
    expect(rows[0]!.textContent).toContain('checked-in')
    expect(within(rows[0]!).getByRole('link', { name: 'Open Review of results' }).getAttribute('href')).toBe(`${BASE}/appointments/${IDS.apptTaylor}`)
  })

  it('lists ICU admissions under Inpatient / Wards too, and a bed’s own name as its context', () => {
    const view = open('inpatient')
    expect(within(screen.getByRole('table')).getByRole('link', { name: 'Close monitoring (fictional)' })).toBeTruthy()
    view.unmount()
    open('wards')
    const cells = within(within(screen.getByRole('table')).getAllByRole('row')[1]!).getAllByRole('cell')
    expect(cells[0]!.textContent).toBe('Bed 17fe7785d')
    expect(cells[1]!.textContent).toBe('Bed 1')
  })

  it('searches saved values and patient names; Clear search restores the list and returns focus', () => {
    open('appointments')
    const search = screen.getByRole('searchbox', { name: 'Search Appointments' }) as HTMLInputElement
    expect(search.placeholder).toBe('Search saved records…')
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()

    fireEvent.change(search, { target: { value: 'jordan' } })
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2)
    fireEvent.change(search, { target: { value: 'MRN-000004' } })
    expect(within(screen.getByRole('table')).getByRole('link', { name: 'Patient requested another day' })).toBeTruthy()

    fireEvent.change(search, { target: { value: 'nothing like this' } })
    expect(screen.getByText('No matching records')).toBeTruthy()
    expect(screen.getByText('Change your search.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(search.value).toBe('')
    expect(document.activeElement).toBe(search)
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(5)
  })

  it('opens the record quick view, which Escape closes, and Open full record goes to the record', async () => {
    open('nursing-tasks')
    fireEvent.click(screen.getByRole('button', { name: 'Quick view 4-hourly observations' }))
    const drawer = screen.getByRole('dialog', { name: 'Record quick view' })
    expect(within(drawer).getByRole('heading', { name: '4-hourly observations' })).toBeTruthy()
    expect(drawer.textContent).toContain('Assigned To')
    expect(drawer.textContent).toContain('Observation (fictional)')
    fireEvent.keyDown(drawer, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Record quick view' })).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Quick view Wound dressing check' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Record quick view' })).getByRole('button', { name: 'Open full record' }))
    await waitFor(() => expect(heading()).toBe('Wound dressing check'))
  })

  it('pages over 50 records', () => {
    for (let index = 0; index < 51; index += 1) createSampleRecord('ward-config', undefined, { name: `Fictional ward ${index + 1}` })
    open('ward-config')
    const pager = screen.getByRole('navigation', { name: 'Record pages' })
    expect(pager.textContent).toContain('Page 1 of 2')
    expect((within(pager).getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(51)
    fireEvent.click(within(pager).getByRole('button', { name: 'Next page' }))
    expect(screen.getByRole('navigation', { name: 'Record pages' }).textContent).toContain('Page 2 of 2')
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4)
  })

  it('creates a patient record: the fields appear once a patient is chosen, required ones are checked', async () => {
    open('appointments')
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    expect(heading()).toBe('New appointments')
    const patient = field('Patient') as unknown as HTMLSelectElement
    expect(patient.tagName).toBe('SELECT')
    expect(patient.options[0]!.textContent).toBe('Select registered patient')
    expect(Array.from(patient.options).map(option => option.textContent)).toContain('Jordan Sample · LOCAL-902ae015')
    expect(screen.queryByRole('button', { name: 'Save record' })).toBeNull()

    fireEvent.change(patient, { target: { value: sampleState().patients[2]!.id } })
    const save = screen.getByRole('button', { name: 'Save record' })
    expect(save.getAttribute('type')).toBe('submit')
    fireEvent.submit(save.closest('form')!)
    expect(screen.getAllByText('Complete this field.')).toHaveLength(4)
    expect(document.activeElement).toBe(field('Appointment time'))

    fireEvent.change(field('Appointment time'), { target: { value: '2026-11-12T09:00' } })
    fireEvent.change(field('Clinician'), { target: { value: '28c11bae-61a6-4843-9291-664517bfa63e' } })
    fireEvent.change(field('Department'), { target: { value: 'Cardiology' } })
    fireEvent.change(field('Reason'), { target: { value: 'Fictional heart check' } })
    fireEvent.submit(save.closest('form')!)

    await waitFor(() => expect(heading()).toBe('Fictional heart check'))
    expect(screen.getByText('Jordan Sample · LOCAL-902ae015')).toBeTruthy()
    expect(within(screen.getByRole('heading', { name: 'Saved record' }).closest('section')!).getByText('Cardiology')).toBeTruthy()
    expect(screen.getByText('booked')).toBeTruthy()
  })

  it('creates a record with no patient straight away, and Back to list returns', async () => {
    open('wards', '/new')
    expect(heading()).toBe('New wards & beds')
    expect(screen.queryByLabelText(labelled('Patient'))).toBeNull()
    const ward = field('Ward') as unknown as HTMLSelectElement
    expect(Array.from(ward.options).map(option => option.textContent)).toEqual(['Select…', 'Example ward · active · be31b8', 'Female Medical Ward · active · a7fc95'])
    fireEvent.change(field('Bed name'), { target: { value: 'Bed 3' } })
    fireEvent.change(ward, { target: { value: IDS.wardFemale } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save record' }).closest('form')!)
    await waitFor(() => expect(heading()).toBe('Bed 3'))
    expect(screen.getByText('available')).toBeTruthy()
    expect(screen.getByText('Female Medical Ward')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Connected hospital history' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    await waitFor(() => expect(heading()).toBe('Wards & Beds'))
    expect(within(screen.getByRole('table')).getByRole('link', { name: 'Bed 3' })).toBeTruthy()
  })

  it('shows the design’s refusals when a booking clashes or an order’s encounter is unsigned', async () => {
    const view = open('appointments', '/new')
    fireEvent.change(field('Patient'), { target: { value: sampleState().patients[1]!.id } })
    fireEvent.change(field('Appointment time'), { target: { value: '2026-11-04T10:15' } })
    fireEvent.change(field('Clinician'), { target: { value: '28c11bae-61a6-4843-9291-664517bfa63e' } })
    fireEvent.change(field('Department'), { target: { value: 'General Outpatient' } })
    fireEvent.change(field('Reason'), { target: { value: 'Clash' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save record' }).closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toBe('Clinician already has an overlapping 30-minute appointment.')
    expect(heading()).toBe('New appointments')
    view.unmount()

    open('radiology', '/new')
    fireEvent.change(field('Patient'), { target: { value: sampleState().patients[3]!.id } })
    const encounter = field('Encounter') as unknown as HTMLSelectElement
    expect(Array.from(encounter.options).map(option => option.textContent)).toEqual(['Select…', '4fe5735c · draft · 4fe573'])
    expect((field('Urgency') as unknown as HTMLSelectElement).value).toBe('Routine')
    fireEvent.change(encounter, { target: { value: encounter.options[1]!.value } })
    fireEvent.change(field('Modality'), { target: { value: 'Fictional scan' } })
    fireEvent.change(field('Indication'), { target: { value: 'Fictional' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save record' }).closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toBe('Sign the encounter before issuing clinical orders.')
  })

  it('runs a one-step action, keeps the earlier version and links the new visit', async () => {
    open('appointments', `/${IDS.apptJordan}`)
    expect(heading()).toBe('Medication review')
    const card = actionsCard()
    expect(within(card).getAllByRole('button').map(button => button.textContent)).toEqual(['Reschedule', 'Check in', 'Cancel appointment', 'Mark no-show'])
    fireEvent.click(within(card).getByRole('button', { name: 'Check in' }))
    expect(within(card).getByRole('button', { name: 'Check in', expanded: true })).toBeTruthy()
    const submit = within(card).getAllByRole('button', { name: 'Check in' }).find(button => button.getAttribute('type') === 'submit')!
    fireEvent.submit(submit.closest('form')!)

    await waitFor(() => expect(screen.getByText('checked-in')).toBeTruthy())
    expect(within(actionsCard()).getByText('No further actions for your permission and this record state.')).toBeTruthy()
    expect(document.activeElement?.classList.contains('hid-ehr-clinical-sample-actions')).toBe(true)
    const versions = screen.getByRole('heading', { name: 'Preserved versions & amendments' }).closest('section')!
    expect(versions.textContent).toMatch(/\d{4}-\d{2}-\d{2}T[\d:.]+Z · booked · Check in/)
    const history = screen.getByRole('heading', { name: 'Connected hospital history' }).closest('section')!
    expect(within(history).getByText('Only records available to your current permissions are listed.')).toBeTruthy()
    expect(within(history).getByRole('link', { name: 'Patient visits · Medication review' })).toBeTruthy()
    expect(within(history).getByRole('link', { name: 'Referral Network · Specialist review' }).getAttribute('href')).toBe(`${BASE}/referrals/${IDS.referral}`)
  })

  it('asks before cancelling; Cancel keeps the typed reason, confirming changes and renames the record', async () => {
    open('appointments', `/${IDS.apptRiley}`)
    fireEvent.click(within(actionsCard()).getByRole('button', { name: 'Cancel appointment' }))
    const form = () => within(actionsCard()).getAllByRole('button', { name: 'Cancel appointment' }).find(button => button.getAttribute('type') === 'submit')!.closest('form')!
    fireEvent.submit(form())
    expect(within(actionsCard()).getByText('Complete this field.')).toBeTruthy()
    fireEvent.change(field('Reason', actionsCard()), { target: { value: 'Fictional clash' } })
    fireEvent.submit(form())

    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel appointment?' })
    expect(dialog.textContent).toContain(CONFIRM_BODY)
    expect(within(dialog).queryByLabelText(/Type .* to confirm/)).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(field('Reason', actionsCard()).value).toBe('Fictional clash')
    expect(screen.getByText('booked')).toBeTruthy()

    fireEvent.submit(form())
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Cancel appointment?' })).getByRole('button', { name: 'Cancel appointment' }))
    await waitFor(() => expect(heading()).toBe('Fictional clash'))
    expect(screen.getByText('cancelled')).toBeTruthy()
    expect(screen.getByText(/· booked · Fictional clash$/)).toBeTruthy()
  })

  it('refuses an occupied bed, then admits to a bed made free', async () => {
    const view = open('inpatient', `/${IDS.admitSam}`)
    fireEvent.click(within(actionsCard()).getByRole('button', { name: 'Admit and allocate bed' }))
    const bed = field('Available bed', actionsCard()) as unknown as HTMLSelectElement
    expect(Array.from(bed.options).map(option => option.textContent)).toEqual(['Select…', 'Bed 1 · occupied · 7fe778', 'Bed 2 · occupied · 359163'])
    fireEvent.change(bed, { target: { value: IDS.bed1 } })
    fireEvent.submit(bed.closest('form')!)
    expect((await within(actionsCard()).findByRole('alert')).textContent).toBe('Bed is occupied, awaiting cleaning or in maintenance.')
    view.unmount()

    const created = createSampleRecord('wards', undefined, { name: 'Bed 9', ward: IDS.wardExample })
    if (!('id' in created)) throw new Error(created.error)
    open('inpatient', `/${IDS.admitSam}`)
    fireEvent.click(within(actionsCard()).getByRole('button', { name: 'Admit and allocate bed' }))
    fireEvent.change(field('Available bed', actionsCard()), { target: { value: created.id } })
    fireEvent.submit(field('Available bed', actionsCard()).closest('form')!)
    await waitFor(() => expect(screen.getByText('admitted')).toBeTruthy())
    expect(within(screen.getByRole('heading', { name: 'Saved record' }).closest('section')!).getByText('Bed 9')).toBeTruthy()
    expect(sampleState().records.find(record => record.id === created.id)!.status).toBe('occupied')
  })

  it('hands off to Nursing tasks with the patient and admission chosen, and to live Nursing observations', async () => {
    const view = openMany(`${BASE}/inpatient/${IDS.admitTaylor}`, ['inpatient', 'nursing-tasks'])
    expect(screen.getByRole('heading', { name: 'Continue care' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create nursing tasks' }))
    await waitFor(() => expect(heading()).toBe('New nursing tasks'))
    expect((field('Patient') as unknown as HTMLSelectElement).value).toBe(sampleState().patients[1]!.id)
    expect((field('Admission') as unknown as HTMLSelectElement).value).toBe(IDS.admitTaylor)
    expect(sampleState().handoff).toBeNull()
    view.unmount()

    openMany(`${BASE}/inpatient/${IDS.admitTaylor}`, ['inpatient'])
    fireEvent.click(screen.getByRole('button', { name: 'Create nursing observations' }))
    expect(screen.getByTestId('elsewhere').textContent).toBe(`${BASE}/nursing/new`)
  })

  it('lists the same patient’s records in other sample workspaces as connected history', () => {
    open('inpatient', `/${IDS.admitTaylor}`)
    const history = screen.getByRole('heading', { name: 'Connected hospital history' }).closest('section')!
    expect(within(history).getAllByRole('link').map(link => link.textContent)).toEqual([
      'Appointments · Review of results', 'Patient visits · b57e94c9', 'Patient visits · Review of results', 'Radiology · Abdominal ultrasound',
      'Dental · 503fafd8', 'Nursing tasks · 4-hourly observations', 'Nursing tasks · Wound dressing check',
    ])
    expect(within(history).getByRole('link', { name: 'Appointments · Review of results' }).getAttribute('href')).toBe(`${BASE}/appointments/${IDS.apptTaylor}`)
  })

  it('shows a visit’s history only from records it started, and the journey footnote under the list', () => {
    const view = open('journey')
    expect(screen.getByText(/^Journey stages are derived from visits/)).toBeTruthy()
    view.unmount()
    open('journey', `/${IDS.visitTaylor}`)
    const history = screen.getByRole('heading', { name: 'Connected hospital history' }).closest('section')!
    expect(within(history).queryAllByRole('link')).toHaveLength(0)
    expect(within(actionsCard()).getByRole('button', { name: 'Create triage & vitals' })).toBeTruthy()
    expect(within(actionsCard()).getByRole('button', { name: 'Create consultation' })).toBeTruthy()
  })

  it('keeps every earlier version, each with its author and values', () => {
    open('radiology', `/${IDS.xray}`)
    const versions = screen.getByRole('heading', { name: 'Preserved versions & amendments' }).closest('section')!
    const summaries = Array.from(versions.querySelectorAll('summary')).map(summary => summary.textContent)
    expect(summaries).toEqual([
      '2026-10-26T11:41:15.455Z · ordered · Schedule examination',
      '2026-10-26T11:41:15.471Z · scheduled · Record examination',
      '2026-10-26T11:41:15.489Z · examined · Attach local study',
      '2026-10-26T11:41:15.505Z · study-attached · Draft report',
      '2026-10-26T11:41:15.521Z · draft-report · Review report',
      '2026-10-26T11:41:15.539Z · reviewed · Publish report',
    ])
    expect(versions.textContent).toContain('Author: Demo Doctor (fictional)')
    const saved = screen.getByRole('heading', { name: 'Saved record' }).closest('section')!
    expect(saved.textContent).toContain('Published At')
    expect(within(saved).getByText('5f459730')).toBeTruthy()
  })

  it('attaches a study by choosing a file it never reads, refusing a large one', async () => {
    open('radiology', `/${IDS.ultrasound}`)
    fireEvent.click(within(actionsCard()).getByRole('button', { name: 'Record examination' }))
    fireEvent.change(field('Examination details', actionsCard()), { target: { value: 'Fictional exam' } })
    fireEvent.submit(field('Examination details', actionsCard()).closest('form')!)
    await waitFor(() => expect(screen.getByText('examined')).toBeTruthy())

    fireEvent.click(within(actionsCard()).getByRole('button', { name: 'Attach local study' }))
    const input = field('Image or PDF (max 2 MB)', actionsCard())
    expect(input.type).toBe('file')
    fireEvent.submit(input.closest('form')!)
    expect(within(actionsCard()).getByText('Complete this field.')).toBeTruthy()
    expect(document.activeElement).toBe(input)
    await act(async () => {})

    const large = new File(['x'], 'large.pdf', { type: 'application/pdf' })
    Object.defineProperty(large, 'size', { value: 3 * 1024 * 1024 })
    fireEvent.change(input, { target: { files: [large] } })
    expect(within(actionsCard()).getByText(FILE_TOO_LARGE)).toBeTruthy()

    fireEvent.change(input, { target: { files: [new File(['%PDF'], 'study.pdf', { type: 'application/pdf' })] } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => expect(screen.getByText('study-attached')).toBeTruthy())
    expect(screen.getByText('Local PDF study chosen (sample: not uploaded)')).toBeTruthy()
  })

  it('records a delivery with a provisional newborn identity', async () => {
    open('maternity', `/${IDS.maternity}`)
    fireEvent.click(within(actionsCard()).getByRole('button', { name: 'Record delivery' }))
    fireEvent.change(field('Delivery record', actionsCard()), { target: { value: 'Fictional delivery' } })
    fireEvent.change(field('Newborn name (creates provisional identity)', actionsCard()), { target: { value: 'Baby Demo' } })
    fireEvent.submit(field('Delivery record', actionsCard()).closest('form')!)
    await waitFor(() => expect(screen.getByText('delivered')).toBeTruthy())
    const saved = screen.getByRole('heading', { name: 'Saved record' }).closest('section')!
    expect(saved.textContent).toContain('Newborn Id')
    expect(sampleState().patients.find(patient => patient.name === 'Baby Demo')?.provisional).toBe(true)
  })

  it('shows the design’s missing-record page', () => {
    open('surgery', '/not-a-record')
    expect(heading()).toBe('Record not found')
    expect(screen.getByText('The record is missing or outside your authorized hospital / branch.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to list' })).toBeTruthy()
  })

  it('starts again from the seed on reset (as on reload)', () => {
    createSampleRecord('ward-config', undefined, { name: 'Temporary ward' })
    expect(sampleState().records.some(record => record.data.name === 'Temporary ward')).toBe(true)
    act(() => resetSampleStore())
    expect(sampleState().records.some(record => record.data.name === 'Temporary ward')).toBe(false)
    open('ward-config')
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3)
  })

  it('uses real controls only, so Tab follows the page and Enter submits', () => {
    open('surgery', `/${IDS.surgery}`)
    const controls = Array.from(document.querySelectorAll<HTMLElement>('a, button, input, select, textarea, summary'))
    expect(controls.length).toBeGreaterThan(5)
    for (const control of controls) expect(control.getAttribute('tabindex')).not.toBe('-1')
    expect(document.querySelectorAll('[onclick], [role="button"]:not(button)')).toHaveLength(0)
    fireEvent.click(within(actionsCard()).getByRole('button', { name: 'Complete demo checklist' }))
    const form = field('Checklist record (not clinical guidance)', actionsCard()).closest('form')!
    expect(form.querySelector('button[type="submit"]')?.textContent).toBe('Complete demo checklist')
  })
})

describe('the emergency board inside another workspace', () => {
  function board(rest = '') {
    return renderPage(
      <Workspace path="emergency">
        <Routes>
          <Route index element={<SampleList id="emergency" />} />
          <Route path="new" element={<SampleCreate id="emergency" />} />
          <Route path=":recordId" element={<SampleDetail id="emergency" />} />
        </Routes>
      </Workspace>,
      'emergency',
      rest,
    )
  }

  it('shows its own sample notice once, with the board’s list', () => {
    board()
    expect(screen.getAllByText(SAMPLE_NOTICE)).toHaveLength(1)
    expect(within(screen.getByRole('table', { name: 'Emergency' })).getByRole('link', { name: 'cfa650e2' })).toBeTruthy()
  })

  it('records an arrival, its assessment and disposition', async () => {
    board('/new')
    expect(screen.getAllByText(SAMPLE_NOTICE)).toHaveLength(1)
    expect(heading()).toBe('New emergency')
    fireEvent.change(field('Patient'), { target: { value: sampleState().patients[0]!.id } })
    expect(field('Triage priority').value).toBe('Routine')
    fireEvent.change(field('Presenting complaint'), { target: { value: 'Fictional fall' } })
    fireEvent.change(field('Assigned clinician'), { target: { value: 'Demo Doctor' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save record' }).closest('form')!)
    await waitFor(() => expect(screen.getByText('arrived')).toBeTruthy())
    expect(screen.getAllByText(SAMPLE_NOTICE)).toHaveLength(1)

    fireEvent.click(within(actionsCard()).getByRole('button', { name: 'Record assessment' }))
    fireEvent.change(field('Assessment', actionsCard()), { target: { value: 'Fictional assessment' } })
    fireEvent.submit(field('Assessment', actionsCard()).closest('form')!)
    await waitFor(() => expect(screen.getByText('assessed')).toBeTruthy())

    fireEvent.click(within(actionsCard()).getByRole('button', { name: 'Record disposition' }))
    fireEvent.change(field('Disposition', actionsCard()), { target: { value: 'Home' } })
    fireEvent.change(field('Follow-up', actionsCard()), { target: { value: 'Clinic in a week' } })
    fireEvent.submit(field('Disposition', actionsCard()).closest('form')!)
    await waitFor(() => expect(screen.getByText('completed')).toBeTruthy())
    expect(touched.api).toBe(false)
  })
})
