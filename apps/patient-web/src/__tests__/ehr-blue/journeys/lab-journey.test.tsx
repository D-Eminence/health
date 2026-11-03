import { useEffect } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { consultationLabel } from '../../../plainLabels'
import { backToTestSite, onSite } from '../../sites/siteHarness'
import { ENCOUNTER_ID, fakeHealthId, PATIENT, PEOPLE, type Person } from './fakeHealthId'

/**
 * A lab request from the doctor to the result back, through the whole app as the EHR's site (and the Lab's) serve it,
 * against one stateful fake that answers as the EHR, Lab and the orders between facilities do at hid-system 34d69557
 * (fakeHealthId.ts). Each person signs in on their own: the app is opened afresh for each, as a new browser would.
 * Every person, facility, patient and value here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
vi.mock('../../../openSite', () => ({ openSite: vi.fn() }))

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => { vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules() })

const EHR = 'ehr.healthidentitydirectory.com'
const LAB_SITE = 'lab.healthidentitydirectory.com'
const WORK_LIST = '/provider/laboratory/work'
/** The first wait loads the real app's lazy pages cold. */
const COLD = { timeout: 25000 }

/** Every address the app has been at, across every person's sign-in. */
const seen: string[] = []
function Address() {
  const location = useLocation()
  const at = location.pathname + location.search + location.hash
  useEffect(() => { if (seen.at(-1) !== at) seen.push(at) }, [at])
  return <span data-testid="address" hidden>{at}</span>
}
const address = () => screen.getByTestId('address').textContent ?? ''

/** `person` opens the app at `path` on `site`, signed in (the fake answers the session as them). */
async function openAs(lab: ReturnType<typeof fakeHealthId>, person: Person, path: string, site = EHR) {
  cleanup()
  lab.as(person)
  onSite(site, path)
  const { App } = await import('../../../App')
  render(<MemoryRouter initialEntries={[path]}><Address /><App /></MemoryRouter>)
}

async function confirmSheet(title: string | RegExp, button: string, fill?: { label: string | RegExp; value: string }) {
  const sheet = await screen.findByRole('dialog', { name: title })
  if (fill) fireEvent.change(within(sheet).getByRole('textbox', { name: fill.label }), { target: { value: fill.value } })
  await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: button })) })
  await waitFor(() => expect(screen.queryByRole('dialog', { name: title })).toBeNull())
}

const stageTabs = () => within(screen.getByRole('navigation', { name: 'Stage' })).getAllByRole('button')
  .map(tab => `${tab.textContent}${tab.getAttribute('aria-pressed') === 'true' ? '*' : ''}`)
const cards = () => screen.queryAllByRole('button', { name: /, Haemoglobin$/ }).filter(card => !card.closest('[hidden]'))

