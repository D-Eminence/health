import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { CircleCheck, CloudOff, MessageSquare, Printer, RotateCcw } from 'lucide-react'
import { Segmented } from '../../../../kasuwa/interactive'
import { ConfirmSheet, FormActions } from '../../../../kasuwa/parts'
import { Alert, Button, Input, Textarea } from '../../../../kasuwa/ui'
import { useFocusById } from '../../../../staff/focus'
import { campaignFlowErrorText, newLocalCommandId, outreachCampaignApi, type StationCommand } from '../campaignApi'
import { ErrorToast } from '../notify'
import { useToast } from '../../../../kasuwa/toast'
import {
  canConfirmOutcome, canSeeSensitive, type OutcomeKind, type OutreachPlan, type OutreachVisit, type ScreeningConsentInput, type TestDefinition,
  type TestResultInput, type Urgency, type VitalDefinition, type VitalId,
} from '../campaignTypes'
import { appliesToPerson, bmiFrom, flagVital, outcomeText, suggestOutcome, visibleReasons } from '../screeningTemplates'
import { addToRecord, DayProblem, hivConsentKey, localRecord, outcomeInputsOf, personOf, useCampaignDay, useDraft, type DayVisit } from './dayContext'
import { BIG_INPUT, BigChoice, DayField, dayControl, dayFromToday, PrintSlip, VitalFlagText, YesNo, Panel } from './dayParts'

/*
 * Each station's form, for one person: vital signs (with the yes/no questions), tests, and the outcome. Each save goes
 * through saveWrite: sent at once when online, else kept on this phone and sent later, with the same localCommandId
 * (Idempotency-Key) every time, so a save sent twice is recorded once. What is typed is kept in memory per visit
 * (useDraft) while the screen lives, so nothing half-entered is lost.
 */

export type Saved = { readonly state: 'sent' | 'queued'; readonly visit: OutreachVisit | null }

const NOT_SAVED = 'This could not be saved. What you entered is kept: try again.'

