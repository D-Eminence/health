import { useEffect, useState } from 'react'
import { Check, CloudOff, UserPlus } from 'lucide-react'
import { FormActions } from '../../../../kasuwa/parts'
import { Button, cx } from '../../../../kasuwa/ui'
import { useFocusById } from '../../../../staff/focus'
import type { OutreachPlan } from '../campaignTypes'
import { caseVisit, clearDrafts, DayScope, moveDrafts, useCampaignDay, type DayVisit } from './dayContext'
import { PlanState } from './DayStart'
import { PersonBanner, Panel } from './dayParts'
import { RegisterFlow } from './RegisterPerson'
import { OutcomeForm, TestsForm, VitalsForm, type Saved } from './stationForms'

/*
 * One person does everything (a one-person campaign): register, vital signs and questions, tests, and the outcome, on
 * one scrolling screen with a progress strip held at the top. The same parts as the stations; each part saves on its own
 * (sent, or kept on this phone), so a lost connection never loses the rest.
 */

type Part = 'register' | 'vitals' | 'tests' | 'outcome'

export function AllInOne({ campaignId }: { readonly campaignId: string }) {
  return <DayScope campaignId={campaignId}><AllInOneBody /></DayScope>
}

function AllInOneBody() {
  const day = useCampaignDay()
  return (
    <section aria-labelledby="outreach-all-heading" className="flex flex-col gap-4">
      <h2 id="outreach-all-heading" className="sr-only">See one person</h2>
      <PlanState plan={day.plan} onRetry={day.refreshPlan}>{plan => <AllInOneSteps plan={plan} />}</PlanState>
    </section>
  )
}

const PART_ID: Record<Part, string> = {
  register: 'outreach-all-register', vitals: 'outreach-all-vitals', tests: 'outreach-all-tests', outcome: 'outreach-all-outcome',
}

