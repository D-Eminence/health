import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Camera, Check, CircleCheck, Droplet, FlaskConical, IdCard, Plus, Printer, Search, Trash2, UserPlus, X } from 'lucide-react'
import { Segmented } from '../../../kasuwa/interactive'
import { ConfirmSheet, FormActions, FormPage, PatientBanner, Step } from '../../../kasuwa/parts'
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Textarea, cx } from '../../../kasuwa/ui'
import { isAllowedPatientLookup, staffApi, type LabAccession } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import {
  commerce, type CatalogueItem, type LabWalkInPatient, type ListPage, type OutsideOrder, type WalkInAnswer, type WalkInLabRequest, type WorkItemBill,
} from '../commerce/api'
import { naira } from '../commerce/money'
import { NOT_SET_UP_UNSAVED, NotSwitchedOn } from '../commerce/NotSwitchedOn'
import { useOrderPhotoUpload, type UploadedPhoto } from '../commerce/orderPhoto'
import { useCommerceRead } from '../commerce/useCommerceRead'
import { useDeptAccess } from '../parts/access'
import { errorText } from '../parts/errors'
import { MadeHealthIdPanel, NewHealthIdForm } from '../pharmacy/newHealthId'
import { PaidLine, PaymentStep, usePaymentSettings } from '../pharmacy/pointOfCare'
import { billOwing, paysFirst, summaryOf } from '../pharmacy/pocFields'
import { Labels, usePrint, type SampleLabel } from './labPrint'
import { normalizeHealthId, normalizePhone, stampText } from './labText'

const WORK = '/provider/laboratory/work'
const SEARCH_ID = 'lab-new-search'
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^\+\d{10,15}$/

type StepNo = 1 | 2 | 3 | 4

interface Basics { name: string; age: string; sex: '' | 'female' | 'male'; phone: string; healthId: string | null }
const EMPTY_BASICS: Basics = { name: '', age: '', sex: '', phone: '', healthId: null }
type BasicsErrors = Partial<Record<'name' | 'age' | 'sex' | 'phone', string>>

interface Doctor { name: string; facility: string; email: string; phone: string; note: string; photo: UploadedPhoto | null }
const EMPTY_DOCTOR: Doctor = { name: '', facility: '', email: '', phone: '', note: '', photo: null }

function checkBasics(basics: Basics): BasicsErrors {
  const errors: BasicsErrors = {}
  if (basics.name.trim().length < 2) errors.name = 'Type their name, as for the label.'
  const age = Number(basics.age)
  if (basics.age.trim() === '' || !Number.isInteger(age) || age < 0 || age > 130) errors.age = 'Type their age in years, like 34. Under one: 0.'
  if (!basics.sex) errors.sex = 'Choose female or male: results are read against the right ranges.'
  if (!PHONE.test(normalizePhone(basics.phone))) errors.phone = 'Type a phone number, like 0803 123 4567, to send the result.'
  return errors
}

const doctorUsed = (doctor: Doctor) => Boolean(doctor.name.trim() || doctor.facility.trim() || doctor.email.trim() || doctor.phone.trim() || doctor.photo)

function outsideOf(doctor: Doctor): OutsideOrder | null {
  return doctorUsed(doctor) ? {
    prescriberName: doctor.name.trim(), facilityName: doctor.facility.trim() || null, writtenOn: null,
    prescriberEmail: doctor.email.trim() || null, prescriberPhone: doctor.phone.trim() ? normalizePhone(doctor.phone) : null,
    photoFileId: doctor.photo?.fileId ?? null,
  } : null
}

/** One Idempotency-Key per request as typed: sending the same again (after a lost answer, a refusal) reuses it. */
function useAttemptKey() {
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  return (signature: string) => {
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    return attempt.current.key
  }
}

/** A step: open while it is being done, folded to one line with Change once done, not shown before it is reached. */
function StepCard({ anchor, n, title, hint, current, done, summary, onChange, children }: {
  readonly anchor: string; readonly n: number; readonly title: string; readonly hint?: string; readonly current: boolean; readonly done: boolean
  readonly summary?: ReactNode; readonly onChange?: () => void; readonly children: ReactNode
}) {
  if (!current && !done) return null
  return <Step n={n} title={title} hint={current ? hint : undefined} done={done && !current}>
    <span id={anchor} tabIndex={-1} className="sr-only">Step {n}: {title}</span>
    {current ? children : <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="m-0 min-w-0 text-[15px] text-ink [overflow-wrap:anywhere]">{summary}</div>
      {onChange ? <Button variant="ghost" onClick={onChange} aria-label={`Change: ${title}`}>Change</Button> : null}
    </div>}
  </Step>
}

/**
 * New request at the lab (POINT_OF_CARE_SPEC §4, POST lab/walk-in-requests): the work first, identity optional. Tests
 * from the price list, then the patient's basics (name, age, sex, phone: enough to label the sample, read the result
 * against the right ranges and send it by SMS; their Health ID only if they have one), the referring doctor if any,
 * then payment as the facility takes it, the sample collected and labelled, and into the work list. A Health ID is
 * offered after, never before. A 404 says it isn't set up: nothing is pretended saved.
 */