/** Sends a form's commands one by one, each with its own command id, kept for a retry; ones already saved are not sent again. */
function useSaver(visit: DayVisit) {
  const day = useCampaignDay()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const running = useRef(false)
  async function save(commands: readonly StationCommand[]): Promise<Saved | null> {
    if (running.current) return null
    running.current = true
    setBusy(true)
    setError('')
    let queued = false
    let latest: OutreachVisit | null = null
    try {
      for (const command of commands) {
        // Same command (its time aside) as the last try: the same id and body, so Health ID records it once.
        const signature = JSON.stringify([visit.key, command], (key, value: unknown) => (key === 'takenAt' ? undefined : value))
        const slot = `${visit.key}|command|${command.kind}`
        const kept = day.drafts.get(slot) as { signature: string; id: string; command: StationCommand; done: boolean } | undefined
        const entry = kept?.signature === signature ? kept : { signature, id: newLocalCommandId(), command, done: false }
        day.drafts.set(slot, entry)
        if (entry.done) continue
        try {
          const result = await day.saveWrite(visit, entry.command, entry.id)
          day.drafts.set(slot, { ...entry, done: true })
          if (result.state === 'queued') queued = true
          else if (result.answer && 'stationsDone' in result.answer) latest = result.answer
        } catch (caught) {
          setError(caught instanceof DayProblem ? caught.message : campaignFlowErrorText(caught, NOT_SAVED))
          return null
        }
      }
      for (const command of commands) day.drafts.delete(`${visit.key}|command|${command.kind}`)
      return { state: queued ? 'queued' : 'sent', visit: latest }
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return { busy, error, save }
}

/** What stopped a save, said in a toast at the top while it lasts; the form keeps what was typed and its Save. */
function SaveError({ error }: { readonly error: string }) {
  return <ErrorToast error={error} title="Not saved" />
}

/** Moves to the next field on Enter, or presses Save at the last one. */
function enterMoves(ids: readonly string[], index: number, focus: (id: string) => void) {
  return (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const next = ids[index + 1]
    if (next) focus(next)
  }
}

// ---------------------------------------------------------------------------------------------------- vital signs --

interface VitalsDraft {
  readonly values: Partial<Record<VitalId, string>>
  /** Blood sugar: eaten in the last 8 hours? 'yes' is random, 'no' fasting. */
  readonly eaten: 'yes' | 'no' | null
  readonly answers: Readonly<Record<string, 'yes' | 'no'>>
}

const vitalId = (id: string) => `outreach-vital-${id}`
const questionId = (id: string) => `outreach-question-${id}`

/** A typed reading as a number, or null when empty; NaN when it isn't a number. */
function reading(text: string | undefined): number | null {
  const typed = (text ?? '').trim().replace(',', '.')
  if (!typed) return null
  return /^\d+(\.\d+)?$/.test(typed) ? Number(typed) : Number.NaN
}

function rangeText(vital: VitalDefinition) {
  return `Check this number: it should be between ${vital.min} and ${vital.max} ${vital.unit}.`
}

/**
 * Vital signs, one per row with its unit and usual range, flagged as typed (in words and an icon); BMI worked out from
 * weight and height; then the campaign's yes/no questions (when this station asks them). Enter moves to the next.
 */
export function VitalsForm({ plan, visit, withQuestions, withReadings = true, saveId = 'outreach-vitals-save', onSaved }: {
  readonly plan: OutreachPlan
  readonly visit: DayVisit
  readonly withQuestions: boolean
  /** False where this station asks the questions only. */
  readonly withReadings?: boolean
  readonly saveId?: string
  readonly onSaved: (saved: Saved) => void
}) {
  const day = useCampaignDay()
  const focus = useFocusById()
  const person = personOf(visit)
  const [draft, setDraft] = useDraft<VitalsDraft>(`${visit.key}|vitals`, () => ({ values: {}, eaten: null, answers: {} }))
  const [problems, setProblems] = useState<Partial<Record<string, string>>>({})
  const { busy, error, save } = useSaver(visit)
  const typed = withReadings ? plan.package.vitals.filter(vital => !vital.derived) : []
  const showBmi = withReadings && plan.package.vitals.some(vital => vital.id === 'bmi')
  const questions = withQuestions ? plan.package.questions.filter(question => question.kind === 'yesno' && appliesToPerson(question, person)) : []
  const ids = [...typed.map(vital => vitalId(vital.id)), saveId]
  const fasting = draft.eaten === 'no'
  const set = (id: VitalId, value: string) => {
    setDraft(previous => ({ ...previous, values: { ...previous.values, [id]: value } }))
    setProblems(previous => ({ ...previous, [id]: undefined, form: undefined }))
  }
  const numbers = Object.fromEntries(typed.map(vital => [vital.id, reading(draft.values[vital.id])])) as Partial<Record<VitalId, number | null>>
  const bmi = bmiFrom(numbers.weight ?? undefined, numbers.height ?? undefined)

  async function submit() {
    const found: Record<string, string> = {}
    const readings: Partial<Record<VitalId, number>> = {}
    for (const vital of typed) {
      const value = numbers[vital.id]
      if (value === null || value === undefined) continue
      if (Number.isNaN(value) || value < vital.min || value > vital.max) found[vital.id] = rangeText(vital)
      else readings[vital.id] = value
    }
    const answers = questions.filter(question => draft.answers[question.id]).map(question => ({ questionId: question.id, value: draft.answers[question.id]! }))
    if (Object.keys(found).length) {
      setProblems(found)
      const first = typed.find(vital => found[vital.id])
      if (first) focus(vitalId(first.id))
      return
    }
    if (!Object.keys(readings).length && !answers.length) {
      setProblems({ form: typed.length ? 'Enter at least one reading.' : 'Answer at least one question.' })
      if (typed[0]) focus(vitalId(typed[0].id))
      return
    }
    setProblems({})
    const commands: StationCommand[] = []
    const takenAt = new Date().toISOString()
    if (Object.keys(readings).length) {
      commands.push({ kind: 'vitals', body: { siteId: day.settings?.siteId ?? null, readings, ...(readings.blood_sugar !== undefined && draft.eaten ? { fasting } : {}), takenAt } })
    }
    if (answers.length) commands.push({ kind: 'answers', body: { answers } })
    const saved = await save(commands)
    if (!saved) return
    addToRecord(day.drafts, visit.key, { vitals: readings, ...(readings.blood_sugar !== undefined && draft.eaten ? { fasting } : {}), answers })
    day.drafts.delete(`${visit.key}|vitals`)
    onSaved(saved)
  }

  return (
    <form noValidate aria-label="Vital signs" className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void submit() }}>
      {typed.length ? (
        <ul className="m-0 flex list-none flex-col divide-y divide-line p-0" aria-label="Readings">
          {typed.map((vital, index) => {
            const value = numbers[vital.id]
            const inRange = value !== null && value !== undefined && !Number.isNaN(value) && value >= vital.min && value <= vital.max
            const flag = inRange ? flagVital(vital.id, value, { fasting }) : null
            const id = vitalId(vital.id)
            const problem = problems[vital.id]
            return (
              <li key={vital.id} className="flex flex-col gap-1.5 py-3 first:pt-0">
                <label htmlFor={id} className="text-[15px] font-medium text-ink">{vital.name}</label>
                <div className="flex items-center gap-3">
                  <div className="relative w-36 shrink-0">
                    <Input {...dayControl(id, problem, true)} className={`${BIG_INPUT} pr-16 tabular`} inputMode="decimal" autoComplete="off" enterKeyHint={index + 1 < typed.length ? 'next' : 'done'}
                      value={draft.values[vital.id] ?? ''} maxLength={6} onChange={event => set(vital.id, event.target.value)} onKeyDown={enterMoves(ids, index, focus)} />
                    <span aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[14px] text-ink-2">{vital.unit}</span>
                  </div>
                  <div className="min-w-0" aria-live="polite">{flag ? <VitalFlagText flag={flag} /> : null}</div>
                </div>
                {problem ? <p id={`${id}-error`} className="m-0 text-[13px] font-medium text-danger-ink">{problem}</p>
                  : <p id={`${id}-hint`} className="m-0 text-[13px] text-ink-2">{flag?.reason ?? [vital.unit, vital.normalText ? `usual: ${vital.normalText}` : '', vital.note ?? ''].filter(Boolean).join(' · ')}</p>}
                {vital.id === 'blood_sugar' ? (
                  <YesNo question="Have they eaten in the last 8 hours?" value={draft.eaten} id="outreach-vital-eaten"
                    onChange={eaten => setDraft(previous => ({ ...previous, eaten }))} />
                ) : null}
              </li>
            )
          })}
          {showBmi ? (
            <li className="flex flex-col gap-1 py-3">
              <p className="m-0 text-[15px] font-medium text-ink">BMI</p>
              <p className="m-0 flex flex-wrap items-center gap-2 text-[15px] text-ink" aria-live="polite">
                {bmi !== null ? <><strong className="tabular">{bmi}</strong> kg/m² <VitalFlagText flag={flagVital('bmi', bmi)} /></> : <span className="text-ink-2">Worked out from weight and height.</span>}
              </p>
            </li>
          ) : null}
        </ul>
      ) : null}
      {questions.length ? (
        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <legend className="mb-1 text-title-3 text-ink">Ask them</legend>
          {questions.map(question => (
            <YesNo key={question.id} question={question.text} id={questionId(question.id)} value={draft.answers[question.id] ?? null}
              onChange={value => setDraft(previous => ({ ...previous, answers: { ...previous.answers, [question.id]: value } }))} />
          ))}
        </fieldset>
      ) : null}
      {problems.form ? <p role="alert" className="m-0 text-[14px] font-medium text-danger-ink">{problems.form}</p> : null}
      <SaveError error={error} />
      <FormActions>
        <Button id={saveId} type="submit" variant="primary" size="lg" className="h-14" aria-disabled={busy || undefined}>{busy ? 'Saving…' : 'Save'}</Button>
      </FormActions>
    </form>
  )
}

