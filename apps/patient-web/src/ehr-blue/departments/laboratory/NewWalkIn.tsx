import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CircleCheck, FlaskConical, Plus, Trash2 } from 'lucide-react'
import { Segmented } from '../../../kasuwa/interactive'
import { FormActions, FormPage } from '../../../kasuwa/parts'
import { Alert, Button, Card, EmptyState, Field, Textarea } from '../../../kasuwa/ui'
import { useFocusById } from '../../../staff/focus'
import { commerce, type CatalogueItem, type WalkInAnswer, type WalkInLabRequest, type WorkItemBill } from '../commerce/api'
import { naira } from '../commerce/money'
import { NotSwitchedOn } from '../commerce/NotSwitchedOn'
import { useDeptAccess } from '../parts/access'
import { PaidLine, PaymentStep, usePaymentSettings } from '../pharmacy/pointOfCare'
import { paysFirst, summaryOf } from '../pharmacy/pocFields'
import {
  CataloguePicker, checkOutside, checkWho, EMPTY_OUTSIDE, EMPTY_WHO, OutsideFields, outsideOrder, outsideUsed, StepCard, StepSummary,
  useAttemptKey, walkInPatient, whoCanContinue, whoFieldId, whoLine, WhoFields, type OutsideDraft, type OutsideErrors, type WhoDraft, type WhoErrors,
} from '../pharmacy/walkIn'

const BACK = { to: '/provider/laboratory', label: 'Back to the lab' }
const SEARCH_ID = 'walkin-search'

type StepNo = 1 | 2 | 3 | 4

/**
 * New walk-in at the lab (POINT_OF_CARE_SPEC §4, POST lab/walk-in-requests): someone who comes with a request form from
 * an outside doctor, or asks for a test themselves. Four steps: who (a Health ID, or a new one made here: a sample is
 * never taken without a name), the referring doctor (optional, with their email so the result can be sent back), the tests
 * (search the price list, tap to add; priority and a clinical note), and check and pay. The request is made once; then
 * payment, and on to the work list to take the sample. A 404 says it isn't switched on: nothing is pretended saved.
 */
export function NewWalkIn() {
  const { facilityId, permissions } = useDeptAccess()
  if (!facilityId || !permissions.includes('lab.walk-in.create')) return <FormPage title="New walk-in" back={BACK}>
    <EmptyState icon={FlaskConical} title="You can’t take walk-ins here" description="Your role needs permission to register walk-in lab requests." />
  </FormPage>
  return <WalkInForm key={facilityId} facilityId={facilityId} permissions={permissions} />
}

