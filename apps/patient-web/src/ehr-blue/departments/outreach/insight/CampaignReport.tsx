import { useCallback, useState, type ReactNode } from 'react'
import { Download, Printer } from 'lucide-react'
import { ConfirmSheet, PageState } from '../../../../kasuwa/parts'
import { Alert, Button, Card, Textarea } from '../../../../kasuwa/ui'
import { staffApi, type OutreachCampaign } from '../../../../staff/api'
import { useDeptAccess } from '../../parts/access'
import { campaignErrorText, CAMPAIGN_STATUS_FAILED, campaignStatusLabel, REASON_LENGTH } from '../outreachParts'
import { NOT_OFFERED, outreachCampaignApi } from '../campaignApi'
import { focusLabel, type CampaignReport as Report } from '../campaignTypes'
import { dayText, InsightCard, lagosToday, useCampaignRead } from './insightParts'

const REPORT_FAILED = 'The report could not be read. Try again.'

/** A count as the report says it: under the threshold (and above none) as "fewer than N", so no small group stands out. */
export function reportCount(count: number, threshold: number): string {
  return count > 0 && count < threshold ? `fewer than ${threshold}` : String(count)
}

/** The report's counts as rows: section, what, count (as said). The CSV and the screen read the same rows. */
export function reportRows(report: Report): Array<{ section: string; rows: Array<[string, string]> }> {
  const c = (count: number) => reportCount(count, report.smallCountThreshold)
  return [
    { section: 'Totals', rows: [
      ['Target', String(report.target)], ['Registered', String(report.registered)], ['Screened', String(report.screened)],
      ['Test kits used', String(report.kitsUsed)], ['Invalid tests (done again)', c(report.invalidTests)],
    ] },
    { section: 'By focus', rows: report.byFocus.flatMap(row => [
      [`${focusLabel(row.focus)}: screened`, c(row.screened)] as [string, string],
      [`${focusLabel(row.focus)}: positive`, c(row.positive)] as [string, string],
      [`${focusLabel(row.focus)}: referred`, c(row.referred)] as [string, string],
    ]) },
    { section: 'By site', rows: report.sites.flatMap(site => [
      [`${site.name} (${site.lga}): registered`, c(site.registered)] as [string, string],
      [`${site.name} (${site.lga}): screened`, c(site.screened)] as [string, string],
    ]) },
    { section: 'By sex', rows: [['Female', c(report.bySex.female)], ['Male', c(report.bySex.male)], ['Other or not said', c(report.bySex.other)]] },
    { section: 'By age', rows: report.byAgeBand.map(band => [band.band, c(band.count)] as [string, string]) },
    { section: 'Outcomes', rows: [
      ['Normal', c(report.outcomes.normal)], ['Follow up', c(report.outcomes.followUp)], ['Referred, urgent', c(report.outcomes.referUrgent)],
      ['Referred, routine', c(report.outcomes.referRoutine)], ['Not decided yet', c(report.outcomes.pending)],
    ] },
    { section: 'Referrals', rows: [
      ['Made', c(report.referrals.made)], ['Arrived', c(report.referrals.arrived)], ['Did not arrive', c(report.referrals.notArrived)],
      ['Not yet seen', c(report.referrals.waiting)],
    ] },
    { section: 'Follow-ups', rows: [
      ['To call', c(report.followUps.due)], ['Reached', c(report.followUps.reached)], ['Not reached', c(report.followUps.notReached)],
      ['Closed', c(report.followUps.closed)],
    ] },
  ]
}

const csvCell = (value: string) => /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

