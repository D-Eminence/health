import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createRegisteredBrowserClient, createSupportService } from '@hid/api'
import { createApiClient, isHidApiError } from '@hid/http'
import { EhrButton, EhrDrawer, EhrField, EhrInput } from '@hid/ui/ehr'
import { getEnvironment } from '../../../staff/env'
import { holdsPersonalDetails, PERSONAL_DETAILS_REFUSAL, SUPPORT_PRIVACY_NOTICE } from './supportPrivacy'

type SupportSend = (text: string, sessionId: string | undefined, options: { signal: AbortSignal }) =>
  Promise<{ sessionId: string; messages: string[] }>

/** Whether this build offers the support assistant (the ehr build, with the approved support contact). */
export function supportChatOffered(): boolean {
  const environment = getEnvironment()
  return environment.supportChatEnabled && environment.supportContact !== null
}

/**
 * The support assistant's client. support-api answers anyone and knows no session, so this client carries none: no
 * cookie, no CSRF token and no bearer token reach it, only the question and the chat's own session id.
 */
function supportSend(): SupportSend {
  const transport = createApiClient({ baseUrl: getEnvironment().apiBaseUrl, clientId: 'staff-web', sessionMode: 'bearer' })
  return createSupportService({ app: 'staff-web', client: createRegisteredBrowserClient(transport, 'staff-web') }).chat
}

/** The account menu's Help: the support assistant, in a drawer of the blue frame. */
export function SupportChatDrawer({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  return <EhrDrawer open={open} title="Help" onClose={onClose}>
    <BlueSupportChat contact={getEnvironment().supportContact ?? ''} />
  </EhrDrawer>
}

/**
 * Health ID's support assistant (support-api, as the patient portal's SupportChat asks it), for staff: account and
 * platform questions only. The privacy notice stands above the question, and a question holding a Health ID, a NIN,
 * an email address or a phone number is refused before anything is sent. The exchange and the chat's session id live
 * in this component's memory only: nothing is kept in the browser, and closing Help ends the chat.
 */
export function BlueSupportChat({ contact }: { readonly contact: string }) {
  const id = useId()
  const send = useRef<SupportSend | null>(null)
  const session = useRef<string | undefined>(undefined)
  const flight = useRef<AbortController | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<readonly { readonly mine: boolean; readonly text: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => () => { flight.current?.abort() }, [])

  function restart() {
    flight.current?.abort(); flight.current = null; session.current = undefined
    setMessages([]); setDraft(''); setError(null); setBusy(false)
    input.current?.focus()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (flight.current || !text || text.length > 500) return
    // Refused here, before any request: the question stays in the box to be changed.
    if (holdsPersonalDetails(text)) {
      setError(PERSONAL_DETAILS_REFUSAL)
      input.current?.focus()
      return
    }
    const controller = new AbortController(); flight.current = controller
    setBusy(true); setError(null); setDraft('')
    setMessages(current => [...current, { mine: true, text }].slice(-20))
    try {
      send.current ??= supportSend()
      const reply = await send.current(text, session.current, { signal: controller.signal })
      if (controller.signal.aborted) return
      session.current = reply.sessionId
      setMessages(current => [...current, ...reply.messages.map(message => ({ mine: false, text: message }))].slice(-20))
    } catch (reason) {
      if (controller.signal.aborted) return
      setError(isHidApiError(reason) && reason.status === 429
        ? 'Please wait before sending another message.' : 'Support chat is unavailable. You can email our support team.')
    } finally {
      if (flight.current === controller) { flight.current = null; setBusy(false) }
    }
  }

  return <div className="hid-ehr-blue-support">
    <div className="hid-ehr-blue-support-toolbar">
      <p className="hid-ehr-blue-flush"><strong>Support chat</strong> <span className="hid-ehr-blue-muted">Account & platform help</span></p>
      <EhrButton variant="quiet" size="sm" onClick={restart}>Start new chat</EhrButton>
    </div>
    {messages.length === 0 ? <p className="hid-ehr-blue-muted">Ask about signing in, your workspace or how Health ID works.</p> : null}
    <div role="log" aria-label="Support messages" aria-live="polite" aria-relevant="additions text" className="hid-ehr-blue-support-log">
      {messages.map((message, index) => <div key={index}
        className={message.mine ? 'hid-ehr-blue-support-message hid-ehr-blue-support-mine' : 'hid-ehr-blue-support-message'}>
        <span className="hid-ehr-blue-muted">{message.mine ? 'You' : 'Health ID support'}</span>
        <p className="hid-ehr-blue-flush">{message.text}</p>
      </div>)}
    </div>
    {busy ? <p role="status" className="hid-ehr-blue-muted">Support is replying…</p> : null}
    {error ? <p role="alert" className="hid-ehr-error">{error}</p> : null}
    <p id={`${id}-notice`} className="hid-ehr-blue-support-notice">{SUPPORT_PRIVACY_NOTICE}</p>
    <form className="hid-ehr-blue-support-form" onSubmit={event => void submit(event)}>
      <EhrField label="Your question">
        <EhrInput ref={input} value={draft} maxLength={500} autoComplete="off" disabled={busy}
          onChange={event => { setDraft(event.target.value); if (error === PERSONAL_DETAILS_REFUSAL) setError(null) }} />
      </EhrField>
      <EhrButton type="submit" disabled={busy || !draft.trim()}>Send</EhrButton>
    </form>
    {contact ? <p className="hid-ehr-blue-flush"><a className="hid-ehr-blue-link" href={contact}>Email support</a></p> : null}
  </div>
}
