import type { ReactNode } from 'react'
import { CircleCheck, CloudOff, MapPin, RefreshCw } from 'lucide-react'
import { Button } from '../../../../kasuwa/ui'
import { DayScope, useCampaignDay } from './dayContext'

/**
 * The top of Today for someone at work (owner, 14 Nov 2026): where they are, their own count in the campaign, and
 * whether this phone's work is sent. One strip, so the form under it starts high on the screen.
 */
export function YourDay({ campaignId, place, onChange }: {
  readonly campaignId: string
  /** "Ajegunle Town Hall · Registration" */
  readonly place: ReactNode
  readonly onChange: () => void
}) {
  return <DayScope campaignId={campaignId}><Strip place={place} onChange={onChange} /></DayScope>
}

function Strip({ place, onChange }: { readonly place: ReactNode; readonly onChange: () => void }) {
  const { mine, roles, waiting, refused, online, queue, accountId } = useCampaignDay()
  const registers = roles.includes('registrar') || roles.includes('coordinator') || !roles.length
  const screens = roles.some(role => role !== 'registrar' && role !== 'data_checker') || !roles.length
  const counts = mine ? [
    ...(registers ? [`${mine.registered} registered`] : []),
    ...(screens ? [`${mine.screened} screened`] : []),
  ] : []
  const busy = queue.syncing
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-tray px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 inline-flex min-w-0 flex-wrap items-center gap-x-2 text-[14px] text-ink">
          <MapPin className="size-4 shrink-0 text-ink-3" aria-hidden />
          {place}
        </p>
        <Button size="sm" onClick={onChange}>Change</Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px]">
        {counts.length ? <p className="m-0 text-ink"><span className="text-ink-2">You: </span><span className="font-semibold tabular">{counts.join(' · ')}</span></p> : <span />}
        {accountId ? (
          <p role="status" className="m-0 inline-flex items-center gap-2">
            {waiting === 0 && refused === 0
              ? <><CircleCheck className="size-4 text-success-ink" aria-hidden /><span className="text-ink-2">All sent</span></>
              : waiting > 0
                ? <>{online ? <RefreshCw className={`size-4 text-warn-ink ${busy ? 'animate-spin' : ''}`} aria-hidden /> : <CloudOff className="size-4 text-warn-ink" aria-hidden />}
                  <span className="font-medium text-ink">{waiting} waiting to send{online ? '' : ' · no connection'}</span>
                  {online ? <Button size="sm" aria-disabled={busy || undefined} onClick={() => { if (!busy) void queue.sync() }}>{busy ? 'Sending…' : 'Send now'}</Button> : null}</>
                : <span className="font-medium text-danger-ink">{refused} not accepted</span>}
          </p>
        ) : null}
      </div>
    </div>
  )
}
