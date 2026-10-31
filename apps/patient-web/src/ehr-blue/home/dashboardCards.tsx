import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { EhrButton, EhrCard, EhrDrawer, EhrEmptyState, EhrField, EhrSampleBanner, EhrSelect, EhrSkeleton } from '@hid/ui/ehr'
import { facilityStaffApi, type Facility } from '../../staff/api'
import { visibleNavigation } from '../../staff/navigation'
import { isRouteMissing, isUnavailable, staffProblemText } from '../../staff/staffProblems'
import { isDemoFacility } from '../blueFacilities'
import { useOpenPages, useSampleHref } from '../frame/pageContext'
import { basePath, pageHrefOf } from '../frame/pageHref'
import { invoiceTotals, sampleRecords, sampleTitle, statusWords, type SampleRecord } from '../frame/sample/store'
import type { EhrBluePage } from '../frame/types'

/**
 * The design's Home cards (design/ehr-target src/dashboard.tsx), shared by each person's own Home and each demo
 * role's dashboard. Patient billing, the demo's People figure and Facility review are samples; People reads the
 * facility's staff live at a demo facility where today's sidebar lists Staff.
 */

export const MAX_SHORTCUTS = 6

/** The reporting period, with its note beside it (screens/roles). Fictional counts: Health ID serves none yet. */
export function ReportingPeriod({ period, onChange }: { readonly period: string; readonly onChange: (period: string) => void }) {
  return <div className="hid-ehr-blue-period">
    <EhrField label="Reporting period">
      <EhrSelect value={period} onChange={event => onChange(event.target.value)}>
        <option value="7">Last 7 days</option>
        <option value="30">Last 30 days</option>
      </EhrSelect>
    </EhrField>
    <span className="hid-ehr-blue-period-note">Record creation dates · local time</span>
  </div>
}

/** "NGN 30,000", as the design writes an amount. */
function naira(minor: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(minor / 100)
}

/**
 * Patient billing (screens/roles/*-dashboard.png): what the sample invoices total, what was collected on them and
 * what is still due, from the sample records. Fictional: nothing is read from Health ID.
 */
export function PatientBillingCard({ notice = false }: { readonly notice?: boolean }) {
  const hrefOf = useSampleHref()
  const href = hrefOf('billing')
  const invoices = sampleRecords('billing').filter(record => record.status !== 'void').map(invoiceTotals)
  const sum = (key: 'total' | 'paid' | 'due') => invoices.reduce((total, invoice) => total + invoice[key], 0)
  return <EhrCard title="Patient billing">
    {notice ? <EhrSampleBanner /> : null}
    <div className="hid-ehr-blue-activity">
      <Figure label="Invoiced in period" value={naira(sum('total'))} detail="No comparison yet" />
      <Figure label="Collected in period" value={naira(sum('paid'))} detail="No comparison yet · Before refunds" />
      <Figure label="Outstanding balance" value={naira(sum('due'))} detail="All open invoices" />
    </div>
    {href ? <Link className="hid-ehr-blue-link" to={href}>View patient billing</Link> : null}
  </EhrCard>
}

/** One of Activity in period's figures: what is counted, the count, and the comparison the design gives. */
export function Figure({ label, value, detail }: { readonly label: string; readonly value: ReactNode; readonly detail: string }) {
  return <div className="hid-ehr-blue-activity-figure">
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{detail}</small>
  </div>
}

/** The design's People card: how many work here (no figure without a count), and the way to Staff & access. */
export function PeopleCard({ count, notice = false }: { readonly count?: ReactNode; readonly notice?: boolean }) {
  return <EhrCard title="People">
    {notice ? <EhrSampleBanner /> : null}
    {count === undefined ? null : <strong className="hid-ehr-blue-stat-value">{count}</strong>}
    <p className="hid-ehr-blue-flush">Active staff in this branch</p>
    <StaffLink />
  </EhrCard>
}

/**
 * The way to Staff & access, only where this session may open the page: it refuses at a governed facility, and to
 * anyone without workforce.manage.
 */
function StaffLink() {
  const staff = useOpenPages().find(page => basePath(page.path) === 'staff')
  return staff ? <Link className="hid-ehr-blue-link" to={pageHrefOf(staff)}>Manage staff & access</Link> : null
}

/** Why the staff could not be read, in today's Staff page's words (staff/routes/Staff.tsx). */
function staffFailure(caught: unknown, facility: string): string {
  if (isRouteMissing(caught)) return 'Adding staff isn’t available on Health ID yet. Please check again later.'
  if (isHidApiError(caught) && caught.code === 'STAFF_MANAGEMENT_NOT_AVAILABLE') {
    return `Health ID support manages who works at ${facility}. Contact Health ID support to add or remove staff.`
  }
  const text = staffProblemText(caught, { facility })
  return isUnavailable(caught) ? text : `${facility}’s staff couldn’t be loaded. ${text}`
}

/** The design's demo figure for People, where no staff list is read. */
export const SAMPLE_STAFF_COUNT = 16

/** A facility's staff count, or what refused the read. */
type StaffRead = { readonly facilityId: string } & ({ readonly count: number } | { readonly caught: unknown })

