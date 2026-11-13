import { useCallback, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { CircleCheck, Phone, PhoneOff, Search } from 'lucide-react'
import { PageState } from '../../../../kasuwa/parts'
import { Alert, Badge, Button, FilterTabs, Input, Textarea, type Tone } from '../../../../kasuwa/ui'
import { useDeptAccess } from '../../parts/access'
import { matchesSearch } from '../../parts/format'
import { campaignFlowErrorText, newLocalCommandId, NOT_OFFERED, outreachCampaignApi } from '../campaignApi'
import type { CampaignFollowUpRow, FollowUpStatus, ReferralStatus } from '../campaignTypes'
import { dayText, lagosToday, useCampaignRead } from './insightParts'

const FOLLOW_UPS_FAILED = 'The follow-up list could not be read. Try again.'
const SAVE_FAILED = 'This could not be saved. Try again.'

type Filter = 'due' | 'overdue' | 'done'

/** Still to call: not reached yet, or tried and not reached. */
const open = (row: CampaignFollowUpRow) => row.followUp.status === 'due' || row.followUp.status === 'not_reached'
const overdue = (row: CampaignFollowUpRow, today: string) => open(row) && row.followUp.dueOn < today

const FOLLOW_UP_WORDS: Readonly<Record<FollowUpStatus, { label: string; tone: Tone }>> = {
  due: { label: 'To call', tone: 'brand' },
  reached: { label: 'Reached', tone: 'success' },
  not_reached: { label: 'Not reached', tone: 'warn' },
  closed: { label: 'Closed', tone: 'neutral' },
}
const REFERRAL_WORDS: Readonly<Record<ReferralStatus, { label: string; tone: Tone }>> = {
  made: { label: 'Sent, not yet seen', tone: 'warn' },
  arrived: { label: 'Arrived', tone: 'success' },
  not_arrived: { label: 'Did not arrive', tone: 'danger' },
  closed: { label: 'Closed', tone: 'neutral' },
}

/** What a mark does: the follow-up's new status, or the referral's. */
type Mark =
  | { readonly kind: 'follow_up'; readonly status: 'reached' | 'not_reached' }
  | { readonly kind: 'referral'; readonly status: 'arrived' | 'not_arrived' }

const MARK_LABEL = (mark: Mark) => mark.kind === 'follow_up'
  ? (mark.status === 'reached' ? 'Reached' : 'Not reached')
  : (mark.status === 'arrived' ? 'Arrived at referral' : 'Did not arrive')

/**
 * Who to call after the campaign: name, phone (tap to call), why in plain words, and when, overdue first. Each is marked
 * Reached or Not reached, and a referral Arrived or Did not arrive, with a note. Every mark is sent with its own command
 * id, kept until it is saved, so a retry after a lost answer changes it once.
 */
export function FollowUps({ campaignId }: { readonly campaignId: string }) {
  const { facilityId } = useDeptAccess()
  const list = useCampaignRead(Boolean(facilityId),
    useCallback((signal: AbortSignal) => outreachCampaignApi.followUps(facilityId!, campaignId, signal), [facilityId, campaignId]), FOLLOW_UPS_FAILED)
  const [filter, setFilter] = useState<Filter>('due')
  const [search, setSearch] = useState('')
  const [said, setSaid] = useState('')
  const today = lagosToday()
  const { read, refresh } = list

  if (read.state === 'not_offered') return <p className="m-0 text-[14px] text-ink-2">{NOT_OFFERED}</p>
  const items = read.value?.items ?? []
  const due = items.filter(open).sort((a, b) => a.followUp.dueOn.localeCompare(b.followUp.dueOn))
  const late = due.filter(row => overdue(row, today))
  const done = items.filter(row => !open(row)).sort((a, b) => b.followUp.updatedAt.localeCompare(a.followUp.updatedAt))
  const inFilter = filter === 'due' ? due : filter === 'overdue' ? late : done
  const rows = inFilter.filter(row => matchesSearch(search, [row.fullName, row.visitCode, row.phone?.replace(/\D/g, ''), row.followUp.reason, row.referral?.partnerName]))
  const empty = items.length === 0
    ? { icon: CircleCheck, title: 'No follow-ups yet', description: 'People who need a call or a referral check show here once their outcome is confirmed.' }
    : rows.length ? null
      : search ? { icon: Search, title: 'No one matches', description: 'Search by name, visit code or phone number.' }
        : filter === 'overdue' ? { icon: CircleCheck, title: 'Nothing overdue', description: 'Everyone due has been called on time.' }
          : filter === 'due' ? { icon: CircleCheck, title: 'No one to call', description: 'Everyone has been reached.' }
            : { icon: CircleCheck, title: 'Nothing marked yet', description: 'People you mark reached or closed show here.' }

  return (
    <div className="flex flex-col gap-4">
      <div role="status" className="sr-only">{said}</div>
      <div className="flex flex-col gap-3 @xl:flex-row @xl:flex-wrap @xl:items-center @xl:justify-between">
        <FilterTabs label="Show follow-ups" value={filter} onChange={setFilter} options={[
          { value: 'due', label: 'Due', count: due.length },
          { value: 'overdue', label: 'Overdue', count: late.length, tone: 'danger' },
          { value: 'done', label: 'Done', count: done.length },
        ]} />
        <div className="min-w-0 @xl:w-80">
          <label htmlFor={`outreach-followups-search-${campaignId}`} className="sr-only">Search follow-ups</label>
          <Input id={`outreach-followups-search-${campaignId}`} type="search" icon={Search} value={search} autoComplete="off"
            placeholder="Name, visit code or phone" onChange={event => setSearch(event.target.value)} />
        </div>
      </div>
      {read.state === 'error' && read.value ? <Alert intent="error" title="Couldn’t refresh the list">{read.error}</Alert> : null}
      <PageState loading={read.state === 'loading'} error={read.state === 'error' && !read.value ? read.error : null} hasData={read.value !== null}
        onRetry={() => void refresh()} what="follow-ups" empty={empty} rows={3}>
        <ul aria-label="Follow-ups" className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))] gap-3 p-0">
          {rows.map(row => (
            <FollowUpCard key={row.caseId} row={row} today={today} facilityId={facilityId!}
              onSaved={text => { setSaid(text); void refresh() }} onStale={() => void refresh()} />
          ))}
        </ul>
      </PageState>
    </div>
  )
}