// ---------------------------------------------------------------------------------------------------------- tests --

interface TestsDraft {
  readonly results: Readonly<Record<string, { readonly first?: string; readonly second?: string; readonly value?: string }>>
  readonly consent: ScreeningConsentInput | null
}

/**
 * The tests for this person: big result buttons for each (Positive / Negative / Invalid), the kit lot remembered for the
 * day, and "Test again" after an invalid one. Sensitive tests (HIV, hepatitis B) only for counsellors and clinicians;
 * HIV with its own agreement.
 */
export function TestsForm({ plan, visit, saveId = 'outreach-tests-save', onSaved }: {
  readonly plan: OutreachPlan
  readonly visit: DayVisit
  readonly saveId?: string
  readonly onSaved: (saved: Saved) => void
}) {
  const day = useCampaignDay()
  const focus = useFocusById()
  const person = personOf(visit)
  const seesSensitive = canSeeSensitive(day.roles)
  const [draft, setDraft] = useDraft<TestsDraft>(`${visit.key}|tests`, () => ({ results: {}, consent: null }))
  const [problem, setProblem] = useState('')
  const { busy, error, save } = useSaver(visit)
  const siteId = day.settings?.siteId ?? null
  const today = dayFromToday(0)
  const tests = plan.package.tests.filter(test => appliesToPerson(test, person))
  const recorded = [...(visit.kind === 'case' ? visit.visit.tests ?? [] : []), ...localRecord(day.drafts, visit.key).tests]
  const witnessedAtRegistration = day.drafts.get(hivConsentKey(visit.key)) as ScreeningConsentInput | undefined
  const consent = draft.consent ?? witnessedAtRegistration ?? null

  /** What is already recorded for a test: the latest attempt. */
  const latest = (testId: string) => recorded.filter(entry => entry.testId === testId).sort((a, b) => b.attempt - a.attempt)[0]
  const lotsFor = (test: TestDefinition) => plan.kits.filter(kit => kit.testId === test.id && (!siteId || kit.siteId === siteId) && kit.expiresOn >= today)
  const lotOf = (test: TestDefinition) => {
    const available = lotsFor(test)
    const picked = day.settings?.kitLots[test.id]
    if (picked && available.some(kit => kit.lot === picked)) return picked
    return available.length === 1 ? available[0]!.lot : null
  }
  const setResult = (testId: string, change: { first?: string; second?: string; value?: string }) => {
    setDraft(previous => ({ ...previous, results: { ...previous.results, [testId]: { ...previous.results[testId], ...change } } }))
    setProblem('')
  }

  async function submit() {
    const results: TestResultInput[] = []
    const takenAt = new Date().toISOString()
    let needsConsent = false
    for (const test of tests) {
      if (test.sensitive && !seesSensitive) continue
      const entry = draft.results[test.id]
      if (!entry) continue
      const before = latest(test.id)
      if (before && before.result !== 'invalid') continue
      const lot = test.usesKit ? lotOf(test) : null
      const kitId = lot ? plan.kits.find(kit => kit.testId === test.id && kit.lot === lot && (!siteId || kit.siteId === siteId))?.id ?? null : null
      const base = { testId: test.id, kitLot: lot, kitId, takenAt }
      if (test.kind === 'number') {
        const value = reading(entry.value)
        if (value === null) continue
        if (Number.isNaN(value)) { setProblem(`Check the ${test.name} value: a number in ${test.unit ?? 'its unit'}.`); return }
        results.push({ ...base, value, attempt: before ? 2 : 1 })
      } else if (before?.result === 'invalid') {
        if (entry.second) results.push({ ...base, result: entry.second, attempt: 2 })
      } else if (entry.first) {
        results.push({ ...base, result: entry.first, attempt: 1 })
        if (entry.first === 'invalid' && entry.second) results.push({ ...base, result: entry.second, attempt: 2 })
      }
      if (test.usesKit && !lot && results.some(result => result.testId === test.id)) {
        setProblem(`Choose the kit lot for the ${test.name}.`)
        return
      }
      if (test.separateConsent && results.some(result => result.testId === test.id)) needsConsent = true
    }
    if (!results.length) { setProblem('Choose a result first.'); return }
    if (needsConsent && !consent) { setProblem('The HIV test needs its own agreement first: record it above.'); focus('outreach-hiv-consent'); return }
    const saved = await save([{ kind: 'tests', body: { siteId, results, ...(needsConsent && consent ? { consent } : {}) } }])
    if (!saved) return
    addToRecord(day.drafts, visit.key, { tests: results.map(({ testId, result, value, attempt }) => ({ testId, result, value, attempt })) })
    day.drafts.delete(`${visit.key}|tests`)
    onSaved(saved)
  }

  const hivTest = tests.find(test => test.separateConsent && seesSensitive && !(latest(test.id) && latest(test.id)!.result !== 'invalid'))
  return (
    <form noValidate aria-label="Tests" className="flex flex-col gap-5" onSubmit={event => { event.preventDefault(); void submit() }}>
      {hivTest ? (
        <HivConsent visit={visit} plan={plan} consent={consent} fromRegistration={!draft.consent && Boolean(witnessedAtRegistration)}
          onConsent={next => setDraft(previous => ({ ...previous, consent: next }))} />
      ) : null}
      {tests.map(test => {
        const before = latest(test.id)
        const entry = draft.results[test.id] ?? {}
        if (test.sensitive && !seesSensitive) {
          return <TestRow key={test.id} test={test}><p className="m-0 text-[15px] text-ink-2">Done by the counsellor.</p></TestRow>
        }
        if (before && before.result !== 'invalid') {
          const label = test.kind === 'number' ? `${before.value} ${test.unit ?? ''}` : test.results.find(option => option.value === before.result)?.label ?? 'Recorded'
          return <TestRow key={test.id} test={test}><p className="m-0 inline-flex items-center gap-2 text-[15px] text-ink"><CircleCheck className="size-4 text-success-ink" aria-hidden />Recorded: {label}</p></TestRow>
        }
        const retest = before?.result === 'invalid' || entry.first === 'invalid'
        const available = test.usesKit ? lotsFor(test) : []
        const options = test.results.map(option => ({ value: option.value, label: option.value === 'invalid' ? 'Invalid' : option.label }))
        return (
          <TestRow key={test.id} test={test}>
            {test.usesKit ? (
              available.length ? (
                <BigChoice label={`Kit lot for ${test.name}`} size="md" columns={available.length > 1 ? 2 : 1} value={lotOf(test)}
                  onChange={lot => void day.saveSettings({ kitLots: { [test.id]: lot } })}
                  options={available.map(kit => ({ value: kit.lot, label: `Kit lot ${kit.lot}`, hint: `Use by ${kit.expiresOn}` }))} />
              ) : <p className="m-0 text-[14px] text-danger-ink">No unexpired kits for this test at your site. Ask the coordinator.</p>
            ) : null}
            {test.kind === 'number' ? (
              <DayField id={`outreach-test-${test.id}`} label={`Result (${test.unit ?? ''})`} hint={test.abnormalFrom !== undefined ? `${test.abnormalFrom} or more needs a check at a clinic.` : undefined}>
                <Input {...dayControl(`outreach-test-${test.id}`, undefined, test.abnormalFrom !== undefined)} className={`${BIG_INPUT} w-40`} inputMode="decimal"
                  autoComplete="off" value={entry.value ?? ''} onChange={event => setResult(test.id, { value: event.target.value })} />
              </DayField>
            ) : before?.result !== 'invalid' ? (
              <BigChoice label={`${test.name} result`} columns={options.length > 3 ? 2 : 3} value={entry.first ?? null}
                onChange={first => setResult(test.id, { first, second: undefined })} options={options} />
            ) : null}
            {retest && test.kind === 'choice' ? (
              <div className="flex flex-col gap-2 rounded-xl bg-warn-soft p-3">
                <p className="m-0 inline-flex items-center gap-2 text-[15px] font-medium text-warn-ink"><RotateCcw className="size-4" aria-hidden />Test again with a new kit</p>
                <BigChoice label={`${test.name} result, second test`} columns={3} value={entry.second ?? null}
                  onChange={second => setResult(test.id, { second })} options={options} />
              </div>
            ) : null}
          </TestRow>
        )
      })}
      {problem ? <p role="alert" className="m-0 text-[14px] font-medium text-danger-ink">{problem}</p> : null}
      <SaveError error={error} />
      <FormActions>
        <Button id={saveId} type="submit" variant="primary" size="lg" className="h-14" aria-disabled={busy || undefined}>{busy ? 'Saving…' : 'Save'}</Button>
      </FormActions>
    </form>
  )
}

