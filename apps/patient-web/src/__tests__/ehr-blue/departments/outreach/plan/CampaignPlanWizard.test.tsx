import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { DEMO_HOSPITAL_ID, renderDept } from '../../harness'
import { ToastProvider } from '../../../../../kasuwa/toast'
import { CampaignPlanWizard } from '../../../../../ehr-blue/departments/outreach/plan'

/*
 * "New campaign" as the plan's steps (owner decisions of 13 November 2026): the served create first (no
 * Idempotency-Key, a lost answer re-reads the list), then the plan saved as it goes against its version. Fictional data.
 */

vi.mock('../../../../../staff/App', async () => {
  const { fakeFacility, staffContext, DEMO_HOSPITAL_ID: hospital } = await import('../../harness')
  return { useStaff: () => staffContext(fakeFacility(['outreach.campaign.read', 'outreach.campaign.write'], { id: hospital, name: 'Demo Health Volunteers', roles: ['outreach_organiser'] })) }
})
const routes = await vi.hoisted(async () => (await import('./planTestKit')).campaignRoutes())
const api = vi.hoisted(() => ({ createOutreachCampaign: vi.fn() }))
vi.mock('../../../../../staff/api', () => ({ staffApi: api, outreachCampaignRequest: routes.request }))

const CREATED = { id: 'campaign-9', name: 'Demo market screening', status: 'planned', services: ['registration'], startsAt: '2026-11-19T23:00:00.000Z', endsAt: null, rowVersion: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  routes.reset()
  api.createOutreachCampaign.mockResolvedValue(CREATED)
})

async function press(button: HTMLElement) {
  await act(async () => { fireEvent.click(button) })
}
const next = () => press(screen.getByRole('button', { name: /^(Next|Create campaign|Save campaign|Back to check)$/ }))
const stepTitle = () => screen.getByRole('heading', { level: 3 }).textContent

function render(props: Partial<Parameters<typeof CampaignPlanWizard>[0]> = {}) {
  const onDone = vi.fn()
  const onCancel = vi.fn()
  const onUnsure = vi.fn()
  renderDept(<ToastProvider><CampaignPlanWizard onDone={onDone} onCancel={onCancel} onUnsure={onUnsure} {...props} /></ToastProvider>)
  return { onDone, onCancel, onUnsure }
}

async function fillBasics() {
  fireEvent.change(screen.getByLabelText(/^Campaign name/), { target: { value: ' Demo market screening ' } })
  fireEvent.change(screen.getByLabelText(/^Start date/), { target: { value: '2026-11-20' } })
  await next()
}

