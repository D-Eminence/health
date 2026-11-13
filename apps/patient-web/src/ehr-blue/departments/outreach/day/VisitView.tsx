import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, EyeOff, Printer, RotateCcw } from 'lucide-react'
import { LoadingRows, Value, type FlagLevel } from '../../../../kasuwa/parts'
import { Alert, Badge, Button, Card, CardHeader } from '../../../../kasuwa/ui'
import { campaignFlowErrorText, isNotOffered, NOT_OFFERED } from '../campaignApi'
import { outreachCampaignApi } from '../campaignApi'
import {
  canSeeSensitive, STATIONS, type FollowUpStatus, type OutreachPlan, type OutreachVisit, type ReferralStatus, type ResultFlag, type VitalId,
} from '../campaignTypes'
import { bmiFrom, flagVital, outcomeText, resultFlagText, VITALS } from '../screeningTemplates'
import { caseVisit, DayScope, useCampaignDay } from './dayContext'
import { ageWords, PersonBanner, PrintSlip, sexWords } from './dayParts'

/*
 * One person's visit: their banner, then everything recorded, station by station, with who and when; the outcome,
 * referral and follow-up; and the slip. Sensitive results (HIV, hepatitis B) only for counsellors and clinicians: the
 * server leaves them out for anyone else, and this hides any it sent all the same.
 */

export function VisitView({ campaignId, caseId, onBack }: { readonly campaignId: string; readonly caseId: string; readonly onBack: () => void }) {
  return <DayScope campaignId={campaignId}><VisitBody caseId={caseId} onBack={onBack} /></DayScope>
}

type Loaded = { readonly status: 'loading' } | { readonly status: 'ready'; readonly visit: OutreachVisit } | { readonly status: 'error'; readonly message: string }

function VisitBody({ caseId, onBack }: { readonly caseId: string; readonly onBack: () => void }) {
  const day = useCampaignDay()
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [reads, setReads] = useState(0)
  useEffect(() => {
    if (!day.facilityId) return
    const abort = new AbortController()
    setLoaded(previous => previous.status === 'ready' && previous.visit.id === caseId ? previous : { status: 'loading' })
    outreachCampaignApi.visit(day.facilityId, caseId, abort.signal).then(
      visit => { if (!abort.signal.aborted) setLoaded({ status: 'ready', visit }) },
      (caught: unknown) => { if (!abort.signal.aborted) setLoaded({ status: 'error', message: isNotOffered(caught) ? NOT_OFFERED : campaignFlowErrorText(caught, 'This visit could not be read. Try again.') }) })
    return () => abort.abort()
  }, [day.facilityId, caseId, reads])
  const retry = useCallback(() => setReads(count => count + 1), [])

  return (
    <section aria-labelledby="outreach-visit-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>Back</Button>
        <h2 id="outreach-visit-heading" className="m-0 text-title-2 text-ink">{loaded.status === 'ready' ? loaded.visit.fullName ?? 'Visit' : 'Visit'}</h2>
      </div>
      {loaded.status === 'loading' ? <LoadingRows rows={4} label="Loading the visit" />
        : loaded.status === 'error' ? <Alert intent="error" title="Couldn’t load the visit" action={<Button size="sm" icon={RotateCcw} onClick={retry}>Try again</Button>}>{loaded.message}</Alert>
          : <VisitDetails visit={loaded.visit} plan={day.plan.status === 'ready' ? day.plan.value : null} />}
    </section>
  )
}

const REFERRAL_WORDS: Readonly<Record<ReferralStatus, string>> = { made: 'Referred, not there yet', arrived: 'Arrived', not_arrived: 'Did not arrive', closed: 'Closed' }
const FOLLOW_UP_WORDS: Readonly<Record<FollowUpStatus, string>> = { due: 'Due', reached: 'Reached', not_reached: 'Not reached', closed: 'Closed' }
const when = (iso: string | null | undefined) => {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}
const flagLevel = (flag: ResultFlag): FlagLevel | null => flag === 'normal' ? null : flag === 'urgent' ? 'critical' : 'abnormal'

