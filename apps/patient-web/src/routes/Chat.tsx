import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { PatientChatAvailability, PatientChatCoverage, PatientChatHistory, PatientChatReply, PatientChatStoredReply } from '@hid/contracts'
import { useSession } from '../session'
import './chat.css'
import { ChatAnswer } from '../ChatAnswer'
import { askFailure, clearFailure } from '../chatErrors'
import { CHAT_NOTICE_ACCEPT, CHAT_NOTICE_PARAGRAPHS, CHAT_NOTICE_TITLE } from '../chatNotice'

const suggestions = [
  { title: 'Summarise my history', detail: 'History and recent events', question: 'Summarise my medical history and important recent recorded events.' },
  { title: 'Find my prescriptions', detail: 'Previous and latest medicines', question: 'What medicines have I previously been prescribed, and which are the latest recorded?' },
  { title: 'Compare my lab results', detail: 'Changes across previous visits', question: 'Compare my laboratory results across visits and show the records supporting the changes.' },
]

/** One question and what came of it, oldest first on screen. */
interface Exchange { id: string; question: string; reply?: PatientChatStoredReply; coverage?: PatientChatCoverage; error?: string }

type Availability = { status: 'loading' } | { status: 'error' } | { status: 'ready'; value: PatientChatAvailability }

/** An Idempotency-Key of 16 to 128 URL-safe characters (hid-system): a UUID, or random hex where there is no randomUUID. */
function newKey(): string {
  const web = globalThis.crypto
  if (typeof web?.randomUUID === 'function') return web.randomUUID()
  const bytes = new Uint8Array(16)
  web.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function NoteIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></svg>
}

export function PatientChat() {
  const { state, api } = useSession()
  if (state.status !== 'authenticated' || state.principal.kind !== 'patient') return null
  return <ChatConversation key={state.principal.subjectId} api={api} />
}

export interface ChatConversationApi {
  chatAvailability(options?: { signal?: AbortSignal }): Promise<PatientChatAvailability>
  chat(question: string, ask: { noticeVersion: string; idempotencyKey: string; maxQuestionLength?: number },
    options?: { signal?: AbortSignal }): Promise<PatientChatReply>
  chatHistory(signal?: AbortSignal): Promise<PatientChatHistory>
  clearChatHistory(signal?: AbortSignal): Promise<{ cleared: true; deletedCount: number }>
}