export function NewRequest() {
  const { facilityId, permissions } = useDeptAccess()
  if (!facilityId || !permissions.includes('lab.walk-in.create')) return <FormPage title="New request" back={{ to: WORK, label: 'Back to the work list' }}>
    <EmptyState icon={FlaskConical} title="You can’t make lab requests here" description="Your role needs permission to take lab requests." />
  </FormPage>
  return <RequestForm key={facilityId} facilityId={facilityId} permissions={permissions} />
}

function RequestForm({ facilityId, permissions }: { readonly facilityId: string; readonly permissions: readonly string[] }) {
  const navigate = useNavigate()
  const focus = useFocusById()
  const settingsRead = usePaymentSettings(facilityId)
  const settings = settingsRead.status === 'ready' ? settingsRead.data : null
  const [step, setStep] = useState<StepNo>(1)
  const [tests, setTests] = useState<CatalogueItem[]>([])
  const [priority, setPriority] = useState<'routine' | 'urgent'>('routine')
  const [testsError, setTestsError] = useState('')
  const [basics, setBasics] = useState<Basics>(EMPTY_BASICS)
  const [basicsErrors, setBasicsErrors] = useState<BasicsErrors>({})
  const [doctor, setDoctor] = useState<Doctor>(EMPTY_DOCTOR)
  const [doctorEmailError, setDoctorEmailError] = useState('')
  const photoUpload = useOrderPhotoUpload(facilityId)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [off, setOff] = useState(false)
  const [created, setCreated] = useState<WalkInAnswer | null>(null)
  const [cleared, setCleared] = useState<NonNullable<WorkItemBill> | null>(null)
  const [payLater, setPayLater] = useState(false)
  const [collected, setCollected] = useState<readonly LabAccession[] | null>(null)
  const [collectLater, setCollectLater] = useState(false)
  const keyFor = useAttemptKey()
  const total = tests.reduce((sum, test) => sum + test.prices.cashKobo, 0)

  function go(next: StepNo) {
    setStep(next)
    focus(next === 1 ? SEARCH_ID : next === 2 ? 'lab-new-name' : `lab-new-step-${next}`)
  }
  function toggle(item: CatalogueItem) {
    setTestsError('')
    setTests(current => current.some(test => test.id === item.id) ? current.filter(test => test.id !== item.id) : [...current, item])
  }
  function doneTests() {
    if (tests.length === 0) { setTestsError('Add at least one test.'); focus(SEARCH_ID); return }
    go(2)
  }
  function doneBasics(event: FormEvent) {
    event.preventDefault()
    const errors = checkBasics(basics)
    setBasicsErrors(errors)
    const first = (['name', 'age', 'sex', 'phone'] as const).find(field => errors[field])
    if (first) { focus(first === 'sex' ? 'lab-new-sex' : `lab-new-${first}`); return }
    setBasics(current => ({ ...current, name: current.name.trim().replace(/\s+/g, ' '), phone: normalizePhone(current.phone) }))
    go(3)
  }
  function doneDoctor() {
    // The photo is sent with the request: wait for its upload to finish (the control says it is uploading).
    if (photoUpload.uploading) return
    if (doctor.email.trim() && !EMAIL.test(doctor.email.trim())) { setDoctorEmailError('Type an email like dr.bello@clinic.ng.'); focus('lab-new-dr-email'); return }
    if (doctorUsed(doctor) && !doctor.name.trim()) { setDoctorEmailError(''); focus('lab-new-dr-name'); return }
    go(4)
  }

  const patient: LabWalkInPatient = {
    name: basics.name.trim(), ageYears: Number(basics.age), sex: basics.sex === 'male' ? 'male' : 'female', phone: normalizePhone(basics.phone),
    healthId: basics.healthId,
  }
  const request: WalkInLabRequest = {
    patient, outside: outsideOf(doctor), tests: tests.map(test => ({ catalogueItemId: test.id })), clinicalNote: doctor.note.trim() || null, priority,
  }
  async function send() {
    if (sending || created) return
    setSending(true); setSendError('')
    const result = await commerce.labWalkIn(facilityId, request, keyFor(JSON.stringify([facilityId, request])))
    setSending(false)
    if (result.ok) {
      setCreated(result.data)
      if (!billOwing(summaryOf(result.data.bill))) setCleared(summaryOf(result.data.bill))
      focus(['lab-new-pay', 'lab-new-collect-title'])
      return
    }
    if (result.notAvailable) { setOff(true); focus('lab-new-off'); return }
    setSendError(result.error)
  }
  function again() {
    setStep(1); setTests([]); setPriority('routine'); setBasics(EMPTY_BASICS); photoUpload.release(doctor.photo); setDoctor(EMPTY_DOCTOR)
    setCreated(null); setCleared(null); setPayLater(false); setCollected(null); setCollectLater(false); setSendError(''); setOff(false)
    focus(SEARCH_ID)
  }

  const banner = <PatientBanner compact name={patient.name || 'New patient'} hid={[basics.healthId ?? 'No Health ID', basics.age.trim() ? `${basics.age.trim()} y` : null].filter(Boolean).join(' · ')}
    sex={basics.sex || null} />
  const paid = cleared !== null
  const paymentDue = created !== null && !paid && settings !== null && !payLater
  const paymentFirst = paysFirst(settings, 'lab')
  const readyToCollect = created !== null && (paid || payLater || settings === null || !paymentFirst) && !paymentDue
  const finished = created !== null && (collected !== null || collectLater)

  return <FormPage title="New request" back={{ to: WORK, label: 'Back to the work list' }} wide
    description={created ? undefined : `Step ${step} of 4`}>
    <StepCard anchor="lab-new-step-1" n={1} title="Tests" hint="Search, then tap to add or remove." current={step === 1 && !created} done={step > 1}
      onChange={created ? undefined : () => go(1)}
      summary={<>{tests.map(test => test.name).join(', ')} · {priority === 'urgent' ? 'Urgent' : 'Routine'} · <strong className="tabular">{naira(total)}</strong></>}>
      <TestPicker facilityId={facilityId} chosen={tests} onToggle={toggle} />
      {tests.length > 0 ? <ul aria-label="Tests asked for" className="m-0 flex list-none flex-col divide-y divide-line p-0">
        {tests.map(test => <li key={test.id} className="flex items-center justify-between gap-3 py-2">
          <span className="min-w-0 text-[15px] font-medium text-ink">{test.name}</span>
          <span className="flex items-center gap-1">
            <span className="text-[15px] text-ink tabular">{naira(test.prices.cashKobo)}</span>
            <Button variant="danger" icon={Trash2} aria-label={`Remove ${test.name}`} className="!px-0 w-11" onClick={() => { toggle(test); focus(SEARCH_ID) }} />
          </span>
        </li>)}
      </ul> : null}
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-2">Priority</span>
        <Segmented ariaLabel="Priority" value={priority} onChange={setPriority} className="self-start"
          options={[{ value: 'routine', label: 'Routine' }, { value: 'urgent', label: 'Urgent' }]} />
      </div>
      {testsError ? <p role="alert" className="m-0 text-[14px] font-medium text-danger-ink">{testsError}</p> : null}
      <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
        <span className="text-[15px] text-ink-2">Total</span>
        <span className="text-[24px] font-semibold text-ink tabular" aria-live="polite">{naira(total)}</span>
      </div>
      <FormActions><Button variant="primary" size="lg" iconRight={ArrowRight} onClick={doneTests}>Continue</Button></FormActions>
    </StepCard>

    <StepCard anchor="lab-new-step-2" n={2} title="Patient" hint="Name, age, sex and phone: for the label, the ranges and the result."
      current={step === 2 && !created} done={step > 2} onChange={created ? undefined : () => go(2)}
      summary={<>{patient.name} · {basics.age} y · {basics.sex === 'male' ? 'Male' : 'Female'} · {patient.phone}{basics.healthId ? ` · ${basics.healthId}` : ''}</>}>
      <form className="flex flex-col gap-4" noValidate onSubmit={doneBasics}>
        <FindByHealthId facilityId={facilityId} canLook={permissions.includes('identity.patient.read')} linked={basics.healthId}
          onFound={found => { setBasics(current => ({ ...current, ...found })); setBasicsErrors({}) }}
          onUnlink={() => setBasics(current => ({ ...current, healthId: null }))} />
        <BasicsFields basics={basics} errors={basicsErrors} onChange={next => { setBasics(next); setBasicsErrors({}) }} />
        <FormActions><Button type="submit" variant="primary" size="lg" iconRight={ArrowRight}>Continue</Button></FormActions>
      </form>
    </StepCard>

    <StepCard anchor="lab-new-step-3" n={3} title="Referring doctor" hint="Optional. From the request form, so the result can go back to them."
      current={step === 3 && !created} done={step > 3} onChange={created ? undefined : () => go(3)}
      summary={doctorUsed(doctor) ? [doctor.name, doctor.facility, doctor.email].filter(Boolean).join(' · ') : 'None'}>
      <DoctorFields doctor={doctor} emailError={doctorEmailError} photoUpload={photoUpload} nameMissing={doctorUsed(doctor) && !doctor.name.trim()}
        onChange={next => { setDoctor(next); setDoctorEmailError('') }} />
      <FormActions>
        {!doctorUsed(doctor) ? <Button onClick={() => go(4)}>Skip</Button> : null}
        <Button variant="primary" size="lg" iconRight={ArrowRight} onClick={doneDoctor}>Continue</Button>
      </FormActions>
    </StepCard>

    <StepCard anchor="lab-new-step-4" n={4} title="Check and pay" current={step === 4 && !created} done={created !== null}
      summary={<>Request made · Bill <span className="tabular">{created?.bill.number}</span> · <strong className="tabular">{naira(created?.bill.totalKobo ?? total)}</strong></>}>
      {banner}
      <dl className="m-0 grid gap-x-4 gap-y-2 text-[15px] @md:grid-cols-[9rem_minmax(0,1fr)]">
        <dt className="text-ink-3">Phone</dt><dd className="m-0 text-ink tabular">{patient.phone}</dd>
        <dt className="text-ink-3">Referred by</dt><dd className="m-0 text-ink break-words">{doctorUsed(doctor) ? [doctor.name, doctor.facility].filter(Boolean).join(', ') : 'Asked for by the patient'}</dd>
        <dt className="text-ink-3">Priority</dt><dd className="m-0 text-ink">{priority === 'urgent' ? 'Urgent' : 'Routine'}</dd>
      </dl>
      <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
        {tests.map(test => <li key={test.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5">
          <span className="min-w-0 text-[15px] font-medium text-ink break-words">{test.name}</span><span className="text-[15px] text-ink tabular">{naira(test.prices.cashKobo)}</span>
        </li>)}
      </ul>
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-t border-line pt-3">
        <span className="text-[15px] font-medium text-ink">Total</span>
        <span className="text-[28px] font-semibold text-ink tabular">{naira(total)}</span>
      </div>
      {off ? <div id="lab-new-off" tabIndex={-1} className="outline-none"><NotSwitchedOn message={NOT_SET_UP_UNSAVED} /></div> : null}
      {sendError ? <Alert intent="error" title="The request wasn’t made">{sendError} Check it and try again: the same request won’t be made twice.</Alert> : null}
      {!off ? <FormActions>
        <Button onClick={() => go(3)}>Back</Button>
        <Button variant="primary" size="lg" loading={sending} onClick={() => void send()}>
          {sending ? 'Making the request…' : settings?.wherePaid === 'cashier' ? 'Make request and send to cashier' : settings ? 'Make request and take payment' : 'Make request'}</Button>
      </FormActions> : null}
    </StepCard>

    {paymentDue && created && settings ? <div className="flex flex-col gap-3">
      <PaymentStep facilityId={facilityId} summary={summaryOf(created.bill)} settings={settings} permissions={permissions} subject={banner}
        verb="take the sample" headingId="lab-new-pay" onCleared={summary => { setCleared(summary); focus('lab-new-collect-title') }} />
      {!paymentFirst ? <Button className="self-end" onClick={() => { setPayLater(true); focus('lab-new-collect-title') }}>Pay later</Button> : null}
    </div> : null}
    {paid && cleared ? <PaidLine summary={cleared} /> : null}

    {readyToCollect && created && !finished ? <CollectNow facilityId={facilityId} permissions={permissions} created={created} tests={tests}
      patient={patient} banner={banner} clinicalNote={request.clinicalNote ?? null} doctor={doctor.name.trim() || null}
      onCollected={accessions => { setCollected(accessions); focus('lab-new-done') }} onLater={() => { setCollectLater(true); focus('lab-new-done') }} /> : null}

    {finished && created ? <Card>
      <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
        <span className="inline-flex size-14 items-center justify-center rounded-full bg-success-soft text-success-ink"><CircleCheck className="size-7" aria-hidden /></span>
        <h2 id="lab-new-done" tabIndex={-1} className="m-0 text-title-1 text-ink outline-none">{collected ? 'Sample taken. In the work list.' : 'In the work list'}</h2>
        <p className="m-0 text-body text-ink-2">{collected ? 'Next: receive it and run the test.' : 'Waiting for the sample.'} Bill <span className="tabular">{created.bill.number}</span>.</p>
        <div className="mt-2 flex w-full max-w-sm flex-col gap-2">
          <Button block icon={Plus} onClick={again}>New request</Button>
          <Button variant="primary" size="lg" block iconRight={ArrowRight}
            onClick={() => navigate(`${WORK}?stage=${collected ? 'testing' : 'collect'}`)}>Open work list</Button>
        </div>
      </div>
    </Card> : null}
    {finished && created && !basics.healthId ? <OfferHealthId facilityId={facilityId} billId={created.bill.id} name={patient.name} /> : null}
  </FormPage>
}

// ----------------------------------------------------------------- tests --
function TestPicker({ facilityId, chosen, onToggle }: {
  readonly facilityId: string; readonly chosen: readonly CatalogueItem[]; readonly onToggle: (item: CatalogueItem) => void
}) {
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => { const timer = setTimeout(() => setQ(query.trim()), 200); return () => clearTimeout(timer) }, [query])
  const read = useCommerceRead<ListPage<CatalogueItem>>(`lab-tests:${facilityId}:${q}`, signal => commerce.catalogueItems(facilityId, { kind: 'lab_test', q }, signal))
  const list = (read.data?.items ?? []).filter(item => item.active && item.kind === 'lab_test')
  const searching = q !== query.trim() || read.status === 'loading'
  return <div className="flex flex-col gap-3">
    <label htmlFor={SEARCH_ID} className="sr-only">Search lab tests</label>
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink-3" aria-hidden />
      <Input id={SEARCH_ID} type="search" value={query} autoComplete="off" placeholder="Search tests by name" className="h-12 text-base"
        style={{ paddingLeft: '2.75rem' }} onChange={event => setQuery(event.target.value)} />
    </div>
    <div role="status" aria-live="polite" className="sr-only">{searching ? 'Searching' : `${list.length} found`}</div>
    {read.status === 'error' && list.length === 0 ? <Alert intent="error" title="Couldn’t search the tests"
      action={<Button size="sm" onClick={read.reload}>Try again</Button>}>{read.error}</Alert> : null}
    {read.status === 'loading' && list.length === 0 ? <p className="m-0 text-[14px] text-ink-3">Loading the tests…</p> : null}
    {(read.status === 'ready' || read.status === 'off') && list.length === 0
      ? <p className="m-0 text-[14px] text-ink-2">{query.trim() ? `No tests match “${query.trim()}”. Check the spelling.` : 'No tests on the price list yet. Add them under Tests & prices.'}</p> : null}
    {list.length > 0 ? <ul aria-label="Lab tests" className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-3 p-0">
      {list.map(item => {
        const added = chosen.some(test => test.id === item.id)
        return <li key={item.id} className="min-w-0">
          <button type="button" onClick={() => onToggle(item)} aria-pressed={added}
            aria-label={`${added ? 'Remove' : 'Add'}: ${item.name}, ${naira(item.prices.cashKobo)}`}
            className={cx('flex min-h-20 w-full cursor-pointer flex-wrap items-start gap-3 rounded-2xl border-0 bg-surface p-3 text-left ring-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]',
              added ? 'ring-2 ring-brand' : 'ring-line hover:bg-subtle')}>
            <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-subtle text-ink-3 ring-1 ring-inset ring-line"><FlaskConical className="size-6" strokeWidth={1.6} /></span>
            <span className="flex min-w-0 flex-[1_1_8rem] flex-col gap-0.5">
              <span className="text-[16px] font-semibold leading-snug text-ink break-words">{item.name}</span>
              {item.packSize ? <span className="text-[13px] text-ink-2">{item.packSize}</span> : null}
              <span className="mt-0.5 text-[16px] font-semibold text-ink tabular">{naira(item.prices.cashKobo)}</span>
            </span>
            {added ? <Badge size="sm" tone="brand" icon={Check}>Added</Badge> : <Plus className="mt-1 size-5 shrink-0 text-ink-3" aria-hidden />}
          </button>
        </li>
      })}
    </ul> : null}
  </div>
}

