import type { ReactNode } from 'react'
import { CloudOff, MapPin } from 'lucide-react'
import { Button, cx } from '../../../../kasuwa/ui'
import { DayScope, useCampaignDay } from './dayContext'

/**
 * The top of Today for someone at work (owner, 14 Nov 2026: numbers first, like a dashboard, then the work): their own
 * counts and what this phone still has to send as cards, then where they are, with Change, just above the work. Each
 * thing said once: the campaign's name and dates are the page's heading, the station is the work's own title.
 */
export function YourDay({ campaignId, site, onChange }: {
  readonly campaignId: string
  readonly site: string
  readonly onChange: () => void
}) {
  return <DayScope campaignId={campaignId}><Strip site={site} onChange={onChange} /></DayScope>
}

function Strip({ site, onChange }: { readonly site: string; readonly onChange: () => void }) {
  const { mine, roles, waiting, refused, online, queue, accountId } = useCampaignDay()
  const registers = roles.includes('registrar') || roles.includes('coordinator') || !roles.length
  const screens = roles.some(role => role !== 'registrar' && role !== 'data_checker') || !roles.length
  const busy = queue.syncing
  const cards: ReactNode[] = []
  if (mine && registers) cards.push(<Count key="registered" label="You registered" value={mine.registered} />)
  if (mine && screens) cards.push(<Count key="screened" label="You screened" value={mine.screened} />)
  if (accountId) {
    cards.push(
      <Count key="send" label="To send" value={waiting + refused}
        line={waiting === 0 && refused === 0 ? <span className="font-medium text-success-ink">All sent</span>
          : refused > 0 ? <span className="font-medium text-danger-ink">{refused} not accepted</span>
            : online ? (
              <Button size="sm" className="mt-1 self-start" aria-disabled={busy || undefined} onClick={() => { if (!busy) void queue.sync() }}>
                {busy ? 'Sending…' : 'Send now'}
              </Button>
            ) : <span className="inline-flex items-center gap-1 font-medium text-warn-ink"><CloudOff className="size-3.5" aria-hidden />No connection</span>} />,
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {cards.length ? (
        <div role="group" aria-label="Your day" className={cx('grid gap-2 @md:gap-3', cards.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>{cards}</div>
      ) : null}
      <div className="flex min-w-0 items-center gap-1">
        <p className="m-0 inline-flex min-w-0 items-center gap-1.5 text-[14px] text-ink-2">
          <MapPin className="size-4 shrink-0 text-ink-3" aria-hidden />
          <span className="truncate">At <span className="font-medium text-ink">{site}</span></span>
        </p>
        <Button size="sm" variant="ghost" onClick={onChange} aria-label="Change site or station">Change</Button>
      </div>
    </div>
  )
}

function Count({ label, value, line }: { readonly label: string; readonly value: number; readonly line?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl bg-surface p-3 ring-1 ring-line @md:p-4">
      <span className="text-[13px] leading-tight break-words text-ink-2">{label}</span>
      <span className="mt-1 text-[22px] leading-8 font-semibold tracking-[-0.02em] text-ink tabular @md:text-[26px]">{value.toLocaleString('en-GB')}</span>
      {line ? <span className="flex flex-col text-[12px] @md:text-[13px]">{line}</span> : null}
    </div>
  )
}
