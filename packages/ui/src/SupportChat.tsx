'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
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
  const history = useRef<HTMLDivElement>(null)
  const previouslyOpen = useRef(false)
  // "Start new chat" asks for focus on the question once it can take it: while a reply is on its way it is disabled.
  const [restarted, setRestarted] = useState(0)
  const id = useId()
  useEffect(() => () => { flight.current?.abort() }, [])
  // In the commit that opens or closes the chat, not an effect after it, so focus has moved as soon as it is shown.
  useLayoutEffect(() => {
    if (open) { dialog.current?.showModal(); input.current?.focus() }
    else { dialog.current?.close(); if (previouslyOpen.current) launcher.current?.focus() }
    previouslyOpen.current = open
  }, [open])
  useLayoutEffect(() => { if (restarted) input.current?.focus() }, [restarted])
  useEffect(() => {
    if (history.current) history.current.scrollTop = history.current.scrollHeight
  }, [messages, busy, error, open])
  const close = () => { setOpen(false) }
  const reset = () => {
    flight.current?.abort(); flight.current = null; session.current = undefined
    setMessages([]); setDraft(''); setError(null); setBusy(false); setRestarted(count => count + 1)
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
      onClick={() => setOpen(true)} className="hid-chat-launcher">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-8 8H4l-1 2V11.5a8.5 8.5 0 1 1 17 0Z" /><path d="M7 9h10M7 13h6" /></svg>
      Support chat
    </button>
    <dialog ref={dialog} id={id} aria-labelledby={`${id}-title`} aria-describedby={`${id}-privacy`} onCancel={close} className="hid-chat-panel">
      <header className="hid-chat-header">
        <div><p className="hid-chat-brand">HEALTH ID</p><h2 id={`${id}-title`}>Support chat</h2><p className="hid-chat-subtitle">A little help, right here.</p></div>
        <button type="button" onClick={close} className="hid-chat-close" aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <div className="hid-chat-toolbar"><span>Account &amp; platform help</span><button type="button" onClick={reset}>Start new chat</button></div>
      <div ref={history} className="hid-chat-history">
        {messages.length === 0 && <div className="hid-chat-welcome"><span className="hid-chat-message-label">Health ID support</span><p>Hi there. How can we help?</p><p className="hid-chat-welcome-copy">Ask about signing in, your access PIN or finding your records.</p></div>}
        <div role="log" aria-label="Support messages" aria-live="polite" aria-relevant="additions text" className="hid-chat-messages">
          {messages.map((message, index) => <div key={index} className={`hid-chat-message ${message.role === 'You' ? 'hid-chat-message-user' : 'hid-chat-message-support'}`}>
            <span className="hid-chat-message-label">{message.role === 'You' ? 'You' : 'Health ID support'}</span><p>{message.text}</p>
          </div>)}
        </div>
        {busy && <p role="status" className="hid-chat-status">Support is replying…</p>}
        {error && <p role="alert" className="hid-chat-error">{error}</p>}
      </div>
      <form className="hid-chat-composer" onSubmit={event => void submit(event)}>
        <label htmlFor={`${id}-question`}>Your question</label>
        <div className="hid-chat-input-row"><input ref={input} id={`${id}-question`} value={draft} maxLength={500} onChange={event => setDraft(event.target.value)}
          disabled={busy} placeholder="Type your question…" autoComplete="off" />
          <button type="submit" disabled={busy || !draft.trim()} aria-label="Send"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m4 4 17 8-17 8 3-8-3-8ZM7 12h14" /></svg></button></div>
      </form>
      <footer className="hid-chat-footer"><p id={`${id}-privacy`}>Please don’t share medical records or personal identifiers here.</p><a href={contact}>Email support <span aria-hidden="true">↗</span></a></footer>
    </dialog>
  </>
}
