import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Clock, Eye, FileText, Lock, Mail, NotebookPen, Stethoscope, UserRound } from 'lucide-react'
import { isHidApiError } from '@hid/http'
import { Alert, Button, Card, CardHeader, cx, type Icon } from '../kasuwa/ui'
import { CodeBoxes, codeComplete } from '../CodeBoxes'
import { Turnstile } from '../Turnstile'
import { useDocumentTitle } from '../authSteps'
import { cardSharesEnabled } from '../cardSharesFlag'
import { browserCardReceiverApi, type CardReceiverApi } from '../cardReceiverApi'
import {
  cardShareScopeLabel, isCardToken, receiverProblem, viewEndingOf,
  type CardRecords, type CardView, type ViewEnding,
} from '../cardShares'
import { ImportedHistory } from '../ImportedHistory'
import { IMPORTED_HEALTH_FIELDS } from '../importedRecords'
import { HEALTH_FIELDS } from '../profileParity'
import { visitClassLabel, visitStatusLabel } from '../plainLabels'
import { Face, SharedCardPage, useMyCard } from './SharedCard'
import { useSession } from '../session'
import { usePatientResource } from './usePatientResource'
import { useProfileSources } from './profileSources'
import { Link } from 'react-router-dom'
import logoSrc from '../../../public-web/public/brand/logo.png'

/**
 * The page a card link opens (step 8, hid-system 0118; BACKEND-NEEDS.md §2): /card#<token>. Off (the build's switch, or
 * the backend answering availability 404) it is today's dormant page, and nothing more is sent.
 *
 * On, the owner's answers of 4 Nov 2026 and the critique's fixes:
 * - the token is read from after # and taken out of the address bar (and history) at once, before the security check
 *   loads; it is held in memory only and sent only in POST bodies (fix 3, fix 5);
 * - nothing about it is sent until the person presses "Email me a code" (fix 7: a mail scanner that loads the page gets
 *   nothing);
 * - the Turnstile check is on the start step only, and gone once used (fix 5);
 * - a reload needs the link and a new code: there is no resume of an earlier view (owner answer 12);
 * - every read after the code names its view (X-Card-View), and 409 CARD_SHARE_VIEW_CHANGED clears the screen (fix 1);
 * - while shown, the view is checked every 30 seconds, and the screen clears as soon as the link has ended (fix 4);
 * - after 5 minutes without a touch, key or scroll, the card is covered (and taken off the page) until asked for (fix 3);
 * - leaving the page clears it, so the back-forward cache cannot show it again (fix 3);
 * - nothing is kept in browser storage, and no answer signs anyone in or out (its own client: cardReceiverApi.ts).
 */
const IDLE_MS = 5 * 60_000
const CHECK_MS = 30_000

type Phase =
  | { at: 'checking' } | { at: 'dormant' } | { at: 'unreachable' } | { at: 'no-link' } | { at: 'bad-link' }
  | { at: 'start' } | { at: 'code'; sentTo: string; resendAfterSeconds: number }
  | { at: 'card'; view: CardView } | { at: 'over'; why: ViewEnding | 'closed' } | { at: 'stop' }

/** The link's token, read once from after # and taken out of the address bar (and so out of history and any Referer). */
function useLinkToken(): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined)
  useLayoutEffect(() => {
    const hash = window.location.hash.replace(/^#/, '')
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    // Under StrictMode the effect runs twice; the second finds the address already clean and keeps what the first read.
    setToken(previous => previous !== undefined ? previous : hash || null)
  }, [])
  return token
}

/** Moves focus to the step's heading each time the step changes. */
function useHeadingFocus(key: string) {
  const heading = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => { heading.current?.focus() }, [key])
  return heading
}

function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className="min-h-svh bg-canvas">
    <header className="border-b border-line bg-surface">
      <div className={cx('mx-auto flex h-14 items-center px-4', wide ? 'max-w-5xl' : 'max-w-xl')}><img src={logoSrc} alt="Health ID" className="h-6 w-auto" /></div>
    </header>
    <main className={cx('mx-auto px-4 py-6', wide ? 'max-w-5xl' : 'max-w-xl')}>{children}</main>
  </div>
}

function Panel({ heading, headingRef, children }: { heading: string; headingRef: React.Ref<HTMLHeadingElement>; children?: ReactNode }) {
  return <Card as="div" className="flex flex-col gap-4 p-5">
    <h1 ref={headingRef} tabIndex={-1} className="m-0 text-title-2 text-ink outline-none">{heading}</h1>
    {children}
  </Card>
}

