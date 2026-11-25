import { useCallback, useState, type FormEvent } from 'react'
import { EhrBadge, EhrButton, EhrEmptyState, EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import {
  DOSE_OUTCOMES, nursingApi, type DoseInput, type DoseOutcome, type DoseRecord, type MarOrder, type SupplySource,
} from '../../../staff/api'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection, DeptUnavailable } from '../parts/DeptPage'
import { useFacilityRead } from '../parts/useFacilityRead'
import { useIdempotencyKeys, usePolling, useStaffNames, type IdempotencyKeys } from './hooks'
import {
  DOSE_STATE_WORDS, EYEBROW, NURSING_REFUSED, OUTCOME_WORDS, PATIENT_BASE, PHARMACY_WORDS, REASONS_BY_OUTCOME, REASON_NEEDS_TEXT,
  REASON_WORDS, ROUND_TITLE, SCHEDULE_WORDS, SUPPLY_WORDS, WARNING_WORDS, canReadRound, canRecordDose, dispensed,
  doseStateTone, isChartAccessRefusal, lagosInput, lagosInputToIso, lagosTime, lagosWhen, learning, memberText, notServed,
  refusalWords,
} from './nursingRules'
import { ChartAccessNotice, PatientIdentity, PatientLink, ScreenWarning, WardPicker, WardsState, useWardChoice } from './parts'

/**
 * The medicine round (NUR-1 route 5): each admitted patient on the ward with doses due or late (or, with "Next 4
 * hours", due soon), their counts for everyone and their medicines only where the member can read the chart ("Open the
 * record to see the medicines"). Read again every minute while shown. Due doses are worked out by the server in Lagos
 * time on each read.
 */
export function MedicineRound() {
  const { facility, permissions } = useDeptAccess()
  if (!facility || !canReadRound(permissions)) return <DeptUnavailable title={ROUND_TITLE} message={NURSING_REFUSED} />
  return <WardRoundPage key={facility.id} facilityId={facility.id} />
}

function WardRoundPage({ facilityId }: { readonly facilityId: string }) {
  const { wards, active, wardId, choose } = useWardChoice(facilityId)
  const [range, setRange] = useState<'now' | 'next_4h'>('now')
  return (
    <DeptPage eyebrow={EYEBROW} title={ROUND_TITLE} className="hid-ehr-dept-nursing"
      description="Doses due and late on the ward. Open a patient to record each dose.">
      <ScreenWarning />
      <WardsState wards={wards} active={active} />
      {active.length > 1 ? <WardPicker active={active} wardId={wardId} onChoose={choose} /> : null}
      {wardId ? (
        <label className="hid-ehr-dept-waiting-toggle">
          <input type="checkbox" checked={range === 'next_4h'} onChange={event => setRange(event.target.checked ? 'next_4h' : 'now')} />
          <span>Also show doses due in the next 4 hours</span>
        </label>
      ) : null}
      {wardId ? <RoundList key={`${wardId}-${range}`} facilityId={facilityId} wardId={wardId} range={range} /> : null}
    </DeptPage>
  )
}