// --------------------------------------------------------------- patient --
const fieldProps = (id: string, error?: string) => ({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `${id}-error` : undefined })

function BasicsFields({ basics, errors, onChange }: { readonly basics: Basics; readonly errors: BasicsErrors; readonly onChange: (next: Basics) => void }) {
  const set = (patch: Partial<Basics>) => onChange({ ...basics, ...patch })
  return <div className="flex flex-col gap-4">
    <Field label="Full name" htmlFor="lab-new-name" error={errors.name} errorId="lab-new-name-error">
      <Input {...fieldProps('lab-new-name', errors.name)} value={basics.name} maxLength={200} autoComplete="off" className="h-12 text-base"
        onChange={event => set({ name: event.target.value })} />
    </Field>
    <div className="grid gap-4 @md:grid-cols-[8rem_minmax(0,1fr)]">
      <Field label="Age (years)" htmlFor="lab-new-age" error={errors.age} errorId="lab-new-age-error">
        <Input {...fieldProps('lab-new-age', errors.age)} type="number" inputMode="numeric" min={0} max={130} value={basics.age} className="h-12 text-base tabular"
          onChange={event => set({ age: event.target.value })} />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span id="lab-new-sex-label" className="text-[13px] font-medium text-ink-2">Sex</span>
        <div id="lab-new-sex" tabIndex={-1} className="outline-none" aria-describedby={errors.sex ? 'lab-new-sex-error' : undefined}>
          <Segmented<Basics['sex']> ariaLabel="Sex" value={basics.sex} onChange={sex => set({ sex })}
            options={[{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }]} />
        </div>
        {errors.sex ? <p id="lab-new-sex-error" className="m-0 text-xs font-medium text-danger-ink">{errors.sex}</p> : null}
      </div>
    </div>
    <Field label="Phone" htmlFor="lab-new-phone" error={errors.phone} errorId="lab-new-phone-error" hint="The result is sent here by SMS." hintId="lab-new-phone-hint">
      <Input {...fieldProps('lab-new-phone', errors.phone)} aria-describedby={errors.phone ? 'lab-new-phone-error' : 'lab-new-phone-hint'}
        type="tel" inputMode="tel" value={basics.phone} maxLength={32} autoComplete="off" className="h-12 text-base tabular" placeholder="0803 123 4567"
        onChange={event => set({ phone: event.target.value })} />
    </Field>
  </div>
}

