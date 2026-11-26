import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { formatDate } from '@hid/ui/display'
import { EhrBadge, EhrButton, EhrDataTable, EhrField, EhrInput, EhrSelect, EhrSkeleton } from '@hid/ui/ehr'
import {
  workforceApi, type Facility, type LicenceRenewalEntry, type LicenceWithdrawReason, type StaffLicence, type StaffLicenceList,
  type StaffLicenceMember, type StaffLicenceMemberRead, type StaffLicenceWithRenewals,
} from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { heldRoleNames, roleName, selfServiceReview } from '../../../staff/staffAccess'
import { saveFile } from '../../../download'
import { useDeptAccess } from '../parts/access'
import { useListAtBase } from '../parts/baseAddress'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { DeptFacts, DeptLinkButton } from '../parts/DeptRecord'
import { DeptSearch } from '../parts/DeptSearch'
import { matchesSearch } from '../parts/format'
import { useIdempotencyKeys } from '../roster/hooks'
import { HrCredentials } from './HrCredentials'
import { HrTitle, TITLE_ID } from './HrParts'
import '../roster/roster.css'
import {
  CHECKED_HOW, SELF_RECORDED, WARNING_ONLY, WITHDRAW_REASONS, attestationText, bannerTitle, checkedHowText, checkedText,
  countsText, exportFileName, learnLicences, licencesServed, licenceStatusText, licenceStatusTone, licenceText, licenceYears, renewalLimits,
  renewalProblems, refusalWords, reviewPendingText, useLicencesServed, validUntilText, withdrawReasonText, type RenewalField,
  type RenewalValues,
} from './licenceRules'

const TITLE = 'HR & Credentials'

/**
 * HR & Credentials with licence renewals (hid-system ROS-1 routes 1-5): each member's licensed roles with the licence's
 * status (Valid, Expires within 60 days, Expires within 30 days, Expired, No renewal recorded, No licence on record), a
 * banner counting the expired and expiring ones, the CSV export for the facility's annual licence check, and one
 * member's licences, where the administrator records a renewal and withdraws one recorded by mistake.
 *
 * Only where today's page reads its staff (workforce.manage at a self-signed-up facility). Elsewhere, and wherever the
 * licence routes are not served (404, or 503 HR_CREDENTIALS_NOT_AVAILABLE while the flag is off), the page is today's
 * HR & Credentials (HrCredentials.tsx), sample rows and all. Once served, the sample half goes (the contract's screen
 * notes): employment information is not collected (Q244 A) and leave is on the Duty roster.
 */
export function HrCredentialsPage() {
  const { facility } = useDeptAccess()
  const canManage = facility?.permissions.includes('workforce.manage') ?? false
  if (!facility || !canManage || selfServiceReview(facility) === null) return <HrCredentials />
  return <LicenceDesk key={facility.id} facility={facility} />
}

type View = { kind: 'list' } | { kind: 'member'; membershipId: string }

function LicenceDesk({ facility }: { readonly facility: Facility }) {
  const served = useLicencesServed(facility.id)
  const leaving = useListAtBase('hr')
  const focus = useFocusById()
  const [list, setList] = useState<StaffLicenceList | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [view, setView] = useState<View>({ kind: 'list' })
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    // Read once per facility and per "Try again": learning that the routes answer must not read them again.
    if (leaving || licencesServed(facility.id) === false) return
    let alive = true
    setProblem(null)
    workforceApi.licences(facility.id).then(
      answer => { if (!alive) return; learnLicences(facility.id); setList(answer) },
      caught => {
        if (!alive || (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED')) return
        learnLicences(facility.id, caught)
        setProblem(refusalWords(caught, `${facility.name}’s licences couldn’t be loaded. Try again.`, facility.name))
      })
    return () => { alive = false }
  }, [facility.id, facility.name, leaving, revision])

  // Not served here: today's page, as it was.
  if (served === false) return <HrCredentials />

  if (view.kind === 'member') {
    return <LicenceMember facility={facility} membershipId={view.membershipId}
      onBack={() => { setView({ kind: 'list' }); setRevision(value => value + 1); focus([`licence-member-${view.membershipId}`, TITLE_ID]) }} />
  }
  return (
    <LicenceList facility={facility} list={list} problem={problem} onRetry={() => setRevision(value => value + 1)}
      onOpen={membershipId => { setView({ kind: 'member', membershipId }); focus(TITLE_ID) }} />
  )
}

interface LicenceRow {
  readonly key: string
  readonly member: StaffLicenceMember
  readonly licence: StaffLicence | null
}

