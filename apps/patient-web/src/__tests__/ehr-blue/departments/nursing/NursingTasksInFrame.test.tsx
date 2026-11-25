import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { REAL_FACILITY, SESSION, facility, json, openStaffApp, problem, serve, sessionAt } from '../../frame/blueHarness'
import {
  ADMIN, ADMISSION, ADMISSION_HIDDEN, ADMISSIONS, DOCTOR, NEW_TASK, NURSE, ROUND, TASKS, WARD, WARDS, card, hiddenCard, many,
  noIdentityInAddresses, sentTo, task, taskStep, ward, wardsOf, withNursingPages,
} from './nursingFixtures'

/*
 * Nursing tasks and the medicine round (hid-system NUR-1 routes 5 and 8-10) inside the blue EHR's real frame: listed
 * for the roles the backend lets use them, Akos's sample replaced on its own address, each write with its contract body,
 * an Idempotency-Key and direct care, every time in Lagos, patients named under Q190 A, and "not switched on yet" while
 * the routes are not served. Every account, facility, patient and reference is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => withNursingPages())
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const nav = () => screen.getByRole('navigation', { name: 'Main navigation' })
const nurse = () => facility(REAL_FACILITY, 'Fictional Hospital', NURSE, ['nurse'])

describe('Nursing tasks in the frame', () => {
  it('replaces the sample on its address, lists the ward’s tasks with Lagos times and names under Q190 A', async () => {
    const member = nurse()
    const sent = serve({
      [SESSION]: [sessionAt(member, [member])],
      [WARDS]: [wardsOf()],
      [TASKS]: many(() => json({ items: [
        task(),
        task({ taskId: 'a0000000-0000-4000-8000-0000000000a2', admissionId: ADMISSION_HIDDEN, patient: hiddenCard(), bedName: 'Bed 7',
          name: 'Check the drip site', overdue: false, status: 'in_progress', assignedMembershipId: null, repeatEveryHours: null,
          dueAt: '2026-12-03T10:30:00.000Z', completionRecorded: true, completionRecord: null }),
      ] })),
    })
    await openStaffApp('/provider/nursing-tasks')
    expect(await screen.findByRole('heading', { level: 1, name: 'Nursing tasks' })).toBeDefined()
    expect(within(nav()).getByRole('link', { name: 'Nursing tasks' }).getAttribute('href')).toBe('/provider/nursing-tasks')
    expect(within(nav()).getByRole('link', { name: 'Medicine round' }).getAttribute('href')).toBe('/provider/medicine-round')
    expect(within(nav()).getByRole('link', { name: 'Shift handover' }).getAttribute('href')).toBe('/provider/handover')
    expect(within(nav()).queryByRole('link', { name: 'Ward patient' })).toBeNull()
    expect(screen.getByText('Do not show this list on a screen patients or visitors can see.')).toBeDefined()
    // No sample banner: this page is live on NUR-1, not fictional data.
    expect(screen.queryByText(/sample/i)).toBeNull()

    const first = await screen.findByRole('listitem', { name: 'Turn the patient' })
    // 08:00 UTC is 09:00 in Lagos, whatever the device's zone.
    expect(within(first).getByText('3 Dec 2026, 09:00')).toBeDefined()
    expect(within(first).getByText('Overdue')).toBeDefined()
    expect(within(first).getByText('Repeats every 2 hours')).toBeDefined()
    expect(within(first).getByText('You')).toBeDefined()
    expect(within(first).getByRole('link', { name: 'Ada Wardone' }).getAttribute('href')).toBe(`/provider/ward-patient/${ADMISSION}/tasks`)
    expect(within(first).getByText('Bed 4 · Female · 54 years · NIN Verified')).toBeDefined()
    expect(within(first).getByLabelText('Health ID ending WW12').textContent).toBe('•••• WW12')

    const second = screen.getByRole('listitem', { name: 'Check the drip site' })
    expect(within(second).getByRole('link', { name: 'B T' })).toBeDefined()
    expect(within(second).getByText('Name hidden')).toBeDefined()
    expect(within(second).getByText('Bed 7 · Female · 61 years · NIN Not Verified')).toBeDefined()
    expect(within(second).queryByLabelText(/Health ID ending/)).toBeNull()
    expect(within(second).getByText('Anyone on the ward')).toBeDefined()
    expect(within(second).getByText('Open the patient’s record to read it.')).toBeDefined()

    const read = sentTo(sent, TASKS)[0]!
    expect(read.headers.get('X-Purpose-Of-Use')).toBe('direct-care')
    expect(read.headers.get('X-Facility-ID')).toBe(REAL_FACILITY)
    const url = String(vi.mocked(fetch).mock.calls.find(([address]) => String(address).includes('/nursing-tasks'))![0])
    expect(new URL(url).searchParams.get('wardId')).toBe(WARD)
    expect(new URL(url).searchParams.get('status')).toBe('open')
    expect(document.body.textContent).not.toMatch(/in_progress|permission|nameHidden/i)
    noIdentityInAddresses()
  })

  it('starts, completes with a record and cancels with a reason, each with its version and an Idempotency-Key', async () => {
    const member = nurse()
    const started = task({ status: 'in_progress', rowVersion: 4 })
    const sent = serve({
      [SESSION]: [sessionAt(member, [member])],
      [WARDS]: [wardsOf()],
      [TASKS]: [() => json({ items: [task()] }), () => json({ items: [started] }), () => json({ items: [task({ status: 'completed' })] }),
        ...many(() => json({ items: [started] }))],
      [taskStep('start')]: [() => json({ task: started, replayed: false })],
      [taskStep('complete')]: [() => json({ task: task({ status: 'completed' }), nextTaskId: 'a0000000-0000-4000-8000-0000000000a9', replayed: false })],
    })
    await openStaffApp('/provider/nursing-tasks')
    const row = await screen.findByRole('listitem', { name: 'Turn the patient' })
    fireEvent.click(within(row).getByRole('button', { name: 'Start task' }))
    await waitFor(() => expect(sentTo(sent, taskStep('start'))).toHaveLength(1))
    const start = sentTo(sent, taskStep('start'))[0]!
    expect(start.body).toEqual({ expectedRowVersion: 3 })
    expect(start.headers.get('Idempotency-Key')).toMatch(/^[A-Za-z0-9_-]{16,128}$/)

    const inProgress = await screen.findByRole('button', { name: 'Complete task' })
    fireEvent.click(inProgress)
    fireEvent.change(screen.getByLabelText('Completion record (optional)'), { target: { value: 'Turned to the left side. Skin intact.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as done' }))
    expect(await screen.findByText('Task done. The next one is on the list.')).toBeDefined()
    expect(sentTo(sent, taskStep('complete'))[0]!.body).toEqual({ expectedRowVersion: 4, completionRecord: 'Turned to the left side. Skin intact.' })
  })

  it('asks for a reason of 8 characters to cancel, and says a task that moved on in plain words', async () => {
    const member = nurse()
    const sent = serve({
      [SESSION]: [sessionAt(member, [member])],
      [WARDS]: [wardsOf()],
      [TASKS]: many(() => json({ items: [task()] })),
      [taskStep('cancel')]: [() => problem(409, 'TASK_STATE_INVALID', 'Conflict')],
    })
    await openStaffApp('/provider/nursing-tasks')
    const row = await screen.findByRole('listitem', { name: 'Turn the patient' })
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel task' }))
    fireEvent.change(within(row).getByLabelText('Why is it cancelled?'), { target: { value: 'No' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel the task' }))
    expect(await within(row).findByText('Say why in at least 8 characters.')).toBeDefined()
    expect(sentTo(sent, taskStep('cancel'))).toHaveLength(0)
    fireEvent.change(within(row).getByLabelText('Why is it cancelled?'), { target: { value: 'Patient moved to theatre' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel the task' }))
    expect(await within(row).findByText('This task has moved on. Reload it.')).toBeDefined()
    expect(sentTo(sent, taskStep('cancel'))[0]!.body).toEqual({ expectedRowVersion: 3, reason: 'Patient moved to theatre' })
  })

  it('adds a task for a patient on the ward, due at a Lagos time sent as UTC', async () => {
    const member = nurse()
    const sent = serve({
      [SESSION]: [sessionAt(member, [member])],
      [WARDS]: many(() => json({ items: [ward()] })),
      [ADMISSIONS]: [() => json({ items: [card(), hiddenCard()], hasMore: false, limit: 500 })],
      [TASKS]: many(() => json({ items: [] })),
      [NEW_TASK]: [() => json({ task: task(), replayed: false }, 201)],
    })
    await openStaffApp('/provider/nursing-tasks')
    expect(await screen.findByText('No open tasks')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'New task' }))
    const form = await screen.findByRole('form', { name: 'New task' })
    await waitFor(() => expect(within(form).getAllByRole('option').map(option => option.textContent)).toContain('Bed 7 · B T'))
    fireEvent.click(within(form).getByRole('button', { name: 'Add task' }))
    expect(await within(form).findByText('Choose the patient.')).toBeDefined()
    fireEvent.change(within(form).getByLabelText('Patient'), { target: { value: ADMISSION } })
    fireEvent.change(within(form).getByLabelText('Task'), { target: { value: 'Check blood glucose' } })
    fireEvent.change(within(form).getByLabelText('Due (Lagos time)'), { target: { value: '2026-12-03T22:30' } })
    fireEvent.change(within(form).getByLabelText('Repeat every (hours, optional)'), { target: { value: '4' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add task' }))
    await waitFor(() => expect(sentTo(sent, NEW_TASK)).toHaveLength(1))
    expect(sentTo(sent, NEW_TASK)[0]!.body).toEqual({ name: 'Check blood glucose', dueAt: '2026-12-03T21:30:00.000Z', repeatEveryHours: 4 })
    const url = String(vi.mocked(fetch).mock.calls.find(([address]) => String(address).includes('/ehr/admissions?'))![0])
    expect(new URL(url).searchParams.get('wardId')).toBe(WARD)
    noIdentityInAddresses()
  })

  it('says it is not switched on yet while NURSING_ENABLED is off (503), and stops listing the nursing pages', async () => {
    const member = nurse()
    serve({
      [SESSION]: [sessionAt(member, [member])],
      [WARDS]: [wardsOf()],
      [TASKS]: many(() => problem(503, 'NURSING_NOT_AVAILABLE', 'Service unavailable')),
    })
    await openStaffApp('/provider/nursing-tasks')
    expect(await screen.findByText('The medicine round and nursing tasks are not switched on yet.')).toBeDefined()
    await waitFor(() => expect(within(nav()).queryByRole('link', { name: 'Nursing tasks' })).toBeNull())
    expect(within(nav()).queryByRole('link', { name: 'Medicine round' })).toBeNull()
    expect(within(nav()).queryByRole('link', { name: 'Shift handover' })).toBeNull()
  })

  it('says an ehr-api before ADT-1 (404 on the wards) is not switched on yet', async () => {
    const member = nurse()
    serve({ [SESSION]: [sessionAt(member, [member])], [WARDS]: many(() => problem(404, 'NOT_FOUND', 'Cannot GET')) })
    await openStaffApp('/provider/nursing-tasks')
    expect(await screen.findByText('The medicine round and nursing tasks are not switched on yet.')).toBeDefined()
  })

  it('is not listed for the front desk or lab, and its address says who can use it without reading', async () => {
    const desk = facility(REAL_FACILITY, 'Fictional Hospital', ['identity.patient.read', 'identity.registration.write'], ['receptionist'])
    const sent = serve({ [SESSION]: [sessionAt(desk, [desk])] })
    await openStaffApp('/provider/nursing-tasks')
    expect(await screen.findByText('Only nurses, clinicians and doctors of this facility can use the medicine round and nursing tasks.')).toBeDefined()
    expect(within(nav()).queryByRole('link', { name: 'Nursing tasks' })).toBeNull()
    expect(within(nav()).queryByRole('link', { name: 'Medicine round' })).toBeNull()
    expect(sent.filter(call => call.route.includes('/ehr/'))).toEqual([])
  })

  it('offers no New task to a member who can read tasks but not write them', async () => {
    const reader = facility(REAL_FACILITY, 'Fictional Hospital', ['ehr.nursing-task.read', 'ehr.ward.read'], ['clinician'])
    serve({ [SESSION]: [sessionAt(reader, [reader])], [WARDS]: [wardsOf()], [TASKS]: many(() => json({ items: [task()] })) })
    await openStaffApp('/provider/nursing-tasks')
    const row = await screen.findByRole('listitem', { name: 'Turn the patient' })
    expect(within(row).queryByRole('button', { name: 'Start task' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New task' })).toBeNull()
  })

  it('asks which ward when there are several, and says when there are none', async () => {
    const member = nurse()
    serve({
      [SESSION]: [sessionAt(member, [member])],
      [WARDS]: [wardsOf(ward(), ward({ wardId: 'c0000000-0000-4000-8000-0000000000c2', name: 'Children’s Ward' }))],
      [TASKS]: many(() => json({ items: [task()] })),
    })
    const view = await openStaffApp('/provider/nursing-tasks')
    const picker = await screen.findByLabelText('Ward')
    expect(screen.queryByRole('listitem', { name: 'Turn the patient' })).toBeNull()
    fireEvent.change(picker, { target: { value: WARD } })
    expect(await screen.findByRole('listitem', { name: 'Turn the patient' })).toBeDefined()
    view.unmount()
    vi.resetModules()
    withNursingPages()
    serve({ [SESSION]: [sessionAt(member, [member])], [WARDS]: [() => json({ items: [] })] })
    await openStaffApp('/provider/nursing-tasks')
    expect(await screen.findByText('This facility has no wards set up yet. An admin sets them up in Ward configuration.')).toBeDefined()
  })
})

describe('Medicine round in the frame', () => {
  it('lists each patient’s due and late doses, and only counts where the chart cannot be read', async () => {
    const doctor = facility(REAL_FACILITY, 'Fictional Hospital', DOCTOR, ['doctor'])
    const sent = serve({
      [SESSION]: [sessionAt(doctor, [doctor])],
      [WARDS]: [wardsOf()],
      [ROUND]: many(() => json({ wardId: WARD, wardName: 'Female Medical Ward', wardType: 'general', window: 'now', at: '2026-12-03T13:20:00.000Z',
        items: [
          { admissionId: ADMISSION, patient: card(), bedName: 'Bed 4', chartShown: true, medicinesHidden: false,
            counts: { due: 1, late: 2, upcoming: 0 }, doses: [
              { prescriptionId: 'f1', medicationDisplay: 'Amoxicillin', strength: '500 mg', scheduledFor: '2026-12-02T13:00:00.000Z', state: 'late' },
              { prescriptionId: 'f1', medicationDisplay: 'Amoxicillin', strength: '500 mg', scheduledFor: '2026-12-03T13:00:00.000Z', state: 'late' },
              { prescriptionId: 'f2', medicationDisplay: 'Paracetamol', strength: '1 g', scheduledFor: '2026-12-03T14:00:00.000Z', state: 'due' },
            ] },
          { admissionId: ADMISSION_HIDDEN, patient: hiddenCard(), bedName: 'Bed 7', chartShown: false, medicinesHidden: true,
            counts: { due: 2, late: 0, upcoming: 0 }, doses: [] },
        ] })),
    })
    await openStaffApp('/provider/medicine-round')
    expect(await screen.findByRole('heading', { level: 1, name: 'Medicine round' })).toBeDefined()
    expect(screen.getByText('Do not show this list on a screen patients or visitors can see.')).toBeDefined()
    const first = await screen.findByRole('listitem', { name: 'Ada Wardone' })
    expect(within(first).getByText('2 late')).toBeDefined()
    expect(within(first).getByText('1 due')).toBeDefined()
    // The round reads doses from 24 hours back: yesterday's late dose carries its date, today's the time only.
    expect(within(first).getByText('2 Dec 2026, 14:00')).toBeDefined()
    expect(within(first).getByText('14:00')).toBeDefined()
    expect(within(first).getByText('Amoxicillin 500 mg')).toBeDefined()
    expect(within(first).getByRole('link', { name: 'Ada Wardone' }).getAttribute('href')).toBe(`/provider/ward-patient/${ADMISSION}/medicines`)
    const hidden = screen.getByRole('listitem', { name: 'B T' })
    expect(within(hidden).getByText('2 due')).toBeDefined()
    expect(within(hidden).getByText('Open the record to see the medicines.')).toBeDefined()
    expect(screen.getByText('As of 14:20')).toBeDefined()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Also show doses due in the next 4 hours' }))
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([address]) => String(address).includes('window=next_4h'))).toBe(true))
    expect(sentTo(sent, ROUND)[0]!.headers.get('X-Purpose-Of-Use')).toBe('direct-care')
    noIdentityInAddresses()
  })

  it('is not open to an admin, who sets shifts up instead', async () => {
    const admin = facility(REAL_FACILITY, 'Fictional Hospital', ADMIN, ['admin'])
    serve({ [SESSION]: [sessionAt(admin, [admin])], [WARDS]: [wardsOf()] })
    await openStaffApp('/provider/medicine-round')
    expect(await screen.findByText('Only nurses, clinicians and doctors of this facility can use the medicine round and nursing tasks.')).toBeDefined()
    fireEvent.click(within(nav()).getByRole('button', { name: 'Settings' }))
    expect(within(nav()).getByRole('link', { name: 'Clinical shifts' }).getAttribute('href')).toBe('/provider/clinical-shifts')
  })
})