/**
 * "Find by Health ID": a small link, never a gate. With patient lookup allowed it fills the name, age and sex from their
 * record; otherwise the Health ID is added to the request and the basics are typed as for anyone else.
 */
function FindByHealthId({ facilityId, canLook, linked, onFound, onUnlink }: {
  readonly facilityId: string; readonly canLook: boolean; readonly linked: string | null
  readonly onFound: (found: Partial<Basics>) => void; readonly onUnlink: () => void
}) {
  const [open, setOpen] = useState(false)
  const [hid, setHid] = useState('')
  const [error, setError] = useState('')
  const [said, setSaid] = useState('')
  const [busy, setBusy] = useState(false)
  const focus = useFocusById()
  if (linked) return <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-subtle px-3 py-2 ring-1 ring-inset ring-line">
    <span className="inline-flex items-center gap-2 text-[14px] text-ink"><IdCard className="size-4 text-ink-3" aria-hidden />
      <span>Health ID <strong className="tracking-[.04em]">{linked}</strong>{said ? <span className="text-ink-2"> · {said}</span> : null}</span></span>
    <Button variant="ghost" size="sm" icon={X} onClick={() => { onUnlink(); setSaid(''); setHid('') }}>Remove</Button>
  </div>
  if (!open) return <Button variant="link" icon={IdCard} className="self-start" onClick={() => { setOpen(true); focus('lab-new-hid') }}>
    Find by Health ID</Button>
  async function find() {
    if (busy) return
    const value = normalizeHealthId(hid)
    if (!/^HID-[A-Z0-9]{4,}$/.test(value)) { setError('Type the Health ID on their card, like HID-ADA2345.'); document.getElementById('lab-new-hid')?.focus(); return }
    setError('')
    if (!canLook) { setSaid('Type their details below.'); onFound({ healthId: value }); return }
    setBusy(true)
    try {
      const lookup = await staffApi.lookupPatient(facilityId, value)
      if (isAllowedPatientLookup(lookup)) {
        const person = lookup.patient
        const born = person.dateOfBirth ? new Date(person.dateOfBirth) : null
        const now = new Date()
        let years = born && !Number.isNaN(born.getTime()) ? now.getFullYear() - born.getFullYear() : null
        if (years !== null && born && now < new Date(now.getFullYear(), born.getMonth(), born.getDate())) years -= 1
        const name = person.fullName ?? [person.firstName, person.lastName].filter(Boolean).join(' ')
        setSaid('Details filled in. Check them and add the phone.')
        onFound({ healthId: person.hid || value, ...(name ? { name } : {}), ...(years !== null ? { age: String(years) } : {}),
          ...(person.gender === 'female' || person.gender === 'male' ? { sex: person.gender } : {}) })
      } else { setSaid('Type their details below.'); onFound({ healthId: value }) }
    } catch {
      // A refusal (no approval to see their record) still lets the Health ID go with the request.
      setSaid('Type their details below.')
      onFound({ healthId: value })
    } finally { setBusy(false) }
  }
  return <div className="flex flex-col gap-2 rounded-lg p-3 ring-1 ring-inset ring-line">
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Health ID" htmlFor="lab-new-hid" error={error} errorId="lab-new-hid-error" className="min-w-0 flex-[1_1_12rem]">
        <Input {...fieldProps('lab-new-hid', error)} value={hid} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="HID-ADA2345"
          className="h-11 tracking-[.04em]" onChange={event => { setHid(event.target.value); setError('') }}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void find() } }} />
      </Field>
      <Button onClick={() => { setOpen(false); setError('') }}>Cancel</Button>
      <Button variant="soft" icon={Search} loading={busy} onClick={() => void find()}>Find</Button>
    </div>
  </div>
}