function RoundList({ facilityId, wardId, range }: { readonly facilityId: string; readonly wardId: string; readonly range: 'now' | 'next_4h' }) {
  const loader = useCallback((id: string) => learning(nursingApi.wardRound(id, wardId, range)), [wardId, range])
  const round = useFacilityRead(facilityId, true, loader, 'The medicine round could not be loaded.')
  usePolling(round.refresh, 60_000)
  const items = round.value?.items ?? []
  return (
    <DeptSection title={round.value ? `Due on ${round.value.wardName} (${items.length})` : 'Due on the ward'} headingId="round-list"
      actions={<EhrButton variant="secondary" size="sm" onClick={() => void round.refresh()}>Refresh</EhrButton>}>
      {round.caught ? <DeptNotice role="alert" tone={notServed(round.caught) ? 'info' : 'critical'}>{refusalWords(round.caught, 'The medicine round could not be loaded.')}</DeptNotice> : null}
      {round.value === null && round.loading ? <p className="hid-ehr-state-message" role="status">Loading the medicine round…</p> : null}
      {round.value ? <p className="hid-ehr-state-message">As of {lagosTime(round.value.at)}</p> : null}
      {round.value && items.length === 0 ? <EhrEmptyState title="No doses due" message="Patients with doses due or late show here." /> : null}
      {items.length > 0 ? (
        <ul className="hid-ehr-dept-waiting-list" aria-labelledby="round-list">
          {items.map(item => {
            const headingId = `round-${item.admissionId}`
            return (
              <li key={item.admissionId} className="hid-ehr-dept-waiting-card" aria-labelledby={headingId}>
                <div className="hid-ehr-dept-waiting-main">
                  <h3 id={headingId} className="hid-ehr-dept-waiting-name">
                    <PatientLink card={item.patient} to={`${PATIENT_BASE}/${item.admissionId}/medicines`} />
                  </h3>
                  <PatientIdentity card={item.patient} bedName={item.bedName} />
                  <div className="hid-ehr-dept-waiting-badges">
                    {item.counts.late > 0 ? <EhrBadge tone="critical">{`${item.counts.late} late`}</EhrBadge> : null}
                    {item.counts.due > 0 ? <EhrBadge tone="caution">{`${item.counts.due} due`}</EhrBadge> : null}
                    {item.counts.upcoming > 0 ? <EhrBadge tone="neutral">{`${item.counts.upcoming} upcoming`}</EhrBadge> : null}
                  </div>
                  {item.medicinesHidden ? <p className="hid-ehr-state-message">Open the record to see the medicines.</p> : (
                    <ul className="hid-ehr-dept-nursing-doses" aria-label={`Doses for ${item.patient.nameHidden ? item.patient.initials : item.patient.fullName ?? ''}`}>
                      {item.doses.map(dose => (
                        <li key={`${dose.prescriptionId}-${dose.scheduledFor}`}>
                          <span>{lagosTime(dose.scheduledFor)}</span>
                          <span>{[dose.medicationDisplay, dose.strength].filter(Boolean).join(' ')}</span>
                          <EhrBadge tone={doseStateTone(dose.state)}>{DOSE_STATE_WORDS[dose.state]}</EhrBadge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
    </DeptSection>
  )
}

/**
 * One stay's medicine administration record (routes 4, 6 and 7): every order of the stay (no schedule last), its due
 * doses with their state, the pharmacy state beside it (Q198 A), and each recorded dose. A dose is recorded against an
 * order only (Q196 A), once per scheduled time, never edited or deleted; a wrong one is marked entered in error.
 */
export function PatientMedicines({ facilityId, admissionId }: { readonly facilityId: string; readonly admissionId: string }) {
  const { permissions, membershipId } = useDeptAccess()
  const loader = useCallback((id: string) => learning(nursingApi.medicineRecord(id, admissionId)), [admissionId])
  const record = useFacilityRead(facilityId, true, loader, 'The medicines could not be loaded.')
  const names = useStaffNames(facilityId, (record.value?.administrations ?? []).map(dose => dose.recordedByMembershipId))
  const keyFor = useIdempotencyKeys()
  const [recording, setRecording] = useState<{ order: MarOrder; scheduledFor: string | null } | null>(null)
  const [done, setDone] = useState('')
  const canRecord = canRecordDose(permissions)

  if (record.caught && isChartAccessRefusal(record.caught)) return <ChartAccessNotice />
  const orders = record.value ? [...record.value.orders].sort((a, b) => Number(a.schedule === null) - Number(b.schedule === null)) : []
  const doses = record.value?.administrations ?? []

  return (
    <>
      {record.caught ? <DeptNotice role="alert" tone={notServed(record.caught) ? 'info' : 'critical'}>{refusalWords(record.caught, 'The medicines could not be loaded.')}</DeptNotice> : null}
      {record.value === null && record.loading ? <p className="hid-ehr-state-message" role="status">Loading the medicines…</p> : null}
      {done ? <p className="hid-ehr-state-message" role="status">{done}</p> : null}
      {recording ? (
        <DoseForm facilityId={facilityId} admissionId={admissionId} order={recording.order} scheduledFor={recording.scheduledFor}
          keyFor={keyFor} onDone={saved => { setRecording(null); if (saved) { setDone(saved); void record.refresh() } }} />
      ) : null}
      {record.value && orders.length === 0 ? <EhrEmptyState title="No medicines ordered" message="Medicines ordered for this stay show here." /> : null}
      {orders.length > 0 ? (
        <DeptSection title="Medicines" headingId="mar-orders">
          <ul className="hid-ehr-dept-waiting-list" aria-labelledby="mar-orders">
            {orders.map(order => (
              <OrderRow key={order.prescriptionId} order={order} canRecord={canRecord && recording === null}
                onRecord={scheduledFor => { setDone(''); setRecording({ order, scheduledFor }) }} />
            ))}
          </ul>
        </DeptSection>
      ) : null}
      {record.value ? (
        <DeptSection title="Doses recorded" headingId="mar-doses">
          {doses.length === 0 ? <EhrEmptyState title="No doses recorded yet" message="Each dose given, held or refused shows here." /> : (
            <ul className="hid-ehr-dept-waiting-list" aria-labelledby="mar-doses">
              {doses.map(dose => (
                <DoseRow key={dose.administrationId} facilityId={facilityId} dose={dose} keyFor={keyFor}
                  order={record.value!.orders.find(order => order.prescriptionId === dose.prescriptionId) ?? null}
                  by={memberText(dose.recordedByMembershipId, membershipId, names, 'Not recorded')}
                  canRecord={canRecord} onChanged={() => void record.refresh()} />
              ))}
            </ul>
          )}
        </DeptSection>
      ) : null}
    </>
  )
}

function orderTitle(order: Pick<MarOrder, 'medicationDisplay' | 'strength' | 'doseForm'>) {
  return [order.medicationDisplay, order.strength, order.doseForm].filter(Boolean).join(' ')
}

function OrderRow({ order, canRecord, onRecord }: {
  readonly order: MarOrder
  readonly canRecord: boolean
  readonly onRecord: (scheduledFor: string | null) => void
}) {
  const headingId = `order-${order.prescriptionId}`
  const active = order.status === 'active'
  const scheduled = order.schedule !== null && order.schedule.kind !== 'as_needed'
  // A dose is recorded once it is due (60 minutes either side of its time) or late; an upcoming one waits.
  const open = order.doses.filter(dose => dose.state === 'due' || dose.state === 'late')
  return (
    <li className="hid-ehr-dept-waiting-card" aria-labelledby={headingId}>
      <div className="hid-ehr-dept-waiting-main">
        <h3 id={headingId} className="hid-ehr-dept-waiting-name">{orderTitle(order)}</h3>
        <dl className="hid-ehr-dept-waiting-facts">
          <div><dt>Dose</dt><dd>{order.dose ? `${order.dose.quantity} ${order.dose.unit}` : '—'}{order.route ? `, ${order.route}` : ''}</dd></div>
          <div><dt>When</dt><dd>{order.schedule ? `${SCHEDULE_WORDS[order.schedule.kind]}${order.schedule.times?.length ? `: ${order.schedule.times.join(', ')}` : ''}` : 'No schedule'}</dd></div>
          {order.schedule?.infusion ? <div><dt>Infusion</dt><dd>{`${order.schedule.infusion.rateMlPerHour} mL an hour, ${order.schedule.infusion.volumeMl} mL${order.schedule.infusion.fluid ? ` ${order.schedule.infusion.fluid}` : ''}`}</dd></div> : null}
          <div><dt>Pharmacy</dt><dd>{PHARMACY_WORDS[order.pharmacyState]}</dd></div>
          {order.asNeeded ? (
            <>
              <div><dt>As needed for</dt><dd>{order.asNeeded.reason}</dd></div>
              <div><dt>Given in 24 hours</dt><dd>{`${order.asNeeded.givenLast24h} of at most ${order.asNeeded.maxDosesPer24h}`}</dd></div>
              <div><dt>Last given</dt><dd>{lagosWhen(order.lastGivenAt)}</dd></div>
              <div><dt>Next allowed</dt><dd>{order.nextAllowedAt ? lagosWhen(order.nextAllowedAt) : 'Now'}</dd></div>
            </>
          ) : null}
        </dl>
        {!active ? <EhrBadge tone="neutral">Not active</EhrBadge> : null}
        {scheduled && order.doses.length > 0 ? (
          <ul className="hid-ehr-dept-nursing-doses" aria-label={`Doses of ${orderTitle(order)}`}>
            {order.doses.map(dose => (
              <li key={dose.scheduledFor}>
                <span>{lagosWhen(dose.scheduledFor)}</span>
                <EhrBadge tone={doseStateTone(dose.state)}>{DOSE_STATE_WORDS[dose.state]}</EhrBadge>
                {canRecord && active && !dose.administrationId && open.includes(dose)
                  ? <EhrButton size="sm" variant="secondary" onClick={() => onRecord(dose.scheduledFor)}>{`Record ${lagosTime(dose.scheduledFor)} dose`}</EhrButton> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {canRecord && active && !scheduled ? (
          <div className="hid-ehr-dept-nursing-actions">
            <EhrButton size="sm" onClick={() => onRecord(null)}>{order.asNeeded ? 'Record an as-needed dose' : 'Record a dose'}</EhrButton>
          </div>
        ) : null}
      </div>
    </li>
  )
}

/** Route 6's form: the outcome, the time (Lagos, up to 12 hours ago), and what each outcome needs. */
function DoseForm({ facilityId, admissionId, order, scheduledFor, keyFor, onDone }: {
  readonly facilityId: string
  readonly admissionId: string
  readonly order: MarOrder
  readonly scheduledFor: string | null
  readonly keyFor: IdempotencyKeys
  readonly onDone: (saved: string | null) => void
}) {
  const [outcome, setOutcome] = useState<DoseOutcome>('given')
  const [time, setTime] = useState(() => lagosInput())
  const [quantity, setQuantity] = useState(order.dose ? String(order.dose.quantity) : '')
  const [unit, setUnit] = useState(order.dose?.unit ?? '')
  const [route, setRoute] = useState(order.route ?? '')
  const [differs, setDiffers] = useState('')
  const [reasonCode, setReasonCode] = useState('')
  const [reasonText, setReasonText] = useState('')
  const [supply, setSupply] = useState<SupplySource | ''>('')
  const [override, setOverride] = useState('')
  const [infusion, setInfusion] = useState<'' | 'started' | 'stopped'>('')
  const [problem, setProblem] = useState('')
  const [warnings, setWarnings] = useState<string[] | null>(null)

  const given = outcome === 'given'
  const doseDiffers = given && order.dose !== null && (Number(quantity) !== order.dose.quantity || unit.trim() !== order.dose.unit)
  const needsSupply = given && !dispensed(order.pharmacyState)
  const asNeededOver = given && order.asNeeded !== null && (order.asNeeded.givenLast24h >= order.asNeeded.maxDosesPer24h
    || (order.nextAllowedAt !== null && Date.parse(order.nextAllowedAt) > Date.now()))

  async function submit(event: FormEvent) {
    event.preventDefault()
    setProblem('')
    const givenAt = lagosInputToIso(time)
    if (!givenAt) { setProblem('Enter the time.'); return }
    const input: DoseInput = { prescriptionId: order.prescriptionId, scheduledFor, outcome, givenAt }
    if (given) {
      const amount = Number(quantity)
      if (!quantity || !Number.isFinite(amount) || amount <= 0 || !unit.trim()) { setProblem('Enter the dose given and its unit.'); return }
      if (!route.trim()) { setProblem('Enter how it was given.'); return }
      input.dose = { quantity: amount, unit: unit.trim() }
      input.route = route.trim()
      if (doseDiffers) {
        if (differs.trim().length < 8) { setProblem('Say why the dose differs from the order.'); return }
        input.doseDiffersReason = differs.trim()
      }
      if (needsSupply) {
        if (!supply) { setProblem('The pharmacy has not dispensed this medicine. Say where it came from.'); return }
        input.supplySource = supply
      }
      if (asNeededOver) {
        if (override.trim().length < 8) { setProblem('This is sooner or more often than ordered. Say why.'); return }
        input.overrideReason = override.trim()
      }
      if (infusion) input.infusionAction = infusion
    } else {
      if (!reasonCode) { setProblem('Choose a reason for a dose that was not given.'); return }
      input.reasonCode = reasonCode
      if (REASON_NEEDS_TEXT.has(reasonCode) && reasonText.trim().length < 8) { setProblem('Say more about the reason, in at least 8 characters.'); return }
      if (reasonText.trim()) input.reasonText = reasonText.trim()
    }
    try {
      const answer = await nursingApi.recordDose(facilityId, admissionId, input, keyFor('dose', input))
      if (answer.warnings.length > 0) { setWarnings(answer.warnings); return }
      onDone(`${OUTCOME_WORDS[outcome]}: ${orderTitle(order)} recorded.`)
    } catch (caught) {
      setProblem(refusalWords(caught, 'The dose could not be recorded. Try again.'))
    }
  }

  if (warnings) {
    return (
      <DeptSection title="Dose recorded">
        <DeptNotice tone="caution" title="Check this dose">
          <ul>{warnings.map(code => <li key={code}>{WARNING_WORDS[code] ?? 'Check this dose with the order.'}</li>)}</ul>
        </DeptNotice>
        <EhrButton onClick={() => onDone(`${OUTCOME_WORDS[outcome]}: ${orderTitle(order)} recorded.`)}>Done</EhrButton>
      </DeptSection>
    )
  }

  return (
    <DeptSection title={`Record a dose: ${orderTitle(order)}`}>
      <form className="hid-ehr-dept-nursing-form" onSubmit={event => void submit(event)} aria-label="Record a dose">
        {scheduledFor ? <p className="hid-ehr-state-message">Due {lagosWhen(scheduledFor)}</p> : null}
        <p className="hid-ehr-state-message">Pharmacy: {PHARMACY_WORDS[order.pharmacyState]}</p>
        <EhrField label="What happened">
          <EhrSelect value={outcome} onChange={event => { setOutcome(event.target.value as DoseOutcome); setReasonCode('') }}>
            {DOSE_OUTCOMES.map(value => <option key={value} value={value}>{OUTCOME_WORDS[value]}</option>)}
          </EhrSelect>
        </EhrField>
        <EhrField label="Time (Lagos time)" hint="Up to 12 hours ago, and not in the future.">
          <EhrInput type="datetime-local" value={time} onChange={event => setTime(event.target.value)} />
        </EhrField>
        {given ? (
          <>
            <EhrField label="Dose given">
              <EhrInput type="number" inputMode="decimal" min={0} step="any" value={quantity} onChange={event => setQuantity(event.target.value)} />
            </EhrField>
            <EhrField label="Unit">
              <EhrInput value={unit} maxLength={80} onChange={event => setUnit(event.target.value)} />
            </EhrField>
            <EhrField label="How it was given">
              <EhrInput value={route} maxLength={100} onChange={event => setRoute(event.target.value)} />
            </EhrField>
            {doseDiffers ? (
              <EhrField label="Why the dose differs from the order" hint="At least 8 characters.">
                <EhrTextarea value={differs} maxLength={300} onChange={event => setDiffers(event.target.value)} />
              </EhrField>
            ) : null}
            {needsSupply ? (
              <EhrField label="Where the medicine came from" hint="The pharmacy has not dispensed it yet.">
                <EhrSelect value={supply} onChange={event => setSupply(event.target.value as SupplySource | '')}>
                  <option value="">Choose</option>
                  {(Object.keys(SUPPLY_WORDS) as SupplySource[]).map(value => <option key={value} value={value}>{SUPPLY_WORDS[value]}</option>)}
                </EhrSelect>
              </EhrField>
            ) : null}
            {asNeededOver ? (
              <EhrField label="Why it is given sooner or more often than ordered" hint="At least 8 characters.">
                <EhrTextarea value={override} maxLength={300} onChange={event => setOverride(event.target.value)} />
              </EhrField>
            ) : null}
            {order.schedule?.infusion ? (
              <EhrField label="Infusion (optional)">
                <EhrSelect value={infusion} onChange={event => setInfusion(event.target.value as '' | 'started' | 'stopped')}>
                  <option value="">No change</option>
                  <option value="started">Started</option>
                  <option value="stopped">Stopped</option>
                </EhrSelect>
              </EhrField>
            ) : null}
          </>
        ) : (
          <>
            <EhrField label="Reason">
              <EhrSelect value={reasonCode} onChange={event => setReasonCode(event.target.value)}>
                <option value="">Choose a reason</option>
                {(REASONS_BY_OUTCOME[outcome] ?? []).map(code => <option key={code} value={code}>{REASON_WORDS[code]}</option>)}
              </EhrSelect>
            </EhrField>
            <EhrField label={REASON_NEEDS_TEXT.has(reasonCode) ? 'More about the reason' : 'More about the reason (optional)'}
              hint={REASON_NEEDS_TEXT.has(reasonCode) ? 'At least 8 characters.' : undefined}>
              <EhrTextarea value={reasonText} maxLength={300} onChange={event => setReasonText(event.target.value)} />
            </EhrField>
          </>
        )}
        {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
        <div className="hid-ehr-dept-nursing-actions">
          <EhrButton type="submit">Save the dose</EhrButton>
          <EhrButton variant="quiet" onClick={() => onDone(null)}>Go back</EhrButton>
        </div>
      </form>
    </DeptSection>
  )
}

function DoseRow({ facilityId, dose, order, by, canRecord, keyFor, onChanged }: {
  readonly facilityId: string
  readonly dose: DoseRecord
  readonly order: MarOrder | null
  readonly by: string
  readonly canRecord: boolean
  readonly keyFor: IdempotencyKeys
  readonly onChanged: () => void
}) {
  const [marking, setMarking] = useState(false)
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState('')
  const inError = dose.status === 'entered_in_error'
  const headingId = `dose-${dose.administrationId}`

  async function mark(event: FormEvent) {
    event.preventDefault()
    if (reason.trim().length < 8) { setProblem('Say why in at least 8 characters.'); return }
    try {
      await nursingApi.doseEnteredInError(facilityId, dose, reason.trim(), keyFor('dose-error', { id: dose.administrationId, reason: reason.trim() }))
      setMarking(false)
      onChanged()
    } catch (caught) {
      setProblem(refusalWords(caught, 'The dose could not be marked. Try again.'))
    }
  }

  return (
    <li className={['hid-ehr-dept-waiting-card', inError ? 'hid-ehr-dept-nursing-struck' : ''].filter(Boolean).join(' ')} aria-labelledby={headingId}>
      <div className="hid-ehr-dept-waiting-main">
        <h3 id={headingId} className="hid-ehr-dept-waiting-name">{order ? orderTitle(order) : 'Medicine'}</h3>
        <div className="hid-ehr-dept-waiting-badges">
          <EhrBadge tone={dose.outcome === 'given' ? 'positive' : 'caution'}>{OUTCOME_WORDS[dose.outcome]}</EhrBadge>
          {inError ? <EhrBadge tone="critical">Entered in error</EhrBadge> : null}
          {dose.late ? <EhrBadge tone="caution">Late</EhrBadge> : null}
          {dose.recordedLate ? <EhrBadge tone="neutral">Recorded late</EhrBadge> : null}
        </div>
        <dl className="hid-ehr-dept-waiting-facts">
          {dose.scheduledFor ? <div><dt>Due</dt><dd>{lagosWhen(dose.scheduledFor)}</dd></div> : null}
          <div><dt>{dose.outcome === 'given' ? 'Given' : 'Time'}</dt><dd>{lagosWhen(dose.givenAt)}</dd></div>
          {dose.dose ? <div><dt>Dose</dt><dd>{`${dose.dose.quantity} ${dose.dose.unit}${dose.route ? `, ${dose.route}` : ''}`}</dd></div> : null}
          {dose.reasonCode ? <div><dt>Reason</dt><dd>{[REASON_WORDS[dose.reasonCode] ?? dose.reasonCode, dose.reasonText].filter(Boolean).join(': ')}</dd></div> : null}
          {dose.doseDiffersReason ? <div><dt>Why the dose differs</dt><dd>{dose.doseDiffersReason}</dd></div> : null}
          {dose.supplySource ? <div><dt>Came from</dt><dd>{SUPPLY_WORDS[dose.supplySource]}</dd></div> : null}
          {dose.pharmacyStateAtRecord ? <div><dt>Pharmacy then</dt><dd>{PHARMACY_WORDS[dose.pharmacyStateAtRecord]}</dd></div> : null}
          {dose.overrideReason ? <div><dt>Why sooner or more often</dt><dd>{dose.overrideReason}</dd></div> : null}
          {dose.infusionAction ? <div><dt>Infusion</dt><dd>{dose.infusionAction === 'started' ? 'Started' : 'Stopped'}</dd></div> : null}
          <div><dt>Recorded by</dt><dd>{by}</dd></div>
          {inError && dose.enteredInErrorReason ? <div><dt>Why entered in error</dt><dd>{dose.enteredInErrorReason}</dd></div> : null}
        </dl>
        {dose.warnings.length > 0 ? <p className="hid-ehr-state-message">{dose.warnings.map(code => WARNING_WORDS[code] ?? '').filter(Boolean).join(' ')}</p> : null}
        {canRecord && !inError && !marking ? (
          <EhrButton size="sm" variant="secondary" onClick={() => setMarking(true)}>Mark entered in error</EhrButton>
        ) : null}
        {marking ? (
          <form className="hid-ehr-dept-nursing-form" onSubmit={event => void mark(event)} aria-label="Mark entered in error">
            <EhrField label="Why is this entered in error?" hint="At least 8 characters. The record stays, struck through, and the dose is due again.">
              <EhrTextarea value={reason} maxLength={500} onChange={event => setReason(event.target.value)} />
            </EhrField>
            {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
            <div className="hid-ehr-dept-nursing-actions">
              <EhrButton type="submit" size="sm" variant="danger">Mark entered in error</EhrButton>
              <EhrButton size="sm" variant="quiet" onClick={() => { setMarking(false); setProblem('') }}>Go back</EhrButton>
            </div>
          </form>
        ) : null}
      </div>
    </li>
  )
}

