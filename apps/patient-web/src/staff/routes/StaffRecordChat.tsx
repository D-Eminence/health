import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { PatientChatAvailability, PatientChatCoverage, PatientChatHistory, PatientChatReply, PatientChatStoredReply } from '@hid/contracts'
import '../../routes/chat.css'
import { ChatAnswer } from '../../ChatAnswer'
import { staffAskFailure, staffClearFailure } from '../../chatErrors'
import { STAFF_CHAT_NOTICE_ACCEPT, STAFF_CHAT_NOTICE_PARAGRAPHS, STAFF_CHAT_NOTICE_TITLE } from '../../staffChatNotice'

/**
 * Staff record chat as hid-system main serves it (ADR-069, 0101): a clinician's question about one patient at the
 * facility they selected, for direct care. The same contract as the patient's chat (availability and the notice, an
 * Idempotency-Key, answered / no_evidence / declined / unverified answers with blocks, references and coverage), with
 * the member's own history of this patient. There is no source viewer: `/chat/sources/...` is not served.
 */
export interface StaffRecordChatApi {
  availability(signal?: AbortSignal): Promise<PatientChatAvailability>
  ask(question: string, ask: { noticeVersion: string; idempotencyKey: string; maxQuestionLength?: number },
    options?: { signal?: AbortSignal }): Promise<PatientChatReply>
  history(signal?: AbortSignal): Promise<PatientChatHistory>
  clear(signal?: AbortSignal): Promise<{ cleared: true; deletedCount: number }>
}

interface Exchange { id: string; question: string; reply?: PatientChatStoredReply; coverage?: PatientChatCoverage; error?: string }
type Availability = { status: 'loading' } | { status: 'error' } | { status: 'ready'; value: PatientChatAvailability }

const suggestions = [
  'Summarise this patient’s recorded history and recent events.',
  'What medicines are recorded for this patient, and which are the latest?',
  'What were the last recorded vital signs?',
]