function TestRow({ test, children }: { readonly test: TestDefinition; readonly children: React.ReactNode }) {
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1 text-[16px] font-semibold text-ink">{test.name}</legend>
      {test.note ? <p className="m-0 text-[13px] text-ink-2">{test.note}</p> : null}
      {children}
    </fieldset>
  )
}

/** The HIV test's own agreement: a code read back from their phone, or witnessed by you out loud. */
function HivConsent({ visit, plan, consent, fromRegistration, onConsent }: {
  readonly visit: DayVisit
  readonly plan: OutreachPlan
  readonly consent: ScreeningConsentInput | null
  readonly fromRegistration: boolean
  readonly onConsent: (consent: ScreeningConsentInput) => void
}) {
  const { facilityId, online, staffName } = useCampaignDay()
  const [challenge, setChallenge] = useState<{ id: string; sentTo: string } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const version = plan.consent.hivVersion ?? plan.consent.version
  const person = personOf(visit)
  const canCode = visit.kind === 'case' && online && Boolean(person.phone)

  if (consent) {
    return (
      <Alert intent="success" title="HIV test: they agreed">
        {consent.method === 'code' ? 'By the code sent to their phone.' : `Out loud, witnessed by ${consent.witnessName}${fromRegistration ? ' at registration' : ''}.`}
      </Alert>
    )
  }
  async function send() {
    if (busy || visit.kind !== 'case') return
    setBusy(true); setError('')
    try {
      const sent = await outreachCampaignApi.sendConsentCode(facilityId, visit.caseId, { purpose: 'hiv', language: 'en', version }, newLocalCommandId())
      setChallenge({ id: sent.challengeId, sentTo: sent.sentTo })
    } catch (caught) { setError(campaignFlowErrorText(caught, 'The code could not be sent.')) }
    finally { setBusy(false) }
  }
  async function verify(typed: string) {
    if (busy || visit.kind !== 'case' || !challenge) return
    setBusy(true); setError('')
    try {
      const record = await outreachCampaignApi.verifyConsentCode(facilityId, visit.caseId, { challengeId: challenge.id, code: typed }, newLocalCommandId())
      onConsent({ method: 'code', consentId: record.consentId })
    } catch (caught) { setError(campaignFlowErrorText(caught, 'The code could not be checked.')) }
    finally { setBusy(false) }
  }
  return (
    <div id="outreach-hiv-consent" tabIndex={-1} className="flex flex-col gap-3 rounded-xl p-4 ring-1 ring-line outline-none">
      <p className="m-0 text-[16px] font-semibold text-ink">HIV test: their own agreement</p>
      {plan.consent.hivText ? <p className="m-0 text-[15px] text-ink">{plan.consent.hivText}</p> : <p className="m-0 text-[15px] text-ink">Explain the HIV test, and that they can say no.</p>}
      {challenge ? (
        <DayField id="outreach-hiv-code" label={`Code sent to ${challenge.sentTo}`} error={error || undefined}>
          <Input {...dayControl('outreach-hiv-code', error || undefined, false)} className="!h-14 w-48 !text-[24px] tracking-[.3em] tabular" inputMode="numeric"
            autoComplete="one-time-code" maxLength={6} value={code}
            onChange={event => { const typed = event.target.value.replace(/\D/g, '').slice(0, 6); setCode(typed); if (typed.length === 6) void verify(typed) }} />
        </DayField>
      ) : error ? <p role="alert" className="m-0 text-[14px] text-danger-ink">{error}</p> : null}
      <div className="grid gap-2 @md:grid-cols-2">
        {canCode && !challenge ? <Button size="lg" icon={MessageSquare} aria-disabled={busy || undefined} onClick={() => void send()}>Send code to their phone</Button> : null}
        <Button size="lg" variant="primary" onClick={() => onConsent({ method: 'witnessed', witnessName: staffName, language: 'en', version })}>They agreed out loud</Button>
      </div>
    </div>
  )
}

