import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { ArrowLeft, Camera, ScanLine, Search, UserPlus } from 'lucide-react'
import { Modal, Segmented } from '../../../../kasuwa/interactive'
import { FormActions } from '../../../../kasuwa/parts'
import { useToast } from '../../../../kasuwa/toast'
import { Alert, Button, Input } from '../../../../kasuwa/ui'
import { useFocusById } from '../../../../staff/focus'
import { campaignFlowErrorText, outreachCampaignApi } from '../campaignApi'
import { normaliseVisitCode, stationLabel, VISIT_CODE_FORMAT, VISIT_CODE_HINT, type OutreachPlan, type StationKind } from '../campaignTypes'
import { waitsForNetwork } from '../offlineQueue'
import { caseVisit, DayScope, moveDrafts, personOf, useCampaignDay, type DayVisit } from './dayContext'
import { PlanState } from './DayStart'
import { ageWords, DayField, dayControl, PersonBanner, sexWords, Panel } from './dayParts'
import { RegisterFlow } from './RegisterPerson'
import { OutcomeForm, questionsStation, TestsForm, VitalsForm, type Saved } from './stationForms'

/*
 * A station's work (owner, 13 November 2026): find the person by the visit code on their slip (typed, or scanned where
 * the phone can), or among the people seen here today; then their banner and this station's form only. Saved: "Next
 * person", and the code box is ready again.
 */

const CODE_ID = 'outreach-station-code'

export function StationWork({ campaignId, station }: { readonly campaignId: string; readonly station: StationKind }) {
  return <DayScope campaignId={campaignId}><StationBody station={station} /></DayScope>
}

function StationBody({ station }: { readonly station: StationKind }) {
  const day = useCampaignDay()
  if (station === 'register') return <RegisterFlow />
  return (
    <section aria-labelledby="outreach-station-heading" className="flex flex-col gap-4">
      <h2 id="outreach-station-heading" className="m-0 text-title-2 text-ink">{stationLabel(station)}</h2>
      <PlanState plan={day.plan} onRetry={day.refreshPlan}>{plan => <StationSteps plan={plan} station={station} />}</PlanState>
    </section>
  )
}

function StationSteps({ plan, station }: { readonly plan: OutreachPlan; readonly station: Exclude<StationKind, 'register'> }) {
  const day = useCampaignDay()
  const focus = useFocusById()
  const toast = useToast()
  const [current, setCurrent] = useState<DayVisit | null>(null)
  const [saved, setSaved] = useState<Saved | null>(null)

  // A registration kept on this phone that has since been sent: carry on with the visit Outreach made.
  const upgraded = current?.kind === 'queued' ? day.synced.get(current.temporaryPatientId) : undefined
  useEffect(() => {
    if (!upgraded || current?.kind !== 'queued') return
    const next = caseVisit(upgraded)
    moveDrafts(day.drafts, current.key, next.key)
    setCurrent(next)
  }, [upgraded, current, day.drafts])

  // The first field of this station's form takes focus as the person opens: the first reading at vital signs.
  const firstReading = plan.package.vitals.find(vital => !vital.derived)
  const firstField = station === 'vitals' && firstReading ? `outreach-vital-${firstReading.id}` : null
  function open(visit: DayVisit) {
    day.remember(station, visit)
    setSaved(null)
    setCurrent(visit)
    focus(firstField ? [firstField, 'outreach-station-person'] : 'outreach-station-person')
  }
  function next() {
    setCurrent(null)
    setSaved(null)
    focus(CODE_ID)
  }
  function onSaved(result: Saved) {
    if (result.visit && current) setCurrent(caseVisit(result.visit))
    setSaved(result)
    // Said at the top; the next thing to do is the next person.
    if (result.state === 'queued') toast.warning({ title: 'Saved on this phone', message: 'It is sent when you’re back online.' })
    else toast.success('Saved')
    if (station !== 'counselling' && station !== 'results') focus('outreach-station-next')
  }

  if (!current) return <FindPerson station={station} onFound={open} />
  const asksQuestions = questionsStation(plan) === station
  return (
    <div className="flex flex-col gap-4">
      <div id="outreach-station-person" tabIndex={-1} className="outline-none"><PersonBanner visit={current} sticky /></div>
      {saved && station !== 'counselling' && station !== 'results' ? null : (
        <Panel className="p-4 sm:p-5">
          {station === 'vitals' ? <VitalsForm plan={plan} visit={current} withQuestions={asksQuestions} onSaved={onSaved} />
            : station === 'tests' ? (
              <div className="flex flex-col gap-6">
                {asksQuestions ? <VitalsForm plan={plan} visit={current} withQuestions withReadings={false} saveId="outreach-questions-save" onSaved={() => undefined} /> : null}
                <TestsForm plan={plan} visit={current} onSaved={onSaved} />
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {asksQuestions ? <VitalsForm plan={plan} visit={current} withQuestions withReadings={false} saveId="outreach-questions-save" onSaved={() => undefined} /> : null}
                {station === 'counselling' ? <TestsForm plan={plan} visit={current} saveId="outreach-counselling-tests-save" onSaved={() => undefined} /> : null}
                <OutcomeForm plan={plan} visit={current} onSaved={onSaved} />
              </div>
            )}
        </Panel>
      )}
      {saved && station !== 'counselling' && station !== 'results' ? (
        <FormActions>
          <Button id="outreach-station-next" variant="primary" size="lg" className="h-14" icon={UserPlus} onClick={next}>Next person</Button>
        </FormActions>
      ) : null}
      {!saved || station === 'counselling' || station === 'results' ? (
        <FormActions sticky={false} align="start">
          <Button icon={saved ? UserPlus : ArrowLeft} variant={saved ? 'primary' : 'secondary'} size={saved ? 'lg' : 'md'} className={saved ? 'h-14' : undefined} onClick={next}>{saved ? 'Next person' : 'Someone else'}</Button>
        </FormActions>
      ) : null}
    </div>
  )
}

