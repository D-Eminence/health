import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { NovuPatientChatSourceView, NovuPatientChatTypedSource } from '@hid/contracts'
import { novuSourceFailure } from './chatErrors'

/** A record's date as the patient reads it; a calendar date keeps its day in every timezone. */
export function chatSourceDate(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric',
    ...(/^\d{4}-\d{2}-\d{2}$/.test(value) ? { timeZone: 'UTC' } : {}) })
}

type Load =
  | { state: 'loading' }
  | { state: 'ready'; view: NovuPatientChatSourceView }
  | { state: 'failed'; message: string; retry?: boolean }

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

/**
 * One source of the current answer, opened from its "View source" button (hid-system #167): every item and every
 * notice the service sends, the notices first and set apart. Nothing is kept once it closes.
 */
export function ChatSourceDrawer({ source, load, onClose }: {
  source: NovuPatientChatTypedSource
  load: (kind: string, id: string, signal?: AbortSignal) => Promise<NovuPatientChatSourceView>
  onClose: () => void
}) {
  const [result, setResult] = useState<Load>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const panel = useRef<HTMLDivElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const titleId = `chat-source-title-${source.number}`

  useEffect(() => {
    const controller = new AbortController()
    setResult({ state: 'loading' })
    load(source.kind, source.id, controller.signal).then(view => {
      if (!controller.signal.aborted) setResult({ state: 'ready', view })
    }, reason => {
      if (!controller.signal.aborted) setResult({ state: 'failed', ...novuSourceFailure(reason) })
    })
    return () => controller.abort()
  }, [load, source.kind, source.id, attempt])

  // The title takes focus as the panel opens, so a screen reader starts at what was opened.
  useLayoutEffect(() => { title.current?.focus({ preventScroll: true }) }, [])

  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
    if (event.key !== 'Tab' || !panel.current) return
    const stops = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (!stops.length) return
    const first = stops[0]!, last = stops[stops.length - 1]!
    if (event.shiftKey && (document.activeElement === first || document.activeElement === title.current)) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  const view = result.state === 'ready' ? result.view : null
  const happened = chatSourceDate(view ? view.effectiveAt : source.effectiveAt)
  const recorded = chatSourceDate(view ? view.recordedAt : source.recordedAt)
  return <div className="record-chat-drawer-layer">
    <div className="record-chat-drawer-backdrop" aria-hidden="true" onClick={onClose} />
    <div ref={panel} className="record-chat-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={keys}>
      <header className="record-chat-drawer-header">
        <div>
          <p className="record-chat-drawer-kind">Source [{source.number}]{view ? ` · ${view.kindLabel}` : ''}</p>
          <h2 id={titleId} ref={title} tabIndex={-1}>{view ? view.title : source.title}</h2>
        </div>
        <button type="button" className="record-chat-drawer-close" onClick={onClose}>Close</button>
      </header>
      <div className="record-chat-drawer-body">
        {result.state === 'loading' && <p role="status" className="record-chat-thinking">Opening this source…</p>}
        {result.state === 'failed' && <div className="record-chat-drawer-failed">
          <p role="alert" className="record-chat-error">{result.message}</p>
          {result.retry && <button type="button" className="record-chat-reset" onClick={() => setAttempt(current => current + 1)}>Try again</button>}
        </div>}
        {view && <>
          {view.notices.length > 0 && <div className="record-chat-source-notices" role="note" aria-label="Please note">
            <h3>Please note</h3>
            <ul>{view.notices.map((notice, index) => <li key={index}>{notice}</li>)}</ul>
          </div>}
          {/*
            Ola's "Discussed with the patient" button goes here, under the notices, in a later PR. It is not built yet:
            nothing on this panel marks a source as discussed.
          */}
          <dl className="record-chat-drawer-facts">
            <div><dt>Where it came from</dt><dd>{view.originLabel}</dd></div>
            <div><dt>Date</dt><dd>{happened ?? recorded ?? 'Date not recorded'}</dd></div>
            {recorded && happened && recorded !== happened && <div><dt>Recorded</dt><dd>{recorded}</dd></div>}
            <div><dt>Recorded as</dt><dd>{view.provenance}</dd></div>
          </dl>
          {view.items.length > 0
            ? <><h3 className="record-chat-drawer-heading">What the record says</h3>
              <dl className="record-chat-drawer-items">{view.items.map((item, index) =>
                <div key={index}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl></>
            : <p className="record-chat-drawer-empty">This record has no further details to show.</p>}
        </>}
      </div>
    </div>
  </div>
}