function AllInOneSteps({ plan }: { readonly plan: OutreachPlan }) {
  const day = useCampaignDay()
  const focus = useFocusById()
  const [round, setRound] = useState(0)
  const [person, setPerson] = useState<DayVisit | null>(null)
  const [saved, setSaved] = useState<Partial<Record<Part, Saved['state']>>>({})
  const parts: Part[] = ['register', 'vitals', ...(plan.package.tests.length ? ['tests' as const] : []), 'outcome']
  const labels: Record<Part, string> = { register: 'Register', vitals: plan.package.vitals.length ? 'Vital signs' : 'Questions', tests: 'Tests', outcome: 'Outcome' }

  // A registration kept on this phone that has since been sent: carry on with the visit Outreach made.
  const upgraded = person?.kind === 'queued' ? day.synced.get(person.temporaryPatientId) : undefined
  useEffect(() => {
    if (!upgraded || person?.kind !== 'queued') return
    const next = caseVisit(upgraded)
    moveDrafts(day.drafts, person.key, next.key)
    setPerson(next)
  }, [upgraded, person, day.drafts])

  function done(part: Part, result: Saved) {
    setSaved(previous => ({ ...previous, [part]: result.state }))
    if (result.visit) setPerson(caseVisit(result.visit))
    const next = parts[parts.indexOf(part) + 1]
    if (next && part !== 'outcome') focus(`${PART_ID[next]}-heading`)
  }
  function nextPerson() {
    if (person) clearDrafts(day.drafts, person.key)
    setPerson(null)
    setSaved({})
    setRound(count => count + 1)
    focus('outreach-register-search')
  }
  const state = (part: Part): 'done' | 'queued' | 'now' | 'later' => {
    if (part === 'register') return person ? (person.kind === 'queued' ? 'queued' : 'done') : 'now'
    if (saved[part]) return saved[part] === 'queued' ? 'queued' : 'done'
    return person && parts.filter(item => item !== 'register').find(item => !saved[item]) === part ? 'now' : 'later'
  }

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Progress" className="sticky top-16 z-[var(--z-sticky)] -mx-1 rounded-xl bg-surface/95 px-1 py-2 ring-1 ring-line backdrop-blur lg:top-20">
        <ol className="m-0 grid list-none gap-1 p-0" style={{ gridTemplateColumns: `repeat(${parts.length}, minmax(0, 1fr))` }}>
          {parts.map((part, index) => {
            const now = state(part)
            return (
              <li key={part}>
                <a href={`#${PART_ID[part]}`} aria-current={now === 'now' ? 'step' : undefined}
                  onClick={event => { event.preventDefault(); document.getElementById(PART_ID[part])?.scrollIntoView({ block: 'start' }) }}
                  className={cx('flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-center text-[12px] no-underline sm:flex-row sm:gap-1.5 sm:text-[13px]',
                    now === 'now' ? 'bg-brand-soft font-semibold text-brand-ink' : now === 'later' ? 'text-ink-3' : 'text-ink')}>
                  <span aria-hidden="true" className={cx('inline-flex size-5 items-center justify-center rounded-full text-[11px] font-semibold',
                    now === 'done' ? 'bg-success text-white' : now === 'queued' ? 'bg-warn-soft text-warn-ink' : now === 'now' ? 'bg-brand-fill text-white' : 'bg-tray text-ink-3')}>
                    {now === 'done' ? <Check className="size-3" /> : now === 'queued' ? <CloudOff className="size-3" /> : index + 1}
                  </span>
                  {labels[part]}
                  <span className="sr-only">{now === 'done' ? ', done' : now === 'queued' ? ', saved on this phone' : now === 'now' ? ', now' : ''}</span>
                </a>
              </li>
            )
          })}
        </ol>
      </nav>

      <div id={PART_ID.register} className="scroll-mt-32">
        <RegisterFlow embedded resetKey={round} onRegistered={visit => { setPerson(visit); focus(`${PART_ID.vitals}-heading`) }} />
      </div>

      {person ? (
        <>
          <PersonBanner visit={person} />
          <PartCard id={PART_ID.vitals} title={labels.vitals} saved={saved.vitals}>
            <VitalsForm plan={plan} visit={person} withQuestions saveId="outreach-all-vitals-save" onSaved={result => done('vitals', result)} />
          </PartCard>
          {parts.includes('tests') ? (
            <PartCard id={PART_ID.tests} title="Tests" saved={saved.tests}>
              <TestsForm plan={plan} visit={person} saveId="outreach-all-tests-save" onSaved={result => done('tests', result)} />
            </PartCard>
          ) : null}
          <PartCard id={PART_ID.outcome} title="Outcome" keepOpen>
            <OutcomeForm plan={plan} visit={person} saveId="outreach-all-outcome-save" onSaved={result => done('outcome', result)} />
          </PartCard>
          <FormActions>
            <Button variant={saved.outcome ? 'primary' : 'secondary'} size="lg" icon={UserPlus} onClick={nextPerson}>Next person</Button>
          </FormActions>
        </>
      ) : null}
    </div>
  )
}

/** One part of the visit: its heading, then its form, or that it was saved. */
function PartCard({ id, title, saved, keepOpen = false, children }: {
  readonly id: string
  readonly title: string
  readonly saved?: Saved['state']
  readonly keepOpen?: boolean
  readonly children: React.ReactNode
}) {
  return (
    <Panel as="section" id={id} aria-labelledby={`${id}-heading`} className="flex scroll-mt-32 flex-col gap-4 p-4 sm:p-5">
      <h3 id={`${id}-heading`} tabIndex={-1} className="m-0 text-title-2 text-ink outline-none">{title}</h3>
      {saved && !keepOpen
        ? <p role="status" className="m-0 inline-flex items-center gap-2 text-[15px] text-ink">
          {saved === 'queued' ? <CloudOff className="size-4 text-warn-ink" aria-hidden /> : <Check className="size-4 text-success-ink" aria-hidden />}
          {saved === 'queued' ? 'Saved on this phone. It is sent when you’re back online.' : 'Saved.'}
        </p>
        : children}
    </Panel>
  )
}
