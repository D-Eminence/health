import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ChevronRight, FileText, Printer, RotateCcw, Search } from 'lucide-react'
import { FormPage, PageState, Value } from '../../../kasuwa/parts'
import { Alert, Button, Card, CardHeader, EmptyState, Input, PageHeader } from '../../../kasuwa/ui'
import { staffApi, type LabExecution, type LabResultRevision, type LabWorkItem } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { pointOfCareOpen } from '../commerce/served'
import { useDeptAccess } from '../parts/access'
import { matchesSearch } from '../parts/format'
import { useFacilityRead } from '../parts/useFacilityRead'
import { outsideOf } from '../pharmacy/pocFields'
import { personBanner, subjectOf } from './LabRequest'
import { useLabRecord } from './labRecord'
import { ResultSlip, usePrint, type SlipLine } from './labPrint'
import { flagLevel, LAB_RESULTS_HIDDEN, revisionText, stampText } from './labText'
import { ShareResult } from './ShareResult'
import { ageSex, personOf, releasedAtOf, requestOf, stageOf } from './stage'

const RESULTS_HREF = '/provider/laboratory/results'

function openId(pathname: string): string | null {
  const match = /\/laboratory\/results\/([^/]+)\/?$/.exec(pathname)
  return match ? decodeURIComponent(match[1]!) : null
}

/** The version of a result that was released: what the patient and the doctor see. */
function releasedOf(execution: LabExecution): LabResultRevision | null {
  const result = execution.result
  if (!result || result.currentReleasedVersion == null) return null
  return result.revisions.find(revision => revision.version === result.currentReleasedVersion) ?? null
}

/**
 * Results (laboratory/results): the released results, searched by name, phone, test or number; one opens below the list
 * (laboratory/results/:id) to print for the patient, send to them by SMS or email, or send to the referring doctor.
 */
export function Results() {
  const { facilityId, permissions } = useDeptAccess()
  const canRead = permissions.includes('lab.work-item.read')
  const read = useFacilityRead(facilityId, canRead, useCallback((id: string) => staffApi.labWorkItems(id), []))
  const location = useLocation()
  const navigate = useNavigate()
  const focus = useFocusById()
  const [search, setSearch] = useState('')
  const id = openId(location.pathname)
  const items = (read.value?.items ?? []).filter(item => stageOf(item) === 'done')
  const chosen = id ? read.value?.items.find(item => item.id === id) ?? null : null
  const last = useRef(id)
  useLayoutEffect(() => {
    const was = last.current
    last.current = id
    if (was && !id) focus([`lab-result-${was}`, 'lab-results-title'], true)
  }, [id, focus])
  const stale = Boolean(id && read.value && !chosen)
  useLayoutEffect(() => { if (stale) navigate(RESULTS_HREF, { replace: true }) }, [stale, navigate])

  if (!facilityId || !canRead) return <div className="flex flex-col gap-5"><PageHeader title="Results" />
    <EmptyState icon={FileText} title="You can’t see lab results here" description="Your role needs permission to see lab work." /></div>
  const shown = items.filter(item => {
    const person = personOf(item)
    return matchesSearch(search, [person.name, person.phone, person.healthId, item.testName, item.accessionNumber, requestOf(item)?.number])
  }).sort((a, b) => Date.parse(releasedAtOf(b) ?? b.acceptedAt ?? '') - Date.parse(releasedAtOf(a) ?? a.acceptedAt ?? ''))

  return <div>
    {chosen ? <ResultView key={chosen.id} facilityId={facilityId} item={chosen} permissions={permissions} /> : null}
    <div hidden={Boolean(chosen)} className="flex flex-col gap-5">
      <PageHeader title={<span id="lab-results-title" tabIndex={-1} className="outline-none">Results</span>}
        actions={<Button icon={RotateCcw} loading={read.loading && read.value !== null} onClick={() => void read.refresh()}>Refresh</Button>} />
      <Input icon={Search} type="search" aria-label="Search results" placeholder="Name, phone, test or number" value={search}
        onChange={event => setSearch(event.target.value)} className="@3xl:max-w-md" />
      <PageState loading={read.loading} error={read.error || null} hasData={read.value !== null} onRetry={() => void read.refresh()} what="results" rows={4}
        empty={shown.length === 0 ? { icon: FileText, title: search.trim() ? 'Nothing matches' : 'No results released yet',
          description: search.trim() ? 'Check the spelling.' : 'Results show here once they are checked and released.' } : null}>
        <ul aria-label="Released results" className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3 p-0">
          {shown.map(item => {
            const person = personOf(item)
            const released = releasedAtOf(item)
            return <li key={item.id} className="min-w-0">
              <Link id={`lab-result-${item.id}`} to={`${RESULTS_HREF}/${encodeURIComponent(item.id)}`}
                className="flex min-h-11 items-center gap-3 rounded-xl bg-surface p-4 text-ink no-underline shadow-[var(--shadow-card)] ring-1 ring-line hover:bg-subtle">
                <span className="min-w-0 flex-1">
                  <span className="block text-title-3 text-ink break-words">{person.name}</span>
                  <span className="block text-caption text-ink-2">{[ageSex(person), person.phone].filter(Boolean).join(' · ')}</span>
                  <span className="mt-1 block text-[15px] font-medium text-ink break-words">{item.testName ?? 'Lab test'}</span>
                  {released ? <span className="block text-caption text-ink-3">Released {stampText(released)}</span> : null}
                </span>
                <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
              </Link>
            </li>
          })}
        </ul>
      </PageState>
    </div>
  </div>
}