/** The code box (big, capitals, found as soon as the code is whole), a camera scan where the phone has one, and the people seen here today. */
function FindPerson({ station, onFound }: { readonly station: StationKind; readonly onFound: (visit: DayVisit) => void }) {
  const day = useCampaignDay()
  const focus = useFocusById()
  const [typed, setTyped] = useState('')
  const [keys, setKeys] = useState<'text' | 'numeric'>('text')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const looked = useRef<string | null>(null)
  const scanner = typeof window !== 'undefined' && 'BarcodeDetector' in window
  const recent = day.recent.filter(item => item.station === station || item.station === 'register' || item.station === 'all')
    .filter((item, index, list) => list.findIndex(other => other.visit.key === item.visit.key) === index).slice(0, 8)

  useLayoutEffect(() => { focus(CODE_ID) }, [focus])

  async function find(code: string) {
    if (busy) return
    looked.current = code
    setProblem('')
    if (!day.online) { setProblem('No connection: finding by code needs one. People registered on this phone are listed below.'); return }
    setBusy(true)
    try {
      const visit = await outreachCampaignApi.visitByCode(day.facilityId, day.campaignId, code)
      setTyped('')
      onFound(caseVisit(visit))
    } catch (caught) {
      setProblem(waitsForNetwork(caught) ? 'No connection: try again in a moment.'
        : isHidApiError(caught) && caught.code === 'OUTREACH_VISIT_NOT_FOUND' ? `No one has the code ${code} here. Check the slip.`
          : campaignFlowErrorText(caught, 'They could not be found. Try again.'))
      focus(CODE_ID)
    } finally {
      setBusy(false)
    }
  }

  function change(value: string) {
    const upper = value.toUpperCase().replace(/[^0-9A-Z-\s]/g, '').slice(0, 7)
    setTyped(upper)
    setProblem('')
    const code = normaliseVisitCode(upper)
    if (code && looked.current !== code) void find(code)
    if (!code) looked.current = null
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const code = normaliseVisitCode(typed)
    if (!code) { setProblem(VISIT_CODE_FORMAT); focus(CODE_ID); return }
    void find(code)
  }

  return (
    <Panel className="flex flex-col gap-4 p-4 sm:p-5">
      <form noValidate aria-label="Find the person" className="flex flex-col gap-3" onSubmit={submit}>
        <DayField id={CODE_ID} label="Visit code" error={problem || undefined} hint={VISIT_CODE_HINT}>
          <Input {...dayControl(CODE_ID, problem || undefined, true)} value={typed} onChange={event => change(event.target.value)}
            className="!h-16 !text-[30px] font-mono tracking-[.15em] uppercase tabular" autoComplete="off" autoCapitalize="characters" spellCheck={false}
            inputMode={keys} enterKeyHint="search" maxLength={7} aria-busy={busy || undefined} />
        </DayField>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented ariaLabel="Keyboard" size="sm" value={keys} onChange={next => { setKeys(next); focus(CODE_ID) }}
            options={[{ value: 'text', label: 'ABC' }, { value: 'numeric', label: '123' }]} />
          <div className="ml-auto flex flex-wrap gap-2">
            {scanner ? <Button size="lg" icon={Camera} onClick={() => setScanning(true)}>Scan slip</Button> : null}
            <Button type="submit" variant="primary" size="lg" className="h-14" icon={Search} aria-disabled={busy || undefined}>{busy ? 'Finding…' : 'Find'}</Button>
          </div>
        </div>
      </form>
      {recent.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-[15px] font-semibold text-ink">Seen on this phone today</h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Seen on this phone today">
            {recent.map(({ visit }) => {
              const person = personOf(visit)
              return (
                <li key={visit.key}>
                  <button type="button" onClick={() => onFound(visit)}
                    className="flex min-h-14 w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-0.5 rounded-xl border-0 bg-surface px-4 py-2 text-left ring-1 ring-line hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]">
                    <span className="min-w-0 flex-1 text-[16px] font-medium text-ink">{person.fullName}</span>
                    <span className="text-[14px] text-ink-2">{ageWords(person.ageYears)} · {sexWords(person.sex)}</span>
                    <span className="font-mono text-[15px] font-semibold text-ink">{person.visitCode ?? 'Saved on this phone'}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
      {scanning ? <ScanSlip onCode={code => { setScanning(false); setTyped(code); void find(code) }} onClose={() => setScanning(false)} /> : null}
    </Panel>
  )
}

interface DetectedBarcode { readonly rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
type BarcodeDetectorClass = new (options?: { formats?: string[] }) => BarcodeDetectorLike

/** The camera, reading a code from the slip (where the browser can: BarcodeDetector). Nothing is kept. */
function ScanSlip({ onCode, onClose }: { readonly onCode: (code: string) => void; readonly onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [problem, setProblem] = useState('')
  const found = useRef(onCode)
  found.current = onCode
  useEffect(() => {
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setInterval> | null = null
    let live = true
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector
    if (!Detector || !navigator.mediaDevices?.getUserMedia) { setProblem('This phone can’t scan. Type the code instead.'); return }
    const detector = new Detector()
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(media => {
      if (!live) { media.getTracks().forEach(track => track.stop()); return }
      stream = media
      if (video.current) { video.current.srcObject = media; void video.current.play().catch(() => undefined) }
      timer = setInterval(() => {
        if (!video.current || video.current.readyState < 2) return
        detector.detect(video.current).then(codes => {
          const code = codes.map(item => normaliseVisitCode(item.rawValue)).find((value): value is string => value !== null)
          if (code && live) found.current(code)
        }, () => undefined)
      }, 300)
    }, () => { if (live) setProblem('The camera could not be opened. Type the code instead.') })
    return () => {
      live = false
      if (timer) clearInterval(timer)
      stream?.getTracks().forEach(track => track.stop())
    }
  }, [])
  return (
    <Modal open onClose={onClose} title="Scan their slip" description="Hold the code on the slip inside the box." size="sm"
      footer={<Button onClick={onClose}>Type it instead</Button>}>
      {problem ? <Alert intent="warning">{problem}</Alert> : (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video ref={video} className="block aspect-[4/3] w-full object-cover" muted playsInline aria-label="Camera" />
          <ScanLine className="pointer-events-none absolute inset-0 m-auto size-24 text-white/80" aria-hidden />
        </div>
      )}
    </Modal>
  )
}
