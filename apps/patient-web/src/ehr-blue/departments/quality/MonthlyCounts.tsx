import { useCallback, useEffect, useState } from 'react'
import { EhrButton, EhrDataTable, EhrField, EhrSelect } from '@hid/ui/ehr'
import { qualityApi, type QualityCountRow, type QualityCounts } from '../../../staff/api'
import { saveFile } from '../../../download'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { DraftListBanner, QualityTabs, type QualityShared } from './parts'
import {
  DESCRIPTION, EYEBROW, INTERNAL_RECORD, NOT_AVAILABLE, TITLE, cancelled, categoryText, departmentText, harmText, isDraft, learnFrom,
  monthText, notServed, recentMonths, refusalWords, whenText,
} from './qualityRules'

/** The file name the backend gives the CSV (Content-Disposition), or the contract's own. */
function fileNameOf(disposition: string | null, month: string): string {
  const named = /filename="([^"/\\]+\.csv)"/i.exec(disposition ?? '')
  return named ? named[1]! : `quality-incident-counts-${month}.csv`
}

/**
 * The monthly counts (route 12, managers): this facility's incidents whose Lagos day of happening falls in the month,
 * by category, harm level and department, for the quality committee. Exact counts, no id, title, text, name, patient or
 * staff member; on screen, and as the backend's CSV file. "Internal quality-improvement record." on both.
 */
export function MonthlyCounts({ facilityId, me }: QualityShared) {
  const [months] = useState(() => recentMonths())
  const [month, setMonth] = useState(months[0] ?? '')
  const [counts, setCounts] = useState<QualityCounts | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<{ text: string; unavailable: boolean } | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')

  const load = useCallback(async () => {
    if (!month) return
    setLoading(true)
    setError(null)
    try {
      const answer = await qualityApi.counts(facilityId, month)
      learnFrom()
      setCounts(answer)
    } catch (caught) {
      if (cancelled(caught)) return
      learnFrom(caught)
      setCounts(null)
      setError({ text: refusalWords(caught, 'The counts could not be loaded. Try again.'), unavailable: notServed(caught) })
    } finally { setLoading(false) }
  }, [facilityId, month])

  useEffect(() => { void load() }, [load])

  async function download() {
    if (downloading || !month) return
    setDownloading(true)
    setDownloadError('')
    try {
      const file = await qualityApi.countsCsv(facilityId, month)
      learnFrom()
      saveFile(file.blob, fileNameOf(file.headers.get('Content-Disposition'), month))
    } catch (caught) {
      if (cancelled(caught)) return
      learnFrom(caught)
      setDownloadError(refusalWords(caught, 'The file could not be made. Try again.'))
    } finally { setDownloading(false) }
  }

  const shown = counts?.month === month ? counts : null
  const rows = shown?.rows ?? []

  return (
    <DeptPage eyebrow={EYEBROW} title={TITLE} description={DESCRIPTION} className="hid-ehr-dept-qs"
      secondaryActions={<EhrButton variant="secondary" onClick={() => void load()} busy={loading && shown !== null}>Refresh</EhrButton>}>
      <QualityTabs me={me} current="counts" />
      <DeptNotice tone="info" title={INTERNAL_RECORD}>
        Counts only: no names, no patients and nothing anyone wrote. Each incident is counted in the month it happened, Lagos time.
      </DeptNotice>
      <DraftListBanner me={me} />

      <DeptSection title="Monthly counts" headingId="qs-counts-month-title">
        <div className="hid-ehr-qs-toolbar">
          <EhrField label="Month" controlId="qs-counts-month">
            <EhrSelect value={month} onChange={event => setMonth(event.target.value)}>
              {months.map(value => <option key={value} value={value}>{monthText(value)}</option>)}
            </EhrSelect>
          </EhrField>
          <EhrButton variant="secondary" busy={downloading} disabled={!shown} onClick={() => void download()}>Download CSV</EhrButton>
        </div>
        {downloadError ? <DeptNotice role="alert" tone="critical" variant="box">{downloadError}</DeptNotice> : null}
        {error ? <DeptNotice role="alert" tone={error.unavailable ? 'info' : 'critical'}>{error.unavailable ? NOT_AVAILABLE : error.text}</DeptNotice> : null}
        {shown ? (
          <p className="hid-ehr-qs-plain" role="status">
            {`${monthText(shown.month)}: ${shown.total} ${shown.total === 1 ? 'incident' : 'incidents'}. Counted ${whenText(shown.generatedAt)}`}
            {`, list ${shown.listVersion}${isDraft(shown) ? ' (draft)' : ''}.`}
          </p>
        ) : null}
        {error && !shown ? null : (
          <EhrDataTable caption={`Incidents in ${monthText(month)}`} columns={COLUMNS(me)} rows={rows} stack="lg"
            rowKey={row => `${row.category}|${row.harmLevel}|${row.departmentCode ?? ''}`} loading={loading && !shown}
            emptyTitle="No incidents" emptyMessage="No incident that happened in this month has been reported." />
        )}
      </DeptSection>
    </DeptPage>
  )
}

const COLUMNS = (me: QualityShared['me']) => [
  { id: 'category', header: 'Category', cell: (row: QualityCountRow) => categoryText(row.category, me.lists) },
  { id: 'harm', header: 'Harm', cell: (row: QualityCountRow) => harmText(row.harmLevel, me.lists) },
  { id: 'department', header: 'Department', cell: (row: QualityCountRow) => departmentText(row.departmentCode) || 'Not given' },
  { id: 'count', header: 'Count', align: 'end' as const, cell: (row: QualityCountRow) => String(row.count) },
]
