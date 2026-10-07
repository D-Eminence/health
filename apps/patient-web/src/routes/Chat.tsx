import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { PatientChatReply } from '@hid/contracts'
import { isHidApiError } from '@hid/http'
import { useSession } from '../session'

function failure(reason: unknown): string {
  if (!isHidApiError(reason)) return 'Record chat is unavailable. Please try later.'
  if (reason.status === 401) return 'Your session ended. Please sign in again.'
  if (reason.status === 403) return 'You do not have access to patient record chat.'
  if (reason.status === 409) return 'Your records changed. Please ask your question again.'
  if (reason.status === 429) return 'Please wait before asking another question.'
  if (reason.code === 'CHAT_RECORD_SCOPE_EXCEEDED') return 'Your record history is too large for chat. Please use the Records page.'
  if (reason.code === 'PATIENT_CHAT_DISABLED') return 'Record chat is not enabled yet.'
  if (reason.code === 'REQUEST_TIMEOUT') return 'The reply took too long. Please try later.'
  return 'Record chat is unavailable. Please try later.'
}
export function PatientChat() {
  const { state } = useSession()
  if (state.status !== 'authenticated' || state.principal.kind !== 'patient') return null
  return <ChatConversation key={state.principal.subjectId} />
}
function ChatConversation() {
  const { api } = useSession()
  const [draft, setDraft] = useState('')
  const [exchanges, setExchanges] = useState<Array<{ question: string; reply: PatientChatReply }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const flight = useRef<AbortController | null>(null)
  useEffect(() => () => { flight.current?.abort() }, [])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const question = draft.trim()
    if (flight.current || !question || question.length > 500) return
    const controller = new AbortController(); flight.current = controller
    setBusy(true); setError(null)
    try {
      const reply = await api.chat(question, { signal: controller.signal })
      if (controller.signal.aborted) return
      setExchanges(current => [...current, { question, reply }].slice(-10)); setDraft('')
    } catch (reason) {
      if (!controller.signal.aborted) setError(failure(reason))
    } finally {
      if (!controller.signal.aborted) { flight.current = null; setBusy(false) }
    }
  }
  return <section className="patient-section">
    <h1 className="patient-page-title">Ask about your records</h1>
    <p className="patient-page-copy">Replies use your released clinical notes. Archived imports, attachments, lab results and prescriptions are not included. This does not replace advice from your care team.</p>
    <div role="log" aria-label="Record chat" aria-live="polite">
      {exchanges.map(({ question, reply }, index) => <article className="patient-card" key={index}>
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><strong>You: </strong>{question}</p>
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{reply.answer}</p>
        {reply.status === 'preparing' && <p>Your notes are being prepared. Please ask again shortly.</p>}
        {reply.sources.length > 0 && <><h2>Sources</h2><ul>{reply.sources.map(source =>
          <li key={source.number}>[{source.number}] {source.title} — revision {source.revisionNo}, signed {new Date(source.signedAt).toLocaleDateString('en-NG')}</li>)}</ul></>}
      </article>)}
    </div>
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">Reading your released notes…</p>}
    <form className="patient-card" onSubmit={event => void submit(event)}>
      <label htmlFor="record-question">Your question</label>
      <textarea id="record-question" value={draft} maxLength={500} disabled={busy}
        onChange={event => setDraft(event.target.value)} style={{ display: 'block', width: '100%', minHeight: 100, border: '1px solid #9babbc', padding: 12 }} />
      <button className="patient-primary-button" disabled={busy || !draft.trim()} type="submit">Ask about my records</button>
    </form>
  </section>
}