/** The report's counts as CSV: one line per count. Nothing about any one person is in it. */
export function reportCsv(report: Report): string {
  const lines = [['Section', 'Count of', 'Number'],
    ['Campaign', report.campaignName, ''], ['Organisation', report.organisationName, ''],
    ['Dates', `${report.startsOn}${report.endsOn ? ` to ${report.endsOn}` : ''}`, '']]
  for (const block of reportRows(report)) for (const [what, count] of block.rows) lines.push([block.section, what, count])
  return `${lines.map(line => line.map(csvCell).join(',')).join('\r\n')}\r\n`
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Prints the report alone: everything else on the page is left off the paper. */
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  [data-outreach-report], [data-outreach-report] * { visibility: visible !important; }
  [data-outreach-report] { position: absolute; inset: 0 auto auto 0; width: 100%; padding: 0; color: #000; background: #fff; }
  [data-outreach-report] [data-print-hide] { display: none !important; }
  [data-outreach-report] section { break-inside: avoid; box-shadow: none !important; }
}`

/**
 * A campaign's report for the organisation and its funders: counts only, never a name. Small counts are said as
 * "fewer than N". Download as PDF (the browser's print, the report alone) or as a CSV of the counts. A coordinator closes
 * the campaign from here (`campaign` and `onClosed` given): for good, after confirming.
 */
export function CampaignReport({ campaignId, campaign, canClose = false, onClosed }: {
  readonly campaignId: string
  /** The campaign as listed, for "Close campaign" (its version). */
  readonly campaign?: OutreachCampaign
  /** This viewer may close it (a coordinator, or the campaign's admin). */
  readonly canClose?: boolean
  readonly onClosed?: () => void
}) {
  const { facilityId } = useDeptAccess()
  const { read, refresh } = useCampaignRead(Boolean(facilityId),
    useCallback((signal: AbortSignal) => outreachCampaignApi.report(facilityId!, campaignId, signal), [facilityId, campaignId]), REPORT_FAILED)
  const closable = canClose && campaign && campaign.status !== 'closed'

  if (read.state === 'not_offered') {
    return <div className="flex flex-col gap-4">
      <p className="m-0 text-[14px] text-ink-2">{NOT_OFFERED}</p>
      {closable && facilityId ? <CloseCampaign facilityId={facilityId} campaign={campaign} onClosed={onClosed} /> : null}
    </div>
  }
  const report = read.value
  return (
    <div className="flex flex-col gap-4" data-outreach-report="">
      <style>{PRINT_CSS}</style>
      <PageState loading={read.state === 'loading'} error={read.state === 'error' && !report ? read.error : null} hasData={report !== null}
        onRetry={() => void refresh()} what="the report" rows={4}>
        {report ? <>
          <header className="flex flex-col gap-1">
            <p className="m-0 text-[13px] text-ink-3">{report.organisationName}</p>
            <h2 className="m-0 text-title-2 text-ink">{report.campaignName}</h2>
            <p className="m-0 text-[14px] text-ink-2">
              {dayText(report.startsOn, true)}{report.endsOn ? ` to ${dayText(report.endsOn, true)}` : ''}
              {' · '}{report.sites.length} {report.sites.length === 1 ? 'site' : 'sites'} · Counts only, no names
            </p>
          </header>
          <div data-print-hide="" className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button size="lg" icon={Download} onClick={() => download(`campaign-report-${lagosToday()}.csv`, reportCsv(report))}>Download counts (CSV)</Button>
            <Button size="lg" icon={Printer} variant={closable ? 'secondary' : 'primary'} onClick={() => window.print()}>Download report (PDF)</Button>
          </div>
          <div className="grid gap-4 @3xl:grid-cols-2">
            {reportRows(report).map((block, index) => (
              <InsightCard key={block.section} title={block.section} id={`outreach-report-${campaignId}-${index}`}>
                {block.rows.length ? (
                  <dl className="m-0 flex flex-col divide-y divide-line">
                    {block.rows.map(([what, count]) => (
                      <div key={what} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                        <dt className="min-w-0 text-[14px] break-words text-ink-2">{what}</dt>
                        <dd className="m-0 text-[15px] font-semibold text-ink tabular">{count}</dd>
                      </div>
                    ))}
                  </dl>
                ) : <p className="m-0 text-[14px] text-ink-2">Nothing to count yet.</p>}
              </InsightCard>
            ))}
          </div>
          {report.smallCountThreshold > 1 ? <p className="m-0 text-[13px] text-ink-3">Counts under {report.smallCountThreshold} are shown as “fewer than {report.smallCountThreshold}”, so no one can be picked out.</p> : null}
        </> : null}
      </PageState>
      {closable && facilityId ? <div data-print-hide=""><CloseCampaign facilityId={facilityId} campaign={campaign} onClosed={onClosed} /></div> : null}
    </div>
  )
}

/** "Close campaign": a reason, then a confirmation that it is for good, then today's status route. */
function CloseCampaign({ facilityId, campaign, onClosed }: {
  readonly facilityId: string
  readonly campaign: OutreachCampaign
  readonly onClosed?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const reasonId = `outreach-close-${campaign.id}-reason`

  async function close() {
    if (busy) return
    const trimmed = reason.trim()
    if (trimmed.length < 8) { setProblem(REASON_LENGTH); document.getElementById(reasonId)?.focus(); return }
    setProblem('')
    setBusy(true)
    setError('')
    try {
      await staffApi.setOutreachCampaignStatus(facilityId, campaign, 'closed', trimmed)
      setOpen(false)
      setDone(true)
      onClosed?.()
    } catch (caught) {
      setError(campaignErrorText(caught, CAMPAIGN_STATUS_FAILED))
    } finally {
      setBusy(false)
    }
  }

  if (done) return <Alert intent="success" title="Campaign closed">No one can register people into it any more. Its records and counts stay.</Alert>
  const body: ReactNode = (
    <div className="flex flex-col gap-2">
      <label htmlFor={reasonId} className="text-[14px] font-medium text-ink">Why it is closing</label>
      <Textarea id={reasonId} rows={3} maxLength={500} value={reason} aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${reasonId}-error` : `${reasonId}-hint`} onChange={event => setReason(event.target.value)} />
      {problem ? <p id={`${reasonId}-error`} className="m-0 text-[13px] text-danger-ink">{problem}</p>
        : <p id={`${reasonId}-hint`} className="m-0 text-[13px] text-ink-3">For example: the work is done. At least 8 characters.</p>}
      {error ? <Alert intent="error" title="Not closed">{error}</Alert> : null}
    </div>
  )
  return (
    <Card className="flex flex-col gap-3 p-4 sm:p-5">
      <h2 className="m-0 text-title-3 text-ink">Finish the campaign</h2>
      <p className="m-0 text-[14px] text-ink-2">Closing finishes it for good: no one can register people into it any more. What was recorded stays.</p>
      <Button size="lg" variant="destructive" className="self-start" onClick={() => { setError(''); setOpen(true) }}>Close campaign</Button>
      <ConfirmSheet open={open} onClose={() => setOpen(false)} title="Close this campaign?" destructive busy={busy} confirmLabel="Close campaign"
        subject={<Card className="px-4 py-3"><p className="m-0 text-title-3 text-ink">{campaign.name}</p>
          <p className="m-0 text-caption text-ink-2">{campaignStatusLabel(campaign.status)}</p></Card>}
        effect="It can’t be opened again." onConfirm={() => void close()}>
        {body}
      </ConfirmSheet>
    </Card>
  )
}
