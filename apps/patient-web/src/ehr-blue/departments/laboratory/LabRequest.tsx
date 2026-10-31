import { useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Pencil, Printer, RotateCcw } from 'lucide-react'
import { FormPage, PatientBanner } from '../../../kasuwa/parts'
import { Alert, Badge, Button, Card, CardHeader, DescriptionList, cx } from '../../../kasuwa/ui'
import type { LabAccession, LabExecution, LabWorkItem } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { cannotCompleteOffered, licenceLine, routeClosedForWork, wrongPatientOffered } from '../../../staff/orderRoutes'
import { OrderEndingActions, type CannotCompleteEnding, type OrderEndingMode } from '../../../staff/routes/CannotComplete'
import type { WrongPatientEnding } from '../../../staff/routes/WrongPatient'
import { useCannotCompleteServed } from '../../../cannotCompleteServed'
import { commerce, type CatalogueItem, type ListPage, type PaymentSettings, type WorkItemBill } from '../commerce/api'
import { BillBadge } from '../commerce/BillBadge'
import { useCommerceRead } from '../commerce/useCommerceRead'
import { DeptEmbedded } from '../parts/DeptEmbedded'
import { RoutedWorkLines } from '../parts/routedWork'
import { PaidLine, PaymentStep } from '../pharmacy/pointOfCare'
import { billOf, billOwing, outsideOf, paysFirst } from '../pharmacy/pocFields'
import { useLabRecord } from './labRecord'
import { Labels, usePrint } from './labPrint'
import { CheckStep, CollectStep, ResultForm, ResultValue, TestingStep, type LabSubject } from './labSteps'
import { LAB_RESULTS_HIDDEN, stampText } from './labText'
import {
  ageSex, factsOfItem, factsOfRecord, personOf, requestOf, stageFrom, STAGE_LABEL, STAGES, waitedText, walkInOf, type LabPerson, type LabStage,
} from './stage'

/** The Lab permissions that write on a request: taken away on work from another facility's order that has closed. */
const LAB_WRITE_PERMISSIONS: ReadonlySet<string> = new Set(['lab.accession.create', 'lab.specimen.collect', 'lab.specimen.receive',
  'lab.specimen.reject', 'lab.execution.start', 'lab.execution.complete', 'lab.result.enter', 'lab.result.correct',
  'lab.result.revise-released', 'lab.result.verify', 'lab.result.release'])

/** The patient's banner: name, Health ID (or none), age and sex. */
export function personBanner(person: LabPerson, compact = false): ReactNode {
  const hid = person.dateOfBirth ? person.hidText : [person.hidText, person.age].filter(Boolean).join(' · ')
  return <PatientBanner compact={compact} name={person.name} hid={hid} dateOfBirth={person.dateOfBirth} sex={person.sex} />
}

export function subjectOf(item: LabWorkItem): LabSubject {
  const person = personOf(item)
  return { name: person.name, banner: personBanner(person, true) }
}

/** The five stages as a track, the current one marked: where this request is, and how far it has to go. */
function StageTrack({ stage }: { readonly stage: LabStage }) {
  const at = STAGES.indexOf(stage)
  return <ol aria-label="Progress" className="m-0 grid list-none grid-cols-5 gap-1 p-0">
    {STAGES.map((step, index) => <li key={step} aria-current={index === at ? 'step' : undefined} className="flex min-w-0 flex-col gap-1.5">
      <span aria-hidden="true" className={cx('h-1 rounded-full', index < at || stage === 'done' ? 'bg-success' : index === at ? 'bg-brand-fill' : 'bg-line-strong')} />
      <span className={cx('break-words text-[12px] leading-tight font-medium', index === at ? 'text-ink' : 'text-ink-3')}>
        {index < at || stage === 'done' ? <Check className="mr-0.5 inline size-3" aria-hidden /> : null}{STAGE_LABEL[step]}
        <span className="sr-only">{index < at || stage === 'done' ? ', done' : index === at ? ', now' : ''}</span>
      </span>
    </li>)}
  </ol>
}

/**
 * One lab request, opened from the work list: who it is for, where it is (the stage track), the one thing to do now
 * (collect, receive and test, enter results, check & release, give the result), the payment step first when payment
 * comes before the sample, and what is known of it. Work from an order another facility sent keeps its checks and
 * endings (wrong patient, can't complete), and is read only once the order has closed.
 */