// ---------------------------------------------------------------- doctor --
function DoctorFields({ doctor, emailError, nameMissing, photoUpload, onChange }: {
  readonly doctor: Doctor; readonly emailError: string; readonly nameMissing: boolean
  readonly photoUpload: ReturnType<typeof useOrderPhotoUpload>; readonly onChange: (next: Doctor) => void
}) {
  const set = (patch: Partial<Doctor>) => onChange({ ...doctor, ...patch })
  return <div className="flex flex-col gap-4">
    <div className="grid gap-4 @md:grid-cols-2">
      <Field label="Doctor’s name" htmlFor="lab-new-dr-name" hint={nameMissing ? 'Add the doctor’s name, or clear the doctor’s details.' : undefined} hintId="lab-new-dr-name-hint">
        <Input id="lab-new-dr-name" value={doctor.name} maxLength={200} autoComplete="off" className="h-11" placeholder="Dr Funmi Adeyemi"
          aria-describedby={nameMissing ? 'lab-new-dr-name-hint' : undefined} onChange={event => set({ name: event.target.value })} />
      </Field>
      <Field label="Hospital or clinic" htmlFor="lab-new-dr-facility" optional>
        <Input id="lab-new-dr-facility" value={doctor.facility} maxLength={200} autoComplete="off" className="h-11" onChange={event => set({ facility: event.target.value })} />
      </Field>
      <Field label="Doctor’s email" htmlFor="lab-new-dr-email" optional error={emailError} errorId="lab-new-dr-email-error" hint="To send the result." hintId="lab-new-dr-email-hint">
        <Input {...fieldProps('lab-new-dr-email', emailError)} aria-describedby={emailError ? 'lab-new-dr-email-error' : 'lab-new-dr-email-hint'}
          type="email" inputMode="email" value={doctor.email} maxLength={254} autoComplete="off" className="h-11" onChange={event => set({ email: event.target.value })} />
      </Field>
      <Field label="Doctor’s phone" htmlFor="lab-new-dr-phone" optional>
        <Input id="lab-new-dr-phone" type="tel" inputMode="tel" value={doctor.phone} maxLength={32} autoComplete="off" className="h-11" onChange={event => set({ phone: event.target.value })} />
      </Field>
    </div>
    <Field label="Clinical note" htmlFor="lab-new-note" optional hint="As written on the form: symptoms, what to rule out." hintId="lab-new-note-hint">
      <Textarea id="lab-new-note" aria-describedby="lab-new-note-hint" rows={2} maxLength={1000} value={doctor.note} onChange={event => set({ note: event.target.value })} />
    </Field>
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-medium text-ink-2">Photo of the request form <span className="font-normal text-ink-3">(optional)</span></span>
      {doctor.photo
        ? <div className="flex items-start gap-3">
          <img src={doctor.photo.preview} alt="The request form, as photographed" className="max-h-48 max-w-[60%] rounded-lg object-contain ring-1 ring-line" />
          <Button icon={X} onClick={() => { photoUpload.release(doctor.photo); set({ photo: null }) }}>Remove photo</Button>
        </div>
        : <label className={cx('inline-flex min-h-11 items-center gap-2 self-start rounded-md bg-surface px-4 text-sm font-medium text-ink ring-1 ring-inset ring-line-strong focus-within:shadow-[var(--shadow-focus)]',
          photoUpload.uploading ? 'cursor-progress' : 'cursor-pointer hover:bg-subtle')}>
          <Camera className="size-4" aria-hidden />{photoUpload.uploading ? 'Uploading the photo…' : 'Take or choose a photo'}
          <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={photoUpload.uploading}
            aria-invalid={photoUpload.error ? true : undefined} aria-describedby={photoUpload.error ? 'lab-new-photo-error' : undefined}
            onChange={event => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void photoUpload.upload(file).then(photo => { if (photo) set({ photo }) })
            }} />
        </label>}
      {photoUpload.error ? <p id="lab-new-photo-error" role="alert" className="m-0 text-xs font-medium text-danger-ink">{photoUpload.error}</p> : null}
    </div>
  </div>
}

