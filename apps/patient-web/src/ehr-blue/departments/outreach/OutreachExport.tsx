import { useId, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { Modal } from '../../../kasuwa/interactive'
import { Alert, Button } from '../../../kasuwa/ui'
import { staffApi, type OutreachCampaign, type OutreachCase } from '../../../staff/api'
import { saveFile } from '../../../download'
import { useDeptAccess } from '../parts/access'
import {
  buildExport, EXPORT_CAPPED, EXPORT_FORMATS, EXPORT_LATEST_100, EXPORT_PAGE_SIZE, exportFileName, exportMeta, readAllCases, readScreenings, rowsFor,
  screeningsFailed, type ExportCase, type ExportContext, type ExportFormat,
} from './outreachExport'

/** The privacy note said before every export. */
export const EXPORT_PRIVACY = 'This file contains people’s personal and health information. Keep it safe and delete it when you’re done.'
export const EXPORT_FAILED = 'The file could not be made. Try again, or choose another file type.'
/** When the registrations could not be read again: the file holds those on screen. */
export function onScreenOnly(count: number) {
  return `Health ID couldn’t be reached, so the file holds only the ${count} ${count === 1 ? 'registration' : 'registrations'} on this screen.`
}

/**
 * "Export": the registrations this person can already see (the list; on a campaign's page, that campaign's only) as a
 * CSV, Excel, Word or PDF file, made on this device. Every page of them is read first (the list shows the newest only),
 * then the health check results of each person who has them, three at a time (those that can't be read are left blank,
 * and the note says how many); without a connection, the file holds what is on screen, and says so. The button opens a
 * short dialog that asks for the file type and says what the file holds; Export saves it, Cancel does nothing. Cancel
 * (or Escape) also works while the file is being made: the reads stop and nothing is saved. Focus goes back to the button either way.
 * With nothing to export, the button says why and opens nothing.
 */
export function OutreachExport({ cases, campaign, campaignOf }: {
  /** The registrations as read; null while they are not read. */
  readonly cases: readonly OutreachCase[] | null
  /** On a campaign's page: only its registrations are exported, and the file is named after it. */
  readonly campaign?: Pick<OutreachCampaign, 'id' | 'name'>
  readonly campaignOf: ExportContext['campaignOf']
}) {
  const { facilityId } = useDeptAccess()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  /** What the last file may be missing, said beside the button once it is saved. */
  const [note, setNote] = useState('')
  const busyRef = useRef(false)
  /** The export being made, stopped by Cancel; null when none is. */
  const running = useRef<AbortController | null>(null)

  const chosen = cases ? (campaign ? cases.filter(item => item.campaignId === campaign.id) : cases) : null
  const count = chosen?.length ?? 0
  const reason = chosen === null ? 'Registrations not loaded yet' : count === 0 ? 'No registrations to export' : ''
  const what = `The file holds every registration ${campaign ? `in ${campaign.name}` : 'from every campaign you can see'}. `
    + 'They are read from Health ID first, which can take a moment.'

  const close = () => {
    // Cancel while the file is being made: its reads stop, and it saves nothing.
    if (running.current) {
      running.current.abort()
      running.current = null
      busyRef.current = false
      setBusy(false)
      setProgress('')
    }
    setOpen(false)
    setError('')
  }

  async function save() {
    if (busyRef.current || !chosen || count === 0) return
    busyRef.current = true
    const controller = new AbortController()
    running.current = controller
    const stopped = () => controller.signal.aborted
    setBusy(true)
    setError('')
    setNote('')
    const done = () => {
      if (running.current !== controller) return
      running.current = null
      busyRef.current = false
      setBusy(false)
      setProgress('')
    }
    const say = (words: string) => { if (!stopped()) setProgress(words) }
    try {
      let rows: readonly ExportCase[] = chosen
      let warning = ''
      let readAll = false
      if (facilityId) {
        say('Getting the registrations from Health ID…')
        try {
          const read = await readAllCases(
            before => staffApi.outreachCasesPage(facilityId, { limit: EXPORT_PAGE_SIZE, before, ...(campaign ? { campaignId: campaign.id } : {}) }),
            sofar => say(`Getting the registrations from Health ID… ${sofar} so far`))
          rows = campaign ? read.cases.filter(item => item.campaignId === campaign.id) : read.cases
          warning = read.capped ? EXPORT_CAPPED : read.latestOnly ? EXPORT_LATEST_100 : ''
          readAll = true
        } catch {
          warning = onScreenOnly(count)
        }
      }
      if (stopped()) return
      if (rows.length === 0) {
        done()
        setError('There are no registrations to export now. Refresh the list to check.')
        return
      }
      // Each person's health check results, read a few at a time; one that can't be read is left blank and the rest go on.
      // Not tried when the registrations themselves couldn't be read (no signal): the file holds those on screen.
      if (facilityId && readAll) {
        const checks = await readScreenings(rows, caseId => staffApi.outreachScreening(facilityId, caseId, controller.signal),
          (doneSoFar, total) => say(`Reading health checks ${doneSoFar} of ${total}…`), controller.signal)
        if (stopped()) return
        rows = rows.map(item => (checks.screenings.has(item.id) ? { ...item, screening: checks.screenings.get(item.id) ?? null } : item))
        if (checks.failed > 0) warning = [warning, screeningsFailed(checks.failed)].filter(Boolean).join(' ')
      }
      say(`Preparing ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}…`)
      const now = new Date()
      const table = rowsFor(rows, { campaignOf })
      const blob = await buildExport(format, table, exportMeta(campaign?.name, rows.length, now))
      if (stopped()) return
      saveFile(blob, exportFileName(campaign?.name, format, now))
      recordExport(facilityId, { format, count: rows.length, ...(campaign ? { campaignId: campaign.id } : {}) })
      done()
      setNote(warning)
      setOpen(false)
    } catch {
      if (stopped()) return
      done()
      setError(EXPORT_FAILED)
    }
  }

  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-2">
        <Button icon={Download} aria-disabled={reason ? true : undefined} aria-describedby={reason ? `${id}-reason` : undefined}
          aria-haspopup="dialog"
          onClick={() => { if (!reason) { setError(''); setOpen(true) } }}>Export</Button>
        {reason ? <span id={`${id}-reason`} className="text-caption text-ink-3">{reason}</span> : null}
        {/* Mounted throughout, so what the saved file may be missing is announced. */}
        <span role="status" className={note && !reason ? 'text-caption font-medium text-warn-ink' : 'sr-only'}>{reason ? '' : note}</span>
      </span>
      <Modal open={open && !reason} onClose={close} title="Export registrations" size="sm"
        footer={<>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" icon={Download} loading={busy} onClick={() => void save()}>{busy ? 'Making the file…' : 'Export'}</Button>
        </>}>
        <div className="flex flex-col gap-4">
          <p className="m-0 text-body text-ink">{what}</p>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 p-0 font-medium text-ink">File type</legend>
            {EXPORT_FORMATS.map(option => (
              <label key={option.value} className="flex cursor-pointer items-start gap-2.5 text-ink">
                <input type="radio" name={`${id}-format`} value={option.value} className="mt-1 size-4 shrink-0" checked={format === option.value}
                  aria-describedby={`${id}-${option.value}-hint`} disabled={busy} onChange={() => setFormat(option.value)} />
                <span className="flex flex-col">
                  <span className="font-medium">{option.label}</span>
                  <span id={`${id}-${option.value}-hint`} className="text-caption text-ink-3">{option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Alert intent="warning" title="Keep this file safe" live={false}>{EXPORT_PRIVACY}</Alert>
          <p role="status" className={progress ? 'm-0 text-body text-ink-2' : 'sr-only'}>{progress}</p>
          {error ? <Alert intent="error">{error}</Alert> : null}
        </div>
      </Modal>
    </>
  )
}

/**
 * Tells Outreach a file was saved, for its audit (POST outreach/registration-cases/exports). Never waited on, and never
 * said on screen: the file is already saved, and an Outreach before the route answers 404 or 405.
 */
function recordExport(facilityId: string | undefined, input: Parameters<typeof staffApi.recordOutreachExport>[1]) {
  if (!facilityId) return
  try {
    void staffApi.recordOutreachExport(facilityId, input).catch(() => undefined)
  } catch {
    // Nothing to say: the download has happened.
  }
}