const PRIVACY = <a href="/card/privacy" className="text-[13px] font-semibold text-brand-ink">How we use your email address</a>

export function CardReceiverPage({ api }: { api?: CardReceiverApi }) {
  if (!cardSharesEnabled()) return <SharedCardPage />
  return <Receiver api={api} />
}

function Receiver({ api: given }: { api?: CardReceiverApi }) {
  useDocumentTitle('Shared Health ID card · Health ID')
  const api = useMemo(() => given ?? browserCardReceiverApi(), [given])
  const token = useLinkToken()
  const [phase, setPhase] = useState<Phase>({ at: 'checking' })
  const [attempt, setAttempt] = useState(0)
  const heading = useHeadingFocus(phase.at)

  useEffect(() => {
    if (token === undefined) return
    const controller = new AbortController()
    setPhase({ at: 'checking' })
    api.availability(controller.signal).then(() => {
      setPhase(token === null ? { at: 'no-link' } : isCardToken(token) ? { at: 'start' } : { at: 'bad-link' })
    }, (error: unknown) => {
      if (controller.signal.aborted) return
      setPhase(isHidApiError(error) && error.status === 404 ? { at: 'dormant' } : { at: 'unreachable' })
    })
    return () => controller.abort()
  }, [api, token, attempt])

  const end = useCallback((why: ViewEnding | 'closed') => setPhase({ at: 'over', why }), [])

  switch (phase.at) {
    case 'checking': return <Shell><p role="status" className="m-0 text-sm text-ink-3">Opening…</p></Shell>
    case 'dormant': return <SharedCardPage />
    case 'unreachable': return <Shell><Panel heading="We couldn’t reach Health ID" headingRef={heading}>
      <p className="m-0 text-sm text-ink-2">Check your connection and try again.</p>
      <Button variant="primary" onClick={() => setAttempt(value => value + 1)}>Try again</Button></Panel></Shell>
    case 'no-link': return <Shell><Panel heading="Open the link in your email again" headingRef={heading}>
      <p className="m-0 text-sm text-ink-2">Each time you open the card, we email you a new code.</p>{PRIVACY}</Panel></Shell>
    case 'bad-link': return <Shell><Panel heading="This link isn’t complete" headingRef={heading}>
      <p className="m-0 text-sm text-ink-2">Open it again from your email.</p></Panel></Shell>
    case 'start': return <Shell><StartStep api={api} token={token!} headingRef={heading}
      onSent={(sentTo, resendAfterSeconds) => setPhase({ at: 'code', sentTo, resendAfterSeconds })} onStop={() => setPhase({ at: 'stop' })} /></Shell>
    case 'code': return <Shell><CodeStep api={api} token={token!} sentTo={phase.sentTo} resendAfterSeconds={phase.resendAfterSeconds} headingRef={heading}
      onOpened={view => setPhase({ at: 'card', view })} onEnded={() => end('link-ended')} onNewCode={() => setPhase({ at: 'start' })} /></Shell>
    case 'card': return <OpenCard api={api} view={phase.view} onEnd={end} />
    case 'over': return <Shell><Ended why={phase.why} headingRef={heading} /></Shell>
    case 'stop': return <Shell><StopForm api={api} token={token!} headingRef={heading} /></Shell>
  }
}

function Ended({ why, headingRef }: { why: ViewEnding | 'closed'; headingRef: React.Ref<HTMLHeadingElement> }) {
  const [title, body] = why === 'link-ended' ? ['This card is no longer shared', 'The person who shared it ended the link, or it has expired.']
    : why === 'closed' ? ['You closed the card', 'To open it again, use the link in your email. We’ll send a new code.']
    : why === 'view-changed' ? ['Another card was opened in this browser', 'To see this card again, open its link in your email again. We’ll send a new code.']
    : ['Your view has ended', 'Open the link in your email again to get a new code.']
  return <Panel heading={title} headingRef={headingRef}><p className="m-0 text-sm text-ink-2">{body}</p></Panel>
}

const SMALL_PRINT = <>
  <p className="m-0 text-[13px] text-ink-3">Read only. The person who shared it is told each time it’s opened. If this reached you by mistake, close this page.</p>
  <p className="m-0 text-[13px] text-ink-3">On a shared computer, press End view when you’re done.</p>