describe('the new campaign’s steps', () => {
  it('prefills the organisation, creates the campaign with the served call, then saves the plan as it goes', async () => {
    routes.on(call => (call.method === 'GET' && call.path.endsWith('/plan') ? new HidApiError(404, 'x', { code: 'OUTREACH_PLAN_NOT_FOUND' }) : undefined))
    routes.on(call => (call.method === 'PUT' ? { ...(call.body as object), campaignId: CREATED.id, rowVersion: Number(call.headers?.['If-Match']?.replace(/"/g, '')) + 1 } : undefined))
    const { onDone } = render()
    expect((screen.getByLabelText(/^Organisation/) as HTMLInputElement).value).toBe('Demo Health Volunteers')
    await fillBasics()
    expect(api.createOutreachCampaign.mock.calls).toEqual([[DEMO_HOSPITAL_ID, { name: 'Demo market screening', services: ['registration'], startsAt: '2026-11-19T23:00:00.000Z' }]])
    expect(stepTitle()).toBe('What it’s for')

    // A focus is needed.
    await next()
    expect(screen.getByText('Choose at least one.')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('HIV'))
    fireEvent.click(screen.getByLabelText('High blood pressure'))
    await next()
    // No site yet: nothing is sent.
    expect(routes.of('PUT', '/plan')).toEqual([])

    expect(stepTitle()).toBe('Screening')
    const hiv = screen.getByLabelText(/HIV rapid test/)
    expect(hiv.closest('li')?.textContent).toContain('Sensitive')
    expect(hiv.closest('li')?.textContent).toContain('Adds its own consent and counselling.')
    expect(screen.getByLabelText(/Blood pressure, top number \(systolic\) \(mmHg\)/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/^Pulse/))
    await next()

    expect(stepTitle()).toBe('Sites')
    await next()
    expect(screen.getByText('Enter where the team will work.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/^Place name/), { target: { value: 'Demo Town Hall' } })
    await next()
    const [first] = routes.of('PUT', '/campaigns/campaign-9/plan')
    expect(first?.headers).toEqual({ 'If-Match': '"0"' })
    const body = first?.body as { focuses: string[]; package: { vitals: Array<{ id: string }> }; stations: string[]; consent: { hivText: string | null }; sites: unknown[] }
    expect(body.focuses).toEqual(['hiv', 'hypertension'])
    expect(body.package.vitals.map(vital => vital.id)).toEqual(['bp_systolic', 'bp_diastolic'])
    expect(body.stations).toContain('counselling')
    expect(body.consent.hivText).toBeTruthy()
    expect(body.sites).toEqual([expect.objectContaining({ name: 'Demo Town Hall' })])

    expect(stepTitle()).toBe('How stations work')
    await next()
    expect(stepTitle()).toBe('Referral partners')
    await press(screen.getByRole('button', { name: 'Skip' }))
    expect(stepTitle()).toBe('Consent')
    expect(screen.getByLabelText(/^HIV test consent/)).toBeTruthy()
    await next()
    await press(screen.getByRole('button', { name: 'Skip' }))
    expect(stepTitle()).toBe('Check and save')
    // Nothing changed since the last save: nothing more is sent.
    expect(routes.of('PUT', '/plan')).toHaveLength(1)

    // Edit from the summary comes back to it.
    await press(screen.getByRole('button', { name: 'Edit sites' }))
    fireEvent.change(screen.getByLabelText(/^Community/), { target: { value: 'Demo Market' } })
    await press(screen.getByRole('button', { name: 'Back to check' }))
    expect(stepTitle()).toBe('Check and save')
    expect(routes.of('PUT', '/plan')[1]?.headers).toEqual({ 'If-Match': '"1"' })
    await next()
    expect(onDone).toHaveBeenCalledWith('campaign-9')
  })

  it('ends as soon as the campaign is made where Outreach doesn’t serve plans yet', async () => {
    const { onDone } = render()
    await fillBasics()
    expect(onDone).toHaveBeenCalledWith('campaign-9')
  })

  it('checks the first step as Outreach does, and reads the list again after a lost answer, sending nothing by itself', async () => {
    api.createOutreachCampaign.mockRejectedValue(new HidApiError(0, 'Network down', { code: 'NETWORK_ERROR' }))
    const { onUnsure, onDone } = render()
    fireEvent.click(screen.getByLabelText('Registration'))
    await next()
    expect(screen.getByText('Complete this field.', { selector: '#plan-campaign-name-error' })).toBeTruthy()
    expect(screen.getByText('Choose at least one service.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText(/^Campaign name/))
    expect(api.createOutreachCampaign).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Registration'))
    await fillBasics()
    // Said in a toast at the top of the screen, not in the form.
    expect((await screen.findByRole('alert')).textContent).toContain('Check it for this campaign before you retry')
    expect(screen.getByRole('form').textContent).not.toContain('Check it for this campaign')
    expect(onUnsure).toHaveBeenCalledTimes(1)
    expect(api.createOutreachCampaign).toHaveBeenCalledTimes(1)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('says a plan changed by someone else in words, reads its version again, and saves against it', async () => {
    let version = 0
    routes.on(call => (call.method === 'GET' && call.path.endsWith('/plan') ? (version ? { rowVersion: version } : new HidApiError(404, 'x', { code: 'OUTREACH_PLAN_NOT_FOUND' })) : undefined))
    routes.on(call => {
      if (call.method !== 'PUT') return undefined
      if (!version) { version = 3; return new HidApiError(412, 'x', { code: 'VERSION_CONFLICT' }) }
      return { ...(call.body as object), rowVersion: version + 1 }
    })
    render()
    await fillBasics()
    fireEvent.click(screen.getByLabelText('Malaria'))
    await next()
    await next()
    fireEvent.change(screen.getByLabelText(/^Place name/), { target: { value: 'Demo Clinic' } })
    await next()
    expect((await screen.findByRole('alert')).textContent).toContain('Someone changed this just now. It has been read again: check it, then try again.')
    expect(stepTitle()).toBe('Sites')
    await next()
    expect(routes.of('PUT', '/plan').map(call => call.headers?.['If-Match'])).toEqual(['"0"', '"3"'])
    expect(stepTitle()).toBe('How stations work')
  })
})

describe('a type of outreach of the organisation’s own', () => {
  it('adds one under Other (a name on the list is that one), with its own test, measurement and question, kept in the plan', async () => {
    routes.on(call => (call.method === 'GET' && call.path.endsWith('/plan') ? new HidApiError(404, 'x', { code: 'OUTREACH_PLAN_NOT_FOUND' }) : undefined))
    routes.on(call => (call.method === 'PUT' ? { ...(call.body as object), campaignId: CREATED.id, rowVersion: 1 } : undefined))
    render()
    await fillBasics()
    await press(screen.getByRole('button', { name: 'Other' }))
    const typed = screen.getByLabelText('Type the condition (e.g. malaria)')
    expect(document.activeElement).toBe(typed)
    // Nothing typed: said under the field, focus kept there.
    await press(screen.getByRole('button', { name: 'Add' }))
    expect(typed.getAttribute('aria-describedby')).toBe('plan-focus-other-error')
    expect(screen.getByText('Type what it is for, like malaria.')).toBeTruthy()
    // "malaria" is on the list: the listed one is chosen, with its own checks.
    fireEvent.change(typed, { target: { value: 'malaria' } })
    await press(screen.getByRole('button', { name: 'Add' }))
    expect((screen.getByLabelText('Malaria') as HTMLInputElement).checked).toBe(true)
    expect((await screen.findByRole('status')).textContent).toContain('Malaria is on the list')
    fireEvent.change(typed, { target: { value: 'sickle cell' } })
    await press(screen.getByRole('button', { name: 'Add' }))
    fireEvent.change(typed, { target: { value: 'Typhoid' } })
    await press(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('button', { name: 'Remove Sickle cell' })).toBeTruthy()
    await press(screen.getByRole('button', { name: 'Remove Typhoid' }))
    expect(screen.queryByRole('button', { name: 'Remove Typhoid' })).toBeNull()
    await next()

    // No template for it: the coordinator adds what it checks.
    expect(stepTitle()).toBe('Screening')
    await press(screen.getByRole('button', { name: 'Add a test' }))
    expect(document.activeElement).toBe(screen.getByLabelText('Test name'))
    expect((screen.getByLabelText('Results') as HTMLInputElement).value).toBe('Positive, Negative, Invalid')
    fireEvent.change(screen.getByLabelText('Test name'), { target: { value: 'Sickle cell test' } })
    fireEvent.click(screen.getByLabelText(/^Private result/))
    await press(screen.getByRole('button', { name: 'Add test' }))
    expect(screen.getByText('Sickle cell test').closest('li')?.textContent).toContain('Private')
    await press(screen.getByRole('button', { name: 'Add a measurement' }))
    fireEvent.change(screen.getByLabelText('Measurement'), { target: { value: 'Haemoglobin' } })
    await press(screen.getByRole('button', { name: 'Add measurement' }))
    expect(screen.getByText('Give the unit, like cm.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Unit'))
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'g/dL' } })
    await press(screen.getByRole('button', { name: 'Add measurement' }))
    expect(screen.getByText('Haemoglobin (g/dL)')).toBeTruthy()
    await next()
    fireEvent.change(screen.getByLabelText(/^Place name/), { target: { value: 'Demo Clinic' } })
    await next()

    const [save] = routes.of('PUT', '/plan')
    const body = save?.body as { focuses: unknown[]; package: { tests: Array<{ name: string; focus: string; sensitive: boolean; results: Array<{ label: string; flag: string }> }>; vitals: Array<{ name: string; unit: string }> } }
    expect(body.focuses).toEqual(['malaria', { id: 'custom:sickle-cell', label: 'Sickle cell' }])
    const own = body.package.tests.find(test => test.name === 'Sickle cell test')!
    expect(own.focus).toBe('custom:sickle-cell')
    expect(own.sensitive).toBe(true)
    expect(own.results.map(result => [result.label, result.flag])).toEqual([['Positive', 'abnormal'], ['Negative', 'normal'], ['Invalid', 'invalid']])
    expect(body.package.vitals.find(vital => vital.name === 'Haemoglobin')?.unit).toBe('g/dL')
  })
})
