import { Component, type ReactNode } from 'react'
import type { OfflineRuntime, SyncSummary } from '@hid/offline'
import { attentionText, CONNECTIVITY, syncingText } from './copy'
import { useOfflineSummary } from './runtime'

type Shown = { tone: 'ok' | 'busy' | 'warn' | 'off'; text: string }

/** One state, the most useful to know first: what needs attention, then whether Health ID can be reached, then sending. */
export function indicatorState(summary: SyncSummary): Shown {
  if (summary.attention > 0) return { tone: 'warn', text: attentionText(summary.attention) }
  if (summary.connectivity === 'offline') return { tone: 'off', text: CONNECTIVITY.offline }
  if (summary.connectivity === 'reconnecting') return { tone: 'busy', text: CONNECTIVITY.reconnecting }
  if (summary.sending > 0) return { tone: 'busy', text: syncingText(summary.sending) }
  if (summary.connectivity === 'slow') return { tone: 'busy', text: CONNECTIVITY.slow }
  return { tone: 'ok', text: CONNECTIVITY.online }
}

/** A small shape beside the words, so the state is never told by colour alone. */
function Icon({ tone }: { tone: Shown['tone'] }) {
  return <svg className="offline-indicator-icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
    {tone === 'ok' && <circle cx="6" cy="6" r="5" fill="currentColor" />}
    {tone === 'busy' && <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2" />}
    {tone === 'warn' && <path d="M6 1 11 11H1Z" fill="currentColor" />}
    {tone === 'off' && <path d="M2 2 10 10M10 2 2 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
  </svg>
}

function Indicator({ runtime }: { runtime: OfflineRuntime }) {
  const summary = useOfflineSummary(runtime)
  if (!summary) return null
  const shown = indicatorState(summary)
  // Passive: a polite status, read when it changes, never focused and never in the way of typing.
  return <span className={`offline-indicator offline-indicator-${shown.tone}`} role="status" aria-live="polite">
    <Icon tone={shown.tone} /><span>{shown.text}</span>
  </span>
}

/** Renders nothing if the indicator fails: a broken status line must never take the workspace with it. */
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  override render() { return this.state.failed ? null : this.props.children }
}

export function ConnectivityIndicator({ runtime }: { runtime: OfflineRuntime }) {
  return <Quiet><Indicator runtime={runtime} /></Quiet>
}