function FollowUpCard({ row, today, facilityId, onSaved, onStale }: {
  readonly row: CampaignFollowUpRow
  readonly today: string
  readonly facilityId: string
  readonly onSaved: (text: string) => void
  readonly onStale: () => void
}) {
  const [mark, setMark] = useState<Mark | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // One command per mark being made: a retry of the same mark sends the same key, so it is saved once.
  const command = useRef<{ key: string; mark: string; id: string } | null>(null)
  // Where focus goes once the form opens or closes: the note, or the first mark button again.
  const [focusTo, setFocusTo] = useState<string | null>(null)
  useLayoutEffect(() => {
    if (!focusTo) return
    setFocusTo(null)
    document.getElementById(focusTo)?.focus()
  }, [focusTo])

  const name = row.fullName ?? 'This person'
  const late = overdue(row, today)
  const isOpen = open(row)
  const referral = row.referral
  const referralOpen = referral && (referral.status === 'made' || referral.status === 'not_arrived')
  const base = `outreach-followup-${row.caseId}`
  const words = FOLLOW_UP_WORDS[row.followUp.status]

  const choose = (next: Mark | null) => {
    if (busy) return
    setMark(next)
    setError('')
    setFocusTo(next ? `${base}-note` : `${base}-first`)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mark || busy) return
    const notes = String(new FormData(event.currentTarget).get('notes') ?? '').trim()
    const markKey = `${mark.kind}:${mark.status}`
    const id = mark.kind === 'follow_up' ? row.followUp.followUpId : referral?.referralId ?? ''
    if (!command.current || command.current.mark !== markKey || command.current.id !== id) command.current = { key: newLocalCommandId(), mark: markKey, id }
    setBusy(true)
    setError('')
    try {
      if (mark.kind === 'follow_up') {
        await outreachCampaignApi.updateFollowUp(facilityId, row.caseId, row.followUp.rowVersion,
          { status: mark.status, ...(notes ? { notes } : {}) }, command.current.key)
      } else if (referral) {
        await outreachCampaignApi.updateReferral(facilityId, row.caseId, referral.rowVersion,
          { status: mark.status, ...(notes ? { notes } : {}) }, command.current.key)
      }
      command.current = null
      setMark(null)
      setFocusTo(`${base}-first`)
      onSaved(`${name}: ${MARK_LABEL(mark).toLowerCase()}. Saved.`)
    } catch (caught) {
      setError(campaignFlowErrorText(caught, SAVE_FAILED))
      if (isHidApiError(caught) && caught.code === 'VERSION_CONFLICT') { command.current = null; onStale() }
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)] ring-1 ring-line sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <h3 className="m-0 min-w-0 flex-[1_1_10rem] text-[18px] leading-tight font-semibold break-words text-ink">{name}</h3>
        <Badge size="sm" tone={words.tone}>{words.label}</Badge>
      </div>
      <p className="m-0 text-[15px] text-ink">{row.followUp.reason}</p>
      <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-ink-2">
        {row.visitCode ? <span>Visit code <span className="font-semibold tracking-[.06em] text-ink">{row.visitCode}</span></span> : null}
        {isOpen ? (late
          ? <span className="font-semibold text-danger-ink">Overdue since {dayText(row.followUp.dueOn)}</span>
          : <span>Due {dayText(row.followUp.dueOn)}</span>) : null}
        {row.followUp.attempts > 0 ? <span>Tried {row.followUp.attempts} {row.followUp.attempts === 1 ? 'time' : 'times'}</span> : null}
      </p>
      {row.followUp.notes ? <p className="m-0 text-[13px] text-ink-2">Note: {row.followUp.notes}</p> : null}
      {referral ? (
        <div className="flex flex-col gap-1 rounded-xl bg-tray px-3 py-2.5">
          <span className="flex flex-wrap items-center justify-between gap-2 text-[14px]">
            <span className="min-w-0 break-words text-ink">Referred to {referral.partnerName ?? 'a partner'}{referral.urgency === 'urgent' ? ' · urgent' : ''}</span>
            <Badge size="sm" tone={REFERRAL_WORDS[referral.status].tone}>{REFERRAL_WORDS[referral.status].label}</Badge>
          </span>
          {referral.notes ? <span className="text-[13px] text-ink-2">Note: {referral.notes}</span> : null}
        </div>
      ) : null}

      {row.phone ? (
        <a href={`tel:${row.phone.replace(/[^\d+]/g, '')}`}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-surface px-4 text-[15px] font-semibold text-ink no-underline ring-1 ring-line-control hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]">
          <Phone className="size-4" aria-hidden />Call {row.phone}
        </a>
      ) : <p className="m-0 text-[13px] text-ink-3">No phone number on their registration.</p>}

      {mark ? (
        <form className="flex flex-col gap-3" noValidate aria-label={`${MARK_LABEL(mark)}: ${name}`} onSubmit={event => void save(event)}>
          <label htmlFor={`${base}-note`} className="text-[14px] font-medium text-ink">Note <span className="font-normal text-ink-3">(optional)</span></label>
          <Textarea id={`${base}-note`} name="notes" rows={2} maxLength={500}
            placeholder={mark.kind === 'follow_up' ? (mark.status === 'reached' ? 'For example: feeling better, will go on Monday.' : 'For example: no answer, try tomorrow.') : 'For example: seen by the doctor.'} />
          {error ? <Alert intent="error" title="Not saved">{error}</Alert> : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button size="lg" aria-disabled={busy || undefined} onClick={() => choose(null)}>Cancel</Button>
            <Button size="lg" type="submit" variant="primary" aria-busy={busy || undefined} aria-disabled={busy || undefined}>{busy ? 'Saving…' : `Save: ${MARK_LABEL(mark).toLowerCase()}`}</Button>
          </div>
        </form>
      ) : isOpen || referralOpen ? (
        <div className="grid grid-cols-2 gap-2" role="group" aria-label={`Mark ${name}`}>
          {isOpen ? <>
            <Button id={`${base}-first`} size="lg" icon={CircleCheck} onClick={() => choose({ kind: 'follow_up', status: 'reached' })}>Reached</Button>
            <Button size="lg" icon={PhoneOff} onClick={() => choose({ kind: 'follow_up', status: 'not_reached' })}>Not reached</Button>
          </> : null}
          {referralOpen ? <>
            <Button id={isOpen ? undefined : `${base}-first`} size="lg" onClick={() => choose({ kind: 'referral', status: 'arrived' })}>Arrived at referral</Button>
            <Button size="lg" onClick={() => choose({ kind: 'referral', status: 'not_arrived' })}>Did not arrive</Button>
          </> : null}
        </div>
      ) : null}
    </li>
  )
}
