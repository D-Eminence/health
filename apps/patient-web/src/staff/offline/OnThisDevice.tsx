import { useEffect, useState } from 'react'
import type { OfflineRuntime, PatientIndexEntry } from '@hid/offline'
import { Button, Card, Field, Input } from '@hid/ui'
import { ON_DEVICE } from './copy'
import { dayTime } from './time'

/**
 * The patients this device keeps, with how long access lasts and what waits to be sent (§2.7). Searching runs on the
 * device: the names and Health IDs are sealed there, never sent to search.
 */
export function OnThisDevice({ runtime, onOpen, busy = false }: {
  runtime: OfflineRuntime
  onOpen: (entry: PatientIndexEntry) => void
  busy?: boolean
}) {
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<PatientIndexEntry[] | null>(null)
  useEffect(() => {
    let active = true
    const read = query.trim() ? runtime.patients.search(query.trim()) : runtime.patients.list()
    void read.then(found => { if (active) setEntries(found) }, () => { if (active) setEntries([]) })
    return () => { active = false }
  }, [runtime, query])
  const now = runtime.trustedNow().at.getTime()
  return <Card className="staff-card offline-on-device"><section aria-labelledby="on-device-title">
    <h2 id="on-device-title">{ON_DEVICE.title}</h2>
    <p>{ON_DEVICE.lede}</p>
    <Field label={ON_DEVICE.search} htmlFor="on-device-search"><Input id="on-device-search" type="search" autoComplete="off" value={query}
      onChange={event => setQuery(event.target.value)} /></Field>
    <div role="status">{entries !== null && entries.length === 0 && <p>{query.trim() ? ON_DEVICE.noMatch : ON_DEVICE.empty}</p>}</div>
    {entries && entries.length > 0 && <ul className="staff-list">{entries.map(entry => {
      const ended = entry.grantExpiresAt !== null && new Date(entry.grantExpiresAt).getTime() <= now
      return <li key={entry.patientId} className="staff-list-item staff-stack">
        <strong>{entry.displayName}</strong>
        <p className="staff-muted">{entry.hidCode} · {ended ? ON_DEVICE.accessEnded : entry.grantExpiresAt ? ON_DEVICE.accessUntil(dayTime(entry.grantExpiresAt)) : ''}
          {entry.pendingCount > 0 ? ` · ${ON_DEVICE.pending(entry.pendingCount)}` : ''}</p>
        {!ended && <Button size="sm" tone="secondary" onClick={() => onOpen(entry)} aria-disabled={busy || undefined}>
          {ON_DEVICE.open}<span className="offline-sr-only"> {entry.displayName}</span></Button>}
      </li>
    })}</ul>}
  </section></Card>
}