</>

function StartStep({ api, token, headingRef, onSent, onStop }: { api: CardReceiverApi; token: string; headingRef: React.Ref<HTMLHeadingElement>
  onSent: (sentTo: string, resendAfterSeconds: number) => void; onStop: () => void }) {
  const [check, setCheck] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [ended, setEnded] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  const send = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !check) return
    setBusy(true); setProblem(null)
    controller.current = new AbortController()
    try {
      const sent = await api.requestCode(token, check, controller.current.signal)
      onSent(sent.sentTo, sent.resendAfterSeconds)
    } catch (error) {
      if (controller.current?.signal.aborted) return
      setProblem(receiverProblem(error, 'code'))
      if (isHidApiError(error) && error.code === 'CARD_SHARE_ENDED') setEnded(true)
      // A token is used once: a new check for the next press.
      setCheck(null); setResetKey(value => value + 1)
      setBusy(false)
    }
  }

  return <Panel heading="Open a shared Health ID card" headingRef={headingRef}>
    <p className="m-0 text-sm text-ink-2">Someone shared their Health ID card with you. To open it, we’ll email a 6-digit code to the address this link was sent to.</p>
    {problem && <Alert intent="error" size="sm">{problem}</Alert>}
    {!ended && <form onSubmit={event => void send(event)} className="flex flex-col gap-3">
      <Turnstile action="card-share-code" onTokenChange={setCheck} resetKey={resetKey} />
      <Button type="submit" variant="primary" icon={Mail} loading={busy} disabled={busy || !check}>{busy ? 'Sending…' : 'Email me a code'}</Button>
    </form>}
    {SMALL_PRINT}
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">{PRIVACY}
      <button type="button" onClick={onStop} className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-brand-ink underline">Stop these emails</button></div>
  </Panel>
}

function CodeStep({ api, token, sentTo, resendAfterSeconds, headingRef, onOpened, onEnded, onNewCode }: {
  api: CardReceiverApi; token: string; sentTo: string; resendAfterSeconds: number; headingRef: React.Ref<HTMLHeadingElement>
  onOpened: (view: CardView) => void; onEnded: () => void; onNewCode: () => void
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [canResend, setCanResend] = useState(resendAfterSeconds <= 0)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    if (resendAfterSeconds <= 0) return
    const timer = setTimeout(() => setCanResend(true), resendAfterSeconds * 1000)
    return () => clearTimeout(timer)
  }, [resendAfterSeconds])

  const verify = async (event?: FormEvent) => {
    event?.preventDefault()
    if (busy) return
    if (!codeComplete(code)) { setProblem('Enter the 6-digit code from the email.'); return }
    setBusy(true); setProblem(null)
    controller.current = new AbortController()
    try {
      onOpened(await api.verify(token, code, controller.current.signal))
    } catch (error) {
      if (controller.current?.signal.aborted) return
      if (isHidApiError(error) && error.code === 'CARD_SHARE_ENDED') { onEnded(); return }
      setProblem(receiverProblem(error, 'verify'))
      setCode('')
      setBusy(false)
    }
  }

  return <Panel heading="Enter the code we emailed" headingRef={headingRef}>
    <p className="m-0 text-sm text-ink-2">We sent a 6-digit code to {sentTo}. It works for 10 minutes.</p>
    <form noValidate onSubmit={event => void verify(event)} className="flex flex-col gap-3">
      <CodeBoxes id="card-code" label="Code" value={code} busy={busy} onChange={setCode}
        invalid={problem ? true : undefined} describedBy={problem ? 'card-code-problem' : undefined} />
      <p id="card-code-problem" role="alert" className="m-0 text-[13px] text-danger-ink empty:hidden">{problem}</p>
      <Button type="submit" variant="primary" icon={Eye} loading={busy} disabled={busy}>{busy ? 'Opening…' : 'Open the card'}</Button>
    </form>
    <p className="m-0 text-[13px] text-ink-3">The code comes only to the inbox this link was sent to. Don’t give it to anyone who asks for it.</p>
    {canResend ? <Button variant="ghost" onClick={onNewCode}>Send a new code</Button>
      : <p className="m-0 text-[13px] text-ink-3">No email? You can ask for a new code in a minute. Check your spam folder too.</p>}
  </Panel>
}

/**
 * The card, once the code was right: read only, its records if the link allows them. Everything is kept in this
 * component's state alone, so an ending (any of them) unmounts it and nothing of the card is left on the page.
 */
