import '@hid/ui/ehr.css'
import '../../frame/frame.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CloudOff, UserPlus } from 'lucide-react'
import { BrandLogo } from '../../../BrandLogo'
import { Alert, Button, Card, CardHeader } from '../../../kasuwa/ui'
import { staffApi } from '../../../staff/api'
import { DeptPage } from '../parts/DeptPage'
import { claimSend, healthIdUnavailable, noConnection, useOutreachQueue } from './offlineQueue'
import { offlineCampaigns, type OutreachSnapshot } from './offlineStart'
import { NoSignalBanner } from './noSignal'
import { OutreachNew, type CaseAttempt, type OutreachGroupForm } from './OutreachNew'
import { OutreachQueuePanel, queuedText } from './outreachGroup'
import { campaignOpenNow } from './outreachParts'

/** How often the page asks whether there is signal again, while it is shown. */
export const SIGNAL_CHECK_MS = 15_000

/** Said in the banner's place once Health ID answers while a registration is half typed. */
export const SIGNAL_BACK = 'Signal is back. Save or cancel this registration to go online.'

/** What needs Health ID itself, said plainly while there is no signal. */
export const NEEDS_SIGNAL = 'Needs signal: the registrations list from Health ID, health checks, Create Health ID and export.'

/**
 * Outreach in "No signal" mode (owner, 13 November 2026): opened with no connection on Health ID Outreach's own site,
 * from the last confirmed session's few facts (offlineStart.ts), when the session itself can't be read. The volunteer
 * registers people, who are kept on this device ("Saved on this device"), and sees those waiting. Nothing is sent from
 * here: every request needs the session.
 *
 * It asks every SIGNAL_CHECK_MS, and as the browser says it is back online, whether Health ID answers. Once it does,
 * and no registration is half typed, `onSignal` reads the session again as usual: the registrations then go to Health
 * ID by themselves, for this same account, after a sign-in if the session has ended.
 */
export function OfflineOutreach({ snapshot, onSignal }: { readonly snapshot: OutreachSnapshot; readonly onSignal: () => void }) {
  const [view, setView] = useState<'list' | 'new'>('list')
  const [note, setNote] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const attempt = useRef<CaseAttempt>(null)
  const queue = useOutreachQueue(snapshot.actorId, snapshot.facilityId, useCallback(() => undefined, []), { offline: true })
  const signal = useSignalBack()

  // Back online with no registration half typed: the session is read again, as at any start.
  useEffect(() => { if (signal && view === 'list') onSignal() }, [signal, view, onSignal])
  // Whether a campaign is open now is judged against the clock, at least every minute.
  useEffect(() => {
    const timer = window.setInterval(() => setTick(tick => tick + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const campaigns = offlineCampaigns(snapshot).filter(campaign => campaignOpenNow(campaign))
  // The campaigns could not all be read the last time Outreach was open with signal (offlineStart.ts `campaignsUnread`):
  // an empty list then says they couldn't be loaded, and what to do, never that the volunteer is in no campaign.
  const campaignsUnread = snapshot.campaignsUnread ? 'offline' : undefined
  const group: OutreachGroupForm = {
    name: snapshot.facilityName,
    queue: entry => queue.add(entry),
    // Used only when a registration is sent, which never happens here (OutreachNew's `offline`), and given as on Outreach.
    dequeue: localCommandId => queue.discard(localCommandId),
    claim: claimSend,
    onQueued: ({ fullName, reason }) => {
      setNote(queuedText(fullName, reason))
      setView('list')
    },
  }

  return (<>
    {/* The same banner, with the same words, as the open workspace with no signal (staff/App.tsx). */}
    <NoSignalBanner>{signal ? SIGNAL_BACK : undefined}</NoSignalBanner>
    <main className="hid-ehr-host min-h-dvh bg-canvas p-4 @container">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <BrandLogo className="h-7 w-auto self-start" />
        {view === 'new' ? (
          <OutreachNew facilityId={snapshot.facilityId} showCampaign campaigns={campaigns} campaignsUnread={campaignsUnread} attempt={attempt} group={group} offline
            healthChecksServed={snapshot.healthChecksServed} onBack={() => setView('list')} onSending={() => setNote(null)} onCreated={() => setView('list')} />
        ) : (
          <DeptPage title="Outreach" description={`${snapshot.facilityName}${snapshot.displayName ? ` · ${snapshot.displayName}` : ''}`}
            primaryAction={<Button variant="primary" icon={UserPlus} onClick={() => setView('new')}>New registration</Button>}>
            <div className="flex flex-col gap-6">
              {note ? <Alert intent="warning" title="Saved on this device">{note}</Alert> : null}
              <OutreachQueuePanel entries={queue.entries} durable={queue.durable} syncing={false} offline onSync={() => undefined}
                onDiscard={id => void queue.discard(id)} />
              {queue.entries.length === 0 ? <p className="m-0 text-body text-ink-2">Nothing is waiting on this device.</p> : null}
              <section aria-labelledby="outreach-offline-needs-heading">
                <Card>
                  <CardHeader as="h2" icon={CloudOff} iconTone="warn" title="Needs signal" titleId="outreach-offline-needs-heading"
                    description={NEEDS_SIGNAL} />
                </Card>
              </section>
            </div>
          </DeptPage>
        )}
      </div>
    </main>
  </>)
}

/** Whether Health ID answers again: asked as the browser says it is online, and every SIGNAL_CHECK_MS while shown. */
function useSignalBack(): boolean {
  const [back, setBack] = useState(false)
  useEffect(() => {
    let stopped = false
    let asking = false
    const ask = async () => {
      if (stopped || asking || navigator.onLine === false || document.visibilityState === 'hidden') return
      asking = true
      try {
        await staffApi.session()
        if (!stopped) setBack(true)
      } catch (caught) {
        // An answer about the session (signed out, say) means there is signal. No answer at all, or Health ID
        // unavailable just now (408, 429, 5xx, a gateway page), means "No signal" mode stays: it would only fail again.
        if (!stopped && !noConnection(caught) && !healthIdUnavailable(caught)) setBack(true)
      } finally {
        asking = false
      }
    }
    const online = () => { void ask() }
    window.addEventListener('online', online)
    const timer = window.setInterval(online, SIGNAL_CHECK_MS)
    return () => {
      stopped = true
      window.removeEventListener('online', online)
      window.clearInterval(timer)
    }
  }, [])
  return back
}

export default OfflineOutreach