/** One released result: its values, and the ways to give it to the patient or send it to the doctor. */
function ResultView({ facilityId, item, permissions }: { readonly facilityId: string; readonly item: LabWorkItem; readonly permissions: readonly string[] }) {
  const { facility } = useDeptAccess()
  const person = personOf(item)
  const subject = subjectOf(item)
  const outside = outsideOf(item)
  const record = useLabRecord(facilityId, item.accessionId, permissions.includes('lab.accession.read'), permissions.includes('lab.execution.read'))
  const released = record.executions.flatMap(execution => { const revision = releasedOf(execution); return revision ? [{ execution, revision }] : [] })
  const { print, area } = usePrint()
  // Sharing a result is a point-of-care route Health ID does not serve yet: offered only where it may answer (commerce/served.ts).
  const canShare = pointOfCareOpen(facilityId) && permissions.includes('lab.result.share') && Boolean(item.accessionId)
  const test = item.testName ?? 'Lab test'
  const lines: SlipLine[] = released.map(({ execution, revision }) => ({
    key: execution.id, test: execution.test.name, value: revisionText(revision), unit: revision.unit, range: revision.referenceRange, flag: revision.abnormalFlag,
  }))
  const slip = <ResultSlip facility={facility?.name ?? 'Laboratory'} name={person.name} ageSex={ageSex(person)} hid={person.hidText}
    requestNumber={record.accession?.accessionNumber ?? item.accessionNumber ?? requestOf(item)?.number ?? ''}
    released={stampText(released[0]?.revision.releasedAt ?? releasedAtOf(item))} lines={lines} />

  return <FormPage wide back={{ to: RESULTS_HREF, label: 'Back to results' }}
    title={<span id="lab-record-title" tabIndex={-1} className="outline-none">{test}</span>}>
    {personBanner(person)}
    <Card>
      <CardHeader as="h2" title="Result" actions={released.length > 0 ? <Button icon={Printer} onClick={() => print('slip', slip)}>Print</Button> : undefined} />
      <div className="flex flex-col gap-4 p-5">
        {record.error ? <Alert intent="error" title="Couldn’t load the result" action={<Button size="sm" icon={RotateCcw} onClick={record.reload}>Try again</Button>}>{record.error}</Alert> : null}
        {record.hidden ? <Alert intent="warning" action={<Button size="sm" icon={RotateCcw} onClick={record.reload}>Refresh</Button>}>{LAB_RESULTS_HIDDEN[record.hidden]}</Alert> : null}
        {record.loading && released.length === 0 ? <p role="status" className="m-0 text-[14px] text-ink-3">Loading…</p> : null}
        {!record.loading && !record.error && !record.hidden && released.length === 0 ? <p className="m-0 text-[15px] text-ink-2">No released result to show.</p> : null}
        {released.length > 0 ? <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
          {released.map(({ execution, revision }) => <li key={execution.id} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
            <span className="text-[15px] font-medium text-ink">{execution.test.name}</span>
            <span className="text-[19px]"><Value value={revisionText(revision)} unit={revision.unit} flag={flagLevel(revision.abnormalFlag)} /></span>
            <span className="text-caption text-ink-3">{[revision.referenceRange ? `Normal range ${revision.referenceRange}` : null,
              revision.releasedAt ? `Released ${stampText(revision.releasedAt)}` : null].filter(Boolean).join(' · ')}</span>
          </li>)}
        </ul> : null}
      </div>
    </Card>
    {canShare && released.length > 0 ? <Card>
      <CardHeader as="h2" title="Give the result" description="A link to this result only. The patient also sees it on their Health ID, if they have one." />
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-[15px] font-semibold text-ink">To {person.name}</h3>
          <ShareResult facilityId={facilityId} accessionId={item.accessionId!} testName={test} to="patient" phone={person.phone} subject={subject.banner} />
        </div>
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <h3 className="m-0 text-[15px] font-semibold text-ink">To the doctor{outside?.prescriberName ? `: ${outside.prescriberName}` : ''}</h3>
          <ShareResult facilityId={facilityId} accessionId={item.accessionId!} testName={test} to="doctor" email={outside?.prescriberEmail}
            doctor={outside?.prescriberName} subject={subject.banner} />
        </div>
      </div>
    </Card> : null}
    {area}
  </FormPage>
}