export function LabRequest({ facilityId, item, siblings, permissions: granted, settings, said, backTo, onListChanged, onEnded, onNotCompleted, onReread }: {
  readonly facilityId: string
  readonly item: LabWorkItem
  /** The other tests asked for on the same request. */
  readonly siblings: readonly LabWorkItem[]
  readonly permissions: readonly string[]
  readonly settings: PaymentSettings | null
  /** What an ending's refusal said, kept when the list read again no longer offers the form. */
  readonly said: string | null
  readonly backTo: string
  readonly onListChanged: () => void
  readonly onEnded: (ending: WrongPatientEnding) => void
  readonly onNotCompleted: (ending: Omit<CannotCompleteEnding, 'key'>) => void
  readonly onReread: (routeId: string, mode: OrderEndingMode, said?: string) => Promise<void>
}) {
  const route = item.orderRoute
  const closed = routeClosedForWork(route)
  const permissions = useMemo(() => closed ? granted.filter(permission => !LAB_WRITE_PERMISSIONS.has(permission)) : granted, [closed, granted])
  const person = personOf(item)
  const subject = useMemo(() => subjectOf(item), [item])
  const walkIn = walkInOf(item)
  const outside = outsideOf(item)
  const test = item.testName ?? 'Lab test'
  // An accession made here before the list says so.
  const [made, setMade] = useState<LabAccession | null>(null)
  const accessionId = item.accessionId || made?.id || null
  const record = useLabRecord(facilityId, accessionId, permissions.includes('lab.accession.read'), permissions.includes('lab.execution.read'))
  const accession = record.accession ?? (made?.id === accessionId ? made : null)
  const facts = accession ? factsOfRecord(accession, record.executions, item.status) : factsOfItem(item)
  const stage = stageFrom(facts)
  // Payment first (POINT_OF_CARE_SPEC §3): collecting waits for the bill to be paid or set to follow.
  const [cleared, setCleared] = useState<NonNullable<WorkItemBill> | null>(null)
  const bill = cleared ?? billOf(item)
  const collects = permissions.includes('lab.accession.create') || permissions.includes('lab.specimen.collect')
  const waitsForPayment = stage === 'collect' && collects && !closed && paysFirst(settings, 'lab') && billOwing(bill)
  // The price list's sample for this test ("Blood, EDTA tube"), as the first guess at collection.
  const catalogue = useCommerceRead<ListPage<CatalogueItem>>(stage === 'collect' && !accessionId ? `lab-test:${facilityId}:${test}` : null,
    signal => commerce.catalogueItems(facilityId, { kind: 'lab_test', q: test }, signal))
  const sampleGuess = catalogue.data?.items.find(entry => entry.name.toLowerCase() === test.toLowerCase())?.packSize ?? null
  const [notice, setNotice] = useState('')
  const [waitingFor, setWaitingFor] = useState<number | null>(null)
  const [correcting, setCorrecting] = useState<string | null>(null)
  const focus = useFocusById()
  const { print, area } = usePrint()
  const cannotServed = useCannotCompleteServed()
  const cannotComplete = cannotCompleteOffered(route, permissions, 'lab', cannotServed)

  // After a step, focus goes to the stage heading once the record has been read again, so it names the new stage.
  useLayoutEffect(() => {
    if (waitingFor === null || record.reads <= waitingFor || record.loading) return
    setWaitingFor(null)
    focus(['lab-label-print', 'lab-stage-title'], true)
  }, [waitingFor, record.reads, record.loading, focus])

  function done(message: string) {
    setNotice(message)
    setWaitingFor(record.reads)
    record.reload()
    onListChanged()
  }

  const labels = (accession?.specimens ?? []).map(specimen => ({
    key: specimen.id, name: person.name, ageSex: ageSex(person), test: `${test} · ${specimen.specimenType}`,
    requestNumber: accession?.accessionNumber ?? requestOf(item)?.number ?? '', date: stampText(null),
  }))
  const bySpecimen = (id: string) => record.executions.filter(execution => execution.specimenId === id)
  const toEnter = record.executions.filter(execution => execution.status === 'completed' && !execution.result)
  const toCheck = record.executions.filter(execution => execution.result?.status === 'entered_unverified' || execution.result?.status === 'verified_not_released')
  const released = record.executions.filter(execution => execution.result?.status === 'released')
  const canCorrect = (execution: LabExecution) => Boolean(execution.result) && permissions.includes('lab.result.correct')
    && (execution.result!.currentReleasedVersion !== execution.result!.currentVersion || permissions.includes('lab.result.revise-released'))
  const step = { facilityId, permissions, subject, routed: Boolean(route), onDone: done, onRefused: record.recheck }
  const defaultReason = walkIn?.clinicalNote ?? (outside ? `Asked for by ${outside.prescriberName}` : walkIn ? 'Walk-in request' : '')

  return <FormPage wide back={{ to: backTo, label: 'Back to the work list' }}
    title={<span id="lab-record-title" tabIndex={-1} className="outline-none">{test}</span>}
    description={[item.priority === 'urgent' || item.priority === 'stat' ? 'Urgent' : null, waitedText(item.acceptedAt) ? `waiting ${waitedText(item.acceptedAt)}` : null]
      .filter(Boolean).join(' · ') || undefined}>
    {personBanner(person)}
    <StageTrack stage={stage} />
    {said && route ? <Alert intent="error" id={`lab-${item.id}-said`}>{said}</Alert> : null}
    {route ? <DeptEmbedded className="hid-ehr-dept-laboratory-routed"><RoutedWorkLines route={route} /></DeptEmbedded> : null}
    {closed ? <Alert intent="warning">This order from another facility has ended, so nothing more can be recorded on it. You can still read what was recorded.</Alert> : null}
    <div role="status" aria-live="polite">{notice ? <p className="m-0 inline-flex items-center gap-2 text-[15px] font-medium text-success-ink">
      <Check className="size-4" aria-hidden />{notice}</p> : null}</div>

    {waitsForPayment && bill && settings ? <PaymentStep facilityId={facilityId} summary={bill} settings={settings} permissions={permissions}
      subject={subject.banner} verb="take the sample" headingId="lab-payment-title"
      onCleared={summary => { setCleared(summary); focus('lab-stage-title', true) }} /> : null}
    {cleared ? <PaidLine summary={cleared} /> : null}

    <Card>
      <CardHeader as="h2" title={<span id="lab-stage-title" tabIndex={-1} className="outline-none">{STAGE_LABEL[stage]}</span>}
        actions={labels.length > 0 ? <Button id="lab-label-print" icon={Printer} onClick={() => print('label', <Labels labels={labels} />)}>
          {labels.length > 1 ? 'Print labels' : 'Print label'}</Button> : undefined} />
      <div className="flex flex-col gap-4 p-5">
        {record.error ? <Alert intent="error" title="Couldn’t load this request" action={<Button size="sm" icon={RotateCcw} onClick={record.reload}>Try again</Button>}>{record.error}</Alert> : null}
        {record.hidden ? <Alert intent="warning" action={<Button size="sm" icon={RotateCcw} onClick={record.reload}>Refresh</Button>}>{LAB_RESULTS_HIDDEN[record.hidden]}</Alert> : null}
        {record.loading && !accession && accessionId ? <p role="status" className="m-0 text-[14px] text-ink-3">Loading…</p> : null}
        {stage === 'collect' && !waitsForPayment && !(accessionId && !accession) ? <CollectStep {...step} item={item} accession={accession}
          defaultType={sampleGuess} defaultReason={defaultReason} onCollected={value => setMade(value)} /> : null}
        {stage === 'collect' && waitsForPayment ? <p className="m-0 text-[15px] text-ink-2">Take payment above, then collect the sample.</p> : null}
        {stage === 'testing' && accession ? accession.specimens.filter(specimen => specimen.status === 'collected' || specimen.status === 'received')
          .map(specimen => <TestingStep key={`${specimen.id}-${specimen.version}`} {...step} specimen={specimen} accessionId={accession.id}
            executions={bySpecimen(specimen.id)} executionsRead={record.executionsRead} />) : null}
        {stage === 'enter' ? (permissions.includes('lab.result.enter')
          ? toEnter.map(execution => <ResultForm key={execution.id} {...step} execution={execution} result={null} />)
          : <p className="m-0 text-[15px] text-ink-2">Waiting for someone who can enter results.</p>) : null}
        {stage === 'check' ? toCheck.map(execution => <CheckStep key={`${execution.id}-${execution.result?.currentVersion}-${execution.result?.status}`} {...step} execution={execution} />) : null}
        {stage === 'done' ? <>
          {released.length > 0 ? <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
            {released.map(execution => <li key={execution.id} className="flex flex-col gap-3 py-3 first:pt-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-[1_1_12rem]"><p className="m-0 text-title-3 text-ink break-words">{execution.test.name}</p><ResultValue result={execution.result!} /></div>
                {canCorrect(execution) && correcting !== execution.id ? <Button variant="ghost" icon={Pencil} onClick={() => setCorrecting(execution.id)}>Correct<span className="sr-only">: {execution.test.name}</span></Button> : null}
              </div>
              {correcting === execution.id ? <ResultForm {...step} execution={execution} result={execution.result} onCancel={() => setCorrecting(null)}
                onDone={message => { setCorrecting(null); done(message) }} /> : null}
            </li>)}
          </ul> : null}
          <div className="flex flex-col gap-2 @md:flex-row @md:justify-end">
            <Button variant="primary" size="lg" iconRight={ArrowRight} to={`/provider/laboratory/results/${encodeURIComponent(item.id)}`}>Give result</Button>
          </div>
        </> : null}
      </div>
    </Card>

    <Card>
      <CardHeader as="h2" title="Request" actions={bill !== undefined ? <BillBadge bill={bill} /> : undefined} />
      <DescriptionList items={[
        ['Test', test],
        ['Priority', item.priority === 'urgent' || item.priority === 'stat' ? <Badge size="sm" tone="warn">Urgent</Badge> : 'Routine'],
        requestOf(item) ? ['Request', requestOf(item)!.number] : null,
        accession ? ['Sample number', accession.accessionNumber] : item.accessionNumber ? ['Sample number', item.accessionNumber] : null,
        person.phone ? ['Phone', person.phone] : null,
        walkIn?.clinicalNote ? ['Clinical note', walkIn.clinicalNote] : null,
        outside ? ['Referred by', [outside.prescriberName, outside.facilityName].filter(Boolean).join(', ')] : null,
        route?.ordererName ? ['Ordered by', route.ordererName + (route.ordererLicence ? ` · ${licenceLine(route.ordererLicence.body, route.ordererLicence.number)}` : '')] : null,
        ['Waiting', waitedText(item.acceptedAt) ?? 'Not known'],
      ]} />
    </Card>

    {siblings.length > 0 ? <Card>
      <CardHeader as="h2" title="Also on this request" />
      <ul className="m-0 list-none divide-y divide-line p-0">
        {siblings.map(other => <li key={other.id}>
          <Link to={`/provider/laboratory/work/${encodeURIComponent(other.id)}`} className="flex min-h-11 items-center justify-between gap-3 px-5 py-3 text-ink no-underline hover:bg-subtle">
            <span className="text-[15px] font-medium">{other.testName ?? 'Lab test'}</span>
            <span className="text-[13px] text-ink-3">{STAGE_LABEL[stageFrom(factsOfItem(other))]}</span>
          </Link>
        </li>)}
      </ul>
    </Card> : null}

    {route && wrongPatientOffered(route, permissions, 'lab') ? <DeptEmbedded className="hid-ehr-dept-laboratory-endings">
      <OrderEndingActions base={`lab-${item.id}`} service="lab" facilityId={facilityId}
        route={{ id: route.id, version: route.version, reference: route.reference }} title={test}
        patient={item.patient?.fullName ?? null} ordering={route.orderingFacilityName ?? 'The ordering facility'}
        cannotComplete={cannotComplete ? { priority: item.priority ?? null, accession: Boolean(item.accessionId), acceptedAt: item.acceptedAt ?? null,
          specimenStatuses: Array.isArray(item.specimenStatuses) ? item.specimenStatuses : [] } : null}
        onReread={(mode, text) => onReread(route.id, mode, text)}
        onWrongPatientEnded={result => onEnded({ service: 'lab', title: test, reference: route.reference,
          patient: item.patient?.fullName ?? null, ordering: route.orderingFacilityName ?? 'The ordering facility', result, dateOfBirthOnly: false })}
        onNotCompleted={(result, reason) => onNotCompleted({ service: 'lab', title: test, reference: route.reference,
          patient: item.patient?.fullName ?? null, ordering: route.orderingFacilityName ?? 'The ordering facility', reason, priority: item.priority ?? null, result })} />
    </DeptEmbedded> : null}
    {area}
  </FormPage>
}
