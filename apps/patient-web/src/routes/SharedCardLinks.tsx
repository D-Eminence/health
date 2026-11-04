import { useCallback, useRef, useState } from 'react'
import { Mail } from 'lucide-react'
import { isHidApiError } from '@hid/http'
import { Badge, Button, Card, type Tone } from '../kasuwa/ui'
import { ConfirmSheet } from '../kasuwa/parts'
import { LoadProblem, Problem, Saved } from './profileParts'
import { useSession } from '../session'
import { ItemName } from '../ItemName'
import { useOnNotificationChange } from '../notificationBadge'
import { cardSharesEnabled } from '../cardSharesFlag'
import {
  cardShareProblem, cardShareScopeLabel, learnCardSharesServed, saysCardSharesNotServed,
  type CardShare, type CardShareEndedReason, type CardShareList,
} from '../cardShares'
import { usePatientResource } from './usePatientResource'
import { useActionFocus, useRetryFocus } from './actionFocus'

/**
 * The patient's card links (step 8, hid-system 0118): GET identity/me/card-shares, read only while the build's switch is
 * on. Its answer is also how the portal learns the backend serves card links: 200 served, 404 NOT_FOUND not (nothing is
 * shown, as today). Kept for the account under one name, so Access and sharing, its list and the send flow share it.
 */
export function useCardShareList() {
  const { api } = useSession()
  const on = cardSharesEnabled()
  const load = useCallback(async (signal?: AbortSignal): Promise<CardShareList | null> => {
    if (!on) return null
    try {
      const list = await api.cardShares(signal)
      learnCardSharesServed(true)
      return list
    } catch (error) {
      if (saysCardSharesNotServed(error) || (isHidApiError(error) && error.status === 404)) { learnCardSharesServed(false); return null }
      throw error
    }
  }, [api, on])
  return usePatientResource<CardShareList | null>(load, 'card-shares')
}

const dateOnly = (value: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' }).format(new Date(value))
const dateTime = (value: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }).format(new Date(value))
const timeOnly = (value: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }).format(new Date(value))

const ENDED_WORDS: Readonly<Record<CardShareEndedReason, string>> = {
  patient_ended: 'you ended it', replaced: 'replaced by a new link', expired: 'expired', account_deleted: 'account deleted',
  patient_inactive: 'account not active', address_blocked: 'they stopped these emails', too_many_wrong_codes: 'too many wrong codes',
}

function stateOf(item: CardShare): { words: string; tone: Tone } {
  switch (item.status) {
    case 'active': return { words: 'Active', tone: 'success' }
    case 'locked': return { words: 'Paused for now', tone: 'warn' }
    case 'expired': return { words: 'Expired', tone: 'neutral' }
    case 'ended': return { words: item.endedReason ? `Ended: ${ENDED_WORDS[item.endedReason]}` : 'Ended', tone: 'neutral' }
  }
}

/** Who a link went to, as the patient knows them: their label and address while it lasts, the masked address after. */
export const cardShareRecipient = (item: CardShare) => item.recipientEmail
  ? item.label ? `${item.label} (${item.recipientEmail})` : item.recipientEmail : item.recipientHint

const live = (item: CardShare) => item.status === 'active' || item.status === 'locked'

/**
 * "Your card, shared by email" on Who has access, modelled on the invitations card: each link with who it went to, what
 * it shows, until when, how often it was opened and its state, and End now for one still open. Ending asks once, and
 * says that whoever is looking now is stopped within a minute (the open page checks every 30 seconds) and that the
 * person is not told. Not shown while switched off or not served.
 */
