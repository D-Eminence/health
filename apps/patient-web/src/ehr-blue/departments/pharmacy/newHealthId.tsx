import { useEffect, useState, type FormEvent } from 'react'
import { CircleCheck, Printer, UserPlus } from 'lucide-react'
import { FormActions } from '../../../kasuwa/parts'
import { Alert, Button, Field, Input, Select } from '../../../kasuwa/ui'
import { staffApi, type RegistrationCapabilities, type RegistrationCase, type ResolveNinInput } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { REGISTRATION_COMPLETED, REGISTRATION_GENDERS, registrationErrorText, useCommandKey } from '../../../staff/registrationFlow'
import { useDeptAccess } from '../parts/access'
import type { MadeHealthId } from './walkIn'
import '../commerce/commerce.css'

/*
 * A walk-in with no Health ID gets a real one (POINT_OF_CARE_SPEC §4), made through the facility registration the
 * Registration page uses: the NIN check (`nin/resolve`) opens a case; no match → approve a new Health ID; a possible
 * match → staff say "This is them" (link) or "Someone new" (approve); then `enroll` sends it to their email. Each step
 * carries its own Idempotency-Key, reused for an unchanged retry, so nothing is made twice. Nothing is kept outside
 * this screen's memory.
 */

interface Draft {
  firstName: string; lastName: string; dateOfBirth: string; gender: '' | NonNullable<ResolveNinInput['gender']>
  nin: string; email: string; consent: boolean
}
const EMPTY: Draft = { firstName: '', lastName: '', dateOfBirth: '', gender: '', nin: '', email: '', consent: false }
type DraftErrors = Partial<Record<keyof Draft, string>>
const ORDER: readonly (keyof Draft)[] = ['firstName', 'lastName', 'dateOfBirth', 'nin', 'email', 'consent']
const FIELD_ID: Readonly<Record<keyof Draft, string>> = {
  firstName: 'first', lastName: 'last', dateOfBirth: 'dob', gender: 'sex', nin: 'nin', email: 'email', consent: 'consent',
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The reason Identity records with each step: what happened, in the staff member's place of work. */
const REASON = {
  pharmacy: 'Walk-in at the pharmacy: the customer asked for a Health ID and agreed to get one.',
  lab: 'Walk-in at the lab: the patient asked for a Health ID and agreed to get one.',
} as const

type Phase =
  | { kind: 'form' }
  | { kind: 'match'; registration: RegistrationCase }
  | { kind: 'send'; registration: RegistrationCase }

function check(draft: Draft, ninNeeded: boolean, ninAsked: boolean, today: string): DraftErrors {
  const errors: DraftErrors = {}
  if (!draft.firstName.trim()) errors.firstName = 'Type their first name as on their ID.'
  if (!draft.lastName.trim()) errors.lastName = 'Type their last name as on their ID.'
  if (!draft.dateOfBirth) errors.dateOfBirth = 'Type their date of birth.'
  else if (draft.dateOfBirth > today) errors.dateOfBirth = 'The date of birth can’t be after today.'
  const nin = draft.nin.replace(/\s/g, '')
  if (ninAsked && (ninNeeded || nin) && !/^\d{11}$/.test(nin)) errors.nin = 'Type the 11 digit NIN.'
  if (!EMAIL.test(draft.email.trim())) errors.email = draft.email.trim() ? 'Type an email like ada@example.com.' : 'Type their email: their Health ID is sent there.'
  if (!draft.consent) errors.consent = 'Ask them first. They must agree to get a Health ID.'
  return errors
}

export function NewHealthIdForm({ idBase, facilityId, place, otcFallback, onMade }: {
  readonly idBase: string; readonly facilityId: string; readonly place: 'pharmacy' | 'lab'
  /** Whether "No details" (over the counter) is there for someone without email. */
  readonly otcFallback: boolean
  readonly onMade: (made: MadeHealthId) => void
}) {
  const { permissions } = useDeptAccess()
  const canWrite = permissions.includes('identity.registration.write')
  const canApprove = permissions.includes('identity.registration.approve')
  const focus = useFocusById()
  const [caps, setCaps] = useState<RegistrationCapabilities | null>(null)
  const [capsError, setCapsError] = useState('')
  const [capsRound, setCapsRound] = useState(0)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [errors, setErrors] = useState<DraftErrors>({})
  const [phase, setPhase] = useState<Phase>({ kind: 'form' })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const resolveKey = useCommandKey()
  const reviewKey = useCommandKey()
  const enrollKey = useCommandKey()
  const id = (field: keyof Draft) => `${idBase}-new-${FIELD_ID[field]}`

  useEffect(() => {
    if (!canWrite || !canApprove) return
    let active = true
    setCapsError('')
    staffApi.registrationCapabilities(facilityId)
      .then(value => { if (active) setCaps(value) })
      .catch((caught: unknown) => { if (active) setCapsError(registrationErrorText(caught, 'We couldn’t check whether new Health IDs can be made.')) })
    return () => { active = false }
  }, [facilityId, canWrite, canApprove, capsRound])

  if (!canWrite || !canApprove) return <p className="m-0 rounded-lg bg-subtle px-4 py-3 text-[14px] text-ink-2 ring-1 ring-inset ring-line">
    You can’t make Health IDs here. Ask someone with registration access{otcFallback ? ', or pick No details for over-the-counter items' : ''}.</p>
  if (capsError) return <Alert intent="error" title="Can’t make Health IDs right now"
    action={<Button size="sm" onClick={() => setCapsRound(round => round + 1)}>Try again</Button>}>{capsError}</Alert>
  if (!caps) return <p role="status" className="m-0 text-[14px] text-ink-3">Getting ready…</p>
  // The served check is `nin/resolve`: a NIN is always sent, as on the Registration page, so it runs only while NIN checks are on.
  const ninAsked = true
  const ninNeeded = true
  if (!caps.nin.enabled) return <Alert intent="warning" title="New Health IDs are paused"
    action={<Button size="sm" onClick={() => { setCaps(null); setCapsRound(round => round + 1) }}>Check again</Button>}>
    NIN checks are off, so new Health IDs can’t be made right now.</Alert>

  const set = (patch: Partial<Draft>) => { setDraft(current => ({ ...current, ...patch })); setErrors({}); setProblem('') }
  const name = `${draft.firstName.trim()} ${draft.lastName.trim()}`
  const email = draft.email.trim().toLowerCase()

  /** The last step: sends their Health ID to their email. */
  async function enroll(registration: RegistrationCase) {
    setPhase({ kind: 'send', registration })
    const key = enrollKey.forInput(JSON.stringify([facilityId, registration.caseId, registration.version, email]))
    try {
      const result = await staffApi.enrollRegistration(facilityId, registration, email, REASON[place], key)
      onMade({ hid: result.hid, name, email })
    } catch (caught) {
      setProblem(registrationErrorText(caught, 'Their Health ID was made, but we couldn’t send it. They may already have an account.'))
      focus(`${idBase}-new-retry`)
    }
  }

  /** "Someone new" (or no match): a new Health ID; "This is them": the one they have. Then it is sent. */
  async function decide(registration: RegistrationCase, patientId: string | null) {
    const key = reviewKey.forInput(JSON.stringify([facilityId, registration.caseId, registration.version, patientId]))
    const decided = patientId === null
      ? await staffApi.approveNewRegistration(facilityId, registration, REASON[place], key)
      : await staffApi.linkExistingRegistration(facilityId, registration, patientId, REASON[place], key)
    await enroll(decided)
  }

  async function run(work: () => Promise<void>, fallback: string) {
    if (busy) return
    setBusy(true); setProblem('')
    try { await work() } catch (caught) { setProblem(registrationErrorText(caught, fallback)) } finally { setBusy(false) }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const found = check(draft, ninNeeded, ninAsked, new Date().toISOString().slice(0, 10))
    setErrors(found)
    const first = ORDER.find(field => found[field])
    if (first) { focus(id(first)); return }
    const nin = draft.nin.replace(/\s/g, '')
    const input: ResolveNinInput = {
      firstName: draft.firstName.trim(), lastName: draft.lastName.trim(), dateOfBirth: draft.dateOfBirth,
      nin, ...(draft.gender ? { gender: draft.gender } : {}),
    }
    await run(async () => {
      const opened = await staffApi.resolveNin(facilityId, input, resolveKey.forInput(JSON.stringify([facilityId, input])))
      // The resolve answer may leave out the matches: the case itself has them.
      const registration = await staffApi.registrationCase(facilityId, opened.caseId).catch(() => opened)
      if (registration.status === 'review_required') { setPhase({ kind: 'match', registration }); focus(`${idBase}-new-match`); return }
      if (registration.status === 'pending_new_identity_approval') { await decide(registration, null); return }
      if (REGISTRATION_COMPLETED.has(registration.status)) { await enroll(registration); return }
      setProblem('Health ID can’t make one for them. Send them to the registration desk.')
    }, 'We couldn’t make their Health ID. Check the details and try again: nothing is made twice.')
  }

  if (phase.kind === 'match') {
    const registration = phase.registration
    return <div className="flex flex-col gap-4">
      <h4 id={`${idBase}-new-match`} tabIndex={-1} className="m-0 text-title-3 text-ink outline-none">They may already have a Health ID</h4>
      <p className="m-0 text-[15px] text-ink-2">Ask them their date of birth and where they registered. Pick them if they’re here.</p>
      {registration.candidates?.length ? <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {registration.candidates.map(candidate => <li key={candidate.patientId}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 ring-1 ring-inset ring-line">
          <span className="min-w-0">
            <span className="block text-[15px] font-medium text-ink">{candidate.fullName}</span>
            <span className="block text-[13px] text-ink-3">Born {candidate.dateOfBirth ?? 'date not known'}</span>
          </span>
          <Button aria-disabled={busy || undefined} aria-label={`This is them: ${candidate.fullName}`}
            onClick={() => void run(() => decide(registration, candidate.patientId), 'We couldn’t link them. Try again: nothing is made twice.')}>This is them</Button>
        </li>)}
      </ul> : <Alert intent="warning" title="Can’t show the matches">Ask the registration desk to check them.</Alert>}
      {problem ? <Alert intent="error" title="Not done">{problem}</Alert> : null}
      <FormActions sticky={false}>
        <Button onClick={() => { setPhase({ kind: 'form' }); focus(id('firstName')) }}>Back</Button>
        <Button aria-busy={busy || undefined} aria-disabled={busy || undefined}
          onClick={() => void run(() => decide(registration, null), 'We couldn’t make their Health ID. Try again: nothing is made twice.')}>
          {busy ? 'Making their Health ID…' : 'Someone new'}</Button>
      </FormActions>
    </div>
  }

  if (phase.kind === 'send' && problem) {
    const registration = phase.registration
    const hid = registration.patient?.hid
    return <div className="flex flex-col gap-4">
      <Alert intent="error" title="Health ID not sent">{problem}</Alert>
      <FormActions sticky={false}>
        {hid ? <Button onClick={() => onMade({ hid, name, email: null })}>Use {hid} without sending</Button> : null}
        <Button id={`${idBase}-new-retry`} variant="primary" aria-disabled={busy || undefined} onClick={() => void run(() => enroll(registration), 'We couldn’t send it. Try again.')}>Try again</Button>
      </FormActions>
    </div>
  }

  const control = (field: keyof Draft, hint = false) => ({
    id: id(field), 'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `${id(field)}-error` : hint ? `${id(field)}-hint` : undefined,
  })
  return <form className="flex flex-col gap-4" noValidate onSubmit={event => void create(event)}>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="First name" htmlFor={id('firstName')} error={errors.firstName} errorId={`${id('firstName')}-error`}>
        <Input {...control('firstName')} value={draft.firstName} maxLength={100} autoComplete="off" className="h-11" readOnly={busy} onChange={event => set({ firstName: event.target.value })} />
      </Field>
      <Field label="Last name" htmlFor={id('lastName')} error={errors.lastName} errorId={`${id('lastName')}-error`}>
        <Input {...control('lastName')} value={draft.lastName} maxLength={100} autoComplete="off" className="h-11" readOnly={busy} onChange={event => set({ lastName: event.target.value })} />
      </Field>
      <Field label="Date of birth" htmlFor={id('dateOfBirth')} error={errors.dateOfBirth} errorId={`${id('dateOfBirth')}-error`}>
        <Input {...control('dateOfBirth')} type="date" max={new Date().toISOString().slice(0, 10)} value={draft.dateOfBirth} className="h-11" readOnly={busy}
          onChange={event => set({ dateOfBirth: event.target.value })} />
      </Field>
      <Field label="Sex" htmlFor={id('gender')} optional>
        <Select id={id('gender')} value={draft.gender} className="[&>select]:h-11" onChange={event => set({ gender: event.target.value as Draft['gender'] })}>
          <option value="">Not said</option>
          {REGISTRATION_GENDERS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
      </Field>
    </div>
    {ninAsked ? <Field label="NIN" htmlFor={id('nin')} optional={!ninNeeded} error={errors.nin} errorId={`${id('nin')}-error`}
      hint="11 digits, from their NIN slip. It isn’t kept here." hintId={`${id('nin')}-hint`}>
      <Input {...control('nin', true)} type="password" inputMode="numeric" autoComplete="off" maxLength={11} value={draft.nin} className="h-11" readOnly={busy}
        onChange={event => set({ nin: event.target.value })} />
    </Field> : null}
    <Field label="Email" htmlFor={id('email')} error={errors.email} errorId={`${id('email')}-error`}
      hint="Their own email. Their Health ID is sent there." hintId={`${id('email')}-hint`}>
      <Input {...control('email', true)} type="email" inputMode="email" maxLength={254} autoComplete="off" value={draft.email} className="h-11" readOnly={busy}
        onChange={event => set({ email: event.target.value })} />
    </Field>
    {otcFallback ? <p className="m-0 text-[14px] text-ink-2">No email? For over-the-counter items, pick No details.</p> : null}
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id('consent')} className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-ink">
        <input id={id('consent')} type="checkbox" checked={draft.consent} className="size-5 shrink-0 accent-[var(--color-brand)]"
          aria-invalid={errors.consent ? true : undefined} aria-describedby={errors.consent ? `${id('consent')}-error` : undefined}
          onChange={event => { if (!busy) set({ consent: event.target.checked }) }} />
        They agree to get a Health ID
      </label>
      {errors.consent ? <p id={`${id('consent')}-error`} className="m-0 text-xs font-medium text-danger-ink">{errors.consent}</p> : null}
    </div>
    {problem ? <Alert intent="error" title="No Health ID yet">{problem}</Alert> : null}
    <FormActions sticky={false}>
      <Button type="submit" variant="primary" size="lg" icon={UserPlus} aria-busy={busy || undefined} aria-disabled={busy || undefined}>
        {busy ? (phase.kind === 'send' ? 'Sending their Health ID…' : 'Making their Health ID…') : 'Create Health ID'}</Button>
    </FormActions>
  </form>
}

/** The new Health ID, large, where it was sent, and a slip to print for them. */
export function MadeHealthIdPanel({ idBase, made }: { readonly idBase: string; readonly made: MadeHealthId }) {
  return <div className="flex flex-col gap-4">
    <div className="flex flex-col items-start gap-2 rounded-xl bg-success-soft/60 px-5 py-4 ring-1 ring-inset ring-line">
      <p id={`${idBase}-made`} tabIndex={-1} className="m-0 inline-flex items-center gap-2 text-[15px] font-medium text-ink outline-none">
        <CircleCheck className="size-5 text-success-ink" aria-hidden />Health ID made for {made.name}</p>
      <p className="m-0 text-[32px] leading-tight font-semibold tracking-[.06em] text-ink tabular [overflow-wrap:anywhere]">{made.hid}</p>
      <p className="m-0 text-[15px] text-ink-2 [overflow-wrap:anywhere]">{made.email
        ? <>Sent to {made.email}. They can sign in and see their records.</>
        : <>Not sent. Give them the slip: they can ask the registration desk to set up sign-in.</>}</p>
      <Button icon={Printer} onClick={() => window.print()}>Print slip</Button>
    </div>
    <section data-receipt-print="" aria-hidden="true" className="hidden print:block">
      <div className="flex flex-col gap-2 p-4 text-black">
        <p className="m-0 text-[14px]">Health ID for</p>
        <p className="m-0 text-[18px] font-semibold">{made.name}</p>
        <p className="m-0 text-[26px] font-semibold tracking-[.06em]">{made.hid}</p>
        <p className="m-0 text-[13px]">{made.email
          ? `To sign in: open the email sent to ${made.email}, set a password, then sign in to Health ID with that email.`
          : 'To sign in: ask at the registration desk to set up your account.'}</p>
        <p className="m-0 text-[13px]">Show this Health ID at any facility so they can see your records.</p>
      </div>
    </section>
  </div>
}