/** The doctor finds the patient (their grant), opens today's visit and its Orders. */
async function doctorOpensVisit(lab: ReturnType<typeof fakeHealthId>) {
  await openAs(lab, PEOPLE.bello, '/provider/patients')
  fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }, COLD), { target: { value: PATIENT.hid } })
  fireEvent.click(screen.getByRole('button', { name: 'Find' }))
  expect(await screen.findByRole('heading', { level: 1, name: PATIENT.name })).toBeTruthy()
  const visit = { startedAt: '2026-11-03T08:00:00.000Z' }
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${consultationLabel(visit)}`) }))
  expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(visit) })).toBeTruthy()
}

/** The doctor opens the lab request from the visit's orders. */
async function doctorOpensRequest(lab: ReturnType<typeof fakeHealthId>) {
  await doctorOpensVisit(lab)
  const orders = await screen.findByRole('list', { name: 'Orders from this consultation' })
  fireEvent.click(await within(orders).findByRole('link', { name: /^Laboratory · Haemoglobin/ }))
  expect(await screen.findByRole('heading', { level: 1, name: 'Haemoglobin' })).toBeTruthy()
}

/** A scientist takes the request from its card through to a saved result (no name sent: the check asks who they are). */
async function scientistTestsAndSaves(named: boolean) {
  // Work from another facility names the patient to check before a sample is taken.
  if (named) expect(await screen.findByText(`Check that the person is ${PATIENT.name} before you take a sample.`)).toBeTruthy()
  fireEvent.click(await screen.findByRole('button', { name: 'Blood' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Why the test' }), { target: { value: 'Tired for a month (fictional)' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Register sample' })) })
  fireEvent.click(await screen.findByRole('button', { name: 'Collect sample' }))
  const sheet = await screen.findByRole('dialog', { name: 'Collect the sample' })
  if (named) expect(within(sheet).getByText('Check the name with the person before you take it.')).toBeTruthy()
  else expect(within(sheet).getByText('Health ID didn’t send this person’s name. Before you take the sample, confirm who they are with the doctor or nurse who asked for the test.')).toBeTruthy()
  await confirmSheet('Collect the sample', 'Collect sample')
  fireEvent.click(await screen.findByRole('button', { name: 'Receive sample' }))
  fireEvent.change(await screen.findByRole('textbox', { name: 'What is being done' }), { target: { value: 'Run on the analyser' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start test' })) })
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Finish test' })) })
  const form = await screen.findByRole('form', { name: 'Enter result: Hemoglobin' })
  fireEvent.change(within(form).getByRole('spinbutton', { name: 'Result' }), { target: { value: '7.1' } })
  fireEvent.change(within(form).getByRole('textbox', { name: 'Unit' }), { target: { value: 'g/dL' } })
  fireEvent.change(within(form).getByRole('textbox', { name: /^Normal range/ }), { target: { value: '12.0-15.5' } })
  fireEvent.click(within(form).getByRole('button', { name: 'Save result' }))
  const save = await screen.findByRole('dialog', { name: 'Save the result' })
  expect(within(save).getByText('Someone other than you must check it before it is released. Until then only the lab sees it.')).toBeTruthy()
  await confirmSheet('Save the result', 'Save result')
  expect(await screen.findByText('Result saved. Next: check and release.')).toBeTruthy()
}

/** The request's stage card: the one thing to do now. */
async function stageCard() {
  await screen.findByRole('heading', { level: 1, name: 'Haemoglobin' }, COLD)
  await waitFor(() => expect(document.getElementById('lab-stage-title')).toBeTruthy())
  return document.getElementById('lab-stage-title')!.closest('section') as HTMLElement
}

async function backToList() {
  fireEvent.click(screen.getByRole('link', { name: 'Back to the work list' }))
  await waitFor(() => expect(address()).toMatch(/^\/provider\/laboratory\/work(\?|$)/))
}

describe.each([{ sendsOpenWork: false }, { sendsOpenWork: true }])('a lab request at the hospital’s own lab, on ehr. (Lab sends openWork: $sendsOpenWork)', ({ sendsOpenWork }) => {
  it('goes from the doctor to the lab and back: two scientists, one who may not see it, and a correction', { timeout: 300_000 }, async () => {
    seen.length = 0
    const lab = fakeHealthId({ sendsOpenWork })
    // A and B used the patient's Access PIN earlier; C did not.
    lab.grant(PEOPLE.scientistA)
    lab.grant(PEOPLE.scientistB)

    // 1. Dr Bello creates an active Haemoglobin request from the visit. Lab accepts it under his access.
    await doctorOpensVisit(lab)
    fireEvent.click(await screen.findByRole('button', { name: 'New lab request' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Add lab requests' })).toBeTruthy()
    for (const [label, value] of [['Test code system', 'LOINC'], ['Test code', '718-7'], ['Test display', 'Haemoglobin']] as const) {
      fireEvent.change(screen.getByLabelText(new RegExp(`^${label}\\s*\\*?$`)), { target: { value } })
    }
    fireEvent.change(screen.getByLabelText(/^Request handling\s*\*?$/), { target: { value: 'active' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create lab request' }))
    await confirmSheet('Confirm the patient', 'Send lab request')
    // The request opens, active, and Lab holds it. (What the create said is lost on the way: see the it.todo below.)
    expect(await screen.findByRole('heading', { level: 1, name: 'Haemoglobin' })).toBeTruthy()
    expect(await screen.findByText('Active')).toBeTruthy()
    expect(lab.work()).toHaveLength(1)

    // 2. Scientist C holds no access of their own to the patient: Lab lists nothing, and the page says why, with the way in.
    await openAs(lab, PEOPLE.scientistC, WORK_LIST)
    expect(await screen.findByText('No one is waiting for a sample', {}, COLD)).toBeTruthy()
    expect(cards()).toEqual([])
    const note = screen.getByText(/^A doctor’s request shows here once you have access to that patient\./)
    expect(within(note.closest('div') as HTMLElement).getByRole('link', { name: 'Find the patient' }).getAttribute('href')).toBe('/provider/patients')

    // 3. Scientist A registers, collects, receives, tests and saves. The list never names a step already done.
    await openAs(lab, PEOPLE.scientistA, WORK_LIST)
    const card = await screen.findByRole('button', { name: /^Register sample: Patient ••••[0-9a-f]{6}, Haemoglobin$/ }, COLD)
    fireEvent.click(card)
    await scientistTestsAndSaves(false)
    await backToList()
    await waitFor(() => expect(stageTabs()).toContain('Check & release0'))
    expect(stageTabs()).toEqual(['Waiting for sample0', 'Testing1*', 'Enter results0', 'Check & release0', 'Done0'])
    expect(cards().map(button => button.textContent)).toEqual([expect.stringMatching(/^Continue:/)])
    expect(document.body.textContent).not.toMatch(/Start test:/)

    // 5. Scientist B checks and releases (today's one press: check, then release).
    await openAs(lab, PEOPLE.scientistB, `${WORK_LIST}/${lab.work()[0]!.id}`)
    fireEvent.click(await within(await stageCard()).findByRole('button', { name: 'Check & release' }))
    await confirmSheet('Check & release', 'Check & release', { label: 'What you checked', value: 'Matches the sample (fictional)' })
    await waitFor(() => expect(document.getElementById('lab-stage-title')?.textContent).toBe('Done'))
    await backToList()
    if (sendsOpenWork) {
      await waitFor(() => expect(stageTabs()).toEqual(['Waiting for sample0*', 'Testing0', 'Enter results0', 'Check & release0', 'Done1']))
    } else {
      // Without openWork the list can't tell it is done: it stays under Testing, and says Continue, not Start test.
      await waitFor(() => expect(stageTabs()).toEqual(['Waiting for sample0', 'Testing1*', 'Enter results0', 'Check & release0', 'Done0']))
      expect(cards().map(button => button.textContent)).toEqual([expect.stringMatching(/^Continue:/)])
    }
    await openAs(lab, PEOPLE.scientistB, '/provider/laboratory/results')
    if (sendsOpenWork) {
      const results = await screen.findByRole('list', { name: 'Released results' }, COLD)
      expect(within(results).getByRole('link', { name: /Haemoglobin/ })).toBeTruthy()
    } else {
      expect(await screen.findByText('Results aren’t listed here yet', {}, COLD)).toBeTruthy()
      expect(screen.queryByText('No results released yet')).toBeNull()
    }

    // 6. Dr Bello reads the released result from the order, in plain words.
    await doctorOpensRequest(lab)
    fireEvent.click(screen.getByRole('button', { name: 'View released results' }))
    expect(await screen.findByText('7.1 g/dL · Low')).toBeTruthy()
    expect(screen.getByText('Latest released result')).toBeTruthy()
    expect(screen.getByText('Normal range: 12.0-15.5')).toBeTruthy()

    // 8. A corrects the released result; B checks and releases the correction; the doctor sees it first.
    await openAs(lab, PEOPLE.scientistA, `${WORK_LIST}/${lab.work()[0]!.id}`)
    fireEvent.click(await within(await stageCard()).findByRole('button', { name: 'Correct: Hemoglobin' }))
    const correct = screen.getByRole('form', { name: 'Correct result: Hemoglobin' })
    fireEvent.change(within(correct).getByRole('spinbutton', { name: 'Result' }), { target: { value: '11.7' } })
    fireEvent.change(within(correct).getByRole('textbox', { name: 'Why it is changed' }), { target: { value: 'Typed 7.1 for 11.7 (fictional)' } })
    fireEvent.click(within(correct).getByRole('button', { name: 'Save correction' }))
    await confirmSheet('Save the correction', 'Save correction')
    expect(await screen.findByText('Correction saved. Check and release it.')).toBeTruthy()
    // Until it is released, the lab says the clinician still sees the earlier result.
    expect((await screen.findByText(/^This corrects a result that was already released\./)).textContent).toMatch(/the clinician still sees the earlier result/)
    // Meanwhile the doctor still reads the released value, and nothing calls it the current one.
    await doctorOpensRequest(lab)
    fireEvent.click(screen.getByRole('button', { name: 'View released results' }))
    const waiting = (await screen.findByText('Latest released result')).closest('li')!
    expect(within(waiting).getByText('7.1 g/dL · Low')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Current result|11\.7/)
    await openAs(lab, PEOPLE.scientistB, `${WORK_LIST}/${lab.work()[0]!.id}`)
    fireEvent.click(await within(await stageCard()).findByRole('button', { name: 'Check & release' }))
    await confirmSheet('Check & release', 'Check & release', { label: 'What you checked', value: 'Correction matches the sample (fictional)' })
    await waitFor(() => expect(document.getElementById('lab-stage-title')?.textContent).toBe('Done'))
    await doctorOpensRequest(lab)
    fireEvent.click(screen.getByRole('button', { name: 'View released results' }))
    const current = (await screen.findByText('Latest released result')).closest('li')!
    expect(within(current).getByText('11.7 g/dL · Low')).toBeTruthy()
    expect(within(current).getByText('Why it was changed: Typed 7.1 for 11.7 (fictional)')).toBeTruthy()
    const earlier = screen.getByText('Earlier released result').closest('li')!
    expect(within(earlier).getByText('7.1 g/dL · Low')).toBeTruthy()
    expect(current.compareDocumentPosition(earlier) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // 7. No address on the way held the patient's id or Health ID. Lab and the EHR were asked nothing this fake doesn't know.
    for (const at of seen) {
      expect(at).not.toContain(PATIENT.id)
      expect(at).not.toContain(PATIENT.hid)
    }
    expect(seen).toContain(`/provider/clinical/${ENCOUNTER_ID}`)
    expect(lab.unexpected.filter(line => /\/(lab|ehr\/patients\/[^/]+\/encounters\/[^/]+\/lab-requests)\b/.test(line))).toEqual([])
  })

  // Found by this journey: the create page leaves its words for the order page in OrderPages' state, but the frame
  // remounts Consultation on each address (BlueFrame.tsx BluePageBoundary key, clinical/* has no keepsState), so
  // the order page opens without them. consult-orders.test.tsx mounts the pages without the frame and doesn't see it.
  it.todo('says “Active lab request created and accepted by Lab.” on the request it opens')

  // 4. Needs the backend's 409 for the person who entered a result (handoff A12) and #83's split Verify.
  it.todo('A’s own Verify says “You entered this result, so someone else must verify it.”')
})

describe('a lab request sent from ehr. to another laboratory (Lakeside Diagnostics, on lab.)', () => {
  beforeEach(() => {
    seen.length = 0
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  })

  /** A Lakeside scientist opens the request from its card on the work list. */
  async function lakesideOpens(lab: ReturnType<typeof fakeHealthId>, person: Person = PEOPLE.lakeside) {
    await openAs(lab, person, WORK_LIST, LAB_SITE)
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`: ${PATIENT.name.replace(/[()]/g, '\\$&')}, Haemoglobin$`) }, COLD))
    return stageCard()
  }

  it('is sent, found by Health ID, accepted with the patient checked, worked by two scientists, and read back on ehr.', { timeout: 300_000 }, async () => {
    const lab = fakeHealthId({ sendsOpenWork: true })

    // 1. Dr Bello sends it to another laboratory: the directory, the patient's agreement, then the send.
    await doctorOpensVisit(lab)
    fireEvent.click(await screen.findByRole('button', { name: 'New lab request' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Add lab requests' })).toBeTruthy()
    for (const [label, value] of [['Test code system', 'LOINC'], ['Test code', '718-7'], ['Test display', 'Haemoglobin']] as const) {
      fireEvent.change(screen.getByLabelText(new RegExp(`^${label}\\s*\\*?$`)), { target: { value } })
    }
    await waitFor(() => expect([...(screen.getByLabelText(/^Request handling\s*\*?$/) as HTMLSelectElement).options].map(option => option.value)).toContain('route'))
    fireEvent.change(screen.getByLabelText(/^Request handling\s*\*?$/), { target: { value: 'route' } })
    fireEvent.change(screen.getByLabelText(/^Search for the laboratory/), { target: { value: 'Lakeside' } })
    fireEvent.click(within(screen.getByRole('group', { name: 'Laboratory' })).getByRole('button', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('radio', { name: /^Lakeside Diagnostics \(fictional\)/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /^I confirm that .* agreed that Riverside Teaching Hospital \(fictional\) sends this test request to Lakeside Diagnostics \(fictional\)\.$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Create and send to Lakeside Diagnostics (fictional)' }))
    await confirmSheet('Confirm the patient', 'Send lab request')
    expect(await screen.findByRole('heading', { level: 1, name: 'Haemoglobin' })).toBeTruthy()
    await waitFor(() => expect(lab.routes()).toEqual([expect.objectContaining({ effectiveState: 'sent' })]))

    // 2. On lab., Lakeside finds it by the patient's Health ID and accepts it with the Health ID.
    await openAs(lab, PEOPLE.lakeside, WORK_LIST, LAB_SITE)
    const find = await screen.findByRole('search', { name: /^Find incoming .* by Health ID$/ }, COLD)
    fireEvent.change(within(find).getByLabelText('Find by Health ID'), { target: { value: PATIENT.hid } })
    fireEvent.click(within(find).getByRole('button', { name: 'Find' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))
    fireEvent.change(screen.getByLabelText(/^Patient’s Health ID/), { target: { value: PATIENT.hid } })
    fireEvent.click(screen.getByRole('button', { name: 'Accept order' }))
    expect(await screen.findByText('Accepted: Haemoglobin.')).toBeTruthy()
    expect(lab.routes()).toEqual([expect.objectContaining({ effectiveState: 'accepted' })])

    // 3. The lab steps, with the patient named; a second scientist checks and releases.
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^Register sample: ${PATIENT.name.replace(/[()]/g, '\\$&')}, Haemoglobin$`) }))
    await stageCard()
    await scientistTestsAndSaves(true)
    await lakesideOpens(lab, PEOPLE.lakesideB)
    fireEvent.click(await within(await stageCard()).findByRole('button', { name: 'Check & release' }))
    await confirmSheet('Check & release', 'Check & release', { label: 'What you checked', value: 'Matches the sample (fictional)' })
    await waitFor(() => expect(document.getElementById('lab-stage-title')?.textContent).toBe('Done'))

    // Back on ehr., the order's route says what Lakeside released.
    await doctorOpensRequest(lab)
    fireEvent.click(await screen.findByRole('button', { name: 'Show details and results' }))
    expect(await screen.findByText(/^Hemoglobin: Released by Lakeside Diagnostics \(fictional\) on .*: 7\.1 g\/dL, flagged low, reference 12\.0-15\.5$/)).toBeTruthy()

    for (const at of seen) {
      expect(at).not.toContain(PATIENT.id)
      expect(at).not.toContain(PATIENT.hid)
    }
    expect(lab.unexpected.filter(line => /\/(lab|ehr\/patients\/[^/]+\/encounters\/[^/]+\/lab-requests)\b/.test(line))).toEqual([])
  })

  it('ends at once when Lakeside accepted it for the wrong person, and leaves the work list', { timeout: 300_000 }, async () => {
    const lab = fakeHealthId({ sendsOpenWork: true })
    lab.sentAndAccepted()
    await lakesideOpens(lab)
    fireEvent.click(await screen.findByRole('button', { name: /^This isn’t the order’s patient: Haemoglobin, Ref 7Q2K\d{4}$/ }))
    fireEvent.click(screen.getByRole('radio', { name: 'I picked another patient’s order from the list' }))
    fireEvent.change(screen.getByLabelText('What happened, for Health ID support'), { target: { value: 'Wrong order picked (fictional)' } })
    fireEvent.click(screen.getByRole('checkbox', { name: `The person I accepted this order for is not ${PATIENT.name}.` }))
    fireEvent.click(screen.getByRole('button', { name: 'End this order' }))
    expect(await screen.findByText(new RegExp(`^Ended: Haemoglobin, reference 7Q2K\\d{4}\\. ${PATIENT.name.replace(/[()]/g, '\\$&')} is told in the Health ID app\\.`))).toBeTruthy()
    expect(await screen.findByRole('heading', { level: 1, name: 'Work list' })).toBeTruthy()
    await waitFor(() => expect(cards()).toEqual([]))
    expect(lab.routes()).toEqual([expect.objectContaining({ effectiveState: 'cancelled', endedKind: 'wrong_patient' })])
  })

  it('after a rejected sample, ends with “We can’t complete this order”, stays readable, and the doctor is told why', { timeout: 300_000 }, async () => {
    const lab = fakeHealthId({ sendsOpenWork: true })
    lab.sentAndAccepted()
    await lakesideOpens(lab)
    fireEvent.click(await screen.findByRole('button', { name: 'Blood' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Why the test' }), { target: { value: 'Tired for a month (fictional)' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Register sample' })) })
    fireEvent.click(await screen.findByRole('button', { name: 'Collect sample' }))
    await confirmSheet('Collect the sample', 'Collect sample')
    // The sample came to the bench clotted: rejected, which Lab allows only once it is taken.
    fireEvent.click(await screen.findByRole('button', { name: 'Reject sample' }))
    const reason = screen.getByRole('textbox', { name: 'Why reject it' })
    fireEvent.change(reason, { target: { value: 'Clotted (fictional)' } })
    await act(async () => { fireEvent.submit(reason.closest('form')!) })
    const card = await stageCard()
    expect(await within(card).findByText('The sample was rejected. Use “We can’t complete this order” below, or call the ordering facility.')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: /^We can’t complete this order: Haemoglobin, Ref 7Q2K\d{4}$/ }))
    const form = screen.getByRole('form', { name: 'End this order: we can’t complete it' })
    fireEvent.click(within(form).getByRole('radio', { name: 'The sample can’t be used, and a new one can’t be recorded on this order' }))
    fireEvent.click(within(form).getByRole('checkbox', { name: /^The person we accepted this/ }))
    fireEvent.click(within(form).getByRole('button', { name: 'End it: we can’t complete it' }))
    const ended = await screen.findByText(/^Ended: Haemoglobin, reference 7Q2K\d{4}\./)
    // Its reads are kept, so the request stays open, read only, with the ending said above it (A1).
    expect(await screen.findByText('This order from another facility has ended, so nothing more can be recorded on it. You can still read what was recorded.')).toBeTruthy()
    expect(ended.closest('[hidden]')).toBeNull()
    expect(screen.getAllByRole('heading', { level: 1 }).map(heading => heading.textContent)).toEqual(['Haemoglobin'])
    expect(lab.routes()).toEqual([expect.objectContaining({ effectiveState: 'cancelled', endedKind: 'receiving_unable' })])

    // On ehr., the order says Lakeside couldn't complete it.
    await doctorOpensRequest(lab)
    expect(await screen.findByText(/Lakeside Diagnostics \(fictional\) couldn’t complete it/)).toBeTruthy()
  })
})