function OpenCard({ api, view: opened, onEnd }: { api: CardReceiverApi; view: CardView; onEnd: (why: ViewEnding | 'closed') => void }) {
  const [view, setView] = useState(opened)
  const [records, setRecords] = useState<CardRecords | null>(null)
  const [recordsFailed, setRecordsFailed] = useState(false)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [covered, setCovered] = useState(false)
  const [closing, setClosing] = useState(false)
  const viewId = opened.viewId
  const photoRef = useRef<string | null>(null)
  const aborts = useRef(new AbortController())
  const finished = useRef(false)
  const coverHeading = useRef<HTMLHeadingElement>(null)
  const cardHeading = useRef<HTMLHeadingElement>(null)

  const finish = useCallback((why: ViewEnding | 'closed') => {
    if (finished.current) return
    finished.current = true
    aborts.current.abort()
    if (photoRef.current) { URL.revokeObjectURL(photoRef.current); photoRef.current = null }
    onEnd(why)
  }, [onEnd])

  // Whatever ends the page ends the reads and frees the photo.
  useEffect(() => () => {
    aborts.current.abort()
    if (photoRef.current) { URL.revokeObjectURL(photoRef.current); photoRef.current = null }
  }, [])

  const failed = useCallback((error: unknown) => {
    const ending = viewEndingOf(error)
    if (ending) finish(ending)
    return ending !== null
  }, [finish])

  useEffect(() => {
    const signal = aborts.current.signal
    api.records(viewId, signal).then(read => { if (!signal.aborted) setRecords(read) },
      (error: unknown) => { if (!signal.aborted && !failed(error)) setRecordsFailed(true) })
    if (opened.card.hasPhoto) {
      api.photo(viewId, signal).then(blob => {
        if (signal.aborted) return
        const url = URL.createObjectURL(blob)
        photoRef.current = url
        setPhotoUrl(url)
      }, (error: unknown) => { if (!signal.aborted) failed(error) })
    }
  }, [api, viewId, opened.card.hasPhoto, failed])

  // Checked every 30 seconds while on screen, covered or not: an ending clears the page.
  useEffect(() => {
    const timer = setInterval(() => {
      const signal = aborts.current.signal
      api.view(viewId, signal).then(next => { if (!signal.aborted) setView(next) }, (error: unknown) => { if (!signal.aborted) failed(error) })
    }, CHECK_MS)
    return () => clearInterval(timer)
  }, [api, viewId, failed])

  // Covered after 5 minutes with no touch, key, pointer or scroll.
  useEffect(() => {
    if (covered) return
    let timer = setTimeout(() => setCovered(true), IDLE_MS)
    const active = () => { clearTimeout(timer); timer = setTimeout(() => setCovered(true), IDLE_MS) }
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'] as const
    for (const name of events) window.addEventListener(name, active, { passive: true })
    return () => { clearTimeout(timer); for (const name of events) window.removeEventListener(name, active) }
  }, [covered])
  useLayoutEffect(() => { (covered ? coverHeading : cardHeading).current?.focus() }, [covered])

  // Leaving the page clears it: the back-forward cache then has nothing of the card to show.
  useEffect(() => {
    const leave = () => finish('view-ended')
    window.addEventListener('pagehide', leave)
    return () => window.removeEventListener('pagehide', leave)
  }, [finish])

  const close = async () => {
    if (closing) return
    setClosing(true)
    try { await api.endView(viewId) } catch { /* the view ends by itself within 30 minutes; the page is cleared either way */ }
    finish('closed')
  }

  if (covered) return <Shell><Panel heading="Still there?" headingRef={coverHeading}>
    <p className="m-0 text-sm text-ink-2">We covered the card because nothing happened for 5 minutes.</p>
    <Button variant="primary" onClick={() => setCovered(false)}>Show the card again</Button>
    <Button onClick={() => void close()} loading={closing} disabled={closing}>End view</Button>
  </Panel></Shell>

  return <CardShareView view={view} records={records} recordsFailed={recordsFailed} photoUrl={photoUrl} headingRef={cardHeading}
    footer={<Button variant="primary" onClick={() => void close()} loading={closing} disabled={closing}>End view</Button>} />
}

