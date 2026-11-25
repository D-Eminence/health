import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { EhrBadge, EhrButton, EhrEmptyState, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import {
  WARD_TAKES, WARD_TYPES, facilityStaffApi, inpatientApi, type BedKind, type FacilityStaffMember, type Ward, type WardBed,
  type WardTakes, type WardType, type WardWritten,
} from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { useDeptAccess } from '../parts/access'
import { DeptNotice, type DeptNoticeTone } from '../parts/DeptNotice'
import { DeptPage, DeptSection, DeptUnavailable } from '../parts/DeptPage'
import { useFacilityRead } from '../parts/useFacilityRead'
import { useIdempotencyKeys } from './hooks'
import {
  BED_STATUS_TONES, RELOAD_AFTER, SETUP_REFUSED, TAKES_WORDS, WARD_CONFIG_TITLE, WARD_TYPE_WORDS, WORKFORCE_MANAGE,
  bedStatusText, canManageWards, isCancelled, learnFrom, lengthProblem, notServed, refusalWords, takesText, wardTypeText,
} from './inpatientRules'
import './inpatient.css'

/** The roles a ward's team may hold (route 6: each an active nurse, clinician or doctor membership here). */
export const WARD_TEAM_ROLES: ReadonlySet<string> = new Set(['nurse', 'clinician', 'doctor'])

/**
 * Ward configuration in the blue EHR (hid-system ADT-1 routes 1-6, Q191 A: facility admins), in place of Akos's sample
 * (clinical/sample definitions.ts "ward-config": Ward name): each ward with its type (ICU is a ward type, Q201 A), who
 * it takes, its beds and overflow spaces (never deleted: taken out of use), and its team. Healthcare operations at the
 * working facility; every write sends the row version it read and its own Idempotency-Key. The team list never opens a
 * chart. The ward charges (bed-day and admission fee) are BILL-1's and stay with Payments.
 */
export function WardConfig() {
  const { facility, permissions } = useDeptAccess()
  if (!facility || !canManageWards(permissions)) return <WardConfigUnavailable />
  return <WardConfigDesk key={facility.id} facilityId={facility.id} />
}

export function WardConfigUnavailable() {
  return <DeptUnavailable title={WARD_CONFIG_TITLE} message={SETUP_REFUSED} />
}

interface Notice { readonly tone: DeptNoticeTone; readonly text: string }

function WardConfigDesk({ facilityId }: { readonly facilityId: string }) {
  const { permissions } = useDeptAccess()
  const keyFor = useIdempotencyKeys()
  const focus = useFocusById()
  const loader = useCallback((id: string) => inpatientApi.wards(id, { includeInactive: true, includeBeds: true, purpose: 'healthcare-operations' })
    .then(answer => { learnFrom(); return answer }, caught => { learnFrom(caught); throw caught }), [])
  const wards = useFacilityRead<{ items: Ward[] }>(facilityId, true, loader, 'The wards could not be loaded.')
  const [members, setMembers] = useState<FacilityStaffMember[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [adding, setAdding] = useState(false)
  const unavailable = wards.caught !== null && notServed(wards.caught)
  const error = wards.error ? refusalWords(wards.caught, wards.error) : ''
  const readsStaff = permissions.includes(WORKFORCE_MANAGE)

  useEffect(() => {
    if (!readsStaff) return
    let live = true
    void facilityStaffApi.read(facilityId).then(staff => {
      if (live) setMembers(staff.members.filter(member => member.roles.some(role => WARD_TEAM_ROLES.has(role))))
    }, () => { if (live) setMembers([]) })
    return () => { live = false }
  }, [facilityId, readsStaff])

  /** One write with its own key per body; a stale ward reloads the list. */
  async function write(name: string, body: unknown, send: (key: string) => Promise<WardWritten>, done: string, invalid: string) {
    if (busy) return false
    setBusy(true)
    try {
      await send(keyFor(name, body))
      setNotice({ tone: 'positive', text: done })
      void wards.refresh()
      return true
    } catch (caught) {
      if (isCancelled(caught)) return false
      learnFrom(caught)
      if (isHidApiError(caught) && RELOAD_AFTER.has(caught.code)) void wards.refresh()
      setNotice({ tone: 'critical', text: refusalWords(caught, 'The change could not be saved. Try again.', invalid) })
      return false
    } finally {
      setBusy(false)
      focus('ward-config-notice')
    }
  }

  const items = wards.value?.items ?? []
  return (
    <DeptPage eyebrow="Settings" title={WARD_CONFIG_TITLE}
      description="Wards, their beds and overflow spaces, who each ward takes, and its team. ICU is a ward type."
      primaryAction={!unavailable ? <EhrButton aria-expanded={adding} onClick={() => setAdding(value => !value)}>New ward</EhrButton> : undefined}
      secondaryActions={<EhrButton variant="secondary" onClick={() => void wards.refresh()} busy={wards.loading && wards.value !== null}>Refresh</EhrButton>}>
      {notice ? <DeptNotice id="ward-config-notice" tabIndex={-1} role={notice.tone === 'critical' ? 'alert' : 'status'} tone={notice.tone} variant="box">{notice.text}</DeptNotice> : null}
      {error ? <DeptNotice role="alert" tone={unavailable ? 'info' : 'critical'}>{error}</DeptNotice> : null}
      {adding && !unavailable ? (
        <WardForm busy={busy} onCancel={() => setAdding(false)} onSave={async values => {
          const saved = await write(`ward:new`, values, key => inpatientApi.createWard(facilityId, values, key),
            `${values.name.trim()} is set up. Add its beds next.`, 'Check the ward’s name, type and who it takes.')
          if (saved) setAdding(false)
        }} />
      ) : null}
      {wards.value === null && wards.loading && !error ? <p className="hid-ehr-state-message" role="status">Loading the wards…</p> : null}
      {wards.value !== null && items.length === 0 ? <EhrEmptyState title="No wards yet." message="Select New ward to set up the first one." /> : null}
      {items.map(ward => (
        <WardSection key={ward.wardId} facilityId={facilityId} ward={ward} members={members} readsStaff={readsStaff} busy={busy} write={write} />
      ))}
    </DeptPage>
  )
}

type Write = (name: string, body: unknown, send: (key: string) => Promise<WardWritten>, done: string, invalid: string) => Promise<boolean>

function WardForm({ ward, busy, onCancel, onSave }: {
  readonly ward?: Ward
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onSave: (values: { name: string; wardType: WardType; takes: WardTakes }) => Promise<unknown>
}) {
  const id = ward ? `ward-${ward.wardId}` : 'ward-new'
  const [name, setName] = useState(ward?.name ?? '')
  const [wardType, setWardType] = useState<WardType>(ward?.wardType ?? 'general')
  const [takes, setTakes] = useState<WardTakes>(ward?.takes ?? 'any')
  const [problem, setProblem] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = lengthProblem(name, 2, 80, 'a ward name')
    if (text) { setProblem(text); return }
    setProblem('')
    await onSave({ name: name.trim(), wardType, takes })
  }
  return (
    <form className="hid-ehr-dept-inpatient-form" noValidate onSubmit={event => void submit(event)} aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{ward ? `Change ${ward.name}` : 'New ward'}</h3>
      <div className="hid-ehr-dept-form-grid">
        <EhrField label="Ward name" controlId={`${id}-name`} error={problem || undefined} hint="2 to 80 characters, such as “Female Medical Ward”.">
          <EhrInput value={name} maxLength={80} onChange={event => setName(event.target.value)} />
        </EhrField>
        <EhrField label="Ward type" controlId={`${id}-type`} hint={ward ? 'The type can change only while no bed is occupied.' : undefined}>
          <EhrSelect value={wardType} onChange={event => setWardType(event.target.value as WardType)}>
            {WARD_TYPES.map(value => <option key={value} value={value}>{WARD_TYPE_WORDS[value]}</option>)}
          </EhrSelect>
        </EhrField>
        <EhrField label="Who the ward takes" controlId={`${id}-takes`}>
          <EhrSelect value={takes} onChange={event => setTakes(event.target.value as WardTakes)}>
            {WARD_TAKES.map(value => <option key={value} value={value}>{TAKES_WORDS[value]}</option>)}
          </EhrSelect>
        </EhrField>
      </div>
      <div className="hid-ehr-dept-form-actions">
        <EhrButton type="submit" busy={busy}>{ward ? 'Save ward' : 'Set up ward'}</EhrButton>
        <EhrButton variant="quiet" onClick={onCancel}>Cancel</EhrButton>
      </div>
    </form>
  )
}

function WardSection({ facilityId, ward, members, readsStaff, busy, write }: {
  readonly facilityId: string
  readonly ward: Ward
  readonly members: FacilityStaffMember[] | null
  readonly readsStaff: boolean
  readonly busy: boolean
  readonly write: Write
}) {
  const [open, setOpen] = useState<'change' | 'bed' | 'team' | null>(null)
  const headingId = `ward-${ward.wardId}-heading`
  const beds = ward.beds ?? []
  const toggle = (next: 'change' | 'bed' | 'team') => setOpen(value => value === next ? null : next)
  return (
    <DeptSection title={ward.name} headingId={headingId}>
      <div className="hid-ehr-dept-inpatient-badges">
        <EhrBadge tone={ward.wardType === 'icu' ? 'critical' : 'brand'}>{wardTypeText(ward.wardType)}</EhrBadge>
        <EhrBadge tone="neutral">{takesText(ward.takes)}</EhrBadge>
        {ward.active ? null : <EhrBadge tone="caution">Closed</EhrBadge>}
      </div>
      <p className="hid-ehr-dept-inpatient-hint">
        {`${ward.bedCount} ${ward.bedCount === 1 ? 'bed' : 'beds'}, ${ward.overflowCount} overflow ${ward.overflowCount === 1 ? 'space' : 'spaces'}; ${ward.occupied} occupied. Team: ${ward.staffCount}.`}
      </p>
      <div className="hid-ehr-dept-inpatient-actions">
        <EhrButton size="sm" variant="secondary" aria-expanded={open === 'change'} onClick={() => toggle('change')}>Change ward</EhrButton>
        {ward.active ? <EhrButton size="sm" variant="secondary" aria-expanded={open === 'bed'} onClick={() => toggle('bed')}>Add bed</EhrButton> : null}
        {readsStaff ? <EhrButton size="sm" variant="secondary" aria-expanded={open === 'team'} onClick={() => toggle('team')}>Ward team</EhrButton> : null}
        <EhrButton size="sm" variant={ward.active ? 'quiet' : 'secondary'} busy={busy}
          onClick={() => void write(`ward-active:${ward.wardId}:${ward.rowVersion}`, { active: !ward.active },
            key => inpatientApi.updateWard(facilityId, ward, { active: !ward.active }, key),
            ward.active ? `${ward.name} is closed. Its beds stay on record.` : `${ward.name} is open again.`, 'Check the ward.')}>
          {ward.active ? 'Close ward' : 'Open ward again'}
        </EhrButton>
      </div>
      {open === 'change' ? (
        <WardForm ward={ward} busy={busy} onCancel={() => setOpen(null)} onSave={async values => {
          const change = {
            ...(values.name !== ward.name ? { name: values.name } : {}),
            ...(values.wardType !== ward.wardType ? { wardType: values.wardType } : {}),
            ...(values.takes !== ward.takes ? { takes: values.takes } : {}),
          }
          if (Object.keys(change).length === 0) { setOpen(null); return }
          if (await write(`ward:${ward.wardId}:${ward.rowVersion}`, change, key => inpatientApi.updateWard(facilityId, ward, change, key),
            `${values.name} is saved.`, 'Check the ward’s name, type and who it takes.')) setOpen(null)
        }} />
      ) : null}
      {open === 'bed' ? (
        <BedAddForm wardId={ward.wardId} busy={busy} onCancel={() => setOpen(null)} onSave={async values => {
          if (await write(`bed:${ward.wardId}`, values, key => inpatientApi.createBed(facilityId, ward.wardId, values, key),
            `${values.name} is added to ${ward.name}.`, 'Give the bed a name of up to 40 characters.')) setOpen(null)
        }} />
      ) : null}
      {open === 'team' ? (
        <TeamForm ward={ward} members={members} busy={busy} onCancel={() => setOpen(null)} onSave={async ids => {
          if (await write(`team:${ward.wardId}:${ward.rowVersion}`, ids, key => inpatientApi.setWardStaff(facilityId, ward, ids, key),
            `${ward.name}’s team is saved.`, 'Choose nurses, clinicians and doctors who work at this facility.')) setOpen(null)
        }} />
      ) : null}
      {beds.length === 0 ? <p className="hid-ehr-dept-inpatient-hint">No beds yet.</p> : (
        <ul className="hid-ehr-dept-inpatient-beds" aria-label={`Beds on ${ward.name}`}>
          {beds.map(bed => <BedRow key={bed.bedId} facilityId={facilityId} bed={bed} busy={busy} write={write} />)}
        </ul>
      )}
    </DeptSection>
  )
}

function BedAddForm({ wardId, busy, onCancel, onSave }: {
  readonly wardId: string
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onSave: (values: { name: string; kind: BedKind }) => Promise<unknown>
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<BedKind>('bed')
  const [problem, setProblem] = useState('')
  return (
    <form className="hid-ehr-dept-inpatient-form" noValidate aria-labelledby={`bed-add-${wardId}-title`} onSubmit={event => {
      event.preventDefault()
      const text = lengthProblem(name, 1, 40, 'a bed name')
      if (text) { setProblem(text); return }
      setProblem('')
      void onSave({ name: name.trim(), kind })
    }}>
      <h3 id={`bed-add-${wardId}-title`}>Add a bed</h3>
      <div className="hid-ehr-dept-form-grid">
        <EhrField label="Bed name" controlId={`bed-add-${wardId}-name`} error={problem || undefined} hint="Such as “Bed 4” or “Extra mattress 1”.">
          <EhrInput value={name} maxLength={40} onChange={event => setName(event.target.value)} />
        </EhrField>
        <EhrField label="Kind" controlId={`bed-add-${wardId}-kind`} hint="Up to 200 beds and 50 overflow spaces a ward.">
          <EhrSelect value={kind} onChange={event => setKind(event.target.value as BedKind)}>
            <option value="bed">Bed</option>
            <option value="overflow">Overflow space</option>
          </EhrSelect>
        </EhrField>
      </div>
      <div className="hid-ehr-dept-form-actions">
        <EhrButton type="submit" busy={busy}>Add bed</EhrButton>
        <EhrButton variant="quiet" onClick={onCancel}>Cancel</EhrButton>
      </div>
    </form>
  )
}

function BedRow({ facilityId, bed, busy, write }: {
  readonly facilityId: string
  readonly bed: WardBed
  readonly busy: boolean
  readonly write: Write
}) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(bed.name)
  const [problem, setProblem] = useState('')
  const active = bed.active !== false
  const headingId = `config-bed-${bed.bedId}`
  return (
    <li className="hid-ehr-dept-inpatient-bed" data-status={bed.status} aria-labelledby={headingId}>
      <h3 id={headingId} className="hid-ehr-dept-inpatient-bed-name">{bed.name}</h3>
      <div className="hid-ehr-dept-inpatient-badges">
        <EhrBadge tone={BED_STATUS_TONES[bed.status] ?? 'neutral'}>{bedStatusText(bed.status)}</EhrBadge>
        {bed.kind === 'overflow' ? <EhrBadge tone="caution">Overflow space</EhrBadge> : null}
        {active ? null : <EhrBadge tone="neutral">Out of use</EhrBadge>}
      </div>
      <div className="hid-ehr-dept-inpatient-actions">
        <EhrButton size="sm" variant="quiet" aria-label={`Rename ${bed.name}`} aria-expanded={renaming} onClick={() => setRenaming(value => !value)}>Rename</EhrButton>
        <EhrButton size="sm" variant="quiet" busy={busy} aria-label={`${active ? 'Take out of use' : 'Bring back into use'}: ${bed.name}`}
          onClick={() => void write(`bed-active:${bed.bedId}:${bed.rowVersion}`, { active: !active },
            key => inpatientApi.updateBed(facilityId, bed, { active: !active }, key),
            active ? `${bed.name} is out of use. It stays on record.` : `${bed.name} is back in use.`, 'Check the bed.')}>
          {active ? 'Take out of use' : 'Bring back into use'}
        </EhrButton>
      </div>
      {renaming ? (
        <form className="hid-ehr-dept-inpatient-form" noValidate onSubmit={event => {
          event.preventDefault()
          const text = lengthProblem(name, 1, 40, 'a bed name')
          if (text) { setProblem(text); return }
          setProblem('')
          void write(`bed-name:${bed.bedId}:${bed.rowVersion}`, { name: name.trim() }, key => inpatientApi.updateBed(facilityId, bed, { name: name.trim() }, key),
            `${name.trim()} is saved.`, 'Give the bed a name of up to 40 characters.').then(saved => { if (saved) setRenaming(false) })
        }}>
          <EhrField label="New name" controlId={`${headingId}-name`} error={problem || undefined}>
            <EhrInput value={name} maxLength={40} onChange={event => setName(event.target.value)} />
          </EhrField>
          <div className="hid-ehr-dept-form-actions">
            <EhrButton type="submit" busy={busy}>Save name</EhrButton>
          </div>
        </form>
      ) : null}
    </li>
  )
}

function TeamForm({ ward, members, busy, onCancel, onSave }: {
  readonly ward: Ward
  readonly members: FacilityStaffMember[] | null
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onSave: (ids: string[]) => Promise<unknown>
}) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set((ward.staffMembershipIds ?? []).map(id => id.toLowerCase())))
  return (
    <form className="hid-ehr-dept-inpatient-form" noValidate aria-labelledby={`team-${ward.wardId}-title`}
      onSubmit={event => { event.preventDefault(); void onSave([...chosen]) }}>
      <h3 id={`team-${ward.wardId}-title`}>{`${ward.name}’s team`}</h3>
      <p className="hid-ehr-dept-inpatient-hint">Nurses, clinicians and doctors who work on this ward. Being on the team never opens a patient’s record by itself.</p>
      {members === null ? <p className="hid-ehr-state-message" role="status">Loading the staff…</p> : null}
      {members !== null && members.length === 0 ? <p className="hid-ehr-dept-inpatient-hint">No nurses, clinicians or doctors work here yet.</p> : null}
      <fieldset className="hid-ehr-dept-inpatient-choices">
        <legend>Team</legend>
        {(members ?? []).map(member => (
          <label key={member.membershipId}>
            <input type="checkbox" checked={chosen.has(member.membershipId.toLowerCase())} onChange={event => setChosen(previous => {
              const next = new Set(previous)
              if (event.target.checked) next.add(member.membershipId.toLowerCase())
              else next.delete(member.membershipId.toLowerCase())
              return next
            })} />
            <span>{member.name}</span>
          </label>
        ))}
      </fieldset>
      <div className="hid-ehr-dept-form-actions">
        <EhrButton type="submit" busy={busy} disabled={members === null}>Save team</EhrButton>
        <EhrButton variant="quiet" onClick={onCancel}>Cancel</EhrButton>
      </div>
    </form>
  )
}
