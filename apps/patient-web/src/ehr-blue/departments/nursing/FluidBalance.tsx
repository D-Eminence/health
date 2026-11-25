import { useCallback, useState, type FormEvent } from 'react'
import { EhrBadge, EhrButton, EhrEmptyState, EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import { FLUID_IN_KINDS, FLUID_OUT_KINDS, nursingApi, type FluidEntry, type FluidInput, type WardPatientCard } from '../../../staff/api'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptSection } from '../parts/DeptPage'
import { useFacilityRead } from '../parts/useFacilityRead'
import { useIdempotencyKeys, useStaffNames, type IdempotencyKeys } from './hooks'
import {
  FLUID_KIND_WORDS, balanceText, canWriteVitals, isChartAccessRefusal, lagosDate, lagosDay, lagosInput, lagosInputToIso, lagosTime,
  lagosWhen, learning, memberText, notServed, refusalWords,
} from './nursingRules'
import { ChartAccessNotice } from './parts'

/**
 * Fluid balance (NUR-1 routes 11-13; Q-NUR-6 A, Q-NUR-15 A): one fluid day (07:00 to 07:00 Lagos time unless the
 * facility chose another start hour), its intake and output totals and balance, by shift and by hour, and each entry.
 * Unmeasured entries are counted apart and never added to a total; entries in error stay, struck through, out of every
 * total.
 */