function LicenceList({ facility, list, problem, onRetry, onOpen }: {
  readonly facility: Facility
  readonly list: StaffLicenceList | null
  readonly problem: string | null
  readonly onRetry: () => void
  readonly onOpen: (membershipId: string) => void
}) {
  const [search, setSearch] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportProblem, setExportProblem] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')

  async function exportCsv() {
    if (exporting) return
    setExporting(true)
    setExportProblem(null)
    setAnnouncement('')
    try {
      const file = await workforceApi.exportLicences(facility.id)
      saveFile(file.blob, exportFileName(file.headers.get('Content-Disposition')))
      setAnnouncement('The licence list was downloaded.')
    } catch (caught) {
      learnLicences(facility.id, caught)
      setExportProblem(refusalWords(caught, 'The licence list could not be downloaded. Try again.', facility.name))
    } finally { setExporting(false) }
  }

  const rows: LicenceRow[] = (list?.members ?? []).flatMap((member): LicenceRow[] => member.licences.length === 0
    ? [{ key: `${member.membershipId}-none`, member, licence: null }]
    : member.licences.map(licence => ({ key: `${member.membershipId}-${licence.role}`, member, licence })))
  const shown = rows.filter(row => matchesSearch(search, [row.member.name, heldRoleNames(row.member.roles),
    row.licence ? licenceText(row.licence) : 'No licence needed', row.licence ? licenceStatusText(row.licence.status) : '']))
  const title = list ? bannerTitle(list.counts) : null
  const pending = selfServiceReview(facility) === 'pending'

  return (
    <DeptPage title={<HrTitle>{TITLE}</HrTitle>}
      secondaryActions={list ? <EhrButton variant="secondary" busy={exporting} onClick={() => void exportCsv()}>Export CSV</EhrButton> : undefined}>
      <p className="hid-ehr-sr-only" role="status">{announcement}</p>
      {problem ? (
        <DeptNotice tone="critical" role="alert">
          <p>{problem}</p>
          <EhrButton variant="secondary" size="sm" onClick={onRetry}>Try again</EhrButton>
        </DeptNotice>
      ) : null}
      {exportProblem ? <DeptNotice tone="critical" role="alert">{exportProblem}</DeptNotice> : null}
      {list ? (
        <DeptNotice tone={title ? (list.counts.expired > 0 ? 'critical' : 'caution') : 'info'} title={title ?? undefined}>
          <p>{WARNING_ONLY}</p>
          <p>{countsText(list.counts)}. As at {formatDate(list.asOf)}.</p>
        </DeptNotice>
      ) : null}
      {pending ? <DeptNotice title="Waiting for Health ID support">{reviewPendingText(facility.name)}</DeptNotice> : null}
      {list ? (
        <DeptSearch label={`Search ${TITLE}`} value={search} onChange={setSearch} placeholder="Search staff and licences…">
          <EhrDataTable
            caption="Licences"
            captionHidden
            rows={shown}
            rowKey={row => row.key}
            emptyTitle="No matching staff"
            emptyMessage={rows.length ? 'Change your search.' : 'Nobody works here yet.'}
            columns={[
              { id: 'staff', header: 'Staff', cell: row => (
                <div>
                  <DeptLinkButton id={`licence-member-${row.member.membershipId}`} onClick={() => onOpen(row.member.membershipId)}>
                    {row.member.name}
                  </DeptLinkButton>
                  <div className="hid-ehr-dept-muted">{heldRoleNames(row.member.roles)}{row.member.isSelf ? ' · You' : ''}</div>
                </div>
              ) },
              { id: 'licence', header: 'Licence', cell: row => row.licence ? licenceText(row.licence) : 'No licence needed' },
              { id: 'status', header: 'Status', cell: row => row.licence
                ? <EhrBadge tone={licenceStatusTone(row.licence.status)}>{licenceStatusText(row.licence.status)}</EhrBadge> : null },
              { id: 'until', header: 'Valid until', cell: row => row.licence?.validUntil ? formatDate(row.licence.validUntil) : '' },
              { id: 'checked', header: 'Last checked', cell: row => row.licence?.renewal ? checkedText(row.licence.renewal) : '' },
            ]}
          />
        </DeptSearch>
      ) : !problem ? (
        <section className="hid-ehr-card hid-ehr-dept-section hid-ehr-dept-list-card" aria-label={TITLE}><EhrSkeleton label="Loading licences…" /></section>
      ) : null}
    </DeptPage>
  )
}

