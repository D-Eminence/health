import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DEMO_HOSPITAL, SESSION, openStaffApp, serve, where, type Sent } from '../frame/blueHarness'
import {
  RIVERSIDE, STAFF, eyebrow, heading, many, membership, nav, sessionWith, staffAnswer, stepButton, stepper, withOnboardingPages,
  type Review,
} from './onboardingHarness'

/*
 * Facility setup, the design's nine-step wizard (screens 14-22), for the administrator of a fictional facility that
 * signed itself up, with the clinic switch on: its stepper, each step's heading and where focus goes, the live parts
 * (the facility's name and check from the session, Staff & access through its own reads) and the sample steps, which
 * send nothing.
 */
vi.mock('../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: true }))
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => {
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  withOnboardingPages()
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const STEPS = ['Facility', 'Type', 'Departments', 'Branches', 'Staff', 'Roles', 'Billing', 'Review', 'Launch']
const SAMPLE = 'Sample only: not connected to Health ID yet. Nothing you do here is saved.'
const NOT_COLLECTED = 'Health ID doesn’t save this yet'
const PENDING = `Health ID support is checking ${RIVERSIDE}. This usually takes up to one working day.`
const DONE = `Health ID support has checked ${RIVERSIDE}, and it now has full access.`

async function openSetup(path = '/provider/onboarding', review: Review = 'reviewed', current = membership({ review })) {
  const sent = serve({ [SESSION]: [sessionWith(current)], [STAFF]: many(staffAnswer(current.name, current.id, review)) })
  await openStaffApp(path)
  await screen.findByRole('navigation', { name: 'Setup steps' })
  return sent
}

const routes = (sent: readonly Sent[]) => sent.map(request => request.route)
/** The Review step's rows, term to value. */
const reviewFacts = () => Object.fromEntries([...document.querySelectorAll('.hid-ehr-onboarding-details dt')]
  .map(term => [term.textContent, term.nextElementSibling?.textContent]))
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
/** The sample notice right under the heading (the steps that are samples throughout). */
const bannerUnderHeading = () => {
  const after = document.querySelector('.hid-ehr-onboarding > .hid-ehr-page-heading')?.nextElementSibling
  return after?.classList.contains('hid-ehr-sample-banner') ? after.textContent : null
}

describe('the stepper and each step\'s heading', () => {
  it('opens at step 1 with the design\'s heading, Exit setup, and a stepper of nine steps', async () => {
    await openSetup()
    expect(eyebrow()).toBe('Step 1 of 9 · Facility')
    // The heading names the step for a screen reader; the eyebrow shows it.
    expect(heading().textContent).toBe('Step 1 of 9 · Facility: Set up your facility')
    expect(screen.getByRole('button', { name: 'Exit setup' })).toBeDefined()
    const buttons = within(stepper()).getAllByRole('button')
    expect(buttons.map(button => button.textContent)).toEqual(STEPS.map((step, index) => `${index + 1}. ${step}`))
    expect(buttons.map(button => button.getAttribute('aria-current'))).toEqual(['step', null, null, null, null, null, null, null, null])
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it.each(STEPS.map((step, index) => [step, index] as const))('goes straight to %s from the stepper, keeping focus on it', async (step, index) => {
    await openSetup()
    const button = stepButton(step)
    button.focus()
    fireEvent.click(button)
    expect(eyebrow()).toBe(`Step ${index + 1} of 9 · ${step}`)
    expect(heading().textContent).toBe(`Step ${index + 1} of 9 · ${step}: Set up your facility`)
    expect(stepButton(step).getAttribute('aria-current')).toBe('step')
    expect(within(stepper()).getAllByRole('button').filter(candidate => candidate.getAttribute('aria-current'))).toHaveLength(1)
    expect(document.activeElement).toBe(button)
    // The sample notice right under the heading on the steps that are samples throughout.
    expect(bannerUnderHeading()).toBe(['Type', 'Departments', 'Branches', 'Billing', 'Launch'].includes(step) ? SAMPLE : null)
    expect(screen.queryByRole('button', { name: 'Back' }) !== null).toBe(index > 0)
  })

  it('moves focus to the heading when the step\'s own button takes it on, or Back takes it back', async () => {
    await openSetup()
    press('Continue')
    expect(eyebrow()).toBe('Step 2 of 9 · Type')
    expect(document.activeElement).toBe(heading())
    press('Back')
    expect(eyebrow()).toBe('Step 1 of 9 · Facility')
    expect(document.activeElement).toBe(heading())
  })

  it('opens at the step its address names', async () => {
    await openSetup('/provider/onboarding/review')
    expect(eyebrow()).toBe('Step 8 of 9 · Review')
    expect(screen.getByRole('heading', { level: 2, name: 'Check your choices' })).toBeDefined()
  })

  it('leaves for Choose workspace from Exit setup, as the design does', async () => {
    await openSetup()
    press('Exit setup')
    await waitFor(() => expect(where()).toBe('/provider/institutions'))
  })
})

describe('step 1, Facility', () => {
  it('shows the facility\'s name from the session, read-only, and the design\'s other fields disabled and marked', async () => {
    const sent = await openSetup()
    const name = screen.getByRole('textbox', { name: 'Facility name' }) as HTMLInputElement
    expect(name.value).toBe(RIVERSIDE)
    expect(name.readOnly).toBe(true)
    for (const label of ['Main phone', 'Main email', 'Address', 'City', 'State', 'CAC number (optional)', 'Optional facility logo']) {
      const field = screen.getByLabelText(label) as HTMLInputElement
      expect(field.disabled, label).toBe(true)
      expect(field.value, label).toBe('')
      expect(field.getAttribute('name'), label).toBeNull()
      expect(document.getElementById(field.getAttribute('aria-describedby') ?? '')?.textContent, label).toBe(NOT_COLLECTED)
    }
    expect(screen.getByText(DONE)).toBeDefined()
    expect(bannerUnderHeading()).toBeNull()
    press('Continue')
    expect(eyebrow()).toBe('Step 2 of 9 · Type')
    expect(routes(sent)).toEqual([SESSION])
  })

  it('says Health ID support is checking the facility while it is', async () => {
    await openSetup('/provider/onboarding', 'pending')
    expect(within(document.querySelector('.hid-ehr-onboarding') as HTMLElement).getByText(PENDING)).toBeDefined()
  })
})

describe('the sample steps send nothing', () => {
  it('takes the design\'s type, departments, branch and billing into the review, asking nothing of Health ID', async () => {
    const sent = await openSetup('/provider/onboarding/type')

    // Type: nothing chosen is refused in the design's words; a type whose suggestion differs asks first.
    press('Next (sample)')
    expect(screen.getByText('Complete this field.')).toBeDefined()
    fireEvent.change(screen.getByRole('combobox', { name: 'Facility type' }), { target: { value: 'Diagnostic Centre' } })
    press('Next (sample)')
    const ask = await screen.findByRole('alertdialog', { name: 'Use suggested departments?' })
    expect(within(ask).getByText('Cancel keeps the departments you chose.')).toBeDefined()
    fireEvent.click(within(ask).getByRole('button', { name: 'Use suggested departments' }))
    expect(eyebrow()).toBe('Step 3 of 9 · Departments')
    expect(document.activeElement).toBe(heading())

    // Departments: the suggestion is ticked; none at all is refused.
    const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement
    expect(screen.getAllByRole('checkbox').filter(input => (input as HTMLInputElement).checked).map(input => input.getAttribute('aria-labelledby') && document.getElementById(input.getAttribute('aria-labelledby')!)?.textContent))
      .toEqual(['Laboratory', 'Radiology'])
    expect(box('Laboratory').getAttribute('aria-describedby')).toBeTruthy()
    fireEvent.click(box('Laboratory'))
    fireEvent.click(box('Radiology'))
    press('Next (sample)')
    expect(screen.getByRole('alert').textContent).toBe('Select at least one department.')
    fireEvent.click(box('General Outpatient'))
    fireEvent.click(box('Laboratory'))
    press('Next (sample)')
    expect(eyebrow()).toBe('Step 4 of 9 · Branches')

    // Branches: the main branch, completed and saved in this visit; it runs the hospital's departments.
    expect(screen.getByRole('button', { name: 'Main', pressed: true })).toBeDefined()
    expect(screen.getAllByRole('checkbox').map(input => (input.closest('label') as HTMLElement).textContent)).toEqual(['General Outpatient', 'Laboratory'])
    // The branch runs what it ran; a department the hospital has just turned on is the administrator's to add.
    expect(screen.getAllByRole('checkbox').map(input => (input as HTMLInputElement).checked)).toEqual([true, false])
    fireEvent.click(screen.getByRole('checkbox', { name: 'Laboratory' }))
    press('Add branch (sample)')
    expect(screen.getAllByText('Complete this field.')).toHaveLength(2)
    fireEvent.change(screen.getByRole('textbox', { name: 'Address' }), { target: { value: '1 Fiction Lane' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Contact' }), { target: { value: '+2348000000000' } })
    // A branch that runs no department is refused in the design's words (src/service.ts:867-875).
    fireEvent.click(screen.getByRole('checkbox', { name: 'General Outpatient' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Laboratory' }))
    press('Add branch (sample)')
    expect(screen.getByRole('alert').textContent).toBe('Branch name, address, contact, hours and departments are required.')
    // The status is there, saying nothing, before it has anything to say: a screen reader then announces it.
    const status = document.querySelector('.hid-ehr-onboarding-status')
    expect(status?.getAttribute('role')).toBe('status')
    expect(status?.textContent).toBe('')
    fireEvent.click(screen.getByRole('checkbox', { name: 'General Outpatient' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Laboratory' }))
    press('Add branch (sample)')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Main is in the branch list.')).toBe(status)
    press('Next (sample)')
    expect(eyebrow()).toBe('Step 5 of 9 · Staff')

    // Billing (from the stepper): the design's fields, required.
    fireEvent.click(stepButton('Billing'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Accepted payment methods (Cash,Transfer,Card,Insurance)' }), { target: { value: 'Cash, Transfer' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'When patients pay' }), { target: { value: '' } })
    press('Next (sample)')
    expect(screen.getByText('Complete this field.')).toBeDefined()
    fireEvent.change(screen.getByRole('combobox', { name: 'When patients pay' }), { target: { value: 'Before service' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Accept insurance' }))
    press('Next (sample)')
    expect(eyebrow()).toBe('Step 8 of 9 · Review')

    // Review: the facility's name from Health ID, what this visit chose, and what Health ID does not collect.
    expect(reviewFacts()).toEqual({
      Name: RIVERSIDE, Type: 'Diagnostic Centre', Phone: NOT_COLLECTED, Email: NOT_COLLECTED, Address: NOT_COLLECTED,
      City: NOT_COLLECTED, State: NOT_COLLECTED, Departments: 'General Outpatient, Laboratory', Currency: 'NGN',
      'Payment Methods': 'Cash, Transfer', 'Payment Timing': 'Before service', Insurance: 'Yes',
    })
    expect(screen.getByText('Main · 1 Fiction Lane · General Outpatient, Laboratory')).toBeDefined()
    expect(screen.queryByText(PENDING)).toBeNull()

    // Not one request: the session alone (the Staff step was passed through the stepper before it read).
    expect(routes(sent).filter(route => route !== STAFF)).toEqual([SESSION])
    expect(sent.every(request => request.route.startsWith('GET '))).toBe(true)
  })

  it('keeps nothing once the page is left: coming back starts again, and the browser holds nothing', async () => {
    const sent = await openSetup('/provider/onboarding/type')
    fireEvent.change(screen.getByRole('combobox', { name: 'Facility type' }), { target: { value: 'Clinic' } })
    press('Next (sample)')
    // A clinic suggests General Outpatient, as already chosen: nothing to ask.
    expect(eyebrow()).toBe('Step 3 of 9 · Departments')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pharmacy' }))
    press('Next (sample)')
    fireEvent.click(stepButton('Review'))
    expect(reviewFacts()).toMatchObject({ Type: 'Clinic', Departments: 'General Outpatient, Pharmacy' })

    // Home, then Facility setup again from the sidebar: a new visit, holding none of the last one's choices.
    fireEvent.click(within(nav()).getByRole('link', { name: 'Home' }))
    await screen.findByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), / })
    // Settings folds once its page is left: opened again from its heading.
    fireEvent.click(within(nav()).getByRole('button', { name: 'Settings' }))
    fireEvent.click(within(nav()).getByRole('link', { name: 'Facility setup' }))
    await screen.findByRole('navigation', { name: 'Setup steps' })
    expect(eyebrow()).toBe('Step 1 of 9 · Facility')
    fireEvent.click(stepButton('Review'))
    expect(reviewFacts()).toMatchObject({ Type: 'Not chosen', Departments: 'General Outpatient' })
    expect([localStorage.length, sessionStorage.length]).toEqual([0, 0])
    // Whatever Home reads, the wizard wrote nothing.
    expect(sent.every(request => request.route.startsWith('GET '))).toBe(true)
  })

  it('keeps the departments chosen when the suggestion is cancelled', async () => {
    await openSetup('/provider/onboarding/type')
    fireEvent.change(screen.getByRole('combobox', { name: 'Facility type' }), { target: { value: 'Maternity Centre' } })
    press('Next (sample)')
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Use suggested departments?' })).getByRole('button', { name: 'Cancel' }))
    expect(eyebrow()).toBe('Step 3 of 9 · Departments')
    expect((screen.getByRole('checkbox', { name: 'General Outpatient' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Maternity' }) as HTMLInputElement).checked).toBe(false)
  })

  it('links into other samples only at a demo facility, never from a real one', async () => {
    await openSetup('/provider/onboarding/staff')
    expect(screen.queryByRole('link', { name: 'Add a shift' })).toBeNull()
    expect(screen.queryByText('Who reports to whom is optional. You can set shifts now or after launch.')).toBeNull()
    fireEvent.click(stepButton('Billing'))
    expect(screen.queryByRole('link', { name: 'Set up your list of services' })).toBeNull()
  })

  it('links into the Shifts and Service catalogue samples at a demo facility, as the design does', async () => {
    await openSetup('/provider/onboarding/staff', 'reviewed', membership({ id: DEMO_HOSPITAL, name: 'Demo Hospital' }))
    expect((await screen.findByRole('link', { name: 'Add a shift' })).getAttribute('href')).toBe('/provider/shifts/new')
    fireEvent.click(stepButton('Billing'))
    expect(screen.getByRole('link', { name: 'Set up your list of services' }).getAttribute('href')).toBe('/provider/services')
  })
})

describe('steps 5 and 6, Staff and Roles', () => {
  it('reads the staff through Staff & access alone, once on each step, and nothing else', async () => {
    const sent = await openSetup()
    expect(routes(sent)).toEqual([SESSION])
    fireEvent.click(stepButton('Staff'))
    expect(await screen.findByText('Demo Administrator', { selector: 'strong' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 1, name: 'Staff & access' })).toBeDefined()
    expect(screen.getByText('Hospital memberships')).toBeDefined()
    expect(routes(sent)).toEqual([SESSION, STAFF])
    expect(bannerUnderHeading()).toBeNull()

    press('Continue to roles')
    expect(eyebrow()).toBe('Step 6 of 9 · Roles')
    expect(document.activeElement).toBe(heading())
    const templates = screen.getByRole('heading', { level: 2, name: 'Roles and what each can do' }).closest('section') as HTMLElement
    expect(within(templates).getByText(SAMPLE)).toBeDefined()
    // The design's words, but for its claim that branch access is edited in Staff & access: Health ID has no branches.
    expect(within(templates).getByText(/^Being an owner or admin/).textContent).toBe('Being an owner or admin never lets someone sign '
      + 'clinical notes, prescribe or dispense. Health ID’s own roles are the ones Staff & access offers below.')
    expect(within(templates).queryByText(/branch/i)).toBeNull()
    const rows = templates.querySelectorAll('details')
    expect([...rows].map(row => row.querySelector('summary')?.textContent)).toEqual(['Facility Owner', 'Medical Director', 'Facility Admin',
      'Consultant', 'Doctor', 'Nurse', 'Receptionist', 'Records Officer', 'Lab Manager', 'Lab Scientist', 'Pharmacy Manager',
      'Pharmacist', 'Billing Officer', 'Cashier', 'Radiology Reporter'])
    expect(rows[0]?.querySelector('p')?.textContent).toMatch(/^dashboard\.view, notifications\.view, profile\.view, subscription\.view/)
    expect(await screen.findByText('Demo Administrator', { selector: 'strong' })).toBeDefined()
    await waitFor(() => expect(routes(sent)).toEqual([SESSION, STAFF, STAFF]))
    press('Continue to billing')
    expect(eyebrow()).toBe('Step 7 of 9 · Billing')
    expect(routes(sent)).toEqual([SESSION, STAFF, STAFF])
  })
})

describe('step 8, Review', () => {
  it('lists Health ID support\'s check as what stands before launch while it is pending, in today\'s words', async () => {
    const sent = await openSetup('/provider/onboarding/review', 'pending')
    const review = screen.getByRole('heading', { level: 2, name: 'Check your choices' }).closest('section') as HTMLElement
    expect(within(review).getByText(PENDING).closest('.hid-ehr-onboarding-blocker')).not.toBeNull()
    press('Check what’s needed to launch')
    expect(eyebrow()).toBe('Step 9 of 9 · Launch')
    expect(screen.getByRole('heading', { level: 2, name: 'Ready to launch?' })).toBeDefined()
    expect(within(document.querySelector('.hid-ehr-onboarding-step') as HTMLElement).getByText(PENDING)).toBeDefined()
    // The frame's own review banner reads the staff for its licence hint; the wizard reads nothing.
    expect(routes(sent).filter(route => route !== STAFF)).toEqual([SESSION])
  })

  it('lists no blocker once the check is done', async () => {
    await openSetup('/provider/onboarding/review', 'reviewed')
    expect(screen.queryByText(PENDING)).toBeNull()
    expect(document.querySelector('.hid-ehr-onboarding-blocker')).toBeNull()
  })
})

describe('step 9, Launch', () => {
  it('sends nothing: it opens Home and says, in a status, that Health ID has no launch step', async () => {
    const sent = await openSetup('/provider/onboarding/launch')
    const { toast } = await import('@hid/ui')
    const info = vi.spyOn(toast, 'info')
    expect(screen.getByText('A new facility starts with no patients, stock or transactions.')).toBeDefined()
    const before = sent.length
    press('Launch facility')
    await waitFor(() => expect(where()).toBe('/provider'))
    expect(info).toHaveBeenCalledWith('Health ID has no launch step yet. Your records system is already open.')
    expect(await screen.findByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), / })).toBeDefined()
    // Whatever Home reads, the launch itself wrote nothing.
    expect(sent.slice(before).every(request => request.route.startsWith('GET '))).toBe(true)
    expect(sent.some(request => /onboarding|launch|setup/i.test(request.route))).toBe(false)
  })

  it('waits for Health ID support\'s check: Launch facility is off, with today\'s waiting sentence, until it is done', async () => {
    const sent = await openSetup('/provider/onboarding/launch', 'pending')
    const launch = screen.getByRole('button', { name: 'Launch facility' }) as HTMLButtonElement
    expect(launch.disabled).toBe(true)
    const waiting = document.getElementById(launch.getAttribute('aria-describedby') ?? '')
    expect(waiting?.textContent).toBe(PENDING)
    const before = sent.length
    fireEvent.click(launch)
    expect(where()).toBe('/provider/onboarding/launch')
    expect(sent.length).toBe(before)
  })
})