/**
 * People on an administrator's own Home, at a demo facility: the facility's staff, read as today's Staff page reads
 * them, where today's sidebar lists Staff (a facility that signed itself up, on Novu); elsewhere Health ID support
 * manages who works there, and the card shows the design's figure as a sample. At a real clinic the card shows no
 * figure and reads nothing: a staff read is audited, and today's Overview makes none.
 */
export function LivePeopleCard({ facility }: { readonly facility: Facility }) {
  const demo = isDemoFacility(facility.id)
  const live = demo && visibleNavigation(facility).some(item => item.to === '/provider/staff')
  const [read, setRead] = useState<StaffRead | null>(null)
  useEffect(() => {
    if (!live) return
    let active = true
    facilityStaffApi.read(facility.id).then(
      staff => { if (active) setRead({ facilityId: facility.id, count: staff.members.length }) },
      caught => { if (active) setRead({ facilityId: facility.id, caught }) })
    return () => { active = false }
  }, [live, facility.id])
  if (!demo) return <PeopleCard />
  if (!live) return <PeopleCard count={SAMPLE_STAFF_COUNT} notice />
  const answer = read?.facilityId === facility.id ? read : null
  if (!answer) return <EhrCard title="People"><EhrSkeleton label="Loading staff" bars={2} /></EhrCard>
  if ('caught' in answer) return <EhrCard title="People">
    <p className="hid-ehr-blue-flush">{staffFailure(answer.caught, facility.name)}</p>
    <StaffLink />
  </EhrCard>
  return <PeopleCard count={answer.count} />
}

/** The Platform Super Admin's Facility review card: the sample has no facility waiting. */
export function FacilityReviewCard({ notice = false }: { readonly notice?: boolean }) {
  const href = useSampleHref()('platform')
  return <EhrCard title="Facility review">
    {notice ? <EhrSampleBanner /> : null}
    <p className="hid-ehr-blue-flush">0 facilities awaiting review</p>
    {href ? <Link className="hid-ehr-blue-link" to={href}>Review facilities</Link> : null}
  </EhrCard>
}

export interface WorklistRow {
  readonly record: SampleRecord
  readonly title: string
}

/** Needs attention or Today: each sample record by its title, then "Workspace · status", or the design's empty state. */
export function SampleWorklist({ rows, empty }: {
  readonly rows: readonly WorklistRow[]
  readonly empty: { readonly title: string; readonly message: string }
}) {
  const hrefOf = useSampleHref()
  if (rows.length === 0) return <EhrEmptyState title={empty.title} message={empty.message} />
  return <ul className="hid-ehr-blue-list">{rows.map(({ record, title }) => {
    const href = hrefOf(record.moduleId)
    return <li key={`${record.moduleId}-${record.id}`} className="hid-ehr-blue-list-item">
      {href ? <Link className="hid-ehr-blue-worklink" to={`${href}/${record.id}`}><strong>{sampleTitle(record)}</strong></Link>
        : <strong>{sampleTitle(record)}</strong>}
      <span className="hid-ehr-blue-muted">{title} · {statusWords(record.status)}</span>
    </li>
  })}</ul>
}

export const NO_ATTENTION = {
  title: 'No open items in your worklist',
  message: 'New work requiring review will appear here. Use your work area to review completed records.',
}

export const NOTHING_TODAY = {
  title: 'No activity recorded today',
  message: 'Your permitted appointments and daily work will appear here as records are saved.',
}

/** Pinned shortcuts: each a secondary button to its page, or the design's line when none is pinned. */
export function PinnedShortcuts({ pages, after }: { readonly pages: readonly { readonly href: string; readonly label: string }[]; readonly after?: ReactNode }) {
  return <section aria-labelledby="hid-ehr-blue-shortcuts">
    <h2 id="hid-ehr-blue-shortcuts" className="hid-ehr-blue-section-title">Pinned shortcuts</h2>
    {pages.length ? <ul className="hid-ehr-blue-shortcuts">
      {pages.map(page => <li key={page.href}><Link className="hid-ehr-button hid-ehr-button-secondary" to={page.href}>{page.label}</Link></li>)}
    </ul> : <p className="hid-ehr-blue-flush">Pin up to six work areas using Customize shortcuts.</p>}
    {after}
  </section>
}

/** Customize shortcuts (the design's drawer): up to six of the pages this person may open, kept in memory only. */
export function CustomizeShortcuts({ open, onClose, candidates, current, onChange }: {
  readonly open: boolean
  readonly onClose: () => void
  readonly candidates: readonly EhrBluePage[]
  readonly current: readonly string[]
  readonly onChange: (paths: readonly string[]) => void
}) {
  return <EhrDrawer open={open} title="Customize shortcuts" onClose={onClose}>
    <EhrSampleBanner />
    <fieldset className="hid-ehr-blue-steps">
      <legend className="hid-ehr-blue-muted">Choose up to {MAX_SHORTCUTS} shortcuts for Home.</legend>
      {candidates.map(page => {
        const picked = current.includes(page.path)
        return (
          <label key={page.path} className="hid-ehr-blue-check">
            <input type="checkbox" className="hid-ehr-blue-check-input" checked={picked}
              disabled={!picked && current.length >= MAX_SHORTCUTS}
              onChange={event => onChange(event.target.checked ? [...current, page.path] : current.filter(path => path !== page.path))} />
            {page.label}
          </label>
        )
      })}
    </fieldset>
    <EhrButton onClick={onClose}>Done</EhrButton>
  </EhrDrawer>
}