// --------------------------------------------------------------- collect --
/**
 * Collect the samples now: one accession per test (its sample type from the price list), each marked collected, after
 * the patient is confirmed; then the labels print. Or later, from the work list. An accession made before a failed
 * collect is kept, so a retry makes no second one.
 */
function CollectNow({ facilityId, permissions, created, tests, patient, banner, clinicalNote, doctor, onCollected, onLater }: {
  readonly facilityId: string; readonly permissions: readonly string[]; readonly created: WalkInAnswer; readonly tests: readonly CatalogueItem[]
  readonly patient: LabWalkInPatient; readonly banner: ReactNode; readonly clinicalNote: string | null; readonly doctor: string | null
  readonly onCollected: (accessions: readonly LabAccession[]) => void; readonly onLater: () => void
}) {
  // Each work item's test: the bill's line for it names the price-list item; else the order the tests were sent in.
  const testOf = (workItemId: string, index: number) => {
    const line = created.bill.lines.find(entry => entry.workItemId === workItemId)
    return tests.find(test => test.id === line?.catalogueItemId) ?? tests[index]
  }
  const rows = created.workItemIds.map((workItemId, index) => ({ workItemId, test: testOf(workItemId, index) }))
  const [types, setTypes] = useState<Record<string, string>>(() => Object.fromEntries(rows.map(row => [row.workItemId, row.test?.packSize ?? ''])))
  const [reason, setReason] = useState(clinicalNote ?? (doctor ? `Asked for by ${doctor}` : 'Walk-in request'))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const made = useRef(new Map<string, LabAccession>())
  const [done, setDone] = useState<readonly LabAccession[] | null>(null)
  const { print, area } = usePrint()
  const can = permissions.includes('lab.accession.create') && permissions.includes('lab.specimen.collect')

  function check(event: FormEvent) {
    event.preventDefault()
    const found: Record<string, string> = {}
    for (const row of rows) if (!types[row.workItemId]?.trim()) found[row.workItemId] = 'Type the sample, like Blood.'
    if (!reason.trim()) found.reason = 'Say why the test is done.'
    setErrors(found); setProblem('')
    const first = Object.keys(found)[0]
    if (first) { document.getElementById(first === 'reason' ? 'lab-new-reason' : `lab-new-type-${first}`)?.focus(); return }
    setAsking(true)
  }
  async function collect() {
    if (busy) return
    setBusy(true); setProblem('')
    try {
      for (const row of rows) {
        let accession = made.current.get(row.workItemId)
        if (!accession) { accession = await staffApi.createLabAccession(facilityId, row.workItemId, types[row.workItemId]!.trim(), reason.trim()); made.current.set(row.workItemId, accession) }
        for (const specimen of accession.specimens.filter(entry => entry.status === 'required')) {
          const next = await staffApi.transitionSpecimen(facilityId, accession.id, specimen, 'collect', '')
          accession = { ...accession, specimens: accession.specimens.map(entry => entry.id === next.id ? next : entry) }
          made.current.set(row.workItemId, accession)
        }
      }
      setAsking(false)
      setDone([...made.current.values()])
    } catch (caught) {
      setAsking(false)
      setProblem(errorText(caught, 'The samples could not be recorded. Try again: nothing is made twice.'))
    } finally { setBusy(false) }
  }
  const labels: SampleLabel[] = (done ?? []).flatMap((accession, index) => accession.specimens.map(specimen => ({
    key: specimen.id, name: patient.name, ageSex: `${patient.ageYears} y · ${patient.sex === 'male' ? 'Male' : 'Female'}`,
    test: `${rows.find(row => row.workItemId === accession.workItemId)?.test?.name ?? rows[index]?.test?.name ?? 'Lab test'} · ${specimen.specimenType}`,
    requestNumber: accession.accessionNumber, date: stampText(null),
  })))

  return <Card>
    <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
      <span aria-hidden="true" className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-fill text-white"><Droplet className="size-4" /></span>
      <h2 id="lab-new-collect-title" tabIndex={-1} className="m-0 text-title-3 text-ink outline-none">{done ? 'Label the samples' : 'Collect the sample'}</h2>
    </div>
    <div className="flex flex-col gap-4 p-5">
      {!can ? <>
        <p className="m-0 text-[15px] text-ink-2">Your role can’t collect samples. The request waits in the work list for a colleague who can.</p>
        <FormActions sticky={false}><Button variant="primary" size="lg" iconRight={ArrowRight} onClick={onLater}>Done</Button></FormActions>
      </> : done ? <>
        <p className="m-0 inline-flex items-center gap-2 text-[15px] font-medium text-success-ink" role="status"><CircleCheck className="size-5" aria-hidden />
          {labels.length > 1 ? `${labels.length} samples collected.` : 'Sample collected.'} Print the {labels.length > 1 ? 'labels' : 'label'} and stick {labels.length > 1 ? 'them' : 'it'} on.</p>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">{labels.map(label => <li key={label.key}
          className="rounded-lg px-3 py-2 text-[14px] ring-1 ring-inset ring-line"><strong>{label.name}</strong> · {label.ageSex}<br />{label.test} · <span className="tabular">{label.requestNumber}</span></li>)}</ul>
        <FormActions sticky={false}>
          <Button icon={Printer} onClick={() => print('label', <Labels labels={labels} />)}>{labels.length > 1 ? 'Print labels' : 'Print label'}</Button>
          <Button variant="primary" size="lg" iconRight={ArrowRight} onClick={() => onCollected(done)}>Done</Button>
        </FormActions>
      </> : <form className="flex flex-col gap-4" noValidate onSubmit={check}>
        {rows.map(row => <Field key={row.workItemId} label={`Sample for ${row.test?.name ?? 'the test'}`} htmlFor={`lab-new-type-${row.workItemId}`}
          error={errors[row.workItemId]} errorId={`lab-new-type-${row.workItemId}-error`}>
          <Input {...fieldProps(`lab-new-type-${row.workItemId}`, errors[row.workItemId])} value={types[row.workItemId] ?? ''} maxLength={240} autoComplete="off" className="h-11"
            placeholder="Blood, urine, swab…" onChange={event => { setTypes(current => ({ ...current, [row.workItemId]: event.target.value })); setErrors({}) }} />
        </Field>)}
        <Field label="Why the test" htmlFor="lab-new-reason" error={errors.reason} errorId="lab-new-reason-error">
          <Input {...fieldProps('lab-new-reason', errors.reason)} value={reason} maxLength={500} autoComplete="off" className="h-11" onChange={event => { setReason(event.target.value); setErrors({}) }} />
        </Field>
        {problem ? <Alert intent="error" size="sm">{problem}</Alert> : null}
        <FormActions sticky={false}>
          <Button onClick={onLater}>Collect later</Button>
          <Button type="submit" variant="primary" size="lg" icon={Droplet}>{rows.length > 1 ? 'Collect samples' : 'Collect sample'}</Button>
        </FormActions>
        <ConfirmSheet open={asking} onClose={() => setAsking(false)} title="Collect the sample" subject={banner} busy={busy}
          effect={<>Collect {rows.length > 1 ? `${rows.length} samples` : 'the sample'} from <strong>{patient.name}</strong>?</>}
          undo="Check the name with the person before you take it." confirmLabel={rows.length > 1 ? 'Collect samples' : 'Collect sample'} onConfirm={() => void collect()} />
      </form>}
    </div>
    {area}
  </Card>
}