/** An Idempotency-Key of 16 to 128 URL-safe characters (hid-system): a UUID, or random hex where there is no randomUUID. */
function newKey(): string {
  const web = globalThis.crypto
  if (typeof web?.randomUUID === 'function') return web.randomUUID()
  const bytes = new Uint8Array(16)
  web.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function StaffRecordChat({ api, patientName, hid, facilityName, onAccessEnded }: {
  api: StaffRecordChatApi; patientName: string; hid: string; facilityName: string; onAccessEnded?: () => void
}) {
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
  useEffect(() => () => { flight.current?.abort() }, [])

  useEffect(() => {
    const controller = new AbortController()
    setAvailability({ status: 'loading' })
    api.availability(controller.signal).then(value => {
      if (!controller.signal.aborted) setAvailability({ status: 'ready', value })
    }).catch(reason => {
      if (controller.signal.aborted) return
      if (staffAskFailure(reason, 50).accessEnded) onAccessEnded?.()
      setAvailability({ status: 'error' })
    })
    return () => controller.abort()
  }, [api, availabilityAttempt, onAccessEnded])

  // The history stays readable and deletable while chat is off, so it loads either way.
  useEffect(() => {
    const controller = new AbortController()
    setHistoryStatus('loading'); setHistoryError('')
    api.history(controller.signal).then(saved => {
      if (controller.signal.aborted) return
      // The service lists newest first; the conversation reads oldest first.
      setExchanges([...saved.exchanges].reverse().map(item => ({ id: item.messageId, question: item.question, reply: item.reply })))
      setHistoryStatus('ready')
    }).catch(reason => {
      if (controller.signal.aborted) return
      if (staffAskFailure(reason, 50).accessEnded) onAccessEnded?.()
      setHistoryStatus('error'); setHistoryError('Your saved conversation could not be loaded. Please try again.')
    })
    return () => controller.abort()
  }, [api, historyAttempt, onAccessEnded])

  const offered = availability.status === 'ready' && availability.value.available ? availability.value : null
  const maxQuestion = offered?.maxQuestionLength ?? 1000
  const historyLimit = offered?.historyLimit ?? 50
  const full = exchanges.filter(exchange => exchange.reply).length >= historyLimit
  const canAsk = Boolean(offered) && accepted && historyStatus === 'ready' && !busy && !full

  const reset = async () => {
    flight.current?.abort()
    const controller = new AbortController(); flight.current = controller
    setResetting(true); setBusy(true); setHistoryError('')
    setExchanges(current => current.map(exchange => exchange.reply || exchange.error ? exchange : { ...exchange, error: 'Reply cancelled. You can ask again.' }))
    try {
      await api.clear(controller.signal)
      if (controller.signal.aborted) return
      setExchanges([]); setDraft(''); setHistoryStatus('ready'); attempt.current = null
      input.current?.focus()
    } catch (reason) {
      if (!controller.signal.aborted) setHistoryError(staffClearFailure(reason))
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
    setExchanges(current => [...current.filter(exchange => exchange.id !== id), { id, question }]); setDraft(''); setBusy(true)
    try {
      const reply = await api.ask(question, { noticeVersion: offered.noticeVersion, idempotencyKey: key, maxQuestionLength: maxQuestion },
        { signal: controller.signal })
      if (controller.signal.aborted) return
      attempt.current = null
      setExchanges(current => current.map(exchange => exchange.id === id
        ? { id: reply.messageId, question, reply: { status: reply.status, answer: reply.answer, blocks: reply.blocks, sources: reply.sources }, coverage: reply.coverage }
        : exchange))
    } catch (reason) {
      if (controller.signal.aborted) return
      const failure = staffAskFailure(reason, historyLimit)
      if (failure.newKey) attempt.current = null
      if (failure.noticeChanged) setAccepted(false)
      if (failure.noticeChanged || failure.recheckAvailability) setAvailabilityAttempt(value => value + 1)
      setExchanges(current => current.map(exchange => exchange.id === id ? { ...exchange, error: failure.message } : exchange))
      setDraft(current => current || question)
      if (failure.accessEnded) onAccessEnded?.()
    } finally {
      if (flight.current === controller) { flight.current = null; setBusy(false) }
    }
  }

  const submit = (event: FormEvent) => { event.preventDefault(); void send() }
  return <section className="patient-section record-chat-page" aria-labelledby="staff-record-chat-title">
    <header className="record-chat-page-header">
      <div><p className="patient-eyebrow">Record assistant</p><h2 id="staff-record-chat-title" className="patient-page-title">Ask about {patientName}</h2>
        <p className="patient-page-copy">{hid} · {facilityName} · direct care only</p></div>
      <button type="button" className="record-chat-reset" disabled={resetting || historyStatus === 'loading' || (exchanges.length === 0 && !busy)}
        onClick={() => { void reset() }}>New conversation</button>
    </header>
    <div className="record-chat-panel">
      {availability.status === 'loading' && <div className="record-chat-coverage"><p role="status">Checking whether record chat is available…</p></div>}
      {availability.status === 'error' && <div className="record-chat-coverage"><p role="alert">We could not check whether record chat is available.</p>
        <button type="button" onClick={() => setAvailabilityAttempt(value => value + 1)}>Try again</button></div>}
      {availability.status === 'ready' && !availability.value.available && <div className="record-chat-coverage">
        <p role="status">Record chat is not available. Your saved conversation about this patient, if you have one, stays below, and you can delete it.</p></div>}
      {offered && <details className="record-chat-coverage"><summary>Which records can I ask about?</summary>
        <p>{offered.released.length > 0 ? `Record chat can read: ${offered.released.join(', ')}.` : 'Record chat can read none of this patient’s record with your permissions.'}
          {offered.withheld && offered.withheld.length > 0 ? ` Not read: ${offered.withheld.join(', ')}.` : ''} Only this facility’s records are used.</p></details>}
      {offered && <section className="record-chat-notice" aria-labelledby="staff-record-chat-notice-title">
        <h3 id="staff-record-chat-notice-title">{STAFF_CHAT_NOTICE_TITLE}</h3>
        {STAFF_CHAT_NOTICE_PARAGRAPHS(offered.historyLimit).map(paragraph => <p key={paragraph}>{paragraph}</p>)}
        <label className="record-chat-accept"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} /> {STAFF_CHAT_NOTICE_ACCEPT}</label>
      </section>}
      <div className="record-chat-coverage">
        {historyStatus === 'loading' && <p role="status">Loading your saved conversation…</p>}
        {historyError && <p role="alert">{historyError}</p>}
        {historyStatus === 'error' && <button type="button" onClick={() => setHistoryAttempt(current => current + 1)}>Retry loading conversation</button>}
        {resetting && <p role="status">Deleting your saved conversation…</p>}
        {full && <p role="status">Your saved conversation about this patient is full ({historyLimit} exchanges). Start a new conversation to ask more.</p>}
      </div>
      <div className="record-chat-history">
        {exchanges.length === 0 && offered && <div className="record-chat-welcome"><h3>Ask about this patient’s record</h3>
          <p>Answers cite the records they use, so you can check them.</p>
          <div className="record-chat-suggestions" aria-label="Suggested questions">{suggestions.map(question => <button key={question} type="button"
            onClick={() => { setDraft(question); input.current?.focus() }}><span>{question}</span></button>)}</div></div>}
        <div role="log" aria-label="Record chat" aria-live="polite" aria-relevant="additions text" aria-busy={busy} className="record-chat-messages">
          {exchanges.map(exchange => <article key={exchange.id} className="record-chat-exchange">
            <div className="record-chat-user"><span className="record-chat-message-label">You</span><p>{exchange.question}</p></div>
            <div className="record-chat-assistant"><div className="record-chat-reply"><span className="record-chat-message-label">Health ID record assistant</span>
              {exchange.reply ? <ChatAnswer answerId={exchange.id} reply={exchange.reply} coverage={exchange.coverage} />
                : exchange.error ? <p role="alert" className="record-chat-error">{exchange.error}</p>
                  : <p role="status" className="record-chat-thinking">Reading the records you may read…</p>}
            </div></div>
          </article>)}
        </div>
      </div>
      {offered && <form className="record-chat-composer" onSubmit={submit}><label htmlFor="staff-record-question">Your question</label>
        <div className="record-chat-input-row"><textarea ref={input} id="staff-record-question" rows={2} value={draft} maxLength={maxQuestion} autoComplete="off"
          placeholder="Ask about this patient’s history, medicines or results…" onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing && !busy) { event.preventDefault(); void send() }
          }} />
          <button type="submit" disabled={!canAsk || !draft.trim() || draft.trim().length > maxQuestion}>Send</button>
        </div>
        <div className="record-chat-composer-hints"><span>{accepted ? 'Enter to send · Shift + Enter for a new line' : 'Accept the notice above to ask a question'}</span><span>{draft.length}/{maxQuestion}</span></div>
        <p className="record-chat-care-note">Answers can be wrong. Check the record references before you rely on one.</p>
      </form>}
    </div>
  </section>
}