// -------------------------------------------------------------------------------------------------------- outcome --

interface OutcomeDraft {
  readonly kind: OutcomeKind | null
  readonly urgency: Urgency | null
  readonly partnerId: string | null
  readonly reason: string | null
  readonly dueOn: string | null
}

const RANK: Readonly<Record<string, number>> = { normal: 0, follow_up: 1, 'refer:routine': 2, 'refer:urgent': 3 }
const rankOf = (kind: OutcomeKind, urgency?: Urgency | null) => RANK[kind === 'refer' ? `refer:${urgency ?? 'routine'}` : kind] ?? 0

/**
 * The outcome: suggested from everything recorded (in plain words, sensitive reasons only for those allowed), then
 * confirmed by a counsellor or clinician as Normal, Follow up or Refer (urgent or routine); a referral to a partner in the
 * plan with its reason, or a follow-up date (in two weeks unless changed); then the result slip, printed or by text.
 */
export function OutcomeForm({ plan, visit, saveId = 'outreach-outcome-save', onSaved }: {
  readonly plan: OutreachPlan
  readonly visit: DayVisit
  readonly saveId?: string
  readonly onSaved: (saved: Saved) => void
}) {
  const day = useCampaignDay()
  const seesSensitive = canSeeSensitive(day.roles)
  const confirms = canConfirmOutcome(day.roles)
  const suggestion = suggestOutcome(outcomeInputsOf(visit, localRecord(day.drafts, visit.key), plan))
  const reasons = visibleReasons(suggestion, seesSensitive)
  const [draft, setDraft] = useDraft<OutcomeDraft>(`${visit.key}|outcome`, () => ({ kind: null, urgency: null, partnerId: null, reason: null, dueOn: null }))
  const [problem, setProblem] = useState('')
  const [asking, setAsking] = useState(false)
  const [done, setDone] = useState<{ kind: OutcomeKind; urgency?: Urgency; reason: string; partner?: string; dueOn?: string; state: Saved['state'] } | null>(null)
  const { busy, error, save } = useSaver(visit)
  const server = visit.kind === 'case' ? visit.visit : null
  const kind = draft.kind ?? suggestion.kind
  const urgency = draft.urgency ?? suggestion.urgency ?? 'routine'
  const partners = plan.partners
  const partnerId = draft.partnerId ?? (partners.length === 1 ? partners[0]!.id : null)
  const reason = draft.reason ?? reasons.join(' ')
  const dueOn = draft.dueOn ?? dayFromToday(14)
  const set = (change: Partial<OutcomeDraft>) => { setDraft(previous => ({ ...previous, ...change })); setProblem('') }

  if (done || server?.outcome) {
    const shown = done ?? { kind: server!.outcome!.kind, urgency: server!.outcome!.urgency, reason: server!.outcome!.reason,
      partner: partners.find(partner => partner.id === server?.referral?.partnerId)?.name, dueOn: server?.followUp?.dueOn, state: 'sent' as const }
    return <ResultSlip plan={plan} visit={visit} outcome={shown} reasons={visibleReasons(suggestion, false).filter(line => !line.startsWith('Some results'))} />
  }

  async function confirm(checked = false) {
    if (kind === 'refer' && !partnerId) { setProblem('Choose where they are referred to.'); return }
    if (!reason.trim()) { setProblem('Say why, in a few words.'); return }
    if (kind === 'follow_up' && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) { setProblem('Choose the follow-up date.'); return }
    // Less than suggested is a clinical choice: said back before it is saved.
    if (!checked && rankOf(kind, urgency) < rankOf(suggestion.kind, suggestion.urgency)) { setAsking(true); return }
    setAsking(false)
    const body = { kind, ...(kind === 'refer' ? { urgency } : {}), reason: reason.trim(), suggestedKind: suggestion.kind,
      ...(suggestion.urgency ? { suggestedUrgency: suggestion.urgency } : {}) }
    const commands: StationCommand[] = [{ kind: 'outcome', body }]
    if (kind === 'refer' && partnerId) commands.push({ kind: 'referral', body: { partnerId, urgency, reason: reason.trim() } })
    if (kind === 'follow_up') commands.push({ kind: 'follow_up', body: { dueOn, reason: reason.trim() } })
    const saved = await save(commands)
    if (!saved) return
    day.drafts.delete(`${visit.key}|outcome`)
    setDone({ kind, ...(kind === 'refer' ? { urgency } : {}), reason: reason.trim(), partner: partners.find(partner => partner.id === partnerId)?.name,
      ...(kind === 'follow_up' ? { dueOn } : {}), state: saved.state })
    onSaved(saved)
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel className="flex flex-col gap-2 p-4">
        <p className="m-0 text-[14px] font-medium text-ink-2">Suggested</p>
        <p className="m-0 text-title-2 text-ink">{outcomeText(suggestion.kind, suggestion.urgency)}</p>
        <ul className="m-0 flex flex-col gap-1 pl-5 text-[15px] text-ink">{reasons.map(line => <li key={line}>{line}</li>)}</ul>
        {suggestion.retests.length ? <p className="m-0 text-[14px] font-medium text-warn-ink">A test was invalid: do it again before they leave.</p> : null}
      </Panel>
      {!confirms ? (
        <Alert intent="info">A counsellor or clinician confirms the outcome. Send them to the results station.</Alert>
      ) : (
        <form noValidate aria-label="Confirm the outcome" className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void confirm() }}>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1 text-title-3 text-ink">Outcome</legend>
            <BigChoice label="Outcome" columns={3} value={kind} onChange={next => set({ kind: next })}
              options={[{ value: 'normal', label: 'Normal' }, { value: 'follow_up', label: 'Follow up' }, { value: 'refer', label: 'Refer' }]} />
          </fieldset>
          {kind === 'refer' ? (
            <>
              <Segmented ariaLabel="How soon" value={urgency} onChange={next => set({ urgency: next })}
                options={[{ value: 'urgent', label: 'Urgent: today' }, { value: 'routine', label: 'Routine' }]} />
              <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
                <legend className="mb-1 text-[15px] font-medium text-ink">Refer to</legend>
                {partners.length ? (
                  <BigChoice label="Refer to" columns={1} size="md" value={partnerId} onChange={next => set({ partnerId: next })}
                    options={partners.map(partner => ({ value: partner.id, label: partner.name, hint: [partner.address, partner.phone, partner.notes].filter(Boolean).join(' · ') }))} />
                ) : <p className="m-0 text-[14px] text-ink-2">The plan has no referral partners. Ask the coordinator to add one.</p>}
              </fieldset>
            </>
          ) : null}
          {kind === 'follow_up' ? (
            <DayField id="outreach-follow-up-date" label="Follow up on" hint="Two weeks from today unless you change it.">
              <Input {...dayControl('outreach-follow-up-date', undefined, true)} className={`${BIG_INPUT} w-48`} type="date" min={dayFromToday(1)} value={dueOn}
                onChange={event => set({ dueOn: event.target.value })} />
            </DayField>
          ) : null}
          {kind !== 'normal' ? (
            <DayField id="outreach-outcome-reason" label="Why, in a few words">
              <Textarea id="outreach-outcome-reason" rows={3} maxLength={1000} value={reason} onChange={event => set({ reason: event.target.value })} />
            </DayField>
          ) : null}
          {problem ? <p role="alert" className="m-0 text-[14px] font-medium text-danger-ink">{problem}</p> : null}
          <SaveError error={error} />
          <FormActions>
            <Button id={saveId} type="submit" variant="primary" size="lg" className="h-14" aria-disabled={busy || undefined}>{busy ? 'Saving…' : `Confirm: ${outcomeText(kind, urgency)}`}</Button>
          </FormActions>
          <ConfirmSheet open={asking} onClose={() => setAsking(false)} title="Less than suggested" busy={busy}
            effect={<>The suggestion is <strong>{outcomeText(suggestion.kind, suggestion.urgency)}</strong>. You chose <strong>{outcomeText(kind, urgency)}</strong>. Check the readings with them first.</>}
            confirmLabel={`Confirm ${outcomeText(kind, urgency)}`} onConfirm={() => void confirm(true)} />
        </form>
      )}
    </div>
  )
}