export function FluidBalance({ facilityId, admission }: { readonly facilityId: string; readonly admission: WardPatientCard | null }) {
  const { permissions, membershipId } = useDeptAccess()
  const [day, setDay] = useState('')
  const [adding, setAdding] = useState(false)
  const [saved, setSaved] = useState('')
  const keyFor = useIdempotencyKeys()
  const admissionId = admission?.admissionId ?? ''
  const loader = useCallback((id: string) => learning(nursingApi.fluidDay(id, admissionId, day || undefined)), [admissionId, day])
  const fluid = useFacilityRead(facilityId, Boolean(admissionId), loader, 'The fluid balance could not be loaded.')
  const entries = fluid.value?.entries ?? []
  const names = useStaffNames(facilityId, entries.map(entry => entry.recordedByMembershipId))
  const canRecord = canWriteVitals(permissions) && admission !== null && (admission.status === 'admitted' || admission.status === 'discharge_ready')

  if (fluid.caught && isChartAccessRefusal(fluid.caught)) return <ChartAccessNotice />
  const totals = fluid.value?.totals
  return (
    <>
      {fluid.caught ? <DeptNotice role="alert" tone={notServed(fluid.caught) ? 'info' : 'critical'}>{refusalWords(fluid.caught, 'The fluid balance could not be loaded.')}</DeptNotice> : null}
      {saved ? <p className="hid-ehr-state-message" role="status">{saved}</p> : null}
      {adding ? (
        <FluidForm facilityId={facilityId} admissionId={admissionId} keyFor={keyFor}
          onDone={message => { setAdding(false); if (message) { setSaved(message); void fluid.refresh() } }} />
      ) : null}
      <DeptSection title="Fluid balance" headingId="fluid-day"
        actions={canRecord && !adding ? <EhrButton size="sm" onClick={() => { setSaved(''); setAdding(true) }}>Add intake or output</EhrButton> : undefined}>
        <EhrField label="Fluid day" hint="Each fluid day starts at the facility’s hour (07:00 unless it chose another).">
          <EhrInput type="date" value={day} max={lagosDay()} onChange={event => setDay(event.target.value)} />
        </EhrField>
        {fluid.value === null && fluid.loading ? <p className="hid-ehr-state-message" role="status">Loading the fluid balance…</p> : null}
        {fluid.value && totals ? (
          <>
            <p className="hid-ehr-state-message">{`${lagosDate(fluid.value.day)}: ${lagosWhen(fluid.value.from)} to ${lagosWhen(fluid.value.to)}`}</p>
            <dl className="hid-ehr-dept-emergency-counts" aria-label="Fluid totals">
              <div><dt>In</dt><dd>{`${totals.intakeMl} mL`}</dd></div>
              <div><dt>Out</dt><dd>{`${totals.outputMl} mL`}</dd></div>
              <div><dt>Balance</dt><dd>{balanceText(totals.balanceMl)}</dd></div>
            </dl>
            {totals.unmeasuredIntakeCount + totals.unmeasuredOutputCount > 0 ? (
              <DeptNotice tone="caution">
                {`Not measured, and not in the totals: ${totals.unmeasuredIntakeCount} in, ${totals.unmeasuredOutputCount} out.`}
              </DeptNotice>
            ) : null}
            {fluid.value.byShift.length > 0 ? (
              <ul className="hid-ehr-dept-nursing-doses" aria-label="By shift">
                {fluid.value.byShift.map(shift => (
                  <li key={`${shift.shiftId}-${shift.shiftDate}`}>
                    <span>{`${shift.name} (${lagosTime(shift.from)} to ${lagosTime(shift.to)})`}</span>
                    <span>{`In ${shift.inMl} mL, out ${shift.outMl} mL`}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
        {fluid.value && entries.length === 0 ? <EhrEmptyState title="Nothing recorded this fluid day" message="Intake and output show here as they are recorded." /> : null}
        {entries.length > 0 ? (
          <ul className="hid-ehr-dept-waiting-list" aria-label="Entries">
            {entries.map(entry => (
              <EntryRow key={entry.entryId} facilityId={facilityId} entry={entry} keyFor={keyFor} canRecord={canRecord}
                by={memberText(entry.recordedByMembershipId, membershipId, names, 'Not recorded')} onChanged={() => void fluid.refresh()} />
            ))}
          </ul>
        ) : null}
      </DeptSection>
    </>
  )
}

function EntryRow({ facilityId, entry, by, canRecord, keyFor, onChanged }: {
  readonly facilityId: string
  readonly entry: FluidEntry
  readonly by: string
  readonly canRecord: boolean
  readonly keyFor: IdempotencyKeys
  readonly onChanged: () => void
}) {
  const [marking, setMarking] = useState(false)
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState('')
  const inError = entry.status === 'entered_in_error'
  const headingId = `fluid-${entry.entryId}`
  const amount = entry.notMeasured ? 'Not measured' : `${entry.volumeMl ?? 0} mL`

  async function mark(event: FormEvent) {
    event.preventDefault()
    if (reason.trim().length < 8) { setProblem('Say why in at least 8 characters.'); return }
    try {
      await nursingApi.fluidEnteredInError(facilityId, entry, reason.trim(), keyFor('fluid-error', { id: entry.entryId, reason: reason.trim() }))
      setMarking(false)
      onChanged()
    } catch (caught) {
      setProblem(refusalWords(caught, 'The entry could not be marked. Try again.'))
    }
  }

  return (
    <li className={['hid-ehr-dept-waiting-card', inError ? 'hid-ehr-dept-nursing-struck' : ''].filter(Boolean).join(' ')} aria-labelledby={headingId}>
      <div className="hid-ehr-dept-waiting-main">
        <h3 id={headingId} className="hid-ehr-dept-waiting-name">{`${entry.direction === 'in' ? 'In' : 'Out'}: ${FLUID_KIND_WORDS[entry.kind] ?? entry.kind}, ${amount}`}</h3>
        {inError ? <div className="hid-ehr-dept-waiting-badges"><EhrBadge tone="critical">Entered in error</EhrBadge></div> : null}
        <dl className="hid-ehr-dept-waiting-facts">
          <div><dt>Time</dt><dd>{lagosWhen(entry.recordedAt)}</dd></div>
          {entry.note ? <div><dt>Note</dt><dd>{entry.note}</dd></div> : null}
          <div><dt>Recorded by</dt><dd>{by}</dd></div>
          {inError && entry.enteredInErrorReason ? <div><dt>Why entered in error</dt><dd>{entry.enteredInErrorReason}</dd></div> : null}
        </dl>
        {canRecord && !inError && !marking ? <EhrButton size="sm" variant="secondary" onClick={() => setMarking(true)}>Mark entered in error</EhrButton> : null}
        {marking ? (
          <form className="hid-ehr-dept-nursing-form" onSubmit={event => void mark(event)} aria-label="Mark entered in error">
            <EhrField label="Why is this entered in error?" hint="At least 8 characters. The entry stays, struck through, out of the totals.">
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

/** What the form would send, or the problem to fix first (FLUID_ENTRY_INVALID's own rule, and the time's). */
export function fluidBody(draft: { direction: 'in' | 'out'; kind: string; volume: string; notMeasured: boolean; time: string; note: string },
  now: number = Date.now()): FluidInput | { problem: string } {
  const kinds: readonly string[] = draft.direction === 'in' ? FLUID_IN_KINDS : FLUID_OUT_KINDS
  if (!kinds.includes(draft.kind)) return { problem: 'Choose what it was.' }
  const recordedAt = lagosInputToIso(draft.time)
  if (!recordedAt) return { problem: 'Enter the time.' }
  const at = Date.parse(recordedAt)
  if (at > now + 60_000 || at < now - 24 * 60 * 60 * 1000) return { problem: 'The time can be up to 24 hours ago, and not in the future.' }
  const note = draft.note.trim()
  if (note.length > 200) return { problem: 'Keep the note to 200 characters.' }
  if (draft.notMeasured) return { direction: draft.direction, kind: draft.kind, notMeasured: true, recordedAt, ...(note ? { note } : {}) }
  const volume = Number(draft.volume)
  if (!draft.volume.trim() || !Number.isInteger(volume) || volume < 1 || volume > 10_000) return { problem: 'Enter the amount in mL, or mark it as not measured.' }
  return { direction: draft.direction, kind: draft.kind, volumeMl: volume, recordedAt, ...(note ? { note } : {}) }
}

function FluidForm({ facilityId, admissionId, keyFor, onDone }: {
  readonly facilityId: string
  readonly admissionId: string
  readonly keyFor: IdempotencyKeys
  readonly onDone: (message: string | null) => void
}) {
  const [direction, setDirection] = useState<'in' | 'out'>('in')
  const [kind, setKind] = useState('')
  const [volume, setVolume] = useState('')
  const [notMeasured, setNotMeasured] = useState(false)
  const [time, setTime] = useState(() => lagosInput())
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState('')
  const kinds = direction === 'in' ? FLUID_IN_KINDS : FLUID_OUT_KINDS

  async function submit(event: FormEvent) {
    event.preventDefault()
    setProblem('')
    const body = fluidBody({ direction, kind, volume, notMeasured, time, note })
    if ('problem' in body) { setProblem(body.problem); return }
    try {
      await nursingApi.recordFluid(facilityId, admissionId, body, keyFor('fluid', body))
      onDone(`${direction === 'in' ? 'Intake' : 'Output'} saved.`)
    } catch (caught) {
      setProblem(refusalWords(caught, 'The entry could not be saved. Try again.'))
    }
  }

  return (
    <DeptSection title="Add intake or output">
      <form className="hid-ehr-dept-nursing-form" onSubmit={event => void submit(event)} aria-label="Add intake or output">
        <EhrField label="In or out">
          <EhrSelect value={direction} onChange={event => { setDirection(event.target.value as 'in' | 'out'); setKind('') }}>
            <option value="in">Intake</option>
            <option value="out">Output</option>
          </EhrSelect>
        </EhrField>
        <EhrField label="What">
          <EhrSelect value={kind} onChange={event => setKind(event.target.value)}>
            <option value="">Choose</option>
            {kinds.map(value => <option key={value} value={value}>{FLUID_KIND_WORDS[value]}</option>)}
          </EhrSelect>
        </EhrField>
        <EhrField label="Amount (mL)">
          <EhrInput type="number" inputMode="numeric" min={1} max={10000} value={volume} disabled={notMeasured} onChange={event => setVolume(event.target.value)} />
        </EhrField>
        <label className="hid-ehr-dept-waiting-toggle">
          <input type="checkbox" checked={notMeasured} onChange={event => { setNotMeasured(event.target.checked); setVolume('') }} />
          <span>Not measured</span>
        </label>
        <EhrField label="Time (Lagos time)" hint="Up to 24 hours ago.">
          <EhrInput type="datetime-local" value={time} onChange={event => setTime(event.target.value)} />
        </EhrField>
        <EhrField label="Note (optional)">
          <EhrTextarea value={note} maxLength={200} onChange={event => setNote(event.target.value)} />
        </EhrField>
        {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
        <div className="hid-ehr-dept-nursing-actions">
          <EhrButton type="submit">Save</EhrButton>
          <EhrButton variant="quiet" onClick={() => onDone(null)}>Go back</EhrButton>
        </div>
      </form>
    </DeptSection>
  )
}