function VisitDetails({ visit, plan }: { readonly visit: OutreachVisit; readonly plan: OutreachPlan | null }) {
  const { roles, members, campaignName } = useCampaignDay()
  const seesSensitive = canSeeSensitive(roles)
  const who = (memberId: string | null | undefined) => (memberId ? members.find(member => member.memberId === memberId)?.name : null) ?? 'A team member'
  const testOf = (testId: string) => plan?.package.tests.find(test => test.id === testId)
  const tests = (visit.tests ?? []).filter(entry => seesSensitive || !testOf(entry.testId)?.sensitive)
  const hidden = visit.sensitiveHidden || tests.length < (visit.tests ?? []).length
  const site = plan?.sites.find(item => item.id === visit.siteId)
  const partner = plan?.partners.find(item => item.id === visit.referral?.partnerId)
  const questionText = (questionId: string) => plan?.package.questions.find(question => question.id === questionId)?.text ?? 'Question'
  const done = new Set(visit.stationsDone ?? [])

  return (
    <div className="flex flex-col gap-4">
      <PersonBanner visit={caseVisit(visit)} />
      <div className="flex flex-wrap gap-2">
        {STATIONS.filter(station => plan?.stations.includes(station.value) ?? true).map(station => (
          <Badge key={station.value} size="sm" tone={done.has(station.value) ? 'success' : 'neutral'}>{station.label}: {done.has(station.value) ? 'done' : 'not yet'}</Badge>
        ))}
      </div>
      {hidden && !seesSensitive ? <Alert intent="info" icon={EyeOff} size="sm">Some results are shown only to a counsellor or clinician.</Alert> : null}

      <Section title="Registration">
        <Facts rows={[
          ['Visit code', visit.visitCode ? <span className="font-mono text-[18px] font-bold tracking-[.1em]">{visit.visitCode}</span> : 'Not given yet'],
          ['Health ID', visit.healthId ? <span className="tracking-[.04em]">{visit.healthId}{visit.identityChecked ? '' : ' · identity not yet checked'}</span> : 'Not given yet'],
          ['Age and sex', `${ageWords(visit.ageYears)} · ${sexWords(visit.sex)}`],
          ['Phone', visit.phone || 'Not given'],
          ['Site', site?.name ?? 'Not recorded'],
          ['Registered', `${when(visit.createdAt)}${visit.registeredBy ? ` by ${visit.registeredBy.name ?? who(visit.registeredBy.memberId)}` : ''}`],
        ]} />
      </Section>

      <Section title="Vital signs">
        {visit.vitals?.length ? visit.vitals.map(entry => {
          const bmi = entry.readings.bmi ?? bmiFrom(entry.readings.weight, entry.readings.height)
          const readings = { ...entry.readings, ...(bmi !== null && bmi !== undefined ? { bmi } : {}) } as Partial<Record<VitalId, number>>
          return (
            <div key={entry.entryId} className="flex flex-col gap-2">
              <p className="m-0 text-[13px] text-ink-2">{when(entry.takenAt)} · {who(entry.recordedBy)}{entry.fasting !== undefined ? ` · ${entry.fasting ? 'fasting' : 'had eaten'}` : ''}</p>
              <Facts rows={(Object.keys(readings) as VitalId[]).map(id => {
                const value = readings[id]!
                const flag = flagVital(id, value, { fasting: entry.fasting ?? false })
                const level: FlagLevel | null = flag.level === 'normal' && flag.label === 'Normal' ? null
                  : flag.level === 'refer_urgent' ? 'critical' : flag.label.endsWith('ow') ? 'low' : 'high'
                return [VITALS[id]?.name ?? id, <Value key={id} value={value} unit={VITALS[id]?.unit} flag={level} />]
              })} />
            </div>
          )
        }) : <Empty>Not taken yet.</Empty>}
        {visit.answers?.length ? (
          <Facts rows={visit.answers.map(answer => [questionText(answer.questionId), answer.value === 'yes' ? 'Yes' : answer.value === 'no' ? 'No' : answer.value])} />
        ) : null}
      </Section>

      <Section title="Tests">
        {tests.length ? <Facts rows={tests.map(entry => {
          const test = testOf(entry.testId)
          const label = entry.value !== undefined ? `${entry.value} ${test?.unit ?? ''}` : test?.results.find(option => option.value === entry.result)?.label ?? entry.result ?? 'Recorded'
          return [`${test?.name ?? 'Test'}${entry.attempt === 2 ? ' (second test)' : ''}`, <span key={entry.entryId} className="flex flex-col gap-0.5">
            <span className="inline-flex flex-wrap items-center gap-2 font-semibold">{label}{flagLevel(entry.flag) ? <Badge size="sm" tone={entry.flag === 'urgent' ? 'danger' : 'warn'}>{resultFlagText(entry.flag)}</Badge> : null}</span>
            <span className="text-[13px] text-ink-2">{when(entry.takenAt)} · {who(entry.recordedBy)}{entry.kitLot ? ` · kit lot ${entry.kitLot}` : ''}</span>
          </span>]
        })} /> : <Empty>{hidden && !seesSensitive ? 'Done by the counsellor.' : 'No tests yet.'}</Empty>}
      </Section>

      <Section title="Outcome">
        {visit.outcome ? (
          <Facts rows={[
            ['Outcome', <strong key="o">{outcomeText(visit.outcome.kind, visit.outcome.urgency)}</strong>],
            ['Why', visit.outcome.reason],
            ...(visit.outcome.suggestedKind && (visit.outcome.suggestedKind !== visit.outcome.kind || visit.outcome.suggestedUrgency !== visit.outcome.urgency)
              ? [['Suggested', outcomeText(visit.outcome.suggestedKind, visit.outcome.suggestedUrgency)] as [string, ReactNode]] : []),
            ['Confirmed', `${when(visit.outcome.confirmedAt)} by ${visit.outcome.confirmedBy.name ?? who(visit.outcome.confirmedBy.memberId)}`],
          ]} />
        ) : <Empty>Not confirmed yet.</Empty>}
        {visit.referral ? (
          <Facts rows={[
            ['Referred to', partner ? `${partner.name}, ${partner.address}` : 'A referral partner'],
            ['How soon', visit.referral.urgency === 'urgent' ? 'Urgent: today' : 'Routine'],
            ['Where it stands', REFERRAL_WORDS[visit.referral.status]],
            ...(visit.referral.notes ? [['Notes', visit.referral.notes] as [string, ReactNode]] : []),
          ]} />
        ) : null}
        {visit.followUp ? (
          <Facts rows={[
            ['Follow up on', visit.followUp.dueOn],
            ['Why', visit.followUp.reason],
            ['Where it stands', `${FOLLOW_UP_WORDS[visit.followUp.status]}${visit.followUp.attempts ? ` · ${visit.followUp.attempts} ${visit.followUp.attempts === 1 ? 'try' : 'tries'}` : ''}`],
            ...(visit.followUp.notes ? [['Notes', visit.followUp.notes] as [string, ReactNode]] : []),
          ]} />
        ) : null}
      </Section>

      <div className="flex flex-wrap gap-2">
        <Button size="lg" icon={Printer} onClick={() => window.print()}>Print slip</Button>
      </div>
      <PrintSlip fullName={visit.fullName ?? ''} visitCode={visit.visitCode ?? null} healthId={visit.healthId ?? null} campaignName={campaignName}
        results={visit.outcome ? [`Result: ${outcomeText(visit.outcome.kind, visit.outcome.urgency)}`,
          ...(partner ? [`Go to ${partner.name}, ${partner.address}.`] : []), ...(visit.followUp ? [`We will call you on ${visit.followUp.dueOn}.`] : [])] : undefined} />
    </div>
  )
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <Card>
      <CardHeader as="h3" title={title} />
      <div className="flex flex-col gap-4 px-4 pb-4 sm:px-5 sm:pb-5">{children}</div>
    </Card>
  )
}

function Facts({ rows }: { readonly rows: ReadonlyArray<readonly [string, ReactNode]> }) {
  return (
    <dl className="m-0 grid gap-x-4 gap-y-2 @md:grid-cols-[minmax(10rem,auto)_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-[13px] text-ink-2 @md:text-[14px]">{label}</dt>
          <dd className="m-0 text-[15px] text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Empty({ children }: { readonly children: ReactNode }) {
  return <p className="m-0 text-[15px] text-ink-2">{children}</p>
}
