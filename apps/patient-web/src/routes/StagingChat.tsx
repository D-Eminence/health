/**
 * The record chat screen of hid-system's staging branches, as Health-id #61 merged it: the hospital chat
 * ("Ask about this patient") renders it, off unless the build turns it on (VITE_HID_STAFF_PATIENT_CHAT_ENABLED).
 * hid-system `main` serves a different patient contract and no hospital chat; the patient's chat is routes/Chat.tsx.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { StagingPatientChatReply } from '@hid/contracts'
import { isHidApiError } from '@hid/http'
import './chat.css'
import { RecordAnswer } from '../RecordAnswer'
import type { StagingPatientChatHistory } from '@hid/contracts'
import { ChatSourceContent } from '../ChatSource'

const suggestions = [
  { title: 'Summarise my history', detail: 'History and recent events', question: 'Summarise my medical history and important recent recorded events.' },
  { title: 'Find my prescriptions', detail: 'Previous and latest medicines', question: 'What medicines have I previously been prescribed, and which are the latest recorded?' },
  { title: 'Compare my lab results', detail: 'Changes across previous visits', question: 'Compare my laboratory results across visits and show the records supporting the changes.' },
]
const staffSuggestions = [
  { title: 'Summarise history', detail: 'History and recent events', question: 'Summarise this patient’s medical history and important recent recorded events.' },
  { title: 'Find prescriptions', detail: 'Previous and latest medicines', question: 'What medications has this patient previously been prescribed, and which are the most recent recorded?' },
  { title: 'Compare lab results', detail: 'Changes across previous visits', question: 'Compare this patient’s laboratory results across visits and cite the records supporting the changes.' },
]
interface Exchange { id: number; question: string; reply?: StagingPatientChatReply; error?: string }
function failure(reason: unknown): string {
  if (!isHidApiError(reason)) return 'Record chat is unavailable. Please try later.'
  if (reason.status === 401) return 'Your session ended. Please sign in again.'
  if (reason.status === 403) return 'You do not have access to patient record chat.'
  if (reason.code === 'CHAT_CONVERSATION_CHANGED') return 'This conversation was cleared. Please start a new question.'
  if (reason.code === 'CHAT_CONTEXT_TOO_LARGE') return 'This conversation covers too many documents. Start a new conversation.'
  if (reason.status === 409) return 'Your records changed. Please ask your question again.'
  if (reason.status === 429) return 'Please wait before asking another question.'
  if (reason.code === 'CHAT_RECORD_SCOPE_EXCEEDED') return 'Your record history is too large for chat. Please use the Records page.'
  if (reason.code === 'PATIENT_CHAT_DISABLED') return 'Record chat is not available.'
  if (reason.code === 'REQUEST_TIMEOUT') return 'The reply took too long. Please try later.'
  return 'Record chat is unavailable. Please try later.'
}
function NoteIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></svg>
}
export interface StagingChatConversationApi {
  chat(question:string,options?:{signal?:AbortSignal}):Promise<StagingPatientChatReply>
  chatHistory(signal?:AbortSignal):Promise<StagingPatientChatHistory>
  clearChatHistory(signal?:AbortSignal):Promise<{cleared:true}>
  chatSource(kind:string,id:string,signal?:AbortSignal):Promise<Record<string,unknown>>
}
export function StagingChatConversation({api,staff}:{api:StagingChatConversationApi;staff?:{patientName:string;hid:string;facilityName:string}}) {
  const [draft, setDraft] = useState('')
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [busy, setBusy] = useState(false)
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [historyAttempt, setHistoryAttempt] = useState(0)
  const [historyError, setHistoryError] = useState('')
  const [resetting, setResetting] = useState(false)
  const flight = useRef<AbortController | null>(null)
  const nextId = useRef(0)
  const input = useRef<HTMLTextAreaElement>(null)
  const history = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)
  useEffect(() => () => { flight.current?.abort() }, [])
  useEffect(() => {
    const controller = new AbortController()
    setHistoryStatus('loading'); setHistoryError('')
    void api.chatHistory(controller.signal).then(saved => {
      if (controller.signal.aborted) return
      setExchanges(saved.exchanges.map((exchange, index) => ({ id: index, question: exchange.question, reply: exchange.reply })))
      nextId.current = saved.exchanges.length
      setHistoryStatus('ready')
    }).catch(reason => {
      if (controller.signal.aborted) return
      setHistoryStatus('error'); setHistoryError(isHidApiError(reason)&&reason.code==='CHAT_CONTEXT_TOO_LARGE' ? 'This conversation covers too many documents. Start a new conversation to narrow the context.' : 'Your saved conversation could not be loaded. Please try again.')
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
  const chooseQuestion = (question: string) => { setDraft(question); input.current?.focus() }
  const reset = async () => {
    flight.current?.abort()
    const controller = new AbortController(); flight.current = controller
    setResetting(true); setBusy(true); setHistoryError('')
    setExchanges(current => current.map(exchange => exchange.reply || exchange.error ? exchange : { ...exchange, error: 'Reply cancelled. You can ask again.' }))
    try {
      const result = await api.clearChatHistory(controller.signal)
      if (controller.signal.aborted) return
      if (result.cleared !== true) throw new Error('History deletion was not confirmed')
      setExchanges([]); setDraft(''); setHistoryStatus('ready'); followLatest.current = true
      input.current?.focus()
    } catch {
      if (!controller.signal.aborted) setHistoryError('Your saved conversation could not be deleted. Please try again.')
    } finally {
      if (flight.current === controller) { flight.current = null; setBusy(false); setResetting(false) }
    }
  }
  const send = async () => {
    const question = draft.trim()
    if (historyStatus !== 'ready' || flight.current || !question || question.length > 500) return
    const controller = new AbortController(); flight.current = controller
    const id = nextId.current++
    followLatest.current = true
    setExchanges(current => [...current, { id, question }].slice(-10)); setDraft(''); setBusy(true)
    try {
      const reply = await api.chat(question, { signal: controller.signal })
      if (controller.signal.aborted) return
      setExchanges(current => current.map(exchange => exchange.id === id ? { ...exchange, reply } : exchange))
    } catch (reason) {
      if (controller.signal.aborted) return
      setExchanges(current => current.map(exchange => exchange.id === id ? { ...exchange, error: failure(reason) } : exchange))
      setDraft(current => current || question)
    } finally {
      if (flight.current === controller) { flight.current = null; setBusy(false) }
    }
  }
  const PageHeading = staff ? 'h2' : 'h1'
  const submit = (event: FormEvent) => { event.preventDefault(); void send() }
  return <section className="patient-section record-chat-page" aria-labelledby="record-chat-title">
    <header className="record-chat-page-header">
      <div><p className="patient-eyebrow">{staff ? 'Clinical record assistant' : 'Your record assistant'}</p><PageHeading id="record-chat-title" className="patient-page-title">{staff ? 'Ask about this patient' : 'Ask about your records'}</PageHeading><p className="patient-page-copy">{staff ? 'Answers from this patient’s available records, within your current access.' : 'A little clarity, from your clinical notes.'}</p></div>
      <button type="button" className="record-chat-reset" disabled={resetting || historyStatus === 'loading'} onClick={() => { void reset() }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>New conversation</button>
    </header>
    <div className="record-chat-panel">
      <header className="record-chat-panel-header"><span className="record-chat-avatar"><NoteIcon /></span><div><h2>Health ID record assistant</h2><p>{staff ? `${staff.patientName} · ${staff.hid} · ${staff.facilityName}` : 'Uses your available authorized patient records'}</p></div><span className="record-chat-private">{staff ? 'Separate for this patient and your facility membership' : 'Private to your account'}</span></header>
      <details className="record-chat-coverage"><summary>Which records can I ask about?</summary><p>Ask about medical history, prescriptions, conditions, observations, investigations and released lab results. Readable documents can be included; unclear or pending scans are identified. Patient-reported history stays labelled. Your care team guides diagnosis and treatment.</p></details>
      <div className="record-chat-coverage"><p>Your latest 10 exchanges are available for 30 days. New conversation deletes saved chats. Up to four recent exchanges help the assistant understand follow-up questions.</p>
        {historyStatus === 'loading' && <p role="status">Loading your saved conversation…</p>}
        {historyError && <p role="alert">{historyError}</p>}
        {historyStatus === 'error' && <button type="button" onClick={() => setHistoryAttempt(current => current + 1)}>Retry loading conversation</button>}
        {resetting && <p role="status">Deleting your saved conversation…</p>}
      </div>
      <div ref={history} className="record-chat-history" onScroll={() => {
        const element = history.current
        if (element) followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
      }}>
        {exchanges.length === 0 && <div className="record-chat-welcome"><span className="record-chat-welcome-icon"><NoteIcon /></span><h2>{staff ? 'Review this patient’s records' : 'Understand your health records'}</h2><p>{staff ? 'Ask about this patient’s history, medicines or results. Answers include record references you can check.' : 'Ask about your history, medicines or results. Answers based on records include references you can check.'}</p>
          <div className="record-chat-suggestions" aria-label="Suggested questions">{(staff ? staffSuggestions : suggestions).map(suggestion => <button key={suggestion.title} type="button" onClick={() => chooseQuestion(suggestion.question)}><span>{suggestion.title}</span><small>{suggestion.detail}</small><span className="record-chat-suggestion-arrow" aria-hidden="true">↗</span></button>)}</div>
        </div>}
        <div role="log" aria-label="Record chat" aria-live="polite" aria-relevant="additions text" aria-busy={busy} className="record-chat-messages">
          {exchanges.map(exchange => <article key={exchange.id} className="record-chat-exchange">
            <div className="record-chat-user"><span className="record-chat-message-label">You</span><p>{exchange.question}</p></div>
            <div className="record-chat-assistant"><span className="record-chat-avatar"><NoteIcon /></span><div className="record-chat-reply"><span className="record-chat-message-label">Health ID record assistant</span>
              {exchange.reply ? <><RecordAnswer text={exchange.reply.answer} />
                {exchange.reply.coverage && !exchange.reply.coverage.complete && <p className="record-chat-preparing">This answer uses the available matching evidence. Coverage is incomplete{exchange.reply.coverage.pendingDocuments ? `; ${exchange.reply.coverage.pendingDocuments} document(s) are pending, unreadable or not included` : ''}. {exchange.reply.coverage.unavailable.join(' ')}</p>}
                {exchange.reply.status === 'preparing' && <p className="record-chat-preparing">Your records are being prepared. Please ask again shortly.</p>}
                {exchange.reply.sources.length > 0 && <details className="record-chat-sources" open><summary>{exchange.reply.sources.length} record {exchange.reply.sources.length === 1 ? 'reference' : 'references'}</summary><ul>{exchange.reply.sources.map(source => <ChatSourceContent key={source.number} source={source} loadSource={api.chatSource} staff={Boolean(staff)} />)}</ul></details>}
              </> : exchange.error ? <p role="alert" className="record-chat-error">{exchange.error}</p>
                : <p role="status" className="record-chat-thinking"><span className="record-chat-thinking-dots" aria-hidden="true"><i /><i /><i /></span>Reading your authorized records…</p>}
            </div></div>
          </article>)}
        </div>
      </div>
      <form className="record-chat-composer" onSubmit={submit}><label htmlFor="record-question">Your question</label>
        <div className="record-chat-input-row"><textarea ref={input} id="record-question" rows={1} value={draft} maxLength={500} aria-describedby="record-question-hint" autoComplete="off" placeholder={staff ? 'Ask about this patient’s records…' : 'Ask about your history, medicines or results…'}
          onChange={event => setDraft(event.target.value)} onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing && !busy) { event.preventDefault(); void send() }
          }} />
          <button type="submit" disabled={historyStatus !== 'ready' || busy || !draft.trim() || draft.trim().length > 500} aria-label="Send question"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m5 12 7-7 7 7M12 5v15" /></svg><span>Send</span></button>
        </div>
        <div className="record-chat-composer-hints"><span id="record-question-hint">Enter to send · Shift + Enter for a new line</span><span>{draft.length}/500</span></div>
        <p className="record-chat-care-note">{staff ? 'Check source records and use clinical judgement. The assistant does not make treatment decisions.' : 'Check the record references and speak with your care team about medical decisions.'}</p>
      </form>
    </div>
  </section>
}
