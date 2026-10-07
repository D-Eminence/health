'use client'

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'

export interface SupportChatProps {
  contact: string
  send: (text: string, sessionId: string | undefined, options: { signal: AbortSignal }) =>
    Promise<{ sessionId: string; messages: string[] }>
}
/** Public FAQs only. Exchanges and session identifiers never leave component memory. */
export function SupportChat({ contact, send }: SupportChatProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<Array<{ role: string; text: string }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const session = useRef<string | undefined>(undefined)
  const flight = useRef<AbortController | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const launcher = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  useEffect(() => () => { flight.current?.abort() }, [])
  useEffect(() => {
    if (open) { dialog.current?.showModal(); input.current?.focus() }
    else { dialog.current?.close() }
  }, [open])
  const close = () => { setOpen(false); launcher.current?.focus() }
  const reset = () => {
    flight.current?.abort(); flight.current = null; session.current = undefined
    setMessages([]); setDraft(''); setError(null); setBusy(false); input.current?.focus()
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (flight.current || !text || text.length > 500) return
    const controller = new AbortController(); flight.current = controller
    setBusy(true); setError(null); setDraft('')
    setMessages(current => [...current, { role: 'You', text }].slice(-20))
    try {
      const reply = await send(text, session.current, { signal: controller.signal })
      if (controller.signal.aborted) return
      session.current = reply.sessionId
      setMessages(current => [...current, ...reply.messages.map(text => ({ role: 'Support', text }))].slice(-20))
    } catch (reason) {
      if (controller.signal.aborted) return
      setError(isHidApiError(reason) && reason.status === 429
        ? 'Please wait before sending another message.' : 'Support chat is unavailable. You can email our support team.')
    } finally {
      if (flight.current === controller) { flight.current = null; setBusy(false) }
    }
  }
  return <>
    <button ref={launcher} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(true)} style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 50,
        background: '#0065b3', color: 'white', borderRadius: 24, padding: '12px 20px', border: 0 }}>
      Support chat
    </button>
    <dialog ref={dialog} id={id} aria-labelledby={`${id}-title`} onCancel={close}
      style={{ width: 'min(420px, calc(100vw - 32px))', maxHeight: '85dvh', padding: 20,
        borderRadius: 16, border: '1px solid #ccd5df', color: '#172a3a', background: 'white', overflowY: 'auto' }}>
      <h2 id={`${id}-title`}>Support chat</h2>
      <p>Ask about Health ID. Do not share medical records or personal identifiers here.</p>
      <button type="button" onClick={close}>Close</button>{' '}
      <button type="button" onClick={reset}>Start new chat</button>
      <div role="log" aria-label="Support messages" aria-live="polite" aria-relevant="additions text">
        {messages.map((message, index) => <p key={index} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          <strong>{message.role}: </strong>{message.text}</p>)}
      </div>
      {busy && <p role="status">Support is replying…</p>}
      {error && <p role="alert">{error}</p>}
      <form onSubmit={event => void submit(event)}>
        <label htmlFor={`${id}-question`}>Your question</label>
        <input ref={input} id={`${id}-question`} value={draft} maxLength={500} onChange={event => setDraft(event.target.value)}
          disabled={busy} style={{ display: 'block', width: '100%', border: '1px solid #9babbc', padding: 8, margin: '8px 0' }} />
        <button type="submit" disabled={busy || !draft.trim()}>Send</button>
      </form>
      <p><a href={contact}>Email support</a></p>
    </dialog>
  </>
}