const HEALTH_LABELS: Readonly<Record<(typeof HEALTH_FIELDS)[number], string>> = {
  bloodGroup: 'Blood group', genotype: 'Genotype', allergies: 'Allergies', currentMedications: 'Medicines they take now',
  chronicConditions: 'Long-term conditions', medicalNotes: 'Other notes',
}
const IMPORTED_LABELS: Readonly<Record<(typeof IMPORTED_HEALTH_FIELDS)[number], string>> = {
  blood_group: 'Blood group', genotype: 'Genotype', allergies: 'Allergies', current_medications: 'Current medications',
  chronic_conditions: 'Long-term conditions', medical_notes: 'Medical notes',
}
const ENTRY_KINDS: Readonly<Record<string, string>> = {
  visit: 'Visit', test: 'Test result', medicine: 'Medicine', diagnosis: 'Diagnosis', vaccination: 'Vaccination', other: 'Other',
}
const day = (iso: string | null | undefined) => {
  if (!iso) return ''
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? '' : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' }).format(parsed)
}

function Section({ title, icon, children }: { title: string; icon: Icon; children: ReactNode }) {
  return <Card><CardHeader as="h2" title={title} icon={icon} iconTone="brand" />{children}</Card>
}
const None = ({ children }: { children: ReactNode }) => <p className="m-0 px-5 pb-4 text-[13px] text-ink-3">{children}</p>

/**
 * What the person sees with a right code, also the patient's own preview of it (SharedCard.tsx): the card face, who
 * shared it and until when, then (for a card-and-records link) each section, with a plain line where one is empty. The
 * footer names the address it was sent to, so a printout or screenshot says whose view it was.
 */
export function CardShareView({ view, records, recordsFailed = false, photoUrl, headingRef, banner, footer }: {
  view: CardView; records: CardRecords | null; recordsFailed?: boolean; photoUrl: string | null
  headingRef?: React.Ref<HTMLHeadingElement>; banner?: ReactNode; footer?: ReactNode
}) {
  const first = view.sharedBy
  const health = records?.healthProfile ?? null
  const withRecords = view.scope === 'card_and_records'
  const facts: Array<[string, string, Icon]> = [
    ['Shared by', first, UserRound], ['Access', 'Read only', Lock], ['Shows', cardShareScopeLabel(view.scope), Eye],
    ['Until', day(view.expiresAt), Clock], ['Each open', `${first} is told`, Mail],
  ]
  return <div className="min-h-svh bg-canvas">
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
        <img src={logoSrc} alt="Health ID" className="h-6 w-auto" />
        <span className="truncate text-[12px] text-ink-3">Read only</span>
      </div>
    </header>
    {banner}
    <main className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 lg:grid-cols-[380px_minmax(0,1fr)] lg:items-start">
      <div className="mx-auto flex w-full max-w-[480px] min-w-0 flex-col gap-4 lg:max-w-none">
        <h1 ref={headingRef} tabIndex={-1} className="m-0 text-title-2 text-ink outline-none">{view.card.fullName}’s Health ID card</h1>
        <Face card={{ name: view.card.fullName, hid: view.card.healthId, verified: view.card.ninVerified, bloodGroup: health?.bloodGroup ?? null,
          genotype: health?.genotype ?? null, allergies: health?.allergies ?? null, photoUrl }} />
        <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line ring-1 ring-line">
          {facts.map(([label, value, I]) => <div key={label} className="bg-surface px-4 py-3">
            <dt className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase"><I className="size-3.5" aria-hidden />{label}</dt>
            <dd className="m-0 mt-1 text-sm font-medium [overflow-wrap:anywhere] text-ink">{value}</dd></div>)}
        </dl>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {withRecords && (recordsFailed ? <Alert intent="error" size="sm">We couldn’t load the records. Close the card and open the link again.</Alert>
          : !records ? <p role="status" className="m-0 text-sm text-ink-3">Loading records…</p>
          : <CardRecordSections records={records} />)}
        <p className="m-0 flex gap-1.5 text-[12px] text-ink-3"><Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>Read only. Opened from an email sent to {view.recipientHint}. {first} can see each time this page is opened.</span></p>
        {footer && <div className="flex flex-col gap-2 sm:flex-row sm:items-center">{footer}
          <span className="text-[12px] text-ink-3">On a shared computer, press End view when you’re done.</span></div>}
      </div>
    </main>
  </div>
}

