import { fireEvent, render, screen, within } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Workspace } from '../../../ehr-blue/clinical/parts/Workspace'
import { SAMPLE_DEFINITIONS, SAMPLE_WORKSPACE_IDS } from '../../../ehr-blue/clinical/sample/definitions'
import { IDS } from '../../../ehr-blue/clinical/sample/seed'
import { listedRecords, sampleState } from '../../../ehr-blue/clinical/sample/store'
import { SampleCreate, SampleDetail, SampleList, SampleWorkspace, resetSampleStore } from '../../../ehr-blue/clinical/sample/SampleWorkspace'
import { BASE, FACILITY_ID, activePatient } from './harness'

/**
 * Review item 8: a sample record's "Continue care" opened a live create form (triage/new, consult/new, nursing/new),
 * preselected with the real patient open in the chart. At a real facility (FACILITY_ID), with Patient One
 * (HID-ZDEMAAA2) open in the chart, a sample hand-off now only ever opens another sample workspace, and no sample
 * control leads into a live workspace's create form.
 */

const staff = vi.hoisted(() => ({
  permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn(() => true), facilityId: '' as string,
}))

vi.mock('../../../staff/api', () => ({
  staffApi: new Proxy({}, { get: (_target, name) => { if (name === 'then') return undefined; throw new Error(`staffApi.${String(name)} was called by a sample page`) } }),
  isAllowedPatientLookup: () => false,
}))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})

/** The live workspaces' ids and address segments (consult is /provider/clinical, consent /provider/requests). */
const LIVE_WORKSPACES = ['patients', 'consult', 'clinical', 'triage', 'nursing', 'emergency', 'consent', 'requests']
const LIVE_CREATE = new RegExp(`^${BASE}/(clinical|triage|nursing|emergency|requests|patients)/new(?:[/?#]|$)`)

beforeEach(() => {
  resetSampleStore()
  staff.facilityId = FACILITY_ID
  staff.activePatient = activePatient()
})

/**
 * Records every address the router moves to after the page it opened on, so a click that leaves the page is still
 * seen (the emergency board's own create page is /provider/emergency/new: opening it is not a control leading there).
 */
function Visited({ start, into }: { start: string; into: string[] }) {
  const { pathname, key } = useLocation()
  useEffect(() => {
    if (key !== 'default' || pathname !== start) into.push(pathname)
  }, [into, key, pathname, start])
  return null
}

function Elsewhere() {
  return <p data-testid="elsewhere">{useLocation().pathname}</p>
}

/** One sample workspace (or the emergency board, inside the Emergency workspace) at `${BASE}/${id}${rest}`. */
function open(id: string, rest: string, visited: string[] = []) {
  const page = id === 'emergency' ? (
    <Workspace path="emergency">
      <Routes>
        <Route index element={<SampleList id="emergency" />} />
        <Route path="new" element={<SampleCreate id="emergency" />} />
        <Route path=":recordId" element={<SampleDetail id="emergency" />} />
      </Routes>
    </Workspace>
  ) : <SampleWorkspace id={id} />
  const start = `${BASE}/${id}${rest}`
  return render(
    <MemoryRouter initialEntries={[start]}>
      <Visited start={start} into={visited} />
      <Routes>
        <Route path={`${BASE}/${id}/*`} element={page} />
        <Route path="*" element={<Elsewhere />} />
      </Routes>
    </MemoryRouter>,
  )
}

function continueCareButtons() {
  const subheading = screen.queryByRole('heading', { name: 'Continue care' })
  const row = subheading?.nextElementSibling as HTMLElement | null | undefined
  return row ? within(row).getAllByRole('button').map(button => button.textContent) : []
}

/** Buttons that may take the page elsewhere: not a form's submit, an action's toggle or a dialog's answer. */
function navigatingButtons() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .filter(button => button.type !== 'submit' && !button.hasAttribute('aria-expanded') && !button.closest('dialog, [role="dialog"], [role="alertdialog"]'))
}

describe('review item 8: a sample hand-off never opens a live create form', () => {
  it('item 8: every Continue care hand-off names a sample workspace, never a live one', () => {
    for (const definition of Object.values(SAMPLE_DEFINITIONS)) {
      for (const handoff of definition.continueCare ?? []) {
        expect((SAMPLE_WORKSPACE_IDS as readonly string[]).includes(handoff.workspace)).toBe(true)
        expect(LIVE_WORKSPACES).not.toContain(handoff.workspace)
      }
    }
  })

  it('item 8: journey’s Continue care offers no "Create triage & vitals" or "Create consultation"', () => {
    const visits = listedRecords(sampleState(), SAMPLE_DEFINITIONS.journey!)
    expect(visits.length).toBeGreaterThan(0)
    for (const visit of visits) {
      const view = open('journey', `/${visit.id}`)
      expect(screen.getByRole('heading', { name: 'Available actions' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Create triage & vitals' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Create consultation' })).toBeNull()
      expect(screen.queryByRole('heading', { name: 'Continue care' })).toBeNull()
      view.unmount()
    }
  })

  it.each([
    { id: 'inpatient', record: 'an admitted record', recordId: IDS.admitTaylor },
    { id: 'inpatient', record: 'a requested record', recordId: IDS.admitSam },
    { id: 'inpatient', record: 'the ICU record it lists', recordId: IDS.icuRiley },
    { id: 'icu', record: 'an admitted record', recordId: IDS.icuRiley },
  ])('item 8: $id ($record) offers no "Create nursing observations" but keeps "Create nursing tasks"', ({ id, recordId }) => {
    const visited: string[] = []
    open(id, `/${recordId}`, visited)
    expect(continueCareButtons()).toEqual(['Create nursing tasks'])
    expect(screen.queryByRole('button', { name: 'Create nursing observations' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Create nursing tasks' }))
    expect(screen.getByTestId('elsewhere').textContent).toBe(`${BASE}/nursing-tasks/new`)
    expect(sampleState().handoff).toMatchObject({ workspace: 'nursing-tasks', values: { admission: recordId } })
    expect(visited.filter(path => LIVE_CREATE.test(path))).toEqual([])
  })

  it('item 8: no sample page renders a link or button to /provider/(clinical|triage|nursing|emergency|requests|patients)/new', () => {
    const visited: string[] = []
    let pages = 0
    for (const id of [...SAMPLE_WORKSPACE_IDS, 'emergency']) {
      const records = listedRecords(sampleState(), SAMPLE_DEFINITIONS[id]!)
      for (const rest of ['', '/new', ...records.map(record => `/${record.id}`)]) {
        pages += 1
        let view = open(id, rest, visited)
        for (const link of Array.from(document.querySelectorAll('a[href]'))) expect(link.getAttribute('href')).not.toMatch(LIVE_CREATE)
        const count = navigatingButtons().length
        view.unmount()
        // Each button on a fresh page, since one that navigates leaves it.
        for (let index = 0; index < count; index += 1) {
          resetSampleStore()
          view = open(id, rest, visited)
          fireEvent.click(navigatingButtons()[index]!)
          view.unmount()
        }
      }
    }
    expect(pages).toBeGreaterThan(40)
    expect(visited).toContain(`${BASE}/nursing-tasks/new`)
    expect(visited.filter(path => LIVE_CREATE.test(path))).toEqual([])
  })
})