export function SharedCardLinksCard() {
  const { api } = useSession()
  const links = useCardShareList()
  const [ending, setEnding] = useState<CardShare | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusAfter = useActionFocus()
  const retryFocus = useRetryFocus(heading)
  // An open, a lock or an ending (each writes a notice): the list is read again by itself.
  useOnNotificationChange(() => { if (links.data) void links.reload() })

  if (!cardSharesEnabled() || (links.data === null && !links.error)) return null

  const end = async () => {
    if (!ending || busy) return
    const who = ending.recipientEmail ?? ending.recipientHint
    setBusy(true); setError(null); setNotice(null)
    try {
      await api.endCardShare(ending.id)
      await links.reload()
      setEnding(null)
      setNotice(`Link ended. ${who} can no longer open your card.`)
      focusAfter(() => heading.current)
    } catch (cause) {
      setEnding(null)
      setError(cardShareProblem(cause, 'Couldn’t end the link. Try again.'))
      if (isHidApiError(cause) && cause.code === 'CARD_SHARE_NOT_FOUND') void links.reload()
      focusAfter(() => document.getElementById(`end-card-link-${ending.id}`) ?? heading.current)
    } finally { setBusy(false) }
  }

  const list = links.data
  return <Card aria-busy={(links.loading && list !== null) || undefined} aria-labelledby="card-links-heading">
    <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 ref={heading} id="card-links-heading" tabIndex={-1} className="m-0 text-title-3 text-ink outline-none">Your card, shared by email</h2>
        <p className="m-0 text-[13px] text-ink-3">Each person needs a code we email them to open it.</p>
      </div>
      <Button to="/access/share/card" size="sm" icon={Mail}>Send my card</Button>
    </div>
    {(links.error || error) && <div className="flex flex-col gap-3 px-5 pt-4">
      {links.error && <LoadProblem what="your shared links" error={`We couldn’t load your shared links. ${links.error}`} buttonRef={retryFocus.button}
        onRetry={() => retryFocus.retry(links.reload)} />}
      {error && <Problem>{error}</Problem>}
    </div>}
    <div className="px-5 empty:hidden"><Saved>{notice}</Saved></div>
    {list && !links.error && (list.items.length === 0 ? <div className="flex flex-col items-start gap-3 px-5 py-6">
      <p className="m-0 text-[13px] text-ink-3">You haven’t sent your card to anyone.</p>
      <Button to="/access/share/card" size="sm" variant="primary" icon={Mail}>Send my card</Button></div>
      : <ul className="m-0 list-none divide-y divide-line p-0">{list.items.map(item => { const state = stateOf(item)
        return <li key={item.id} className="flex flex-col gap-3 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-semibold [overflow-wrap:anywhere] text-ink">{cardShareRecipient(item)}</p>
              <p className="m-0 mt-0.5 text-[13px] text-ink-3">{cardShareScopeLabel(item.scope)} · Read only · Until {dateOnly(item.expiresAt)}</p>
              <p className="m-0 text-[13px] text-ink-3">Sent {dateTime(item.createdAt)} · {item.openCount > 0
                ? `Opened ${item.openCount} ${item.openCount === 1 ? 'time' : 'times'}${item.lastOpenedAt ? `, last at ${timeOnly(item.lastOpenedAt)}` : ''}` : 'Not opened yet'}</p>
              <p className="m-0 text-[12px] text-ink-3">Reference {item.reference}</p>
              {live(item) && (item.delivery === 'not_sent' || item.delivery === 'failed') &&
                <p className="m-0 mt-1 text-[13px] text-warn-ink">We couldn’t email this one. Try again tomorrow.</p>}
              {item.status === 'locked' && item.lockedUntil && <p className="m-0 mt-1 text-[13px] text-warn-ink">Too many wrong codes were entered. It opens again at {timeOnly(item.lockedUntil)}.</p>}
            </div>
            <Badge size="sm" tone={state.tone}>{state.words}</Badge>
          </div>
          {live(item) && <div><Button id={`end-card-link-${item.id}`} size="sm" variant="danger" disabled={busy || links.loading}
            onClick={() => setEnding(item)}>End now <ItemName>the link to {item.recipientEmail ?? item.recipientHint}</ItemName></Button></div>}
        </li> })}</ul>)}
    {list && list.liveCount > 0 && <p className="m-0 border-t border-line px-5 py-3 text-[13px] text-ink-3">{list.liveCount} of {list.liveLimit} links open.
      You can send {Math.max(0, list.dailyLimit - list.createdToday)} more today.</p>}
    <ConfirmSheet open={ending !== null} onClose={() => setEnding(null)} title="End this link?" destructive busy={busy} confirmLabel="End now" onConfirm={() => void end()}
      effect={ending ? `End this link now? ${ending.recipientEmail ?? ending.recipientHint} won’t be able to open your card again, and anyone looking at it now is stopped within a minute. They aren’t told you ended it.` : ''} />
  </Card>
}