/** One member's licences (route 2): each with its status and every renewal, and the administrator's two actions. */
function LicenceMember({ facility, membershipId, onBack }: {
  readonly facility: Facility
  readonly membershipId: string
  readonly onBack: () => void
}) {
  const [member, setMember] = useState<StaffLicenceMemberRead | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const load = useCallback(async () => {
    setProblem(null)
    try {
      const read = await workforceApi.memberLicences(facility.id, membershipId)
      learnLicences(facility.id)
      setMember(read)
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      learnLicences(facility.id, caught)
      setProblem(refusalWords(caught, 'This person’s licences couldn’t be loaded. Try again.', facility.name))
    }
  }, [facility.id, facility.name, membershipId])
  useEffect(() => { void load() }, [load])

  const reviewed = selfServiceReview(facility) === 'reviewed'
  return (
    <DeptPage title={<HrTitle>{member?.name ?? TITLE}</HrTitle>} onBack={onBack}>
      <p className="hid-ehr-sr-only" role="status">{announcement}</p>
      {problem ? (
        <DeptNotice tone="critical" role="alert">
          <p>{problem}</p>
          <EhrButton variant="secondary" size="sm" onClick={() => void load()}>Try again</EhrButton>
        </DeptNotice>
      ) : null}
      {!member && !problem ? <EhrSkeleton label="Loading licences…" /> : null}
      {member ? (
        <>
          <div className="hid-ehr-dept-context">
            <span className="hid-ehr-dept-context-item">{heldRoleNames(member.roles)}{member.isSelf ? ' · You' : ''}</span>
          </div>
          <DeptNotice tone="info">{WARNING_ONLY}</DeptNotice>
          {!reviewed ? <DeptNotice title="Waiting for Health ID support">{reviewPendingText(facility.name)}</DeptNotice> : null}
          {member.licences.length === 0 ? (
            <DeptSection title="Licences"><p className="hid-ehr-state-message">No licensed role: this person needs no licence here.</p></DeptSection>
          ) : member.licences.map(licence => (
            <LicenceSection key={licence.role} facility={facility} member={member} licence={licence} canRecord={reviewed}
              onChanged={text => { setAnnouncement(text); void load() }} />
          ))}
        </>
      ) : null}
    </DeptPage>
  )
}

function LicenceSection({ facility, member, licence, canRecord, onChanged }: {
  readonly facility: Facility
  readonly member: StaffLicenceMemberRead
  readonly licence: StaffLicenceWithRenewals
  readonly canRecord: boolean
  readonly onChanged: (announcement: string) => void
}) {
  const [recording, setRecording] = useState(false)
  const headingId = `licence-${licence.role}`
  const onRecord = licence.status !== 'no_licence'
  return (
    <DeptSection title={`${roleName(licence.role)}: ${licenceText(licence)}`} headingId={headingId}
      actions={canRecord && onRecord && !recording ? (
        <EhrButton size="sm" variant="secondary" aria-describedby={headingId} onClick={() => setRecording(true)}>Record renewal</EhrButton>
      ) : undefined}>
      <DeptFacts facts={[
        { label: 'Status', value: <EhrBadge tone={licenceStatusTone(licence.status)}>{licenceStatusText(licence.status)}</EhrBadge> },
        ...licence.validUntil ? [{ label: 'Valid until', value: formatDate(licence.validUntil) }] : [],
        ...licence.daysLeft !== null && licence.daysLeft >= 0 ? [{ label: 'Days left', value: String(licence.daysLeft) }] : [],
      ]} />
      {licence.status === 'no_licence' ? <p className="hid-ehr-dept-muted">Add the licence on Staff & access first.</p> : null}
      {recording ? (
        <RenewalForm facility={facility} member={member} licence={licence} onCancel={() => setRecording(false)}
          onDone={() => { setRecording(false); onChanged('Renewal recorded.') }} />
      ) : null}
      <h3 className="hid-ehr-dept-roster-subheading">Renewals</h3>
      {licence.renewals.length === 0 ? <p className="hid-ehr-dept-muted">No renewal recorded yet.</p> : (
        <ul className="hid-ehr-dept-roster-requests" aria-label={`Renewals of the ${licence.body} licence`}>
          {licence.renewals.map(renewal => (
            <RenewalLine key={renewal.renewalId} facility={facility} renewal={renewal} canWithdraw={canRecord} onDone={onChanged} />
          ))}
        </ul>
      )}
    </DeptSection>
  )
}