function CardRecordSections({ records }: { records: CardRecords }) {
  const health = records.healthProfile
  const imported = records.importedHealthProfile
  return <>
    <Section title="Visits" icon={Stethoscope}>{records.encounters.length === 0 ? <None>No visits yet.</None>
      : <ul className="m-0 list-none divide-y divide-line p-0">{records.encounters.map(visit => <li key={visit.id} className="px-5 py-3">
        <p className="m-0 text-sm font-medium text-ink">{visitClassLabel(visit.encounterType)}</p>
        <p className="m-0 text-[13px] text-ink-3">{[visitStatusLabel(visit.status), day(visit.startedAt)].filter(Boolean).join(' · ')}</p></li>)}</ul>}</Section>
    <Section title="Clinical notes" icon={NotebookPen}>{records.notes.length === 0 ? <None>No signed notes yet.</None>
      : <ul className="m-0 list-none divide-y divide-line p-0">{records.notes.map(note => <li key={note.id} className="px-5 py-3">
        <p className="m-0 text-sm font-medium text-ink">{note.title || 'Note'}</p>
        <p className="m-0 text-[13px] text-ink-3">{day(note.signedAt)}</p>
        <p className="m-0 mt-1 text-[13px] whitespace-pre-wrap [overflow-wrap:anywhere] text-ink-2">{note.content}</p></li>)}</ul>}</Section>
    {records.importedRecords.length > 0 && <Card className="p-5"><ImportedHistory records={records.importedRecords} limit={records.limit} /></Card>}
    <Section title="Health information they entered" icon={UserRound}>{!health ? <None>They haven’t entered any.</None>
      : <dl className="m-0 divide-y divide-line px-5 pb-2">{HEALTH_FIELDS.map(field => <div key={field} className="py-2.5">
        <dt className="text-[13px] text-ink-3">{HEALTH_LABELS[field]}</dt>
        <dd className="m-0 text-sm whitespace-pre-wrap [overflow-wrap:anywhere] text-ink">{health[field] ?? 'Not stated'}</dd></div>)}</dl>}</Section>
    {imported && <Section title="From their old Health ID account" icon={FileText}>
      <dl className="m-0 divide-y divide-line px-5 pb-2">{IMPORTED_HEALTH_FIELDS.filter(field => imported.content[field]).map(field => <div key={field} className="py-2.5">
        <dt className="text-[13px] text-ink-3">{IMPORTED_LABELS[field]}</dt>
        <dd className="m-0 text-sm whitespace-pre-wrap [overflow-wrap:anywhere] text-ink">{imported.content[field]}</dd></div>)}</dl></Section>}
    <Section title="Records they added" icon={FileText}>
      <p className="m-0 px-5 pb-2 text-[13px] text-ink-3">Added by the patient. Not checked by a health worker.</p>
      {records.patientEntries.length === 0 ? <None>They haven’t added any.</None>
        : <ul className="m-0 list-none divide-y divide-line p-0">{records.patientEntries.map(entry => <li key={entry.id} className="px-5 py-3">
          <p className="m-0 text-sm font-medium [overflow-wrap:anywhere] text-ink">{entry.title}</p>
          <p className="m-0 text-[13px] text-ink-3">{[ENTRY_KINDS[entry.kind] ?? 'Other', entry.facilityName, day(entry.occurredOn)].filter(Boolean).join(' · ')}</p>
          {entry.notes && <p className="m-0 mt-1 text-[13px] whitespace-pre-wrap [overflow-wrap:anywhere] text-ink-2">{entry.notes}</p>}
          {entry.documents.length > 0 && <ul className="m-0 mt-1 list-none p-0">{entry.documents.map(document => <li key={document.id}
            className="text-[13px] [overflow-wrap:anywhere] text-ink-3">{document.fileName}</li>)}</ul>}
        </li>)}</ul>}
      {records.patientEntriesMore && <None>Only the newest 50 are shown.</None>}
    </Section>
  </>
}

// -------------------------------------------------------------------- stop --

/**
 * "Stop these emails" (critique fix 20, owner answer 7): from the card page, or from the link in either email
 * (/card/stop#<token>). The person chooses to end only this link, or to stop all card emails to their address (the
 * block list). Asks for the security check, then sends the token in the body; the answer is the same for any link.
 */
