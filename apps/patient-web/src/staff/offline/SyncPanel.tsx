import { useLayoutEffect, useRef } from 'react'
import type { OfflineRuntime } from '@hid/offline'
import { Button } from '@hid/ui'
import { attentionText, CONNECTIVITY, PANEL, pendingCountText, POLICY_REASONS } from './copy'
import { useOfflineAuditProblem, useOfflineSummary } from './runtime'
import { dayTime } from './time'

/**
 * Offline and sync, in one place (OFFLINE-CONTRACT §2.3, §2.6): the state, when changes were last sent, what is
 * waiting, what works offline and what needs a connection, a way to send now, and notices about storage, the spare
 * key for unsent work, and why offline is not in use when it is not. A labelled region, opened from the top bar.
 */
export function SyncPanel({ runtime, onReview, onClose }: { runtime: OfflineRuntime; onReview: () => void; onClose: () => void }) {
  const summary = useOfflineSummary(runtime)
  const auditProblem = useOfflineAuditProblem()
  const heading = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => { heading.current?.focus() }, [])
  if (!summary) return null
  const policy = runtime.policy()
  const offline = summary.connectivity === 'offline'
  return <section className="staff-card offline-panel" aria-labelledby="offline-panel-title"
    onKeyDown={event => { if (event.key === 'Escape') onClose() }}>
    <div className="staff-row offline-panel-head">
      <h2 id="offline-panel-title" ref={heading} tabIndex={-1}>{PANEL.title}</h2>
      <Button tone="quiet" size="sm" onClick={onClose}>{PANEL.close}</Button>
    </div>
    <dl className="offline-facts">
      <div><dt>Status</dt><dd>{CONNECTIVITY[summary.connectivity]}</dd></div>
      <div><dt>{PANEL.lastSync}</dt><dd>{summary.lastSyncAt ? dayTime(summary.lastSyncAt) : PANEL.never}</dd></div>
      <div><dt>{PANEL.pending}</dt><dd>{pendingCountText(summary.pending)}</dd></div>
      {summary.attention > 0 && <div><dt>{PANEL.attention}</dt><dd>{attentionText(summary.attention)}</dd></div>}
      {summary.leaseUntil && <div><dt>{PANEL.accessUntil}</dt><dd>{dayTime(summary.leaseUntil)}</dd></div>}
    </dl>
    {!policy.enabled && policy.reason && <p className="staff-notice">{POLICY_REASONS[policy.reason]}</p>}
    {summary.clock === 'suspect' && <p className="staff-notice">{PANEL.clockSuspect}</p>}
    {auditProblem && <p className="staff-notice">{PANEL.auditProblem}</p>}
    <div className="staff-row">
      <Button size="sm" onClick={() => runtime.commands.syncNow()} disabled={offline || summary.pending === 0}>{PANEL.syncNow}</Button>
      {summary.attention > 0 && <Button size="sm" tone="secondary" onClick={onReview}>{PANEL.review}</Button>}
    </div>
    {summary.storage.low && <p className="staff-notice">{PANEL.storageLow}</p>}
    {summary.storage.persisted === false && <p className="staff-muted">{PANEL.storageNotKept}</p>}
    <p className="staff-muted">{summary.escrow ? PANEL.escrowOn : PANEL.escrowOff}</p>
    <h3>{PANEL.worksTitle}</h3>
    <ul className="offline-list">{PANEL.works.map(item => <li key={item}>{item}</li>)}</ul>
    <h3>{PANEL.onlineOnlyTitle}</h3>
    <ul className="offline-list">{PANEL.onlineOnly.map(item => <li key={item}>{item}</li>)}</ul>
  </section>
}