function RenewalLine({ facility, renewal, canWithdraw, onDone }: {
  readonly facility: Facility
  readonly renewal: LicenceRenewalEntry
  readonly canWithdraw: boolean
  readonly onDone: (announcement: string) => void
}) {
  const keyFor = useIdempotencyKeys()
  const [withdrawing, setWithdrawing] = useState(false)
  const [reason, setReason] = useState<LicenceWithdrawReason | ''>('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const headingId = `renewal-${renewal.renewalId}`

  async function withdraw(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (!reason) { setProblem('Choose why it is withdrawn.'); return }
    setBusy(true)
    setProblem(null)
    try {
      await workforceApi.withdrawRenewal(facility.id, renewal.renewalId, reason, keyFor(`withdraw-${renewal.renewalId}`, reason))
      setWithdrawing(false)
      onDone('Renewal withdrawn.')
    } catch (caught) {
      learnLicences(facility.id, caught)
      setProblem(refusalWords(caught, 'The renewal could not be withdrawn. Try again.', facility.name))
    } finally { setBusy(false) }
  }

  return (
    <li aria-labelledby={headingId}>
      <div>
        <h4 id={headingId} className={renewal.withdrawn ? 'hid-ehr-dept-roster-withdrawn' : undefined}>{validUntilText(renewal)}</h4>
        <p>{checkedText(renewal)}</p>
        <p className="hid-ehr-dept-muted">
          Recorded {formatDate(renewal.recordedAt)}{renewal.checkedByName ? ` by ${renewal.checkedByName}` : ''}
          {renewal.selfRecorded ? ` · ${SELF_RECORDED}` : ''}
        </p>
        {renewal.withdrawn ? (
          <p><EhrBadge tone="neutral">Withdrawn</EhrBadge> {formatDate(renewal.withdrawn.withdrawnAt)}: {withdrawReasonText(renewal.withdrawn.reasonCode)}</p>
        ) : null}
        {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
      </div>
      {!renewal.withdrawn && canWithdraw ? (withdrawing ? (
        <form className="hid-ehr-dept-action-form" noValidate onSubmit={event => void withdraw(event)}>
          <EhrField label="Why is it withdrawn?" controlId={`${headingId}-reason`}>
            <EhrSelect value={reason} onChange={event => setReason(event.target.value as LicenceWithdrawReason | '')}>
              <option value="">Choose…</option>
              {WITHDRAW_REASONS.map(code => <option key={code} value={code}>{withdrawReasonText(code)}</option>)}
            </EhrSelect>
          </EhrField>
          <div className="hid-ehr-dept-form-actions">
            <EhrButton type="submit" size="sm" variant="danger" busy={busy}>Withdraw renewal</EhrButton>
            <EhrButton size="sm" variant="quiet" onClick={() => { setWithdrawing(false); setProblem(null) }}>Keep it</EhrButton>
          </div>
        </form>
      ) : (
        <EhrButton size="sm" variant="secondary" aria-describedby={headingId} onClick={() => setWithdrawing(true)}>Withdraw</EhrButton>
      )) : null}
    </li>
  )
}

const EMPTY_RENEWAL: RenewalValues = { period: '', licenceYear: '', validUntil: '', checkedHow: '', checkedOn: '', attested: false }

/** Record a renewal (route 4): a licence year or an expiry date, how and when it was checked, and the confirmation. */
function RenewalForm({ facility, member, licence, onCancel, onDone }: {
  readonly facility: Facility
  readonly member: StaffLicenceMemberRead
  readonly licence: StaffLicenceWithRenewals
  readonly onCancel: () => void
  readonly onDone: () => void
}) {
  const keyFor = useIdempotencyKeys()
  const focus = useFocusById()
  const [values, setValues] = useState<RenewalValues>(EMPTY_RENEWAL)
  const [problems, setProblems] = useState<Partial<Record<RenewalField, string>>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const id = `renewal-${licence.role}`
  const limits = renewalLimits()
  const set = <K extends keyof RenewalValues>(key: K, value: RenewalValues[K]) => setValues(current => ({ ...current, [key]: value }))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const found = renewalProblems(values)
    setProblems(found)
    const first = (['period', 'licenceYear', 'validUntil', 'checkedHow', 'checkedOn', 'attested'] as const).find(key => found[key])
    if (first) { focus(`${id}-${first}`); return }
    const input = values.period === 'licence_year'
      ? { membershipId: member.membershipId, role: licence.role, period: 'licence_year' as const, licenceYear: Number(values.licenceYear),
        checkedHow: values.checkedHow as typeof CHECKED_HOW[number], checkedOn: values.checkedOn }
      : { membershipId: member.membershipId, role: licence.role, period: 'expiry_date' as const, validUntil: values.validUntil,
        checkedHow: values.checkedHow as typeof CHECKED_HOW[number], checkedOn: values.checkedOn }
    setBusy(true)
    setProblem(null)
    try {
      await workforceApi.recordRenewal(facility.id, input, keyFor('renewal', input))
      onDone()
    } catch (caught) {
      learnLicences(facility.id, caught)
      setProblem(refusalWords(caught, 'The renewal could not be recorded. Try again.', facility.name))
      focus(`${id}-problem`)
    } finally { setBusy(false) }
  }

  return (
    <form className="hid-ehr-dept-action-form" noValidate onSubmit={event => void submit(event)} aria-label={`Record a renewal of the ${licence.body} licence`}>
      {member.isSelf ? <DeptNotice tone="info">This is your own licence. The renewal is marked “{SELF_RECORDED}”.</DeptNotice> : null}
      <fieldset aria-describedby={problems.period ? `${id}-period-problem` : undefined}>
        <legend id={`${id}-period`} tabIndex={-1}>What the licence shows<span aria-hidden="true"> *</span></legend>
        <label className="hid-ehr-dept-roster-choice">
          <input type="radio" name={`${id}-period`} checked={values.period === 'licence_year'} onChange={() => set('period', 'licence_year')} />
          <span>A licence year (valid to 31 December)</span>
        </label>
        <label className="hid-ehr-dept-roster-choice">
          <input type="radio" name={`${id}-period`} checked={values.period === 'expiry_date'} onChange={() => set('period', 'expiry_date')} />
          <span>An expiry date</span>
        </label>
        {problems.period ? <p id={`${id}-period-problem`} className="hid-ehr-error">{problems.period}</p> : null}
      </fieldset>
      <div className="hid-ehr-dept-form-grid">
        {values.period === 'licence_year' ? (
          <EhrField label={<>Licence year<span aria-hidden="true"> *</span></>} controlId={`${id}-licenceYear`} error={problems.licenceYear}>
            <EhrSelect value={values.licenceYear} onChange={event => set('licenceYear', event.target.value)}>
              <option value="">Choose…</option>
              {licenceYears().map(year => <option key={year} value={String(year)}>{year}</option>)}
            </EhrSelect>
          </EhrField>
        ) : null}
        {values.period === 'expiry_date' ? (
          <EhrField label={<>Expiry date<span aria-hidden="true"> *</span></>} controlId={`${id}-validUntil`} error={problems.validUntil}
            hint={values.validUntil ? formatDate(values.validUntil) : undefined}>
            <EhrInput type="date" value={values.validUntil} min={limits.validUntilMin} max={limits.validUntilMax}
              onChange={event => set('validUntil', event.target.value)} />
          </EhrField>
        ) : null}
        <EhrField label={<>How you checked it<span aria-hidden="true"> *</span></>} controlId={`${id}-checkedHow`} error={problems.checkedHow}>
          <EhrSelect value={values.checkedHow} onChange={event => set('checkedHow', event.target.value as RenewalValues['checkedHow'])}>
            <option value="">Choose…</option>
            {CHECKED_HOW.map(how => <option key={how} value={how}>{checkedHowText(how)}</option>)}
          </EhrSelect>
        </EhrField>
        <EhrField label={<>Day you checked it<span aria-hidden="true"> *</span></>} controlId={`${id}-checkedOn`} error={problems.checkedOn}
          hint={values.checkedOn ? formatDate(values.checkedOn) : 'Today or up to 90 days ago.'}>
          <EhrInput type="date" value={values.checkedOn} min={limits.checkedOnMin} max={limits.checkedOnMax}
            onChange={event => set('checkedOn', event.target.value)} />
        </EhrField>
      </div>
      <label className="hid-ehr-dept-roster-choice">
        <input id={`${id}-attested`} type="checkbox" checked={values.attested} aria-invalid={problems.attested ? true : undefined}
          aria-describedby={problems.attested ? `${id}-attested-problem` : undefined} onChange={event => set('attested', event.target.checked)} />
        <span>{attestationText(member.name)}</span>
      </label>
      {problems.attested ? <p id={`${id}-attested-problem`} className="hid-ehr-error">{problems.attested}</p> : null}
      {problem ? <DeptNotice id={`${id}-problem`} tabIndex={-1} role="alert" tone="critical">{problem}</DeptNotice> : null}
      <div className="hid-ehr-dept-form-actions">
        <EhrButton type="submit" busy={busy}>Record renewal</EhrButton>
        <EhrButton variant="quiet" onClick={onCancel}>Cancel</EhrButton>
      </div>
    </form>
  )
}