// ------------------------------------------------------------- health id --
/**
 * After the request, never before: a Health ID for someone who has none (the facility registration flow), then the
 * request's bill and its work joined to it (POST bills/:billId/patient).
 */
function OfferHealthId({ facilityId, billId, name }: { readonly facilityId: string; readonly billId: string; readonly name: string }) {
  const [open, setOpen] = useState(false)
  const [made, setMade] = useState<{ hid: string; name: string; email: string | null } | null>(null)
  const [joined, setJoined] = useState<'yes' | 'off' | string | null>(null)
  const focus = useFocusById()
  const key = useRef(crypto.randomUUID())
  async function join(hid: string) {
    const result = await commerce.attachPatient(facilityId, billId, hid, key.current)
    setJoined(result.ok ? 'yes' : result.notAvailable ? 'off' : result.error)
  }
  return <Card>
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink"><UserPlus className="size-5" /></span>
        <div className="min-w-0">
          <h2 className="m-0 text-title-3 text-ink">Give them a Health ID</h2>
          <p className="m-0 text-[14px] text-ink-2">Optional. {name}’s results then also show on their Health ID, at any facility.</p>
        </div>
      </div>
      {made ? <>
        <MadeHealthIdPanel idBase="lab-offer" made={made} />
        {joined === 'yes' ? <p role="status" className="m-0 text-[14px] font-medium text-success-ink">This request is on their Health ID.</p>
          : joined === 'off' ? <NotSwitchedOn compact message="This request couldn’t be put on their Health ID here. Contact support." />
            : joined ? <Alert intent="error" size="sm" action={<Button size="sm" onClick={() => void join(made.hid)}>Try again</Button>}>{joined}</Alert> : null}
      </> : open ? <NewHealthIdForm idBase="lab-offer" facilityId={facilityId} place="lab" otcFallback={false}
        onMade={value => { setMade(value); focus('lab-offer-made'); void join(value.hid) }} />
        : <Button className="self-start" icon={UserPlus} onClick={() => { setOpen(true); focus('lab-offer-new-first') }}>Make a Health ID</Button>}
    </div>
  </Card>
}
