/**
 * The patient's own record chat on a Novu build (hid-system `staging-novu-ci-20261005`, "Patient chat safety PR 1",
 * #167). The answer is shown as the service gives it: it already ends with the service's "Talk to your doctor" lines,
 * and its sources are only the ones it cites, each with its number, title, date and where it came from, opened in a
 * panel with every item and notice. A service before #167 (no origin labels) shows as before. Nothing is kept in the
 * browser: the conversation is read from the service and dropped on sign-out or account change.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import type {
  NovuPatientChatHistory, NovuPatientChatReply, NovuPatientChatSourceView, NovuPatientChatTypedSource,
} from '@hid/contracts'
import './chat.css'
import { RecordAnswer } from '../RecordAnswer'
import { originText } from '../ChatSource'
import { ChatSourceDrawer, chatSourceDate } from '../ChatSourceDrawer'
import { novuAskFailure } from '../chatErrors'

export interface PatientRecordChatApi {
  chat(question: string, signal?: AbortSignal): Promise<NovuPatientChatReply>
  chatHistory(signal?: AbortSignal): Promise<NovuPatientChatHistory>
  clearChatHistory(signal?: AbortSignal): Promise<{ cleared: true }>
  chatSource(kind: string, id: string, signal?: AbortSignal): Promise<NovuPatientChatSourceView>
}

const MAX_QUESTION = 500
const suggestions = [
  { title: 'Summarise my history', detail: 'History and recent events', question: 'Summarise my medical history and important recent recorded events.' },
  { title: 'Find my prescriptions', detail: 'Previous and latest medicines', question: 'What medicines have I previously been prescribed, and which are the latest recorded?' },
  { title: 'Compare my lab results', detail: 'Changes across previous visits', question: 'Compare my laboratory results across visits and show the records supporting the changes.' },
]
interface Exchange { id: number; question: string; reply?: NovuPatientChatReply; error?: string; askAgain?: boolean }
type FocusRequest = { to: 'composer' } | { to: 'opener'; key: string }

function NoteIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></svg>
}

/**
 * The service's own notes on what it could not read (patient-evidence.service.ts: "Laboratory service unavailable; ...",
 * "Document extraction unavailable; ..."), in plain words. A note not known here is left out: its text is the service's.
 */
const UNAVAILABLE_WORDS: ReadonlyArray<readonly [string, string]> = [
  ['Laboratory', 'Your lab results could not be checked just now.'],
  ['Document extraction', 'Some scanned documents could not be read.'],
]
export function coverageWords(unavailable: readonly string[]): string[] {
  const words = unavailable.map(note => UNAVAILABLE_WORDS.find(([start]) => note.startsWith(start))?.[1])
    .filter((line): line is string => line !== undefined)
  return [...new Set(words)]
}

function Coverage({ coverage }: { coverage: NonNullable<NovuPatientChatReply['coverage']> }) {
  if (coverage.complete) return null
  const unavailable = coverageWords(coverage.unavailable)
  return <p className="record-chat-preparing">
    Some of your records could not be read for this answer, so it may not be complete.
    {coverage.pendingDocuments > 0 && <> {coverage.pendingDocuments === 1 ? '1 document is' : `${coverage.pendingDocuments} documents are`} still being read or could not be read.</>}
    {unavailable.length > 0 && <> {unavailable.join(' ')}</>}
  </p>
}

function Sources({ exchangeId, reply, open, openers }: {
  exchangeId: number
  reply: NovuPatientChatReply
  open: (key: string, source: NovuPatientChatTypedSource) => void
  openers: RefObject<Map<string, HTMLButtonElement>>
}) {
  if (!reply.sources.length) return null
  const headingId = `record-chat-sources-${exchangeId}`
  return <section className="record-chat-sources" aria-labelledby={headingId}>
    <h3 id={headingId}>{reply.sources.length === 1 ? 'Source used in this answer' : `${reply.sources.length} sources used in this answer`}</h3>
    <ul>{reply.sources.map(source => {
      if (!('kind' in source)) {
        // A note-only source of an answer saved before typed sources: shown as before, with nothing to open.
        return <li key={source.number}><span className="record-chat-source-number">[{source.number}]</span><div>
          <strong>{source.title}</strong><span>{chatSourceDate(source.signedAt) ?? 'Date not recorded'}</span></div></li>
      }
      const key = `${exchangeId}:${source.number}`
      // The service's own words; a service before #167 sends only the origin, said as the screens said it before.
      const origin = source.originLabel ?? originText(source.origin)
      return <li key={source.number}><span className="record-chat-source-number">[{source.number}]</span><div>
        <strong>{source.title}</strong>
        <span>{chatSourceDate(source.effectiveAt ?? source.recordedAt) ?? 'Date not recorded'}</span>
        {origin && <span className="record-chat-source-origin">{origin}</span>}
        <button type="button" className="record-chat-source-open" aria-haspopup="dialog"
          aria-label={`View source ${source.number}: ${source.title}`}
          ref={element => { if (element) openers.current.set(key, element); else openers.current.delete(key) }}
          onClick={() => open(key, source)}>View source</button>
      </div></li>
    })}</ul>
  </section>
}

