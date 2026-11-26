import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { EhrBadge, EhrButton, EhrEmptyState, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import {
  WARD_TAKES, WARD_TYPES, facilityStaffApi, inpatientApi, type BedKind, type FacilityStaffMember, type Ward, type WardBed,
  type WardTakes, type WardType, type WardWritten,
} from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { selfServiceReview } from '../../../staff/staffAccess'
import { isRouteMissing } from '../../../staff/staffProblems'
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

/**
 * The facility's staff for the team form: `members` are those who may be on a ward's team (a nurse, clinician or doctor
 * role), `names` every member's name (a team member whose role changed is still named). 'failed': the list could not be
 * read, and the team cannot be changed until it is (Refresh reads it again). 'unavailable': the list is not read here at
 * all, so reading it again would not help, and `text` says why.
 */
export type TeamStaff =
  | { readonly state: 'loading' }
  | { readonly state: 'failed' }
  | { readonly state: 'unavailable'; readonly text: string }
  | { readonly state: 'ready'; readonly members: readonly FacilityStaffMember[]; readonly names: ReadonlyMap<string, string> }

/**
 * A facility that did not sign itself up (governed, or set up before self sign-up) has its staff managed by Health ID
 * support: Identity refuses its staff list (403 STAFF_MANAGEMENT_NOT_AVAILABLE), the only list the team can be chosen from.
 */
export const teamManagedText = (facility: string) =>
  `Health ID support manages who works at ${facility}, so a ward’s team cannot be set here yet.`

/** A refused staff read that reading again would not change (as HR & Credentials treats it), in words; null otherwise. */
export function staffNotRead(caught: unknown, facility: string): string | null {
  if (isHidApiError(caught) && caught.code === 'STAFF_MANAGEMENT_NOT_AVAILABLE') return teamManagedText(facility)
  if (isRouteMissing(caught)) return 'The staff list is not switched on yet, so a ward’s team cannot be set now.'
  return null
}

export function teamStaffOf(staff: readonly FacilityStaffMember[]): TeamStaff {
  return {
    state: 'ready',
    members: staff.filter(member => member.roles.some(role => WARD_TEAM_ROLES.has(role))),
    names: new Map(staff.map(member => [member.membershipId.toLowerCase(), member.name])),
  }
}

/**
 * A ward's team as the form may save it: only ids of members who may be on a team now. The ward keeps a member whose
 * membership ended or whose role changed (nothing takes them off), and the backend refuses the whole list with them in
 * it (WARD_STAFF_INVALID): they are dropped, and `gone` says who, so the form can tell the admin.
 */
export function teamChoice(wardIds: readonly string[] | undefined, chosen: ReadonlySet<string>, staff: Extract<TeamStaff, { state: 'ready' }>) {
  const offered = new Set(staff.members.map(member => member.membershipId.toLowerCase()))
  const gone = [...new Set((wardIds ?? []).map(id => id.toLowerCase()))].filter(id => !offered.has(id))
  return { send: [...chosen].filter(id => offered.has(id)), gone }
}

/** "Nurse Bisi Fiction and 1 former staff member": who the save takes off the team, never by id. */
export function goneText(gone: readonly string[], names: ReadonlyMap<string, string>): string {
  const named = gone.map(id => names.get(id)).filter((name): name is string => Boolean(name))
  const unnamed = gone.length - named.length
  const parts = [...named, ...(unnamed > 0 ? [`${unnamed} former staff ${unnamed === 1 ? 'member' : 'members'}`] : [])]
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

function WardConfigDesk({ facilityId }: { readonly facilityId: string }) {
  const { facility, permissions } = useDeptAccess()
  const facilityName = facility?.name ?? 'this facility'
  const keyFor = useIdempotencyKeys()
  const focus = useFocusById()
  const loader = useCallback((id: string) => inpatientApi.wards(id, { includeInactive: true, includeBeds: true, purpose: 'healthcare-operations' })
    .then(answer => { learnFrom(); return answer }, caught => { learnFrom(caught); throw caught }), [])
  const wards = useFacilityRead<{ items: Ward[] }>(facilityId, true, loader, 'The wards could not be loaded.')
  const [read, setRead] = useState<TeamStaff>({ state: 'loading' })
  const [staffRound, setStaffRound] = useState(0)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [adding, setAdding] = useState(false)
  const unavailable = wards.caught !== null && notServed(wards.caught)
  const error = wards.error ? refusalWords(wards.caught, wards.error) : ''
  const readsStaff = permissions.includes(WORKFORCE_MANAGE)
  // Identity reads the staff list only for a facility that signed itself up (useLiveStaff's condition): no read elsewhere.
  const selfService = selfServiceReview(facility) !== null
  const staff: TeamStaff = selfService ? read : { state: 'unavailable', text: teamManagedText(facilityName) }

  useEffect(() => {
    if (!readsStaff || !selfService) return
    let live = true
    void facilityStaffApi.read(facilityId).then(answer => {
      if (live) setRead(teamStaffOf(answer.members))
    }, caught => {
      if (!live) return
      const text = staffNotRead(caught, facilityName)
      setRead(text ? { state: 'unavailable', text } : { state: 'failed' })
    })
    return () => { live = false }
  }, [facilityId, facilityName, readsStaff, selfService, staffRound])

  /**
   * One write with its own key per body. A stale ward or bed reads the list again before the write ends, and 'changed'
   * tells the form it was opened from what is no longer there, so it closes rather than send its old values again.
   */
  async function write(name: string, body: unknown, send: (key: string) => Promise<WardWritten>, done: string, invalid: string): Promise<WriteOutcome> {
    if (busy) return 'refused'
    setBusy(true)
    try {
      await send(keyFor(name, body))
      // Done: the same body sent again later (a bed added again under a name used before) is a new request.
      keyFor.forget(name, body)
      setNotice({ tone: 'positive', text: done })
      void wards.refresh()
      return 'saved'
    } catch (caught) {
      if (isCancelled(caught)) return 'refused'
      learnFrom(caught)
      setNotice({ tone: 'critical', text: refusalWords(caught, 'The change could not be saved. Try again.', invalid) })
      if (isHidApiError(caught) && RELOAD_AFTER.has(caught.code)) await wards.refresh()
      return isHidApiError(caught) && caught.code === 'WARD_VERSION_CONFLICT' ? 'changed' : 'refused'
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
      secondaryActions={<EhrButton variant="secondary" busy={wards.loading && wards.value !== null} onClick={() => {
        void wards.refresh()
        if (staff.state === 'failed') { setRead({ state: 'loading' }); setStaffRound(round => round + 1) }
      }}>Refresh</EhrButton>}>
      {notice ? <DeptNotice id="ward-config-notice" tabIndex={-1} role={notice.tone === 'critical' ? 'alert' : 'status'} tone={notice.tone} variant="box">{notice.text}</DeptNotice> : null}
      {error ? <DeptNotice role="alert" tone={unavailable ? 'info' : 'critical'}>{error}</DeptNotice> : null}
      {adding && !unavailable ? (
        <WardForm busy={busy} onCancel={() => setAdding(false)} onSave={async values => {
          const saved = await write(`ward:new`, values, key => inpatientApi.createWard(facilityId, values, key),
            `${values.name.trim()} is set up. Add its beds next.`, 'Check the ward’s name, type and who it takes.')
          if (saved === 'saved') setAdding(false)
        }} />
      ) : null}
      {wards.value === null && wards.loading && !error ? <p className="hid-ehr-state-message" role="status">Loading the wards…</p> : null}
      {wards.value !== null && items.length === 0 ? <EhrEmptyState title="No wards yet." message="Select New ward to set up the first one." /> : null}
      {items.map(ward => (
        <WardSection key={ward.wardId} facilityId={facilityId} ward={ward} staff={staff} readsStaff={readsStaff} busy={busy} write={write} />
      ))}
    </DeptPage>
  )
}

/** How a write ended: saved; refused as the ward or bed changed since the form was opened (read again by then); refused. */
type WriteOutcome = 'saved' | 'changed' | 'refused'
type Write = (name: string, body: unknown, send: (key: string) => Promise<WardWritten>, done: string, invalid: string) => Promise<WriteOutcome>

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

function WardSection({ facilityId, ward, staff, readsStaff, busy, write }: {
  readonly facilityId: string
  readonly ward: Ward
  readonly staff: TeamStaff
  readonly readsStaff: boolean
  readonly busy: boolean
  readonly write: Write
}) {
  // The open form and the ward as it was when the form opened: its values start from that ward and it sends that row
  // version, so a change made since (read in the meantime) is refused (412) rather than overwritten with the old values.
  const [open, setOpen] = useState<{ readonly form: 'change' | 'bed' | 'team'; readonly ward: Ward } | null>(null)
  const headingId = `ward-${ward.wardId}-heading`
  const beds = ward.beds ?? []
  const toggle = (form: 'change' | 'bed' | 'team') => setOpen(value => value?.form === form ? null : { form, ward })
  const closeUnlessRefused = (outcome: WriteOutcome) => { if (outcome !== 'refused') setOpen(null) }
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
        <EhrButton size="sm" variant="secondary" aria-expanded={open?.form === 'change'} onClick={() => toggle('change')}>Change ward</EhrButton>
        {ward.active ? <EhrButton size="sm" variant="secondary" aria-expanded={open?.form === 'bed'} onClick={() => toggle('bed')}>Add bed</EhrButton> : null}
        {readsStaff ? <EhrButton size="sm" variant="secondary" aria-expanded={open?.form === 'team'} onClick={() => toggle('team')}>Ward team</EhrButton> : null}
        <EhrButton size="sm" variant={ward.active ? 'quiet' : 'secondary'} busy={busy}
          onClick={() => void write(`ward-active:${ward.wardId}:${ward.rowVersion}`, { active: !ward.active },
            key => inpatientApi.updateWard(facilityId, ward, { active: !ward.active }, key),
            ward.active ? `${ward.name} is closed. Its beds stay on record.` : `${ward.name} is open again.`, 'Check the ward.')}>
          {ward.active ? 'Close ward' : 'Open ward again'}
        </EhrButton>
      </div>
      {open?.form === 'change' ? (
        <WardForm ward={open.ward} busy={busy} onCancel={() => setOpen(null)} onSave={async values => {
          const opened = open.ward
          const change = {
            ...(values.name !== opened.name ? { name: values.name } : {}),
            ...(values.wardType !== opened.wardType ? { wardType: values.wardType } : {}),
            ...(values.takes !== opened.takes ? { takes: values.takes } : {}),
          }
          if (Object.keys(change).length === 0) { setOpen(null); return }
          closeUnlessRefused(await write(`ward:${opened.wardId}:${opened.rowVersion}`, change,
            key => inpatientApi.updateWard(facilityId, opened, change, key), `${values.name} is saved.`, 'Check the ward’s name, type and who it takes.'))
        }} />
      ) : null}
      {open?.form === 'bed' ? (
        <BedAddForm wardId={ward.wardId} busy={busy} onCancel={() => setOpen(null)} onSave={async values => {
          if (await write(`bed:${ward.wardId}`, values, key => inpatientApi.createBed(facilityId, ward.wardId, values, key),
            `${values.name} is added to ${ward.name}.`, 'Give the bed a name of up to 40 characters.') === 'saved') setOpen(null)
        }} />
      ) : null}
      {open?.form === 'team' ? (
        <TeamForm ward={open.ward} staff={staff} busy={busy} onCancel={() => setOpen(null)} onSave={async ids => {
          const opened = open.ward
          closeUnlessRefused(await write(`team:${opened.wardId}:${opened.rowVersion}`, ids,
            key => inpatientApi.setWardStaff(facilityId, opened, ids, key), `${opened.name}’s team is saved.`,
            'Choose nurses, clinicians and doctors who work at this facility.'))
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
  // The bed as it was when Rename was selected: its row version goes with the new name (as the ward forms do).
  const [renaming, setRenaming] = useState<WardBed | null>(null)
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
        <EhrButton size="sm" variant="quiet" aria-label={`Rename ${bed.name}`} aria-expanded={renaming !== null} onClick={() => {
          if (renaming) { setRenaming(null); return }
          setName(bed.name)
          setProblem('')
          setRenaming(bed)
        }}>Rename</EhrButton>
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
          void write(`bed-name:${renaming.bedId}:${renaming.rowVersion}`, { name: name.trim() },
            key => inpatientApi.updateBed(facilityId, renaming, { name: name.trim() }, key),
            `${name.trim()} is saved.`, 'Give the bed a name of up to 40 characters.').then(outcome => { if (outcome !== 'refused') setRenaming(null) })
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

function TeamForm({ ward, staff, busy, onCancel, onSave }: {
  readonly ward: Ward
  readonly staff: TeamStaff
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onSave: (ids: string[]) => Promise<unknown>
}) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set((ward.staffMembershipIds ?? []).map(id => id.toLowerCase())))
  const members = staff.state === 'ready' ? staff.members : []
  const choice = staff.state === 'ready' ? teamChoice(ward.staffMembershipIds, chosen, staff) : null
  return (
    <form className="hid-ehr-dept-inpatient-form" noValidate aria-labelledby={`team-${ward.wardId}-title`}
      onSubmit={event => { event.preventDefault(); if (choice) void onSave(choice.send) }}>
      <h3 id={`team-${ward.wardId}-title`}>{`${ward.name}’s team`}</h3>
      <p className="hid-ehr-dept-inpatient-hint">Nurses, clinicians and doctors who work on this ward. Being on the team never opens a patient’s record by itself.</p>
      {staff.state === 'loading' ? <p className="hid-ehr-state-message" role="status">Loading the staff…</p> : null}
      {staff.state === 'failed' ? (
        <DeptNotice role="alert" tone="critical">The staff list could not be loaded, so the team cannot be changed now. Select Refresh to try again.</DeptNotice>
      ) : null}
      {staff.state === 'unavailable' ? <DeptNotice role="status" tone="info">{staff.text}</DeptNotice> : null}
      {staff.state === 'ready' && members.length === 0 ? <p className="hid-ehr-dept-inpatient-hint">No nurses, clinicians or doctors work here yet.</p> : null}
      {choice && choice.gone.length > 0 && staff.state === 'ready' ? (
        <DeptNotice tone="caution" title="No longer on the ward roles">
          {`${goneText(choice.gone, staff.names)} no longer ${choice.gone.length === 1 ? 'works here as a nurse, clinician or doctor' : 'work here as nurses, clinicians or doctors'}. Saving the team takes them off it.`}
        </DeptNotice>
      ) : null}
      {staff.state === 'unavailable' ? null : (
        <fieldset className="hid-ehr-dept-inpatient-choices">
          <legend>Team</legend>
          {members.map(member => (
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
      )}
      <div className="hid-ehr-dept-form-actions">
        {/* Not read here at all: nothing to save, and reading again would not help. */}
        {staff.state === 'unavailable' ? null : <EhrButton type="submit" busy={busy} disabled={staff.state !== 'ready'}>Save team</EhrButton>}
        <EhrButton variant="quiet" onClick={onCancel}>{staff.state === 'unavailable' ? 'Close' : 'Cancel'}</EhrButton>
      </div>
    </form>
  )
}