function WalkInForm({ facilityId, permissions }: { readonly facilityId: string; readonly permissions: readonly string[] }) {
  const navigate = useNavigate()
  const focus = useFocusById()
  const settingsRead = usePaymentSettings(facilityId)
  const settings = settingsRead.status === 'ready' ? settingsRead.data : null
  const [step, setStep] = useState<StepNo>(1)
  const [who, setWho] = useState<WhoDraft>(EMPTY_WHO)
  const [whoErrors, setWhoErrors] = useState<WhoErrors>({})
  const [outside, setOutside] = useState<OutsideDraft>(EMPTY_OUTSIDE)
  const [outsideErrors, setOutsideErrors] = useState<OutsideErrors>({})
  const [tests, setTests] = useState<CatalogueItem[]>([])
  const [priority, setPriority] = useState<'routine' | 'urgent'>('routine')
  const [note, setNote] = useState('')
  const [testsError, setTestsError] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [off, setOff] = useState(false)
  const [created, setCreated] = useState<WalkInAnswer | null>(null)
  const [cleared, setCleared] = useState<NonNullable<WorkItemBill> | null>(null)
  const keyFor = useAttemptKey()
  const total = tests.reduce((sum, test) => sum + test.prices.cashKobo, 0)

  function go(next: StepNo) {
    setStep(next)
    focus(next === 3 ? SEARCH_ID : `walkin-step-${next}`)
  }
  function doneWho() {
    const errors = checkWho(who)
    setWhoErrors(errors)
    const first = Object.keys(errors)[0]
    if (first) return focus(whoFieldId('walkin-who', first as keyof WhoErrors))
    go(2)
  }
  function doneDoctor() {
    const errors = checkOutside(outside, outsideUsed(outside))
    setOutsideErrors(errors)
    const first = Object.keys(errors)[0]
    if (first) return focus(first === 'prescriberName' ? 'walkin-dr-prescriber' : first === 'writtenOn' ? 'walkin-dr-written' : `walkin-dr-${first}`)
    go(3)
  }
  function toggle(item: CatalogueItem) {
    setTestsError('')
    setTests(current => current.some(test => test.id === item.id) ? current.filter(test => test.id !== item.id) : [...current, item])
  }
  function doneTests() {
    if (tests.length === 0) { setTestsError('Add at least one test.'); return focus(SEARCH_ID) }
    go(4)
  }

  const patient = walkInPatient(who)
  const request: WalkInLabRequest | null = patient.kind === 'anonymous' ? null : {
    patient, outside: outsideOrder(outside), tests: tests.map(test => ({ catalogueItemId: test.id })),
    clinicalNote: note.trim() || null, priority,
  }
  async function send() {
    if (sending || created || !request) return
    setSending(true); setSendError('')
    const result = await commerce.labWalkIn(facilityId, request, keyFor(JSON.stringify([facilityId, request])))
    setSending(false)
    if (result.ok) {
      setCreated(result.data)
      if (result.data.bill.status === 'paid' || result.data.bill.status === 'deferred') setCleared(summaryOf(result.data.bill))
      focus('walkin-made')
      return
    }
    if (result.notAvailable) { setOff(true); focus('walkin-off'); return }
    setSendError(result.error)
  }
  function again() {
    setStep(1); setWho(EMPTY_WHO); setOutside(EMPTY_OUTSIDE); setTests([]); setPriority('routine'); setNote('')
    setCreated(null); setCleared(null); setSendError(''); setOff(false)
    focus('walkin-step-1')
  }

  const workHref = created ? `/provider/laboratory?work=${encodeURIComponent(created.workItemIds[0] ?? '')}` : '/provider/laboratory'
  const payFirst = paysFirst(settings, 'lab')

  return <FormPage title="New walk-in" back={BACK} wide
    description={created ? undefined : `Step ${step} of 4. Someone who comes in for a test, with or without a doctor’s request form.`}>
    <StepCard anchor="walkin-step-1" n={1} title="Who is it for?" current={step === 1} done={step > 1}
      summary={<StepSummary label="Change who it is for" onChange={created ? undefined : () => go(1)}>{whoLine(who)}</StepSummary>}>
      <WhoFields idBase="walkin-who" facilityId={facilityId} place="lab" who={who} errors={whoErrors} anonymous={false}
        onChange={next => { if (next.made && !who.made) focus('walkin-who-made'); setWho(next); setWhoErrors({}) }} />
      {whoCanContinue(who) ? <FormActions sticky={false}><Button variant="primary" size="lg" iconRight={ArrowRight} onClick={doneWho}>Continue</Button></FormActions> : null}
    </StepCard>

    <StepCard anchor="walkin-step-2" n={2} title="Referring doctor" hint="Optional. From the request form, so the result can go back to them."
      current={step === 2} done={step > 2}
      summary={<StepSummary label="Change the referring doctor" onChange={created ? undefined : () => go(2)}>
        {outsideUsed(outside) ? [outside.prescriberName, outside.facilityName, outside.email].filter(Boolean).join(' · ') : 'None'}</StepSummary>}>
      <OutsideFields idBase="walkin-dr" outside={outside} errors={outsideErrors} contact paper="request form"
        onChange={next => { setOutside(next); setOutsideErrors({}) }} />
      <FormActions sticky={false}>
        {!outsideUsed(outside) ? <Button onClick={() => go(3)}>Skip</Button> : null}
        <Button variant="primary" size="lg" iconRight={ArrowRight} onClick={doneDoctor}>Continue</Button>
      </FormActions>
    </StepCard>

    <StepCard anchor="walkin-step-3" n={3} title="Tests" hint="Search, then tap to add or remove." current={step === 3} done={step > 3}
      summary={<StepSummary label="Change the tests" onChange={created ? undefined : () => go(3)}>
        {tests.map(test => test.name).join(', ')} · {priority === 'urgent' ? 'Urgent' : 'Routine'} · <strong className="tabular">{naira(total)}</strong></StepSummary>}>
      <CataloguePicker facilityId={facilityId} kind="lab_test" searchId={SEARCH_ID} withStock={false} emptyWord="tests"
        chosen={id => tests.some(test => test.id === id) ? 1 : 0} blockedWhy={() => null} onPick={entry => toggle(entry.item)} />
      {tests.length > 0 ? <section aria-labelledby="walkin-tests-title" className="flex flex-col gap-2">
        <h4 id="walkin-tests-title" className="m-0 text-title-3 text-ink">Tests asked for</h4>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {tests.map(test => <li key={test.id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 ring-1 ring-inset ring-line">
            <span className="min-w-0 text-[15px] font-medium text-ink">{test.name}</span>
            <span className="flex items-center gap-2">
              <span className="text-[15px] text-ink tabular">{naira(test.prices.cashKobo)}</span>
              <Button variant="danger" icon={Trash2} aria-label={`Remove ${test.name}`} onClick={() => { toggle(test); focus(SEARCH_ID) }}>Remove</Button>
            </span>
          </li>)}
        </ul>
      </section> : null}
      <div className="flex flex-col gap-1.5">
        <span id="walkin-priority-label" className="text-[13px] font-medium text-ink-2">Priority</span>
        <Segmented ariaLabel="Priority" value={priority} onChange={setPriority} className="self-start"
          options={[{ value: 'routine', label: 'Routine' }, { value: 'urgent', label: 'Urgent' }]} />
      </div>
      <Field label="Clinical note" htmlFor="walkin-note" optional hint="As written on the request form: symptoms, what to rule out." hintId="walkin-note-hint">
        <Textarea id="walkin-note" aria-describedby="walkin-note-hint" rows={3} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} />
      </Field>
      {testsError ? <p role="alert" className="m-0 text-[14px] font-medium text-danger-ink">{testsError}</p> : null}
      <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
        <span className="text-[15px] text-ink-2">Total</span>
        <span className="text-[24px] font-semibold text-ink tabular" aria-live="polite">{naira(total)}</span>
      </div>
      <FormActions><Button variant="primary" size="lg" iconRight={ArrowRight} onClick={doneTests}>Check the request</Button></FormActions>
    </StepCard>

    <StepCard anchor="walkin-step-4" n={4} title="Check and pay" current={step === 4} done={Boolean(cleared)}>
      <dl className="m-0 grid gap-x-4 gap-y-2 text-[15px] sm:grid-cols-[10rem_minmax(0,1fr)]">
        <dt className="text-ink-3">For</dt><dd className="m-0 text-ink">{whoLine(who)}</dd>
        <dt className="text-ink-3">Referred by</dt><dd className="m-0 text-ink">{outsideUsed(outside)
          ? [outside.prescriberName, outside.facilityName].filter(Boolean).join(', ') : 'Asked for by the patient'}</dd>
        {outside.email.trim() ? <><dt className="text-ink-3">Result to</dt><dd className="m-0 text-ink [overflow-wrap:anywhere]">{outside.email.trim()}</dd></> : null}
        <dt className="text-ink-3">Priority</dt><dd className="m-0 text-ink">{priority === 'urgent' ? 'Urgent' : 'Routine'}</dd>
        {note.trim() ? <><dt className="text-ink-3">Clinical note</dt><dd className="m-0 text-ink [overflow-wrap:anywhere]">{note.trim()}</dd></> : null}
      </dl>
      <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
        {tests.map(test => <li key={test.id} className="flex items-center justify-between gap-3 py-2.5">
          <span className="text-[15px] font-medium text-ink">{test.name}</span>
          <span className="text-[15px] text-ink tabular">{naira(test.prices.cashKobo)}</span>
        </li>)}
      </ul>
      <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
        <span className="text-[15px] font-medium text-ink">Total</span>
        <span className="text-[28px] font-semibold text-ink tabular">{naira(created?.bill.totalKobo ?? total)}</span>
      </div>
      {off ? <div id="walkin-off" tabIndex={-1} className="outline-none">
        <NotSwitchedOn message="Walk-in requests aren’t switched on for this facility yet. Nothing was saved." /></div> : null}
      {sendError ? <Alert intent="error" title="The request wasn’t made">{sendError} Check it and try again: the same request won’t be made twice.</Alert> : null}
      {!created && !off ? <FormActions>
        <Button onClick={() => go(3)}>Back to tests</Button>
        <Button variant="primary" size="lg" aria-busy={sending || undefined} aria-disabled={sending || undefined} onClick={() => void send()}>
          {sending ? 'Making the request…' : settings?.wherePaid === 'cashier' ? 'Make request and send to cashier' : 'Make request and take payment'}</Button>
      </FormActions> : null}
    </StepCard>

    {created ? <div className="flex flex-col gap-4">
      <p id="walkin-made" tabIndex={-1} className="m-0 inline-flex items-center gap-2 text-[15px] font-medium text-ink outline-none">
        <CircleCheck className="size-5 text-success-ink" aria-hidden />Request made · Bill {created.bill.number}</p>
      {!cleared && settings ? <PaymentStep facilityId={facilityId} summary={summaryOf(created.bill)} settings={settings}
        permissions={permissions} subject={null} verb="take the sample" headingId="walkin-pay"
        onCleared={summary => { setCleared(summary); focus('walkin-ready') }} /> : null}
      {cleared || !settings || !payFirst ? <Card className={cleared ? 'ring-success/40' : undefined}>
        <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
          <span className="inline-flex size-14 items-center justify-center rounded-full bg-success-soft text-success-ink"><FlaskConical className="size-7" aria-hidden /></span>
          <h2 id="walkin-ready" tabIndex={-1} className="m-0 text-title-1 text-ink outline-none">{cleared ? 'Ready for the sample' : 'Take the sample now'}</h2>
          {cleared ? <PaidLine summary={cleared} /> : <p className="m-0 text-body text-ink-2">Payment isn’t needed before the sample here.</p>}
          <div className="mt-2 flex w-full max-w-sm flex-col gap-2">
            <Button variant={cleared || !settings ? 'primary' : 'secondary'} size="lg" block iconRight={ArrowRight} onClick={() => navigate(workHref)}>Open in work list</Button>
            <Button block icon={Plus} onClick={again}>New walk-in</Button>
          </div>
        </div>
      </Card> : null}
    </div> : null}
  </FormPage>
}
