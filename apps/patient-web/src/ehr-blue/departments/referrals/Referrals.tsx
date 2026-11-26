import { useCallback, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { EhrBadge, EhrButton, EhrEmptyState, EhrModuleTabs } from '@hid/ui/ehr'
import {
  referralsApi, type ReferralArrival, type ReferralCard, type ReferralExpected, type ReferralIncoming, type ReferralList,
} from '../../../staff/api'
import { useBluePage } from '../../frame/pageContext'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { useFacilityRead } from '../parts/useFacilityRead'
import { ArrivalPanel } from './ArrivalPanel'
import { ReferralRow, ReferralsNotServed, ReferralsRefusal } from './ReferralParts'
import { ReferralDetail } from './ReferralDetail'
import { ReferralLetterPage } from './ReferralLetter'
import {
  BASE, CONTROL_OFF, DESCRIPTION, EYEBROW, REFERRAL_ARRIVE, REFERRAL_ID, TITLE, bornText, canArrive, canRead, canReceive, canSearch,
  departmentText, healthIdEnding, learnFrom, notServed, refusalWords, sexText, urgencyText, urgencyTone, usesReferrals, whenText,
  useReferralsServed,
} from './referralRules'

/**
 * Referrals between facilities in the blue EHR (hid-system REF-1, 0191 and 0192), in place of Akos's sample Referral
 * Network (clinical/sample definitions.ts "referrals"): the Sent, Incoming, Received and Expected arrivals tabs, each only
 * for the codes it needs; one referral with its package, history and the steps this facility may take; and the printable
 * letter. Every date and time is Lagos's, whatever the device's zone. Addresses carry a referral's UUID only, never a
 * Health ID or a name. While Health ID does not serve referrals here (404, or 503 while switched off), the demo
 * facilities keep today's sample, and every other facility is told they are not available yet.
 */
export function Referrals() {
  const { facility, permissions } = useDeptAccess()
  const served = useReferralsServed()
  if (!facility || !usesReferrals(permissions)) return <ReferralsRefusal />
  if (served === false) return <ReferralsNotServed />
  return <ReferralsDesk key={facility.id} facilityId={facility.id} />
}

export type ReferralTab = 'sent' | 'incoming' | 'received' | 'expected'
const TAB_ORDER: readonly ReferralTab[] = ['sent', 'incoming', 'received', 'expected']

/** The tabs this member may use: Sent with the read code, Incoming and Received with receive, Expected arrivals with arrive. */
export function tabsFor(permissions: readonly string[]): ReferralTab[] {
  return TAB_ORDER.filter(tab => tab === 'sent' ? canRead(permissions)
    : tab === 'expected' ? permissions.includes(REFERRAL_ARRIVE) : canReceive(permissions))
}

function ReferralsDesk({ facilityId }: { readonly facilityId: string }) {
  const { rest } = useBluePage()
  const { permissions } = useDeptAccess()
  // The waiting count, once Incoming has been read: the tab shows it from then on (no read only for a count).
  const [waiting, setWaiting] = useState<number | null>(null)
  const below = rest.replace(/\/+$/, '')
  const tabs = tabsFor(permissions)
  if (below === '') return tabs.length > 0 ? <Navigate replace to={`${BASE}/${tabs[0]}`} /> : <SendOnly />
  if ((TAB_ORDER as readonly string[]).includes(below)) {
    const tab = below as ReferralTab
    if (!tabs.includes(tab)) return <Navigate replace to={BASE} />
    return <ListPage facilityId={facilityId} tab={tab} tabs={tabs} waiting={waiting} onWaiting={setWaiting} />
  }
  const [id = '', sub, ...more] = below.split('/')
  if (REFERRAL_ID.test(id) && more.length === 0) {
    if (sub === undefined) return <ReferralDetail key={id} facilityId={facilityId} referralId={id.toLowerCase()} />
    if (sub === 'letter') return <ReferralLetterPage key={id} facilityId={facilityId} referralId={id.toLowerCase()} />
  }
  // Anything else (a sample record's id, a mistyped address): the list.
  return <Navigate replace to={BASE} />
}

/** A member who may only send (no list of their own): referrals are sent from a patient's visit. */
function SendOnly() {
  return (
    <DeptPage eyebrow={EYEBROW} title={TITLE} description={DESCRIPTION} className="hid-ehr-dept-referrals">
      <DeptNotice tone="info">Send a referral from a patient’s visit, under Orders.</DeptNotice>
    </DeptPage>
  )
}

const TAB_LABELS: Readonly<Record<ReferralTab, string>> = { sent: 'Sent', incoming: 'Incoming', received: 'Received', expected: 'Expected arrivals' }

function ListPage({ facilityId, tab, tabs, waiting, onWaiting }: {
  readonly facilityId: string
  readonly tab: ReferralTab
  readonly tabs: readonly ReferralTab[]
  readonly waiting: number | null
  readonly onWaiting: (count: number) => void
}) {
  const navigate = useNavigate()
  const [reload, setReload] = useState(0)
  return (
    <DeptPage eyebrow={EYEBROW} title={TITLE} description={DESCRIPTION} className="hid-ehr-dept-referrals"
      secondaryActions={<EhrButton variant="secondary" onClick={() => setReload(count => count + 1)}>Refresh</EhrButton>}>
      <EhrModuleTabs className="hid-ehr-dept-referrals-tabs" label="Referrals" currentId={tab}
        tabs={tabs.map(id => ({ id, href: `${BASE}/${id}`, label: id === 'incoming' && waiting !== null ? `${TAB_LABELS[id]} (${waiting})` : TAB_LABELS[id] }))}
        onNavigate={(item, event) => { event.preventDefault(); navigate(item.href) }} />
      {tab === 'sent' ? <SentList key={reload} facilityId={facilityId} /> : null}
      {tab === 'incoming' ? <IncomingList key={reload} facilityId={facilityId} onWaiting={onWaiting} /> : null}
      {tab === 'received' ? <ReceivedList key={reload} facilityId={facilityId} /> : null}
      {tab === 'expected' ? <ExpectedList key={reload} facilityId={facilityId} /> : null}
    </DeptPage>
  )
}

/** A read that learns whether referrals are served from its answer. */
function served<T>(read: Promise<T>): Promise<T> {
  return read.then(answer => { learnFrom(); return answer }, (caught: unknown) => { learnFrom(caught); throw caught })
}

/** The sent or received list, newest first, 50 at a time. */
function PagedList({ facilityId, which }: { readonly facilityId: string; readonly which: 'sent' | 'received' }) {
  const loader = useCallback((id: string) => served(which === 'sent' ? referralsApi.sent(id, { limit: 50 }) : referralsApi.received(id, { limit: 50 })), [which])
  const list = useFacilityRead<ReferralList>(facilityId, true, loader, 'The referrals could not be loaded.')
  const [more, setMore] = useState<{ items: readonly ReferralCard[]; nextCursor: string | null } | null>(null)
  const [moreBusy, setMoreBusy] = useState(false)
  const [moreError, setMoreError] = useState('')
  const items = [...(list.value?.items ?? []), ...(more?.items ?? [])]
  const next = more ? more.nextCursor : list.value?.nextCursor ?? null
  const name = which === 'sent' ? 'Referrals sent from this facility' : 'Referrals this facility answered'

  async function loadMore() {
    if (!next || moreBusy) return
    setMoreBusy(true); setMoreError('')
    try {
      const page = await served(which === 'sent' ? referralsApi.sent(facilityId, { limit: 50, cursor: next })
        : referralsApi.received(facilityId, { limit: 50, cursor: next }))
      setMore(previous => ({ items: [...(previous?.items ?? []), ...page.items], nextCursor: page.nextCursor }))
    } catch (caught) {
      setMoreError(refusalWords(caught, 'More referrals could not be loaded. Try again.'))
    } finally { setMoreBusy(false) }
  }

  if (list.caught && notServed(list.caught)) return null
  return (
    <DeptSection title={name} headingId={`referrals-${which}-title`}>
      {list.error ? <DeptNotice role="alert" tone="critical">{refusalWords(list.caught, list.error)}</DeptNotice> : null}
      {list.value === null && list.loading ? <p className="hid-ehr-state-message" role="status">Loading referrals…</p> : null}
      {list.value !== null && items.length === 0 ? (
        <EhrEmptyState title={which === 'sent' ? 'No referrals sent in the last 90 days' : 'No referrals answered in the last 90 days'}
          message={which === 'sent' ? 'Send a referral from a patient’s visit, under Orders.' : 'Referrals other facilities send here are under Incoming.'} />
      ) : null}
      {items.length > 0 ? (
        <ul className="hid-ehr-dept-referrals-list" aria-labelledby={`referrals-${which}-title`}>
          {items.map(card => <ReferralRow key={card.referralId} card={card} />)}
        </ul>
      ) : null}
      {moreError ? <DeptNotice role="alert" tone="critical">{moreError}</DeptNotice> : null}
      {next ? <div className="hid-ehr-dept-form-actions"><EhrButton variant="secondary" busy={moreBusy} onClick={() => void loadMore()}>Show more</EhrButton></div> : null}
    </DeptSection>
  )
}

function SentList({ facilityId }: { readonly facilityId: string }) {
  return <PagedList facilityId={facilityId} which="sent" />
}

function ReceivedList({ facilityId }: { readonly facilityId: string }) {
  return <PagedList facilityId={facilityId} which="received" />
}

/**
 * Referrals waiting for this facility's answer, urgent first. Before accepting, a card shows the reason, the department
 * and service, the urgency, who referred and the patient's sex and age only (Q-REF-8 A); with the control off, only the
 * reference, facilities, department, urgency and dates come, and a referral can be declined but not accepted.
 */
function IncomingList({ facilityId, onWaiting }: { readonly facilityId: string; readonly onWaiting: (count: number) => void }) {
  const loader = useCallback((id: string) => served(referralsApi.incoming(id)).then(answer => {
    onWaiting(answer.counts.waiting)
    return answer
  }), [onWaiting])
  const list = useFacilityRead<ReferralIncoming>(facilityId, true, loader, 'Incoming referrals could not be loaded.')
  if (list.caught && notServed(list.caught)) return null
  const items = list.value?.items ?? []
  const metadataOnly = items.some(card => card.viewLevel === 'metadata')
  const counts = list.value?.counts
  return (
    <DeptSection title="Waiting for your answer" headingId="referrals-incoming-title">
      {list.error ? <DeptNotice role="alert" tone="critical">{refusalWords(list.caught, list.error)}</DeptNotice> : null}
      {list.value === null && list.loading ? <p className="hid-ehr-state-message" role="status">Loading incoming referrals…</p> : null}
      {counts ? <p className="hid-ehr-dept-referrals-line" role="status">{counts.waiting} waiting{counts.urgent > 0 ? `, ${counts.urgent} urgent` : ''}</p> : null}
      {metadataOnly ? (
        <DeptNotice tone="caution" title="Accepting is switched off">
          {CONTROL_OFF.replace(' You can print a referral letter instead.', '')} You can still decline a referral, so the referring facility knows.
        </DeptNotice>
      ) : null}
      {list.value !== null && items.length === 0 ? (
        <EhrEmptyState title="No referrals waiting" message="Referrals other facilities send here show here until you answer them." />
      ) : null}
      {items.length > 0 ? (
        <ul className="hid-ehr-dept-referrals-list" aria-labelledby="referrals-incoming-title">
          {items.map(card => <ReferralRow key={card.referralId} card={card} />)}
        </ul>
      ) : null}
      {list.value?.hasMore ? <DeptNotice tone="caution">Only the first {list.value.limit} referrals are shown, the most urgent first. Answer them to see the rest.</DeptNotice> : null}
    </DeptSection>
  )
}

/**
 * The front desk's expected arrivals: accepted referrals not yet arrived, urgent first. Identity and the booking only
 * (name, sex, date of birth, the last 4 characters of the Health ID, the referring facility, department and urgency),
 * never the reason, letter or package (Q-REF-14 A). "Patient arrived" opens the arrival under its row.
 */
function ExpectedList({ facilityId }: { readonly facilityId: string }) {
  const { permissions } = useDeptAccess()
  const loader = useCallback((id: string) => served(referralsApi.expected(id)), [])
  const list = useFacilityRead(facilityId, true, loader, 'Expected arrivals could not be loaded.')
  const [open, setOpen] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const arrives = canArrive(permissions)
  const { refresh } = list

  function arrived(item: ReferralExpected, result: ReferralArrival) {
    setOpen(null)
    setDone(result.outcome === 'already_on_list'
      ? `${item.patient.fullName} is marked arrived. They were already on the waiting list.`
      : `${item.patient.fullName} is marked arrived and checked in to the waiting list.`)
    void refresh()
  }

  if (list.caught && notServed(list.caught)) return null
  const items = list.value?.items ?? []
  return (
    <DeptSection title="Expected arrivals" headingId="referrals-expected-title">
      {done ? <DeptNotice role="status" tone="positive">{done}</DeptNotice> : null}
      {list.error ? <DeptNotice role="alert" tone="critical">{refusalWords(list.caught, list.error, true)}</DeptNotice> : null}
      {list.value === null && list.loading ? <p className="hid-ehr-state-message" role="status">Loading expected arrivals…</p> : null}
      {!arrives ? <DeptNotice tone="info">Your role at this facility can’t check patients in, so it can’t mark them arrived.</DeptNotice> : null}
      {list.value !== null && items.length === 0 ? (
        <EhrEmptyState title="No referred patients expected" message="Patients whose referral this facility accepted show here until they arrive." />
      ) : null}
      {items.length > 0 ? (
        <ul className="hid-ehr-dept-referrals-list" aria-labelledby="referrals-expected-title">
          {items.map(item => {
            const headingId = `expected-${item.referralId}`
            const patient = item.patient
            return (
              <li key={item.referralId} className="hid-ehr-dept-referrals-card" aria-labelledby={headingId}>
                <div className="hid-ehr-dept-referrals-main">
                  <h3 id={headingId} className="hid-ehr-dept-referrals-name">{patient.fullName}</h3>
                  <p className="hid-ehr-dept-referrals-line">
                    {sexText(patient.sex) ? <span>{sexText(patient.sex)}</span> : null}
                    {patient.dateOfBirth ? <span>{bornText(patient.dateOfBirth, patient.dateOfBirthEstimated)}</span> : null}
                    {patient.healthIdLast4 ? <span aria-label={`Health ID ending ${patient.healthIdLast4}`}>{healthIdEnding(patient.healthIdLast4)}</span> : null}
                  </p>
                  <p className="hid-ehr-dept-referrals-line">
                    <span>From {item.referringFacilityName}</span>
                    <span>{departmentText(item.departmentCode)}{item.serviceWanted ? ` · ${item.serviceWanted}` : ''}</span>
                    <span>Reference {item.reference}</span>
                  </p>
                  <p className="hid-ehr-dept-referrals-line">
                    <span>Accepted {whenText(item.acceptedAt)}</span>
                    <span>Arrive by {whenText(item.arriveBy)}</span>
                  </p>
                  <div className="hid-ehr-dept-referrals-badges">
                    <EhrBadge tone={urgencyTone(item.urgency)}>{urgencyText(item.urgency)}</EhrBadge>
                  </div>
                </div>
                {arrives ? (
                  <div className="hid-ehr-dept-referrals-actions">
                    <EhrButton size="sm" variant={open === item.referralId ? 'secondary' : 'primary'} aria-expanded={open === item.referralId}
                      aria-label={`Patient arrived: ${patient.fullName}`}
                      onClick={() => { setDone(null); setOpen(open === item.referralId ? null : item.referralId) }}>
                      {open === item.referralId ? 'Cancel' : 'Patient arrived'}
                    </EhrButton>
                  </div>
                ) : null}
                {open === item.referralId ? (
                  <ArrivalPanel facilityId={facilityId} item={item} canSearch={canSearch(permissions)}
                    onArrived={result => arrived(item, result)} onStale={() => void refresh()} />
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
      {list.value?.hasMore ? <DeptNotice tone="caution">Only the first {list.value.limit} expected patients are shown, the most urgent first.</DeptNotice> : null}
    </DeptSection>
  )
}