function StopForm({ api, token, headingRef }: { api: CardReceiverApi; token: string; headingRef: React.Ref<HTMLHeadingElement> }) {
  const [scope, setScope] = useState<'link' | 'address'>('link')
  const [check, setCheck] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<'link' | 'address' | null>(null)
  const doneHeading = useHeadingFocus(done ?? 'form')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  const stop = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !check) return
    setBusy(true); setProblem(null)
    controller.current = new AbortController()
    try {
      setDone((await api.stopEmails(token, scope, check, controller.current.signal)).stopped)
    } catch (error) {
      if (controller.current?.signal.aborted) return
      setProblem(receiverProblem(error, 'stop'))
      setCheck(null); setResetKey(value => value + 1)
    } finally { setBusy(false) }
  }

  if (done === 'address') return <Panel heading="We’ve stopped these emails" headingRef={doneHeading}>
    <p className="m-0 text-sm text-ink-2">We won’t send Health ID card links or codes to this address again, and any card link sent to it has ended.
      To undo this, email support@healthidentitydirectory.com.</p></Panel>
  if (done === 'link') return <Panel heading="We’ve ended this card link" headingRef={doneHeading}>
    <p className="m-0 text-sm text-ink-2">No one can open the card with this link now. The person who shared it is told it was stopped from this address.</p></Panel>

  return <Panel heading="Stop these emails" headingRef={headingRef}>
    <p className="m-0 text-sm text-ink-2">If you didn’t expect a Health ID card, or don’t want these emails, you can stop them here.</p>
    <form onSubmit={event => void stop(event)} className="flex flex-col gap-3">
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 p-0 text-[13px] font-medium text-ink-2">What to stop</legend>
        {([['link', 'End only this card link', 'The person who shared it can still send you a new one.'],
          ['address', 'Stop all Health ID card emails to this address', 'No one can send a Health ID card to this address until you ask support.']] as const).map(([value, label, hint]) =>
          <label key={value} className={cx('flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1', scope === value ? 'bg-brand-soft ring-brand' : 'ring-line')}>
            <input type="radio" name="card-stop" value={value} checked={scope === value} onChange={() => setScope(value)} className="mt-1" />
            <span><span className="block text-sm font-semibold text-ink">{label}</span><span className="block text-[13px] text-ink-3">{hint}</span></span>
          </label>)}
      </fieldset>
      {problem && <Alert intent="error" size="sm">{problem}</Alert>}
      <Turnstile action="card-share-stop" onTokenChange={setCheck} resetKey={resetKey} />
      <Button type="submit" variant="primary" loading={busy} disabled={busy || !check}>{busy ? 'Stopping…' : 'Stop the emails'}</Button>
    </form>
    {PRIVACY}
  </Panel>
}

/** /card/stop#<token>: the "Stop these emails" link in the card emails. Dormant while switched off. */
export function CardStopPage({ api }: { api?: CardReceiverApi }) {
  if (!cardSharesEnabled()) return <SharedCardPage />
  return <StopPage api={api} />
}

function StopPage({ api: given }: { api?: CardReceiverApi }) {
  useDocumentTitle('Stop these emails · Health ID')
  const api = useMemo(() => given ?? browserCardReceiverApi(), [given])
  const token = useLinkToken()
  const [phase, setPhase] = useState<'checking' | 'dormant' | 'unreachable' | 'bad-link' | 'form'>('checking')
  const heading = useHeadingFocus(phase)
  useEffect(() => {
    if (token === undefined) return
    const controller = new AbortController()
    api.availability(controller.signal).then(() => setPhase(token && isCardToken(token) ? 'form' : 'bad-link'), (error: unknown) => {
      if (!controller.signal.aborted) setPhase(isHidApiError(error) && error.status === 404 ? 'dormant' : 'unreachable')
    })
    return () => controller.abort()
  }, [api, token])
  if (phase === 'dormant') return <SharedCardPage />
  return <Shell>{phase === 'checking' ? <p role="status" className="m-0 text-sm text-ink-3">Opening…</p>
    : phase === 'unreachable' ? <Panel heading="We couldn’t reach Health ID" headingRef={heading}><p className="m-0 text-sm text-ink-2">Check your connection, then open the link in your email again.</p></Panel>
    : phase === 'bad-link' ? <Panel heading="This link isn’t complete" headingRef={heading}><p className="m-0 text-sm text-ink-2">Open it again from your email.</p></Panel>
    : <StopForm api={api} token={token!} headingRef={heading} />}</Shell>
}

// ----------------------------------------------------------------- privacy --