/** After the outcome: what was decided, and the result slip to print or text (never a sensitive result). */
function ResultSlip({ plan, visit, outcome, reasons }: {
  readonly plan: OutreachPlan
  readonly visit: DayVisit
  readonly outcome: { kind: OutcomeKind; urgency?: Urgency; reason: string; partner?: string; dueOn?: string; state: Saved['state'] }
  /** The reasons anyone may read: no sensitive one. */
  readonly reasons: readonly string[]
}) {
  const { facilityId, online, campaignName } = useCampaignDay()
  const person = personOf(visit)
  const [, setSms] = useState('')
  const toast = useToast()
  const [sending, setSending] = useState(false)
  const command = useRef<string | null>(null)
  const partner = plan.partners.find(item => item.name === outcome.partner)
  const lines = [
    `Result: ${outcomeText(outcome.kind, outcome.urgency)}`,
    ...(outcome.kind === 'normal' ? reasons : []),
    ...(partner ? [`Go to ${partner.name}, ${partner.address}${partner.phone ? `, ${partner.phone}` : ''}${outcome.urgency === 'urgent' ? ', today' : ''}.`] : []),
    ...(outcome.dueOn ? [`We will call you on ${outcome.dueOn}.`] : []),
  ]
  async function text() {
    if (sending || visit.kind !== 'case') return
    command.current ??= newLocalCommandId()
    setSending(true)
    try {
      const sent = await outreachCampaignApi.sendSlipSms(facilityId, visit.caseId, { kind: 'results' }, command.current)
      const failed = sent.deliveryOutcome === 'definitive_failure'
      setSms(failed ? 'The text could not be delivered. Give them the printed slip.' : `Sent to ${sent.sentTo}.`)
      if (failed) toast.error({ title: 'Not delivered', message: 'The text could not be delivered. Give them the printed slip.' })
      else toast.success(`Sent to ${sent.sentTo}.`)
      command.current = null
    } catch (caught) {
      const said = campaignFlowErrorText(caught, 'The text could not be sent. Give them the printed slip.')
      setSms(said)
      toast.error({ title: 'Not sent', message: said })
    } finally { setSending(false) }
  }
  return (
    <Panel className="flex flex-col gap-3 p-4">
      <p className="m-0 inline-flex items-center gap-2 text-title-3 text-ink">
        {outcome.state === 'queued' ? <CloudOff className="size-5 text-warn-ink" aria-hidden /> : <CircleCheck className="size-5 text-success-ink" aria-hidden />}
        {outcomeText(outcome.kind, outcome.urgency)}{outcome.state === 'queued' ? ': saved on this phone' : ': saved'}
      </p>
      {outcome.partner ? <p className="m-0 text-[15px] text-ink">Referred to {outcome.partner}.</p> : null}
      {outcome.dueOn ? <p className="m-0 text-[15px] text-ink">Follow up on {outcome.dueOn}.</p> : null}
      <div className="grid gap-2 @md:grid-cols-2">
        <Button size="lg" icon={Printer} onClick={() => window.print()}>Print result slip</Button>
        {visit.kind === 'case' && person.phone ? (
          <Button size="lg" icon={MessageSquare} aria-disabled={sending || !online || undefined} onClick={() => { if (online) void text() }}>{sending ? 'Sending…' : 'Text the result'}</Button>
        ) : null}
      </div>
      <PrintSlip fullName={person.fullName} visitCode={person.visitCode} healthId={person.healthId} campaignName={campaignName} results={lines} />
    </Panel>
  )
}

/** Where the yes/no questions are asked: at vital signs, or the first station after registration the plan has. */
export function questionsStation(plan: OutreachPlan): 'vitals' | 'tests' | 'counselling' | 'results' {
  if (plan.stationMode === 'one_person') return 'vitals'
  return (['vitals', 'tests', 'counselling', 'results'] as const).find(station => plan.stations.includes(station)) ?? 'vitals'
}