export function PatientRecordChat({ api }: { api: PatientRecordChatApi }) {
  const [draft, setDraft] = useState('')
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [busy, setBusy] = useState(false)
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [historyAttempt, setHistoryAttempt] = useState(0)
  const [historyError, setHistoryError] = useState('')
  const [resetting, setResetting] = useState(false)
  const [viewing, setViewing] = useState<{ key: string; source: NovuPatientChatTypedSource } | null>(null)
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
  const flight = useRef<AbortController | null>(null)
  const nextId = useRef(0)
  const input = useRef<HTMLTextAreaElement>(null)
  const history = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)
  const openers = useRef(new Map<string, HTMLButtonElement>())

  useEffect(() => () => { flight.current?.abort() }, [])
  useEffect(() => {
    const controller = new AbortController()
    setHistoryStatus('loading'); setHistoryError('')
    api.chatHistory(controller.signal).then(saved => {
      if (controller.signal.aborted) return
      setExchanges(saved.exchanges.map((exchange, index) => ({ id: index, question: exchange.question, reply: exchange.reply })))
      nextId.current = saved.exchanges.length
      setHistoryStatus('ready')
    }, () => {
      if (controller.signal.aborted) return
      setHistoryStatus('error'); setHistoryError('Your saved conversation could not be loaded. Please try again.')
    })
    return () => controller.abort()
  }, [api, historyAttempt])
  useEffect(() => {
    if (history.current && followLatest.current) history.current.scrollTop = history.current.scrollHeight
  }, [exchanges, busy])
  useEffect(() => {
    if (input.current) {
      input.current.style.height = 'auto'
      input.current.style.height = Math.max(48, Math.min(input.current.scrollHeight, 144)) + 'px'
    }
  }, [draft])
  // Focus moves only here, after the commit that shows its target.
  useLayoutEffect(() => {
    if (!focusRequest) return
    if (focusRequest.to === 'composer') input.current?.focus()
    else openers.current.get(focusRequest.key)?.focus()
  }, [focusRequest])

  // Closing returns focus to the "View source" button that opened it.
  const closeSource = () => {
    if (viewing) setFocusRequest({ to: 'opener', key: viewing.key })
    setViewing(null)
  }
  const loadSource = useCallback((kind: string, id: string, signal?: AbortSignal) => api.chatSource(kind, id, signal), [api])

  const reset = async () => {
    flight.current?.abort()
    const controller = new AbortController(); flight.current = controller
    setViewing(null); setResetting(true); setBusy(true); setHistoryError('')
    setExchanges(current => current.map(exchange => exchange.reply || exchange.error ? exchange : { ...exchange, error: 'Answer cancelled. You can ask again.' }))
    try {
      const result = await api.clearChatHistory(controller.signal)
      if (controller.signal.aborted) return
      if (result.cleared !== true) throw new Error('History deletion was not confirmed')
      setExchanges([]); setDraft(''); setHistoryStatus('ready'); followLatest.current = true
      setFocusRequest({ to: 'composer' })
    } catch {
      if (!controller.signal.aborted) setHistoryError('Your saved conversation could not be deleted. Please try again.')
    } finally {
      if (flight.current === controller) { flight.current = null; setBusy(false); setResetting(false) }
    }
  }
  /** Sends what is in the box, or `again`: a question asked before, sent once more. */
  const send = async (again?: string) => {
    const question = (again ?? draft).trim()
    if (historyStatus !== 'ready' || flight.current || !question || question.length > MAX_QUESTION) return
    const controller = new AbortController(); flight.current = controller
    const id = nextId.current++
    followLatest.current = true
    setExchanges(current => [...current, { id, question }].slice(-10))
    setDraft(current => again === undefined || current.trim() === question ? '' : current)
    setBusy(true)
    try {
      const reply = await api.chat(question, controller.signal)
      if (controller.signal.aborted) return
      setExchanges(current => current.map(exchange => exchange.id === id ? { ...exchange, reply } : exchange))
    } catch (reason) {
      if (controller.signal.aborted) return
      const failure = novuAskFailure(reason)
      setExchanges(current => current.map(exchange => exchange.id === id
        ? { ...exchange, error: failure.message, askAgain: failure.askAgain } : exchange))
      // The typed question is never lost: it goes back in the box unless something new has been typed there.
      setDraft(current => current.trim() ? current : question)
    } finally {
      if (flight.current === controller) { flight.current = null; setBusy(false) }
    }
  }
  const submit = (event: FormEvent) => { event.preventDefault(); void send() }
  const canSend = historyStatus === 'ready' && !busy && Boolean(draft.trim()) && draft.trim().length <= MAX_QUESTION

  return <section className="patient-section record-chat-page" aria-labelledby="record-chat-title">
    <header className="record-chat-page-header">
      <div><p className="patient-eyebrow">Your record assistant</p><h1 id="record-chat-title" className="patient-page-title">Ask about your records</h1><p className="patient-page-copy">A little clarity, from your clinical notes.</p></div>
      <button type="button" className="record-chat-reset" disabled={resetting || historyStatus === 'loading'} onClick={() => { void reset() }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>New conversation</button>
    </header>
    <div className="record-chat-panel">
      <header className="record-chat-panel-header"><span className="record-chat-avatar"><NoteIcon /></span><div><h2>Health ID record assistant</h2><p>Uses the records you can see in Health ID</p></div><span className="record-chat-private">Private to your account</span></header>
      <details className="record-chat-coverage"><summary>Which records can I ask about?</summary><p>Ask about your medical history, medicines, conditions, visits and released lab results. Each answer lists the records it used and where each came from, and you can open them. Your doctor guides diagnosis and treatment.</p></details>
      <div className="record-chat-coverage"><p>Your latest 10 questions and answers are kept for 30 days. New conversation deletes them.</p>
        {historyStatus === 'loading' && <p role="status">Loading your saved conversation…</p>}
        {historyError && <p role="alert">{historyError}</p>}
        {historyStatus === 'error' && <button type="button" className="record-chat-reset" onClick={() => setHistoryAttempt(current => current + 1)}>Try loading it again</button>}
        {resetting && <p role="status">Deleting your saved conversation…</p>}
      </div>
      <div ref={history} className="record-chat-history" onScroll={() => {
        const element = history.current
        if (element) followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
      }}>
        {exchanges.length === 0 && <div className="record-chat-welcome"><span className="record-chat-welcome-icon"><NoteIcon /></span><h2>Understand your health records</h2><p>Ask about your history, medicines or results. Each answer shows the records it used, so you can check them.</p>
          <div className="record-chat-suggestions" aria-label="Suggested questions">{suggestions.map(suggestion => <button key={suggestion.title} type="button" onClick={() => { setDraft(suggestion.question); setFocusRequest({ to: 'composer' }) }}><span>{suggestion.title}</span><small>{suggestion.detail}</small><span className="record-chat-suggestion-arrow" aria-hidden="true">↗</span></button>)}</div>
        </div>}
        <div role="log" aria-label="Record chat" aria-live="polite" aria-relevant="additions text" aria-busy={busy} className="record-chat-messages">
          {exchanges.map(exchange => <article key={exchange.id} className="record-chat-exchange">
            <div className="record-chat-user"><span className="record-chat-message-label">You</span><p>{exchange.question}</p></div>
            <div className="record-chat-assistant"><span className="record-chat-avatar"><NoteIcon /></span><div className="record-chat-reply"><span className="record-chat-message-label">Health ID record assistant</span>
              {exchange.reply
                ? exchange.reply.status === 'preparing'
                  ? <div className="record-chat-preparing-block">
                    <p className="record-chat-preparing">We are still getting your records ready, so this question cannot be answered yet. Please ask again in a minute or two.</p>
                    <button type="button" className="record-chat-again" disabled={busy || historyStatus !== 'ready'} onClick={() => { void send(exchange.question) }}>Ask again</button>
                  </div>
                  : <>
                    <RecordAnswer text={exchange.reply.answer} />
                    {exchange.reply.coverage && <Coverage coverage={exchange.reply.coverage} />}
                    <Sources exchangeId={exchange.id} reply={exchange.reply} openers={openers} open={(key, source) => setViewing({ key, source })} />
                  </>
                : exchange.error
                  ? <div className="record-chat-preparing-block">
                    <p role="alert" className="record-chat-error">{exchange.error}</p>
                    {exchange.askAgain && <button type="button" className="record-chat-again" disabled={busy || historyStatus !== 'ready'} onClick={() => { void send(exchange.question) }}>Ask again</button>}
                  </div>
                  : <p role="status" className="record-chat-thinking"><span className="record-chat-thinking-dots" aria-hidden="true"><i /><i /><i /></span>Reading your records…</p>}
            </div></div>
          </article>)}
        </div>
      </div>
      <form className="record-chat-composer" onSubmit={submit}><label htmlFor="record-question">Your question</label>
        <div className="record-chat-input-row"><textarea ref={input} id="record-question" rows={1} value={draft} maxLength={MAX_QUESTION} aria-describedby="record-question-hint" autoComplete="off" placeholder="Ask about your history, medicines or results…"
          onChange={event => setDraft(event.target.value)} onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing && !busy) { event.preventDefault(); void send() }
          }} />
          <button type="submit" disabled={!canSend} aria-label="Send question"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m5 12 7-7 7 7M12 5v15" /></svg><span>Send</span></button>
        </div>
        <div className="record-chat-composer-hints"><span id="record-question-hint">Enter to send · Shift + Enter for a new line</span><span>{draft.length}/{MAX_QUESTION}</span></div>
        <p className="record-chat-care-note">Check the sources under each answer. Your doctor makes decisions about your care.</p>
      </form>
    </div>
    {viewing && <ChatSourceDrawer key={viewing.key} source={viewing.source} load={loadSource} onClose={closeSource} />}
  </section>
}