export function ChatConversation({ api }: { api: ChatConversationApi }) {
  const [availability, setAvailability] = useState<Availability>({ status: 'loading' })
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0)
  const [draft, setDraft] = useState('')
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [busy, setBusy] = useState(false)
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [historyAttempt, setHistoryAttempt] = useState(0)
  const [historyError, setHistoryError] = useState('')
  const [resetting, setResetting] = useState(false)
  // The notice is accepted for this visit only: nothing about it is kept in the browser.
  const [accepted, setAccepted] = useState(false)
  const flight = useRef<AbortController | null>(null)
  const attempt = useRef<{ question: string; noticeVersion: string; key: string } | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const history = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)
  useEffect(() => () => { flight.current?.abort() }, [])

  useEffect(() => {
    const controller = new AbortController()
    setAvailability({ status: 'loading' })
    api.chatAvailability({ signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setAvailability({ status: 'ready', value })
    }).catch(() => { if (!controller.signal.aborted) setAvailability({ status: 'error' }) })
    return () => controller.abort()
  }, [api, availabilityAttempt])

  // The history stays readable and deletable while chat is off, so it loads either way.
  useEffect(() => {
    const controller = new AbortController()
    setHistoryStatus('loading'); setHistoryError('')
    void api.chatHistory(controller.signal).then(saved => {
      if (controller.signal.aborted) return
      // The service lists newest first; the conversation reads oldest first.
      setExchanges([...saved.exchanges].reverse().map(item => ({ id: item.messageId, question: item.question, reply: item.reply })))
      setHistoryStatus('ready')
    }).catch(() => {
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

  const offered = availability.status === 'ready' && availability.value.available ? availability.value : null
  const maxQuestion = offered?.maxQuestionLength ?? 1000
  const historyLimit = offered?.historyLimit ?? 50
  const full = exchanges.filter(exchange => exchange.reply).length >= historyLimit

  const chooseQuestion = (question: string) => { setDraft(question); input.current?.focus() }

  const reset = async () => {
    flight.current?.abort()
    const controller = new AbortController(); flight.current = controller
    setResetting(true); setBusy(true); setHistoryError('')
    setExchanges(current => current.map(exchange => exchange.reply || exchange.error ? exchange : { ...exchange, error: 'Reply cancelled. You can ask again.' }))
    try {
      await api.clearChatHistory(controller.signal)
      if (controller.signal.aborted) return
      setExchanges([]); setDraft(''); setHistoryStatus('ready'); followLatest.current = true; attempt.current = null
      input.current?.focus()
    } catch (reason) {
      if (!controller.signal.aborted) setHistoryError(clearFailure(reason))
    } finally {
      if (flight.current === controller) { flight.current = null; setBusy(false); setResetting(false) }
    }
  }

  const send = async () => {
    const question = draft.trim()
    if (!offered || !accepted || historyStatus !== 'ready' || flight.current || !question || question.length > maxQuestion || full) return
    // A retry of the same question under the same notice reuses its key, so a reply that was stored is answered again, not asked again.
    const previous = attempt.current
    const key = previous && previous.question === question && previous.noticeVersion === offered.noticeVersion ? previous.key : newKey()
    attempt.current = { question, noticeVersion: offered.noticeVersion, key }
    const controller = new AbortController(); flight.current = controller
    const id = `pending-${key}`
    followLatest.current = true
    setExchanges(current => [...current.filter(exchange => exchange.id !== id), { id, question }]); setDraft(''); setBusy(true)
    try {
      const reply = await api.chat(question, { noticeVersion: offered.noticeVersion, idempotencyKey: key, maxQuestionLength: maxQuestion },
        { signal: controller.signal })
      if (controller.signal.aborted) return
      attempt.current = null
      setExchanges(current => current.map(exchange => exchange.id === id
        ? { id: reply.messageId, question, reply: { status: reply.status, answer: reply.answer, blocks: reply.blocks, sources: reply.sources }, coverage: reply.coverage }
        : exchange))
    } catch (reason) {
      if (controller.signal.aborted) return
      const failure = askFailure(reason, historyLimit)
      if (failure.newKey) attempt.current = null
      if (failure.noticeChanged) setAccepted(false)
      if (failure.noticeChanged || failure.recheckAvailability) setAvailabilityAttempt(value => value + 1)
      setExchanges(current => current.map(exchange => exchange.id === id ? { ...exchange, error: failure.message } : exchange))
      setDraft(current => current || question)
    } finally {
      if (flight.current === controller) { flight.current = null; setBusy(false) }
    }
  }

  const submit = (event: FormEvent) => { event.preventDefault(); void send() }
  const canAsk = Boolean(offered) && accepted && historyStatus === 'ready' && !busy && !full
  return <section className="patient-section record-chat-page" aria-labelledby="record-chat-title">
    <header className="record-chat-page-header">
      <div><p className="patient-eyebrow">Your record assistant</p><h1 id="record-chat-title" className="patient-page-title">Ask about your records</h1>
        <p className="patient-page-copy">A little clarity, from the records released to you.</p></div>
      <button type="button" className="record-chat-reset" disabled={resetting || historyStatus === 'loading' || (exchanges.length === 0 && !busy)} onClick={() => { void reset() }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>New conversation</button>
    </header>
    <div className="record-chat-panel">
      <header className="record-chat-panel-header"><span className="record-chat-avatar"><NoteIcon /></span><div><h2>Health ID record assistant</h2><p>Uses the records released to your patient account</p></div><span className="record-chat-private">Private to your account</span></header>
      {availability.status === 'loading' && <div className="record-chat-coverage"><p role="status">Checking whether record chat is available…</p></div>}
      {availability.status === 'error' && <div className="record-chat-coverage"><p role="alert">We could not check whether record chat is available.</p>
        <button type="button" onClick={() => setAvailabilityAttempt(value => value + 1)}>Try again</button></div>}
      {availability.status === 'ready' && !availability.value.available && <div className="record-chat-coverage"><p role="status">Record chat is not available. Your saved conversation, if you have one, stays below, and you can delete it.</p></div>}
      {offered && <details className="record-chat-coverage"><summary>Which records can I ask about?</summary>
        <p>{offered.released.length > 0 ? `Record chat can read: ${offered.released.join(', ')}.` : 'Record chat reads only the records released to you.'} Imported history from the previous system is not used. Your care team guides diagnosis and treatment.</p></details>}
      {offered && <section className="record-chat-notice" aria-labelledby="record-chat-notice-title">
        <h2 id="record-chat-notice-title">{CHAT_NOTICE_TITLE}</h2>
        {CHAT_NOTICE_PARAGRAPHS(offered.historyLimit).map(paragraph => <p key={paragraph}>{paragraph}</p>)}
        <label className="record-chat-accept"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} /> {CHAT_NOTICE_ACCEPT}</label>
      </section>}
      <div className="record-chat-coverage">
        {historyStatus === 'loading' && <p role="status">Loading your saved conversation…</p>}
        {historyError && <p role="alert">{historyError}</p>}
        {historyStatus === 'error' && <button type="button" onClick={() => setHistoryAttempt(current => current + 1)}>Retry loading conversation</button>}
        {resetting && <p role="status">Deleting your saved conversation…</p>}
        {full && <p role="status">Your saved conversation is full ({historyLimit} exchanges). Start a new conversation to ask more.</p>}
      </div>
      <div ref={history} className="record-chat-history" onScroll={() => {
        const element = history.current
        if (element) followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
      }}>
        {exchanges.length === 0 && offered && <div className="record-chat-welcome"><span className="record-chat-welcome-icon"><NoteIcon /></span><h2>Understand your health records</h2><p>Ask about your history, medicines or results. Answers based on your records include references you can check.</p>
          <div className="record-chat-suggestions" aria-label="Suggested questions">{suggestions.map(suggestion => <button key={suggestion.title} type="button" onClick={() => chooseQuestion(suggestion.question)}><span>{suggestion.title}</span><small>{suggestion.detail}</small><span className="record-chat-suggestion-arrow" aria-hidden="true">↗</span></button>)}</div>
        </div>}
        <div role="log" aria-label="Record chat" aria-live="polite" aria-relevant="additions text" aria-busy={busy} className="record-chat-messages">
          {exchanges.map(exchange => <article key={exchange.id} className="record-chat-exchange">
            <div className="record-chat-user"><span className="record-chat-message-label">You</span><p>{exchange.question}</p></div>
            <div className="record-chat-assistant"><span className="record-chat-avatar"><NoteIcon /></span><div className="record-chat-reply"><span className="record-chat-message-label">Health ID record assistant</span>
              {exchange.reply ? <ChatAnswer answerId={exchange.id} reply={exchange.reply} coverage={exchange.coverage} />
                : exchange.error ? <p role="alert" className="record-chat-error">{exchange.error}</p>
                  : <p role="status" className="record-chat-thinking"><span className="record-chat-thinking-dots" aria-hidden="true"><i /><i /><i /></span>Reading your released records…</p>}
            </div></div>
          </article>)}
        </div>
      </div>
      {offered && <form className="record-chat-composer" onSubmit={submit}><label htmlFor="record-question">Your question</label>
        <div className="record-chat-input-row"><textarea ref={input} id="record-question" rows={1} value={draft} maxLength={maxQuestion} aria-describedby="record-question-hint" autoComplete="off" placeholder="Ask about your history, medicines or results…"
          onChange={event => setDraft(event.target.value)} onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing && !busy) { event.preventDefault(); void send() }
          }} />
          <button type="submit" disabled={!canAsk || !draft.trim() || draft.trim().length > maxQuestion} aria-label="Send question"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m5 12 7-7 7 7M12 5v15" /></svg><span>Send</span></button>
        </div>
        <div className="record-chat-composer-hints"><span id="record-question-hint">{accepted ? 'Enter to send · Shift + Enter for a new line' : 'Accept the notice above to ask a question'}</span><span>{draft.length}/{maxQuestion}</span></div>
        <p className="record-chat-care-note">Check the record references and speak with your care team about medical decisions.</p>
      </form>}
    </div>
  </section>
}