/**
 * /card/privacy: the short notice for the person a card is sent to (critique fix 20, owner answer 13), linked from the
 * emails and the card page. The retention periods and processors are the owner's answers of 4 Nov 2026.
 */
export function CardPrivacyPage() {
  useDocumentTitle('How we use your email address · Health ID')
  if (!cardSharesEnabled()) return <SharedCardPage />
  const part = (title: string, body: ReactNode) => <section className="flex flex-col gap-1.5"><h2 className="m-0 text-title-3 text-ink">{title}</h2>
    <div className="flex flex-col gap-2 text-sm text-ink-2 [&_p]:m-0">{body}</div></section>
  return <Shell><Card as="div" className="flex flex-col gap-5 p-5">
    <h1 className="m-0 text-title-2 text-ink">How we use your email address</h1>
    <p className="m-0 text-sm text-ink-2">This is for people who were sent a Health ID card by email. You don’t need a Health ID account.</p>
    {part('Why we have it', <p>Someone with a Health ID typed your address to share their card with you. We use it to send you the link, to send the codes that open it, and to stop the link being misused.</p>)}
    {part('What we keep, and for how long', <>
      <p>Your full address is kept encrypted while the link is open, and erased when the link ends.</p>
      <p>We keep a masked version (like a•••@gmail.com) and a scrambled form of the address for 12 months after the link ends, so the person who shared it can see where they sent it, and so we can stop misuse. Then we delete them.</p>
      <p>Network details from when the card is opened are deleted after 30 days.</p>
      <p>If the person who shared it deletes their Health ID account, what links them to your address is deleted too.</p></>)}
    {part('Who else handles it', <>
      <p>Amazon SES and Brevo send our emails. Link tracking is turned off in these emails.</p>
      <p>Cloudflare Turnstile checks that a real browser asks for a code.</p>
      <p>Sentry receives error reports from this page, without your address, the link or the code.</p></>)}
    {part('Your choices', <>
      <p>Use Stop these emails, from the link in any of these emails or on the card page, to end a link or stop all card emails to your address.</p>
      <p>To ask what we hold about you, to have it deleted, or to object, email support@healthidentitydirectory.com.</p></>)}
  </Card></Shell>
}

// ----------------------------------------------------------------- preview --

/**
 * /card/preview while card links are on: the patient sees what someone they send their card to sees, with their own card,
 * records and health information, as a card-and-records link shows them. Nothing is sent to anyone.
 */
export function CardLinkPreview() {
  const { api } = useSession()
  const card = useMyCard()
  const records = usePatientResource(api.records)
  const { health } = useProfileSources()
  const [now] = useState(() => Date.now())
  const own = records.data && !records.error ? records.data : null
  const saved = health.data && !health.error ? health.data : null
  const cardRecords = useMemo<CardRecords | null>(() => own ? {
    encounters: (own.encounters ?? []).filter(visit => visit.status === 'completed'),
    notes: (own.notes ?? []).filter(note => note.status === 'signed' || note.status === 'amended'),
    importedRecords: own.importedRecords ?? [], importedHealthProfile: own.importedHealthProfile ?? null,
    healthProfile: saved ? Object.fromEntries(HEALTH_FIELDS.map(field => [field, saved[field] ?? null])) as unknown as CardRecords['healthProfile'] : null,
    patientEntries: (own.patientEntries ?? []).slice(0, 50), patientEntriesMore: (own.patientEntries ?? []).length > 50, limit: own.limit,
  } : null, [own, saved])
  if (!card) return <div className="p-6 text-sm text-ink-3" role="status">Loading your card…</div>
  const view: CardView = {
    viewId: 'preview', scope: 'card_and_records', reference: '', recipientHint: 'the person you send it to',
    card: { fullName: card.name, healthId: card.hid, ninVerified: card.verified, hasPhoto: card.photoUrl !== null },
    sharedBy: card.name.split(' ')[0] ?? card.name,
    expiresAt: new Date(now + 24 * 3600_000).toISOString(), viewExpiresAt: new Date(now + 30 * 60_000).toISOString(),
  }
  return <CardShareView view={view} records={cardRecords} photoUrl={card.photoUrl}
    banner={<div className="border-b border-brand-line bg-brand-soft"><div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px] text-brand-ink">
      <span><strong className="font-semibold">Preview.</strong> This is what someone you send your card to sees.</span>
      <Link to="/access/share/card" className="font-semibold text-brand-ink no-underline hover:underline">Back to Send my card</Link></div></div>} />
}
